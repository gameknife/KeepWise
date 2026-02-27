import { useEffect, useRef, useState, type ComponentType } from "react";
import { sankey as d3Sankey, sankeyJustify, sankeyLinkHorizontal } from "d3-sankey";
import { isRecord, readArray, readNumber, readPath, readString } from "../../utils/value";

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

type WealthVisibility = {
  investment: boolean;
  cash: boolean;
  realEstate: boolean;
  liability: boolean;
};

function WealthStackedTrendChart({
  rows,
  visibility,
  formatCentsShort,
  height = 300,
}: {
  rows: Array<{
    label: string;
    cash: number;
    realEstate: number;
    investment: number;
    liability: number;
  }>;
  visibility: WealthVisibility;
  formatCentsShort: (cents?: number) => string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(720);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.max(360, Math.round(el.clientWidth || 720));
      setMeasuredWidth((prev) => (prev === next ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => update());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const points = rows.filter((r) => r.label);
  if (points.length === 0) {
    return <div ref={wrapRef} className="line-area-chart-empty">暂无趋势数据</div>;
  }

  const width = measuredWidth;
  const layers = [
    { key: "cash", label: "现金", color: "#6fb4ff", visible: visibility.cash },
    { key: "realEstate", label: "不动产", color: "#9b84ff", visible: visibility.realEstate },
    { key: "investment", label: "投资", color: "#eab35f", visible: visibility.investment },
  ] as const;
  const debtColor = "#ff8c7a";
  const debtPatternId = "wealth-debt-stripe-pattern";

  const enriched = points.map((p) => {
    const cash = visibility.cash && Number.isFinite(p.cash) ? p.cash : 0;
    const realEstate = visibility.realEstate && Number.isFinite(p.realEstate) ? p.realEstate : 0;
    const investment = visibility.investment && Number.isFinite(p.investment) ? p.investment : 0;
    const liability = visibility.liability ? Math.max(0, Number.isFinite(p.liability) ? p.liability : 0) : 0;
    const cashTop = cash;
    const reTop = cash + realEstate;
    const invTop = cash + realEstate + investment;
    return {
      ...p,
      cash,
      realEstate,
      investment,
      liability,
      cashBottom: 0,
      cashTop,
      realEstateBottom: cashTop,
      realEstateTop: reTop,
      investmentBottom: reTop,
      investmentTop: invTop,
      liabilityTop: 0,
      liabilityBottom: -liability,
    };
  });

  const maxPositive = Math.max(...enriched.map((p) => p.investmentTop), 0);
  const minNegative = Math.min(...enriched.map((p) => p.liabilityBottom), 0);
  let yMin = minNegative;
  let yMax = maxPositive;
  if (yMin === yMax) {
    const bump = Math.max(Math.abs(yMax) * 0.1, 1);
    yMin -= bump;
    yMax += bump;
  } else {
    const span = yMax - yMin;
    const pad = span * 0.08;
    yMin -= pad;
    yMax += pad;
  }
  const ySpan = yMax - yMin || 1;

  const baseMargin = { top: 14, right: 16, bottom: 42 };
  const yTickCount = 4;
  const innerH = height - baseMargin.top - baseMargin.bottom;
  const yTickMeta = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const ratio = i / yTickCount;
    const value = yMax - ySpan * ratio;
    return { ratio, value, label: formatCentsShort(value) };
  });
  const maxYLabelLen = Math.max(...yTickMeta.map((tick) => tick.label.length), 1);
  const margin = {
    top: baseMargin.top,
    right: baseMargin.right,
    bottom: baseMargin.bottom,
    left: Math.min(152, Math.max(76, 20 + maxYLabelLen * 7)),
  };
  const innerW = Math.max(140, width - margin.left - margin.right);
  const stepX = enriched.length > 1 ? innerW / (enriched.length - 1) : 0;
  const toX = (idx: number) => margin.left + (enriched.length > 1 ? idx * stepX : innerW / 2);
  const toY = (value: number) => margin.top + innerH - ((value - yMin) / ySpan) * innerH;

  const buildAreaPath = (
    upperVals: number[],
    lowerVals: number[],
  ) => {
    if (upperVals.length === 0) return "";
    const upper = upperVals
      .map((v, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx).toFixed(2)} ${toY(v).toFixed(2)}`)
      .join(" ");
    const lower = lowerVals
      .map((_v, idx) => `L ${toX(lowerVals.length - 1 - idx).toFixed(2)} ${toY(lowerVals[lowerVals.length - 1 - idx]).toFixed(2)}`)
      .join(" ");
    return `${upper} ${lower} Z`;
  };
  const buildLinePath = (vals: number[]) =>
    vals.map((v, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx).toFixed(2)} ${toY(v).toFixed(2)}`).join(" ");

  const cashTopVals = enriched.map((p) => p.cashTop);
  const cashBottomVals = enriched.map((p) => p.cashBottom);
  const reTopVals = enriched.map((p) => p.realEstateTop);
  const reBottomVals = enriched.map((p) => p.realEstateBottom);
  const invTopVals = enriched.map((p) => p.investmentTop);
  const invBottomVals = enriched.map((p) => p.investmentBottom);
  const debtTopVals = enriched.map((p) => p.liabilityTop);
  const debtBottomVals = enriched.map((p) => p.liabilityBottom);

  const xTicks = (() => {
    const maxTicks = 8;
    if (enriched.length <= maxTicks) return enriched.map((_p, idx) => idx);
    const step = Math.max(1, Math.ceil(enriched.length / maxTicks));
    const result: number[] = [];
    for (let i = 0; i < enriched.length; i += step) result.push(i);
    if (result[result.length - 1] !== enriched.length - 1) result.push(enriched.length - 1);
    return result;
  })();
  const zeroY = toY(0);
  const activeIndex = hoverIndex == null ? null : Math.max(0, Math.min(enriched.length - 1, hoverIndex));
  const activePoint = activeIndex == null ? null : enriched[activeIndex];

  return (
    <div className="stacked-wealth-chart-wrap" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="stacked-wealth-chart"
        onMouseLeave={() => {
          setHoverIndex(null);
          setHoverPos(null);
        }}
        onMouseMove={(e) => {
          const wrapRect = wrapRef.current?.getBoundingClientRect();
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const localX = e.clientX - rect.left;
          const svgX = (localX / rect.width) * width;
          const rawIdx = stepX > 0 ? Math.round((svgX - margin.left) / stepX) : 0;
          setHoverIndex(Math.max(0, Math.min(enriched.length - 1, rawIdx)));
          if (wrapRect) {
            setHoverPos({
              x: Math.max(8, Math.min(wrapRect.width - 8, e.clientX - wrapRect.left)),
              y: Math.max(8, Math.min(wrapRect.height - 8, e.clientY - wrapRect.top)),
            });
          }
        }}
      >
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        <defs>
          <pattern
            id={debtPatternId}
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="8" fill="rgba(255,140,122,0.08)" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,140,122,0.82)" strokeWidth="2" />
          </pattern>
        </defs>

        {yTickMeta.map((tick, idx) => {
          const y = margin.top + innerH * tick.ratio;
          return (
            <g key={`y-tick-${idx}`}>
              <line x1={margin.left} x2={margin.left + innerW} y1={y} y2={y} className="stacked-axis-grid" />
              <text x={margin.left - 10} y={y + 4} textAnchor="end" className="stacked-axis-label">
                {tick.label}
              </text>
            </g>
          );
        })}

        <line x1={margin.left} x2={margin.left + innerW} y1={zeroY} y2={zeroY} className="stacked-axis-zero" />
        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + innerH} className="stacked-axis-line" />
        <line x1={margin.left} x2={margin.left + innerW} y1={margin.top + innerH} y2={margin.top + innerH} className="stacked-axis-line" />

        {visibility.cash ? <path d={buildAreaPath(cashTopVals, cashBottomVals)} fill="rgba(111,180,255,0.24)" /> : null}
        {visibility.realEstate ? <path d={buildAreaPath(reTopVals, reBottomVals)} fill="rgba(155,132,255,0.22)" /> : null}
        {visibility.investment ? <path d={buildAreaPath(invTopVals, invBottomVals)} fill="rgba(234,179,95,0.20)" /> : null}
        {visibility.liability ? <path d={buildAreaPath(debtTopVals, debtBottomVals)} fill={`url(#${debtPatternId})`} /> : null}

        {visibility.cash ? <path d={buildLinePath(cashTopVals)} fill="none" stroke="#6fb4ff" strokeWidth="1.6" /> : null}
        {visibility.realEstate ? <path d={buildLinePath(reTopVals)} fill="none" stroke="#9b84ff" strokeWidth="1.6" /> : null}
        {visibility.investment ? <path d={buildLinePath(invTopVals)} fill="none" stroke="#eab35f" strokeWidth="1.8" /> : null}
        {visibility.liability ? (
          <path d={buildLinePath(debtBottomVals)} fill="none" stroke={debtColor} strokeWidth="1.6" strokeDasharray="6 4" />
        ) : null}

        {xTicks.map((idx) => (
          <g key={`x-tick-${idx}`}>
            <line x1={toX(idx)} x2={toX(idx)} y1={margin.top + innerH} y2={margin.top + innerH + 4} className="stacked-axis-line" />
            <text x={toX(idx)} y={margin.top + innerH + 18} textAnchor="middle" className="stacked-axis-label">
              {enriched[idx].label.length >= 10 ? enriched[idx].label.slice(5) : enriched[idx].label}
            </text>
          </g>
        ))}

        {activePoint && activeIndex != null ? (
          <g pointerEvents="none">
            <line x1={toX(activeIndex)} x2={toX(activeIndex)} y1={margin.top} y2={margin.top + innerH} className="stacked-hover-line" />
            <circle cx={toX(activeIndex)} cy={toY(activePoint.investmentTop)} r="3.2" fill="#eab35f" />
            {visibility.liability ? <circle cx={toX(activeIndex)} cy={toY(activePoint.liabilityBottom)} r="3.2" fill={debtColor} /> : null}
          </g>
        ) : null}
      </svg>

      <div className="stacked-wealth-legend">
        {layers.filter((layer) => layer.visible).map((layer) => (
          <span key={layer.key} className="stacked-wealth-legend-item">
            <span className="stacked-wealth-legend-swatch" style={{ backgroundColor: layer.color }} />
            <span>{layer.label}</span>
          </span>
        ))}
        {visibility.liability ? (
          <span className="stacked-wealth-legend-item">
            <span className="stacked-wealth-legend-swatch debt" />
            <span>负债（负轴）</span>
          </span>
        ) : null}
      </div>

      {activePoint && hoverPos ? (
        <div
          className="stacked-wealth-tooltip stacked-wealth-tooltip-floating"
          style={{
            left: `${Math.min(Math.max(hoverPos.x + 12, 10), measuredWidth - 250)}px`,
            top: `${Math.max(hoverPos.y - 10, 10)}px`,
          }}
        >
          <span className="stacked-wealth-tooltip-date">{activePoint.label}</span>
          {visibility.cash ? (
            <div className="stacked-wealth-tooltip-row">
              <span className="stacked-wealth-tooltip-row-label">
                <span className="stacked-wealth-tooltip-swatch" style={{ backgroundColor: "#6fb4ff" }} />
                现金
              </span>
              <span className="stacked-wealth-tooltip-row-value">{formatCentsShort(activePoint.cash)}</span>
            </div>
          ) : null}
          {visibility.realEstate ? (
            <div className="stacked-wealth-tooltip-row">
              <span className="stacked-wealth-tooltip-row-label">
                <span className="stacked-wealth-tooltip-swatch" style={{ backgroundColor: "#9b84ff" }} />
                不动产
              </span>
              <span className="stacked-wealth-tooltip-row-value">{formatCentsShort(activePoint.realEstate)}</span>
            </div>
          ) : null}
          {visibility.investment ? (
            <div className="stacked-wealth-tooltip-row">
              <span className="stacked-wealth-tooltip-row-label">
                <span className="stacked-wealth-tooltip-swatch" style={{ backgroundColor: "#eab35f" }} />
                投资
              </span>
              <span className="stacked-wealth-tooltip-row-value">{formatCentsShort(activePoint.investment)}</span>
            </div>
          ) : null}
          <div className="stacked-wealth-tooltip-row">
            <span className="stacked-wealth-tooltip-row-label">
              <span className="stacked-wealth-tooltip-swatch neutral" />
              总资产
            </span>
            <span className="stacked-wealth-tooltip-row-value">{formatCentsShort(activePoint.investmentTop)}</span>
          </div>
          {visibility.liability ? (
            <div className="stacked-wealth-tooltip-row">
              <span className="stacked-wealth-tooltip-row-label">
                <span className="stacked-wealth-tooltip-swatch debt" />
                负债
              </span>
              <span className="stacked-wealth-tooltip-row-value">{formatCentsShort(activePoint.liability)}</span>
            </div>
          ) : null}
          <div className="stacked-wealth-tooltip-row">
            <span className="stacked-wealth-tooltip-row-label">
              <span className="stacked-wealth-tooltip-swatch net" />
              净资产
            </span>
            <span className="stacked-wealth-tooltip-row-value">
              {formatCentsShort(activePoint.investmentTop - activePoint.liability)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatCentsCompactCny(cents: number | undefined, isAmountPrivacyMasked: () => boolean, options?: { negative?: boolean }): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  const value = options?.negative ? -Math.abs(cents) : cents;
  if (isAmountPrivacyMasked()) return "****";
  const yuan = value / 100;
  const abs = Math.abs(yuan);
  if (abs >= 100000000) return `${(yuan / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${(yuan / 10000).toFixed(2)}万`;
  return `${yuan.toFixed(2)}元`;
}

function WealthSankeyDiagram({
  overviewData,
  visibility,
  isAmountPrivacyMasked,
}: {
  overviewData: unknown;
  visibility: WealthVisibility;
  isAmountPrivacyMasked: () => boolean;
}) {
  if (!isRecord(overviewData)) return null;
  const summary = readPath(overviewData, "summary");
  const rows = readArray(overviewData, "rows").filter(isRecord);
  if (!isRecord(summary)) return null;

  const sumByAssetClass = (assetClass: string): number =>
    rows.reduce((acc, row) => {
      const cls = typeof row.asset_class === "string" ? row.asset_class : "";
      const value = typeof row.value_cents === "number" ? row.value_cents : 0;
      return cls === assetClass ? acc + value : acc;
    }, 0);

  const rawCashTotal = readNumber(summary, "cash_total_cents") ?? sumByAssetClass("cash");
  const rawRealEstateTotal = readNumber(summary, "real_estate_total_cents") ?? sumByAssetClass("real_estate");
  const rawInvestmentTotal = readNumber(summary, "investment_total_cents") ?? sumByAssetClass("investment");
  const rawLiabilityTotal = Math.max(0, readNumber(summary, "liability_total_cents") ?? sumByAssetClass("liability"));
  const cashTotal = visibility.cash ? rawCashTotal : 0;
  const realEstateTotal = visibility.realEstate ? rawRealEstateTotal : 0;
  const investmentTotal = visibility.investment ? rawInvestmentTotal : 0;
  const liabilityTotal = visibility.liability ? rawLiabilityTotal : 0;
  const grossTotal = Math.max(0, cashTotal + realEstateTotal + investmentTotal);
  const netTotal = grossTotal - liabilityTotal;

  const categories = [
    { key: "cash", label: "现金", color: "#6fb4ff", total: cashTotal },
    { key: "real_estate", label: "不动产", color: "#9b84ff", total: realEstateTotal },
    { key: "investment", label: "投资", color: "#eab35f", total: investmentTotal },
  ].filter((item) => item.total > 0);
  const hasAnyPositiveSelected = visibility.investment || visibility.cash || visibility.realEstate;
  const hasChartData = !(categories.length === 0 && liabilityTotal <= 0 && grossTotal <= 0);
  const width = 980;
  const height = 390;

  const debtFlowValue = Math.min(liabilityTotal, grossTotal);
  const netFlowValue = Math.max(0, grossTotal - debtFlowValue);
  const showNetNode = grossTotal > 0;
  const showDebtNode = liabilityTotal > 0 && grossTotal > 0;

  if (!hasAnyPositiveSelected) {
    return <div className="wealth-sankey-empty">财富结构图至少需要选择一项正向资产（投资 / 现金 / 不动产）。</div>;
  }

  if (!hasChartData) {
    return <div className="wealth-sankey-empty">当前筛选条件下暂无财富结构数据。</div>;
  }

  type SankeyNodeDatum = {
    id: string;
    name: string;
    color: string;
    value_cents: number;
    role: "category" | "summary";
  };
  type SankeyLinkDatum = {
    source: string;
    target: string;
    value: number;
    color: string;
    dashed?: boolean;
  };

  const nodeData: SankeyNodeDatum[] = [
    ...categories.map((cat) => ({
      id: cat.key,
      name: cat.label,
      color: cat.color,
      value_cents: cat.total,
      role: "category" as const,
    })),
    { id: "gross", name: "总资产", color: "#7b7fff", value_cents: grossTotal, role: "summary" },
    ...(showNetNode ? [{ id: "net", name: "净资产", color: "#4bd19d", value_cents: netTotal, role: "summary" as const }] : []),
    ...(showDebtNode ? [{ id: "debt", name: "负债", color: "#ff8c7a", value_cents: liabilityTotal, role: "summary" as const }] : []),
  ];

  const linkData: SankeyLinkDatum[] = [
    ...categories.map((cat) => ({
      source: cat.label,
      target: "总资产",
      value: Math.max(1, cat.total),
      color: cat.color,
    })),
    ...(showNetNode
      ? [{
          source: "总资产",
          target: "净资产",
          value: Math.max(1, netFlowValue),
          color: "#4bd19d",
        }]
      : []),
    ...(showDebtNode
      ? [{
          source: "总资产",
          target: "负债",
          value: Math.max(1, debtFlowValue),
          color: "#ff8c7a",
          dashed: true,
        }]
      : []),
  ];

  const sankeyGraph = d3Sankey<any, any>()
    .nodeId((d: any) => d.name)
    .nodeAlign(sankeyJustify)
    .nodeWidth(16)
    .nodePadding(18)
    .nodeSort(null)
    .extent([[210, 90], [820, 335]])({
      nodes: nodeData.map((node) => ({ ...node })),
      links: linkData.map((link) => ({ ...link })),
    } as any);

  const nodeValueByName = new Map<string, number>();
  for (const node of nodeData) nodeValueByName.set(node.name, node.value_cents);

  const pathGen = sankeyLinkHorizontal<any, any>();
  const categoryCardBaseX = 34;
  const categoryCardW = 166;
  const categoryCardH = 44;

  return (
    <div className="wealth-sankey-panel">
      <div className="wealth-sankey-title-row">
        <h4>财富结构关系图</h4>
      </div>
      <div className="wealth-sankey-stage" role="img" aria-label="财富结构关系图：资产构成、总资产、净资产与负债关系">
        <svg viewBox={`0 0 ${width} ${height}`} className="wealth-sankey-svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="kwWealthSankeyBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.03)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width={width - 1} height={height - 1} rx="14" ry="14" fill="url(#kwWealthSankeyBg)" stroke="rgba(255,255,255,0.08)" />

          {(sankeyGraph.links as any[]).map((link, idx) => {
            const path = pathGen(link);
            if (!path) return null;
            return (
              <g key={`sankey-link-${idx}`}>
                <path
                  d={path}
                  fill="none"
                  stroke={String(link.color ?? "#7cc3ff")}
                  strokeOpacity={0.56}
                  strokeLinecap="butt"
                  strokeWidth={Math.max(2, Number(link.width ?? 2))}
                  strokeDasharray={link.dashed ? "8 5" : undefined}
                >
                  <title>
                    {`${String(link.source?.name ?? "-")} → ${String(link.target?.name ?? "-")} | ${formatCentsCompactCny(
                      Number(link.value ?? 0),
                      isAmountPrivacyMasked,
                      { negative: String(link.target?.name ?? "") === "负债" },
                    )}`}
                  </title>
                </path>
              </g>
            );
          })}

          {(sankeyGraph.nodes as any[]).map((node, idx) => (
            <g key={`sankey-node-${String(node.name ?? idx)}`}>
              <rect
                x={Number(node.x0)}
                y={Number(node.y0)}
                width={Math.max(8, Number(node.x1) - Number(node.x0))}
                height={Math.max(8, Number(node.y1) - Number(node.y0))}
                rx="0"
                ry="0"
                fill={String(node.color ?? "#7cc3ff")}
                opacity="0.92"
                stroke="rgba(255,255,255,0.08)"
              >
                <title>{`${String(node.name)} | ${formatCentsCompactCny(nodeValueByName.get(String(node.name)) ?? 0, isAmountPrivacyMasked, { negative: String(node.name) === "负债" })}`}</title>
              </rect>
            </g>
          ))}

          {(sankeyGraph.nodes as any[]).map((node, idx) => {
            const name = String(node.name ?? idx);
            const isCategory = String(node.role ?? "") === "category";
            if (!isCategory) return null;
            const total = nodeValueByName.get(name) ?? 0;
            const ratio = grossTotal > 0 ? (total / grossTotal) * 100 : 0;
            const cardY = (Number(node.y0) + Number(node.y1)) / 2 - categoryCardH / 2;
            const cardColor = String(node.color ?? "#7cc3ff");
            return (
              <g key={`cat-card-${name}`}>
                <rect x={categoryCardBaseX} y={cardY} width={categoryCardW} height={categoryCardH} rx="10" ry="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
                <rect x={categoryCardBaseX} y={cardY} width="7" height={categoryCardH} fill={cardColor} />
                <text x={categoryCardBaseX + 14} y={cardY + 17} fontSize="11.5" fill="#f3efe5">{name}</text>
                <text x={categoryCardBaseX + 14} y={cardY + 33} fontSize="10.5" fill="rgba(243,239,229,0.72)">
                  {formatCentsCompactCny(total, isAmountPrivacyMasked)} · {ratio.toFixed(1)}%
                </text>
              </g>
            );
          })}

          {(sankeyGraph.nodes as any[]).map((node, idx) => {
            const name = String(node.name ?? idx);
            if (String(node.role ?? "") !== "summary") return null;
            const x = Number(node.x1) + 12;
            const amount = nodeValueByName.get(name) ?? 0;
            const color = String(node.color ?? "#f3efe5");
            if (name === "总资产") {
              const cx = (Number(node.x0) + Number(node.x1)) / 2;
              const cy = (Number(node.y0) + Number(node.y1)) / 2;
              const cardW = 112;
              const cardH = 40;
              const cardX = cx - cardW / 2;
              const cardY = cy - cardH / 2;
              return (
                <g key={`summary-label-${name}`}>
                  <rect x={cardX} y={cardY} width={cardW} height={cardH} rx="10" ry="10" fill="rgba(9, 14, 20, 0.58)" stroke="rgba(255,255,255,0.08)" />
                  <rect x={cardX + cardW - 6} y={cardY} width="6" height={cardH} fill={color} />
                  <text x={cx} y={cy - 3} fontSize="11.5" fill="rgba(243,239,229,0.78)" textAnchor="middle">{name}</text>
                  <text x={cx} y={cy + 14} fontSize="12.5" fontWeight="700" fill={color} textAnchor="middle">
                    {formatCentsCompactCny(amount, isAmountPrivacyMasked)}
                  </text>
                </g>
              );
            }
            const labelCardW = 126;
            const labelCardH = 40;
            const labelCardY = Math.max(92, Number(node.y0) + (Number(node.y1) - Number(node.y0)) / 2 - labelCardH / 2);
            return (
              <g key={`summary-label-${name}`}>
                <rect x={x} y={labelCardY} width={labelCardW} height={labelCardH} rx="10" ry="10" fill="rgba(255,255,255,0.035)" stroke="rgba(255,255,255,0.08)" />
                <rect x={x + labelCardW - 6} y={labelCardY} width="6" height={labelCardH} fill={color} />
                <text x={x + 10} y={labelCardY + 15} fontSize="12" fill="rgba(243,239,229,0.72)">{name}</text>
                <text x={x + 10} y={labelCardY + 31} fontSize="13" fontWeight="700" fill={color}>
                  {formatCentsCompactCny(amount, isAmountPrivacyMasked, { negative: name === "负债" })}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function WealthOverviewPreview({
  data,
  visibility,
  PreviewStat,
  formatCentsShort,
  isAmountPrivacyMasked,
}: {
  data: unknown;
  visibility: WealthVisibility;
  PreviewStat: ComponentType<PreviewStatProps>;
  formatCentsShort: (cents?: number) => string;
  isAmountPrivacyMasked: () => boolean;
}) {
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const wealthTotal = readNumber(data, "summary.wealth_total_cents");
  const netAssetTotal = readNumber(data, "summary.net_asset_total_cents");
  const liabilityTotal = readNumber(data, "summary.liability_total_cents");
  const asOf = readString(data, "as_of") ?? "-";
  const requestedAsOf = readString(data, "requested_as_of") ?? "-";

  return (
    <div className="wealth-section-block">
      <div className="preview-header">
        <h3>财富总览结果</h3>
        <div className="preview-subtle">
          统计日期 <code>{asOf}</code>
          {requestedAsOf !== "-" && requestedAsOf !== asOf ? (
            <> · 请求日期 <code>{requestedAsOf}</code></>
          ) : null}
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="财富总额（元）" value={formatCentsShort(wealthTotal)} />
        <PreviewStat label="净资产（元）" value={formatCentsShort(netAssetTotal)} />
        <PreviewStat label="负债（元）" value={formatCentsShort(liabilityTotal)} />
      </div>
      <WealthSankeyDiagram overviewData={data} visibility={visibility} isAmountPrivacyMasked={isAmountPrivacyMasked} />
      {rows.length === 0 ? <p className="preview-note">当前筛选条件下暂无可展示的财富条目。</p> : null}
    </div>
  );
}

export function WealthCurvePreview({
  data,
  visibility,
  PreviewStat,
  formatCentsShort,
  formatPct,
  signedMetricTone,
  formatSignedDeltaCentsShort,
  formatMonthDayLabel,
  computeMonthlyTotalAssetGrowthFromWealthCurve,
}: {
  data: unknown;
  visibility: WealthVisibility;
  PreviewStat: ComponentType<PreviewStatProps>;
  formatCentsShort: (cents?: number) => string;
  formatPct: (value?: number) => string;
  signedMetricTone: (value?: number) => "default" | "good" | "warn";
  formatSignedDeltaCentsShort: (cents?: number) => string;
  formatMonthDayLabel: (dateIso?: string) => string;
  computeMonthlyTotalAssetGrowthFromWealthCurve: (data: unknown) =>
    | { deltaCents: number; baselineDate: string; latestDate: string }
    | undefined;
}) {
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  if (rows.length === 0) return null;
  const from = readString(data, "range.effective_from") ?? "-";
  const to = readString(data, "range.effective_to") ?? "-";
  const changePct = readNumber(data, "summary.change_pct");
  const endWealth = readNumber(data, "summary.end_wealth_cents");
  const endNetAsset = readNumber(data, "summary.end_net_asset_cents");
  const stackedRows = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      if (!label) return null;
      const cash = typeof r.cash_total_cents === "number" ? r.cash_total_cents : 0;
      const realEstate = typeof r.real_estate_total_cents === "number" ? r.real_estate_total_cents : 0;
      const investment = typeof r.investment_total_cents === "number" ? r.investment_total_cents : 0;
      const liability = typeof r.liability_total_cents === "number" ? r.liability_total_cents : 0;
      return { label, cash, realEstate, investment, liability };
    })
    .filter(
      (v): v is { label: string; cash: number; realEstate: number; investment: number; liability: number } => v !== null,
    );
  const monthlyTotalAssetGrowth = computeMonthlyTotalAssetGrowthFromWealthCurve(data);
  const monthlyTotalAssetGrowthLabel = monthlyTotalAssetGrowth?.baselineDate
    ? `相比${formatMonthDayLabel(monthlyTotalAssetGrowth.baselineDate)}`
    : "月度总资产增长（元）";

  return (
    <div className="wealth-section-block">
      <div className="preview-header">
        <h3>财富变化趋势</h3>
        <div className="preview-subtle">
          统计区间 <code>{from}</code> ~ <code>{to}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="期末财富总额（元）" value={formatCentsShort(endWealth)} />
        <PreviewStat label="期末净资产（元）" value={formatCentsShort(endNetAsset)} />
        <PreviewStat label="区间变化率" value={formatPct(changePct)} tone={signedMetricTone(changePct)} />
        <PreviewStat
          label={monthlyTotalAssetGrowthLabel}
          value={formatSignedDeltaCentsShort(monthlyTotalAssetGrowth?.deltaCents)}
          tone={signedMetricTone(monthlyTotalAssetGrowth?.deltaCents)}
        />
      </div>
      <div className="preview-chart-stack">
        <div className="wealth-trend-chart-block full-width-chart-panel">
          <div className="sparkline-title">财产趋势（堆叠）</div>
          <WealthStackedTrendChart
            rows={stackedRows}
            visibility={visibility}
            formatCentsShort={formatCentsShort}
            height={318}
          />
        </div>
      </div>
    </div>
  );
}
