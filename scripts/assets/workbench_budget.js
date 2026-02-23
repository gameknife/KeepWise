    function initBudget() {
      const budgetStatus = document.getElementById("budgetStatus");
      const budgetYear = document.getElementById("budgetYear");
      const budgetSummaryMetrics = document.getElementById("budgetSummaryMetrics");
      const fireMetrics = document.getElementById("fireMetrics");
      const budgetMonthlyReviewMetrics = document.getElementById("budgetMonthlyReviewMetrics");
      const budgetMonthlyReviewWrap = document.getElementById("budgetMonthlyReviewWrap");
      const budgetMonthlyReviewBody = document.getElementById("budgetMonthlyReviewBody");

      const budgetItemsStatus = document.getElementById("budgetItemsStatus");
      const budgetItemsMetrics = document.getElementById("budgetItemsMetrics");
      const budgetItemsWrap = document.getElementById("budgetItemsWrap");
      const budgetItemsBody = document.getElementById("budgetItemsBody");
      const budgetItemName = document.getElementById("budgetItemName");
      const budgetItemMonthlyAmount = document.getElementById("budgetItemMonthlyAmount");
      const budgetItemSortOrder = document.getElementById("budgetItemSortOrder");
      const budgetItemIsActive = document.getElementById("budgetItemIsActive");
      const budgetItemEditingId = document.getElementById("budgetItemEditingId");
      const budgetItemEditHint = document.getElementById("budgetItemEditHint");
      const budgetItemSaveBtn = document.getElementById("budgetItemSaveBtn");
      const budgetItemCancelEditBtn = document.getElementById("budgetItemCancelEditBtn");
      const budgetItemRefreshBtn = document.getElementById("budgetItemRefreshBtn");
      const budgetRefreshBtn = document.getElementById("budgetRefreshBtn");
      const budgetWithdrawalRatePct = document.getElementById("budgetWithdrawalRatePct");

      if (!budgetYear) return;
      if (!budgetYear.value) budgetYear.value = String(new Date().getFullYear());
      if (budgetWithdrawalRatePct) {
        let restored = "";
        try {
          restored = String(window.localStorage.getItem(BUDGET_WITHDRAWAL_RATE_PCT_STORAGE_KEY) || "").trim();
        } catch {}
        const restoredNum = Number(restored);
        if (restored && Number.isFinite(restoredNum) && restoredNum > 0 && restoredNum < 100) {
          budgetWithdrawalRatePct.value = restoredNum.toFixed(2);
        } else if (!budgetWithdrawalRatePct.value) {
          budgetWithdrawalRatePct.value = "4.00";
        }
      }

      let latestBudgetOverviewReq = 0;
      let latestFireReq = 0;
      let latestBudgetItemsReq = 0;

      function clearBudgetItemEditMode() {
        state.editingBudgetItem = null;
        budgetItemEditingId.textContent = "-";
        budgetItemEditHint.classList.add("hidden");
        budgetItemCancelEditBtn.classList.add("hidden");
        budgetItemSaveBtn.textContent = "保存预算项";
        budgetItemName.value = "";
        budgetItemMonthlyAmount.value = "0";
        budgetItemSortOrder.value = "1000";
        budgetItemIsActive.value = "true";
      }

      function setBudgetItemEditMode(row) {
        state.editingBudgetItem = row;
        budgetItemEditingId.textContent = String(row.id || "-");
        budgetItemEditHint.classList.remove("hidden");
        budgetItemCancelEditBtn.classList.remove("hidden");
        budgetItemSaveBtn.textContent = "更新预算项";
        budgetItemName.value = String(row.name || "");
        budgetItemMonthlyAmount.value = Number(row.monthly_amount_yuan || 0);
        budgetItemSortOrder.value = String(row.sort_order ?? 1000);
        budgetItemIsActive.value = row.is_active ? "true" : "false";
      }

      function getSelectedBudgetYear() {
        const value = String(budgetYear.value || "").trim();
        const yearNum = Number(value);
        if (!Number.isFinite(yearNum) || yearNum < 2000 || yearNum > 2100) {
          return new Date().getFullYear();
        }
        return Math.trunc(yearNum);
      }

      function getWithdrawalRateDecimal() {
        const raw = String(budgetWithdrawalRatePct ? budgetWithdrawalRatePct.value : "4").trim();
        const pctNum = Number(raw);
        if (!Number.isFinite(pctNum) || pctNum <= 0 || pctNum >= 100) {
          throw new Error("提取率必须在 0 到 100 之间（百分比）");
        }
        try {
          window.localStorage.setItem(BUDGET_WITHDRAWAL_RATE_PCT_STORAGE_KEY, pctNum.toFixed(2));
        } catch {}
        return pctNum / 100;
      }

      async function refreshBudgetItems(options = {}) {
        const { silent = true } = options;
        const reqId = ++latestBudgetItemsReq;
        try {
          const data = await api("/api/budgets/monthly-items");
          if (reqId !== latestBudgetItemsReq) return;

          showMetrics(budgetItemsMetrics, [
            { k: "预算项总数", v: data.summary.total_count, amount: false },
            { k: "启用预算项", v: data.summary.active_count, amount: false },
            { k: "月度预算总额(元)", v: data.summary.monthly_budget_total_yuan },
            { k: "年度预算(元)", v: data.summary.annual_budget_yuan },
          ]);

          budgetItemsWrap.classList.remove("hidden");
          budgetItemsBody.innerHTML = (data.rows || []).map(row => `
            <tr data-budget-item-id="${row.id}">
              <td>${escapeHtml(row.name)}</td>
              <td>${renderAmountValue(row.monthly_amount_yuan)}</td>
              <td>${renderAmountValue(row.annual_amount_yuan)}</td>
              <td>${row.is_active ? "启用" : "停用"}</td>
              <td>${row.is_builtin ? "内置" : "自定义"}</td>
              <td>
                <button class="btn secondary js-budget-edit" type="button">编辑</button>
                <button class="btn danger js-budget-delete" type="button">删除</button>
              </td>
            </tr>
          `).join("");
          applyAmountMaskInDom(budgetItemsWrap);
          state.budgetItemsRows = data.rows || [];
          if (!silent) setStatus(budgetItemsStatus, true, "预算项已刷新");
        } catch (err) {
          if (reqId !== latestBudgetItemsReq) return;
          hide(budgetItemsMetrics);
          hide(budgetItemsWrap);
          budgetItemsBody.innerHTML = "";
          setStatus(budgetItemsStatus, false, err.message || String(err));
        }
      }

      async function refreshBudgetOverview(options = {}) {
        const { silent = true } = options;
        const reqId = ++latestBudgetOverviewReq;
        try {
          const year = getSelectedBudgetYear();
          const data = await api(`/api/analytics/budget-overview?year=${encodeURIComponent(year)}`);
          if (reqId !== latestBudgetOverviewReq) return;
          showMetrics(budgetSummaryMetrics, [
            { k: "预算年度", v: data.year, amount: false },
            { k: "月度预算总额(元)", v: data.budget.monthly_total_yuan },
            { k: "年度预算(元)", v: data.budget.annual_total_yuan },
            { k: "实际消费累计(元)", v: data.actual.spent_total_yuan },
            { k: "剩余预算(元)", v: data.metrics.annual_remaining_yuan },
            { k: "达成率/使用率", v: data.metrics.usage_rate_pct_text, amount: false },
            { k: "YTD预算(元)", v: data.budget.ytd_budget_yuan },
            { k: "YTD实际(元)", v: data.actual.ytd_spent_yuan },
            { k: "YTD偏差(元)", v: data.metrics.ytd_variance_yuan },
            { k: "已过月份", v: data.analysis_scope.elapsed_months, amount: false },
          ]);
          if (!silent) {
            setStatus(budgetStatus, true, `预算总览已更新（${data.year}年，as_of: ${data.as_of_date}）`);
          }
        } catch (err) {
          if (reqId !== latestBudgetOverviewReq) return;
          hide(budgetSummaryMetrics);
          setStatus(budgetStatus, false, err.message || String(err));
        }
      }

      async function refreshFireProgress(options = {}) {
        const { silent = true } = options;
        const reqId = ++latestFireReq;
        try {
          const year = getSelectedBudgetYear();
          const withdrawalRate = getWithdrawalRateDecimal();
          const data = await api(
            `/api/analytics/fire-progress?year=${encodeURIComponent(year)}&withdrawal_rate=${encodeURIComponent(withdrawalRate)}`
          );
          if (reqId !== latestFireReq) return;
          showMetrics(fireMetrics, [
            { k: "可投资资产(元)", v: data.investable_assets.total_yuan },
            { k: "其中投资(元)", v: data.investable_assets.investment_yuan },
            { k: "其中现金(元)", v: data.investable_assets.cash_yuan },
            { k: "FIRE目标资产(元)", v: data.metrics.required_assets_yuan },
            { k: "与目标差额(元)", v: data.metrics.goal_gap_yuan },
            { k: "尚需资产(元)", v: data.metrics.remaining_to_goal_yuan },
            { k: "覆盖年数", v: data.metrics.coverage_years_text || "-", amount: false },
            { k: "财务自由度", v: data.metrics.freedom_ratio_pct_text || "-", amount: false },
            { k: "提取率", v: data.withdrawal_rate_pct_text, amount: false },
            { k: "资产快照日期", v: data.investable_assets.as_of, amount: false },
          ]);
          if (!silent && budgetStatus.classList.contains("hidden")) {
            setStatus(budgetStatus, true, `FIRE 指标已更新（${data.year}年）`);
          }
        } catch (err) {
          if (reqId !== latestFireReq) return;
          hide(fireMetrics);
          setStatus(budgetStatus, false, err.message || String(err));
        }
      }

      async function refreshBudgetMonthlyReview(options = {}) {
        const { silent = true } = options;
        try {
          const year = getSelectedBudgetYear();
          const data = await api(`/api/analytics/budget-monthly-review?year=${encodeURIComponent(year)}`);
          showMetrics(budgetMonthlyReviewMetrics, [
            { k: "月度预算(元)", v: data.summary.monthly_budget_yuan },
            { k: "年度预算(元)", v: data.summary.annual_budget_yuan },
            { k: "年度实际消费(元)", v: data.summary.annual_spent_yuan },
            { k: "年度差额(元)", v: data.summary.annual_variance_yuan },
            { k: "年度达成率", v: data.summary.annual_usage_rate_pct_text, amount: false },
            { k: "超预算月份", v: data.summary.over_budget_months, amount: false },
            { k: "低于预算月份", v: data.summary.under_budget_months, amount: false },
            { k: "持平月份", v: data.summary.equal_months, amount: false },
          ]);
          budgetMonthlyReviewWrap.classList.remove("hidden");
          budgetMonthlyReviewBody.innerHTML = (data.rows || []).map(row => `
            <tr>
              <td>${escapeHtml(row.month_key)}</td>
              <td>${renderAmountValue(row.budget_yuan)}</td>
              <td>${renderAmountValue(row.spent_yuan)}</td>
              <td>${renderAmountValue(row.variance_yuan)}</td>
              <td>${escapeHtml(row.usage_rate_pct_text || "-")}</td>
              <td>${escapeHtml(String(row.tx_count || 0))}</td>
              <td>${escapeHtml(row.status || "-")}</td>
            </tr>
          `).join("");
          applyAmountMaskInDom(budgetMonthlyReviewWrap);
          if (!silent && budgetStatus.classList.contains("hidden")) {
            setStatus(budgetStatus, true, `月度复盘已更新（${data.year}年）`);
          }
        } catch (err) {
          hide(budgetMonthlyReviewMetrics);
          hide(budgetMonthlyReviewWrap);
          budgetMonthlyReviewBody.innerHTML = "";
          setStatus(budgetStatus, false, err.message || String(err));
        }
      }

      async function refreshBudgetAnalytics(options = {}) {
        const { silent = true } = options;
        await Promise.all([
          refreshBudgetItems({ silent }),
          refreshBudgetOverview({ silent }),
          refreshFireProgress({ silent }),
          refreshBudgetMonthlyReview({ silent }),
        ]);
      }

      state.refreshBudgetAnalytics = refreshBudgetAnalytics;

      budgetItemSaveBtn.addEventListener("click", async () => {
        try {
          const name = String(budgetItemName.value || "").trim();
          if (!name) throw new Error("请填写预算项名称");
          const monthlyAmount = String(budgetItemMonthlyAmount.value || "").trim();
          const payload = {
            id: state.editingBudgetItem ? state.editingBudgetItem.id : undefined,
            name,
            monthly_amount: monthlyAmount,
            sort_order: String(budgetItemSortOrder.value || "1000").trim(),
            is_active: budgetItemIsActive.value === "true",
          };
          const data = await api("/api/budgets/monthly-items/upsert", "POST", payload);
          setStatus(
            budgetItemsStatus,
            true,
            state.editingBudgetItem ? `预算项已更新：${data.name}` : `预算项已保存：${data.name}`
          );
          clearBudgetItemEditMode();
          await Promise.all([
            refreshBudgetItems({ silent: true }),
            refreshBudgetOverview({ silent: true }),
            refreshFireProgress({ silent: true }),
            refreshBudgetMonthlyReview({ silent: true }),
          ]);
        } catch (err) {
          setStatus(budgetItemsStatus, false, err.message || String(err));
        }
      });

      budgetItemCancelEditBtn.addEventListener("click", () => {
        clearBudgetItemEditMode();
      });

      budgetItemRefreshBtn.addEventListener("click", async () => {
        await refreshBudgetItems({ silent: false });
      });

      budgetRefreshBtn.addEventListener("click", async () => {
        await Promise.all([
          refreshBudgetOverview({ silent: false }),
          refreshFireProgress({ silent: true }),
          refreshBudgetMonthlyReview({ silent: true }),
        ]);
      });

      budgetYear.addEventListener("change", () => {
        refreshBudgetOverview({ silent: true });
        refreshFireProgress({ silent: true });
        refreshBudgetMonthlyReview({ silent: true });
      });

      if (budgetWithdrawalRatePct) {
        budgetWithdrawalRatePct.addEventListener("change", () => {
          refreshFireProgress({ silent: true });
        });
      }

      budgetItemsBody.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const rowEl = target.closest("tr[data-budget-item-id]");
        if (!rowEl) return;
        const itemId = rowEl.getAttribute("data-budget-item-id");
        if (!itemId) return;
        const row = (state.budgetItemsRows || []).find(item => String(item.id) === itemId);
        if (!row) return;

        if (target.classList.contains("js-budget-edit")) {
          setBudgetItemEditMode(row);
          return;
        }

        if (target.classList.contains("js-budget-delete")) {
          const ok = window.confirm(`确认删除预算项「${row.name}」？`);
          if (!ok) return;
          try {
            await api("/api/budgets/monthly-items/delete", "POST", { id: itemId });
            if (state.editingBudgetItem && String(state.editingBudgetItem.id) === itemId) {
              clearBudgetItemEditMode();
            }
            setStatus(budgetItemsStatus, true, `预算项已删除：${row.name}`);
            await Promise.all([
              refreshBudgetItems({ silent: true }),
              refreshBudgetOverview({ silent: true }),
              refreshFireProgress({ silent: true }),
              refreshBudgetMonthlyReview({ silent: true }),
            ]);
          } catch (err) {
            setStatus(budgetItemsStatus, false, err.message || String(err));
          }
        }
      });

      clearBudgetItemEditMode();
      refreshBudgetAnalytics({ silent: true });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initBudget,
    });
