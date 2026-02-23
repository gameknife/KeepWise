    function initAccountManagement() {
      const acctStatus = document.getElementById("acctStatus");
      const acctMetrics = document.getElementById("acctMetrics");
      const acctWrap = document.getElementById("acctWrap");
      const acctBody = document.getElementById("acctBody");
      const acctKind = document.getElementById("acctKind");
      const acctName = document.getElementById("acctName");
      const acctEditingId = document.getElementById("acctEditingId");
      const acctSaveBtn = document.getElementById("acctSaveBtn");
      const acctCancelEditBtn = document.getElementById("acctCancelEditBtn");
      const acctEditHint = document.getElementById("acctEditHint");
      const acctFilterKind = document.getElementById("acctFilterKind");
      const acctKeyword = document.getElementById("acctKeyword");

      function setAccountEditMode(row) {
        state.editingAccountRecord = row || null;
        const editing = !!state.editingAccountRecord;
        acctSaveBtn.textContent = editing ? "更新账户" : "创建账户";
        acctCancelEditBtn.classList.toggle("hidden", !editing);
        acctEditHint.classList.toggle("hidden", !editing);
        acctEditingId.textContent = editing ? (row.account_id || "-") : "-";
        acctKind.disabled = editing;
      }

      function clearAccountEditMode() {
        state.editingAccountRecord = null;
        acctKind.value = "investment";
        acctName.value = "";
        setAccountEditMode(null);
      }

      function getFilteredAccountRows() {
        const kind = String(acctFilterKind.value || "all");
        const keyword = String(acctKeyword.value || "").trim().toLowerCase();
        return (state.accountCatalogRows || []).filter(row => {
          if (kind !== "all" && String(row.account_kind || "") !== kind) return false;
          if (!keyword) return true;
          const haystack = [
            row.account_id,
            row.account_name,
            row.account_kind,
            row.account_type,
          ].map(v => String(v || "")).join(" ").toLowerCase();
          return haystack.includes(keyword);
        });
      }

      function renderAccountCatalog() {
        const rows = getFilteredAccountRows();
        const referencedCount = rows.filter(row =>
          Number(row.transaction_count || 0) > 0
          || Number(row.investment_record_count || 0) > 0
          || Number(row.asset_valuation_count || 0) > 0
        ).length;
        showMetrics(acctMetrics, [
          { k: "账户数", v: rows.length, amount: false },
          { k: "已引用账户", v: referencedCount, amount: false },
          { k: "投资账户", v: rows.filter(r => r.account_kind === "investment").length, amount: false },
          { k: "资产/负债账户", v: rows.filter(r => ["cash", "real_estate", "liability"].includes(String(r.account_kind || ""))).length, amount: false },
        ]);

        acctWrap.classList.remove("hidden");
        if (rows.length === 0) {
          acctBody.innerHTML = `<tr><td colspan="8">暂无账户</td></tr>`;
          return;
        }

        acctBody.innerHTML = rows.map(row => {
          const rowJson = encodeURIComponent(JSON.stringify({
            account_id: row.account_id,
            account_name: row.account_name,
            account_kind: row.account_kind,
          }));
          const canDelete = Number(row.transaction_count || 0) === 0
            && Number(row.investment_record_count || 0) === 0
            && Number(row.asset_valuation_count || 0) === 0;
          return `
            <tr>
              <td>${accountKindLabel(row.account_kind)}</td>
              <td>${escapeHtml(row.account_name || "")}</td>
              <td>${escapeHtml(row.account_id || "")}</td>
              <td>${Number(row.transaction_count || 0)}</td>
              <td>${Number(row.investment_record_count || 0)}</td>
              <td>${Number(row.asset_valuation_count || 0)}</td>
              <td>${escapeHtml(String(row.updated_at || "").replace("T", " ").slice(0, 19))}</td>
              <td class="actions-cell">
                <button type="button" class="btn secondary small acct-edit-btn" data-row="${rowJson}">编辑</button>
                <button type="button" class="btn danger small acct-del-btn" data-id="${escapeHtml(row.account_id || "")}"${canDelete ? "" : " disabled"}>删除</button>
              </td>
            </tr>
          `;
        }).join("");
      }

      state.renderAccountCatalog = renderAccountCatalog;

      document.getElementById("acctFilterBtn").addEventListener("click", renderAccountCatalog);
      document.getElementById("acctClearFilterBtn").addEventListener("click", () => {
        acctFilterKind.value = "all";
        acctKeyword.value = "";
        renderAccountCatalog();
      });
      acctFilterKind.addEventListener("change", renderAccountCatalog);
      acctKeyword.addEventListener("input", () => {
        renderAccountCatalog();
      });

      acctCancelEditBtn.addEventListener("click", () => {
        clearAccountEditMode();
        setStatus(acctStatus, true, "已退出账户编辑模式");
      });

      document.getElementById("acctRefreshBtn").addEventListener("click", async () => {
        try {
          await refreshAccountCatalog();
          setStatus(acctStatus, true, `账户列表已刷新，共 ${(state.accountCatalogRows || []).length} 个账户`);
        } catch (err) {
          setStatus(acctStatus, false, err.message || String(err));
        }
      });

      acctSaveBtn.addEventListener("click", async () => {
        try {
          const accountKind = String(acctKind.value || "").trim();
          const accountName = String(acctName.value || "").trim();
          if (!accountKind) throw new Error("请选择账户类型");
          if (!accountName) throw new Error("请输入账户名称");
          const payload = {
            account_kind: accountKind,
            account_name: accountName,
          };
          if (state.editingAccountRecord && state.editingAccountRecord.account_id) {
            payload.account_id = state.editingAccountRecord.account_id;
          }
          const data = await api("/api/accounts/upsert", "POST", payload);
          setStatus(
            acctStatus,
            true,
            payload.account_id
              ? `账户已更新：${data.row?.account_name || accountName}`
              : `账户已创建：${data.row?.account_name || accountName}`
          );
          clearAccountEditMode();
          await refreshInvestmentAccounts();
          if (typeof state.refreshInvestmentQuery === "function") {
            await state.refreshInvestmentQuery({ silent: true });
          }
          if (typeof state.refreshAssetQuery === "function") {
            await state.refreshAssetQuery({ silent: true });
          }
        } catch (err) {
          setStatus(acctStatus, false, err.message || String(err));
        }
      });

      acctBody.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("acct-edit-btn")) {
          try {
            const raw = decodeURIComponent(target.getAttribute("data-row") || "{}");
            const row = JSON.parse(raw);
            acctKind.value = row.account_kind || "other";
            acctName.value = row.account_name || "";
            setAccountEditMode(row);
            setStatus(acctStatus, true, `已载入账户编辑：${row.account_name || row.account_id}`);
          } catch {
            setStatus(acctStatus, false, "账户信息解析失败");
          }
          return;
        }

        if (target.classList.contains("acct-del-btn")) {
          const accountId = String(target.getAttribute("data-id") || "").trim();
          if (!accountId) return;
          if (!window.confirm(`确认删除账户：${accountId} ?（仅允许删除无引用账户）`)) return;
          try {
            const payload = await api("/api/accounts/delete", "POST", { account_id: accountId });
            setStatus(acctStatus, true, `账户已删除：${payload.account_name || accountId}`);
            if (state.editingAccountRecord && state.editingAccountRecord.account_id === accountId) {
              clearAccountEditMode();
            }
            await refreshInvestmentAccounts();
          } catch (err) {
            setStatus(acctStatus, false, err.message || String(err));
          }
        }
      });

      setAccountEditMode(null);
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initAccountManagement,
    });
