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

    // Load portfolio history
    async function loadPortfolioHistory() {
      try {
        const res = await fetch("/api/portfolio/history");
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        if (data.success && data.history) {
          dashboardState.portfolioHistory = data.history;
          renderPortfolioChart(data.history);
        }
      } catch (e) {
        console.error("Failed to load portfolio history", e);
      }
    }

    // Dynamic Timeframe switching
    window.setChartTimeframe = function(tf) {
      currentChartTimeframe = tf;
      ["1D", "7D", "30D"].forEach(t => {
        const btn = document.getElementById(`tf-${t.toLowerCase()}`);
        if (!btn) return;
        if (t === tf) {
          btn.style.background = "var(--accent-light)";
          btn.style.color = "#fff";
        } else {
          btn.style.background = "none";
          btn.style.color = "var(--text-muted)";
        }
      });
      if (dashboardState.portfolioHistory) {
        renderPortfolioChart(dashboardState.portfolioHistory);
      }
    };

    // Render portfolio trend SVG chart
    function renderPortfolioChart(history) {
      const container = document.getElementById("portfolio-chart-container");
      if (!container) return;

      if (!history || history.length === 0) {
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:12px;">No historical data available</div>`;
        return;
      }

      // ── Aggregate into clean buckets ─────────────────────────────
      // 1D  → 1 point per hour  (last snapshot in each hour)
      // 7D  → 1 point per day   (last snapshot in each calendar day)
      // 30D → 1 point per day   (last snapshot in each calendar day)
      const nowMs = Date.now();

      function bucketKey(ts, mode) {
        const d = new Date(ts);
        if (mode === "1D") {
          // YYYY-MM-DDTHH  (group by hour)
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
        } else {
          // YYYY-MM-DD  (group by day)
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        }
      }

      let cutoffMs;
      if (currentChartTimeframe === "1D")  cutoffMs = nowMs - 24 * 60 * 60 * 1000;
      else if (currentChartTimeframe === "7D")  cutoffMs = nowMs - 7  * 24 * 60 * 60 * 1000;
      else                                  cutoffMs = nowMs - 30 * 24 * 60 * 60 * 1000;

      // Keep only entries inside the window
      const inWindow = history.filter(h => new Date(h.timestamp || h.date).getTime() >= cutoffMs);

      // Group → keep LAST entry per bucket (most recent reading in the period)
      const bucketMap = new Map();
      for (const h of inWindow) {
        const key = bucketKey(new Date(h.timestamp || h.date).getTime(), currentChartTimeframe);
        bucketMap.set(key, h); // later entries overwrite earlier ones → last wins
      }

      // Sort buckets chronologically
      let filtered = Array.from(bucketMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, h]) => h);

      if (filtered.length === 0) {
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:12px;">No history in this range</div>`;
        return;
      }

      // Use SOL as primary metric — this shows true portfolio health after fees
      const valuesUsd = filtered.map(h => h.value);
      const valuesSol = filtered.map(h =>
        h.valueSol != null ? h.valueSol : (h.value / (dashboardState.status?.wallet?.sol_price || 150))
      );
      
      const DAY_SHORT = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
      const MON_SHORT = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

      const dates = filtered.map(h => {
        const d = new Date(h.timestamp || h.date);
        if (currentChartTimeframe === "1D") {
          // HH:00 — jam bulat
          return `${String(d.getHours()).padStart(2,'0')}:00`;
        } else if (currentChartTimeframe === "7D") {
          // Sen\n21/6
          return `${DAY_SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
        } else {
          // 21 Jun
          return `${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
        }
      });

      // Plot on SOL axis
      const maxVal = Math.max(...valuesSol, 0.01) * 1.05;
      const minVal = Math.min(...valuesSol) * 0.95;
      const actualMinVal = Math.max(0, minVal);
      const valRange = maxVal - actualMinVal;

      const width = container.clientWidth || 600;
      const height = 200;
      const padding = { top: 15, right: 20, bottom: 32, left: 55 };

      const points = [];
      const stepX = (width - padding.left - padding.right) / Math.max(1, filtered.length - 1);
      
      for (let i = 0; i < filtered.length; i++) {
        const x = padding.left + i * stepX;
        const y = padding.top + (height - padding.top - padding.bottom) * (1 - (valuesSol[i] - actualMinVal) / (valRange || 1));
        points.push({ x, y, val: valuesUsd[i], valSol: valuesSol[i], date: dates[i], timestamp: filtered[i].timestamp || filtered[i].date });
      }

      let linePath = `M ${points[0].x} ${points[0].y}`;
      if (points.length > 1) {
        for (let i = 1; i < points.length; i++) {
          const cpX1 = points[i-1].x + stepX / 3;
          const cpY1 = points[i-1].y;
          const cpX2 = points[i].x - stepX / 3;
          const cpY2 = points[i].y;
          linePath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${points[i].x} ${points[i].y}`;
        }
      } else {
        linePath += ` L ${points[0].x} ${points[0].y}`;
      }

      const chartBottom = height - padding.bottom;
      let areaPath = `${linePath} L ${points[points.length - 1].x} ${chartBottom} L ${points[0].x} ${chartBottom} Z`;

      const gridCount = 4;
      let gridLinesHtml = "";
      for (let i = 0; i <= gridCount; i++) {
        const ratio = i / gridCount;
        const y = padding.top + (height - padding.top - padding.bottom) * ratio;
        const gridVal = maxVal - ratio * valRange;
        // Show SOL on Y-axis (3 decimal places)
        const solLabel = gridVal >= 10 ? gridVal.toFixed(1) : gridVal.toFixed(3);
        gridLinesHtml += `
          <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3,3" />
          <text x="${padding.left - 6}" y="${y + 4}" fill="var(--text-muted)" font-size="9" font-family="'Space Grotesk', sans-serif" text-anchor="end">${solLabel}◎</text>
        `;
      }

      // X-axis labels — show evenly spaced, all buckets already capped
      let xAxisHtml = "";
      // Target ~6-8 visible labels; for small sets show all
      const maxLabels = currentChartTimeframe === "1D" ? 8 : currentChartTimeframe === "7D" ? 7 : 10;
      const labelStep = Math.max(1, Math.ceil(filtered.length / maxLabels));
      const labelledIndexes = new Set();
      for (let i = 0; i < filtered.length; i += labelStep) labelledIndexes.add(i);
      labelledIndexes.add(filtered.length - 1); // always include last

      for (const i of [...labelledIndexes].sort((a,b)=>a-b)) {
        const pt = points[i];
        const lbl = dates[i];
        // For 7D split "Sen 21/6" into two lines
        if (currentChartTimeframe === "7D") {
          const parts = lbl.split(' ');
          xAxisHtml += `
            <text x="${pt.x}" y="${height - 16}" fill="var(--text-muted)" font-size="8" font-family="'Space Grotesk', sans-serif" text-anchor="middle" font-weight="700">${parts[0]}</text>
            <text x="${pt.x}" y="${height - 6}" fill="rgba(255,255,255,0.35)" font-size="8" font-family="'Space Grotesk', sans-serif" text-anchor="middle">${parts[1]}</text>
          `;
        } else {
          xAxisHtml += `
            <text x="${pt.x}" y="${height - 8}" fill="var(--text-muted)" font-size="9" font-family="'Space Grotesk', sans-serif" text-anchor="middle">${lbl}</text>
          `;
        }
      }

      // Badge: SOL primary + USD secondary
      const currentValSol = valuesSol[valuesSol.length - 1];
      const currentValUsd = valuesUsd[valuesUsd.length - 1];
      const prevValSol = valuesSol.length > 1 ? valuesSol[valuesSol.length - 2] : currentValSol;
      const changePct = prevValSol > 0 ? ((currentValSol - prevValSol) / prevValSol * 100) : 0;
      const changeSign = changePct >= 0 ? "+" : "";
      const changeColor = changePct >= 0 ? "var(--success)" : "#ff6b8a";

      const badgeEl = document.getElementById("chart-current-value");
      if (badgeEl) {
        badgeEl.innerHTML = `
          <span style="font-size:12px; color:${changeColor}; margin-right:12px; font-weight:600;">
            ${changeSign}${changePct.toFixed(2)}% (${currentChartTimeframe === '1D' ? '24h' : currentChartTimeframe})
          </span>
          <span style="display:inline-flex; flex-direction:column; align-items:flex-end; gap:1px;">
            <span style="color:var(--accent-light); font-weight:700; font-size:14px;">◎ ${currentValSol.toFixed(4)} SOL</span>
            <span style="color:var(--text-muted); font-weight:500; font-size:11px;">$${currentValUsd != null ? currentValUsd.toFixed(2) : '--'} USD</span>
          </span>
        `;
      }

      let hoverPointsHtml = "";
      let interactiveOverlaysHtml = "";
      
      points.forEach((pt, index) => {
        hoverPointsHtml += `
          <circle id="chart-dot-${index}" cx="${pt.x}" cy="${pt.y}" r="4" fill="var(--accent-light)" stroke="#fff" stroke-width="1.5" style="opacity: 0; transition: opacity 0.15s ease;" />
        `;
        const hitWidth = width / filtered.length;
        const triggerX = pt.x - hitWidth / 2;
        interactiveOverlaysHtml += `
          <rect x="${triggerX}" y="${padding.top}" width="${hitWidth}" height="${height - padding.top - padding.bottom}" fill="transparent" style="cursor: pointer;"
                onmouseover="showChartTooltip(${index}, ${pt.x}, ${pt.y}, '${pt.timestamp}', ${pt.val}, ${pt.valSol})"
                onmouseout="hideChartTooltip(${index})" />
        `;
      });

      const svgHtml = `
        <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="overflow: visible;">
          <defs>
            <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent-light)" stop-opacity="0.25" />
              <stop offset="100%" stop-color="var(--accent-light)" stop-opacity="0.00" />
            </linearGradient>
            <linearGradient id="chart-stroke-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="rgb(124,92,255)" />
              <stop offset="100%" stop-color="rgb(168,85,247)" />
            </linearGradient>
          </defs>
          ${gridLinesHtml}
          <path d="${areaPath}" fill="url(#chart-area-grad)" />
          <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
          <path d="${linePath}" fill="none" stroke="url(#chart-stroke-grad)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${xAxisHtml}
          ${hoverPointsHtml}
          ${interactiveOverlaysHtml}
        </svg>
        <div id="chart-tooltip" style="position: absolute; display: none; background: rgba(15, 12, 30, 0.95); border: 1px solid rgba(124, 92, 255, 0.4); border-radius: 6px; padding: 6px 10px; pointer-events: none; z-index: 100; font-family: 'Space Grotesk', sans-serif; font-size: 11px; color: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.5); transform: translate(-50%, -100%); margin-top: -10px;">
          <div id="tooltip-date" style="color: var(--text-secondary); font-size: 9px; margin-bottom: 2px;"></div>
          <div id="tooltip-value" style="font-weight: 700;"></div>
        </div>
      `;

      container.innerHTML = svgHtml;
    }

    // Chart interaction handlers
    window.showChartTooltip = function(index, x, y, dateStr, valUsd, valSol) {
      const dot = document.getElementById(`chart-dot-${index}`);
      if (dot) dot.style.opacity = "1";
      const tooltip = document.getElementById("chart-tooltip");
      if (tooltip) {
        const dateObj = new Date(dateStr);
        let dateFormatted = dateStr;
        if (!isNaN(dateObj.getTime())) {
          dateFormatted = dateObj.toLocaleDateString() + " " + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        document.getElementById("tooltip-date").textContent = dateFormatted;
        document.getElementById("tooltip-value").innerHTML = `
          <span style="color:var(--accent-light); font-weight:700;">${valSol.toFixed(3)} SOL</span><br>
          <span style="color:var(--text-muted); font-size:10px;">$${valUsd.toFixed(2)} USD</span>
        `;
        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
        tooltip.style.display = "block";
      }
    };

    window.hideChartTooltip = function(index) {
      const dot = document.getElementById(`chart-dot-${index}`);
      if (dot) dot.style.opacity = "0";
      const tooltip = document.getElementById("chart-tooltip");
      if (tooltip) tooltip.style.display = "none";
    };

    // Redraw chart on window resize
    window.addEventListener("resize", () => {
      if (dashboardState.portfolioHistory) {
        renderPortfolioChart(dashboardState.portfolioHistory);
      }
    });

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
