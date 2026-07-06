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
        
        document.getElementById("cfg-timeframe").value = data.screening.timeframe;
        document.getElementById("cfg-minVolume").value = data.screening.minVolume;
        document.getElementById("cfg-minTvl").value = data.screening.minTvl;
        document.getElementById("cfg-maxTvl").value = data.screening.maxTvl;
        document.getElementById("cfg-minMcap").value = data.screening.minMcap;
        document.getElementById("cfg-maxMcap").value = data.screening.maxMcap;
        document.getElementById("cfg-minOrganic").value = data.screening.minOrganic;
        document.getElementById("cfg-minHolders").value = data.screening.minHolders;
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
        
        managementIntervalMin: Math.round(Number(document.getElementById("cfg-managementIntervalMin").value)),
        screeningIntervalMin: Math.round(Number(document.getElementById("cfg-screeningIntervalMin").value)),
        screeningModel: document.getElementById("cfg-screeningModel").value,
        managementModel: document.getElementById("cfg-managementModel").value,
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

    // ═══════════════════ MOBILE BOTTOM NAV ═══════════════════
    const BNAV_TABS = ['dashboard', 'positions', 'decisions'];
    const MORE_TABS = ['lessons', 'config'];
