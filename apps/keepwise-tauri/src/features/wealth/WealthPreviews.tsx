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

type WealthAccountListView = "investable" | "all";
type LooseUiEvent = {
  target: EventTarget & { value?: string; checked?: boolean };
  currentTarget: { getBoundingClientRect: () => DOMRect; select?: () => void };
  clientX?: number;
  clientY?: number;
  stopPropagation: () => void;
};

const WEALTH_ACCOUNT_TYPE_META: Record<string, { label: string; order: number }> = {
  investment: { label: "投资", order: 1 },
  cash: { label: "现金", order: 2 },
  real_estate: { label: "不动产", order: 3 },
  liability: { label: "负债", order: 4 },
};

function formatAccountShare(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 10) return `${value.toFixed(1)}%`;
  if (abs >= 1) return `${value.toFixed(2)}%`;
  if (abs > 0) return `${value.toFixed(3)}%`;
  return "0.00%";
}

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
      setMeasuredWidth((prev: number) => (prev === next ? prev : next));
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
  const effectiveHeight = width > 560 ? height : Math.max(180, Math.round(height * 0.7));
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

  const compactYAxisLabel = (valueCents: number) => {
    const raw = formatCentsShort(valueCents);
    if (/\*/.test(raw)) return raw;
    const abs = Math.abs(valueCents);
    if (abs < 1_000_000) return raw;
    const wan = valueCents / 1_000_000;
    const absWan = Math.abs(wan);
    const digits = absWan >= 1000 ? 0 : absWan >= 100 ? 1 : 2;
    return `${wan.toFixed(digits)}万`;
  };

  const baseMargin = { top: 14, right: 12, bottom: 42 };
  const yTickCount = 4;
  const innerH = effectiveHeight - baseMargin.top - baseMargin.bottom;
  const yTickMeta = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const ratio = i / yTickCount;
    const value = yMax - ySpan * ratio;
    return { ratio, value, label: compactYAxisLabel(value) };
  });
  const margin = {
    top: baseMargin.top,
    right: baseMargin.right,
    bottom: baseMargin.bottom,
    left: 10,
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
  const grossTrendVals = enriched.map((p) => p.investmentTop);
  const grossTrendMin = Math.min(...grossTrendVals);
  const grossTrendMax = Math.max(...grossTrendVals);
  const grossTrendSpan = grossTrendMax - grossTrendMin;
  const grossTrendPad = Math.max(grossTrendSpan * 0.12, Math.abs(grossTrendMax) * 0.002, 1);
  const grossTrendYMin = grossTrendMin - grossTrendPad;
  const grossTrendYMax = grossTrendMax + grossTrendPad;
  const grossTrendYSpan = grossTrendYMax - grossTrendYMin || 1;
  const toFocusedTrendY = (value: number) =>
    margin.top + innerH - ((value - grossTrendYMin) / grossTrendYSpan) * innerH;
  const buildFocusedTrendPath = (vals: number[]) =>
    vals.map((v, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx).toFixed(2)} ${toFocusedTrendY(v).toFixed(2)}`).join(" ");
  const showGrossTrendLine = grossTrendVals.length > 1 && grossTrendSpan > 0 && (visibility.cash || visibility.realEstate || visibility.investment);
  const focusedTrendTickMeta = [grossTrendMax, (grossTrendMin + grossTrendMax) / 2, grossTrendMin];
  const formatSignedCentsShort = (valueCents: number) => {
    if (valueCents === 0) return "0";
    const text = formatCentsShort(Math.abs(valueCents));
    if (text === "****") return text;
    return valueCents > 0 ? `+${text}` : `-${text}`;
  };

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
  const activeGrossDelta = activePoint ? activePoint.investmentTop - enriched[0].investmentTop : 0;
  const focusedAxisX = margin.left + innerW;

  return (
    <div className="stacked-wealth-chart-wrap" ref={wrapRef}>
      <svg
        viewBox={`0 0 ${width} ${effectiveHeight}`}
        className="stacked-wealth-chart"
        onMouseLeave={() => {
          setHoverIndex(null);
          setHoverPos(null);
        }}
        onMouseMove={(e: LooseUiEvent) => {
          const wrapRect = wrapRef.current?.getBoundingClientRect();
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const clientX = e.clientX ?? 0;
          const clientY = e.clientY ?? 0;
          const localX = clientX - rect.left;
          const svgX = (localX / rect.width) * width;
          const rawIdx = stepX > 0 ? Math.round((svgX - margin.left) / stepX) : 0;
          setHoverIndex(Math.max(0, Math.min(enriched.length - 1, rawIdx)));
          if (wrapRect) {
            setHoverPos({
              x: Math.max(8, Math.min(wrapRect.width - 8, clientX - wrapRect.left)),
              y: Math.max(8, Math.min(wrapRect.height - 8, clientY - wrapRect.top)),
            });
          }
        }}
      >
        <rect x={0} y={0} width={width} height={effectiveHeight} fill="transparent" />
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
              <text x={margin.left + 6} y={y + 4} textAnchor="start" className="stacked-axis-label">
                {tick.label}
              </text>
            </g>
          );
        })}

        <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + innerH} className="stacked-axis-line" />
        <line x1={margin.left} x2={margin.left + innerW} y1={margin.top + innerH} y2={margin.top + innerH} className="stacked-axis-line" />
        {showGrossTrendLine ? (
          <g pointerEvents="none">
            <line
              x1={focusedAxisX}
              x2={focusedAxisX}
              y1={margin.top}
              y2={margin.top + innerH}
              className="stacked-focus-axis-line"
            />
            <text x={focusedAxisX - 7} y={margin.top - 3} textAnchor="end" className="stacked-focus-axis-title">
              总资产趋势
            </text>
            {focusedTrendTickMeta.map((value, idx) => {
              const y = toFocusedTrendY(value);
              return (
                <g key={`focus-y-tick-${idx}`}>
                  <line x1={focusedAxisX - 4} x2={focusedAxisX} y1={y} y2={y} className="stacked-focus-axis-line" />
                  <text x={focusedAxisX - 7} y={y + 4} textAnchor="end" className="stacked-focus-axis-label">
                    {compactYAxisLabel(value)}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}

        {visibility.cash ? <path d={buildAreaPath(cashTopVals, cashBottomVals)} fill="rgba(111,180,255,0.24)" /> : null}
        {visibility.realEstate ? <path d={buildAreaPath(reTopVals, reBottomVals)} fill="rgba(155,132,255,0.22)" /> : null}
        {visibility.investment ? <path d={buildAreaPath(invTopVals, invBottomVals)} fill="rgba(234,179,95,0.20)" /> : null}
        {visibility.liability ? <path d={buildAreaPath(debtTopVals, debtBottomVals)} fill={`url(#${debtPatternId})`} /> : null}

        <line x1={margin.left} x2={margin.left + innerW} y1={zeroY} y2={zeroY} className="stacked-axis-zero" />
        {visibility.cash ? <path d={buildLinePath(cashTopVals)} fill="none" stroke="#6fb4ff" strokeWidth="1.2" /> : null}
        {visibility.realEstate ? <path d={buildLinePath(reTopVals)} fill="none" stroke="#9b84ff" strokeWidth="1.2" /> : null}
        {visibility.investment ? <path d={buildLinePath(invTopVals)} fill="none" stroke="#eab35f" strokeWidth="1.2" /> : null}
        {visibility.liability ? (
          <path d={buildLinePath(debtBottomVals)} fill="none" stroke={debtColor} strokeWidth="1.2" strokeDasharray="6 4" />
        ) : null}
        {showGrossTrendLine ? (
          <>
            <path d={buildFocusedTrendPath(grossTrendVals)} fill="none" className="stacked-total-trend-halo" />
            <path d={buildFocusedTrendPath(grossTrendVals)} fill="none" className="stacked-total-trend-line" />
          </>
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
        {showGrossTrendLine ? (
          <span className="stacked-wealth-legend-item">
            <span className="stacked-wealth-legend-swatch total-trend" />
            <span>总资产趋势</span>
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
          {showGrossTrendLine ? (
            <div className="stacked-wealth-tooltip-row">
              <span className="stacked-wealth-tooltip-row-label">
                <span className="stacked-wealth-tooltip-swatch total-trend" />
                总资产变化
              </span>
              <span className="stacked-wealth-tooltip-row-value">{formatSignedCentsShort(activeGrossDelta)}</span>
            </div>
          ) : null}
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
  isMobileMode = false,
}: {
  overviewData: unknown;
  visibility: WealthVisibility;
  isAmountPrivacyMasked: () => boolean;
  isMobileMode?: boolean;
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
  const height = isMobileMode ? 720 : 420;

  const debtFlowValue = Math.min(liabilityTotal, grossTotal);
  const netFlowValue = Math.max(0, grossTotal - debtFlowValue);
  const showNetNode = grossTotal > 0;
  const showDebtNode = liabilityTotal > 0 && grossTotal > 0;

  if (!hasAnyPositiveSelected) {
    return <div className="wealth-sankey-empty">资产构成图至少需要选择一项正向资产（投资 / 现金 / 不动产）。</div>;
  }

  if (!hasChartData) {
    return <div className="wealth-sankey-empty">当前筛选条件下暂无资产构成数据。</div>;
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

  const sankeyExtent = isMobileMode
    ? [[254, 150], [764, 520]]
    : [[162, 100], [836, 350]];
  const nodeWidth = isMobileMode ? 16 : 14;
  const nodePadding = isMobileMode ? 26 : 20;
  const categoryCardBaseX = isMobileMode ? 28 : 28;
  const categoryCardW = isMobileMode ? 170 : 110;
  const categoryCardH = isMobileMode ? 82 : 48;
  const summaryCenterCardW = isMobileMode ? 139 : 82;
  const summaryCenterCardH = isMobileMode ? 84 : 48;
  const summarySideCardW = isMobileMode ? 149 : 91;
  const summarySideCardH = isMobileMode ? 80 : 46;
  const summaryLabelOffsetX = isMobileMode ? 18 : 12;
  const summaryLabelMinY = isMobileMode ? 126 : 96;
  const categoryAccentW = isMobileMode ? 10 : 8;
  const summaryAccentW = isMobileMode ? 10 : 7;
  const categoryNameFontSize = isMobileMode ? 18 : 12.5;
  const categoryRatioFontSize = isMobileMode ? 14 : 10;
  const categoryValueFontSize = isMobileMode ? 15.5 : 11;
  const summaryCenterTitleFontSize = isMobileMode ? 17 : 11;
  const summaryCenterValueFontSize = isMobileMode ? 18 : 12;
  const summarySideTitleFontSize = isMobileMode ? 16.5 : 11;
  const summarySideValueFontSize = isMobileMode ? 17.5 : 11.5;

  const sankeyGraph = d3Sankey<any, any>()
    .nodeId((d: { name: string }) => d.name)
    .nodeAlign(sankeyJustify)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .nodeSort(null)
    .extent(sankeyExtent as [[number, number], [number, number]])({
      nodes: nodeData.map((node) => ({ ...node })),
      links: linkData.map((link) => ({ ...link })),
    } as any);

  const nodeValueByName = new Map<string, number>();
  for (const node of nodeData) nodeValueByName.set(node.name, node.value_cents);

  const pathGen = sankeyLinkHorizontal<any, any>();

  return (
    <div className="wealth-sankey-panel">
      <div className="wealth-sankey-stage" role="img" aria-label="资产构成关系图：资产构成、总资产、净资产与负债关系">
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
                <rect x={categoryCardBaseX} y={cardY} width={categoryCardW} height={categoryCardH} rx="12" ry="12" fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.08)" />
                <rect x={categoryCardBaseX} y={cardY} width={categoryAccentW} height={categoryCardH} fill={cardColor} />
                <text x={categoryCardBaseX + 18} y={cardY + categoryCardH * 0.38} fontSize={categoryNameFontSize} fontWeight="600" fill="#f3efe5">{name}</text>
                <text
                  x={categoryCardBaseX + categoryCardW - 16}
                  y={cardY + categoryCardH * 0.38}
                  fontSize={categoryRatioFontSize}
                  fontWeight="600"
                  fill="rgba(243,239,229,0.7)"
                  textAnchor="end"
                >
                  {ratio.toFixed(1)}%
                </text>
                <text x={categoryCardBaseX + 18} y={cardY + categoryCardH * 0.74} fontSize={categoryValueFontSize} fill="rgba(243,239,229,0.76)">
                  {formatCentsCompactCny(total, isAmountPrivacyMasked)}
                </text>
              </g>
            );
          })}

          {(sankeyGraph.nodes as any[]).map((node, idx) => {
            const name = String(node.name ?? idx);
            if (String(node.role ?? "") !== "summary") return null;
            const x = Number(node.x1) + summaryLabelOffsetX;
            const amount = nodeValueByName.get(name) ?? 0;
            const color = String(node.color ?? "#f3efe5");
            if (name === "总资产") {
              const cx = (Number(node.x0) + Number(node.x1)) / 2;
              const cy = (Number(node.y0) + Number(node.y1)) / 2;
              const cardW = summaryCenterCardW;
              const cardH = summaryCenterCardH;
              const cardX = cx - cardW / 2;
              const cardY = cy - cardH / 2;
              return (
                <g key={`summary-label-${name}`}>
                  <rect x={cardX} y={cardY} width={cardW} height={cardH} rx="12" ry="12" fill="rgba(9, 14, 20, 0.62)" stroke="rgba(255,255,255,0.08)" />
                  <rect x={cardX + cardW - summaryAccentW} y={cardY} width={summaryAccentW} height={cardH} fill={color} />
                  <text x={cx} y={cy - cardH * 0.14} fontSize={summaryCenterTitleFontSize} fill="rgba(243,239,229,0.8)" textAnchor="middle">{name}</text>
                  <text x={cx} y={cy + cardH * 0.28} fontSize={summaryCenterValueFontSize} fontWeight="700" fill={color} textAnchor="middle">
                    {formatCentsCompactCny(amount, isAmountPrivacyMasked)}
                  </text>
                </g>
              );
            }
            const labelCardW = summarySideCardW;
            const labelCardH = summarySideCardH;
            const labelCardY = Math.max(summaryLabelMinY, Number(node.y0) + (Number(node.y1) - Number(node.y0)) / 2 - labelCardH / 2);
            return (
              <g key={`summary-label-${name}`}>
                <rect x={x} y={labelCardY} width={labelCardW} height={labelCardH} rx="12" ry="12" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
                <rect x={x + labelCardW - summaryAccentW} y={labelCardY} width={summaryAccentW} height={labelCardH} fill={color} />
                <text x={x + 16} y={labelCardY + labelCardH * 0.4} fontSize={summarySideTitleFontSize} fill="rgba(243,239,229,0.76)">{name}</text>
                <text x={x + 16} y={labelCardY + labelCardH * 0.77} fontSize={summarySideValueFontSize} fontWeight="700" fill={color}>
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
  isMobileMode = false,
}: {
  data: unknown;
  visibility: WealthVisibility;
  PreviewStat: ComponentType<PreviewStatProps>;
  formatCentsShort: (cents?: number) => string;
  isAmountPrivacyMasked: () => boolean;
  isMobileMode?: boolean;
}) {
  const [accountListView, setAccountListView] = useState<WealthAccountListView>("investable");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const wealthTotal = readNumber(data, "summary.wealth_total_cents");
  const netAssetTotal = readNumber(data, "summary.net_asset_total_cents");
  const liabilityTotal = readNumber(data, "summary.liability_total_cents");
  const asOf = readString(data, "as_of") ?? "-";
  const requestedAsOf = readString(data, "requested_as_of") ?? "-";
  const accountRows = rows
    .map((row) => {
      const assetClass = readString(row, "asset_class") ?? "";
      const accountName = readString(row, "account_name") ?? readString(row, "account_id") ?? "-";
      const accountId = readString(row, "account_id") ?? "";
      const snapshotDate = readString(row, "snapshot_date") ?? "-";
      const rawValue = readNumber(row, "value_cents") ?? 0;
      const meta = WEALTH_ACCOUNT_TYPE_META[assetClass] ?? { label: assetClass || "其他", order: 99 };
      const signedValue = assetClass === "liability" ? -Math.abs(rawValue) : rawValue;
      return {
        assetClass,
        accountName,
        accountId,
        snapshotDate,
        rawValue,
        signedValue,
        typeLabel: meta.label,
        typeOrder: meta.order,
      };
    })
    .filter((row) => row.rawValue !== 0)
    .sort((a, b) => {
      if (a.typeOrder !== b.typeOrder) return a.typeOrder - b.typeOrder;
      const valueDiff = Math.abs(b.rawValue) - Math.abs(a.rawValue);
      if (valueDiff !== 0) return valueDiff;
      return a.accountName.localeCompare(b.accountName, "zh-Hans-CN");
    });
  const displayedAccountRows = accountRows.filter((row) =>
    accountListView === "investable" ? row.assetClass === "investment" || row.assetClass === "cash" : true,
  );
  const accountShareDenominator = displayedAccountRows.reduce((acc, row) => acc + Math.abs(row.signedValue), 0);

  return (
    <div className="wealth-section-block">
      <div className="preview-header">
        <h3>资产构成</h3>
        <div className="preview-subtle">
          统计日期 <code>{asOf}</code>
          {requestedAsOf !== "-" && requestedAsOf !== asOf ? (
            <> · 请求日期 <code>{requestedAsOf}</code></>
          ) : null}
        </div>
      </div>
      <div className="preview-stat-grid wealth-overview-stat-grid">
        <PreviewStat label="财富总额（元）" value={formatCentsShort(wealthTotal)} />
        <PreviewStat label="净资产（元）" value={formatCentsShort(netAssetTotal)} />
        <PreviewStat label="负债（元）" value={formatCentsShort(liabilityTotal)} />
      </div>
      <WealthSankeyDiagram overviewData={data} visibility={visibility} isAmountPrivacyMasked={isAmountPrivacyMasked} isMobileMode={isMobileMode} />
      {accountRows.length > 0 ? (
        <div className="subcard preview-card">
          <div className="preview-header">
            <div>
              <h3>账户明细</h3>
              <div className="preview-subtle">按账户类型排序 · 占比按当前视图计算</div>
            </div>
            <div className="wealth-asset-chip-group" role="group" aria-label="账户明细视图">
              <button
                type="button"
                className={`consumption-chip ${accountListView === "investable" ? "active" : ""}`}
                onClick={() => setAccountListView("investable")}
              >
                可投资产
              </button>
              <button
                type="button"
                className={`consumption-chip ${accountListView === "all" ? "active" : ""}`}
                onClick={() => setAccountListView("all")}
              >
                所有资产
              </button>
            </div>
          </div>
          {displayedAccountRows.length > 0 ? (
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>账户</th>
                    <th>类型</th>
                    <th className="num">实际金额</th>
                    <th className="num">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedAccountRows.map((row) => {
                    const share = accountShareDenominator > 0 ? (Math.abs(row.signedValue) / accountShareDenominator) * 100 : 0;
                    return (
                      <tr key={`${row.assetClass}:${row.accountId}:${row.snapshotDate}`}>
                        <td className="truncate-cell" title={row.accountName}>{row.accountName}</td>
                        <td>{row.typeLabel}</td>
                        <td className="num">{formatCentsShort(row.signedValue)}</td>
                        <td className="num">{formatAccountShare(share)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="preview-note">当前视图下暂无有金额账户。</p>
          )}
        </div>
      ) : null}
      {accountRows.length === 0 ? <p className="preview-note">当前筛选条件下暂无有金额账户。</p> : null}
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
        <h3>资产趋势</h3>
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
