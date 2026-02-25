import { startTransition, useEffect, useId, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import keepwiseLogoSvg from "./assets/keepwise-logo.svg";
import {
  deleteAnalysisExclusionRule,
  deleteMonthlyBudgetItem,
  cmbBankPdfImport,
  cmbBankPdfPreview,
  cmbEmlImport,
  cmbEmlPreview,
  deleteAccountCatalogEntry,
  deleteAssetValuation,
  deleteBankTransferWhitelistRule,
  deleteCategoryRule,
  deleteInvestmentRecord,
  deleteMerchantMapRule,
  importRepoRuntimeLedgerDb,
  importLedgerDbFromPath,
  loadBootstrapProbe,
  loadLedgerDbAdminStats,
  loadLedgerDbStatus,
  queryAccountCatalog,
  queryBudgetMonthlyReview,
  queryBudgetOverview,
  queryConsumptionReport,
  queryAnalysisExclusionRules,
  queryAssetValuations,
  queryBankTransferWhitelistRules,
  queryCategoryRules,
  queryInvestments,
  queryInvestmentReturns,
  queryInvestmentCurve,
  queryInvestmentReturn,
  queryMerchantRuleSuggestions,
  queryMonthlyBudgetItems,
  queryMetaAccounts,
  queryMerchantMapRules,
  queryFireProgress,
  querySalaryIncomeOverview,
  queryTransactions,
  queryWealthCurve,
  queryWealthOverview,
  runLedgerDbAdminResetAll,
  runLedgerDbAdminResetTransactions,
  runRuntimeDbHealthCheck,
  runLedgerDbMigrate,
  updateTransactionAnalysisExclusion,
  updateAssetValuation,
  updateInvestmentRecord,
  upsertAccountCatalogEntry,
  upsertAnalysisExclusionRule,
  upsertBankTransferWhitelistRule,
  upsertCategoryRule,
  upsertMonthlyBudgetItem,
  upsertMerchantMapRule,
  upsertManualAssetValuation,
  upsertManualInvestment,
  yzxyImportFile,
  yzxyPreviewFile,
  type BootstrapProbe,
  type CmbEmlImportPayload,
  type CmbEmlPreviewPayload,
  type CmbBankPdfImportPayload,
  type CmbBankPdfPreviewPayload,
  type BudgetMonthlyReviewPayload,
  type BudgetOverviewPayload,
  type BudgetYearQueryRequest,
  type ConsumptionReportPayload,
  type CategoryRuleDeleteRequest,
  type CategoryRuleUpsertRequest,
  type AccountCatalogDeletePayload,
  type AccountCatalogPayload,
  type AccountCatalogUpsertPayload,
  type AssetValuationMutationPayload,
  type DeleteByIdRequest,
  type LedgerAdminDbStats,
  type LedgerAdminResetAllResult,
  type LedgerAdminResetTransactionsResult,
  type LedgerDbImportRepoRuntimeResult,
  type InvestmentCurvePayload,
  type InvestmentCurveQueryRequest,
  type InvestmentReturnsPayload,
  type InvestmentReturnsQueryRequest,
  type InvestmentRecordMutationPayload,
  type LedgerDbMigrateResult,
  type LedgerDbStatus,
  type ManualAssetValuationMutationPayload,
  type ManualInvestmentMutationPayload,
  type MerchantMapDeleteRequest,
  type MerchantMapUpsertRequest,
  type MonthlyBudgetItemDeleteRequest,
  type MonthlyBudgetItemMutationPayload,
  type MonthlyBudgetItemsPayload,
  type MonthlyBudgetItemUpsertRequest,
  type MerchantRuleSuggestionsQueryRequest,
  type MetaAccountsPayload,
  type MetaAccountsQueryRequest,
  type RulesQueryPayload,
  type RuleMutationPayload,
  type RulesListQueryRequest,
  type QueryAssetValuationsPayload,
  type QueryAssetValuationsRequest,
  type QueryInvestmentsPayload,
  type QueryInvestmentsRequest,
  type QueryTransactionsPayload,
  type QueryTransactionsRequest,
  type QueryAccountCatalogRequest,
  type RuntimeDbHealthCheckPayload,
  type SalaryIncomeOverviewPayload,
  type AnalysisExclusionDeleteRequest,
  type AnalysisExclusionQueryRequest,
  type AnalysisExclusionUpsertRequest,
  type BankTransferWhitelistDeleteRequest,
  type BankTransferWhitelistQueryRequest,
  type BankTransferWhitelistUpsertRequest,
  type UpdateTransactionAnalysisExclusionRequest,
  type TransactionAnalysisExclusionMutationPayload,
  type UpdateAssetValuationRequest,
  type UpdateInvestmentRecordRequest,
  type UpsertManualAssetValuationRequest,
  type UpsertManualInvestmentRequest,
  type UpsertAccountCatalogEntryRequest,
  type WealthCurvePayload,
  type WealthCurveQueryRequest,
  type WealthOverviewPayload,
  type WealthOverviewQueryRequest,
  type YzxyImportPayload,
  type YzxyPreviewPayload,
  type FireProgressPayload,
  type FireProgressQueryRequest,
  type InvestmentReturnQueryRequest,
  type InvestmentReturnPayload,
  type PathProbe,
} from "./lib/desktopApi";

type LoadStatus = "idle" | "loading" | "ready" | "error";
type BoolString = "true" | "false";
type SmokeStatus = "idle" | "pass" | "fail";
type SmokeKey = "investment-return" | "investment-curve" | "wealth-overview" | "wealth-curve";
type PipelineStatus = "idle" | "running" | "pass" | "fail";
type ImportStepStatus = "idle" | "running" | "pass" | "fail" | "skip";
type ImportStepKey = "yzxy" | "cmb-eml" | "cmb-pdf";
type ProductTabKey =
  | "import-center"
  | "manual-entry"
  | "return-analysis"
  | "wealth-overview"
  | "budget-fire"
  | "income-analysis"
  | "consumption-analysis"
  | "base-query"
  | "admin";

type SmokeRow = {
  key: SmokeKey;
  label: string;
  status: SmokeStatus;
  durationMs?: number;
  detail?: string;
};

type ImportStepRow = {
  key: ImportStepKey;
  label: string;
  status: ImportStepStatus;
  durationMs?: number;
  detail?: string;
};

type ProductTabDef = {
  key: ProductTabKey;
  icon: string;
  label: string;
  subtitle: string;
  status: "ready" | "partial" | "todo";
};

const PRODUCT_TABS: ProductTabDef[] = [
  { key: "import-center", icon: "⇩", label: "导入中心", subtitle: "YZXY / EML / CMB PDF", status: "ready" },
  { key: "manual-entry", icon: "✎", label: "手动录入", subtitle: "记录修正与手工录入", status: "partial" },
  { key: "return-analysis", icon: "↗", label: "收益分析", subtitle: "投资收益率与收益曲线", status: "ready" },
  { key: "wealth-overview", icon: "◔", label: "财富总览", subtitle: "总览与财富曲线", status: "ready" },
  { key: "budget-fire", icon: "◎", label: "预算与FIRE", subtitle: "预算、复盘与 FIRE 进度", status: "partial" },
  { key: "income-analysis", icon: "¥", label: "收入分析", subtitle: "工资/公积金收入结构与趋势", status: "partial" },
  { key: "consumption-analysis", icon: "¤", label: "消费分析", subtitle: "交易筛选与排除规则", status: "partial" },
  { key: "base-query", icon: "⌕", label: "基础查询", subtitle: "交易/投资/资产查询", status: "partial" },
  { key: "admin", icon: "⚙", label: "高级管理", subtitle: "调试、健康检查、管理操作", status: "ready" },
];

function PathRow({ label, probe }: { label: string; probe: PathProbe }) {
  return (
    <div className="path-row">
      <div className="path-label">{label}</div>
      {probe.path ? (
        <code className="path-value" title={probe.path}>
          {probe.path}
        </code>
      ) : (
        <div className="path-error" title={probe.error ?? undefined}>
          {probe.error ?? "Unavailable"}
        </div>
      )}
    </div>
  );
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "true" | "false";
  onChange: (value: "true" | "false") => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as "true" | "false")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </label>
  );
}

function JsonResultCard({
  title = "Result JSON",
  data,
  emptyText,
}: {
  title?: string;
  data: unknown;
  emptyText: string;
}) {
  let rendered = emptyText;
  if (data) {
    try {
      rendered = JSON.stringify(
        data,
        (_key, value) => (typeof value === "bigint" ? value.toString() : value),
        2,
      );
    } catch (err) {
      rendered = `Unable to render JSON: ${
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
      }`;
    }
  }

  return (
    <div className="subcard db-result-card">
      <h3>{title}</h3>
      <pre className="json-pre">{rendered}</pre>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function readString(root: unknown, path: string): string | undefined {
  const value = readPath(root, path);
  return typeof value === "string" ? value : undefined;
}

function readNumber(root: unknown, path: string): number | undefined {
  const value = readPath(root, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBool(root: unknown, path: string): boolean | undefined {
  const value = readPath(root, path);
  return typeof value === "boolean" ? value : undefined;
}

function readArray(root: unknown, path: string): unknown[] {
  const value = readPath(root, path);
  return Array.isArray(value) ? value : [];
}

function formatCentsShort(cents?: number): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatRatePct(rate?: number): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(2)}%`;
}

function formatPct(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function safeNumericInputValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseNumericInputWithFallback(raw: string, fallback: number): number {
  const next = Number(raw);
  return Number.isFinite(next) ? next : fallback;
}

function PreviewStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div className={`preview-stat tone-${tone}`}>
      <div className="preview-stat-label">{label}</div>
      <div className="preview-stat-value">{String(value)}</div>
    </div>
  );
}

function LineAreaChart({
  points,
  color = "#7cc3ff",
  xLabelFormatter,
  valueFormatter,
  tooltipFormatter,
  height = 240,
  preferZeroBaseline = false,
  maxXTicks = 8,
}: {
  points: Array<{ label: string; value: number }>;
  color?: string;
  xLabelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (point: { label: string; value: number }) => string;
  height?: number;
  preferZeroBaseline?: boolean;
  maxXTicks?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(560);
  const gradientId = useId().replace(/[:]/g, "_");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.max(320, Math.round(el.clientWidth || 560));
      setMeasuredWidth((prev) => (prev === next ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => update());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const clean = points.filter((p) => Number.isFinite(p.value));
  if (clean.length === 0) {
    return <div ref={wrapRef} className="line-area-chart-empty">暂无趋势数据</div>;
  }

  const width = measuredWidth;
  const formattedValue = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const baseMargin = { top: 14, right: 16, bottom: 42 };
  const yTickCount = 4;
  const innerH = height - baseMargin.top - baseMargin.bottom;

  const minRaw = Math.min(...clean.map((p) => p.value));
  const maxRaw = Math.max(...clean.map((p) => p.value));
  let yMin = preferZeroBaseline ? Math.min(0, minRaw) : minRaw;
  let yMax = preferZeroBaseline ? Math.max(0, maxRaw) : maxRaw;
  if (yMin === yMax) {
    const bump = Math.max(Math.abs(yMin) * 0.1, 1);
    yMin -= bump;
    yMax += bump;
  } else {
    const pad = (yMax - yMin) * 0.08;
    if (preferZeroBaseline && minRaw >= 0) {
      yMax += pad;
      yMin = 0;
    } else if (preferZeroBaseline && maxRaw <= 0) {
      yMin -= pad;
      yMax = 0;
    } else {
      yMin -= pad;
      yMax += pad;
    }
  }
  const ySpan = yMax - yMin || 1;
  const yTickMeta = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const ratio = i / yTickCount;
    const value = yMax - ySpan * ratio;
    return {
      ratio,
      value,
      label: formattedValue(value),
    };
  });

  const maxYLabelLen = Math.max(...yTickMeta.map((tick) => tick.label.length), 1);
  const margin = {
    top: baseMargin.top,
    right: baseMargin.right,
    bottom: baseMargin.bottom,
    left: Math.min(152, Math.max(76, 20 + maxYLabelLen * 7)),
  };
  const innerW = Math.max(120, width - margin.left - margin.right);
  const stepX = clean.length > 1 ? innerW / (clean.length - 1) : 0;

  const toX = (idx: number) => margin.left + (clean.length > 1 ? idx * stepX : innerW / 2);
  const toY = (value: number) => margin.top + innerH - ((value - yMin) / ySpan) * innerH;

  const yTicks = yTickMeta.map((tick) => ({
    ...tick,
    y: margin.top + innerH * tick.ratio,
  }));

  const linePath = clean
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx).toFixed(2)} ${toY(p.value).toFixed(2)}`)
    .join(" ");
  const areaPath =
    clean.length > 0
      ? [
          `M ${toX(0).toFixed(2)} ${(margin.top + innerH).toFixed(2)}`,
          ...clean.map((p, idx) => `L ${toX(idx).toFixed(2)} ${toY(p.value).toFixed(2)}`),
          `L ${toX(clean.length - 1).toFixed(2)} ${(margin.top + innerH).toFixed(2)}`,
          "Z",
        ].join(" ")
      : "";

  const effectiveMaxXTicks = Math.max(3, Math.min(maxXTicks, Math.floor(width / 72)));
  const tickStride =
    clean.length <= effectiveMaxXTicks ? 1 : Math.ceil(clean.length / Math.max(2, effectiveMaxXTicks));
  const xTicks = clean.map((p, idx) => ({
    label: xLabelFormatter ? xLabelFormatter(p.label) : p.label,
    rawLabel: p.label,
    x: toX(idx),
    idx,
  })).filter((_tick, idx, arr) => idx === 0 || idx === arr.length - 1 || idx % tickStride === 0);

  const active = hoverIndex != null ? clean[hoverIndex] : null;
  const activeX = hoverIndex != null ? toX(hoverIndex) : null;
  const activeY = hoverIndex != null && active ? toY(active.value) : null;

  return (
    <div ref={wrapRef} className="line-area-chart-wrap" style={{ height: `${height}px` }}>
      <svg
        className="line-area-chart"
        viewBox={`0 0 ${width} ${height}`}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || clean.length === 0) return;
          const clientX = e.clientX;
          const px = ((clientX - rect.left) / rect.width) * width;
          const clamped = Math.max(margin.left, Math.min(margin.left + innerW, px));
          const idx =
            clean.length === 1 ? 0 : Math.round(((clamped - margin.left) / innerW) * (clean.length - 1));
          setHoverIndex(Math.max(0, Math.min(clean.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="65%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick, idx) => (
          <g key={`y-${idx}`}>
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={tick.y}
              y2={tick.y}
              className={`line-area-grid ${idx === yTicks.length - 1 ? "axis-baseline" : ""}`}
            />
            <text x={margin.left - 8} y={tick.y + 4} className="line-area-axis-label line-area-axis-label-y" textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}

        {xTicks.map((tick) => (
          <g key={`x-${tick.rawLabel}`}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={margin.top + innerH}
              y2={margin.top + innerH + 6}
              className="line-area-axis-tick"
            />
            <text x={tick.x} y={height - 14} className="line-area-axis-label line-area-axis-label-x" textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /> : null}

        {clean.map((p, idx) => {
          const x = toX(idx);
          const y = toY(p.value);
          const isActive = hoverIndex === idx;
          return (
            <circle
              key={`pt-${p.label}-${idx}`}
              cx={x}
              cy={y}
              r={isActive ? 4.2 : 2.4}
              className={isActive ? "line-area-point active" : "line-area-point"}
              style={{ fill: color, fillOpacity: isActive ? 1 : 0.72 }}
            />
          );
        })}

        {active && activeX != null && activeY != null ? (
          <g>
            <line
              x1={activeX}
              x2={activeX}
              y1={margin.top}
              y2={margin.top + innerH}
              className="line-area-crosshair"
              style={{ stroke: color, strokeOpacity: 0.36 }}
            />
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={activeY}
              y2={activeY}
              className="line-area-crosshair horizontal"
              style={{ stroke: color, strokeOpacity: 0.22 }}
            />
            <circle
              cx={activeX}
              cy={activeY}
              r={5.2}
              className="line-area-point-ring"
              style={{ fill: color, fillOpacity: 0.16, stroke: color, strokeOpacity: 0.72 }}
            />
          </g>
        ) : null}

        <rect
          x={margin.left}
          y={margin.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          pointerEvents="all"
        />
      </svg>

      {active && activeX != null && activeY != null ? (
        <div
          className="line-area-tooltip"
          style={{
            left: `${Math.max(7, Math.min(93, (activeX / width) * 100))}%`,
            top: `${(activeY / height) * 100}%`,
          }}
        >
          <div className="line-area-tooltip-title">{xLabelFormatter ? xLabelFormatter(active.label) : active.label}</div>
          <div className="line-area-tooltip-value">
            {tooltipFormatter ? tooltipFormatter(active) : formattedValue(active.value)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InvestmentReturnPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const accountName = readString(data, "account_name") ?? "-";
  const from = readString(data, "range.effective_from") ?? "-";
  const to = readString(data, "range.effective_to") ?? "-";
  const returnRate = readNumber(data, "metrics.return_rate");
  const annualizedRate = readNumber(data, "metrics.annualized_rate");
  const profitCents = readNumber(data, "metrics.profit_cents");
  const endAssetsCents = readNumber(data, "metrics.end_assets_cents");
  const note = readString(data, "metrics.note") ?? "";

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Quick Preview</h3>
        <div className="preview-subtle">{accountName}</div>
      </div>
      <div className="preview-subtle">
        Range: <code>{from}</code> ~ <code>{to}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Return" value={formatRatePct(returnRate)} tone={typeof returnRate === "number" && returnRate >= 0 ? "good" : "warn"} />
        <PreviewStat label="Annualized" value={formatRatePct(annualizedRate)} />
        <PreviewStat label="Profit (Yuan)" value={formatCentsShort(profitCents)} />
        <PreviewStat label="End Assets (Yuan)" value={formatCentsShort(endAssetsCents)} />
      </div>
      {note ? <div className="preview-note">{note}</div> : null}
    </div>
  );
}

function InvestmentCurvePreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  if (rows.length === 0) return null;
  const from = readString(data, "range.effective_from") ?? "-";
  const to = readString(data, "range.effective_to") ?? "-";
  const count = readNumber(data, "summary.count");
  const endAssets = readNumber(data, "summary.end_assets_cents");
  const endReturn = readNumber(data, "summary.end_cumulative_return_rate");
  const assetPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.total_assets_cents === "number" ? r.total_assets_cents : NaN;
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
  const firstDateValue = rows[0]?.["snapshot_date"];
  const lastDateValue = rows[rows.length - 1]?.["snapshot_date"];
  const firstDate = typeof firstDateValue === "string" ? firstDateValue : "-";
  const lastDate = typeof lastDateValue === "string" ? lastDateValue : "-";

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Curve Preview</h3>
        <div className="preview-subtle">
          {firstDate} → {lastDate}
        </div>
      </div>
      <div className="preview-subtle">
        Effective Range: <code>{from}</code> ~ <code>{to}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Points" value={count ?? rows.length} />
        <PreviewStat label="End Assets (Yuan)" value={formatCentsShort(endAssets)} />
        <PreviewStat label="End Cum Return" value={formatRatePct(endReturn)} tone={typeof endReturn === "number" && endReturn >= 0 ? "good" : "warn"} />
      </div>
      <div className="preview-chart-stack">
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title">总资产曲线</div>
          <LineAreaChart
            points={assetPoints}
            color="#7cc3ff"
            height={250}
            preferZeroBaseline
            maxXTicks={8}
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title">累计收益率曲线</div>
          <LineAreaChart
            points={returnPoints}
            color="#dcb06a"
            height={230}
            preferZeroBaseline
            maxXTicks={8}
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={(v) => `${(v * 100).toFixed(1)}%`}
            tooltipFormatter={(p) => `${p.label} · ${(p.value * 100).toFixed(2)}%`}
          />
        </div>
      </div>
    </div>
  );
}

function WealthOverviewPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const wealthTotal = readNumber(data, "summary.wealth_total_cents");
  const netAssetTotal = readNumber(data, "summary.net_asset_total_cents");
  const liabilityTotal = readNumber(data, "summary.liability_total_cents");
  const staleCount = readNumber(data, "summary.stale_account_count");
  const reconciliationOk = readBool(data, "summary.reconciliation_ok");
  const asOf = readString(data, "as_of") ?? "-";
  const requestedAsOf = readString(data, "requested_as_of") ?? "-";
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "asset_class":
          return row.asset_class;
        case "account_name":
          return row.account_name;
        case "snapshot_date":
          return row.snapshot_date;
        case "value_cents":
          return row.value_cents;
        case "stale_days":
          return row.stale_days;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Overview Preview</h3>
        <div className="preview-subtle">
          as_of <code>{asOf}</code> (requested <code>{requestedAsOf}</code>)
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Wealth (Yuan)" value={formatCentsShort(wealthTotal)} />
        <PreviewStat label="Net Assets (Yuan)" value={formatCentsShort(netAssetTotal)} />
        <PreviewStat label="Liability (Yuan)" value={formatCentsShort(liabilityTotal)} />
        <PreviewStat label="Stale Accounts" value={staleCount ?? 0} tone={(staleCount ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="Reconciliation" value={reconciliationOk ? "OK" : "Mismatch"} tone={reconciliationOk ? "good" : "warn"} />
        <PreviewStat label="Rows" value={rows.length} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="类型" sortKey="asset_class" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="日期" sortKey="snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="数值" sortKey="value_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="滞后天数" sortKey="stale_days" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const cls = typeof row.asset_class === "string" ? row.asset_class : "-";
                const name = typeof row.account_name === "string" ? row.account_name : "-";
                const date = typeof row.snapshot_date === "string" ? row.snapshot_date : "-";
                const value = typeof row.value_cents === "number" ? row.value_cents : undefined;
                const stale = typeof row.stale_days === "number" ? row.stale_days : undefined;
                return (
                  <tr key={`${cls}-${name}-${date}-${idx}`}>
                    <td>{cls}</td>
                    <td className="truncate-cell" title={name}>
                      {name}
                    </td>
                    <td>{date}</td>
                    <td className="num">{formatCentsShort(value)}</td>
                    <td className={`num ${typeof stale === "number" && stale > 0 ? "warn-text" : ""}`}>{stale ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function WealthCurvePreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  if (rows.length === 0) return null;
  const points = readNumber(data, "range.points");
  const from = readString(data, "range.effective_from") ?? "-";
  const to = readString(data, "range.effective_to") ?? "-";
  const changePct = readNumber(data, "summary.change_pct");
  const endWealth = readNumber(data, "summary.end_wealth_cents");
  const endNetAsset = readNumber(data, "summary.end_net_asset_cents");
  const wealthPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.wealth_total_cents === "number" ? r.wealth_total_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const netAssetPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.net_asset_total_cents === "number" ? r.net_asset_total_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const liabilityPoints = rows
    .map((r) => {
      const label = typeof r.snapshot_date === "string" ? r.snapshot_date : "";
      const value = typeof r.liability_total_cents === "number" ? r.liability_total_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Wealth Curve Preview</h3>
        <div className="preview-subtle">
          <code>{from}</code> ~ <code>{to}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Points" value={points ?? rows.length} />
        <PreviewStat label="End Wealth (Yuan)" value={formatCentsShort(endWealth)} />
        <PreviewStat label="End Net Assets (Yuan)" value={formatCentsShort(endNetAsset)} />
        <PreviewStat label="Change %" value={formatPct(changePct)} tone={typeof changePct === "number" && changePct >= 0 ? "good" : "warn"} />
      </div>
      <div className="preview-chart-stack">
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title">财富总额曲线</div>
          <LineAreaChart
            points={wealthPoints}
            color="#7cc3ff"
            height={250}
            preferZeroBaseline
            maxXTicks={8}
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title">净资产曲线</div>
          <LineAreaChart
            points={netAssetPoints}
            color="#7ad7a7"
            height={230}
            preferZeroBaseline={false}
            maxXTicks={8}
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
        <div className="sparkline-card full-width-chart-panel">
          <div className="sparkline-title">负债曲线</div>
          <LineAreaChart
            points={liabilityPoints}
            color="#ff937f"
            height={210}
            preferZeroBaseline
            maxXTicks={8}
            xLabelFormatter={(label) => (label.length >= 10 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
      </div>
    </div>
  );
}

function BudgetItemsPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("sort_order");
  const [sortDir, setSortDir] = useState<TableSortDirection>("asc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const totalCount = readNumber(data, "summary.total_count");
  const activeCount = readNumber(data, "summary.active_count");
  const monthlyTotal = readNumber(data, "summary.monthly_budget_total_cents");
  const annualTotal = readNumber(data, "summary.annual_budget_cents");
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "name":
          return row.name ?? "";
        case "monthly_amount_cents":
          return row.monthly_amount_cents ?? 0;
        case "annual_amount_cents":
          return row.annual_amount_cents ?? 0;
        case "is_active":
          return row.is_active ?? false;
        case "sort_order":
          return row.sort_order ?? 0;
        case "updated_at":
          return row.updated_at ?? "";
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>预算项预览</h3>
        <div className="preview-subtle">按月预算条目</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="总条目" value={totalCount ?? rows.length} />
        <PreviewStat label="启用条目" value={activeCount ?? 0} tone={(activeCount ?? 0) > 0 ? "good" : "warn"} />
        <PreviewStat label="月预算(元)" value={formatCentsShort(monthlyTotal)} />
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualTotal)} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="名称" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="月预算" sortKey="monthly_amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="年预算" sortKey="annual_amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="排序" sortKey="sort_order" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="启用" sortKey="is_active" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="更新时间" sortKey="updated_at" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const id = typeof row.id === "string" ? row.id : `row_${idx}`;
                const name = typeof row.name === "string" ? row.name : "-";
                const monthly = typeof row.monthly_amount_cents === "number" ? row.monthly_amount_cents : undefined;
                const annual = typeof row.annual_amount_cents === "number" ? row.annual_amount_cents : undefined;
                const sort = typeof row.sort_order === "number" ? row.sort_order : "-";
                const active = typeof row.is_active === "boolean" ? row.is_active : false;
                const builtin = typeof row.is_builtin === "boolean" ? row.is_builtin : false;
                const updatedAt = typeof row.updated_at === "string" ? row.updated_at : "-";
                return (
                  <tr key={id}>
                    <td className="truncate-cell" title={name}>{name}{builtin ? "（内置）" : ""}</td>
                    <td className="num">{formatCentsShort(monthly)}</td>
                    <td className="num">{formatCentsShort(annual)}</td>
                    <td className="num">{String(sort)}</td>
                    <td>{active ? "是" : "否"}</td>
                    <td>{updatedAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="placeholder">暂无预算项，请先新增预算项。</p>
      )}
    </div>
  );
}

function BudgetOverviewPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const year = readNumber(data, "year");
  const asOf = readString(data, "as_of_date") ?? "-";
  const monthlyBudget = readNumber(data, "budget.monthly_total_cents");
  const annualBudget = readNumber(data, "budget.annual_total_cents");
  const ytdBudget = readNumber(data, "budget.ytd_budget_cents");
  const actual = readNumber(data, "actual.spent_total_cents");
  const ytdActual = readNumber(data, "actual.ytd_spent_cents");
  const annualRemaining = readNumber(data, "metrics.annual_remaining_cents");
  const ytdVariance = readNumber(data, "metrics.ytd_variance_cents");
  const usageRateText = readString(data, "metrics.usage_rate_pct_text") ?? "-";
  const ytdUsageRateText = readString(data, "metrics.ytd_usage_rate_pct_text") ?? "-";
  const elapsedMonths = readNumber(data, "analysis_scope.elapsed_months");
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>预算概览预览</h3>
        <div className="preview-subtle">{year ?? "-"} 年 · as_of {asOf}</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="月预算(元)" value={formatCentsShort(monthlyBudget)} />
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualBudget)} />
        <PreviewStat label="累计支出(元)" value={formatCentsShort(actual)} />
        <PreviewStat label="年剩余(元)" value={formatCentsShort(annualRemaining)} tone={(annualRemaining ?? 0) >= 0 ? "good" : "warn"} />
        <PreviewStat label="YTD预算(元)" value={formatCentsShort(ytdBudget)} />
        <PreviewStat label="YTD支出(元)" value={formatCentsShort(ytdActual)} />
        <PreviewStat label="YTD偏差(元)" value={formatCentsShort(ytdVariance)} tone={(ytdVariance ?? 0) >= 0 ? "good" : "warn"} />
        <PreviewStat label="全年使用率" value={usageRateText} />
        <PreviewStat label="YTD使用率" value={ytdUsageRateText} />
        <PreviewStat label="已过月数" value={elapsedMonths ?? "-"} />
      </div>
    </div>
  );
}

function BudgetMonthlyReviewPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("month_key");
  const [sortDir, setSortDir] = useState<TableSortDirection>("asc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const year = readNumber(data, "year");
  const annualBudget = readNumber(data, "summary.annual_budget_cents");
  const annualSpent = readNumber(data, "summary.annual_spent_cents");
  const annualVariance = readNumber(data, "summary.annual_variance_cents");
  const annualUsageRateText = readString(data, "summary.annual_usage_rate_pct_text") ?? "-";
  const overMonths = readNumber(data, "summary.over_budget_months");
  const underMonths = readNumber(data, "summary.under_budget_months");
  const equalMonths = readNumber(data, "summary.equal_months");
  const sortedRows = [...rows].sort((a, b) => {
    const cmp = compareSortValues(a[sortKey], b[sortKey]);
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>预算月度复盘预览</h3>
        <div className="preview-subtle">{year ?? "-"} 年 12 个月</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualBudget)} />
        <PreviewStat label="年支出(元)" value={formatCentsShort(annualSpent)} />
        <PreviewStat label="年偏差(元)" value={formatCentsShort(annualVariance)} tone={(annualVariance ?? 0) >= 0 ? "good" : "warn"} />
        <PreviewStat label="年使用率" value={annualUsageRateText} />
        <PreviewStat label="超预算月" value={overMonths ?? 0} tone={(overMonths ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="低于预算月" value={underMonths ?? 0} tone={(underMonths ?? 0) > 0 ? "good" : "default"} />
        <PreviewStat label="持平月" value={equalMonths ?? 0} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="月份" sortKey="month_key" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="交易数" sortKey="tx_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="预算" sortKey="budget_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="支出" sortKey="spent_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="偏差" sortKey="variance_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="使用率" sortKey="usage_rate" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="状态" sortKey="status" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const monthKey = typeof row.month_key === "string" ? row.month_key : `m_${idx}`;
                const txCount = typeof row.tx_count === "number" ? row.tx_count : 0;
                const budget = typeof row.budget_cents === "number" ? row.budget_cents : undefined;
                const spent = typeof row.spent_cents === "number" ? row.spent_cents : undefined;
                const variance = typeof row.variance_cents === "number" ? row.variance_cents : undefined;
                const usageText = typeof row.usage_rate_pct_text === "string" ? row.usage_rate_pct_text : "-";
                const statusText = typeof row.status === "string" ? row.status : "-";
                return (
                  <tr key={`${monthKey}-${idx}`}>
                    <td>{monthKey}</td>
                    <td className="num">{txCount}</td>
                    <td className="num">{formatCentsShort(budget)}</td>
                    <td className="num">{formatCentsShort(spent)}</td>
                    <td className={`num ${typeof variance === "number" && variance < 0 ? "warn-text" : ""}`}>
                      {formatCentsShort(variance)}
                    </td>
                    <td>{usageText}</td>
                    <td>{statusText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function FireProgressPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const year = readNumber(data, "year");
  const rateText = readString(data, "withdrawal_rate_pct_text") ?? "-";
  const annualBudget = readNumber(data, "budget.annual_total_cents");
  const investableTotal = readNumber(data, "investable_assets.total_cents");
  const coverageYearsText = readString(data, "metrics.coverage_years_text") ?? "-";
  const freedomRatioText = readString(data, "metrics.freedom_ratio_pct_text") ?? "-";
  const requiredAssets = readNumber(data, "metrics.required_assets_cents");
  const remainingToGoal = readNumber(data, "metrics.remaining_to_goal_cents");
  const goalGap = readNumber(data, "metrics.goal_gap_cents");
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>FIRE 进度预览</h3>
        <div className="preview-subtle">{year ?? "-"} 年 · 提取率 {rateText}</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualBudget)} />
        <PreviewStat label="可投资产(元)" value={formatCentsShort(investableTotal)} />
        <PreviewStat label="覆盖年数" value={coverageYearsText} />
        <PreviewStat label="自由度" value={freedomRatioText} />
        <PreviewStat label="目标资产(元)" value={formatCentsShort(requiredAssets)} />
        <PreviewStat label="距离目标(元)" value={formatCentsShort(remainingToGoal)} tone={(remainingToGoal ?? 0) === 0 ? "good" : "warn"} />
        <PreviewStat label="目标差额(元)" value={formatCentsShort(goalGap)} tone={(goalGap ?? 0) >= 0 ? "good" : "warn"} />
      </div>
    </div>
  );
}

function SalaryIncomeOverviewPreview({ data }: { data: unknown }) {
  const [rowSortKey, setRowSortKey] = useState<string>("month_key");
  const [rowSortDir, setRowSortDir] = useState<TableSortDirection>("asc");
  const [employerSortKey, setEmployerSortKey] = useState<string>("amount_cents");
  const [employerSortDir, setEmployerSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const year = readNumber(data, "year");
  const asOf = readString(data, "as_of_date") ?? "-";
  const sourceType = readString(data, "source_type") ?? "-";
  const rows = readArray(data, "rows").filter(isRecord);
  const employers = readArray(data, "employers").filter(isRecord);
  const salaryTotal = readNumber(data, "summary.salary_total_cents");
  const fundTotal = readNumber(data, "summary.housing_fund_total_cents");
  const totalIncome = readNumber(data, "summary.total_income_cents");
  const salaryCount = readNumber(data, "summary.salary_tx_count");
  const fundCount = readNumber(data, "summary.housing_fund_tx_count");
  const monthsWithSalary = readNumber(data, "summary.months_with_salary");
  const monthsWithFund = readNumber(data, "summary.months_with_housing_fund");
  const employerCount = readNumber(data, "summary.employer_count");
  const incomeChartPoints = rows
    .map((r) => {
      const label = typeof r.month_key === "string" ? r.month_key : "";
      const value = typeof r.total_income_cents === "number" ? r.total_income_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const sortedRows = [...rows].sort((a, b) => {
    const cmp = compareSortValues(a[rowSortKey], b[rowSortKey]);
    return rowSortDir === "asc" ? cmp : -cmp;
  });
  const sortedEmployers = [...employers].sort((a, b) => {
    const cmp = compareSortValues(a[employerSortKey], b[employerSortKey]);
    return employerSortDir === "asc" ? cmp : -cmp;
  });
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>工资收入概览预览</h3>
        <div className="preview-subtle">
          {year ?? "-"} 年 · {sourceType} · as_of {asOf}
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="工资总额(元)" value={formatCentsShort(salaryTotal)} />
        <PreviewStat label="公积金总额(元)" value={formatCentsShort(fundTotal)} />
        <PreviewStat label="总收入(元)" value={formatCentsShort(totalIncome)} tone={(totalIncome ?? 0) > 0 ? "good" : "warn"} />
        <PreviewStat label="工资笔数" value={salaryCount ?? 0} />
        <PreviewStat label="公积金笔数" value={fundCount ?? 0} />
        <PreviewStat label="工资到账月数" value={monthsWithSalary ?? 0} />
        <PreviewStat label="公积金到账月数" value={monthsWithFund ?? 0} />
        <PreviewStat label="雇主数" value={employerCount ?? 0} />
      </div>
      <div className="preview-chart-grid">
        <div className="sparkline-card">
          <div className="sparkline-title">月度总收入</div>
          <LineAreaChart
            points={incomeChartPoints}
            color="#88d8aa"
            height={220}
            preferZeroBaseline
            maxXTicks={12}
            xLabelFormatter={(label) => (label.length >= 7 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
      </div>
      {sortedEmployers.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="雇主" sortKey="employer" activeSortKey={employerSortKey} sortDir={employerSortDir} onToggle={(key) => {
                  const next = nextSortState(employerSortKey, employerSortDir, key);
                  setEmployerSortKey(next.key);
                  setEmployerSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="笔数" sortKey="tx_count" activeSortKey={employerSortKey} sortDir={employerSortDir} onToggle={(key) => {
                  const next = nextSortState(employerSortKey, employerSortDir, key);
                  setEmployerSortKey(next.key);
                  setEmployerSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount_cents" activeSortKey={employerSortKey} sortDir={employerSortDir} onToggle={(key) => {
                  const next = nextSortState(employerSortKey, employerSortDir, key);
                  setEmployerSortKey(next.key);
                  setEmployerSortDir(next.dir);
                }} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployers.map((row, idx) => {
                const employer = typeof row.employer === "string" ? row.employer : `row_${idx}`;
                const txCount = typeof row.tx_count === "number" ? row.tx_count : 0;
                const amount = typeof row.amount_cents === "number" ? row.amount_cents : undefined;
                return (
                  <tr key={`${employer}-${idx}`}>
                    <td className="truncate-cell" title={employer}>{employer}</td>
                    <td className="num">{txCount}</td>
                    <td className="num">{formatCentsShort(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="月份" sortKey="month_key" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="工资(元)" sortKey="salary_cents" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="公积金(元)" sortKey="housing_fund_cents" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="总收入(元)" sortKey="total_income_cents" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const monthKey = typeof row.month_key === "string" ? row.month_key : `m_${idx}`;
                const salary = typeof row.salary_cents === "number" ? row.salary_cents : undefined;
                const fund = typeof row.housing_fund_cents === "number" ? row.housing_fund_cents : undefined;
                const total = typeof row.total_income_cents === "number" ? row.total_income_cents : undefined;
                return (
                  <tr key={`${monthKey}-${idx}`}>
                    <td>{monthKey}</td>
                    <td className="num">{formatCentsShort(salary)}</td>
                    <td className="num">{formatCentsShort(fund)}</td>
                    <td className="num">{formatCentsShort(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ConsumptionOverviewPreview({ data }: { data: unknown }) {
  const [catSortKey, setCatSortKey] = useState<string>("amount");
  const [catSortDir, setCatSortDir] = useState<TableSortDirection>("desc");
  const [monthSortKey, setMonthSortKey] = useState<string>("month");
  const [monthSortDir, setMonthSortDir] = useState<TableSortDirection>("asc");
  const [merchantSortKey, setMerchantSortKey] = useState<string>("amount");
  const [merchantSortDir, setMerchantSortDir] = useState<TableSortDirection>("desc");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMerchants, setSelectedMerchants] = useState<string[]>([]);
  const [excludeNeedsReview, setExcludeNeedsReview] = useState(true);
  if (!isRecord(data)) return null;

  type TxRow = {
    month: string;
    date: string;
    merchant: string;
    description: string;
    category: string;
    amount: number;
    needsReview: boolean;
    confidence: number;
    sourcePath: string;
  };

  const transactions = readArray(data, "transactions").filter(isRecord);
  const txRows: TxRow[] = transactions.map((row) => ({
    month: typeof row.month === "string" ? row.month : "",
    date: typeof row.date === "string" ? row.date : "",
    merchant: typeof row.merchant === "string" && row.merchant ? row.merchant : "未知商户",
    description: typeof row.description === "string" ? row.description : "",
    category: typeof row.category === "string" && row.category ? row.category : "待分类",
    amount: typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0,
    needsReview: typeof row.needs_review === "boolean" ? row.needs_review : false,
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0,
    sourcePath: typeof row.source_path === "string" ? row.source_path : "",
  }));

  const total = readNumber(data, "consumption_total_value");
  const totalText = readString(data, "consumption_total") ?? "-";
  const count = readNumber(data, "consumption_count");
  const reviewCount = readNumber(data, "needs_review_count");
  const reviewRatio = readNumber(data, "needs_review_ratio");
  const excludedCount = readNumber(data, "excluded_consumption_count");
  const excludedTotalText = readString(data, "excluded_consumption_total") ?? "-";
  const rawCount = readNumber(data, "raw_consumption_count");
  const rawTotalText = readString(data, "raw_consumption_total") ?? "-";
  const inputFiles = readNumber(data, "input_files_count");
  const failedFiles = readNumber(data, "failed_files_count");
  const generatedAt = readString(data, "generated_at") ?? "-";

  const monthOptions = Array.from(new Set(txRows.map((r) => r.month).filter((m) => m)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));

  const monthScopedTx = txRows.filter((r) => {
    if (excludeNeedsReview && r.needsReview) return false;
    if (selectedMonth && r.month !== selectedMonth) return false;
    return true;
  });

  const buildAgg = <K extends string>(
    rows: TxRow[],
    keySelector: (row: TxRow) => K,
  ): Array<Record<string, unknown>> => {
    const buckets = new Map<K, { amountCents: number; count: number; reviewCount: number; sampleCategory?: string }>();
    for (const row of rows) {
      const key = keySelector(row);
      const item = buckets.get(key) ?? { amountCents: 0, count: 0, reviewCount: 0, sampleCategory: row.category };
      item.amountCents += Math.round(row.amount * 100);
      item.count += 1;
      item.reviewCount += row.needsReview ? 1 : 0;
      if (!item.sampleCategory) item.sampleCategory = row.category;
      buckets.set(key, item);
    }
    return Array.from(buckets.entries()).map(([key, stat]) => ({
      key,
      amount_cents: stat.amountCents,
      amount: Number((stat.amountCents / 100).toFixed(2)),
      count: stat.count,
      review_count: stat.reviewCount,
      category: stat.sampleCategory ?? "",
    }));
  };

  const categoryOptionsAgg = buildAgg(monthScopedTx, (r) => r.category)
    .map((x) => ({
      category: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const categoryScopedTx = monthScopedTx.filter((r) =>
    selectedCategories.length === 0 ? true : selectedCategories.includes(r.category),
  );

  const merchantOptionsAgg = buildAgg(categoryScopedTx, (r) => r.merchant)
    .map((x) => ({
      merchant: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      category: (x.category as string) || "待分类",
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const filteredTx = categoryScopedTx.filter((r) =>
    selectedMerchants.length === 0 ? true : selectedMerchants.includes(r.merchant),
  );

  const categories = buildAgg(filteredTx, (r) => r.category)
    .map((x) => ({
      category: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const months = buildAgg(filteredTx, (r) => r.month)
    .map((x) => ({
      month: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      review_count: x.review_count as number,
    }))
    .filter((x) => x.month)
    .sort((a, b) => a.month.localeCompare(b.month, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));

  const merchants = buildAgg(filteredTx, (r) => r.merchant)
    .map((x) => ({
      merchant: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      category: (x.category as string) || "待分类",
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const filteredTotalCents = filteredTx.reduce((sum, r) => sum + Math.round(r.amount * 100), 0);
  const filteredReviewCount = filteredTx.filter((r) => r.needsReview).length;
  const filteredReviewRatio = filteredTx.length > 0 ? filteredReviewCount / filteredTx.length : 0;

  const categorySorted = [...categories].sort((a, b) => {
    const cmp = compareSortValues(
      (a as Record<string, unknown>)[catSortKey],
      (b as Record<string, unknown>)[catSortKey],
    );
    return catSortDir === "asc" ? cmp : -cmp;
  });
  const monthSorted = [...months].sort((a, b) => {
    const cmp = compareSortValues(
      (a as Record<string, unknown>)[monthSortKey],
      (b as Record<string, unknown>)[monthSortKey],
    );
    return monthSortDir === "asc" ? cmp : -cmp;
  });
  const merchantSorted = [...merchants].sort((a, b) => {
    const cmp = compareSortValues(
      (a as Record<string, unknown>)[merchantSortKey],
      (b as Record<string, unknown>)[merchantSortKey],
    );
    return merchantSortDir === "asc" ? cmp : -cmp;
  });
  const monthChartPoints = months
    .map((m) => {
      const label = typeof m.month === "string" ? m.month : "";
      const amount = typeof m.amount === "number" ? Math.round(m.amount * 100) : NaN;
      return label && Number.isFinite(amount) ? { label, value: amount } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);

  const donutRows = categories
    .slice(0, 8)
    .map((row) => ({
      category: row.category,
      amount: row.amount,
      count: row.count,
    }))
    .filter((r) => r.amount > 0);
  const donutTotal = donutRows.reduce((sum, r) => sum + r.amount, 0);
  const palette = ["#7cc3ff", "#88d8aa", "#ffd27d", "#ff9f8a", "#a8a4ff", "#59d2c9", "#f3a6ff", "#9ad36a"];
  let acc = 0;
  const donutStops = donutRows.map((row, idx) => {
    const start = donutTotal > 0 ? (acc / donutTotal) * 100 : 0;
    acc += row.amount;
    const end = donutTotal > 0 ? (acc / donutTotal) * 100 : 0;
    return { ...row, color: palette[idx % palette.length], start, end };
  });
  const donutStyle =
    donutStops.length > 0
      ? {
          background: `conic-gradient(${donutStops
            .map((s) => `${s.color} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`)
            .join(", ")})`,
        }
      : undefined;

  const toggleMulti = (values: string[], value: string, setter: (next: string[]) => void) => {
    if (!value) return;
    if (values.includes(value)) {
      setter(values.filter((v) => v !== value));
    } else {
      setter([...values, value]);
    }
  };

  const filterPills = [
    ...(selectedMonth ? [{ kind: "month" as const, label: `月份: ${selectedMonth}` }] : []),
    ...(excludeNeedsReview ? [{ kind: "hide_review" as const, label: "已排除待确认" }] : []),
    ...selectedCategories.map((v) => ({ kind: "category" as const, value: v, label: `分类: ${v}` })),
    ...selectedMerchants.map((v) => ({ kind: "merchant" as const, value: v, label: `商户: ${v}` })),
  ];

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>消费总览</h3>
        <div className="preview-subtle">生成时间 {generatedAt}</div>
      </div>

      <div className="consumption-filter-bar">
        <div className="consumption-filter-row">
          <label className="field checkbox-field">
            <span>排除待确认（默认）</span>
            <input
              type="checkbox"
              checked={excludeNeedsReview}
              onChange={(e) => setExcludeNeedsReview(e.target.checked)}
            />
          </label>
          <div className="consumption-filter-inline">
            <span className="consumption-filter-label">月份单选</span>
            <div className="consumption-chip-group">
              <button
                type="button"
                className={`consumption-chip ${selectedMonth === "" ? "active" : ""}`}
                onClick={() => setSelectedMonth("")}
              >
                全部
              </button>
              {monthOptions.map((month) => (
                <button
                  key={month}
                  type="button"
                  className={`consumption-chip ${selectedMonth === month ? "active" : ""}`}
                  onClick={() => setSelectedMonth(month)}
                >
                  {month}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="consumption-filter-inline">
          <span className="consumption-filter-label">分类筛选（多选）</span>
          <div className="consumption-chip-group">
            <button
              type="button"
              className={`consumption-chip ${selectedCategories.length === 0 ? "active" : ""}`}
              onClick={() => setSelectedCategories([])}
            >
              全部分类
            </button>
            {categoryOptionsAgg.slice(0, 24).map((row) => (
              <button
                key={row.category}
                type="button"
                className={`consumption-chip ${selectedCategories.includes(row.category) ? "active" : ""}`}
                onClick={() => toggleMulti(selectedCategories, row.category, setSelectedCategories)}
                title={`${row.category} | ${row.amount.toFixed(2)} 元 | ${row.count} 笔`}
              >
                {row.category}
              </button>
            ))}
          </div>
        </div>

        <div className="consumption-filter-inline">
          <span className="consumption-filter-label">商户筛选（多选）</span>
          <div className="consumption-chip-group">
            <button
              type="button"
              className={`consumption-chip ${selectedMerchants.length === 0 ? "active" : ""}`}
              onClick={() => setSelectedMerchants([])}
            >
              全部商户
            </button>
            {merchantOptionsAgg.slice(0, 30).map((row) => (
              <button
                key={row.merchant}
                type="button"
                className={`consumption-chip ${selectedMerchants.includes(row.merchant) ? "active" : ""}`}
                onClick={() => toggleMulti(selectedMerchants, row.merchant, setSelectedMerchants)}
                title={`${row.merchant} | ${row.amount.toFixed(2)} 元 | ${row.count} 笔`}
              >
                {row.merchant}
              </button>
            ))}
          </div>
        </div>

        {filterPills.length > 0 ? (
          <div className="consumption-pill-bar">
            {filterPills.map((pill) => (
              <span key={`${pill.kind}-${"value" in pill ? pill.value : ""}`} className="consumption-pill">
                <span>{pill.label}</span>
                <button
                  type="button"
                  aria-label={`移除筛选：${pill.label}`}
                  onClick={() => {
                    if (pill.kind === "month") setSelectedMonth("");
                    if (pill.kind === "hide_review") setExcludeNeedsReview(false);
                    if (pill.kind === "category" && "value" in pill) {
                      setSelectedCategories((prev) => prev.filter((v) => v !== pill.value));
                    }
                    if (pill.kind === "merchant" && "value" in pill) {
                      setSelectedMerchants((prev) => prev.filter((v) => v !== pill.value));
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="secondary-btn table-inline-btn"
              onClick={() => {
                setSelectedMonth("");
                setSelectedCategories([]);
                setSelectedMerchants([]);
                setExcludeNeedsReview(true);
              }}
            >
              清空筛选（恢复默认）
            </button>
          </div>
        ) : null}
      </div>

      <div className="preview-stat-grid">
        <PreviewStat label="筛选后消费总额(元)" value={formatCentsShort(filteredTotalCents)} tone={filteredTotalCents > 0 ? "good" : "warn"} />
        <PreviewStat label="筛选后消费笔数" value={filteredTx.length} />
        <PreviewStat label="筛选后待确认笔数" value={filteredReviewCount} tone={filteredReviewCount > 0 ? "warn" : "good"} />
        <PreviewStat label="筛选后待确认占比" value={formatRatePct(filteredReviewRatio)} />
        <PreviewStat label="全量消费总额(元)" value={totalText} tone={(total ?? 0) > 0 ? "default" : "warn"} />
        <PreviewStat label="全量消费笔数" value={count ?? 0} />
        <PreviewStat label="全量待确认笔数" value={reviewCount ?? 0} tone={(reviewCount ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="全量待确认占比" value={formatRatePct(reviewRatio)} />
        <PreviewStat label="排除笔数" value={excludedCount ?? 0} />
        <PreviewStat label="排除金额(元)" value={excludedTotalText} />
        <PreviewStat label="原始笔数" value={rawCount ?? 0} />
        <PreviewStat label="原始金额(元)" value={rawTotalText} />
        <PreviewStat label="输入文件数" value={inputFiles ?? 0} />
        <PreviewStat label="失败文件数" value={failedFiles ?? 0} tone={(failedFiles ?? 0) > 0 ? "warn" : "good"} />
      </div>

      <div className="preview-chart-grid">
        <div className="sparkline-card">
          <div className="sparkline-title">月度消费趋势</div>
          <LineAreaChart
            points={monthChartPoints}
            color="#7cc3ff"
            height={230}
            preferZeroBaseline
            maxXTicks={12}
            xLabelFormatter={(label) => (label.length >= 7 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
        <div className="sparkline-card">
          <div className="sparkline-title">分类分布（Top 8）</div>
          <div className="consumption-donut-wrap">
            <div className="consumption-donut" style={donutStyle}>
              <div className="consumption-donut-hole">
                <div className="consumption-donut-total-label">总额</div>
                <div className="consumption-donut-total-value">{totalText}</div>
              </div>
            </div>
            <div className="consumption-donut-legend">
              {donutStops.length > 0 ? (
                donutStops.map((item) => (
                  <div key={item.category} className="consumption-legend-row" title={`${item.category}: ${item.amount.toFixed(2)}`}>
                    <span className="consumption-legend-dot" style={{ backgroundColor: item.color }} />
                    <span className="consumption-legend-label">{item.category}</span>
                    <span className="consumption-legend-value">
                      {item.amount.toFixed(2)} ({donutTotal > 0 ? ((item.amount / donutTotal) * 100).toFixed(1) : "0.0"}%)
                    </span>
                  </div>
                ))
              ) : (
                <p className="placeholder">暂无分类分布数据。</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {categorySorted.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="分类" sortKey="category" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="笔数" sortKey="count" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="待确认" sortKey="review_count" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
              </tr>
            </thead>
            <tbody>
              {categorySorted.map((row, idx) => {
                const category = row.category;
                const amount = row.amount;
                const count = row.count;
                const review = row.review_count;
                return (
                  <tr key={`${category}-${idx}`}>
                    <td className="truncate-cell" title={category}>{category}</td>
                    <td className="num">{amount.toFixed(2)}</td>
                    <td className="num">{count}</td>
                    <td className={`num ${review > 0 ? "warn-text" : ""}`}>{review}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="preview-chart-grid">
        {monthSorted.length > 0 ? (
          <div className="sparkline-card">
            <div className="sparkline-title">月度分布</div>
            <div className="preview-table-wrap">
              <table className="preview-table compact">
                <thead>
                  <tr>
                    <th><SortableHeaderButton label="月份" sortKey="month" activeSortKey={monthSortKey} sortDir={monthSortDir} onToggle={(key) => {
                      const next = nextSortState(monthSortKey, monthSortDir, key); setMonthSortKey(next.key); setMonthSortDir(next.dir);
                    }} /></th>
                    <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount" activeSortKey={monthSortKey} sortDir={monthSortDir} onToggle={(key) => {
                      const next = nextSortState(monthSortKey, monthSortDir, key); setMonthSortKey(next.key); setMonthSortDir(next.dir);
                    }} /></th>
                    <th className="num"><SortableHeaderButton label="笔数" sortKey="count" activeSortKey={monthSortKey} sortDir={monthSortDir} onToggle={(key) => {
                      const next = nextSortState(monthSortKey, monthSortDir, key); setMonthSortKey(next.key); setMonthSortDir(next.dir);
                    }} /></th>
                  </tr>
                </thead>
                <tbody>
                  {monthSorted.map((row, idx) => (
                    <tr key={`${String(row.month)}-${idx}`}>
                      <td>{typeof row.month === "string" ? row.month : "-"}</td>
                      <td className="num">{typeof row.amount === "number" ? row.amount.toFixed(2) : "-"}</td>
                      <td className="num">{typeof row.count === "number" ? row.count : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {merchantSorted.length > 0 ? (
          <div className="sparkline-card">
            <div className="sparkline-title">高频商户（Top 20）</div>
            <div className="preview-table-wrap">
              <table className="preview-table compact">
                <thead>
                  <tr>
                    <th><SortableHeaderButton label="商户" sortKey="merchant" activeSortKey={merchantSortKey} sortDir={merchantSortDir} onToggle={(key) => {
                      const next = nextSortState(merchantSortKey, merchantSortDir, key); setMerchantSortKey(next.key); setMerchantSortDir(next.dir);
                    }} /></th>
                    <th><SortableHeaderButton label="分类" sortKey="category" activeSortKey={merchantSortKey} sortDir={merchantSortDir} onToggle={(key) => {
                      const next = nextSortState(merchantSortKey, merchantSortDir, key); setMerchantSortKey(next.key); setMerchantSortDir(next.dir);
                    }} /></th>
                    <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount" activeSortKey={merchantSortKey} sortDir={merchantSortDir} onToggle={(key) => {
                      const next = nextSortState(merchantSortKey, merchantSortDir, key); setMerchantSortKey(next.key); setMerchantSortDir(next.dir);
                    }} /></th>
                  </tr>
                </thead>
                <tbody>
                  {merchantSorted.slice(0, 20).map((row, idx) => (
                    <tr key={`${String(row.merchant)}-${idx}`}>
                      <td className="truncate-cell" title={typeof row.merchant === "string" ? row.merchant : undefined}>
                        {typeof row.merchant === "string" ? row.merchant : "-"}
                      </td>
                      <td>{typeof row.category === "string" ? row.category : "-"}</td>
                      <td className="num">{typeof row.amount === "number" ? row.amount.toFixed(2) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

    </div>
  );
}

function AdminDbStatsPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("row_count");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const dbPath = readString(data, "db_path") ?? "-";
  const confirmPhrase = readString(data, "confirm_phrase") ?? "-";
  const tableCount = readNumber(data, "summary.table_count");
  const totalRows = readNumber(data, "summary.total_rows");
  const sortedRows = [...rows].sort((a, b) => {
    const cmp = compareSortValues(
      sortKey === "table" ? a.table : a.row_count,
      sortKey === "table" ? b.table : b.row_count,
    );
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>DB Health Preview</h3>
        <div className="preview-subtle">
          <code>{dbPath}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Tables" value={tableCount ?? rows.length} />
        <PreviewStat
          label="Total Rows"
          value={typeof totalRows === "number" ? totalRows.toLocaleString() : "-"}
          tone={typeof totalRows === "number" && totalRows > 0 ? "good" : "warn"}
        />
        <PreviewStat label="Confirm Phrase" value={confirmPhrase} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="表名" sortKey="table" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="行数" sortKey="row_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const table = typeof row.table === "string" ? row.table : `row_${idx}`;
                const count = typeof row.row_count === "number" ? row.row_count : undefined;
                return (
                  <tr key={`${table}-${idx}`}>
                    <td>{table}</td>
                    <td className="num">{typeof count === "number" ? count.toLocaleString() : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="preview-note">No admin tables found in the current desktop DB.</p>
      )}
    </div>
  );
}

function RuntimeHealthPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const ok = readBool(data, "ok");
  const checkedAt = readString(data, "checked_at") ?? "-";
  const warnings = readArray(data, "warnings").filter((v): v is string => typeof v === "string");
  const failures = readArray(data, "failures").filter((v): v is string => typeof v === "string");
  const dbPath = readString(data, "checks.db_path") ?? "-";
  const totalRows = readNumber(data, "checks.db_stats.total_rows");
  const tableCount = readNumber(data, "checks.db_stats.table_count");
  const invCount = readNumber(data, "checks.accounts.investment_count");
  const cashCount = readNumber(data, "checks.accounts.cash_count");
  const reCount = readNumber(data, "checks.accounts.real_estate_count");
  const liabCount = readNumber(data, "checks.accounts.liability_count");
  const wealthRecon = readBool(data, "checks.wealth_overview.reconciliation_ok");
  const wealthRowCount = readNumber(data, "checks.wealth_overview.row_count");
  const wealthStale = readNumber(data, "checks.wealth_overview.stale_account_count");
  const portfolioCurveOk = readBool(data, "checks.portfolio_curve.ok");
  const portfolioCurvePoints = readNumber(data, "checks.portfolio_curve.points");
  const portfolioCurveReturn = readString(data, "checks.portfolio_curve.end_cumulative_return_pct_text") ?? "-";
  const portfolioCurveGrowth = readString(data, "checks.portfolio_curve.end_net_growth_yuan") ?? "-";

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Runtime Health Preview</h3>
        <div className="preview-subtle">
          checked_at <code>{checkedAt}</code>
        </div>
      </div>
      <div className="preview-subtle">
        DB: <code>{dbPath}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Overall" value={ok ? "PASS" : "FAIL"} tone={ok ? "good" : "warn"} />
        <PreviewStat label="Warnings" value={warnings.length} tone={warnings.length > 0 ? "warn" : "good"} />
        <PreviewStat label="Failures" value={failures.length} tone={failures.length > 0 ? "warn" : "good"} />
        <PreviewStat label="Tables" value={tableCount ?? "-"} />
        <PreviewStat
          label="Total Rows"
          value={typeof totalRows === "number" ? totalRows.toLocaleString() : "-"}
          tone={typeof totalRows === "number" && totalRows > 0 ? "good" : "warn"}
        />
        <PreviewStat label="Investment Accts" value={invCount ?? 0} />
        <PreviewStat label="Cash Accts" value={cashCount ?? 0} />
        <PreviewStat label="RE Accts" value={reCount ?? 0} />
        <PreviewStat label="Liability Accts" value={liabCount ?? 0} />
        <PreviewStat
          label="Wealth Recon"
          value={wealthRecon === undefined ? "-" : wealthRecon ? "OK" : "Mismatch"}
          tone={wealthRecon === false ? "warn" : wealthRecon ? "good" : "default"}
        />
        <PreviewStat label="Wealth Rows" value={wealthRowCount ?? "-"} />
        <PreviewStat label="Stale Accts" value={wealthStale ?? "-"} tone={(wealthStale ?? 0) > 0 ? "warn" : "good"} />
      </div>

      <div className="preview-stat-grid">
        <PreviewStat
          label="Portfolio Curve"
          value={portfolioCurveOk === undefined ? "-" : portfolioCurveOk ? "OK" : "Skipped/Warn"}
          tone={portfolioCurveOk === false ? "warn" : portfolioCurveOk ? "good" : "default"}
        />
        <PreviewStat label="Curve Points" value={portfolioCurvePoints ?? "-"} />
        <PreviewStat label="Curve Return" value={portfolioCurveReturn} />
        <PreviewStat label="Curve Growth (Yuan)" value={portfolioCurveGrowth} />
      </div>

      {warnings.length > 0 ? (
        <div className="preview-note">
          <strong>Warnings</strong>
          <ul className="text-list">
            {warnings.map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <div className="inline-error" role="alert">
          <strong>Failures</strong>
          <ul className="text-list">
            {failures.map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function InvestmentReturnsPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("return_rate_pct");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const errors = readArray(data, "errors").filter(isRecord);
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "account_name":
          return typeof row.account_name === "string" && row.account_name
            ? row.account_name
            : row.account_id;
        case "return_rate_pct":
          return row.return_rate_pct;
        case "annualized_rate_pct":
          return row.annualized_rate_pct;
        case "profit_cents":
          return row.profit_cents;
        case "effective_from":
          return row.effective_from;
        case "effective_to":
          return row.effective_to;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  const preset = readString(data, "range.preset") ?? "-";
  const avgReturnPct = readString(data, "summary.avg_return_pct") ?? "-";
  const accountCount = readNumber(data, "summary.account_count");
  const computedCount = readNumber(data, "summary.computed_count");
  const errorCount = readNumber(data, "summary.error_count");

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Investment Returns Compare</h3>
        <div className="preview-subtle">
          preset <code>{preset}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Accounts" value={accountCount ?? 0} />
        <PreviewStat label="Computed" value={computedCount ?? 0} tone={(computedCount ?? 0) > 0 ? "good" : "warn"} />
        <PreviewStat label="错误数" value={errorCount ?? 0} tone={(errorCount ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="Avg Return" value={avgReturnPct} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="收益率" sortKey="return_rate_pct" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="年化" sortKey="annualized_rate_pct" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="收益额" sortKey="profit_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th>
                  <SortableHeaderButton label="起始" sortKey="effective_from" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const name = (typeof row.account_name === "string" && row.account_name) || (typeof row.account_id === "string" ? row.account_id : "-");
                const rr = typeof row.return_rate_pct === "string" ? row.return_rate_pct : "-";
                const ar = typeof row.annualized_rate_pct === "string" ? row.annualized_rate_pct : "-";
                const profit = typeof row.profit_cents === "number" ? formatCentsShort(row.profit_cents) : "-";
                const from = typeof row.effective_from === "string" ? row.effective_from : "-";
                const to = typeof row.effective_to === "string" ? row.effective_to : "-";
                return (
                  <tr key={`${name}-${idx}`}>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td className="num">{rr}</td>
                    <td className="num">{ar}</td>
                    <td className="num">{profit}</td>
                    <td>{from} ~ {to}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {errors.length > 0 ? (
        <div className="preview-note">
          <strong>Top 错误数</strong>
          <ul className="text-list">
            {errors.slice(0, 5).map((row, idx) => {
              const name = (typeof row.account_name === "string" && row.account_name) || (typeof row.account_id === "string" ? row.account_id : `row_${idx}`);
              const msg = typeof row.error === "string" ? row.error : "Unknown error";
              return <li key={`${name}-${idx}`}>{name}: {msg}</li>;
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function MetaAccountsPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("latest_snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const kind = readString(data, "kind") ?? "-";
  const selected = readArray(data, "accounts").length;
  const inv = readArray(data, "investment_accounts").length;
  const cash = readArray(data, "cash_accounts").length;
  const re = readArray(data, "real_estate_accounts").length;
  const liab = readArray(data, "liability_accounts").length;
  const rows = readArray(data, "accounts").filter(isRecord);
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "account_name":
          return row.account_name ?? row.account_id;
        case "kind_or_type":
          return row.asset_class ?? row.account_type ?? "investment";
        case "record_count":
          return row.record_count;
        case "latest_snapshot_date":
          return row.latest_snapshot_date;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Meta Accounts</h3>
        <div className="preview-subtle">kind <code>{kind}</code></div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Selected" value={selected} />
        <PreviewStat label="Investment" value={inv} />
        <PreviewStat label="Cash" value={cash} />
        <PreviewStat label="Real Estate" value={re} />
        <PreviewStat label="Liability" value={liab} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="类型/分类" sortKey="kind_or_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="记录数" sortKey="record_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="最新日期" sortKey="latest_snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const name = (typeof row.account_name === "string" && row.account_name) || (typeof row.account_id === "string" ? row.account_id : "-");
                const typeOrClass =
                  (typeof row.asset_class === "string" && row.asset_class) ||
                  (typeof row.account_type === "string" && row.account_type) ||
                  "investment";
                const count = typeof row.record_count === "number" ? row.record_count : "-";
                const latest = typeof row.latest_snapshot_date === "string" ? row.latest_snapshot_date : "-";
                return (
                  <tr key={`${name}-${idx}`}>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td>{typeOrClass}</td>
                    <td className="num">{String(count)}</td>
                    <td>{latest}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function TransactionsPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("posted_at");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const total = readNumber(data, "summary.total_amount_cents");
  const excluded = readNumber(data, "summary.excluded_count_in_rows");
  const sort = readString(data, "summary.sort") ?? "-";
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "posted_at":
          return (typeof row.posted_at === "string" && row.posted_at) ||
            (typeof row.occurred_at === "string" ? row.occurred_at : "");
        case "merchant":
          return (typeof row.merchant === "string" && row.merchant) ||
            (typeof row.merchant_normalized === "string" ? row.merchant_normalized : "");
        case "expense_category":
          return row.expense_category;
        case "amount_cents":
          return row.amount_cents;
        case "manual_excluded":
          return row.manual_excluded === true ? 1 : 0;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>交易查询</h3>
        <div className="preview-subtle">sort <code>{sort}</code></div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Total (Yuan)" value={formatCentsShort(total)} />
        <PreviewStat label="排除数 In Rows" value={excluded ?? 0} tone={(excluded ?? 0) > 0 ? "warn" : "default"} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="日期" sortKey="posted_at" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="商户" sortKey="merchant" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="分类" sortKey="expense_category" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="金额" sortKey="amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="标记" sortKey="manual_excluded" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const date =
                  (typeof row.posted_at === "string" && row.posted_at) ||
                  (typeof row.occurred_at === "string" ? row.occurred_at : "-");
                const merchant =
                  (typeof row.merchant === "string" && row.merchant) ||
                  (typeof row.merchant_normalized === "string" ? row.merchant_normalized : "-");
                const cat = typeof row.expense_category === "string" ? row.expense_category : "-";
                const amt = typeof row.amount_cents === "number" ? formatCentsShort(row.amount_cents) : "-";
                const manual排除数 = row.manual_excluded === true;
                return (
                  <tr key={`${date}-${idx}`}>
                    <td>{date}</td>
                    <td className="truncate-cell" title={merchant}>{merchant}</td>
                    <td>{cat}</td>
                    <td className="num">{amt}</td>
                    <td>{manual排除数 ? "manual_excluded" : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function InvestmentsListPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const latestAssets = readNumber(data, "summary.latest_total_assets_cents");
  const netFlow = readNumber(data, "summary.net_transfer_amount_cents");
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "snapshot_date":
          return row.snapshot_date;
        case "account_name":
          return row.account_name ?? row.account_id;
        case "total_assets_cents":
          return row.total_assets_cents;
        case "transfer_amount_cents":
          return row.transfer_amount_cents;
        case "source_type":
          return row.source_type;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>投资记录查询</h3>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Latest Assets (Yuan)" value={formatCentsShort(latestAssets)} />
        <PreviewStat label="Net Transfer (Yuan)" value={formatCentsShort(netFlow)} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="日期" sortKey="snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="总资产" sortKey="total_assets_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="净转入" sortKey="transfer_amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="来源" sortKey="source_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const date = typeof row.snapshot_date === "string" ? row.snapshot_date : "-";
                const name =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (typeof row.account_id === "string" ? row.account_id : "-");
                const assets = typeof row.total_assets_cents === "number" ? formatCentsShort(row.total_assets_cents) : "-";
                const transfer = typeof row.transfer_amount_cents === "number" ? formatCentsShort(row.transfer_amount_cents) : "-";
                const source = typeof row.source_type === "string" ? row.source_type : "-";
                return (
                  <tr key={`${date}-${idx}`}>
                    <td>{date}</td>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td className="num">{assets}</td>
                    <td className="num">{transfer}</td>
                    <td>{source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function AssetValuationsPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const total = readNumber(data, "summary.sum_value_cents");
  const assetClass = readString(data, "summary.asset_class") ?? "";
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "snapshot_date":
          return row.snapshot_date;
        case "account_name":
          return row.account_name ?? row.account_id;
        case "asset_class":
          return row.asset_class;
        case "value_cents":
          return row.value_cents;
        case "source_type":
          return row.source_type;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>资产估值查询</h3>
        <div className="preview-subtle">
          class <code>{assetClass || "all"}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Sum Value (Yuan)" value={formatCentsShort(total)} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="日期" sortKey="snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="分类" sortKey="asset_class" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="数值" sortKey="value_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="来源" sortKey="source_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const date = typeof row.snapshot_date === "string" ? row.snapshot_date : "-";
                const name =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (typeof row.account_id === "string" ? row.account_id : "-");
                const cls = typeof row.asset_class === "string" ? row.asset_class : "-";
                const value = typeof row.value_cents === "number" ? formatCentsShort(row.value_cents) : "-";
                const source = typeof row.source_type === "string" ? row.source_type : "-";
                return (
                  <tr key={`${date}-${idx}`}>
                    <td>{date}</td>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td>{cls}</td>
                    <td className="num">{value}</td>
                    <td>{source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function AccountCatalogPreview({ data }: { data: unknown }) {
  const [sortKey, setSortKey] = useState<string>("updated_at");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const kind = readString(data, "summary.kind") ?? "-";
  const keyword = readString(data, "summary.keyword") ?? "";
  const groups = ["investment", "cash", "real_estate", "bank", "credit_card", "wallet", "liability", "other"];
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "account_name":
          return row.account_name ?? row.account_id;
        case "account_kind":
          return row.account_kind;
        case "account_type":
          return row.account_type;
        case "transaction_count":
          return row.transaction_count;
        case "investment_record_count":
          return row.investment_record_count;
        case "asset_valuation_count":
          return row.asset_valuation_count;
        case "updated_at":
          return row.updated_at;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>账户目录</h3>
        <div className="preview-subtle">
          kind <code>{kind}</code> {keyword ? <>| keyword <code>{keyword}</code></> : null}
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Rows" value={count ?? 0} />
        {groups.slice(0, 7).map((g) => (
          <PreviewStat key={g} label={g} value={readArray(data, `groups.${g}`).length} />
        ))}
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="种类" sortKey="account_kind" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="类型" sortKey="account_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="交易" sortKey="transaction_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="投资" sortKey="investment_record_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="资产" sortKey="asset_valuation_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="更新时间" sortKey="updated_at" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const name =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (typeof row.account_id === "string" ? row.account_id : "-");
                const kindVal = typeof row.account_kind === "string" ? row.account_kind : "-";
                const typeVal = typeof row.account_type === "string" ? row.account_type : "-";
                const tx = typeof row.transaction_count === "number" ? row.transaction_count : 0;
                const inv = typeof row.investment_record_count === "number" ? row.investment_record_count : 0;
                const asset = typeof row.asset_valuation_count === "number" ? row.asset_valuation_count : 0;
                const updated = typeof row.updated_at === "string" ? row.updated_at : "-";
                return (
                  <tr key={`${name}-${idx}`}>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td>{kindVal}</td>
                    <td>{typeVal}</td>
                    <td className="num">{tx}</td>
                    <td className="num">{inv}</td>
                    <td className="num">{asset}</td>
                    <td>{updated}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function makeInitialSmokeRows(): SmokeRow[] {
  return [
    { key: "investment-return", label: "投资区间收益率", status: "idle" },
    { key: "investment-curve", label: "投资曲线", status: "idle" },
    { key: "wealth-overview", label: "财富总览", status: "idle" },
    { key: "wealth-curve", label: "财富曲线", status: "idle" },
  ];
}

function withSmokeResult(rows: SmokeRow[], next: SmokeRow): SmokeRow[] {
  return rows.map((row) => (row.key === next.key ? next : row));
}

function makeInitialImportStepRows(): ImportStepRow[] {
  return [
    { key: "yzxy", label: "有知有行 XLSX/CSV", status: "idle" },
    { key: "cmb-eml", label: "招行信用卡 EML", status: "idle" },
    { key: "cmb-pdf", label: "招行银行流水 PDF", status: "idle" },
  ];
}

function summarizeInvestmentReturnPayload(payload: unknown): string {
  const account = readString(payload, "account_name") ?? readString(payload, "account_id") ?? "-";
  const rate = formatRatePct(readNumber(payload, "metrics.return_rate"));
  const profit = formatCentsShort(readNumber(payload, "metrics.profit_cents"));
  return `${account} | return=${rate} | profit=${profit}`;
}

function summarizeInvestmentCurvePayload(payload: unknown): string {
  const points = readNumber(payload, "summary.count") ?? readArray(payload, "rows").length;
  const endAssets = formatCentsShort(readNumber(payload, "summary.end_assets_cents"));
  const endReturn = formatRatePct(readNumber(payload, "summary.end_cumulative_return_rate"));
  return `points=${points} | end_assets=${endAssets} | end_return=${endReturn}`;
}

function summarizeWealthOverviewPayload(payload: unknown): string {
  const asOf = readString(payload, "as_of") ?? "-";
  const netAssets = formatCentsShort(readNumber(payload, "summary.net_asset_total_cents"));
  const stale = readNumber(payload, "summary.stale_account_count") ?? 0;
  const recon = readBool(payload, "summary.reconciliation_ok") ? "OK" : "Mismatch";
  return `as_of=${asOf} | net=${netAssets} | stale=${stale} | recon=${recon}`;
}

function summarizeWealthCurvePayload(payload: unknown): string {
  const points = readNumber(payload, "range.points") ?? readArray(payload, "rows").length;
  const endWealth = formatCentsShort(readNumber(payload, "summary.end_wealth_cents"));
  const changePct = formatPct(readNumber(payload, "summary.change_pct"));
  return `points=${points} | end_wealth=${endWealth} | change=${changePct}`;
}

function summarizeYzxyPreviewPayload(payload: unknown): string {
  const parserKind = readString(payload, "parser_kind") ?? "-";
  const parsedCount = readNumber(payload, "parsed_count") ?? 0;
  const errorCount = readNumber(payload, "error_count") ?? 0;
  return `parser=${parserKind} | parsed=${parsedCount} | errors=${errorCount}`;
}

function summarizeYzxyImportPayload(payload: unknown): string {
  const imported = readNumber(payload, "imported_count") ?? 0;
  const errors = readNumber(payload, "error_count") ?? 0;
  const parserKind = readString(payload, "preview.parser_kind") ?? "-";
  return `imported=${imported} | errors=${errors} | parser=${parserKind}`;
}

function summarizeCmbEmlPreviewPayload(payload: unknown): string {
  const files = readNumber(payload, "summary.input_files_count") ?? 0;
  const records = readNumber(payload, "summary.records_count") ?? 0;
  const review = readNumber(payload, "summary.needs_review_count") ?? 0;
  return `files=${files} | records=${records} | needs_review=${review}`;
}

function summarizeCmbEmlImportPayload(payload: unknown): string {
  const imported = readNumber(payload, "imported_count") ?? 0;
  const errors = readNumber(payload, "import_error_count") ?? 0;
  const records = readNumber(payload, "summary.records_count") ?? 0;
  return `imported=${imported} | errors=${errors} | records=${records}`;
}

function summarizeCmbBankPdfPreviewPayload(payload: unknown): string {
  const importRows = readNumber(payload, "summary.import_rows_count") ?? 0;
  const total = readNumber(payload, "summary.total_records") ?? 0;
  const expense = readNumber(payload, "summary.expense_rows_count") ?? 0;
  const income = readNumber(payload, "summary.income_rows_count") ?? 0;
  return `records=${total} | import_rows=${importRows} | expense=${expense} | income=${income}`;
}

function summarizeCmbBankPdfImportPayload(payload: unknown): string {
  const imported = readNumber(payload, "imported_count") ?? 0;
  const errors = readNumber(payload, "import_error_count") ?? 0;
  const importRows = readNumber(payload, "preview.summary.import_rows_count") ?? 0;
  return `imported=${imported} | errors=${errors} | import_rows=${importRows}`;
}

function YzxyPreviewSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行预览，查看解析摘要与样例行。</p>;
  }
  const file = readString(data, "file") ?? "-";
  const parserKind = readString(data, "parser_kind") ?? "-";
  const parsedCount = readNumber(data, "parsed_count") ?? 0;
  const errorCount = readNumber(data, "error_count") ?? 0;
  const previewRows = readArray(data, "preview_rows").length;
  const mapping = readPath(data, "mapping");
  const mappingCount = isRecord(mapping) ? Object.keys(mapping).length : 0;
  const errors = readArray(data, "errors").filter((v): v is string => typeof v === "string").slice(0, 5);

  return (
    <>
      <div className="preview-subtle">
        文件： <code>{file}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Parser" value={parserKind} />
        <PreviewStat label="解析行数" value={parsedCount} tone={parsedCount > 0 ? "good" : "warn"} />
        <PreviewStat label="预览行数" value={previewRows} />
        <PreviewStat label="映射字段数" value={mappingCount} />
        <PreviewStat label="错误数" value={errorCount} tone={errorCount > 0 ? "warn" : "good"} />
      </div>
      {errors.length > 0 ? (
        <ul className="text-list">
          {errors.map((err, idx) => (
            <li key={`${idx}-${err}`}>{err}</li>
          ))}
        </ul>
      ) : (
        <div className="preview-note">预览结果正常，可以继续导入。</div>
      )}
    </>
  );
}

function YzxyImportSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) return <p className="placeholder">尚未导入。请先确认预览结果后执行导入。</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const sourceType = readString(data, "source_type") ?? "-";
  const parserKind = readString(data, "preview.parser_kind") ?? "-";
  return (
    <>
      <div className="preview-subtle">
        source_type <code>{sourceType}</code> | parser <code>{parserKind}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="导入成功" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="错误数" value={errors} tone={errors > 0 ? "warn" : "good"} />
      </div>
      <div className="preview-note">
        导入任务 ID： <code>{jobId}</code>
      </div>
    </>
  );
}

function CmbEmlPreviewSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行预览，查看解析/分类摘要后再导入。</p>;
  }
  const files = readNumber(data, "summary.input_files_count") ?? 0;
  const records = readNumber(data, "summary.records_count") ?? 0;
  const consume = readNumber(data, "summary.consume_count") ?? 0;
  const review = readNumber(data, "summary.needs_review_count") ?? 0;
  const excluded = readNumber(data, "summary.excluded_count") ?? 0;
  const failed = readNumber(data, "summary.failed_files_count") ?? 0;
  const failedFiles = readArray(data, "summary.failed_files").filter(isRecord).slice(0, 5);

  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="EML 文件数" value={files} />
        <PreviewStat label="记录数" value={records} tone={records > 0 ? "good" : "warn"} />
        <PreviewStat label="消费记录数" value={consume} />
        <PreviewStat label="待确认数" value={review} tone={review > 0 ? "warn" : "good"} />
        <PreviewStat label="排除数" value={excluded} />
        <PreviewStat label="失败文件数" value={failed} tone={failed > 0 ? "warn" : "good"} />
      </div>
      {failedFiles.length > 0 ? (
        <ul className="text-list">
          {failedFiles.map((row, idx) => {
            const file = typeof row.file === "string" ? row.file : "unknown";
            const err = typeof row.error === "string" ? row.error : "unknown";
            return <li key={`${idx}-${file}`}>{`${file}: ${err}`}</li>;
          })}
        </ul>
      ) : (
        <div className="preview-note">预览摘要已生成，请确认数量和待确认项后再导入。</div>
      )}
    </>
  );
}

function CmbEmlImportSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) return <p className="placeholder">尚未导入。请先确认预览结果后执行导入。</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "import_error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const records = readNumber(data, "summary.records_count") ?? 0;
  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="导入成功" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="导入错误数" value={errors} tone={errors > 0 ? "warn" : "good"} />
        <PreviewStat label="预览记录数" value={records} />
      </div>
      <div className="preview-note">
        导入任务 ID： <code>{jobId}</code>
      </div>
    </>
  );
}

function CmbBankPdfPreviewSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行预览，确认规则分类摘要后再导入。</p>;
  }
  const accountLast4 = readString(data, "header.account_last4") ?? "-";
  const rangeStart = readString(data, "header.range_start") ?? "-";
  const rangeEnd = readString(data, "header.range_end") ?? "-";
  const total = readNumber(data, "summary.total_records") ?? 0;
  const importRows = readNumber(data, "summary.import_rows_count") ?? 0;
  const expenseRows = readNumber(data, "summary.expense_rows_count") ?? 0;
  const incomeRows = readNumber(data, "summary.income_rows_count") ?? 0;
  const expenseTotal = readNumber(data, "summary.expense_total_cents");
  const incomeTotal = readNumber(data, "summary.income_total_cents");
  const ruleCountsRaw = readPath(data, "rule_counts");
  const ruleEntries = isRecord(ruleCountsRaw)
    ? Object.entries(ruleCountsRaw)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];

  return (
    <>
      <div className="preview-subtle">
        账户尾号 <code>{accountLast4}</code> | 区间 <code>{rangeStart}</code> ~ <code>{rangeEnd}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="总记录数" value={total} />
        <PreviewStat label="可导入行数" value={importRows} tone={importRows > 0 ? "good" : "warn"} />
        <PreviewStat label="支出行数" value={expenseRows} />
        <PreviewStat label="收入行数" value={incomeRows} />
        <PreviewStat label="支出合计（元）" value={formatCentsShort(expenseTotal)} />
        <PreviewStat label="收入合计（元）" value={formatCentsShort(incomeTotal)} />
      </div>
      {ruleEntries.length > 0 ? (
        <div className="preview-subtle">
          规则命中统计：{" "}
          {ruleEntries.map(([k, v]) => (
            <span key={k}>
              <code>{k}</code>={v}{" "}
            </span>
          ))}
        </div>
      ) : null}
      <div className="preview-note">请确认规则命中统计与样例后再导入。</div>
    </>
  );
}

function CmbBankPdfImportSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) return <p className="placeholder">尚未导入。请先确认预览结果后执行导入。</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "import_error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const importRows = readNumber(data, "preview.summary.import_rows_count") ?? 0;
  const expenseRows = readNumber(data, "preview.summary.expense_rows_count") ?? 0;
  const incomeRows = readNumber(data, "preview.summary.income_rows_count") ?? 0;
  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="导入成功" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="导入错误数" value={errors} tone={errors > 0 ? "warn" : "good"} />
        <PreviewStat label="预览可导入行数" value={importRows} />
        <PreviewStat label="支出行数" value={expenseRows} />
        <PreviewStat label="收入行数" value={incomeRows} />
      </div>
      <div className="preview-note">
        导入任务 ID： <code>{jobId}</code>
      </div>
    </>
  );
}

function MerchantSuggestionsPreview({
  data,
  onPickRow,
}: {
  data: unknown;
  onPickRow?: (row: {
    merchant_normalized: string;
    suggested_expense_category: string;
    mapped_expense_category: string;
  }) => void;
}) {
  const [sortKey, setSortKey] = useState<string>("review_count");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行查询，查看可用于规则回填的商户建议。</p>;
  }
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count") ?? rows.length;
  const onlyUnmapped = readBool(data, "summary.only_unmapped");
  const keyword = readString(data, "summary.keyword") ?? "";
  const sortedRows = [...rows].sort((a, b) => {
    const normalize = (row: Record<string, unknown>) => {
      const raw = row[sortKey];
      if (typeof raw === "number") return raw;
      if (typeof raw === "string") {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) return n;
        return raw.toLowerCase();
      }
      if (raw == null) return "";
      return String(raw).toLowerCase();
    };
    const av = normalize(a);
    const bv = normalize(b);
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const columns: Array<{ key: string; label: string; sortable?: boolean; className?: string }> = [
    { key: "__action__", label: "操作", sortable: false },
    { key: "merchant_normalized", label: "商户" },
    { key: "suggested_expense_category", label: "建议分类" },
    { key: "mapped_expense_category", label: "已映射分类" },
    { key: "txn_count", label: "交易数", className: "num" },
    { key: "review_count", label: "待确认数", className: "num" },
    { key: "total_amount_cents", label: "总金额(元)", className: "num" },
  ];

  return (
    <div className="subcard">
      <h3>商户建议预览</h3>
      <div className="preview-stat-grid">
        <PreviewStat label="记录数" value={count} tone={count > 0 ? "good" : "warn"} />
        <PreviewStat label="仅未映射" value={String(onlyUnmapped ?? false)} />
        <PreviewStat label="关键词" value={keyword || "-"} />
      </div>
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={col.className ?? ""}>
                    {col.sortable === false ? (
                      col.label
                    ) : (
                      <button
                        type="button"
                        className="table-sort-btn"
                        onClick={() => {
                          const next = nextSortState(sortKey, sortDir, col.key);
                          setSortKey(next.key);
                          setSortDir(next.dir);
                        }}
                        title={`按 ${col.label} 排序`}
                      >
                        <span>{col.label}</span>
                        <span className="table-sort-indicator">
                          {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const merchant = typeof row.merchant_normalized === "string" ? row.merchant_normalized : "-";
                const suggested =
                  typeof row.suggested_expense_category === "string" && row.suggested_expense_category
                    ? row.suggested_expense_category
                    : "-";
                const mapped =
                  typeof row.mapped_expense_category === "string" && row.mapped_expense_category
                    ? row.mapped_expense_category
                    : "-";
                const txnCount = typeof row.txn_count === "number" ? row.txn_count : 0;
                const reviewCount = typeof row.review_count === "number" ? row.review_count : 0;
                const totalYuan =
                  typeof row.total_amount_yuan === "string"
                    ? row.total_amount_yuan
                    : typeof row.total_amount_cents === "number"
                      ? (row.total_amount_cents / 100).toFixed(2)
                      : "-";
                return (
                  <tr key={`${merchant}-${idx}`}>
                    <td>
                      <button
                        type="button"
                        className="secondary-btn table-inline-btn"
                        onClick={() =>
                          onPickRow?.({
                            merchant_normalized: merchant,
                            suggested_expense_category:
                              typeof row.suggested_expense_category === "string"
                                ? row.suggested_expense_category
                                : "",
                            mapped_expense_category:
                              typeof row.mapped_expense_category === "string"
                                ? row.mapped_expense_category
                                : "",
                          })
                        }
                        disabled={!onPickRow || merchant === "-"}
                        title="回填到 Merchant Map 表单"
                      >
                        回填
                      </button>
                    </td>
                    <td className="truncate-cell" title={merchant}>{merchant}</td>
                    <td>{suggested}</td>
                    <td>{mapped}</td>
                    <td className="num">{txnCount}</td>
                    <td className="num">{reviewCount}</td>
                    <td className="num">{totalYuan}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="placeholder">暂无建议记录（可能没有消费交易，或商户都已映射）。</p>
      )}
    </div>
  );
}

type RulesPreviewColumn = {
  key: string;
  label: string;
  kind?: "text" | "bool01";
};

type TableSortDirection = "asc" | "desc";

function nextSortState(
  currentKey: string | null,
  currentDir: TableSortDirection,
  clickedKey: string,
): { key: string; dir: TableSortDirection } {
  if (currentKey !== clickedKey) {
    return { key: clickedKey, dir: "asc" };
  }
  return { key: clickedKey, dir: currentDir === "asc" ? "desc" : "asc" };
}

function compareSortValues(a: unknown, b: unknown): number {
  const normalize = (value: unknown): string | number => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      const num = Number(trimmed);
      if (trimmed !== "" && Number.isFinite(num)) return num;
      return value.toLowerCase();
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value == null) return "";
    return String(value).toLowerCase();
  };
  const av = normalize(a);
  const bv = normalize(b);
  if (typeof av === "number" && typeof bv === "number") {
    return av - bv;
  }
  return String(av).localeCompare(String(bv), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function SortableHeaderButton({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onToggle,
}: {
  label: string;
  sortKey: string;
  activeSortKey: string | null;
  sortDir: TableSortDirection;
  onToggle: (sortKey: string) => void;
}) {
  return (
    <button
      type="button"
      className="table-sort-btn"
      onClick={() => onToggle(sortKey)}
      title={`按 ${label} 排序`}
    >
      <span>{label}</span>
      <span className="table-sort-indicator">
        {activeSortKey === sortKey ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}

function RulesRowsPreview({
  title,
  data,
  emptyText,
  columns,
}: {
  title: string;
  data: unknown;
  emptyText: string;
  columns: RulesPreviewColumn[];
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<TableSortDirection>("asc");

  if (!isRecord(data)) {
    return <p className="placeholder">{emptyText}</p>;
  }

  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count") ?? rows.length;
  const filePath = readString(data, "summary.file_path") ?? "";

  const sortedRows = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return 0;

    const normalize = (row: Record<string, unknown>) => {
      const raw = row[sortKey];
      if (col.kind === "bool01") {
        if (typeof raw === "number") return raw;
        const n = Number(raw ?? 0);
        return Number.isFinite(n) ? n : 0;
      }
      if (typeof raw === "number") return raw;
      if (typeof raw === "string") {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) return n;
        return raw.toLowerCase();
      }
      if (raw == null) return "";
      return String(raw).toLowerCase();
    };

    const av = normalize(a);
    const bv = normalize(b);
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const renderCell = (row: Record<string, unknown>, col: RulesPreviewColumn) => {
    const value = row[col.key];
    if (col.kind === "bool01") {
      const num = typeof value === "number" ? value : Number(value ?? 0);
      return num === 1 ? "是" : "否";
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "string") {
      return value || "-";
    }
    if (value == null) {
      return "-";
    }
    return String(value);
  };

  return (
    <div className="subcard">
      <h3>{title}</h3>
      <div className="preview-stat-grid">
        <PreviewStat label="记录数" value={count} tone={count > 0 ? "good" : "warn"} />
        <PreviewStat label="当前显示" value={sortedRows.length} />
      </div>
      {filePath ? (
        <div className="preview-subtle">
          文件：<code>{filePath}</code>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>
                    <button
                      type="button"
                      className="table-sort-btn"
                      onClick={() => {
                        const next = nextSortState(sortKey, sortDir, col.key);
                        setSortKey(next.key);
                        setSortDir(next.dir);
                      }}
                      title={`按 ${col.label} 排序`}
                    >
                      <span>{col.label}</span>
                      <span className="table-sort-indicator">
                        {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => (
                <tr key={idx}>
                  {columns.map((col) => (
                    <td key={col.key} className={String(renderCell(row, col)).length > 30 ? "truncate-cell" : ""} title={String(renderCell(row, col))}>
                      {renderCell(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="placeholder">查询成功，但当前没有匹配规则行。</p>
      )}
    </div>
  );
}

function RulesAdminPanel({ showRawJson }: { showRawJson: boolean }) {
  const errMsg = (err: unknown) =>
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";

  const [merchantQueryBusy, setMerchantQueryBusy] = useState(false);
  const [merchantQueryError, setMerchantQueryError] = useState("");
  const [merchantQueryResult, setMerchantQueryResult] = useState<RulesQueryPayload | null>(null);
  const [merchantQuery, setMerchantQuery] = useState<RulesListQueryRequest>({ keyword: "", limit: 100 });
  const [merchantUpsertBusy, setMerchantUpsertBusy] = useState(false);
  const [merchantUpsertError, setMerchantUpsertError] = useState("");
  const [merchantUpsertResult, setMerchantUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [merchantUpsertForm, setMerchantUpsertForm] = useState<MerchantMapUpsertRequest>({
    merchant_normalized: "",
    expense_category: "",
    confidence: "0.95",
    note: "",
  });
  const [merchantDeleteBusy, setMerchantDeleteBusy] = useState(false);
  const [merchantDeleteError, setMerchantDeleteError] = useState("");
  const [merchantDeleteResult, setMerchantDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [merchantDeleteForm, setMerchantDeleteForm] = useState<MerchantMapDeleteRequest>({
    merchant_normalized: "",
  });
  const [merchantSuggestionsBusy, setMerchantSuggestionsBusy] = useState(false);
  const [merchantSuggestionsError, setMerchantSuggestionsError] = useState("");
  const [merchantSuggestionsResult, setMerchantSuggestionsResult] = useState<RulesQueryPayload | null>(null);
  const [merchantSuggestionsQuery, setMerchantSuggestionsQuery] = useState<MerchantRuleSuggestionsQueryRequest>({
    keyword: "",
    limit: 100,
    only_unmapped: "true",
  });

  const [categoryQueryBusy, setCategoryQueryBusy] = useState(false);
  const [categoryQueryError, setCategoryQueryError] = useState("");
  const [categoryQueryResult, setCategoryQueryResult] = useState<RulesQueryPayload | null>(null);
  const [categoryQuery, setCategoryQuery] = useState<RulesListQueryRequest>({ keyword: "", limit: 100 });
  const [categoryUpsertBusy, setCategoryUpsertBusy] = useState(false);
  const [categoryUpsertError, setCategoryUpsertError] = useState("");
  const [categoryUpsertResult, setCategoryUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [categoryUpsertForm, setCategoryUpsertForm] = useState<CategoryRuleUpsertRequest>({
    priority: "500",
    match_type: "contains",
    pattern: "",
    expense_category: "",
    confidence: "0.70",
    note: "",
  });
  const [categoryDeleteBusy, setCategoryDeleteBusy] = useState(false);
  const [categoryDeleteError, setCategoryDeleteError] = useState("");
  const [categoryDeleteResult, setCategoryDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [categoryDeleteForm, setCategoryDeleteForm] = useState<CategoryRuleDeleteRequest>({
    match_type: "contains",
    pattern: "",
  });

  const [bankQueryBusy, setBankQueryBusy] = useState(false);
  const [bankQueryError, setBankQueryError] = useState("");
  const [bankQueryResult, setBankQueryResult] = useState<RulesQueryPayload | null>(null);
  const [bankQuery, setBankQuery] = useState<BankTransferWhitelistQueryRequest>({
    keyword: "",
    limit: 100,
    active_only: "false",
  });
  const [bankUpsertBusy, setBankUpsertBusy] = useState(false);
  const [bankUpsertError, setBankUpsertError] = useState("");
  const [bankUpsertResult, setBankUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [bankUpsertForm, setBankUpsertForm] = useState<BankTransferWhitelistUpsertRequest>({
    name: "",
    is_active: "true",
    note: "",
  });
  const [bankDeleteBusy, setBankDeleteBusy] = useState(false);
  const [bankDeleteError, setBankDeleteError] = useState("");
  const [bankDeleteResult, setBankDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [bankDeleteForm, setBankDeleteForm] = useState<BankTransferWhitelistDeleteRequest>({ name: "" });

  const [exclQueryBusy, setExclQueryBusy] = useState(false);
  const [exclQueryError, setExclQueryError] = useState("");
  const [exclQueryResult, setExclQueryResult] = useState<RulesQueryPayload | null>(null);
  const [exclQuery, setExclQuery] = useState<AnalysisExclusionQueryRequest>({
    keyword: "",
    limit: 100,
    enabled_only: "false",
  });
  const [exclUpsertBusy, setExclUpsertBusy] = useState(false);
  const [exclUpsertError, setExclUpsertError] = useState("");
  const [exclUpsertResult, setExclUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [exclUpsertForm, setExclUpsertForm] = useState<AnalysisExclusionUpsertRequest>({
    enabled: "true",
    rule_name: "",
    merchant_contains: "",
    description_contains: "",
    expense_category: "",
    min_amount: "",
    max_amount: "",
    start_date: "",
    end_date: "",
    reason: "排除分析",
  });
  const [exclDeleteBusy, setExclDeleteBusy] = useState(false);
  const [exclDeleteError, setExclDeleteError] = useState("");
  const [exclDeleteResult, setExclDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [exclDeleteForm, setExclDeleteForm] = useState<AnalysisExclusionDeleteRequest>({ rule_name: "" });

  const anyBusy =
    merchantQueryBusy ||
    merchantUpsertBusy ||
    merchantDeleteBusy ||
    merchantSuggestionsBusy ||
    categoryQueryBusy ||
    categoryUpsertBusy ||
    categoryDeleteBusy ||
    bankQueryBusy ||
    bankUpsertBusy ||
    bankDeleteBusy ||
    exclQueryBusy ||
    exclUpsertBusy ||
    exclDeleteBusy;

  async function handleMerchantQuery() {
    setMerchantQueryBusy(true);
    setMerchantQueryError("");
    try {
      const payload = await queryMerchantMapRules({
        keyword: `${merchantQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(merchantQuery.limit, 100),
      });
      startTransition(() => setMerchantQueryResult(payload));
    } catch (err) {
      setMerchantQueryError(errMsg(err));
    } finally {
      setMerchantQueryBusy(false);
    }
  }

  async function handleMerchantUpsert() {
    setMerchantUpsertBusy(true);
    setMerchantUpsertError("");
    try {
      const payload = await upsertMerchantMapRule({
        merchant_normalized: `${merchantUpsertForm.merchant_normalized ?? ""}`.trim(),
        expense_category: `${merchantUpsertForm.expense_category ?? ""}`.trim(),
        confidence: `${merchantUpsertForm.confidence ?? ""}`.trim(),
        note: `${merchantUpsertForm.note ?? ""}`.trim(),
      });
      startTransition(() => setMerchantUpsertResult(payload));
      void handleMerchantQuery();
    } catch (err) {
      setMerchantUpsertError(errMsg(err));
    } finally {
      setMerchantUpsertBusy(false);
    }
  }

  async function handleMerchantDelete() {
    setMerchantDeleteBusy(true);
    setMerchantDeleteError("");
    try {
      const payload = await deleteMerchantMapRule({
        merchant_normalized: `${merchantDeleteForm.merchant_normalized ?? ""}`.trim(),
      });
      startTransition(() => setMerchantDeleteResult(payload));
      void handleMerchantQuery();
    } catch (err) {
      setMerchantDeleteError(errMsg(err));
    } finally {
      setMerchantDeleteBusy(false);
    }
  }

  async function handleMerchantSuggestionsQuery() {
    setMerchantSuggestionsBusy(true);
    setMerchantSuggestionsError("");
    try {
      const payload = await queryMerchantRuleSuggestions({
        keyword: `${merchantSuggestionsQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(merchantSuggestionsQuery.limit, 100),
        only_unmapped: merchantSuggestionsQuery.only_unmapped ?? "true",
      });
      startTransition(() => setMerchantSuggestionsResult(payload));
    } catch (err) {
      setMerchantSuggestionsError(errMsg(err));
    } finally {
      setMerchantSuggestionsBusy(false);
    }
  }

  function handlePickMerchantSuggestion(row: {
    merchant_normalized: string;
    suggested_expense_category: string;
    mapped_expense_category: string;
  }) {
    const preferredCategory =
      row.mapped_expense_category.trim() || row.suggested_expense_category.trim() || "";
    setMerchantUpsertForm((prev) => ({
      ...prev,
      merchant_normalized: row.merchant_normalized,
      expense_category: preferredCategory || prev.expense_category || "",
      note:
        prev.note && prev.note.trim()
          ? prev.note
          : "from merchant suggestions (desktop)",
    }));
  }

  async function handleCategoryQuery() {
    setCategoryQueryBusy(true);
    setCategoryQueryError("");
    try {
      const payload = await queryCategoryRules({
        keyword: `${categoryQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(categoryQuery.limit, 100),
      });
      startTransition(() => setCategoryQueryResult(payload));
    } catch (err) {
      setCategoryQueryError(errMsg(err));
    } finally {
      setCategoryQueryBusy(false);
    }
  }

  async function handleCategoryUpsert() {
    setCategoryUpsertBusy(true);
    setCategoryUpsertError("");
    try {
      const payload = await upsertCategoryRule({
        priority: `${categoryUpsertForm.priority ?? ""}`.trim(),
        match_type: (categoryUpsertForm.match_type ?? "contains") as CategoryRuleUpsertRequest["match_type"],
        pattern: `${categoryUpsertForm.pattern ?? ""}`.trim(),
        expense_category: `${categoryUpsertForm.expense_category ?? ""}`.trim(),
        confidence: `${categoryUpsertForm.confidence ?? ""}`.trim(),
        note: `${categoryUpsertForm.note ?? ""}`.trim(),
      });
      startTransition(() => setCategoryUpsertResult(payload));
      void handleCategoryQuery();
    } catch (err) {
      setCategoryUpsertError(errMsg(err));
    } finally {
      setCategoryUpsertBusy(false);
    }
  }

  async function handleCategoryDelete() {
    setCategoryDeleteBusy(true);
    setCategoryDeleteError("");
    try {
      const payload = await deleteCategoryRule({
        match_type: (categoryDeleteForm.match_type ?? "contains") as CategoryRuleDeleteRequest["match_type"],
        pattern: `${categoryDeleteForm.pattern ?? ""}`.trim(),
      });
      startTransition(() => setCategoryDeleteResult(payload));
      void handleCategoryQuery();
    } catch (err) {
      setCategoryDeleteError(errMsg(err));
    } finally {
      setCategoryDeleteBusy(false);
    }
  }

  async function handleBankQuery() {
    setBankQueryBusy(true);
    setBankQueryError("");
    try {
      const payload = await queryBankTransferWhitelistRules({
        keyword: `${bankQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(bankQuery.limit, 100),
        active_only: bankQuery.active_only ?? "false",
      });
      startTransition(() => setBankQueryResult(payload));
    } catch (err) {
      setBankQueryError(errMsg(err));
    } finally {
      setBankQueryBusy(false);
    }
  }

  async function handleBankUpsert() {
    setBankUpsertBusy(true);
    setBankUpsertError("");
    try {
      const payload = await upsertBankTransferWhitelistRule({
        name: `${bankUpsertForm.name ?? ""}`.trim(),
        is_active: bankUpsertForm.is_active ?? "true",
        note: `${bankUpsertForm.note ?? ""}`.trim(),
      });
      startTransition(() => setBankUpsertResult(payload));
      void handleBankQuery();
      void handleCmbBankPdfPreviewAutoHint();
    } catch (err) {
      setBankUpsertError(errMsg(err));
    } finally {
      setBankUpsertBusy(false);
    }
  }

  async function handleBankDelete() {
    setBankDeleteBusy(true);
    setBankDeleteError("");
    try {
      const payload = await deleteBankTransferWhitelistRule({
        name: `${bankDeleteForm.name ?? ""}`.trim(),
      });
      startTransition(() => setBankDeleteResult(payload));
      void handleBankQuery();
      void handleCmbBankPdfPreviewAutoHint();
    } catch (err) {
      setBankDeleteError(errMsg(err));
    } finally {
      setBankDeleteBusy(false);
    }
  }

  async function handleExclQuery() {
    setExclQueryBusy(true);
    setExclQueryError("");
    try {
      const payload = await queryAnalysisExclusionRules({
        keyword: `${exclQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(exclQuery.limit, 100),
        enabled_only: exclQuery.enabled_only ?? "false",
      });
      startTransition(() => setExclQueryResult(payload));
    } catch (err) {
      setExclQueryError(errMsg(err));
    } finally {
      setExclQueryBusy(false);
    }
  }

  async function handleExclUpsert() {
    setExclUpsertBusy(true);
    setExclUpsertError("");
    try {
      const payload = await upsertAnalysisExclusionRule({
        enabled: exclUpsertForm.enabled ?? "true",
        rule_name: `${exclUpsertForm.rule_name ?? ""}`.trim(),
        merchant_contains: `${exclUpsertForm.merchant_contains ?? ""}`.trim(),
        description_contains: `${exclUpsertForm.description_contains ?? ""}`.trim(),
        expense_category: `${exclUpsertForm.expense_category ?? ""}`.trim(),
        min_amount: `${exclUpsertForm.min_amount ?? ""}`.trim(),
        max_amount: `${exclUpsertForm.max_amount ?? ""}`.trim(),
        start_date: `${exclUpsertForm.start_date ?? ""}`.trim(),
        end_date: `${exclUpsertForm.end_date ?? ""}`.trim(),
        reason: `${exclUpsertForm.reason ?? ""}`.trim(),
      });
      startTransition(() => setExclUpsertResult(payload));
      void handleExclQuery();
      void handleCmbEmlPreviewAutoHint();
    } catch (err) {
      setExclUpsertError(errMsg(err));
    } finally {
      setExclUpsertBusy(false);
    }
  }

  async function handleExclDelete() {
    setExclDeleteBusy(true);
    setExclDeleteError("");
    try {
      const payload = await deleteAnalysisExclusionRule({
        rule_name: `${exclDeleteForm.rule_name ?? ""}`.trim(),
      });
      startTransition(() => setExclDeleteResult(payload));
      void handleExclQuery();
      void handleCmbEmlPreviewAutoHint();
    } catch (err) {
      setExclDeleteError(errMsg(err));
    } finally {
      setExclDeleteBusy(false);
    }
  }

  // Lightweight hint trigger: re-query file-based summaries only if user already has a path entered.
  async function handleCmbEmlPreviewAutoHint() {
    return;
  }
  async function handleCmbBankPdfPreviewAutoHint() {
    return;
  }

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>规则管理</h2>
        <p>在 desktop 内维护导入规则文件（当前写入仓库 `data/rules/*.csv`），供 EML / CMB PDF 导入即时生效。</p>
      </div>

      <div className="db-actions">
        <button type="button" className="secondary-btn" onClick={() => void handleMerchantQuery()} disabled={anyBusy}>
          刷新商户映射
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void handleMerchantSuggestionsQuery()}
          disabled={anyBusy}
        >
          刷新商户建议
        </button>
        <button type="button" className="secondary-btn" onClick={() => void handleCategoryQuery()} disabled={anyBusy}>
          刷新分类规则
        </button>
        <button type="button" className="secondary-btn" onClick={() => void handleBankQuery()} disabled={anyBusy}>
          刷新转账白名单
        </button>
        <button type="button" className="secondary-btn" onClick={() => void handleExclQuery()} disabled={anyBusy}>
          刷新分析排除规则
        </button>
      </div>

      <div className="db-grid rules-admin-grid">
        <div className="subcard">
          <h3>商户映射</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>关键词</span>
              <input
                value={merchantQuery.keyword ?? ""}
                onChange={(e) => setMerchantQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="merchant/category/note"
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(merchantQuery.limit, 100)}
                onChange={(e) =>
                  setMerchantQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>标准化商户名</span>
              <input
                value={merchantUpsertForm.merchant_normalized ?? ""}
                onChange={(e) =>
                  setMerchantUpsertForm((prev) => ({ ...prev, merchant_normalized: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>消费分类</span>
              <input
                value={merchantUpsertForm.expense_category ?? ""}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>置信度</span>
              <input
                value={merchantUpsertForm.confidence ?? "0.95"}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, confidence: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>备注</span>
              <input
                value={merchantUpsertForm.note ?? ""}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleMerchantQuery()} disabled={anyBusy}>
              {merchantQueryBusy ? "查询中..." : "查询"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleMerchantUpsert()} disabled={anyBusy}>
              {merchantUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>删除目标（标准化商户名）</span>
              <input
                value={merchantDeleteForm.merchant_normalized ?? ""}
                onChange={(e) =>
                  setMerchantDeleteForm((prev) => ({ ...prev, merchant_normalized: e.target.value }))
                }
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleMerchantDelete()} disabled={anyBusy}>
              {merchantDeleteBusy ? "删除中..." : "删除"}
            </button>
          </div>
          {merchantQueryError || merchantUpsertError || merchantDeleteError ? (
            <div className="inline-error" role="alert">
              {[merchantQueryError, merchantUpsertError, merchantDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="商户映射预览"
            data={merchantQueryResult}
            emptyText="尚未查询商户映射。"
            columns={[
              { key: "merchant_normalized", label: "标准化商户名" },
              { key: "expense_category", label: "消费分类" },
              { key: "confidence", label: "置信度" },
              { key: "note", label: "备注" },
            ]}
          />
          <p className="inline-hint">建议先查询查看现有规则，再写入/删除。可打开原始 JSON 查看结果详情。</p>
          {showRawJson ? (
            <>
              <JsonResultCard title="商户映射查询" data={merchantQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="商户映射写入" data={merchantUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="商户映射删除" data={merchantDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>

        <div className="subcard">
          <h3>商户建议</h3>
          <p className="inline-hint">
            基于 desktop 本地库交易聚合生成建议回填清单。建议先用 `only_unmapped=true` 看未映射商户，再把结果回填到 商户映射。
          </p>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>关键词</span>
              <input
                value={merchantSuggestionsQuery.keyword ?? ""}
                onChange={(e) =>
                  setMerchantSuggestionsQuery((prev) => ({ ...prev, keyword: e.target.value }))
                }
                placeholder="商户关键词"
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(merchantSuggestionsQuery.limit, 100)}
                onChange={(e) =>
                  setMerchantSuggestionsQuery((prev) => ({
                    ...prev,
                    limit: parseNumericInputWithFallback(e.target.value, 100),
                  }))
                }
              />
            </label>
            <BoolField
              label="仅显示未映射"
              value={(merchantSuggestionsQuery.only_unmapped ?? "true") as BoolString}
              onChange={(value) =>
                setMerchantSuggestionsQuery((prev) => ({ ...prev, only_unmapped: value }))
              }
            />
          </div>
          <div className="db-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleMerchantSuggestionsQuery()}
              disabled={anyBusy}
            >
              {merchantSuggestionsBusy ? "Querying..." : "查询商户建议"}
            </button>
          </div>
          {merchantSuggestionsError ? (
            <div className="inline-error" role="alert">
              {merchantSuggestionsError}
            </div>
          ) : null}
          <MerchantSuggestionsPreview
            data={merchantSuggestionsResult}
            onPickRow={handlePickMerchantSuggestion}
          />
          {showRawJson ? (
            <JsonResultCard
              title="商户建议 JSON"
              data={merchantSuggestionsResult}
              emptyText="尚未查询。"
            />
          ) : null}
        </div>

        <div className="subcard">
          <h3>分类规则</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>关键词</span>
              <input
                value={categoryQuery.keyword ?? ""}
                onChange={(e) => setCategoryQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="pattern/category/note"
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(categoryQuery.limit, 100)}
                onChange={(e) =>
                  setCategoryQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>优先级</span>
              <input
                value={categoryUpsertForm.priority ?? "500"}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, priority: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>匹配类型</span>
              <select
                value={categoryUpsertForm.match_type ?? "contains"}
                onChange={(e) =>
                  setCategoryUpsertForm((prev) => ({
                    ...prev,
                    match_type: e.target.value as CategoryRuleUpsertRequest["match_type"],
                  }))
                }
              >
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="prefix">prefix</option>
                <option value="regex">regex</option>
              </select>
            </label>
            <label className="field">
              <span>匹配模式</span>
              <input
                value={categoryUpsertForm.pattern ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, pattern: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>消费分类</span>
              <input
                value={categoryUpsertForm.expense_category ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>置信度</span>
              <input
                value={categoryUpsertForm.confidence ?? "0.70"}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, confidence: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>备注</span>
              <input
                value={categoryUpsertForm.note ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleCategoryQuery()} disabled={anyBusy}>
              {categoryQueryBusy ? "查询中..." : "查询"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleCategoryUpsert()} disabled={anyBusy}>
              {categoryUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>删除目标匹配类型</span>
              <select
                value={categoryDeleteForm.match_type ?? "contains"}
                onChange={(e) =>
                  setCategoryDeleteForm((prev) => ({
                    ...prev,
                    match_type: e.target.value as CategoryRuleDeleteRequest["match_type"],
                  }))
                }
              >
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="prefix">prefix</option>
                <option value="regex">regex</option>
              </select>
            </label>
            <label className="field">
              <span>删除目标模式</span>
              <input
                value={categoryDeleteForm.pattern ?? ""}
                onChange={(e) => setCategoryDeleteForm((prev) => ({ ...prev, pattern: e.target.value }))}
              />
            </label>
            <div className="field field-inline-button">
              <span>&nbsp;</span>
              <button type="button" className="danger-btn" onClick={() => void handleCategoryDelete()} disabled={anyBusy}>
                {categoryDeleteBusy ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
          {categoryQueryError || categoryUpsertError || categoryDeleteError ? (
            <div className="inline-error" role="alert">
              {[categoryQueryError, categoryUpsertError, categoryDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="分类规则预览"
            data={categoryQueryResult}
            emptyText="尚未查询分类规则。"
            columns={[
              { key: "priority", label: "优先级" },
              { key: "match_type", label: "匹配类型" },
              { key: "pattern", label: "匹配模式" },
              { key: "expense_category", label: "消费分类" },
              { key: "confidence", label: "置信度" },
            ]}
          />
          <p className="inline-hint">EML/PDF 分类会读取这里的规则，修改后重新预览即可验证效果。</p>
          {showRawJson ? (
            <>
              <JsonResultCard title="分类规则查询" data={categoryQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="分类规则写入" data={categoryUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="分类规则删除" data={categoryDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>

        <div className="subcard">
          <h3>银行转账白名单</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>关键词</span>
              <input
                value={bankQuery.keyword ?? ""}
                onChange={(e) => setBankQuery((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(bankQuery.limit, 100)}
                onChange={(e) =>
                  setBankQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
            <BoolField
              label="仅显示启用"
              value={(bankQuery.active_only ?? "false") as BoolString}
              onChange={(value) => setBankQuery((prev) => ({ ...prev, active_only: value }))}
            />
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>名称</span>
              <input
                value={bankUpsertForm.name ?? ""}
                onChange={(e) => setBankUpsertForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <BoolField
              label="is_active"
              value={(bankUpsertForm.is_active ?? "true") as BoolString}
              onChange={(value) => setBankUpsertForm((prev) => ({ ...prev, is_active: value }))}
            />
            <label className="field">
              <span>备注</span>
              <input
                value={bankUpsertForm.note ?? ""}
                onChange={(e) => setBankUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleBankQuery()} disabled={anyBusy}>
              {bankQueryBusy ? "查询中..." : "查询"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleBankUpsert()} disabled={anyBusy}>
              {bankUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>删除目标名称</span>
              <input
                value={bankDeleteForm.name ?? ""}
                onChange={(e) => setBankDeleteForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleBankDelete()} disabled={anyBusy}>
              {bankDeleteBusy ? "删除中..." : "删除"}
            </button>
          </div>
          {bankQueryError || bankUpsertError || bankDeleteError ? (
            <div className="inline-error" role="alert">
              {[bankQueryError, bankUpsertError, bankDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="转账白名单预览"
            data={bankQueryResult}
            emptyText="尚未查询转账白名单。"
            columns={[
              { key: "name", label: "名称" },
              { key: "is_active", label: "启用", kind: "bool01" },
              { key: "note", label: "备注" },
            ]}
          />
          <p className="inline-hint">该白名单用于招行 PDF 导入中识别银行卡个人转账消费。</p>
          {showRawJson ? (
            <>
              <JsonResultCard title="白名单查询" data={bankQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="白名单写入" data={bankUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="白名单删除" data={bankDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>

        <div className="subcard">
          <h3>分析排除规则</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>关键词</span>
              <input
                value={exclQuery.keyword ?? ""}
                onChange={(e) => setExclQuery((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(exclQuery.limit, 100)}
                onChange={(e) =>
                  setExclQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
            <BoolField
              label="仅显示启用"
              value={(exclQuery.enabled_only ?? "false") as BoolString}
              onChange={(value) => setExclQuery((prev) => ({ ...prev, enabled_only: value }))}
            />
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <BoolField
              label="enabled"
              value={(exclUpsertForm.enabled ?? "true") as BoolString}
              onChange={(value) => setExclUpsertForm((prev) => ({ ...prev, enabled: value }))}
            />
            <label className="field">
              <span>规则名</span>
              <input
                value={exclUpsertForm.rule_name ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, rule_name: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>商户包含</span>
              <input
                value={exclUpsertForm.merchant_contains ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, merchant_contains: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>描述包含</span>
              <input
                value={exclUpsertForm.description_contains ?? ""}
                onChange={(e) =>
                  setExclUpsertForm((prev) => ({ ...prev, description_contains: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>消费分类</span>
              <input
                value={exclUpsertForm.expense_category ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>最小金额（分）</span>
              <input
                value={exclUpsertForm.min_amount ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, min_amount: e.target.value }))}
                placeholder="100000"
              />
            </label>
            <label className="field">
              <span>最大金额（分）</span>
              <input
                value={exclUpsertForm.max_amount ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, max_amount: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>开始日期</span>
              <input
                value={exclUpsertForm.start_date ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, start_date: e.target.value }))}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>结束日期</span>
              <input
                value={exclUpsertForm.end_date ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, end_date: e.target.value }))}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>原因</span>
              <input
                value={exclUpsertForm.reason ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, reason: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleExclQuery()} disabled={anyBusy}>
              {exclQueryBusy ? "查询中..." : "查询"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleExclUpsert()} disabled={anyBusy}>
              {exclUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>删除目标规则名</span>
              <input
                value={exclDeleteForm.rule_name ?? ""}
                onChange={(e) => setExclDeleteForm((prev) => ({ ...prev, rule_name: e.target.value }))}
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleExclDelete()} disabled={anyBusy}>
              {exclDeleteBusy ? "删除中..." : "删除"}
            </button>
          </div>
          {exclQueryError || exclUpsertError || exclDeleteError ? (
            <div className="inline-error" role="alert">
              {[exclQueryError, exclUpsertError, exclDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="分析排除规则预览"
            data={exclQueryResult}
            emptyText="尚未查询分析排除规则。"
            columns={[
              { key: "enabled", label: "启用", kind: "bool01" },
              { key: "rule_name", label: "规则名" },
              { key: "merchant_contains", label: "商户包含" },
              { key: "expense_category", label: "消费分类" },
              { key: "reason", label: "原因" },
            ]}
          />
          <p className="inline-hint">EML 导入会在分类后应用这些排除规则，修改后重新预览招行 EML 即可观察变化。</p>
          {showRawJson ? (
            <>
              <JsonResultCard title="排除规则查询" data={exclQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="排除规则写入" data={exclUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="排除规则删除" data={exclDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [probe, setProbe] = useState<BootstrapProbe | null>(null);
  const [error, setError] = useState<string>("");
  const [dbStatus, setDbStatus] = useState<LedgerDbStatus | null>(null);
  const [dbStatusError, setDbStatusError] = useState<string>("");
  const [dbBusy, setDbBusy] = useState(false);
  const [dbImportPath, setDbImportPath] = useState("");
  const [yzxyFilePath, setYzxyFilePath] = useState("");
  const [yzxySourceType, setYzxySourceType] = useState("yzxy_xlsx");
  const [yzxyPreviewBusy, setYzxyPreviewBusy] = useState(false);
  const [yzxyPreviewError, setYzxyPreviewError] = useState("");
  const [yzxyPreviewResult, setYzxyPreviewResult] = useState<YzxyPreviewPayload | null>(null);
  const [yzxyImportBusy, setYzxyImportBusy] = useState(false);
  const [yzxyImportError, setYzxyImportError] = useState("");
  const [yzxyImportResult, setYzxyImportResult] = useState<YzxyImportPayload | null>(null);
  const [emlSourcePath, setEmlSourcePath] = useState("");
  const [emlSourceType, setEmlSourceType] = useState("cmb_eml");
  const [emlReviewThreshold, setEmlReviewThreshold] = useState(0.7);
  const [emlPreviewBusy, setEmlPreviewBusy] = useState(false);
  const [emlPreviewError, setEmlPreviewError] = useState("");
  const [emlPreviewResult, setEmlPreviewResult] = useState<CmbEmlPreviewPayload | null>(null);
  const [emlImportBusy, setEmlImportBusy] = useState(false);
  const [emlImportError, setEmlImportError] = useState("");
  const [emlImportResult, setEmlImportResult] = useState<CmbEmlImportPayload | null>(null);
  const [cmbPdfPath, setCmbPdfPath] = useState("");
  const [cmbPdfSourceType, setCmbPdfSourceType] = useState("cmb_bank_pdf");
  const [cmbPdfReviewThreshold, setCmbPdfReviewThreshold] = useState(0.7);
  const [cmbPdfPreviewBusy, setCmbPdfPreviewBusy] = useState(false);
  const [cmbPdfPreviewError, setCmbPdfPreviewError] = useState("");
  const [cmbPdfPreviewResult, setCmbPdfPreviewResult] = useState<CmbBankPdfPreviewPayload | null>(null);
  const [cmbPdfImportBusy, setCmbPdfImportBusy] = useState(false);
  const [cmbPdfImportError, setCmbPdfImportError] = useState("");
  const [cmbPdfImportResult, setCmbPdfImportResult] = useState<CmbBankPdfImportPayload | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [adminDbStatsBusy, setAdminDbStatsBusy] = useState(false);
  const [adminDbStatsError, setAdminDbStatsError] = useState("");
  const [adminDbStatsResult, setAdminDbStatsResult] = useState<LedgerAdminDbStats | null>(null);
  const [adminDbStatsLastRunAt, setAdminDbStatsLastRunAt] = useState<number | null>(null);
  const [adminResetConfirmText, setAdminResetConfirmText] = useState("");
  const [adminResetTxBusy, setAdminResetTxBusy] = useState(false);
  const [adminResetTxError, setAdminResetTxError] = useState("");
  const [adminResetTxResult, setAdminResetTxResult] = useState<LedgerAdminResetTransactionsResult | null>(null);
  const [adminResetAllBusy, setAdminResetAllBusy] = useState(false);
  const [adminResetAllError, setAdminResetAllError] = useState("");
  const [adminResetAllResult, setAdminResetAllResult] = useState<LedgerAdminResetAllResult | null>(null);
  const [runtimeHealthBusy, setRuntimeHealthBusy] = useState(false);
  const [runtimeHealthError, setRuntimeHealthError] = useState("");
  const [runtimeHealthResult, setRuntimeHealthResult] = useState<RuntimeDbHealthCheckPayload | null>(null);
  const [runtimeHealthLastRunAt, setRuntimeHealthLastRunAt] = useState<number | null>(null);
  const [importCenterStatus, setImportCenterStatus] = useState<PipelineStatus>("idle");
  const [importCenterLastRunAt, setImportCenterLastRunAt] = useState<number | null>(null);
  const [importCenterMessage, setImportCenterMessage] = useState("");
  const [importCenterRows, setImportCenterRows] = useState<ImportStepRow[]>(() => makeInitialImportStepRows());
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineLastRunAt, setPipelineLastRunAt] = useState<number | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [smokeRows, setSmokeRows] = useState<SmokeRow[]>(() => makeInitialSmokeRows());
  const [smokeLastRunAt, setSmokeLastRunAt] = useState<number | null>(null);
  const [dbLastResult, setDbLastResult] = useState<LedgerDbMigrateResult | null>(null);
  const [dbImportLastResult, setDbImportLastResult] = useState<LedgerDbImportRepoRuntimeResult | null>(null);
  const [invBusy, setInvBusy] = useState(false);
  const [invError, setInvError] = useState("");
  const [invResult, setInvResult] = useState<InvestmentReturnPayload | null>(null);
  const [invQuery, setInvQuery] = useState({
    account_id: "__portfolio__",
    preset: "ytd",
    from: "",
    to: "",
  });
  const [invBatchBusy, setInvBatchBusy] = useState(false);
  const [invBatchError, setInvBatchError] = useState("");
  const [invBatchResult, setInvBatchResult] = useState<InvestmentReturnsPayload | null>(null);
  const [invBatchQuery, setInvBatchQuery] = useState<InvestmentReturnsQueryRequest>({
    preset: "ytd",
    from: "",
    to: "",
    keyword: "",
    limit: 200,
  });
  const [invCurveBusy, setInvCurveBusy] = useState(false);
  const [invCurveError, setInvCurveError] = useState("");
  const [invCurveResult, setInvCurveResult] = useState<InvestmentCurvePayload | null>(null);
  const [invCurveQuery, setInvCurveQuery] = useState({
    account_id: "__portfolio__",
    preset: "1y",
    from: "",
    to: "",
  });
  const [wealthOverviewBusy, setWealthOverviewBusy] = useState(false);
  const [wealthOverviewError, setWealthOverviewError] = useState("");
  const [wealthOverviewResult, setWealthOverviewResult] = useState<WealthOverviewPayload | null>(null);
  const [wealthOverviewQuery, setWealthOverviewQuery] = useState<{
    as_of: string;
    include_investment: BoolString;
    include_cash: BoolString;
    include_real_estate: BoolString;
    include_liability: BoolString;
  }>({
    as_of: "",
    include_investment: "true",
    include_cash: "true",
    include_real_estate: "true",
    include_liability: "true",
  });
  const [wealthCurveBusy, setWealthCurveBusy] = useState(false);
  const [wealthCurveError, setWealthCurveError] = useState("");
  const [wealthCurveResult, setWealthCurveResult] = useState<WealthCurvePayload | null>(null);
  const [wealthCurveQuery, setWealthCurveQuery] = useState<{
    preset: string;
    from: string;
    to: string;
    include_investment: BoolString;
    include_cash: BoolString;
    include_real_estate: BoolString;
    include_liability: BoolString;
  }>({
    preset: "1y",
    from: "",
    to: "",
    include_investment: "true",
    include_cash: "true",
    include_real_estate: "true",
    include_liability: "true",
  });
  const [budgetItemsBusy, setBudgetItemsBusy] = useState(false);
  const [budgetItemsError, setBudgetItemsError] = useState("");
  const [budgetItemsResult, setBudgetItemsResult] = useState<MonthlyBudgetItemsPayload | null>(null);
  const [budgetItemUpsertBusy, setBudgetItemUpsertBusy] = useState(false);
  const [budgetItemUpsertError, setBudgetItemUpsertError] = useState("");
  const [budgetItemUpsertResult, setBudgetItemUpsertResult] = useState<MonthlyBudgetItemMutationPayload | null>(null);
  const [budgetItemDeleteBusy, setBudgetItemDeleteBusy] = useState(false);
  const [budgetItemDeleteError, setBudgetItemDeleteError] = useState("");
  const [budgetItemDeleteResult, setBudgetItemDeleteResult] = useState<MonthlyBudgetItemMutationPayload | null>(null);
  const [budgetItemForm, setBudgetItemForm] = useState<MonthlyBudgetItemUpsertRequest>({
    id: "",
    name: "",
    monthly_amount: "",
    sort_order: "1000",
    is_active: "true",
  });
  const [budgetItemDeleteForm, setBudgetItemDeleteForm] = useState<MonthlyBudgetItemDeleteRequest>({
    id: "",
  });
  const currentYearText = String(new Date().getFullYear());
  const [budgetOverviewBusy, setBudgetOverviewBusy] = useState(false);
  const [budgetOverviewError, setBudgetOverviewError] = useState("");
  const [budgetOverviewResult, setBudgetOverviewResult] = useState<BudgetOverviewPayload | null>(null);
  const [budgetOverviewQuery, setBudgetOverviewQuery] = useState<BudgetYearQueryRequest>({
    year: currentYearText,
  });
  const [budgetReviewBusy, setBudgetReviewBusy] = useState(false);
  const [budgetReviewError, setBudgetReviewError] = useState("");
  const [budgetReviewResult, setBudgetReviewResult] = useState<BudgetMonthlyReviewPayload | null>(null);
  const [budgetReviewQuery, setBudgetReviewQuery] = useState<BudgetYearQueryRequest>({
    year: currentYearText,
  });
  const [fireProgressBusy, setFireProgressBusy] = useState(false);
  const [fireProgressError, setFireProgressError] = useState("");
  const [fireProgressResult, setFireProgressResult] = useState<FireProgressPayload | null>(null);
  const [fireProgressQuery, setFireProgressQuery] = useState<FireProgressQueryRequest>({
    year: currentYearText,
    withdrawal_rate: "0.04",
  });
  const [salaryIncomeBusy, setSalaryIncomeBusy] = useState(false);
  const [salaryIncomeError, setSalaryIncomeError] = useState("");
  const [salaryIncomeResult, setSalaryIncomeResult] = useState<SalaryIncomeOverviewPayload | null>(null);
  const [salaryIncomeQuery, setSalaryIncomeQuery] = useState<BudgetYearQueryRequest>({
    year: currentYearText,
  });
  const [consumptionOverviewBusy, setConsumptionOverviewBusy] = useState(false);
  const [consumptionOverviewError, setConsumptionOverviewError] = useState("");
  const [consumptionOverviewResult, setConsumptionOverviewResult] = useState<ConsumptionReportPayload | null>(null);
  const [metaAccountsBusy, setMetaAccountsBusy] = useState(false);
  const [metaAccountsError, setMetaAccountsError] = useState("");
  const [metaAccountsResult, setMetaAccountsResult] = useState<MetaAccountsPayload | null>(null);
  const [metaAccountsQuery, setMetaAccountsQuery] = useState<MetaAccountsQueryRequest>({ kind: "all" });
  const [txListBusy, setTxListBusy] = useState(false);
  const [txListError, setTxListError] = useState("");
  const [txListResult, setTxListResult] = useState<QueryTransactionsPayload | null>(null);
  const [txListQuery, setTxListQuery] = useState<QueryTransactionsRequest>({
    limit: 100,
    sort: "date_desc",
    month_key: "",
    source_type: "",
    account_id: "",
    keyword: "",
  });
  const [txExclusionBusy, setTxExclusionBusy] = useState(false);
  const [txExclusionError, setTxExclusionError] = useState("");
  const [txExclusionResult, setTxExclusionResult] =
    useState<TransactionAnalysisExclusionMutationPayload | null>(null);
  const [txExclusionForm, setTxExclusionForm] = useState<UpdateTransactionAnalysisExclusionRequest>({
    id: "",
    action: "exclude",
    reason: "",
  });
  const [invListBusy, setInvListBusy] = useState(false);
  const [invListError, setInvListError] = useState("");
  const [invListResult, setInvListResult] = useState<QueryInvestmentsPayload | null>(null);
  const [invListQuery, setInvListQuery] = useState<QueryInvestmentsRequest>({
    limit: 100,
    from: "",
    to: "",
    source_type: "",
    account_id: "",
  });
  const [assetListBusy, setAssetListBusy] = useState(false);
  const [assetListError, setAssetListError] = useState("");
  const [assetListResult, setAssetListResult] = useState<QueryAssetValuationsPayload | null>(null);
  const [assetListQuery, setAssetListQuery] = useState<QueryAssetValuationsRequest>({
    limit: 100,
    from: "",
    to: "",
    asset_class: "",
    account_id: "",
  });
  const [acctCatalogBusy, setAcctCatalogBusy] = useState(false);
  const [acctCatalogError, setAcctCatalogError] = useState("");
  const [acctCatalogResult, setAcctCatalogResult] = useState<AccountCatalogPayload | null>(null);
  const [acctCatalogQuery, setAcctCatalogQuery] = useState<QueryAccountCatalogRequest>({
    kind: "all",
    keyword: "",
    limit: 200,
  });
  const [acctCatalogUpsertBusy, setAcctCatalogUpsertBusy] = useState(false);
  const [acctCatalogUpsertError, setAcctCatalogUpsertError] = useState("");
  const [acctCatalogUpsertResult, setAcctCatalogUpsertResult] = useState<AccountCatalogUpsertPayload | null>(null);
  const [acctCatalogUpsertForm, setAcctCatalogUpsertForm] = useState<UpsertAccountCatalogEntryRequest>({
    account_id: "",
    account_name: "",
    account_kind: "cash",
  });
  const [acctCatalogDeleteBusy, setAcctCatalogDeleteBusy] = useState(false);
  const [acctCatalogDeleteError, setAcctCatalogDeleteError] = useState("");
  const [acctCatalogDeleteResult, setAcctCatalogDeleteResult] = useState<AccountCatalogDeletePayload | null>(null);
  const [acctCatalogDeleteId, setAcctCatalogDeleteId] = useState("");
  const [manualInvBusy, setManualInvBusy] = useState(false);
  const [manualInvError, setManualInvError] = useState("");
  const [manualInvResult, setManualInvResult] = useState<ManualInvestmentMutationPayload | null>(null);
  const [manualInvForm, setManualInvForm] = useState<UpsertManualInvestmentRequest>({
    snapshot_date: "",
    account_id: "",
    account_name: "",
    total_assets: "",
    transfer_amount: "0",
  });
  const [updateInvBusy, setUpdateInvBusy] = useState(false);
  const [updateInvError, setUpdateInvError] = useState("");
  const [updateInvResult, setUpdateInvResult] = useState<InvestmentRecordMutationPayload | null>(null);
  const [updateInvForm, setUpdateInvForm] = useState<UpdateInvestmentRecordRequest>({
    id: "",
    snapshot_date: "",
    account_id: "",
    account_name: "",
    total_assets: "",
    transfer_amount: "0",
  });
  const [deleteInvBusy, setDeleteInvBusy] = useState(false);
  const [deleteInvError, setDeleteInvError] = useState("");
  const [deleteInvResult, setDeleteInvResult] = useState<InvestmentRecordMutationPayload | null>(null);
  const [deleteInvId, setDeleteInvId] = useState("");
  const [manualAssetBusy, setManualAssetBusy] = useState(false);
  const [manualAssetError, setManualAssetError] = useState("");
  const [manualAssetResult, setManualAssetResult] = useState<ManualAssetValuationMutationPayload | null>(null);
  const [manualAssetForm, setManualAssetForm] = useState<UpsertManualAssetValuationRequest>({
    asset_class: "cash",
    snapshot_date: "",
    account_id: "",
    account_name: "",
    value: "",
  });
  const [updateAssetBusy, setUpdateAssetBusy] = useState(false);
  const [updateAssetError, setUpdateAssetError] = useState("");
  const [updateAssetResult, setUpdateAssetResult] = useState<AssetValuationMutationPayload | null>(null);
  const [updateAssetForm, setUpdateAssetForm] = useState<UpdateAssetValuationRequest>({
    id: "",
    asset_class: "cash",
    snapshot_date: "",
    account_id: "",
    account_name: "",
    value: "",
  });
  const [deleteAssetBusy, setDeleteAssetBusy] = useState(false);
  const [deleteAssetError, setDeleteAssetError] = useState("");
  const [deleteAssetResult, setDeleteAssetResult] = useState<AssetValuationMutationPayload | null>(null);
  const [deleteAssetId, setDeleteAssetId] = useState("");

  async function refreshProbe() {
    setStatus("loading");
    setError("");
    try {
      const next = await loadBootstrapProbe();
      startTransition(() => {
        setProbe(next);
        setStatus("ready");
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Unknown error";
      setError(message);
      setStatus("error");
    }
  }

  async function refreshDbStatus() {
    setDbStatusError("");
    try {
      const next = await loadLedgerDbStatus();
      startTransition(() => {
        setDbStatus(next);
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
      setDbStatusError(message);
    }
  }

  async function handleRefreshAdminDbStats() {
    setAdminDbStatsBusy(true);
    setAdminDbStatsError("");
    try {
      const payload = await loadLedgerDbAdminStats();
      startTransition(() => {
        setAdminDbStatsResult(payload);
        setAdminDbStatsLastRunAt(Date.now());
      });
    } catch (err) {
      setAdminDbStatsError(toErrorMessage(err));
    } finally {
      setAdminDbStatsBusy(false);
    }
  }

  async function handleAdminResetTransactions() {
    setAdminResetTxBusy(true);
    setAdminResetTxError("");
    try {
      const payload = await runLedgerDbAdminResetTransactions(buildAdminResetRequest());
      startTransition(() => {
        setAdminResetTxResult(payload);
      });
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
      void handleTransactionsQuery();
      void handleConsumptionOverviewQuery();
    } catch (err) {
      setAdminResetTxError(toErrorMessage(err));
    } finally {
      setAdminResetTxBusy(false);
    }
  }

  async function handleAdminResetAll() {
    setAdminResetAllBusy(true);
    setAdminResetAllError("");
    try {
      const payload = await runLedgerDbAdminResetAll(buildAdminResetRequest());
      startTransition(() => {
        setAdminResetAllResult(payload);
      });
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
      void handleTransactionsQuery();
      void handleConsumptionOverviewQuery();
      void handleInvestmentsListQuery();
      void handleAssetValuationsQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setAdminResetAllError(toErrorMessage(err));
    } finally {
      setAdminResetAllBusy(false);
    }
  }

  async function handleRunRuntimeHealthCheck() {
    setRuntimeHealthBusy(true);
    setRuntimeHealthError("");
    try {
      const payload = await runRuntimeDbHealthCheck();
      startTransition(() => {
        setRuntimeHealthResult(payload);
        setRuntimeHealthLastRunAt(Date.now());
      });
    } catch (err) {
      setRuntimeHealthError(toErrorMessage(err));
    } finally {
      setRuntimeHealthBusy(false);
    }
  }

  async function handleRunMigrations() {
    setDbBusy(true);
    setDbStatusError("");
    try {
      const result = await runLedgerDbMigrate();
      startTransition(() => {
        setDbLastResult(result);
      });
      await refreshDbStatus();
      await refreshProbe();
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
      setDbStatusError(message);
    } finally {
      setDbBusy(false);
    }
  }

  async function runDbImportSequence(mode: "repo" | "path"): Promise<LedgerDbImportRepoRuntimeResult> {
    setDbBusy(true);
    setDbStatusError("");
    try {
      const result =
        mode === "repo" ? await importRepoRuntimeLedgerDb() : await importLedgerDbFromPath(dbImportPath.trim());
      startTransition(() => {
        setDbImportLastResult(result);
      });
      await refreshDbStatus();
      await refreshProbe();
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
      return result;
    } catch (err) {
      const message = toErrorMessage(err);
      setDbStatusError(message);
      throw err;
    } finally {
      setDbBusy(false);
    }
  }

  async function handleImportRepoRuntimeDb() {
    try {
      await runDbImportSequence("repo");
    } catch {
      // Error already surfaced in `dbStatusError`.
    }
  }

  async function handleImportDbFromPath() {
    try {
      await runDbImportSequence("path");
    } catch {
      // Error already surfaced in `dbStatusError`.
    }
  }

  async function handlePickDbImportPath() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择 KeepWise SQLite 数据库",
        filters: [
          { name: "SQLite DB", extensions: ["db", "sqlite", "sqlite3"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof selected === "string" && selected.trim()) {
        setDbImportPath(selected);
      }
    } catch (err) {
      setDbStatusError(toErrorMessage(err));
    }
  }

  async function handlePickYzxyFilePath() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择有知有行导出文件（CSV / XLSX）",
        filters: [
          { name: "YZXY Export", extensions: ["xlsx", "csv"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof selected === "string" && selected.trim()) {
        setYzxyFilePath(selected);
      }
    } catch (err) {
      setYzxyPreviewError(toErrorMessage(err));
    }
  }

  async function handleYzxyPreview() {
    const sourcePath = yzxyFilePath.trim();
    if (!sourcePath) {
      setYzxyPreviewError("请先选择有知有行导出文件（.csv / .xlsx）");
      return;
    }
    setYzxyPreviewBusy(true);
    setYzxyPreviewError("");
    try {
      const payload = await yzxyPreviewFile({ source_path: sourcePath });
      startTransition(() => {
        setYzxyPreviewResult(payload);
      });
    } catch (err) {
      setYzxyPreviewError(toErrorMessage(err));
    } finally {
      setYzxyPreviewBusy(false);
    }
  }

  async function handleYzxyImport() {
    const sourcePath = yzxyFilePath.trim();
    const sourceType = yzxySourceType.trim() || "yzxy_xlsx";
    if (!sourcePath) {
      setYzxyImportError("请先选择有知有行导出文件（.csv / .xlsx）");
      return;
    }

    setYzxyImportBusy(true);
    setYzxyImportError("");
    try {
      const payload = await yzxyImportFile({
        source_path: sourcePath,
        source_type: sourceType,
      });
      startTransition(() => {
        setYzxyImportResult(payload);
      });
      void refreshDbStatus();
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleInvestmentsListQuery();
      void handleInvestmentReturnsQuery();
      void handleInvestmentReturnQuery();
      void handleInvestmentCurveQuery();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
    } catch (err) {
      setYzxyImportError(toErrorMessage(err));
    } finally {
      setYzxyImportBusy(false);
    }
  }

  async function handlePickEmlFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择招行 EML 账单文件",
        filters: [
          { name: "EML", extensions: ["eml"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof selected === "string" && selected.trim()) {
        setEmlSourcePath(selected);
      }
    } catch (err) {
      setEmlPreviewError(toErrorMessage(err));
    }
  }

  async function handlePickEmlFolder() {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
        title: "选择包含招行 EML 账单的目录（递归扫描）",
      });
      if (typeof selected === "string" && selected.trim()) {
        setEmlSourcePath(selected);
      }
    } catch (err) {
      setEmlPreviewError(toErrorMessage(err));
    }
  }

  async function handleCmbEmlPreview() {
    const sourcePath = emlSourcePath.trim();
    if (!sourcePath) {
      setEmlPreviewError("请先选择 EML 文件或目录");
      return;
    }
    setEmlPreviewBusy(true);
    setEmlPreviewError("");
    try {
      const payload = await cmbEmlPreview({
        source_path: sourcePath,
        review_threshold: Number.isFinite(emlReviewThreshold) ? emlReviewThreshold : 0.7,
      });
      startTransition(() => {
        setEmlPreviewResult(payload);
      });
    } catch (err) {
      setEmlPreviewError(toErrorMessage(err));
    } finally {
      setEmlPreviewBusy(false);
    }
  }

  async function handleCmbEmlImport() {
    const sourcePath = emlSourcePath.trim();
    const sourceType = emlSourceType.trim() || "cmb_eml";
    if (!sourcePath) {
      setEmlImportError("请先选择 EML 文件或目录");
      return;
    }
    setEmlImportBusy(true);
    setEmlImportError("");
    try {
      const payload = await cmbEmlImport({
        source_path: sourcePath,
        source_type: sourceType,
        review_threshold: Number.isFinite(emlReviewThreshold) ? emlReviewThreshold : 0.7,
      });
      startTransition(() => {
        setEmlImportResult(payload);
      });
      void refreshDbStatus();
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
      void handleConsumptionOverviewQuery();
      void handleTransactionsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setEmlImportError(toErrorMessage(err));
    } finally {
      setEmlImportBusy(false);
    }
  }

  async function handlePickCmbPdfFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择招行银行流水 PDF 文件",
        filters: [
          { name: "PDF", extensions: ["pdf"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof selected === "string" && selected.trim()) {
        setCmbPdfPath(selected);
      }
    } catch (err) {
      setCmbPdfPreviewError(toErrorMessage(err));
    }
  }

  async function handleCmbBankPdfPreview() {
    const sourcePath = cmbPdfPath.trim();
    if (!sourcePath) {
      setCmbPdfPreviewError("请先选择银行流水 PDF 文件");
      return;
    }
    setCmbPdfPreviewBusy(true);
    setCmbPdfPreviewError("");
    try {
      const payload = await cmbBankPdfPreview({
        source_path: sourcePath,
        review_threshold: Number.isFinite(cmbPdfReviewThreshold) ? cmbPdfReviewThreshold : 0.7,
      });
      startTransition(() => {
        setCmbPdfPreviewResult(payload);
      });
    } catch (err) {
      setCmbPdfPreviewError(toErrorMessage(err));
    } finally {
      setCmbPdfPreviewBusy(false);
    }
  }

  async function handleCmbBankPdfImport() {
    const sourcePath = cmbPdfPath.trim();
    const sourceType = cmbPdfSourceType.trim() || "cmb_bank_pdf";
    if (!sourcePath) {
      setCmbPdfImportError("请先选择银行流水 PDF 文件");
      return;
    }
    setCmbPdfImportBusy(true);
    setCmbPdfImportError("");
    try {
      const payload = await cmbBankPdfImport({
        source_path: sourcePath,
        source_type: sourceType,
        review_threshold: Number.isFinite(cmbPdfReviewThreshold) ? cmbPdfReviewThreshold : 0.7,
      });
      startTransition(() => {
        setCmbPdfImportResult(payload);
      });
      void refreshDbStatus();
      void handleRefreshAdminDbStats();
      void handleRunRuntimeHealthCheck();
      void handleConsumptionOverviewQuery();
      void handleTransactionsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleSalaryIncomeOverviewQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setCmbPdfImportError(toErrorMessage(err));
    } finally {
      setCmbPdfImportBusy(false);
    }
  }

  function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
  }

  function buildInvestmentReturnRequest(): InvestmentReturnQueryRequest {
    const req: InvestmentReturnQueryRequest = {
      account_id: invQuery.account_id,
      preset: invQuery.preset,
    };
    if (invQuery.from.trim()) req.from = invQuery.from.trim();
    if (invQuery.to.trim()) req.to = invQuery.to.trim();
    return req;
  }

  function buildInvestmentCurveRequest(): InvestmentCurveQueryRequest {
    const req: InvestmentCurveQueryRequest = {
      account_id: invCurveQuery.account_id,
      preset: invCurveQuery.preset,
    };
    if (invCurveQuery.from.trim()) req.from = invCurveQuery.from.trim();
    if (invCurveQuery.to.trim()) req.to = invCurveQuery.to.trim();
    return req;
  }

  function buildInvestmentReturnsRequest(): InvestmentReturnsQueryRequest {
    const req: InvestmentReturnsQueryRequest = {
      preset: invBatchQuery.preset || "ytd",
      limit: Number(invBatchQuery.limit ?? 200),
    };
    const from = `${invBatchQuery.from ?? ""}`.trim();
    const to = `${invBatchQuery.to ?? ""}`.trim();
    const keyword = `${invBatchQuery.keyword ?? ""}`.trim();
    if (from) req.from = from;
    if (to) req.to = to;
    if (keyword) req.keyword = keyword;
    return req;
  }

  function buildMetaAccountsRequest(): MetaAccountsQueryRequest {
    return { kind: metaAccountsQuery.kind ?? "all" };
  }

  function buildWealthOverviewRequest(): WealthOverviewQueryRequest {
    const req: WealthOverviewQueryRequest = {
      include_investment: wealthOverviewQuery.include_investment,
      include_cash: wealthOverviewQuery.include_cash,
      include_real_estate: wealthOverviewQuery.include_real_estate,
      include_liability: wealthOverviewQuery.include_liability,
    };
    if (wealthOverviewQuery.as_of.trim()) req.as_of = wealthOverviewQuery.as_of.trim();
    return req;
  }

  function buildWealthCurveRequest(): WealthCurveQueryRequest {
    const req: WealthCurveQueryRequest = {
      preset: wealthCurveQuery.preset,
      include_investment: wealthCurveQuery.include_investment,
      include_cash: wealthCurveQuery.include_cash,
      include_real_estate: wealthCurveQuery.include_real_estate,
      include_liability: wealthCurveQuery.include_liability,
    };
    if (wealthCurveQuery.from.trim()) req.from = wealthCurveQuery.from.trim();
    if (wealthCurveQuery.to.trim()) req.to = wealthCurveQuery.to.trim();
    return req;
  }

  function buildBudgetYearQueryRequest(query: BudgetYearQueryRequest): BudgetYearQueryRequest {
    const req: BudgetYearQueryRequest = {};
    const year = `${query.year ?? ""}`.trim();
    if (year) req.year = year;
    return req;
  }

  function buildFireProgressQueryRequest(): FireProgressQueryRequest {
    const req: FireProgressQueryRequest = {};
    const year = `${fireProgressQuery.year ?? ""}`.trim();
    const withdrawalRate = `${fireProgressQuery.withdrawal_rate ?? ""}`.trim();
    if (year) req.year = year;
    if (withdrawalRate) req.withdrawal_rate = withdrawalRate;
    return req;
  }

  function buildBudgetItemUpsertMutationRequest(): MonthlyBudgetItemUpsertRequest {
    const req: MonthlyBudgetItemUpsertRequest = {
      name: `${budgetItemForm.name ?? ""}`.trim(),
      monthly_amount: `${budgetItemForm.monthly_amount ?? ""}`.trim(),
      sort_order: `${budgetItemForm.sort_order ?? ""}`.trim(),
      is_active: budgetItemForm.is_active ?? "true",
    };
    const id = `${budgetItemForm.id ?? ""}`.trim();
    if (id) req.id = id;
    return req;
  }

  function buildBudgetItemDeleteMutationRequest(): MonthlyBudgetItemDeleteRequest {
    return { id: `${budgetItemDeleteForm.id ?? ""}`.trim() };
  }

  function buildTransactionsQueryRequest(): QueryTransactionsRequest {
    const req: QueryTransactionsRequest = {
      limit: Number(txListQuery.limit ?? 20),
      sort: txListQuery.sort ?? "date_desc",
    };
    const monthKey = `${txListQuery.month_key ?? ""}`.trim();
    const sourceType = `${txListQuery.source_type ?? ""}`.trim();
    const accountId = `${txListQuery.account_id ?? ""}`.trim();
    const keyword = `${txListQuery.keyword ?? ""}`.trim();
    if (monthKey) req.month_key = monthKey;
    if (sourceType) req.source_type = sourceType;
    if (accountId) req.account_id = accountId;
    if (keyword) req.keyword = keyword;
    return req;
  }

  function buildInvestmentsListQueryRequest(): QueryInvestmentsRequest {
    const req: QueryInvestmentsRequest = {
      limit: Number(invListQuery.limit ?? 20),
    };
    const from = `${invListQuery.from ?? ""}`.trim();
    const to = `${invListQuery.to ?? ""}`.trim();
    const sourceType = `${invListQuery.source_type ?? ""}`.trim();
    const accountId = `${invListQuery.account_id ?? ""}`.trim();
    if (from) req.from = from;
    if (to) req.to = to;
    if (sourceType) req.source_type = sourceType;
    if (accountId) req.account_id = accountId;
    return req;
  }

  function buildAssetValuationsQueryRequest(): QueryAssetValuationsRequest {
    const req: QueryAssetValuationsRequest = {
      limit: Number(assetListQuery.limit ?? 20),
    };
    const from = `${assetListQuery.from ?? ""}`.trim();
    const to = `${assetListQuery.to ?? ""}`.trim();
    const assetClass = `${assetListQuery.asset_class ?? ""}`.trim() as QueryAssetValuationsRequest["asset_class"];
    const accountId = `${assetListQuery.account_id ?? ""}`.trim();
    if (from) req.from = from;
    if (to) req.to = to;
    if (assetClass) req.asset_class = assetClass;
    if (accountId) req.account_id = accountId;
    return req;
  }

  function buildAccountCatalogQueryRequest(): QueryAccountCatalogRequest {
    const req: QueryAccountCatalogRequest = {
      kind: acctCatalogQuery.kind ?? "all",
      limit: Number(acctCatalogQuery.limit ?? 200),
    };
    const keyword = `${acctCatalogQuery.keyword ?? ""}`.trim();
    if (keyword) req.keyword = keyword;
    return req;
  }

  function buildAccountCatalogUpsertRequest(): UpsertAccountCatalogEntryRequest {
    const req: UpsertAccountCatalogEntryRequest = {
      account_name: `${acctCatalogUpsertForm.account_name ?? ""}`.trim(),
      account_kind: acctCatalogUpsertForm.account_kind,
    };
    const accountId = `${acctCatalogUpsertForm.account_id ?? ""}`.trim();
    if (accountId) req.account_id = accountId;
    return req;
  }

  function buildAdminResetRequest(): { confirm_text?: string } {
    return { confirm_text: adminResetConfirmText.trim() };
  }

  async function handleMonthlyBudgetItemsQuery() {
    setBudgetItemsBusy(true);
    setBudgetItemsError("");
    try {
      const payload = await queryMonthlyBudgetItems();
      startTransition(() => {
        setBudgetItemsResult(payload);
      });
    } catch (err) {
      setBudgetItemsError(toErrorMessage(err));
    } finally {
      setBudgetItemsBusy(false);
    }
  }

  async function handleUpsertMonthlyBudgetItem() {
    setBudgetItemUpsertBusy(true);
    setBudgetItemUpsertError("");
    try {
      const payload = await upsertMonthlyBudgetItem(buildBudgetItemUpsertMutationRequest());
      startTransition(() => {
        setBudgetItemUpsertResult(payload);
      });
      void handleMonthlyBudgetItemsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleFireProgressQuery();
    } catch (err) {
      setBudgetItemUpsertError(toErrorMessage(err));
    } finally {
      setBudgetItemUpsertBusy(false);
    }
  }

  async function handleDeleteMonthlyBudgetItem() {
    setBudgetItemDeleteBusy(true);
    setBudgetItemDeleteError("");
    try {
      const payload = await deleteMonthlyBudgetItem(buildBudgetItemDeleteMutationRequest());
      startTransition(() => {
        setBudgetItemDeleteResult(payload);
      });
      void handleMonthlyBudgetItemsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleFireProgressQuery();
    } catch (err) {
      setBudgetItemDeleteError(toErrorMessage(err));
    } finally {
      setBudgetItemDeleteBusy(false);
    }
  }

  async function handleBudgetOverviewQuery() {
    setBudgetOverviewBusy(true);
    setBudgetOverviewError("");
    try {
      const payload = await queryBudgetOverview(buildBudgetYearQueryRequest(budgetOverviewQuery));
      startTransition(() => {
        setBudgetOverviewResult(payload);
      });
    } catch (err) {
      setBudgetOverviewError(toErrorMessage(err));
    } finally {
      setBudgetOverviewBusy(false);
    }
  }

  async function handleBudgetMonthlyReviewQuery() {
    setBudgetReviewBusy(true);
    setBudgetReviewError("");
    try {
      const payload = await queryBudgetMonthlyReview(buildBudgetYearQueryRequest(budgetReviewQuery));
      startTransition(() => {
        setBudgetReviewResult(payload);
      });
    } catch (err) {
      setBudgetReviewError(toErrorMessage(err));
    } finally {
      setBudgetReviewBusy(false);
    }
  }

  async function handleFireProgressQuery() {
    setFireProgressBusy(true);
    setFireProgressError("");
    try {
      const payload = await queryFireProgress(buildFireProgressQueryRequest());
      startTransition(() => {
        setFireProgressResult(payload);
      });
    } catch (err) {
      setFireProgressError(toErrorMessage(err));
    } finally {
      setFireProgressBusy(false);
    }
  }

  async function handleSalaryIncomeOverviewQuery() {
    setSalaryIncomeBusy(true);
    setSalaryIncomeError("");
    try {
      const payload = await querySalaryIncomeOverview(buildBudgetYearQueryRequest(salaryIncomeQuery));
      startTransition(() => {
        setSalaryIncomeResult(payload);
      });
    } catch (err) {
      setSalaryIncomeError(toErrorMessage(err));
    } finally {
      setSalaryIncomeBusy(false);
    }
  }

  async function handleConsumptionOverviewQuery() {
    setConsumptionOverviewBusy(true);
    setConsumptionOverviewError("");
    try {
      const payload = await queryConsumptionReport();
      startTransition(() => {
        setConsumptionOverviewResult(payload);
      });
    } catch (err) {
      setConsumptionOverviewError(toErrorMessage(err));
    } finally {
      setConsumptionOverviewBusy(false);
    }
  }

  async function handleAccountCatalogQuery() {
    setAcctCatalogBusy(true);
    setAcctCatalogError("");
    try {
      const payload = await queryAccountCatalog(buildAccountCatalogQueryRequest());
      startTransition(() => {
        setAcctCatalogResult(payload);
      });
    } catch (err) {
      setAcctCatalogError(toErrorMessage(err));
    } finally {
      setAcctCatalogBusy(false);
    }
  }

  async function handleAccountCatalogUpsert() {
    setAcctCatalogUpsertBusy(true);
    setAcctCatalogUpsertError("");
    try {
      const payload = await upsertAccountCatalogEntry(buildAccountCatalogUpsertRequest());
      startTransition(() => {
        setAcctCatalogUpsertResult(payload);
      });
      void handleAccountCatalogQuery();
      void handleMetaAccountsQuery();
    } catch (err) {
      setAcctCatalogUpsertError(toErrorMessage(err));
    } finally {
      setAcctCatalogUpsertBusy(false);
    }
  }

  async function handleAccountCatalogDelete() {
    setAcctCatalogDeleteBusy(true);
    setAcctCatalogDeleteError("");
    try {
      const payload = await deleteAccountCatalogEntry({
        account_id: acctCatalogDeleteId.trim(),
      });
      startTransition(() => {
        setAcctCatalogDeleteResult(payload);
      });
      void handleAccountCatalogQuery();
      void handleMetaAccountsQuery();
    } catch (err) {
      setAcctCatalogDeleteError(toErrorMessage(err));
    } finally {
      setAcctCatalogDeleteBusy(false);
    }
  }

  function compactStringFields<T extends Record<string, unknown>>(input: T): T {
    const out = { ...input } as Record<string, unknown>;
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === "string") out[key] = value.trim();
    }
    return out as T;
  }

  async function handleUpsertManualInvestment() {
    setManualInvBusy(true);
    setManualInvError("");
    try {
      const payload = await upsertManualInvestment(compactStringFields(manualInvForm));
      startTransition(() => setManualInvResult(payload));
      void handleInvestmentsListQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setManualInvError(toErrorMessage(err));
    } finally {
      setManualInvBusy(false);
    }
  }

  async function handleUpdateInvestmentRecordMutation() {
    setUpdateInvBusy(true);
    setUpdateInvError("");
    try {
      const payload = await updateInvestmentRecord(compactStringFields(updateInvForm));
      startTransition(() => setUpdateInvResult(payload));
      void handleInvestmentsListQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setUpdateInvError(toErrorMessage(err));
    } finally {
      setUpdateInvBusy(false);
    }
  }

  async function handleDeleteInvestmentRecordMutation() {
    setDeleteInvBusy(true);
    setDeleteInvError("");
    try {
      const payload = await deleteInvestmentRecord({ id: deleteInvId.trim() } satisfies DeleteByIdRequest);
      startTransition(() => setDeleteInvResult(payload));
      void handleInvestmentsListQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setDeleteInvError(toErrorMessage(err));
    } finally {
      setDeleteInvBusy(false);
    }
  }

  async function handleUpsertManualAssetValuationMutation() {
    setManualAssetBusy(true);
    setManualAssetError("");
    try {
      const payload = await upsertManualAssetValuation(compactStringFields(manualAssetForm));
      startTransition(() => setManualAssetResult(payload));
      void handleAssetValuationsQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setManualAssetError(toErrorMessage(err));
    } finally {
      setManualAssetBusy(false);
    }
  }

  async function handleUpdateAssetValuationMutation() {
    setUpdateAssetBusy(true);
    setUpdateAssetError("");
    try {
      const payload = await updateAssetValuation(compactStringFields(updateAssetForm));
      startTransition(() => setUpdateAssetResult(payload));
      void handleAssetValuationsQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setUpdateAssetError(toErrorMessage(err));
    } finally {
      setUpdateAssetBusy(false);
    }
  }

  async function handleDeleteAssetValuationMutation() {
    setDeleteAssetBusy(true);
    setDeleteAssetError("");
    try {
      const payload = await deleteAssetValuation({ id: deleteAssetId.trim() } satisfies DeleteByIdRequest);
      startTransition(() => setDeleteAssetResult(payload));
      void handleAssetValuationsQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
    } catch (err) {
      setDeleteAssetError(toErrorMessage(err));
    } finally {
      setDeleteAssetBusy(false);
    }
  }

  useEffect(() => {
    const deriveRouteRow = (args: {
      key: ImportStepKey;
      label: string;
      pathText: string;
      previewBusy: boolean;
      previewError: string;
      previewResult: unknown;
      importBusy: boolean;
      importError: string;
      importResult: unknown;
      summarizePreview: (payload: unknown) => string;
      summarizeImport: (payload: unknown) => string;
    }): ImportStepRow => {
      const pathReady = args.pathText.trim().length > 0;
      const previewState: ImportStepStatus = args.previewBusy
        ? "running"
        : args.previewError
          ? "fail"
          : args.previewResult
            ? "pass"
            : pathReady
              ? "idle"
              : "skip";
      const importState: ImportStepStatus = args.importBusy
        ? "running"
        : args.importError
          ? "fail"
          : args.importResult
            ? "pass"
            : "idle";

      let status: ImportStepStatus = "idle";
      if (!pathReady) status = "skip";
      if (previewState === "running" || importState === "running") status = "running";
      else if (previewState === "fail" || importState === "fail") status = "fail";
      else if (importState === "pass") status = "pass";
      else if (previewState === "pass") status = "pass";
      else if (pathReady) status = "idle";

      const previewSummary = args.previewResult ? args.summarizePreview(args.previewResult) : "";
      const importSummary = args.importResult ? args.summarizeImport(args.importResult) : "";

      let detail = "";
      if (!pathReady) {
        detail = "请选择文件/目录，然后先执行预览";
      } else if (args.previewBusy || args.importBusy) {
        detail = "正在执行...";
      } else if (args.previewError) {
        detail = `预览失败：${args.previewError}`;
      } else if (args.importError) {
        detail = `导入失败：${args.importError}`;
      } else if (args.importResult) {
        detail = importSummary || "已导入，可查看查询/健康面板确认结果";
      } else if (args.previewResult) {
        detail = `${previewSummary || "预览已完成"} | 可执行导入`;
      } else {
        detail = "路径已设置，先执行预览确认";
      }

      return { key: args.key, label: args.label, status, detail };
    };

    const nextRows = [
      deriveRouteRow({
        key: "yzxy",
        label: "有知有行 XLSX/CSV",
        pathText: yzxyFilePath,
        previewBusy: yzxyPreviewBusy,
        previewError: yzxyPreviewError,
        previewResult: yzxyPreviewResult,
        importBusy: yzxyImportBusy,
        importError: yzxyImportError,
        importResult: yzxyImportResult,
        summarizePreview: summarizeYzxyPreviewPayload,
        summarizeImport: summarizeYzxyImportPayload,
      }),
      deriveRouteRow({
        key: "cmb-eml",
        label: "招行信用卡 EML",
        pathText: emlSourcePath,
        previewBusy: emlPreviewBusy,
        previewError: emlPreviewError,
        previewResult: emlPreviewResult,
        importBusy: emlImportBusy,
        importError: emlImportError,
        importResult: emlImportResult,
        summarizePreview: summarizeCmbEmlPreviewPayload,
        summarizeImport: summarizeCmbEmlImportPayload,
      }),
      deriveRouteRow({
        key: "cmb-pdf",
        label: "招行银行流水 PDF",
        pathText: cmbPdfPath,
        previewBusy: cmbPdfPreviewBusy,
        previewError: cmbPdfPreviewError,
        previewResult: cmbPdfPreviewResult,
        importBusy: cmbPdfImportBusy,
        importError: cmbPdfImportError,
        importResult: cmbPdfImportResult,
        summarizePreview: summarizeCmbBankPdfPreviewPayload,
        summarizeImport: summarizeCmbBankPdfImportPayload,
      }),
    ] satisfies ImportStepRow[];

    const failCount = nextRows.filter((r) => r.status === "fail").length;
    const runningCount = nextRows.filter((r) => r.status === "running").length;
    const passCount = nextRows.filter((r) => r.status === "pass").length;
    const skipCount = nextRows.filter((r) => r.status === "skip").length;
    const idleCount = nextRows.filter((r) => r.status === "idle").length;

    const nextStatus: PipelineStatus =
      runningCount > 0 ? "running" : failCount > 0 ? "fail" : passCount > 0 ? "pass" : "idle";
    const nextMessage =
      nextStatus === "idle"
        ? "请在下方三个导入面板中手动执行预览 / 导入；此处展示当前准备状态与最近结果摘要。"
        : `通过=${passCount} | 失败=${failCount} | 运行中=${runningCount} | 空闲=${idleCount} | 跳过=${skipCount}`;

    startTransition(() => {
      setImportCenterRows(nextRows);
      setImportCenterStatus(nextStatus);
      setImportCenterMessage(nextMessage);
      setImportCenterLastRunAt(Date.now());
    });
  }, [
    yzxyFilePath,
    yzxyPreviewBusy,
    yzxyPreviewError,
    yzxyPreviewResult,
    yzxyImportBusy,
    yzxyImportError,
    yzxyImportResult,
    emlSourcePath,
    emlPreviewBusy,
    emlPreviewError,
    emlPreviewResult,
    emlImportBusy,
    emlImportError,
    emlImportResult,
    cmbPdfPath,
    cmbPdfPreviewBusy,
    cmbPdfPreviewError,
    cmbPdfPreviewResult,
    cmbPdfImportBusy,
    cmbPdfImportError,
    cmbPdfImportResult,
  ]);

  async function runCoreAnalyticsSmokeSequence(): Promise<SmokeRow[]> {
    setSmokeBusy(true);
    let nextRows = makeInitialSmokeRows();
    startTransition(() => setSmokeRows(nextRows));

    const commitRow = (row: SmokeRow) => {
      nextRows = withSmokeResult(nextRows, row);
      startTransition(() => setSmokeRows(nextRows));
    };

    const runOne = async <T,>(
      rowBase: Pick<SmokeRow, "key" | "label">,
      fn: () => Promise<T>,
      onSuccess: (payload: T) => void,
      onError: (message: string) => void,
      summarize: (payload: T) => string,
    ) => {
      const started = Date.now();
      try {
        const payload = await fn();
        onSuccess(payload);
        commitRow({
          ...rowBase,
          status: "pass",
          durationMs: Date.now() - started,
          detail: summarize(payload),
        });
      } catch (err) {
        const message = toErrorMessage(err);
        onError(message);
        commitRow({
          ...rowBase,
          status: "fail",
          durationMs: Date.now() - started,
          detail: message,
        });
      }
    };

    try {
      await runOne(
        { key: "investment-return", label: "投资区间收益率" },
        () => queryInvestmentReturn(buildInvestmentReturnRequest()),
        (payload) => {
          startTransition(() => {
            setInvResult(payload);
            setInvError("");
          });
        },
        (message) => setInvError(message),
        summarizeInvestmentReturnPayload,
      );

      await runOne(
        { key: "investment-curve", label: "投资曲线" },
        () => queryInvestmentCurve(buildInvestmentCurveRequest()),
        (payload) => {
          startTransition(() => {
            setInvCurveResult(payload);
            setInvCurveError("");
          });
        },
        (message) => setInvCurveError(message),
        summarizeInvestmentCurvePayload,
      );

      await runOne(
        { key: "wealth-overview", label: "财富总览" },
        () => queryWealthOverview(buildWealthOverviewRequest()),
        (payload) => {
          startTransition(() => {
            setWealthOverviewResult(payload);
            setWealthOverviewError("");
          });
        },
        (message) => setWealthOverviewError(message),
        summarizeWealthOverviewPayload,
      );

      await runOne(
        { key: "wealth-curve", label: "财富曲线" },
        () => queryWealthCurve(buildWealthCurveRequest()),
        (payload) => {
          startTransition(() => {
            setWealthCurveResult(payload);
            setWealthCurveError("");
          });
        },
        (message) => setWealthCurveError(message),
        summarizeWealthCurvePayload,
      );

      startTransition(() => setSmokeLastRunAt(Date.now()));
      return nextRows;
    } finally {
      setSmokeBusy(false);
    }
  }

  async function handleRunCoreAnalyticsSmoke() {
    await runCoreAnalyticsSmokeSequence();
  }

  async function handleRunValidationPipeline() {
    if (pipelineBusy) return;
    setPipelineBusy(true);
    setPipelineStatus("running");
    setPipelineMessage("");
    try {
      const mode = dbImportPath.trim() ? "path" : "repo";
      const importResult = await runDbImportSequence(mode);
      const rows = await runCoreAnalyticsSmokeSequence();
      void handleRunRuntimeHealthCheck();
      const allPassed = rows.every((row) => row.status === "pass");
      startTransition(() => {
        setPipelineStatus(allPassed ? "pass" : "fail");
        setPipelineLastRunAt(Date.now());
        setPipelineMessage(
          `${mode === "path" ? "导入成功 from selected path" : "导入成功 repo runtime DB"} | copied=${importResult.copied_bytes} bytes | smoke ${allPassed ? "PASS" : "FAIL"}`,
        );
      });
    } catch (err) {
      startTransition(() => {
        setPipelineStatus("fail");
        setPipelineLastRunAt(Date.now());
        setPipelineMessage(toErrorMessage(err));
      });
    } finally {
      setPipelineBusy(false);
    }
  }

  async function handleInvestmentReturnQuery() {
    setInvBusy(true);
    setInvError("");
    try {
      const payload = await queryInvestmentReturn(buildInvestmentReturnRequest());
      startTransition(() => {
        setInvResult(payload);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      setInvError(message);
    } finally {
      setInvBusy(false);
    }
  }

  async function handleInvestmentReturnsQuery() {
    setInvBatchBusy(true);
    setInvBatchError("");
    try {
      const payload = await queryInvestmentReturns(buildInvestmentReturnsRequest());
      startTransition(() => {
        setInvBatchResult(payload);
      });
    } catch (err) {
      setInvBatchError(toErrorMessage(err));
    } finally {
      setInvBatchBusy(false);
    }
  }

  async function handleInvestmentCurveQuery() {
    setInvCurveBusy(true);
    setInvCurveError("");
    try {
      const payload = await queryInvestmentCurve(buildInvestmentCurveRequest());
      startTransition(() => {
        setInvCurveResult(payload);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      setInvCurveError(message);
    } finally {
      setInvCurveBusy(false);
    }
  }

  async function handleWealthOverviewQuery() {
    setWealthOverviewBusy(true);
    setWealthOverviewError("");
    try {
      const payload = await queryWealthOverview(buildWealthOverviewRequest());
      startTransition(() => {
        setWealthOverviewResult(payload);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      setWealthOverviewError(message);
    } finally {
      setWealthOverviewBusy(false);
    }
  }

  async function handleWealthCurveQuery() {
    setWealthCurveBusy(true);
    setWealthCurveError("");
    try {
      const payload = await queryWealthCurve(buildWealthCurveRequest());
      startTransition(() => {
        setWealthCurveResult(payload);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      setWealthCurveError(message);
    } finally {
      setWealthCurveBusy(false);
    }
  }

  async function handleMetaAccountsQuery() {
    setMetaAccountsBusy(true);
    setMetaAccountsError("");
    try {
      const payload = await queryMetaAccounts(buildMetaAccountsRequest());
      startTransition(() => {
        setMetaAccountsResult(payload);
      });
    } catch (err) {
      setMetaAccountsError(toErrorMessage(err));
    } finally {
      setMetaAccountsBusy(false);
    }
  }

  async function handleTransactionsQuery() {
    setTxListBusy(true);
    setTxListError("");
    try {
      const payload = await queryTransactions(buildTransactionsQueryRequest());
      startTransition(() => {
        setTxListResult(payload);
      });
    } catch (err) {
      setTxListError(toErrorMessage(err));
    } finally {
      setTxListBusy(false);
    }
  }

  async function handleTransactionAnalysisExclusionMutation() {
    setTxExclusionBusy(true);
    setTxExclusionError("");
    try {
      const payload = await updateTransactionAnalysisExclusion({
        id: `${txExclusionForm.id ?? ""}`.trim(),
        action: txExclusionForm.action,
        reason: `${txExclusionForm.reason ?? ""}`.trim(),
      });
      startTransition(() => {
        setTxExclusionResult(payload);
      });
      void handleTransactionsQuery();
      void handleConsumptionOverviewQuery();
    } catch (err) {
      setTxExclusionError(toErrorMessage(err));
    } finally {
      setTxExclusionBusy(false);
    }
  }

  async function handleInvestmentsListQuery() {
    setInvListBusy(true);
    setInvListError("");
    try {
      const payload = await queryInvestments(buildInvestmentsListQueryRequest());
      startTransition(() => {
        setInvListResult(payload);
      });
    } catch (err) {
      setInvListError(toErrorMessage(err));
    } finally {
      setInvListBusy(false);
    }
  }

  async function handleAssetValuationsQuery() {
    setAssetListBusy(true);
    setAssetListError("");
    try {
      const payload = await queryAssetValuations(buildAssetValuationsQueryRequest());
      startTransition(() => {
        setAssetListResult(payload);
      });
    } catch (err) {
      setAssetListError(toErrorMessage(err));
    } finally {
      setAssetListBusy(false);
    }
  }

  useEffect(() => {
    void Promise.all([refreshProbe(), refreshDbStatus()]);
  }, []);

  const [activeTab, setActiveTab] = useState<ProductTabKey>("import-center");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isReady = status === "ready";
  const activeTabMeta = PRODUCT_TABS.find((tab) => tab.key === activeTab) ?? PRODUCT_TABS[0];
  const isTab = (...keys: ProductTabKey[]) => keys.includes(activeTab);
  const isManualEntryTab = isTab("manual-entry");
  const isBaseQueryTab = isTab("base-query");
  const isConsumptionAnalysisTab = isTab("consumption-analysis");
  const showDebugJson = showRawJson && isTab("admin");
  const queryWorkbenchHeader = isManualEntryTab
    ? {
        title: "手动录入",
        description: "集中处理账户目录、投资记录与资产估值的手工录入/修改/删除，形成桌面端数据修正闭环。",
      }
    : isConsumptionAnalysisTab
      ? {
          title: "消费交易查询与剔除",
          description: "聚焦消费交易查询与分析剔除操作，便于校正统计口径并快速回看交易明细。",
        }
      : {
          title: "基础查询",
          description: "查看账户元数据、投资记录与资产估值等基础数据，为收益分析和财富总览提供核查入口。",
        };
  const queryWorkbenchModules = isManualEntryTab
    ? ["账户目录维护", "投资记录维护", "资产估值维护"]
    : isConsumptionAnalysisTab
      ? ["交易查询", "分析剔除", "消费总览联动"]
      : ["账户元数据", "投资记录查询", "资产估值查询"];
  const queryWorkbenchFlow = isManualEntryTab
    ? ["先查询账户目录确认 account_id", "执行写入/修改/删除", "回到基础查询或收益分析验证结果"]
    : isConsumptionAnalysisTab
      ? ["先刷新消费总览", "在交易查询中定位交易", "执行剔除/恢复并回看总览变化"]
      : ["先查账户元数据确认范围", "再查投资/资产明细", "必要时切换到手动录入进行纠错"];
  const queryWorkbenchGridModeClass = isManualEntryTab
    ? "mode-manual"
    : isConsumptionAnalysisTab
      ? "mode-consumption"
      : "mode-base";

  return (
    <main className="app-shell">
      <div className={`workspace-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside className={`card workspace-sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="功能导航">
          <div className="workspace-sidebar-head">
            <div className="workspace-brand">
              <div className="workspace-brand-icon" aria-hidden="true">
                <img src={keepwiseLogoSvg} alt="" />
              </div>
              <div className="workspace-brand-text">
                <div className="workspace-brand-name">KeepWise</div>
                <div className="workspace-brand-subtitle">Desktop</div>
              </div>
            </div>
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? "展开侧栏" : "收纳侧栏（仅显示图标）"}
              aria-label={sidebarCollapsed ? "展开侧栏" : "收纳侧栏"}
              aria-pressed={sidebarCollapsed}
            >
              {sidebarCollapsed ? ">" : "<"}
            </button>
          </div>
          <nav className="tab-nav">
            {PRODUCT_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`tab-nav-btn ${activeTab === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
                title={`${tab.label} · ${tab.subtitle}`}
              >
                <span className="tab-nav-main">
                  <span className={`tab-nav-icon tab-status-${tab.status}`} aria-hidden="true">
                    {tab.icon}
                  </span>
                  <span className="tab-nav-title">{tab.label}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="workspace-content">
          <section className="card workspace-tab-header">
            <div>
              <p className="eyebrow">工作区</p>
              <h2>{activeTabMeta.label}</h2>
              <p className="workspace-tab-copy">{activeTabMeta.subtitle}</p>
            </div>
            <div className="workspace-tab-actions">
              {isTab("admin") ? (
                <button type="button" className="secondary-btn" onClick={() => setShowRawJson((v) => !v)}>
                  {showRawJson ? "隐藏原始 JSON" : "显示原始 JSON"}
                </button>
              ) : null}
              <div className={`status-pill status-${status}`}>桌面 {status.toUpperCase()}</div>
            </div>
          </section>

          {isTab("consumption-analysis") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>消费总览</h2>
                <p>基于账本交易数据直接渲染消费分析（分类分布、月度趋势、商户分布），不再嵌入独立 HTML 报告。</p>
              </div>

              <div className="db-actions">
                <button type="button" className="primary-btn" onClick={() => void handleConsumptionOverviewQuery()} disabled={consumptionOverviewBusy}>
                  {consumptionOverviewBusy ? "执行中..." : "刷新消费总览"}
                </button>
              </div>

              {consumptionOverviewError ? (
                <div className="inline-error" role="alert">
                  {consumptionOverviewError}
                </div>
              ) : null}

              <ConsumptionOverviewPreview data={consumptionOverviewResult} />
              {showDebugJson ? (
                <JsonResultCard
                  title="消费总览 JSON"
                  data={consumptionOverviewResult}
                  emptyText="暂无消费总览结果。请先导入招行 EML / 招行 PDF 后再刷新。"
                />
              ) : null}
            </section>
          ) : null}

          {isTab("manual-entry", "base-query", "consumption-analysis") ? (
            <section className="card panel workbench-intro-panel">
              <div className="panel-header">
                <h2>{queryWorkbenchHeader.title} 导览</h2>
                <p>{queryWorkbenchHeader.description}</p>
              </div>
              <div className="workbench-module-strip">
                {queryWorkbenchModules.map((label) => (
                  <span key={label} className="workbench-module-pill">{label}</span>
                ))}
              </div>
              <ol className="workbench-flow-list">
                {queryWorkbenchFlow.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>预算项管理</h2>
                <p>月预算条目 CRUD（与 Web 版 `monthly_budget_items` 口径一致）。修改后可直接重跑预算概览 / 月度复盘 / FIRE 进度。</p>
              </div>

              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>预算项 ID（编辑时填写）</span>
                  <input
                    value={`${budgetItemForm.id ?? ""}`}
                    onChange={(e) => setBudgetItemForm((s) => ({ ...s, id: e.target.value }))}
                    placeholder="留空表示新建"
                  />
                </label>
                <label className="field">
                  <span>预算项名称</span>
                  <input
                    value={`${budgetItemForm.name ?? ""}`}
                    onChange={(e) => setBudgetItemForm((s) => ({ ...s, name: e.target.value }))}
                    placeholder="如：日常开销"
                  />
                </label>
                <label className="field">
                  <span>月预算金额（元）</span>
                  <input
                    value={`${budgetItemForm.monthly_amount ?? ""}`}
                    onChange={(e) => setBudgetItemForm((s) => ({ ...s, monthly_amount: e.target.value }))}
                    placeholder="3000.00"
                  />
                </label>
                <label className="field">
                  <span>排序</span>
                  <input
                    value={`${budgetItemForm.sort_order ?? ""}`}
                    onChange={(e) => setBudgetItemForm((s) => ({ ...s, sort_order: e.target.value }))}
                    placeholder="1000"
                  />
                </label>
                <BoolField
                  label="是否启用"
                  value={budgetItemForm.is_active ?? "true"}
                  onChange={(value) => setBudgetItemForm((s) => ({ ...s, is_active: value }))}
                />
              </div>

              <div className="db-actions">
                <button type="button" className="primary-btn" onClick={() => void handleMonthlyBudgetItemsQuery()} disabled={budgetItemsBusy}>
                  {budgetItemsBusy ? "执行中..." : "刷新预算项"}
                </button>
                <button type="button" className="secondary-btn" onClick={() => void handleUpsertMonthlyBudgetItem()} disabled={budgetItemUpsertBusy}>
                  {budgetItemUpsertBusy ? "执行中..." : "写入预算项"}
                </button>
              </div>

              {budgetItemsError ? <div className="inline-error" role="alert">{budgetItemsError}</div> : null}
              {budgetItemUpsertError ? <div className="inline-error" role="alert">{budgetItemUpsertError}</div> : null}

              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>删除预算项 ID</span>
                  <input
                    value={`${budgetItemDeleteForm.id ?? ""}`}
                    onChange={(e) => setBudgetItemDeleteForm({ id: e.target.value })}
                    placeholder="budget_item_xxx 或 uuid"
                  />
                </label>
              </div>
              <div className="db-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void handleDeleteMonthlyBudgetItem()}
                  disabled={budgetItemDeleteBusy || !`${budgetItemDeleteForm.id ?? ""}`.trim()}
                >
                  {budgetItemDeleteBusy ? "执行中..." : "删除预算项"}
                </button>
              </div>
              {budgetItemDeleteError ? <div className="inline-error" role="alert">{budgetItemDeleteError}</div> : null}

              {budgetItemUpsertResult ? <JsonResultCard title="预算项写入结果" data={budgetItemUpsertResult} emptyText="暂无结果。" /> : null}
              {budgetItemDeleteResult ? <JsonResultCard title="预算项删除结果" data={budgetItemDeleteResult} emptyText="暂无结果。" /> : null}

              <BudgetItemsPreview data={budgetItemsResult} />
              {showRawJson ? (
                <JsonResultCard title="预算项列表 JSON" data={budgetItemsResult} emptyText="暂无预算项结果。" />
              ) : null}
            </section>
          ) : null}

          {isTab("income-analysis") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>工资收入概览</h2>
                <p>按年汇总招行银行流水中的代发工资/公积金收入，并展示雇主分布与月度结构。</p>
              </div>

              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>年份</span>
                  <input
                    value={`${salaryIncomeQuery.year ?? ""}`}
                    onChange={(e) => setSalaryIncomeQuery((s) => ({ ...s, year: e.target.value }))}
                    placeholder="2026"
                  />
                </label>
              </div>

              <div className="db-actions">
                <button type="button" className="primary-btn" onClick={() => void handleSalaryIncomeOverviewQuery()} disabled={salaryIncomeBusy}>
                  {salaryIncomeBusy ? "执行中..." : "查询工资收入概览"}
                </button>
              </div>

              {salaryIncomeError ? <div className="inline-error" role="alert">{salaryIncomeError}</div> : null}
              <SalaryIncomeOverviewPreview data={salaryIncomeResult} />
              {showRawJson ? (
                <JsonResultCard title="工资收入概览 JSON" data={salaryIncomeResult} emptyText="暂无结果。请先导入招行银行流水后再查询。" />
              ) : null}
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>预算概览</h2>
                <p>按年查看预算、实际支出、年剩余与 YTD 偏差。</p>
              </div>
              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>年份</span>
                  <input
                    value={`${budgetOverviewQuery.year ?? ""}`}
                    onChange={(e) => setBudgetOverviewQuery((s) => ({ ...s, year: e.target.value }))}
                    placeholder="2026"
                  />
                </label>
              </div>
              <div className="db-actions">
                <button type="button" className="primary-btn" onClick={() => void handleBudgetOverviewQuery()} disabled={budgetOverviewBusy}>
                  {budgetOverviewBusy ? "执行中..." : "查询预算概览"}
                </button>
              </div>
              {budgetOverviewError ? <div className="inline-error" role="alert">{budgetOverviewError}</div> : null}
              <BudgetOverviewPreview data={budgetOverviewResult} />
              {showRawJson ? <JsonResultCard title="预算概览 JSON" data={budgetOverviewResult} emptyText="暂无预算概览结果。" /> : null}
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>预算月度复盘</h2>
                <p>按月份查看预算/支出/偏差/状态（超预算、低于预算、持平）。</p>
              </div>
              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>年份</span>
                  <input
                    value={`${budgetReviewQuery.year ?? ""}`}
                    onChange={(e) => setBudgetReviewQuery((s) => ({ ...s, year: e.target.value }))}
                    placeholder="2026"
                  />
                </label>
              </div>
              <div className="db-actions">
                <button type="button" className="primary-btn" onClick={() => void handleBudgetMonthlyReviewQuery()} disabled={budgetReviewBusy}>
                  {budgetReviewBusy ? "执行中..." : "查询预算月度复盘"}
                </button>
              </div>
              {budgetReviewError ? <div className="inline-error" role="alert">{budgetReviewError}</div> : null}
              <BudgetMonthlyReviewPreview data={budgetReviewResult} />
              {showRawJson ? <JsonResultCard title="预算月度复盘 JSON" data={budgetReviewResult} emptyText="暂无预算月度复盘结果。" /> : null}
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>FIRE 进度</h2>
                <p>基于年预算与可投资产（投资 + 现金）计算覆盖年数、自由度与目标差额。</p>
              </div>
              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>年份</span>
                  <input
                    value={`${fireProgressQuery.year ?? ""}`}
                    onChange={(e) => setFireProgressQuery((s) => ({ ...s, year: e.target.value }))}
                    placeholder="2026"
                  />
                </label>
                <label className="field">
                  <span>提取率（0~1）</span>
                  <input
                    value={`${fireProgressQuery.withdrawal_rate ?? ""}`}
                    onChange={(e) => setFireProgressQuery((s) => ({ ...s, withdrawal_rate: e.target.value }))}
                    placeholder="0.04"
                  />
                </label>
              </div>
              <div className="db-actions">
                <button type="button" className="primary-btn" onClick={() => void handleFireProgressQuery()} disabled={fireProgressBusy}>
                  {fireProgressBusy ? "执行中..." : "查询 FIRE 进度"}
                </button>
              </div>
              {fireProgressError ? <div className="inline-error" role="alert">{fireProgressError}</div> : null}
              <FireProgressPreview data={fireProgressResult} />
              {showRawJson ? <JsonResultCard title="FIRE 进度 JSON" data={fireProgressResult} emptyText="暂无 FIRE 进度结果。" /> : null}
            </section>
          ) : null}

      {isTab("admin") && status === "error" && (
        <section className="card alert-card" role="alert">
          <h2>命令探针失败</h2>
          <p>
            前端已经尝试调用 Tauri command，但没有拿到有效返回。若你是在浏览器直接运行 `npm run dev`，这是预期现象。
            请使用 `npm run tauri dev`。
          </p>
          <pre>{error}</pre>
        </section>
      )}

      {isTab("admin") ? <section className="panel-grid">
        <section className="card panel">
          <div className="panel-header">
            <h2>命令探针</h2>
            <p>第一批基础命令：`health_ping` / `app_metadata` / `app_paths`</p>
          </div>

          <div className="stack">
            <div className="subcard">
              <h3>健康检查</h3>
              {isReady && probe ? (
                <dl className="kv-grid">
                  <dt>状态</dt>
                  <dd>{probe.health.status}</dd>
                  <dt>模式</dt>
                  <dd>{probe.health.mode}</dd>
                  <dt>时间戳</dt>
                  <dd>{probe.health.unix_ts}</dd>
                </dl>
              ) : (
                <p className="placeholder">等待命令返回...</p>
              )}
            </div>

            <div className="subcard">
              <h3>应用信息</h3>
              {isReady && probe ? (
                <dl className="kv-grid">
                  <dt>应用名称</dt>
                  <dd>{probe.metadata.app_name}</dd>
                  <dt>版本</dt>
                  <dd>{probe.metadata.app_version}</dd>
                  <dt>标识符</dt>
                  <dd>{probe.metadata.app_identifier ?? "-"}</dd>
                  <dt>构建模式</dt>
                  <dd>{probe.metadata.debug ? "debug" : "release"}</dd>
                  <dt>Tauri 主版本</dt>
                  <dd>{probe.metadata.tauri_major}</dd>
                </dl>
              ) : (
                <p className="placeholder">等待命令返回...</p>
              )}
            </div>
          </div>
        </section>

        <section className="card panel">
          <div className="panel-header">
            <h2>应用路径</h2>
            <p>后续 SQLite、规则文件、日志、导入缓存都会基于这些目录能力落地。</p>
          </div>

          {isReady && probe ? (
            <div className="path-list">
              <PathRow label="应用数据" probe={probe.paths.app_data_dir} />
              <PathRow label="应用配置" probe={probe.paths.app_config_dir} />
              <PathRow label="应用缓存" probe={probe.paths.app_cache_dir} />
              <PathRow label="应用日志" probe={probe.paths.app_log_dir} />
              <PathRow label="应用本地数据" probe={probe.paths.app_local_data_dir} />
            </div>
          ) : (
            <p className="placeholder">等待路径解析结果...</p>
          )}
        </section>
      </section> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>桌面账本数据库（SQLite）</h2>
          <p>第一条真实基础能力：在 Tauri desktop 内初始化数据库并执行嵌入迁移脚本。</p>
        </div>

        <div className="db-actions">
          <button type="button" className="primary-btn" onClick={() => void refreshDbStatus()} disabled={dbBusy}>
            刷新数据库状态
          </button>
          <button type="button" className="primary-btn" onClick={() => void handleRunMigrations()} disabled={dbBusy}>
            {dbBusy ? "执行中..." : "初始化 / 迁移数据库"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleImportRepoRuntimeDb()}
            disabled={dbBusy}
            title="复制仓库默认运行库 data/work/processed/ledger/keepwise.db 到 Tauri app 本地库"
          >
            {dbBusy ? "执行中..." : "导入仓库运行库"}
          </button>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>从路径导入已有数据库</span>
            <input
              value={dbImportPath}
              onChange={(e) => setDbImportPath(e.target.value)}
              placeholder="/absolute/path/to/keepwise.db"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickDbImportPath()}
            disabled={dbBusy}
            title="打开系统文件选择器，选择已有 keepwise.db"
          >
            浏览...
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleImportDbFromPath()}
            disabled={dbBusy || !dbImportPath.trim()}
            title="导入任意已有 keepwise.db 到 Tauri app 本地库（将覆盖当前 app 库）"
          >
            {dbBusy ? "执行中..." : "从路径导入数据库"}
          </button>
        </div>
        <p className="inline-hint">
          适用于导入任意已有 `keepwise.db`（例如历史备份、副本、其他环境生成的库）。开发期也可继续使用上面的
          `导入仓库运行库` 快捷按钮。
        </p>

        {dbStatusError ? (
          <div className="inline-error" role="alert">
            {dbStatusError}
          </div>
        ) : null}

        {dbStatus ? (
          <div className="db-grid">
            <div className="subcard">
              <h3>状态</h3>
              <dl className="kv-grid">
                <dt>数据库存在</dt>
                <dd>{String(dbStatus.exists)}</dd>
                <dt>迁移表存在</dt>
                <dd>{String(dbStatus.schema_migrations_table_exists)}</dd>
                <dt>可用</dt>
                <dd>{String(dbStatus.ready)}</dd>
                <dt>已应用</dt>
                <dd>
                  {dbStatus.applied_versions.length} / {dbStatus.migration_files.length}
                </dd>
                <dt>待执行</dt>
                <dd>{dbStatus.pending_versions.length}</dd>
              </dl>
            </div>

            <div className="subcard">
              <h3>数据库路径</h3>
              <code className="path-value">{dbStatus.db_path}</code>
            </div>
          </div>
        ) : (
          <p className="placeholder">等待数据库状态...</p>
        )}

        {dbStatus ? (
          <div className="db-grid db-grid-lists">
            <div className="subcard">
              <h3>已应用版本</h3>
              {dbStatus.applied_versions.length > 0 ? (
                <ul className="mono-list">
                  {dbStatus.applied_versions.map((v) => (
                    <li key={v}>
                      <code>{v}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">尚未应用迁移。</p>
              )}
            </div>
            <div className="subcard">
              <h3>待执行版本</h3>
              {dbStatus.pending_versions.length > 0 ? (
                <ul className="mono-list">
                  {dbStatus.pending_versions.map((v) => (
                    <li key={v}>
                      <code>{v}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">没有待执行迁移。</p>
              )}
            </div>
          </div>
        ) : null}

        {dbLastResult ? (
          <div className="subcard db-result-card">
            <h3>最近迁移结果</h3>
            <dl className="kv-grid">
              <dt>是否新建</dt>
              <dd>{String(dbLastResult.created)}</dd>
              <dt>本次应用</dt>
              <dd>{dbLastResult.applied_now.length}</dd>
              <dt>跳过</dt>
              <dd>{dbLastResult.skipped.length}</dd>
              <dt>累计已应用</dt>
              <dd>{dbLastResult.applied_total}</dd>
              <dt>累计待执行</dt>
              <dd>{dbLastResult.pending_total}</dd>
            </dl>
          </div>
        ) : null}

        {dbImportLastResult ? (
          <div className="subcard db-result-card">
            <h3>最近导入仓库运行库结果</h3>
            <dl className="kv-grid">
              <dt>源数据库</dt>
              <dd>
                <code className="path-value">{dbImportLastResult.source_db_path}</code>
              </dd>
              <dt>目标数据库</dt>
              <dd>
                <code className="path-value">{dbImportLastResult.target_db_path}</code>
              </dd>
              <dt>是否覆盖已有</dt>
              <dd>{String(dbImportLastResult.replaced_existing)}</dd>
              <dt>复制字节数</dt>
              <dd>{dbImportLastResult.copied_bytes}</dd>
              <dt>迁移本次应用</dt>
              <dd>{dbImportLastResult.migrate_result.applied_now.length}</dd>
              <dt>迁移待执行总数</dt>
              <dd>{dbImportLastResult.migrate_result.pending_total}</dd>
            </dl>
          </div>
        ) : null}
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>导入中心（桌面）</h2>
          <p>统一展示三条 Rust 导入链路的手动导入准备状态、Preview 摘要与最近 Import 结果（不在此处批量执行）。</p>
        </div>

        <div className="db-actions">
          <div className="smoke-last-run">
            状态更新时间：{importCenterLastRunAt ? new Date(importCenterLastRunAt).toLocaleTimeString() : "-"}
          </div>
        </div>

        <div className="pipeline-status-row">
          <span
            className={`status-pill status-${
              importCenterStatus === "idle"
                ? "idle"
                : importCenterStatus === "running"
                  ? "loading"
                  : importCenterStatus === "pass"
                    ? "ready"
                    : "error"
            }`}
          >
            导入中心 {importCenterStatus.toUpperCase()}
          </span>
          <span className="pipeline-last-run">
            手动流程：先 Preview 确认，再 Import（每条导入链路独立执行）
          </span>
        </div>
        {importCenterMessage ? <p className="pipeline-message">{importCenterMessage}</p> : null}

        <div className="smoke-grid">
          {importCenterRows.map((row) => {
            const rowTone =
              row.status === "pass"
                ? "smoke-pass"
                : row.status === "fail"
                  ? "smoke-fail"
                  : "";
            const pillTone =
              row.status === "pass"
                ? "ready"
                : row.status === "fail"
                  ? "error"
                  : row.status === "running"
                    ? "loading"
                    : "idle";
            return (
              <div key={row.key} className={`smoke-row ${rowTone}`.trim()}>
                <div className="smoke-row-head">
                  <code>{row.label}</code>
                  <span className={`status-pill status-${pillTone}`}>{row.status.toUpperCase()}</span>
                </div>
                <div className="smoke-row-meta">
                  <span>{typeof row.durationMs === "number" ? `${row.durationMs} ms` : "-"}</span>
                </div>
                <div className="smoke-row-detail" title={row.detail}>
                  {row.detail ?? "尚未执行"}
                </div>
              </div>
            );
          })}
        </div>

        <p className="inline-hint">
          此处仅展示三种导入方式的“路径是否已选择 / Preview 是否完成 / Import 最近结果”。实际操作请在下方各面板逐项手动执行。
        </p>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>有知有行导入</h2>
          <p>Rust 原生解析并导入有知有行导出文件（`.csv` / `.xlsx`），用于构建 desktop 端完整导入验证闭环。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>有知有行导出文件</span>
            <input
              value={yzxyFilePath}
              onChange={(e) => setYzxyFilePath(e.target.value)}
              placeholder="/absolute/path/to/youzhiyouxing.xlsx"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickYzxyFilePath()}
            disabled={yzxyPreviewBusy || yzxyImportBusy}
          >
            浏览...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>来源类型</span>
            <input
              value={yzxySourceType}
              onChange={(e) => setYzxySourceType(e.target.value)}
              placeholder="yzxy_xlsx"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleYzxyPreview()}
            disabled={yzxyPreviewBusy || yzxyImportBusy || !yzxyFilePath.trim()}
          >
            {yzxyPreviewBusy ? "预览中..." : "预览有知有行文件"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleYzxyImport()}
            disabled={yzxyImportBusy || yzxyPreviewBusy || !yzxyFilePath.trim()}
            title="导入到 Tauri app 本地账本；导入成功后会自动刷新投资相关查询与分析面板"
          >
            {yzxyImportBusy ? "导入中..." : "导入有知有行到桌面数据库"}
          </button>
        </div>

        <p className="inline-hint">
          建议流程：先 `Preview` 确认映射与样例，再 `Import`。导入成功后会自动刷新 `Investments / Meta Accounts /
          账户目录 / Analytics` 面板，便于立即验证结果。
        </p>

        {yzxyPreviewError ? (
          <div className="inline-error" role="alert">
            {yzxyPreviewError}
          </div>
        ) : null}
        {yzxyImportError ? (
          <div className="inline-error" role="alert">
            {yzxyImportError}
          </div>
        ) : null}

        <div className="db-grid">
          <div className="subcard">
            <h3>预览结果</h3>
            <YzxyPreviewSummaryReport data={yzxyPreviewResult} />
            {showRawJson ? (
              <JsonResultCard title="有知有行预览 JSON" data={yzxyPreviewResult} emptyText="尚未预览。请选择有知有行文件后执行预览。" />
            ) : null}
          </div>
          <div className="subcard">
            <h3>导入结果</h3>
            <YzxyImportSummaryReport data={yzxyImportResult} />
            {showRawJson ? (
              <JsonResultCard title="有知有行导入 JSON" data={yzxyImportResult} emptyText="尚未导入。请在预览确认后执行导入。" />
            ) : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>招行信用卡 EML 导入</h2>
          <p>Rust 原生解析招行信用卡 EML（支持单文件或目录递归扫描），完成 preview + import 并写入 `transactions`。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>EML 文件 / 目录</span>
            <input
              value={emlSourcePath}
              onChange={(e) => setEmlSourcePath(e.target.value)}
              placeholder="/absolute/path/to/file.eml or /dir/of/eml/"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickEmlFile()}
            disabled={emlPreviewBusy || emlImportBusy}
          >
            选择文件...
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickEmlFolder()}
            disabled={emlPreviewBusy || emlImportBusy}
          >
            选择目录...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>复核阈值</span>
            <input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={safeNumericInputValue(emlReviewThreshold, 0.7)}
              onChange={(e) => setEmlReviewThreshold(parseNumericInputWithFallback(e.target.value || "0.7", 0.7))}
            />
          </label>
          <label className="field">
            <span>来源类型</span>
            <input
              value={emlSourceType}
              onChange={(e) => setEmlSourceType(e.target.value)}
              placeholder="cmb_eml"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleCmbEmlPreview()}
            disabled={emlPreviewBusy || emlImportBusy || !emlSourcePath.trim()}
          >
            {emlPreviewBusy ? "预览中..." : "预览招行 EML"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleCmbEmlImport()}
            disabled={emlImportBusy || emlPreviewBusy || !emlSourcePath.trim()}
            title="导入到 desktop 本地库，导入成功后自动刷新 Transactions/Admin Health 等面板"
          >
            {emlImportBusy ? "导入中..." : "导入招行 EML 到桌面数据库"}
          </button>
        </div>

        <p className="inline-hint">
          支持直接选择单个 `.eml` 或选择目录进行递归扫描。建议先 `Preview` 查看解析/分类结果摘要，再执行 `Import`。
        </p>

        {emlPreviewError ? (
          <div className="inline-error" role="alert">
            {emlPreviewError}
          </div>
        ) : null}
        {emlImportError ? (
          <div className="inline-error" role="alert">
            {emlImportError}
          </div>
        ) : null}

        <div className="db-grid">
          <div className="subcard">
            <h3>EML 预览结果</h3>
            <CmbEmlPreviewSummaryReport data={emlPreviewResult} />
            {showRawJson ? <JsonResultCard title="招行 EML 预览 JSON" data={emlPreviewResult} emptyText="尚未预览。" /> : null}
          </div>
          <div className="subcard">
            <h3>EML 导入结果</h3>
            <CmbEmlImportSummaryReport data={emlImportResult} />
            {showRawJson ? <JsonResultCard title="招行 EML 导入 JSON" data={emlImportResult} emptyText="尚未导入。" /> : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>招行银行流水 PDF 导入</h2>
          <p>Rust 原生解析招商银行流水 PDF，执行规则分类并导入 `transactions`（desktop-only 验证链路）。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>银行流水 PDF</span>
            <input
              value={cmbPdfPath}
              onChange={(e) => setCmbPdfPath(e.target.value)}
              placeholder="/absolute/path/to/cmb_bank_statement.pdf"
            />
          </label>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickCmbPdfFile()}
            disabled={cmbPdfPreviewBusy || cmbPdfImportBusy}
          >
            选择 PDF...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>复核阈值</span>
            <input
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={safeNumericInputValue(cmbPdfReviewThreshold, 0.7)}
              onChange={(e) =>
                setCmbPdfReviewThreshold(parseNumericInputWithFallback(e.target.value || "0.7", 0.7))
              }
            />
          </label>
          <label className="field">
            <span>来源类型</span>
            <input
              value={cmbPdfSourceType}
              onChange={(e) => setCmbPdfSourceType(e.target.value)}
              placeholder="cmb_bank_pdf"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleCmbBankPdfPreview()}
            disabled={cmbPdfPreviewBusy || cmbPdfImportBusy || !cmbPdfPath.trim()}
          >
            {cmbPdfPreviewBusy ? "预览中..." : "预览招行银行流水 PDF"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleCmbBankPdfImport()}
            disabled={cmbPdfImportBusy || cmbPdfPreviewBusy || !cmbPdfPath.trim()}
            title="导入到 desktop 本地库，完成后自动刷新 Transactions/Health 面板"
          >
            {cmbPdfImportBusy ? "导入中..." : "导入招行银行流水 PDF 到桌面数据库"}
          </button>
        </div>

        <p className="inline-hint">
          建议先 `Preview` 检查 `rule_counts / summary / samples`，确认工资、转账、借记卡消费识别逻辑正常后再导入。
        </p>

        {cmbPdfPreviewError ? (
          <div className="inline-error" role="alert">
            {cmbPdfPreviewError}
          </div>
        ) : null}
        {cmbPdfImportError ? (
          <div className="inline-error" role="alert">
            {cmbPdfImportError}
          </div>
        ) : null}

        <div className="db-grid">
          <div className="subcard">
            <h3>招行 PDF 预览结果</h3>
            <CmbBankPdfPreviewSummaryReport data={cmbPdfPreviewResult} />
            {showRawJson ? <JsonResultCard title="招行 PDF 预览 JSON" data={cmbPdfPreviewResult} emptyText="尚未预览。" /> : null}
          </div>
          <div className="subcard">
            <h3>招行 PDF 导入结果</h3>
            <CmbBankPdfImportSummaryReport data={cmbPdfImportResult} />
            {showRawJson ? <JsonResultCard title="招行 PDF 导入 JSON" data={cmbPdfImportResult} emptyText="尚未导入。" /> : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <RulesAdminPanel showRawJson={showRawJson} /> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>管理员数据库健康</h2>
          <p>桌面侧运行库健康快照：对齐 Web 管理页的 `admin/db-stats` 核心口径（表计数 + 总行数）。</p>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRefreshAdminDbStats()}
            disabled={adminDbStatsBusy || dbBusy}
          >
            {adminDbStatsBusy ? "刷新中..." : "刷新管理员数据库统计"}
          </button>
          <div className="smoke-last-run">
            最近运行：{adminDbStatsLastRunAt ? new Date(adminDbStatsLastRunAt).toLocaleTimeString() : "-"}
          </div>
        </div>

        {adminDbStatsError ? (
          <div className="inline-error" role="alert">
            {adminDbStatsError}
          </div>
        ) : null}

        <AdminDbStatsPreview data={adminDbStatsResult} />
        <div className="subcard danger-zone">
          <h3>管理员重置</h3>
          <p className="inline-hint">
            Desktop 侧管理员重置能力（破坏性操作）。需输入确认口令 <code>{readString(adminDbStatsResult, "confirm_phrase") ?? "RESET KEEPWISE"}</code>。
          </p>

          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>确认口令</span>
              <input
                value={adminResetConfirmText}
                onChange={(e) => setAdminResetConfirmText(e.target.value)}
                placeholder={readString(adminDbStatsResult, "confirm_phrase") ?? "RESET KEEPWISE"}
              />
            </label>
          </div>

          <div className="db-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleAdminResetTransactions()}
              disabled={dbBusy || adminResetTxBusy || adminResetAllBusy}
              title="仅清理 transactions / reconciliations / import_jobs(transaction sources)"
            >
              {adminResetTxBusy ? "重置中..." : "重置交易范围"}
            </button>
            <button
              type="button"
              className="danger-btn"
              onClick={() => void handleAdminResetAll()}
              disabled={dbBusy || adminResetAllBusy || adminResetTxBusy}
              title="清理管理员数据表（高风险）"
            >
              {adminResetAllBusy ? "重置中..." : "管理员全量重置"}
            </button>
          </div>

          {adminResetTxError ? (
            <div className="inline-error" role="alert">
              {adminResetTxError}
            </div>
          ) : null}
          {adminResetAllError ? (
            <div className="inline-error" role="alert">
              {adminResetAllError}
            </div>
          ) : null}

          {adminResetTxResult ? (
            <JsonResultCard
              title="管理员重置交易范围结果"
              data={adminResetTxResult}
              emptyText="暂无交易范围重置结果。"
            />
          ) : null}
          {adminResetAllResult ? (
            <JsonResultCard
              title="管理员全量重置结果"
              data={adminResetAllResult}
              emptyText="暂无全量重置结果。"
            />
          ) : null}
        </div>
        {showRawJson ? (
          <JsonResultCard
            title="管理员数据库统计 JSON"
            data={adminDbStatsResult}
            emptyText="暂无管理员数据库统计。请先初始化/导入桌面数据库后再刷新。"
          />
        ) : null}
      </section> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>核心分析冒烟验证（桌面）</h2>
          <p>批量执行 4 个核心 Rust 接口，快速确认当前 desktop 本地库是否能稳定返回成功态。</p>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRunValidationPipeline()}
            disabled={pipelineBusy || dbBusy || smokeBusy}
            title="一键执行：导入数据库（优先使用已选择路径，否则使用 repo runtime）+ 4 个核心接口 smoke"
          >
            {pipelineBusy ? "执行验证流程中..." : "运行验证流程"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRunCoreAnalyticsSmoke()}
            disabled={smokeBusy || pipelineBusy}
          >
            {smokeBusy ? "执行冒烟验证中..." : "运行核心分析冒烟验证"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setShowRawJson((v) => !v)}
            disabled={pipelineBusy}
          >
            {showRawJson ? "隐藏原始 JSON" : "显示原始 JSON"}
          </button>
          <div className="smoke-last-run">
            最近运行：{smokeLastRunAt ? new Date(smokeLastRunAt).toLocaleTimeString() : "-"}
          </div>
        </div>

        <div className="pipeline-status-row">
          <span
            className={`status-pill status-${
              pipelineStatus === "idle"
                ? "idle"
                : pipelineStatus === "running"
                  ? "loading"
                  : pipelineStatus === "pass"
                    ? "ready"
                    : "error"
            }`}
          >
            流程 {pipelineStatus.toUpperCase()}
          </span>
          <span className="pipeline-last-run">
            最近流程运行：{pipelineLastRunAt ? new Date(pipelineLastRunAt).toLocaleTimeString() : "-"}
          </span>
        </div>
        {pipelineMessage ? <p className="pipeline-message">{pipelineMessage}</p> : null}

        <div className="smoke-grid">
          {smokeRows.map((row) => (
            <div key={row.key} className={`smoke-row smoke-${row.status}`}>
              <div className="smoke-row-head">
                <code>{row.label}</code>
                <span className={`status-pill status-${row.status === "idle" ? "idle" : row.status === "pass" ? "ready" : "error"}`}>
                  {row.status.toUpperCase()}
                </span>
              </div>
              <div className="smoke-row-meta">
                <span>{typeof row.durationMs === "number" ? `${row.durationMs} ms` : "-"}</span>
              </div>
              <div className="smoke-row-detail" title={row.detail}>
                {row.detail ?? "尚未执行"}
              </div>
            </div>
          ))}
        </div>
      </section> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>运行库健康检查</h2>
          <p>非破坏性健康巡检：组合 `db-stats`、基础表探针、财富总览与组合收益曲线检查。</p>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRunRuntimeHealthCheck()}
            disabled={runtimeHealthBusy || dbBusy}
          >
            {runtimeHealthBusy ? "执行健康检查中..." : "运行运行库健康检查"}
          </button>
          <div className="smoke-last-run">
            最近运行：{runtimeHealthLastRunAt ? new Date(runtimeHealthLastRunAt).toLocaleTimeString() : "-"}
          </div>
        </div>

        {runtimeHealthError ? (
          <div className="inline-error" role="alert">
            {runtimeHealthError}
          </div>
        ) : null}

        <RuntimeHealthPreview data={runtimeHealthResult} />
        {showRawJson ? (
          <JsonResultCard
            title="运行库健康检查 JSON"
            data={runtimeHealthResult}
            emptyText="暂无运行库健康检查结果。请先初始化/导入桌面数据库后再执行健康检查。"
          />
        ) : null}
      </section> : null}

      {isTab("return-analysis") ? <section className="card panel">
        <div className="panel-header">
          <h2>投资收益率对比</h2>
          <p>批量账户收益率对比：`investment-returns`（用于账户横向比较与异常账户识别）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>预设区间</span>
            <select
              value={`${invBatchQuery.preset ?? "ytd"}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, preset: e.target.value }))}
            >
              <option value="ytd">ytd</option>
              <option value="1y">1y</option>
              <option value="3y">3y</option>
              <option value="since_inception">since_inception</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="field">
            <span>开始日期（自定义）</span>
            <input
              value={`${invBatchQuery.from ?? ""}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>结束日期（可选）</span>
            <input
              value={`${invBatchQuery.to ?? ""}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>关键词（可选）</span>
            <input
              value={`${invBatchQuery.keyword ?? ""}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, keyword: e.target.value }))}
              placeholder="账户 ID / 名称"
            />
          </label>
          <label className="field">
            <span>数量</span>
            <input
              type="number"
              min={1}
              max={500}
              value={safeNumericInputValue(invBatchQuery.limit, 200)}
              onChange={(e) =>
                setInvBatchQuery((s) => ({
                  ...s,
                  limit: parseNumericInputWithFallback(e.target.value || "200", 200),
                }))
              }
            />
          </label>
        </div>

        <div className="db-actions">
          <button type="button" className="primary-btn" onClick={() => void handleInvestmentReturnsQuery()} disabled={invBatchBusy}>
            {invBatchBusy ? "执行中..." : "查询账户收益率对比"}
          </button>
        </div>

        {invBatchError ? (
          <div className="inline-error" role="alert">
            {invBatchError}
          </div>
        ) : null}

        <InvestmentReturnsPreview data={invBatchResult} />
        {showRawJson ? (
          <JsonResultCard
            title="投资收益率对比 JSON"
            data={invBatchResult}
            emptyText="暂无结果。请先导入桌面数据库后再查询账户收益率对比。"
          />
        ) : null}
      </section> : null}

      {isTab("manual-entry", "consumption-analysis", "base-query") ? <section className="card panel workbench-shell-panel">
        <div className="panel-header">
          <h2>{queryWorkbenchHeader.title}</h2>
          <p>按功能分区展示操作面板，优先支持“查询 → 校正 → 复查”的桌面工作流。</p>
        </div>

        <div className={`workbench-card-grid ${queryWorkbenchGridModeClass}`}>
          {isManualEntryTab ? <div className="subcard">
            <h3>账户目录维护</h3>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>查询类型</span>
                <select
                  value={acctCatalogQuery.kind ?? "all"}
                  onChange={(e) =>
                    setAcctCatalogQuery((s) => ({
                      ...s,
                      kind: e.target.value as QueryAccountCatalogRequest["kind"],
                    }))
                  }
                >
                  <option value="all">all</option>
                  <option value="investment">investment</option>
                  <option value="cash">cash</option>
                  <option value="real_estate">real_estate</option>
                  <option value="bank">bank</option>
                  <option value="credit_card">credit_card</option>
                  <option value="wallet">wallet</option>
                  <option value="liability">liability</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label className="field">
                <span>查询关键词</span>
                <input
                  value={`${acctCatalogQuery.keyword ?? ""}`}
                  onChange={(e) => setAcctCatalogQuery((s) => ({ ...s, keyword: e.target.value }))}
                  placeholder="账户 ID / 名称 / 类型"
                />
              </label>
              <label className="field">
                <span>查询数量</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={safeNumericInputValue(acctCatalogQuery.limit, 200)}
                  onChange={(e) =>
                    setAcctCatalogQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "200", 200),
                    }))
                  }
                />
              </label>
            </div>

            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleAccountCatalogQuery()} disabled={acctCatalogBusy}>
                {acctCatalogBusy ? "执行中..." : "查询账户目录"}
              </button>
            </div>

            {acctCatalogError ? (
              <div className="inline-error" role="alert">
                {acctCatalogError}
              </div>
            ) : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>写入账户 ID（编辑时可填）</span>
                <input
                  value={`${acctCatalogUpsertForm.account_id ?? ""}`}
                  onChange={(e) => setAcctCatalogUpsertForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="留空则按 account_kind + name 生成"
                />
              </label>
              <label className="field">
                <span>写入账户名称</span>
                <input
                  value={`${acctCatalogUpsertForm.account_name ?? ""}`}
                  onChange={(e) => setAcctCatalogUpsertForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="账户名称"
                />
              </label>
              <label className="field">
                <span>写入账户类型</span>
                <select
                  value={acctCatalogUpsertForm.account_kind ?? "cash"}
                  onChange={(e) =>
                    setAcctCatalogUpsertForm((s) => ({
                      ...s,
                      account_kind: e.target.value as UpsertAccountCatalogEntryRequest["account_kind"],
                    }))
                  }
                >
                  <option value="investment">investment</option>
                  <option value="cash">cash</option>
                  <option value="real_estate">real_estate</option>
                  <option value="bank">bank</option>
                  <option value="credit_card">credit_card</option>
                  <option value="wallet">wallet</option>
                  <option value="liability">liability</option>
                  <option value="other">other</option>
                </select>
              </label>
            </div>

            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleAccountCatalogUpsert()}
                disabled={acctCatalogUpsertBusy}
              >
                {acctCatalogUpsertBusy ? "执行中..." : "写入账户目录条目"}
              </button>
            </div>

            {acctCatalogUpsertError ? (
              <div className="inline-error" role="alert">
                {acctCatalogUpsertError}
              </div>
            ) : null}

            {acctCatalogUpsertResult ? (
              <JsonResultCard
                title="账户目录 Upsert Result"
                data={acctCatalogUpsertResult}
                emptyText="No upsert result."
              />
            ) : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>删除账户 ID</span>
                <input
                  value={acctCatalogDeleteId}
                  onChange={(e) => setAcctCatalogDeleteId(e.target.value)}
                  placeholder="acct_xxx"
                />
              </label>
            </div>

            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleAccountCatalogDelete()}
                disabled={acctCatalogDeleteBusy || !acctCatalogDeleteId.trim()}
              >
                {acctCatalogDeleteBusy ? "执行中..." : "删除账户目录条目"}
              </button>
            </div>

            {acctCatalogDeleteError ? (
              <div className="inline-error" role="alert">
                {acctCatalogDeleteError}
              </div>
            ) : null}

            {acctCatalogDeleteResult ? (
              <JsonResultCard
                title="账户目录 Delete Result"
                data={acctCatalogDeleteResult}
                emptyText="No delete result."
              />
            ) : null}

            <AccountCatalogPreview data={acctCatalogResult} />
            {showDebugJson ? (
              <JsonResultCard
                title="账户目录 JSON"
                data={acctCatalogResult}
                emptyText="暂无结果。请先查询账户目录。"
              />
            ) : null}
          </div> : null}

          {isManualEntryTab ? <div className="subcard">
            <h3>记录维护</h3>
            <p className="inline-hint">
              用于 desktop 内验证投资记录与资产估值的新增/修改/删除。成功后会自动刷新 `query_investments` / `query_asset_valuations` / `meta/accounts` / `account_catalog`。
            </p>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>投资写入快照日期</span>
                <input
                  value={`${manualInvForm.snapshot_date ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>投资写入账户 ID（可选）</span>
                <input
                  value={`${manualInvForm.account_id ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_inv_xxx"
                />
              </label>
              <label className="field">
                <span>投资写入账户名称</span>
                <input
                  value={`${manualInvForm.account_name ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="手工投资账户"
                />
              </label>
              <label className="field">
                <span>投资写入总资产</span>
                <input
                  value={`${manualInvForm.total_assets ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, total_assets: e.target.value }))}
                  placeholder="10000.00"
                />
              </label>
              <label className="field">
                <span>投资写入净转入</span>
                <input
                  value={`${manualInvForm.transfer_amount ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, transfer_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="secondary-btn" onClick={() => void handleUpsertManualInvestment()} disabled={manualInvBusy}>
                {manualInvBusy ? "执行中..." : "写入手工投资记录"}
              </button>
            </div>
            {manualInvError ? <div className="inline-error" role="alert">{manualInvError}</div> : null}
            {manualInvResult ? <JsonResultCard title="手工投资记录写入结果" data={manualInvResult} emptyText="暂无结果。" /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>投资更新记录 ID</span>
                <input
                  value={`${updateInvForm.id ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, id: e.target.value }))}
                  placeholder="investment record id"
                />
              </label>
              <label className="field">
                <span>投资更新快照日期</span>
                <input
                  value={`${updateInvForm.snapshot_date ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>投资更新账户 ID（可选）</span>
                <input
                  value={`${updateInvForm.account_id ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_inv_xxx"
                />
              </label>
              <label className="field">
                <span>投资更新账户名称</span>
                <input
                  value={`${updateInvForm.account_name ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="用于生成新账户ID（当 account_id 为空）"
                />
              </label>
              <label className="field">
                <span>投资更新总资产</span>
                <input
                  value={`${updateInvForm.total_assets ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, total_assets: e.target.value }))}
                  placeholder="10000.00"
                />
              </label>
              <label className="field">
                <span>投资更新净转入</span>
                <input
                  value={`${updateInvForm.transfer_amount ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, transfer_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </label>
            </div>
            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateInvestmentRecordMutation()}
                disabled={updateInvBusy}
              >
                {updateInvBusy ? "执行中..." : "更新投资记录"}
              </button>
            </div>
            {updateInvError ? <div className="inline-error" role="alert">{updateInvError}</div> : null}
            {updateInvResult ? <JsonResultCard title="投资记录更新结果" data={updateInvResult} emptyText="暂无结果。" /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>投资删除记录 ID</span>
                <input value={deleteInvId} onChange={(e) => setDeleteInvId(e.target.value)} placeholder="investment record id" />
              </label>
            </div>
            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleDeleteInvestmentRecordMutation()}
                disabled={deleteInvBusy || !deleteInvId.trim()}
              >
                {deleteInvBusy ? "执行中..." : "删除投资记录"}
              </button>
            </div>
            {deleteInvError ? <div className="inline-error" role="alert">{deleteInvError}</div> : null}
            {deleteInvResult ? <JsonResultCard title="投资记录删除结果" data={deleteInvResult} emptyText="暂无结果。" /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>资产写入类型</span>
                <select
                  value={manualAssetForm.asset_class ?? "cash"}
                  onChange={(e) =>
                    setManualAssetForm((s) => ({
                      ...s,
                      asset_class: e.target.value as UpsertManualAssetValuationRequest["asset_class"],
                    }))
                  }
                >
                  <option value="cash">cash</option>
                  <option value="real_estate">real_estate</option>
                  <option value="liability">liability</option>
                </select>
              </label>
              <label className="field">
                <span>资产写入快照日期</span>
                <input
                  value={`${manualAssetForm.snapshot_date ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>资产写入账户 ID（可选）</span>
                <input
                  value={`${manualAssetForm.account_id ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_cash_xxx / acct_re_xxx / acct_liab_xxx"
                />
              </label>
              <label className="field">
                <span>资产写入账户名称</span>
                <input
                  value={`${manualAssetForm.account_name ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="现金账户 / 不动产账户 / 负债账户"
                />
              </label>
              <label className="field">
                <span>资产写入数值</span>
                <input
                  value={`${manualAssetForm.value ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, value: e.target.value }))}
                  placeholder="500000.00"
                />
              </label>
            </div>
            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpsertManualAssetValuationMutation()}
                disabled={manualAssetBusy}
              >
                {manualAssetBusy ? "执行中..." : "写入手工资产估值"}
              </button>
            </div>
            {manualAssetError ? <div className="inline-error" role="alert">{manualAssetError}</div> : null}
            {manualAssetResult ? <JsonResultCard title="手工资产估值写入结果" data={manualAssetResult} emptyText="暂无结果。" /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>资产更新记录 ID</span>
                <input
                  value={`${updateAssetForm.id ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, id: e.target.value }))}
                  placeholder="asset valuation id"
                />
              </label>
              <label className="field">
                <span>资产更新类型</span>
                <select
                  value={updateAssetForm.asset_class ?? "cash"}
                  onChange={(e) =>
                    setUpdateAssetForm((s) => ({
                      ...s,
                      asset_class: e.target.value as UpdateAssetValuationRequest["asset_class"],
                    }))
                  }
                >
                  <option value="cash">cash</option>
                  <option value="real_estate">real_estate</option>
                  <option value="liability">liability</option>
                </select>
              </label>
              <label className="field">
                <span>资产更新快照日期</span>
                <input
                  value={`${updateAssetForm.snapshot_date ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>资产更新账户 ID（可选）</span>
                <input
                  value={`${updateAssetForm.account_id ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_xxx"
                />
              </label>
              <label className="field">
                <span>资产更新账户名称</span>
                <input
                  value={`${updateAssetForm.account_name ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="account name"
                />
              </label>
              <label className="field">
                <span>资产更新数值</span>
                <input
                  value={`${updateAssetForm.value ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, value: e.target.value }))}
                  placeholder="500000.00"
                />
              </label>
            </div>
            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleUpdateAssetValuationMutation()}
                disabled={updateAssetBusy}
              >
                {updateAssetBusy ? "执行中..." : "更新资产估值"}
              </button>
            </div>
            {updateAssetError ? <div className="inline-error" role="alert">{updateAssetError}</div> : null}
            {updateAssetResult ? <JsonResultCard title="资产估值更新结果" data={updateAssetResult} emptyText="暂无结果。" /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>资产删除记录 ID</span>
                <input value={deleteAssetId} onChange={(e) => setDeleteAssetId(e.target.value)} placeholder="asset valuation id" />
              </label>
            </div>
            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleDeleteAssetValuationMutation()}
                disabled={deleteAssetBusy || !deleteAssetId.trim()}
              >
                {deleteAssetBusy ? "执行中..." : "删除资产估值"}
              </button>
            </div>
            {deleteAssetError ? <div className="inline-error" role="alert">{deleteAssetError}</div> : null}
            {deleteAssetResult ? <JsonResultCard title="资产估值删除结果" data={deleteAssetResult} emptyText="暂无结果。" /> : null}
          </div> : null}

          {isBaseQueryTab ? <div className="subcard">
            <h3>账户元数据查询</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>类型</span>
                <select
                  value={metaAccountsQuery.kind ?? "all"}
                  onChange={(e) =>
                    setMetaAccountsQuery({
                      kind: e.target.value as MetaAccountsQueryRequest["kind"],
                    })
                  }
                >
                  <option value="all">all</option>
                  <option value="investment">investment</option>
                  <option value="cash">cash</option>
                  <option value="real_estate">real_estate</option>
                  <option value="liability">liability</option>
                </select>
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleMetaAccountsQuery()} disabled={metaAccountsBusy}>
                {metaAccountsBusy ? "执行中..." : "查询账户元数据"}
              </button>
            </div>
            {metaAccountsError ? (
              <div className="inline-error" role="alert">
                {metaAccountsError}
              </div>
            ) : null}
            <MetaAccountsPreview data={metaAccountsResult} />
            {showDebugJson ? (
              <JsonResultCard
                title="账户元数据 JSON"
                data={metaAccountsResult}
                emptyText="暂无结果。请先查询账户元数据。"
              />
            ) : null}
          </div> : null}

          {isConsumptionAnalysisTab ? <div className="subcard">
            <h3>交易查询</h3>
            <div className="query-form-grid">
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(txListQuery.limit, 100)}
                  onChange={(e) =>
                    setTxListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "100", 100),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>排序</span>
                <select
                  value={txListQuery.sort ?? "date_desc"}
                  onChange={(e) =>
                    setTxListQuery((s) => ({
                      ...s,
                      sort: e.target.value as QueryTransactionsRequest["sort"],
                    }))
                  }
                >
                  <option value="date_desc">date_desc</option>
                  <option value="date_asc">date_asc</option>
                  <option value="amount_desc">amount_desc</option>
                  <option value="amount_asc">amount_asc</option>
                </select>
              </label>
              <label className="field">
                <span>月份</span>
                <input
                  value={`${txListQuery.month_key ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, month_key: e.target.value }))}
                  placeholder="YYYY-MM"
                />
              </label>
              <label className="field">
                <span>关键词</span>
                <input
                  value={`${txListQuery.keyword ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, keyword: e.target.value }))}
                  placeholder="商户/摘要/分类"
                />
              </label>
              <label className="field">
                <span>来源类型</span>
                <input
                  value={`${txListQuery.source_type ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, source_type: e.target.value }))}
                  placeholder="cmb_eml / cmb_bank_pdf"
                />
              </label>
              <label className="field">
                <span>账户 ID</span>
                <input
                  value={`${txListQuery.account_id ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_xxx"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleTransactionsQuery()} disabled={txListBusy}>
                {txListBusy ? "执行中..." : "查询交易记录"}
              </button>
            </div>
            {txListError ? (
              <div className="inline-error" role="alert">
                {txListError}
              </div>
            ) : null}
            <TransactionsPreview data={txListResult} />
            {showDebugJson ? (
              <JsonResultCard title="交易查询 JSON" data={txListResult} emptyText="暂无结果。请先查询交易记录。" />
            ) : null}
          </div> : null}

          {isConsumptionAnalysisTab ? <div className="subcard">
            <h3>交易分析剔除</h3>
            <p className="inline-hint">
              对齐 Web `update_transaction_analysis_exclusion`：可手动剔除/恢复交易的分析统计状态。先在 `交易查询` 中取 `id`。
            </p>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>交易 ID</span>
                <input
                  value={`${txExclusionForm.id ?? ""}`}
                  onChange={(e) => setTxExclusionForm((s) => ({ ...s, id: e.target.value }))}
                  placeholder="transactions.id"
                />
              </label>
              <label className="field">
                <span>操作</span>
                <select
                  value={txExclusionForm.action ?? "exclude"}
                  onChange={(e) =>
                    setTxExclusionForm((s) => ({
                      ...s,
                      action: e.target.value as UpdateTransactionAnalysisExclusionRequest["action"],
                    }))
                  }
                >
                  <option value="exclude">剔除</option>
                  <option value="restore">恢复</option>
                </select>
              </label>
              <label className="field">
                <span>原因（仅剔除时）</span>
                <input
                  value={`${txExclusionForm.reason ?? ""}`}
                  onChange={(e) => setTxExclusionForm((s) => ({ ...s, reason: e.target.value }))}
                  placeholder="手动剔除（查询页）"
                />
              </label>
            </div>

            <div className="db-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => void handleTransactionAnalysisExclusionMutation()}
                disabled={txExclusionBusy || !`${txExclusionForm.id ?? ""}`.trim()}
              >
                {txExclusionBusy ? "执行中..." : "执行交易分析剔除"}
              </button>
            </div>

            {txExclusionError ? (
              <div className="inline-error" role="alert">
                {txExclusionError}
              </div>
            ) : null}
            {txExclusionResult ? (
              <JsonResultCard
                title="交易分析剔除结果"
                data={txExclusionResult}
                emptyText="暂无变更结果。"
              />
            ) : null}
          </div> : null}

          {isBaseQueryTab ? <div className="subcard">
            <h3>投资记录查询</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(invListQuery.limit, 100)}
                  onChange={(e) =>
                    setInvListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "100", 100),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>开始日期</span>
                <input
                  value={`${invListQuery.from ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, from: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>结束日期</span>
                <input
                  value={`${invListQuery.to ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, to: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>来源类型</span>
                <input
                  value={`${invListQuery.source_type ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, source_type: e.target.value }))}
                  placeholder="manual / yzxy_xlsx / ..."
                />
              </label>
              <label className="field">
                <span>账户 ID</span>
                <input
                  value={`${invListQuery.account_id ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_inv_xxx"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleInvestmentsListQuery()} disabled={invListBusy}>
                {invListBusy ? "执行中..." : "查询投资记录"}
              </button>
            </div>
            {invListError ? (
              <div className="inline-error" role="alert">
                {invListError}
              </div>
            ) : null}
            <InvestmentsListPreview data={invListResult} />
            {showDebugJson ? (
              <JsonResultCard title="投资记录查询 JSON" data={invListResult} emptyText="暂无结果。请先查询投资记录。" />
            ) : null}
          </div> : null}

          {isBaseQueryTab ? <div className="subcard">
            <h3>资产估值查询</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(assetListQuery.limit, 100)}
                  onChange={(e) =>
                    setAssetListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "100", 100),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>开始日期</span>
                <input
                  value={`${assetListQuery.from ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, from: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>结束日期</span>
                <input
                  value={`${assetListQuery.to ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, to: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>资产类型</span>
                <select
                  value={assetListQuery.asset_class ?? ""}
                  onChange={(e) =>
                    setAssetListQuery((s) => ({
                      ...s,
                      asset_class: e.target.value as QueryAssetValuationsRequest["asset_class"],
                    }))
                  }
                >
                  <option value="">all</option>
                  <option value="cash">cash</option>
                  <option value="real_estate">real_estate</option>
                  <option value="liability">liability</option>
                </select>
              </label>
              <label className="field">
                <span>账户 ID</span>
                <input
                  value={`${assetListQuery.account_id ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_xxx"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleAssetValuationsQuery()} disabled={assetListBusy}>
                {assetListBusy ? "执行中..." : "查询资产估值"}
              </button>
            </div>
            {assetListError ? (
              <div className="inline-error" role="alert">
                {assetListError}
              </div>
            ) : null}
            <AssetValuationsPreview data={assetListResult} />
            {showDebugJson ? (
              <JsonResultCard
                title="资产估值查询 JSON"
                data={assetListResult}
                emptyText="暂无结果。请先查询资产估值。"
              />
            ) : null}
          </div> : null}
        </div>
      </section> : null}

      {isTab("return-analysis") ? <section className="card panel">
        <div className="panel-header">
          <h2>投资区间收益率</h2>
          <p>
            第一条业务口径迁移：`investment-return`（当前已支持单账户与 `__portfolio__` 组合查询，直接读取 desktop
            SQLite）。
          </p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>账户 ID</span>
            <input
              value={invQuery.account_id}
              onChange={(e) => setInvQuery((s) => ({ ...s, account_id: e.target.value }))}
              placeholder="acct_xxx or __portfolio__"
            />
          </label>
          <label className="field">
            <span>预设区间</span>
            <select
              value={invQuery.preset}
              onChange={(e) => setInvQuery((s) => ({ ...s, preset: e.target.value }))}
            >
              <option value="ytd">ytd</option>
              <option value="1y">1y</option>
              <option value="3y">3y</option>
              <option value="since_inception">since_inception</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="field">
            <span>开始日期（自定义）</span>
            <input
              value={invQuery.from}
              onChange={(e) => setInvQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>结束日期（可选）</span>
            <input
              value={invQuery.to}
              onChange={(e) => setInvQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
        </div>

        <div className="db-actions">
          <button type="button" className="primary-btn" onClick={() => void handleInvestmentReturnQuery()} disabled={invBusy}>
            {invBusy ? "执行中..." : "查询投资区间收益率"}
          </button>
        </div>

        {invError ? (
          <div className="inline-error" role="alert">
            {invError}
          </div>
        ) : null}

        <InvestmentReturnPreview data={invResult} />
        {showRawJson ? (
          <JsonResultCard
            data={invResult}
            emptyText="暂无结果。请先执行数据库迁移后再查询。"
          />
        ) : null}
      </section> : null}

      {isTab("return-analysis") ? <section className="card panel">
        <div className="panel-header">
          <h2>投资曲线</h2>
          <p>第二条投资分析接口：`investment-curve`（单账户/组合，返回资产曲线与累计收益率曲线）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>账户 ID</span>
            <input
              value={invCurveQuery.account_id}
              onChange={(e) => setInvCurveQuery((s) => ({ ...s, account_id: e.target.value }))}
              placeholder="acct_xxx or __portfolio__"
            />
          </label>
          <label className="field">
            <span>预设区间</span>
            <select
              value={invCurveQuery.preset}
              onChange={(e) => setInvCurveQuery((s) => ({ ...s, preset: e.target.value }))}
            >
              <option value="ytd">ytd</option>
              <option value="1y">1y</option>
              <option value="3y">3y</option>
              <option value="since_inception">since_inception</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="field">
            <span>开始日期（自定义）</span>
            <input
              value={invCurveQuery.from}
              onChange={(e) => setInvCurveQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>结束日期（可选）</span>
            <input
              value={invCurveQuery.to}
              onChange={(e) => setInvCurveQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleInvestmentCurveQuery()}
            disabled={invCurveBusy}
          >
            {invCurveBusy ? "执行中..." : "查询投资曲线"}
          </button>
        </div>

        {invCurveError ? (
          <div className="inline-error" role="alert">
            {invCurveError}
          </div>
        ) : null}

        <InvestmentCurvePreview data={invCurveResult} />
        {showRawJson ? (
          <JsonResultCard
            data={invCurveResult}
            emptyText="暂无结果。请先执行数据库迁移后再查询。"
          />
        ) : null}
      </section> : null}

      {isTab("wealth-overview") ? <section className="card panel">
        <div className="panel-header">
          <h2>财富总览</h2>
          <p>财富总览口径验证：`wealth-overview`（含筛选、对账校验、滞后天数）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>统计日期（可选）</span>
            <input
              value={wealthOverviewQuery.as_of}
              onChange={(e) => setWealthOverviewQuery((s) => ({ ...s, as_of: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <BoolField
            label="包含投资"
            value={wealthOverviewQuery.include_investment}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_investment: value }))}
          />
          <BoolField
            label="包含现金"
            value={wealthOverviewQuery.include_cash}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_cash: value }))}
          />
          <BoolField
            label="包含不动产"
            value={wealthOverviewQuery.include_real_estate}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_real_estate: value }))}
          />
          <BoolField
            label="包含负债"
            value={wealthOverviewQuery.include_liability}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_liability: value }))}
          />
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleWealthOverviewQuery()}
            disabled={wealthOverviewBusy}
          >
            {wealthOverviewBusy ? "执行中..." : "查询财富总览"}
          </button>
        </div>

        {wealthOverviewError ? (
          <div className="inline-error" role="alert">
            {wealthOverviewError}
          </div>
        ) : null}

        <WealthOverviewPreview data={wealthOverviewResult} />
        {showRawJson ? (
          <JsonResultCard
            data={wealthOverviewResult}
            emptyText="暂无结果。请先执行迁移，并确认桌面数据库已有样本/真实数据。"
          />
        ) : null}
      </section> : null}

      {isTab("wealth-overview") ? <section className="card panel">
        <div className="panel-header">
          <h2>财富曲线</h2>
          <p>财富曲线口径验证：`wealth-curve`（区间预设 + 资产类型筛选）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>预设区间</span>
            <select
              value={wealthCurveQuery.preset}
              onChange={(e) => setWealthCurveQuery((s) => ({ ...s, preset: e.target.value }))}
            >
              <option value="ytd">ytd</option>
              <option value="1y">1y</option>
              <option value="3y">3y</option>
              <option value="since_inception">since_inception</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className="field">
            <span>开始日期（自定义）</span>
            <input
              value={wealthCurveQuery.from}
              onChange={(e) => setWealthCurveQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>结束日期（可选）</span>
            <input
              value={wealthCurveQuery.to}
              onChange={(e) => setWealthCurveQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <BoolField
            label="包含投资"
            value={wealthCurveQuery.include_investment}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_investment: value }))}
          />
          <BoolField
            label="包含现金"
            value={wealthCurveQuery.include_cash}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_cash: value }))}
          />
          <BoolField
            label="包含不动产"
            value={wealthCurveQuery.include_real_estate}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_real_estate: value }))}
          />
          <BoolField
            label="包含负债"
            value={wealthCurveQuery.include_liability}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_liability: value }))}
          />
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleWealthCurveQuery()}
            disabled={wealthCurveBusy}
          >
            {wealthCurveBusy ? "执行中..." : "查询财富曲线"}
          </button>
        </div>

        {wealthCurveError ? (
          <div className="inline-error" role="alert">
            {wealthCurveError}
          </div>
        ) : null}

        <WealthCurvePreview data={wealthCurveResult} />
        {showRawJson ? (
          <JsonResultCard
            data={wealthCurveResult}
            emptyText="暂无结果。请先执行迁移，并确认桌面数据库已有样本/真实数据。"
          />
        ) : null}
      </section> : null}

      {isTab("admin") ? <section className="card panel roadmap-panel">
        <div className="panel-header">
          <h2>后续迁移计划</h2>
          <p>基座稳定后，按低风险到高价值的顺序推进。</p>
        </div>
        <ol className="roadmap-list">
          <li>已完成：数据库路径初始化 + 迁移执行（复用 `db/migrations/*.sql`）。</li>
          <li>已完成：4 个核心分析接口 Rust 迁移（`investment-return/curve`, `wealth-overview/curve`）。</li>
          <li>已完成：Rust adapter CLI 接入差分 runner，全量 `25 case + 2 cross-check` 通过。</li>
          <li>当前阶段：Tauri 基座页接入 4 个接口 Probe，进入 desktop UI 验证。</li>
          <li>下一步：把验证通过的接口整理为正式工作台页面（替换临时 JSON probe）。</li>
        </ol>
      </section> : null}
        </div>
      </div>
    </main>
  );
}

export default App;
