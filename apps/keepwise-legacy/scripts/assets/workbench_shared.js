    const PRIVACY_MASK_STORAGE_KEY = "keepwise:privacy-mask-amounts";
    const BUDGET_WITHDRAWAL_RATE_PCT_STORAGE_KEY = "keepwise:budget-withdrawal-rate-pct";

    const state = {
      emlPreviewToken: "",
      yzxyPreviewToken: "",
      cmbBankPdfPreviewToken: "",
      investmentAccounts: [],
      accountCatalogRows: [],
      refreshReturnAnalytics: null,
      refreshReturnBatchAnalytics: null,
      refreshWealthAnalytics: null,
      refreshBudgetAnalytics: null,
      refreshIncomeAnalytics: null,
      refreshTransactionQuery: null,
      refreshInvestmentQuery: null,
      refreshAssetQuery: null,
      renderAccountCatalog: null,
      privacyMaskAmounts: false,
      editingAccountRecord: null,
      editingInvestmentRecord: null,
      editingAssetRecord: null,
      editingBudgetItem: null,
    };

    const ACCOUNT_KIND_LABELS = {
      investment: "投资",
      cash: "现金",
      real_estate: "不动产",
      bank: "银行卡",
      credit_card: "信用卡",
      wallet: "钱包",
      liability: "负债",
      other: "其他",
    };

    function escapeHtml(text) {
      return String(text ?? "")
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

    function money(cents) {
      return (Number(cents || 0) / 100).toFixed(2);
    }

    function pct(value) {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
      return `${(Number(value) * 100).toFixed(2)}%`;
    }

    function formatYuanShortFromCents(cents) {
      const yuan = Number(cents || 0) / 100;
      const abs = Math.abs(yuan);
      if (abs >= 100000000) return `${(yuan / 100000000).toFixed(2)}亿`;
      if (abs >= 10000) return `${(yuan / 10000).toFixed(1)}万`;
      return yuan.toFixed(0);
    }

    function buildReturnReferenceLines(rows) {
      const candidates = [-30, -20, -10, -5, 0, 5, 10, 20, 30, 40, 50];
      const values = (rows || [])
        .map(row => Number(row.cumulative_return_pct))
        .filter(v => Number.isFinite(v));
      const minVal = values.length ? Math.min(...values) : -5;
      const maxVal = values.length ? Math.max(...values) : 5;
      return candidates
        .filter(v => v >= minVal - 2 && v <= maxVal + 2)
        .map(v => ({
          value: v,
          label: `${v}%`,
          color: v === 0 ? "#b45309" : "#d2d9c7",
        }));
    }

    function setStatus(el, ok, text) {
      el.classList.remove("hidden", "ok", "err");
      el.classList.add(ok ? "ok" : "err");
      el.textContent = text;
    }

    function hide(el) {
      el.classList.add("hidden");
    }

    function isAmountMetricKey(key) {
      return /(\(元\)|金额|总资产|总财富|净流入|净增长|收益额)/.test(String(key || ""));
    }

    function showMetrics(holder, items) {
      holder.classList.remove("hidden");
      holder.innerHTML = items.map(item => `
        <div class="metric">
          <div class="k">${escapeHtml(item.k)}</div>
          <div class="v">${
            (item.amount === true || (item.amount !== false && isAmountMetricKey(item.k)))
              ? renderAmountValue(item.v)
              : escapeHtml(item.v)
          }</div>
        </div>
      `).join("");
      applyAmountMaskInDom(holder);
    }

    async function applyPrivacyMode(enabled, options = {}) {
      const { refreshAnalytics = true } = options;
      state.privacyMaskAmounts = !!enabled;
      try {
        window.localStorage.setItem(PRIVACY_MASK_STORAGE_KEY, state.privacyMaskAmounts ? "1" : "0");
      } catch {}
      const toggle = document.getElementById("privacyToggle");
      if (toggle && toggle.checked !== state.privacyMaskAmounts) {
        toggle.checked = state.privacyMaskAmounts;
      }
      applyAmountMaskInDom(document);

      if (!refreshAnalytics) return;
      const tasks = [];
      if (typeof state.refreshReturnAnalytics === "function") {
        tasks.push(state.refreshReturnAnalytics({ silent: true }));
      }
      if (typeof state.refreshReturnBatchAnalytics === "function") {
        tasks.push(state.refreshReturnBatchAnalytics({ silent: true }));
      }
      if (typeof state.refreshWealthAnalytics === "function") {
        tasks.push(state.refreshWealthAnalytics({ silent: true }));
      }
      if (typeof state.refreshBudgetAnalytics === "function") {
        tasks.push(state.refreshBudgetAnalytics({ silent: true }));
      }
      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }
    }

    function initPrivacyToggle() {
      const toggle = document.getElementById("privacyToggle");
      if (!toggle) return;
      let enabled = false;
      try {
        enabled = window.localStorage.getItem(PRIVACY_MASK_STORAGE_KEY) === "1";
      } catch {}
      toggle.checked = enabled;
      applyPrivacyMode(enabled, { refreshAnalytics: false }).catch(() => {});
      toggle.addEventListener("change", () => {
        applyPrivacyMode(toggle.checked).catch(() => {});
      });
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

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const base64 = result.split(",")[1] || "";
          resolve({ name: file.name, content_base64: base64 });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function collectFiles(inputEl) {
      const files = Array.from(inputEl.files || []);
      const payload = [];
      for (const file of files) {
        payload.push(await readFileAsBase64(file));
      }
      return payload;
    }

    function openTab(targetTabId) {
      if (!targetTabId) return;
      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-tab") === targetTabId);
      });
      document.querySelectorAll("section.panel").forEach(panel => {
        panel.classList.toggle("hidden", panel.id !== targetTabId);
      });
    }

    function initTabs() {
      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          openTab(btn.getAttribute("data-tab"));
        });
      });
    }

    function setTodayIfEmpty(elId) {
      const el = document.getElementById(elId);
      if (el && !el.value) {
        el.value = new Date().toISOString().slice(0, 10);
      }
    }

    function syncCustomDateState(selectId, fromInputId) {
      const selectEl = document.getElementById(selectId);
      const fromEl = document.getElementById(fromInputId);
      if (!selectEl || !fromEl) return;
      const apply = () => {
        const isCustom = selectEl.value === "custom";
        fromEl.disabled = !isCustom;
        if (!isCustom) fromEl.value = "";
      };
      selectEl.addEventListener("change", apply);
      apply();
    }

    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      state,
      api,
      money,
      pct,
      escapeHtml,
      setStatus,
      hide,
      showMetrics,
      renderAmountValue,
      applyAmountMaskInDom,
      formatYuanShortFromCents,
      readFileAsBase64,
      collectFiles,
      openTab,
      initTabs,
      setTodayIfEmpty,
      syncCustomDateState,
      applyPrivacyMode,
      initPrivacyToggle,
    });
