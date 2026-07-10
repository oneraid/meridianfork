async function loadPositions() {
      try {
        const res = await fetch("/api/positions");
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        dashboardState.positions = data.positions || [];

        safeText("metric-positions-count", data.total_positions);
        safeText("metric-positions-max", `/ ${dashboardState.status.maxPositions || "--"}`);
        safeText("positions-total-badge", `${data.total_positions} Positions`);

        const totalFees  = data.positions.reduce((acc, p) => acc + (Number(p.total_fees_claimed_usd) || 0) + (Number(p.unclaimed_fees_usd) || 0), 0);
        const totalValue = data.positions.reduce((acc, p) => acc + (Number(p.total_value_usd) || 0), 0);

        safeText("metric-fees-claimed", `$${totalFees.toFixed(2)}`);
        safeText("metric-total-value", `$${totalValue.toFixed(2)}`);

        renderPositionsTable();
        renderDashboardPositionsGrid();
        loadPositionsHistory();
      } catch (e) {
        console.error("Failed to load positions", e);
      }
    }

    // Load closed positions history
    const historyPagination = { page: 0, perPage: 10 };
    async function loadPositionsHistory() {
      try {
        const res = await fetch("/api/positions/history");
        if (res.status === 401) return handleLogout();
        const data = await res.json();
        dashboardState.positionsHistory = data.positions || [];
        safeText("positions-history-total-badge", `${data.total_positions} Closed`);
        historyPagination.page = 0;
        renderHistoryPage();
      } catch (e) {
        console.error("Failed to load positions history", e);
      }
    }

    function historyPage(dir) {
      const total = (dashboardState.positionsHistory || []).length;
      const maxPage = Math.max(0, Math.ceil(total / historyPagination.perPage) - 1);
      historyPagination.page = Math.min(maxPage, Math.max(0, historyPagination.page + dir));
      renderHistoryPage();
    }

    function renderHistoryPage() {
      const container = document.getElementById("positions-history-table-body");
      container.replaceChildren();
      const { page, perPage } = historyPagination;
      const historyPositions = dashboardState.positionsHistory || [];
      const total = historyPositions.length;
      const start = page * perPage;
      const slice = historyPositions.slice(start, start + perPage);

      const totalPages = Math.max(1, Math.ceil(total / perPage));
      document.getElementById("history-pager-info").textContent = total === 0 ? "" : `${start + 1}–${Math.min(start + perPage, total)} dari ${total}`;
      document.getElementById("history-pager-page").textContent = total === 0 ? "" : `Hal ${page + 1} / ${totalPages}`;
      document.getElementById("history-pager-prev").disabled = page === 0;
      document.getElementById("history-pager-next").disabled = page >= totalPages - 1;
      document.getElementById("history-pager").style.display = total <= perPage ? "none" : "flex";

      if (total === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td"); td.colSpan = 7;
        td.style.cssText = "text-align:center;padding:24px;color:var(--text-muted);font-size:13px;";
        td.textContent = "No closed positions found in history.";
        tr.appendChild(td); container.appendChild(tr);
        return;
      }

      slice.forEach(p => {
          const tr = document.createElement("tr");

          // Col 1: Pair / CA / Meteora link
          const tdPair = document.createElement("td");
          tdPair.style.cssText = "white-space:nowrap;";

          const divPair = document.createElement("div");
          divPair.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:4px;";
          const pairName = document.createElement("span");
          pairName.style.cssText = "font-weight:700;color:var(--text-primary);font-size:14px;";
          pairName.textContent = p.pool_name || p.pair;

          const metLink = document.createElement("a");
          metLink.href = `https://app.meteora.ag/dlmm/${p.pool}`;
          metLink.target = "_blank";
          metLink.rel = "noopener noreferrer";
          metLink.title = "Open on Meteora";
          metLink.style.cssText = "color:var(--accent-light);opacity:0.7;display:inline-flex;align-items:center;transition:opacity 0.15s;flex-shrink:0;";
          metLink.onmouseenter = () => metLink.style.opacity = '1';
          metLink.onmouseleave = () => metLink.style.opacity = '0.7';
          metLink.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>`;
          divPair.appendChild(pairName);
          divPair.appendChild(metLink);

          const divCA = document.createElement("div");
          divCA.style.cssText = "display:flex;align-items:center;gap:4px;";
          const caText = document.createElement("span");
          caText.style.cssText = "font-family:monospace;font-size:11px;color:var(--text-muted);";
          caText.textContent = p.position ? `${p.position.slice(0, 4)}...${p.position.slice(-4)}` : "??";

          const copyBtn = document.createElement("button");
          copyBtn.className = "btn-ghost btn-xs";
          copyBtn.style.padding = "2px 4px";
          copyBtn.textContent = "Copy";
          copyBtn.onclick = async () => {
            const ok = await copyTextToClipboard(p.position || "");
            if (ok) {
              copyBtn.textContent = "✓";
              copyBtn.style.color = "var(--success)";
            } else {
              copyBtn.textContent = "Err";
              copyBtn.style.color = "var(--danger)";
            }
            setTimeout(() => {
              copyBtn.textContent = "Copy";
              copyBtn.style.color = "";
            }, 1000);
          };
          divCA.appendChild(caText);
          divCA.appendChild(copyBtn);

          tdPair.appendChild(divPair);
          tdPair.appendChild(divCA);
          tr.appendChild(tdPair);

          // Col 2: Amount (Initial SOL)
          const tdAmount = document.createElement("td");
          tdAmount.style.cssText = "font-weight:600;color:var(--text-primary);";
          tdAmount.textContent = p.amount_sol ? `${Number(p.amount_sol).toFixed(2)} SOL` : "--";
          tr.appendChild(tdAmount);

          // Col 3: Closed PnL
          const tdPeak = document.createElement("td");
          tdPeak.style.cssText = "white-space:nowrap;";
          const pnlPct = p.close_pnl_pct ?? 0;
          const pnlUsd = p.close_pnl_usd ?? 0;
          const pnlColor = pnlPct > 0 ? 'var(--success)'
            : pnlPct < 0 ? 'var(--danger)' : 'var(--text-secondary)';
          const pnlSign = pnlPct > 0 ? '+' : '';

          const pnlPctEl = document.createElement("div");
          pnlPctEl.style.cssText = `font-weight:700;font-size:13px;color:${pnlColor};`;
          pnlPctEl.textContent = `${pnlSign}${Number(pnlPct).toFixed(2)}%`;

          const pnlUsdEl = document.createElement("div");
          pnlUsdEl.style.cssText = `font-size:10px;font-family:'JetBrains Mono';color:${pnlColor};opacity:0.85;margin-top:1px;`;
          const usdSign = pnlUsd > 0 ? '+' : '';
          pnlUsdEl.textContent = `${usdSign}$${Number(pnlUsd).toFixed(3)}`;

          tdPeak.appendChild(pnlPctEl);
          tdPeak.appendChild(pnlUsdEl);
          tr.appendChild(tdPeak);

          // Col 4: Total Fees
          const tdFees = document.createElement("td");
          tdFees.style.cssText = "color:var(--text-primary);";
          tdFees.textContent = p.total_fees_claimed_usd ? `$${Number(p.total_fees_claimed_usd).toFixed(2)}` : "$0.00";
          tr.appendChild(tdFees);

          // Col 5: Timeline / Duration
          const tdTimeline = document.createElement("td");
          tdTimeline.style.cssText = "font-size:12px;color:var(--text-secondary);line-height:1.4;";

          let durationStr = "--";
          if (p.deployed_at && p.closed_at) {
            const durationMs = new Date(p.closed_at).getTime() - new Date(p.deployed_at).getTime();
            const durationMin = Math.floor(durationMs / 60000);
            if (durationMin >= 0) {
              if (durationMin < 60) {
                durationStr = `${durationMin}m`;
              } else {
                const hrs = Math.floor(durationMin / 60);
                const mins = durationMin % 60;
                durationStr = `${hrs}h ${mins}m`;
              }
            }
          }

          const durationEl = document.createElement("div");
          durationEl.style.cssText = "font-weight:700;color:var(--accent-light);font-size:12px;margin-bottom:2px;";
          durationEl.textContent = `Duration: ${durationStr}`;

          const deployEl = document.createElement("div");
          deployEl.style.cssText = "font-size:11px;color:var(--text-secondary);opacity:0.85;";
          deployEl.textContent = p.deployed_at ? `Opened: ${new Date(p.deployed_at).toLocaleString()}` : "Opened: --";

          const closedEl = document.createElement("div");
          closedEl.style.cssText = "font-size:11px;color:var(--text-muted);opacity:0.85;";
          closedEl.textContent = p.closed_at ? `Closed: ${new Date(p.closed_at).toLocaleString()}` : "Closed: --";

          tdTimeline.appendChild(durationEl);
          tdTimeline.appendChild(deployEl);
          tdTimeline.appendChild(closedEl);
          tr.appendChild(tdTimeline);

          // Col 6: Close Reason
          const tdReason = document.createElement("td");
          tdReason.style.cssText = "font-size:12px;color:var(--text-muted);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

          let reasonStr = "--";
          if (p.notes && p.notes.length > 0) {
            const lastNote = p.notes[p.notes.length - 1];
            if (lastNote.includes("Closed at")) {
              reasonStr = lastNote.split("Closed at")[1].replace(/^[^:]*:\s*/, "");
            } else {
              reasonStr = lastNote;
            }
          }
          tdReason.textContent = reasonStr;
          tdReason.title = reasonStr;
          tr.appendChild(tdReason);

          container.appendChild(tr);
        });
    }

    function renderPositionsTable() {
      const container = document.getElementById("positions-list");
      if (!container) return;
      container.replaceChildren();

      if (dashboardState.positions.length === 0) {
        const div = document.createElement("div");
        div.style.cssText = "grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-muted);font-size:13px;background:var(--bg-surface);border-radius:16px;border:1px solid var(--border-subtle);";
        div.textContent = "No open LP positions found.";
        container.appendChild(div);
        return;
      }

      dashboardState.positions.forEach((p) => {
        const binStep = p.bin_step ?? dashboardState.config?.bin_step ?? 100;
        const totalBins = (p.lower_bin != null && p.upper_bin != null)
          ? (p.upper_bin - p.lower_bin + 1) : null;
        const priceLow  = binToSolPrice(p.lower_bin, binStep, p.decimal_multiplier);
        const priceHigh = binToSolPrice(p.upper_bin, binStep, p.decimal_multiplier);

        const card = document.createElement("div");
        card.className = "pos-card";
        card.style.cssText = "display:flex;flex-direction:column;gap:14px;padding:20px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:16px;position:relative;transition:all 0.2s;";

        // Header: Pair & External link, Strategy & Status
        const header = document.createElement("div");
        header.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;";

        // Left Header: Pair and CA
        const leftHeader = document.createElement("div");
        leftHeader.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;";
        
        const pairDiv = document.createElement("div");
        pairDiv.style.cssText = "display:flex;align-items:center;gap:6px;";
        
        const pairName = document.createElement("span");
        pairName.style.cssText = "font-family:'Space Grotesk';font-size:16px;font-weight:700;color:#fff;";
        pairName.textContent = p.pair;
        
        const metLink = document.createElement("a");
        metLink.href = `https://app.meteora.ag/dlmm/${p.pool}`;
        metLink.target = "_blank";
        metLink.rel = "noopener noreferrer";
        metLink.title = "Open on Meteora";
        metLink.style.cssText = "color:var(--accent-light);opacity:0.7;display:inline-flex;align-items:center;transition:opacity 0.15s;flex-shrink:0;margin-top:1px;";
        metLink.onmouseenter = () => metLink.style.opacity = '1';
        metLink.onmouseleave = () => metLink.style.opacity = '0.7';
        metLink.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>`;
        
        pairDiv.appendChild(pairName);
        pairDiv.appendChild(metLink);
        
        const caDiv = document.createElement("div");
        caDiv.style.cssText = "display:flex;align-items:center;gap:4px;";
        
        const caText = document.createElement("span");
        caText.style.cssText = "font-size:10px;font-family:'JetBrains Mono';color:var(--text-muted);";
        caText.textContent = `${p.pool.slice(0,6)}…${p.pool.slice(-6)}`;
        
        const btnCopy = document.createElement("button");
        btnCopy.title = "Copy pool address";
        btnCopy.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;display:inline-flex;align-items:center;border-radius:4px;transition:all 0.15s;";
        btnCopy.innerHTML = `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
        btnCopy.onclick = async () => {
          const ok = await copyTextToClipboard(p.pool);
          if (ok) {
            btnCopy.innerHTML = `<svg width="11" height="11" fill="none" stroke="#10d9a0" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
          } else {
            showToast('Copy failed', 'error');
          }
          setTimeout(() => { btnCopy.innerHTML = `<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }, 1800);
        };
        
        caDiv.appendChild(caText);
        caDiv.appendChild(btnCopy);
        
        leftHeader.appendChild(pairDiv);
        leftHeader.appendChild(caDiv);
        header.appendChild(leftHeader);

        // Right Header: Strategy and Status Badges
        const rightHeader = document.createElement("div");
        rightHeader.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;";
        
        // Status Badge
        rightHeader.appendChild(buildStatusBadge(p));

        // Strategy Badge
        const stratVal = p.strategy || 'default';
        const stratBadge = document.createElement("span");
        stratBadge.style.cssText = "font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;display:inline-block;text-transform:capitalize;border:1px solid transparent;";
        if (stratVal === "spot") {
          stratBadge.style.background = "rgba(16,217,160,0.1)";
          stratBadge.style.color = "var(--success)";
          stratBadge.style.borderColor = "rgba(16,217,160,0.2)";
          stratBadge.textContent = "spot";
        } else if (stratVal === "curve") {
          stratBadge.style.background = "rgba(59,130,246,0.1)";
          stratBadge.style.color = "#60a5fa";
          stratBadge.style.borderColor = "rgba(59,130,246,0.2)";
          stratBadge.textContent = "curve";
        } else if (stratVal === "bid_ask") {
          stratBadge.style.background = "rgba(124,92,255,0.1)";
          stratBadge.style.color = "var(--accent-light)";
          stratBadge.style.borderColor = "rgba(124,92,255,0.2)";
          stratBadge.textContent = "bid-ask";
        } else {
          stratBadge.style.background = "rgba(255,255,255,0.05)";
          stratBadge.style.color = "var(--text-muted)";
          stratBadge.style.borderColor = "rgba(255,255,255,0.1)";
          stratBadge.textContent = stratVal;
        }
        rightHeader.appendChild(stratBadge);
        header.appendChild(rightHeader);
        card.appendChild(header);

        // Visual Range Bar
        const rangeContainer = document.createElement("div");
        rangeContainer.style.cssText = "background:rgba(255,255,255,0.02);padding:10px 12px;border-radius:12px;border:1px solid rgba(124,92,255,0.05);";
        
        const priceRow = document.createElement("div");
        priceRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:4px;color:var(--text-secondary);font-size:11px;font-family:'JetBrains Mono';margin-bottom:8px;";
        
        const priceLabel = document.createElement("span");
        priceLabel.style.cssText = "color:var(--text-muted);font-weight:600;font-size:9px;text-transform:uppercase;";
        priceLabel.textContent = "Price Range";
        
        const priceRangeDiv = document.createElement("div");
        priceRangeDiv.style.cssText = "display:flex;align-items:center;gap:4px;";
        
        if (priceLow != null && priceHigh != null) {
          const lowNode = formatPriceSubscript(priceLow);
          const highNode = formatPriceSubscript(priceHigh);
          const separator = document.createElement("span");
          separator.style.cssText = "color:var(--text-muted);font-size:10px;margin:0 2px;";
          separator.textContent = '→';
          
          if (lowNode instanceof DocumentFragment) priceRangeDiv.appendChild(lowNode);
          else priceRangeDiv.appendChild(document.createTextNode(lowNode));
          priceRangeDiv.appendChild(separator);
          if (highNode instanceof DocumentFragment) priceRangeDiv.appendChild(highNode);
          else priceRangeDiv.appendChild(document.createTextNode(highNode));
        } else {
          priceRangeDiv.style.color = 'var(--text-muted)';
          priceRangeDiv.textContent = '--';
        }
        priceRow.appendChild(priceLabel);
        priceRow.appendChild(priceRangeDiv);
        rangeContainer.appendChild(priceRow);

        const rangeBarWrap = document.createElement("div");
        rangeBarWrap.appendChild(buildRangeBar(p));
        rangeContainer.appendChild(rangeBarWrap);
        card.appendChild(rangeContainer);

        // Stats Grid (Value, PnL, Fees, Yield, Age, Bins)
        const statsGrid = document.createElement("div");
        statsGrid.style.cssText = "display:grid;grid-template-columns:repeat(2, 1fr);gap:12px 16px;padding:12px 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle);";

        // 1. Value
        const valDiv = document.createElement("div");
        const valLabel = document.createElement("div"); valLabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);"; valLabel.textContent = "Value";
        const valValue = document.createElement("div"); valValue.style.cssText = "font-size:13px;font-weight:700;color:var(--text-primary);margin-top:2px;"; valValue.textContent = `$${Number(p.total_value_usd).toFixed(2)}`;
        valDiv.appendChild(valLabel); valDiv.appendChild(valValue);

        // 2. PnL
        const pnlDiv = document.createElement("div");
        const pnlLabel = document.createElement("div"); pnlLabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);"; pnlLabel.textContent = "PnL";
        const pnlValDiv = document.createElement("div");
        pnlValDiv.style.cssText = "display:flex;align-items:baseline;gap:6px;margin-top:2px;";
        
        const pnlPct = p.pnl_pct ?? null;
        const pnlUsd = p.pnl_usd ?? null;
        const pnlColor = pnlPct == null ? 'var(--text-muted)' : pnlPct > 0 ? 'var(--success)' : pnlPct < 0 ? 'var(--danger)' : 'var(--text-secondary)';
        const pnlSign = pnlPct != null && pnlPct > 0 ? '+' : '';
        
        const pnlPctSpan = document.createElement("span");
        pnlPctSpan.style.cssText = `font-size:13px;font-weight:700;color:${pnlColor};`;
        pnlPctSpan.textContent = pnlPct != null ? `${pnlSign}${pnlPct.toFixed(2)}%` : '--';
        
        const pnlUsdSpan = document.createElement("span");
        pnlUsdSpan.style.cssText = `font-size:10px;font-family:'JetBrains Mono';color:${pnlColor};opacity:0.8;`;
        if (pnlUsd != null) {
          const usdSign = pnlUsd > 0 ? '+' : '';
          pnlUsdSpan.textContent = `(${usdSign}$${Number(pnlUsd).toFixed(2)})`;
        }
        pnlValDiv.appendChild(pnlPctSpan);
        if (pnlUsd != null) pnlValDiv.appendChild(pnlUsdSpan);
        pnlDiv.appendChild(pnlLabel); pnlDiv.appendChild(pnlValDiv);

        // 3. Fees
        const feesDiv = document.createElement("div");
        const feesLabel = document.createElement("div"); feesLabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);"; feesLabel.textContent = "Unclaimed Fees";
        const feesValue = document.createElement("div"); feesValue.style.cssText = "font-size:13px;font-weight:700;color:var(--success);margin-top:2px;"; feesValue.textContent = `$${Number(p.unclaimed_fees_usd).toFixed(4)}`;
        feesDiv.appendChild(feesLabel); feesDiv.appendChild(feesValue);

        // 4. Yield (24h)
        const yieldDiv = document.createElement("div");
        const yieldLabel = document.createElement("div"); yieldLabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);"; yieldLabel.textContent = "Yield (24h)";
        const yieldValue = document.createElement("div"); yieldValue.style.cssText = "font-size:13px;font-weight:700;color:var(--accent-light);margin-top:2px;";
        const yVal = p.fee_per_tvl_24h;
        yieldValue.textContent = yVal != null ? `${Number(yVal).toFixed(2)}%` : '--';
        yieldDiv.appendChild(yieldLabel); yieldDiv.appendChild(yieldValue);

        // 5. Age
        const ageDiv = document.createElement("div");
        const ageLabel = document.createElement("div"); ageLabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);"; ageLabel.textContent = "Age";
        const ageValue = document.createElement("div"); ageValue.style.cssText = "font-size:13px;font-weight:600;color:var(--text-secondary);margin-top:2px;";
        const ageMin = p.age_minutes;
        if (ageMin != null && ageMin >= 0) {
          if (ageMin < 60) {
            ageValue.textContent = `${ageMin} min`;
          } else if (ageMin < 1440) {
            const hrs = Math.floor(ageMin / 60);
            const mins = ageMin % 60;
            ageValue.textContent = `${hrs}h ${mins}m`;
          } else {
            const days = Math.floor(ageMin / 1440);
            const hrs = Math.floor((ageMin % 1440) / 60);
            ageValue.textContent = `${days}d ${hrs}h`;
          }
        } else {
          ageValue.textContent = '--';
        }
        ageDiv.appendChild(ageLabel); ageDiv.appendChild(ageValue);

        // 6. Bins
        const binsDiv = document.createElement("div");
        const binsLabel = document.createElement("div"); binsLabel.style.cssText = "font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:var(--text-muted);"; binsLabel.textContent = "Bins Size";
        const binsValue = document.createElement("div"); binsValue.style.cssText = "font-size:13px;font-weight:700;color:var(--accent-light);margin-top:2px;";
        binsValue.textContent = totalBins != null ? `${totalBins} bins (step ${binStep})` : '--';
        binsDiv.appendChild(binsLabel); binsDiv.appendChild(binsValue);

        statsGrid.appendChild(valDiv);
        statsGrid.appendChild(pnlDiv);
        statsGrid.appendChild(feesDiv);
        statsGrid.appendChild(yieldDiv);
        statsGrid.appendChild(ageDiv);
        statsGrid.appendChild(binsDiv);
        card.appendChild(statsGrid);

        // Instruction / Idea
        if (p.instruction) {
          const note = document.createElement("div");
          note.style.cssText = "font-size:11px;color:var(--accent-light);background:rgba(124,92,255,0.07);border:1px solid rgba(124,92,255,0.15);border-radius:8px;padding:8px 10px;display:flex;gap:6px;";
          const icon = document.createElement("span"); icon.textContent = "💡";
          const text = document.createElement("span"); text.textContent = p.instruction;
          note.appendChild(icon); note.appendChild(text);
          card.appendChild(note);
        }

        // Actions
        const actionsDiv = document.createElement("div");
        actionsDiv.style.cssText = "display:flex;gap:8px;margin-top:auto;justify-content:flex-end;";

        const btnNote = document.createElement("button");
        btnNote.className = "btn-ghost btn-sm";
        btnNote.style.cssText = "padding:6px 12px;font-size:12px;";
        btnNote.textContent = p.instruction ? "✏ Edit Note" : "+ Note";
        btnNote.onclick = () => showPositionNoteModal(p.position, p.instruction || "");

        const btnClose = document.createElement("button");
        btnClose.className = "btn-danger btn-sm";
        btnClose.style.cssText = "padding:6px 12px;font-size:12px;box-shadow:none;";
        btnClose.textContent = "Close Position";
        btnClose.onclick = () => handleClosePosition(p.position, p.pair);

        actionsDiv.appendChild(btnNote);
        actionsDiv.appendChild(btnClose);
        card.appendChild(actionsDiv);

        container.appendChild(card);
      });
    }

    // Render dashboard grid
    function showPositionNoteModal(position, instruction) {
      document.getElementById("note-position-address").value = position;
      document.getElementById("note-text").value = instruction;
      document.getElementById("position-note-modal").showModal();
    }

    document.getElementById("position-note-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const position    = document.getElementById("note-position-address").value;
      const instruction = document.getElementById("note-text").value;
      try {
        const res = await fetch("/api/positions/instruction", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ position, instruction })
        });
        if (!res.ok) throw new Error();
        showToast("Instruction note saved successfully.");
        document.getElementById("position-note-modal").close();
        loadPositions();
      } catch {
        showToast("Failed to save instruction note", "error");
      }
    });

    // Close position
    function handleClosePosition(position, pairName) {
      closePositionPendingAddr = position;
      closePositionPendingPair = pairName;
      const pairSpan = document.getElementById("close-confirm-pair");
      if (pairSpan) pairSpan.textContent = pairName;
      document.getElementById("close-confirm-modal").showModal();
    }

    document.getElementById("btn-confirm-close").addEventListener("click", async () => {
      document.getElementById("close-confirm-modal").close();
      const position = closePositionPendingAddr;
      const pairName = closePositionPendingPair;
      if (!position) return;

      showToast(`Initiating close for ${pairName}…`, "info");
      try {
        const res = await fetch("/api/positions/close", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ position })
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.success) {
          showToast(`Closed ${pairName}. PnL: $${Number(data.pnl_usd).toFixed(2)}`);
          loadPositions();
        } else {
          showToast(`Failed to close: ${data.error || "unknown error"}`, "error");
        }
      } catch {
        showToast("Close transaction failed", "error");
      }
    });

    // Load candidates
