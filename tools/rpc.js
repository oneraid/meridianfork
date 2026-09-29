import { Connection } from "@solana/web3.js";
import { log } from "../logger.js";

/**
 * Prioritized RPC Manager
 * Priority order:
 * 1. Primary Helius API Key / RPC_URL
 * 2. Helius Backup Keys (HELIUS_BACKUP_KEYS)
 * 3. Alchemy RPC (ALCHEMY_RPC_URL or ALCHEMY_API_KEY)
 * 4. Fallback RPC_URL / Public Solana RPC
 */

class RpcManager {
  constructor() {
    this.endpoints = [];
    this.connections = new Map();
    this.activeEndpoint = null;
    this.cooldownDurationMs = 2 * 60 * 1000; // 2 minutes cooldown on rate limit
    this.healthCheckIntervalMs = 30 * 1000; // Probe higher priority RPC every 30s
    this.proxyConnection = null;
    this.initialized = false;
    this.healthCheckTimer = null;
  }

  buildEndpoints() {
    const list = [];
    const seenUrls = new Set();
    const existingMap = new Map(this.endpoints.map((e) => [e.url, e]));

    const addEndpoint = (url, name, type, priority) => {
      if (!url || typeof url !== "string") return;
      const cleanUrl = url.trim();
      if (!cleanUrl || seenUrls.has(cleanUrl)) return;
      seenUrls.add(cleanUrl);
      const existing = existingMap.get(cleanUrl);
      list.push({
        name,
        url: cleanUrl,
        type,
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
      addEndpoint(`https://mainnet.helius-rpc.com/?api-key=${heliusApiKey.trim()}`, "Helius (Primary)", "helius", 1);
    } else if (rpcUrl && rpcUrl.includes("helius")) {
      addEndpoint(rpcUrl, "Helius (Primary)", "helius", 1);
    }

    // 2. Helius Backup Keys
    const heliusBackups = (process.env.HELIUS_BACKUP_KEYS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    heliusBackups.forEach((key, idx) => {
      addEndpoint(`https://mainnet.helius-rpc.com/?api-key=${key}`, `Helius (Backup ${idx + 1})`, "helius", 2);
    });

    // 3. Alchemy Fallback
    const alchemyUrl = process.env.ALCHEMY_RPC_URL;
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    if (alchemyUrl && !alchemyUrl.includes("YOUR_ALCHEMY_API_KEY")) {
      addEndpoint(alchemyUrl, "Alchemy (Backup)", "alchemy", 3);
    } else if (alchemyKey && alchemyKey.trim()) {
      addEndpoint(`https://solana-mainnet.g.alchemy.com/v2/${alchemyKey.trim()}`, "Alchemy (Backup)", "alchemy", 3);
    }

    // 4. Configured RPC_URL if not already added
    if (rpcUrl) {
      addEndpoint(rpcUrl, "Configured RPC", "custom", 4);
    }

    // 5. Default Public Fallback (emergency read-only fallback)
    addEndpoint("https://api.mainnet-beta.solana.com", "Solana Public Mainnet", "public", 5);

    this.endpoints = list;
    if (!this.activeEndpoint && this.endpoints.length > 0) {
      this.activeEndpoint = this.selectBestAvailableEndpoint();
    }
  }

  init() {
    if (this.initialized) return;
    this.buildEndpoints();
    this.activeEndpoint = this.selectBestAvailableEndpoint();
    this.initialized = true;

    if (this.activeEndpoint) {
      log("rpc", `Initialized RPC Manager with ${this.endpoints.length} endpoints. Active: ${this.activeEndpoint.name}`);
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

  getRawConnection(endpoint) {
    if (!this.connections.has(endpoint.url)) {
      this.connections.set(
        endpoint.url,
        new Connection(endpoint.url, {
          commitment: "confirmed",
          disableRetryOnRateLimit: true, // Fail fast on 429 so RPC Manager can immediately rotate to a healthy endpoint
        })
      );
    }
    return this.connections.get(endpoint.url);
  }

  selectBestAvailableEndpoint() {
    const now = Date.now();
    // Sort by priority ascending (1 is best)
    const sorted = [...this.endpoints].sort((a, b) => a.priority - b.priority);

    // 1. Pick first endpoint whose cooldown has expired
    for (const ep of sorted) {
      if (ep.cooldownUntil <= now) {
        ep.isExhausted = false; // Cooldown expired, eligible again
        return ep;
      }
    }

    // 2. If all are cooling down, pick the one with earliest cooldown expiry
    return sorted.sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0] || this.endpoints[0];
  }

  markEndpointFailed(endpoint, err) {
    const now = Date.now();
    const isExhausted = this.isQuotaExhaustedError(err);
    const isRateLimit = isExhausted || this.isRateLimitError(err);

    if (isExhausted) {
      endpoint.isExhausted = true;
      endpoint.cooldownUntil = now + 12 * 60 * 60 * 1000; // 12 hours cooldown for exhausted quota
    } else if (isRateLimit) {
      endpoint.cooldownUntil = now + this.cooldownDurationMs; // 2 minutes for temporary rate limit
    } else {
      endpoint.cooldownUntil = now + 30_000;
    }

    endpoint.consecutiveErrors += 1;
    endpoint.lastError = err?.message || String(err);

    const oldActive = this.activeEndpoint;
    const next = this.selectBestAvailableEndpoint();

    if (next && next.url !== oldActive?.url) {
      this.activeEndpoint = next;
      log(
        "rpc_warn",
        `RPC [${oldActive?.name}] ${isExhausted ? "quota exhausted (max usage reached)" : "error"}: ${endpoint.lastError}. Failing over immediately to [${next.name}] (Priority ${next.priority})`
      );
    }
  }

  async autoRecoverHigherPriorityRpc() {
    try {
      const current = this.activeEndpoint;
      if (!current) return;

      const now = Date.now();
      // Look for any endpoint with strictly better priority whose cooldown has expired
      const higherPriorityEps = this.endpoints
        .filter((ep) => ep.priority < current.priority && ep.cooldownUntil <= now)
        .sort((a, b) => a.priority - b.priority);

      for (const candidate of higherPriorityEps) {
        // Probe candidate with lightweight getSlot in background
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
            this.activeEndpoint = candidate;
            log(
              "rpc",
              `Recovered higher priority RPC [${candidate.name}] (Slot: ${slot}). Switched active RPC back to [${candidate.name}].`
            );
            return;
          }
        } catch (probeErr) {
          // If probe still fails, push cooldown forward again without disrupting active traffic!
          this.markEndpointFailed(candidate, probeErr);
        }
      }
    } catch {
      // Non-blocking background healthcheck
    }
  }

  getConnection() {
    this.init();
    if (this.proxyConnection) return this.proxyConnection;

    const self = this;
    const handler = {
      get(target, prop) {
        if (prop === "rpcEndpoint") {
          const active = self.activeEndpoint || self.selectBestAvailableEndpoint();
          return active ? active.url : "";
        }

        const active = self.activeEndpoint || self.selectBestAvailableEndpoint();
        const rawConn = self.getRawConnection(active);
        const value = rawConn[prop];

        if (typeof value === "function") {
          return async function (...args) {
            let lastError = null;
            const maxAttempts = Math.max(1, self.endpoints.length);

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
              const currentEp = self.activeEndpoint || self.selectBestAvailableEndpoint();
              const conn = self.getRawConnection(currentEp);

              try {
                const fn = conn[prop];
                if (typeof fn !== "function") return fn;
                return await fn.apply(conn, args);
              } catch (err) {
                lastError = err;
                if (self.isRateLimitError(err)) {
                  self.markEndpointFailed(currentEp, err);
                  // Immediately loop to the next available healthy endpoint
                  continue;
                }
                throw err;
              }
            }
            throw lastError;
          };
        }
        return value;
      },
    };

    this.proxyConnection = new Proxy({}, handler);
    return this.proxyConnection;
  }

  maskUrl(url) {
    if (!url) return "";
    return url.replace(/(api-key=|v2\/)([a-zA-Z0-9_-]{4})([a-zA-Z0-9_-]+)([a-zA-Z0-9_-]{4})/g, (m, p, s, mid, e) => {
      return `${p}${s}...${e}`;
    });
  }

  getActiveEndpoint() {
    this.init();
    return this.activeEndpoint;
  }

  getStatus() {
    this.init();
    const now = Date.now();
    return {
      active: this.activeEndpoint
        ? {
            name: this.activeEndpoint.name,
            url: this.maskUrl(this.activeEndpoint.url),
            type: this.activeEndpoint.type,
            priority: this.activeEndpoint.priority,
          }
        : null,
      endpoints: this.endpoints.map((ep) => {
        const isCoolingDown = ep.cooldownUntil > now;
        const cooldownSecondsLeft = Math.max(0, Math.ceil((ep.cooldownUntil - now) / 1000));
        return {
          name: ep.name,
          url: this.maskUrl(ep.url),
          type: ep.type,
          priority: ep.priority,
          isActive: this.activeEndpoint?.url === ep.url,
          isExhausted: !!ep.isExhausted,
          isCoolingDown,
          cooldownSecondsLeft,
          consecutiveErrors: ep.consecutiveErrors || 0,
          lastError: ep.lastError || null,
        };
      }),
    };
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
    this.activeEndpoint = this.selectBestAvailableEndpoint();
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
