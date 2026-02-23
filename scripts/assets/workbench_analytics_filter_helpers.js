    function buildPresetParams(prefix) {
      return {
        preset: document.getElementById(`${prefix}Preset`).value,
        from: document.getElementById(`${prefix}From`).value.trim(),
        to: document.getElementById(`${prefix}To`).value.trim(),
      };
    }

    function readWealthFilters() {
      const buttons = Array.from(document.querySelectorAll("#wealthAssetFilters .pill-tab"));
      const filters = {
        include_investment: true,
        include_cash: true,
        include_real_estate: true,
        include_liability: true,
      };
      buttons.forEach(btn => {
        const key = btn.getAttribute("data-key");
        if (!key || !(key in filters)) return;
        filters[key] = btn.classList.contains("active");
      });
      return filters;
    }

    function toQueryBool(raw) {
      return raw ? "true" : "false";
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      buildPresetParams,
      readWealthFilters,
      toQueryBool,
    });
