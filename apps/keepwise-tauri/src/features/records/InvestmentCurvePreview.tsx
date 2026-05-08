import { useEffect, useState, type ComponentType } from "react";
import { isRecord, readArray, readBool, readNumber, readString } from "../../utils/value";

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

type LineAreaChartProps = {
  points: Array<{ label: string; value: number }>;
  series?: Array<{
    id: string;
    label: string;
    points: Array<{ label: string; value: number }>;
    color?: string;
    dashed?: boolean;
  }>;
  color?: string;
  xLabelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (point: { label: string; value: number }) => string;
  multiTooltipFormatter?: (item: { label: string; seriesLabel: string; value: number }) => string;
  height?: number;
  preferZeroBaseline?: boolean;
  maxXTicks?: number;
  smooth?: boolean;
  sourceLabel?: string;
  showZeroLine?: boolean;
};

export function InvestmentCurvePreview({
  data,
  returnData,
  onRetryBenchmarks,
  benchmarkRetryBusy = false,
  formatCentsShort,
  formatRatePct,
  signedMetricTone,
  PreviewStat,
  LineAreaChart,
}: {
  data: unknown;
  returnData?: unknown;
  onRetryBenchmarks?: () => void;
  benchmarkRetryBusy?: boolean;
  formatCentsShort: (cents?: number) => string;
  formatRatePct: (rate?: number) => string;
  signedMetricTone: (value?: number) => "default" | "good" | "warn";
  PreviewStat: ComponentType<PreviewStatProps>;
  LineAreaChart: ComponentType<LineAreaChartProps>;
}) {
  const [selectedCurveKind, setSelectedCurveKind] = useState<"return_rate" | "net_growth" | "total_assets">("return_rate");
  const [visibleBenchmarkIds, setVisibleBenchmarkIds] = useState<string[]>([]);
  const payload = isRecord(data) ? data : null;
  const benchmarkCurves = payload ? readArray(payload, "benchmarks.curves").filter(isRecord) : [];
  const benchmarkIdsKey = benchmarkCurves
    .map((curve) => (typeof curve.key === "string" ? curve.key : ""))
    .filter((key) => key)
    .join("|");
  useEffect(() => {
    const availableIds = benchmarkCurves
      .map((curve) => (typeof curve.key === "string" ? curve.key : ""))
      .filter((key) => key);
    setVisibleBenchmarkIds((prev) => {
      if (availableIds.length === 0) return [];
      if (prev.length === 0) {
        return availableIds.includes("sse") ? ["sse"] : [availableIds[0]];
      }
      const filtered = prev.filter((id) => availableIds.includes(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [benchmarkIdsKey]);
  if (!payload) return null;
  const rows = readArray(payload, "rows").filter(isRecord);
  if (rows.length === 0) return null;
  const returnPayload = isRecord(returnData) ? returnData : null;
  const from = readString(payload, "range.effective_from") ?? "-";
  const to = readString(payload, "range.effective_to") ?? "-";
  const beginAssets = readNumber(payload, "summary.start_assets_cents");
  const endAssets = readNumber(payload, "summary.end_assets_cents");
  const endNetGrowth = readNumber(payload, "summary.end_net_growth_cents");
  const annualizedRate = readNumber(returnPayload, "metrics.annualized_rate");
  const intervalReturnRate = readNumber(returnPayload, "metrics.return_rate");
  const returnNote = readString(returnPayload, "metrics.note") ?? "";
  const accountName = readString(payload, "account_name") ?? "我的收益";
  const benchmarkWarnings = readArray(payload, "benchmarks.warnings")
    .map((item) => (typeof item === "string" ? item : ""))
    .filter((item) => item);
  const benchmarkSource = readString(payload, "benchmarks.source") ?? "";
  const benchmarkAvailableCount = readNumber(payload, "benchmarks.summary.available_count") ?? 0;
  const benchmarkLoadFailed = readBool(payload, "benchmarks.load_failed") === true;
  const hasBenchmarkWarning = benchmarkWarnings.length > 0;
  const benchmarkFailureNote = hasBenchmarkWarning ? "拉取对比指标失败" : "";
  const benchmarkSourceLabel =
    selectedCurveKind === "return_rate" && benchmarkSource && benchmarkAvailableCount > 0
      ? `来源：${benchmarkSource}`
      : undefined;
  const intervalReturnToneClass = signedMetricTone(intervalReturnRate);
  const assetPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.total_assets_cents === "number" ? r.total_assets_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const netGrowthPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.cumulative_net_growth_cents === "number" ? r.cumulative_net_growth_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const returnPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.cumulative_return_rate === "number" ? r.cumulative_return_rate : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const maxDrawdownRatio = (() => {
    let peak = Number.NEGATIVE_INFINITY;
    let worstDrawdown = 0;
    for (const point of assetPoints) {
      if (point.value > peak) peak = point.value;
      if (peak <= 0) continue;
      const drawdown = (point.value - peak) / peak;
      if (drawdown < worstDrawdown) worstDrawdown = drawdown;
    }
    return Math.abs(worstDrawdown);
  })();
  const maxDrawdownText = `${(maxDrawdownRatio * 100).toFixed(2)}%`;
  const maxDrawdownTone: "default" | "good" | "warn" =
    maxDrawdownRatio >= 0.2 ? "warn" : maxDrawdownRatio <= 0.05 ? "good" : "default";
  const benchmarkColorMap: Record<string, string> = {
    sse: "#7cc3ff",
    hsi: "#73d7b6",
    sp500: "#f08aa1",
  };
  const returnComparisonSeries = [
    {
      id: "account",
      label: accountName,
      points: returnPoints,
      color: "#dcb06a",
      dashed: false,
    },
    ...benchmarkCurves
      .map((curve) => {
        const key = typeof curve.key === "string" ? curve.key : "";
        const label = typeof curve.label === "string" && curve.label ? curve.label : key || "基准";
        const points = readArray(curve, "rows")
          .filter(isRecord)
          .map((row) => {
            const pointLabel = typeof row.snapshot_date === "string" ? row.snapshot_date : "";
            const value = typeof row.cumulative_return_rate === "number" ? row.cumulative_return_rate : NaN;
            return pointLabel && Number.isFinite(value) ? { label: pointLabel, value } : null;
          })
          .filter((item): item is { label: string; value: number } => item !== null);
        if (points.length === 0) return null;
        return {
          id: key || label,
          label,
          points,
          color: benchmarkColorMap[key] ?? "#9fb6ff",
          dashed: false,
        };
      })
      .filter(
        (
          item,
        ): item is { id: string; label: string; points: Array<{ label: string; value: number }>; color: string; dashed: boolean } =>
          item !== null,
        ),
  ];
  const visibleReturnComparisonSeries = returnComparisonSeries.filter(
    (series) => series.id === "account" || visibleBenchmarkIds.includes(series.id),
  );
  const toggleBenchmarkVisibility = (seriesId: string) => {
    setVisibleBenchmarkIds((prev) =>
      prev.includes(seriesId) ? prev.filter((id) => id !== seriesId) : [...prev, seriesId],
    );
  };
  const activeCurve =
    selectedCurveKind === "total_assets"
      ? {
          title: "总资产曲线",
          points: assetPoints,
          color: "#7cc3ff",
          valueFormatter: (v: number) => formatCentsShort(v),
          tooltipFormatter: (p: { label: string; value: number }) => `${p.label} · ${formatCentsShort(p.value)} 元`,
        }
      : selectedCurveKind === "net_growth"
        ? {
            title: "累计净增长曲线",
            points: netGrowthPoints,
            color: "#73d7b6",
            valueFormatter: (v: number) => formatCentsShort(v),
            tooltipFormatter: (p: { label: string; value: number }) => `${p.label} · ${formatCentsShort(p.value)} 元`,
          }
          : {
              title: "累计收益率曲线",
              points: returnPoints,
              series: visibleReturnComparisonSeries,
              color: "#dcb06a",
              valueFormatter: (v: number) => `${(v * 100).toFixed(1)}%`,
              tooltipFormatter: (p: { label: string; value: number }) => `${p.label} · ${(p.value * 100).toFixed(2)}%`,
             multiTooltipFormatter: ({ value }: { label: string; seriesLabel: string; value: number }) =>
               `${(value * 100).toFixed(2)}%`,
           };

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>投资收益表现</h3>
        <div className="preview-subtle">趋势与区间收益指标</div>
      </div>
      <div className="preview-subtle">
        统计区间：<code>{from}</code> ~ <code>{to}</code>
      </div>
      <div className="return-analysis-stat-layout">
        <div className={`preview-stat return-analysis-focus tone-${intervalReturnToneClass}`}>
          <div className="preview-stat-label">区间收益率</div>
          <div className="return-analysis-focus-value">{formatRatePct(intervalReturnRate)}</div>
          <div className="return-analysis-focus-subtle">
            统计区间 <code>{from}</code> ~ <code>{to}</code>
          </div>
        </div>
        <div className="preview-stat-grid return-analysis-stat-grid">
          <PreviewStat label="年化收益率" value={formatRatePct(annualizedRate)} />
          <PreviewStat label="期初资产（元）" value={formatCentsShort(beginAssets)} />
          <PreviewStat label="期末资产（元）" value={formatCentsShort(endAssets)} />
          <PreviewStat label="期末净增长（元）" value={formatCentsShort(endNetGrowth)} tone={signedMetricTone(endNetGrowth)} />
          <PreviewStat label="最大回撤比例" value={maxDrawdownText} tone={maxDrawdownTone} />
        </div>
      </div>
      {returnNote ? <div className="preview-note">{returnNote}</div> : null}
      <div className="preview-chart-stack">
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title-row">
            <div className="sparkline-title">{activeCurve.title}</div>
            <label className="return-curve-inline-field">
              <span>曲线</span>
              <select
                value={selectedCurveKind}
                onChange={(e) => setSelectedCurveKind(e.target.value as "return_rate" | "net_growth" | "total_assets")}
              >
                <option value="return_rate">累计收益率</option>
                <option value="net_growth">累计净增长</option>
                <option value="total_assets">总资产</option>
              </select>
            </label>
          </div>
          <LineAreaChart
            points={activeCurve.points}
            series={activeCurve.series}
            color={activeCurve.color}
            height={250}
            preferZeroBaseline
            maxXTicks={8}
            smooth
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={activeCurve.valueFormatter}
            tooltipFormatter={activeCurve.tooltipFormatter}
            multiTooltipFormatter={activeCurve.multiTooltipFormatter}
            sourceLabel={benchmarkSourceLabel}
            showZeroLine={selectedCurveKind === "return_rate" || selectedCurveKind === "net_growth"}
          />
          {selectedCurveKind === "return_rate" ? (
            <>
              <div className="return-comparison-legend">
                {returnComparisonSeries.map((series) => {
                  const lastPoint = series.points[series.points.length - 1];
                  const isBenchmark = series.id !== "account";
                  const isVisible = !isBenchmark || visibleBenchmarkIds.includes(series.id);
                  const commonChildren = (
                    <>
                      <span
                        className={`return-comparison-legend-swatch${series.dashed ? " is-dashed" : ""}`}
                        style={series.dashed ? { borderTopColor: series.color } : { backgroundColor: series.color }}
                      />
                      <span>{series.label}</span>
                      <strong>{lastPoint ? `${(lastPoint.value * 100).toFixed(2)}%` : "-"}</strong>
                    </>
                  );
                  return (
                    isBenchmark ? (
                      <button
                        key={series.id}
                        type="button"
                        className={`return-comparison-legend-item is-toggle${isVisible ? "" : " is-inactive"}`}
                        aria-pressed={isVisible}
                        onClick={() => toggleBenchmarkVisibility(series.id)}
                        title={isVisible ? `点击隐藏 ${series.label}` : `点击显示 ${series.label}`}
                      >
                        {commonChildren}
                      </button>
                    ) : (
                      <div key={series.id} className="return-comparison-legend-item">
                        {commonChildren}
                      </div>
                    )
                  );
                })}
              </div>
              {hasBenchmarkWarning ? (
                <div className="return-comparison-note-row">
                  <div className="preview-note return-comparison-note">{benchmarkFailureNote}</div>
                  {(benchmarkLoadFailed || hasBenchmarkWarning) && onRetryBenchmarks ? (
                    <button
                      type="button"
                      className="secondary-btn table-inline-btn return-comparison-retry-btn"
                      onClick={onRetryBenchmarks}
                      disabled={benchmarkRetryBusy}
                    >
                      {benchmarkRetryBusy ? "重试中..." : "重试"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
