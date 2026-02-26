    function accountKindLabel(kind) {
      return ACCOUNT_KIND_LABELS[kind] || kind || "-";
    }

    function accountTypeLabel(type) {
      if (type === "other") return "other(含不动产)";
      return type || "-";
    }

    function getAccountCatalogRowsByKinds(kinds) {
      const set = new Set(Array.isArray(kinds) ? kinds : [kinds]);
      return (state.accountCatalogRows || []).filter(row => set.has(String(row.account_kind || "")));
    }

    function accountOptionText(row, options = {}) {
      const { includeId = true, includeKind = false } = options;
      const name = String(row.account_name || row.account_id || "");
      const parts = [name];
      if (includeKind) parts.push(accountKindLabel(row.account_kind));
      if (includeId) parts.push(String(row.account_id || ""));
      return parts.filter(Boolean).join(" | ");
    }

    function buildAccountOptionsMarkup(rows, options = {}) {
      const {
        selectedValue = "",
        blankLabel = null,
        includeId = true,
        includeKind = false,
      } = options;
      const list = Array.isArray(rows) ? rows : [];
      const html = [];
      if (blankLabel !== null) {
        html.push(`<option value="">${escapeHtml(blankLabel)}</option>`);
      }
      list.forEach(row => {
        const id = String(row.account_id || "");
        const selected = id === String(selectedValue || "") ? " selected" : "";
        html.push(
          `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(accountOptionText(row, { includeId, includeKind }))}</option>`
        );
      });
      if (selectedValue && !list.some(row => String(row.account_id || "") === String(selectedValue))) {
        html.push(`<option value="${escapeHtml(String(selectedValue))}" selected>${escapeHtml(String(selectedValue))}</option>`);
      }
      return html.join("");
    }

    function setSelectAccountOptions(selectEl, rows, options = {}) {
      if (!selectEl) return;
      const {
        blankLabel = "",
        includeId = true,
        includeKind = false,
        emptyLabel = "暂无可选账户",
      } = options;
      const prev = selectEl.value;
      const list = Array.isArray(rows) ? rows : [];
      const html = [];
      if (blankLabel !== null) {
        html.push(`<option value="">${escapeHtml(blankLabel)}</option>`);
      }
      list.forEach(row => {
        const id = String(row.account_id || "");
        html.push(`<option value="${escapeHtml(id)}">${escapeHtml(accountOptionText(row, { includeId, includeKind }))}</option>`);
      });
      if (html.length === 0) {
        html.push(`<option value="">${escapeHtml(emptyLabel)}</option>`);
      }
      selectEl.innerHTML = html.join("");
      const exists = prev && Array.from(selectEl.options).some(opt => opt.value === prev);
      if (exists) {
        selectEl.value = prev;
      } else if (prev && blankLabel === null) {
        selectEl.innerHTML += `<option value="${escapeHtml(prev)}" selected>${escapeHtml(prev)}</option>`;
      }
    }

    function refreshAccountSelectorsFromCatalog() {
      const allRows = state.accountCatalogRows || [];
      const investmentRows = getAccountCatalogRowsByKinds("investment");
      const cashRows = getAccountCatalogRowsByKinds("cash");
      const realEstateRows = getAccountCatalogRowsByKinds("real_estate");
      const liabilityRows = getAccountCatalogRowsByKinds("liability");

      setSelectAccountOptions(document.getElementById("invAccountId"), investmentRows, {
        blankLabel: "请选择投资账户",
        includeKind: false,
      });
      setSelectAccountOptions(document.getElementById("qInvAccountId"), investmentRows, {
        blankLabel: "全部投资账户",
        includeKind: false,
      });
      setSelectAccountOptions(document.getElementById("qTxAccountId"), allRows, {
        blankLabel: "全部账户",
        includeKind: true,
      });

      const assetClassEl = document.getElementById("assetClass");
      const assetClass = assetClassEl ? assetClassEl.value : "cash";
      const assetRows = assetClass === "real_estate"
        ? realEstateRows
        : (assetClass === "liability" ? liabilityRows : cashRows);
      const assetAccountLabel = assetClass === "real_estate"
        ? "请选择不动产账户"
        : (assetClass === "liability" ? "请选择负债账户" : "请选择现金账户");
      setSelectAccountOptions(document.getElementById("assetAccountId"), assetRows, {
        blankLabel: assetAccountLabel,
        includeKind: false,
      });

      const qAssetClassEl = document.getElementById("qAssetClass");
      const qAssetClass = qAssetClassEl ? qAssetClassEl.value : "";
      const qAssetRows = qAssetClass === "cash"
        ? cashRows
        : (
          qAssetClass === "real_estate"
            ? realEstateRows
            : (qAssetClass === "liability" ? liabilityRows : [...cashRows, ...realEstateRows, ...liabilityRows])
        );
      const qAssetLabel = qAssetClass
        ? `全部${qAssetClass === "cash" ? "现金" : (qAssetClass === "real_estate" ? "不动产" : "负债")}账户`
        : "全部资产/负债账户";
      setSelectAccountOptions(document.getElementById("qAssetAccountId"), qAssetRows, {
        blankLabel: qAssetLabel,
        includeKind: qAssetClass === "",
      });
    }

    async function refreshAccountCatalog() {
      const data = await api("/api/accounts/catalog?kind=all&limit=1000");
      state.accountCatalogRows = Array.isArray(data.rows) ? data.rows : [];
      refreshAccountSelectorsFromCatalog();
      if (typeof state.renderAccountCatalog === "function") {
        state.renderAccountCatalog();
      }
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      accountKindLabel,
      accountTypeLabel,
      getAccountCatalogRowsByKinds,
      accountOptionText,
      buildAccountOptionsMarkup,
      setSelectAccountOptions,
      refreshAccountSelectorsFromCatalog,
      refreshAccountCatalog,
    });
