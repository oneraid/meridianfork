function filterLibraryStrategies() {
      const shape = document.getElementById("cfg-strategy").value;
      const activeStratSelect = document.getElementById("cfg-activeStrategyId");
      if (!activeStratSelect || !window.strategyLibrary) return;
      
      const currentSelected = activeStratSelect.value || window.activeStrategyId;
      activeStratSelect.innerHTML = "";
      
      window.strategyLibrary.forEach(s => {
        const isCompatible = 
          s.lp_strategy === "any" || 
          s.lp_strategy === "mixed" || 
          s.lp_strategy === shape || 
          (s.lp_strategy === "adaptive" && (shape === "bid_ask" || shape === "spot"));
          
        if (isCompatible) {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = `${s.name} (${s.lp_strategy})`;
          activeStratSelect.appendChild(opt);
        }
      });
      
      if (Array.from(activeStratSelect.options).some(opt => opt.value === currentSelected)) {
        activeStratSelect.value = currentSelected;
      } else if (activeStratSelect.options.length > 0) {
        activeStratSelect.selectedIndex = 0;
      }
    }

    // Load config
    async function loadConfig() {
      try {
        const res = await fetch("/api/config");
        const data = await res.json();
        dashboardState.config = data;
        
        // Render RPC Endpoints & API Failover Status
        if (data.rpcStatus) {
          renderRpcStatus(data.rpcStatus);
          startRpcPolling();
        }

        // Pre-set strategy shape value so it can be read by filterLibraryStrategies
        document.getElementById("cfg-strategy").value = data.strategy.strategy;

        // Fetch strategies list
        try {
          const stratRes = await fetch("/api/strategies");
          if (stratRes.ok) {
            const stratData = await stratRes.json();
            window.strategyLibrary = stratData.strategies;
            window.activeStrategyId = stratData.active;
            
            const dlmmShapeSelect = document.getElementById("cfg-strategy");
            if (dlmmShapeSelect) {
              dlmmShapeSelect.onchange = filterLibraryStrategies;
            }
            filterLibraryStrategies();
          }
        } catch (e) {
          console.error("Failed to load strategy library list", e);
        }

        document.getElementById("cfg-deployAmountSol").value = data.management.deployAmountSol;
        document.getElementById("cfg-minSolToOpen").value = data.management.minSolToOpen;
        document.getElementById("cfg-gasReserve").value = data.management.gasReserve;
        document.getElementById("cfg-maxPositions").value = data.risk.maxPositions;
        document.getElementById("cfg-maxDeployAmount").value = data.risk.maxDeployAmount;
        document.getElementById("cfg-solMode").checked = !!data.management.solMode;
        
        document.getElementById("cfg-takeProfitPct").value = data.management.takeProfitPct !== null ? data.management.takeProfitPct : "";
        document.getElementById("cfg-stopLossPct").value = data.management.stopLossPct !== null ? data.management.stopLossPct : "";
        document.getElementById("cfg-trailingTakeProfit").checked = data.management.trailingTakeProfit;
        document.getElementById("cfg-trailingTriggerPct").value = data.management.trailingTriggerPct;
        document.getElementById("cfg-trailingDropPct").value = data.management.trailingDropPct;
        document.getElementById("cfg-outOfRangeBinsToClose").value = data.management.outOfRangeBinsToClose;
        document.getElementById("cfg-outOfRangeWaitMinutes").value = data.management.outOfRangeWaitMinutes;
        document.getElementById("cfg-minFeePerTvl24h").value = data.management.minFeePerTvl24h;
        document.getElementById("cfg-minAgeBeforeYieldCheck").value = data.management.minAgeBeforeYieldCheck;
        
        // New PnL & Auto-Swap settings
        document.getElementById("cfg-pnlConfirmTicks").value = data.pnl?.confirmTicks ?? 2;
        document.getElementById("cfg-autoSwapRetryAttempts").value = data.management.autoSwapRetryAttempts ?? 3;
        document.getElementById("cfg-autoSwapRetryDelayMs").value = data.management.autoSwapRetryDelayMs ?? 3000;

        // SL Cooldown settings
        document.getElementById("cfg-slCooldownEnabled").checked = data.management.slCooldownEnabled ?? true;
        document.getElementById("cfg-slCooldownHours").value = data.management.slCooldownHours ?? 8;

        // Loss Cooldown settings
        document.getElementById("cfg-lossCooldownEnabled").checked = data.management.lossCooldownEnabled ?? true;
        document.getElementById("cfg-lossCooldownPct").value = data.management.lossCooldownPct ?? 3;
        document.getElementById("cfg-lossCooldownHours").value = data.management.lossCooldownHours ?? 3;
        
        document.getElementById("cfg-timeframe").value = data.screening.timeframe;
        document.getElementById("cfg-minVolume").value = data.screening.minVolume;
        document.getElementById("cfg-minTvl").value = data.screening.minTvl;
        document.getElementById("cfg-maxTvl").value = data.screening.maxTvl;
        document.getElementById("cfg-minMcap").value = data.screening.minMcap;
        document.getElementById("cfg-maxMcap").value = data.screening.maxMcap;
        document.getElementById("cfg-minOrganic").value = data.screening.minOrganic;
        document.getElementById("cfg-minHolders").value = data.screening.minHolders;
        document.getElementById("cfg-minTokenAgeHours").value = (data.screening.minTokenAgeHours !== null && data.screening.minTokenAgeHours !== undefined) ? data.screening.minTokenAgeHours : "";
        document.getElementById("cfg-maxTokenAgeHours").value = (data.screening.maxTokenAgeHours !== null && data.screening.maxTokenAgeHours !== undefined) ? data.screening.maxTokenAgeHours : "";
        document.getElementById("cfg-minPctBelowAth").value = data.screening.minPctBelowAth ?? 30;
        document.getElementById("cfg-athSource").value = data.screening.athSource || "meteora";
        document.getElementById("cfg-minBinStep").value = data.screening.minBinStep;
        document.getElementById("cfg-maxBinStep").value = data.screening.maxBinStep;
        document.getElementById("cfg-minFeeActiveTvlRatio").value = data.screening.minFeeActiveTvlRatio;
        document.getElementById("cfg-loneCandidateMinDegen").value = data.screening.loneCandidateMinDegen ?? 50;
        document.getElementById("cfg-minBinsBelow").value = data.strategy.minBinsBelow;
        document.getElementById("cfg-maxBinsBelow").value = data.strategy.maxBinsBelow;
        document.getElementById("cfg-defaultBinsBelow").value = data.strategy.defaultBinsBelow;
        
        // Opportunity Poller & Degen Targets
        document.getElementById("cfg-opportunityPollEnabled").checked = !!data.opportunity?.enabled;
        document.getElementById("cfg-opportunityPollIntervalSec").value = data.opportunity?.pollIntervalSec ?? 45;
        document.getElementById("cfg-opportunityPollLimit").value = data.opportunity?.limit ?? 10;
        document.getElementById("cfg-opportunityMinScore").value = data.opportunity?.minScore ?? 40;
        document.getElementById("cfg-opportunitySmartWalletBonus").value = data.opportunity?.smartWalletScoreBonus ?? 20;
        document.getElementById("cfg-degenTargetVolRatio").value = data.opportunity?.targetVolRatio ?? 20;
        document.getElementById("cfg-degenTargetLpCount").value = data.opportunity?.targetLpCount ?? 40;
        document.getElementById("cfg-degenTargetFeeRatio").value = data.opportunity?.targetFeeRatio ?? 0.20;
        document.getElementById("cfg-degenTargetLiquidity").value = data.opportunity?.targetLiquidity ?? 20000;
        
        document.getElementById("cfg-managementIntervalMin").value = data.schedule.managementIntervalMin;
        document.getElementById("cfg-screeningIntervalMin").value = data.schedule.screeningIntervalMin;
        document.getElementById("cfg-screeningModel").value = data.llm.screeningModel;
        document.getElementById("cfg-managementModel").value = data.llm.managementModel;

        // Chart indicators
        const ind = data.indicators || data.chartIndicators || {};
        document.getElementById("cfg-chartIndicators").checked = !!ind.enabled;
        document.getElementById("cfg-indicatorEntryPreset").value = ind.entryPreset || "supertrend_break";
        document.getElementById("cfg-indicatorExitPreset").value = ind.exitPreset || "supertrend_break";
        document.getElementById("cfg-indicatorIntervals").value = Array.isArray(ind.intervals) ? ind.intervals.join(", ") : (ind.intervals || "5_MINUTE");
        document.getElementById("cfg-indicatorCandles").value = ind.candles ?? 298;
        document.getElementById("cfg-rsiLength").value = ind.rsiLength ?? 2;
        document.getElementById("cfg-rsiOversold").value = ind.rsiOversold ?? 30;
        document.getElementById("cfg-rsiOverbought").value = ind.rsiOverbought ?? 80;
        document.getElementById("cfg-requireAllIntervals").checked = !!ind.requireAllIntervals;
        
        loadActiveCooldowns();
      } catch {
        showToast("Failed to load settings", "error");
      }
    }

    // Save config
    async function saveConfiguration() {
      const changes = {
        deployAmountSol: Number(document.getElementById("cfg-deployAmountSol").value),
        minSolToOpen: Number(document.getElementById("cfg-minSolToOpen").value),
        gasReserve: Number(document.getElementById("cfg-gasReserve").value),
        maxPositions: Math.round(Number(document.getElementById("cfg-maxPositions").value)),
        maxDeployAmount: Number(document.getElementById("cfg-maxDeployAmount").value),
        solMode: document.getElementById("cfg-solMode").checked,
        
        takeProfitPct: document.getElementById("cfg-takeProfitPct").value === "" ? null : Number(document.getElementById("cfg-takeProfitPct").value),
        stopLossPct: document.getElementById("cfg-stopLossPct").value === "" ? null : Number(document.getElementById("cfg-stopLossPct").value),
        trailingTakeProfit: document.getElementById("cfg-trailingTakeProfit").checked,
        trailingTriggerPct: Number(document.getElementById("cfg-trailingTriggerPct").value),
        trailingDropPct: Number(document.getElementById("cfg-trailingDropPct").value),
        outOfRangeBinsToClose: Math.round(Number(document.getElementById("cfg-outOfRangeBinsToClose").value)),
        outOfRangeWaitMinutes: Math.round(Number(document.getElementById("cfg-outOfRangeWaitMinutes").value)),
        minFeePerTvl24h: Number(document.getElementById("cfg-minFeePerTvl24h").value),
        minAgeBeforeYieldCheck: Math.round(Number(document.getElementById("cfg-minAgeBeforeYieldCheck").value)),
        
        // PnL & Auto-swap changes
        pnlConfirmTicks: Math.round(Number(document.getElementById("cfg-pnlConfirmTicks").value)),
        autoSwapRetryAttempts: Math.round(Number(document.getElementById("cfg-autoSwapRetryAttempts").value)),
        autoSwapRetryDelayMs: Math.round(Number(document.getElementById("cfg-autoSwapRetryDelayMs").value)),
        
        timeframe: document.getElementById("cfg-timeframe").value,
        minVolume: Number(document.getElementById("cfg-minVolume").value),
        minTvl: Number(document.getElementById("cfg-minTvl").value),
        maxTvl: Number(document.getElementById("cfg-maxTvl").value),
        minMcap: Number(document.getElementById("cfg-minMcap").value),
        maxMcap: Number(document.getElementById("cfg-maxMcap").value),
        minOrganic: Math.round(Number(document.getElementById("cfg-minOrganic").value)),
        minHolders: Math.round(Number(document.getElementById("cfg-minHolders").value)),
        minTokenAgeHours: document.getElementById("cfg-minTokenAgeHours").value === "" ? null : Math.round(Number(document.getElementById("cfg-minTokenAgeHours").value)),
        maxTokenAgeHours: document.getElementById("cfg-maxTokenAgeHours").value === "" ? null : Math.round(Number(document.getElementById("cfg-maxTokenAgeHours").value)),
        minPctBelowAth: document.getElementById("cfg-minPctBelowAth").value === "" ? null : Math.round(Number(document.getElementById("cfg-minPctBelowAth").value)),
        athSource: document.getElementById("cfg-athSource").value,
        minBinStep: Math.round(Number(document.getElementById("cfg-minBinStep").value)),
        maxBinStep: Math.round(Number(document.getElementById("cfg-maxBinStep").value)),
        minFeeActiveTvlRatio: Number(document.getElementById("cfg-minFeeActiveTvlRatio").value),
        loneCandidateMinDegen: Math.round(Number(document.getElementById("cfg-loneCandidateMinDegen").value)),
        minBinsBelow: Math.round(Number(document.getElementById("cfg-minBinsBelow").value)),
        maxBinsBelow: Math.round(Number(document.getElementById("cfg-maxBinsBelow").value)),
        defaultBinsBelow: Math.round(Number(document.getElementById("cfg-defaultBinsBelow").value)),
        
        // Opportunity Poller changes
        opportunityPollEnabled: document.getElementById("cfg-opportunityPollEnabled").checked,
        opportunityPollIntervalSec: Math.round(Number(document.getElementById("cfg-opportunityPollIntervalSec").value)),
        opportunityPollLimit: Math.round(Number(document.getElementById("cfg-opportunityPollLimit").value)),
        opportunityMinScore: Math.round(Number(document.getElementById("cfg-opportunityMinScore").value)),
        opportunitySmartWalletBonus: Math.round(Number(document.getElementById("cfg-opportunitySmartWalletBonus").value)),
        degenTargetVolRatio: Number(document.getElementById("cfg-degenTargetVolRatio").value),
        degenTargetLpCount: Math.round(Number(document.getElementById("cfg-degenTargetLpCount").value)),
        degenTargetFeeRatio: Number(document.getElementById("cfg-degenTargetFeeRatio").value),
        degenTargetLiquidity: Number(document.getElementById("cfg-degenTargetLiquidity").value),

        // SL Cooldown
        slCooldownEnabled: document.getElementById("cfg-slCooldownEnabled").checked,
        slCooldownHours: Math.max(1, Math.min(48, Math.round(Number(document.getElementById("cfg-slCooldownHours").value)))),

        // Loss Cooldown
        lossCooldownEnabled: document.getElementById("cfg-lossCooldownEnabled").checked,
        lossCooldownPct: Math.max(0.1, Number(document.getElementById("cfg-lossCooldownPct").value || 3)),
        lossCooldownHours: Math.max(0.1, Number(document.getElementById("cfg-lossCooldownHours").value || 3)),
        
        managementIntervalMin: Math.round(Number(document.getElementById("cfg-managementIntervalMin").value)),
        screeningIntervalMin: Math.round(Number(document.getElementById("cfg-screeningIntervalMin").value)),
        screeningModel: document.getElementById("cfg-screeningModel").value,
        managementModel: document.getElementById("cfg-managementModel").value,

        // Chart indicators
        chartIndicatorsEnabled: document.getElementById("cfg-chartIndicators").checked,
        indicatorEntryPreset: document.getElementById("cfg-indicatorEntryPreset").value,
        indicatorExitPreset: document.getElementById("cfg-indicatorExitPreset").value,
        indicatorIntervals: document.getElementById("cfg-indicatorIntervals").value.split(",").map(s => s.trim()).filter(Boolean),
        indicatorCandles: Math.round(Number(document.getElementById("cfg-indicatorCandles").value || 298)),
        rsiLength: Math.round(Number(document.getElementById("cfg-rsiLength").value || 2)),
        rsiOversold: Number(document.getElementById("cfg-rsiOversold").value || 30),
        rsiOverbought: Number(document.getElementById("cfg-rsiOverbought").value || 80),
        requireAllIntervals: document.getElementById("cfg-requireAllIntervals").checked,
      };
      try {
        const res = await fetch("/api/config/update", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ changes })
        });
        if (!res.ok) throw new Error();
        showToast("Configuration saved successfully.");
        loadConfig();
      } catch {
        showToast("Failed to save configurations", "error");
      }
    }

    // Quick actions
    async function triggerQuickAction(actionType) {
      showToast(actionType === "screen" ? "Triggering pool screen…" : "Triggering management run…", "info");
      try {
        const endpoint = actionType === "screen" ? "/api/candidates/screen" : "/api/control/run-management";
        const res = await fetch(endpoint, { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
        if (!res.ok) throw new Error();
        showToast("Agent loop cycle initiated in background.");
      } catch {
        showToast("Failed to trigger agent loops", "error");
      }
    }

    // Clear only bad/negative lessons
    async function clearBadLessons() {
      if (!confirm("⚠️ PANGKAS LESSON BAD / NEGATIF?\n\nIni akan menghapus semua lesson bernilai buruk/negatif (bad, poor, failed) yang menyebabkan LLM ragu-ragu atau trauma saat screening entry.\nLesson GOOD, MANUAL, dan riwayat PERFORMANCE tetap aman tersimpan.\n\nLanjutkan?")) return;
      const statusEl = document.getElementById("clear-lessons-status");
      const btn = document.getElementById("btn-clear-bad-lessons");
      try {
        btn.disabled = true;
        btn.textContent = "Memangkas...";
        const res = await fetch("/api/lessons/clear-bad", {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrfToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        statusEl.style.display = "block";
        statusEl.style.color = "var(--accent-green)";
        statusEl.textContent = `✅ ${data.message}`;
        showToast(data.message, "success");
      } catch (e) {
        statusEl.style.display = "block";
        statusEl.style.color = "#ef4444";
        statusEl.textContent = `❌ Gagal: ${e.message}`;
        showToast("Gagal memangkas lesson bad: " + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.242-4.243 3 3 0 004.242 4.243z"/></svg> Pangkas Lesson Bad';
        setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 5000);
      }
    }
    window.clearBadLessons = clearBadLessons;

    // Clear all lessons with confirmation
    async function clearAllLessons() {
      if (!confirm("⚠️ HAPUS SEMUA LESSONS?\n\nIni akan menghapus semua pembelajaran bot (lessons.json).\nData performance TIDAK akan terhapus.\n\nLanjutkan?")) return;
      const statusEl = document.getElementById("clear-lessons-status");
      const btn = document.getElementById("btn-clear-lessons");
      try {
        btn.disabled = true;
        btn.textContent = "Menghapus...";
        const res = await fetch("/api/lessons/clear-all", {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrfToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        statusEl.style.display = "block";
        statusEl.style.color = "var(--accent-green)";
        statusEl.textContent = `✅ ${data.message}`;
        showToast(data.message, "success");
      } catch (e) {
        statusEl.style.display = "block";
        statusEl.style.color = "#ef4444";
        statusEl.textContent = `❌ Gagal: ${e.message}`;
        showToast("Gagal menghapus lessons: " + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> Hapus Semua Lessons';
        setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 5000);
      }
    }

    // Clear performance data with confirmation
    async function clearPerformanceData() {
      if (!confirm("⚠️ HAPUS DATA PERFORMANCE?\n\nIni akan menghapus semua rekam jejak trade (data untuk Darwin learning).\nLessons TIDAK akan terhapus.\n\nLanjutkan?")) return;
      const statusEl = document.getElementById("clear-lessons-status");
      const btn = document.getElementById("btn-clear-performance");
      try {
        btn.disabled = true;
        btn.textContent = "Menghapus...";
        const res = await fetch("/api/lessons/clear-performance", {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrfToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        statusEl.style.display = "block";
        statusEl.style.color = "#f59e0b";
        statusEl.textContent = `✅ ${data.message}`;
        showToast(data.message, "success");
      } catch (e) {
        statusEl.style.display = "block";
        statusEl.style.color = "#ef4444";
        statusEl.textContent = `❌ Gagal: ${e.message}`;
        showToast("Gagal hapus performance: " + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg> Hapus Data Performance';
        setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 5000);
      }
    }

    // Clear database / history to reset winrate
    async function clearDatabaseHistory() {
      if (!confirm("⚠️ RESET WINRATE / HISTORY DATABASE?\n\nIni akan menghapus seluruh data history posisi yang sudah ditutup.\nPosisi aktif yang sedang berjalan TIDAK akan terhapus.\nWinrate di dashboard akan kembali ke 0%.\n\nLanjutkan?")) return;
      const statusEl = document.getElementById("clear-lessons-status");
      const btn = document.getElementById("btn-clear-history");
      try {
        btn.disabled = true;
        btn.textContent = "Mereset...";
        const res = await fetch("/api/state/clear-history", {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrfToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        statusEl.style.display = "block";
        statusEl.style.color = "var(--accent-blue)";
        statusEl.textContent = `✅ ${data.message}`;
        showToast(data.message, "success");
        // Reload page or status to reflect immediately
        if (typeof loadStatus === "function") loadStatus();
      } catch (e) {
        statusEl.style.display = "block";
        statusEl.style.color = "#ef4444";
        statusEl.textContent = `❌ Gagal: ${e.message}`;
        showToast("Gagal mereset database history: " + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg> Reset Winrate / History';
        setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 5000);
      }
    }
    window.clearDatabaseHistory = clearDatabaseHistory;

    function formatCooldownRemaining(isoString) {
      if (!isoString) return null;
      const ms = new Date(isoString).getTime() - Date.now();
      if (ms <= 0) return "Kedaluwarsa";
      const mins = Math.ceil(ms / 60000);
      if (mins < 60) return `${mins}m lagi`;
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hrs}j ${remMins}m lagi`;
    }

    function renderCooldownModalList(active = []) {
      const body = document.getElementById("cooldown-modal-body");
      const resetAllBtn = document.getElementById("modal-btn-reset-all");
      if (!body) return;

      if (!active || active.length === 0) {
        if (resetAllBtn) resetAllBtn.style.display = "none";
        body.innerHTML = `
          <div style="text-align:center;padding:36px 20px;color:var(--text-muted);font-size:13px;">
            <div style="font-size:36px;margin-bottom:10px;">✨</div>
            <div style="font-weight:700;font-size:15px;color:var(--text-main);margin-bottom:6px;">Tidak Ada Cooldown Aktif</div>
            <div style="max-width:380px;margin:0 auto;line-height:1.5;color:var(--text-muted);">
              Semua pool dan token saat ini bebas dari masa cooldown. Bot akan otomatis menganalisis kandidat saat screening berikutnya.
            </div>
          </div>
        `;
        return;
      }

      if (resetAllBtn) resetAllBtn.style.display = "inline-flex";

      body.innerHTML = active.map(item => {
        const poolRem = item.pool_cooldown ? formatCooldownRemaining(item.pool_cooldown.until) : null;
        const tokenRem = item.token_cooldown ? formatCooldownRemaining(item.token_cooldown.until) : null;

        const poolBadge = item.pool_cooldown ? `
          <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:6px;padding:6px 10px;font-size:12px;">
            <span style="display:flex;align-items:center;gap:6px;color:#fca5a5;">
              <span style="width:6px;height:6px;border-radius:50%;background:#ef4444;"></span>
              <strong>Pool Cooldown</strong>: ${item.pool_cooldown.reason || "Active"}
            </span>
            <span style="color:#f87171;font-weight:600;font-size:11px;">⏱️ ${poolRem}</span>
          </div>
        ` : "";

        const tokenBadge = item.token_cooldown ? `
          <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.25);border-radius:6px;padding:6px 10px;font-size:12px;">
            <span style="display:flex;align-items:center;gap:6px;color:#d8b4fe;">
              <span style="width:6px;height:6px;border-radius:50%;background:#a855f7;"></span>
              <strong>Token Cooldown</strong>: ${item.token_cooldown.reason || "Active"}
            </span>
            <span style="color:#c084fc;font-weight:600;font-size:11px;">⏱️ ${tokenRem}</span>
          </div>
        ` : "";

        return `
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
              <div>
                <div style="font-size:14px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:8px;">
                  ${item.name}
                  <span style="font-size:10px;background:rgba(255,255,255,0.08);color:var(--text-muted);padding:2px 6px;border-radius:4px;font-family:monospace;">
                    ${item.pool.slice(0, 6)}...${item.pool.slice(-4)}
                  </span>
                </div>
                ${item.base_mint ? `
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:monospace;">
                    Mint: ${item.base_mint.slice(0, 8)}...${item.base_mint.slice(-6)}
                  </div>
                ` : ""}
              </div>
              <button type="button" onclick="resetCooldown('${item.pool}')" class="btn-sm" style="background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:all 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.22)'" onmouseout="this.style.background='rgba(239,68,68,0.12)'">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                Reset Cooldown Ini
              </button>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
              ${poolBadge}
              ${tokenBadge}
            </div>
          </div>
        `;
      }).join("");
    }

    // Open cooldown modal
    async function openCooldownModal() {
      const modal = document.getElementById("cooldown-modal");
      if (!modal) return;
      const body = document.getElementById("cooldown-modal-body");
      if (body) {
        body.innerHTML = `
          <div style="text-align:center;padding:32px 20px;color:var(--text-muted);font-size:13px;">
            <div style="font-size:28px;margin-bottom:8px;">⏳</div>
            Memuat daftar cooldown...
          </div>
        `;
      }
      modal.showModal();

      try {
        const res = await fetch("/api/cooldown/active");
        const data = await res.json();
        const active = data.active || [];
        renderCooldownModalList(active);
        updateCooldownBadge(active.length);
      } catch (e) {
        if (body) {
          body.innerHTML = `
            <div style="text-align:center;padding:24px 20px;color:#ef4444;font-size:13px;">
              Gagal memuat cooldown: ${e.message}
            </div>
          `;
        }
      }
    }
    window.openCooldownModal = openCooldownModal;

    function updateCooldownBadge(count) {
      const badge = document.getElementById("cooldown-active-count-badge");
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }

    // Reset pool & token cooldowns
    async function resetCooldown(poolAddress = null) {
      const isSpecific = Boolean(poolAddress);
      const confirmMsg = isSpecific
        ? `⚠️ RESET COOLDOWN?\n\nIni akan mereset status cooldown untuk pool & token ini agar bot dapat kembali mendeteksi dan masuk jika lolos screening.\n\nLanjutkan?`
        : "⚠️ RESET SEMUA COOLDOWN?\n\nIni akan mereset status cooldown untuk semua pool dan token yang sedang aktif.\nBot akan dapat kembali mendeteksi dan membuka posisi di pool tersebut jika lolos screening.\n\nLanjutkan?";

      if (!confirm(confirmMsg)) return;

      const statusEl = document.getElementById("cooldown-action-status") || document.getElementById("clear-lessons-status");
      const btn = document.getElementById("btn-reset-cooldown");
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Mereset...";
        }
        const res = await fetch("/api/cooldown/reset", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken
          },
          body: JSON.stringify(isSpecific ? { pool: poolAddress } : { all: true })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");

        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.style.color = "#4ade80";
          statusEl.textContent = `✅ ${data.message}`;
        }
        showToast(data.message, "success");

        // Refresh modal if opened and update badge
        await loadActiveCooldowns();
      } catch (e) {
        if (statusEl) {
          statusEl.style.display = "block";
          statusEl.style.color = "#ef4444";
          statusEl.textContent = `❌ Gagal: ${e.message}`;
        }
        showToast("Gagal mereset cooldown: " + e.message, "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Reset Cooldown';
        }
        setTimeout(() => { if (statusEl) statusEl.style.display = "none"; }, 6000);
      }
    }
    window.resetCooldown = resetCooldown;

    // Load and update active cooldowns badge count & modal if open
    async function loadActiveCooldowns() {
      try {
        const res = await fetch("/api/cooldown/active");
        if (!res.ok) return;
        const data = await res.json();
        const active = data.active || [];
        updateCooldownBadge(active.length);

        const modal = document.getElementById("cooldown-modal");
        if (modal && modal.open) {
          renderCooldownModalList(active);
        }
      } catch {
        // silent
      }
    }
    window.loadActiveCooldowns = loadActiveCooldowns;



    // Toggle cron
    async function toggleCronState() {
      const action = dashboardState.status.cronStarted ? "pause" : "resume";
      showToast(`${action === "pause" ? "Pausing" : "Resuming"} cron schedules…`, "info");
      try {
        const res = await fetch("/api/control/toggle-cron", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ action })
        });
        if (!res.ok) throw new Error();
        showToast(`Cron schedules ${action === "pause" ? "paused" : "resumed"}.`);
        loadStatus();
      } catch {
        showToast("Failed to toggle cron status", "error");
      }
    }

    // ═══════════════════ RPC ENDPOINTS & FAILOVER UI ═══════════════════
    let rpcStatusData = null;
    let rpcPollingTimer = null;
    let rpcCountdownTimer = null;

    function safeEscape(str) {
      if (str == null) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function formatCooldownTime(seconds) {
      if (!seconds || seconds <= 0) return "Selesai";
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h > 0) return `${h} jam ${m} mnt`;
      if (m > 0) return `${m} mnt ${s} dtk`;
      return `${s} dtk`;
    }

    let rpcLastProbeResults = {};

    function openRpcDetailModal() {
      const modal = document.getElementById("rpc-detail-modal");
      if (modal) {
        updateRpcStatusUI();
        modal.showModal();
      }
    }

    function closeRpcDetailModal() {
      const modal = document.getElementById("rpc-detail-modal");
      if (modal) modal.close();
    }

    function openAddRpcModal() {
      const modal = document.getElementById("add-rpc-modal");
      if (modal) {
        const form = document.getElementById("add-rpc-form");
        if (form) form.reset();
        onRpcProviderChange("helius");
        modal.showModal();
      }
    }

    function onRpcProviderChange(prov) {
      const labelHelius = document.getElementById("label-prov-helius");
      const labelAlchemy = document.getElementById("label-prov-alchemy");
      const labelCustom = document.getElementById("label-prov-custom");
      const inputLabel = document.getElementById("rpc-input-label");
      const inputVal = document.getElementById("rpc-input-value");
      const inputHint = document.getElementById("rpc-input-hint");
      const nameGroup = document.getElementById("rpc-name-group");

      [labelHelius, labelAlchemy, labelCustom].forEach((l) => {
        if (l) {
          l.style.border = "1px solid var(--border-subtle)";
          l.style.background = "var(--bg-elevated)";
        }
      });

      if (prov === "helius") {
        if (labelHelius) {
          labelHelius.style.border = "1.5px solid var(--accent-light)";
          labelHelius.style.background = "rgba(124,92,255,0.08)";
        }
        if (inputLabel) inputLabel.innerHTML = 'Helius API Key atau Full URL <span style="color:#ef4444;">*</span>';
        if (inputVal) inputVal.placeholder = "Contoh: 9c2a81fe-7237-44f1-94d8-8ee47baf1011";
        if (inputHint) inputHint.textContent = "Bisa masukkan API Key saja atau full URL Helius (https://mainnet.helius-rpc.com/?api-key=...). Otomatis ditambahkan ke failover list.";
        if (nameGroup) nameGroup.style.display = "none";
      } else if (prov === "alchemy") {
        if (labelAlchemy) {
          labelAlchemy.style.border = "1.5px solid var(--accent-light)";
          labelAlchemy.style.background = "rgba(124,92,255,0.08)";
        }
        if (inputLabel) inputLabel.innerHTML = 'Alchemy API Key atau Full URL <span style="color:#ef4444;">*</span>';
        if (inputHint) inputHint.textContent = "Mendukung API key Alchemy atau URL endpoint RPC lengkap. Node baru otomatis ditambahkan sebagai Alchemy Backup tanpa menimpa node lama.";
        if (nameGroup) nameGroup.style.display = "none";
      } else {
        if (labelCustom) {
          labelCustom.style.border = "1.5px solid var(--accent-light)";
          labelCustom.style.background = "rgba(124,92,255,0.08)";
        }
        if (inputLabel) inputLabel.innerHTML = 'Solana RPC Full HTTP(S) URL <span style="color:#ef4444;">*</span>';
        if (inputVal) inputVal.placeholder = "Contoh: https://example.solana-mainnet.quiknode.pro/...";
        if (inputHint) inputHint.textContent = "Masukkan full HTTPS URL untuk QuickNode, Triton, Shyft, atau dedicated private node.";
        if (nameGroup) nameGroup.style.display = "block";
      }
    }

    async function submitAddRpc(e) {
      e.preventDefault();
      const provRadios = document.getElementsByName("rpc-provider-type");
      let provider = "helius";
      for (const r of provRadios) {
        if (r.checked) { provider = r.value; break; }
      }
      const valInput = document.getElementById("rpc-input-value");
      const nameInput = document.getElementById("rpc-input-name");
      const value = valInput ? valInput.value.trim() : "";
      const name = nameInput ? nameInput.value.trim() : "";
      if (!value) return;

      const submitBtn = document.getElementById("btn-submit-add-rpc");
      const origHtml = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Menyimpan...";
      }

      try {
        const res = await fetch("/api/rpc/add", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ provider, value, name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gagal menambahkan RPC endpoint");

        showToast(data.message || "Endpoint RPC berhasil ditambahkan!", "success");
        document.getElementById("add-rpc-modal").close();
        if (data.status) {
          renderRpcStatus(data.status);
        } else {
          loadRpcPage();
        }
        // Run auto probe to verify new key
        setTimeout(() => probeRpcEndpoints(), 500);
      } catch (err) {
        showToast(`Gagal menambahkan RPC: ${err.message}`, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = origHtml;
        }
      }
    }

    async function deleteRpcEndpoint(idOrUrl, name) {
      if (!confirm(`Hapus endpoint "${name}" dari konfigurasi failover?\n\nTindakan ini akan menghapus key dari file .env.`)) return;

      try {
        const res = await fetch("/api/rpc/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ url: idOrUrl })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gagal menghapus RPC endpoint");

        showToast(data.message || "Endpoint RPC berhasil dihapus", "success");
        if (data.status) {
          renderRpcStatus(data.status);
        } else {
          loadRpcPage();
        }
      } catch (err) {
        showToast(`Gagal menghapus RPC: ${err.message}`, "error");
      }
    }

    async function loadRpcPage() {
      try {
        const res = await fetch("/api/rpc/status");
        if (res.ok) {
          const data = await res.json();
          renderRpcStatus(data);
          startRpcPolling();
        }
      } catch (err) {
        console.error("Gagal memuat status RPC:", err);
      }
    }

    function updateRpcStatusUI() {
      if (!rpcStatusData) return;
      const tbody = document.getElementById("cfg-rpc-tbody");
      const pageTbody = document.getElementById("rpc-page-tbody");
      const activeBadge = document.getElementById("cfg-rpc-active-badge");
      const modalBadge = document.getElementById("cfg-rpc-modal-badge");
      const summaryCounts = document.getElementById("cfg-rpc-summary-counts");

      const endpoints = rpcStatusData.endpoints || [];
      const activeEp = rpcStatusData.active;
      const activeRead = rpcStatusData.activeRead;
      const stats = rpcStatusData.stats || {};
      const limitCount = endpoints.filter((e) => e.isExhausted || e.isCoolingDown).length;
      const standbyCount = endpoints.filter((e) => !e.isActiveWrite && !e.isActiveRead && !e.isExhausted && !e.isCoolingDown).length;

      // Update standalone RPC page header & cards
      const pageActiveName = document.getElementById("rpc-page-active-name");
      if (pageActiveName) {
        pageActiveName.textContent = activeEp ? activeEp.name : "Helius (Primary)";
      }
      const pageActiveSub = document.getElementById("rpc-page-active-sub");
      if (pageActiveSub && activeEp) {
        pageActiveSub.textContent = `Priority #${activeEp.priority} • ${(activeEp.type || "SOLANA").toUpperCase()} (Write Primary)`;
      }
      const pageActivePulse = document.getElementById("rpc-page-active-pulse");
      if (pageActivePulse) {
        pageActivePulse.style.background = activeEp ? "#c084fc" : "#fbbf24";
      }

      // Read node card
      const pageReadName = document.getElementById("rpc-page-read-name");
      if (pageReadName) {
        pageReadName.textContent = activeRead ? activeRead.name : "Solana Public Mainnet";
      }

      // Credit saving stats
      const pageSavedPct = document.getElementById("rpc-page-saved-pct");
      if (pageSavedPct) {
        pageSavedPct.textContent = `${stats.creditsSavedPct || 0}%`;
      }
      const pageSavedSub = document.getElementById("rpc-page-saved-sub");
      if (pageSavedSub) {
        const pub = stats.publicReadCalls || 0;
        const priv = (stats.privateReadCalls || 0) + (stats.privateWriteCalls || 0);
        pageSavedSub.textContent = `${pub} Public Reads • ${priv} Private Calls`;
      }

      // Dual routing banner telemetry counters
      const statsFailovers = document.getElementById("rpc-stats-failovers");
      if (statsFailovers) statsFailovers.textContent = stats.failoverCount || 0;
      const statsReads = document.getElementById("rpc-stats-reads");
      if (statsReads) statsReads.textContent = stats.readCalls || 0;
      const statsWrites = document.getElementById("rpc-stats-writes");
      if (statsWrites) statsWrites.textContent = stats.writeCalls || 0;

      const pageTotalBadge = document.getElementById("rpc-page-total-badge");
      if (pageTotalBadge) pageTotalBadge.textContent = `${endpoints.length} Endpoints`;

      if (activeEp) {
        const activeLabel = `🟢 ${activeEp.name}`;
        if (activeBadge) {
          activeBadge.textContent = activeLabel;
          activeBadge.className = "cfg-badge cfg-badge-green";
        }
        if (modalBadge) {
          modalBadge.textContent = `Active: ${activeEp.name}`;
          modalBadge.className = "cfg-badge cfg-badge-green";
        }
      } else {
        if (activeBadge) {
          activeBadge.textContent = `⚪ Menghubungkan...`;
          activeBadge.className = "cfg-badge";
        }
        if (modalBadge) {
          modalBadge.textContent = `Menghubungkan...`;
          modalBadge.className = "cfg-badge";
        }
      }

      if (summaryCounts) {
        summaryCounts.innerHTML = `&bull; <span style="color:${limitCount > 0 ? '#f87171' : 'var(--text-muted)'};font-weight:${limitCount > 0 ? '600' : '400'};">${limitCount} Limit/Cooldown</span> &bull; <span>${standbyCount} Standby</span>`;
      }

      // Render dedicated RPC page table
      if (pageTbody) {
        if (endpoints.length === 0) {
          pageTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:36px;">Tidak ada RPC endpoint yang terkonfigurasi.</td></tr>`;
        } else {
          pageTbody.innerHTML = endpoints.map((ep) => {
            let statusBadge = "";
            let rowBg = "";
            let cooldownInfo = `<span style="color:var(--text-muted);font-size:12px;">-</span>`;
            const probe = rpcLastProbeResults[ep.name];
            let latencyBadge = `<span style="color:var(--text-muted);font-size:11px;">Belum dites</span>`;

            if (probe) {
              if (probe.ok) {
                const lat = probe.latencyMs || 0;
                const color = lat < 250 ? "var(--success)" : (lat < 600 ? "#fbbf24" : "#ff6b8a");
                latencyBadge = `<span style="font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:${color};background:rgba(255,255,255,0.05);padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);">${lat} ms</span>`;
              } else {
                latencyBadge = `<span style="font-family:'JetBrains Mono';font-size:11px;font-weight:700;color:#f87171;background:rgba(239,68,68,0.1);padding:2px 8px;border-radius:6px;border:1px solid rgba(239,68,68,0.25);">Error</span>`;
              }
            }

            // Role badge
            let roleBadge = "";
            if (ep.type === "public") {
              roleBadge = `<span class="cfg-badge" style="background:rgba(34,197,94,0.15);color:#4ade80;font-size:11px;font-weight:600;border:1px solid rgba(34,197,94,0.3);">🌱 Free Read Primary</span>`;
            } else if (ep.priority === 1) {
              roleBadge = `<span class="cfg-badge" style="background:rgba(168,85,247,0.15);color:#c084fc;font-size:11px;font-weight:600;border:1px solid rgba(168,85,247,0.3);">⚡ Execute Primary</span>`;
            } else if (ep.type === "alchemy") {
              roleBadge = `<span class="cfg-badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;font-size:11px;font-weight:600;border:1px solid rgba(59,130,246,0.3);">🛡️ Execute Backup</span>`;
            } else {
              roleBadge = `<span class="cfg-badge" style="background:rgba(255,255,255,0.06);color:var(--text-muted);font-size:11px;font-weight:600;border:1px solid rgba(255,255,255,0.1);">${safeEscape(ep.role || 'Custom Node')}</span>`;
            }

            if (ep.isActiveWrite && ep.isActiveRead) {
              rowBg = "background:rgba(34, 197, 94, 0.08);";
              statusBadge = `<span class="cfg-badge cfg-badge-green" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;"><span style="width:7px;height:7px;border-radius:50%;background:#4ade80;" class="pulse-dot"></span> ACTIVE (ALL)</span>`;
              cooldownInfo = `<span style="color:#4ade80;font-size:12px;font-weight:600;">⚡ Melayani Read &amp; Write</span>`;
            } else if (ep.isActiveWrite) {
              rowBg = "background:rgba(168, 85, 247, 0.07);";
              statusBadge = `<span class="cfg-badge" style="background:rgba(168,85,247,0.2);color:#c084fc;border:1px solid rgba(168,85,247,0.4);font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;"><span style="width:7px;height:7px;border-radius:50%;background:#c084fc;" class="pulse-dot"></span> ACTIVE (WRITE)</span>`;
              cooldownInfo = `<span style="color:#c084fc;font-size:12px;font-weight:600;">⚡ Melayani Transaksi Kritis</span>`;
            } else if (ep.isActiveRead) {
              rowBg = "background:rgba(34, 197, 94, 0.07);";
              statusBadge = `<span class="cfg-badge cfg-badge-green" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;"><span style="width:7px;height:7px;border-radius:50%;background:#4ade80;" class="pulse-dot"></span> ACTIVE (READ)</span>`;
              cooldownInfo = `<span style="color:#4ade80;font-size:12px;font-weight:600;">🌱 Melayani Polling Gratis</span>`;
            } else if (ep.isExhausted) {
              rowBg = "background:rgba(239, 68, 68, 0.05);";
              statusBadge = `<span class="cfg-badge cfg-badge-red" style="font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;"><span style="width:7px;height:7px;border-radius:50%;background:#ef4444;"></span> LIMIT</span>`;
              cooldownInfo = `
                <div style="font-size:12px;font-weight:600;color:#f87171;">
                  ⏱️ Cooldown: ${formatCooldownTime(ep.cooldownSecondsLeft)}
                </div>
                ${ep.lastError ? `<div style="font-size:10px;color:#fca5a5;margin-top:2px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeEscape(ep.lastError)}">⚠️ ${safeEscape(ep.lastError)}</div>` : ''}
              `;
            } else if (ep.isCoolingDown) {
              rowBg = "background:rgba(245, 158, 11, 0.05);";
              statusBadge = `<span class="cfg-badge cfg-badge-yellow" style="color:#fbbf24;font-weight:700;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;"><span style="width:7px;height:7px;border-radius:50%;background:#fbbf24;"></span> COOLDOWN</span>`;
              cooldownInfo = `
                <div style="font-size:12px;font-weight:600;color:#fbbf24;">
                  ⏱️ Cooldown: ${formatCooldownTime(ep.cooldownSecondsLeft)}
                </div>
              `;
            } else {
              statusBadge = `<span class="cfg-badge" style="background:rgba(255,255,255,0.06);color:var(--text-muted);font-weight:600;display:inline-flex;align-items:center;gap:6px;padding:3px 10px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--text-muted);"></span> STANDBY</span>`;
              cooldownInfo = `<span style="color:var(--text-muted);font-size:12px;">Siap failover otomatis</span>`;
            }

            const canDelete = ep.type !== "public";
            const deleteAction = canDelete
              ? `<button type="button" onclick="deleteRpcEndpoint('${safeEscape(ep.id || ep.url)}', '${safeEscape(ep.name)}')" class="btn-ghost btn-xs" style="color:#f87171;padding:4px 8px;border-radius:6px;font-size:11px;border:1px solid rgba(239,68,68,0.25);cursor:pointer;transition:all 0.18s;" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='none'" title="Hapus dari failover">Hapus</button>`
              : `<span style="font-size:11px;color:var(--text-muted);">-</span>`;

            return `
              <tr style="${rowBg}">
                <td style="padding:12px 16px;vertical-align:middle;">${statusBadge}</td>
                <td style="padding:12px 16px;vertical-align:middle;">
                  <div style="font-weight:700;font-size:13px;color:${ep.isActiveWrite ? '#c084fc' : ep.isActiveRead ? '#4ade80' : 'var(--text-primary)'};">
                    ${safeEscape(ep.name)}
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                    Priority #${ep.priority} &bull; <span style="text-transform:uppercase;letter-spacing:0.04em;">${safeEscape(ep.type)}</span>
                  </div>
                </td>
                <td style="padding:12px 16px;vertical-align:middle;">${roleBadge}</td>
                <td style="padding:12px 16px;vertical-align:middle;">
                  <code style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#93c5fd;background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.06);display:inline-block;word-break:break-all;">
                    ${safeEscape(ep.url || '')}
                  </code>
                </td>
                <td style="padding:12px 16px;vertical-align:middle;">${latencyBadge}</td>
                <td style="padding:12px 16px;vertical-align:middle;">${cooldownInfo}</td>
                <td style="padding:12px 16px;vertical-align:middle;text-align:center;">${deleteAction}</td>
              </tr>
            `;
          }).join("");
        }
      }

      // Render modal table if modal exists
      if (tbody) {
        if (endpoints.length === 0) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">Tidak ada RPC endpoint yang terkonfigurasi.</td></tr>`;
        } else {
          tbody.innerHTML = endpoints.map((ep) => {
            let statusBadge = "";
            let rowBg = "";
            let cooldownInfo = `<span style="color:var(--text-muted);font-size:12px;">-</span>`;

            if (ep.isActive) {
              rowBg = "background:rgba(34, 197, 94, 0.08);";
              statusBadge = `<span class="cfg-badge cfg-badge-green" style="font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#4ade80;"></span> ACTIVE</span>`;
              cooldownInfo = `<span style="color:#4ade80;font-size:11px;font-weight:600;">⚡ Sedang Digunakan</span>`;
            } else if (ep.isExhausted) {
              rowBg = "background:rgba(239, 68, 68, 0.04);";
              statusBadge = `<span class="cfg-badge cfg-badge-red" style="font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;"></span> LIMIT</span>`;
              cooldownInfo = `
                <div style="font-size:11px;font-weight:600;color:#f87171;">
                  ⏱️ Cooldown: ${formatCooldownTime(ep.cooldownSecondsLeft)}
                </div>
                ${ep.lastError ? `<div style="font-size:10px;color:#fca5a5;margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${safeEscape(ep.lastError)}">⚠️ ${safeEscape(ep.lastError)}</div>` : ''}
              `;
            } else if (ep.isCoolingDown) {
              rowBg = "background:rgba(245, 158, 11, 0.04);";
              statusBadge = `<span class="cfg-badge cfg-badge-yellow" style="color:#fbbf24;font-weight:700;display:inline-flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:#fbbf24;"></span> COOLDOWN</span>`;
              cooldownInfo = `
                <div style="font-size:11px;font-weight:600;color:#fbbf24;">
                  ⏱️ Cooldown: ${formatCooldownTime(ep.cooldownSecondsLeft)}
                </div>
              `;
            } else {
              statusBadge = `<span class="cfg-badge" style="background:rgba(255,255,255,0.06);color:var(--text-muted);font-weight:600;display:inline-flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);"></span> STANDBY</span>`;
              cooldownInfo = `<span style="color:var(--text-muted);font-size:11px;">Siap failover</span>`;
            }

            return `
              <tr style="${rowBg}">
                <td style="padding:10px 14px;vertical-align:middle;">${statusBadge}</td>
                <td style="padding:10px 14px;vertical-align:middle;">
                  <div style="font-weight:600;font-size:13px;color:${ep.isActive ? '#4ade80' : 'var(--text-main)'};">
                    ${safeEscape(ep.name)}
                  </div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                    Priority #${ep.priority} &bull; <span style="text-transform:uppercase;">${safeEscape(ep.type)}</span>
                  </div>
                </td>
                <td style="padding:10px 14px;vertical-align:middle;">
                  <code style="font-family:monospace;font-size:11px;color:#93c5fd;background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:5px;display:inline-block;word-break:break-all;">
                    ${safeEscape(ep.url || '')}
                  </code>
                </td>
                <td style="padding:10px 14px;vertical-align:middle;">${cooldownInfo}</td>
              </tr>
            `;
          }).join("");
        }
      }
    }

    function renderRpcStatus(rpcStatus) {
      if (!rpcStatus) return;
      rpcStatusData = rpcStatus;
      updateRpcStatusUI();

      // Start 1s countdown decrementer
      if (!rpcCountdownTimer) {
        rpcCountdownTimer = setInterval(() => {
          if (!rpcStatusData) return;
          const rpcView = document.getElementById("view-lessons");
          const configView = document.getElementById("view-config");
          const isViewActive = (rpcView && rpcView.style.display !== "none") || (configView && configView.style.display !== "none");
          if (isViewActive) {
            let changed = false;
            for (const ep of rpcStatusData.endpoints || []) {
              if (ep.cooldownSecondsLeft > 0) {
                ep.cooldownSecondsLeft -= 1;
                changed = true;
                if (ep.cooldownSecondsLeft <= 0) {
                  ep.isCoolingDown = false;
                  ep.isExhausted = false;
                }
              }
            }
            if (changed) updateRpcStatusUI();
          }
        }, 1000);
      }
    }

    function startRpcPolling() {
      if (rpcPollingTimer) clearInterval(rpcPollingTimer);
      rpcPollingTimer = setInterval(async () => {
        const rpcView = document.getElementById("view-lessons");
        const configView = document.getElementById("view-config");
        const isViewActive = (rpcView && rpcView.style.display !== "none") || (configView && configView.style.display !== "none");
        if (isViewActive) {
          try {
            const res = await fetch("/api/rpc/status");
            if (res.ok) {
              const data = await res.json();
              renderRpcStatus(data);
            }
          } catch {}
        }
      }, 12000);
    }

    async function probeRpcEndpoints() {
      const btn = document.getElementById("btn-probe-rpc");
      const origHtml = btn ? btn.innerHTML : "";
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="animation:spin 1s linear infinite;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Menguji RPC...`;
      }

      showToast("Sedang menguji latensi dan status seluruh endpoint RPC...", "info");

      try {
        const res = await fetch("/api/rpc/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Gagal menguji endpoint");

        if (data.results && Array.isArray(data.results)) {
          data.results.forEach((r) => {
            rpcLastProbeResults[r.name] = r;
          });
          const activeResult = data.results.find((r) => r.name === data.status?.active?.name) || data.results[0];
          if (activeResult) {
            safeText("rpc-page-latency-val", `${activeResult.latencyMs} ms`);
            safeText("rpc-page-slot-val", `Slot: ${activeResult.slot || '--'}`);
          }
        }

        if (data.status) {
          renderRpcStatus(data.status);
        }

        const healthyCount = (data.results || []).filter(r => r.ok).length;
        const totalCount = (data.results || []).length;
        showToast(`Tes selesai: ${healthyCount}/${totalCount} RPC sehat & merespon.`, "success");
      } catch (err) {
        showToast(`Gagal menguji RPC: ${err.message}`, "error");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      }
    }

    // ═══════════════════ MOBILE BOTTOM NAV ═══════════════════
    const BNAV_TABS = ['dashboard', 'positions', 'decisions', 'lessons', 'config'];
    const MORE_TABS = [];
