    function rulesAdminApp() {
      return window.keepwiseRulesAdmin || {};
    }

    function bindEvents() {
      Array.from(document.querySelectorAll("#ruleTabs .pill-tab")).forEach(btn => {
        btn.addEventListener("click", () => {
          (rulesAdminApp().setView || setView)(btn.getAttribute("data-view") || "suggestions");
        });
      });

      document.getElementById("refreshAllBtn").addEventListener("click", async () => {
        try {
          await Promise.all([
            (rulesAdminApp().loadSuggestions || loadSuggestions)({ silent: true }),
            (rulesAdminApp().loadMerchantMap || loadMerchantMap)({ silent: true }),
            (rulesAdminApp().loadKeywordRules || loadKeywordRules)({ silent: true }),
            (rulesAdminApp().loadBankTransferWhitelist || loadBankTransferWhitelist)({ silent: true }),
          ]);
          (rulesAdminApp().setStatus || setStatus)(true, "规则数据已全部刷新");
        } catch (err) {
          (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err));
        }
      });

      document.getElementById("sugLoadBtn").addEventListener("click", () => (
        (rulesAdminApp().loadSuggestions || loadSuggestions)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("mapLoadBtn").addEventListener("click", () => (
        (rulesAdminApp().loadMerchantMap || loadMerchantMap)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("kwLoadBtn").addEventListener("click", () => (
        (rulesAdminApp().loadKeywordRules || loadKeywordRules)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("bwLoadBtn").addEventListener("click", () => (
        (rulesAdminApp().loadBankTransferWhitelist || loadBankTransferWhitelist)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("mSaveBtn").addEventListener("click", () => (
        (rulesAdminApp().saveMerchantRule || saveMerchantRule)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("kSaveBtn").addEventListener("click", () => (
        (rulesAdminApp().saveKeywordRule || saveKeywordRule)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("bwSaveBtn").addEventListener("click", () => (
        (rulesAdminApp().saveBankTransferWhitelistRule || saveBankTransferWhitelistRule)()
          .catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)))
      ));
      document.getElementById("mResetBtn").addEventListener("click", rulesAdminApp().resetMerchantForm || resetMerchantForm);
      document.getElementById("kResetBtn").addEventListener("click", rulesAdminApp().resetKeywordForm || resetKeywordForm);
      document.getElementById("bwResetBtn").addEventListener(
        "click",
        rulesAdminApp().resetBankTransferWhitelistForm || resetBankTransferWhitelistForm
      );

      document.getElementById("sugBody").addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("fill-merchant-btn")) {
          const merchant = decodeURIComponent(target.getAttribute("data-merchant") || "");
          const category = decodeURIComponent(target.getAttribute("data-category") || "");
          (rulesAdminApp().fillMerchantForm || fillMerchantForm)(merchant, category);
          return;
        }

        if (target.classList.contains("quick-save-btn")) {
          const merchant = decodeURIComponent(target.getAttribute("data-merchant") || "");
          const category = decodeURIComponent(target.getAttribute("data-category") || "");
          if (!category) {
            (rulesAdminApp().fillMerchantForm || fillMerchantForm)(merchant, "");
            (rulesAdminApp().setStatus || setStatus)(false, `商户 ${merchant} 没有推荐分类，请手动填写后保存`);
            return;
          }
          document.getElementById("mMerchant").value = merchant;
          document.getElementById("mCategory").value = category;
          try {
            await (rulesAdminApp().saveMerchantRule || saveMerchantRule)();
          } catch (err) {
            (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err));
          }
        }
      });

      document.getElementById("mapBody").addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("edit-map-btn")) {
          const merchant = decodeURIComponent(target.getAttribute("data-merchant") || "");
          const category = decodeURIComponent(target.getAttribute("data-category") || "");
          const note = decodeURIComponent(target.getAttribute("data-note") || "");
          document.getElementById("mMerchant").value = merchant;
          document.getElementById("mCategory").value = category;
          document.getElementById("mConfidence").value = target.getAttribute("data-confidence") || "0.95";
          document.getElementById("mNote").value = note;
          return;
        }

        if (target.classList.contains("del-map-btn")) {
          const merchant = decodeURIComponent(target.getAttribute("data-merchant") || "");
          if (!merchant) return;
          if (!window.confirm(`确认删除商户规则：${merchant} ?`)) return;
          try {
            await (rulesAdminApp().api || api)("/api/rules/merchant-map/delete", "POST", { merchant_normalized: merchant });
            await Promise.all([
              (rulesAdminApp().loadMerchantMap || loadMerchantMap)({ silent: true }),
              (rulesAdminApp().loadSuggestions || loadSuggestions)({ silent: true }),
            ]);
            (rulesAdminApp().setStatus || setStatus)(true, `已删除商户规则：${merchant}`);
          } catch (err) {
            (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err));
          }
        }
      });

      document.getElementById("kwBody").addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("edit-kw-btn")) {
          const raw = decodeURIComponent(target.getAttribute("data-row") || "{}");
          try {
            (rulesAdminApp().fillKeywordForm || fillKeywordForm)(JSON.parse(raw));
          } catch {
            (rulesAdminApp().setStatus || setStatus)(false, "规则数据解析失败");
          }
          return;
        }

        if (target.classList.contains("del-kw-btn")) {
          const matchType = target.getAttribute("data-match-type") || "";
          const pattern = decodeURIComponent(target.getAttribute("data-pattern") || "");
          if (!pattern) return;
          if (!window.confirm(`确认删除关键词规则：${matchType}:${pattern} ?`)) return;
          try {
            await (rulesAdminApp().api || api)("/api/rules/category-rules/delete", "POST", {
              match_type: matchType,
              pattern,
            });
            await (rulesAdminApp().loadKeywordRules || loadKeywordRules)({ silent: true });
            (rulesAdminApp().setStatus || setStatus)(true, `已删除关键词规则：${pattern}`);
          } catch (err) {
            (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err));
          }
        }
      });

      document.getElementById("bwBody").addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("edit-bw-btn")) {
          const raw = decodeURIComponent(target.getAttribute("data-row") || "{}");
          try {
            (rulesAdminApp().fillBankTransferWhitelistForm || fillBankTransferWhitelistForm)(JSON.parse(raw));
          } catch {
            (rulesAdminApp().setStatus || setStatus)(false, "白名单数据解析失败");
          }
          return;
        }

        if (target.classList.contains("del-bw-btn")) {
          const name = decodeURIComponent(target.getAttribute("data-name") || "");
          if (!name) return;
          if (!window.confirm(`确认删除转账白名单：${name} ?`)) return;
          try {
            await (rulesAdminApp().api || api)("/api/rules/bank-transfer-whitelist/delete", "POST", { name });
            await (rulesAdminApp().loadBankTransferWhitelist || loadBankTransferWhitelist)({ silent: true });
            (rulesAdminApp().setStatus || setStatus)(true, `已删除转账白名单：${name}`);
          } catch (err) {
            (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err));
          }
        }
      });
    }

    async function init() {
      (rulesAdminApp().initPrivacyToggle || initPrivacyToggle)();
      bindEvents();
      (rulesAdminApp().setView || setView)("suggestions");
      await Promise.all([
        (rulesAdminApp().loadSuggestions || loadSuggestions)({ silent: true }),
        (rulesAdminApp().loadMerchantMap || loadMerchantMap)({ silent: true }),
        (rulesAdminApp().loadKeywordRules || loadKeywordRules)({ silent: true }),
        (rulesAdminApp().loadBankTransferWhitelist || loadBankTransferWhitelist)({ silent: true }),
      ]);
      (rulesAdminApp().setStatus || setStatus)(true, "规则数据已加载");
    }

    window.keepwiseRulesAdmin = Object.assign(window.keepwiseRulesAdmin || {}, {
      bindEvents,
      init,
    });

    init().catch(err => (rulesAdminApp().setStatus || setStatus)(false, err.message || String(err)));
