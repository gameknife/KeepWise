    function renderWealthStackedTrendChart(hostId, legendId, rows, filters = {}) {
      const host = document.getElementById(hostId);
      const legend = document.getElementById(legendId);
      if (!host || !legend) return;
      if (!rows || rows.length === 0) {
        host.innerHTML = `<div class="empty">暂无可视化数据</div>`;
        legend.classList.add("hidden");
        return;
      }

      const width = 1000;
      const height = 380;
      const padLeft = 104;
      const padRight = 24;
      const padTop = 16;
      const padBottom = 30;
      const chartWidth = width - padLeft - padRight;
      const chartHeight = height - padTop - padBottom;
      const xStep = rows.length > 1 ? chartWidth / (rows.length - 1) : 0;
      const x = idx => padLeft + idx * xStep;

      const stackSeries = [];
      if (filters.include_investment) stackSeries.push({ key: "investment_total_cents", label: "投资", color: "#e28b00" });
      if (filters.include_cash) stackSeries.push({ key: "cash_total_cents", label: "现金", color: "#2f6db4" });
      if (filters.include_real_estate) stackSeries.push({ key: "real_estate_total_cents", label: "不动产", color: "#7d5a97" });

      const includeLiability = !!filters.include_liability;
      const areaSegments = [];
      let maxVal = 0;
      let minVal = 0;
      const grossLine = [];
      const liabilityLine = [];
      const pointMeta = [];

      rows.forEach((row, idx) => {
        let positiveBase = 0;
        const segmentsAtPoint = [];
        stackSeries.forEach(series => {
          const value = Number(row[series.key] || 0);
          const y0 = positiveBase;
          const y1 = positiveBase + value;
          positiveBase = y1;
          segmentsAtPoint.push({ ...series, y0, y1, value });
          maxVal = Math.max(maxVal, y1);
        });
        const liability = includeLiability ? Number(row.liability_total_cents || 0) : 0;
        const liabilityBottom = -liability;
        minVal = Math.min(minVal, liabilityBottom);
        const gross = Number(row.wealth_total_cents || 0);
        const net = Number(row.net_asset_total_cents || 0);
        maxVal = Math.max(maxVal, gross);
        minVal = Math.min(minVal, 0);
        grossLine.push(gross);
        liabilityLine.push(liability);
        pointMeta.push({
          snapshot_date: row.snapshot_date || "",
          gross,
          liability,
          net,
          segments: segmentsAtPoint,
        });

        segmentsAtPoint.forEach(seg => {
          let holder = areaSegments.find(item => item.key === seg.key);
          if (!holder) {
            holder = { key: seg.key, label: seg.label, color: seg.color, uppers: [], lowers: [] };
            areaSegments.push(holder);
          }
          holder.uppers.push({ x: x(idx), yValue: seg.y1 });
          holder.lowers.push({ x: x(idx), yValue: seg.y0 });
        });
      });

      if (Math.abs(maxVal - minVal) < 1e-9) {
        maxVal += 1;
        minVal -= 1;
      }
      const span = maxVal - minVal;
      const y = val => padTop + ((maxVal - val) / span) * chartHeight;
      const zeroY = y(0);

      const yTickCount = 4;
      const gridLines = [];
      const yLabels = [];
      for (let i = 0; i <= yTickCount; i += 1) {
        const ratio = i / yTickCount;
        const val = maxVal - ratio * span;
        const yy = y(val);
        gridLines.push(
          `<line x1="${padLeft}" y1="${yy.toFixed(2)}" x2="${width - padRight}" y2="${yy.toFixed(2)}" stroke="#e3e8d8" stroke-width="1" />`
        );
        yLabels.push(
          `<text x="${padLeft - 8}" y="${(yy + 4).toFixed(2)}" font-size="11" text-anchor="end" fill="#6a767f">${
            shouldMaskAmounts() ? "****" : `${formatYuanShortFromCents(val)}元`
          }</text>`
        );
      }
      const areaPolygons = areaSegments.map(seg => {
        const upper = seg.uppers.map(p => `${p.x.toFixed(2)},${y(p.yValue).toFixed(2)}`);
        const lower = seg.lowers.slice().reverse().map(p => `${p.x.toFixed(2)},${y(p.yValue).toFixed(2)}`);
        return `
          <polygon points="${upper.concat(lower).join(" ")}"
            fill="${seg.color}" fill-opacity="0.14" stroke="${seg.color}" stroke-width="1.4" />
        `;
      }).join("");

      const liabilityArea = includeLiability
        ? (() => {
            const upper = rows.map((_, idx) => `${x(idx).toFixed(2)},${zeroY.toFixed(2)}`);
            const lower = rows.slice().reverse().map((row, reverseIdx) => {
              const idx = rows.length - 1 - reverseIdx;
              const liab = Number(row.liability_total_cents || 0);
              return `${x(idx).toFixed(2)},${y(-liab).toFixed(2)}`;
            });
            return `
              <polygon points="${upper.concat(lower).join(" ")}"
                fill="#b42318" fill-opacity="0.07" stroke="none" />
              <polygon points="${upper.concat(lower).join(" ")}"
                fill="url(#wealthLiabilityPattern)" stroke="#b42318" stroke-opacity="0.75" stroke-width="1.2" />
            `;
          })()
        : "";

      function polyline(values, color, widthPx = 2.4, dash = "") {
        const points = values.map((val, idx) => `${x(idx).toFixed(2)},${y(Number(val)).toFixed(2)}`).join(" ");
        return `<polyline fill="none" stroke="${color}" stroke-width="${widthPx}" ${dash ? `stroke-dasharray="${dash}"` : ""} points="${points}" />`;
      }

      const grossLineSvg = polyline(grossLine, "#0f766e", 2.8);
      const liabilityLineSvg = includeLiability ? polyline(liabilityLine.map(v => -v), "#b42318", 2.0, "6 4") : "";

      const xStartLabel = rows[0].snapshot_date || "";
      const xEndLabel = rows[rows.length - 1].snapshot_date || "";

      host.innerHTML = `
        <div class="chart-stage">
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" class="chart-svg">
            <defs>
              <pattern id="wealthLiabilityPattern" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(135)">
                <line x1="0" y1="0" x2="0" y2="12" stroke="#b42318" stroke-width="2" stroke-opacity="0.22" stroke-dasharray="3 4" />
              </pattern>
            </defs>
            ${gridLines.join("")}
            ${yLabels.join("")}
            <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" stroke="#cfd8c3" stroke-width="1.2" />
            <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" stroke="#cfd8c3" stroke-width="1.2" />
            ${areaPolygons}
            ${liabilityArea}
            <line x1="${padLeft}" y1="${zeroY.toFixed(2)}" x2="${width - padRight}" y2="${zeroY.toFixed(2)}" stroke="#b6c2bd" stroke-width="1.3" stroke-dasharray="5 4" />
            ${grossLineSvg}
            ${liabilityLineSvg}
            <line data-role="hover-line" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" stroke="#6f7f86" stroke-width="1.2" stroke-dasharray="4 4" visibility="hidden" />
            <circle data-role="hover-dot-gross" r="4.5" fill="#fff" stroke="#0f766e" stroke-width="2" visibility="hidden" />
            ${includeLiability ? '<circle data-role="hover-dot-liab" r="4.2" fill="#fff" stroke="#b42318" stroke-width="2" visibility="hidden" />' : ""}
            <text x="${padLeft}" y="${height - 8}" font-size="11" fill="#6a767f">${xStartLabel}</text>
            <text x="${width - padRight - 90}" y="${height - 8}" font-size="11" fill="#6a767f">${xEndLabel}</text>
            <rect data-role="overlay" x="${padLeft}" y="${padTop}" width="${chartWidth}" height="${chartHeight}" fill="transparent" />
          </svg>
          <div class="chart-tooltip hidden" data-role="tooltip"></div>
        </div>
      `;

      const legendItems = [
        ...areaSegments.map(seg => `<span class="legend-item"><i style="background:${seg.color}"></i>${seg.label}(堆叠)</span>`),
        includeLiability ? `<span class="legend-item"><i style="background:#b42318"></i>负债(向下堆叠/虚线)</span>` : "",
        `<span class="legend-item"><i style="background:#0f766e"></i>总资产</span>`,
      ].filter(Boolean);
      legend.classList.remove("hidden");
      legend.innerHTML = legendItems.join("");

      const stage = host.querySelector(".chart-stage");
      const overlay = host.querySelector('[data-role="overlay"]');
      const hoverLine = host.querySelector('[data-role="hover-line"]');
      const dotGross = host.querySelector('[data-role="hover-dot-gross"]');
      const dotLiab = host.querySelector('[data-role="hover-dot-liab"]');
      const tooltip = host.querySelector('[data-role="tooltip"]');
      if (!stage || !overlay || !hoverLine || !tooltip || !dotGross) return;

      function showAt(index, pointerX = null) {
        if (index < 0 || index >= pointMeta.length) return;
        const meta = pointMeta[index];
        const xx = x(index);
        hoverLine.setAttribute("x1", xx.toFixed(2));
        hoverLine.setAttribute("x2", xx.toFixed(2));
        hoverLine.setAttribute("visibility", "visible");

        dotGross.setAttribute("cx", xx.toFixed(2));
        dotGross.setAttribute("cy", y(meta.gross).toFixed(2));
        dotGross.setAttribute("visibility", "visible");

        if (dotLiab) {
          dotLiab.setAttribute("cx", xx.toFixed(2));
          dotLiab.setAttribute("cy", y(-meta.liability).toFixed(2));
          dotLiab.setAttribute("visibility", includeLiability ? "visible" : "hidden");
        }

        const lines = [];
        meta.segments.forEach(seg => {
          lines.push(`<div class="t-row"><i style="background:${seg.color}"></i><span>${seg.label}: ${renderAmountValue(`${money(seg.value)} 元`)}</span></div>`);
        });
        if (includeLiability) {
          lines.push(`<div class="t-row"><i style="background:#b42318"></i><span>负债: ${renderAmountValue(`${money(meta.liability)} 元`)}</span></div>`);
        }
        lines.push(`<div class="t-row"><i style="background:#0f766e"></i><span>总资产: ${renderAmountValue(`${money(meta.gross)} 元`)}</span></div>`);

        tooltip.innerHTML = `<div class="t-title">${meta.snapshot_date}</div>${lines.join("")}`;
        tooltip.classList.remove("hidden");

        const stageRect = stage.getBoundingClientRect();
        const targetX = pointerX !== null ? pointerX : (xx / width) * stageRect.width;
        const tooltipWidth = tooltip.offsetWidth || 180;
        let left = targetX + 12;
        if (left + tooltipWidth > stageRect.width - 6) left = targetX - tooltipWidth - 12;
        if (left < 6) left = 6;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = "8px";
      }

      function hideHover() {
        hoverLine.setAttribute("visibility", "hidden");
        dotGross.setAttribute("visibility", "hidden");
        if (dotLiab) dotLiab.setAttribute("visibility", "hidden");
        tooltip.classList.add("hidden");
      }

      overlay.addEventListener("mousemove", (event) => {
        const rect = overlay.getBoundingClientRect();
        if (rect.width <= 0) return;
        const px = event.clientX - rect.left;
        const localX = (px / rect.width) * chartWidth;
        const idx = rows.length > 1 ? Math.round(localX / xStep) : 0;
        const clampedIdx = Math.max(0, Math.min(rows.length - 1, idx));
        showAt(clampedIdx, event.clientX - stage.getBoundingClientRect().left);
      });
      overlay.addEventListener("mouseenter", () => showAt(rows.length - 1));
      overlay.addEventListener("mouseleave", hideHover);
      applyAmountMaskInDom(host);
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      renderWealthStackedTrendChart,
    });
