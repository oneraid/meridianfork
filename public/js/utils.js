let csrfToken = "";
    let statusInterval = null;
    let positionsInterval = null;
    let historyInterval = null;
    let dashboardState = {
      status: {},
      positions: [],
      positionsHistory: [],
      candidates: [],
      decisions: [],
      lessons: {},
      config: {},
      pnlCalendar: null
    };
    let closePositionPendingAddr = "";
    let closePositionPendingPair = "";


// ─── Shared Utilities ───
    // Safe text helper (XSS prevention)
    function safeText(el, text) {
      if (typeof el === 'string') el = document.getElementById(el);
      if (el) el.textContent = (text !== undefined && text !== null) ? text : "";
    }

    function updateApiStatusEl(id, statusObj) {
      const el = document.getElementById(id);
      if (!el) return;
      if (!statusObj) {
        el.innerHTML = `<span style="color:var(--text-muted);font-size:10px;">UNKNOWN</span>`;
        return;
      }
      if (statusObj.connected) {
        el.innerHTML = `<span style="color:var(--success);font-weight:700;font-size:10px;">✓ OK</span>`;
        el.title = statusObj.detail || "";
      } else {
        el.innerHTML = `<span style="color:var(--danger);font-weight:700;font-size:10px;" title="${statusObj.detail || ""}">✗ ERR</span>`;
      }
    }

    // Toast notifications
    function showToast(message, type = "success") {
      const toast = document.createElement("div");
      toast.className = `toast-item ${type}`;

      const icons = {
        success: "✓",
        error: "✕",
        info: "ℹ"
      };
      const iconEl = document.createElement("span");
      iconEl.textContent = icons[type] || "ℹ";
      iconEl.style.cssText = "font-weight:900;font-size:14px;flex-shrink:0;";

      const msgEl = document.createElement("span");
      msgEl.textContent = message;

      toast.appendChild(iconEl);
      toast.appendChild(msgEl);
      document.getElementById("toast-container").appendChild(toast);

      setTimeout(() => toast.remove(), 4000);
    }

    // Tab switching
    function switchTab(tabId) {
      const tabs = ["dashboard", "positions", "decisions", "lessons", "config"];
      tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const view = document.getElementById(`view-${t}`);
        if (t === tabId) {
          btn.classList.add("active");
          view.style.display = "";
        } else {
          btn.classList.remove("active");
          view.style.display = "none";
        }
      });

      const titles = {
        dashboard: "Overview",
        positions: "LP Positions",
        decisions: "Decisions & Logs",
        lessons: "Lessons & Performance",
        config: "Configuration Settings"
      };
      safeText("view-title", titles[tabId]);

      if (tabId === "dashboard") {
        if (typeof loadPnlCalendar === "function") loadPnlCalendar();
      }
      if (tabId === "decisions") {
        loadDecisions();
        loadCandidates();
      }
      if (tabId === "lessons") loadLessons();
      if (tabId === "config") loadConfig();
    }

    async function handleLogout() {
      await fetch("/api/auth/logout", { method: "POST" });
      clearInterval(statusInterval);
      clearInterval(positionsInterval);
      if (historyInterval) clearInterval(historyInterval);
      csrfToken = "";
      document.getElementById("app-shell").style.display = "none";
      document.getElementById("login-page").style.display = "flex";
      document.getElementById("password-input").value = "";
    }

    // Check session on load
    async function checkSession() {
      try {
        const res = await fetch("/api/status");
        if (res.status === 401) throw new Error("Unauthorized");
        const data = await res.json();
        csrfToken = data.csrfToken;
        document.getElementById("login-page").style.display = "none";
        document.getElementById("app-shell").style.display = "flex";
        startPolling();
        switchTab("dashboard");
      } catch (err) {
        document.getElementById("app-shell").style.display = "none";
        document.getElementById("login-page").style.display = "flex";
      }
    }

    // Polling
    function startPolling() {
      loadStatus();
      loadPositions();
      loadPnlCalendar();
      statusInterval = setInterval(loadStatus, 10000);
      positionsInterval = setInterval(loadPositions, 10000);
      historyInterval = setInterval(loadPnlCalendar, 30000);
    }

    // Build range bar DOM
    function buildRangeBar(p) {
      let progress = 0;
      if (p.upper_bin !== p.lower_bin) {
        progress = ((p.active_bin - p.lower_bin) / (p.upper_bin - p.lower_bin)) * 100;
      }
      progress = Math.max(0, Math.min(100, progress));
      const cls = p.in_range ? "in" : "out";

      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:160px;";

      const labels = document.createElement("div");
      labels.style.cssText = "display:flex;justify-content:space-between;font-size:9px;font-family:'JetBrains Mono';color:var(--text-muted);";
      const lL = document.createElement("span"); lL.textContent = `L:${p.lower_bin}`;
      const lA = document.createElement("span"); lA.textContent = `A:${p.active_bin}`; lA.style.cssText = "color:var(--text-secondary);font-weight:700;";
      const lU = document.createElement("span"); lU.textContent = `U:${p.upper_bin}`;
      labels.appendChild(lL); labels.appendChild(lA); labels.appendChild(lU);

      const track = document.createElement("div");
      track.className = "range-track";
      const fill = document.createElement("div");
      fill.className = `range-fill ${cls}`;
      fill.style.width = `${progress}%`;
      const dot = document.createElement("div");
      dot.className = `range-dot ${cls}`;
      dot.style.left = `${progress}%`;
      track.appendChild(fill);
      track.appendChild(dot);

      wrap.appendChild(labels);
      wrap.appendChild(track);
      return wrap;
    }

    // Calculate total bins count for a position
    function getPositionTotalBins(p) {
      if (!p) return null;
      if (p.total_bins != null) return Number(p.total_bins);
      const lower = p.lower_bin ?? p.bin_range?.min ?? null;
      const upper = p.upper_bin ?? p.bin_range?.max ?? null;
      if (lower != null && upper != null) {
        return Math.abs(upper - lower) + 1;
      }
      if (typeof p.bin_range === "number") {
        return p.bin_range;
      }
      if (p.bin_range && typeof p.bin_range === "object") {
        if (p.bin_range.bins_below != null || p.bin_range.bins_above != null) {
          return (Number(p.bin_range.bins_below) || 0) + (Number(p.bin_range.bins_above) || 0) + 1;
        }
      }
      return null;
    }

    // ─── Price helpers ───────────────────────────────────────────
    // Meteora DLMM: price = (1 + bin_step/10000)^binId
    // Result is tokenX per tokenY. Since we want SOL price (Y/X), we invert.
    function binToSolPrice(binId, binStep, decimalMultiplier = 1) {
      if (binId == null || binStep == null) return null;
      // price of X in terms of Y = (1 + binStep/10000)^binId * decimalMultiplier
      return Math.pow(1 + binStep / 10000, binId) * decimalMultiplier;
    }

    // Format price in the compact subscript notation:
    //   0.05₅000 means 0.05 × 10^-5 leading zeros = 0.0000050
    // We show it as: integer part + subscript zero count + 3 significant digits
    function formatPriceSubscript(price) {
      if (price == null || !isFinite(price) || price <= 0) return '--';

      // Prices >= 0.01 show normally (4 sig figs)
      if (price >= 0.01) {
        return price.toPrecision(4);
      }

      // Use toExponential to reliably count leading zeros and extract digits.
      // e.g. 0.00035298 → "3.5298e-4"
      //      0.000000056 → "5.6e-8"
      const expStr = price.toExponential();
      const [mantissa, eStr] = expStr.split('e');
      const exp = parseInt(eStr);                // e.g. -4, -8
      const leadingZeros = -exp - 1;             // e.g. 3, 7

      // Get significant digits from mantissa string (strip the decimal point)
      // "3.5298" → "35298"  |  "5.6" → "56"
      const sigStr = mantissa.replace('.', '');  // all sig digits as a string
      // Pad to at least 3 chars and take the first 3 (truncate, never round up)
      const digits3 = sigStr.padEnd(3, '0').slice(0, 3);

      // Build DOM node: "0.0" + <sub>n</sub> + "352"
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode('0.0'));
      const sub = document.createElement('sub');
      sub.style.cssText = 'font-size:0.72em;line-height:1;vertical-align:sub;';
      sub.textContent = leadingZeros;
      fragment.appendChild(sub);
      fragment.appendChild(document.createTextNode(digits3));
      return fragment;
    }

    // Status badge
    function buildStatusBadge(p) {
      const badge = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "badge-dot";

      if (p.in_range) {
        badge.className = "badge-in-range";
        dot.style.background = "var(--success)";
        dot.className += " pulse-dot";
        badge.appendChild(dot);
        badge.appendChild(document.createTextNode("IN RANGE"));
      } else {
        badge.className = "badge-oor";
        dot.style.background = "var(--warning)";
        badge.appendChild(dot);
        badge.appendChild(document.createTextNode(`OOR ${p.minutes_out_of_range || 0}m`));
      }
      return badge;
    }

    // Robust copy to clipboard helper
    async function copyTextToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch (e) {
          // Fall back if writeText fails
        }
      }
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      } catch (err) {
        document.body.removeChild(textArea);
        return false;
      }
    }

    // Render positions table
