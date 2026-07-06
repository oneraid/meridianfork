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

    // Logout
    function syncBottomNav(tabId) {
      BNAV_TABS.forEach(t => {
        const btn = document.getElementById(`bnav-${t}`);
        if (btn) btn.classList.toggle('active', t === tabId);
      });
      const moreBtn = document.getElementById('bnav-more');
      if (moreBtn) moreBtn.classList.toggle('active', MORE_TABS.includes(tabId));
      MORE_TABS.forEach(t => {
        const item = document.getElementById(`more-btn-${t}`);
        if (item) item.classList.toggle('active', t === tabId);
      });
    }

    function toggleMoreMenu() {
      const menu = document.getElementById('more-menu');
      const backdrop = document.getElementById('more-backdrop');
      const isOpen = menu.classList.toggle('open');
      backdrop.classList.toggle('open', isOpen);
    }

    function closeMoreMenu() {
      document.getElementById('more-menu').classList.remove('open');
      document.getElementById('more-backdrop').classList.remove('open');
    }

    function closeMobileMenu() { closeMoreMenu(); }

    function moreNav(tabId) {
      switchTab(tabId);
      closeMoreMenu();
      window.scrollTo(0, 0);
      const ca = document.getElementById('content-area');
      if (ca) ca.scrollTop = 0;
    }

    // Patch switchTab to sync bottom nav active state
    const _origSwitchTab = switchTab;
    switchTab = function(tabId) {
      _origSwitchTab(tabId);
      syncBottomNav(tabId);
    };

    // Close more menu when tapping content area
    document.getElementById('content-area').addEventListener('touchstart', closeMoreMenu, { passive: true });

    // Check active session on load
    checkSession();


// ─── Initial Triggers ───
window.addEventListener("resize", () => {
  if (dashboardState.portfolioHistory) {
    renderPortfolioChart(dashboardState.portfolioHistory);
  }
});

document.getElementById('content-area').addEventListener('touchstart', closeMoreMenu, { passive: true });

checkSession();
