    function initWealth() {
      const wealthStatus = document.getElementById("wealthStatus");
      const wealthCurvePreset = document.getElementById("wealthCurvePreset");
      const wealthFilterButtons = Array.from(document.querySelectorAll("#wealthAssetFilters .pill-tab"));

      let latestOverviewRequestId = 0;
      let latestCurveRequestId = 0;

      function setFilterButtonState(btn, enabled) {
        btn.classList.toggle("active", enabled);
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
      }

      function hasAnyFilterEnabled(filters) {
        return (
          filters.include_investment
          || filters.include_cash
          || filters.include_real_estate
          || filters.include_liability
        );
      }

      function serializeFilterParams(filters) {
        return {
          include_investment: toQueryBool(filters.include_investment),
          include_cash: toQueryBool(filters.include_cash),
          include_real_estate: toQueryBool(filters.include_real_estate),
          include_liability: toQueryBool(filters.include_liability),
        };
      }

      function wealthPresetLabel(preset) {
        if (preset === "since_inception") return "成立以来";
        if (preset === "1y") return "近一年";
        if (preset === "ytd") return "YTD";
        return preset || "-";
      }

      function clearWealthOverviewVisuals() {
        renderWealthSankeyChart("wealthGrowthChart", "wealthGrowthLegend", null, {});
      }

      function clearWealthCurveVisuals() {
        renderWealthStackedTrendChart("wealthCurveChart", "wealthCurveLegend", [], {});
      }

      async function refreshWealthOverview(options = {}) {
        const { silent = false } = options;
        const requestId = ++latestOverviewRequestId;
        try {
          const filters = readWealthFilters();
          if (!hasAnyFilterEnabled(filters)) {
            clearWealthOverviewVisuals();
            if (!silent) setStatus(wealthStatus, false, "至少需要选择一个资产类型");
            return;
          }

          const params = new URLSearchParams({
            ...serializeFilterParams(filters),
          });
          const data = await api(`/api/analytics/wealth-overview?${params.toString()}`);
          if (requestId !== latestOverviewRequestId) return;
          renderWealthSankeyChart("wealthGrowthChart", "wealthGrowthLegend", data, filters);

          if (!silent) {
            setStatus(wealthStatus, true, `财富结构关系图已更新（as_of: ${data.as_of}）`);
          }
        } catch (err) {
          if (requestId !== latestOverviewRequestId) return;
          clearWealthOverviewVisuals();
          setStatus(wealthStatus, false, err.message || String(err));
        }
      }

      async function refreshWealthCurve(options = {}) {
        const { silent = false } = options;
        const requestId = ++latestCurveRequestId;
        try {
          const filters = readWealthFilters();
          if (!hasAnyFilterEnabled(filters)) {
            clearWealthCurveVisuals();
            if (!silent) setStatus(wealthStatus, false, "至少需要选择一个资产类型");
            return;
          }

          const params = new URLSearchParams({
            preset: wealthCurvePreset ? wealthCurvePreset.value : "since_inception",
            ...serializeFilterParams(filters),
          });
          const data = await api(`/api/analytics/wealth-curve?${params.toString()}`);
          if (requestId !== latestCurveRequestId) return;
          renderWealthStackedTrendChart("wealthCurveChart", "wealthCurveLegend", data.rows || [], filters);

          if (!silent) {
            const presetText = wealthPresetLabel(wealthCurvePreset ? wealthCurvePreset.value : data.range.preset);
            setStatus(
              wealthStatus,
              true,
              `资产趋势已更新（${presetText}）：${data.range.effective_from} ~ ${data.range.effective_to}`
            );
          }
        } catch (err) {
          if (requestId !== latestCurveRequestId) return;
          clearWealthCurveVisuals();
          setStatus(wealthStatus, false, err.message || String(err));
        }
      }

      async function refreshWealthAnalytics(options = {}) {
        const { silent = true } = options;
        await Promise.all([
          refreshWealthOverview({ silent }),
          refreshWealthCurve({ silent }),
        ]);
      }

      state.refreshWealthAnalytics = refreshWealthAnalytics;

      wealthFilterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          const isEnabled = btn.classList.contains("active");
          const activeCount = wealthFilterButtons.filter(item => item.classList.contains("active")).length;
          if (isEnabled && activeCount <= 1) {
            setStatus(wealthStatus, false, "至少需要选择一个资产类型");
            return;
          }
          setFilterButtonState(btn, !isEnabled);
          refreshWealthAnalytics({ silent: true });
        });
      });

      if (wealthCurvePreset) {
        wealthCurvePreset.addEventListener("change", () => {
          refreshWealthCurve({ silent: true });
        });
      }

      refreshWealthAnalytics({ silent: true });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initWealth,
    });
