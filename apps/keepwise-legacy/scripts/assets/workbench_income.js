    function wbNs() {
      return window.keepwiseWorkbench || {};
    }

    function wbApi(...args) {
      return (wbNs().api || api)(...args);
    }

    function wbShowMetrics(...args) {
      return (wbNs().showMetrics || showMetrics)(...args);
    }

    function wbEscapeHtml(...args) {
      return (wbNs().escapeHtml || escapeHtml)(...args);
    }

    function wbRenderAmountValue(...args) {
      return (wbNs().renderAmountValue || renderAmountValue)(...args);
    }

    function wbApplyAmountMaskInDom(...args) {
      return (wbNs().applyAmountMaskInDom || applyAmountMaskInDom)(...args);
    }

    function wbHide(...args) {
      return (wbNs().hide || hide)(...args);
    }

    function wbSetStatus(...args) {
      return (wbNs().setStatus || setStatus)(...args);
    }

    function initIncome() {
      const incomeYear = document.getElementById("incomeYear");
      const incomeRefreshBtn = document.getElementById("incomeRefreshBtn");
      const incomeStatus = document.getElementById("incomeStatus");
      const incomeMetrics = document.getElementById("incomeMetrics");
      const incomeMonthlyWrap = document.getElementById("incomeMonthlyWrap");
      const incomeMonthlyBody = document.getElementById("incomeMonthlyBody");
      const incomeEmployerWrap = document.getElementById("incomeEmployerWrap");
      const incomeEmployerBody = document.getElementById("incomeEmployerBody");

      if (!incomeYear || !incomeRefreshBtn) return;
      if (!incomeYear.value) incomeYear.value = String(new Date().getFullYear());

      function selectedYear() {
        const n = Number(String(incomeYear.value || "").trim());
        if (!Number.isFinite(n) || n < 2000 || n > 2100) return new Date().getFullYear();
        return Math.trunc(n);
      }

      async function refreshIncomeAnalytics(options = {}) {
        const { silent = true } = options;
        try {
          const year = selectedYear();
          const data = await wbApi(`/api/analytics/salary-income?year=${encodeURIComponent(year)}`);
          const s = data.summary || {};
          wbShowMetrics(incomeMetrics, [
            { k: "统计年度", v: data.year, amount: false },
            { k: "工资收入(元)", v: s.salary_total_yuan || "0.00" },
            { k: "公积金收入(元)", v: s.housing_fund_total_yuan || "0.00" },
            { k: "收入合计(元)", v: s.total_income_yuan || "0.00" },
            { k: "工资笔数", v: s.salary_tx_count || 0, amount: false },
            { k: "公积金笔数", v: s.housing_fund_tx_count || 0, amount: false },
            { k: "工资月份数", v: s.months_with_salary || 0, amount: false },
            { k: "雇主数", v: s.employer_count || 0, amount: false },
          ]);

          const monthlyRows = data.rows || [];
          incomeMonthlyWrap.classList.remove("hidden");
          incomeMonthlyBody.innerHTML = monthlyRows.map(row => `
              <tr>
              <td>${wbEscapeHtml(row.month_key || "-")}</td>
              <td>${wbRenderAmountValue(row.salary_yuan || "0.00")}</td>
              <td>${wbEscapeHtml(String(row.salary_tx_count || 0))}</td>
              <td>${wbRenderAmountValue(row.housing_fund_yuan || "0.00")}</td>
              <td>${wbEscapeHtml(String(row.housing_fund_tx_count || 0))}</td>
              <td>${wbRenderAmountValue(row.total_income_yuan || "0.00")}</td>
            </tr>
          `).join("");
          wbApplyAmountMaskInDom(incomeMonthlyWrap);

          const employerRows = data.employers || [];
          if (employerRows.length > 0) {
            incomeEmployerWrap.classList.remove("hidden");
            incomeEmployerBody.innerHTML = employerRows.map(row => `
              <tr>
                <td>${wbEscapeHtml(row.employer || "-")}</td>
                <td>${wbRenderAmountValue(row.amount_yuan || "0.00")}</td>
                <td>${wbEscapeHtml(String(row.tx_count || 0))}</td>
              </tr>
            `).join("");
            wbApplyAmountMaskInDom(incomeEmployerWrap);
          } else {
            wbHide(incomeEmployerWrap);
            incomeEmployerBody.innerHTML = "";
          }

          if (!silent) {
            wbSetStatus(incomeStatus, true, `收入分析已更新（${data.year}年，来源：招商银行流水 PDF）`);
          }
        } catch (err) {
          wbHide(incomeMetrics);
          wbHide(incomeMonthlyWrap);
          wbHide(incomeEmployerWrap);
          incomeMonthlyBody.innerHTML = "";
          incomeEmployerBody.innerHTML = "";
          wbSetStatus(incomeStatus, false, err.message || String(err));
        }
      }

      state.refreshIncomeAnalytics = refreshIncomeAnalytics;
      incomeRefreshBtn.addEventListener("click", () => refreshIncomeAnalytics({ silent: false }));
      incomeYear.addEventListener("change", () => refreshIncomeAnalytics({ silent: true }));

      refreshIncomeAnalytics({ silent: true });
    }

    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initIncome,
    });
