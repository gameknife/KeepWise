    function wbNs() {
      return window.keepwiseWorkbench || {};
    }

    function wbApi(...args) {
      return (wbNs().api || api)(...args);
    }

    function wbShowMetrics(...args) {
      return (wbNs().showMetrics || showMetrics)(...args);
    }

    function wbSetStatus(...args) {
      return (wbNs().setStatus || setStatus)(...args);
    }

    function wbRefreshInvestmentAccounts(...args) {
      return (wbNs().refreshInvestmentAccounts || refreshInvestmentAccounts)(...args);
    }

    function initAdmin() {
      const adminStatus = document.getElementById("adminStatus");
      const adminMetrics = document.getElementById("adminMetrics");
      const adminRowsWrap = document.getElementById("adminRowsWrap");
      const adminRowsBody = document.getElementById("adminRowsBody");
      const adminConfirmPhrase = document.getElementById("adminConfirmPhrase");
      const adminConfirmText = document.getElementById("adminConfirmText");

      function renderAdminRows(beforeRows, afterRows) {
        const afterMap = new Map((afterRows || []).map(item => [item.table, Number(item.row_count || 0)]));
        const base = beforeRows || [];
        adminRowsWrap.classList.remove("hidden");
        adminRowsBody.innerHTML = base.map(item => {
          const before = Number(item.row_count || 0);
          const after = Number(afterMap.has(item.table) ? afterMap.get(item.table) : 0);
          return `
            <tr>
              <td>${item.table}</td>
              <td>${before}</td>
              <td>${after}</td>
              <td>${before - after}</td>
            </tr>
          `;
        }).join("");
      }

      async function loadAdminStats(options = {}) {
        const { silent = false } = options;
        const data = await wbApi("/api/admin/db-stats");
        adminConfirmPhrase.textContent = data.confirm_phrase || "-";
        wbShowMetrics(adminMetrics, [
          { k: "数据表数量", v: data.summary.table_count },
          { k: "当前总行数", v: data.summary.total_rows },
          { k: "确认口令", v: data.confirm_phrase || "-" },
          { k: "数据库", v: "keepwise.db" },
        ]);
        renderAdminRows(data.rows || [], data.rows || []);
        if (!silent) {
          wbSetStatus(adminStatus, true, `数据库统计已更新，当前共 ${data.summary.total_rows} 行`);
        }
      }

      document.getElementById("adminLoadStatsBtn").addEventListener("click", async () => {
        try {
          await loadAdminStats({ silent: false });
        } catch (err) {
          wbSetStatus(adminStatus, false, err.message || String(err));
        }
      });

      document.getElementById("adminResetTxBtn").addEventListener("click", async () => {
        try {
          const payload = await wbApi("/api/admin/reset-transactions", "POST", {
            confirm_text: adminConfirmText.value.trim(),
            clear_import_sessions: true,
          });
          wbShowMetrics(adminMetrics, [
            { k: "清理范围", v: "交易数据（EML/PDF）" },
            { k: "清理前总行数", v: payload.summary.total_rows_before },
            { k: "清理后总行数", v: payload.summary.total_rows_after },
            { k: "已删除行数", v: payload.summary.deleted_rows },
          ]);
          renderAdminRows(payload.before_rows || [], payload.after_rows || []);
          wbSetStatus(
            adminStatus,
            true,
            `交易数据已清理，可重新导入 EML/PDF（清理会话目录 ${payload.cleared_preview_sessions || 0} 个）`
          );
          adminConfirmText.value = "";
          if (typeof state.refreshBudgetAnalytics === "function") {
            state.refreshBudgetAnalytics().catch(() => {});
          }
          if (typeof state.refreshTransactionQuery === "function") {
            state.refreshTransactionQuery().catch(() => {});
          }
          if (typeof state.refreshIncomeAnalytics === "function") {
            state.refreshIncomeAnalytics().catch(() => {});
          }
          if (typeof state.refreshInvestmentQuery === "function") {
            state.refreshInvestmentQuery().catch(() => {});
          }
          if (typeof state.refreshAssetQuery === "function") {
            state.refreshAssetQuery().catch(() => {});
          }
        } catch (err) {
          wbSetStatus(adminStatus, false, err.message || String(err));
        }
      });

      document.getElementById("adminResetDbBtn").addEventListener("click", async () => {
        try {
          const payload = await wbApi("/api/admin/reset-db", "POST", {
            confirm_text: adminConfirmText.value.trim(),
            clear_import_sessions: true,
          });
          wbShowMetrics(adminMetrics, [
            { k: "数据表数量", v: payload.summary.table_count },
            { k: "清理前总行数", v: payload.summary.total_rows_before },
            { k: "清理后总行数", v: payload.summary.total_rows_after },
            { k: "已删除行数", v: payload.summary.deleted_rows },
          ]);
          renderAdminRows(payload.before_rows || [], payload.after_rows || []);
          wbSetStatus(
            adminStatus,
            true,
            `数据库已清空，可重新导入验证（清理会话目录 ${payload.cleared_preview_sessions || 0} 个）`
          );
          adminConfirmText.value = "";
          await wbRefreshInvestmentAccounts();
          if (typeof state.refreshTransactionQuery === "function") {
            state.refreshTransactionQuery().catch(() => {});
          }
          if (typeof state.refreshIncomeAnalytics === "function") {
            state.refreshIncomeAnalytics().catch(() => {});
          }
        } catch (err) {
          wbSetStatus(adminStatus, false, err.message || String(err));
        }
      });

      loadAdminStats({ silent: true }).catch(() => {
        adminConfirmPhrase.textContent = "RESET KEEPWISE";
      });
    }

    async function init() {
      (wbNs().initTabs || initTabs)();
      (wbNs().initPrivacyToggle || initPrivacyToggle)();

      (wbNs().setTodayIfEmpty || setTodayIfEmpty)("invSnapshotDate");
      (wbNs().setTodayIfEmpty || setTodayIfEmpty)("assetSnapshotDate");

      await (wbNs().initImportActions || initImportActions)();
      (wbNs().initRecordActions || initRecordActions)();
      (wbNs().initReturnAnalytics || initReturnAnalytics)();
      (wbNs().initWealth || initWealth)();
      (wbNs().initBudget || initBudget)();
      (wbNs().initIncome || initIncome)();
      (wbNs().initConsumptionEmbed || initConsumptionEmbed)();
      (wbNs().initAccountManagement || initAccountManagement)();
      (wbNs().initQuery || initQuery)();
      initAdmin();
      await wbRefreshInvestmentAccounts();
    }

    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initAdmin,
      init,
    });

    init();
