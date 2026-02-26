    const PRIVACY_MASK_STORAGE_KEY = "keepwise:privacy-mask-amounts";

    const state = {
      activeView: "suggestions",
      suggestionRows: [],
      merchantRows: [],
      keywordRows: [],
      bankTransferWhitelistRows: [],
      privacyMaskAmounts: false,
    };

    function escapeHtml(text) {
      return String(text || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function shouldMaskAmounts() {
      return !!state.privacyMaskAmounts;
    }

    function formatAmountRaw(value) {
      if (value === null || value === undefined) return "-";
      const text = String(value);
      return text === "" ? "-" : text;
    }

    function renderAmountValue(value) {
      const raw = formatAmountRaw(value);
      const safe = escapeHtml(raw);
      const shown = shouldMaskAmounts() && raw !== "-" ? "****" : safe;
      return `<span class="amount-sensitive" data-amount-raw="${safe}">${shown}</span>`;
    }

    function applyAmountMaskInDom(root = document) {
      const nodes = root.querySelectorAll(".amount-sensitive[data-amount-raw]");
      nodes.forEach(node => {
        const raw = node.getAttribute("data-amount-raw") || "";
        if (shouldMaskAmounts() && raw && raw !== "-") {
          node.textContent = "****";
        } else {
          node.textContent = raw;
        }
      });
      document.body.classList.toggle("privacy-masked", shouldMaskAmounts());
    }

    function initPrivacyToggle() {
      const toggle = document.getElementById("privacyToggle");
      if (!toggle) return;
      let enabled = false;
      try {
        enabled = window.localStorage.getItem(PRIVACY_MASK_STORAGE_KEY) === "1";
      } catch {}
      state.privacyMaskAmounts = enabled;
      toggle.checked = enabled;
      applyAmountMaskInDom(document);
      toggle.addEventListener("change", () => {
        state.privacyMaskAmounts = !!toggle.checked;
        try {
          window.localStorage.setItem(PRIVACY_MASK_STORAGE_KEY, state.privacyMaskAmounts ? "1" : "0");
        } catch {}
        applyAmountMaskInDom(document);
      });
    }

    function setStatus(ok, text) {
      const el = document.getElementById("globalStatus");
      el.classList.remove("hidden", "ok", "err");
      el.classList.add(ok ? "ok" : "err");
      el.textContent = text;
    }

    function showMetrics(items) {
      const holder = document.getElementById("globalMetrics");
      holder.classList.remove("hidden");
      holder.innerHTML = items.map(item => `
        <div class="metric">
          <div class="k">${escapeHtml(item.k)}</div>
          <div class="v">${escapeHtml(item.v)}</div>
        </div>
      `).join("");
    }

    async function api(path, method = "GET", body = null) {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : null,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }

    function setView(view) {
      state.activeView = view;
      const tabs = Array.from(document.querySelectorAll("#ruleTabs .pill-tab"));
      tabs.forEach(btn => btn.classList.toggle("active", btn.getAttribute("data-view") === view));
      document.getElementById("viewSuggestions").classList.toggle("hidden", view !== "suggestions");
      document.getElementById("viewMerchantMap").classList.toggle("hidden", view !== "merchant_map");
      document.getElementById("viewKeywordRules").classList.toggle("hidden", view !== "keyword_rules");
      document.getElementById("viewBankTransferWhitelist").classList.toggle("hidden", view !== "bank_transfer_whitelist");
      document.getElementById("merchantFormCard").classList.toggle("hidden", !["suggestions", "merchant_map"].includes(view));
      document.getElementById("keywordFormCard").classList.toggle("hidden", view !== "keyword_rules");
      document.getElementById("whitelistFormCard").classList.toggle("hidden", view !== "bank_transfer_whitelist");
    }

    window.keepwiseRulesAdmin = Object.assign(window.keepwiseRulesAdmin || {}, {
      state,
      escapeHtml,
      shouldMaskAmounts,
      formatAmountRaw,
      renderAmountValue,
      applyAmountMaskInDom,
      initPrivacyToggle,
      setStatus,
      showMetrics,
      api,
      setView,
    });
