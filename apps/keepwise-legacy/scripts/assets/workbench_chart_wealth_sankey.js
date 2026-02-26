    function renderWealthSankeyChart(hostId, legendId, overviewData, filters = {}) {
      const host = document.getElementById(hostId);
      const legend = document.getElementById(legendId);
      if (!host || !legend) return;
      const summary = overviewData && overviewData.summary ? overviewData.summary : null;
      if (!summary) {
        host.innerHTML = `<div class="empty">暂无关系图数据</div>`;
        legend.classList.add("hidden");
        return;
      }

      const liability = filters.include_liability ? Number(summary.liability_total_cents || 0) : 0;
      const gross = Number(summary.gross_assets_total_cents || summary.wealth_total_cents || 0);
      const net = Number(summary.net_asset_total_cents || (gross - liability));
      if (gross <= 0 && liability <= 0) {
        host.innerHTML = `<div class="empty">暂无关系图数据</div>`;
        legend.classList.add("hidden");
        return;
      }

      const categories = [
        { key: "cash", enabled: !!filters.include_cash, label: "现金", color: "#2f6db4", total: Number(summary.cash_total_cents || 0) },
        { key: "real_estate", enabled: !!filters.include_real_estate, label: "不动产", color: "#7d5a97", total: Number(summary.real_estate_total_cents || 0) },
        { key: "investment", enabled: !!filters.include_investment, label: "投资", color: "#e28b00", total: Number(summary.investment_total_cents || 0) },
      ].filter(item => item.enabled && item.total > 0);

      const width = 980;
      const height = 420;
      const centerY = 220;

      function formatSankeyAmount(cents, options = {}) {
        const { negative = false } = options;
        if (shouldMaskAmounts()) return "****";
        const raw = Number(cents || 0);
        const value = negative ? -Math.abs(raw) : raw;
        const yuan = value / 100;
        const abs = Math.abs(yuan);
        if (abs >= 100000000) return `${(yuan / 100000000).toFixed(2)}亿`;
        if (abs >= 10000) return `${(yuan / 10000).toFixed(2)}万`;
        return `${yuan.toFixed(2)}元`;
      }

      function escapeSvgText(text) {
        return escapeHtml(String(text || "")).replaceAll("\n", " ");
      }

      function linkPath(x1, y1, x2, y2, bend = 0.42) {
        const dx = x2 - x1;
        const c1 = x1 + dx * bend;
        const c2 = x2 - dx * (1 - bend);
        return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
      }

      const flowBase = Math.max(gross, Math.abs(net), liability, 1);
      const flowWidth = (value, minWidth = 3, maxWidth = 58) => {
        const raw = (Math.abs(Number(value || 0)) / flowBase) * maxWidth;
        return Math.max(minWidth, Math.min(maxWidth, raw));
      };

      const leftNodeX = 56;
      const leftNodeW = 170;
      const leftNodeH = 42;
      const leftGap = 16;
      const leftBlockH = categories.length > 0 ? categories.length * leftNodeH + (categories.length - 1) * leftGap : 0;
      const leftStartY = Math.max(78, centerY - Math.round(leftBlockH / 2));

      const grossNode = { x: 392, y: centerY - 32, w: 170, h: 64, label: "总资产", value: gross, color: "#6366f1" };
      const netNode = { x: 700, y: centerY - 74, w: 170, h: 48, label: "净资产", value: net, color: "#10b981" };
      const debtNode = { x: 700, y: centerY + 30, w: 170, h: 48, label: "负债", value: liability, color: "#b42318" };

      categories.forEach((item, idx) => {
        item.x = leftNodeX;
        item.y = leftStartY + idx * (leftNodeH + leftGap);
        item.w = leftNodeW;
        item.h = leftNodeH;
      });

      const topCards = [
        { x: 392, y: 16, w: 120, h: 52, label: "总资产", value: gross, color: "#6366f1" },
        { x: 520, y: 16, w: 120, h: 52, label: "总负债", value: liability, color: "#b42318", negative: true },
        { x: 648, y: 16, w: 120, h: 52, label: "净资产", value: net, color: "#10b981" },
      ];

      function nodeBox(node, options = {}) {
        const { muted = false } = options;
        const stroke = muted ? "rgba(148,163,184,0.28)" : "rgba(99,102,241,0.14)";
        return `
          <g>
            <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="12" ry="12"
              fill="rgba(255,255,255,0.96)" stroke="${stroke}" stroke-width="1" />
            <rect x="${node.x}" y="${node.y}" width="8" height="${node.h}" rx="12" ry="12" fill="${node.color}" opacity="0.88" />
            <text x="${node.x + 14}" y="${node.y + 18}" font-size="12" fill="#475569">${escapeSvgText(node.label)}</text>
            <text x="${node.x + 14}" y="${node.y + node.h - 12}" font-size="13" font-weight="700" fill="${node.color}">
              ${escapeSvgText(formatSankeyAmount(node.value, { negative: node.label.includes("负债") }))}
            </text>
          </g>
        `;
      }

      function categoryNodeBox(node) {
        const ratio = gross > 0 ? (Number(node.total || 0) / gross) : 0;
        const ratioText = `${(ratio * 100).toFixed(1)}%`;
        return `
          <g>
            <rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="10" ry="10"
              fill="rgba(255,255,255,0.95)" stroke="rgba(148,163,184,0.22)" stroke-width="1" />
            <rect x="${node.x}" y="${node.y}" width="7" height="${node.h}" rx="10" ry="10" fill="${node.color}" />
            <text x="${node.x + 13}" y="${node.y + 16}" font-size="11.5" fill="#334155">${escapeSvgText(node.label)}</text>
            <text x="${node.x + 13}" y="${node.y + 31}" font-size="10.5" fill="rgba(71,85,105,0.78)">
              ${escapeSvgText(formatSankeyAmount(node.total))} · ${escapeSvgText(ratioText)}
            </text>
          </g>
        `;
      }

      function summaryCard(card) {
        return `
          <g>
            <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="12" ry="12"
              fill="rgba(255,255,255,0.90)" stroke="rgba(148,163,184,0.20)" stroke-width="1" />
            <text x="${card.x + 12}" y="${card.y + 17}" font-size="11.5" fill="#64748b">${escapeSvgText(card.label)}</text>
            <text x="${card.x + 12}" y="${card.y + 38}" font-size="13.5" font-weight="700" fill="${card.color}">
              ${escapeSvgText(formatSankeyAmount(card.value, { negative: !!card.negative }))}
            </text>
          </g>
        `;
      }

      const links = [];
      categories.forEach((cat, idx) => {
        links.push({
          d: linkPath(cat.x + cat.w, cat.y + cat.h / 2, grossNode.x, grossNode.y + grossNode.h / 2 + (idx - (categories.length - 1) / 2) * 8, 0.46),
          color: cat.color,
          width: flowWidth(cat.total, 4, 44),
          glow: 0.22,
        });
      });

      const netPortion = Math.max(0, gross - liability);
      if (netPortion > 0) {
        links.push({
          d: linkPath(grossNode.x + grossNode.w, grossNode.y + grossNode.h / 2 - 6, netNode.x, netNode.y + netNode.h / 2, 0.44),
          color: "#10b981",
          width: flowWidth(netPortion, 5, 52),
          glow: 0.20,
        });
      }
      if (liability > 0) {
        links.push({
          d: linkPath(grossNode.x + grossNode.w, grossNode.y + grossNode.h / 2 + 8, debtNode.x, debtNode.y + debtNode.h / 2, 0.44),
          color: "#b42318",
          width: flowWidth(liability, 4, 44),
          glow: 0.16,
          dash: "8 5",
        });
      }

      host.innerHTML = `
        <div class="chart-stage">
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" class="chart-svg">
            <defs>
              <linearGradient id="wealthSankeyBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fbfdff" />
                <stop offset="100%" stop-color="#f7faff" />
              </linearGradient>
              <radialGradient id="wealthSankeyGlowA" cx="22%" cy="22%" r="70%">
                <stop offset="0%" stop-color="rgba(99,102,241,0.07)" />
                <stop offset="100%" stop-color="rgba(99,102,241,0)" />
              </radialGradient>
              <radialGradient id="wealthSankeyGlowB" cx="72%" cy="60%" r="65%">
                <stop offset="0%" stop-color="rgba(16,185,129,0.06)" />
                <stop offset="100%" stop-color="rgba(16,185,129,0)" />
              </radialGradient>
            </defs>
            <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14" ry="14" fill="url(#wealthSankeyBg)" stroke="rgba(148,163,184,0.20)" />
            <rect x="0" y="0" width="${width}" height="${height}" rx="14" ry="14" fill="url(#wealthSankeyGlowA)" />
            <rect x="0" y="0" width="${width}" height="${height}" rx="14" ry="14" fill="url(#wealthSankeyGlowB)" />
            <text x="22" y="28" font-size="15.5" fill="#0f172a" font-weight="700">财富关系图</text>

            ${topCards.map(summaryCard).join("")}

            ${links.map(link => `
              <path d="${link.d}" fill="none" stroke="${link.color}" stroke-opacity="${link.glow}" stroke-linecap="round"
                stroke-width="${link.width}" ${link.dash ? `stroke-dasharray="${link.dash}"` : ""} />
              <path d="${link.d}" fill="none" stroke="${link.color}" stroke-opacity="0.72" stroke-linecap="round"
                stroke-width="${Math.max(1.05, link.width * 0.16)}" ${link.dash ? `stroke-dasharray="${link.dash}"` : ""} />
            `).join("")}

            ${categories.map(categoryNodeBox).join("")}
            ${nodeBox(grossNode)}
            ${nodeBox(netNode, { muted: true })}
            ${liability > 0 ? nodeBox(debtNode, { muted: true }) : ""}

            <text x="22" y="${height - 16}" font-size="11" fill="rgba(100,116,139,0.88)">
              说明：总资产由现金 / 不动产 / 投资构成，总资产再拆分为净资产与负债（虚线）。
            </text>
          </svg>
        </div>
      `;

      legend.classList.add("hidden");
      legend.innerHTML = "";
      applyAmountMaskInDom(host);
    }

    window.keepwiseWorkbench = Object.assign(window.keepwiseWorkbench || {}, {
      renderWealthSankeyChart,
    });
