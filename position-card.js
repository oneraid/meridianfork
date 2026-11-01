import fs from "fs";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";
import { log } from "./logger.js";

/**
 * Draw a rounded rectangle path
 */
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Parse a price into prefix, subscript zero count, and rest digits for clear rendering
 */
function parsePriceParts(val) {
  if (val == null || !Number.isFinite(val) || val <= 0) {
    return { prefix: "--", sub: "", rest: "" };
  }
  if (val >= 1000) return { prefix: val.toFixed(2), sub: "", rest: "" };
  if (val >= 1) return { prefix: val.toFixed(4), sub: "", rest: "" };
  if (val >= 0.01) return { prefix: val.toFixed(5), sub: "", rest: "" };

  const str = val.toFixed(10);
  const match = str.match(/^0\.(0+)(\d+)/);
  if (match) {
    const zeroCount = match[1].length;
    const rest = match[2].slice(0, 4);
    if (zeroCount >= 3) {
      return { prefix: "0.0", sub: String(zeroCount), rest };
    }
  }
  return { prefix: val.toFixed(6), sub: "", rest: "" };
}

/**
 * Draw a Metlex-style white price pill with label (e.g. HIGH / LOW)
 */
function drawPricePill(ctx, x, y, label, priceVal) {
  const parts = parsePriceParts(priceVal);

  // Label text (HIGH / LOW)
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.font = "bold 11px 'DejaVu Sans', sans-serif";
  ctx.fillText(label, x, y + 4);
  const labelW = ctx.measureText(label).width;

  const pillX = x + labelW + 8;
  const pillY = y - 11;
  const pillH = 22;

  // Measure pill contents
  ctx.font = "bold 11px 'DejaVu Sans', monospace";
  let contentW = ctx.measureText(parts.prefix).width;
  if (parts.sub) {
    ctx.font = "bold 8px 'DejaVu Sans', monospace";
    contentW += ctx.measureText(parts.sub).width;
    ctx.font = "bold 11px 'DejaVu Sans', monospace";
    contentW += ctx.measureText(parts.rest).width;
  }
  const pillW = Math.max(contentW + 16, 68);

  // White pill container
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, pillX, pillY, pillW, pillH, 5);
  ctx.fill();

  // Dark text inside pill
  ctx.fillStyle = "#0c0d14";
  let textX = pillX + (pillW - contentW) / 2;
  const textBaseline = pillY + 15;

  ctx.font = "bold 11px 'DejaVu Sans', monospace";
  ctx.fillText(parts.prefix, textX, textBaseline);
  textX += ctx.measureText(parts.prefix).width;

  if (parts.sub) {
    ctx.font = "bold 8px 'DejaVu Sans', monospace";
    ctx.fillText(parts.sub, textX, textBaseline + 2);
    textX += ctx.measureText(parts.sub).width;

    ctx.font = "bold 11px 'DejaVu Sans', monospace";
    ctx.fillText(parts.rest, textX, textBaseline);
  }
}

/**
 * Format milliseconds into HH:MM:SS
 */
function formatDuration(ms) {
  if (!ms || ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return [
    String(hrs).padStart(2, "0"),
    String(mins).padStart(2, "0"),
    String(secs).padStart(2, "0"),
  ].join(":");
}

/**
 * Enrich position data from state.json / lessons.json if missing essential fields
 */
function enrichPositionData(pos) {
  if (!pos) return {};
  const enriched = { ...pos };

  if (!enriched.bin_range || !enriched.close_reason || !enriched.strategy) {
    try {
      const statePath = path.resolve(process.cwd(), "state.json");
      if (fs.existsSync(statePath)) {
        const stateData = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        const posObj = (stateData.positions && enriched.position) ? stateData.positions[enriched.position] : null;
        if (posObj) {
          enriched.bin_range = enriched.bin_range || posObj.bin_range;
          enriched.strategy = enriched.strategy || posObj.strategy;
          enriched.bin_step = enriched.bin_step || posObj.bin_step;
          enriched.close_reason = enriched.close_reason || posObj.close_reason || (posObj.notes?.length ? posObj.notes[posObj.notes.length - 1] : null);
          enriched.amount_sol = enriched.amount_sol || posObj.amount_sol;
          enriched.entry_mcap = enriched.entry_mcap || posObj.entry_mcap;
          enriched.active_bin_at_deploy = enriched.active_bin_at_deploy ?? posObj.active_bin_at_deploy;
        }
      }
    } catch {}

    try {
      const lessonsPath = path.resolve(process.cwd(), "lessons.json");
      if (fs.existsSync(lessonsPath)) {
        const lessonsData = JSON.parse(fs.readFileSync(lessonsPath, "utf-8"));
        const perf = (lessonsData.performance || []).find(
          p => (enriched.position && p.position === enriched.position) || (enriched.pool && p.pool === enriched.pool)
        );
        if (perf) {
          enriched.bin_range = enriched.bin_range || perf.bin_range;
          enriched.strategy = enriched.strategy || perf.strategy;
          enriched.bin_step = enriched.bin_step || perf.bin_step;
          enriched.close_reason = enriched.close_reason || perf.close_reason;
          enriched.amount_sol = enriched.amount_sol || perf.amount_sol;
          enriched.entry_mcap = enriched.entry_mcap || perf.entry_mcap;
          enriched.exit_mcap = enriched.exit_mcap || perf.exit_mcap;
        }
      }
    } catch {}
  }

  return enriched;
}

/**
 * Extract position LP range prices (rangeLow, rangeHigh)
 */
function getRangePrices(pos) {
  let rangeLow = null;
  let rangeHigh = null;

  if (pos.price_range?.min && pos.price_range?.max) {
    rangeLow = Number(pos.price_range.min);
    rangeHigh = Number(pos.price_range.max);
  }

  if ((!rangeLow || !rangeHigh) && pos.bin_range?.min != null && pos.bin_range?.max != null) {
    const binStep = Number(pos.bin_step) || 100;
    const rawMin = Math.pow(1 + binStep / 10000, Number(pos.bin_range.min));
    const rawMax = Math.pow(1 + binStep / 10000, Number(pos.bin_range.max));
    // Factor between base decimals (e.g. 6) and quote decimals (SOL 9)
    const factor = Math.pow(10, (pos.base_decimals ?? 6) - (pos.quote_decimals ?? 9));
    rangeLow = rawMin * factor;
    rangeHigh = rawMax * factor;
  }

  if (!rangeLow || !rangeHigh || rangeLow <= 0 || rangeHigh <= 0) {
    rangeLow = 0.00000528;
    rangeHigh = 0.00001060;
  }

  return { rangeLow, rangeHigh };
}

/**
 * Determine exit direction: whether closed Out of Range, and if so, above or below
 */
function getExitDirection(pos) {
  const reason = (pos.close_reason || (Array.isArray(pos.notes) ? pos.notes.join(" ") : "") || "").toLowerCase();
  const isOor = reason.includes("out of range") || reason.includes("oor");

  if (!isOor) {
    return { isOor: false, isOorAbove: false, isOorBelow: false };
  }

  if (reason.includes("above") || reason.includes("pump")) {
    return { isOor: true, isOorAbove: true, isOorBelow: false };
  }
  if (reason.includes("below") || reason.includes("dump")) {
    return { isOor: true, isOorAbove: false, isOorBelow: true };
  }

  // Single-sided SOL (bid-ask with bins_above === 0): all bins below entry, any OOR is ABOVE range
  const binsAbove = pos.bin_range?.bins_above ?? (pos.strategy === "bid_ask" ? 0 : null);
  const binsBelow = pos.bin_range?.bins_below ?? (pos.strategy === "bid_ask" ? 70 : null);

  if (binsAbove === 0 && (binsBelow == null || binsBelow > 0)) {
    return { isOor: true, isOorAbove: true, isOorBelow: false };
  }
  if (binsBelow === 0 && (binsAbove == null || binsAbove > 0)) {
    return { isOor: true, isOorAbove: false, isOorBelow: true };
  }

  // Compare exit market cap vs entry market cap
  if (pos.exit_mcap != null && pos.entry_mcap != null) {
    if (pos.exit_mcap >= pos.entry_mcap) {
      return { isOor: true, isOorAbove: true, isOorBelow: false };
    } else {
      return { isOor: true, isOorAbove: false, isOorBelow: true };
    }
  }

  // Default for bid_ask single-sided SOL
  return { isOor: true, isOorAbove: true, isOorBelow: false };
}

/**
 * Generate realistic synthetic candles that accurately model position entry, breakout, and exit
 */
function generateRealisticCandles({
  count = 24,
  pnlPct = 0,
  volatility = 2.5,
  isOorAbove = false,
  isOorBelow = false,
  rangeLow = 0.00000528,
  rangeHigh = 0.00001060,
  binsAbove = 0,
}) {
  const candles = [];
  const rangeSpan = Math.max(rangeHigh - rangeLow, rangeHigh * 0.2);
  const volPct = Math.max(0.015, Math.min(0.04, (volatility || 2.5) / 100));

  let startPrice;
  let targetExitPrice;

  if (isOorAbove) {
    // Bid-ask single-sided SOL enters at upper edge (rangeHigh)
    startPrice = binsAbove === 0 ? rangeHigh * 0.995 : rangeHigh * 0.94;
    // Exit price is positioned comfortably above rangeHigh (85px above HIGH line)
    targetExitPrice = rangeHigh + 0.28 * rangeSpan;
  } else if (isOorBelow) {
    startPrice = rangeLow * 1.005;
    targetExitPrice = rangeLow - 0.28 * rangeSpan;
  } else {
    // In-range position
    startPrice = rangeLow + rangeSpan * 0.55;
    targetExitPrice = Math.max(rangeLow * 1.02, Math.min(rangeHigh * 0.98, startPrice * (1 + pnlPct / 100)));
  }

  let currentPrice = startPrice;

  for (let i = 0; i < count; i++) {
    const progress = i / (count - 1);
    let trendPrice;

    if (isOorAbove) {
      if (progress < 0.20) {
        // Initial hovering & testing near rangeHigh
        trendPrice = startPrice + (rangeHigh * 1.008 - startPrice) * (progress / 0.20);
      } else if (progress < 0.45) {
        // Breakout push above rangeHigh with a retest
        const bp = (progress - 0.20) / 0.25;
        trendPrice = rangeHigh * 1.008 + (rangeHigh * 1.15 - rangeHigh * 1.008) * bp;
      } else {
        // Sustained out-of-range holding & climbing towards exit
        const cp = (progress - 0.45) / 0.55;
        trendPrice = rangeHigh * 1.15 + (targetExitPrice - rangeHigh * 1.15) * Math.pow(cp, 0.85);
      }
    } else if (isOorBelow) {
      if (progress < 0.20) {
        trendPrice = startPrice - (startPrice - rangeLow * 0.992) * (progress / 0.20);
      } else if (progress < 0.45) {
        const bp = (progress - 0.20) / 0.25;
        trendPrice = rangeLow * 0.992 - (rangeLow * 0.992 - rangeLow * 0.85) * bp;
      } else {
        const cp = (progress - 0.45) / 0.55;
        trendPrice = rangeLow * 0.85 - (rangeLow * 0.85 - targetExitPrice) * Math.pow(cp, 0.85);
      }
    } else {
      trendPrice = startPrice + (targetExitPrice - startPrice) * progress;
    }

    // Alternating wave oscillations to create both green/white and red/dark candles
    const wave1 = Math.sin(progress * Math.PI * 6.5) * (rangeSpan * volPct * 0.9);
    const wave2 = Math.cos(progress * Math.PI * 9.2) * (rangeSpan * volPct * 0.5);
    const noise = (Math.sin((i + 1) * 7.8) * 0.5 + (Math.random() - 0.5) * 0.5) * (rangeSpan * volPct * 0.8);

    const open = currentPrice;
    let close = i === count - 1 ? targetExitPrice : (trendPrice + wave1 + wave2 + noise);

    // Ensure exit candle (count - 2) close is exactly targetExitPrice
    if (i === count - 2) {
      close = targetExitPrice;
    }

    // Realistic wicks
    const wickUp = Math.random() * (rangeSpan * volPct * 0.7);
    const wickDown = Math.random() * (rangeSpan * volPct * 0.7);
    const high = Math.max(open, close) + wickUp;
    const low = Math.min(open, close) - wickDown;

    currentPrice = close;
    candles.push({ open, high, low, close });
  }

  return candles;
}

/**
 * Generate a position recap share card PNG buffer (Metlex-style)
 * @param {Object} rawPos Position details
 * @returns {Promise<Buffer>} PNG Buffer
 */
export async function generatePositionCard(rawPos = {}) {
  const pos = enrichPositionData(rawPos);

  const width = 1080;
  const height = 608;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 1. Background (Deep Dark Slate)
  ctx.fillStyle = "#08090d";
  ctx.fillRect(0, 0, width, height);

  // Radial ambient violet glow on right chart area
  const radialGlow = ctx.createRadialGradient(820, 240, 20, 820, 240, 500);
  radialGlow.addColorStop(0, "rgba(124, 92, 255, 0.16)");
  radialGlow.addColorStop(0.5, "rgba(80, 50, 180, 0.05)");
  radialGlow.addColorStop(1, "rgba(8, 9, 13, 0)");
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, width, height);

  // Subtle Dot Grid (cross-points every 32px)
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  for (let gx = 36; gx < width; gx += 32) {
    for (let gy = 36; gy < height; gy += 32) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Outer border with rounded corners
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 16, 16, width - 32, height - 32, 20);
  ctx.stroke();

  // ─── Top Header (Centered Hashtag) ───────────────
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("#MERIDIAN_DLMM", width / 2, 48);
  ctx.textAlign = "start";

  // ─── Left Column (Metrics & Info) ────────────────
  const startX = 54;

  // TIME Label
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "bold 12px 'DejaVu Sans', sans-serif";
  ctx.fillText("TIME", startX, 115);

  // Duration value
  const deployedMs = pos.deployed_at ? new Date(pos.deployed_at).getTime() : Date.now() - 3600000;
  const closedMs = pos.closed_at ? new Date(pos.closed_at).getTime() : Date.now();
  const durationStr = formatDuration(closedMs - deployedMs);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 44px 'DejaVu Sans', sans-serif";
  ctx.fillText(durationStr, startX, 165);

  // DLMM SUBTITLE
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
  ctx.fillText("DLMM (BASE + QT)", startX, 222);

  // PAIR NAME
  const rawPair = pos.pool_name || pos.pair || "TOKEN-SOL";
  const pairName = rawPair.toUpperCase();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 44px 'DejaVu Sans', sans-serif";
  ctx.fillText(pairName, startX, 275);

  // PROFIT LABEL
  const isSolMode = pos.close_pnl_sol != null;
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
  ctx.fillText(isSolMode ? "PROFIT (SOL)" : "PROFIT (USD)", startX, 335);

  // PROFIT BIG VALUE
  const pnlPct = Number(pos.close_pnl_pct ?? 0);
  const pnlSol = pos.close_pnl_sol != null ? Number(pos.close_pnl_sol) : null;
  const pnlUsd = pos.close_pnl_usd != null ? Number(pos.close_pnl_usd) : 0;
  const isProfit = pnlPct >= 0;

  let profitDisplay = "$0.00";
  if (pnlSol != null) {
    const absVal = Math.abs(pnlSol);
    const sign = pnlSol > 0 ? "+" : pnlSol < 0 ? "-" : "";
    profitDisplay = `${sign}${absVal >= 1 ? absVal.toFixed(3) : absVal.toFixed(4)}`;
  } else {
    const absVal = Math.abs(pnlUsd);
    const sign = pnlUsd > 0 ? "+" : pnlUsd < 0 ? "-" : "";
    profitDisplay = `${sign}$${absVal.toFixed(2)}`;
  }

  // Glowing profit number
  ctx.shadowColor = isProfit ? "rgba(16, 217, 160, 0.4)" : "rgba(255, 77, 109, 0.4)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = isProfit ? "#10d9a0" : "#ff4d6d";
  ctx.font = "900 66px 'DejaVu Sans', sans-serif";
  ctx.fillText(profitDisplay, startX, 412);
  ctx.shadowBlur = 0; // reset shadow

  // Branding / Footnote Left
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "12px 'DejaVu Sans', sans-serif";
  ctx.fillText("⚡ T.ME/AGENTMERIDIAN", startX, 475);
  ctx.fillText("🛡️ METEORA DLMM AUTONOMOUS LP", startX, 495);

  // ─── Right Column: DLMM Position Range & Chart ───
  const boxLeftX = 475;
  const boxRightX = 995;
  const boxW = boxRightX - boxLeftX;
  const boxTopY = 82;
  const boxBottomY = 510;

  // 1. Get position's LP range prices and exit direction
  const { rangeLow, rangeHigh } = getRangePrices(pos);
  const { isOor, isOorAbove, isOorBelow } = getExitDirection(pos);

  // 2. Vertical layout of the LP Range box:
  // When price pumped out of range above, place topLineY (HIGH) lower to give 65px+ headroom above for breakout & EXIT
  // When price dumped out of range below, place bottomLineY (LOW) higher to give 65px+ footroom below for breakdown & EXIT
  let topLineY;
  let bottomLineY;

  if (isOorAbove) {
    topLineY = 175;     // Upper LP boundary (HIGH line)
    bottomLineY = 480;  // Lower LP boundary (LOW line)
  } else if (isOorBelow) {
    topLineY = 110;     // Upper LP boundary
    bottomLineY = 415;  // Lower LP boundary (LOW line)
  } else {
    topLineY = 110;
    bottomLineY = 480;
  }

  // 3. Price-to-Y coordinate mapping
  // Maps rangeLow directly to bottomLineY, rangeHigh directly to topLineY
  const priceRange = Math.max(rangeHigh - rangeLow, rangeHigh * 0.05);
  const getY = (val) => bottomLineY - ((val - rangeLow) / priceRange) * (bottomLineY - topLineY);

  // 4. Generate candles accurately reflecting the position trajectory
  const CANDLE_COUNT = 24;
  const binsAbove = pos.bin_range?.bins_above ?? (pos.strategy === "bid_ask" ? 0 : 30);
  const candles = generateRealisticCandles({
    count: CANDLE_COUNT,
    pnlPct,
    volatility: pos.volatility,
    isOorAbove,
    isOorBelow,
    rangeLow,
    rangeHigh,
    binsAbove,
  });

  // 5. Purple DLMM Liquidity Bins (Curve & Stripes)
  // Liquidity strictly exists within the LP range [bottomLineY, topLineY]
  const curveStartX = boxLeftX + boxW * 0.54;
  const curveMidX = boxLeftX + boxW * 0.75;
  const curveEndX = boxRightX - 6;

  function getCurveX(py) {
    const t = 1 - (py - topLineY) / (bottomLineY - topLineY); // 0 at bottom, 1 at top
    return (1 - t) * (1 - t) * curveStartX + 2 * (1 - t) * t * curveMidX + t * t * curveEndX;
  }

  // Shading behind liquidity curve
  const rangeGrad = ctx.createLinearGradient(curveStartX, bottomLineY, boxRightX, topLineY);
  rangeGrad.addColorStop(0, "rgba(115, 75, 240, 0.04)");
  rangeGrad.addColorStop(0.5, "rgba(135, 90, 255, 0.24)");
  rangeGrad.addColorStop(1, "rgba(165, 115, 255, 0.50)");

  ctx.fillStyle = rangeGrad;
  ctx.beginPath();
  ctx.moveTo(curveStartX, bottomLineY);
  ctx.quadraticCurveTo(curveMidX, (bottomLineY + topLineY) / 2, curveEndX, topLineY);
  ctx.lineTo(boxRightX, topLineY);
  ctx.lineTo(boxRightX, bottomLineY);
  ctx.closePath();
  ctx.fill();

  // Purple Horizontal Bin Stripes across the curve (every 6px)
  ctx.strokeStyle = "rgba(160, 120, 255, 0.40)";
  ctx.lineWidth = 1.2;
  for (let py = bottomLineY; py >= topLineY; py -= 6) {
    const cx = getCurveX(py);
    ctx.beginPath();
    ctx.moveTo(cx, py);
    ctx.lineTo(boxRightX, py);
    ctx.stroke();
  }

  // 6. Dashed Bounding Box forming the LP Range [LOW, HIGH]
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;

  // Top horizontal dashed line (HIGH price boundary of LP range)
  ctx.beginPath();
  ctx.moveTo(boxLeftX - 10, topLineY);
  ctx.lineTo(boxRightX + 10, topLineY);
  ctx.stroke();

  // Bottom horizontal dashed line (LOW price boundary of LP range)
  ctx.beginPath();
  ctx.moveTo(boxLeftX - 10, bottomLineY);
  ctx.lineTo(boxRightX + 10, bottomLineY);
  ctx.stroke();

  // Candle horizontal area (offset from left edge so HIGH/LOW pills have clean room)
  const candleStartX = boxLeftX + 90;
  const candleEndX = boxRightX - 25;
  const candlePlotW = candleEndX - candleStartX;
  const candleStep = candlePlotW / candles.length;
  const exitCandleIdx = candles.length - 2;
  const exitCandle = candles[exitCandleIdx];
  const exitX = candleStartX + (exitCandleIdx + 0.5) * candleStep;
  const exitY = getY(exitCandle.close);

  // Vertical dashed lines extend past exitY if price went out of range
  const vertMinY = Math.min(topLineY, exitY) - 16;
  const vertMaxY = Math.max(bottomLineY, exitY) + 16;

  // Left vertical dashed line
  ctx.beginPath();
  ctx.moveTo(boxLeftX, vertMinY);
  ctx.lineTo(boxLeftX, vertMaxY);
  ctx.stroke();

  // Right vertical dashed line
  ctx.beginPath();
  ctx.moveTo(boxRightX, vertMinY);
  ctx.lineTo(boxRightX, vertMaxY);
  ctx.stroke();
  ctx.setLineDash([]);

  // 7. Draw Candlesticks
  const candleBodyW = Math.round(candleStep * 0.50); // ~10px

  candles.forEach((c, i) => {
    const cx = candleStartX + (i + 0.5) * candleStep;
    const isBullish = c.close >= c.open;
    const bodyTop = Math.min(getY(c.open), getY(c.close));
    const bodyH = Math.max(Math.abs(getY(c.close) - getY(c.open)), 2);

    // Wick
    ctx.strokeStyle = isBullish ? "rgba(255, 255, 255, 0.85)" : "rgba(150, 160, 185, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, getY(c.high));
    ctx.lineTo(cx, getY(c.low));
    ctx.stroke();

    // Body
    ctx.fillStyle = isBullish ? "#ffffff" : "#42485d";
    ctx.fillRect(cx - candleBodyW / 2, bodyTop, candleBodyW, bodyH);
  });

  // 8. HIGH and LOW Range Pills
  drawPricePill(ctx, boxLeftX + 10, topLineY, "HIGH", rangeHigh);
  drawPricePill(ctx, boxLeftX + 10, bottomLineY, "LOW", rangeLow);

  // Small circle at top-left intersection
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(boxLeftX, topLineY, 3.5, 0, Math.PI * 2);
  ctx.stroke();

  // 9. ENTRY pill (positioned directly above candle 0)
  const entryCandleX = candleStartX + 0.5 * candleStep;
  const entryPillW = 66;
  const entryPillH = 23;
  const entryPillX = Math.round(entryCandleX - entryPillW / 2);
  const entryY = getY(candles[0].open);
  const entryPillY = Math.max(boxTopY + 12, entryY - 36);

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, entryPillX, entryPillY, entryPillW, entryPillH, 6);
  ctx.fill();
  ctx.fillStyle = "#0c0d14";
  ctx.font = "bold 11px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ENTRY", entryPillX + entryPillW / 2, entryPillY + 16);
  ctx.textAlign = "start";

  // 10. EXIT pill & Target Circle on exit candle
  // Horizontal dashed guide line passing through the EXIT level
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.2;

  const exitPillW = 60;
  const exitPillH = 23;
  const exitPillPosX = exitX - exitPillW - 14;
  const exitPillPosY = exitY - exitPillH / 2;

  // Left dashed segment to EXIT pill
  ctx.beginPath();
  ctx.moveTo(boxLeftX + 15, exitY);
  ctx.lineTo(exitPillPosX - 6, exitY);
  ctx.stroke();

  // Right dashed segment from target circle to right box line
  ctx.beginPath();
  ctx.moveTo(exitX + 11, exitY);
  ctx.lineTo(boxRightX + 15, exitY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Solid line segment connecting EXIT pill to target circle
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(exitPillPosX + exitPillW, exitY);
  ctx.lineTo(exitX - 9, exitY);
  ctx.stroke();

  // Double-ring target circle on exit candle with dark backdrop disc
  ctx.fillStyle = "#08090d";
  ctx.beginPath();
  ctx.arc(exitX, exitY, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(exitX, exitY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(exitX, exitY, 7.5, 0, Math.PI * 2);
  ctx.stroke();

  // EXIT Pill
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, exitPillPosX, exitPillPosY, exitPillW, exitPillH, 6);
  ctx.fill();
  ctx.fillStyle = "#0c0d14";
  ctx.font = "bold 11px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("EXIT", exitPillPosX + exitPillW / 2, exitPillPosY + 16);
  ctx.textAlign = "start";

  // ─── Bottom Bar ──────────────────────────────────
  const bY = height - 58;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(35, bY - 12);
  ctx.lineTo(width - 35, bY - 12);
  ctx.stroke();

  // Bottom stats columns
  const initialSol = pos.amount_sol ? `${Number(pos.amount_sol).toFixed(2)} SOL` : "-- SOL";
  const binStep = pos.bin_step ?? 100;
  const totalBins = pos.total_bins ?? (pos.bin_range ? (pos.bin_range.bins_below || 60) : 60);
  const baseFee = pos.fee_pct ? `${Number(pos.fee_pct).toFixed(1)}%` : "2.0%";
  const pnlSign = pnlPct > 0 ? "+" : "";
  const pnlStr = `${pnlSign}${pnlPct.toFixed(2)}%`;

  const items = [
    { label: "TVL", val: initialSol, color: "#10d9a0" },
    { label: "BIN STEP", val: String(binStep) },
    { label: "BINS", val: String(totalBins) },
    { label: "BASE FEE", val: baseFee, color: "#10d9a0" },
    { label: "PNL", val: pnlStr, color: isProfit ? "#10d9a0" : "#ff4d6d" },
  ];

  const colWidth = (width - 100) / items.length;
  items.forEach((item, idx) => {
    const ix = 54 + idx * colWidth;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "bold 11px 'DejaVu Sans', sans-serif";
    ctx.fillText(item.label, ix, bY + 14);

    if (item.color) {
      ctx.fillStyle = item.color;
      ctx.font = "bold 14px 'DejaVu Sans', sans-serif";
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
    }
    ctx.fillText(item.val, ix + ctx.measureText(item.label).width + 8, bY + 14);
  });

  // Footer Center URL
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "bold 10px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("AGENTMERIDIAN.XYZ", width / 2, height - 20);
  ctx.textAlign = "start";

  return canvas.toBuffer("image/png");
}

/**
 * Generate an open position card PNG buffer (Metlex-style)
 * @param {Object} rawPos Position details
 * @returns {Promise<Buffer>} PNG Buffer
 */
export async function generateOpenPositionCard(rawPos = {}) {
  const pos = enrichPositionData(rawPos);

  const width = 1080;
  const height = 608;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 1. Background (Deep Dark Slate)
  ctx.fillStyle = "#08090d";
  ctx.fillRect(0, 0, width, height);

  // Radial ambient violet glow on right chart area
  const radialGlow = ctx.createRadialGradient(820, 240, 20, 820, 240, 500);
  radialGlow.addColorStop(0, "rgba(124, 92, 255, 0.16)");
  radialGlow.addColorStop(0.5, "rgba(80, 50, 180, 0.05)");
  radialGlow.addColorStop(1, "rgba(8, 9, 13, 0)");
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, width, height);

  // Subtle Dot Grid (cross-points every 32px)
  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  for (let gx = 36; gx < width; gx += 32) {
    for (let gy = 36; gy < height; gy += 32) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Outer border with rounded corners
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 16, 16, width - 32, height - 32, 20);
  ctx.stroke();

  // Top Header (Centered Hashtag)
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("#MERIDIAN_DLMM", width / 2, 48);
  ctx.textAlign = "start";

  // Left Column (Metrics & Info)
  const startX = 54;

  // STATUS Label
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.font = "bold 12px 'DejaVu Sans', sans-serif";
  ctx.fillText("STATUS", startX, 115);

  // Status value
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 44px 'DejaVu Sans', sans-serif";
  ctx.fillText("ACTIVE", startX, 165);

  // DLMM SUBTITLE
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
  ctx.fillText("DLMM (BASE + QT)", startX, 222);

  // PAIR NAME
  const rawPair = pos.pool_name || pos.pair || "TOKEN-SOL";
  const pairName = rawPair.toUpperCase();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 44px 'DejaVu Sans', sans-serif";
  ctx.fillText(pairName, startX, 275);

  // SIZE LABEL
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
  ctx.fillText("DEPLOYED SIZE", startX, 335);

  // SIZE BIG VALUE
  const amountSol = pos.amount_sol != null ? Number(pos.amount_sol) : 0.30;
  const sizeDisplay = `${amountSol.toFixed(2)} SOL`;

  ctx.shadowColor = "rgba(16, 217, 160, 0.45)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#10d9a0";
  ctx.font = "900 66px 'DejaVu Sans', sans-serif";
  ctx.fillText(sizeDisplay, startX, 412);
  ctx.shadowBlur = 0; // reset shadow

  // Optional target / strategy tag
  if (pos.target_wallet_name) {
    ctx.fillStyle = "rgba(124, 92, 255, 0.9)";
    ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
    ctx.fillText(`TARGET: ${pos.target_wallet_name.toUpperCase()}${pos.target_priority != null ? ` (PRIO ${pos.target_priority})` : ""}`, startX, 452);
  }

  // Branding / Footnote Left
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "12px 'DejaVu Sans', sans-serif";
  ctx.fillText("⚡ T.ME/AGENTMERIDIAN", startX, 482);
  ctx.fillText("🛡️ METEORA DLMM AUTONOMOUS LP", startX, 502);

  // Right Column: DLMM Position Range & Chart
  const boxLeftX = 475;
  const boxRightX = 995;
  const boxW = boxRightX - boxLeftX;
  const boxTopY = 82;
  const boxBottomY = 510;

  const { rangeLow, rangeHigh } = getRangePrices(pos);
  const topLineY = 110;
  const bottomLineY = 480;

  const priceRange = Math.max(rangeHigh - rangeLow, rangeHigh * 0.05);
  const getY = (val) => bottomLineY - ((val - rangeLow) / priceRange) * (bottomLineY - topLineY);

  // Fill gradient curve
  const curveStartX = boxLeftX + boxW * 0.28;
  const curveMidX = boxLeftX + boxW * 0.65;
  const curveEndX = boxRightX - 30;

  const getCurveX = (y) => {
    const t = 1 - (y - topLineY) / (bottomLineY - topLineY);
    return (1 - t) * (1 - t) * curveStartX + 2 * (1 - t) * t * curveMidX + t * t * curveEndX;
  };

  const rangeGrad = ctx.createLinearGradient(boxLeftX, 0, boxRightX, 0);
  rangeGrad.addColorStop(0, "rgba(115, 75, 240, 0.04)");
  rangeGrad.addColorStop(0.5, "rgba(135, 90, 255, 0.24)");
  rangeGrad.addColorStop(1, "rgba(165, 115, 255, 0.50)");

  ctx.fillStyle = rangeGrad;
  ctx.beginPath();
  ctx.moveTo(curveStartX, bottomLineY);
  ctx.quadraticCurveTo(curveMidX, (bottomLineY + topLineY) / 2, curveEndX, topLineY);
  ctx.lineTo(boxRightX, topLineY);
  ctx.lineTo(boxRightX, bottomLineY);
  ctx.closePath();
  ctx.fill();

  // Purple Horizontal Bin Stripes across the curve (every 6px)
  ctx.strokeStyle = "rgba(160, 120, 255, 0.40)";
  ctx.lineWidth = 1.2;
  for (let py = bottomLineY; py >= topLineY; py -= 6) {
    const cx = getCurveX(py);
    ctx.beginPath();
    ctx.moveTo(cx, py);
    ctx.lineTo(boxRightX, py);
    ctx.stroke();
  }

  // Dashed Bounding Box forming the LP Range [LOW, HIGH]
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;

  ctx.beginPath();
  ctx.moveTo(boxLeftX - 10, topLineY);
  ctx.lineTo(boxRightX + 10, topLineY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(boxLeftX - 10, bottomLineY);
  ctx.lineTo(boxRightX + 10, bottomLineY);
  ctx.stroke();

  // Candlesticks leading up to ENTRY
  const candleStartX = boxLeftX + 90;
  const candleEndX = boxRightX - 25;
  const candlePlotW = candleEndX - candleStartX;
  const CANDLE_COUNT = 18;
  const candleStep = candlePlotW / CANDLE_COUNT;
  const candleBodyW = Math.round(candleStep * 0.50);

  const rangeSpan = Math.max(rangeHigh - rangeLow, rangeHigh * 0.1);
  const binsAbove = pos.bin_range?.bins_above ?? (pos.strategy === "bid_ask" ? 0 : 30);
  const entryPrice = binsAbove === 0 ? rangeHigh * 0.995 : rangeLow + rangeSpan * 0.55;
  const startPrice = rangeLow + rangeSpan * 0.45;

  let currentPrice = startPrice;
  const candles = [];
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const progress = i / (CANDLE_COUNT - 1);
    const trendPrice = startPrice + (entryPrice - startPrice) * progress;
    const wave = Math.sin(progress * Math.PI * 3.5) * (rangeSpan * 0.03);
    const noise = (Math.random() - 0.5) * (rangeSpan * 0.025);

    const open = currentPrice;
    const close = i === CANDLE_COUNT - 1 ? entryPrice : (trendPrice + wave + noise);
    const high = Math.max(open, close) + Math.random() * (rangeSpan * 0.02);
    const low = Math.min(open, close) - Math.random() * (rangeSpan * 0.02);

    currentPrice = close;
    candles.push({ open, high, low, close });
  }

  candles.forEach((c, i) => {
    const cx = candleStartX + (i + 0.5) * candleStep;
    const isBullish = c.close >= c.open;
    const bodyTop = Math.min(getY(c.open), getY(c.close));
    const bodyH = Math.max(Math.abs(getY(c.close) - getY(c.open)), 2);

    ctx.strokeStyle = isBullish ? "rgba(255, 255, 255, 0.85)" : "rgba(150, 160, 185, 0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, getY(c.high));
    ctx.lineTo(cx, getY(c.low));
    ctx.stroke();

    ctx.fillStyle = isBullish ? "#ffffff" : "#42485d";
    ctx.fillRect(cx - candleBodyW / 2, bodyTop, candleBodyW, bodyH);
  });

  // Target Circle & ENTRY pill on the final candle
  const entryCandleIdx = CANDLE_COUNT - 1;
  const entryX = candleStartX + (entryCandleIdx + 0.5) * candleStep;
  const entryY = getY(entryPrice);

  // Guide dashed line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(boxLeftX + 15, entryY);
  ctx.lineTo(entryX - 10, entryY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Double-ring target circle on entry candle
  ctx.fillStyle = "#08090d";
  ctx.beginPath();
  ctx.arc(entryX, entryY, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#10d9a0";
  ctx.beginPath();
  ctx.arc(entryX, entryY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#10d9a0";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(entryX, entryY, 7.5, 0, Math.PI * 2);
  ctx.stroke();

  // ENTRY Pill
  const entryPillW = 66;
  const entryPillH = 23;
  const entryPillPosX = Math.max(boxLeftX + 20, entryX - entryPillW - 14);
  const entryPillPosY = entryY - entryPillH / 2;

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, entryPillPosX, entryPillPosY, entryPillW, entryPillH, 6);
  ctx.fill();
  ctx.fillStyle = "#0c0d14";
  ctx.font = "bold 11px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ENTRY", entryPillPosX + entryPillW / 2, entryPillPosY + 16);
  ctx.textAlign = "start";

  // HIGH and LOW Range Pills
  drawPricePill(ctx, boxLeftX + 10, topLineY, "HIGH", rangeHigh);
  drawPricePill(ctx, boxLeftX + 10, bottomLineY, "LOW", rangeLow);

  // Bottom Bar
  const bY = height - 58;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(35, bY - 12);
  ctx.lineTo(width - 35, bY - 12);
  ctx.stroke();

  const binStep = pos.bin_step ?? 100;
  const totalBins = pos.total_bins ?? (pos.bin_range ? (pos.bin_range.bins_below || 60) : 60);
  const baseFee = pos.fee_pct ? `${Number(pos.fee_pct).toFixed(1)}%` : "2.0%";
  const strat = (pos.strategy || "spot").toUpperCase();

  const items = [
    { label: "TVL", val: sizeDisplay, color: "#10d9a0" },
    { label: "BIN STEP", val: String(binStep) },
    { label: "BINS", val: String(totalBins) },
    { label: "BASE FEE", val: baseFee, color: "#10d9a0" },
    { label: "STRATEGY", val: strat, color: "#10d9a0" },
  ];

  const colWidth = (width - 100) / items.length;
  items.forEach((item, idx) => {
    const ix = 54 + idx * colWidth;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "bold 11px 'DejaVu Sans', sans-serif";
    ctx.fillText(item.label, ix, bY + 14);

    if (item.color) {
      ctx.fillStyle = item.color;
      ctx.font = "bold 14px 'DejaVu Sans', sans-serif";
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px 'DejaVu Sans', sans-serif";
    }
    ctx.fillText(item.val, ix + ctx.measureText(item.label).width + 8, bY + 14);
  });

  // Footer Center URL
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.font = "bold 10px 'DejaVu Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("AGENTMERIDIAN.XYZ", width / 2, height - 20);
  ctx.textAlign = "start";

  return canvas.toBuffer("image/png");
}

/**
 * Send open position notification to Telegram (text + emotes only, no image card)
 */
export async function sendOpenPositionCard(posData) {
  try {
    const { sendHTML } = await import("./telegram.js");
    const { escapeHtml } = await import("./utils/html.js");

    const pair = escapeHtml(posData.pool_name || posData.pair || "DLMM Pool");
    const amountStr = posData.amount_sol != null ? `${Number(posData.amount_sol).toFixed(2)} SOL` : "0.30 SOL";
    const stratStr = escapeHtml((posData.strategy || "spot").toUpperCase());
    const binsStr = posData.total_bins ? ` (${posData.total_bins} bins)` : "";
    const targetStr = posData.target_wallet_name
      ? ` ├─ 👤 Target: <b>${escapeHtml(posData.target_wallet_name)}</b>${posData.target_priority != null ? ` (Priority ${posData.target_priority})` : ""}\n`
      : "";
    const reasonStr = posData.reason
      ? ` ├─ 🛠 Reason: <i>${escapeHtml(posData.reason)}</i>\n`
      : "";
    const posStr = posData.position
      ? ` ├─ 📍 Position: <code>${escapeHtml(posData.position.slice(0, 10))}...</code>\n`
      : "";
    const txStr = posData.tx
      ? ` └─ 🧾 Tx: <code>${escapeHtml(posData.tx.slice(0, 16))}...</code>`
      : ` └─ ⚡ <i>Active in Range</i>`;

    const message =
      `🚀 <b>New Position Opened</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `🔹 <b>${pair}</b>\n` +
      ` ├─ 💧 Size: <b>${amountStr}</b>\n` +
      ` ├─ 📐 Strategy: <b>${stratStr}</b>${binsStr}\n` +
      targetStr +
      reasonStr +
      posStr +
      txStr;

    return await sendHTML(message);
  } catch (err) {
    log("telegram_error", `Failed to send open position notification: ${err.message}`);
    return null;
  }
}

/**
 * Generate position card and send directly to Telegram
 */
export async function sendCloseRecapCard(posData) {
  try {
    const { sendPhoto, sendHTML } = await import("./telegram.js");
    let buffer = null;
    try {
      buffer = await generatePositionCard(posData);
    } catch (cardErr) {
      log("card", `Failed to generate close recap card buffer: ${cardErr.message}`);
    }

    const pnlPct = Number(posData.close_pnl_pct ?? 0);
    const pnlSign = pnlPct >= 0 ? "+" : "";
    const profitStr = posData.close_pnl_sol != null
      ? `${posData.close_pnl_sol >= 0 ? "+" : ""}${Number(posData.close_pnl_sol).toFixed(4)} SOL`
      : `${(posData.close_pnl_usd ?? 0) >= 0 ? "+" : ""}$${Number(posData.close_pnl_usd ?? 0).toFixed(2)}`;

    const caption = [
      `🎯 <b>Position Closed: ${posData.pool_name || posData.pair || "DLMM Pool"}</b>`,
      `💰 PnL: <b>${pnlSign}${pnlPct.toFixed(2)}%</b> (${profitStr})`,
      posData.close_reason ? `📋 Reason: <i>${posData.close_reason}</i>` : null,
    ].filter(Boolean).join("\n");

    if (buffer) {
      const res = await sendPhoto(buffer, caption);
      if (res) return res;
    }
    return await sendHTML(caption);
  } catch (err) {
    log("card", `Failed to send close recap card: ${err.message}`);
    return null;
  }
}

