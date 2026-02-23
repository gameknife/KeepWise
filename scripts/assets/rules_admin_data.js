    function rulesAdminNs() {
      return window.keepwiseRulesAdmin || {};
    }

    function raApi(...args) {
      return (rulesAdminNs().api || api)(...args);
    }

    function raRenderSuggestionRows(...args) {
      return (rulesAdminNs().renderSuggestionRows || renderSuggestionRows)(...args);
    }

    function raRenderMerchantRows(...args) {
      return (rulesAdminNs().renderMerchantRows || renderMerchantRows)(...args);
    }

    function raRenderKeywordRows(...args) {
      return (rulesAdminNs().renderKeywordRows || renderKeywordRows)(...args);
    }

    function raRenderBankTransferWhitelistRows(...args) {
      return (rulesAdminNs().renderBankTransferWhitelistRows || renderBankTransferWhitelistRows)(...args);
    }

    function raShowMetrics(...args) {
      return (rulesAdminNs().showMetrics || showMetrics)(...args);
    }

    function raSetStatus(...args) {
      return (rulesAdminNs().setStatus || setStatus)(...args);
    }

    async function loadSuggestions(options = {}) {
      const { silent = false } = options;
      const params = new URLSearchParams({
        keyword: document.getElementById("sugKeyword").value.trim(),
        limit: document.getElementById("sugLimit").value.trim() || "200",
        only_unmapped: document.getElementById("sugOnlyUnmapped").checked ? "true" : "false",
      });
      const data = await raApi(`/api/rules/merchant-suggestions?${params.toString()}`);
      state.suggestionRows = data.rows || [];
      raRenderSuggestionRows(state.suggestionRows);
      raShowMetrics([
        { k: "商户建议", v: data.summary.count },
        { k: "仅未映射", v: data.summary.only_unmapped ? "是" : "否" },
        { k: "关键字", v: data.summary.keyword || "-" },
        { k: "数据文件", v: "merchant_map.csv" },
      ]);
      if (!silent) raSetStatus(true, `商户建议已更新：${data.summary.count} 条`);
    }

    async function loadMerchantMap(options = {}) {
      const { silent = false } = options;
      const params = new URLSearchParams({
        keyword: document.getElementById("mapKeyword").value.trim(),
        limit: document.getElementById("mapLimit").value.trim() || "200",
      });
      const data = await raApi(`/api/rules/merchant-map?${params.toString()}`);
      state.merchantRows = data.rows || [];
      raRenderMerchantRows(state.merchantRows);
      raShowMetrics([
        { k: "商户规则", v: data.summary.count },
        { k: "关键字", v: data.summary.keyword || "-" },
        { k: "返回上限", v: data.summary.limit },
        { k: "数据文件", v: "merchant_map.csv" },
      ]);
      if (!silent) raSetStatus(true, `商户规则已更新：${data.summary.count} 条`);
    }

    async function loadKeywordRules(options = {}) {
      const { silent = false } = options;
      const params = new URLSearchParams({
        keyword: document.getElementById("kwKeyword").value.trim(),
        limit: document.getElementById("kwLimit").value.trim() || "200",
      });
      const data = await raApi(`/api/rules/category-rules?${params.toString()}`);
      state.keywordRows = data.rows || [];
      raRenderKeywordRows(state.keywordRows);
      raShowMetrics([
        { k: "关键词规则", v: data.summary.count },
        { k: "关键字", v: data.summary.keyword || "-" },
        { k: "返回上限", v: data.summary.limit },
        { k: "数据文件", v: "category_rules.csv" },
      ]);
      if (!silent) raSetStatus(true, `关键词规则已更新：${data.summary.count} 条`);
    }

    async function loadBankTransferWhitelist(options = {}) {
      const { silent = false } = options;
      const params = new URLSearchParams({
        keyword: document.getElementById("bwKeyword").value.trim(),
        limit: document.getElementById("bwLimit").value.trim() || "200",
        active_only: document.getElementById("bwActiveOnly").checked ? "true" : "false",
      });
      const data = await raApi(`/api/rules/bank-transfer-whitelist?${params.toString()}`);
      state.bankTransferWhitelistRows = data.rows || [];
      raRenderBankTransferWhitelistRows(state.bankTransferWhitelistRows);
      raShowMetrics([
        { k: "转账白名单", v: data.summary.count },
        { k: "启用项", v: data.summary.active_count },
        { k: "关键字", v: data.summary.keyword || "-" },
        { k: "数据文件", v: "bank_transfer_whitelist.csv" },
      ]);
      if (!silent) raSetStatus(true, `转账白名单已更新：${data.summary.count} 条`);
    }

    async function saveMerchantRule() {
      const payload = {
        merchant_normalized: document.getElementById("mMerchant").value.trim(),
        expense_category: document.getElementById("mCategory").value.trim(),
        confidence: document.getElementById("mConfidence").value.trim(),
        note: document.getElementById("mNote").value.trim(),
      };
      const data = await raApi("/api/rules/merchant-map/upsert", "POST", payload);
      await Promise.all([
        loadMerchantMap({ silent: true }),
        loadSuggestions({ silent: true }),
      ]);
      raSetStatus(true, `${data.updated ? "已更新" : "已新增"}商户规则：${data.row.merchant_normalized}`);
    }

    async function saveKeywordRule() {
      const payload = {
        priority: document.getElementById("kPriority").value.trim(),
        match_type: document.getElementById("kMatchType").value,
        pattern: document.getElementById("kPattern").value.trim(),
        expense_category: document.getElementById("kCategory").value.trim(),
        confidence: document.getElementById("kConfidence").value.trim(),
        note: document.getElementById("kNote").value.trim(),
      };
      const data = await raApi("/api/rules/category-rules/upsert", "POST", payload);
      await loadKeywordRules({ silent: true });
      raSetStatus(true, `${data.updated ? "已更新" : "已新增"}关键词规则：${data.row.pattern}`);
    }

    async function saveBankTransferWhitelistRule() {
      const payload = {
        name: document.getElementById("bwName").value.trim(),
        is_active: document.getElementById("bwIsActive").checked,
        note: document.getElementById("bwNote").value.trim(),
      };
      const data = await raApi("/api/rules/bank-transfer-whitelist/upsert", "POST", payload);
      await loadBankTransferWhitelist({ silent: true });
      raSetStatus(true, `${data.updated ? "已更新" : "已新增"}转账白名单：${data.row.name}`);
    }

    function resetMerchantForm() {
      document.getElementById("mMerchant").value = "";
      document.getElementById("mCategory").value = "";
      document.getElementById("mConfidence").value = "0.95";
      document.getElementById("mNote").value = "";
    }

    function resetKeywordForm() {
      document.getElementById("kPriority").value = "500";
      document.getElementById("kMatchType").value = "contains";
      document.getElementById("kPattern").value = "";
      document.getElementById("kCategory").value = "";
      document.getElementById("kConfidence").value = "0.70";
      document.getElementById("kNote").value = "";
    }

    function resetBankTransferWhitelistForm() {
      document.getElementById("bwName").value = "";
      document.getElementById("bwIsActive").checked = true;
      document.getElementById("bwNote").value = "";
    }

    window.keepwiseRulesAdmin = Object.assign(window.keepwiseRulesAdmin || {}, {
      loadSuggestions,
      loadMerchantMap,
      loadKeywordRules,
      loadBankTransferWhitelist,
      saveMerchantRule,
      saveKeywordRule,
      saveBankTransferWhitelistRule,
      resetMerchantForm,
      resetKeywordForm,
      resetBankTransferWhitelistForm,
    });
