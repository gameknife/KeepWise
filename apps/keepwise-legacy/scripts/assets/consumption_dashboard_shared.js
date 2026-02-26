    let REPORT_DATA = null;
    const COLORS = ["#2f8f63","#4aa87c","#77b77b","#9ec36f","#d1a758","#cf8752","#7f9a70","#87a8b4","#7c8dc7","#ab8dbb","#c27f91","#8f9a9a"];
    const PRIVACY_MASK_STORAGE_KEY = "keepwise:privacy-mask-amounts";
    const state = {
      year: "",
      month: "ALL",
      selectedCategories: new Set(),
      selectedMerchants: new Set(),
      keyword: "",
      includePending: false,
      hideAmounts: false,
      sortField: "date",
      sortDir: "desc",
    };

    const yearSelect = document.getElementById("yearSelect");
    const monthSelect = document.getElementById("monthSelect");
    const keywordInput = document.getElementById("keywordInput");
    const includePending = document.getElementById("includePending");
    const filterPills = document.getElementById("filterPills");
    const categoryCloud = document.getElementById("categoryCloud");
    const categorySelectAll = document.getElementById("categorySelectAll");
    const categoryClear = document.getElementById("categoryClear");
    const privacyToggle = document.getElementById("privacyToggle");
    const privacyToggleLabel = document.getElementById("privacyToggleLabel");

    function fmtMoney(value) {
      if (state.hideAmounts) return "***";
      return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value || 0);
    }
    function fmtMoneyCompact(value) {
      if (state.hideAmounts) return "***";
      const abs = Math.abs(value || 0);
      if (abs >= 100000000) return `¥${(value / 100000000).toFixed(2)}亿`;
      if (abs >= 10000) return `¥${(value / 10000).toFixed(1)}万`;
      return `¥${Math.round(value).toLocaleString("zh-CN")}`;
    }
    function fmtPercent(value) {
      return `${(value * 100).toFixed(2)}%`;
    }
    function text(el, value) {
      const node = document.getElementById(el);
      if (node) node.textContent = value;
    }

    function getAvailableYears() {
      const years = new Set();
      (REPORT_DATA.months || []).forEach((x) => {
        const m = String(x.month || "");
        if (m.length >= 4) years.add(m.slice(0, 4));
      });
      if (years.size === 0) {
        (REPORT_DATA.transactions || []).forEach((x) => {
          const m = String(x.month || "");
          if (m.length >= 4) years.add(m.slice(0, 4));
        });
      }
      return Array.from(years).sort((a, b) => b.localeCompare(a, "zh-CN", { numeric: true }));
    }

    function refreshMonthSelector() {
      const year = state.year || "";
      const monthRows = (REPORT_DATA.months || []).filter((x) => String(x.month || "").startsWith(`${year}-`));
      const monthOptions = [{ value: "ALL", label: `${year} 全年` }].concat(
        monthRows.map((x) => ({ value: x.month, label: x.month }))
      );
      if (!monthOptions.some((x) => x.value === state.month)) state.month = "ALL";
      monthSelect.innerHTML = monthOptions.map((x) => `<option value="${x.value}">${x.label}</option>`).join("");
      monthSelect.value = state.month;
    }

    function initSelectors() {
      const years = getAvailableYears();
      if (!state.year || !years.includes(state.year)) {
        state.year = years[0] || String(new Date().getFullYear());
      }
      yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
      yearSelect.value = state.year;
      refreshMonthSelector();
    }

    const keepwiseConsumptionNs = Object.assign(window.keepwiseConsumption || {}, {
      COLORS,
      PRIVACY_MASK_STORAGE_KEY,
      state,
      yearSelect,
      monthSelect,
      keywordInput,
      includePending,
      filterPills,
      categoryCloud,
      categorySelectAll,
      categoryClear,
      privacyToggle,
      privacyToggleLabel,
      fmtMoney,
      fmtMoneyCompact,
      fmtPercent,
      text,
      getAvailableYears,
      refreshMonthSelector,
      initSelectors,
    });

    Object.defineProperty(keepwiseConsumptionNs, "REPORT_DATA", {
      configurable: true,
      enumerable: true,
      get() {
        return REPORT_DATA;
      },
      set(value) {
        REPORT_DATA = value;
      },
    });

    window.keepwiseConsumption = keepwiseConsumptionNs;
