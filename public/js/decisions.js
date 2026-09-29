let currentCandidateTab = "passed";

function switchCandidateTab(tab) {
  currentCandidateTab = tab;
  const btnPassed = document.getElementById("tab-btn-cand-passed");
  const btnFiltered = document.getElementById("tab-btn-cand-filtered");
  const panelPassed = document.getElementById("panel-cand-passed");
  const panelFiltered = document.getElementById("panel-cand-filtered");

  if (tab === "passed") {
    btnPassed?.classList.add("active");
    btnFiltered?.classList.remove("active");
    if (panelPassed) panelPassed.style.display = "block";
    if (panelFiltered) panelFiltered.style.display = "none";
  } else {
    btnPassed?.classList.remove("active");
    btnFiltered?.classList.add("active");
    if (panelPassed) panelPassed.style.display = "none";
    if (panelFiltered) panelFiltered.style.display = "block";
  }
}

function quickCheckFilter(address) {
  if (!address) return;
  const input = document.getElementById("chk-filter-address");
  if (input) {
    input.value = address;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
    checkAddressFilters();
  }
}

async function loadCandidates() {
  const tbodyPassed = document.getElementById("screener-table-body");
  const tbodyFiltered = document.getElementById("screener-filtered-table-body");
  
  if (tbodyPassed) {
    tbodyPassed.replaceChildren();
    const trLoading = document.createElement("tr");
    const tdLoading = document.createElement("td"); tdLoading.colSpan = 7;
    tdLoading.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;";
    tdLoading.textContent = "Loading candidate pools…";
    trLoading.appendChild(tdLoading); tbodyPassed.appendChild(trLoading);
  }

  try {
    const res = await fetch("/api/candidates");
    const data = await res.json();
    dashboardState.candidates = data.candidates || data.pools || [];
    dashboardState.candidatesFiltered = data.filtered_examples || [];

    // Update Tab Counts
    const badgePassed = document.getElementById("badge-cand-passed-count");
    const badgeFiltered = document.getElementById("badge-cand-filtered-count");
    if (badgePassed) badgePassed.textContent = dashboardState.candidates.length;
    if (badgeFiltered) badgeFiltered.textContent = dashboardState.candidatesFiltered.length;

    // Render Passed Candidates
    if (tbodyPassed) {
      tbodyPassed.replaceChildren();
      if (dashboardState.candidates.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td"); td.colSpan = 7;
        td.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;";
        td.innerHTML = 'No pools passed all filters.<br><span style="font-size:11px;color:var(--text-muted);opacity:0.8;">Klik tab <b>Filtered / Rejected Pools</b> di atas untuk melihat token yang tereliminasi & alasannya.</span>';
        tr.appendChild(td); tbodyPassed.appendChild(tr);
      } else {
        dashboardState.candidates.forEach((c) => {
          const tr = document.createElement("tr");

          // Name / CA / Pool
          const tdName = document.createElement("td");
          const divName = document.createElement("div");
          divName.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
          const spanName = document.createElement("span");
          spanName.style.cssText = "font-weight:700;color:var(--text-primary);font-size:14px;";
          spanName.textContent = c.name;
          divName.appendChild(spanName);

          const baseMint = c.base?.mint || "";
          const poolAddr = c.pool || "";

          if (poolAddr) {
            const metLink = document.createElement("a");
            metLink.href = `https://app.meteora.ag/dlmm/${poolAddr}`;
            metLink.target = "_blank";
            metLink.rel = "noopener noreferrer";
            metLink.title = "Open on Meteora DLMM";
            metLink.style.cssText = "color:var(--accent-light);display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s;padding:2px 5px;border-radius:4px;background:rgba(124,92,255,0.12);border:1px solid rgba(124,92,255,0.25);gap:3px;font-size:10px;font-weight:700;text-decoration:none;";
            metLink.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg><span>MET</span>`;
            divName.appendChild(metLink);
          }

          if (baseMint) {
            const gmgnLink = document.createElement("a");
            gmgnLink.href = `https://gmgn.ai/sol/token/${baseMint}`;
            gmgnLink.target = "_blank";
            gmgnLink.rel = "noopener noreferrer";
            gmgnLink.title = "Open on GMGN";
            gmgnLink.style.cssText = "color:var(--success);display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s;padding:2px 5px;border-radius:4px;background:rgba(16,217,160,0.12);border:1px solid rgba(16,217,160,0.25);gap:3px;font-size:10px;font-weight:700;text-decoration:none;";
            gmgnLink.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg><span>GMGN</span>`;
            divName.appendChild(gmgnLink);
          }

          tdName.appendChild(divName);

          if (baseMint) {
            const divCA = document.createElement("div");
            divCA.style.cssText = "display:flex;align-items:center;gap:4px;font-size:10px;font-family:'JetBrains Mono';color:var(--text-muted);margin-top:2px;";
            
            const labelCA = document.createElement("span");
            labelCA.textContent = `CA: ${baseMint.slice(0,6)}…${baseMint.slice(-6)}`;
            
            const btnCopyCA = document.createElement("button");
            btnCopyCA.title = "Copy Contract Address (CA)";
            btnCopyCA.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;display:inline-flex;align-items:center;border-radius:4px;transition:all 0.15s;";
            btnCopyCA.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
            btnCopyCA.onclick = async (e) => {
              e.stopPropagation();
              const ok = await copyTextToClipboard(baseMint);
              if (ok) {
                btnCopyCA.innerHTML = `<svg width="10" height="10" fill="none" stroke="#10d9a0" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
              } else {
                showToast('Copy CA failed', 'error');
              }
              setTimeout(() => { btnCopyCA.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }, 1500);
            };
            
            divCA.appendChild(labelCA);
            divCA.appendChild(btnCopyCA);
            tdName.appendChild(divCA);
          }

          if (poolAddr) {
            const divAddr = document.createElement("div");
            divAddr.style.cssText = "display:flex;align-items:center;gap:4px;font-size:9px;font-family:'JetBrains Mono';color:var(--text-muted);margin-top:1px;";
            
            const labelPool = document.createElement("span");
            labelPool.textContent = `PL: ${poolAddr.slice(0,6)}…${poolAddr.slice(-6)}`;
            
            const btnCopyPool = document.createElement("button");
            btnCopyPool.title = "Copy Pool Address";
            btnCopyPool.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;display:inline-flex;align-items:center;border-radius:4px;transition:all 0.15s;";
            btnCopyPool.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
            btnCopyPool.onclick = async (e) => {
              e.stopPropagation();
              const ok = await copyTextToClipboard(poolAddr);
              if (ok) {
                btnCopyPool.innerHTML = `<svg width="10" height="10" fill="none" stroke="#10d9a0" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
              } else {
                showToast('Copy Pool failed', 'error');
              }
              setTimeout(() => { btnCopyPool.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }, 1500);
            };
            
            divAddr.appendChild(labelPool);
            divAddr.appendChild(btnCopyPool);
            tdName.appendChild(divAddr);
          }
          tr.appendChild(tdName);

          // Fee ratio
          const tdRatio = document.createElement("td"); tdRatio.style.cssText = "font-weight:700;color:var(--accent-light);";
          tdRatio.textContent = `${Number(c.fee_active_tvl_ratio || c.fee_tvl_ratio || 0).toFixed(2)}%`;
          tr.appendChild(tdRatio);

          // Vol/TVL
          const tdMet = document.createElement("td");
          const dv = document.createElement("div"); dv.style.cssText = "font-weight:600;color:var(--text-primary);"; dv.textContent = `Vol: $${Math.round(c.volume_window||0).toLocaleString()}`;
          const dt = document.createElement("div"); dt.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:2px;"; dt.textContent = `TVL: $${Math.round(c.tvl||c.active_tvl||0).toLocaleString()}`;
          tdMet.appendChild(dv); tdMet.appendChild(dt); tr.appendChild(tdMet);

          // Organic score
          const tdOrg = document.createElement("td"); tdOrg.style.cssText = "font-weight:600;color:var(--text-secondary);"; tdOrg.textContent = c.organic_score || "--"; tr.appendChild(tdOrg);

          // Volatility
          const tdVol = document.createElement("td"); tdVol.style.cssText = "font-weight:600;color:var(--text-secondary);"; tdVol.textContent = c.volatility || "--"; tr.appendChild(tdVol);

          // Detail
          const tdDetail = document.createElement("td");
          const btnDetail = document.createElement("button"); btnDetail.className = "btn-ghost btn-xs"; btnDetail.style.cssText = "font-size:11px;padding:4px 10px;border-radius:6px;white-space:nowrap;"; btnDetail.textContent = "Detail"; btnDetail.onclick = () => showPoolDetailModal(c, dashboardState.candidatesFiltered);
          tdDetail.appendChild(btnDetail); tr.appendChild(tdDetail);

          // Deploy
          const tdDeploy = document.createElement("td");
          const btnDeploy = document.createElement("button"); btnDeploy.className = "btn-primary btn-xs"; btnDeploy.textContent = "Deploy LP"; btnDeploy.onclick = () => showDeployModal(c);
          tdDeploy.appendChild(btnDeploy); tr.appendChild(tdDeploy);

          tbodyPassed.appendChild(tr);
        });
      }
    }

    // Render Filtered Pools
    renderFilteredCandidates(dashboardState.candidatesFiltered);

  } catch (err) {
    if (tbodyPassed) tbodyPassed.replaceChildren();
    showToast("Failed to fetch pool candidates", "error");
  }
}

function renderFilteredCandidates(filteredPools) {
  const tbody = document.getElementById("screener-filtered-table-body");
  if (!tbody) return;
  tbody.replaceChildren();

  if (!filteredPools || filteredPools.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;";
    td.textContent = "Tidak ada pool yang terfilter / ditolak pada sesi screening ini.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  filteredPools.forEach((c) => {
    const tr = document.createElement("tr");

    // Column 1: Name / CA / Pool
    const tdName = document.createElement("td");
    const divName = document.createElement("div");
    divName.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
    const spanName = document.createElement("span");
    spanName.style.cssText = "font-weight:700;color:var(--text-primary);font-size:14px;";
    spanName.textContent = c.name || "Unknown Token";
    divName.appendChild(spanName);

    const baseMint = c.base?.mint || c.base_mint || "";
    const poolAddr = c.pool || "";

    if (poolAddr) {
      const metLink = document.createElement("a");
      metLink.href = `https://app.meteora.ag/dlmm/${poolAddr}`;
      metLink.target = "_blank";
      metLink.rel = "noopener noreferrer";
      metLink.title = "Open on Meteora DLMM";
      metLink.style.cssText = "color:var(--accent-light);display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s;padding:2px 5px;border-radius:4px;background:rgba(124,92,255,0.12);border:1px solid rgba(124,92,255,0.25);gap:3px;font-size:10px;font-weight:700;text-decoration:none;";
      metLink.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg><span>MET</span>`;
      divName.appendChild(metLink);
    }

    if (baseMint) {
      const gmgnLink = document.createElement("a");
      gmgnLink.href = `https://gmgn.ai/sol/token/${baseMint}`;
      gmgnLink.target = "_blank";
      gmgnLink.rel = "noopener noreferrer";
      gmgnLink.title = "Open on GMGN";
      gmgnLink.style.cssText = "color:var(--success);display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s;padding:2px 5px;border-radius:4px;background:rgba(16,217,160,0.12);border:1px solid rgba(16,217,160,0.25);gap:3px;font-size:10px;font-weight:700;text-decoration:none;";
      gmgnLink.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg><span>GMGN</span>`;
      divName.appendChild(gmgnLink);
    }

    tdName.appendChild(divName);

    if (baseMint) {
      const divCA = document.createElement("div");
      divCA.style.cssText = "display:flex;align-items:center;gap:4px;font-size:10px;font-family:'JetBrains Mono';color:var(--text-muted);margin-top:2px;";
      
      const labelCA = document.createElement("span");
      labelCA.textContent = `CA: ${baseMint.slice(0,6)}…${baseMint.slice(-6)}`;
      
      const btnCopyCA = document.createElement("button");
      btnCopyCA.title = "Copy Contract Address (CA)";
      btnCopyCA.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;display:inline-flex;align-items:center;border-radius:4px;transition:all 0.15s;";
      btnCopyCA.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
      btnCopyCA.onclick = async (e) => {
        e.stopPropagation();
        const ok = await copyTextToClipboard(baseMint);
        if (ok) {
          btnCopyCA.innerHTML = `<svg width="10" height="10" fill="none" stroke="#10d9a0" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
        } else {
          showToast('Copy CA failed', 'error');
        }
        setTimeout(() => { btnCopyCA.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }, 1500);
      };
      
      divCA.appendChild(labelCA);
      divCA.appendChild(btnCopyCA);
      tdName.appendChild(divCA);
    }

    if (poolAddr) {
      const divAddr = document.createElement("div");
      divAddr.style.cssText = "display:flex;align-items:center;gap:4px;font-size:9px;font-family:'JetBrains Mono';color:var(--text-muted);margin-top:1px;";
      
      const labelPool = document.createElement("span");
      labelPool.textContent = `PL: ${poolAddr.slice(0,6)}…${poolAddr.slice(-6)}`;
      
      const btnCopyPool = document.createElement("button");
      btnCopyPool.title = "Copy Pool Address";
      btnCopyPool.style.cssText = "background:none;border:none;cursor:pointer;color:var(--text-muted);padding:2px;display:inline-flex;align-items:center;border-radius:4px;transition:all 0.15s;";
      btnCopyPool.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
      btnCopyPool.onclick = async (e) => {
        e.stopPropagation();
        const ok = await copyTextToClipboard(poolAddr);
        if (ok) {
          btnCopyPool.innerHTML = `<svg width="10" height="10" fill="none" stroke="#10d9a0" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
        } else {
          showToast('Copy Pool failed', 'error');
        }
        setTimeout(() => { btnCopyPool.innerHTML = `<svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`; }, 1500);
      };
      
      divAddr.appendChild(labelPool);
      divAddr.appendChild(btnCopyPool);
      tdName.appendChild(divAddr);
    }
    tr.appendChild(tdName);

    // Column 2: Rejection Reason
    const tdReason = document.createElement("td");
    const spanReason = document.createElement("span");
    spanReason.className = "reject-reason-tag";
    spanReason.textContent = c.reason || "Filtered by screening rules";
    tdReason.appendChild(spanReason);
    tr.appendChild(tdReason);

    // Column 3: Volume / TVL
    const tdVolTvl = document.createElement("td");
    const dVol = document.createElement("div");
    dVol.style.cssText = "font-weight:600;color:var(--text-primary);";
    dVol.textContent = `Vol: $${Math.round(c.volume_window || 0).toLocaleString()}`;
    const dTvl = document.createElement("div");
    dTvl.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:2px;";
    dTvl.textContent = `TVL: $${Math.round(c.tvl || 0).toLocaleString()}`;
    tdVolTvl.appendChild(dVol);
    tdVolTvl.appendChild(dTvl);
    tr.appendChild(tdVolTvl);

    // Column 4: Fee / Volatility
    const tdFeeVol = document.createElement("td");
    const dFee = document.createElement("div");
    dFee.style.cssText = "font-weight:600;color:var(--accent-light);";
    dFee.textContent = c.fee_active_tvl_ratio != null && Number(c.fee_active_tvl_ratio) > 0 ? `${Number(c.fee_active_tvl_ratio).toFixed(2)}%` : "--";
    const dVolat = document.createElement("div");
    dVolat.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:2px;";
    dVolat.textContent = `Volat: ${c.volatility ?? "--"}`;
    tdFeeVol.appendChild(dFee);
    tdFeeVol.appendChild(dVolat);
    tr.appendChild(tdFeeVol);

    // Column 5: Status Badge
    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge-oor";
    badge.style.cssText = "color:#ff6b8a;border-color:rgba(255,77,109,0.3);background:rgba(255,77,109,0.1);";
    badge.innerHTML = '<span class="badge-dot" style="background:#ff6b8a;"></span>REJECTED';
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    // Column 6: Action Button (Cek Filter)
    const tdAction = document.createElement("td");
    const btnCheck = document.createElement("button");
    btnCheck.className = "btn-secondary btn-xs";
    btnCheck.style.cssText = "font-size:11px;padding:4px 10px;border-radius:6px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;";
    btnCheck.innerHTML = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg> Cek Filter';
    btnCheck.onclick = () => quickCheckFilter(baseMint || poolAddr);
    tdAction.appendChild(btnCheck);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  });
}
    // Pool Screening Detail Modal
    function showPoolDetailModal(candidate, filteredPools) {
      const modal  = document.getElementById("pool-detail-modal");
      const title  = document.getElementById("pool-detail-modal-title");
      const badge  = document.getElementById("pool-detail-modal-badge");
      const sub    = document.getElementById("pool-detail-modal-subtitle");
      const body   = document.getElementById("pool-detail-modal-body");

      title.textContent = candidate.name || "Pool Detail";
      sub.textContent   = `${candidate.pool.slice(0,12)}…${candidate.pool.slice(-8)}`;

      // Badge — this pool passed since it's in the candidates list
      badge.textContent = "✓ PASSED";
      badge.style.cssText = "font-size:10px;font-weight:700;padding:2px 10px;border-radius:99px;letter-spacing:0.06em;background:rgba(16,217,160,0.12);color:var(--success);border:1px solid rgba(16,217,160,0.25);";

      body.replaceChildren();

      // ── Section: PASSED filters ─────────────────────────────────────────
      const passedFilters = [
        { label: "TVL",              value: `$${Math.round(candidate.tvl || candidate.active_tvl || 0).toLocaleString()}`, pass: true },
        { label: "Fee / Active TVL", value: `${Number(candidate.fee_active_tvl_ratio || candidate.fee_tvl_ratio || 0).toFixed(3)}%`, pass: true },
        { label: "Volume (window)",  value: `$${Math.round(candidate.volume_window || 0).toLocaleString()}`, pass: true },
        { label: "Organic Score",    value: String(candidate.organic_score ?? "--"), pass: true },
        { label: "Volatility",       value: String(candidate.volatility ?? "--"), pass: true },
        { label: "Pool Cooldown",    value: "None active", pass: true },
        { label: "Token Cooldown",   value: "None active", pass: true },
        { label: "Dev Blocklist",    value: "Not blocked", pass: true },
        { label: "PVP Risk",         value: candidate.is_pvp ? "Flagged" : "Clear", pass: !candidate.is_pvp },
        { label: "Open Position",    value: "No duplicate", pass: true },
        { label: "Indicator Confirm",value: candidate.indicator_confirmation ? (candidate.indicator_confirmation.confirmed ? "Confirmed" : "Rejected") : "N/A", pass: !candidate.indicator_confirmation || !!candidate.indicator_confirmation.confirmed },
      ];

      const passedSection = _buildDetailSection("✅ Passed Filters", passedFilters, "rgba(16,217,160,0.04)", "rgba(16,217,160,0.12)");
      body.appendChild(passedSection);

      // ── Section: FAILED pools from this screening run ───────────────────
      const failedRows = (filteredPools || []).slice(0, 30).map((f) => ({
        label: f.name || "Unknown pool",
        value: f.reason || "Unknown reason",
        pass: false,
      }));

      if (failedRows.length > 0) {
        const failedSection = _buildDetailSection(
          `❌ Rejected Pools (${failedRows.length} dari screening ini)`,
          failedRows,
          "rgba(255,77,109,0.04)",
          "rgba(255,77,109,0.12)"
        );
        body.appendChild(failedSection);
      } else {
        const emptyDiv = document.createElement("div");
        emptyDiv.style.cssText = "padding:16px 20px;font-size:12px;color:var(--text-muted);";
        emptyDiv.textContent = "Tidak ada pool yang ditolak tercatat di sesi screening ini.";
        body.appendChild(emptyDiv);
      }

      modal.showModal();
    }

    function _buildDetailSection(heading, rows, bgSection, bgHeader) {
      const section = document.createElement("div");
      section.style.cssText = `margin-bottom:0;border-bottom:1px solid var(--border-subtle);background:${bgSection};`;

      // Heading
      const h = document.createElement("div");
      h.style.cssText = `font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--text-muted);padding:10px 20px 8px;background:${bgHeader};border-bottom:1px solid var(--border-subtle);`;
      h.textContent = heading;
      section.appendChild(h);

      rows.forEach((row, i) => {
        const item = document.createElement("div");
        item.style.cssText = `display:flex;align-items:flex-start;gap:10px;padding:9px 20px;font-size:12px;border-bottom:${i < rows.length - 1 ? "1px solid var(--border-subtle)" : "none"};`;

        const icon = document.createElement("span");
        icon.style.cssText = `flex-shrink:0;margin-top:1px;font-size:13px;color:${row.pass ? "var(--success)" : "#ff6b8a"};`;
        icon.textContent = row.pass ? "✓" : "✗";

        const labelEl = document.createElement("span");
        labelEl.style.cssText = "flex:0 0 150px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;";
        labelEl.textContent = row.label;
        labelEl.title = row.label;

        const valEl = document.createElement("span");
        valEl.style.cssText = `flex:1;font-weight:600;color:${row.pass ? "var(--text-primary)" : "#ff6b8a"};word-break:break-word;min-width:0;`;
        valEl.textContent = row.value;

        item.appendChild(icon);
        item.appendChild(labelEl);
        item.appendChild(valEl);
        section.appendChild(item);
      });

      return section;
    }

    // Deploy modal
    function showDeployModal(candidate) {
      document.getElementById("deploy-pool-address").value = candidate.pool;
      document.getElementById("deploy-pool-name").value = candidate.name;
      document.getElementById("deploy-amount").value = dashboardState.status.deployAmountSol || 0.5;
      const parsedVolatility = Number(candidate.volatility);
      let binsBelow = 69;
      if (Number.isFinite(parsedVolatility) && parsedVolatility > 0) {
        binsBelow = Math.max(35, Math.min(150, Math.round(35 + (parsedVolatility / 5) * 115)));
      }
      document.getElementById("deploy-bins-below").value = binsBelow;
      document.getElementById("deploy-error").style.display = "none";
      document.getElementById("deploy-modal").showModal();
    }

    document.getElementById("deploy-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pool_address = document.getElementById("deploy-pool-address").value;
      const pool_name    = document.getElementById("deploy-pool-name").value;
      const amount       = document.getElementById("deploy-amount").value;
      const bins_below   = document.getElementById("deploy-bins-below").value;
      const submitBtn    = document.getElementById("btn-submit-deploy");
      const errEl        = document.getElementById("deploy-error");

      submitBtn.disabled = true; errEl.style.display = "none";
      showToast("Submitting deploy transaction to Solana…", "info");

      try {
        const res = await fetch("/api/candidates/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ pool_address, amount, bins_below, pool_name })
        });
        const data = await res.json();
        if (res.ok && (data.success || (data.position && !data.error))) {
          showToast(`Successfully deployed to ${pool_name}!`);
          document.getElementById("deploy-modal").close();
          loadPositions();
        } else {
          errEl.textContent = data.reason || data.error || "Deploy execution failed.";
          errEl.style.display = "block";
        }
      } catch {
        errEl.textContent = "Deploy connection timeout.";
        errEl.style.display = "block";
      } finally {
        submitBtn.disabled = false;
      }
    });

    // Refresh candidates
    async function triggerScreening() {
      const btn = document.getElementById("btn-trigger-screen");
      btn.disabled = true;
      showToast("Background pool screening cycle started…", "info");
      try {
        await fetch("/api/candidates/screen", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
        setTimeout(loadCandidates, 3000);
      } catch {
        showToast("Screening request failed", "error");
      } finally {
        setTimeout(() => { btn.disabled = false; }, 3000);
      }
    }

    // Load decisions
    const decisionsPagination = { page: 0, perPage: 10 };
    async function loadDecisions() {
      decisionsPagination.page = 0;
      try {
        const res = await fetch("/api/decisions");
        const data = await res.json();
        dashboardState.decisions = Array.isArray(data) ? data : (data.decisions || []);
        renderDashboardDecisionsFeed();
        renderDecisionsPage();
      } catch {
        showToast("Failed to load decisions log", "error");
      }
    }
    function decisionsPage(dir) {
      const total = dashboardState.decisions.length;
      const maxPage = Math.max(0, Math.ceil(total / decisionsPagination.perPage) - 1);
      decisionsPagination.page = Math.min(maxPage, Math.max(0, decisionsPagination.page + dir));
      renderDecisionsPage();
    }
    function renderDecisionsPage() {
      const tbody = document.getElementById("decisions-table-body");
      tbody.replaceChildren();
      const { page, perPage } = decisionsPagination;
      const all = dashboardState.decisions;
      const total = all.length;
      const start = page * perPage;
      const slice = all.slice(start, start + perPage);

      // Update pager UI
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      document.getElementById("decisions-pager-info").textContent = total === 0 ? "" : `${start + 1}–${Math.min(start + perPage, total)} dari ${total}`;
      document.getElementById("decisions-pager-page").textContent = total === 0 ? "" : `Hal ${page + 1} / ${totalPages}`;
      document.getElementById("decisions-pager-prev").disabled = page === 0;
      document.getElementById("decisions-pager-next").disabled = page >= totalPages - 1;
      document.getElementById("decisions-pager").style.display = total <= perPage ? "none" : "flex";

      if (total === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td"); td.colSpan = 4;
        td.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;";
        td.textContent = "No logged agent decisions yet.";
        tr.appendChild(td); tbody.appendChild(tr); return;
      }

      slice.forEach((d) => {
        const tr = document.createElement("tr");
        const tdTime = document.createElement("td"); tdTime.style.cssText = "font-family:'JetBrains Mono';font-size:11px;color:var(--text-muted);";
        tdTime.textContent = (d.ts || d.timestamp) ? new Date(d.ts || d.timestamp).toLocaleString() : "--"; tr.appendChild(tdTime);
        const tdBadge = document.createElement("td");
        const badge = document.createElement("span");
        badge.style.cssText = "font-size:10px;font-weight:700;padding:2px 10px;border-radius:99px;letter-spacing:0.06em;";
        const type = String(d.type).toLowerCase();
        if (type === "deploy") { badge.style.background = "rgba(16,217,160,0.12)"; badge.style.color = "var(--success)"; badge.style.border = "1px solid rgba(16,217,160,0.25)"; badge.textContent = "DEPLOY"; }
        else if (type === "close") { badge.style.background = "rgba(255,77,109,0.1)"; badge.style.color = "#ff6b8a"; badge.style.border = "1px solid rgba(255,77,109,0.25)"; badge.textContent = "CLOSE"; }
        else if (type === "skip")  { badge.style.background = "rgba(100,80,255,0.08)"; badge.style.color = "var(--text-muted)"; badge.style.border = "1px solid var(--border-subtle)"; badge.textContent = "SKIP"; }
        else { badge.style.background = "rgba(100,80,255,0.08)"; badge.style.color = "var(--text-secondary)"; badge.style.border = "1px solid var(--border-subtle)"; badge.textContent = String(d.type).toUpperCase(); }
        tdBadge.appendChild(badge); tr.appendChild(tdBadge);
        const tdSummary = document.createElement("td"); tdSummary.style.cssText = "font-weight:600;color:var(--text-primary);"; tdSummary.textContent = d.summary; tr.appendChild(tdSummary);
        const tdReason  = document.createElement("td"); tdReason.style.cssText  = "color:var(--text-secondary);font-size:12px;max-width:320px;white-space:normal;line-height:1.5;"; tdReason.textContent  = d.reason; tr.appendChild(tdReason);
        tbody.appendChild(tr);
      });
    }

    // Filter checker logic
    async function checkAddressFilters() {
      const addressInput = document.getElementById("chk-filter-address");
      const address = addressInput.value.trim();
      const btn = document.getElementById("btn-check-filters");
      const modal = document.getElementById("filter-check-modal");
      const modalBody = document.getElementById("filter-check-modal-body");
      
      if (!address) {
        showToast("Masukkan alamat CA / Pool terlebih dahulu", "error");
        return;
      }
      
      btn.disabled = true;
      const origHtml = btn.innerHTML;
      btn.textContent = "Checking...";
      
      // Open modal with loading state
      modalBody.innerHTML = '<div style="color:var(--text-muted);padding:30px 0;text-align:center;font-size:14px;">🔍 Sedang mencari pool dan memeriksa kriteria filter...</div>';
      modal.showModal();
      
      try {
        const res = await fetch(`/api/candidates/check-filter?address=${encodeURIComponent(address)}`);
        const data = await res.json();
        
        if (!res.ok || data.error) {
          modalBody.innerHTML = `<div style="color:#ff4d6d;font-weight:600;padding:30px 0;text-align:center;font-size:14px;">❌ ${data.error || "Gagal melakukan pencarian"}</div>`;
          return;
        }
        
        if (!data.found || !data.results || data.results.length === 0) {
          modalBody.innerHTML = `<div style="color:#ff4d6d;font-weight:600;padding:30px 0;text-align:center;font-size:14px;">❌ Tidak ada pool Meteora DLMM yang ditemukan untuk alamat ini.</div>`;
          return;
        }
        
        let html = "";
        data.results.forEach((r) => {
          const statusBadge = r.passed
            ? '<span style="color:#10d9a0;background:rgba(16,217,160,0.12);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:bold;margin-left:8px;border:1px solid rgba(16,217,160,0.2)">✓ LOLOS FILTER</span>'
            : '<span style="color:#ff4d6d;background:rgba(255,77,109,0.1);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:bold;margin-left:8px;border:1px solid rgba(255,77,109,0.2)">✗ GAGAL FILTER</span>';
            
          html += `
            <div style="border-bottom: 1px dashed var(--border-subtle); padding-bottom: 20px; margin-bottom: 20px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                <div>
                  <strong style="color:var(--text-primary);font-size:15px;">🏊 Pool: ${r.name}</strong>
                  <div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono';margin-top:2px;">Pool Address: ${r.pool}</div>
                </div>
                <div>
                  ${statusBadge}
                </div>
              </div>
              
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-subtle);color:var(--text-muted);text-align:left;">
                    <th style="padding:8px;font-weight:600;">Kriteria / Filter</th>
                    <th style="padding:8px;font-weight:600;">Value Token</th>
                    <th style="padding:8px;font-weight:600;">Batas Minimal/Maksimal</th>
                    <th style="padding:8px;font-weight:600;text-align:center;">Status</th>
                  </tr>
                </thead>
                <tbody>
          `;
          
          r.checks.forEach((chk) => {
            const rowColor = chk.passed ? "transparent" : "rgba(255,77,109,0.03)";
            const statusIcon = chk.passed
              ? '<span style="color:#10d9a0;font-weight:bold;display:flex;align-items:center;justify-content:center;gap:4px;">✓ Lolos</span>'
              : '<span style="color:#ff4d6d;font-weight:bold;display:flex;align-items:center;justify-content:center;gap:4px;">✗ Gagal</span>';
              
            html += `
              <tr style="border-bottom:1px solid rgba(255,255,255,0.02);background:${rowColor};">
                <td style="padding:8px;font-weight:600;color:var(--text-secondary);">${chk.name}</td>
                <td style="padding:8px;font-family:'JetBrains Mono';color:var(--text-primary);">${chk.value}</td>
                <td style="padding:8px;color:var(--text-muted);">${chk.expected}</td>
                <td style="padding:8px;text-align:center;">${statusIcon}</td>
              </tr>
            `;
          });
          
          html += `
                </tbody>
              </table>
            </div>
          `;
        });
        
        modalBody.innerHTML = html;
      } catch (e) {
        modalBody.innerHTML = `<div style="color:#ff4d6d;font-weight:600;padding:30px 0;text-align:center;font-size:14px;">❌ Terjadi kesalahan: ${e.message}</div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    }

    // Dashboard decisions feed
