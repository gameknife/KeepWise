    function renderLineChart(hostId, legendId, rows, seriesDefs, options = {}) {
      const host = document.getElementById(hostId);
      const legend = document.getElementById(legendId);
      if (!rows || rows.length === 0) {
        host.innerHTML = `<div class="empty">暂无可视化数据</div>`;
        legend.classList.add("hidden");
        return;
      }

      const width = 1000;
      const height = 360;
      const padLeft = 60;
      const padRight = 24;
      const padTop = 16;
      const padBottom = 30;
      const chartWidth = width - padLeft - padRight;
      const chartHeight = height - padTop - padBottom;

      const yTickCount = Math.max(2, Number(options.yTickCount || 4));
      const includeZero = options.includeZero !== false;
      const yAxisFormatter = options.yAxisFormatter || ((v) => `${Number(v).toFixed(2)}`);
      const referenceLines = Array.isArray(options.referenceLines) ? options.referenceLines : [];

      const values = rows.flatMap(row => seriesDefs.map(s => Number(row[s.key])));
      const numericValues = values.filter(v => Number.isFinite(v));
      if (numericValues.length === 0) {
        host.innerHTML = `<div class="empty">暂无可视化数据</div>`;
        legend.classList.add("hidden");
        return;
      }

      let minVal = Math.min(...numericValues);
      let maxVal = Math.max(...numericValues);
      if (includeZero) {
        minVal = Math.min(minVal, 0);
        maxVal = Math.max(maxVal, 0);
      }
      if (Number.isFinite(options.minValue)) minVal = Number(options.minValue);
      if (Number.isFinite(options.maxValue)) maxVal = Number(options.maxValue);
      if (Math.abs(maxVal - minVal) < 1e-9) {
        const padding = Math.max(1, Math.abs(maxVal) * 0.1);
        minVal -= padding;
        maxVal += padding;
      }
      const span = maxVal - minVal;
      const xStep = rows.length > 1 ? chartWidth / (rows.length - 1) : 0;

      const x = idx => padLeft + idx * xStep;
      const y = val => padTop + ((maxVal - val) / span) * chartHeight;

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
          `<text x="${padLeft - 8}" y="${(yy + 4).toFixed(2)}" font-size="11" text-anchor="end" fill="#6a767f">${yAxisFormatter(val)}</text>`
        );
      }

      const refLineSvg = referenceLines
        .filter(line => Number.isFinite(line.value))
        .filter(line => line.value >= minVal && line.value <= maxVal)
        .map(line => {
          const yy = y(Number(line.value));
          const color = line.color || "#d2d9c7";
          return `
            <line x1="${padLeft}" y1="${yy.toFixed(2)}" x2="${width - padRight}" y2="${yy.toFixed(2)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="5 4" />
            <text x="${padLeft + 4}" y="${(yy - 4).toFixed(2)}" font-size="11" fill="${color}">${line.label || ""}</text>
          `;
        }).join("");

      const seriesPaths = seriesDefs.map(def => {
        const segments = [];
        let current = [];
        rows.forEach((row, idx) => {
          const val = Number(row[def.key]);
          if (!Number.isFinite(val)) {
            if (current.length > 1) {
              segments.push(current);
            }
            current = [];
            return;
          }
          current.push(`${x(idx).toFixed(2)},${y(val).toFixed(2)}`);
        });
        if (current.length > 1) segments.push(current);
        return segments
          .map(points => `<polyline fill="none" stroke="${def.color}" stroke-width="2.4" points="${points.join(" ")}" />`)
          .join("");
      }).join("");

      const xStartLabel = rows[0].snapshot_date || "";
      const xEndLabel = rows[rows.length - 1].snapshot_date || "";

      host.innerHTML = `
        <div class="chart-stage">
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" class="chart-svg">
            ${gridLines.join("")}
            ${yLabels.join("")}
            ${refLineSvg}
            <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" stroke="#cfd8c3" stroke-width="1.2" />
            <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" stroke="#cfd8c3" stroke-width="1.2" />
            ${seriesPaths}
            <line data-role="hover-line" x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${height - padBottom}" stroke="#6f7f86" stroke-width="1.2" stroke-dasharray="4 4" visibility="hidden" />
            ${seriesDefs.map((def, idx) => `
              <circle data-role="hover-dot" data-series="${idx}" r="4.5" fill="#fff" stroke="${def.color}" stroke-width="2" visibility="hidden" />
            `).join("")}
            <text x="${padLeft}" y="${height - 8}" font-size="11" fill="#6a767f">${xStartLabel}</text>
            <text x="${width - padRight - 90}" y="${height - 8}" font-size="11" fill="#6a767f">${xEndLabel}</text>
            <rect data-role="overlay" x="${padLeft}" y="${padTop}" width="${chartWidth}" height="${chartHeight}" fill="transparent" />
          </svg>
          <div class="chart-tooltip hidden" data-role="tooltip"></div>
        </div>
      `;

      legend.classList.remove("hidden");
      legend.innerHTML = seriesDefs.map(def => `
        <span class="legend-item"><i style="background:${def.color}"></i>${def.label}</span>
      `).join("");

      const stage = host.querySelector(".chart-stage");
      const overlay = host.querySelector('[data-role="overlay"]');
      const hoverLine = host.querySelector('[data-role="hover-line"]');
      const dots = Array.from(host.querySelectorAll('[data-role="hover-dot"]'));
      const tooltip = host.querySelector('[data-role="tooltip"]');
      if (!stage || !overlay || !hoverLine || !tooltip) return;

      function showAt(index, pointerX = null) {
        if (index < 0 || index >= rows.length) return;
        const row = rows[index];
        const xCoord = x(index);
        hoverLine.setAttribute("x1", xCoord.toFixed(2));
        hoverLine.setAttribute("x2", xCoord.toFixed(2));
        hoverLine.setAttribute("visibility", "visible");

        const lines = [];
        seriesDefs.forEach((def, idx) => {
          const val = Number(row[def.key]);
          const dot = dots[idx];
          if (!dot) return;
          if (Number.isFinite(val)) {
            const yCoord = y(val);
            dot.setAttribute("cx", xCoord.toFixed(2));
            dot.setAttribute("cy", yCoord.toFixed(2));
            dot.setAttribute("visibility", "visible");
            const valueText = typeof def.formatValue === "function" ? def.formatValue(val, row) : `${val}`;
            lines.push(`<div class="t-row"><i style="background:${def.color}"></i><span>${def.label}: ${valueText}</span></div>`);
          } else {
            dot.setAttribute("visibility", "hidden");
          }
        });

        const title = typeof options.tooltipTitle === "function"
          ? options.tooltipTitle(row, index)
          : (row.snapshot_date || "");
        tooltip.innerHTML = `<div class="t-title">${title}</div>${lines.join("")}`;
        tooltip.classList.remove("hidden");

        const stageRect = stage.getBoundingClientRect();
        const targetX = pointerX !== null ? pointerX : (xCoord / width) * stageRect.width;
        const tooltipWidth = tooltip.offsetWidth || 140;
        let left = targetX + 12;
        if (left + tooltipWidth > stageRect.width - 6) left = targetX - tooltipWidth - 12;
        if (left < 6) left = 6;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = "8px";
      }

      function hideHover() {
        hoverLine.setAttribute("visibility", "hidden");
        dots.forEach(dot => dot.setAttribute("visibility", "hidden"));
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

      overlay.addEventListener("mouseenter", () => {
        showAt(rows.length - 1);
      });
      overlay.addEventListener("mouseleave", hideHover);
    }


    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      renderLineChart,
    });
