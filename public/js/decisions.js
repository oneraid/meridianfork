async function loadCandidates() {
      const tbody = document.getElementById("screener-table-body");
      tbody.replaceChildren();
      const trLoading = document.createElement("tr");
      const tdLoading = document.createElement("td"); tdLoading.colSpan = 6;
      tdLoading.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;";
      tdLoading.textContent = "Loading candidate pools…";
      trLoading.appendChild(tdLoading); tbody.appendChild(trLoading);

      try {
        const res = await fetch("/api/candidates");
        const data = await res.json();
        dashboardState.candidates = data.candidates || data.pools || [];

        tbody.replaceChildren();
        if (dashboardState.candidates.length === 0) {
          const tr = document.createElement("tr");
          const td = document.createElement("td"); td.colSpan = 6;
          td.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;";
          td.textContent = "No pools met filters. Try triggering a fresh screening run.";
          tr.appendChild(td); tbody.appendChild(tr); return;
        }

        dashboardState.candidates.forEach((c) => {
          const tr = document.createElement("tr");

          // Name
          const tdName = document.createElement("td");
          const divName = document.createElement("div"); divName.style.cssText = "font-weight:700;color:var(--text-primary);font-size:14px;"; divName.textContent = c.name;
          const divAddr = document.createElement("div"); divAddr.style.cssText = "font-size:9px;font-family:'JetBrains Mono';color:var(--text-muted);margin-top:2px;"; divAddr.textContent = `${c.pool.slice(0,10)}…${c.pool.slice(-10)}`;
          tdName.appendChild(divName); tdName.appendChild(divAddr); tr.appendChild(tdName);

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

          // Deploy
          const tdDeploy = document.createElement("td");
          const btnDeploy = document.createElement("button"); btnDeploy.className = "btn-primary btn-xs"; btnDeploy.textContent = "Deploy LP"; btnDeploy.onclick = () => showDeployModal(c);
          tdDeploy.appendChild(btnDeploy); tr.appendChild(tdDeploy);

          tbody.appendChild(tr);
        });
      } catch {
        tbody.replaceChildren();
        showToast("Failed to fetch pool candidates", "error");
      }
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

    // Dashboard decisions feed
