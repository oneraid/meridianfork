import fs from "fs";
import { setDefaultResultOrder } from "dns";
try {
  setDefaultResultOrder("ipv4first");
} catch (_) { }
import { PublicKey } from "@solana/web3.js";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";
import { getWalletPositions, deployPosition, closePosition, getMyPositions } from "./tools/dlmm.js";
import { addLesson } from "./lessons.js";
import { getTrackedPosition, updateClosedPnL } from "./state.js";
import { zapOutTokensToSol } from "./tools/executor.js";

async function autoZapOutAfterClose(closeRes, label = "smart_lp copy close") {
  try {
    const candidateMints = new Set();
    if (Array.isArray(closeRes?.tokens_to_swap)) {
      closeRes.tokens_to_swap.forEach((m) => candidateMints.add(m));
    }
    if (closeRes?.base_mint) candidateMints.add(closeRes.base_mint);
    if (closeRes?.token_x_mint) candidateMints.add(closeRes.token_x_mint);
    if (closeRes?.token_y_mint) candidateMints.add(closeRes.token_y_mint);

    const zapRes = await zapOutTokensToSol({
      mints: Array.from(candidateMints),
      sweepWallet: true,
      label,
    });
    if (zapRes?.swapped) {
      log("smart_lp", `Zap-out completed after copy close: received ~${zapRes.total_sol_received?.toFixed(4)} SOL`);
    }
    return zapRes;
  } catch (err) {
    log("smart_lp_warn", `Zap-out after copy close error: ${err.message}`);
    return null;
  }
}

const CONFIG_FILE = repoPath("smart-lp-config.json");
const HISTORY_FILE = repoPath("smart-lp-history.json");

const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DEFAULT_CONFIG = {
  enabled: false,
  mode: "observe", // "observe" | "copy"
  active_copy_wallet: "",
  wallets: [], // [{ address, name, enabled, addedAt }]
  poll_interval_sec: 30,
  copy_settings: {
    max_sol_per_position: 0.3,
    gas_reserve: 0.02,
    max_active_positions: 1,
    slippage_bps: 100,
    auto_stop_loss_pct: 15,
    auto_take_profit_pct: 4,
    auto_close_on_target_exit: true,
    priority_fallback_minutes: 15,
  },
  last_poll: null,
};

const DEFAULT_HISTORY = {
  positions_by_wallet: {}, // wallet_address -> positions array
  all_target_positions: [], // flattened positions list enriched with wallet info
  copied_positions_map: {}, // target_position_pubkey -> { user_position_pubkey, pool_address, open_time, user_sol, status }
  activities: [],
  insights: {
    total_observed_entries: 0,
    total_copied_entries: 0,
    preferred_bin_steps: {},
    preferred_strategies: {},
    average_bin_width: 0,
    average_bins_below: 0,
    average_bins_above: 0,
    pool_tvl_stats: { min: null, max: null, avg: 0 },
    pool_volume_stats: { min: null, max: null, avg: 0 },
    average_hold_minutes: 0,
    completed_trades_count: 0,
    win_rate_pct: 0,
    wins_count: 0,
    losses_count: 0,
    breakeven_count: 0,
    total_realized_pnl_usd: 0,
    total_unrealized_pnl_usd: 0,
    total_net_pnl_usd: 0,
    avg_pnl_pct: 0,
    best_trade_pnl_pct: null,
    worst_trade_pnl_pct: null,
    wallet_performance: {},
    active_in_profit_count: 0,
  },
  priority_rotation: {
    current_priority: 0,
    timer_started_at: null,
  },
};

// ─── Persistence & Migration ──────────────────────────────────────
export function loadSmartLpConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    saveSmartLpConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    const config = {
      ...DEFAULT_CONFIG,
      ...raw,
      wallets: Array.isArray(raw.wallets) ? raw.wallets : [],
      copy_settings: {
        ...DEFAULT_CONFIG.copy_settings,
        ...(raw.copy_settings || {}),
      },
    };

    // Auto-migrate legacy single-target config if wallets array is empty
    if (config.wallets.length === 0 && raw.target_wallet && SOLANA_PUBKEY_RE.test(raw.target_wallet)) {
      config.wallets.push({
        address: raw.target_wallet,
        name: raw.target_name || "Target 1",
        enabled: true,
        copy_enabled: true,
        copy_priority: 0,
        addedAt: new Date().toISOString(),
      });
      if (!config.active_copy_wallet) {
        config.active_copy_wallet = raw.target_wallet;
      }
      saveSmartLpConfig(config);
    }

    // Ensure wallets have copy_enabled, copy_priority, and copy_strategy properties
    let walletsMigrated = false;
    for (let i = 0; i < config.wallets.length; i++) {
      const w = config.wallets[i];
      if (w.copy_enabled === undefined) {
        w.copy_enabled = (w.address === config.active_copy_wallet);
        walletsMigrated = true;
      }
      if (w.copy_priority === undefined) {
        w.copy_priority = (w.address === config.active_copy_wallet) ? 0 : (w.copy_enabled ? 1 : i);
        walletsMigrated = true;
      }
      if (w.copy_strategy === undefined) {
        w.copy_strategy = (w.name?.toLowerCase().includes("wallet 3") || w.address === "GAgLMuwFatGw2LdeoZEJECgGTN2h8Wn5nF7EdiDawRXC")
          ? "bid_ask"
          : "spot";
        walletsMigrated = true;
      }
    }
    if (config.copy_settings.priority_fallback_minutes === undefined) {
      config.copy_settings.priority_fallback_minutes = 15;
      walletsMigrated = true;
    }
    if (config.copy_settings.gas_reserve === undefined) {
      config.copy_settings.gas_reserve = 0.02;
      walletsMigrated = true;
    }
    if (walletsMigrated) {
      saveSmartLpConfig(config);
    }

    return config;
  } catch (e) {
    log("smart_lp_error", `Failed to load config: ${e.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveSmartLpConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    log("smart_lp_error", `Failed to save config: ${e.message}`);
    return false;
  }
}

export function loadSmartLpHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    saveSmartLpHistory(DEFAULT_HISTORY);
    return { ...DEFAULT_HISTORY };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    const history = {
      ...DEFAULT_HISTORY,
      ...raw,
      positions_by_wallet: raw.positions_by_wallet || {},
      all_target_positions: raw.all_target_positions || raw.last_target_positions || [],
      insights: {
        ...DEFAULT_HISTORY.insights,
        ...(raw.insights || {}),
      },
      priority_rotation: {
        ...DEFAULT_HISTORY.priority_rotation,
        ...(raw.priority_rotation || {}),
      },
    };

    if ((raw.insights?.win_rate_pct == null || raw.insights?.total_realized_pnl_usd == null) && (history.activities || []).length > 0) {
      recalculateInsights(history);
      saveSmartLpHistory(history);
    }

    return history;
  } catch (e) {
    log("smart_lp_error", `Failed to load history: ${e.message}`);
    return { ...DEFAULT_HISTORY };
  }
}

export function saveSmartLpHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    return true;
  } catch (e) {
    log("smart_lp_error", `Failed to save history: ${e.message}`);
    return false;
  }
}

export function pruneActivitiesPerWallet(activities, maxPerWallet = 100, maxTotal = 600) {
  if (!Array.isArray(activities)) return [];
  const byWalletCount = new Map();
  const kept = [];
  for (const act of activities) {
    const w = act.target_wallet || act.target_name || "unknown";
    const count = byWalletCount.get(w) || 0;
    if (count < maxPerWallet && kept.length < maxTotal) {
      byWalletCount.set(w, count + 1);
      kept.push(act);
    }
  }
  return kept;
}

// ─── Multi-Wallet Management ─────────────────────────────────────
export function addSmartLpWallet({ address, name, copy_strategy }) {
  const trimmed = String(address || "").trim();
  if (!SOLANA_PUBKEY_RE.test(trimmed)) {
    return { success: false, error: "Invalid Solana address format" };
  }

  const config = loadSmartLpConfig();
  const existing = config.wallets.find((w) => w.address === trimmed);
  if (existing) {
    return { success: false, error: `Wallet already tracked as "${existing.name}"` };
  }

  const validStrategies = ["auto", "spot", "bid_ask", "curve"];
  const rawStrat = String(copy_strategy || "auto").toLowerCase();
  const strat = (rawStrat === "ba" || rawStrat === "bidask") ? "bid_ask" : rawStrat;
  const finalStrategy = validStrategies.includes(strat) ? strat : "auto";

  const newWallet = {
    address: trimmed,
    name: String(name || "").trim().slice(0, 50) || `Whale #${config.wallets.length + 1}`,
    enabled: true,
    copy_strategy: finalStrategy,
    addedAt: new Date().toISOString(),
  };

  config.wallets.push(newWallet);
  if (!config.active_copy_wallet) {
    config.active_copy_wallet = trimmed;
  }

  saveSmartLpConfig(config);
  log("smart_lp", `Added target wallet: ${newWallet.name} (${trimmed.slice(0, 8)}...) [Strategy: ${finalStrategy}]`);

  // Trigger quick poll in background for this new wallet
  pollTargetWallet("wallet_added").catch(() => { });

  return { success: true, wallet: newWallet, wallets: config.wallets };
}

export function removeSmartLpWallet({ address }) {
  const config = loadSmartLpConfig();
  const index = config.wallets.findIndex((w) => w.address === address);
  if (index === -1) {
    return { success: false, error: "Wallet not found in tracked list" };
  }

  const removed = config.wallets.splice(index, 1)[0];
  if (config.active_copy_wallet === address) {
    config.active_copy_wallet = config.wallets[0]?.address || "";
  }

  saveSmartLpConfig(config);

  // Clean up positions history for this wallet
  const history = loadSmartLpHistory();
  if (history.positions_by_wallet) {
    delete history.positions_by_wallet[address];
    history.all_target_positions = (history.all_target_positions || []).filter(
      (p) => p.wallet_address !== address
    );
    saveSmartLpHistory(history);
  }

  log("smart_lp", `Removed target wallet: ${removed.name}`);
  return { success: true, removed: removed.name, wallets: config.wallets };
}

export function setActiveCopyWallet({ address }) {
  const config = loadSmartLpConfig();
  const target = config.wallets.find((w) => w.address === address);
  if (!target) {
    return { success: false, error: "Wallet not found in tracked list" };
  }

  target.copy_enabled = true;
  target.copy_priority = 0;
  config.active_copy_wallet = address;

  // Demote other priority 0 wallets to priority 1
  for (const w of config.wallets) {
    if (w.address !== address && w.copy_enabled && w.copy_priority === 0) {
      w.copy_priority = 1;
    }
  }

  saveSmartLpConfig(config);
  log("smart_lp", `Active copy target switched to Priority 0: ${target.name} (${address.slice(0, 8)}...)`);
  return { success: true, active_copy_wallet: address, name: target.name, wallets: config.wallets };
}

export function setWalletCopyPriority({ address, copy_enabled, copy_priority, copy_strategy }) {
  const config = loadSmartLpConfig();
  const wallet = config.wallets.find((w) => w.address === address);
  if (!wallet) {
    return { success: false, error: "Wallet not found in tracked list" };
  }

  if (copy_enabled !== undefined) {
    wallet.copy_enabled = Boolean(copy_enabled);
  }
  if (copy_priority !== undefined) {
    wallet.copy_priority = Math.max(0, parseInt(copy_priority, 10) || 0);
  }
  if (copy_strategy !== undefined) {
    const valid = ["auto", "spot", "bid_ask", "curve"];
    const s = String(copy_strategy).toLowerCase();
    const normalized = (s === "ba" || s === "bidask") ? "bid_ask" : s;
    if (valid.includes(normalized)) {
      wallet.copy_strategy = normalized;
    }
  }

  if (wallet.copy_enabled && wallet.copy_priority === 0) {
    config.active_copy_wallet = wallet.address;
    for (const w of config.wallets) {
      if (w.address !== address && w.copy_enabled && w.copy_priority === 0) {
        w.copy_priority = 1;
      }
    }
  }

  saveSmartLpConfig(config);
  log("smart_lp", `Updated copy priority for ${wallet.name}: enabled=${wallet.copy_enabled}, priority=${wallet.copy_priority}, strategy=${wallet.copy_strategy}`);
  return { success: true, wallet, wallets: config.wallets };
}

export function setWalletCopyStrategy({ address, copy_strategy }) {
  const config = loadSmartLpConfig();
  const wallet = config.wallets.find((w) => w.address === address);
  if (!wallet) {
    return { success: false, error: "Wallet not found in tracked list" };
  }

  const validStrategies = ["auto", "spot", "bid_ask", "curve"];
  const s = String(copy_strategy || "").toLowerCase();
  const normalized = (s === "ba" || s === "bidask") ? "bid_ask" : s;
  if (!validStrategies.includes(normalized)) {
    return { success: false, error: `Invalid strategy: ${copy_strategy}. Choose auto, spot, bid_ask, or curve.` };
  }

  wallet.copy_strategy = normalized;
  saveSmartLpConfig(config);
  log("smart_lp", `Updated copy strategy for ${wallet.name}: ${normalized}`);
  return { success: true, wallet, wallets: config.wallets };
}

export function getWalletLastActivity(address, history) {
  if (!history) return null;
  const acts = (history.activities || []).filter((a) => a.target_wallet === address);
  let latestIso = acts.length > 0 ? acts[0].timestamp : null;

  const positions = history.positions_by_wallet?.[address] || [];
  for (const p of positions) {
    if (p.age_minutes != null) {
      const posTime = new Date(Date.now() - p.age_minutes * 60 * 1000).toISOString();
      if (!latestIso || posTime > latestIso) {
        latestIso = posTime;
      }
    }
  }
  return latestIso;
}

export function isWalletIdle(address, history, fallbackMinutes = 15, isPriority0 = false) {
  if (fallbackMinutes <= 0) {
    if (isPriority0 && history?.priority_rotation?.prio0_focus_timer_started_at) {
      const elapsed = Date.now() - new Date(history.priority_rotation.prio0_focus_timer_started_at).getTime();
      return elapsed >= 15 * 60 * 1000;
    }
    return true;
  }

  // If we recently returned to Priority 0, give Priority 0 the full fallbackMinutes window to produce a new trade
  if (isPriority0 && history?.returned_to_priority_0_at) {
    const elapsedSinceReturn = Date.now() - new Date(history.returned_to_priority_0_at).getTime();
    if (elapsedSinceReturn < fallbackMinutes * 60 * 1000) {
      return false; // Still within grace period waiting for next transaction
    }
  }

  const lastAct = getWalletLastActivity(address, history);
  if (!lastAct) return true;
  const elapsedMs = Date.now() - new Date(lastAct).getTime();
  return elapsedMs >= fallbackMinutes * 60 * 1000;
}

export function toggleTrackedWallet({ address, enabled }) {
  const config = loadSmartLpConfig();
  const wallet = config.wallets.find((w) => w.address === address);
  if (!wallet) {
    return { success: false, error: "Wallet not found in tracked list" };
  }

  wallet.enabled = enabled !== undefined ? Boolean(enabled) : !wallet.enabled;
  saveSmartLpConfig(config);
  log("smart_lp", `Toggled wallet ${wallet.name}: enabled=${wallet.enabled}`);
  return { success: true, wallet, wallets: config.wallets };
}

// ─── Pool Metadata Fetcher (Cached) ───────────────────────────────
const _poolMetaCache = new Map();
const POOL_META_TTL = 10 * 60 * 1000;

async function getPoolDetails(poolAddress) {
  const cached = _poolMetaCache.get(poolAddress);
  if (cached && Date.now() - cached.fetchedAt < POOL_META_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`https://dlmm.datapi.meteora.ag/pools/${poolAddress}`);
    if (res.ok) {
      const data = await res.json();
      const meta = {
        address: poolAddress,
        name: data?.name || `${data?.token_x?.symbol || "X"}-${data?.token_y?.symbol || "Y"}`,
        token_x: data?.token_x?.symbol || "Token X",
        token_y: data?.token_y?.symbol || "Token Y",
        bin_step: Number(data?.bin_step || 0),
        base_fee_percentage: Number(data?.base_fee_percentage || 0),
        tvl: Number(data?.tvl || 0),
        volume_24h: Number(data?.trade_volume_24h || 0),
      };
      _poolMetaCache.set(poolAddress, { data: meta, fetchedAt: Date.now() });
      return meta;
    }
  } catch (e) {
    log("smart_lp_warn", `Failed to fetch pool details for ${poolAddress}: ${e.message}`);
  }

  const fallback = {
    address: poolAddress,
    name: poolAddress.slice(0, 8) + "...",
    token_x: "Unknown",
    token_y: "SOL",
    bin_step: 0,
    base_fee_percentage: 0,
    tvl: 0,
    volume_24h: 0,
  };
  _poolMetaCache.set(poolAddress, { data: fallback, fetchedAt: Date.now() });
  return fallback;
}

// ─── Pool Screening Filter Audit (Tuning Advisor) ────────────────
export async function auditPoolScreeningFilters(poolAddress, poolMeta = null, userConfig = null) {
  if (!userConfig) {
    try {
      const userConfigPath = repoPath("user-config.json");
      if (fs.existsSync(userConfigPath)) {
        userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8"));
      }
    } catch (_) {
      userConfig = {};
    }
  }

  const s = {
    minVolume: userConfig?.minVolume ?? 500,
    minTvl: userConfig?.minTvl ?? 10000,
    maxTvl: userConfig?.maxTvl !== undefined && userConfig?.maxTvl !== null ? userConfig.maxTvl : 150000,
    minMcap: userConfig?.minMcap ?? 150000,
    maxMcap: userConfig?.maxMcap ?? 10000000,
    minBinStep: userConfig?.minBinStep ?? 80,
    maxBinStep: userConfig?.maxBinStep ?? 125,
    minFeeActiveTvlRatio: userConfig?.minFeeActiveTvlRatio ?? 0.05,
    minOrganic: userConfig?.minOrganic ?? 60,
    minHolders: userConfig?.minHolders ?? 500,
    minTokenAgeHours: userConfig?.minTokenAgeHours ?? null,
    maxTokenAgeHours: userConfig?.maxTokenAgeHours ?? null,
    maxTop10Pct: userConfig?.maxTop10Pct ?? 60,
    excludeHighSupplyConcentration: userConfig?.excludeHighSupplyConcentration ?? true,
    allowedLaunchpads: Array.isArray(userConfig?.allowedLaunchpads) ? userConfig.allowedLaunchpads : [],
    blockedLaunchpads: Array.isArray(userConfig?.blockedLaunchpads) ? userConfig.blockedLaunchpads : [],
    timeframe: userConfig?.timeframe || "30m",
  };

  let poolData = null;
  let baseToken = null;
  let quoteToken = null;

  // 1. Query Meteora pool-discovery API (rich metrics, organic score, holders, mcap)
  try {
    const discoveryUrl = `https://pool-discovery-api.datapi.meteora.ag/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}&timeframe=${s.timeframe}`;
    const res = await fetch(discoveryUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.data && json.data.length > 0) {
        poolData = json.data[0];
        baseToken = poolData.token_x || {};
        quoteToken = poolData.token_y || {};
      }
    }
  } catch (_) {
    // fallback to DLMM data API
  }

  // 2. Fallback to DLMM data API if discovery API is unavailable
  if (!poolData) {
    try {
      const dlmmUrl = `https://dlmm.datapi.meteora.ag/pools/${poolAddress}`;
      const res = await fetch(dlmmUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const d = await res.json();
        poolData = {
          pool_address: poolAddress,
          name: d.name,
          tvl: Number(d.tvl || 0),
          volume: Number(d.trade_volume_24h || d.volume?.[s.timeframe] || 0),
          fee_active_tvl_ratio: Number(d.fee_tvl_ratio?.[s.timeframe] || 0),
          dlmm_params: { bin_step: Number(d.bin_step || 0) },
          base_token_holders: Number(d.token_x?.holders || 0),
          token_x: d.token_x || {},
          token_y: d.token_y || {},
          pool_type: "dlmm",
        };
        baseToken = poolData.token_x;
        quoteToken = poolData.token_y;
      }
    } catch (_) { }
  }

  // 3. Fallback to poolMeta if both network calls failed
  if (!poolData && poolMeta) {
    poolData = {
      pool_address: poolAddress,
      name: poolMeta.name,
      tvl: poolMeta.tvl,
      volume: poolMeta.volume_24h,
      fee_active_tvl_ratio: 0,
      dlmm_params: { bin_step: poolMeta.bin_step },
      base_token_holders: 0,
      token_x: { symbol: poolMeta.token_x },
      token_y: { symbol: poolMeta.token_y },
      pool_type: "dlmm",
    };
    baseToken = poolData.token_x;
    quoteToken = poolData.token_y;
  }

  const numeric = (val) => (val == null || isNaN(Number(val)) ? null : Number(val));

  const mcap = numeric(baseToken?.market_cap);
  const holders = numeric(poolData?.base_token_holders ?? baseToken?.holders);
  const volume = numeric(poolData?.volume ?? poolMeta?.volume_24h);
  const tvl = numeric(poolData?.tvl ?? poolData?.active_tvl ?? poolMeta?.tvl);
  const binStep = numeric(poolData?.dlmm_params?.bin_step ?? poolMeta?.bin_step);
  const feeRatio = numeric(poolData?.fee_active_tvl_ratio);
  const organic = numeric(baseToken?.organic_score);
  const createdAt = numeric(baseToken?.created_at);
  const ageHours = createdAt ? Math.max(0, (Date.now() - createdAt) / 3600000) : null;
  const top10 = numeric(baseToken?.top_holders_pct);
  const launchpad = poolData?.launchpad || baseToken?.launchpad || null;
  const hasFreeze = baseToken?.has_freeze_authority === true;
  const hasMint = baseToken?.has_mint_authority === true;
  const hasCriticalWarnings = poolData?.base_token_has_critical_warnings === true ||
    poolData?.quote_token_has_critical_warnings === true ||
    (Array.isArray(baseToken?.warnings) && baseToken.warnings.some(w => w.severity === "danger" || w.severity === "critical"));

  const checks = [
    {
      id: "volume",
      name: `Volume (${s.timeframe})`,
      passed: volume != null && volume >= s.minVolume,
      value: volume != null ? `$${Math.round(volume).toLocaleString()}` : "unknown",
      raw_value: volume,
      threshold: `>= $${Number(s.minVolume).toLocaleString()}`,
      raw_threshold: s.minVolume,
    },
    {
      id: "tvl",
      name: "TVL / Active Liquidity",
      passed: tvl != null && tvl >= s.minTvl && (s.maxTvl == null || tvl <= s.maxTvl),
      value: tvl != null ? `$${Math.round(tvl).toLocaleString()}` : "unknown",
      raw_value: tvl,
      threshold: `$${Number(s.minTvl).toLocaleString()}${s.maxTvl != null ? ` - $${Number(s.maxTvl).toLocaleString()}` : " (No max)"}`,
      raw_threshold: { min: s.minTvl, max: s.maxTvl },
    },
    {
      id: "mcap",
      name: "Market Cap (Mcap)",
      passed: mcap != null && mcap >= s.minMcap && (s.maxMcap == null || mcap <= s.maxMcap),
      value: mcap != null ? `$${Math.round(mcap).toLocaleString()}` : "unknown",
      raw_value: mcap,
      threshold: `$${Number(s.minMcap).toLocaleString()}${s.maxMcap != null ? ` - $${Number(s.maxMcap).toLocaleString()}` : " (No max)"}`,
      raw_threshold: { min: s.minMcap, max: s.maxMcap },
    },
    {
      id: "holders",
      name: "Token Holders",
      passed: holders != null && holders >= s.minHolders,
      value: holders != null ? Number(holders).toLocaleString() : "unknown",
      raw_value: holders,
      threshold: `>= ${Number(s.minHolders).toLocaleString()}`,
      raw_threshold: s.minHolders,
    },
    {
      id: "bin_step",
      name: "Bin Step",
      passed: binStep != null && binStep >= s.minBinStep && binStep <= s.maxBinStep,
      value: binStep != null ? String(binStep) : "unknown",
      raw_value: binStep,
      threshold: `${s.minBinStep} - ${s.maxBinStep}`,
      raw_threshold: { min: s.minBinStep, max: s.maxBinStep },
    },
    {
      id: "fee_active_tvl_ratio",
      name: "Fee / Active TVL Ratio",
      passed: feeRatio != null && feeRatio >= s.minFeeActiveTvlRatio,
      value: feeRatio != null ? `${Number(feeRatio).toFixed(3)}%` : "unknown",
      raw_value: feeRatio,
      threshold: `>= ${s.minFeeActiveTvlRatio}%`,
      raw_threshold: s.minFeeActiveTvlRatio,
    },
    {
      id: "organic_score",
      name: "Base Organic Score",
      passed: organic == null || organic >= s.minOrganic,
      value: organic != null ? String(Math.round(organic)) : "N/A",
      raw_value: organic,
      threshold: `>= ${s.minOrganic}`,
      raw_threshold: s.minOrganic,
    },
    {
      id: "token_age_hours",
      name: "Token Age",
      passed: (function () {
        if (ageHours == null) return true; // skip if unknown creation date
        if (s.minTokenAgeHours != null && ageHours < s.minTokenAgeHours) return false;
        if (s.maxTokenAgeHours != null && ageHours > s.maxTokenAgeHours) return false;
        return true;
      })(),
      value: ageHours != null ? `${ageHours.toFixed(1)} jam` : "unknown",
      raw_value: ageHours,
      threshold: `${s.minTokenAgeHours ? `>= ${s.minTokenAgeHours}h` : "No min"}${s.maxTokenAgeHours ? ` - <= ${s.maxTokenAgeHours}h` : ""}`,
      raw_threshold: { min: s.minTokenAgeHours, max: s.maxTokenAgeHours },
    },
    {
      id: "top10_pct",
      name: "Top 10 Holders Supply",
      passed: top10 == null || s.maxTop10Pct == null || top10 <= s.maxTop10Pct,
      value: top10 != null ? `${top10.toFixed(1)}%` : "Clear",
      raw_value: top10,
      threshold: `<= ${s.maxTop10Pct}%`,
      raw_threshold: s.maxTop10Pct,
    },
    {
      id: "launchpad",
      name: "Launchpad Filter",
      passed: (!s.blockedLaunchpads?.length || !s.blockedLaunchpads.includes(launchpad)) &&
        (!s.allowedLaunchpads?.length || s.allowedLaunchpads.includes(launchpad)),
      value: launchpad || "None",
      raw_value: launchpad,
      threshold: "Tidak di blokir",
      raw_threshold: null,
    },
    {
      id: "security_audit",
      name: "Security Warnings",
      passed: !hasFreeze && !hasMint && !hasCriticalWarnings,
      value: hasFreeze || hasMint ? "Freeze/Mint Active" : (hasCriticalWarnings ? "Critical Warning" : "Clear"),
      raw_value: { hasFreeze, hasMint, hasCriticalWarnings },
      threshold: "Bebas warning bahaya",
      raw_threshold: null,
    },
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const failedChecks = checks.filter((c) => !c.passed);
  const passedAll = failedChecks.length === 0;

  return {
    audited_at: new Date().toISOString(),
    pool_address: poolAddress,
    pool_name: poolData?.name || poolMeta?.name || "Unknown Pool",
    token_symbol: baseToken?.symbol || poolMeta?.token_x || "Token",
    token_mint: baseToken?.address || null,
    passed_all: passedAll,
    score: `${passedCount}/${checks.length}`,
    passed_count: passedCount,
    failed_count: failedChecks.length,
    checks,
    failed_reasons: failedChecks.map((c) => `${c.name}: ${c.value} (Syarat: ${c.threshold})`),
    raw_metrics: {
      mcap: mcap != null ? Math.round(mcap) : null,
      holders: holders != null ? Math.round(holders) : null,
      volume: volume != null ? Math.round(volume) : null,
      tvl: tvl != null ? Math.round(tvl) : null,
      bin_step: binStep,
      fee_active_tvl_ratio: feeRatio != null ? Number(feeRatio.toFixed(4)) : null,
      organic_score: organic != null ? Math.round(organic) : null,
      token_age_hours: ageHours != null ? Number(ageHours.toFixed(2)) : null,
      top10_pct: top10 != null ? Number(top10.toFixed(2)) : null,
    },
  };
}

// ─── Strategy Shape Detection ────────────────────────────────────
export function detectStrategyShape(lowerBin, upperBin, activeBin, rawPosition = null) {
  if (rawPosition?.strategy) {
    const s = String(rawPosition.strategy).toLowerCase();
    if (s.includes("bid") || s === "ba") return "bid_ask";
    if (s.includes("curve")) return "curve";
    if (s.includes("spot")) return "spot";
  }
  if (rawPosition?.strategyType != null) {
    const st = Number(rawPosition.strategyType);
    if (st === 2) return "bid_ask";
    if (st === 1) return "curve";
    if (st === 0) return "spot";
  }
  // Check if position metadata has strategy details
  if (rawPosition?.raw_pnl?.strategyType != null) {
    const st = Number(rawPosition.raw_pnl.strategyType);
    if (st === 2) return "bid_ask";
    if (st === 1) return "curve";
    if (st === 0) return "spot";
  }
  return "spot";
}

// ─── Reconcile Copied Positions with Bot Core State ──────────────
export function syncCopiedPositionsWithState(history) {
  if (!history || !history.copied_positions_map) return false;
  let modified = false;
  const nowIso = new Date().toISOString();

  for (const [targetPos, copyInfo] of Object.entries(history.copied_positions_map)) {
    if (copyInfo.status === "open") {
      const tracked = getTrackedPosition(copyInfo.user_position);
      if (tracked && tracked.closed) {
        copyInfo.status = "closed";
        copyInfo.closed_time = tracked.closed_at || nowIso;
        if (!history.priority_rotation) history.priority_rotation = { current_priority: 0, timer_started_at: null };
        history.priority_rotation.current_priority = 0;
        history.priority_rotation.timer_started_at = copyInfo.closed_time;
        if ((copyInfo.copy_priority ?? 99) === 0) {
          history.priority_rotation.prio0_focus_timer_started_at = copyInfo.closed_time;
        }
        modified = true;
        log("smart_lp", `Synced mirrored position ${copyInfo.user_position} -> marked closed based on state`);
      }
    }
  }

  if (Array.isArray(history.activities)) {
    for (const act of history.activities) {
      if (act.type === "EXIT" && act.user_action) {
        const copyInfo = history.copied_positions_map?.[act.target_position];
        const userPos = copyInfo?.user_position;
        if (userPos) {
          const tracked = getTrackedPosition(userPos);
          if (tracked && tracked.closed) {
            if (!act.user_action.closed_copy) {
              act.user_action.closed_copy = true;
              act.user_action.error = null;
              act.user_action.resolved_note = "Position confirmed closed by core management loop";
              modified = true;
            }
            if (tracked.close_pnl_pct != null && act.user_action.user_pnl_pct == null) {
              act.user_action.user_pnl_pct = tracked.close_pnl_pct;
              act.user_action.user_pnl_usd = tracked.close_pnl_usd;
              modified = true;
            }
          }
        }
      }
    }
  }

  const hasAnyOpen = Object.values(history.copied_positions_map || {}).some((c) => c.status === "open");
  if (!history.priority_rotation) {
    history.priority_rotation = { current_priority: 0, timer_started_at: null };
  }

  if (!hasAnyOpen) {
    if (history.priority_rotation.timer_started_at == null) {
      history.priority_rotation.current_priority = 0;
      history.priority_rotation.timer_started_at = nowIso;
      modified = true;
    }
  } else {
    if (history.priority_rotation.timer_started_at != null) {
      history.priority_rotation.timer_started_at = null;
      modified = true;
    }
  }

  return modified;
}

// ─── Real-Time SL / TP Monitor on Copied Positions ────────────────
const _closingPositions = new Set();

/**
 * Evaluates live PnL on all currently open copied positions.
 * Triggers immediate close if:
 * - Stop Loss: PnL <= -auto_stop_loss_pct (e.g. <= -15%)
 * - Take Profit: PnL >= +auto_take_profit_pct (e.g. >= +4%)
 * This executes independently without waiting for the target wallet to exit.
 */
export async function checkAndExecuteCopyPnlExits(history, config, providedPositions = null) {
  if (!config.enabled || config.mode !== "copy") return false;
  if (!history || !history.copied_positions_map) return false;

  const openCopies = Object.entries(history.copied_positions_map).filter(
    ([, info]) => info && info.status === "open" && info.user_position
  );

  if (openCopies.length === 0) return false;

  let livePositions = providedPositions;
  if (!livePositions) {
    try {
      const myPosRes = await getMyPositions({ force: true, silent: true });
      livePositions = myPosRes?.positions || [];
    } catch (err) {
      log("smart_lp_warn", `Failed to fetch live positions for copy SL/TP check: ${err.message}`);
      return false;
    }
  }

  const liveMap = new Map((livePositions || []).map((p) => [p.position, p]));
  const slPct = Math.abs(Number(config.copy_settings?.auto_stop_loss_pct) || 15);
  const tpPct = Math.abs(Number(config.copy_settings?.auto_take_profit_pct) || 4);
  const nowIso = new Date().toISOString();
  let modified = false;

  for (const [targetPos, copyInfo] of openCopies) {
    const userPos = copyInfo.user_position;
    if (_closingPositions.has(userPos)) {
      continue;
    }

    const livePos = liveMap.get(userPos);
    if (!livePos) {
      const tracked = getTrackedPosition(userPos);
      if (tracked && tracked.closed) {
        copyInfo.status = "closed";
        copyInfo.closed_time = tracked.closed_at || nowIso;
        if (!history.priority_rotation) history.priority_rotation = { current_priority: 0, timer_started_at: null };
        history.priority_rotation.current_priority = 0;
        history.priority_rotation.timer_started_at = copyInfo.closed_time;
        if ((copyInfo.copy_priority ?? 99) === 0) {
          history.priority_rotation.prio0_focus_timer_started_at = copyInfo.closed_time;
        }
        modified = true;
      }
      continue;
    }

    const currentPnlPct = livePos.pnl_pct;
    if (currentPnlPct == null || isNaN(currentPnlPct)) continue;

    const isStopLoss = slPct > 0 && currentPnlPct <= -slPct;
    const isTakeProfit = tpPct > 0 && currentPnlPct >= tpPct;

    if (!isStopLoss && !isTakeProfit) continue;

    const targetWalletObj = config.wallets?.find((w) => w.address === copyInfo.target_wallet);
    const targetWalletName = targetWalletObj?.name || copyInfo.target_wallet_name || "Target Wallet";
    const wLabel = targetWalletName.charAt(0).toUpperCase() + targetWalletName.slice(1);
    const exitType = isStopLoss ? "STOP_LOSS" : "TAKE_PROFIT";
    const exitReason = isStopLoss
      ? `${wLabel} : Auto Stop Loss triggered (${currentPnlPct.toFixed(2)}% <= -${slPct}%)`
      : `${wLabel} : Auto Take Profit triggered (+${currentPnlPct.toFixed(2)}% >= +${tpPct}%)`;

    log("smart_lp", `🚨 [${exitType}] Triggered on copy position ${userPos.slice(0, 8)} (${wLabel}): PnL ${currentPnlPct.toFixed(2)}% (SL: -${slPct}%, TP: +${tpPct}%) — closing immediately without waiting for target wallet to exit!`);

    _closingPositions.add(userPos);
    let closeSuccess = false;
    let lastError = null;
    let closeRes = null;

    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          log("smart_lp", `Executing ${exitType} close for ${userPos.slice(0, 8)} (attempt ${attempt}/3)...`);
          closeRes = await closePosition({
            position_address: userPos,
            reason: exitReason,
          });
          if (closeRes?.success) {
            closeSuccess = true;
            break;
          } else {
            lastError = closeRes?.error || "Close position failed";
            log("smart_lp_warn", `${exitType} close attempt ${attempt}/3 failed: ${lastError}`);
          }
        } catch (closeErr) {
          lastError = closeErr.message;
          log("smart_lp_error", `${exitType} close attempt ${attempt}/3 error: ${closeErr.message}`);
        }
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    } finally {
      _closingPositions.delete(userPos);
    }

    const poolMeta = await getPoolDetails(copyInfo.pool_address || livePos.pool).catch(() => ({ name: livePos.pair || "Pool" }));
    const holdMinutes = copyInfo.open_time
      ? Math.max(1, Math.round((Date.now() - new Date(copyInfo.open_time).getTime()) / 60000))
      : livePos.age_minutes || null;

    const activity = {
      id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: nowIso,
      type: "EXIT",
      target_wallet: copyInfo.target_wallet || "",
      target_name: (config.wallets || []).find((w) => w.address === copyInfo.target_wallet)?.name || "Target Wallet",
      target_position: targetPos,
      pool: poolMeta,
      hold_duration_minutes: holdMinutes,
      target_final_pnl_usd: null,
      target_final_pnl_pct: null,
      user_action: {
        closed_copy: closeSuccess,
        user_pnl_pct: currentPnlPct,
        user_pnl_usd: livePos.pnl_usd ?? null,
        exit_trigger: exitType,
        resolved_note: exitReason,
        error: closeSuccess ? null : lastError,
      },
    };

    if (closeSuccess) {
      copyInfo.status = "closed";
      copyInfo.closed_time = nowIso;
      copyInfo.close_reason = exitReason;

      if (!history.priority_rotation) history.priority_rotation = { current_priority: 0, timer_started_at: null };
      history.priority_rotation.current_priority = 0;
      history.priority_rotation.timer_started_at = nowIso;
      if ((copyInfo.copy_priority ?? 99) === 0) {
        history.priority_rotation.prio0_focus_timer_started_at = nowIso;
      }

      log("smart_lp", `✅ Mirrored position closed via ${exitType} -> Returned to Priority 0. Idle timer started.`);

      await autoZapOutAfterClose(closeRes, `smart_lp ${exitType.toLowerCase()} close`);

      try {
        const lessonRule = `[Smart LP ${exitType}] Position closed at PnL ${currentPnlPct.toFixed(2)}% on ${poolMeta.name} (${exitReason}). Target wallet was still holding. Returned to Priority 0.`;
        addLesson(lessonRule, ["smart_lp", exitType.toLowerCase(), poolMeta.name], {
          pinned: false,
          role: "MANAGER",
        });
      } catch (lErr) {
        log("smart_lp_warn", `Could not record lesson: ${lErr.message}`);
      }

      if (!history.activities) history.activities = [];
      history.activities.unshift(activity);
      history.activities = pruneActivitiesPerWallet(history.activities, 100, 600);
      modified = true;
    } else {
      log("smart_lp_error", `❌ Failed to close mirrored position on ${exitType}: ${lastError}`);
    }
  }

  if (modified) {
    saveSmartLpHistory(history);
  }
  return modified;
}

/**
 * Fast exit signal evaluator called by core bot PnL poller.
 */
export function getSmartLpExitSignal(positionAddress, pnlPct) {
  if (!positionAddress || pnlPct == null || isNaN(pnlPct)) return null;

  try {
    const config = loadSmartLpConfig();
    if (!config.enabled || config.mode !== "copy") return null;

    const history = loadSmartLpHistory();
    const openEntry = Object.entries(history.copied_positions_map || {}).find(
      ([, info]) => info && info.status === "open" && info.user_position === positionAddress
    );

    if (!openEntry) return null;

    const [targetPos, copyInfo] = openEntry;
    const slPct = Math.abs(Number(config.copy_settings?.auto_stop_loss_pct) || 15);
    const tpPct = Math.abs(Number(config.copy_settings?.auto_take_profit_pct) || 4);

    if (slPct > 0 && pnlPct <= -slPct) {
      return {
        action: "CLOSE",
        rule: "smart_lp_sl",
        reason: `Smart LP: Auto Stop Loss (${Number(pnlPct).toFixed(2)}% <= -${slPct}%)`,
        type: "STOP_LOSS",
        targetPos,
        copyInfo,
      };
    }

    if (tpPct > 0 && pnlPct >= tpPct) {
      return {
        action: "CLOSE",
        rule: "smart_lp_tp",
        reason: `Smart LP: Auto Take Profit (+${Number(pnlPct).toFixed(2)}% >= +${tpPct}%)`,
        type: "TAKE_PROFIT",
        targetPos,
        copyInfo,
      };
    }
  } catch (err) {
    log("smart_lp_warn", `getSmartLpExitSignal error: ${err.message}`);
  }

  return null;
}

// ─── Insights Aggregator ──────────────────────────────────────────
export function recalculateInsights(history) {
  const activities = history.activities || [];
  const entries = activities.filter((a) => a.type === "ENTRY");
  const exits = activities.filter((a) => a.type === "EXIT");

  const binStepCounts = {};
  const strategyCounts = {};
  let totalWidth = 0;
  let totalBelow = 0;
  let totalAbove = 0;
  let validRangeCount = 0;

  let totalTvl = 0;
  let minTvl = null;
  let maxTvl = null;
  let validTvlCount = 0;

  let totalVol = 0;
  let minVol = null;
  let maxVol = null;
  let validVolCount = 0;

  for (const entry of entries) {
    if (entry.strategy_detected) {
      strategyCounts[entry.strategy_detected] = (strategyCounts[entry.strategy_detected] || 0) + 1;
    }

    const bs = entry.pool?.bin_step;
    if (bs) {
      binStepCounts[bs] = (binStepCounts[bs] || 0) + 1;
    }

    if (entry.range) {
      totalWidth += entry.range.width || 0;
      totalBelow += entry.range.bins_below || 0;
      totalAbove += entry.range.bins_above || 0;
      validRangeCount++;
    }

    const tvl = entry.pool?.tvl;
    if (tvl && tvl > 0) {
      totalTvl += tvl;
      if (minTvl === null || tvl < minTvl) minTvl = tvl;
      if (maxTvl === null || tvl > maxTvl) maxTvl = tvl;
      validTvlCount++;
    }

    const vol = entry.pool?.volume_24h;
    if (vol && vol > 0) {
      totalVol += vol;
      if (minVol === null || vol < minVol) minVol = vol;
      if (maxVol === null || vol > maxVol) maxVol = vol;
      validVolCount++;
    }
  }

  let totalHoldMin = 0;
  let validExitCount = 0;
  let winsCount = 0;
  let lossesCount = 0;
  let breakevenCount = 0;
  let totalRealizedPnlUsd = 0;
  let totalPnlPctSum = 0;
  let validPnlExitCount = 0;
  let bestTradePct = null;
  let worstTradePct = null;

  const walletPerf = {}; // wallet_address -> { address, name, wins, losses, breakeven, completed_trades, realized_pnl_usd, total_pnl_pct_sum, avg_pnl_pct, win_rate_pct }

  for (const exit of exits) {
    if (exit.hold_duration_minutes) {
      totalHoldMin += exit.hold_duration_minutes;
      validExitCount++;
    }

    const wAddr = exit.target_wallet;
    if (wAddr && !walletPerf[wAddr]) {
      walletPerf[wAddr] = {
        address: wAddr,
        name: exit.target_name || "Target",
        wins: 0,
        losses: 0,
        breakeven: 0,
        completed_trades: 0,
        realized_pnl_usd: 0,
        total_pnl_pct_sum: 0,
        avg_pnl_pct: 0,
        win_rate_pct: 0,
      };
    }

    const pnlUsd = Number(exit.target_final_pnl_usd);
    const pnlPct = Number(exit.target_final_pnl_pct);

    const hasValidPct = Number.isFinite(pnlPct);
    const hasValidUsd = Number.isFinite(pnlUsd);

    if (hasValidPct || hasValidUsd) {
      const effectivePct = hasValidPct ? pnlPct : 0;
      const effectiveUsd = hasValidUsd ? pnlUsd : 0;

      // Filter out Meteora liquidity withdrawal zero-balance anomaly (-100% upon pool exit)
      if (effectivePct <= -99.9 && Math.abs(effectiveUsd) > 50) {
        continue;
      }

      validPnlExitCount++;
      totalPnlPctSum += effectivePct;
      totalRealizedPnlUsd += effectiveUsd;

      if (bestTradePct === null || effectivePct > bestTradePct) bestTradePct = effectivePct;
      if (worstTradePct === null || effectivePct < worstTradePct) worstTradePct = effectivePct;

      if (effectivePct > 0 || (effectivePct === 0 && effectiveUsd > 0)) {
        winsCount++;
      } else if (effectivePct < 0 || (effectivePct === 0 && effectiveUsd < 0)) {
        lossesCount++;
      } else {
        breakevenCount++;
      }

      if (wAddr && walletPerf[wAddr]) {
        walletPerf[wAddr].completed_trades++;
        walletPerf[wAddr].realized_pnl_usd += effectiveUsd;
        walletPerf[wAddr].total_pnl_pct_sum += effectivePct;
        if (effectivePct > 0 || (effectivePct === 0 && effectiveUsd > 0)) {
          walletPerf[wAddr].wins++;
        } else if (effectivePct < 0 || (effectivePct === 0 && effectiveUsd < 0)) {
          walletPerf[wAddr].losses++;
        } else {
          walletPerf[wAddr].breakeven++;
        }
      }
    }
  }

  // Finalize per-wallet stats
  for (const w of Object.values(walletPerf)) {
    const totalW = w.wins + w.losses + w.breakeven;
    w.win_rate_pct = totalW > 0 ? Math.round((w.wins / totalW) * 1000) / 10 : 0;
    w.avg_pnl_pct = totalW > 0 ? Math.round((w.total_pnl_pct_sum / totalW) * 100) / 100 : 0;
    w.realized_pnl_usd = Math.round(w.realized_pnl_usd * 100) / 100;
  }

  const totalExitsWithPnl = winsCount + lossesCount + breakevenCount;
  const overallWinRatePct = totalExitsWithPnl > 0 ? Math.round((winsCount / totalExitsWithPnl) * 1000) / 10 : 0;
  const avgPnlPct = validPnlExitCount > 0 ? Math.round((totalPnlPctSum / validPnlExitCount) * 100) / 100 : 0;

  // Active / Live target positions unrealized PnL
  const currentPositions = history.all_target_positions || history.last_target_positions || [];
  let totalUnrealizedPnlUsd = 0;
  let activeInProfitCount = 0;
  for (const pos of currentPositions) {
    const uPnl = Number(pos.pnl_usd || 0);
    if (Number.isFinite(uPnl)) totalUnrealizedPnlUsd += uPnl;
    if (Number(pos.pnl_pct || 0) > 0) activeInProfitCount++;
  }

  totalRealizedPnlUsd = Math.round(totalRealizedPnlUsd * 100) / 100;
  totalUnrealizedPnlUsd = Math.round(totalUnrealizedPnlUsd * 100) / 100;
  const totalNetPnlUsd = Math.round((totalRealizedPnlUsd + totalUnrealizedPnlUsd) * 100) / 100;

  history.insights = {
    total_observed_entries: entries.length,
    total_copied_entries: entries.filter((e) => e.user_action?.copied).length,
    preferred_bin_steps: binStepCounts,
    preferred_strategies: strategyCounts,
    average_bin_width: validRangeCount > 0 ? Math.round(totalWidth / validRangeCount) : 0,
    average_bins_below: validRangeCount > 0 ? Math.round(totalBelow / validRangeCount) : 0,
    average_bins_above: validRangeCount > 0 ? Math.round(totalAbove / validRangeCount) : 0,
    pool_tvl_stats: {
      min: minTvl != null ? Math.round(minTvl) : 0,
      max: maxTvl != null ? Math.round(maxTvl) : 0,
      avg: validTvlCount > 0 ? Math.round(totalTvl / validTvlCount) : 0,
    },
    pool_volume_stats: {
      min: minVol != null ? Math.round(minVol) : 0,
      max: maxVol != null ? Math.round(maxVol) : 0,
      avg: validVolCount > 0 ? Math.round(totalVol / validVolCount) : 0,
    },
    average_hold_minutes: validExitCount > 0 ? Math.round(totalHoldMin / validExitCount) : 0,
    completed_trades_count: validExitCount,
    // Observed Win Rate & PnL Metrics
    win_rate_pct: overallWinRatePct,
    wins_count: winsCount,
    losses_count: lossesCount,
    breakeven_count: breakevenCount,
    total_realized_pnl_usd: totalRealizedPnlUsd,
    total_unrealized_pnl_usd: totalUnrealizedPnlUsd,
    total_net_pnl_usd: totalNetPnlUsd,
    avg_pnl_pct: avgPnlPct,
    best_trade_pnl_pct: bestTradePct !== null ? Math.round(bestTradePct * 100) / 100 : null,
    worst_trade_pnl_pct: worstTradePct !== null ? Math.round(worstTradePct * 100) / 100 : null,
    wallet_performance: walletPerf,
    active_in_profit_count: activeInProfitCount,
  };

  history.filter_advisor = calculateFilterAdvisor(history);
}

// ─── Filter Advisor & Setting Optimization Engine ─────────────────
export function calculateFilterAdvisor(history, userConfig = null) {
  if (!userConfig) {
    try {
      const userConfigPath = repoPath("user-config.json");
      if (fs.existsSync(userConfigPath)) {
        userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8"));
      }
    } catch (_) {
      userConfig = {};
    }
  }

  const activities = history.activities || [];
  const entriesWithAudit = activities.filter((a) => a.type === "ENTRY" && a.filter_audit);

  if (entriesWithAudit.length === 0) {
    return {
      total_audited: 0,
      passed_all_count: 0,
      failed_any_count: 0,
      pass_rate_pct: 0,
      filter_fail_frequencies: {},
      whale_metrics: {},
      recommendations: [],
      current_config: {
        minVolume: userConfig?.minVolume ?? 500,
        minTvl: userConfig?.minTvl ?? 10000,
        maxTvl: userConfig?.maxTvl ?? 150000,
        minMcap: userConfig?.minMcap ?? 150000,
        maxMcap: userConfig?.maxMcap ?? 10000000,
        minBinStep: userConfig?.minBinStep ?? 80,
        maxBinStep: userConfig?.maxBinStep ?? 125,
        minFeeActiveTvlRatio: userConfig?.minFeeActiveTvlRatio ?? 0.05,
        minOrganic: userConfig?.minOrganic ?? 60,
        minHolders: userConfig?.minHolders ?? 500,
        minTokenAgeHours: userConfig?.minTokenAgeHours ?? null,
      },
    };
  }

  let passedAllCount = 0;
  const failStats = {};
  const metricValues = {
    volume: [],
    tvl: [],
    mcap: [],
    holders: [],
    bin_step: [],
    fee_active_tvl_ratio: [],
    organic_score: [],
    token_age_hours: [],
    top10_pct: [],
  };

  for (const entry of entriesWithAudit) {
    const fa = entry.filter_audit;
    if (fa.passed_all) {
      passedAllCount++;
    }

    if (Array.isArray(fa.checks)) {
      for (const chk of fa.checks) {
        if (!chk.passed) {
          if (!failStats[chk.id]) {
            failStats[chk.id] = {
              id: chk.id,
              name: chk.name,
              count: 0,
              threshold: chk.threshold,
              fail_rate_pct: 0,
            };
          }
          failStats[chk.id].count++;
        }
      }
    }

    const rm = fa.raw_metrics || {};
    for (const [key, val] of Object.entries(rm)) {
      if (metricValues[key] && typeof val === "number" && !isNaN(val)) {
        metricValues[key].push(val);
      }
    }
  }

  const totalAudited = entriesWithAudit.length;
  for (const stat of Object.values(failStats)) {
    stat.fail_rate_pct = Math.round((stat.count / totalAudited) * 1000) / 10;
  }

  const calcDistribution = (arr) => {
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = Math.round((sum / sorted.length) * 100) / 100;
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const p20 = sorted[Math.floor(sorted.length * 0.2)];
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    return { min, max, avg, median, p20, p80, count: sorted.length };
  };

  const whaleDistributions = {};
  for (const [k, list] of Object.entries(metricValues)) {
    whaleDistributions[k] = calcDistribution(list);
  }

  // Generate Smart Recommendations
  const recommendations = [];

  // 1. TVL (minTvl & maxTvl)
  const tvlDist = whaleDistributions.tvl;
  if (tvlDist && tvlDist.count >= 2) {
    const curMax = userConfig?.maxTvl !== undefined && userConfig?.maxTvl !== null ? userConfig.maxTvl : 150000;
    const curMin = userConfig?.minTvl ?? 10000;
    const suggestedMax = Math.max(curMax, Math.round(tvlDist.p80 * 1.15));
    const suggestedMin = Math.min(curMin, Math.max(1000, Math.round(tvlDist.min * 0.8)));

    if (suggestedMax > curMax || (failStats.tvl?.count || 0) > 0) {
      recommendations.push({
        key: "maxTvl",
        label: "Max TVL (Batas Likuiditas)",
        current: curMax,
        current_display: `$${curMax.toLocaleString()}`,
        suggested: suggestedMax,
        suggested_display: `$${suggestedMax.toLocaleString()}`,
        whale_reality: `Median: $${tvlDist.median.toLocaleString()} | 80%: $${tvlDist.p80.toLocaleString()} (Max: $${tvlDist.max.toLocaleString()})`,
        fail_count: failStats.tvl?.count || 0,
        fail_rate_pct: failStats.tvl?.fail_rate_pct || 0,
        reason: `Whale target bertransaksi di pool likuiditas lebih besar (sampai $${tvlDist.max.toLocaleString()}). Batas $${curMax.toLocaleString()} memblokir ${failStats.tvl?.count || 0} entri.`,
      });
    }
  }

  // 2. Market Cap (maxMcap)
  const mcapDist = whaleDistributions.mcap;
  if (mcapDist && mcapDist.count >= 2) {
    const curMaxMcap = userConfig?.maxMcap ?? 10000000;
    const suggestedMaxMcap = Math.max(curMaxMcap, Math.round(mcapDist.p80 * 1.2));
    if (suggestedMaxMcap > curMaxMcap || (failStats.mcap?.count || 0) > 0) {
      recommendations.push({
        key: "maxMcap",
        label: "Max Market Cap",
        current: curMaxMcap,
        current_display: `$${curMaxMcap.toLocaleString()}`,
        suggested: suggestedMaxMcap,
        suggested_display: `$${suggestedMaxMcap.toLocaleString()}`,
        whale_reality: `Median: $${mcapDist.median.toLocaleString()} | 80%: $${mcapDist.p80.toLocaleString()} (Max: $${mcapDist.max.toLocaleString()})`,
        fail_count: failStats.mcap?.count || 0,
        fail_rate_pct: failStats.mcap?.fail_rate_pct || 0,
        reason: `Whale sering masuk saat mcap sudah mencapai $${mcapDist.median.toLocaleString()} - $${mcapDist.max.toLocaleString()}.`,
      });
    }
  }

  // 3. Fee Active TVL Ratio
  const feeDist = whaleDistributions.fee_active_tvl_ratio;
  if (feeDist && feeDist.count >= 2) {
    const curFee = userConfig?.minFeeActiveTvlRatio ?? 0.05;
    const suggestedFee = Math.min(curFee, Math.max(0.05, Number((feeDist.p20 * 0.9).toFixed(3))));
    if ((failStats.fee_active_tvl_ratio?.count || 0) > 0 && suggestedFee < curFee) {
      recommendations.push({
        key: "minFeeActiveTvlRatio",
        label: "Min Fee / Active TVL Ratio",
        current: curFee,
        current_display: `${curFee}%`,
        suggested: suggestedFee,
        suggested_display: `${suggestedFee}%`,
        whale_reality: `Median: ${feeDist.median}% | Min: ${feeDist.min}%`,
        fail_count: failStats.fee_active_tvl_ratio?.count || 0,
        fail_rate_pct: failStats.fee_active_tvl_ratio?.fail_rate_pct || 0,
        reason: `Syarat fee ratio ${curFee}% terlalu ketat untuk beberapa pool DLMM aktif target wallet.`,
      });
    }
  }

  // 4. Token Age
  const ageDist = whaleDistributions.token_age_hours;
  if (ageDist && ageDist.count >= 2 && userConfig?.minTokenAgeHours) {
    const curAge = userConfig.minTokenAgeHours;
    const suggestedAge = Math.min(curAge, Math.max(1, Math.round(ageDist.p20)));
    if (suggestedAge < curAge || (failStats.token_age_hours?.count || 0) > 0) {
      recommendations.push({
        key: "minTokenAgeHours",
        label: "Min Usia Token (Jam)",
        current: curAge,
        current_display: `${curAge} Jam`,
        suggested: suggestedAge,
        suggested_display: `${suggestedAge} Jam`,
        whale_reality: `Median: ${ageDist.median} Jam | Min: ${ageDist.min} Jam`,
        fail_count: failStats.token_age_hours?.count || 0,
        fail_rate_pct: failStats.token_age_hours?.fail_rate_pct || 0,
        reason: `Whale sering entry di token berumur ${ageDist.median} jam. Filter ${curAge} jam menyaring koin segar ini.`,
      });
    }
  }

  // 5. Volume
  const volDist = whaleDistributions.volume;
  if (volDist && volDist.count >= 2) {
    const curVol = userConfig?.minVolume ?? 500;
    const suggestedVol = Math.min(curVol, Math.max(200, Math.round(volDist.p20 * 0.8)));
    if ((failStats.volume?.count || 0) > 0 && suggestedVol < curVol) {
      recommendations.push({
        key: "minVolume",
        label: "Min Volume",
        current: curVol,
        current_display: `$${curVol.toLocaleString()}`,
        suggested: suggestedVol,
        suggested_display: `$${suggestedVol.toLocaleString()}`,
        whale_reality: `Median: $${volDist.median.toLocaleString()} | Min: $${volDist.min.toLocaleString()}`,
        fail_count: failStats.volume?.count || 0,
        fail_rate_pct: failStats.volume?.fail_rate_pct || 0,
        reason: `Sebagian pool whale memiliki volume $${volDist.min.toLocaleString()}, tertahan oleh batas $${curVol.toLocaleString()}.`,
      });
    }
  }

  // 6. Base Organic Score
  const organicDist = whaleDistributions.organic_score;
  if (organicDist && organicDist.count >= 2) {
    const curOrg = userConfig?.minOrganic ?? 60;
    const suggestedOrg = Math.min(curOrg, Math.max(30, Math.round(organicDist.p20 * 0.9)));
    if ((failStats.organic_score?.count || 0) > 0 && suggestedOrg < curOrg) {
      recommendations.push({
        key: "minOrganic",
        label: "Min Organic Score",
        current: curOrg,
        current_display: `${curOrg}`,
        suggested: suggestedOrg,
        suggested_display: `${suggestedOrg}`,
        whale_reality: `Median: ${organicDist.median} | Min: ${organicDist.min}`,
        fail_count: failStats.organic_score?.count || 0,
        fail_rate_pct: failStats.organic_score?.fail_rate_pct || 0,
        reason: `Beberapa token whale memiliki organic score ${organicDist.min}-${curOrg}.`,
      });
    }
  }

  return {
    total_audited: totalAudited,
    passed_all_count: passedAllCount,
    failed_any_count: totalAudited - passedAllCount,
    pass_rate_pct: Math.round((passedAllCount / totalAudited) * 1000) / 10,
    filter_fail_frequencies: failStats,
    whale_metrics: whaleDistributions,
    recommendations,
    current_config: {
      minVolume: userConfig?.minVolume ?? 500,
      minTvl: userConfig?.minTvl ?? 10000,
      maxTvl: userConfig?.maxTvl ?? 150000,
      minMcap: userConfig?.minMcap ?? 150000,
      maxMcap: userConfig?.maxMcap ?? 10000000,
      minBinStep: userConfig?.minBinStep ?? 80,
      maxBinStep: userConfig?.maxBinStep ?? 125,
      minFeeActiveTvlRatio: userConfig?.minFeeActiveTvlRatio ?? 0.05,
      minOrganic: userConfig?.minOrganic ?? 60,
      minHolders: userConfig?.minHolders ?? 500,
      minTokenAgeHours: userConfig?.minTokenAgeHours ?? null,
    },
  };
}

// ─── Backfill Filter Audits on Historical Activities ──────────────
export async function backfillFilterAudits(history = null, force = false) {
  if (!history) history = loadSmartLpHistory();
  const activities = history.activities || [];
  const entries = activities.filter((a) => a.type === "ENTRY");

  if (entries.length === 0) {
    return { success: true, message: "No entries to backfill", count: 0 };
  }

  const poolCache = new Map();
  let updatedCount = 0;

  for (const entry of entries) {
    const poolAddress = entry.pool?.address;
    if (!poolAddress) continue;

    if (force || !entry.filter_audit) {
      let audit = poolCache.get(poolAddress);
      if (!audit) {
        audit = await auditPoolScreeningFilters(poolAddress, entry.pool);
        poolCache.set(poolAddress, audit);
        await new Promise((r) => setTimeout(r, 60));
      }
      entry.filter_audit = audit;
      updatedCount++;
    }
  }

  recalculateInsights(history);
  saveSmartLpHistory(history);

  log("smart_lp", `[Filter Audit Backfill] Completed backfill for ${updatedCount} entry events across ${poolCache.size} unique pools.`);
  return {
    success: true,
    updated_entries: updatedCount,
    unique_pools_audited: poolCache.size,
    filter_advisor: history.filter_advisor,
  };
}

// ─── Apply Recommended Filters to user-config.json ────────────────
export function applySuggestedFilters(customSuggestions = null) {
  const history = loadSmartLpHistory();
  const advisor = history.filter_advisor || calculateFilterAdvisor(history);
  const userConfigPath = repoPath("user-config.json");

  if (!fs.existsSync(userConfigPath)) {
    return { success: false, error: "user-config.json not found" };
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8"));
    const appliedChanges = {};

    const recs = customSuggestions || (advisor?.recommendations || []);
    for (const rec of recs) {
      if (rec.key && rec.suggested !== undefined) {
        const oldVal = userConfig[rec.key];
        userConfig[rec.key] = rec.suggested;
        appliedChanges[rec.key] = { from: oldVal, to: rec.suggested, label: rec.label };
      }
    }

    fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
    log("smart_lp", `[Filter Tuning] Applied suggested screening filters to user-config.json: ${JSON.stringify(appliedChanges)}`);

    addLesson(
      `[Smart LP Filter Tuning] Screening filters adjusted based on ${advisor?.total_audited || 0} whale entry audits: ${Object.keys(appliedChanges).join(", ")}`,
      ["smart_lp", "screening_filters", "filter_tuning"],
      { pinned: true, role: "SCREENER" }
    );

    recalculateInsights(history);
    saveSmartLpHistory(history);

    return { success: true, applied_changes: appliedChanges, updated_config: userConfig };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Get Smart LP Filter Audits & Advisor Data ────────────────────
export function getSmartLpFilterAudits(limit = 100) {
  const history = loadSmartLpHistory();
  if (!history.filter_advisor) {
    history.filter_advisor = calculateFilterAdvisor(history);
  }
  const activities = history.activities || [];
  const entryAudits = activities
    .filter((a) => a.type === "ENTRY" && a.filter_audit)
    .slice(0, limit)
    .map((a) => ({
      activity_id: a.id,
      timestamp: a.timestamp,
      target_wallet: a.target_wallet,
      target_name: a.target_name,
      pool_name: a.pool?.name || "Pool",
      pool_address: a.pool?.address,
      filter_audit: a.filter_audit,
      copied: a.user_action?.copied || false,
    }));

  return {
    success: true,
    filter_advisor: history.filter_advisor,
    total_audited: entryAudits.length,
    audits: entryAudits,
  };
}

// ─── Zero-RPC Target Position Fetcher (Helius Credit-Saver) ────────
async function fetchTargetPositions(walletAddress) {
  // Strategy 1: Meteora Portfolio REST API (0 RPC calls, 0 Helius credits used!)
  try {
    const portfolioUrl = `https://dlmm.datapi.meteora.ag/portfolio/open?user=${walletAddress}`;
    const res = await fetch(portfolioUrl, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const portfolio = await res.json();
      const pools = portfolio.pools || [];
      const positions = [];

      for (const pool of pools) {
        const poolAddr = pool.poolAddress;
        const poolName = (pool.tokenX && pool.tokenY) ? `${pool.tokenX}-${pool.tokenY}` : (pool.name || null);
        if (poolName) {
          _poolMetaCache.set(poolAddr, {
            data: {
              address: poolAddr,
              name: poolName,
              token_x: pool.tokenX || "Token X",
              token_y: pool.tokenY || "Token Y",
              bin_step: pool.binStep || 0,
              base_fee_percentage: pool.baseFee || 0,
              tvl: Number(pool.balances || 0),
              volume_24h: 0,
            },
            fetchedAt: Date.now(),
          });
        }
        let pnlMap = {};
        try {
          const pnlUrl = `https://dlmm.datapi.meteora.ag/positions/${poolAddr}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;
          const pnlRes = await fetch(pnlUrl, { signal: AbortSignal.timeout(5000) });
          if (pnlRes.ok) {
            const pnlJson = await pnlRes.json();
            const list = pnlJson.positions || pnlJson.data || [];
            for (const item of list) {
              const posAddr = item.positionAddress || item.address || item.position;
              if (posAddr) pnlMap[posAddr] = item;
            }
          }
        } catch (_) { }

        for (const posAddr of (pool.listPositions || [])) {
          const p = pnlMap[posAddr];
          positions.push({
            position: posAddr,
            pool: poolAddr,
            pool_name: poolName,
            token_x: pool.tokenX || null,
            token_y: pool.tokenY || null,
            lower_bin: p?.lowerBinId ?? null,
            upper_bin: p?.upperBinId ?? null,
            active_bin: p?.poolActiveBinId ?? null,
            in_range: p ? !p.isOutOfRange : !pool.outOfRange,
            unclaimed_fees_usd: Number(p?.unrealizedPnl?.unclaimedFeeTokenX?.usd || 0) + Number(p?.unrealizedPnl?.unclaimedFeeTokenY?.usd || 0),
            total_value_usd: Number(p?.unrealizedPnl?.balances || 0),
            pnl_usd: Number(p?.pnlUsd || 0),
            pnl_pct: Number(p?.pnlPctChange || 0),
            age_minutes: p?.createdAt ? Math.floor((Date.now() - p.createdAt * 1000) / 60000) : null,
          });
        }
      }

      return { source: "meteora_rest_zero_rpc", positions };
    }
  } catch (err) {
    log("smart_lp_warn", `Zero-RPC portfolio API fetch failed, falling back to on-chain: ${err.message}`);
  }

  // Strategy 2: Fallback to on-chain getWalletPositions
  const result = await getWalletPositions({ wallet_address: walletAddress });
  return { source: "on_chain_rpc", positions: result.positions || [] };
}

// ─── Poller Engine (Multi-Wallet) ─────────────────────────────────
let _pollerTimer = null;
let _fastCopyCheckTimer = null;
let _isPolling = false;

export async function pollTargetWallet(triggerSource = "cron") {
  const config = loadSmartLpConfig();
  if (!config.enabled && triggerSource === "cron") {
    return { success: false, reason: "Smart LP is disabled" };
  }

  const enabledWallets = (config.wallets || []).filter((w) => w.enabled !== false);
  if (enabledWallets.length === 0) {
    return { success: false, reason: "No active target wallets configured" };
  }

  if (_isPolling) {
    return { success: false, reason: "Polling already in progress" };
  }

  _isPolling = true;
  log("smart_lp", `[${triggerSource.toUpperCase()}] Polling ${enabledWallets.length} target wallet(s)... (mode: ${config.mode})`);

  try {
    const history = loadSmartLpHistory();
    if (!history.positions_by_wallet) history.positions_by_wallet = {};
    if (!history.copied_positions_map) history.copied_positions_map = {};
    if (!history.copy_attempts) history.copy_attempts = {};

    syncCopiedPositionsWithState(history);
    await checkAndExecuteCopyPnlExits(history, config);

    const newActivities = [];
    const nowIso = new Date().toISOString();
    const allCurrentPositions = [];
    const copyCandidates = [];

    for (const target of enabledWallets) {
      try {
        const result = await fetchTargetPositions(target.address);
        const currentPositions = result.positions || [];

        // Enrich with wallet info and pool name
        for (const p of currentPositions) {
          if (!p.pool_name) {
            const meta = await getPoolDetails(p.pool);
            p.pool_name = meta?.name || null;
            p.token_x = p.token_x || meta?.token_x || null;
            p.token_y = p.token_y || meta?.token_y || null;
          }
          allCurrentPositions.push({
            ...p,
            wallet_address: target.address,
            wallet_name: target.name,
          });
        }

        const previousPositions = history.positions_by_wallet[target.address] || [];
        const isFirstWalletPoll = !history.positions_by_wallet[target.address];
        const prevMap = new Map(previousPositions.map((p) => [p.position, p]));
        const currMap = new Map(currentPositions.map((p) => [p.position, p]));

        // 1. Detect Entries and Gather Copy Candidates
        for (const curr of currentPositions) {
          const isNew = !isFirstWalletPoll && !prevMap.has(curr.position);
          const isCopyTarget = Boolean(target.copy_enabled);
          const copiedInfo = history.copied_positions_map?.[curr.position];
          const hasOpenCopy = copiedInfo && copiedInfo.status === "open";
          const attempts = history.copy_attempts?.[curr.position] || 0;

          // Freshness check: if age_minutes is known, position must be <= 5 minutes old
          const isFresh = curr.age_minutes == null || curr.age_minutes <= 5;

          // User Rule: NEVER copy an already-running position from earlier polls or past switches.
          // Candidate must be a FRESH, newly detected entry on this cycle (isNew && isFresh),
          // OR an immediate retry (< 3 attempts) of a failed copy on an entry that is still fresh.
          const isRetryableAttempt = attempts > 0 && attempts < 3 && isFresh;
          const shouldConsiderCopy = config.mode === "copy" && config.enabled && isCopyTarget && !hasOpenCopy && (isNew || isRetryableAttempt) && isFresh;

          if (isNew || shouldConsiderCopy) {
            const poolMeta = await getPoolDetails(curr.pool);
            const lowerBin = curr.lower_bin;
            const upperBin = curr.upper_bin;
            const activeBin = curr.active_bin;

            const binsBelow = (activeBin != null && lowerBin != null) ? Math.max(0, activeBin - lowerBin) : 69;
            const binsAbove = (activeBin != null && upperBin != null) ? Math.max(0, upperBin - activeBin) : 0;
            const detectedStrategy = detectStrategyShape(lowerBin, upperBin, activeBin, curr);
            let strategy = "spot";
            if (target.copy_strategy && target.copy_strategy !== "auto") {
              strategy = target.copy_strategy;
            } else {
              strategy = detectedStrategy;
            }
            if (strategy === "ba" || strategy === "bidask") strategy = "bid_ask";

            const targetSpan = (upperBin != null && lowerBin != null)
              ? Math.max(5, upperBin - lowerBin)
              : Math.max(5, binsBelow + binsAbove);

            if (isNew) {
              log("smart_lp", `[${target.name}] entered pool ${poolMeta.name} (${curr.pool.slice(0, 8)}) with detected strategy: ${detectedStrategy}, copy strategy: ${strategy}, bins: -${binsBelow}/+${binsAbove} (span: ${targetSpan})`);
            }

            const activity = {
              id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: nowIso,
              type: "ENTRY",
              target_wallet: target.address,
              target_name: target.name,
              is_copy_target: isCopyTarget,
              copy_priority: target.copy_priority ?? 99,
              target_position: curr.position,
              pool: poolMeta,
              range: {
                lower_bin: lowerBin,
                upper_bin: upperBin,
                active_bin: activeBin,
                bins_below: binsBelow,
                bins_above: binsAbove,
                width: targetSpan,
              },
              strategy_detected: detectedStrategy,
              strategy_copied: strategy,
              target_value_usd: curr.total_value_usd,
              user_action: {
                copied: false,
                strategy: null,
                user_position: null,
                error: null,
              },
            };

            try {
              activity.filter_audit = await auditPoolScreeningFilters(curr.pool, poolMeta);
              if (activity.filter_audit) {
                const fa = activity.filter_audit;
                if (fa.passed_all) {
                  log("smart_lp", `[Filter Audit] ${target.name} entry ${poolMeta.name}: LOLOS SEMUA FILTER (${fa.score})`);
                } else {
                  log("smart_lp", `[Filter Audit] ${target.name} entry ${poolMeta.name}: GAGAL FILTER (${fa.score} lolos) -> Gagal: ${fa.failed_reasons.join("; ")}`);
                }
              }
            } catch (auditErr) {
              log("smart_lp_warn", `[Filter Audit] Error auditing pool ${curr.pool}: ${auditErr.message}`);
            }

            if (isNew) {
              newActivities.push(activity);
            }

            if (shouldConsiderCopy) {
              copyCandidates.push({
                target,
                curr,
                poolMeta,
                lowerBin,
                upperBin,
                activeBin,
                binsBelow,
                binsAbove,
                strategy,
                targetSpan,
                activity,
                isNew,
              });
            } else if (isNew && !isFresh) {
              log("smart_lp", `[${target.name}] Position ${curr.position.slice(0, 8)} detected but already running (${curr.age_minutes}m old) — skipping copy (waiting for fresh next transaction).`);
            }
          }
        }

        // 2. Detect Exits for this wallet
        for (const prev of previousPositions) {
          if (!currMap.has(prev.position)) {
            const poolMeta = await getPoolDetails(prev.pool);
            const mappedCopy = history.copied_positions_map?.[prev.position];

            let holdDurationMinutes = null;
            if (prev.age_minutes) {
              holdDurationMinutes = prev.age_minutes;
            }

            let finalTargetPnlPct = prev.pnl_pct;
            let finalTargetPnlUsd = prev.pnl_usd;
            const isWithdrawalArtifact = finalTargetPnlPct != null && finalTargetPnlPct <= -99.9 && Math.abs(finalTargetPnlUsd || 0) > 50;
            if (isWithdrawalArtifact) {
              finalTargetPnlPct = null;
              finalTargetPnlUsd = null;
            }

            log("smart_lp", `[${target.name}] exited pool ${poolMeta.name} (${prev.pool.slice(0, 8)}). Final PnL: ${isWithdrawalArtifact ? 'Withdrawn' : (prev.pnl_pct + '%')}`);

            const activity = {
              id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: nowIso,
              type: "EXIT",
              target_wallet: target.address,
              target_name: target.name,
              target_position: prev.position,
              pool: poolMeta,
              hold_duration_minutes: holdDurationMinutes,
              target_final_pnl_usd: finalTargetPnlUsd,
              target_final_pnl_pct: finalTargetPnlPct,
              user_action: {
                closed_copy: false,
                error: null,
              },
            };

            // COPY CLOSE EXECUTION
            if (mappedCopy && mappedCopy.status === "open" && config.copy_settings.auto_close_on_target_exit) {
              let closeSuccess = false;
              let lastCloseError = null;

              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const wLabel = target.name.charAt(0).toUpperCase() + target.name.slice(1);
                  log("smart_lp", `Target exited — closing mirrored user position ${mappedCopy.user_position} (${wLabel}, attempt ${attempt}/3)`);
                  const closeRes = await closePosition({
                    position_address: mappedCopy.user_position,
                    reason: `${wLabel} : Target closed position`,
                  });
                  if (closeRes?.success) {
                    closeSuccess = true;
                    activity.user_action.closed_copy = true;
                    mappedCopy.status = "closed";
                    mappedCopy.closed_time = nowIso;
                    const tracked = getTrackedPosition(mappedCopy.user_position);
                    if (tracked?.close_pnl_pct != null) {
                      activity.user_action.user_pnl_pct = tracked.close_pnl_pct;
                      activity.user_action.user_pnl_usd = tracked.close_pnl_usd;
                    }
                    if (!history.priority_rotation) history.priority_rotation = { current_priority: 0, timer_started_at: null };
                    history.priority_rotation.current_priority = 0;
                    history.priority_rotation.timer_started_at = nowIso;
                    if ((mappedCopy.copy_priority ?? 99) === 0) {
                      history.priority_rotation.prio0_focus_timer_started_at = nowIso;
                    }
                    log("smart_lp", `Mirrored user position closed successfully -> Returned to Priority 0. Idle timer started for fresh transactions.`);
                    await autoZapOutAfterClose(closeRes, "smart_lp target exit close");
                    break;
                  } else {
                    lastCloseError = closeRes?.error || "Close position failed";
                    log("smart_lp_warn", `Close attempt ${attempt}/3 failed: ${lastCloseError}`);
                  }
                } catch (closeErr) {
                  lastCloseError = closeErr.message;
                  log("smart_lp_error", `Error closing mirrored position (attempt ${attempt}/3): ${closeErr.message}`);
                }
                if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
              }

              if (!closeSuccess) {
                activity.user_action.error = lastCloseError;
              }
            }

            // Record lesson to Meridian's core memory
            try {
              const lessonRule = `[Smart LP Observation] Target ${target.name} exited pool ${poolMeta.name} after ${holdDurationMinutes || "?"}m with PnL ${prev.pnl_pct ?? 0}%. Strategy reference noted.`;
              addLesson(lessonRule, ["smart_lp", "target_reference", poolMeta.name], {
                pinned: false,
                role: "SCREENER",
              });
            } catch (lErr) {
              log("smart_lp_warn", `Could not record lesson: ${lErr.message}`);
            }

            newActivities.push(activity);
            delete history.copy_attempts?.[prev.position];
          }
        }

        // Save current positions for this wallet
        history.positions_by_wallet[target.address] = currentPositions;
      } catch (walletPollErr) {
        log("smart_lp_warn", `Failed polling wallet ${target.name} (${target.address.slice(0, 8)}): ${walletPollErr.message}`);
      }
    }

    // 3. Stranded Open Position Recovery (if target exited previously or prior close failed)
    if (config.mode === "copy" && config.enabled && config.copy_settings.auto_close_on_target_exit) {
      const activeTargetPositions = new Set(allCurrentPositions.map((p) => p.position));
      for (const [targetPos, copyInfo] of Object.entries(history.copied_positions_map || {})) {
        if (copyInfo.status === "open" && !activeTargetPositions.has(targetPos)) {
          const tracked = getTrackedPosition(copyInfo.user_position);
          if (tracked && tracked.closed) {
            copyInfo.status = "closed";
            copyInfo.closed_time = tracked.closed_at || nowIso;
            log("smart_lp", `Stranded recovery: mirrored position ${copyInfo.user_position} already closed in state`);
            continue;
          }

          log("smart_lp_warn", `Target already exited for copy ${copyInfo.user_position} — auto-recovery close retry...`);
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const targetWalletObj = config.wallets?.find((w) => w.address === copyInfo.target_wallet);
              const targetWalletName = targetWalletObj?.name || copyInfo.target_wallet_name || "Target Wallet";
              const wLabel = targetWalletName.charAt(0).toUpperCase() + targetWalletName.slice(1);
              const closeRes = await closePosition({
                position_address: copyInfo.user_position,
                reason: `${wLabel} : Target exited previously (auto-recovery close)`,
              });
              if (closeRes?.success) {
                copyInfo.status = "closed";
                copyInfo.closed_time = new Date().toISOString();
                if (!history.priority_rotation) history.priority_rotation = { current_priority: 0, timer_started_at: null };
                history.priority_rotation.current_priority = 0;
                history.priority_rotation.timer_started_at = copyInfo.closed_time;
                if ((copyInfo.copy_priority ?? 99) === 0) {
                  history.priority_rotation.prio0_focus_timer_started_at = copyInfo.closed_time;
                }
                log("smart_lp", `Stranded position ${copyInfo.user_position} closed successfully -> Returned to Priority 0. Idle timer started.`);
                await autoZapOutAfterClose(closeRes, "smart_lp stranded recovery close");
                break;
              }
            } catch (retryErr) {
              log("smart_lp_error", `Failed closing stranded position (attempt ${attempt}/3): ${retryErr.message}`);
            }
            if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    }

    // 4. Priority-Based Rotation & Copy Execution
    if (config.mode === "copy" && config.enabled) {
      await checkAndExecuteCopyPnlExits(history, config);
      if (!history.priority_rotation) {
        history.priority_rotation = { current_priority: 0, timer_started_at: null };
      }

      const activeCopiedCount = Object.values(history.copied_positions_map || {}).filter(
        (p) => p.status === "open"
      ).length;
      const maxActive = config.copy_settings.max_active_positions || 1;

      if (activeCopiedCount >= maxActive) {
        // While trade is active, idle rotation timer is paused/reset
        history.priority_rotation.timer_started_at = null;
        log("smart_lp", `Copy queue: Max active copied positions reached (${activeCopiedCount}/${maxActive}). Trade running until closed — will return to Priority 0 on close.`);
      } else {
        const copyWallets = enabledWallets
          .filter((w) => w.copy_enabled)
          .sort((a, b) => (a.copy_priority ?? 99) - (b.copy_priority ?? 99));

        if (copyWallets.length > 0) {
          const rawFallback = config.copy_settings.priority_fallback_minutes;
          const isInstant = rawFallback === 0 || rawFallback === "0";
          const fallbackMinutes = isInstant ? 0 : (rawFallback || 15);
          const fallbackMs = fallbackMinutes * 60 * 1000;

          const p0Wallet = copyWallets.find((w) => (w.copy_priority ?? 0) === 0) || copyWallets[0];
          const p0Candidate = copyCandidates.find((c) => c.target.address === p0Wallet.address);

          let chosenCandidate = null;
          let chosenReason = "";

          if (isInstant) {
            // INSTANT WATERFALL WITH PRIORITY 0 FOCUS TIMER
            // "utamakan prio 0, saat ada transaksi copy wallet prio 0 dia kasih timer tujuannya agar fokus ke prio 0 dulu"
            // "nah saat gada transaksi di prio 0/ sepi baru pindah ke prio 1,2 3, dst tanpa delay/timer. timer nyala saat ada copy trade di prio 0 sisanya gada timer."
            const p0FocusWindowMs = 15 * 60 * 1000;
            let isP0TimerActive = false;
            let p0TimerElapsedMs = 0;

            if (history.priority_rotation.prio0_focus_timer_started_at) {
              p0TimerElapsedMs = Math.max(0, Date.now() - new Date(history.priority_rotation.prio0_focus_timer_started_at).getTime());
              if (p0TimerElapsedMs < p0FocusWindowMs) {
                isP0TimerActive = true;
              } else {
                history.priority_rotation.prio0_focus_timer_started_at = null;
              }
            }

            // P0 ALWAYS has immediate override if it has a fresh transaction
            if (p0Candidate) {
              history.priority_rotation.current_priority = 0;
              history.priority_rotation.prio0_focus_timer_started_at = nowIso;
              chosenCandidate = p0Candidate;
              chosenReason = `Priority 0 (${p0Wallet.name}) primary target executed (fresh transaction)`;
            } else if (isP0TimerActive) {
              // Focus timer is ticking after a Prio 0 copy trade -> stay locked on Prio 0, ignore lower fallbacks
              const elapsedMin = (p0TimerElapsedMs / 60000).toFixed(1);
              const remMin = Math.max(0, (p0FocusWindowMs - p0TimerElapsedMs) / 60000).toFixed(1);
              history.priority_rotation.current_priority = 0;
              history.priority_rotation.timer_started_at = history.priority_rotation.prio0_focus_timer_started_at;
              log("smart_lp", `[Instant Mode] Prio 0 Focus Timer active (${elapsedMin}/15m). Waiting exclusively for ${p0Wallet.name} (${remMin}m remaining before fallback unlocks).`);
            } else {
              // Prio 0 is idle / focus timer finished -> Instant Waterfall across Prio 1, 2, 3... without delay
              history.priority_rotation.timer_started_at = null; // No idle timer for fallbacks

              for (const wallet of copyWallets) {
                const cand = copyCandidates.find((c) => c.target.address === wallet.address);
                if (cand) {
                  chosenCandidate = cand;
                  const prio = wallet.copy_priority ?? 0;
                  history.priority_rotation.current_priority = prio;
                  chosenReason = prio === 0
                    ? `Priority 0 (${wallet.name}) primary target executed`
                    : `Instant Waterfall: Priority ${prio} (${wallet.name}) executed without delay (Prio 0 idle)`;
                  if (prio === 0) {
                    history.priority_rotation.prio0_focus_timer_started_at = nowIso;
                  }
                  break;
                }
              }

              if (!chosenCandidate) {
                history.priority_rotation.current_priority = 0;
                log("smart_lp", `[Instant Waterfall Standby] Prio 0 is idle. Standing by for any fresh transaction across all priorities (Prio 1, 2, 3...) with instant entry.`);
              }
            }
          } else {
            // SEQUENTIAL TIMED ROTATION (when fallbackMinutes > 0, e.g. 15, 30, 60m)
            // RULE 1: Immediate Priority 0 Override (without timer)
            if (p0Candidate) {
              history.priority_rotation.current_priority = 0;
              chosenCandidate = p0Candidate;
              chosenReason = `Priority 0 (${p0Wallet.name}) has fresh transaction (immediate priority override)`;
            } else {
              let curPrio = history.priority_rotation.current_priority ?? 0;

              if (!history.priority_rotation.timer_started_at) {
                history.priority_rotation.timer_started_at = nowIso;
                log("smart_lp", `[Priority Rotation] Idle timer started for Priority ${curPrio} (${p0Wallet.name}) at ${nowIso}`);
              }

              const timerStartedMs = new Date(history.priority_rotation.timer_started_at).getTime();
              const elapsedMs = Math.max(0, Date.now() - timerStartedMs);

              if (elapsedMs >= fallbackMs) {
                const currentWalletIdx = copyWallets.findIndex((w) => (w.copy_priority ?? 0) === curPrio);
                const nextWalletIdx = currentWalletIdx >= 0 && currentWalletIdx + 1 < copyWallets.length
                  ? currentWalletIdx + 1
                  : 0;

                const nextWallet = copyWallets[nextWalletIdx];
                const nextPrio = nextWallet.copy_priority ?? 0;

                log("smart_lp", `[Priority Rotation] Priority ${curPrio} had no transactions for ${fallbackMinutes}m -> Switched to Priority ${nextPrio} (${nextWallet.name}). Idle timer started.`);
                curPrio = nextPrio;
                history.priority_rotation.current_priority = nextPrio;
                history.priority_rotation.timer_started_at = nowIso;
              }

              const activeWallet = copyWallets.find((w) => (w.copy_priority ?? 0) === curPrio) || copyWallets[0];
              const candidateForActive = copyCandidates.find((c) => c.target.address === activeWallet.address);

              if (candidateForActive) {
                chosenCandidate = candidateForActive;
                chosenReason = curPrio === 0
                  ? `Priority 0 (${activeWallet.name}) primary target (fresh transaction)`
                  : `Priority ${curPrio} (${activeWallet.name}) fallback candidate (higher priorities idle > ${fallbackMinutes}m)`;
              } else {
                const currentElapsedMs = Date.now() - new Date(history.priority_rotation.timer_started_at).getTime();
                const elapsedMin = (currentElapsedMs / 60000).toFixed(1);
                const remMin = Math.max(0, (fallbackMs - currentElapsedMs) / 60000).toFixed(1);
                const nextIdx = copyWallets.findIndex((w) => (w.copy_priority ?? 0) === curPrio) + 1;
                const nextTargetName = nextIdx < copyWallets.length ? copyWallets[nextIdx].name : copyWallets[0].name;

                log("smart_lp", `[Priority ${curPrio}] Waiting for fresh transaction from ${activeWallet.name} (${elapsedMin}/${fallbackMinutes}m idle timer, switching to ${nextTargetName} in ${remMin}m).`);
              }
            }
          }

          // Execute Copy if a candidate was selected
          if (chosenCandidate) {
            const { target, curr, poolMeta, strategy, targetSpan, activity, isNew } = chosenCandidate;
            const copySol = Number(config.copy_settings.max_sol_per_position) || 0.3;
            const minGasReserve = config.copy_settings?.gas_reserve !== undefined
              ? Math.max(0, Number(config.copy_settings.gas_reserve))
              : 0.02; // reserve SOL for rent & transaction fees

            let walletBalance = null;
            try {
              const { getWalletBalances } = await import("./tools/wallet.js");
              walletBalance = await getWalletBalances();
            } catch (_) {}

            if (walletBalance && Number(walletBalance.sol) < (copySol + minGasReserve)) {
              log("smart_lp_warn", `⚠️ Cannot copy ${poolMeta.name}: Insufficient SOL (${walletBalance.sol} SOL). Need ${copySol} SOL + ${minGasReserve} SOL gas reserve. Skipping.`);
              if (activity?.user_action) {
                activity.user_action.error = `Insufficient SOL: have ${walletBalance.sol} SOL, need ${copySol + minGasReserve} SOL (deploy + gas reserve)`;
              }
            } else {
              const attempts = history.copy_attempts?.[curr.position] || 0;
              log("smart_lp", `Executing copy: ${chosenReason} — ${copySol} SOL on ${poolMeta.name} (${strategy}, span: ${targetSpan} bins, target config: ${target.copy_strategy || 'auto'})`);

              try {
                const deployRes = await deployPosition({
                  pool_address: curr.pool,
                  amount_sol: copySol,
                  strategy: strategy || "spot",
                  bins_below: targetSpan,
                  bins_above: 0,
                  allow_narrow_range: true,
                  bypass_cooldown: true,
                  pool_name: poolMeta.name,
                  bin_step: poolMeta.bin_step,
                  base_fee: poolMeta.base_fee_percentage,
                  entry_tvl: poolMeta.tvl,
                  entry_volume: poolMeta.volume_24h,
                  reason: chosenReason || `Smart LP: Copied ${target.name}`,
                  target_wallet_name: target.name,
                  target_priority: target.copy_priority ?? 0,
                });

                if (deployRes?.success) {
                  activity.user_action.copied = true;
                  activity.user_action.strategy = strategy;
                  activity.user_action.user_position = deployRes.position || "user_pos_created";
                  if (!history.copied_positions_map) history.copied_positions_map = {};
                  history.copied_positions_map[curr.position] = {
                    user_position: deployRes.position,
                    pool_address: curr.pool,
                    open_time: nowIso,
                    user_sol: config.copy_settings.max_sol_per_position,
                    status: "open",
                    target_wallet: target.address,
                    target_wallet_name: target.name,
                    copy_priority: target.copy_priority ?? 99,
                    copy_strategy: strategy,
                    selection_reason: chosenReason,
                  };
                  delete history.copy_attempts?.[curr.position];
                  // "saat ada transaksi timer reset"
                  history.priority_rotation.timer_started_at = null;
                  if ((target.copy_priority ?? 99) === 0) {
                    history.priority_rotation.prio0_focus_timer_started_at = nowIso;
                  }
                  log("smart_lp", `Successfully copied position: ${deployRes.position} (${chosenReason}). Timer reset during active trade.`);

                  if (!isNew && !newActivities.includes(activity)) {
                    newActivities.push(activity);
                  }
                } else {
                  activity.user_action.error = deployRes?.error || "Deploy execution failed";
                  if (!history.copy_attempts) history.copy_attempts = {};
                  history.copy_attempts[curr.position] = attempts + 1;
                  log("smart_lp_error", `Copy deploy failed: ${activity.user_action.error} (attempt ${attempts + 1}/3)`);
                }
              } catch (deployErr) {
                activity.user_action.error = deployErr.message;
                if (!history.copy_attempts) history.copy_attempts = {};
                history.copy_attempts[curr.position] = attempts + 1;
                log("smart_lp_error", `Copy deploy exception: ${deployErr.message} (attempt ${attempts + 1}/3)`);
              }
            }
          }
        }
      }
    }

    // Save updated aggregated positions and activities
    history.all_target_positions = allCurrentPositions;
    history.last_target_positions = allCurrentPositions; // legacy compatibility
    if (newActivities.length > 0) {
      history.activities = pruneActivitiesPerWallet([...newActivities, ...(history.activities || [])], 100, 600);
    }
    recalculateInsights(history);

    saveSmartLpHistory(history);

    config.last_poll = nowIso;
    saveSmartLpConfig(config);

    return {
      success: true,
      polled_wallets_count: enabledWallets.length,
      active_positions_count: allCurrentPositions.length,
      new_events_count: newActivities.length,
    };
  } catch (error) {
    log("smart_lp_error", `Polling failure: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    _isPolling = false;
  }
}

// ─── Status & Config Getters ──────────────────────────────────────
export function getSmartLpStatus() {
  const config = loadSmartLpConfig();
  const history = loadSmartLpHistory();

  if (syncCopiedPositionsWithState(history)) {
    saveSmartLpHistory(history);
  }

  const activeCopiedCount = Object.values(history.copied_positions_map || {}).filter(
    (p) => p.status === "open"
  ).length;

  const rawPositions = history.all_target_positions || history.last_target_positions || [];
  const positions = rawPositions.map((p) => {
    if (!p.pool_name) {
      const cached = _poolMetaCache.get(p.pool)?.data?.name;
      if (cached) return { ...p, pool_name: cached };
    }
    return p;
  });

  const copyWallets = (config.wallets || [])
    .filter((w) => w.enabled !== false && w.copy_enabled)
    .sort((a, b) => (a.copy_priority ?? 99) - (b.copy_priority ?? 99));

  const rawFallback = config.copy_settings?.priority_fallback_minutes;
  const isInstant = rawFallback === 0 || rawFallback === "0";
  const fallbackMinutes = isInstant ? 0 : (rawFallback || 15);
  const fallbackMs = fallbackMinutes * 60 * 1000;
  const currentCopied = Object.values(history.copied_positions_map || {}).find((p) => p.status === "open");
  const rotation = history.priority_rotation || { current_priority: 0, timer_started_at: null, prio0_focus_timer_started_at: null };

  let activePriorityWallet = null;
  let activePriorityLevel = null;
  let isFallback = false;

  if (currentCopied) {
    const origTarget = (config.wallets || []).find((w) => w.address === currentCopied.target_wallet);
    activePriorityWallet = origTarget ? origTarget.name : currentCopied.target_wallet?.slice(0, 8);
    activePriorityLevel = currentCopied.copy_priority ?? origTarget?.copy_priority ?? null;
    isFallback = activePriorityLevel != null && activePriorityLevel > 0;
  } else if (copyWallets.length > 0) {
    const curPrio = rotation.current_priority ?? 0;
    const matchingWallet = copyWallets.find((w) => (w.copy_priority ?? 0) === curPrio) || copyWallets[0];
    activePriorityWallet = matchingWallet.name;
    activePriorityLevel = matchingWallet.copy_priority ?? 0;
    isFallback = activePriorityLevel > 0;
  }

  let timerElapsedSec = null;
  let timerRemainingSec = null;
  let isTimerRunning = false;
  let isP0Focus = false;

  if (!currentCopied) {
    if (isInstant) {
      if (rotation.prio0_focus_timer_started_at) {
        const elapsedMs = Math.max(0, Date.now() - new Date(rotation.prio0_focus_timer_started_at).getTime());
        const focusWindowMs = 15 * 60 * 1000;
        if (elapsedMs < focusWindowMs) {
          timerElapsedSec = Math.floor(elapsedMs / 1000);
          timerRemainingSec = Math.max(0, Math.floor((focusWindowMs - elapsedMs) / 1000));
          isTimerRunning = true;
          isP0Focus = true;
        }
      }
    } else if (rotation.timer_started_at) {
      const elapsedMs = Math.max(0, Date.now() - new Date(rotation.timer_started_at).getTime());
      timerElapsedSec = Math.floor(elapsedMs / 1000);
      timerRemainingSec = Math.max(0, Math.floor((fallbackMs - elapsedMs) / 1000));
      isTimerRunning = true;
    }
  }

  const copyPriorityStatus = {
    current_priority: rotation.current_priority ?? 0,
    active_wallet_name: activePriorityWallet,
    active_priority: activePriorityLevel,
    is_fallback: isFallback,
    fallback_minutes: fallbackMinutes,
    is_instant: isInstant,
    is_p0_focus: isP0Focus,
    has_active_copy: Boolean(currentCopied),
    active_copied_position: currentCopied?.user_position || null,
    timer_started_at: rotation.timer_started_at || null,
    prio0_focus_timer_started_at: rotation.prio0_focus_timer_started_at || null,
    timer_elapsed_sec: timerElapsedSec,
    timer_remaining_sec: timerRemainingSec,
    is_timer_running: isTimerRunning,
    copy_targets: (config.wallets || []).map((w) => ({
      address: w.address,
      name: w.name,
      enabled: w.enabled !== false,
      copy_enabled: Boolean(w.copy_enabled),
      copy_priority: w.copy_priority ?? 99,
      copy_strategy: w.copy_strategy || "auto",
      is_current: (w.copy_priority ?? 99) === (rotation.current_priority ?? 0),
      is_idle: isWalletIdle(w.address, history, fallbackMinutes, (w.copy_priority ?? 99) === 0),
      last_activity: getWalletLastActivity(w.address, history),
    })),
  };

  return {
    enabled: config.enabled,
    mode: config.mode,
    active_copy_wallet: config.active_copy_wallet,
    copy_priority_status: copyPriorityStatus,
    wallets: config.wallets || [],
    poll_interval_sec: config.poll_interval_sec,
    copy_settings: config.copy_settings,
    last_poll: config.last_poll,
    active_target_positions: positions.length,
    active_copied_positions: activeCopiedCount,
    total_activities: (history.activities || []).length,
    target_positions: positions,
    observed_performance: {
      win_rate_pct: history.insights?.win_rate_pct ?? 0,
      wins_count: history.insights?.wins_count ?? 0,
      losses_count: history.insights?.losses_count ?? 0,
      breakeven_count: history.insights?.breakeven_count ?? 0,
      total_realized_pnl_usd: history.insights?.total_realized_pnl_usd ?? 0,
      total_unrealized_pnl_usd: history.insights?.total_unrealized_pnl_usd ?? 0,
      total_net_pnl_usd: history.insights?.total_net_pnl_usd ?? 0,
      avg_pnl_pct: history.insights?.avg_pnl_pct ?? 0,
      completed_trades_count: history.insights?.completed_trades_count ?? 0,
      wallet_performance: history.insights?.wallet_performance ?? {},
    },
    insights: history.insights || DEFAULT_HISTORY.insights,
  };
}

export function updateSmartLpConfig(updates) {
  const current = loadSmartLpConfig();

  if (updates.active_copy_wallet !== undefined) {
    current.active_copy_wallet = String(updates.active_copy_wallet).trim();
  }
  if (updates.mode !== undefined) {
    if (!["observe", "copy"].includes(updates.mode)) {
      return { success: false, error: "Mode must be 'observe' or 'copy'" };
    }
    current.mode = updates.mode;
  }
  if (updates.enabled !== undefined) {
    current.enabled = Boolean(updates.enabled);
  }
  if (updates.poll_interval_sec !== undefined) {
    current.poll_interval_sec = Math.max(10, Math.min(300, Number(updates.poll_interval_sec) || 30));
  }
  if (updates.copy_settings && typeof updates.copy_settings === "object") {
    const cs = { ...updates.copy_settings };
    if (cs.auto_stop_loss_pct !== undefined) cs.auto_stop_loss_pct = Math.abs(Number(cs.auto_stop_loss_pct) || 15);
    if (cs.auto_take_profit_pct !== undefined) cs.auto_take_profit_pct = Math.abs(Number(cs.auto_take_profit_pct) || 4);
    if (cs.gas_reserve !== undefined) cs.gas_reserve = Math.max(0.001, Number(cs.gas_reserve) || 0.02);
    current.copy_settings = {
      ...current.copy_settings,
      ...cs,
    };
  }

  saveSmartLpConfig(current);
  log("smart_lp", `Config updated: mode=${current.mode}, enabled=${current.enabled}, active_copy=${current.active_copy_wallet?.slice(0, 8)}...`);
  return { success: true, config: current };
}

export function toggleSmartLp({ enabled, mode }) {
  const current = loadSmartLpConfig();
  if (enabled !== undefined) current.enabled = Boolean(enabled);
  if (mode !== undefined && ["observe", "copy"].includes(mode)) current.mode = mode;

  saveSmartLpConfig(current);
  log("smart_lp", `Smart LP state toggled: enabled=${current.enabled}, mode=${current.mode}`);

  if (current.enabled && (current.wallets?.length || 0) > 0) {
    pollTargetWallet("toggle").catch((e) => log("smart_lp_warn", `Immediate poll failed: ${e.message}`));
  }

  return { success: true, enabled: current.enabled, mode: current.mode };
}

export function getSmartLpActivities(limit = null, wallet = null, perWalletLimit = 50) {
  const history = loadSmartLpHistory();
  const allActivities = history.activities || [];

  if (wallet && wallet !== "all") {
    const filtered = allActivities.filter(
      (a) => a.target_wallet === wallet || a.target_name?.toLowerCase() === wallet.toLowerCase()
    );
    const maxItems = limit || perWalletLimit || 50;
    return {
      activities: filtered.slice(0, maxItems),
      total: filtered.length,
      total_unfiltered: allActivities.length,
    };
  }

  // When returning all activities: take up to perWalletLimit (default 50) per wallet
  // so no single active wallet crowds out the others!
  const byWalletCount = new Map();
  const resultActivities = [];
  for (const act of allActivities) {
    const wKey = act.target_wallet || act.target_name || "unknown";
    const count = byWalletCount.get(wKey) || 0;
    if (count < (perWalletLimit || 50)) {
      byWalletCount.set(wKey, count + 1);
      resultActivities.push(act);
    }
  }

  // Sort chronologically newest first
  resultActivities.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  const finalLimit = limit ? Math.min(limit, resultActivities.length) : resultActivities.length;
  return {
    activities: resultActivities.slice(0, finalLimit),
    total: resultActivities.length,
    total_unfiltered: allActivities.length,
  };
}

export function getSmartLpInsights() {
  const history = loadSmartLpHistory();
  recalculateInsights(history);
  return {
    insights: history.insights || DEFAULT_HISTORY.insights,
  };
}

// ─── Transfer / Apply Insights to Meridian Main Bot ───────────────
export function applyInsightsToMainBot() {
  const history = loadSmartLpHistory();
  const insights = history.insights;

  if (!insights || insights.total_observed_entries === 0) {
    return { success: false, error: "No target activity has been observed yet to extract insights." };
  }

  const userConfigPath = repoPath("user-config.json");
  if (!fs.existsSync(userConfigPath)) {
    return { success: false, error: "user-config.json not found." };
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(userConfigPath, "utf8"));

    const changes = {};

    // 1. Preferred Strategy
    const strategies = insights.preferred_strategies || {};
    const topStrategy = Object.keys(strategies).sort((a, b) => strategies[b] - strategies[a])[0];
    if (topStrategy && topStrategy !== userConfig.strategy) {
      changes.strategy = { from: userConfig.strategy, to: topStrategy };
      userConfig.strategy = topStrategy;
    }

    // 2. Preferred Bin Step
    const binSteps = insights.preferred_bin_steps || {};
    const sortedBinSteps = Object.keys(binSteps).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (sortedBinSteps.length > 0) {
      const minStep = sortedBinSteps[0];
      const maxStep = sortedBinSteps[sortedBinSteps.length - 1];
      if (userConfig.minBinStep !== minStep || userConfig.maxBinStep !== maxStep) {
        changes.binStep = {
          from: `${userConfig.minBinStep}-${userConfig.maxBinStep}`,
          to: `${minStep}-${maxStep}`,
        };
        userConfig.minBinStep = minStep;
        userConfig.maxBinStep = maxStep;
      }
    }

    // 3. Preferred Bins Below
    if (insights.average_bins_below > 0) {
      const targetBinsBelow = Math.min(69, Math.max(10, insights.average_bins_below));
      if (userConfig.defaultBinsBelow !== targetBinsBelow) {
        changes.defaultBinsBelow = { from: userConfig.defaultBinsBelow, to: targetBinsBelow };
        userConfig.defaultBinsBelow = targetBinsBelow;
      }
    }

    // 4. Volume Threshold
    if (insights.pool_volume_stats?.min > 0) {
      const suggestedMinVol = Math.round(insights.pool_volume_stats.min * 0.8);
      if (suggestedMinVol > userConfig.minVolume) {
        changes.minVolume = { from: userConfig.minVolume, to: suggestedMinVol };
        userConfig.minVolume = suggestedMinVol;
      }
    }

    // 5. TVL Threshold
    if (insights.pool_tvl_stats?.min > 0) {
      const suggestedMinTvl = Math.round(insights.pool_tvl_stats.min * 0.8);
      if (suggestedMinTvl > userConfig.minTvl) {
        changes.minTvl = { from: userConfig.minTvl, to: suggestedMinTvl };
        userConfig.minTvl = suggestedMinTvl;
      }
    }

    fs.writeFileSync(userConfigPath, JSON.stringify(userConfig, null, 2));
    log("smart_lp", `Applied Smart LP insights to user-config.json: ${JSON.stringify(changes)}`);

    addLesson(
      `[Smart LP Optimization] Bot screening filters synchronized with multi-target wallet patterns: Strategy=${userConfig.strategy}, BinStep=${userConfig.minBinStep}-${userConfig.maxBinStep}, BinsBelow=${userConfig.defaultBinsBelow}`,
      ["smart_lp", "filter_adaptation", "system_optimization"],
      { pinned: true, role: "SCREENER" }
    );

    return { success: true, changes, updatedConfig: userConfig };
  } catch (err) {
    log("smart_lp_error", `Failed applying insights to user-config: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Poller Lifecycle ─────────────────────────────────────────────
export function startSmartLpPoller() {
  if (_pollerTimer) clearInterval(_pollerTimer);
  if (_fastCopyCheckTimer) clearInterval(_fastCopyCheckTimer);

  const config = loadSmartLpConfig();
  const intervalMs = Math.max(10, config.poll_interval_sec || 30) * 1000;

  _pollerTimer = setInterval(() => {
    const currentCfg = loadSmartLpConfig();
    if (currentCfg.enabled && (currentCfg.wallets?.length || 0) > 0) {
      pollTargetWallet("cron").catch((e) => log("smart_lp_warn", `Interval poll error: ${e.message}`));
    }
  }, intervalMs);

  // Fast sub-poller (every 5 seconds) for real-time SL/TP enforcement on active copy positions
  _fastCopyCheckTimer = setInterval(async () => {
    try {
      const currentCfg = loadSmartLpConfig();
      if (!currentCfg.enabled || currentCfg.mode !== "copy") return;
      const hist = loadSmartLpHistory();
      const hasOpen = Object.values(hist.copied_positions_map || {}).some((c) => c.status === "open");
      if (hasOpen && !_isPolling) {
        await checkAndExecuteCopyPnlExits(hist, currentCfg);
      }
    } catch (e) {
      log("smart_lp_warn", `Fast SL/TP monitor error: ${e.message}`);
    }
  }, 5000);

  log("smart_lp", `Smart LP Multi-Wallet Poller started (interval: ${intervalMs / 1000}s, fast SL/TP monitor: 5s)`);
}

export function stopSmartLpPoller() {
  if (_pollerTimer) {
    clearInterval(_pollerTimer);
    _pollerTimer = null;
  }
  if (_fastCopyCheckTimer) {
    clearInterval(_fastCopyCheckTimer);
    _fastCopyCheckTimer = null;
  }
  log("smart_lp", "Smart LP Poller stopped");
}

export function isSmartLpCopyActive() {
  const config = loadSmartLpConfig();
  const hasCopyWallets = config.wallets?.some((w) => w.enabled !== false && w.copy_enabled);
  return Boolean(config.enabled && config.mode === "copy" && (config.active_copy_wallet || hasCopyWallets));
}
