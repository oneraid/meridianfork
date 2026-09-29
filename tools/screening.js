import { config } from "../config.js";
import { isBlacklisted } from "../token-blacklist.js";
import { isDevBlocked, getBlockedDevs } from "../dev-blocklist.js";
import { log } from "../logger.js";
import { isBaseMintOnCooldown, isPoolOnCooldown } from "../pool-memory.js";
import { confirmIndicatorPreset } from "./chart-indicators.js";
import { getAgentMeridianBase, getAgentMeridianHeaders } from "./agent-meridian.js";

const DATAPI_JUP = "https://datapi.jup.ag/v1";

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";
const MIN_VOLATILITY_TIMEFRAME = "30m";
const TIMEFRAME_MINUTES = {
  "5m": 5,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "12h": 720,
  "24h": 1440,
};
// Degen Score normalizes window-dependent inputs (volume/fee/LP) to this reference
// window, so its targets stay valid regardless of the configured screening timeframe.
const DEGEN_REFERENCE_MINUTES = 30;
const PVP_SHORTLIST_LIMIT = 2;
const PVP_RIVAL_LIMIT = 2;
const PVP_MIN_ACTIVE_TVL = 5_000;
const PVP_MIN_HOLDERS = 500;
const PVP_MIN_GLOBAL_FEES_SOL = 30;

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

export function scoreCandidate(pool) {
  const feeTvl = Number(pool.fee_active_tvl_ratio || 0);
  const organic = Number(pool.organic_score || 0);
  const volume = Number(pool.volume_window || 0);
  const holders = Number(pool.holders || 0);
  return feeTvl * 1000 + organic * 10 + volume / 100 + holders / 100;
}

/**
 * Degen Score — a pool's efficiency relative to its liquidity, on a 0..100 scale.
 * Geometric mean of four liquidity-relative sub-scores so a HIGH score requires balance
 * across all four (a pool spiking one metric can't dominate):
 *   1. Recent trading activity   → volume / active_tvl   (volume_active_tvl_ratio)
 *   2. Recent LP activity        → unique_lps + positions_created
 *   3. Fees paid to LPs          → fee / active_tvl       (fee_active_tvl_ratio)
 *   4. Liquidity                 → active_tvl (log floor — dust pools can't win on ratios)
 * Efficiency only (no momentum/change_pct), per design. Targets are configurable so the
 * score can be calibrated; each sub-score saturates at its target.
 *
 * The volume/fee/LP inputs are measured over `config.screening.timeframe`, so they are
 * normalized to a fixed 30m reference window before scoring — the targets are expressed
 * in 30m terms and stay valid even if the timeframe changes (5m, 1h, 24h, …). Liquidity
 * is a level, not a rate, so it is not scaled.
 */
export function degenScore(pool, targets = {}) {
  const {
    targetVolRatio = 20,    // (30m) volume/active_tvl that earns a full trading sub-score
    targetLpCount = 40,     // (30m) unique_lps + positions_created for a full LP sub-score
    targetFeeRatio = 0.20,  // (30m) fee/active_tvl for a full fee sub-score
    targetLiquidity = 20000, // active_tvl ($) floor for full liquidity sub-score (not timeframe-scaled)
  } = targets;

  const La = Number(pool.active_tvl ?? pool.tvl ?? 0);
  if (!Number.isFinite(La) || La <= 0) return 0;

  const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

  // Normalize window-dependent inputs to the 30m reference (rate × scale).
  const tfMinutes = TIMEFRAME_MINUTES[config.screening.timeframe] || DEGEN_REFERENCE_MINUTES;
  const tfScale = DEGEN_REFERENCE_MINUTES / tfMinutes;

  const volRatio = Number(pool.volume_active_tvl_ratio);
  const tradingRatio = (Number.isFinite(volRatio) ? volRatio : Number(pool.volume_window || 0) / La) * tfScale;
  const feeRatio = (Number.isFinite(Number(pool.fee_active_tvl_ratio))
    ? Number(pool.fee_active_tvl_ratio)
    : Number(pool.fee_window || 0) / La) * tfScale;
  const lpActivity = (Number(pool.unique_lps || 0) + Number(pool.positions_created || 0)) * tfScale;

  const sTrading = clamp01(tradingRatio / targetVolRatio);
  const sLp      = clamp01(lpActivity / targetLpCount);
  const sFees    = clamp01(feeRatio / targetFeeRatio);
  const sLiq     = clamp01(Math.log10(La) / Math.log10(targetLiquidity));

  // Geometric mean (×100). Any zero sub-score → 0, enforcing balance across all four.
  return (sTrading * sLp * sFees * sLiq) ** 0.25 * 100;
}

function numeric(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isUsableVolatility(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function includesCaseInsensitive(values, value) {
  if (!Array.isArray(values) || values.length === 0 || !value) return false;
  const needle = String(value).toLowerCase();
  return values.some((entry) => String(entry).toLowerCase() === needle);
}

function getPoolLaunchpad(pool) {
  const base = pool?.token_x || {};
  return base?.launchpad ||
    base?.launchpad_platform ||
    pool?.base_token_launchpad ||
    pool?.launchpad ||
    pool?.launchpad_platform ||
    null;
}

function getPoolBaseMint(pool) {
  return pool?.token_x?.address ||
    pool?.base_token_address ||
    pool?.base_mint ||
    pool?.base?.mint ||
    null;
}

function getVolatilityTimeframe(sourceTimeframe) {
  const source = String(sourceTimeframe || "").trim();
  const sourceMinutes = TIMEFRAME_MINUTES[source];
  const minMinutes = TIMEFRAME_MINUTES[MIN_VOLATILITY_TIMEFRAME];
  return sourceMinutes != null && sourceMinutes >= minMinutes ? source : MIN_VOLATILITY_TIMEFRAME;
}

function getRawPoolScreeningRejectReason(pool, s) {
  const base = pool?.token_x || {};
  const quote = pool?.token_y || {};
  const binStep = numeric(pool?.dlmm_params?.bin_step);
  const tvl = numeric(pool?.tvl ?? pool?.active_tvl);
  const feeActiveTvlRatio = numeric(pool?.fee_active_tvl_ratio);
  const volatility = numeric(pool?.volatility);
  const volume = numeric(pool?.volume);
  const holders = numeric(pool?.base_token_holders);
  const mcap = numeric(base?.market_cap);
  const baseOrganic = numeric(base?.organic_score);
  const quoteOrganic = numeric(quote?.organic_score);
  const launchpad = getPoolLaunchpad(pool);
  const createdAt = numeric(base?.created_at);

  if (s.excludeHighSupplyConcentration && pool?.base_token_has_high_supply_concentration === true) {
    return "base token has high supply concentration";
  }
  if (pool?.base_token_has_critical_warnings === true) return "base token has critical warnings";
  if (pool?.quote_token_has_critical_warnings === true) return "quote token has critical warnings";
  if (pool?.base_token_has_high_single_ownership === true) return "base token has high single ownership";
  if (pool?.pool_type && pool.pool_type !== "dlmm") return `pool_type ${pool.pool_type} is not dlmm`;

  if (mcap == null || mcap < s.minMcap) return `mcap ${mcap ?? "unknown"} below minMcap ${s.minMcap}`;
  if (mcap > s.maxMcap) return `mcap ${mcap} above maxMcap ${s.maxMcap}`;
  if (holders == null || holders < s.minHolders) return `holders ${holders ?? "unknown"} below minHolders ${s.minHolders}`;
  if (volume == null || volume < s.minVolume) return `volume ${volume ?? "unknown"} below minVolume ${s.minVolume}`;
  if (tvl == null || tvl < s.minTvl) return `TVL ${tvl ?? "unknown"} below minTvl ${s.minTvl}`;
  if (s.maxTvl != null && tvl > s.maxTvl) return `TVL ${tvl} above maxTvl ${s.maxTvl}`;
  if (binStep == null || binStep < s.minBinStep) return `bin_step ${binStep ?? "unknown"} below minBinStep ${s.minBinStep}`;
  if (binStep > s.maxBinStep) return `bin_step ${binStep} above maxBinStep ${s.maxBinStep}`;
  if (feeActiveTvlRatio == null || feeActiveTvlRatio < s.minFeeActiveTvlRatio) {
    return `fee/active-TVL ${feeActiveTvlRatio ?? "unknown"} below minFeeActiveTvlRatio ${s.minFeeActiveTvlRatio}`;
  }
  if (!isUsableVolatility(volatility)) {
    return `volatility ${volatility ?? "unknown"} is unusable`;
  }
  if (baseOrganic == null || baseOrganic < s.minOrganic) {
    return `base organic ${baseOrganic ?? "unknown"} below minOrganic ${s.minOrganic}`;
  }
  if (quoteOrganic == null || quoteOrganic < s.minQuoteOrganic) {
    return `quote organic ${quoteOrganic ?? "unknown"} below minQuoteOrganic ${s.minQuoteOrganic}`;
  }
  if (
    pool?.discord_signal &&
    Array.isArray(s.allowedLaunchpads) &&
    s.allowedLaunchpads.length > 0 &&
    launchpad &&
    !includesCaseInsensitive(s.allowedLaunchpads, launchpad)
  ) {
    return `launchpad ${launchpad} not in allow-list`;
  }
  if (includesCaseInsensitive(s.blockedLaunchpads, launchpad)) {
    return `blocked launchpad (${launchpad})`;
  }
  if (s.minTokenAgeHours != null) {
    const maxCreatedAt = Date.now() - s.minTokenAgeHours * 3_600_000;
    if (createdAt == null || createdAt > maxCreatedAt) return `token age below minTokenAgeHours ${s.minTokenAgeHours}`;
  }
  if (s.maxTokenAgeHours != null) {
    const minCreatedAt = Date.now() - s.maxTokenAgeHours * 3_600_000;
    if (createdAt == null || createdAt < minCreatedAt) return `token age above maxTokenAgeHours ${s.maxTokenAgeHours}`;
  }
  if (s.minPctBelowAth != null && s.minPctBelowAth > 0) {
    const athPrice = pool.ath_price;
    const currentPrice = pool.current_price_gmgn;
    if (athPrice != null && currentPrice != null && athPrice > 0) {
      const pctBelowAth = ((athPrice - currentPrice) / athPrice) * 100;
      if (pctBelowAth < s.minPctBelowAth) {
        return `price is only ${pctBelowAth.toFixed(1)}% below ATH (required minPctBelowAth: ${s.minPctBelowAth}%, source: ${pool.ath_source})`;
      }
    } else {
      return "could not resolve token ATH price or current price for ATH check";
    }
  }
  return null;
}

async function fetchDiscordSignalCandidates() {
  const res = await fetch(`${getAgentMeridianBase()}/signals/discord/candidates`, {
    headers: getAgentMeridianHeaders(),
  });
  if (!res.ok) throw new Error(`discord signal candidates ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.candidates) ? data.candidates : [];
}

async function fetchPoolDiscoveryPage({ page_size, filters, timeframe, category }) {
  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=${page_size}` +
    `&filter_by=${encodeURIComponent(filters)}` +
    `&timeframe=${timeframe}` +
    `&category=${category}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function fetchPoolDiscoveryDetail({ poolAddress, timeframe }) {
  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=1` +
    `&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}` +
    `&timeframe=${timeframe}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Pool detail API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return (data.data || [])[0] ?? null;
}

async function applyVolatilityTimeframe(rawPools, sourceTimeframe) {
  if (!Array.isArray(rawPools) || rawPools.length === 0) return rawPools;
  const volatilityTimeframe = getVolatilityTimeframe(sourceTimeframe);

  // Tag primary-timeframe values on every pool before any overwrite
  for (const pool of rawPools) {
    if (!pool) continue;
    pool[`volume_${sourceTimeframe}`] = pool.volume ?? null;
    pool[`volatility_${sourceTimeframe}`] = pool.volatility ?? null;
    pool.volatility_timeframe = volatilityTimeframe;
  }

  if (sourceTimeframe === volatilityTimeframe) return rawPools;

  const uniquePoolAddresses = [...new Set(rawPools.map((pool) => pool?.pool_address).filter(Boolean))];
  const longResults = await Promise.allSettled(
    uniquePoolAddresses.map((poolAddress) =>
      fetchPoolDiscoveryDetail({ poolAddress, timeframe: volatilityTimeframe })
        .then((pool) => ({
          poolAddress,
          volatility: numeric(pool?.volatility),
          volume: numeric(pool?.volume),
        }))
    )
  );

  const metricsByPool = new Map();
  for (const result of longResults) {
    if (result.status !== "fulfilled") continue;
    metricsByPool.set(result.value.poolAddress, result.value);
  }

  for (const pool of rawPools) {
    if (!pool?.pool_address) continue;
    const metrics = metricsByPool.get(pool.pool_address);
    if (!metrics) continue;

    pool[`volume_${volatilityTimeframe}`] = metrics.volume;
    pool[`volatility_${volatilityTimeframe}`] = metrics.volatility;

    // Use longer-timeframe values as the canonical ones for filtering
    if (metrics.volatility != null) pool.volatility = metrics.volatility;
    if (metrics.volume != null) pool.volume = metrics.volume;
  }

  return rawPools;
}

async function searchAssetsBySymbol(symbol) {
  const res = await fetch(`${DATAPI_JUP}/assets/search?query=${encodeURIComponent(symbol)}`);
  if (!res.ok) throw new Error(`assets/search ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function enrichDiscordSignalLaunchpads(rawPools) {
  const missing = rawPools.filter((pool) =>
    pool?.discord_signal &&
    !getPoolLaunchpad(pool) &&
    getPoolBaseMint(pool)
  );
  if (missing.length === 0) return;

  const uniqueMints = [...new Set(missing.map(getPoolBaseMint).filter(Boolean))];
  const results = await Promise.allSettled(
    uniqueMints.map(async (mint) => {
      const assets = await searchAssetsBySymbol(mint);
      const asset = assets.find((item) => item?.id === mint) || assets[0] || null;
      return { mint, asset };
    })
  );

  const byMint = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const launchpad = result.value.asset?.launchpad || result.value.asset?.launchpadPlatform || null;
    if (!launchpad) continue;
    byMint.set(result.value.mint, {
      launchpad,
      dev: result.value.asset?.dev || null,
      holderCount: numeric(result.value.asset?.holderCount),
      organicScore: numeric(result.value.asset?.organicScore),
      marketCap: numeric(result.value.asset?.mcap ?? result.value.asset?.fdv),
      createdAt: result.value.asset?.createdAt ? Date.parse(result.value.asset.createdAt) : null,
    });
  }

  for (const pool of missing) {
    const mint = getPoolBaseMint(pool);
    const asset = byMint.get(mint);
    if (!asset) continue;
    pool.token_x ||= {};
    pool.token_x.launchpad = asset.launchpad;
    pool.base_token_launchpad = asset.launchpad;
    if (asset.dev && !pool.token_x.dev) pool.token_x.dev = asset.dev;
    if (asset.holderCount != null && pool.base_token_holders == null) pool.base_token_holders = asset.holderCount;
    if (asset.organicScore != null && pool.token_x.organic_score == null) pool.token_x.organic_score = asset.organicScore;
    if (asset.marketCap != null && pool.token_x.market_cap == null) pool.token_x.market_cap = asset.marketCap;
    if (asset.createdAt != null && pool.token_x.created_at == null) pool.token_x.created_at = asset.createdAt;
    log("screening", `Discord signal launchpad enriched from Jupiter: ${pool.name || mint} — ${asset.launchpad}`);
  }
}

export async function fetchMeteoraPoolAth(poolAddress, timeframe = "1h") {
  if (!poolAddress) return null;
  try {
    const res = await fetch(`https://dlmm.datapi.meteora.ag/pools/${poolAddress}/ohlcv?timeframe=${encodeURIComponent(timeframe || "1h")}`);
    if (!res.ok) return null;
    const json = await res.json();
    const candles = json?.data || (Array.isArray(json) ? json : []);
    if (!Array.isArray(candles) || candles.length === 0) return null;
    const highs = candles.map((c) => Number(c.high)).filter((h) => Number.isFinite(h) && h > 0);
    if (highs.length === 0) return null;
    const athPrice = Math.max(...highs);
    const latestCandle = candles[candles.length - 1];
    const currentPrice = Number(latestCandle?.close || latestCandle?.open || 0);
    return {
      ath_price: athPrice,
      price: currentPrice > 0 ? currentPrice : null,
    };
  } catch {
    return null;
  }
}

export async function checkAthFilter(baseMint, poolDetail, minPctBelowAth, athSource = "meteora") {
  if (minPctBelowAth == null || minPctBelowAth <= 0) {
    return { pass: true };
  }

  const sourceSetting = String(athSource || "meteora").toLowerCase().trim();
  const poolAddress = poolDetail?.pool_address || poolDetail?.address || poolDetail?.pool;
  let athPrice = null;
  let currentPrice = null;
  let source = sourceSetting;

  const { getGmgnTokenAthAndPrice, hasGmgnApiKey } = await import("./gmgn.js");
  const useGmgn = (sourceSetting === "gmgn" || sourceSetting === "both") && hasGmgnApiKey() && Boolean(baseMint);

  let gmgnInfo = null;
  if (useGmgn) {
    try {
      gmgnInfo = await getGmgnTokenAthAndPrice(baseMint);
    } catch (err) {
      log("screening", `GMGN ATH check failed for ${baseMint.slice(0, 8)}: ${err.message}`);
    }
  }

  let metInfo = null;
  if (sourceSetting === "meteora" || sourceSetting === "both" || !gmgnInfo) {
    if (poolAddress) {
      metInfo = await fetchMeteoraPoolAth(poolAddress);
    }
  }

  if (sourceSetting === "both") {
    if (metInfo?.ath_price && metInfo.price && gmgnInfo?.ath_price && gmgnInfo.price) {
      const metDrop = ((metInfo.ath_price - metInfo.price) / metInfo.ath_price) * 100;
      const gmgnDrop = ((gmgnInfo.ath_price - gmgnInfo.price) / gmgnInfo.ath_price) * 100;
      if (metDrop <= gmgnDrop) {
        athPrice = metInfo.ath_price;
        currentPrice = metInfo.price;
        source = "meteora (both checked)";
      } else {
        athPrice = gmgnInfo.ath_price;
        currentPrice = gmgnInfo.price;
        source = "gmgn (both checked)";
      }
    } else if (metInfo?.ath_price && metInfo.price) {
      athPrice = metInfo.ath_price;
      currentPrice = metInfo.price;
      source = "meteora (gmgn missing)";
    } else if (gmgnInfo?.ath_price && gmgnInfo.price) {
      athPrice = gmgnInfo.ath_price;
      currentPrice = gmgnInfo.price;
      source = "gmgn (meteora missing)";
    }
  } else if (sourceSetting === "meteora") {
    if (metInfo?.ath_price && metInfo.price) {
      athPrice = metInfo.ath_price;
      currentPrice = metInfo.price;
      source = "meteora";
    } else if (gmgnInfo?.ath_price && gmgnInfo.price) {
      athPrice = gmgnInfo.ath_price;
      currentPrice = gmgnInfo.price;
      source = "gmgn (meteora fallback)";
    }
  } else {
    // GMGN
    if (gmgnInfo?.ath_price && gmgnInfo.price) {
      athPrice = gmgnInfo.ath_price;
      currentPrice = gmgnInfo.price;
      source = "gmgn";
    } else if (metInfo?.ath_price && metInfo.price) {
      athPrice = metInfo.ath_price;
      currentPrice = metInfo.price;
      source = "meteora (gmgn fallback)";
    }
  }

  if (athPrice == null || currentPrice == null || athPrice <= 0) {
    return {
      pass: false,
      reason: "Could not resolve token ATH price or current price.",
    };
  }

  const pctBelowAth = ((athPrice - currentPrice) / athPrice) * 100;
  const pass = pctBelowAth >= minPctBelowAth;

  return {
    pass,
    pctBelowAth,
    athPrice,
    currentPrice,
    source,
  };
}

async function enrichAthDetails(rawPools, s) {
  if (s.minPctBelowAth == null || s.minPctBelowAth <= 0) return;

  const sourceSetting = String(s.athSource || "meteora").toLowerCase().trim();
  const needGmgn = sourceSetting === "gmgn" || sourceSetting === "both";
  const needMeteora = sourceSetting === "meteora" || sourceSetting === "both";

  const { getGmgnTokenAthAndPrice, hasGmgnApiKey } = await import("./gmgn.js");
  const useGmgn = needGmgn && hasGmgnApiKey();

  const uniqueMints = [...new Set(rawPools.map(getPoolBaseMint).filter(Boolean))];
  const uniquePools = [...new Set(rawPools.map((p) => p?.pool_address || p?.address || p?.pool).filter(Boolean))];

  const gmgnResults = {};
  if (useGmgn && uniqueMints.length > 0) {
    const results = await Promise.allSettled(
      uniqueMints.map(async (mint) => {
        const res = await getGmgnTokenAthAndPrice(mint);
        return { mint, res };
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.res) {
        gmgnResults[r.value.mint] = r.value.res;
      }
    }
  }

  const meteoraResults = {};
  if (needMeteora && uniquePools.length > 0) {
    const metResults = await Promise.allSettled(
      uniquePools.map(async (poolAddr) => {
        const res = await fetchMeteoraPoolAth(poolAddr, s.timeframe || "1h");
        return { poolAddr, res };
      })
    );
    for (const r of metResults) {
      if (r.status === "fulfilled" && r.value.res) {
        meteoraResults[r.value.poolAddr] = r.value.res;
      }
    }
  }

  for (const pool of rawPools) {
    if (!pool) continue;
    const mint = getPoolBaseMint(pool);
    const poolAddr = pool.pool_address || pool.address || pool.pool;
    const gmgn = gmgnResults[mint];
    const met = meteoraResults[poolAddr];

    if (sourceSetting === "both") {
      if (met?.ath_price != null && met.price != null && gmgn?.ath_price != null && gmgn.price != null) {
        const metDrop = ((met.ath_price - met.price) / met.ath_price) * 100;
        const gmgnDrop = ((gmgn.ath_price - gmgn.price) / gmgn.ath_price) * 100;
        if (metDrop <= gmgnDrop) {
          pool.ath_price = met.ath_price;
          pool.current_price_gmgn = met.price;
          pool.ath_source = "meteora (both checked)";
        } else {
          pool.ath_price = gmgn.ath_price;
          pool.current_price_gmgn = gmgn.price;
          pool.ath_source = "gmgn (both checked)";
        }
      } else if (met?.ath_price != null && met.price != null) {
        pool.ath_price = met.ath_price;
        pool.current_price_gmgn = met.price;
        pool.ath_source = "meteora (gmgn missing)";
      } else if (gmgn?.ath_price != null && gmgn.price != null) {
        pool.ath_price = gmgn.ath_price;
        pool.current_price_gmgn = gmgn.price;
        pool.ath_source = "gmgn (meteora missing)";
      } else {
        pool.ath_price = pool.max_price != null ? numeric(pool.max_price) : null;
        pool.current_price_gmgn = pool.pool_price != null ? numeric(pool.pool_price) : null;
        pool.ath_source = "meteora_fallback";
      }
    } else if (sourceSetting === "meteora") {
      if (met?.ath_price != null && met.price != null) {
        pool.ath_price = met.ath_price;
        pool.current_price_gmgn = met.price;
        pool.ath_source = "meteora";
      } else if (gmgn?.ath_price != null && gmgn.price != null) {
        pool.ath_price = gmgn.ath_price;
        pool.current_price_gmgn = gmgn.price;
        pool.ath_source = "gmgn (meteora fallback)";
      } else {
        pool.ath_price = pool.max_price != null ? numeric(pool.max_price) : null;
        pool.current_price_gmgn = pool.pool_price != null ? numeric(pool.pool_price) : null;
        pool.ath_source = "meteora_fallback";
      }
    } else {
      // GMGN
      if (gmgn?.ath_price != null && gmgn.price != null) {
        pool.ath_price = gmgn.ath_price;
        pool.current_price_gmgn = gmgn.price;
        pool.ath_source = "gmgn";
      } else if (met?.ath_price != null && met.price != null) {
        pool.ath_price = met.ath_price;
        pool.current_price_gmgn = met.price;
        pool.ath_source = "meteora (gmgn fallback)";
      } else {
        pool.ath_price = pool.max_price != null ? numeric(pool.max_price) : null;
        pool.current_price_gmgn = pool.pool_price != null ? numeric(pool.pool_price) : null;
        pool.ath_source = "meteora_fallback";
      }
    }
  }
}

async function findRivalPool(mint) {
  const url = `https://dlmm.datapi.meteora.ag/pools?query=${encodeURIComponent(mint)}&sort_by=${encodeURIComponent("tvl:desc")}&filter_by=${encodeURIComponent(`tvl>${PVP_MIN_ACTIVE_TVL}`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rival pool search ${res.status}`);
  const data = await res.json();
  const pools = Array.isArray(data?.data) ? data.data : [];
  return pools.find((pool) => pool?.token_x?.address === mint || pool?.token_y?.address === mint) || null;
}

async function enrichPvpRisk(pools) {
  const shortlist = [...pools]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, PVP_SHORTLIST_LIMIT);

  if (shortlist.length === 0) return;

  const symbolCache = new Map();

  await Promise.all(shortlist.map(async (pool) => {
    const symbol = normalizeSymbol(pool.base?.symbol);
    const ownMint = pool.base?.mint;
    if (!symbol || !ownMint) return;

    let assets = symbolCache.get(symbol);
    if (!assets) {
      assets = await searchAssetsBySymbol(symbol).catch(() => []);
      symbolCache.set(symbol, assets);
    }

    const rivalAssets = assets
      .filter((asset) => normalizeSymbol(asset?.symbol) === symbol && asset?.id && asset.id !== ownMint)
      .sort((a, b) => Number(b?.liquidity || 0) - Number(a?.liquidity || 0))
      .slice(0, PVP_RIVAL_LIMIT);

    for (const rival of rivalAssets) {
      const rivalHolders = Number(rival?.holderCount || 0);
      const rivalFees = Number(rival?.fees || 0);
      if (rivalHolders < PVP_MIN_HOLDERS || rivalFees < PVP_MIN_GLOBAL_FEES_SOL) continue;

      const rivalPool = await findRivalPool(rival.id).catch(() => null);
      if (!rivalPool) continue;

      pool.is_pvp = true;
      pool.pvp_risk = "high";
      pool.pvp_symbol = pool.base?.symbol || symbol;
      pool.pvp_rival_name = rival?.name || pool.pvp_symbol;
      pool.pvp_rival_mint = rival.id;
      pool.pvp_rival_pool = rivalPool.address;
      pool.pvp_rival_tvl = round(Number(rivalPool.tvl || 0));
      pool.pvp_rival_holders = rivalHolders;
      pool.pvp_rival_fees = Number(rivalFees.toFixed(2));
      log("screening", `PVP guard: ${pool.name} has active rival ${pool.pvp_rival_name} (${rival.id.slice(0, 8)})`);
      break;
    }
  }));
}



/**
 * Refresh live metrics for discord-only signal pools.
 * Their discovery_pool is a snapshot from when the signal was captured — volume/volatility/fee
 * can be 0 even if the pool is active right now. We overwrite with fresh data from the
 * pool discovery API so filtering uses current numbers, not stale ones.
 */
async function refreshDiscordOnlyPools(pools, timeframe) {
  if (!pools.length) return;
  const FIELDS = ["volume", "fee", "active_tvl", "tvl", "volatility", "fee_active_tvl_ratio"];
  const results = await Promise.allSettled(
    pools.map((pool) =>
      fetchPoolDiscoveryDetail({ poolAddress: pool.pool_address, timeframe })
        .then((fresh) => ({ pool, fresh }))
    )
  );
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.fresh) continue;
    const { pool, fresh } = result.value;
    for (const field of FIELDS) {
      const val = numeric(fresh[field]);
      if (val != null) pool[field] = val;
    }
    log("screening", `Discord signal refreshed live data: ${pool.name || pool.pool_address} — vol=${pool.volume?.toFixed(0)} fee=${pool.fee?.toFixed(2)}`);
  }
}

/**
 * Fetch pools from the Meteora Pool Discovery API.
 * Returns condensed data optimized for LLM consumption (saves tokens).
 */
export async function discoverPools({
  page_size = 50,
} = {}) {
  const s = config.screening;
  const filters = [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    s.excludeHighSupplyConcentration ? "base_token_has_high_supply_concentration=false" : null,
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_market_cap>=${s.minMcap}`,
    `base_token_market_cap<=${s.maxMcap}`,
    `base_token_holders>=${s.minHolders}`,
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    s.maxTvl != null ? `tvl<=${s.maxTvl}` : null,
    `dlmm_bin_step>=${s.minBinStep}`,
    `dlmm_bin_step<=${s.maxBinStep}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${s.minOrganic}`,
    `quote_token_organic_score>=${s.minQuoteOrganic}`,
    s.minTokenAgeHours != null ? `base_token_created_at<=${Date.now() - s.minTokenAgeHours * 3_600_000}` : null,
    s.maxTokenAgeHours != null ? `base_token_created_at>=${Date.now() - s.maxTokenAgeHours * 3_600_000}` : null,
    Array.isArray(s.allowedLaunchpads) && s.allowedLaunchpads.length > 0
      ? `base_token_launchpad=[${s.allowedLaunchpads.join(",")}]`
      : null,
  ].filter(Boolean).join("&&");

  const data = await fetchPoolDiscoveryPage({
    page_size,
    filters,
    timeframe: s.timeframe,
    category: s.category,
  });

  let rawPools = Array.isArray(data.data) ? data.data : [];

  if (config.screening.useDiscordSignals) {
    const signalCandidates = await fetchDiscordSignalCandidates().catch((error) => {
      log("screening", `Discord signal fetch failed: ${error.message}`);
      return [];
    });
    const signalPools = signalCandidates
      .map((candidate) => {
        const discoveryPool = candidate.discovery_pool;
        if (!discoveryPool?.pool_address) return null;
        return {
          ...discoveryPool,
          discord_signal: true,
          discord_signal_count: candidate.source_count || 1,
          discord_signal_seen_count: candidate.seen_count || 1,
          discord_signal_first_seen_at: candidate.first_seen_at || null,
          discord_signal_last_seen_at: candidate.last_seen_at || null,
        };
      })
      .filter(Boolean);

    if (config.screening.discordSignalMode === "only") {
      rawPools = signalPools;
      // Refresh all signal pools with live data since discovery_pool is a stale snapshot
      await refreshDiscordOnlyPools(rawPools, s.timeframe);
    } else if (signalPools.length > 0) {
      const byPool = new Map(rawPools.map((pool) => [pool.pool_address, pool]));
      const discordOnlyPools = [];
      for (const signalPool of signalPools) {
        if (byPool.has(signalPool.pool_address)) {
          byPool.set(signalPool.pool_address, {
            ...byPool.get(signalPool.pool_address),
            discord_signal: true,
            discord_signal_count: signalPool.discord_signal_count,
            discord_signal_seen_count: signalPool.discord_signal_seen_count,
            discord_signal_first_seen_at: signalPool.discord_signal_first_seen_at,
            discord_signal_last_seen_at: signalPool.discord_signal_last_seen_at,
          });
        } else {
          byPool.set(signalPool.pool_address, signalPool);
          discordOnlyPools.push(signalPool);
        }
      }
      rawPools = Array.from(byPool.values());
      // Refresh discord-only pools with live data — their discovery_pool is a stale snapshot
      // so volume/volatility/fee may be 0 even when the pool is active right now
      if (discordOnlyPools.length > 0) {
        await refreshDiscordOnlyPools(discordOnlyPools, s.timeframe);
      }
    }
  }

  rawPools = await applyVolatilityTimeframe(rawPools, s.timeframe);
  await enrichDiscordSignalLaunchpads(rawPools);
  await enrichAthDetails(rawPools, s);

  const filteredExamples = [];
  const thresholdedRawPools = rawPools.filter((pool) => {
    const reason = getRawPoolScreeningRejectReason(pool, s);
    if (!reason) return true;
    filteredExamples.push({
      name: pool.name || pool.pool_address || "unknown pool",
      pool: pool.pool_address || pool.pool || null,
      base: {
        symbol: pool.token_x?.symbol || (pool.name ? pool.name.split(/[\/\-]/)[0]?.trim() : null),
        mint: pool.token_x?.address || pool.base_token_address || pool.base?.mint || null,
      },
      reason,
      tvl: round(pool.tvl || pool.active_tvl || 0),
      fee_active_tvl_ratio: pool.fee_active_tvl_ratio != null ? fix(pool.fee_active_tvl_ratio, 4) : fix(pool.fee_tvl_ratio, 4),
      volume_window: round(pool.volume || pool.volume_window || pool.volume_24h || 0),
      volatility: fix(pool.volatility, 4),
      organic_score: Math.round(pool.token_x?.organic_score || pool.organic_score || 0),
      launchpad: getPoolLaunchpad(pool),
    });
    if (pool.discord_signal) log("screening", `Discord signal filtered: ${pool.name || pool.pool_address} — ${reason}`);
    return false;
  });

  const condensed = thresholdedRawPools.map(condensePool);

  // Hard-filter blacklisted tokens and blocked deployers (what pool discovery already gave us)
  let pools = condensed.filter((p) => {
    if (isBlacklisted(p.base?.mint)) {
      log("blacklist", `Filtered blacklisted token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)}) in pool ${p.name}`);
      return false;
    }
    if (p.dev && isDevBlocked(p.dev)) {
      log("dev_blocklist", `Filtered blocked deployer ${p.dev?.slice(0, 8)} token ${p.base?.symbol} in pool ${p.name}`);
      return false;
    }
    return true;
  });

  const filtered = condensed.length - pools.length;
  if (filtered > 0) log("blacklist", `Filtered ${filtered} pool(s) with blacklisted tokens/devs`);

  // If pool discovery didn't supply dev field, batch-fetch from Jupiter for any pools
  // where dev is null — but only if the dev blocklist is non-empty (avoid useless calls)
  const blockedDevs = getBlockedDevs();
  if (Object.keys(blockedDevs).length > 0) {
    const missingDev = pools.filter((p) => !p.dev && p.base?.mint);
    if (missingDev.length > 0) {
      const devResults = await Promise.allSettled(
        missingDev.map((p) =>
          fetch(`${DATAPI_JUP}/assets/search?query=${p.base.mint}`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => {
              const t = Array.isArray(d) ? d[0] : d;
              return { pool: p.pool, dev: t?.dev || null };
            })
            .catch(() => ({ pool: p.pool, dev: null }))
        )
      );
      const devMap = {};
      for (const r of devResults) {
        if (r.status === "fulfilled") devMap[r.value.pool] = r.value.dev;
      }
      pools = pools.filter((p) => {
        const dev = devMap[p.pool];
        if (dev) p.dev = dev; // enrich in-place
        if (dev && isDevBlocked(dev)) {
          log("dev_blocklist", `Filtered blocked deployer (jup) ${dev.slice(0, 8)} token ${p.base?.symbol}`);
          return false;
        }
        return true;
      });
    }
  }

  return {
    total: data.total,
    pools,
    filtered_examples: filteredExamples,
  };
}

/**
 * Returns eligible pools for the agent to evaluate and pick from.
 * Hard filters applied in code, agent decides which to deploy into.
 */
export async function getTopCandidates({ limit = 10 } = {}) {
  const { config } = await import("../config.js");
  const discovery = await discoverPools({ page_size: 50 });
  const { pools } = discovery;
  const filteredOut = Array.isArray(discovery.filtered_examples) ? [...discovery.filtered_examples] : [];

  // Exclude pools where the wallet already has an open position
  const { getMyPositions } = await import("./dlmm.js");
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map((p) => p.pool));
  const occupiedMints = new Set(positions.map((p) => p.base_mint).filter(Boolean));
  const minTvl = Number(config.screening.minTvl ?? 0);
  const maxTvl = config.screening.maxTvl == null ? null : Number(config.screening.maxTvl);
  const minFeeActiveTvlRatio = Number(config.screening.minFeeActiveTvlRatio ?? 0);

  const eligible = pools
    .filter((p) => {
      const tvl = Number(p.tvl ?? p.active_tvl ?? 0);
      if (Number.isFinite(minTvl) && minTvl > 0 && tvl < minTvl) {
        pushFilteredReason(filteredOut, p, `TVL $${tvl} below minTvl $${minTvl}`);
        return false;
      }
      if (Number.isFinite(maxTvl) && maxTvl > 0 && tvl > maxTvl) {
        pushFilteredReason(filteredOut, p, `TVL $${tvl} above maxTvl $${maxTvl}`);
        return false;
      }
      const feeActiveTvlRatio = Number(p.fee_active_tvl_ratio);
      if (Number.isFinite(minFeeActiveTvlRatio) && minFeeActiveTvlRatio > 0 && (!Number.isFinite(feeActiveTvlRatio) || feeActiveTvlRatio < minFeeActiveTvlRatio)) {
        pushFilteredReason(filteredOut, p, `fee/active-TVL ${Number.isFinite(feeActiveTvlRatio) ? feeActiveTvlRatio : "unknown"} below minFeeActiveTvlRatio ${minFeeActiveTvlRatio}`);
        return false;
      }
      if (!isUsableVolatility(p.volatility)) {
        pushFilteredReason(filteredOut, p, `volatility ${p.volatility ?? "unknown"} is unusable`);
        return false;
      }
      if (occupiedPools.has(p.pool)) {
        pushFilteredReason(filteredOut, p, "already have an open position in this pool");
        return false;
      }
      if (occupiedMints.has(p.base?.mint)) {
        pushFilteredReason(filteredOut, p, "already holding this base token in another pool");
        return false;
      }
      if (isPoolOnCooldown(p.pool)) {
        log("screening", `Filtered cooldown pool ${p.name} (${p.pool.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "pool cooldown active");
        return false;
      }
      if (isBaseMintOnCooldown(p.base?.mint)) {
        log("screening", `Filtered cooldown token ${p.base?.symbol} (${p.base?.mint?.slice(0, 8)})`);
        pushFilteredReason(filteredOut, p, "token cooldown active");
        return false;
      }
      return true;
    })
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, limit);

  if (config.screening.avoidPvpSymbols && eligible.length > 0) {
    await enrichPvpRisk(eligible);
    if (config.screening.blockPvpSymbols) {
      const before = eligible.length;
      const pvpRemoved = eligible.filter((p) => p.is_pvp);
      pvpRemoved.forEach((p) => pushFilteredReason(filteredOut, p, "PVP hard filter"));
      eligible.splice(0, eligible.length, ...eligible.filter((p) => !p.is_pvp));
      if (eligible.length < before) {
        log("screening", `PVP hard filter removed ${before - eligible.length} pool(s)`);
      }
    }
  }

  // Dev blocklist check — filter pools whose creator is on the blocklist
  if (eligible.length > 0) {
    const before = eligible.length;
    const filtered = eligible.filter((p) => {
      if (p.dev && isDevBlocked(p.dev)) {
        log("dev_blocklist", `Filtered blocked deployer ${p.dev.slice(0, 8)} token ${p.base?.symbol}`);
        pushFilteredReason(filteredOut, p, "blocked deployer");
        return false;
      }
      return true;
    });
    eligible.splice(0, eligible.length, ...filtered);
    if (eligible.length < before) log("dev_blocklist", `Filtered ${before - eligible.length} pool(s) via dev blocklist`);
  }

  if (config.indicators.enabled && eligible.length > 0) {
    const confirmations = await Promise.all(
      eligible.map(async (pool) => {
        try {
          const confirmation = await confirmIndicatorPreset({
            mint: pool.base?.mint,
            side: "entry",
          });
          return { pool: pool.pool, confirmation };
        } catch (error) {
          return {
            pool: pool.pool,
            confirmation: {
              enabled: true,
              confirmed: true,
              skipped: true,
              reason: `Indicator confirmation unavailable: ${error.message}`,
              intervals: [],
            },
          };
        }
      }),
    );
    const confirmationByPool = new Map(confirmations.map((entry) => [entry.pool, entry.confirmation]));
    const before = eligible.length;
    const confirmedEligible = eligible.filter((pool) => {
      const confirmation = confirmationByPool.get(pool.pool);
      pool.indicator_confirmation = confirmation || null;
      if (!confirmation || confirmation.confirmed) return true;
      pushFilteredReason(filteredOut, pool, `indicator reject: ${confirmation.reason}`);
      log("screening", `Indicator rejected ${pool.name} (${pool.pool.slice(0, 8)}): ${confirmation.reason}`);
      return false;
    });
    eligible.splice(0, eligible.length, ...confirmedEligible);
    if (eligible.length < before) {
      log("screening", `Indicator confirmation removed ${before - eligible.length} candidate(s)`);
    }
  }

  return {
    candidates: eligible,
    total_screened: pools.length,
    filtered_examples: filteredOut,
  };
}

/**
 * Get full raw details for a specific pool.
 * Fetches top 50 pools from discovery API and finds the matching address.
 * Returns the full unfiltered API object (all fields, not condensed).
 */
export async function getPoolDetail({ pool_address, timeframe = "5m" }) {
  const pool = await fetchPoolDiscoveryDetail({ poolAddress: pool_address, timeframe });

  if (!pool) {
    throw new Error(`Pool ${pool_address} not found`);
  }

  return pool;
}

/**
 * Condense a pool object for LLM consumption.
 * Raw API returns ~100+ fields per pool. The LLM only needs ~20.
 */
function condensePool(p) {
  return {
    pool: p.pool_address,
    name: p.name,
    base: {
      symbol: p.token_x?.symbol,
      mint: p.token_x?.address,
      organic: Math.round(p.token_x?.organic_score || 0),
      warnings: p.token_x?.warnings?.length || 0,
    },
    quote: {
      symbol: p.token_y?.symbol,
      mint: p.token_y?.address,
    },
    pool_type: p.pool_type,
    bin_step: p.dlmm_params?.bin_step || null,
    fee_pct: p.fee_pct,

    // Core metrics (the numbers that matter)
    tvl: round(p.tvl),
    active_tvl: round(p.active_tvl),
    fee_window: round(p.fee),
    volume_window: round(p.volume),
    fee_active_tvl_ratio: p.fee_active_tvl_ratio != null ? fix(p.fee_active_tvl_ratio, 4) : null,
    volatility: fix(p.volatility, 4),
    volatility_timeframe: p.volatility_timeframe || getVolatilityTimeframe(config.screening.timeframe),

    // Per-timeframe breakdown (populated when sourceTimeframe !== volatilityTimeframe)
    ...(p.volatility_timeframe && p.volatility_timeframe !== config.screening.timeframe ? {
      [`volume_${config.screening.timeframe}`]: round(p[`volume_${config.screening.timeframe}`] ?? null),
      [`volume_${p.volatility_timeframe}`]: round(p[`volume_${p.volatility_timeframe}`] ?? null),
      [`volatility_${config.screening.timeframe}`]: fix(p[`volatility_${config.screening.timeframe}`] ?? null, 4),
      [`volatility_${p.volatility_timeframe}`]: fix(p[`volatility_${p.volatility_timeframe}`] ?? null, 4),
    } : {}),

    // Token health
    holders: p.base_token_holders,
    mcap: round(p.token_x?.market_cap),
    organic_score: Math.round(p.token_x?.organic_score || 0),
    token_age_hours: p.token_x?.created_at
      ? Math.floor((Date.now() - p.token_x.created_at) / 3_600_000)
      : null,
    dev: p.token_x?.dev || null,
    launchpad: getPoolLaunchpad(p),

    // Position health
    active_positions: p.active_positions,
    active_pct: fix(p.active_positions_pct, 1),
    open_positions: p.open_positions,
    discord_signal: Boolean(p.discord_signal),
    discord_signal_count: p.discord_signal_count || 0,
    discord_signal_seen_count: p.discord_signal_seen_count || 0,
    discord_signal_last_seen_at: p.discord_signal_last_seen_at || null,

    // Price action
    price: p.pool_price,
    price_change_pct: fix(p.pool_price_change_pct, 1),
    price_trend: p.price_trend,
    min_price: p.min_price,
    max_price: p.max_price,

    // Activity trends
    volume_change_pct: fix(p.volume_change_pct, 1),
    fee_change_pct: fix(p.fee_change_pct, 1),
    swap_count: p.swap_count,
    unique_traders: p.unique_traders,

    // Liquidity-relative + LP-activity metrics (Degen Score inputs)
    volume_active_tvl_ratio: p.volume_active_tvl_ratio != null ? fix(p.volume_active_tvl_ratio, 4) : null,
    unique_lps: p.unique_lps,
    unique_lps_change_pct: fix(p.unique_lps_change_pct, 1),
    positions_created: p.positions_created,
  };
}

function round(n) {
  return n != null ? Math.round(n) : null;
}

function fix(n, decimals) {
  const value = Number(n);
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function pushFilteredReason(list, pool, reason) {
  if (!list || !pool) return;
  list.push({
    name: pool.name || `${pool.base?.symbol || "?"}-${pool.quote?.symbol || "?"}`,
    pool: pool.pool || pool.pool_address || null,
    base: {
      symbol: pool.base?.symbol || (pool.name ? pool.name.split(/[\/\-]/)[0]?.trim() : null),
      mint: pool.base?.mint || pool.base_token_address || pool.token_x?.address || null,
    },
    reason,
    tvl: round(pool.tvl || pool.active_tvl || 0),
    fee_active_tvl_ratio: pool.fee_active_tvl_ratio != null ? fix(pool.fee_active_tvl_ratio, 4) : fix(pool.fee_tvl_ratio, 4),
    volume_window: round(pool.volume_window || pool.volume || 0),
    volatility: fix(pool.volatility, 4),
    organic_score: Math.round(pool.organic_score || pool.base?.organic || 0),
    launchpad: pool.launchpad || null,
  });
}

/**
 * Check screening filters for a specific pool address or token address (CA).
 * Returns detailed check results.
 */
export async function testScreeningFiltersForAddress(address) {
  const { config } = await import("../config.js");
  const s = config.screening;
  const timeframe = s.timeframe || "30m";
  
  // 1. Try base_token_address
  let url = `${POOL_DISCOVERY_BASE}/pools?page_size=5&filter_by=${encodeURIComponent(`base_token_address=${address}`)}&timeframe=${timeframe}`;
  let res = await fetch(url);
  let data = await res.json().catch(() => ({}));
  let pools = data.data || [];
  
  // 2. If empty, try pool_address
  if (pools.length === 0) {
    url = `${POOL_DISCOVERY_BASE}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${address}`)}&timeframe=${timeframe}`;
    res = await fetch(url);
    data = await res.json().catch(() => ({}));
    pools = data.data || [];
  }
  
  if (pools.length === 0) {
    return { found: false, error: "No DLMM pools found on Meteora for this token address or pool address." };
  }
  
  const processedPools = await applyVolatilityTimeframe(pools, timeframe);
  await enrichAthDetails(processedPools, s);
  const results = [];
  
  const { getMyPositions } = await import("./dlmm.js");
  const { positions } = await getMyPositions().catch(() => ({ positions: [] }));
  const occupiedPools = new Set(positions.map((p) => p.pool));
  const occupiedMints = new Set(positions.map((p) => p.base_mint).filter(Boolean));
  
  for (const pool of processedPools) {
    const base = pool.token_x || {};
    const quote = pool.token_y || {};
    const binStep = numeric(pool.dlmm_params?.bin_step);
    const tvl = numeric(pool.tvl ?? pool.active_tvl);
    const feeActiveTvlRatio = numeric(pool.fee_active_tvl_ratio);
    const volatility = numeric(pool.volatility);
    const volume = numeric(pool.volume);
    const holders = numeric(pool.base_token_holders);
    const mcap = numeric(base.market_cap);
    const baseOrganic = numeric(base.organic_score);
    const quoteOrganic = numeric(quote.organic_score);
    const launchpad = getPoolLaunchpad(pool);
    const createdAt = numeric(base.created_at);
    
    const checks = [
      {
        name: "Meteora DLMM Pool Type",
        passed: pool.pool_type === "dlmm",
        value: pool.pool_type || "unknown",
        expected: "dlmm"
      },
      {
        name: "Market Cap (Mcap)",
        passed: mcap != null && mcap >= s.minMcap && mcap <= s.maxMcap,
        value: mcap != null ? `$${Math.round(mcap).toLocaleString()}` : "unknown",
        expected: `$${s.minMcap.toLocaleString()} - $${s.maxMcap.toLocaleString()}`
      },
      {
        name: "Token Holders",
        passed: holders != null && holders >= s.minHolders,
        value: holders != null ? holders.toLocaleString() : "unknown",
        expected: `>= ${s.minHolders.toLocaleString()}`
      },
      {
        name: "24h/Window Volume",
        passed: volume != null && volume >= s.minVolume,
        value: volume != null ? `$${Math.round(volume).toLocaleString()}` : "unknown",
        expected: `>= $${s.minVolume.toLocaleString()}`
      },
      {
        name: "Active Liquidity (TVL)",
        passed: tvl != null && tvl >= s.minTvl && (s.maxTvl == null || tvl <= s.maxTvl),
        value: tvl != null ? `$${Math.round(tvl).toLocaleString()}` : "unknown",
        expected: `$${s.minTvl.toLocaleString()}` + (s.maxTvl != null ? ` - $${s.maxTvl.toLocaleString()}` : " (No limit)")
      },
      {
        name: "Bin Step",
        passed: binStep != null && binStep >= s.minBinStep && binStep <= s.maxBinStep,
        value: binStep != null ? binStep : "unknown",
        expected: `${s.minBinStep} - ${s.maxBinStep}`
      },
      {
        name: "Fee / Active TVL Ratio",
        passed: feeActiveTvlRatio != null && feeActiveTvlRatio >= s.minFeeActiveTvlRatio,
        value: feeActiveTvlRatio != null ? `${feeActiveTvlRatio.toFixed(3)}%` : "unknown",
        expected: `>= ${s.minFeeActiveTvlRatio}%`
      },
      {
        name: "Base Token Organic Score",
        passed: baseOrganic != null && baseOrganic >= s.minOrganic,
        value: baseOrganic != null ? baseOrganic : "unknown",
        expected: `>= ${s.minOrganic}`
      },
      {
        name: "Quote Token Organic Score",
        passed: quoteOrganic != null && quoteOrganic >= s.minQuoteOrganic,
        value: quoteOrganic != null ? quoteOrganic : "unknown",
        expected: `>= ${s.minQuoteOrganic}`
      },
      {
        name: "Launchpad Filter",
        passed: !includesCaseInsensitive(s.blockedLaunchpads, launchpad) && 
                (!Array.isArray(s.allowedLaunchpads) || s.allowedLaunchpads.length === 0 || !launchpad || includesCaseInsensitive(s.allowedLaunchpads, launchpad)),
        value: launchpad || "None",
        expected: `Not blocked and in allowlist if set`
      },
      {
        name: "Token Age",
        passed: (function() {
          if (createdAt == null) return false;
          if (s.minTokenAgeHours != null && createdAt > Date.now() - s.minTokenAgeHours * 3_600_000) return false;
          if (s.maxTokenAgeHours != null && createdAt < Date.now() - s.maxTokenAgeHours * 3_600_000) return false;
          return true;
        })(),
        value: createdAt ? `${((Date.now() - createdAt) / 3_600_000).toFixed(1)} hours` : "unknown",
        expected: `${s.minTokenAgeHours ?? 0}h` + (s.maxTokenAgeHours ? ` - ${s.maxTokenAgeHours}h` : " (No max)")
      },
      {
        name: "Supply Concentration Warning",
        passed: !s.excludeHighSupplyConcentration || pool.base_token_has_high_supply_concentration !== true,
        value: pool.base_token_has_high_supply_concentration === true ? "High Concentration Warning" : "Clear",
        expected: "Clear"
      },
      {
        name: "Critical Audit Warnings",
        passed: pool.base_token_has_critical_warnings !== true && pool.quote_token_has_critical_warnings !== true,
        value: (pool.base_token_has_critical_warnings === true || pool.quote_token_has_critical_warnings === true) ? "Has Warnings" : "Clear",
        expected: "Clear"
      },
      {
        name: "Duplicate Position Guard",
        passed: !occupiedPools.has(pool.pool) && !occupiedMints.has(pool.base?.mint),
        value: occupiedPools.has(pool.pool) ? "Already open in pool" : occupiedMints.has(pool.base?.mint) ? "Already holding token" : "Clear",
        expected: "No open positions"
      },
      {
        name: "Pool Cooldown Guard",
        passed: !isPoolOnCooldown(pool.pool) && !isBaseMintOnCooldown(pool.base?.mint),
        value: isPoolOnCooldown(pool.pool) ? "Pool cooldown active" : isBaseMintOnCooldown(pool.base?.mint) ? "Token cooldown active" : "Clear",
        expected: "No active cooldowns"
      },
      {
        name: "Percent Below ATH",
        passed: (function() {
          if (s.minPctBelowAth == null || s.minPctBelowAth <= 0) return true;
          const athPrice = pool.ath_price;
          const currentPrice = pool.current_price_gmgn;
          if (athPrice == null || currentPrice == null || athPrice <= 0) return false;
          const pctBelowAth = ((athPrice - currentPrice) / athPrice) * 100;
          return pctBelowAth >= s.minPctBelowAth;
        })(),
        value: (function() {
          const athPrice = pool.ath_price;
          const currentPrice = pool.current_price_gmgn;
          if (athPrice == null || currentPrice == null || athPrice <= 0) return "unknown";
          const pctBelowAth = ((athPrice - currentPrice) / athPrice) * 100;
          return `${pctBelowAth.toFixed(1)}% below ATH (${pool.ath_source || "unknown"})`;
        })(),
        expected: s.minPctBelowAth != null && s.minPctBelowAth > 0 ? `>= ${s.minPctBelowAth}%` : "No limit"
      }
    ];

    const passedAll = checks.every(c => c.passed);
    results.push({
      pool: pool.pool,
      name: pool.name,
      base_mint: pool.base?.mint || pool.base_token_address,
      passed: passedAll,
      checks
    });
  }
  
  return { found: true, results };
}
