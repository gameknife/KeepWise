    function toggleSetValue(setObj, value) {
      if (!value) return;
      if (setObj.has(value)) setObj.delete(value);
      else setObj.add(value);
    }

    function getFilteredRows(ignoreMerchant = false) {
      const keyword = state.keyword.trim().toLowerCase();
      return REPORT_DATA.transactions.filter((row) => {
        if (state.year && !String(row.month || "").startsWith(`${state.year}-`)) return false;
        if (state.month !== "ALL" && row.month !== state.month) return false;
        if (state.selectedCategories.size > 0 && !state.selectedCategories.has(row.category)) return false;
        if (!ignoreMerchant && state.selectedMerchants.size > 0 && !state.selectedMerchants.has(row.merchant)) return false;
        if (!state.includePending && row.needs_review) return false;
        if (!keyword) return true;
        const haystack = `${row.merchant} ${row.description}`.toLowerCase();
        return haystack.includes(keyword);
      });
    }

    function aggregateByCategory(rows) {
      const m = new Map();
      for (const row of rows) {
        if (!m.has(row.category)) m.set(row.category, { category: row.category, amount: 0, count: 0, review: 0 });
        const item = m.get(row.category);
        item.amount += row.amount;
        item.count += 1;
        item.review += row.needs_review ? 1 : 0;
      }
      return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
    }

    function aggregateByMonth(rows) {
      const base = new Map(
        REPORT_DATA.months
          .filter((m) => !state.year || String(m.month || "").startsWith(`${state.year}-`))
          .map((m) => [m.month, { month: m.month, amount: 0, count: 0 }])
      );
      for (const row of rows) {
        if (!base.has(row.month)) base.set(row.month, { month: row.month, amount: 0, count: 0 });
        const item = base.get(row.month);
        item.amount += row.amount;
        item.count += 1;
      }
      return Array.from(base.values()).sort((a, b) => a.month.localeCompare(b.month));
    }

    function aggregateByMerchant(rows) {
      const m = new Map();
      for (const row of rows) {
        if (!m.has(row.merchant)) m.set(row.merchant, { merchant: row.merchant, amount: 0, count: 0, category: row.category });
        const item = m.get(row.merchant);
        item.amount += row.amount;
        item.count += 1;
      }
      return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
    }

    function getSortValue(row, field) {
      if (field === "amount") return row.amount || 0;
      if (field === "confidence") return row.confidence || 0;
      if (field === "date") return row.date || "";
      if (field === "category") return row.category || "";
      if (field === "merchant") return row.merchant || "";
      if (field === "description") return row.description || "";
      if (field === "source_path") return row.source_path || "";
      return row.date || "";
    }

    function sortRows(rows) {
      const dir = state.sortDir === "asc" ? 1 : -1;
      const field = state.sortField;
      const sorted = [...rows].sort((a, b) => {
        const av = getSortValue(a, field);
        const bv = getSortValue(b, field);
        if (typeof av === "number" && typeof bv === "number") {
          if (av !== bv) return (av - bv) * dir;
        } else {
          const cmp = String(av).localeCompare(String(bv), "zh-CN", { numeric: true, sensitivity: "base" });
          if (cmp !== 0) return cmp * dir;
        }
        const dateCmp = String(b.date || "").localeCompare(String(a.date || ""));
        if (dateCmp !== 0) return dateCmp;
        return (b.amount || 0) - (a.amount || 0);
      });
      return sorted;
    }

    function updateSortHeaders() {
      document.querySelectorAll(".th-sort").forEach((btn) => {
        const field = btn.getAttribute("data-sort");
        const arrow = btn.querySelector(".arrow");
        const active = field === state.sortField;
        btn.classList.toggle("active", active);
        if (!arrow) return;
        arrow.textContent = active ? (state.sortDir === "asc" ? "▲" : "▼") : "↕";
      });
    }

    window.keepwiseConsumption = Object.assign(window.keepwiseConsumption || {}, {
      toggleSetValue,
      getFilteredRows,
      aggregateByCategory,
      aggregateByMonth,
      aggregateByMerchant,
      getSortValue,
      sortRows,
      updateSortHeaders,
    });
