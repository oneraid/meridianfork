import { Connection } from "@solana/web3.js";
import { log } from "../logger.js";

/**
 * Solana RPC Manager with Smart Dual-Routing (Read vs Execute)
 *
 * Routing Policy:
 * 1. Read / Monitoring queries (getBalance, getAccountInfo, pooler PnL, token balances, etc.):
 *    -> Routed to Solana Public Mainnet (api.mainnet-beta.solana.com) by default to save 100% of free-tier credits!
 *    -> If Public hits rate limit (429) or cooldown, auto-fails over seamlessly to Helius / Alchemy.
 *
 * 2. Execution / Write transactions (sendTransaction, simulateTransaction, getLatestBlockhash, confirmTransaction):
 *    -> Routed strictly to Helius (Primary) -> Helius Backups -> Alchemy -> Custom.
 *    -> Public Solana is excluded to prevent transaction drops and simulation lag.
 */

export const EXECUTION_METHODS = new Set([
  "sendTransaction",
  "sendRawTransaction",
  "sendEncodedTransaction",
  "simulateTransaction",
  "getLatestBlockhash",
  "getRecentBlockhash",
  "confirmTransaction",
  "getSignatureStatus",
  "getSignatureStatuses",
  "getTransaction",
  "getParsedTransaction",
  "getParsedTransactions",
  "getProgramAccounts",
]);

class RpcManager {
  constructor() {
    this.endpoints = [];
    this.connections = new Map();
    this.activeEndpoint = null;
    this.cooldownDurationMs = 2 * 60 * 1000; // 2 minutes cooldown on rate limit
    this.publicCooldownDurationMs = 60 * 1000; // 1 minute cooldown for public RPC
    this.healthCheckIntervalMs = 30 * 1000; // Probe higher priority RPC every 30s
    this.proxyConnection = null;
    this.initialized = false;
    this.healthCheckTimer = null;

    // Credit-saving telemetry
    this.stats = {
      readCalls: 0,
      writeCalls: 0,
      publicReadCalls: 0,
      privateReadCalls: 0,
      privateWriteCalls: 0,
      failoverCount: 0,
      startedAt: Date.now(),
    };
  }

  buildEndpoints() {
    const list = [];
    const seenUrls = new Set();
    const existingMap = new Map(this.endpoints.map((e) => [e.url, e]));

    const addEndpoint = (url, name, type, priority, role) => {
      if (!url || typeof url !== "string") return;
      const cleanUrl = url.trim();
      if (!cleanUrl || seenUrls.has(cleanUrl)) return;
      seenUrls.add(cleanUrl);
      const existing = existingMap.get(cleanUrl);
      list.push({
        name,
        url: cleanUrl,
        type,
        role: role || (type === "public" ? "Free Read & Monitoring" : "Execution & Fallback"),
        priority, // Lower number = higher priority
        cooldownUntil: existing ? existing.cooldownUntil : 0,
        isExhausted: existing ? existing.isExhausted : false,
        consecutiveErrors: existing ? existing.consecutiveErrors : 0,
        lastError: existing ? existing.lastError : null,
      });
    };

    // 1. Primary Helius
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const rpcUrl = process.env.RPC_URL;
    if (heliusApiKey) {
      addEndpoint(
        `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey.trim()}`,
        "Helius (Primary)",
        "helius",
        1,
        "Execution & Write Primary"
      );
    } else if (rpcUrl && rpcUrl.includes("helius")) {
      addEndpoint(rpcUrl, "Helius (Primary)", "helius", 1, "Execution & Write Primary");
    }

    // 2. Helius Backup Keys
    const heliusBackups = (process.env.HELIUS_BACKUP_KEYS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    heliusBackups.forEach((key, idx) => {
      addEndpoint(
        `https://mainnet.helius-rpc.com/?api-key=${key}`,
        `Helius (Backup ${idx + 1})`,
        "helius",
        2,
        "Execution & Write Backup"
      );
    });

    // 3. Alchemy Fallback (Primary + Multiple Backups)
    const alchemyUrl = process.env.ALCHEMY_RPC_URL;
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    let alchemyPrimaryAdded = false;
    if (alchemyUrl && !alchemyUrl.includes("YOUR_ALCHEMY_API_KEY")) {
      addEndpoint(alchemyUrl, "Alchemy (Primary)", "alchemy", 3, "Execution & Write Fallback");
      alchemyPrimaryAdded = true;
    } else if (alchemyKey && alchemyKey.trim()) {
      addEndpoint(
        `https://solana-mainnet.g.alchemy.com/v2/${alchemyKey.trim()}`,
        "Alchemy (Primary)",
        "alchemy",
        3,
        "Execution & Write Fallback"
      );
      alchemyPrimaryAdded = true;
    }

    // Multiple Alchemy Backup Keys
    const alchemyBackups = (process.env.ALCHEMY_BACKUP_KEYS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    alchemyBackups.forEach((keyOrUrl, idx) => {
      const url = keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")
        ? keyOrUrl
        : `https://solana-mainnet.g.alchemy.com/v2/${keyOrUrl}`;
      const name = alchemyPrimaryAdded ? `Alchemy (Backup ${idx + 1})` : `Alchemy (Backup ${idx + 1})`;
      addEndpoint(url, name, "alchemy", 3, "Execution & Write Fallback");
    });

    // 4. Custom RPC URLs / QuickNode / Triton / Other
    const customUrls = (process.env.CUSTOM_RPC_URLS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    customUrls.forEach((url, idx) => {
      let providerName = `Custom RPC #${idx + 1}`;
      let pType = "custom";
      if (url.includes("quiknode") || url.includes("quicknode")) {
        providerName = `QuickNode (Backup ${idx + 1})`;
        pType = "quicknode";
      } else if (url.includes("triton") || url.includes("rpcpool")) {
        providerName = `Triton (Backup ${idx + 1})`;
        pType = "triton";
      } else if (url.includes("alchemy")) {
        providerName = `Alchemy (Backup ${idx + 1})`;
        pType = "alchemy";
      }
      addEndpoint(url, providerName, pType, 4, "Custom Backup");
    });

    // 5. Configured RPC_URL if not already added
    if (rpcUrl) {
      addEndpoint(rpcUrl, "Configured RPC", "custom", 4, "Custom Backup");
    }

    // 6. Default Public Solana (Free Monitoring & Reads primary)
    addEndpoint(
      "https://api.mainnet-beta.solana.com",
      "Solana Public Mainnet",
      "public",
      5,
      "Free Read & Monitoring Primary"
    );

    this.endpoints = list;
    if (!this.activeEndpoint && this.endpoints.length > 0) {
      this.activeEndpoint = this.selectEndpointForPurpose("write");
    }
  }

  init() {
    if (this.initialized) return;
    this.buildEndpoints();
    this.activeEndpoint = this.selectEndpointForPurpose("write");
    this.initialized = true;

    if (this.activeEndpoint) {
      log(
        "rpc",
        `Initialized Smart RPC Router with ${this.endpoints.length} endpoints. Write Primary: [${this.activeEndpoint.name}], Free Read Primary: [Solana Public Mainnet]`
      );
    }

    // Start background auto-recovery healthcheck
    if (!this.healthCheckTimer) {
      this.healthCheckTimer = setInterval(() => this.autoRecoverHigherPriorityRpc(), this.healthCheckIntervalMs);
      if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
    }
  }

  isQuotaExhaustedError(err) {
    if (!err) return false;
    const msg = String(err?.message || err).toLowerCase();
    return (
      msg.includes("max usage reached") ||
      msg.includes("quota exceeded") ||
      msg.includes("credits exhausted") ||
      msg.includes("monthly limit") ||
      msg.includes("account has exceeded")
    );
  }

  isRateLimitError(err) {
    if (!err) return false;
    const msg = String(err?.message || err).toLowerCase();
    return (
      msg.includes("429") ||
      msg.includes("too many requests") ||
      msg.includes("rate limit") ||
      this.isQuotaExhaustedError(err)
    );
  }

  isRecoverableRpcError(err) {
    if (!err) return false;
    const msg = String(err?.message || err).toLowerCase();
    return (
      this.isRateLimitError(err) ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("fetch failed") ||
      msg.includes("network error") ||
      msg.includes("socket hang up") ||
      msg.includes("503") ||
      msg.includes("502") ||
      msg.includes("504") ||
      msg.includes("bad gateway") ||
      msg.includes("gateway timeout") ||
      msg.includes("service unavailable")
    );
  }

  getRawConnection(endpoint) {
    if (!this.connections.has(endpoint.url)) {
      this.connections.set(
        endpoint.url,
        new Connection(endpoint.url, {
          commitment: "confirmed",
          disableRetryOnRateLimit: true, // Fail fast on 429 so RPC Manager can immediately rotate
        })
      );
    }
    return this.connections.get(endpoint.url);
  }

  /**
   * Smart endpoint selection based on purpose:
   * - "write": Exclude public RPC; pick highest priority private RPC (Helius -> Alchemy -> Custom)
   * - "read": Pick Public Solana RPC first. If public is cooling down or rate-limited, fallback to private RPC.
   */
  selectEndpointForPurpose(purpose = "read", excludeUrls = new Set()) {
    const now = Date.now();

    if (purpose === "write") {
      // 1. Filter out public endpoints for write/execution
      const privateCandidates = this.endpoints.filter((e) => e.type !== "public" && !excludeUrls.has(e.url));
      const pool = privateCandidates.length > 0 ? privateCandidates : this.endpoints.filter((e) => !excludeUrls.has(e.url));
      const sorted = [...pool].sort((a, b) => a.priority - b.priority);

      // Find first with expired cooldown
      for (const ep of sorted) {
        if (ep.cooldownUntil <= now) {
          ep.isExhausted = false;
          return ep;
        }
      }
      // If all cooling down, pick earliest expiry
      return sorted.sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0] || this.endpoints[0];
    } else {
      // READ / MONITORING traffic
      // 1. Try Public Solana first to preserve paid/free-tier credits
      const publicEndpoints = this.endpoints.filter(
        (e) => e.type === "public" && !excludeUrls.has(e.url) && e.cooldownUntil <= now
      );
      if (publicEndpoints.length > 0) {
        return publicEndpoints[0];
      }

      // 2. If Public Solana is cooling down or excluded, fallback to private nodes by priority
      const fallbackCandidates = this.endpoints.filter((e) => !excludeUrls.has(e.url));
      const sorted = [...fallbackCandidates].sort((a, b) => a.priority - b.priority);

      for (const ep of sorted) {
        if (ep.cooldownUntil <= now) {
          ep.isExhausted = false;
          return ep;
        }
      }

      // 3. Fallback to any remaining
      return sorted.sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0] || this.endpoints[0];
    }
  }

  selectBestAvailableEndpoint() {
    return this.selectEndpointForPurpose("write");
  }

  markEndpointFailed(endpoint, err) {
    const now = Date.now();
    const isExhausted = this.isQuotaExhaustedError(err);
    const isRateLimit = isExhausted || this.isRateLimitError(err);

    if (isExhausted) {
      endpoint.isExhausted = true;
      endpoint.cooldownUntil = now + 12 * 60 * 60 * 1000; // 12 hours cooldown for exhausted quota
    } else if (isRateLimit) {
      // Public RPC gets a short 60s cooldown; private gets 2 minutes
      endpoint.cooldownUntil = now + (endpoint.type === "public" ? this.publicCooldownDurationMs : this.cooldownDurationMs);
    } else {
      endpoint.cooldownUntil = now + 30_000;
    }

    endpoint.consecutiveErrors += 1;
    endpoint.lastError = err?.message || String(err);

    log(
      "rpc_warn",
      `RPC [${endpoint.name}] (${endpoint.type}) ${
        isExhausted ? "quota exhausted" : isRateLimit ? "rate limit (429)" : "error"
      }: ${endpoint.lastError}. Cooldown until ${new Date(endpoint.cooldownUntil).toLocaleTimeString()}`
    );

    // Update activeEndpoint reference if the failed one was the active write node
    if (this.activeEndpoint?.url === endpoint.url) {
      this.activeEndpoint = this.selectEndpointForPurpose("write");
    }
  }

  recordSuccess(endpoint, purpose) {
    if (purpose === "write") {
      this.stats.writeCalls += 1;
      this.stats.privateWriteCalls += 1;
    } else {
      this.stats.readCalls += 1;
      if (endpoint.type === "public") {
        this.stats.publicReadCalls += 1;
      } else {
        this.stats.privateReadCalls += 1;
      }
    }
  }

  async autoRecoverHigherPriorityRpc() {
    try {
      const now = Date.now();
      // Check if any higher priority or cooling down endpoints have recovered
      const coolingDownEps = this.endpoints.filter((ep) => ep.cooldownUntil > 0 && ep.cooldownUntil <= now);

      for (const candidate of coolingDownEps) {
        try {
          const testConn = this.getRawConnection(candidate);
          const slot = await Promise.race([
            testConn.getSlot("confirmed"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000)),
          ]);
          if (Number.isFinite(slot) && slot > 0) {
            candidate.consecutiveErrors = 0;
            candidate.cooldownUntil = 0;
            candidate.isExhausted = false;
            candidate.lastError = null;
            log("rpc", `RPC [${candidate.name}] recovered successfully (Slot: ${slot}). Ready for traffic.`);
          }
        } catch (probeErr) {
          // Push cooldown slightly without spamming logs
          candidate.cooldownUntil = now + 30_000;
        }
      }
    } catch {
      // Non-blocking background healthcheck
    }
  }

  getConnection(enforcedPurpose = null) {
    this.init();
    if (this.proxyConnection && !enforcedPurpose) return this.proxyConnection;

    const self = this;
    const handler = {
      get(target, prop) {
        if (prop === "rpcEndpoint") {
          const active = self.selectEndpointForPurpose(enforcedPurpose || "write");
          return active ? active.url : "";
        }

        return async function (...args) {
          // Identify purpose: write vs read
          const isWrite = enforcedPurpose === "write" || (!enforcedPurpose && EXECUTION_METHODS.has(prop));
          const purpose = isWrite ? "write" : "read";

          let lastError = null;
          const maxAttempts = Math.max(1, self.endpoints.length);
          const attemptedUrls = new Set();

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const currentEp = self.selectEndpointForPurpose(purpose, attemptedUrls);
            if (!currentEp) break;
            attemptedUrls.add(currentEp.url);

            const conn = self.getRawConnection(currentEp);
            try {
              const fn = conn[prop];
              if (typeof fn !== "function") return fn;
              const result = await fn.apply(conn, args);
              self.recordSuccess(currentEp, purpose);
              return result;
            } catch (err) {
              lastError = err;
              if (self.isRecoverableRpcError(err)) {
                self.stats.failoverCount += 1;
                self.markEndpointFailed(currentEp, err);
                // Continue to fallback endpoint
                continue;
              }
              // For non-recoverable client errors (e.g. invalid signature/params), throw immediately
              throw err;
            }
          }
          throw lastError;
        };
      },
    };

    const proxy = new Proxy({}, handler);
    if (!enforcedPurpose) {
      this.proxyConnection = proxy;
    }
    return proxy;
  }

  maskUrl(url) {
    if (!url) return "";
    return url.replace(/(api-key=|v2\/)([a-zA-Z0-9_-]{4})([a-zA-Z0-9_-]+)([a-zA-Z0-9_-]{4})/g, (m, p, s, mid, e) => {
      return `${p}${s}...${e}`;
    });
  }

  getActiveEndpoint(purpose = "write") {
    this.init();
    return this.selectEndpointForPurpose(purpose);
  }

  getStatus() {
    this.init();
    const now = Date.now();
    const activeWrite = this.selectEndpointForPurpose("write");
    const activeRead = this.selectEndpointForPurpose("read");

    const totalCalls = this.stats.readCalls + this.stats.writeCalls;
    const creditsSavedPct = totalCalls > 0 ? Math.round((this.stats.publicReadCalls / totalCalls) * 100) : 0;

    return {
      active: activeWrite
        ? {
            name: activeWrite.name,
            url: this.maskUrl(activeWrite.url),
            type: activeWrite.type,
            priority: activeWrite.priority,
            role: activeWrite.role,
          }
        : null,
      activeRead: activeRead
        ? {
            name: activeRead.name,
            url: this.maskUrl(activeRead.url),
            type: activeRead.type,
            priority: activeRead.priority,
            role: activeRead.role,
          }
        : null,
      routing: {
        mode: "Smart Dual-Routing (Read vs Execute)",
        readRule: "Public Solana (Fallback ke Helius/Alchemy saat limit)",
        writeRule: "Helius Primary (Fallback ke Alchemy/Custom)",
      },
      stats: {
        readCalls: this.stats.readCalls,
        writeCalls: this.stats.writeCalls,
        publicReadCalls: this.stats.publicReadCalls,
        privateReadCalls: this.stats.privateReadCalls,
        privateWriteCalls: this.stats.privateWriteCalls,
        failoverCount: this.stats.failoverCount,
        creditsSavedPct,
      },
      endpoints: this.endpoints.map((ep) => {
        const isCoolingDown = ep.cooldownUntil > now;
        const cooldownSecondsLeft = Math.max(0, Math.ceil((ep.cooldownUntil - now) / 1000));
        return {
          id: ep.url,
          name: ep.name,
          url: this.maskUrl(ep.url),
          type: ep.type,
          role: ep.role,
          priority: ep.priority,
          isActiveWrite: activeWrite?.url === ep.url,
          isActiveRead: activeRead?.url === ep.url,
          isExhausted: !!ep.isExhausted,
          isCoolingDown,
          cooldownSecondsLeft,
          consecutiveErrors: ep.consecutiveErrors || 0,
          lastError: ep.lastError || null,
        };
      }),
    };
  }

  reloadEndpoints() {
    this.buildEndpoints();
    this.activeEndpoint = this.selectEndpointForPurpose("write");
  }

  async probeAllEndpoints() {
    this.init();
    const results = [];
    for (const ep of this.endpoints) {
      const start = Date.now();
      try {
        const conn = this.getRawConnection(ep);
        const slot = await Promise.race([
          conn.getSlot("confirmed"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout (4s)")), 4000)),
        ]);
        const latencyMs = Date.now() - start;
        ep.consecutiveErrors = 0;
        ep.cooldownUntil = 0;
        ep.isExhausted = false;
        ep.lastError = null;
        results.push({ name: ep.name, ok: true, slot, latencyMs });
      } catch (err) {
        this.markEndpointFailed(ep, err);
        results.push({ name: ep.name, ok: false, error: err?.message || String(err) });
      }
    }
    this.activeEndpoint = this.selectEndpointForPurpose("write");
    return {
      results,
      status: this.getStatus(),
    };
  }
}

export const rpcManager = new RpcManager();

export function getConnection() {
  return rpcManager.getConnection();
}

export function getReadConnection() {
  return rpcManager.getConnection("read");
}

export function getExecutionConnection() {
  return rpcManager.getConnection("write");
}
