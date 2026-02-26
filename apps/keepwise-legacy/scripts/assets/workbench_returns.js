    function initReturnAnalytics() {
      const retStatus = document.getElementById("retStatus");
      const retMetrics = document.getElementById("retMetrics");
      const retFlowWrap = document.getElementById("retFlowWrap");
      const retFlowBody = document.getElementById("retFlowBody");
      const retBatchMetrics = document.getElementById("retBatchMetrics");
      const retBatchWrap = document.getElementById("retBatchWrap");
      const retBatchBody = document.getElementById("retBatchBody");
      const retAccountId = document.getElementById("retAccountId");
      const retPreset = document.getElementById("retPreset");
      const retFrom = document.getElementById("retFrom");
      const retTo = document.getElementById("retTo");
      const retChartAssetView = document.getElementById("retChartAssetView");
      const retChartReturnView = document.getElementById("retChartReturnView");
      const retChartGrowthView = document.getElementById("retChartGrowthView");
      const retTabButtons = Array.from(document.querySelectorAll("#retChartTabs .pill-tab"));

      let latestRequestId = 0;
      let latestBatchRequestId = 0;

      function setReturnChartView(view) {
        const views = {
          asset: retChartAssetView,
          return: retChartReturnView,
          growth: retChartGrowthView,
        };
        Object.entries(views).forEach(([key, el]) => {
          if (!el) return;
          el.classList.toggle("hidden", key !== view);
        });
        retTabButtons.forEach(btn => {
          btn.classList.toggle("active", btn.getAttribute("data-view") === view);
        });
      }

      function applyReturnPresetState() {
        const isCustom = retPreset.value === "custom";
        retFrom.disabled = !isCustom;
        if (!isCustom) retFrom.value = "";
      }

      function clearReturnVisuals() {
        hide(retMetrics);
        hide(retFlowWrap);
        renderLineChart("retCurveChart", "retCurveLegend", [], [
          { key: "total_assets_cents", color: "#0f766e", label: "总资产" },
        ]);
        renderLineChart("retRateChart", "retRateLegend", [], [
          { key: "cumulative_return_pct", color: "#b45309", label: "累计收益率(%)" },
        ]);
        renderLineChart("retGrowthChart", "retGrowthLegend", [], [
          { key: "cumulative_net_growth_cents", color: "#2f6db4", label: "净增长资金" },
        ]);
      }

      function clearReturnBatchVisuals() {
        hide(retBatchMetrics);
        hide(retBatchWrap);
        retBatchBody.innerHTML = "";
      }

      async function refreshReturnAnalytics(options = {}) {
        const { silent = false } = options;
        const requestId = ++latestRequestId;
        try {
          const accountId = retAccountId.value;
          if (!accountId) {
            clearReturnVisuals();
            if (!silent) setStatus(retStatus, false, "请先选择投资账户");
            return;
          }
          if (retPreset.value === "custom" && !retFrom.value.trim()) {
            clearReturnVisuals();
            if (!silent) setStatus(retStatus, false, "自定义区间需要填写开始日期");
            return;
          }

          const params = new URLSearchParams({ account_id: accountId, ...buildPresetParams("ret") });
          const [retData, curveData] = await Promise.all([
            api(`/api/analytics/investment-return?${params.toString()}`),
            api(`/api/analytics/investment-curve?${params.toString()}`),
          ]);
          if (requestId !== latestRequestId) return;

          const targetLabel = retData.account_count ? `组合（${retData.account_count}个账户）` : (retData.account_name || "-");
          showMetrics(retMetrics, [
            { k: "分析对象", v: targetLabel },
            { k: "区间收益率", v: retData.metrics.return_rate_pct || "-" },
            { k: "年化收益率", v: retData.metrics.annualized_rate_pct || "-" },
            { k: "净增长资金(元)", v: retData.metrics.net_growth_yuan || retData.metrics.profit_yuan },
            { k: "曲线点位数", v: curveData.summary.count ?? curveData.range?.points ?? "-", amount: false },
            { k: "起点总资产(元)", v: curveData.summary.start_assets_yuan || "-" },
            { k: "终点总资产(元)", v: curveData.summary.end_assets_yuan || "-" },
            { k: "资产涨跌额(元)", v: curveData.summary.change_yuan || "-" },
            { k: "资产涨跌幅", v: curveData.summary.change_pct_text || "-", amount: false },
          ]);

          const flows = retData.cash_flows || [];
          if (flows.length > 0) {
            retFlowWrap.classList.remove("hidden");
            retFlowBody.innerHTML = flows.map(flow => `
              <tr>
                <td>${flow.snapshot_date}</td>
                <td>${renderAmountValue(flow.transfer_amount_yuan)}</td>
                <td>${flow.weight.toFixed(4)}</td>
              </tr>
            `).join("");
            applyAmountMaskInDom(retFlowWrap);
          } else {
            hide(retFlowWrap);
          }

          renderLineChart("retCurveChart", "retCurveLegend", curveData.rows || [], [
            {
              key: "total_assets_cents",
              color: "#0f766e",
              label: "总资产",
              formatValue: (val) => renderAmountValue(`${money(val)} 元`),
            },
          ], {
            includeZero: false,
            yTickCount: 4,
            yAxisFormatter: (val) => (shouldMaskAmounts() ? "****" : `${formatYuanShortFromCents(val)}元`),
            tooltipTitle: (row) =>
              row.effective_snapshot_date && row.effective_snapshot_date !== row.snapshot_date
                ? `${row.snapshot_date}（按${row.effective_snapshot_date}快照）`
                : (row.snapshot_date || ""),
          });
          renderLineChart("retRateChart", "retRateLegend", curveData.rows || [], [
            {
              key: "cumulative_return_pct",
              color: "#b45309",
              label: "累计收益率(%)",
              formatValue: (val) => `${Number(val).toFixed(2)}%`,
            },
          ], {
            includeZero: true,
            yTickCount: 4,
            yAxisFormatter: (val) => `${Number(val).toFixed(1)}%`,
            referenceLines: buildReturnReferenceLines(curveData.rows || []),
            tooltipTitle: (row) =>
              row.effective_snapshot_date && row.effective_snapshot_date !== row.snapshot_date
                ? `${row.snapshot_date}（按${row.effective_snapshot_date}快照）`
                : (row.snapshot_date || ""),
          });
          renderLineChart("retGrowthChart", "retGrowthLegend", curveData.rows || [], [
            {
              key: "cumulative_net_growth_cents",
              color: "#2f6db4",
              label: "净增长资金",
              formatValue: (val) => renderAmountValue(`${money(val)} 元`),
            },
          ], {
            includeZero: true,
            yTickCount: 4,
            yAxisFormatter: (val) => (shouldMaskAmounts() ? "****" : `${formatYuanShortFromCents(val)}元`),
            referenceLines: [{ value: 0, label: shouldMaskAmounts() ? "****" : "0元", color: "#9ca3af" }],
            tooltipTitle: (row) =>
              row.effective_snapshot_date && row.effective_snapshot_date !== row.snapshot_date
                ? `${row.snapshot_date}（按${row.effective_snapshot_date}快照）`
                : (row.snapshot_date || ""),
          });

          if (!silent) {
            setStatus(
              retStatus,
              true,
              `已自动更新：${targetLabel}，区间 ${retData.range.effective_from} ~ ${retData.range.effective_to}`
            );
          }
        } catch (err) {
          if (requestId !== latestRequestId) return;
          clearReturnVisuals();
          setStatus(retStatus, false, err.message || String(err));
        }
      }

      async function refreshReturnBatchAnalytics(options = {}) {
        const { silent = false } = options;
        const requestId = ++latestBatchRequestId;
        try {
          if (retPreset.value === "custom" && !retFrom.value.trim()) {
            clearReturnBatchVisuals();
            if (!silent) setStatus(retStatus, false, "自定义区间需要填写开始日期");
            return;
          }

          const params = new URLSearchParams(buildPresetParams("ret"));
          const data = await api(`/api/analytics/investment-returns?${params.toString()}`);
          if (requestId !== latestBatchRequestId) return;

          showMetrics(retBatchMetrics, [
            { k: "参与账户", v: data.summary.account_count },
            { k: "可计算账户", v: data.summary.computed_count },
            { k: "异常账户", v: data.summary.error_count },
            { k: "平均收益率", v: data.summary.avg_return_pct || "-" },
          ]);

          retBatchWrap.classList.remove("hidden");
          const rows = data.rows || [];
          if (rows.length === 0) {
            retBatchBody.innerHTML = `<tr><td colspan="7">当前区间暂无可计算账户</td></tr>`;
          } else {
            retBatchBody.innerHTML = rows.map(row => `
              <tr>
                <td>${row.account_name || row.account_id}</td>
                <td>${row.return_rate_pct || "-"}</td>
                <td>${row.annualized_rate_pct || "-"}</td>
                <td>${renderAmountValue(row.profit_yuan)}</td>
                <td>${renderAmountValue(row.net_flow_yuan)}</td>
                <td>${row.effective_from} ~ ${row.effective_to}</td>
                <td>${row.interval_days}</td>
              </tr>
            `).join("");
          }
          applyAmountMaskInDom(retBatchWrap);

          if (!silent) {
            if (data.summary.error_count > 0) {
              setStatus(
                retStatus,
                false,
                `对比已更新：可计算 ${data.summary.computed_count} 个，异常 ${data.summary.error_count} 个`
              );
            } else {
              setStatus(retStatus, true, `账户收益率对比已更新：${data.summary.computed_count} 个账户`);
            }
          }
        } catch (err) {
          if (requestId !== latestBatchRequestId) return;
          clearReturnBatchVisuals();
          setStatus(retStatus, false, err.message || String(err));
        }
      }

      async function refreshAllReturnAnalytics(options = {}) {
        const { silent = false } = options;
        await Promise.all([
          refreshReturnAnalytics({ silent }),
          refreshReturnBatchAnalytics({ silent: true }),
        ]);
      }

      state.refreshReturnAnalytics = refreshReturnAnalytics;
      state.refreshReturnBatchAnalytics = refreshReturnBatchAnalytics;

      retTabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
          setReturnChartView(btn.getAttribute("data-view") || "asset");
        });
      });
      setReturnChartView("asset");

      retAccountId.addEventListener("change", () => {
        refreshReturnAnalytics({ silent: false });
      });
      retPreset.addEventListener("change", () => {
        applyReturnPresetState();
        refreshAllReturnAnalytics({ silent: false });
      });
      retFrom.addEventListener("change", () => {
        refreshAllReturnAnalytics({ silent: false });
      });
      retTo.addEventListener("change", () => {
        refreshAllReturnAnalytics({ silent: false });
      });
      document.getElementById("retBatchBtn").addEventListener("click", async () => {
        await refreshReturnBatchAnalytics({ silent: false });
      });

      document.getElementById("retRefreshAccountsBtn").addEventListener("click", async () => {
        try {
          await refreshInvestmentAccounts();
          setStatus(retStatus, true, "投资账户列表已刷新并自动更新收益分析与账户对比");
        } catch (err) {
          setStatus(retStatus, false, err.message || String(err));
        }
      });

      applyReturnPresetState();
      refreshReturnBatchAnalytics({ silent: true });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initReturnAnalytics,
    });
