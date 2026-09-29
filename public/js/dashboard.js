// Load status
    async function loadStatus() {
      try {
        const res = await fetch("/api/status");
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        dashboardState.status = data;

        const solValue = Number(data.wallet.sol).toFixed(3);
        const usdValue = `$${Number(data.wallet.sol_usd).toFixed(2)}`;

        safeText("metric-wallet-sol", `${solValue} SOL`);
        safeText("metric-wallet-usd", `${usdValue} USD — SOL @ $${data.wallet.sol_price}`);
        safeText("sidebar-wallet-sol", solValue);
        safeText("sidebar-wallet-usd", `${usdValue} USD`);

        // Cron status
        const cronBadge = document.getElementById("cron-status-badge");
        const btnToggleCron = document.getElementById("btn-toggle-cron");
        if (data.cronStarted) {
          cronBadge.textContent = "ON";
          cronBadge.style.cssText = "font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(16,217,160,0.12);color:var(--success);border:1px solid rgba(16,217,160,0.25);";
          btnToggleCron.innerHTML = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Pause Agent`;
          btnToggleCron.className = "btn-danger btn-sm";
        } else {
          cronBadge.textContent = "OFF";
          cronBadge.style.cssText = "font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(245,166,35,0.1);color:var(--warning);border:1px solid rgba(245,166,35,0.25);";
          btnToggleCron.innerHTML = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Resume Agent`;
          btnToggleCron.className = "btn-ghost btn-sm";
          btnToggleCron.style.color = "var(--success)";
          btnToggleCron.style.borderColor = "rgba(16,217,160,0.3)";
        }

        // Countdown
        const nextMgmt   = data.timers?.managementLastRun  ? Math.max(0, Math.ceil(data.timers.managementIntervalMin || 10) - (Date.now() - data.timers.managementLastRun) / 60000) : null;
        const nextScreen = data.timers?.screeningLastRun   ? Math.max(0, Math.ceil(data.timers.screeningIntervalMin || 30) - (Date.now() - data.timers.screeningLastRun) / 60000)  : null;
        let countdownStr = "Autonomous cycles: ";
        if (nextMgmt !== null)   countdownStr += `manage in ${nextMgmt.toFixed(1)}m`;
        if (nextMgmt !== null && nextScreen !== null) countdownStr += " · ";
        if (nextScreen !== null) countdownStr += `screen in ${nextScreen.toFixed(1)}m`;
        safeText("countdown-text", countdownStr || "No cycle data yet");

        // Update winrate
        if (data.winrate) {
          const wins = data.winrate.wins || 0;
          const losses = data.winrate.losses || 0;
          const total = wins + losses;
          const winratePct = total > 0 ? ((wins / total) * 100).toFixed(1) : "0.0";
          safeText("metric-winrate-pct", `${winratePct}%`);
          safeText("metric-winrate-count", `W: ${wins} / L: ${losses}`);
        }

        // Update API statuses
        if (data.apiStatus) {
          updateApiStatusEl("status-rpc", data.apiStatus.rpc);
          updateApiStatusEl("status-helius", data.apiStatus.helius);
          updateApiStatusEl("status-telegram", data.apiStatus.telegram);
          updateApiStatusEl("status-llm", data.apiStatus.llm);
        }

      } catch (e) {
        console.error("Failed to load status", e);
      }
    }
    // ─── PnL Calendar State & Handlers ───
    let pnlCalendarState = {
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
      daily: {},
      allTime: {}
    };

    const MONTH_NAMES = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

    // Load PnL Calendar data from server
    async function loadPnlCalendar() {
      try {
        const res = await fetch("/api/pnl/calendar");
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        if (data.success) {
          dashboardState.pnlCalendar = data;
          pnlCalendarState.daily = data.daily || {};
          pnlCalendarState.allTime = data.allTime || {};
          renderPnlCalendar();
        }
      } catch (e) {
        console.error("Failed to load PnL calendar data", e);
      }
    }

    // Navigation handlers
    window.prevPnlMonth = function() {
      pnlCalendarState.month--;
      if (pnlCalendarState.month < 0) {
        pnlCalendarState.month = 11;
        pnlCalendarState.year--;
      }
      renderPnlCalendar();
    };

    window.nextPnlMonth = function() {
      pnlCalendarState.month++;
      if (pnlCalendarState.month > 11) {
        pnlCalendarState.month = 0;
        pnlCalendarState.year++;
      }
      renderPnlCalendar();
    };

    window.goToTodayPnlMonth = function() {
      const now = new Date();
      pnlCalendarState.year = now.getFullYear();
      pnlCalendarState.month = now.getMonth();
      renderPnlCalendar();
    };

    // Render PnL Calendar
    function renderPnlCalendar() {
      const { year, month, daily } = pnlCalendarState;
      const container = document.getElementById("pnl-calendar-container");
      if (!container) return;

      // Update Month Title
      const monthTitleEl = document.getElementById("pnl-cal-month-title");
      if (monthTitleEl) {
        monthTitleEl.textContent = `${MONTH_NAMES[month]} ${year}`;
      }

      // Calculate stats for selected month
      const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
      let monthPnl = 0;
      let monthFees = 0;
      let monthTrades = 0;
      let monthWins = 0;
      let monthLosses = 0;
      let greenDays = 0;
      let redDays = 0;
      let flatDays = 0;
      let bestDay = null;
      let worstDay = null;

      for (const dayKey in daily) {
        if (dayKey.startsWith(monthPrefix)) {
          const d = daily[dayKey];
          monthPnl += d.pnl_usd;
          monthFees += d.fees_usd;
          monthTrades += d.trades_count;
          monthWins += d.wins;
          monthLosses += d.losses;

          if (d.pnl_usd > 0) {
            greenDays++;
            if (!bestDay || d.pnl_usd > bestDay.pnl) bestDay = { date: dayKey, pnl: d.pnl_usd };
          } else if (d.pnl_usd < 0) {
            redDays++;
            if (!worstDay || d.pnl_usd < worstDay.pnl) worstDay = { date: dayKey, pnl: d.pnl_usd };
          } else if (d.trades_count > 0) {
            flatDays++;
          }
        }
      }

      const totalClosedMonth = monthWins + monthLosses;
      const monthWinRate = totalClosedMonth > 0 ? ((monthWins / totalClosedMonth) * 100).toFixed(1) : "0.0";
      const solPrice = Number(dashboardState.pnlCalendar?.sol_price) || Number(dashboardState.status?.wallet?.sol_price) || 150;
      const monthPnlSol = (monthPnl / solPrice).toFixed(3);

      // Render Month Summary Top Header Badges
      const summaryEl = document.getElementById("pnl-cal-month-summary");
      if (summaryEl) {
        const pnlColor = monthPnl >= 0 ? "var(--success)" : "#ff6b8a";
        const pnlSign = monthPnl >= 0 ? "+" : "";
        summaryEl.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:4px 12px;">
            <span style="font-size:10px; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">Bulan Ini:</span>
            <span style="font-family:'Space Grotesk',sans-serif; font-size:14px; font-weight:700; color:${pnlColor};">${pnlSign}$${monthPnl.toFixed(2)}</span>
            <span style="font-size:11px; font-weight:600; color:var(--text-secondary);">(${pnlSign}${monthPnlSol} ◎)</span>
          </div>
        `;
      }

      // Render Stat Strip Cards
      const statsStrip = document.getElementById("pnl-cal-stats-strip");
      if (statsStrip) {
        const pnlColor = monthPnl >= 0 ? "var(--success)" : "#ff6b8a";
        const pnlSign = monthPnl >= 0 ? "+" : "";
        statsStrip.innerHTML = `
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Net Realized PnL</span>
            <span class="pnl-cal-stat-val" style="color:${pnlColor};">${pnlSign}$${monthPnl.toFixed(2)}</span>
            <span class="pnl-cal-stat-sub">${pnlSign}${monthPnlSol} SOL</span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Win Rate (${monthWins}W / ${monthLosses}L)</span>
            <span class="pnl-cal-stat-val" style="color:var(--accent-light);">${monthWinRate}%</span>
            <span class="pnl-cal-stat-sub">${totalClosedMonth} Posisi Ditutup</span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Green / Red Days</span>
            <span class="pnl-cal-stat-val">
              <span style="color:var(--success);">${greenDays}H</span>
              <span style="color:var(--text-muted); font-size:12px; margin:0 2px;">/</span>
              <span style="color:#ff6b8a;">${redDays}M</span>
            </span>
            <span class="pnl-cal-stat-sub">${flatDays} Netral</span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Total Fee Earned</span>
            <span class="pnl-cal-stat-val" style="color:var(--success);">+$${monthFees.toFixed(2)}</span>
            <span class="pnl-cal-stat-sub">Klaim LP Otomatis</span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Best / Worst Day</span>
            <span class="pnl-cal-stat-val" style="font-size:13px;">
              <span style="color:var(--success);">${bestDay ? `+$${bestDay.pnl.toFixed(2)}` : '--'}</span>
              <span style="color:var(--text-muted); margin:0 3px;">/</span>
              <span style="color:#ff6b8a;">${worstDay ? `-$${Math.abs(worstDay.pnl).toFixed(2)}` : '--'}</span>
            </span>
            <span class="pnl-cal-stat-sub">Peak Profit / Drawdown</span>
          </div>
        `;
      }

      // Clear week data cache
      window._pnlWeekData = {};

      // Build Calendar Grid HTML (8 columns: 7 days + Weekly summary column)
      const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const daysInPrevMonth = new Date(year, month, 0).getDate();

      const today = new Date();
      const isCurrentMonthToday = (today.getFullYear() === year && today.getMonth() === month);
      const todayDate = today.getDate();

      const totalCells = firstDayIndex + daysInMonth;
      const remainingCells = (7 - (totalCells % 7)) % 7;
      const totalGridDays = totalCells + remainingCells;
      const numWeeks = Math.ceil(totalGridDays / 7);

      let gridHtml = `
        <div class="pnl-cal-weekday-header">
          ${DAY_NAMES.map(name => `<div class="pnl-cal-weekday">${name}</div>`).join("")}
          <div class="pnl-cal-weekday weekly-col-header" title="Total Realized Profit Mingguan">
            <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            <span>Mingguan</span>
          </div>
        </div>
        <div class="pnl-cal-grid">
      `;

      for (let w = 0; w < numWeeks; w++) {
        let weekPnl = 0;
        let weekFees = 0;
        let weekWins = 0;
        let weekLosses = 0;
        let weekTradesCount = 0;
        const weekTradesList = [];
        let weekStartDay = null;
        let weekEndDay = null;
        let weekDaysHtml = "";

        for (let col = 0; col < 7; col++) {
          const cellIdx = w * 7 + col;

          if (cellIdx < firstDayIndex) {
            // Previous Month Padding Days
            const prevDayNum = daysInPrevMonth - (firstDayIndex - 1 - cellIdx);
            weekDaysHtml += `
              <div class="pnl-cal-cell other-month">
                <div class="pnl-cell-header">
                  <span class="pnl-cell-num">${prevDayNum}</span>
                </div>
              </div>
            `;
          } else if (cellIdx < firstDayIndex + daysInMonth) {
            // Current Month Days
            const dayNum = cellIdx - firstDayIndex + 1;
            const dayKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
            const dayData = daily[dayKey];
            const isToday = isCurrentMonthToday && dayNum === todayDate;

            if (weekStartDay === null) weekStartDay = dayNum;
            weekEndDay = dayNum;

            let cellCls = "pnl-cal-cell";
            if (isToday) cellCls += " today-cell";

            if (dayData && dayData.trades_count > 0) {
              cellCls += " has-data";
              if (dayData.pnl_usd > 0) cellCls += " profit";
              else if (dayData.pnl_usd < 0) cellCls += " loss";
              else cellCls += " neutral";

              const wins = dayData.wins || 0;
              const losses = dayData.losses || 0;
              const totalDayTrades = wins + losses;
              const dayWinRate = totalDayTrades > 0 ? ((wins / totalDayTrades) * 100).toFixed(0) : "0";
              const wrClass = totalDayTrades > 0 ? (Number(dayWinRate) >= 50 ? "high" : "low") : "zero";

              const pnlVal = dayData.pnl_usd;
              const pnlSign = pnlVal > 0 ? "+" : (pnlVal < 0 ? "-" : "");
              const valClass = pnlVal > 0 ? "pos" : (pnlVal < 0 ? "neg" : "zero");
              const absVal = Math.abs(pnlVal).toFixed(2);
              const solVal = solPrice > 0 ? (pnlVal / solPrice) : 0;
              const absSol = Math.abs(solVal) >= 1 ? Math.abs(solVal).toFixed(3) : Math.abs(solVal).toFixed(4);
              const tradeCountText = `${dayData.trades_count} pos`;

              // Accumulate week stats
              weekPnl += pnlVal;
              weekFees += dayData.fees_usd || 0;
              weekWins += wins;
              weekLosses += losses;
              weekTradesCount += dayData.trades_count;
              if (dayData.trades && dayData.trades.length > 0) {
                weekTradesList.push(...dayData.trades);
              }

              weekDaysHtml += `
                <div class="${cellCls}" onclick="openPnlDayDetail('${dayKey}')" title="${dayKey}: ${pnlSign}$${absVal} USD (${pnlSign}${absSol} SOL) · ${dayData.trades_count} posisi — ${wins} Win, ${losses} Loss, WR: ${dayWinRate}%">
                  <div class="pnl-cell-header">
                    <span class="pnl-cell-num">${dayNum}</span>
                    <div style="display:flex; align-items:center; gap:3px;">
                      ${isToday ? '<span class="pnl-cell-today-pill">TODAY</span>' : ''}
                      <span class="pnl-cell-wr-pill ${wrClass}" title="Win Rate: ${dayWinRate}%">${dayWinRate}%</span>
                    </div>
                  </div>
                  <div class="pnl-cell-body">
                    <div class="pnl-cell-val-row">
                      <span class="pnl-cell-val ${valClass}">${pnlSign}$${absVal}</span>
                      <span class="pnl-cell-sol ${valClass}">${pnlSign}${absSol} SOL</span>
                    </div>
                    <div class="pnl-cell-footer-stats">
                      <div class="pnl-cell-wl">
                        <span class="wl-win-tag" title="${wins} Win">${wins}W</span>
                        <span class="wl-loss-tag" title="${losses} Loss">${losses}L</span>
                      </div>
                      <span class="pnl-cell-badge">${tradeCountText}</span>
                    </div>
                  </div>
                </div>
              `;
            } else {
              // Empty day without trades
              weekDaysHtml += `
                <div class="${cellCls}">
                  <div class="pnl-cell-header">
                    <span class="pnl-cell-num">${dayNum}</span>
                    ${isToday ? '<span class="pnl-cell-today-pill">TODAY</span>' : ''}
                  </div>
                  <div class="pnl-cell-body" style="opacity:0.25;">
                    <span style="font-size:11px; color:var(--text-muted);">--</span>
                  </div>
                </div>
              `;
            }
          } else {
            // Next Month Padding Days
            const nextDayNum = cellIdx - (firstDayIndex + daysInMonth) + 1;
            weekDaysHtml += `
              <div class="pnl-cal-cell other-month">
                <div class="pnl-cell-header">
                  <span class="pnl-cell-num">${nextDayNum}</span>
                </div>
              </div>
            `;
          }
        }

        // 8th column: Distinct Weekly summary card
        const weekKey = `week_${w + 1}`;
        const weekNum = w + 1;
        const dateRangeLabel = weekStartDay ? (weekStartDay === weekEndDay ? `${weekStartDay} ${MONTH_NAMES[month]}` : `${weekStartDay}–${weekEndDay} ${MONTH_NAMES[month]}`) : `Minggu ${weekNum}`;

        let weekCellHtml = "";
        if (weekTradesCount > 0) {
          const weekPnlSign = weekPnl > 0 ? "+" : (weekPnl < 0 ? "-" : "");
          const weekValClass = weekPnl > 0 ? "pos" : (weekPnl < 0 ? "neg" : "zero");
          const weekTagClass = weekPnl > 0 ? "profit" : (weekPnl < 0 ? "loss" : "neutral");
          const weekAbsVal = Math.abs(weekPnl).toFixed(2);
          const weekSolVal = solPrice > 0 ? (weekPnl / solPrice) : 0;
          const weekAbsSol = Math.abs(weekSolVal) >= 1 ? Math.abs(weekSolVal).toFixed(3) : Math.abs(weekSolVal).toFixed(4);
          const totalWeekClosed = weekWins + weekLosses;
          const weekWinRate = totalWeekClosed > 0 ? ((weekWins / totalWeekClosed) * 100).toFixed(0) : "0";
          const weekWrClass = totalWeekClosed > 0 ? (Number(weekWinRate) >= 50 ? "high" : "low") : "zero";
          const weekCls = `pnl-cal-cell pnl-cal-weekly-cell has-data ${weekPnl > 0 ? 'profit' : (weekPnl < 0 ? 'loss' : 'neutral')}`;

          window._pnlWeekData[weekKey] = {
            weekNum,
            dateRangeLabel,
            weekPnl,
            weekFees,
            weekWins,
            weekLosses,
            weekTradesCount,
            weekWr: weekWinRate,
            trades: weekTradesList
          };

          weekCellHtml = `
            <div class="${weekCls}" onclick="openPnlWeekDetail('${weekKey}')" title="Total Minggu ${weekNum} (${dateRangeLabel}): ${weekPnlSign}$${weekAbsVal} USD (${weekPnlSign}${weekAbsSol} SOL) · ${weekTradesCount} posisi — ${weekWins} Win, ${weekLosses} Loss, WR: ${weekWinRate}%">
              <div class="pnl-weekly-header-bar">
                <span class="pnl-weekly-tag ${weekTagClass}">W${weekNum} • TOTAL</span>
                <span class="pnl-weekly-dates">${dateRangeLabel}</span>
              </div>
              <div class="pnl-weekly-val-box">
                <span class="pnl-weekly-usd-val ${weekValClass}">${weekPnlSign}$${weekAbsVal}</span>
                <span class="pnl-weekly-sol-chip ${weekValClass}">◎ ${weekPnlSign}${weekAbsSol} SOL</span>
              </div>
              <div class="pnl-weekly-footer">
                <div class="pnl-cell-wl">
                  <span class="wl-win-tag" title="${weekWins} Win">${weekWins}W</span>
                  <span class="wl-loss-tag" title="${weekLosses} Loss">${weekLosses}L</span>
                  <span class="pnl-cell-wr-pill ${weekWrClass}" style="margin-left:2px;">${weekWinRate}%</span>
                </div>
                <span class="pnl-weekly-action-hint">Detail ↗</span>
              </div>
            </div>
          `;
        } else {
          weekCellHtml = `
            <div class="pnl-cal-cell pnl-cal-weekly-cell empty" title="Total Minggu ${weekNum} (${dateRangeLabel}): Belum ada posisi ditutup">
              <div class="pnl-weekly-header-bar">
                <span class="pnl-weekly-tag" style="background:rgba(255,255,255,0.05); color:var(--text-muted); border-color:rgba(255,255,255,0.08);">W${weekNum} • TOTAL</span>
                <span class="pnl-weekly-dates">${dateRangeLabel}</span>
              </div>
              <div class="pnl-weekly-val-box" style="opacity:0.35;">
                <span style="font-family:'Space Grotesk'; font-size:12px; font-weight:700; color:var(--text-muted);">$0.00</span>
                <span class="pnl-weekly-sol-chip zero">◎ 0.000 SOL</span>
              </div>
              <div class="pnl-weekly-footer" style="opacity:0.3;">
                <span style="font-size:8px; color:var(--text-muted);">0 posisi</span>
                <span style="font-size:8px; color:var(--text-muted);">--</span>
              </div>
            </div>
          `;
        }

        gridHtml += weekDaysHtml + weekCellHtml;
      }

      gridHtml += `</div>`;
      container.innerHTML = gridHtml;
    }

    // Helper to populate trades inside pnl detail modal
    function renderModalTrades(trades, solPrice) {
      const tradesContainer = document.getElementById("pnl-day-modal-trades");
      if (!tradesContainer) return;
      tradesContainer.replaceChildren();

      const sortedTrades = [...trades].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      sortedTrades.forEach(t => {
        const item = document.createElement("div");
        item.style.cssText = "background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:8px;";

        const topRow = document.createElement("div");
        topRow.style.cssText = "display:flex; justify-content:space-between; align-items:center;";

        const titleWrap = document.createElement("div");
        titleWrap.style.cssText = "display:flex; align-items:center; gap:8px;";

        const isPos = t.pnl_usd >= 0;
        const outcomeTag = document.createElement("span");
        outcomeTag.className = isPos ? "pnl-trade-outcome-tag win" : "pnl-trade-outcome-tag loss";
        outcomeTag.textContent = isPos ? "WIN" : "LOSS";

        const titleDiv = document.createElement("div");
        titleDiv.style.cssText = "font-family:'Space Grotesk'; font-size:14px; font-weight:700; color:#fff;";
        titleDiv.textContent = t.pool_name || t.pool || "Unknown Pool";

        titleWrap.appendChild(outcomeTag);
        titleWrap.appendChild(titleDiv);

        const tSol = solPrice > 0 ? (t.pnl_usd / solPrice) : 0;
        const tSolSign = tSol >= 0 ? "+" : "-";
        const tAbsSol = Math.abs(tSol) >= 1 ? Math.abs(tSol).toFixed(3) : Math.abs(tSol).toFixed(4);

        const pnlBadge = document.createElement("div");
        pnlBadge.style.cssText = "text-align:right;";
        pnlBadge.innerHTML = `
          <div style="font-family:'Space Grotesk'; font-size:13px; font-weight:700; color:${isPos ? 'var(--success)' : '#ff6b8a'};">
            ${isPos ? '+' : ''}$${t.pnl_usd.toFixed(2)} (${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%)
          </div>
          <div style="font-family:'JetBrains Mono'; font-size:10.5px; font-weight:600; color:${isPos ? '#5eead4' : '#fca5a5'}; opacity:0.88;">
            ${tSolSign}${tAbsSol} SOL
          </div>
        `;

        topRow.appendChild(titleWrap);
        topRow.appendChild(pnlBadge);
        item.appendChild(topRow);

        // Details grid
        const metaRow = document.createElement("div");
        metaRow.style.cssText = "display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-secondary); flex-wrap:wrap; gap:6px;";

        const leftMeta = document.createElement("div");
        leftMeta.style.cssText = "display:flex; gap:12px;";
        const feeSpan = document.createElement("span");
        feeSpan.innerHTML = `Fee: <strong style="color:var(--success);">+$${Number(t.fees_usd || 0).toFixed(4)}</strong>`;
        const durSpan = document.createElement("span");
        durSpan.textContent = t.minutes_held ? `Durasi: ${t.minutes_held}m` : "";
        leftMeta.appendChild(feeSpan);
        if (t.minutes_held) leftMeta.appendChild(durSpan);

        const reasonSpan = document.createElement("div");
        reasonSpan.style.cssText = "font-size:10px; font-family:'JetBrains Mono'; color:var(--text-muted); background:rgba(255,255,255,0.04); padding:2px 8px; border-radius:4px; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        reasonSpan.textContent = t.close_reason || "Closed";
        reasonSpan.title = t.close_reason || "";

        metaRow.appendChild(leftMeta);
        metaRow.appendChild(reasonSpan);
        item.appendChild(metaRow);

        tradesContainer.appendChild(item);
      });
    }

    // Open PnL Day Detail Modal
    window.openPnlDayDetail = function(dateStr) {
      const modal = document.getElementById("pnl-day-modal");
      if (!modal) return;

      const dayData = pnlCalendarState.daily[dateStr];
      if (!dayData || !dayData.trades || dayData.trades.length === 0) {
        showToast("Tidak ada riwayat posisi ditutup pada tanggal ini", "info");
        return;
      }

      const solPrice = Number(dashboardState.pnlCalendar?.sol_price) || Number(dashboardState.status?.wallet?.sol_price) || 150;
      const isPos = dayData.pnl_usd >= 0;
      const solVal = solPrice > 0 ? (dayData.pnl_usd / solPrice) : 0;
      const solSign = solVal >= 0 ? "+" : "-";
      const absSol = Math.abs(solVal) >= 1 ? Math.abs(solVal).toFixed(3) : Math.abs(solVal).toFixed(4);

      // Format Date Header (e.g. 21 Agustus 2026)
      const [y, m, d] = dateStr.split("-").map(Number);
      const dateFormatted = `${d} ${MONTH_NAMES[m - 1]} ${y}`;
      safeText("pnl-day-modal-title", `PnL Detail — ${dateFormatted}`);
      safeText("pnl-day-modal-subtitle", "Performance breakdown untuk posisi ditutup pada tanggal ini");

      const badgeEl = document.getElementById("pnl-day-modal-badge");
      if (badgeEl) {
        badgeEl.textContent = `${isPos ? '+' : ''}$${dayData.pnl_usd.toFixed(2)} USD (${solSign}${absSol} SOL)`;
        badgeEl.style.background = isPos ? "rgba(16,217,160,0.15)" : "rgba(255,77,109,0.15)";
        badgeEl.style.color = isPos ? "var(--success)" : "#ff6b8a";
        badgeEl.style.border = `1px solid ${isPos ? 'rgba(16,217,160,0.3)' : 'rgba(255,77,109,0.3)'}`;
      }

      // Day Summary Stats
      const statsContainer = document.getElementById("pnl-day-modal-stats");
      if (statsContainer) {
        const winrate = dayData.trades_count > 0 ? ((dayData.wins / dayData.trades_count) * 100).toFixed(0) : "0";
        statsContainer.innerHTML = `
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Net Realized PnL</span>
            <span class="pnl-cal-stat-val" style="color:${isPos ? 'var(--success)' : '#ff6b8a'};">${isPos ? '+' : ''}$${dayData.pnl_usd.toFixed(2)}</span>
            <span class="pnl-cal-stat-sub">${solSign}${absSol} SOL · ${dayData.trades_count} total posisi</span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Win Rate & Breakdown</span>
            <span class="pnl-cal-stat-val" style="color:var(--accent-light);">${winrate}%</span>
            <span class="pnl-cal-stat-sub"><strong style="color:var(--success);">${dayData.wins} Win</strong> / <strong style="color:#ff6b8a;">${dayData.losses} Loss</strong></span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Claimed Fees</span>
            <span class="pnl-cal-stat-val" style="color:var(--success);">+$${dayData.fees_usd.toFixed(4)}</span>
            <span class="pnl-cal-stat-sub">Fee perdagangan LP harian</span>
          </div>
        `;
      }

      renderModalTrades(dayData.trades, solPrice);
      modal.showModal();
    };

    // Open PnL Week Detail Modal
    window.openPnlWeekDetail = function(weekKey) {
      const modal = document.getElementById("pnl-day-modal");
      if (!modal) return;

      const weekData = window._pnlWeekData?.[weekKey];
      if (!weekData || !weekData.trades || weekData.trades.length === 0) {
        showToast("Tidak ada riwayat posisi ditutup pada minggu ini", "info");
        return;
      }

      const solPrice = Number(dashboardState.pnlCalendar?.sol_price) || Number(dashboardState.status?.wallet?.sol_price) || 150;
      const isPos = weekData.weekPnl >= 0;
      const solVal = solPrice > 0 ? (weekData.weekPnl / solPrice) : 0;
      const solSign = solVal >= 0 ? "+" : "-";
      const absSol = Math.abs(solVal) >= 1 ? Math.abs(solVal).toFixed(3) : Math.abs(solVal).toFixed(4);

      safeText("pnl-day-modal-title", `PnL Detail — Minggu ${weekData.weekNum} (${weekData.dateRangeLabel})`);
      safeText("pnl-day-modal-subtitle", `Performance breakdown untuk seluruh posisi ditutup pada Minggu ke-${weekData.weekNum}`);

      const badgeEl = document.getElementById("pnl-day-modal-badge");
      if (badgeEl) {
        badgeEl.textContent = `${isPos ? '+' : ''}$${weekData.weekPnl.toFixed(2)} USD (${solSign}${absSol} SOL)`;
        badgeEl.style.background = isPos ? "rgba(16,217,160,0.15)" : "rgba(255,77,109,0.15)";
        badgeEl.style.color = isPos ? "var(--success)" : "#ff6b8a";
        badgeEl.style.border = `1px solid ${isPos ? 'rgba(16,217,160,0.3)' : 'rgba(255,77,109,0.3)'}`;
      }

      const statsContainer = document.getElementById("pnl-day-modal-stats");
      if (statsContainer) {
        statsContainer.innerHTML = `
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Total Realized PnL</span>
            <span class="pnl-cal-stat-val" style="color:${isPos ? 'var(--success)' : '#ff6b8a'};">${isPos ? '+' : ''}$${weekData.weekPnl.toFixed(2)}</span>
            <span class="pnl-cal-stat-sub">${solSign}${absSol} SOL · ${weekData.weekTradesCount} posisi</span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Win Rate & Breakdown</span>
            <span class="pnl-cal-stat-val" style="color:var(--accent-light);">${weekData.weekWr}%</span>
            <span class="pnl-cal-stat-sub"><strong style="color:var(--success);">${weekData.weekWins} Win</strong> / <strong style="color:#ff6b8a;">${weekData.weekLosses} Loss</strong></span>
          </div>
          <div class="pnl-cal-stat-pill">
            <span class="pnl-cal-stat-label">Claimed Fees</span>
            <span class="pnl-cal-stat-val" style="color:var(--success);">+$${weekData.weekFees.toFixed(4)}</span>
            <span class="pnl-cal-stat-sub">Fee perdagangan LP mingguan</span>
          </div>
        `;
      }

      renderModalTrades(weekData.trades, solPrice);
      modal.showModal();
    };

    // Load positions
    function renderDashboardPositionsGrid() {
      const container = document.getElementById("dashboard-positions-list");
      container.replaceChildren();

      if (dashboardState.positions.length === 0) {
        const div = document.createElement("div");
        div.style.cssText = "grid-column:span 2;text-align:center;padding:48px 20px;color:var(--text-muted);font-size:13px;background:var(--bg-elevated);border-radius:14px;border:1px solid var(--border-subtle);";
        div.textContent = "No open positions. Ready to allocate capital.";
        container.appendChild(div);
        return;
      }

      dashboardState.positions.forEach(p => {
        const card = document.createElement("div");
        card.className = "pos-card";

        // Header
        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;";

        const titleDiv = document.createElement("div");
        const pairDiv = document.createElement("div");
        pairDiv.style.cssText = "font-family:'Space Grotesk';font-size:15px;font-weight:700;color:#fff;";
        pairDiv.textContent = p.pair;
        const valDiv = document.createElement("div");
        valDiv.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:2px;";
        valDiv.textContent = `$${Number(p.total_value_usd).toFixed(2)} LP`;
        titleDiv.appendChild(pairDiv); titleDiv.appendChild(valDiv);

        header.appendChild(titleDiv);
        header.appendChild(buildStatusBadge(p));
        card.appendChild(header);

        // Range
        const rangeWrap = document.createElement("div");
        rangeWrap.style.marginBottom = "12px";
        rangeWrap.appendChild(buildRangeBar(p));
        card.appendChild(rangeWrap);

        // Stats
        const statsGrid = document.createElement("div");
        statsGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;padding-top:12px;border-top:1px solid var(--border-subtle);";

        const earnedDiv = document.createElement("div");
        const elabel = document.createElement("div"); elabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:var(--text-muted);"; elabel.textContent = "Unclaimed Fees";
        const evalue = document.createElement("div"); evalue.style.cssText = "font-size:13px;font-weight:700;color:var(--success);margin-top:2px;"; evalue.textContent = `$${Number(p.unclaimed_fees_usd).toFixed(4)}`;
        earnedDiv.appendChild(elabel); earnedDiv.appendChild(evalue);

        const ageDiv = document.createElement("div");
        const alabel = document.createElement("div"); alabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:var(--text-muted);"; alabel.textContent = "Age";
        const avalue = document.createElement("div"); avalue.style.cssText = "font-size:13px;font-weight:600;color:var(--text-secondary);margin-top:2px;"; avalue.textContent = `${p.age_minutes || 0} min`;
        ageDiv.appendChild(alabel); ageDiv.appendChild(avalue);

        statsGrid.appendChild(earnedDiv); statsGrid.appendChild(ageDiv);
        card.appendChild(statsGrid);

        // Instruction note
        if (p.instruction) {
          const note = document.createElement("div");
          note.style.cssText = "margin-top:10px;font-size:11px;color:var(--accent-light);background:rgba(124,92,255,0.07);border:1px solid rgba(124,92,255,0.15);border-radius:8px;padding:8px 10px;display:flex;gap:6px;";
          const icon = document.createElement("span"); icon.textContent = "💡";
          const text = document.createElement("span"); text.textContent = p.instruction;
          note.appendChild(icon); note.appendChild(text);
          card.appendChild(note);
        }

        container.appendChild(card);
      });
    }

    // Note modal
    function renderDashboardDecisionsFeed() {
      const container = document.getElementById("dashboard-decisions-list");
      container.replaceChildren();

      const feed = dashboardState.decisions.slice(0, 5);
      if (feed.length === 0) {
        const div = document.createElement("div");
        div.style.cssText = "text-align:center;padding:32px 16px;color:var(--text-muted);font-size:12px;background:var(--bg-elevated);border-radius:12px;border:1px solid var(--border-subtle);";
        div.textContent = "No log activities yet.";
        container.appendChild(div); return;
      }

      feed.forEach(d => {
        const item = document.createElement("div");
        item.className = "feed-item";

        const type = String(d.type).toLowerCase();
        let icon;
        if (type === "deploy") icon = document.getElementById("tmpl-icon-deploy").firstElementChild.cloneNode(true);
        else if (type === "close") icon = document.getElementById("tmpl-icon-close").firstElementChild.cloneNode(true);
        else icon = document.getElementById("tmpl-icon-skip").firstElementChild.cloneNode(true);

        const body = document.createElement("div");
        body.style.cssText = "min-width:0;flex:1;";

        const title = document.createElement("div"); title.style.cssText = "font-size:12px;font-weight:700;color:var(--text-primary);"; title.textContent = d.summary;
        const reason = document.createElement("div"); reason.style.cssText = "font-size:10px;font-family:'JetBrains Mono';color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"; reason.textContent = d.reason || "";

        body.appendChild(title); body.appendChild(reason);
        item.appendChild(icon); item.appendChild(body);
        container.appendChild(item);
      });
    }

    // Load lessons
    const perfPagination    = { page: 0, perPage: 10 };
    const lessonsPagination = { page: 0, perPage: 10 };
