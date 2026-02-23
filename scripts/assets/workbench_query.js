    function initQuery() {
      const qTxMetrics = document.getElementById("qTxMetrics");
      const qTxWrap = document.getElementById("qTxWrap");
      const qTxBody = document.getElementById("qTxBody");
      let transactionRowsCache = [];

      async function loadTransactionQuery() {
        const params = new URLSearchParams({
          month_key: document.getElementById("qMonthKey").value.trim(),
          source_type: document.getElementById("qTxSourceType").value.trim(),
          account_id: document.getElementById("qTxAccountId").value.trim(),
          keyword: document.getElementById("qTxKeyword").value.trim(),
          sort: document.getElementById("qTxSort").value.trim() || "date_desc",
          limit: document.getElementById("qTxLimit").value.trim() || "100",
        });
        const data = await api(`/api/query/transactions?${params.toString()}`);
        transactionRowsCache = data.rows || [];
        showMetrics(qTxMetrics, [
          { k: "总笔数", v: data.summary.count },
          { k: "总金额(元)", v: data.summary.total_amount_yuan },
          { k: "返回条数", v: transactionRowsCache.length },
          { k: "已剔除(返回行)", v: data.summary.excluded_count_in_rows ?? 0, amount: false },
          { k: "剔除金额(元)", v: data.summary.excluded_total_abs_yuan_in_rows || "0.00" },
          { k: "来源", v: data.summary.source_type || "-" },
          { k: "排序", v: data.summary.sort || "-", amount: false },
        ]);
        qTxWrap.classList.remove("hidden");
        qTxBody.innerHTML = transactionRowsCache.map(row => {
          const excluded = Number(row.excluded_in_analysis || 0) === 1;
          const manualExcluded = !!row.manual_excluded;
          let statusText = "计入统计";
          if (excluded && manualExcluded) {
            statusText = `手动剔除${row.manual_exclude_reason ? `（${row.manual_exclude_reason}）` : ""}`;
          } else if (excluded) {
            statusText = `规则剔除${row.exclude_reason ? `（${row.exclude_reason}）` : ""}`;
          }
          const actionHtml = manualExcluded
            ? `<button class="btn secondary q-tx-restore-btn" data-id="${encodeURIComponent(row.id || "")}" type="button">恢复</button>`
            : (excluded
              ? `<span class="hint">规则剔除</span>`
              : `<button class="btn danger q-tx-exclude-btn" data-id="${encodeURIComponent(row.id || "")}" type="button">剔除</button>`);
          return `
          <tr>
            <td>${escapeHtml(row.posted_at || row.occurred_at || "")}</td>
            <td>${escapeHtml(row.merchant_normalized || row.merchant || "")}</td>
            <td>${escapeHtml(row.description || "")}</td>
            <td>${renderAmountValue(money(row.amount_cents))}</td>
            <td>${escapeHtml(row.expense_category || row.statement_category || "")}</td>
            <td>${escapeHtml(row.source_type || "")}</td>
            <td>${escapeHtml(statusText)}</td>
            <td>${actionHtml}</td>
          </tr>
        `;
        }).join("");
        applyAmountMaskInDom(qTxWrap);
      }

      state.refreshTransactionQuery = loadTransactionQuery;
      document.getElementById("qTxBtn").addEventListener("click", loadTransactionQuery);

      qTxBody.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const encodedId = target.getAttribute("data-id") || "";
        const txId = decodeURIComponent(encodedId);
        if (!txId) return;

        if (target.classList.contains("q-tx-exclude-btn")) {
          if (!window.confirm("确认将该交易从统计中剔除？（不会删除原始记录）")) return;
          try {
            await api("/api/transactions/exclusion", "POST", {
              id: txId,
              action: "exclude",
              reason: "查询页手动剔除",
            });
            await loadTransactionQuery();
            if (typeof state.refreshBudgetAnalytics === "function") {
              state.refreshBudgetAnalytics({ silent: true }).catch(() => {});
            }
            if (typeof state.refreshIncomeAnalytics === "function") {
              state.refreshIncomeAnalytics({ silent: true }).catch(() => {});
            }
          } catch (err) {
            window.alert(err.message || String(err));
          }
          return;
        }

        if (target.classList.contains("q-tx-restore-btn")) {
          if (!window.confirm("确认恢复该交易进入统计？")) return;
          try {
            await api("/api/transactions/exclusion", "POST", {
              id: txId,
              action: "restore",
            });
            await loadTransactionQuery();
            if (typeof state.refreshBudgetAnalytics === "function") {
              state.refreshBudgetAnalytics({ silent: true }).catch(() => {});
            }
            if (typeof state.refreshIncomeAnalytics === "function") {
              state.refreshIncomeAnalytics({ silent: true }).catch(() => {});
            }
          } catch (err) {
            window.alert(err.message || String(err));
          }
        }
      });

      const qInvMetrics = document.getElementById("qInvMetrics");
      const qInvWrap = document.getElementById("qInvWrap");
      const qInvBody = document.getElementById("qInvBody");
      let investmentRowsCache = [];
      let invInlineEditId = "";

      function renderInvestmentInlineEditorRow(row) {
        const rowId = escapeHtml(String(row.id || ""));
        const accountId = String(row.account_id || "");
        const snapshotDate = escapeHtml(String(row.snapshot_date || ""));
        const totalAssets = escapeHtml(money(row.total_assets_cents || 0));
        const transferAmount = escapeHtml(money(row.transfer_amount_cents || 0));
        const accountOptions = buildAccountOptionsMarkup(getAccountCatalogRowsByKinds("investment"), {
          selectedValue: accountId,
          blankLabel: "请选择投资账户",
          includeKind: false,
        });
        return `
          <tr class="inline-edit-row">
            <td colspan="6">
              <div class="inline-edit-box" data-edit-id="${rowId}">
                <div class="inline-edit-title">编辑投资记录</div>
                <div class="row-4 inline-edit-grid">
                  <div>
                    <label>投资账户</label>
                    <select data-role="account_id">${accountOptions}</select>
                  </div>
                  <div>
                    <label>快照日期</label>
                    <input type="date" data-role="snapshot_date" value="${snapshotDate}">
                  </div>
                  <div>
                    <label>总资产(元)</label>
                    <input type="number" step="0.01" data-role="total_assets" value="${totalAssets}">
                  </div>
                  <div>
                    <label>转入转出(元)</label>
                    <input type="number" step="0.01" data-role="transfer_amount" value="${transferAmount}">
                  </div>
                </div>
                <div class="actions">
                  <button type="button" class="btn primary small q-inv-inline-save-btn" data-id="${rowId}">保存</button>
                  <button type="button" class="btn secondary small q-inv-inline-cancel-btn">取消</button>
                </div>
              </div>
            </td>
          </tr>
        `;
      }

      function renderInvestmentQueryRows(rows) {
        investmentRowsCache = Array.isArray(rows) ? rows : [];
        qInvBody.innerHTML = investmentRowsCache.map(row => {
          const rowJson = encodeURIComponent(JSON.stringify(row));
          const label = encodeURIComponent(`${row.account_name || row.account_id || ""} ${row.snapshot_date || ""}`);
          const baseRow = `
            <tr data-row-id="${escapeHtml(row.id || "")}">
              <td>${row.snapshot_date || ""}</td>
              <td>${row.account_name || row.account_id || ""}</td>
              <td>${renderAmountValue(money(row.total_assets_cents))}</td>
              <td>${renderAmountValue(money(row.transfer_amount_cents || 0))}</td>
              <td>${row.source_type || ""}</td>
              <td class="actions-cell">
                <button class="btn secondary small q-inv-edit-btn" data-row="${rowJson}">${invInlineEditId === row.id ? "收起" : "编辑"}</button>
                <button class="btn danger small q-inv-del-btn" data-id="${escapeHtml(row.id || "")}" data-label="${label}">删除</button>
              </td>
            </tr>
          `;
          if (row.id && invInlineEditId === row.id) {
            return baseRow + renderInvestmentInlineEditorRow(row);
          }
          return baseRow;
        }).join("");
        applyAmountMaskInDom(qInvWrap);
      }

      async function loadInvestmentQuery() {
        const params = new URLSearchParams({
          from: document.getElementById("qInvFrom").value.trim(),
          to: document.getElementById("qInvTo").value.trim(),
          source_type: document.getElementById("qInvSourceType").value.trim(),
          account_id: document.getElementById("qInvAccountId").value.trim(),
          limit: document.getElementById("qInvLimit").value.trim() || "100",
        });
        const data = await api(`/api/query/investments?${params.toString()}`);
        showMetrics(qInvMetrics, [
          { k: "记录数", v: data.summary.count },
          { k: "最新总资产(元)", v: data.summary.latest_total_assets_yuan },
          { k: "区间转入转出(元)", v: data.summary.net_transfer_amount_yuan },
          { k: "来源", v: data.summary.source_type || "-" },
        ]);
        qInvWrap.classList.remove("hidden");
        if (invInlineEditId && !(data.rows || []).some(row => row.id === invInlineEditId)) {
          invInlineEditId = "";
        }
        renderInvestmentQueryRows(data.rows || []);
      }
      state.refreshInvestmentQuery = loadInvestmentQuery;
      document.getElementById("qInvBtn").addEventListener("click", () => {
        loadInvestmentQuery().catch(err => window.alert(err.message || String(err)));
      });

      qInvBody.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("q-inv-edit-btn")) {
          try {
            const raw = decodeURIComponent(target.getAttribute("data-row") || "{}");
            const row = JSON.parse(raw);
            invInlineEditId = invInlineEditId === row.id ? "" : String(row.id || "");
            renderInvestmentQueryRows(investmentRowsCache);
          } catch {
            window.alert("投资记录解析失败");
          }
          return;
        }

        if (target.classList.contains("q-inv-inline-cancel-btn")) {
          invInlineEditId = "";
          renderInvestmentQueryRows(investmentRowsCache);
          return;
        }

        if (target.classList.contains("q-inv-inline-save-btn")) {
          const id = (target.getAttribute("data-id") || "").trim();
          const box = target.closest(".inline-edit-box");
          if (!id || !box) return;
          const accountId = box.querySelector('[data-role="account_id"]');
          const snapshotDate = box.querySelector('[data-role="snapshot_date"]');
          const totalAssets = box.querySelector('[data-role="total_assets"]');
          const transferAmount = box.querySelector('[data-role="transfer_amount"]');
          try {
            const selectedAccountId = accountId ? accountId.value.trim() : "";
            if (!selectedAccountId) throw new Error("请选择投资账户");
            await api("/api/investments/update", "POST", {
              id,
              account_id: selectedAccountId,
              snapshot_date: snapshotDate ? snapshotDate.value.trim() : "",
              total_assets: totalAssets ? totalAssets.value.trim() : "",
              transfer_amount: transferAmount ? transferAmount.value.trim() : "",
            });
            invInlineEditId = "";
            await refreshInvestmentAccounts();
            await loadInvestmentQuery();
          } catch (err) {
            window.alert(err.message || String(err));
          }
          return;
        }

        if (target.classList.contains("q-inv-del-btn")) {
          const id = (target.getAttribute("data-id") || "").trim();
          const label = decodeURIComponent(target.getAttribute("data-label") || "");
          if (!id) return;
          if (!window.confirm(`确认删除投资记录：${label} ?`)) return;
          try {
            await api("/api/investments/delete", "POST", { id });
            await refreshInvestmentAccounts();
            await loadInvestmentQuery();
          } catch (err) {
            window.alert(err.message || String(err));
          }
        }
      });

      const qAssetMetrics = document.getElementById("qAssetMetrics");
      const qAssetWrap = document.getElementById("qAssetWrap");
      const qAssetBody = document.getElementById("qAssetBody");
      let assetRowsCache = [];
      let assetInlineEditId = "";

      function renderAssetInlineEditorRow(row) {
        const rowId = escapeHtml(String(row.id || ""));
        const accountId = String(row.account_id || "");
        const snapshotDate = escapeHtml(String(row.snapshot_date || ""));
        const value = escapeHtml(money(row.value_cents || 0));
        const assetClass = String(row.asset_class || "cash");
        const assetAccountRows = getAccountCatalogRowsByKinds(
          assetClass === "real_estate" ? "real_estate" : (assetClass === "liability" ? "liability" : "cash")
        );
        const accountOptions = buildAccountOptionsMarkup(assetAccountRows, {
          selectedValue: accountId,
          blankLabel: assetClass === "real_estate"
            ? "请选择不动产账户"
            : (assetClass === "liability" ? "请选择负债账户" : "请选择现金账户"),
          includeKind: false,
        });
        return `
          <tr class="inline-edit-row">
            <td colspan="6">
              <div class="inline-edit-box" data-edit-id="${rowId}">
                <div class="inline-edit-title">编辑资产记录</div>
                <div class="row-4 inline-edit-grid">
                  <div>
                    <label>资产类型</label>
                    <select data-role="asset_class">
                      <option value="cash"${assetClass === "cash" ? " selected" : ""}>现金</option>
                      <option value="real_estate"${assetClass === "real_estate" ? " selected" : ""}>不动产</option>
                      <option value="liability"${assetClass === "liability" ? " selected" : ""}>负债</option>
                    </select>
                  </div>
                  <div>
                    <label>账户</label>
                    <select data-role="account_id">${accountOptions}</select>
                  </div>
                  <div>
                    <label>快照日期</label>
                    <input type="date" data-role="snapshot_date" value="${snapshotDate}">
                  </div>
                  <div>
                    <label>金额(元)</label>
                    <input type="number" step="0.01" data-role="value" value="${value}">
                  </div>
                </div>
                <div class="actions">
                  <button type="button" class="btn primary small q-asset-inline-save-btn" data-id="${rowId}">保存</button>
                  <button type="button" class="btn secondary small q-asset-inline-cancel-btn">取消</button>
                </div>
              </div>
            </td>
          </tr>
        `;
      }

      function renderAssetQueryRows(rows) {
        assetRowsCache = Array.isArray(rows) ? rows : [];
        qAssetBody.innerHTML = assetRowsCache.map(row => {
          const rowJson = encodeURIComponent(JSON.stringify(row));
          const label = encodeURIComponent(`${row.account_name || row.account_id || ""} ${row.snapshot_date || ""}`);
          const baseRow = `
            <tr data-row-id="${escapeHtml(row.id || "")}">
              <td>${row.snapshot_date}</td>
              <td>${row.asset_class}</td>
              <td>${row.account_name || row.account_id}</td>
              <td>${renderAmountValue(money(row.value_cents))}</td>
              <td>${row.source_type || ""}</td>
              <td class="actions-cell">
                <button class="btn secondary small q-asset-edit-btn" data-row="${rowJson}">${assetInlineEditId === row.id ? "收起" : "编辑"}</button>
                <button class="btn danger small q-asset-del-btn" data-id="${escapeHtml(row.id || "")}" data-label="${label}">删除</button>
              </td>
            </tr>
          `;
          if (row.id && assetInlineEditId === row.id) {
            return baseRow + renderAssetInlineEditorRow(row);
          }
          return baseRow;
        }).join("");
        applyAmountMaskInDom(qAssetWrap);
      }

      async function loadAssetQuery() {
        const params = new URLSearchParams({
          from: document.getElementById("qAssetFrom").value.trim(),
          to: document.getElementById("qAssetTo").value.trim(),
          asset_class: document.getElementById("qAssetClass").value,
          account_id: document.getElementById("qAssetAccountId").value.trim(),
          limit: document.getElementById("qAssetLimit").value.trim() || "100",
        });
        const data = await api(`/api/query/assets?${params.toString()}`);
        showMetrics(qAssetMetrics, [
          { k: "记录数", v: data.summary.count },
          { k: "金额合计(元)", v: data.summary.sum_value_yuan },
          { k: "资产类型", v: data.summary.asset_class || "全部" },
          { k: "返回条数", v: data.rows.length },
        ]);
        qAssetWrap.classList.remove("hidden");
        if (assetInlineEditId && !(data.rows || []).some(row => row.id === assetInlineEditId)) {
          assetInlineEditId = "";
        }
        renderAssetQueryRows(data.rows || []);
      }
      state.refreshAssetQuery = loadAssetQuery;
      document.getElementById("qAssetBtn").addEventListener("click", () => {
        loadAssetQuery().catch(err => window.alert(err.message || String(err)));
      });
      document.getElementById("qAssetClass").addEventListener("change", () => {
        refreshAccountSelectorsFromCatalog();
      });

      qAssetBody.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("q-asset-edit-btn")) {
          try {
            const raw = decodeURIComponent(target.getAttribute("data-row") || "{}");
            const row = JSON.parse(raw);
            assetInlineEditId = assetInlineEditId === row.id ? "" : String(row.id || "");
            renderAssetQueryRows(assetRowsCache);
          } catch {
            window.alert("资产记录解析失败");
          }
          return;
        }

        if (target.classList.contains("q-asset-inline-cancel-btn")) {
          assetInlineEditId = "";
          renderAssetQueryRows(assetRowsCache);
          return;
        }

        if (target.classList.contains("q-asset-inline-save-btn")) {
          const id = (target.getAttribute("data-id") || "").trim();
          const box = target.closest(".inline-edit-box");
          if (!id || !box) return;
          const assetClass = box.querySelector('[data-role="asset_class"]');
          const accountId = box.querySelector('[data-role="account_id"]');
          const snapshotDate = box.querySelector('[data-role="snapshot_date"]');
          const valueInput = box.querySelector('[data-role="value"]');
          try {
            const selectedAccountId = accountId ? accountId.value.trim() : "";
            if (!selectedAccountId) throw new Error("请选择资产账户");
            await api("/api/assets/update", "POST", {
              id,
              asset_class: assetClass ? assetClass.value : "",
              account_id: selectedAccountId,
              snapshot_date: snapshotDate ? snapshotDate.value.trim() : "",
              value: valueInput ? valueInput.value.trim() : "",
            });
            assetInlineEditId = "";
            if (typeof state.refreshWealthAnalytics === "function") {
              await state.refreshWealthAnalytics({ silent: true });
            }
            await loadAssetQuery();
          } catch (err) {
            window.alert(err.message || String(err));
          }
          return;
        }

        if (target.classList.contains("q-asset-del-btn")) {
          const id = (target.getAttribute("data-id") || "").trim();
          const label = decodeURIComponent(target.getAttribute("data-label") || "");
          if (!id) return;
          if (!window.confirm(`确认删除资产记录：${label} ?`)) return;
          try {
            await api("/api/assets/delete", "POST", { id });
            if (typeof state.refreshWealthAnalytics === "function") {
              await state.refreshWealthAnalytics({ silent: true });
            }
            await loadAssetQuery();
          } catch (err) {
            window.alert(err.message || String(err));
          }
        }
      });

      qAssetBody.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('select[data-role="asset_class"]')) return;
        const box = target.closest(".inline-edit-box");
        if (!box) return;
        const accountSelect = box.querySelector('select[data-role="account_id"]');
        if (!(accountSelect instanceof HTMLSelectElement)) return;
        const assetClass = target.value === "real_estate"
          ? "real_estate"
          : (target.value === "liability" ? "liability" : "cash");
        const rows = getAccountCatalogRowsByKinds(assetClass);
        accountSelect.innerHTML = buildAccountOptionsMarkup(rows, {
          selectedValue: "",
          blankLabel: assetClass === "real_estate"
            ? "请选择不动产账户"
            : (assetClass === "liability" ? "请选择负债账户" : "请选择现金账户"),
          includeKind: false,
        });
      });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initQuery,
    });
