// ════════════════ SMART LP CLIENT LOGIC (MULTI-WALLET) ════════════════

let smartLpState = {
  enabled: false,
  mode: "observe",
  active_copy_wallet: "",
  wallets: [],
  poll_interval_sec: 30,
  copy_settings: {},
  last_poll: null,
  active_target_positions: 0,
  target_positions: [],
  activities: [],
  insights: {},
  activity_wallet_filter: "all",
};

let smartLpPollInterval = null;

async function loadSmartLp() {
  await Promise.all([
    fetchSmartLpStatus(),
    fetchSmartLpInsights(),
    fetchSmartLpActivities(),
  ]);
  renderSmartLpUI();
}

async function fetchSmartLpStatus() {
  try {
    const res = await fetch("/api/smart-lp/status");
    if (!res.ok) return;
    const data = await res.json();
    smartLpState = { ...smartLpState, ...data };
  } catch (err) {
    console.error("Failed to fetch Smart LP status:", err);
  }
}

async function fetchSmartLpInsights() {
  try {
    const res = await fetch("/api/smart-lp/insights");
    if (!res.ok) return;
    const data = await res.json();
    smartLpState.insights = data.insights || {};
  } catch (err) {
    console.error("Failed to fetch Smart LP insights:", err);
  }
}

async function fetchSmartLpActivities() {
  try {
    const res = await fetch("/api/smart-lp/activities?per_wallet=50");
    if (!res.ok) return;
    const data = await res.json();
    smartLpState.activities = data.activities || [];
    const auditedCount = smartLpState.activities.filter((a) => a.type === "ENTRY" && a.filter_audit).length;
    safeText("smartlp-audit-count", auditedCount);
  } catch (err) {
    console.error("Failed to fetch Smart LP activities:", err);
  }
}

function renderSmartLpUI() {
  // 1. Hero / Header state
  const modeBadge = document.getElementById("smartlp-mode-badge");
  const beacon = document.getElementById("smartlp-status-beacon");
  const masterBtn = document.getElementById("btn-smartlp-master");
  const masterLabel = document.getElementById("smartlp-master-label");

  if (smartLpState.enabled) {
    if (modeBadge) {
      modeBadge.textContent = smartLpState.mode === "copy" ? "COPY ACTIVE" : "OBSERVE ACTIVE";
      modeBadge.style.color = smartLpState.mode === "copy" ? "#fb7185" : "var(--success)";
      modeBadge.style.borderColor = smartLpState.mode === "copy" ? "rgba(255,77,109,0.4)" : "rgba(16,217,160,0.4)";
      modeBadge.style.background = smartLpState.mode === "copy" ? "rgba(255,77,109,0.12)" : "rgba(16,217,160,0.12)";
    }
    if (beacon) {
      beacon.style.background = smartLpState.mode === "copy" ? "var(--danger)" : "var(--success)";
    }
    if (masterBtn) {
      masterBtn.className = "btn-danger btn-sm";
    }
    if (masterLabel) masterLabel.textContent = "Disable Smart LP";
  } else {
    if (modeBadge) {
      modeBadge.textContent = "STANDBY / OFF";
      modeBadge.style.color = "var(--text-muted)";
      modeBadge.style.borderColor = "var(--border-subtle)";
      modeBadge.style.background = "rgba(255,255,255,0.04)";
    }
    if (beacon) {
      beacon.style.background = "var(--text-muted)";
    }
    if (masterBtn) {
      masterBtn.className = "btn-primary btn-sm";
    }
    if (masterLabel) masterLabel.textContent = "Enable Smart LP";
  }

  // Sidebar & Mobile bottom-nav badge sync
  const sidebarBadge = document.getElementById("sidebar-smartlp-badge");
  const bnavBadge = document.getElementById("bnav-smartlp-badge");
  if (sidebarBadge) {
    if (smartLpState.enabled) {
      sidebarBadge.style.display = "inline-block";
      sidebarBadge.textContent = smartLpState.mode === "copy" ? "COPY" : "OBS";
      sidebarBadge.style.color = smartLpState.mode === "copy" ? "#ff6b8a" : "var(--success)";
      sidebarBadge.style.background = smartLpState.mode === "copy" ? "rgba(255,77,109,0.15)" : "rgba(16,217,160,0.15)";
    } else {
      sidebarBadge.style.display = "none";
    }
  }
  if (bnavBadge) {
    if (smartLpState.enabled) {
      bnavBadge.style.display = "block";
      bnavBadge.style.background = smartLpState.mode === "copy" ? "#ff6b8a" : "var(--success)";
      bnavBadge.style.boxShadow = smartLpState.mode === "copy" ? "0 0 6px rgba(255,77,109,0.8)" : "0 0 6px rgba(16,217,160,0.8)";
    } else {
      bnavBadge.style.display = "none";
    }
  }

  // 2. Metrics Cards
  const activeCopyWalletObj = (smartLpState.wallets || []).find((w) => w.address === smartLpState.active_copy_wallet);
  const activeCopyName = activeCopyWalletObj ? activeCopyWalletObj.name : (smartLpState.active_copy_wallet ? formatWalletTruncated(smartLpState.active_copy_wallet) : "None selected");

  const totalWallets = (smartLpState.wallets || []).length;
  const activeMonitoredCount = (smartLpState.wallets || []).filter((w) => w.enabled !== false).length;

  const copyPrio = smartLpState.copy_priority_status || {};
  let targetHeaderSub = `Active Copy: ${activeCopyName} (${activeMonitoredCount} active)`;
  if (smartLpState.mode === "copy" && copyPrio.copy_targets) {
    const activeTargets = copyPrio.copy_targets.filter((t) => t.copy_enabled && t.enabled);
    if (activeTargets.length > 1) {
      targetHeaderSub = `Priority Rotation: ${activeTargets.map((t) => `P${t.copy_priority}:${t.name}`).join(" → ")}`;
    }
  }
  safeText("smartlp-card-target-address", targetHeaderSub);
  safeText("smartlp-wallet-count-badge", `${totalWallets} Wallets`);

  // Observed Win Rate & PnL Overview
  const ins = smartLpState.insights || smartLpState.observed_performance || {};
  const winRate = ins.win_rate_pct != null ? Number(ins.win_rate_pct) : 0;
  const wins = ins.wins_count || 0;
  const losses = ins.losses_count || 0;
  const totalCompleted = ins.completed_trades_count || (wins + losses);
  const realizedPnl = Number(ins.total_realized_pnl_usd || 0);
  const unrealizedPnl = Number(ins.total_unrealized_pnl_usd || 0);
  const netPnl = Number(ins.total_net_pnl_usd != null ? ins.total_net_pnl_usd : (realizedPnl + unrealizedPnl));

  const wrEl = document.getElementById("smartlp-card-winrate-value");
  if (wrEl) {
    wrEl.textContent = totalCompleted > 0 ? `${winRate.toFixed(1)}%` : "--%";
    wrEl.style.color = winRate >= 50 ? "var(--success)" : "var(--danger)";
  }
  safeText("smartlp-card-winrate-sub", totalCompleted > 0 ? `${wins}W • ${losses}L (${totalCompleted} completed)` : "0 completed trades");

  const pnlEl = document.getElementById("smartlp-card-pnl-value");
  if (pnlEl) {
    pnlEl.textContent = `${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}`;
    pnlEl.style.color = netPnl >= 0 ? "var(--success)" : "var(--danger)";
  }
  safeText("smartlp-card-pnl-sub", `Realized: ${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)} | Live: ${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`);

  safeText("smartlp-card-mode-text", smartLpState.mode.toUpperCase());
  safeText("smartlp-card-mode-sub", smartLpState.mode === "copy" ? `Mirroring ${activeCopyName}` : `Observing all ${activeMonitoredCount} targets`);

  safeText("smartlp-card-events-count", smartLpState.total_activities || (smartLpState.activities?.length || 0));
  safeText("smartlp-card-events-sub", smartLpState.last_poll ? `Last poll: ${formatTimeAgo(smartLpState.last_poll)}` : "Last poll: Never");
  safeText("smartlp-last-polled-stamp", smartLpState.last_poll ? new Date(smartLpState.last_poll).toLocaleTimeString() : "--");

  // 3. Multi-Wallets List
  renderWalletsList();

  // 4. Poll Interval Form
  const pollInput = document.getElementById("smartlp-input-poll-interval");
  if (pollInput && document.activeElement !== pollInput) {
    pollInput.value = smartLpState.poll_interval_sec || 30;
  }

  // Copy Settings Form
  const cs = smartLpState.copy_settings || {};
  const maxSolInput = document.getElementById("smartlp-input-max-sol");
  if (maxSolInput && document.activeElement !== maxSolInput) maxSolInput.value = cs.max_sol_per_position ?? 0.3;

  const gasReserveInput = document.getElementById("smartlp-input-gas-reserve");
  if (gasReserveInput && document.activeElement !== gasReserveInput) gasReserveInput.value = cs.gas_reserve ?? 0.02;

  const maxPosInput = document.getElementById("smartlp-input-max-positions");
  if (maxPosInput && document.activeElement !== maxPosInput) maxPosInput.value = cs.max_active_positions ?? 1;

  const slippageInput = document.getElementById("smartlp-input-slippage");
  if (slippageInput && document.activeElement !== slippageInput) slippageInput.value = cs.slippage_bps ?? 100;

  const stopLossInput = document.getElementById("smartlp-input-stop-loss");
  if (stopLossInput && document.activeElement !== stopLossInput) stopLossInput.value = cs.auto_stop_loss_pct ?? 15;

  const takeProfitInput = document.getElementById("smartlp-input-take-profit");
  if (takeProfitInput && document.activeElement !== takeProfitInput) takeProfitInput.value = cs.auto_take_profit_pct ?? 4;

  const autoCloseBox = document.getElementById("smartlp-input-auto-close");
  if (autoCloseBox) autoCloseBox.checked = cs.auto_close_on_target_exit !== false;

  const fallbackMinutesInput = document.getElementById("smartlp-input-fallback-minutes");
  if (fallbackMinutesInput && document.activeElement !== fallbackMinutesInput) {
    fallbackMinutesInput.value = cs.priority_fallback_minutes ?? 15;
  }

  // 5. Mode Switch Buttons
  syncModeButtons();

  // 6. Intelligence / Strategy Insights
  renderInsightsUI();

  // 7. Tables & Feed
  renderTargetPositionsTable();
  renderActivityFeed();
}

function renderWalletsList() {
  const container = document.getElementById("smartlp-wallets-list-container");
  if (!container) return;

  const wallets = smartLpState.wallets || [];
  if (wallets.length === 0) {
    container.innerHTML = `
      <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px;background:rgba(255,255,255,0.01);border-radius:8px;">
        No target wallets added yet. Add your first wallet above.
      </div>
    `;
    return;
  }

  const ins = smartLpState.insights || smartLpState.observed_performance || {};
  const walletPerf = ins.wallet_performance || {};

  container.innerHTML = wallets.map((w) => {
    const isCopyEnabled = w.copy_enabled !== false && (w.copy_enabled || w.address === smartLpState.active_copy_wallet);
    const copyPriority = w.copy_priority != null ? w.copy_priority : (w.address === smartLpState.active_copy_wallet ? 0 : 99);
    const isEnabled = w.enabled !== false;
    const wp = walletPerf[w.address];
    const hasTrades = wp && wp.completed_trades > 0;

    const copyStrategy = w.copy_strategy || "auto";
    let stratBadgeBg = "rgba(16,217,160,0.12)";
    let stratColor = "var(--success)";
    let stratBorder = "rgba(16,217,160,0.3)";
    if (copyStrategy === "bid_ask") {
      stratBadgeBg = "rgba(245,158,11,0.15)";
      stratColor = "#fbbf24";
      stratBorder = "rgba(245,158,11,0.3)";
    } else if (copyStrategy === "curve") {
      stratBadgeBg = "rgba(236,72,153,0.15)";
      stratColor = "#f472b6";
      stratBorder = "rgba(236,72,153,0.3)";
    } else if (copyStrategy === "auto") {
      stratBadgeBg = "rgba(124,92,255,0.15)";
      stratColor = "var(--accent-light)";
      stratBorder = "rgba(124,92,255,0.3)";
    }

    let copyControl = "";
    if (isCopyEnabled) {
      let badgeBg = "rgba(16,217,160,0.15)";
      let badgeColor = "var(--success)";
      let badgeBorder = "rgba(16,217,160,0.3)";
      if (copyPriority === 1) {
        badgeBg = "rgba(56,189,248,0.15)";
        badgeColor = "var(--accent)";
        badgeBorder = "rgba(56,189,248,0.3)";
      } else if (copyPriority > 1) {
        badgeBg = "rgba(255,255,255,0.06)";
        badgeColor = "var(--text-secondary)";
        badgeBorder = "rgba(255,255,255,0.15)";
      }

      copyControl = `
        <div style="display:flex;align-items:center;gap:4px;">
          <select onchange="handleSetWalletPriority('${w.address}', true, this.value)" title="Copy Priority" style="background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};border-radius:6px;font-size:10px;font-weight:700;padding:2px 4px;height:24px;cursor:pointer;">
            <option value="0" ${copyPriority === 0 ? "selected" : ""}>Prio 0 (Utama)</option>
            <option value="1" ${copyPriority === 1 ? "selected" : ""}>Prio 1 (Cadangan 1)</option>
            <option value="2" ${copyPriority === 2 ? "selected" : ""}>Prio 2 (Cadangan 2)</option>
            <option value="3" ${copyPriority === 3 ? "selected" : ""}>Prio 3 (Cadangan 3)</option>
          </select>
          <select onchange="handleSetWalletStrategy('${w.address}', this.value)" title="Strategy: Spot / Bid-Ask (BA) / Curve / Auto" style="background:${stratBadgeBg};color:${stratColor};border:1px solid ${stratBorder};border-radius:6px;font-size:10px;font-weight:700;padding:2px 4px;height:24px;cursor:pointer;">
            <option value="auto" ${copyStrategy === "auto" ? "selected" : ""}>Auto</option>
            <option value="spot" ${copyStrategy === "spot" ? "selected" : ""}>Spot</option>
            <option value="bid_ask" ${copyStrategy === "bid_ask" ? "selected" : ""}>BA</option>
            <option value="curve" ${copyStrategy === "curve" ? "selected" : ""}>Curve</option>
          </select>
          <button type="button" onclick="handleSetWalletPriority('${w.address}', false, ${copyPriority})" class="btn-ghost btn-sm" style="color:var(--text-muted);padding:2px 5px;height:24px;font-size:11px;" title="Disable copy for this wallet">✕</button>
        </div>
      `;
    } else {
      copyControl = `
        <div style="display:flex;align-items:center;gap:4px;">
          <select onchange="handleSetWalletStrategy('${w.address}', this.value)" title="Strategy preference" style="background:${stratBadgeBg};color:${stratColor};border:1px solid ${stratBorder};border-radius:6px;font-size:10px;font-weight:700;padding:2px 4px;height:24px;cursor:pointer;">
            <option value="auto" ${copyStrategy === "auto" ? "selected" : ""}>Auto</option>
            <option value="spot" ${copyStrategy === "spot" ? "selected" : ""}>Spot</option>
            <option value="bid_ask" ${copyStrategy === "bid_ask" ? "selected" : ""}>BA</option>
            <option value="curve" ${copyStrategy === "curve" ? "selected" : ""}>Curve</option>
          </select>
          <button type="button" onclick="handleSetWalletPriority('${w.address}', true, 1)" class="btn-ghost btn-sm" style="font-size:10px;padding:2px 8px;border-radius:6px;height:24px;" title="Enable copy for this wallet">+ Copy</button>
        </div>
      `;
    }

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.03);border:1px solid ${isCopyEnabled ? 'rgba(124,92,255,0.3)' : 'rgba(255,255,255,0.05)'};border-radius:8px;padding:8px 12px;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
          <input type="checkbox" ${isEnabled ? "checked" : ""} onchange="handleToggleTargetWallet('${w.address}', this.checked)" title="Enable/Disable monitoring" style="accent-color:var(--accent);width:15px;height:15px;cursor:pointer;">
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:12px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${w.name}
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-top:2px;flex-wrap:wrap;">
              <span>${formatWalletTruncated(w.address)}</span>
              <span style="padding:1px 5px;border-radius:3px;background:${stratBadgeBg};color:${stratColor};font-weight:700;font-size:9px;border:1px solid ${stratBorder};" title="Copy strategy">
                ${copyStrategy.toUpperCase()}
              </span>
              <a href="https://solscan.io/account/${w.address}" target="_blank" rel="noopener" style="color:var(--accent-light);text-decoration:none;" title="View on Solscan">
                <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
              </a>
              ${hasTrades ? `
                <span style="padding:1px 5px;border-radius:3px;background:${wp.win_rate_pct >= 50 ? 'rgba(16,217,160,0.12)' : 'rgba(255,77,109,0.12)'};color:${wp.win_rate_pct >= 50 ? 'var(--success)' : 'var(--danger)'};font-weight:700;">
                  WR: ${wp.win_rate_pct}% (${wp.wins}W/${wp.losses}L)
                </span>
                <span style="padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.04);color:${wp.realized_pnl_usd >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:700;">
                  PnL: ${wp.realized_pnl_usd >= 0 ? '+' : ''}$${wp.realized_pnl_usd.toFixed(2)}
                </span>
              ` : `<span style="opacity:0.6;">(0 closed trades)</span>`}
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:6px;">
          ${copyControl}
          <button type="button" onclick="handleRemoveTargetWallet('${w.address}')" class="btn-ghost btn-sm" style="color:var(--danger);padding:4px 6px;height:24px;border:none;background:transparent;" title="Remove wallet">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

function syncModeButtons() {
  const btnObs = document.getElementById("btn-mode-observe");
  const btnCopy = document.getElementById("btn-mode-copy");
  const desc = document.getElementById("smartlp-mode-description");

  const activeCopyWalletObj = (smartLpState.wallets || []).find((w) => w.address === smartLpState.active_copy_wallet);
  const activeCopyName = activeCopyWalletObj ? activeCopyWalletObj.name : "None selected";

  if (btnObs && btnCopy) {
    if (smartLpState.mode === "observe") {
      btnObs.style.background = "var(--accent)";
      btnObs.style.color = "#fff";
      btnCopy.style.background = "transparent";
      btnCopy.style.color = "var(--text-secondary)";
      if (desc) {
        desc.innerHTML = `<strong>Observe Mode Active:</strong> Tracking and profiling <strong>all ${(smartLpState.wallets || []).filter(w => w.enabled !== false).length} enabled wallets</strong> simultaneously. Zero transactions in your wallet. Ideal for consensus research.`;
      }
    } else {
      btnCopy.style.background = "var(--danger)";
      btnCopy.style.color = "#fff";
      btnObs.style.background = "transparent";
      btnObs.style.color = "var(--text-secondary)";
      if (desc) {
        const copyWallets = (smartLpState.wallets || [])
          .filter((w) => w.enabled !== false && w.copy_enabled)
          .sort((a, b) => (a.copy_priority ?? 99) - (b.copy_priority ?? 99));

        if (copyWallets.length === 0) {
          desc.innerHTML = `<strong style="color:#ff6b8a;">Copy Mode Active:</strong> No wallets selected for copy rotation. Set priority on at least one wallet below.`;
        } else {
          const rotationStr = copyWallets
            .map((w) => `<span style="font-weight:700;color:${(w.copy_priority ?? 0) === 0 ? 'var(--success)' : 'var(--accent)'};">Prio ${w.copy_priority ?? 0}: ${w.name}</span>`)
            .join(" &rarr; ");
          const fallbackM = Number(smartLpState.copy_settings?.priority_fallback_minutes ?? 15);
          const isInstant = fallbackM === 0;
          const prioStatus = smartLpState.copy_priority_status || {};
          let timerNote = "";
          if (prioStatus.has_active_copy) {
            timerNote = `<span style="color:#38bdf8;font-weight:600;margin-left:6px;">[Trade Active &bull; Timer Paused]</span>`;
          } else if (isInstant) {
            if (prioStatus.is_p0_focus && prioStatus.timer_remaining_sec > 0) {
              const remM = Math.floor(prioStatus.timer_remaining_sec / 60);
              const remS = prioStatus.timer_remaining_sec % 60;
              timerNote = `<span style="color:#fbbf24;font-weight:600;margin-left:6px;">[Prio 0 Focus Timer: ${remM}m${remS}s remaining]</span>`;
            } else {
              timerNote = `<span style="color:#10b981;font-weight:600;margin-left:6px;">[Instant Waterfall Active &bull; Standby without delay]</span>`;
            }
          } else if (prioStatus.is_timer_running && prioStatus.timer_elapsed_sec != null) {
            const elM = Math.floor(prioStatus.timer_elapsed_sec / 60);
            const elS = prioStatus.timer_elapsed_sec % 60;
            const remM = Math.floor((prioStatus.timer_remaining_sec || 0) / 60);
            const remS = (prioStatus.timer_remaining_sec || 0) % 60;
            const curP = prioStatus.current_priority ?? 0;
            timerNote = `<span style="color:#fbbf24;font-weight:600;margin-left:6px;">[Prio ${curP} Idle Timer: ${elM}m${elS}s / ${fallbackM}m &bull; Fallback in ${remM}m${remS}s]</span>`;
          }

          if (isInstant) {
            desc.innerHTML = `<strong style="color:#ff6b8a;">Instant Waterfall:</strong> ${rotationStr} ${timerNote}. Prio 0 has top precedence with 15m focus timer upon copy trades. When Prio 0 is idle, fallbacks (Prio 1, 2, 3...) execute instantly without delay.`;
          } else {
            desc.innerHTML = `<strong style="color:#ff6b8a;">Priority Rotation:</strong> ${rotationStr} ${timerNote}. If active priority has no trade for ${fallbackM}m, bot falls back to next priority. P0 override is immediate when fresh trade appears.`;
          }
        }
      }
    }
  }
}

function renderInsightsUI() {
  const ins = smartLpState.insights || smartLpState.observed_performance || {};

  // 1. Observed Win Rate & PnL Analytics
  const winRate = ins.win_rate_pct != null ? Number(ins.win_rate_pct) : 0;
  const wins = ins.wins_count || 0;
  const losses = ins.losses_count || 0;
  const breakeven = ins.breakeven_count || 0;
  const completedCount = ins.completed_trades_count || (wins + losses + breakeven);
  const realizedPnl = Number(ins.total_realized_pnl_usd || 0);
  const unrealizedPnl = Number(ins.total_unrealized_pnl_usd || 0);
  const avgPnlPct = Number(ins.avg_pnl_pct || 0);

  safeText("insight-trades-badge", `${completedCount} ${completedCount === 1 ? "Trade" : "Trades"}`);
  safeText("insight-winrate-tag", completedCount > 0 ? `${winRate.toFixed(1)}% Win Rate` : "No exits yet");
  const wrTag = document.getElementById("insight-winrate-tag");
  if (wrTag) {
    wrTag.style.color = winRate >= 50 ? "var(--success)" : "var(--danger)";
  }

  safeText("insight-wl-ratio-text", `${wins}W • ${losses}L ${breakeven > 0 ? `(${breakeven} Breakeven)` : ""}`);
  const wrBar = document.getElementById("insight-winrate-bar");
  if (wrBar) {
    wrBar.style.width = completedCount > 0 ? `${Math.min(100, Math.max(0, winRate))}%` : "0%";
    wrBar.style.background = winRate >= 50
      ? "linear-gradient(90deg, #10d9a0, #34d399)"
      : "linear-gradient(90deg, #fb7185, #f43f5e)";
  }

  const rPnlEl = document.getElementById("insight-realized-pnl");
  if (rPnlEl) {
    rPnlEl.textContent = `${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}`;
    rPnlEl.style.color = realizedPnl >= 0 ? "var(--success)" : "var(--danger)";
  }

  const uPnlEl = document.getElementById("insight-unrealized-pnl");
  if (uPnlEl) {
    uPnlEl.textContent = `${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`;
    uPnlEl.style.color = unrealizedPnl > 0 ? "var(--success)" : (unrealizedPnl < 0 ? "var(--danger)" : "#fff");
  }

  const avgPnlEl = document.getElementById("insight-avg-pnl-pct");
  if (avgPnlEl) {
    avgPnlEl.textContent = `${avgPnlPct >= 0 ? "+" : ""}${avgPnlPct.toFixed(2)}%`;
    avgPnlEl.style.color = avgPnlPct >= 0 ? "var(--success)" : "var(--danger)";
  }

  if (ins.best_trade_pnl_pct != null) {
    safeText("insight-best-trade", `${ins.best_trade_pnl_pct >= 0 ? "+" : ""}${ins.best_trade_pnl_pct.toFixed(2)}%`);
  } else {
    safeText("insight-best-trade", "--");
  }

  if (ins.worst_trade_pnl_pct != null) {
    safeText("insight-worst-trade", `${ins.worst_trade_pnl_pct.toFixed(2)}%`);
  } else {
    safeText("insight-worst-trade", "--");
  }

  // 2. Strategy & Shape Extraction
  const strategies = ins.preferred_strategies || {};
  const topStrat = Object.keys(strategies).sort((a, b) => strategies[b] - strategies[a])[0] || "spot";

  const stratLabels = {
    spot: "Spot (Single-Sided SOL)",
    bid_ask: "Bid-Ask (Inverse Curve)",
    curve: "Curve (Concentrated)",
  };

  safeText("insight-strategy-name", stratLabels[topStrat] || "Spot (Single-Sided SOL)");
  safeText("smartlp-card-strategy-detected", stratLabels[topStrat] || "Spot (Single-Sided SOL)");

  const avgBelow = ins.average_bins_below || 69;
  const avgAbove = ins.average_bins_above || 0;
  safeText("insight-bins-below", avgBelow);
  safeText("insight-bins-above", avgAbove);
  safeText("smartlp-card-range-sub", `Bins: -${avgBelow} / +${avgAbove}`);

  // Bar ratio
  const totalBins = Math.max(1, avgBelow + avgAbove);
  const belowPct = Math.round((avgBelow / totalBins) * 100);
  const barBelow = document.getElementById("insight-bar-below");
  const barAbove = document.getElementById("insight-bar-above");
  if (barBelow && barAbove) {
    barBelow.style.width = `${belowPct}%`;
    barAbove.style.width = `${100 - belowPct}%`;
  }

  // Hold duration
  safeText("insight-hold-duration", ins.average_hold_minutes ? `${ins.average_hold_minutes} min` : "-- min");

  // Bin steps
  const steps = Object.keys(ins.preferred_bin_steps || {});
  safeText("insight-bin-steps", steps.length > 0 ? steps.join(", ") : "80, 100, 125");

  // Volume & TVL
  const minVol = ins.pool_volume_stats?.min;
  safeText("insight-volume-range", minVol ? `>$${minVol.toLocaleString()} / 24h` : ">$3,000 / 24h");

  const minTvl = ins.pool_tvl_stats?.min;
  const maxTvl = ins.pool_tvl_stats?.max;
  safeText("insight-tvl-range", (minTvl && maxTvl) ? `$${Math.round(minTvl / 1000)}k - $${Math.round(maxTvl / 1000)}k` : "$20K - $150K");
}

function renderTargetPositionsTable() {
  const tbody = document.getElementById("smartlp-live-positions-tbody");
  const countEl = document.getElementById("smartlp-live-pos-count");
  const positions = smartLpState.target_positions || [];

  if (countEl) countEl.textContent = positions.length;
  if (!tbody) return;

  if (positions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding:28px;text-align:center;color:var(--text-muted);">
          No active target positions detected across monitored wallets. Click "Poll Target Now" to fetch live positions.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = positions.map((p) => {
    const pnlColor = (p.pnl_pct || 0) >= 0 ? "var(--success)" : "var(--danger)";
    const inRangeTag = p.in_range
      ? `<span style="padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;background:rgba(16,217,160,0.12);color:var(--success);">IN RANGE</span>`
      : `<span style="padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;background:rgba(255,77,109,0.12);color:var(--danger);">OUT OF RANGE</span>`;

    let stratCell = `<span style="color:var(--text-muted);font-family:'JetBrains Mono';font-size:11px;">[${p.lower_bin ?? '?'} .. ${p.upper_bin ?? '?'}]</span>`;
    if (p.lower_bin != null && p.upper_bin != null) {
      const activeBin = p.active_bin ?? Math.round((p.lower_bin + p.upper_bin) / 2);
      const binsBelow = Math.max(0, activeBin - p.lower_bin);
      const binsAbove = Math.max(0, p.upper_bin - activeBin);
      const totalBins = binsBelow + binsAbove;

      let shape = "bid_ask";
      if (totalBins > 0) {
        if (binsAbove === 0 || (binsBelow / totalBins) >= 0.8) {
          shape = "bid_ask";
        } else {
          const ratio = binsBelow / Math.max(1, binsAbove);
          shape = (ratio >= 0.7 && ratio <= 1.4) ? "spot" : "curve";
        }
      }

      const shapeMeta = {
        bid_ask: { bg: "rgba(59,130,246,0.15)", text: "#60a5fa", border: "rgba(59,130,246,0.3)", label: "Bid-Ask" },
        spot: { bg: "rgba(16,217,160,0.15)", text: "var(--success)", border: "rgba(16,217,160,0.3)", label: "Spot" },
        curve: { bg: "rgba(167,139,250,0.15)", text: "var(--accent-light)", border: "rgba(167,139,250,0.3)", label: "Curve" },
      };
      const sm = shapeMeta[shape] || shapeMeta.bid_ask;

      stratCell = `
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:${sm.bg};color:${sm.text};border:1px solid ${sm.border};">${sm.label}</span>
            <span style="font-size:11px;font-family:'JetBrains Mono';color:#fff;font-weight:600;">-${binsBelow}/+${binsAbove}</span>
          </div>
          <span style="font-size:10px;font-family:'JetBrains Mono';color:var(--text-muted);">bins [${p.lower_bin}..${p.upper_bin}]</span>
        </div>
      `;
    }

    const poolName = p.pool_name || smartLpState.activities?.find((a) => a.pool?.address === p.pool)?.pool?.name || formatWalletTruncated(p.pool);
    const poolTrunc = formatWalletTruncated(p.pool);
    const posTrunc = formatWalletTruncated(p.position);
    const walletLabel = p.wallet_name || formatWalletTruncated(p.wallet_address || "");

    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s ease;">
        <td style="padding:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
            <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(124,92,255,0.15);color:var(--accent-light);white-space:nowrap;">
              ${escapeHtml(walletLabel)}
            </span>
            <span style="font-weight:700;color:#fff;font-size:13px;letter-spacing:0.01em;">${escapeHtml(poolName)}</span>
          </div>
          <div style="font-size:10px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;display:flex;align-items:center;gap:6px;">
            <span title="Pool Address: ${escapeHtml(p.pool)}">Pool: ${poolTrunc}</span>
            <span style="opacity:0.4;">•</span>
            <span title="Position Address: ${escapeHtml(p.position)}">Pos: ${posTrunc}</span>
          </div>
        </td>
        <td style="padding:12px;">
          ${stratCell}
        </td>
        <td style="padding:12px;">${inRangeTag}</td>
        <td style="padding:12px;font-family:'JetBrains Mono',monospace;font-weight:600;color:#fff;">
          $${(p.total_value_usd || 0).toFixed(2)}
        </td>
        <td style="padding:12px;font-family:'JetBrains Mono',monospace;font-weight:700;color:${pnlColor};">
          ${(p.pnl_pct || 0) >= 0 ? "+" : ""}${(p.pnl_pct || 0).toFixed(2)}%
        </td>
        <td style="padding:12px;color:var(--text-secondary);font-size:11px;">
          ${p.age_minutes != null ? `${p.age_minutes}m ago` : '--'}
        </td>
        <td style="padding:12px;text-align:right;">
          <a href="https://solscan.io/account/${p.position}" target="_blank" rel="noopener" class="btn-ghost btn-sm" style="text-decoration:none;display:inline-flex;padding:3px 8px;font-size:11px;">
            Solscan
          </a>
        </td>
      </tr>
    `;
  }).join("");
}

function handleFeedWalletFilterChange(walletAddress) {
  smartLpState.activity_wallet_filter = walletAddress || "all";
  renderActivityFeed();
}

function renderActivityFeed() {
  const container = document.getElementById("smartlp-activity-feed-container");
  const countEl = document.getElementById("smartlp-feed-count");
  const filterSelect = document.getElementById("smartlp-feed-wallet-filter");
  const quickPillsContainer = document.getElementById("smartlp-feed-wallet-quick-pills");
  const filterStatusEl = document.getElementById("smartlp-feed-filter-status");
  const resetBtn = document.getElementById("btn-smartlp-feed-reset-filter");
  const allActivities = smartLpState.activities || [];

  if (countEl) countEl.textContent = allActivities.length;
  if (!container) return;

  // Build wallet map of known wallets from smartLpState.wallets AND any wallet in activities
  const walletMap = new Map();
  (smartLpState.wallets || []).forEach((w) => {
    if (w.address) {
      walletMap.set(w.address, {
        address: w.address,
        name: w.name || formatWalletTruncated(w.address),
        count: 0,
      });
    }
  });

  allActivities.forEach((act) => {
    const addr = act.target_wallet;
    if (addr) {
      if (!walletMap.has(addr)) {
        walletMap.set(addr, {
          address: addr,
          name: act.target_name || formatWalletTruncated(addr),
          count: 0,
        });
      }
      walletMap.get(addr).count++;
    }
  });

  const selectedFilter = smartLpState.activity_wallet_filter || "all";

  // Update select dropdown options
  if (filterSelect) {
    const optionsHtml = [
      `<option value="all"${selectedFilter === "all" ? " selected" : ""}>Semua Wallet (${allActivities.length}) — maks 50/wallet</option>`,
      ...Array.from(walletMap.values()).map(
        (w) =>
          `<option value="${escapeHtml(w.address)}"${w.address === selectedFilter ? " selected" : ""}>${escapeHtml(w.name)} (${formatWalletTruncated(w.address)}) — ${w.count} events</option>`
      ),
    ].join("");

    filterSelect.innerHTML = optionsHtml;
    filterSelect.value = selectedFilter;
  }

  // Update quick pills if wallets exist
  if (quickPillsContainer) {
    const walletsArr = Array.from(walletMap.values());
    if (walletsArr.length > 0 && walletsArr.length <= 6) {
      const isAllActive = selectedFilter === "all";
      let pillsHtml = `
        <button type="button" onclick="handleFeedWalletFilterChange('all')" class="btn-ghost btn-xs" style="padding:2px 8px;font-size:11px;border-radius:12px;${isAllActive ? 'background:rgba(124,92,255,0.25);color:var(--accent-light);border:1px solid rgba(124,92,255,0.4);font-weight:600;' : 'color:var(--text-secondary);'}">
          All (${allActivities.length})
        </button>
      `;

      pillsHtml += walletsArr
        .map((w) => {
          const isActive = selectedFilter === w.address;
          return `
            <button type="button" onclick="handleFeedWalletFilterChange('${escapeHtml(w.address)}')" class="btn-ghost btn-xs" style="padding:2px 8px;font-size:11px;border-radius:12px;${isActive ? 'background:rgba(124,92,255,0.25);color:var(--accent-light);border:1px solid rgba(124,92,255,0.4);font-weight:600;' : 'color:var(--text-secondary);'}" title="${escapeHtml(w.address)}">
              ${escapeHtml(w.name)} (${w.count})
            </button>
          `;
        })
        .join("");

      quickPillsContainer.innerHTML = pillsHtml;
      quickPillsContainer.style.display = "flex";
    } else {
      quickPillsContainer.innerHTML = "";
      quickPillsContainer.style.display = "none";
    }
  }

  // Filter activities
  const filteredActivities =
    selectedFilter === "all"
      ? allActivities
      : allActivities.filter(
          (act) =>
            act.target_wallet === selectedFilter ||
            act.target_name?.toLowerCase() === selectedFilter.toLowerCase()
        );

  // Status & Reset button
  if (filterStatusEl) {
    if (selectedFilter === "all") {
      filterStatusEl.textContent = `Menampilkan semua: ${allActivities.length} event (maks. 50 per wallet)`;
    } else {
      const activeObj = walletMap.get(selectedFilter);
      const label = activeObj ? activeObj.name : formatWalletTruncated(selectedFilter);
      filterStatusEl.innerHTML = `Filter: <strong style="color:var(--accent-light);">${escapeHtml(label)}</strong> (${filteredActivities.length} event)`;
    }
  }

  if (resetBtn) {
    resetBtn.style.display = selectedFilter === "all" ? "none" : "inline-flex";
  }

  if (filteredActivities.length === 0) {
    if (allActivities.length === 0) {
      container.innerHTML = `
        <div style="padding:28px;text-align:center;color:var(--text-muted);">
          No activity recorded yet across monitored wallets.
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="padding:32px 16px;text-align:center;background:rgba(255,255,255,0.01);border:1px dashed var(--border-subtle);border-radius:8px;">
          <div style="color:var(--text-secondary);font-size:13px;margin-bottom:8px;">
            Tidak ada aktivitas yang tercatat untuk wallet ini.
          </div>
          <button type="button" onclick="handleFeedWalletFilterChange('all')" class="btn-ghost btn-xs" style="color:var(--accent-light);text-decoration:underline;cursor:pointer;">
            Tampilkan semua wallet (${allActivities.length})
          </button>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = filteredActivities.map((act) => {
    const isEntry = act.type === "ENTRY";
    const badgeColor = isEntry ? "var(--success)" : "var(--accent)";
    const badgeBg = isEntry ? "rgba(16,217,160,0.12)" : "rgba(124,92,255,0.12)";
    const typeLabel = isEntry ? "ENTRY / DEPLOY" : "EXIT / CLOSE";

    let copyStatusBadge = "";
    if (act.user_action?.copied) {
      copyStatusBadge = `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(16,217,160,0.15);color:var(--success);border:1px solid rgba(16,217,160,0.3);">COPIED</span>`;
    } else if (act.user_action?.closed_copy) {
      const noteTitle = act.user_action?.resolved_note ? ` title="${escapeHtml(act.user_action.resolved_note)}"` : "";
      copyStatusBadge = `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(56,189,248,0.15);color:var(--accent);border:1px solid rgba(56,189,248,0.3);"${noteTitle}>CLOSED COPY</span>`;
    } else if (act.user_action?.error) {
      copyStatusBadge = `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(255,77,109,0.15);color:var(--danger);border:1px solid rgba(255,77,109,0.3);" title="${escapeHtml(act.user_action.error)}">COPY FAILED</span>`;
    } else {
      copyStatusBadge = `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,0.05);color:var(--text-muted);">OBSERVED</span>`;
    }

    let filterAuditBadge = "";
    if (isEntry && act.filter_audit) {
      const fa = act.filter_audit;
      if (fa.passed_all) {
        filterAuditBadge = `<button type="button" onclick="showSmartLpFilterModal('${escapeHtml(act.id)}')" title="Lolos semua ${fa.passed_count} kriteria screening. Klik untuk detail breakdown." style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(16,217,160,0.15);color:var(--success);border:1px solid rgba(16,217,160,0.3);display:inline-flex;align-items:center;gap:4px;">
          ✓ FILTER PASS (${fa.score})
        </button>`;
      } else {
        const failReasonsTip = (fa.failed_reasons || []).join(", ");
        filterAuditBadge = `<button type="button" onclick="showSmartLpFilterModal('${escapeHtml(act.id)}')" title="Gagal: ${escapeHtml(failReasonsTip)}. Klik untuk detail breakdown." style="border:none;cursor:pointer;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(255,170,0,0.15);color:#ffaa00;border:1px solid rgba(255,170,0,0.3);display:inline-flex;align-items:center;gap:4px;">
          ⚠ FILTER FAIL (${fa.score})
        </button>`;
      }
    }

    const timeAgo = formatTimeAgo(act.timestamp);
    const targetDisplay = act.target_name || formatWalletTruncated(act.target_wallet || "");

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.02);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 16px;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;background:${badgeBg};color:${badgeColor};letter-spacing:0.04em;">
            ${typeLabel}
          </span>
          <div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span onclick="handleFeedWalletFilterChange('${escapeHtml(act.target_wallet || '')}')" title="Filter hanya wallet ini" style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(124,92,255,0.2);color:var(--accent-light);cursor:pointer;display:inline-flex;align-items:center;gap:4px;" onmouseover="this.style.background='rgba(124,92,255,0.35)'" onmouseout="this.style.background='rgba(124,92,255,0.2)'">
                ${escapeHtml(targetDisplay)}
                <svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
              </span>
              <span style="font-weight:600;color:#fff;font-size:13px;">${escapeHtml(act.pool?.name || "Pool")}</span>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
              ${isEntry
                ? `Strategy: <strong>${escapeHtml(act.strategy_detected || "bid_ask")}</strong> | Bins: -${act.range?.bins_below || 0}/+${act.range?.bins_above || 0} | Step: ${act.pool?.bin_step || "--"}`
                : (() => {
                    const isAnomaly = act.target_final_pnl_pct == null || act.target_final_pnl_pct <= -99.9;
                    const targetDisplay = isAnomaly
                      ? `<span style="color:var(--text-secondary);font-weight:600;" title="Target withdraw / pool exit">Withdrawn</span>`
                      : `<span style="color:${act.target_final_pnl_pct >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:700;">${act.target_final_pnl_pct >= 0 ? '+' : ''}${act.target_final_pnl_pct.toFixed(2)}%</span>`;

                    let userDisplay = "";
                    if (act.user_action?.user_pnl_pct != null) {
                      const uPct = Number(act.user_action.user_pnl_pct);
                      const uUsd = Number(act.user_action.user_pnl_usd);
                      const uCol = uPct >= 0 ? "var(--success)" : "var(--danger)";
                      userDisplay = ` | <strong style="color:var(--accent-light);">User Copy PnL:</strong> <span style="color:${uCol};font-weight:700;">${uPct >= 0 ? '+' : ''}${uPct.toFixed(2)}% (${uUsd >= 0 ? '+$' : '-$'}${Math.abs(uUsd || 0).toFixed(2)})</span>`;
                    }
                    return `Hold: <strong>${act.hold_duration_minutes || "?"}m</strong> | Target PnL: ${targetDisplay}${userDisplay}`;
                  })()
              }
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          ${filterAuditBadge}
          ${copyStatusBadge}
          <span style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">${timeAgo}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ─── Actions & Event Handlers ─────────────────────────────────────

async function handleAddTargetWallet(e) {
  e.preventDefault();
  const addressInput = document.getElementById("smartlp-input-address");
  const nameInput = document.getElementById("smartlp-input-name");
  const stratInput = document.getElementById("smartlp-input-strategy");
  const address = addressInput.value.trim();
  const name = nameInput.value.trim();
  const copy_strategy = stratInput ? stratInput.value : "auto";

  try {
    const res = await fetch("/api/smart-lp/wallet/add", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ address, name, copy_strategy }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed adding wallet");
    }
    showToast(`Added target wallet: ${data.wallet.name}`);
    addressInput.value = "";
    nameInput.value = "";
    loadSmartLp();
  } catch (err) {
    showToast("Error adding wallet: " + err.message);
  }
}

async function handleRemoveTargetWallet(address) {
  if (!confirm("Are you sure you want to stop tracking this wallet?")) return;
  try {
    const res = await fetch("/api/smart-lp/wallet/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ address }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed removing wallet");
    }
    showToast(`Removed wallet: ${data.removed}`);
    loadSmartLp();
  } catch (err) {
    showToast("Error removing wallet: " + err.message);
  }
}

async function handleSelectCopyWallet(address) {
  try {
    const res = await fetch("/api/smart-lp/wallet/select-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ address }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed selecting copy wallet");
    }
    showToast(`Selected copy target: ${data.name}`);
    loadSmartLp();
  } catch (err) {
    showToast("Error setting copy target: " + err.message);
  }
}

async function handleToggleTargetWallet(address, enabled) {
  try {
    const res = await fetch("/api/smart-lp/wallet/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ address, enabled }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed updating wallet state");
    }
    loadSmartLp();
  } catch (err) {
    showToast("Error toggling wallet: " + err.message);
  }
}

async function handleSavePollInterval() {
  const poll_interval_sec = Number(document.getElementById("smartlp-input-poll-interval").value) || 30;
  try {
    await fetch("/api/smart-lp/config", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ poll_interval_sec }),
    });
    showToast("Poll interval updated");
  } catch (err) {
    console.error("Failed saving interval:", err);
  }
}

async function toggleSmartLpMaster() {
  const newEnabled = !smartLpState.enabled;
  try {
    const res = await fetch("/api/smart-lp/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    if (!res.ok) throw new Error("Server error");
    const data = await res.json();
    smartLpState.enabled = data.enabled;
    showToast(data.enabled ? "Smart LP Engine Activated" : "Smart LP Engine Paused");
    loadSmartLp();
  } catch (err) {
    showToast("Error toggling Smart LP: " + err.message);
  }
}

async function setSmartLpMode(mode) {
  if (!["observe", "copy"].includes(mode)) return;
  try {
    const res = await fetch("/api/smart-lp/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) throw new Error("Server error");
    const data = await res.json();
    smartLpState.mode = data.mode;
    showToast(`Smart LP Mode changed to: ${mode.toUpperCase()}`);
    renderSmartLpUI();
  } catch (err) {
    showToast("Error updating mode: " + err.message);
  }
}

async function handleSaveCopySettings(e) {
  e.preventDefault();
  const max_sol_per_position = Number(document.getElementById("smartlp-input-max-sol").value) || 0.3;
  const gas_reserve = Number(document.getElementById("smartlp-input-gas-reserve")?.value) ?? 0.02;
  const max_active_positions = Number(document.getElementById("smartlp-input-max-positions").value) || 1;
  const slippage_bps = Number(document.getElementById("smartlp-input-slippage").value) || 100;
  const auto_stop_loss_pct = Number(document.getElementById("smartlp-input-stop-loss").value) || 15;
  const auto_take_profit_pct = Number(document.getElementById("smartlp-input-take-profit")?.value) || 4;
  const auto_close_on_target_exit = document.getElementById("smartlp-input-auto-close").checked;
  const priority_fallback_minutes = Number(document.getElementById("smartlp-input-fallback-minutes")?.value ?? 15);

  try {
    const res = await fetch("/api/smart-lp/config", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({
        copy_settings: {
          max_sol_per_position,
          gas_reserve,
          max_active_positions,
          slippage_bps,
          auto_stop_loss_pct,
          auto_take_profit_pct,
          auto_close_on_target_exit,
          priority_fallback_minutes,
        },
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed saving copy settings");
    }
    showToast("Copy trade execution settings updated!");
    loadSmartLp();
  } catch (err) {
    showToast("Failed updating settings: " + err.message);
  }
}

window.handleSetWalletPriority = async function (address, copy_enabled, priority) {
  try {
    const res = await fetch("/api/smart-lp/wallet/priority", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ address, copy_enabled, copy_priority: parseInt(priority, 10) || 0 }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Failed updating priority");
    showToast(`Wallet copy priority updated!`);
    loadSmartLp();
  } catch (err) {
    showToast("Failed updating priority: " + err.message);
  }
};

window.handleSetWalletStrategy = async function (address, copy_strategy) {
  try {
    const res = await fetch("/api/smart-lp/wallet/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ address, copy_strategy }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Failed updating strategy");
    showToast(`Strategy updated to ${copy_strategy.toUpperCase()}!`);
    loadSmartLp();
  } catch (err) {
    showToast("Failed updating strategy: " + err.message);
  }
};

async function triggerSmartLpPoll() {
  const btn = document.getElementById("btn-smartlp-poll");
  const label = document.getElementById("smartlp-poll-label");
  if (label) label.textContent = "Polling...";
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/smart-lp/poll-now", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.reason || "Poll failed");
    }
    showToast(`Poll complete: ${data.polled_wallets_count || 1} wallets, ${data.active_positions_count} positions`);
    loadSmartLp();
  } catch (err) {
    showToast("Polling failed: " + err.message);
  } finally {
    if (label) label.textContent = "Poll Target Now";
    if (btn) btn.disabled = false;
  }
}

async function applyInsightsToBot() {
  const btn = document.getElementById("btn-apply-insights");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/smart-lp/apply-to-bot", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to synchronize");
    }

    const changedKeys = Object.keys(data.changes || {});
    if (changedKeys.length === 0) {
      showToast("Meridian bot is already fully optimized to target filters!");
    } else {
      showToast(`Applied ${changedKeys.length} target filters to Meridian bot!`);
    }
    loadSmartLp();
  } catch (err) {
    showToast("Sync error: " + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function switchSmartLpSubTab(tab) {
  const btnActive = document.getElementById("tab-smartlp-sub-active");
  const btnFeed = document.getElementById("tab-smartlp-sub-feed");
  const btnAudit = document.getElementById("tab-smartlp-sub-filter-audit");
  const viewActive = document.getElementById("smartlp-subview-active");
  const viewFeed = document.getElementById("smartlp-subview-feed");
  const viewAudit = document.getElementById("smartlp-subview-filter-audit");

  const resetBtn = (btn) => {
    if (btn) {
      btn.style.background = "transparent";
      btn.style.color = "var(--text-secondary)";
      btn.style.fontWeight = "normal";
    }
  };
  const setBtnActive = (btn) => {
    if (btn) {
      btn.style.background = "rgba(255,255,255,0.08)";
      btn.style.color = "#fff";
      btn.style.fontWeight = "600";
    }
  };

  resetBtn(btnActive);
  resetBtn(btnFeed);
  resetBtn(btnAudit);

  if (viewActive) viewActive.style.display = "none";
  if (viewFeed) viewFeed.style.display = "none";
  if (viewAudit) viewAudit.style.display = "none";

  if (tab === "active") {
    setBtnActive(btnActive);
    if (viewActive) viewActive.style.display = "block";
  } else if (tab === "feed") {
    setBtnActive(btnFeed);
    if (viewFeed) viewFeed.style.display = "block";
  } else if (tab === "filter-audit") {
    setBtnActive(btnAudit);
    if (viewAudit) viewAudit.style.display = "block";
    fetchAndRenderFilterAdvisor();
  }
}

function formatWalletTruncated(address) {
  if (!address) return "--";
  if (address.length <= 10) return address;
  return address.slice(0, 4) + "..." + address.slice(-4);
}

function formatTimeAgo(isoString) {
  if (!isoString) return "--";
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Filter Advisor & Tuning Advisor Subview ──────────────────────

let _advisorAuditsCache = [];

async function fetchAndRenderFilterAdvisor() {
  const recsTbody = document.getElementById("smartlp-advisor-recs-tbody");
  const auditsTbody = document.getElementById("smartlp-audits-list-tbody");

  try {
    const res = await fetch("/api/smart-lp/filter-audits?limit=100");
    if (!res.ok) throw new Error("Gagal mengambil data filter audit");
    const data = await res.json();

    const adv = data.filter_advisor || {};
    _advisorAuditsCache = data.audits || [];

    // Header KPIs
    safeText("smartlp-audit-count", adv.total_audited || 0);
    safeText("smartlp-advisor-total-entries", adv.total_audited || 0);
    safeText("smartlp-advisor-pass-rate", (adv.pass_rate_pct != null ? adv.pass_rate_pct : 0) + "%");
    safeText("smartlp-advisor-pass-count", `${adv.passed_all_count || 0} lolos dari ${adv.total_audited || 0} entry`);

    // Top blocker
    const failFreqs = Object.values(adv.filter_fail_frequencies || {}).sort((a, b) => (b.count || 0) - (a.count || 0));
    if (failFreqs.length > 0) {
      const top = failFreqs[0];
      safeText("smartlp-advisor-top-blocker", `${top.name} (${top.fail_rate_pct}%)`);
      safeText("smartlp-advisor-top-blocker-sub", `Memblokir ${top.count} dari ${adv.total_audited} transaksi`);
    } else {
      safeText("smartlp-advisor-top-blocker", "None");
      safeText("smartlp-advisor-top-blocker-sub", "Semua filter lolos sempurna");
    }

    // Recommendation Table
    const recs = adv.recommendations || [];
    if (recsTbody) {
      if (recs.length === 0) {
        recsTbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding:24px;text-align:center;color:var(--success);font-weight:600;">
              ✓ Filter Anda saat ini sudah sangat selaras dengan kebiasaan transaksi target whale! Tidak ada penyesuaian mendesak.
            </td>
          </tr>
        `;
      } else {
        recsTbody.innerHTML = recs.map((r) => {
          const isHighFail = r.fail_rate_pct > 30;
          const failColor = isHighFail ? "var(--danger)" : "#ffaa00";
          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:12px;font-weight:700;color:#fff;">
                ${escapeHtml(r.label)}
                <div style="font-size:10px;font-family:'JetBrains Mono';color:var(--text-muted);font-weight:normal;">${escapeHtml(r.key)}</div>
              </td>
              <td style="padding:12px;">
                <span style="font-family:'JetBrains Mono';font-size:12px;font-weight:700;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,0.06);color:#fff;">
                  ${escapeHtml(r.current_display)}
                </span>
              </td>
              <td style="padding:12px;font-size:11px;color:var(--text-secondary);font-family:'JetBrains Mono';">
                ${escapeHtml(r.whale_reality)}
              </td>
              <td style="padding:12px;">
                <span style="font-size:11px;font-weight:700;color:${failColor};background:rgba(255,77,109,0.1);padding:3px 8px;border-radius:6px;border:1px solid rgba(255,77,109,0.2);">
                  ${r.fail_rate_pct}% (${r.fail_count}x gagal)
                </span>
              </td>
              <td style="padding:12px;">
                <span style="font-family:'JetBrains Mono';font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(16,217,160,0.15);color:var(--success);border:1px solid rgba(16,217,160,0.3);">
                  ${escapeHtml(r.suggested_display)}
                </span>
              </td>
              <td style="padding:12px;font-size:11px;color:var(--text-secondary);line-height:1.4;">
                ${escapeHtml(r.reason)}
              </td>
            </tr>
          `;
        }).join("");
      }
    }

    // Audits List Table
    if (auditsTbody) {
      if (_advisorAuditsCache.length === 0) {
        auditsTbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding:24px;text-align:center;color:var(--text-muted);">
              Belum ada riwayat audit. Klik tombol "Audit Ulang" untuk memeriksa transaksi masa lalu.
            </td>
          </tr>
        `;
      } else {
        auditsTbody.innerHTML = _advisorAuditsCache.map((a) => {
          const fa = a.filter_audit || {};
          const isPass = fa.passed_all;
          const statusBadge = isPass
            ? `<span style="color:var(--success);background:rgba(16,217,160,0.12);padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;border:1px solid rgba(16,217,160,0.3);">✓ LOLOS (${fa.score || '11/11'})</span>`
            : `<span style="color:#ffaa00;background:rgba(255,170,0,0.12);padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;border:1px solid rgba(255,170,0,0.3);">✗ GAGAL (${fa.score || '--'})</span>`;

          const failedNames = (fa.checks || [])
            .filter((c) => !c.passed)
            .map((c) => `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(255,77,109,0.15);color:var(--danger);">${escapeHtml(c.name)}</span>`)
            .join(" ");

          return `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:10px 12px;font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono';">
                ${formatTimeAgo(a.timestamp)}
              </td>
              <td style="padding:10px 12px;font-weight:600;color:var(--accent-light);">
                ${escapeHtml(a.target_name || formatWalletTruncated(a.target_wallet))}
              </td>
              <td style="padding:10px 12px;">
                <strong style="color:#fff;font-size:13px;">${escapeHtml(a.pool_name)}</strong>
              </td>
              <td style="padding:10px 12px;">
                ${statusBadge}
              </td>
              <td style="padding:10px 12px;display:flex;gap:4px;flex-wrap:wrap;">
                ${failedNames || '<span style="color:var(--success);font-size:11px;">Semua kriteria lolos</span>'}
              </td>
              <td style="padding:10px 12px;text-align:right;">
                <button type="button" onclick="showSmartLpFilterModal('${escapeHtml(a.activity_id)}')" class="btn-ghost btn-xs" style="padding:3px 8px;border-radius:5px;border:1px solid var(--border-subtle);color:var(--text-secondary);" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='var(--text-secondary)'">
                  Detail Cek
                </button>
              </td>
            </tr>
          `;
        }).join("");
      }
    }
  } catch (err) {
    console.error("fetchAndRenderFilterAdvisor error:", err);
    if (recsTbody) recsTbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// ─── Modal Popup for Detailed Filter Checks ──────────────────────

function showSmartLpFilterModal(activityId) {
  let act = (smartLpState.activities || []).find((a) => a.id === activityId);
  if (!act) {
    const cached = _advisorAuditsCache.find((a) => a.activity_id === activityId);
    if (cached) {
      act = {
        id: cached.activity_id,
        timestamp: cached.timestamp,
        target_name: cached.target_name,
        target_wallet: cached.target_wallet,
        pool: { name: cached.pool_name, address: cached.pool_address },
        filter_audit: cached.filter_audit,
      };
    }
  }

  if (!act || !act.filter_audit) {
    showToast("Data filter audit tidak ditemukan untuk transaksi ini", "error");
    return;
  }

  const fa = act.filter_audit;
  const modal = document.getElementById("filter-check-modal");
  const modalBody = document.getElementById("filter-check-modal-body");
  const modalSubtitle = document.getElementById("filter-check-modal-subtitle");

  if (!modal || !modalBody) return;

  if (modalSubtitle) {
    modalSubtitle.innerHTML = `Pool: <strong>${escapeHtml(fa.pool_name)}</strong> • Target: <strong>${escapeHtml(act.target_name || formatWalletTruncated(act.target_wallet))}</strong> • ${formatTimeAgo(act.timestamp)}`;
  }

  const statusBadge = fa.passed_all
    ? '<span style="color:#10d9a0;background:rgba(16,217,160,0.12);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:bold;margin-left:8px;border:1px solid rgba(16,217,160,0.2)">✓ LOLOS SEMUA FILTER</span>'
    : `<span style="color:#ffaa00;background:rgba(255,170,0,0.12);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:bold;margin-left:8px;border:1px solid rgba(255,170,0,0.2)">✗ GAGAL (${fa.score} LOLOS)</span>`;

  let reasonsHtml = "";
  if (!fa.passed_all && fa.failed_reasons?.length > 0) {
    reasonsHtml = `
      <div style="background:rgba(255,77,109,0.08);border:1px solid rgba(255,77,109,0.25);border-radius:8px;padding:12px 14px;margin-bottom:14px;">
        <div style="font-size:12px;font-weight:700;color:var(--danger);margin-bottom:4px;">⚠️ Penyebab Tidak Lolos Screening:</div>
        <ul style="margin:0;padding-left:18px;font-size:12px;color:#fff;">
          ${fa.failed_reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
        </ul>
      </div>
    `;
  }

  const tableRows = (fa.checks || []).map((c) => {
    const isPass = c.passed;
    const mark = isPass
      ? '<span style="color:var(--success);font-weight:700;">✓ LOLOS</span>'
      : '<span style="color:var(--danger);font-weight:700;">✗ GAGAL</span>';
    return `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px;font-weight:600;color:#fff;">${escapeHtml(c.name)}</td>
        <td style="padding:8px;font-family:'JetBrains Mono';font-size:11px;color:${isPass ? '#fff' : 'var(--danger)'};">${escapeHtml(String(c.value))}</td>
        <td style="padding:8px;font-family:'JetBrains Mono';font-size:11px;color:var(--text-muted);">${escapeHtml(String(c.threshold))}</td>
        <td style="padding:8px;text-align:right;">${mark}</td>
      </tr>
    `;
  }).join("");

  modalBody.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
      <div>
        <strong style="color:#fff;font-size:16px;">🏊 ${escapeHtml(fa.pool_name)}</strong>
        <div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono';margin-top:2px;">Pool: ${escapeHtml(fa.pool_address)}</div>
      </div>
      <div>
        ${statusBadge}
      </div>
    </div>

    ${reasonsHtml}

    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);text-align:left;">
          <th style="padding:8px;font-weight:600;">Kriteria / Filter</th>
          <th style="padding:8px;font-weight:600;">Value Token Whale</th>
          <th style="padding:8px;font-weight:600;">Syarat Filter di Config</th>
          <th style="padding:8px;font-weight:600;text-align:right;">Status</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;

  modal.showModal();
}

// ─── Actions: Backfill & Apply Suggested Filters ──────────────────

async function handleBackfillFilterAudits() {
  const btn = document.getElementById("btn-backfill-filters");
  if (btn) btn.disabled = true;
  showToast("Sedang memeriksa & mengaudit seluruh riwayat transaksi whale...", "info");

  try {
    const res = await fetch("/api/smart-lp/filter-audits/backfill", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": getCsrfToken(),
      },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Gagal melakukan backfill");
    }

    showToast(`Audit selesai! Memperbarui ${data.updated_entries} transaksi dari ${data.unique_pools_audited} pool.`, "success");
    await fetchSmartLpActivities();
    await fetchAndRenderFilterAdvisor();
  } catch (err) {
    showToast("Backfill gagal: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleApplySuggestedFilters() {
  if (!confirm("⚠️ Terapkan Rekomendasi Setting Filter ke user-config.json?\n\nNilai filter screening bot Meridian (TVL, Mcap, Fee Ratio, Usia Token, Volume) akan disesuaikan secara cerdas agar mampu menjaring transaksi target alpha wallet.\n\nLanjutkan?")) {
    return;
  }

  const btn = document.getElementById("btn-apply-suggested-filters");
  if (btn) btn.disabled = true;

  try {
    const res = await fetch("/api/smart-lp/apply-suggested-filters", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": getCsrfToken(),
      },
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Gagal menerapkan rekomendasi filter");
    }

    const changedCount = Object.keys(data.applied_changes || {}).length;
    showToast(`Berhasil menerapkan ${changedCount} parameter filter ke user-config.json!`, "success");
    await fetchAndRenderFilterAdvisor();
  } catch (err) {
    showToast("Gagal menerapkan filter: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}
