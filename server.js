import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { executeTool } from "./tools/executor.js";
import { getWalletBalances } from "./tools/wallet.js";
import { getMyPositions } from "./tools/dlmm.js";
import { getTopCandidates } from "./tools/screening.js";
import { config } from "./config.js";
import { log } from "./logger.js";
import { REPO_ROOT, repoPath } from "./repo-root.js";
import { getTrackedPositions, recordPortfolioSnapshot, getPortfolioHistory } from "./state.js";
import { Connection } from "@solana/web3.js";
import { listStrategies, setActiveStrategy } from "./strategy-library.js";
import { rpcManager, getConnection } from "./tools/rpc.js";

let apiStatusCache = null;
let apiStatusCacheTime = 0;

async function checkApiConnections() {
  const now = Date.now();
  if (apiStatusCache && (now - apiStatusCacheTime < 60000)) {
    return apiStatusCache;
  }

  const results = {
    rpc: { connected: false, detail: "Not connected" },
    helius: { connected: false, detail: "Not connected" },
    telegram: { connected: false, detail: "Not configured" },
    llm: { connected: false, detail: "Not configured" }
  };

  // 1. RPC
  try {
    const connection = getConnection();
    const activeEp = rpcManager.getActiveEndpoint();
    const slot = await Promise.race([
      connection.getSlot(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
    ]);
    results.rpc = { connected: true, detail: `${activeEp?.name || "Connected"} (Slot: ${slot})` };
  } catch (e) {
    results.rpc = { connected: false, detail: e.message };
  }

  // 2. Helius
  try {
    if (process.env.HELIUS_API_KEY) {
      results.helius = { connected: true, detail: "Configured" };
    } else {
      results.helius = { connected: false, detail: "HELIUS_API_KEY missing" };
    }
  } catch (e) {
    results.helius = { connected: false, detail: e.message };
  }

  // 3. Telegram
  try {
    if (process.env.TELEGRAM_BOT_TOKEN) {
      const res = await Promise.race([
        fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          results.telegram = { connected: true, detail: `@${data.result.username}` };
        } else {
          results.telegram = { connected: false, detail: data.description || "Invalid token" };
        }
      } else {
        results.telegram = { connected: false, detail: `HTTP ${res.status}` };
      }
    } else {
      results.telegram = { connected: false, detail: "TELEGRAM_BOT_TOKEN missing" };
    }
  } catch (e) {
    results.telegram = { connected: false, detail: e.message };
  }

  // 4. LLM
  try {
    const baseUrl = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    if (apiKey) {
      const res = await Promise.race([
        fetch(`${baseUrl}/models`, {
          headers: { "Authorization": `Bearer ${apiKey}` }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000))
      ]);
      if (res.ok) {
        results.llm = { connected: true, detail: "Connected" };
      } else {
        results.llm = { connected: false, detail: `HTTP ${res.status}` };
      }
    } else {
      results.llm = { connected: false, detail: "API key missing" };
    }
  } catch (e) {
    results.llm = { connected: false, detail: e.message };
  }

  apiStatusCache = results;
  apiStatusCacheTime = now;
  return results;
}


// Session store in memory: token -> { expires, csrfToken }
const sessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
let lastKnownSolPrice = 0;

export function startDashboardServer(context = {}) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || "127.0.0.1";

  // Resolve password from env or generate ephemeral one
  let password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(16).toString("hex");
    console.warn(`\n[Dashboard Warning] DASHBOARD_PASSWORD is not set in env. Ephemeral password generated: ${password}\n`);
  }

  app.use(express.json());

  // Custom cookie parser middleware (avoids cookie-parser dependency)
  app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(";").forEach((c) => {
        const parts = c.split("=");
        if (parts.length === 2) {
          req.cookies[parts[0].trim()] = parts[1].trim();
        }
      });
    }
    next();
  });

  // Auth Middleware
  const requireAuth = (req, res, next) => {
    const sessionToken = req.cookies.session;
    if (!sessionToken || !sessions.has(sessionToken)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const sessionObj = sessions.get(sessionToken);
    if (Date.now() > sessionObj.expires) {
      sessions.delete(sessionToken);
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };

  // CSRF Middleware for state-changing requests
  const requireCsrf = (req, res, next) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      const sessionToken = req.cookies.session;
      const clientCsrfToken = req.headers["x-csrf-token"];
      const sessionObj = sessions.get(sessionToken);
      if (!sessionObj || !clientCsrfToken || clientCsrfToken !== sessionObj.csrfToken) {
        return res.status(403).json({ error: "Forbidden (CSRF check failed)" });
      }
    }
    next();
  };

  // ─── AUTHENTICATION ENDPOINTS ───────────────────
  
  app.post("/api/auth/login", (req, res) => {
    const { pass } = req.body;
    if (!pass || pass !== password) {
      return res.status(400).json({ error: "Invalid password" });
    }

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const csrfToken = crypto.randomBytes(16).toString("hex");
    const expires = Date.now() + SESSION_TTL;

    sessions.set(sessionToken, { expires, csrfToken });

    res.cookie("session", sessionToken, {
      httpOnly: true,
      secure: false, // Set false for local HTTP, let it be configurable if needed
      sameSite: "lax",
      maxAge: SESSION_TTL,
    });

    res.json({ success: true, csrfToken });
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    const sessionToken = req.cookies.session;
    if (sessionToken) {
      sessions.delete(sessionToken);
    }
    res.clearCookie("session");
    res.json({ success: true });
  });

  // ─── API ENDPOINTS (PROTECTED) ───────────────────

  app.get("/api/status", requireAuth, async (req, res) => {
    try {
      const balances = await getWalletBalances().catch(() => ({ sol: 0, sol_usd: 0, sol_price: 0, tokens: [] }));
      const statusData = context.getStatus ? context.getStatus() : {};

      // Record daily portfolio snapshot (uses cached positions if TTL hasn't expired)
      const livePositions = await getMyPositions().catch(() => ({ positions: [], total_positions: 0 }));
      const positionsVal = (livePositions?.positions || []).reduce((sum, p) => sum + (Number(p.total_value_usd) || 0), 0);
      const solPrice = Number(balances.sol_price) || 0;
      if (solPrice > 0) lastKnownSolPrice = solPrice;
      const walletVal = Number(balances.sol_usd) || (Number(balances.sol) * solPrice);
      const totalPortfolioValue = walletVal + positionsVal;
      const totalPortfolioValueSol = solPrice > 0 ? (totalPortfolioValue / solPrice) : Number(balances.sol);
      // Record hourly portfolio snapshot (wallet SOL + LP positions value in SOL)
      if (totalPortfolioValue > 0) {
        recordPortfolioSnapshot(totalPortfolioValue, totalPortfolioValueSol);
      }

      // Calculate Winrate
      const allTracked = getTrackedPositions(false);
      const closed = allTracked.filter(p => p.closed);
      let performanceMap = {};
      try {
        const lessonsPath = path.join(REPO_ROOT, "lessons.json");
        if (fs.existsSync(lessonsPath)) {
          const lessonsData = JSON.parse(fs.readFileSync(lessonsPath, "utf-8"));
          const perfList = lessonsData.performance || [];
          for (const item of perfList) {
            if (item.position) {
              performanceMap[item.position] = {
                pnl_usd: item.pnl_usd,
                pnl_pct: item.pnl_pct
              };
            }
          }
        }
      } catch (err) {
        log("server_error", `Failed to read lessons.json for winrate: ${err.message}`);
      }

      let wins = 0;
      let losses = 0;
      closed.forEach(p => {
        const perf = performanceMap[p.position] || {};
        const pnlUsd = perf.pnl_usd ?? p.close_pnl_usd ?? 0;
        if (pnlUsd > 0) wins++;
        else if (pnlUsd < 0) losses++;
      });

      const apiStatus = await checkApiConnections();
      
      const sessionObj = sessions.get(req.cookies.session);
      res.json({
        wallet: balances,
        dryRun: process.env.DRY_RUN === "true",
        managementBusy: statusData.managementBusy || false,
        screeningBusy: statusData.screeningBusy || false,
        cronStarted: statusData.cronStarted || false,
        timers: statusData.timers || {},
        maxPositions: config.risk.maxPositions,
        deployAmountSol: config.management.deployAmountSol,
        csrfToken: sessionObj ? sessionObj.csrfToken : undefined,
        winrate: { wins, losses },
        apiStatus,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/positions", requireAuth, async (req, res) => {
    try {
      const livePositions = await getMyPositions({ force: true }).catch(() => ({ positions: [], total_positions: 0 }));
      res.json(livePositions);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/positions/history", requireAuth, async (req, res) => {
    try {
      const allTracked = getTrackedPositions(false);
      const closed = allTracked.filter(p => p.closed);

      // Load lessons to match performance pnl_usd / pnl_pct
      let performanceMap = {};
      try {
        const lessonsPath = path.join(REPO_ROOT, "lessons.json");
        if (fs.existsSync(lessonsPath)) {
          const lessonsData = JSON.parse(fs.readFileSync(lessonsPath, "utf-8"));
          const perfList = lessonsData.performance || [];
          for (const item of perfList) {
            if (item.position) {
              performanceMap[item.position] = {
                pnl_usd: item.pnl_usd,
                pnl_pct: item.pnl_pct,
                base_mint: item.base_mint || null
              };
            }
          }
        }
      } catch (err) {
        log("server_error", `Failed to read lessons.json for history: ${err.message}`);
      }

      // Map closed positions with their final performance PnL
      const mappedClosed = closed.map(p => {
        const perf = performanceMap[p.position] || {};
        return {
          ...p,
          close_pnl_pct: perf.pnl_pct ?? p.close_pnl_pct ?? p.peak_pnl_pct ?? 0,
          close_pnl_usd: perf.pnl_usd ?? p.close_pnl_usd ?? 0,
          base_mint: p.base_mint || perf.base_mint || p.signal_snapshot?.base_mint || null
        };
      });

      // Sort closed positions by closed_at descending (newest closed first)
      mappedClosed.sort((a, b) => new Date(b.closed_at || 0) - new Date(a.closed_at || 0));
      res.json({
        positions: mappedClosed,
        total_positions: mappedClosed.length
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/positions/close", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { position } = req.body;
      if (!position) return res.status(400).json({ error: "Missing position address" });
      
      log("dashboard", `Manual close triggered via Web UI for position ${position}`);
      const result = await executeTool("close_position", { position_address: position });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/positions/instruction", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { position, instruction } = req.body;
      if (!position) return res.status(400).json({ error: "Missing position address" });

      const result = await executeTool("set_position_note", { position_address: position, instruction });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/candidates", requireAuth, async (req, res) => {
    try {
      const candidatesData = await getTopCandidates({ limit: 10 }).catch(() => ({ candidates: [] }));
      res.json(candidatesData);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/candidates/check-filter", requireAuth, async (req, res) => {
    try {
      const { address } = req.query;
      if (!address) return res.status(400).json({ error: "Address query parameter is required" });
      const { testScreeningFiltersForAddress } = await import("./tools/screening.js");
      const result = await testScreeningFiltersForAddress(address.trim());
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/candidates/screen", requireAuth, requireCsrf, async (req, res) => {
    if (context.runScreeningCycle) {
      log("dashboard", "Manual screening cycle triggered via Web UI");
      // Run async in background
      context.runScreeningCycle({ silent: false }).catch((e) => {
        log("dashboard_error", `Background screen failed: ${e.message}`);
      });
      res.json({ success: true, message: "Screening cycle started in background" });
    } else {
      res.status(400).json({ error: "Screening handler not registered" });
    }
  });

  app.post("/api/candidates/deploy", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { pool_address, amount, bins_below, pool_name } = req.body;
      if (!pool_address) return res.status(400).json({ error: "Missing pool address" });
      if (!amount || amount <= 0) return res.status(400).json({ error: "Invalid amount" });

      log("dashboard", `Manual deploy triggered via Web UI for pool ${pool_address} (${amount} SOL)`);
      const result = await executeTool("deploy_position", {
        pool_address,
        amount_y: Number(amount),
        strategy: config.strategy.strategy,
        bins_below: Number(bins_below || config.strategy.defaultBinsBelow),
        bins_above: 0,
        pool_name: pool_name || "unknown",
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/decisions", requireAuth, (req, res) => {
    try {
      const logPath = repoPath("decision-log.json");
      if (fs.existsSync(logPath)) {
        const raw = fs.readFileSync(logPath, "utf8");
        res.json(JSON.parse(raw));
      } else {
        res.json([]);
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/lessons", requireAuth, (req, res) => {
    try {
      const lessonsPath = repoPath("lessons.json");
      if (fs.existsSync(lessonsPath)) {
        const raw = fs.readFileSync(lessonsPath, "utf8");
        res.json(JSON.parse(raw));
      } else {
        res.json({ lessons: [], performance: [] });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/lessons/add", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { rule, tags } = req.body;
      if (!rule) return res.status(400).json({ error: "Missing lesson rule text" });
      
      const result = await executeTool("add_lesson", { rule, tags });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clear ALL lessons (keeps performance data intact)
  app.delete("/api/lessons/clear-all", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { clearAllLessons } = await import("./lessons.js");
      const count = clearAllLessons();
      log("dashboard", `Cleared all ${count} lessons via Web UI`);
      res.json({ success: true, cleared: count, message: `${count} lesson(s) cleared successfully.` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clear ALL performance records (keeps lessons intact)
  app.delete("/api/lessons/clear-performance", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { clearPerformance } = await import("./lessons.js");
      const count = clearPerformance();
      log("dashboard", `Cleared all ${count} performance records via Web UI`);
      res.json({ success: true, cleared: count, message: `${count} performance record(s) cleared.` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clear state/history database to reset winrate
  app.delete("/api/state/clear-history", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { clearStateHistory } = await import("./state.js");
      const count = clearStateHistory();
      log("dashboard", `Cleared position database history (${count} closed positions deleted) via Web UI`);
      res.json({ success: true, cleared: count, message: `${count} closed position(s) history cleared. Winrate has been reset.` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get config change recommendations for a specific lesson rule text
  app.post("/api/lessons/recommend-config", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { rule } = req.body;
      if (!rule) return res.status(400).json({ error: "Lesson rule text is required" });
      const { getRecommendationForLesson } = await import("./agent.js");
      const recommendations = await getRecommendationForLesson(rule);
      res.json({ success: true, recommendations });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/portfolio/history", requireAuth, (req, res) => {
    try {
      const history = getPortfolioHistory();
      res.json({ success: true, history });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/pnl/calendar", requireAuth, (req, res) => {
    try {
      // 1. Gather closed positions from state.json
      const allTracked = getTrackedPositions(false);
      const closedPositions = allTracked.filter(p => p.closed);

      // 2. Gather performance records from lessons.json
      let perfList = [];
      try {
        const lessonsPath = repoPath("lessons.json");
        if (fs.existsSync(lessonsPath)) {
          const lessonsData = JSON.parse(fs.readFileSync(lessonsPath, "utf8"));
          perfList = lessonsData.performance || [];
        }
      } catch (err) {
        log("server_error", `Failed to read lessons.json for calendar: ${err.message}`);
      }

      // 3. Merge & deduplicate by position address
      const tradeMap = new Map();

      // Process lessons performance first
      for (const item of perfList) {
        const id = item.position || `${item.pool}_${item.recorded_at}`;
        const dateStr = item.recorded_at || item.created_at;
        tradeMap.set(id, {
          id,
          position: item.position || "",
          pool_name: item.pool_name || item.pool || "unknown",
          pool: item.pool || "",
          date: dateStr,
          pnl_usd: Number(item.pnl_usd || 0),
          pnl_pct: Number(item.pnl_pct || 0),
          fees_usd: Number(item.fees_earned_usd || 0),
          minutes_held: item.minutes_held ? Math.round(item.minutes_held) : null,
          close_reason: item.close_reason || "Position closed",
          initial_value_usd: item.initial_value_usd || null,
          final_value_usd: item.final_value_usd || null,
        });
      }

      // Overlay/add state.json closed positions (contains latest on-chain close data)
      for (const pos of closedPositions) {
        const id = pos.position || `${pos.pool}_${pos.closed_at}`;
        const existing = tradeMap.get(id);
        const dateStr = pos.closed_at || pos.deployed_at || (existing ? existing.date : null);
        const pnlUsd = existing?.pnl_usd ?? Number(pos.close_pnl_usd || 0);
        const pnlPct = existing?.pnl_pct ?? Number(pos.close_pnl_pct || pos.peak_pnl_pct || 0);
        const feesUsd = (existing?.fees_usd && existing.fees_usd > 0) ? existing.fees_usd : Number(pos.total_fees_claimed_usd || 0);

        tradeMap.set(id, {
          id,
          position: pos.position || "",
          pool_name: pos.pool_name || pos.pool || (existing ? existing.pool_name : "unknown"),
          pool: pos.pool || (existing ? existing.pool : ""),
          date: dateStr,
          pnl_usd: pnlUsd,
          pnl_pct: pnlPct,
          fees_usd: feesUsd,
          minutes_held: existing?.minutes_held || (pos.deployed_at && pos.closed_at ? Math.round((new Date(pos.closed_at) - new Date(pos.deployed_at)) / 60000) : null),
          close_reason: existing?.close_reason || pos.notes?.[pos.notes.length - 1] || "Closed",
          initial_value_usd: existing?.initial_value_usd || pos.initial_value_usd || null,
          final_value_usd: existing?.final_value_usd || null,
        });
      }

      // 4. Group by Date (YYYY-MM-DD)
      const daily = {};
      let totalPnl = 0;
      let totalFees = 0;
      let totalWins = 0;
      let totalLosses = 0;

      for (const trade of tradeMap.values()) {
        if (!trade.date) continue;
        const d = new Date(trade.date);
        if (isNaN(d.getTime())) continue;

        // Group by YYYY-MM-DD
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const dayKey = `${year}-${month}-${day}`;

        if (!daily[dayKey]) {
          daily[dayKey] = {
            date: dayKey,
            pnl_usd: 0,
            fees_usd: 0,
            trades_count: 0,
            wins: 0,
            losses: 0,
            trades: [],
          };
        }

        daily[dayKey].pnl_usd += trade.pnl_usd;
        daily[dayKey].fees_usd += trade.fees_usd;
        daily[dayKey].trades_count += 1;

        if (trade.pnl_usd > 0 || (trade.pnl_usd === 0 && trade.pnl_pct >= 0)) {
          daily[dayKey].wins += 1;
          totalWins += 1;
        } else {
          daily[dayKey].losses += 1;
          totalLosses += 1;
        }

        daily[dayKey].trades.push(trade);
        totalPnl += trade.pnl_usd;
        totalFees += trade.fees_usd;
      }

      // Sort trades inside each day newest first
      for (const dayKey in daily) {
        daily[dayKey].pnl_usd = parseFloat(daily[dayKey].pnl_usd.toFixed(2));
        daily[dayKey].fees_usd = parseFloat(daily[dayKey].fees_usd.toFixed(4));
        daily[dayKey].trades.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      }

      const totalTrades = totalWins + totalLosses;
      const winRate = totalTrades > 0 ? parseFloat(((totalWins / totalTrades) * 100).toFixed(1)) : 0;

      res.json({
        success: true,
        daily,
        sol_price: lastKnownSolPrice || 0,
        allTime: {
          total_pnl_usd: parseFloat(totalPnl.toFixed(2)),
          total_fees_usd: parseFloat(totalFees.toFixed(2)),
          total_trades: totalTrades,
          wins: totalWins,
          losses: totalLosses,
          win_rate: winRate,
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/config", requireAuth, (req, res) => {
    // Return editable parameters
    res.json({
      screening: config.screening,
      management: config.management,
      risk: config.risk,
      schedule: config.schedule,
      llm: config.llm,
      strategy: config.strategy,
      pnl: config.pnl,
      opportunity: config.opportunity,
      indicators: config.indicators,
      chartIndicators: config.indicators,
      rpcStatus: rpcManager.getStatus(),
    });
  });

  app.get("/api/rpc/status", requireAuth, (req, res) => {
    res.json(rpcManager.getStatus());
  });

  app.post("/api/rpc/probe", requireAuth, requireCsrf, async (req, res) => {
    try {
      log("dashboard", "Manual RPC probe triggered via Web UI");
      const result = await rpcManager.probeAllEndpoints();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/config/update", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { changes } = req.body;
      if (!changes || typeof changes !== "object") {
        return res.status(400).json({ error: "Changes object required" });
      }
      
      log("dashboard", `Config updates requested via Web UI: ${JSON.stringify(changes)}`);
      const result = await executeTool("update_config", {
        changes,
        reason: "Web Dashboard Configuration Panel",
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Strategy Manager API ─────────────────────────────────────

  // List all strategies with active status
  app.get("/api/strategies", requireAuth, (req, res) => {
    try {
      const result = listStrategies();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Set which strategy is active
  app.post("/api/strategies/activate", requireAuth, requireCsrf, async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Strategy id required" });
      const result = setActiveStrategy({ id });
      if (result.error) return res.status(404).json(result);
      log("dashboard", `Strategy activated via Web UI: ${id}`);
      res.json({ success: true, active: id, name: result.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/control/run-management", requireAuth, requireCsrf, (req, res) => {
    if (context.runManagementCycle) {
      log("dashboard", "Manual management cycle triggered via Web UI");
      context.runManagementCycle({ silent: false }).catch((e) => {
        log("dashboard_error", `Background management failed: ${e.message}`);
      });
      res.json({ success: true, message: "Management cycle started in background" });
    } else {
      res.status(400).json({ error: "Management handler not registered" });
    }
  });

  app.post("/api/control/toggle-cron", requireAuth, requireCsrf, (req, res) => {
    try {
      const { action } = req.body;
      if (context.toggleCron) {
        const result = context.toggleCron(action);
        res.json({ success: true, status: result });
      } else {
        res.status(400).json({ error: "Cron controller not registered" });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const renderIndexHtml = (req, res) => {
    try {
      const templatePath = path.join(REPO_ROOT, "public", "index.template.html");
      let html = fs.readFileSync(templatePath, "utf8");
      
      const components = ["sidebar", "dashboard", "positions", "decisions", "lessons", "config", "modals"];
      for (const comp of components) {
        const compPath = path.join(REPO_ROOT, "public", "components", `${comp}.html`);
        if (fs.existsSync(compPath)) {
          const compHtml = fs.readFileSync(compPath, "utf8");
          html = html.replace(`{{${comp}}}`, compHtml);
        }
      }
      res.send(html);
    } catch (e) {
      log("dashboard_error", `Failed to render index template: ${e.message}`);
      res.status(500).send("Error rendering dashboard: " + e.message);
    }
  };

  // Handle root and index.html routes dynamically with templating
  app.get(["/", "/index.html"], renderIndexHtml);

  // Serve static files from /public
  app.use(express.static(path.join(REPO_ROOT, "public")));

  // Fallback to SPA dynamic rendering for undefined HTML routes
  app.get("*", (req, res) => {
    if (path.extname(req.path)) {
      return res.status(404).end();
    }
    renderIndexHtml(req, res);
  });

  // Start Server
  app.listen(PORT, HOST, () => {
    log("dashboard", `Web UI server is online at http://${HOST}:${PORT}`);
  });
}
