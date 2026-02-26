    async function refreshInvestmentAccounts() {
      const data = await api("/api/meta/accounts?kind=investment");
      state.investmentAccounts = data.investment_accounts || [];
      const accountOptions = state.investmentAccounts
        .map(item => `<option value="${item.account_id}">${item.account_name} (${item.account_id})</option>`)
        .join("");
      const options = state.investmentAccounts.length > 0
        ? `<option value="__portfolio__">全部投资账户（组合）</option>${accountOptions}`
        : "";

      ["retAccountId"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const prev = el.value;
        el.innerHTML = options || `<option value="">暂无投资账户</option>`;
        if (prev && Array.from(el.options).some(opt => opt.value === prev)) {
          el.value = prev;
        }
      });

      await refreshAccountCatalog();

      if (typeof state.refreshReturnAnalytics === "function") {
        await state.refreshReturnAnalytics({ silent: true });
      }
      if (typeof state.refreshReturnBatchAnalytics === "function") {
        await state.refreshReturnBatchAnalytics({ silent: true });
      }
      if (typeof state.refreshWealthAnalytics === "function") {
        await state.refreshWealthAnalytics({ silent: true });
      }
    }

    async function initImportActions() {
      const emlFiles = document.getElementById("emlFiles");
      const emlThreshold = document.getElementById("emlThreshold");
      const emlStatus = document.getElementById("emlStatus");
      const emlMetrics = document.getElementById("emlMetrics");
      const emlErrorsWrap = document.getElementById("emlErrorsWrap");
      const emlErrorsBody = document.getElementById("emlErrorsBody");

      document.getElementById("emlPreviewBtn").addEventListener("click", async () => {
        try {
          const files = await collectFiles(emlFiles);
          if (files.length === 0) throw new Error("请至少选择一个 .eml 文件");
          const data = await api("/api/eml/preview", "POST", {
            files,
            review_threshold: Number(emlThreshold.value || 0.7),
          });
          state.emlPreviewToken = data.preview_token;
          setStatus(emlStatus, true, "EML 预览完成，可确认导入。");
          showMetrics(emlMetrics, [
            { k: "文件数", v: data.summary.input_files_count },
            { k: "交易数", v: data.summary.records_count },
            { k: "消费笔数", v: data.summary.consume_count },
            { k: "待确认", v: data.summary.needs_review_count },
          ]);
          const errors = data.summary.failed_files || [];
          if (errors.length > 0) {
            emlErrorsWrap.classList.remove("hidden");
            emlErrorsBody.innerHTML = errors.map(e => `<tr><td>${e.file}</td><td>${e.error}</td></tr>`).join("");
          } else {
            hide(emlErrorsWrap);
          }
        } catch (err) {
          setStatus(emlStatus, false, err.message || String(err));
          hide(emlMetrics);
        }
      });

      document.getElementById("emlImportBtn").addEventListener("click", async () => {
        try {
          if (!state.emlPreviewToken) throw new Error("请先做 EML 预览。");
          const data = await api("/api/eml/import", "POST", {
            preview_token: state.emlPreviewToken,
            review_threshold: Number(emlThreshold.value || 0.7),
          });
          setStatus(
            emlStatus,
            true,
            `EML 导入成功：交易 ${data.imported_count} 条，失败 ${data.import_error_count} 条，任务ID ${data.import_job_id}`
          );
          await refreshAccountCatalog();
        } catch (err) {
          setStatus(emlStatus, false, err.message || String(err));
        }
      });

      const yzxyCsvFile = document.getElementById("yzxyCsvFile");
      const yzxyStatus = document.getElementById("yzxyStatus");
      const yzxyMetrics = document.getElementById("yzxyMetrics");
      const yzxyErrorsWrap = document.getElementById("yzxyErrorsWrap");
      const yzxyErrorsBody = document.getElementById("yzxyErrorsBody");

      document.getElementById("yzxyPreviewBtn").addEventListener("click", async () => {
        try {
          const files = await collectFiles(yzxyCsvFile);
          if (files.length !== 1) throw new Error("请只选择一个 CSV 或 XLSX 文件");
          const data = await api("/api/yzxy/preview", "POST", { file: files[0] });
          state.yzxyPreviewToken = data.preview_token;
          setStatus(yzxyStatus, true, "文件预览完成，可确认导入。");
          showMetrics(yzxyMetrics, [
            { k: "解析成功", v: data.preview.parsed_count },
            { k: "错误数", v: data.preview.error_count },
            { k: "映射列数", v: Object.keys(data.preview.mapping || {}).length },
            { k: "预览行", v: (data.preview.preview_rows || []).length },
          ]);
          const errors = data.preview.errors || [];
          if (errors.length > 0) {
            yzxyErrorsWrap.classList.remove("hidden");
            yzxyErrorsBody.innerHTML = errors.map(e => `<tr><td>${e}</td></tr>`).join("");
          } else {
            hide(yzxyErrorsWrap);
          }
        } catch (err) {
          setStatus(yzxyStatus, false, err.message || String(err));
          hide(yzxyMetrics);
        }
      });

      document.getElementById("yzxyImportBtn").addEventListener("click", async () => {
        try {
          if (!state.yzxyPreviewToken) throw new Error("请先做文件预览。");
          const data = await api("/api/yzxy/import", "POST", { preview_token: state.yzxyPreviewToken });
          setStatus(
            yzxyStatus,
            true,
            `导入成功：记录 ${data.imported_count} 条，失败 ${data.error_count} 条，任务ID ${data.import_job_id}`
          );
          await refreshInvestmentAccounts();
        } catch (err) {
          setStatus(yzxyStatus, false, err.message || String(err));
        }
      });

      const cmbBankPdfFile = document.getElementById("cmbBankPdfFile");
      const cmbBankPdfStatus = document.getElementById("cmbBankPdfStatus");
      const cmbBankPdfMetrics = document.getElementById("cmbBankPdfMetrics");
      const cmbBankPdfSamplesWrap = document.getElementById("cmbBankPdfSamplesWrap");
      const cmbBankPdfSamplesBody = document.getElementById("cmbBankPdfSamplesBody");

      function renderBankPdfPreview(preview) {
        const summary = preview?.summary || {};
        const ruleCounts = preview?.rule_counts || {};
        showMetrics(cmbBankPdfMetrics, [
          { k: "总记录数", v: summary.total_records ?? "-" },
          { k: "可导入记录", v: summary.import_rows_count ?? "-" },
          { k: "支出记录", v: summary.expense_rows_count ?? "-" },
          { k: "收入记录", v: summary.income_rows_count ?? "-" },
          { k: "工资规则命中", v: ruleCounts.salary ?? 0 },
          { k: "房贷固定月供", v: ruleCounts.mortgage_fixed ?? 0 },
          { k: "微信转账/红包", v: ruleCounts.wechat_transfer_redpacket ?? 0 },
          { k: "非人民币忽略", v: ruleCounts.skip_non_cny ?? 0 },
        ]);

        const sampleRows = [];
        for (const [kind, rows] of Object.entries(preview?.samples || {})) {
          for (const row of (rows || [])) {
            sampleRows.push({
              kind,
              date: row.date || "-",
              amount: row.amount || "-",
              counterparty: row.counterparty || "-",
            });
          }
        }
        if (sampleRows.length > 0) {
          cmbBankPdfSamplesWrap.classList.remove("hidden");
          cmbBankPdfSamplesBody.innerHTML = sampleRows.map(row => `
            <tr>
              <td>${escapeHtml(row.kind)}</td>
              <td>${escapeHtml(row.date)}</td>
              <td>${renderAmountValue(row.amount)}</td>
              <td>${escapeHtml(row.counterparty)}</td>
            </tr>
          `).join("");
          applyAmountMaskInDom(cmbBankPdfSamplesWrap);
        } else {
          hide(cmbBankPdfSamplesWrap);
        }
      }

      document.getElementById("cmbBankPdfPreviewBtn").addEventListener("click", async () => {
        try {
          const files = await collectFiles(cmbBankPdfFile);
          if (files.length !== 1) throw new Error("请只选择一个招商银行流水 PDF 文件");
          const data = await api("/api/cmb-bank-pdf/preview", "POST", { file: files[0] });
          state.cmbBankPdfPreviewToken = data.preview_token;
          renderBankPdfPreview(data.preview);
          const info = data.preview?.file || {};
          const header = data.preview?.header || {};
          setStatus(
            cmbBankPdfStatus,
            true,
            `PDF 预览完成：尾号${header.account_last4 || "-"}，区间 ${header.range_start || "-"} ~ ${header.range_end || "-"}，稳定源ID ${info.stable_source_name || "-"}`
          );
        } catch (err) {
          setStatus(cmbBankPdfStatus, false, err.message || String(err));
          hide(cmbBankPdfMetrics);
          hide(cmbBankPdfSamplesWrap);
        }
      });

      document.getElementById("cmbBankPdfImportBtn").addEventListener("click", async () => {
        try {
          if (!state.cmbBankPdfPreviewToken) throw new Error("请先预览 PDF。");
          const data = await api("/api/cmb-bank-pdf/import", "POST", {
            preview_token: state.cmbBankPdfPreviewToken,
          });
          renderBankPdfPreview(data.preview || {});
          setStatus(
            cmbBankPdfStatus,
            true,
            `银行流水 PDF 导入成功：记录 ${data.imported_count} 条，失败 ${data.import_error_count} 条，任务ID ${data.import_job_id}`
          );
          await refreshAccountCatalog();
          if (typeof state.refreshBudgetAnalytics === "function") {
            await state.refreshBudgetAnalytics({ silent: true });
          }
          if (typeof state.refreshIncomeAnalytics === "function") {
            await state.refreshIncomeAnalytics({ silent: true });
          }
        } catch (err) {
          setStatus(cmbBankPdfStatus, false, err.message || String(err));
        }
      });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      refreshInvestmentAccounts,
      initImportActions,
    });
