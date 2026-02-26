    function consumptionApp() {
      return window.keepwiseConsumption || {};
    }

    async function init() {
      const app = consumptionApp();
      const res = await fetch("/api/analytics/consumption-report");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载消费分析失败");
      if (typeof app.REPORT_DATA !== "undefined") {
        app.REPORT_DATA = data;
      } else {
        REPORT_DATA = data;
      }
      (app.initSelectors || initSelectors)();

      includePending.checked = state.includePending;
      if (privacyToggle) {
        privacyToggle.addEventListener("click", () => {
          state.hideAmounts = !state.hideAmounts;
          try {
            window.localStorage.setItem(PRIVACY_MASK_STORAGE_KEY, state.hideAmounts ? "1" : "0");
          } catch {}
          (consumptionApp().render || render)();
        });
      }
      monthSelect.addEventListener("change", () => {
        const value = monthSelect.value || "ALL";
        state.month = value;
        (consumptionApp().render || render)();
      });
      yearSelect.addEventListener("change", () => {
        state.year = yearSelect.value || state.year;
        state.month = "ALL";
        (consumptionApp().refreshMonthSelector || refreshMonthSelector)();
        (consumptionApp().render || render)();
      });
      if (categorySelectAll) {
        categorySelectAll.addEventListener("click", () => {
          const currentData = consumptionApp().REPORT_DATA || REPORT_DATA;
          state.selectedCategories = new Set((currentData.categories || []).map((x) => x.category));
          (consumptionApp().render || render)();
        });
      }
      if (categoryClear) {
        categoryClear.addEventListener("click", () => {
          state.selectedCategories.clear();
          (consumptionApp().render || render)();
        });
      }
      keywordInput.addEventListener("input", () => {
        state.keyword = keywordInput.value;
        (consumptionApp().render || render)();
      });
      includePending.addEventListener("change", () => {
        state.includePending = includePending.checked;
        (consumptionApp().render || render)();
      });
      document.querySelectorAll(".th-sort").forEach((btn) => {
        btn.addEventListener("click", () => {
          const field = btn.getAttribute("data-sort");
          if (!field) return;
          if (state.sortField === field) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.sortField = field;
            state.sortDir = (field === "date" || field === "amount" || field === "confidence") ? "desc" : "asc";
          }
          (consumptionApp().render || render)();
        });
      });
      try {
        state.hideAmounts = window.localStorage.getItem(PRIVACY_MASK_STORAGE_KEY) === "1";
      } catch {}
      (app.render || render)();
    }
    init().catch((err) => {
      const app = consumptionApp();
      const msg = (err && err.message) ? err.message : String(err);
      (app.text || text)("heroSubtitle", `加载失败：${msg}`);
      const tbody = document.getElementById("txnBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty">消费分析数据加载失败：${msg}</td></tr>`;
      (app.text || text)("footInfo", "数据加载失败");
      (app.text || text)("footTime", "生成时间：-");
    });

    window.keepwiseConsumption = Object.assign(window.keepwiseConsumption || {}, {
      init,
    });
