async function loadLessons() {
      perfPagination.page = 0;
      lessonsPagination.page = 0;
      try {
        const res = await fetch("/api/lessons");
        const data = await res.json();

        // Sort lessons newest first
        if (data && data.lessons) {
          data.lessons.sort((a, b) => {
            const timeA = a.created_at ? new Date(a.created_at).getTime() : (a.id || 0);
            const timeB = b.created_at ? new Date(b.created_at).getTime() : (b.id || 0);
            return timeB - timeA;
          });
        }

        // Sort performance newest first
        if (data && data.performance) {
          data.performance.sort((a, b) => {
            const timeA = a.recorded_at ? new Date(a.recorded_at).getTime() : 0;
            const timeB = b.recorded_at ? new Date(b.recorded_at).getTime() : 0;
            return timeB - timeA;
          });
        }

        dashboardState.lessons = data;

        const perf = data.performance || [];
        const closedCount = perf.length;
        let winRate = "--", avgPnl = "--";
        if (closedCount > 0) {
          const wins = perf.filter(p => (p.pnl_pct || 0) >= 0).length;
          winRate = `${((wins / closedCount) * 100).toFixed(0)}%`;
          avgPnl  = `${(perf.reduce((a, p) => a + (p.pnl_pct || 0), 0) / closedCount).toFixed(2)}%`;
        }
        safeText("perf-closed-count", closedCount);
        safeText("perf-win-rate", winRate);
        safeText("perf-avg-pnl", avgPnl);

        renderPerfPage();
        renderLessonsPage();
      } catch {
        showToast("Failed to load lessons and performance stats", "error");
      }
    }

    function perfPage(dir) {
      const total = (dashboardState.lessons?.performance || []).length;
      const maxPage = Math.max(0, Math.ceil(total / perfPagination.perPage) - 1);
      perfPagination.page = Math.min(maxPage, Math.max(0, perfPagination.page + dir));
      renderPerfPage();
    }
    function renderPerfPage() {
      const tperf = document.getElementById("lessons-perf-table-body");
      tperf.replaceChildren();
      const { page, perPage } = perfPagination;
      const perf = (dashboardState.lessons?.performance || []);
      const total = perf.length;
      const start = page * perPage;
      const slice = perf.slice(start, start + perPage);

      const totalPages = Math.max(1, Math.ceil(total / perPage));
      document.getElementById("perf-pager-info").textContent = total === 0 ? "" : `${start + 1}–${Math.min(start + perPage, total)} dari ${total}`;
      document.getElementById("perf-pager-page").textContent = total === 0 ? "" : `Hal ${page + 1} / ${totalPages}`;
      document.getElementById("perf-pager-prev").disabled = page === 0;
      document.getElementById("perf-pager-next").disabled = page >= totalPages - 1;
      document.getElementById("perf-pager").style.display = total <= perPage ? "none" : "flex";

      if (total === 0) {
        const tr = document.createElement("tr"); const td = document.createElement("td"); td.colSpan = 4;
        td.style.cssText = "text-align:center;padding:48px;color:var(--text-muted);font-size:13px;"; td.textContent = "No closed performance data available.";
        tr.appendChild(td); tperf.appendChild(tr);
      } else {
        slice.forEach(p => {
          const tr = document.createElement("tr");
          const tdPool  = document.createElement("td"); tdPool.style.cssText  = "font-weight:700;color:var(--text-primary);"; tdPool.textContent  = p.pool_name || p.pool || "unknown"; tr.appendChild(tdPool);
          const tdTime  = document.createElement("td"); tdTime.style.cssText  = "color:var(--text-secondary);font-weight:500;"; tdTime.textContent  = p.minutes_held ? `${Math.round(p.minutes_held)}m` : "--"; tr.appendChild(tdTime);
          const tdReas  = document.createElement("td"); tdReas.style.cssText  = "color:var(--text-muted);font-size:12px;"; tdReas.textContent  = p.close_reason || "OOR close"; tr.appendChild(tdReas);
          const tdPnl   = document.createElement("td");
          const pnlVal = p.pnl_pct || 0;
          const spanPnl = document.createElement("span"); spanPnl.style.cssText = `font-weight:700;color:${pnlVal >= 0 ? 'var(--success)' : '#ff6b8a'};`;
          spanPnl.textContent = `${pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)}%`;
          tdPnl.appendChild(spanPnl); tr.appendChild(tdPnl);
          tperf.appendChild(tr);
        });
      }
    }

    function lessonsPage(dir) {
      const total = (dashboardState.lessons?.lessons || []).length;
      const maxPage = Math.max(0, Math.ceil(total / lessonsPagination.perPage) - 1);
      lessonsPagination.page = Math.min(maxPage, Math.max(0, lessonsPagination.page + dir));
      renderLessonsPage();
    }
    function renderLessonsPage() {
      const list = document.getElementById("lessons-list");
      list.replaceChildren();
      const { page, perPage } = lessonsPagination;
      const lessons = (dashboardState.lessons?.lessons || []);
      const total = lessons.length;
      const start = page * perPage;
      const slice = lessons.slice(start, start + perPage);

      const totalPages = Math.max(1, Math.ceil(total / perPage));
      document.getElementById("lessons-pager-info").textContent = total === 0 ? "" : `${start + 1}–${Math.min(start + perPage, total)} dari ${total}`;
      document.getElementById("lessons-pager-page").textContent = total === 0 ? "" : `Hal ${page + 1} / ${totalPages}`;
      document.getElementById("lessons-pager-prev").disabled = page === 0;
      document.getElementById("lessons-pager-next").disabled = page >= totalPages - 1;
      document.getElementById("lessons-pager").style.display = total <= perPage ? "none" : "flex";

      if (total === 0) {
        const div = document.createElement("div");
        div.style.cssText = "text-align:center;padding:32px;color:var(--text-muted);font-size:12px;background:var(--bg-elevated);border-radius:12px;border:1px solid var(--border-subtle);";
        div.textContent = "No lessons recorded yet. Close positions to trigger study.";
        list.appendChild(div);
      } else {
        slice.forEach(l => {
          const item = document.createElement("div");
          item.className = "lesson-card";
          item.title = "Klik untuk lihat detail";
          item.addEventListener("click", () => openLessonDetail(l));

          // click hint
          const hint = document.createElement("span"); hint.className = "lesson-card-click-hint"; hint.textContent = "detail →";

          const hdr = document.createElement("div"); hdr.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--border-subtle);";
          const spanRole = document.createElement("span"); spanRole.style.cssText = "font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:2px 8px;border-radius:99px;background:rgba(124,92,255,0.1);color:var(--accent-light);border:1px solid rgba(124,92,255,0.2);flex-shrink:0;"; spanRole.textContent = String(l.role || "all");

          const rightSide = document.createElement("div"); rightSide.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0;";
          const tagCont = document.createElement("div"); tagCont.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;min-width:0;";
          (l.tags || []).forEach(t => {
            const st = document.createElement("span"); st.style.cssText = "font-size:9px;font-weight:600;padding:1px 6px;border-radius:99px;background:var(--bg-base);color:var(--text-muted);border:1px solid var(--border-subtle);white-space:nowrap;"; st.textContent = t;
            tagCont.appendChild(st);
          });
          rightSide.appendChild(tagCont);
          rightSide.appendChild(hint);
          hdr.appendChild(spanRole); hdr.appendChild(rightSide);

          const ruleP = document.createElement("p"); ruleP.style.cssText = "font-size:12px;color:var(--text-secondary);line-height:1.6;margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;"; ruleP.textContent = l.rule;

          item.appendChild(hdr); item.appendChild(ruleP);
          list.appendChild(item);
        });
      }
    }

    // Open lesson detail popup
    function openLessonDetail(l) {
      const modal   = document.getElementById("lesson-detail-modal");
      const body    = document.getElementById("lesson-detail-body");
      const title   = document.getElementById("lesson-detail-title");
      const subtitle= document.getElementById("lesson-detail-subtitle");
      const badge   = document.getElementById("lesson-detail-outcome-badge");

      // Clear previous content
      body.replaceChildren();

      // --- Title & badge ---
      const isConfigChange = (l.tags || []).some(t => t === "config_change" || t === "self_tune" || t === "evolution");
      const isPerf = l.sourceType === "performance";
      const outcome = l.outcome || "manual";

      if (isConfigChange) {
        title.textContent = (l.tags || []).includes("evolution") ? "Auto-Evolved Config" : "Self-Tuned Config";
        badge.className = "lesson-outcome-badge config";
        badge.textContent = "⚙ Config Change";
      } else if (isPerf) {
        title.textContent = outcome === "good" ? "✅ Good Trade Lesson" : "❌ Bad Trade Lesson";
        badge.className = `lesson-outcome-badge ${outcome}`;
        badge.textContent = outcome === "good" ? "Profitable" : "Loss";
      } else {
        title.textContent = "📝 Manual Lesson";
        badge.className = "lesson-outcome-badge manual";
        badge.textContent = "Manual";
      }

      // --- Subtitle: date ---
      if (l.created_at) {
        const d = new Date(l.created_at);
        subtitle.textContent = `Recorded: ${d.toLocaleString("id-ID", { dateStyle:"medium", timeStyle:"short" })}`;
      } else {
        subtitle.textContent = "";
      }

      function makeSection(label, contentEl) {
        const sec = document.createElement("div");
        sec.className = "lesson-detail-section";
        const lbl = document.createElement("div"); lbl.className = "lesson-detail-label"; lbl.textContent = label;
        sec.appendChild(lbl); sec.appendChild(contentEl);
        body.appendChild(sec);
      }

      // --- Rule text ---
      const ruleDiv = document.createElement("div");
      ruleDiv.className = "lesson-detail-value";
      ruleDiv.style.cssText = "background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:8px;padding:12px 14px;line-height:1.7;";
      ruleDiv.textContent = l.rule || "—";
      makeSection("Lesson / Rule", ruleDiv);

      // --- Config params (for config_change / self_tune / evolution) ---
      if (isConfigChange && l.rule) {
        // Try to parse "Changed key=val, key=val" or "key=val → key2=val2" patterns
        const changedMatch = l.rule.match(/Changed\s+(.*)/);
        const evolvedMatch = l.rule.match(/\[AUTO-EVOLVED[^\]]*\]\s+(.*)/);
        let rawParams = changedMatch ? changedMatch[1] : (evolvedMatch ? evolvedMatch[1] : null);

        if (rawParams) {
          // Parse "key=val, key=val" format
          const pairs = rawParams.split(/,\s*/).map(p => p.trim()).filter(Boolean);
          const paramEntries = [];
          pairs.forEach(pair => {
            // handle "key=val → newval" or "key=val"
            const eqIdx = pair.indexOf("=");
            if (eqIdx !== -1) {
              const key = pair.slice(0, eqIdx).trim();
              let val = pair.slice(eqIdx + 1).trim();
              // strip trailing descriptors after " —"
              val = val.split(" —")[0].trim();
              paramEntries.push({ key, val });
            } else {
              // It might be a description line, add as note
              paramEntries.push({ key: "note", val: pair });
            }
          });

          if (paramEntries.length > 0) {
            const grid = document.createElement("div");
            grid.className = "lesson-detail-config-grid";
            paramEntries.forEach(({ key, val }) => {
              const item = document.createElement("div");
              item.className = "lesson-detail-config-item";
              const k = document.createElement("div"); k.className = "lesson-detail-config-key"; k.textContent = key;
              const v = document.createElement("div"); v.className = "lesson-detail-config-val"; v.textContent = val;
              item.appendChild(k); item.appendChild(v);
              grid.appendChild(item);
            });
            makeSection("Parameter yang Diubah", grid);
          }
        }
      }

      // --- Performance metrics ---
      if (isPerf || l.pnl_pct != null) {
        const metrics = [];
        if (l.pnl_pct != null) metrics.push({ label: "PnL", val: `${l.pnl_pct >= 0 ? "+" : ""}${l.pnl_pct.toFixed(2)}%`, color: l.pnl_pct >= 0 ? "#22d366" : "#ff6b8a" });
        if (l.fees_earned_usd != null) metrics.push({ label: "Fees Earned", val: `$${l.fees_earned_usd.toFixed(3)}`, color: "#22d366" });
        if (l.initial_value_usd != null) metrics.push({ label: "Initial Value", val: `$${l.initial_value_usd.toFixed(2)}`, color: "var(--text-secondary)" });
        if (l.range_efficiency != null) metrics.push({ label: "Range Efficiency", val: `${l.range_efficiency}%`, color: l.range_efficiency >= 80 ? "#22d366" : "#fbbf24" });
        if (l.confidence != null) metrics.push({ label: "Confidence", val: `${(l.confidence * 100).toFixed(0)}%`, color: "var(--accent-light)" });

        if (metrics.length > 0) {
          const metricsGrid = document.createElement("div");
          metricsGrid.className = "lesson-detail-metrics";
          metrics.forEach(({ label, val, color }) => {
            const m = document.createElement("div"); m.className = "lesson-detail-metric";
            const ml = document.createElement("div"); ml.className = "lesson-detail-metric-label"; ml.textContent = label;
            const mv = document.createElement("div"); mv.className = "lesson-detail-metric-val"; mv.style.color = color; mv.textContent = val;
            m.appendChild(ml); m.appendChild(mv);
            metricsGrid.appendChild(m);
          });
          makeSection("Performance Metrics", metricsGrid);
        }
      }

      // --- Close reason ---
      if (l.close_reason) {
        const cr = document.createElement("div"); cr.className = "lesson-detail-value";
        cr.textContent = l.close_reason;
        makeSection("Close Reason", cr);
      }

      // --- Entry / Exit data ---
      const hasEntryExit = l.entry_mcap || l.entry_tvl || l.entry_volume || l.exit_mcap || l.exit_tvl || l.exit_volume;
      if (hasEntryExit) {
        const fmt = (v, prefix="") => v != null ? `${prefix}${v >= 1e6 ? (v/1e6).toFixed(2)+"M" : v >= 1e3 ? (v/1e3).toFixed(1)+"K" : v.toFixed(0)}` : "—";
        const table = document.createElement("div");
        table.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;";

        const cols = [
          { key: "MCap", entry: fmt(l.entry_mcap, "$"), exit: fmt(l.exit_mcap, "$") },
          { key: "TVL",  entry: fmt(l.entry_tvl, "$"),  exit: fmt(l.exit_tvl, "$") },
          { key: "Volume", entry: fmt(l.entry_volume, "$"), exit: fmt(l.exit_volume, "$") },
        ];
        cols.forEach(({ key, entry, exit }) => {
          const cell = document.createElement("div");
          cell.style.cssText = "background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:8px;padding:10px 12px;";
          cell.innerHTML = `<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px;font-weight:700;">${key}</div>
            <div style="font-size:11px;color:var(--text-secondary);">Entry: <span style="color:var(--text-primary);font-weight:600;">${entry}</span></div>
            <div style="font-size:11px;color:var(--text-secondary);">Exit: <span style="color:var(--text-primary);font-weight:600;">${exit}</span></div>`;
          table.appendChild(cell);
        });
        makeSection("Entry → Exit Data", table);
      }

      // --- Pool address ---
      if (l.pool) {
        const poolDiv = document.createElement("div");
        poolDiv.style.cssText = "font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent-light);word-break:break-all;background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:8px;padding:8px 12px;";
        poolDiv.textContent = l.pool;
        makeSection("Pool Address", poolDiv);
      }

      // --- Context string ---
      if (l.context) {
        const ctx = document.createElement("div"); ctx.className = "lesson-detail-context";
        ctx.textContent = l.context;
        makeSection("Context Detail", ctx);
      }

      // --- Tags ---
      if (l.tags && l.tags.length > 0) {
        const tagsDiv = document.createElement("div");
        l.tags.forEach(t => {
          const span = document.createElement("span"); span.className = "lesson-detail-tag"; span.textContent = t;
          tagsDiv.appendChild(span);
        });
        makeSection("Tags", tagsDiv);
      }

      // --- Role ---
      if (l.role) {
        const roleDiv = document.createElement("div"); roleDiv.className = "lesson-detail-value";
        roleDiv.textContent = l.role;
        makeSection("Target Role", roleDiv);
      }

      // --- Config recommendations section ---
      const recContainer = document.createElement("div");
      recContainer.id = "lesson-rec-container";
      recContainer.style.cssText = "margin-top:20px;border-top:1px solid var(--border-subtle);padding-top:16px;display:none;";
      body.appendChild(recContainer);

      modal.showModal();
      
      // Trigger recommendations lookup
      fetchRecommendationsForLesson(l.rule);
    }

    // Add lesson
    document.getElementById("add-lesson-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const rule = document.getElementById("lesson-rule-text").value;
      const tags = document.getElementById("lesson-tags").value.split(",").map(t => t.trim()).filter(Boolean);
      try {
        const res = await fetch("/api/lessons/add", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ rule, tags })
        });
        if (!res.ok) throw new Error();
        showToast("Manual lesson stored.");
        document.getElementById("add-lesson-modal").close();
        document.getElementById("lesson-rule-text").value = "";
        document.getElementById("lesson-tags").value = "";
        loadLessons();
      } catch {
        showToast("Failed to record manual lesson", "error");
      }
    });

    // Filter Library Strategies based on chosen DLMM Shape

    let currentLessonRecommendations = [];

    async function fetchRecommendationsForLesson(rule) {
      const container = document.getElementById("lesson-rec-container");
      const applyBtn = document.getElementById("btn-apply-lesson-changes");
      if (!container || !applyBtn) return;
      
      container.style.display = "block";
      applyBtn.style.display = "none";
      container.innerHTML = `
        <div class="lesson-detail-label">💡 AI Config Recommendations</div>
        <div style="color:var(--text-muted);font-size:12px;padding:8px 0;display:flex;align-items:center;gap:6px;">
          <svg class="animate-spin" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="animation: spin 1s linear infinite;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          Menganalisis lesson untuk rekomendasi config...
        </div>
      `;
      
      try {
        const res = await fetch("/api/lessons/recommend-config", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ rule })
        });
        const data = await res.json();
        
        if (!res.ok || !data.success || !data.recommendations || data.recommendations.length === 0) {
          container.style.display = "none";
          return;
        }
        
        currentLessonRecommendations = data.recommendations;
        
        let html = `
          <div class="lesson-detail-label">💡 AI Config Recommendations</div>
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">
            Pilih rekomendasi parameter di bawah ini untuk diterapkan ke config Anda:
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
        `;
        
        data.recommendations.forEach((rec, idx) => {
          const pathParts = rec.path.split(".");
          const paramName = pathParts[pathParts.length - 1];
          const cat = pathParts[0];
          const currentVal = dashboardState.config?.[cat]?.[paramName] ?? "N/A";
          
          html += `
            <label style="display:flex;align-items:flex-start;gap:10px;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.15);border-radius:8px;padding:10px 12px;cursor:pointer;user-select:none;">
              <input type="checkbox" name="lesson-rec-chk" value="${idx}" checked style="margin-top:3px;cursor:pointer;">
              <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:4px;">
                  <span style="font-family:'JetBrains Mono';font-size:12px;font-weight:700;color:var(--accent-light);">${rec.path}</span>
                  <span style="font-size:11px;color:var(--text-muted);">
                    Sebelumnya: <strong style="color:var(--text-secondary);">${currentVal}</strong> → Baru: <strong style="color:var(--success);">${rec.proposed}</strong>
                  </span>
                </div>
                <div style="font-size:11px;color:var(--text-secondary);line-height:1.4;">${rec.reason}</div>
              </div>
            </label>
          `;
        });
        
        html += `</div>`;
        container.innerHTML = html;
        applyBtn.style.display = "block";
      } catch (e) {
        container.innerHTML = `<div style="color:#ff6b8a;font-size:12px;padding:8px 0;">❌ Gagal memuat rekomendasi config: ${e.message}</div>`;
      }
    }

    async function applyCheckedConfigChanges() {
      const chks = document.querySelectorAll('input[name="lesson-rec-chk"]:checked');
      if (chks.length === 0) {
        showToast("Pilih minimal satu perubahan untuk diterapkan", "error");
        return;
      }
      
      const changes = {};
      chks.forEach((chk) => {
        const idx = parseInt(chk.value);
        const rec = currentLessonRecommendations[idx];
        if (rec) {
          const pathParts = rec.path.split(".");
          const paramName = pathParts[pathParts.length - 1];
          changes[paramName] = rec.proposed;
        }
      });
      
      const applyBtn = document.getElementById("btn-apply-lesson-changes");
      applyBtn.disabled = true;
      applyBtn.textContent = "Menerapkan...";
      
      try {
        const res = await fetch("/api/config/update", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ changes })
        });
        const data = await res.json();
        if (!res.ok || data.success === false) {
          throw new Error(data.error || "Gagal menerapkan perubahan");
        }
        showToast("Konfigurasi berhasil diperbarui!");
        document.getElementById("lesson-detail-modal").close();
        if (typeof loadConfig === "function") loadConfig();
      } catch (e) {
        showToast("Gagal memperbarui konfigurasi: " + e.message, "error");
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = "Terapkan Perubahan";
      }
    }
