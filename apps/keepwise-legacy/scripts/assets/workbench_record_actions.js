    function initRecordActions() {
      const invStatus = document.getElementById("invStatus");
      const invSaveBtn = document.getElementById("invSaveBtn");
      const invCancelEditBtn = document.getElementById("invCancelEditBtn");
      const invEditHint = document.getElementById("invEditHint");
      const invAccountIdEl = document.getElementById("invAccountId");
      const invSnapshotDateEl = document.getElementById("invSnapshotDate");
      const invTotalAssetsEl = document.getElementById("invTotalAssets");
      const invTransferAmountEl = document.getElementById("invTransferAmount");

      function setInvestmentEditMode(record) {
        state.editingInvestmentRecord = record || null;
        const editing = !!state.editingInvestmentRecord;
        invSaveBtn.textContent = editing ? "更新投资记录" : "保存投资记录";
        invCancelEditBtn.classList.toggle("hidden", !editing);
        invEditHint.classList.toggle("hidden", !editing);
      }

      function clearInvestmentEditMode() {
        setInvestmentEditMode(null);
      }

      function fillInvestmentFormFromRow(row) {
        invAccountIdEl.value = row.account_id || "";
        invSnapshotDateEl.value = row.snapshot_date || "";
        invTotalAssetsEl.value = money(row.total_assets_cents || 0);
        invTransferAmountEl.value = money(row.transfer_amount_cents || 0);
      }

      state.startEditInvestmentRecord = (row) => {
        if (!row || !row.id) return;
        fillInvestmentFormFromRow(row);
        setInvestmentEditMode(row);
        openTab("tab-records");
        setStatus(invStatus, true, `已载入投资记录编辑：${row.account_name || row.account_id} ${row.snapshot_date}`);
      };

      invCancelEditBtn.addEventListener("click", () => {
        clearInvestmentEditMode();
        setStatus(invStatus, true, "已退出投资记录编辑模式");
      });

      invSaveBtn.addEventListener("click", async () => {
        try {
          const accountId = invAccountIdEl.value.trim();
          if (!accountId) throw new Error("请先在账户管理中创建并选择投资账户");
          const basePayload = {
            account_id: accountId,
            snapshot_date: invSnapshotDateEl.value.trim(),
            total_assets: invTotalAssetsEl.value.trim(),
            transfer_amount: invTransferAmountEl.value.trim(),
          };
          let data;
          if (state.editingInvestmentRecord && state.editingInvestmentRecord.id) {
            data = await api("/api/investments/update", "POST", {
              id: state.editingInvestmentRecord.id,
              ...basePayload,
            });
            setStatus(invStatus, true, `投资记录已更新：${data.account_name} ${data.snapshot_date}`);
            clearInvestmentEditMode();
          } else {
            data = await api("/api/investments/manual", "POST", basePayload);
            setStatus(invStatus, true, `投资记录已保存：${data.account_name} ${data.snapshot_date}`);
          }
          await refreshInvestmentAccounts();
          if (typeof state.refreshInvestmentQuery === "function") {
            await state.refreshInvestmentQuery({ silent: true });
          }
        } catch (err) {
          setStatus(invStatus, false, err.message || String(err));
        }
      });

      const assetStatus = document.getElementById("assetStatus");
      const assetSaveBtn = document.getElementById("assetSaveBtn");
      const assetCancelEditBtn = document.getElementById("assetCancelEditBtn");
      const assetEditHint = document.getElementById("assetEditHint");
      const assetClassEl = document.getElementById("assetClass");
      const assetAccountIdEl = document.getElementById("assetAccountId");
      const assetSnapshotDateEl = document.getElementById("assetSnapshotDate");
      const assetValueEl = document.getElementById("assetValue");
      assetClassEl.addEventListener("change", () => {
        refreshAccountSelectorsFromCatalog();
      });

      function setAssetEditMode(record) {
        state.editingAssetRecord = record || null;
        const editing = !!state.editingAssetRecord;
        assetSaveBtn.textContent = editing ? "更新资产记录" : "保存资产记录";
        assetCancelEditBtn.classList.toggle("hidden", !editing);
        assetEditHint.classList.toggle("hidden", !editing);
      }

      function clearAssetEditMode() {
        setAssetEditMode(null);
      }

      function fillAssetFormFromRow(row) {
        assetClassEl.value = row.asset_class || "cash";
        refreshAccountSelectorsFromCatalog();
        assetAccountIdEl.value = row.account_id || "";
        assetSnapshotDateEl.value = row.snapshot_date || "";
        assetValueEl.value = money(row.value_cents || 0);
      }

      state.startEditAssetRecord = (row) => {
        if (!row || !row.id) return;
        fillAssetFormFromRow(row);
        setAssetEditMode(row);
        openTab("tab-records");
        setStatus(assetStatus, true, `已载入资产记录编辑：${row.account_name || row.account_id} ${row.snapshot_date}`);
      };

      assetCancelEditBtn.addEventListener("click", () => {
        clearAssetEditMode();
        setStatus(assetStatus, true, "已退出资产记录编辑模式");
      });

      assetSaveBtn.addEventListener("click", async () => {
        try {
          const accountId = assetAccountIdEl.value.trim();
          if (!accountId) throw new Error("请先在账户管理中创建并选择对应资产账户");
          const payload = {
            asset_class: assetClassEl.value,
            account_id: accountId,
            snapshot_date: assetSnapshotDateEl.value.trim(),
            value: assetValueEl.value.trim(),
          };
          let data;
          if (state.editingAssetRecord && state.editingAssetRecord.id) {
            data = await api("/api/assets/update", "POST", {
              id: state.editingAssetRecord.id,
              ...payload,
            });
            setStatus(assetStatus, true, `资产记录已更新：${data.account_name} ${data.snapshot_date}`);
            clearAssetEditMode();
          } else {
            data = await api("/api/assets/manual", "POST", payload);
            setStatus(assetStatus, true, `资产记录已保存：${data.account_name} ${data.snapshot_date}`);
          }
          if (typeof state.refreshWealthAnalytics === "function") {
            await state.refreshWealthAnalytics({ silent: true });
          }
          if (typeof state.refreshAssetQuery === "function") {
            await state.refreshAssetQuery({ silent: true });
          }
        } catch (err) {
          setStatus(assetStatus, false, err.message || String(err));
        }
      });
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      initRecordActions,
    });
