    function consumptionNs() {
      return window.keepwiseConsumption || {};
    }

    function cnsText(...args) {
      return (consumptionNs().text || text)(...args);
    }

    function cnsFmtMoney(...args) {
      return (consumptionNs().fmtMoney || fmtMoney)(...args);
    }

    function cnsFmtMoneyCompact(...args) {
      return (consumptionNs().fmtMoneyCompact || fmtMoneyCompact)(...args);
    }

    function cnsFmtPercent(...args) {
      return (consumptionNs().fmtPercent || fmtPercent)(...args);
    }

    function cnsGetFilteredRows(...args) {
      return (consumptionNs().getFilteredRows || getFilteredRows)(...args);
    }

    function cnsAggregateByCategory(...args) {
      return (consumptionNs().aggregateByCategory || aggregateByCategory)(...args);
    }

    function cnsAggregateByMonth(...args) {
      return (consumptionNs().aggregateByMonth || aggregateByMonth)(...args);
    }

    function cnsAggregateByMerchant(...args) {
      return (consumptionNs().aggregateByMerchant || aggregateByMerchant)(...args);
    }

    function cnsToggleSetValue(...args) {
      return (consumptionNs().toggleSetValue || toggleSetValue)(...args);
    }

    function cnsSortRows(...args) {
      return (consumptionNs().sortRows || sortRows)(...args);
    }

    function cnsUpdateSortHeaders(...args) {
      return (consumptionNs().updateSortHeaders || updateSortHeaders)(...args);
    }

    function renderMetrics(rows) {
      const total = rows.reduce((s, x) => s + x.amount, 0);
      const count = rows.length;
      const avg = count ? total / count : 0;
      const review = rows.filter((x) => x.needs_review).length;
      const fileCount = new Set(rows.map((x) => String(x.source_path || ""))).size;

      cnsText("metricTotal", cnsFmtMoney(total));
      cnsText("metricTotalSub", `${count.toLocaleString()} 笔交易`);
      cnsText("metricAvg", cnsFmtMoney(avg));
      cnsText("metricReview", review.toLocaleString());
      cnsText("metricReviewSub", count ? cnsFmtPercent(review / count) : "0.00%");
      cnsText("metricFiles", fileCount.toLocaleString());
      cnsText("metricFilesSub", `解析失败 ${REPORT_DATA.failed_files_count}（全库导入任务）`);
    }

    function renderTrendChart(rows) {
      const svg = document.getElementById("trendChart");
      const data = cnsAggregateByMonth(rows);
      const points = data.filter((x) => x.count > 0);
      if (!points.length) {
        svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#6f7773" font-size="14">当前筛选无趋势数据</text>`;
        return;
      }
      const w = 820, h = 260, px = 38, py = 34;
      const max = Math.max(...points.map((p) => p.amount), 1);
      const spanX = w - px * 2;
      const spanY = h - py * 2;
      const x = (i) => px + (points.length === 1 ? spanX / 2 : (i * spanX) / (points.length - 1));
      const y = (v) => py + spanY - (v / max) * spanY;

      const grid = [0, 0.25, 0.5, 0.75, 1].map((r) => {
        const gy = y(max * r);
        return `<line x1="${px}" y1="${gy}" x2="${w - px}" y2="${gy}" stroke="#e8eeea" stroke-width="1"/>`;
      }).join("");

      const polyline = points.map((p, i) => `${x(i)},${y(p.amount)}`).join(" ");
      const area = `${px},${h - py} ${polyline} ${x(points.length - 1)},${h - py}`;
      const dots = points.map((p, i) => {
        const cx = x(i), cy = y(p.amount);
        return `<g><circle cx="${cx}" cy="${cy}" r="3.6" fill="#2f8f63"/><title>${p.month} ${cnsFmtMoney(p.amount)}</title></g>`;
      }).join("");
      const valueLabels = points.map((p, i) => {
        const lx = x(i);
        const ly = Math.max(py - 6, y(p.amount) - (i % 2 === 0 ? 10 : 22));
        return `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#2f5f49" font-size="10" font-weight="700" style="paint-order:stroke;stroke:#f8fbf9;stroke-width:3;stroke-linejoin:round">${cnsFmtMoneyCompact(p.amount)}</text>`;
      }).join("");
      const labels = points.map((p, i) => {
        const lx = x(i);
        const show = points.length <= 8 || i % Math.ceil(points.length / 6) === 0 || i === points.length - 1;
        if (!show) return "";
        return `<text x="${lx}" y="${h - 6}" text-anchor="middle" fill="#6b746f" font-size="11">${p.month.slice(5)}</text>`;
      }).join("");

      svg.innerHTML = `
        ${grid}
        <polygon points="${area}" fill="rgba(47,143,99,0.14)"></polygon>
        <polyline points="${polyline}" fill="none" stroke="#2f8f63" stroke-width="2.2" stroke-linecap="round"></polyline>
        ${valueLabels}
        ${dots}
        ${labels}
      `;
    }

    function renderDonut(rows) {
      const donut = document.getElementById("donut");
      const legend = document.getElementById("donutLegend");
      const data = cnsAggregateByCategory(rows).slice(0, 10);
      const total = data.reduce((s, x) => s + x.amount, 0);
      if (!data.length || total <= 0) {
        donut.style.background = "#edf1ee";
        legend.innerHTML = `<div class="empty">暂无分类数据</div>`;
        return;
      }

      let cursor = 0;
      const segments = data.map((item, i) => {
        const pct = item.amount / total;
        const start = cursor * 100;
        cursor += pct;
        const end = cursor * 100;
        const color = COLORS[i % COLORS.length];
        return { ...item, color, start, end, pct };
      });
      donut.style.background = `conic-gradient(${segments.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(",")})`;

      legend.innerHTML = segments.map((s) => `
        <div class="legend-item" data-category="${s.category}">
          <span class="swatch" style="background:${s.color}"></span>
          <span class="legend-title">${s.category}</span>
          <span class="legend-value">${cnsFmtMoney(s.amount)} · ${(s.pct * 100).toFixed(1)}%</span>
        </div>
      `).join("");

      legend.querySelectorAll(".legend-item").forEach((node) => {
        node.addEventListener("click", () => {
          const category = node.getAttribute("data-category");
          cnsToggleSetValue(state.selectedCategories, category);
          render();
        });
      });
    }

    function renderCategoryBars(rows) {
      const holder = document.getElementById("categoryBars");
      const data = cnsAggregateByCategory(rows).slice(0, 9);
      if (!data.length) {
        holder.innerHTML = `<div class="empty">当前筛选无分类排行</div>`;
        return;
      }
      const max = Math.max(...data.map((x) => x.amount), 1);
      holder.innerHTML = data.map((item) => `
        <div class="bar-row">
          <div class="bar-label">${item.category}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(item.amount / max) * 100}%"></div></div>
          <div class="bar-value">${cnsFmtMoney(item.amount)}</div>
        </div>
      `).join("");
    }

    function renderFilterPills() {
      if (!filterPills) return;
      const items = [];
      if (state.month !== "ALL") items.push({ type: "month", value: state.month, label: `月份: ${state.month}` });
      state.selectedCategories.forEach((v) => items.push({ type: "category", value: v, label: `分类: ${v}` }));
      state.selectedMerchants.forEach((v) => items.push({ type: "merchant", value: v, label: `商户: ${v}` }));
      if (state.keyword.trim()) items.push({ type: "keyword", value: "keyword", label: `关键词: ${state.keyword.trim()}` });
      if (state.includePending) items.push({ type: "pending", value: "pending", label: "显示待确认" });

      if (items.length === 0) {
        filterPills.innerHTML = `<span class="pill-empty">当前无筛选，展示默认分析结果。</span>`;
        return;
      }

      filterPills.innerHTML = `
        ${items
          .map(
            (x) => `<span class="pill" data-type="${x.type}" data-value="${x.value}">
              <span class="txt">${x.label}</span>
              <button type="button" title="移除筛选">×</button>
            </span>`
          )
          .join("")}
        <button class="pill-clear-all" type="button" data-action="clear-all">清空全部筛选 ×</button>
      `;

      filterPills.querySelectorAll(".pill button").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const pill = e.currentTarget.closest(".pill");
          if (!pill) return;
          const type = pill.getAttribute("data-type");
          const value = pill.getAttribute("data-value");
          if (type === "month") {
            state.month = "ALL";
            monthSelect.value = "ALL";
          }
          if (type === "category") state.selectedCategories.delete(value);
          if (type === "merchant") state.selectedMerchants.delete(value);
          if (type === "keyword") {
            state.keyword = "";
            keywordInput.value = "";
          }
          if (type === "pending") {
            state.includePending = false;
            includePending.checked = false;
          }
          render();
        });
      });
      const clearAll = filterPills.querySelector('[data-action="clear-all"]');
      if (clearAll) {
        clearAll.addEventListener("click", () => {
          state.month = "ALL";
          monthSelect.value = "ALL";
          state.selectedCategories.clear();
          state.selectedMerchants.clear();
          state.keyword = "";
          keywordInput.value = "";
          state.includePending = false;
          includePending.checked = false;
          render();
        });
      }
    }

    function renderCategoryCloud() {
      if (!categoryCloud) return;
      const categories = REPORT_DATA.categories.map((x) => x.category);
      if (!categories.length) {
        categoryCloud.innerHTML = `<div class="empty">暂无分类可筛选</div>`;
        return;
      }
      categoryCloud.innerHTML = categories.map((cat) => `
        <button class="chip ${state.selectedCategories.has(cat) ? "active" : ""}" data-category="${cat}">${cat}</button>
      `).join("");
      categoryCloud.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const category = btn.getAttribute("data-category");
          cnsToggleSetValue(state.selectedCategories, category);
          render();
        });
      });
    }

    function renderMerchantCloud(rowsForCloud) {
      const holder = document.getElementById("merchantCloud");
      const data = cnsAggregateByMerchant(rowsForCloud).slice(0, 22);
      if (!data.length) {
        holder.innerHTML = `<div class="empty">当前筛选无商户数据</div>`;
        return;
      }
      holder.innerHTML = data.map((item) => `
        <button class="chip ${state.selectedMerchants.has(item.merchant) ? "active" : ""}" data-merchant="${item.merchant}" title="${cnsFmtMoney(item.amount)} · ${item.count}笔">${item.merchant}</button>
      `).join("");
      holder.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const merchant = btn.getAttribute("data-merchant");
          cnsToggleSetValue(state.selectedMerchants, merchant);
          render();
        });
      });
    }

    function renderTable(rows) {
      const tbody = document.getElementById("txnBody");
      const sorted = cnsSortRows(rows).slice(0, 160);
      cnsUpdateSortHeaders();
      if (!sorted.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">当前筛选无交易记录</td></tr>`;
        return;
      }
      tbody.innerHTML = sorted.map((row) => `
        <tr class="${row.needs_review ? "warn" : ""}">
          <td>${row.date}</td>
          <td>${row.category}</td>
          <td>${row.merchant}</td>
          <td>${row.description}</td>
          <td>${row.source_path}</td>
          <td>${(row.confidence * 100).toFixed(0)}%</td>
          <td class="num">${cnsFmtMoney(row.amount)}</td>
        </tr>
      `).join("");
    }

    function render() {
      const rows = cnsGetFilteredRows();
      const rowsForCloud = cnsGetFilteredRows(true);
      const scopeLabel = state.month === "ALL" ? `${state.year} 全年` : state.month;
      if (privacyToggle) {
        privacyToggle.classList.toggle("active", state.hideAmounts);
        privacyToggle.setAttribute("aria-pressed", state.hideAmounts ? "true" : "false");
        privacyToggle.setAttribute("title", state.hideAmounts ? "点击显示金额" : "点击隐藏金额");
      }
      if (privacyToggleLabel) privacyToggleLabel.textContent = state.hideAmounts ? "显示金额" : "隐藏金额";
      cnsText(
        "heroSubtitle",
        `${scopeLabel} 消费分析（筛选后 ${rows.length} 笔），金额 ${cnsFmtMoney(rows.reduce((s, x) => s + x.amount, 0))}。`
      );
      renderMetrics(rows);
      renderTrendChart(rows);
      renderDonut(rows);
      renderCategoryCloud();
      renderCategoryBars(rows);
      renderMerchantCloud(rowsForCloud);
      renderFilterPills();
      renderTable(rows);

      cnsText("resultHint", `· 当前筛选命中 ${rows.length.toLocaleString()} 笔`);
      cnsText(
        "footInfo",
        `${scopeLabel} · 当前筛选 ${rows.length} 笔，待确认 ${rows.filter((x) => x.needs_review).length} 笔`
      );
      cnsText("footTime", `生成时间：${REPORT_DATA.generated_at}`);
    }

    window.keepwiseConsumption = Object.assign(window.keepwiseConsumption || {}, {
      renderMetrics,
      renderTrendChart,
      renderDonut,
      renderCategoryBars,
      renderFilterPills,
      renderCategoryCloud,
      renderMerchantCloud,
      renderTable,
      render,
    });
