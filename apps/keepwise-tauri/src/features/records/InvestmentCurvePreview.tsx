import { useState, type ComponentType } from "react";
import { isRecord, readArray, readNumber, readString } from "../../utils/value";

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

type LineAreaChartProps = {
  points: Array<{ label: string; value: number }>;
  color?: string;
  xLabelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (point: { label: string; value: number }) => string;
  height?: number;
  preferZeroBaseline?: boolean;
  maxXTicks?: number;
};

export function InvestmentCurvePreview({
  data,
  returnData,
  formatCentsShort,
  formatRatePct,
  signedMetricTone,
  PreviewStat,
  LineAreaChart,
}: {
  data: unknown;
  returnData?: unknown;
  formatCentsShort: (cents?: number) => string;
  formatRatePct: (rate?: number) => string;
  signedMetricTone: (value?: number) => "default" | "good" | "warn";
  PreviewStat: ComponentType<PreviewStatProps>;
  LineAreaChart: ComponentType<LineAreaChartProps>;
}) {
  const [selectedCurveKind, setSelectedCurveKind] = useState<"return_rate" | "net_growth" | "total_assets">("return_rate");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  if (rows.length === 0) return null;
  const returnPayload = isRecord(returnData) ? returnData : null;
  const from = readString(data, "range.effective_from") ?? "-";
  const to = readString(data, "range.effective_to") ?? "-";
  const endAssets = readNumber(data, "summary.end_assets_cents");
  const endNetGrowth = readNumber(data, "summary.end_net_growth_cents");
  const endReturn = readNumber(data, "summary.end_cumulative_return_rate");
  const annualizedRate = readNumber(returnPayload, "metrics.annualized_rate");
  const intervalReturnRate = readNumber(returnPayload, "metrics.return_rate");
  const returnNote = readString(returnPayload, "metrics.note") ?? "";
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
            color: "#dcb06a",
            valueFormatter: (v: number) => `${(v * 100).toFixed(1)}%`,
            tooltipFormatter: (p: { label: string; value: number }) => `${p.label} · ${(p.value * 100).toFixed(2)}%`,
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
          <PreviewStat label="期末资产（元）" value={formatCentsShort(endAssets)} />
          <PreviewStat label="期末净增长（元）" value={formatCentsShort(endNetGrowth)} tone={signedMetricTone(endNetGrowth)} />
          <PreviewStat label="期末累计收益率" value={formatRatePct(endReturn)} tone={signedMetricTone(endReturn)} />
        </div>
      </div>
      {returnNote ? <div className="preview-note">{returnNote}</div> : null}
      <div className="return-curve-switch">
        <label className="field return-curve-switch-field">
          <span>曲线切换</span>
          <select
            value={selectedCurveKind}
            onChange={(e) => setSelectedCurveKind(e.target.value as "return_rate" | "net_growth" | "total_assets")}
          >
            <option value="return_rate">累计收益率曲线</option>
            <option value="net_growth">累计净增长曲线</option>
            <option value="total_assets">总资产曲线</option>
          </select>
        </label>
      </div>
      <div className="preview-chart-stack">
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title">{activeCurve.title}</div>
          <LineAreaChart
            points={activeCurve.points}
            color={activeCurve.color}
            height={250}
            preferZeroBaseline
            maxXTicks={8}
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={activeCurve.valueFormatter}
            tooltipFormatter={activeCurve.tooltipFormatter}
          />
        </div>
      </div>
    </div>
  );
}
