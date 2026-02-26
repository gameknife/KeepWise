    function rulesAdminNs() {
      return window.keepwiseRulesAdmin || {};
    }

    function raSetView(...args) {
      return (rulesAdminNs().setView || setView)(...args);
    }

    function raEscapeHtml(...args) {
      return (rulesAdminNs().escapeHtml || escapeHtml)(...args);
    }

    function raRenderAmountValue(...args) {
      return (rulesAdminNs().renderAmountValue || renderAmountValue)(...args);
    }

    function raApplyAmountMaskInDom(...args) {
      return (rulesAdminNs().applyAmountMaskInDom || applyAmountMaskInDom)(...args);
    }

    function fillMerchantForm(merchant, category = "") {
      document.getElementById("mMerchant").value = merchant || "";
      if (category) document.getElementById("mCategory").value = category;
      raSetView("merchant_map");
    }

    function fillKeywordForm(row) {
      document.getElementById("kPriority").value = row.priority || "500";
      document.getElementById("kMatchType").value = row.match_type || "contains";
      document.getElementById("kPattern").value = row.pattern || "";
      document.getElementById("kCategory").value = row.expense_category || "";
      document.getElementById("kConfidence").value = row.confidence || "0.70";
      document.getElementById("kNote").value = row.note || "";
      raSetView("keyword_rules");
    }

    function fillBankTransferWhitelistForm(row = {}) {
      document.getElementById("bwName").value = row.name || "";
      document.getElementById("bwIsActive").checked = Number(row.is_active ?? 1) === 1;
      document.getElementById("bwNote").value = row.note || "";
      raSetView("bank_transfer_whitelist");
    }

    function renderSuggestionRows(rows) {
      const tbody = document.getElementById("sugBody");
      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">暂无建议</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(row => {
        const merchant = String(row.merchant_normalized || "");
        const preferred = String(row.mapped_expense_category || row.suggested_expense_category || "");
        return `
          <tr>
            <td>${raEscapeHtml(merchant)}</td>
            <td>${row.txn_count || 0}</td>
            <td>${raRenderAmountValue(row.total_amount_yuan || "0.00")}</td>
            <td>${row.review_count || 0}</td>
            <td>${raEscapeHtml(row.suggested_expense_category || "-")}</td>
            <td>${raEscapeHtml(row.mapped_expense_category || "-")}</td>
            <td class="actions-cell">
              <button class="btn secondary small fill-merchant-btn" data-merchant="${encodeURIComponent(merchant)}" data-category="${encodeURIComponent(preferred)}">填入表单</button>
              <button class="btn primary small quick-save-btn" data-merchant="${encodeURIComponent(merchant)}" data-category="${encodeURIComponent(preferred)}">一键保存</button>
            </td>
          </tr>
        `;
      }).join("");
      raApplyAmountMaskInDom(tbody);
    }

    function renderMerchantRows(rows) {
      const tbody = document.getElementById("mapBody");
      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5">暂无商户规则</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(row => `
        <tr>
          <td>${raEscapeHtml(row.merchant_normalized)}</td>
          <td>${raEscapeHtml(row.expense_category)}</td>
          <td>${raEscapeHtml(row.confidence)}</td>
          <td>${raEscapeHtml(row.note || "")}</td>
          <td class="actions-cell">
            <button class="btn secondary small edit-map-btn" data-merchant="${encodeURIComponent(row.merchant_normalized || "")}" data-category="${encodeURIComponent(row.expense_category || "")}" data-confidence="${raEscapeHtml(row.confidence || "")}" data-note="${encodeURIComponent(row.note || "")}">编辑</button>
            <button class="btn danger small del-map-btn" data-merchant="${encodeURIComponent(row.merchant_normalized || "")}">删除</button>
          </td>
        </tr>
      `).join("");
    }

    function renderKeywordRows(rows) {
      const tbody = document.getElementById("kwBody");
      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">暂无关键词规则</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(row => `
        <tr>
          <td>${raEscapeHtml(row.priority)}</td>
          <td>${raEscapeHtml(row.match_type)}</td>
          <td>${raEscapeHtml(row.pattern)}</td>
          <td>${raEscapeHtml(row.expense_category)}</td>
          <td>${raEscapeHtml(row.confidence)}</td>
          <td>${raEscapeHtml(row.note || "")}</td>
          <td class="actions-cell">
            <button class="btn secondary small edit-kw-btn" data-row="${encodeURIComponent(JSON.stringify(row))}">编辑</button>
            <button class="btn danger small del-kw-btn" data-match-type="${raEscapeHtml(row.match_type || "")}" data-pattern="${encodeURIComponent(row.pattern || "")}">删除</button>
          </td>
        </tr>
      `).join("");
    }

    function renderBankTransferWhitelistRows(rows) {
      const tbody = document.getElementById("bwBody");
      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4">暂无白名单规则</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(row => `
        <tr>
          <td>${raEscapeHtml(row.name || "")}</td>
          <td>${Number(row.is_active || 0) === 1 ? "是" : "否"}</td>
          <td>${raEscapeHtml(row.note || "")}</td>
          <td class="actions-cell">
            <button class="btn secondary small edit-bw-btn" data-row="${encodeURIComponent(JSON.stringify(row))}">编辑</button>
            <button class="btn danger small del-bw-btn" data-name="${encodeURIComponent(row.name || "")}">删除</button>
          </td>
        </tr>
      `).join("");
    }

    window.keepwiseRulesAdmin = Object.assign(window.keepwiseRulesAdmin || {}, {
      fillMerchantForm,
      fillKeywordForm,
      fillBankTransferWhitelistForm,
      renderSuggestionRows,
      renderMerchantRows,
      renderKeywordRows,
      renderBankTransferWhitelistRows,
    });
