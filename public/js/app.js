// ════════════════ MERIDIAN APPLICATION ENTRY POINT ════════════════

    // Login
    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = document.getElementById("password-input").value;
      const errEl = document.getElementById("login-error");
      errEl.style.display = "none";

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pass })
        });
        if (!res.ok) throw new Error("invalid");
        const data = await res.json();

        csrfToken = data.csrfToken;
        document.getElementById("login-page").style.display = "none";
        document.getElementById("app-shell").style.display = "flex";

        showToast("Access granted. Terminal unlocked.");
        startPolling();
        switchTab("dashboard");
      } catch {
        errEl.style.display = "block";
      }
    });

    function syncBottomNav(tabId) {
      const bnavTabs = ['dashboard', 'positions', 'smartlp', 'decisions', 'lessons', 'config'];
      bnavTabs.forEach(t => {
        const btn = document.getElementById(`bnav-${t}`);
        if (btn) btn.classList.toggle('active', t === tabId);
      });
    }

    function closeMobileMenu() {}

    // Patch switchTab to sync bottom nav active state and scroll to top
    const _origSwitchTab = switchTab;
    switchTab = function(tabId) {
      _origSwitchTab(tabId);
      syncBottomNav(tabId);
      window.scrollTo(0, 0);
      const ca = document.getElementById('content-area');
      if (ca) ca.scrollTop = 0;
    };

    // Check active session on load
    checkSession();


// ─── Initial Triggers ───
window.addEventListener("resize", () => {
  if (dashboardState.pnlCalendar && typeof renderPnlCalendar === "function") {
    renderPnlCalendar();
  }
});
