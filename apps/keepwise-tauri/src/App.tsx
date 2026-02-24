import { startTransition, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import {
  deleteAnalysisExclusionRule,
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
  queryAnalysisExclusionRules,
  queryAssetValuations,
  queryBankTransferWhitelistRules,
  queryCategoryRules,
  queryInvestments,
  queryInvestmentReturns,
  queryInvestmentCurve,
  queryInvestmentReturn,
  queryMerchantRuleSuggestions,
  queryMetaAccounts,
  queryMerchantMapRules,
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
  { key: "budget-fire", icon: "◎", label: "预算与FIRE", subtitle: "规划与目标（待迁移）", status: "todo" },
  { key: "income-analysis", icon: "¥", label: "收入分析", subtitle: "收入结构与趋势（待迁移）", status: "todo" },
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

function Sparkline({
  values,
  color = "#7cc3ff",
}: {
  values: Array<number | null | undefined>;
  color?: string;
}) {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length === 0) {
    return <div className="sparkline-empty">No data</div>;
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const width = 100;
  const height = 40;
  const step = clean.length > 1 ? width / (clean.length - 1) : 0;
  const points = clean
    .map((v, i) => {
      const x = clean.length > 1 ? i * step : width / 2;
      const y = height - ((v - min) / span) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={height} x2={width} y2={height} className="sparkline-axis" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const assets = rows.map((r) => (typeof r.total_assets_cents === "number" ? r.total_assets_cents : null));
  const returns = rows.map((r) => (typeof r.cumulative_return_rate === "number" ? r.cumulative_return_rate : null));
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
      <div className="preview-chart-grid">
        <div className="sparkline-card">
          <div className="sparkline-title">Assets</div>
          <Sparkline values={assets} color="#7cc3ff" />
        </div>
        <div className="sparkline-card">
          <div className="sparkline-title">Cum Return</div>
          <Sparkline values={returns} color="#dcb06a" />
        </div>
      </div>
    </div>
  );
}

function WealthOverviewPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const wealthTotal = readNumber(data, "summary.wealth_total_cents");
  const netAssetTotal = readNumber(data, "summary.net_asset_total_cents");
  const liabilityTotal = readNumber(data, "summary.liability_total_cents");
  const staleCount = readNumber(data, "summary.stale_account_count");
  const reconciliationOk = readBool(data, "summary.reconciliation_ok");
  const asOf = readString(data, "as_of") ?? "-";
  const requestedAsOf = readString(data, "requested_as_of") ?? "-";
  const topRows = rows.slice(0, 8);

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
      {topRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Account</th>
                <th>Date</th>
                <th className="num">Value</th>
                <th className="num">Stale</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((row, idx) => {
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
  const wealthSeries = rows.map((r) => (typeof r.wealth_total_cents === "number" ? r.wealth_total_cents : null));
  const netAssetSeries = rows.map((r) => (typeof r.net_asset_total_cents === "number" ? r.net_asset_total_cents : null));
  const liabilitySeries = rows.map((r) => (typeof r.liability_total_cents === "number" ? r.liability_total_cents : null));

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
      <div className="preview-chart-grid">
        <div className="sparkline-card">
          <div className="sparkline-title">Wealth Total</div>
          <Sparkline values={wealthSeries} color="#7cc3ff" />
        </div>
        <div className="sparkline-card">
          <div className="sparkline-title">Net Assets</div>
          <Sparkline values={netAssetSeries} color="#7ad7a7" />
        </div>
        <div className="sparkline-card">
          <div className="sparkline-title">Liability</div>
          <Sparkline values={liabilitySeries} color="#ff937f" />
        </div>
      </div>
    </div>
  );
}

function AdminDbStatsPreview({ data }: { data: unknown }) {
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const dbPath = readString(data, "db_path") ?? "-";
  const confirmPhrase = readString(data, "confirm_phrase") ?? "-";
  const tableCount = readNumber(data, "summary.table_count");
  const totalRows = readNumber(data, "summary.total_rows");

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
      {rows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Table</th>
                <th className="num">Rows</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
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
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const errors = readArray(data, "errors").filter(isRecord);
  const topRows = rows.slice(0, 10);
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
        <PreviewStat label="Errors" value={errorCount ?? 0} tone={(errorCount ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="Avg Return" value={avgReturnPct} />
      </div>
      {topRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Return</th>
                <th className="num">Annualized</th>
                <th className="num">Profit</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map((row, idx) => {
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
          <strong>Top Errors</strong>
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
  if (!isRecord(data)) return null;
  const kind = readString(data, "kind") ?? "-";
  const selected = readArray(data, "accounts").length;
  const inv = readArray(data, "investment_accounts").length;
  const cash = readArray(data, "cash_accounts").length;
  const re = readArray(data, "real_estate_accounts").length;
  const liab = readArray(data, "liability_accounts").length;
  const rows = readArray(data, "accounts").filter(isRecord).slice(0, 10);
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
      {rows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type/Class</th>
                <th className="num">Records</th>
                <th>Latest</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
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
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord).slice(0, 10);
  const count = readNumber(data, "summary.count");
  const total = readNumber(data, "summary.total_amount_cents");
  const excluded = readNumber(data, "summary.excluded_count_in_rows");
  const sort = readString(data, "summary.sort") ?? "-";
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Transactions Query</h3>
        <div className="preview-subtle">sort <code>{sort}</code></div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Total (Yuan)" value={formatCentsShort(total)} />
        <PreviewStat label="Excluded In Rows" value={excluded ?? 0} tone={(excluded ?? 0) > 0 ? "warn" : "default"} />
      </div>
      {rows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Merchant</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const date =
                  (typeof row.posted_at === "string" && row.posted_at) ||
                  (typeof row.occurred_at === "string" ? row.occurred_at : "-");
                const merchant =
                  (typeof row.merchant === "string" && row.merchant) ||
                  (typeof row.merchant_normalized === "string" ? row.merchant_normalized : "-");
                const cat = typeof row.expense_category === "string" ? row.expense_category : "-";
                const amt = typeof row.amount_cents === "number" ? formatCentsShort(row.amount_cents) : "-";
                const manualExcluded = row.manual_excluded === true;
                return (
                  <tr key={`${date}-${idx}`}>
                    <td>{date}</td>
                    <td className="truncate-cell" title={merchant}>{merchant}</td>
                    <td>{cat}</td>
                    <td className="num">{amt}</td>
                    <td>{manualExcluded ? "manual_excluded" : "-"}</td>
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
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord).slice(0, 10);
  const count = readNumber(data, "summary.count");
  const latestAssets = readNumber(data, "summary.latest_total_assets_cents");
  const netFlow = readNumber(data, "summary.net_transfer_amount_cents");
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Investments Query</h3>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Latest Assets (Yuan)" value={formatCentsShort(latestAssets)} />
        <PreviewStat label="Net Transfer (Yuan)" value={formatCentsShort(netFlow)} />
      </div>
      {rows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th className="num">Assets</th>
                <th className="num">Transfer</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
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
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord).slice(0, 10);
  const count = readNumber(data, "summary.count");
  const total = readNumber(data, "summary.sum_value_cents");
  const assetClass = readString(data, "summary.asset_class") ?? "";
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Asset Valuations Query</h3>
        <div className="preview-subtle">
          class <code>{assetClass || "all"}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Sum Value (Yuan)" value={formatCentsShort(total)} />
      </div>
      {rows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Account</th>
                <th>Class</th>
                <th className="num">Value</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
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
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord).slice(0, 12);
  const count = readNumber(data, "summary.count");
  const kind = readString(data, "summary.kind") ?? "-";
  const keyword = readString(data, "summary.keyword") ?? "";
  const groups = ["investment", "cash", "real_estate", "bank", "credit_card", "wallet", "liability", "other"];
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Account Catalog</h3>
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
      {rows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Kind</th>
                <th>Type</th>
                <th className="num">TX</th>
                <th className="num">INV</th>
                <th className="num">ASSET</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
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
    { key: "investment-return", label: "investment-return", status: "idle" },
    { key: "investment-curve", label: "investment-curve", status: "idle" },
    { key: "wealth-overview", label: "wealth-overview", status: "idle" },
    { key: "wealth-curve", label: "wealth-curve", status: "idle" },
  ];
}

function withSmokeResult(rows: SmokeRow[], next: SmokeRow): SmokeRow[] {
  return rows.map((row) => (row.key === next.key ? next : row));
}

function makeInitialImportStepRows(): ImportStepRow[] {
  return [
    { key: "yzxy", label: "YZXY XLSX/CSV", status: "idle" },
    { key: "cmb-eml", label: "CMB EML", status: "idle" },
    { key: "cmb-pdf", label: "CMB Bank PDF", status: "idle" },
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
    return <p className="placeholder">Run preview to see parser summary and sample rows.</p>;
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
        File: <code>{file}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Parser" value={parserKind} />
        <PreviewStat label="Parsed Rows" value={parsedCount} tone={parsedCount > 0 ? "good" : "warn"} />
        <PreviewStat label="Preview Rows" value={previewRows} />
        <PreviewStat label="Mapping Fields" value={mappingCount} />
        <PreviewStat label="Errors" value={errorCount} tone={errorCount > 0 ? "warn" : "good"} />
      </div>
      {errors.length > 0 ? (
        <ul className="text-list">
          {errors.map((err, idx) => (
            <li key={`${idx}-${err}`}>{err}</li>
          ))}
        </ul>
      ) : (
        <div className="preview-note">Preview looks good. You can proceed with import.</div>
      )}
    </>
  );
}

function YzxyImportSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) return <p className="placeholder">No import yet. Import after preview confirmation.</p>;
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
        <PreviewStat label="Imported" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="Errors" value={errors} tone={errors > 0 ? "warn" : "good"} />
      </div>
      <div className="preview-note">
        Import Job ID: <code>{jobId}</code>
      </div>
    </>
  );
}

function CmbEmlPreviewSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <p className="placeholder">Run preview to see parse/classify summary before import.</p>;
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
        <PreviewStat label="EML Files" value={files} />
        <PreviewStat label="Records" value={records} tone={records > 0 ? "good" : "warn"} />
        <PreviewStat label="Consume" value={consume} />
        <PreviewStat label="Needs Review" value={review} tone={review > 0 ? "warn" : "good"} />
        <PreviewStat label="Excluded" value={excluded} />
        <PreviewStat label="Failed Files" value={failed} tone={failed > 0 ? "warn" : "good"} />
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
        <div className="preview-note">Preview summary is available. Confirm counts and review items, then import.</div>
      )}
    </>
  );
}

function CmbEmlImportSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) return <p className="placeholder">No import yet. Import after preview confirmation.</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "import_error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const records = readNumber(data, "summary.records_count") ?? 0;
  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="Imported" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="Import Errors" value={errors} tone={errors > 0 ? "warn" : "good"} />
        <PreviewStat label="Preview Records" value={records} />
      </div>
      <div className="preview-note">
        Import Job ID: <code>{jobId}</code>
      </div>
    </>
  );
}

function CmbBankPdfPreviewSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) {
    return <p className="placeholder">Run preview to inspect rule classification summary before import.</p>;
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
        Account <code>{accountLast4}</code> | Range <code>{rangeStart}</code> ~ <code>{rangeEnd}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Total Records" value={total} />
        <PreviewStat label="Import Rows" value={importRows} tone={importRows > 0 ? "good" : "warn"} />
        <PreviewStat label="Expense Rows" value={expenseRows} />
        <PreviewStat label="Income Rows" value={incomeRows} />
        <PreviewStat label="Expense Total (Yuan)" value={formatCentsShort(expenseTotal)} />
        <PreviewStat label="Income Total (Yuan)" value={formatCentsShort(incomeTotal)} />
      </div>
      {ruleEntries.length > 0 ? (
        <div className="preview-subtle">
          Top Rule Counts:{" "}
          {ruleEntries.map(([k, v]) => (
            <span key={k}>
              <code>{k}</code>={v}{" "}
            </span>
          ))}
        </div>
      ) : null}
      <div className="preview-note">Confirm rule counts and samples, then run import.</div>
    </>
  );
}

function CmbBankPdfImportSummaryReport({ data }: { data: unknown }) {
  if (!isRecord(data)) return <p className="placeholder">No import yet. Import after preview confirmation.</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "import_error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const importRows = readNumber(data, "preview.summary.import_rows_count") ?? 0;
  const expenseRows = readNumber(data, "preview.summary.expense_rows_count") ?? 0;
  const incomeRows = readNumber(data, "preview.summary.income_rows_count") ?? 0;
  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="Imported" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="Import Errors" value={errors} tone={errors > 0 ? "warn" : "good"} />
        <PreviewStat label="Preview Import Rows" value={importRows} />
        <PreviewStat label="Expense Rows" value={expenseRows} />
        <PreviewStat label="Income Rows" value={incomeRows} />
      </div>
      <div className="preview-note">
        Import Job ID: <code>{jobId}</code>
      </div>
    </>
  );
}

function ProductPlaceholderPanel({
  title,
  description,
  bullets,
  tone = "default",
}: {
  title: string;
  description: string;
  bullets: string[];
  tone?: "default" | "warn";
}) {
  return (
    <section className={`card panel placeholder-panel ${tone === "warn" ? "placeholder-panel-warn" : ""}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <ul className="text-list">
        {bullets.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
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
  if (!isRecord(data)) {
    return <p className="placeholder">Run query to see merchant suggestions for rule backfill.</p>;
  }
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count") ?? rows.length;
  const onlyUnmapped = readBool(data, "summary.only_unmapped");
  const keyword = readString(data, "summary.keyword") ?? "";

  return (
    <div className="subcard">
      <h3>Merchant Suggestions Preview</h3>
      <div className="preview-stat-grid">
        <PreviewStat label="Rows" value={count} tone={count > 0 ? "good" : "warn"} />
        <PreviewStat label="Only Unmapped" value={String(onlyUnmapped ?? false)} />
        <PreviewStat label="Keyword" value={keyword || "-"} />
      </div>
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                <th>操作</th>
                <th>Merchant</th>
                <th>Suggested</th>
                <th>Mapped</th>
                <th className="num">Txns</th>
                <th className="num">Review</th>
                <th className="num">Total (Yuan)</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row, idx) => {
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
        <p className="placeholder">No suggestion rows yet (possibly no consumer transactions or all merchants are mapped).</p>
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
        <h2>Rules Admin (Rust)</h2>
        <p>在 desktop 内维护导入规则文件（当前写入仓库 `data/rules/*.csv`），供 EML / CMB PDF 导入即时生效。</p>
      </div>

      <div className="db-actions">
        <button type="button" className="secondary-btn" onClick={() => void handleMerchantQuery()} disabled={anyBusy}>
          Refresh Merchant Map
        </button>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => void handleMerchantSuggestionsQuery()}
          disabled={anyBusy}
        >
          Refresh Merchant Suggestions
        </button>
        <button type="button" className="secondary-btn" onClick={() => void handleCategoryQuery()} disabled={anyBusy}>
          Refresh Category Rules
        </button>
        <button type="button" className="secondary-btn" onClick={() => void handleBankQuery()} disabled={anyBusy}>
          Refresh Transfer Whitelist
        </button>
        <button type="button" className="secondary-btn" onClick={() => void handleExclQuery()} disabled={anyBusy}>
          Refresh Analysis Exclusions
        </button>
      </div>

      <div className="db-grid">
        <div className="subcard">
          <h3>Merchant Map</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>keyword</span>
              <input
                value={merchantQuery.keyword ?? ""}
                onChange={(e) => setMerchantQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="merchant/category/note"
              />
            </label>
            <label className="field">
              <span>limit</span>
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
              <span>merchant_normalized</span>
              <input
                value={merchantUpsertForm.merchant_normalized ?? ""}
                onChange={(e) =>
                  setMerchantUpsertForm((prev) => ({ ...prev, merchant_normalized: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>expense_category</span>
              <input
                value={merchantUpsertForm.expense_category ?? ""}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>confidence</span>
              <input
                value={merchantUpsertForm.confidence ?? "0.95"}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, confidence: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>note</span>
              <input
                value={merchantUpsertForm.note ?? ""}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleMerchantQuery()} disabled={anyBusy}>
              {merchantQueryBusy ? "Querying..." : "Query"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleMerchantUpsert()} disabled={anyBusy}>
              {merchantUpsertBusy ? "Saving..." : "Upsert"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>delete merchant_normalized</span>
              <input
                value={merchantDeleteForm.merchant_normalized ?? ""}
                onChange={(e) =>
                  setMerchantDeleteForm((prev) => ({ ...prev, merchant_normalized: e.target.value }))
                }
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleMerchantDelete()} disabled={anyBusy}>
              {merchantDeleteBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
          {merchantQueryError || merchantUpsertError || merchantDeleteError ? (
            <div className="inline-error" role="alert">
              {[merchantQueryError, merchantUpsertError, merchantDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          {showRawJson ? (
            <>
              <JsonResultCard title="Merchant Map Query" data={merchantQueryResult} emptyText="No query yet." />
              <JsonResultCard title="Merchant Map Upsert" data={merchantUpsertResult} emptyText="No upsert yet." />
              <JsonResultCard title="Merchant Map Delete" data={merchantDeleteResult} emptyText="No delete yet." />
            </>
          ) : (
            <p className="inline-hint">建议先 Query 查看现有规则，再 Upsert/Delete。可打开 Raw JSON 查看结果详情。</p>
          )}
        </div>

        <div className="subcard">
          <h3>Merchant Suggestions</h3>
          <p className="inline-hint">
            基于 desktop 本地库交易聚合生成建议回填清单。建议先用 `only_unmapped=true` 看未映射商户，再把结果回填到 Merchant Map。
          </p>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>keyword</span>
              <input
                value={merchantSuggestionsQuery.keyword ?? ""}
                onChange={(e) =>
                  setMerchantSuggestionsQuery((prev) => ({ ...prev, keyword: e.target.value }))
                }
                placeholder="merchant keyword"
              />
            </label>
            <label className="field">
              <span>limit</span>
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
              label="only_unmapped"
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
              {merchantSuggestionsBusy ? "Querying..." : "Query merchant suggestions"}
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
              title="Merchant Suggestions JSON"
              data={merchantSuggestionsResult}
              emptyText="No query yet."
            />
          ) : null}
        </div>

        <div className="subcard">
          <h3>Category Rules</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>keyword</span>
              <input
                value={categoryQuery.keyword ?? ""}
                onChange={(e) => setCategoryQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="pattern/category/note"
              />
            </label>
            <label className="field">
              <span>limit</span>
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
              <span>priority</span>
              <input
                value={categoryUpsertForm.priority ?? "500"}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, priority: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>match_type</span>
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
              <span>pattern</span>
              <input
                value={categoryUpsertForm.pattern ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, pattern: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>expense_category</span>
              <input
                value={categoryUpsertForm.expense_category ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>confidence</span>
              <input
                value={categoryUpsertForm.confidence ?? "0.70"}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, confidence: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>note</span>
              <input
                value={categoryUpsertForm.note ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleCategoryQuery()} disabled={anyBusy}>
              {categoryQueryBusy ? "Querying..." : "Query"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleCategoryUpsert()} disabled={anyBusy}>
              {categoryUpsertBusy ? "Saving..." : "Upsert"}
            </button>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>delete match_type</span>
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
              <span>delete pattern</span>
              <input
                value={categoryDeleteForm.pattern ?? ""}
                onChange={(e) => setCategoryDeleteForm((prev) => ({ ...prev, pattern: e.target.value }))}
              />
            </label>
            <div className="field field-inline-button">
              <span>&nbsp;</span>
              <button type="button" className="danger-btn" onClick={() => void handleCategoryDelete()} disabled={anyBusy}>
                {categoryDeleteBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
          {categoryQueryError || categoryUpsertError || categoryDeleteError ? (
            <div className="inline-error" role="alert">
              {[categoryQueryError, categoryUpsertError, categoryDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          {showRawJson ? (
            <>
              <JsonResultCard title="Category Rules Query" data={categoryQueryResult} emptyText="No query yet." />
              <JsonResultCard title="Category Rules Upsert" data={categoryUpsertResult} emptyText="No upsert yet." />
              <JsonResultCard title="Category Rules Delete" data={categoryDeleteResult} emptyText="No delete yet." />
            </>
          ) : (
            <p className="inline-hint">EML/PDF 分类会读取这里的规则，修改后重新 Preview 即可验证效果。</p>
          )}
        </div>

        <div className="subcard">
          <h3>Bank Transfer Whitelist</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>keyword</span>
              <input
                value={bankQuery.keyword ?? ""}
                onChange={(e) => setBankQuery((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>limit</span>
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
              label="active_only"
              value={(bankQuery.active_only ?? "false") as BoolString}
              onChange={(value) => setBankQuery((prev) => ({ ...prev, active_only: value }))}
            />
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>name</span>
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
              <span>note</span>
              <input
                value={bankUpsertForm.note ?? ""}
                onChange={(e) => setBankUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleBankQuery()} disabled={anyBusy}>
              {bankQueryBusy ? "Querying..." : "Query"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleBankUpsert()} disabled={anyBusy}>
              {bankUpsertBusy ? "Saving..." : "Upsert"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>delete name</span>
              <input
                value={bankDeleteForm.name ?? ""}
                onChange={(e) => setBankDeleteForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleBankDelete()} disabled={anyBusy}>
              {bankDeleteBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
          {bankQueryError || bankUpsertError || bankDeleteError ? (
            <div className="inline-error" role="alert">
              {[bankQueryError, bankUpsertError, bankDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          {showRawJson ? (
            <>
              <JsonResultCard title="Whitelist Query" data={bankQueryResult} emptyText="No query yet." />
              <JsonResultCard title="Whitelist Upsert" data={bankUpsertResult} emptyText="No upsert yet." />
              <JsonResultCard title="Whitelist Delete" data={bankDeleteResult} emptyText="No delete yet." />
            </>
          ) : (
            <p className="inline-hint">该白名单用于 CMB Bank PDF 导入中识别银行卡个人转账消费。</p>
          )}
        </div>

        <div className="subcard">
          <h3>Analysis Exclusions</h3>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>keyword</span>
              <input
                value={exclQuery.keyword ?? ""}
                onChange={(e) => setExclQuery((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>limit</span>
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
              label="enabled_only"
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
              <span>rule_name</span>
              <input
                value={exclUpsertForm.rule_name ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, rule_name: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>merchant_contains</span>
              <input
                value={exclUpsertForm.merchant_contains ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, merchant_contains: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>description_contains</span>
              <input
                value={exclUpsertForm.description_contains ?? ""}
                onChange={(e) =>
                  setExclUpsertForm((prev) => ({ ...prev, description_contains: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>expense_category</span>
              <input
                value={exclUpsertForm.expense_category ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>min_amount</span>
              <input
                value={exclUpsertForm.min_amount ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, min_amount: e.target.value }))}
                placeholder="100000"
              />
            </label>
            <label className="field">
              <span>max_amount</span>
              <input
                value={exclUpsertForm.max_amount ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, max_amount: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>start_date</span>
              <input
                value={exclUpsertForm.start_date ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, start_date: e.target.value }))}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>end_date</span>
              <input
                value={exclUpsertForm.end_date ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, end_date: e.target.value }))}
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>reason</span>
              <input
                value={exclUpsertForm.reason ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, reason: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="secondary-btn" onClick={() => void handleExclQuery()} disabled={anyBusy}>
              {exclQueryBusy ? "Querying..." : "Query"}
            </button>
            <button type="button" className="primary-btn" onClick={() => void handleExclUpsert()} disabled={anyBusy}>
              {exclUpsertBusy ? "Saving..." : "Upsert"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>delete rule_name</span>
              <input
                value={exclDeleteForm.rule_name ?? ""}
                onChange={(e) => setExclDeleteForm((prev) => ({ ...prev, rule_name: e.target.value }))}
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleExclDelete()} disabled={anyBusy}>
              {exclDeleteBusy ? "Deleting..." : "Delete"}
            </button>
          </div>
          {exclQueryError || exclUpsertError || exclDeleteError ? (
            <div className="inline-error" role="alert">
              {[exclQueryError, exclUpsertError, exclDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          {showRawJson ? (
            <>
              <JsonResultCard title="Exclusions Query" data={exclQueryResult} emptyText="No query yet." />
              <JsonResultCard title="Exclusions Upsert" data={exclUpsertResult} emptyText="No upsert yet." />
              <JsonResultCard title="Exclusions Delete" data={exclDeleteResult} emptyText="No delete yet." />
            </>
          ) : (
            <p className="inline-hint">EML 导入会在分类后应用这些排除规则，修改后重新 Preview CMB EML 即可观察变化。</p>
          )}
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
  const [metaAccountsBusy, setMetaAccountsBusy] = useState(false);
  const [metaAccountsError, setMetaAccountsError] = useState("");
  const [metaAccountsResult, setMetaAccountsResult] = useState<MetaAccountsPayload | null>(null);
  const [metaAccountsQuery, setMetaAccountsQuery] = useState<MetaAccountsQueryRequest>({ kind: "all" });
  const [txListBusy, setTxListBusy] = useState(false);
  const [txListError, setTxListError] = useState("");
  const [txListResult, setTxListResult] = useState<QueryTransactionsPayload | null>(null);
  const [txListQuery, setTxListQuery] = useState<QueryTransactionsRequest>({
    limit: 20,
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
    limit: 20,
    from: "",
    to: "",
    source_type: "",
    account_id: "",
  });
  const [assetListBusy, setAssetListBusy] = useState(false);
  const [assetListError, setAssetListError] = useState("");
  const [assetListResult, setAssetListResult] = useState<QueryAssetValuationsPayload | null>(null);
  const [assetListQuery, setAssetListQuery] = useState<QueryAssetValuationsRequest>({
    limit: 20,
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
      void handleTransactionsQuery();
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
      void handleTransactionsQuery();
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
        detail = "请选择文件/目录，然后先执行 Preview";
      } else if (args.previewBusy || args.importBusy) {
        detail = "正在执行...";
      } else if (args.previewError) {
        detail = `Preview Error: ${args.previewError}`;
      } else if (args.importError) {
        detail = `Import Error: ${args.importError}`;
      } else if (args.importResult) {
        detail = importSummary || "已导入，可查看查询/健康面板确认结果";
      } else if (args.previewResult) {
        detail = `${previewSummary || "Preview 已完成"} | 可执行 Import`;
      } else {
        detail = "路径已设置，先执行 Preview 确认";
      }

      return { key: args.key, label: args.label, status, detail };
    };

    const nextRows = [
      deriveRouteRow({
        key: "yzxy",
        label: "YZXY XLSX/CSV",
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
        label: "CMB EML",
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
        label: "CMB Bank PDF",
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
        ? "在下方三种导入面板中手动执行 Preview / Import；此处展示当前准备状态与最近结果摘要。"
        : `pass=${passCount} | fail=${failCount} | running=${runningCount} | idle=${idleCount} | skip=${skipCount}`;

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
        { key: "investment-return", label: "investment-return" },
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
        { key: "investment-curve", label: "investment-curve" },
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
        { key: "wealth-overview", label: "wealth-overview" },
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
        { key: "wealth-curve", label: "wealth-curve" },
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
          `${mode === "path" ? "Imported from selected path" : "Imported repo runtime DB"} | copied=${importResult.copied_bytes} bytes | smoke ${allPassed ? "PASS" : "FAIL"}`,
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

  return (
    <main className="app-shell">
      <div className={`workspace-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <aside className={`card workspace-sidebar ${sidebarCollapsed ? "collapsed" : ""}`} aria-label="功能导航">
          <div className="workspace-sidebar-head">
            <div className="workspace-brand">
              <div className="workspace-brand-icon" aria-hidden="true">
                KW
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
              <p className="eyebrow">Workspace</p>
              <h2>{activeTabMeta.label}</h2>
              <p className="workspace-tab-copy">{activeTabMeta.subtitle}</p>
            </div>
            <div className="workspace-tab-actions">
              {isTab("admin") ? (
                <button type="button" className="secondary-btn" onClick={() => setShowRawJson((v) => !v)}>
                  {showRawJson ? "Hide Raw JSON" : "Show Raw JSON"}
                </button>
              ) : null}
              <div className={`status-pill status-${status}`}>DESKTOP {status.toUpperCase()}</div>
            </div>
          </section>

          {isTab("manual-entry") ? (
            <ProductPlaceholderPanel
              title="手动录入（已并入当前工作台）"
              description="当前手动录入、账户目录维护与部分查询仍在同一个工作台面板中，先保证使用闭环，后续会拆成独立产品页。"
              bullets={[
                "可在下方 Workbench 面板使用 Record Mutations（投资记录/资产估值增删改）",
                "可在下方 Workbench 面板使用 Account Catalog Admin（账户目录维护）",
                "后续会拆分为更精简的“录入页 + 查询页”结构",
              ]}
            />
          ) : null}

          {isTab("consumption-analysis") ? (
            <ProductPlaceholderPanel
              title="消费分析（迁移进行中）"
              description="消费分析相关的已迁移能力当前分布在导入中心与工作台查询面板中，这里先提供聚合入口。"
              bullets={[
                "CMB EML / CMB Bank PDF 导入与预览：在“导入中心”TAB",
                "交易查询与分析剔除：在下方 Workbench 面板（临时合并）",
                "规则维护（商户映射/分类规则/排除规则）：在“导入中心”TAB 的 Rules Admin",
              ]}
              tone="warn"
            />
          ) : null}

          {isTab("base-query") ? (
            <ProductPlaceholderPanel
              title="基础查询（临时合并工作台）"
              description="基础查询功能已迁移，但目前与手动录入/纠错操作共用一个工作台面板，后续再拆分成更干净的查询页。"
              bullets={[
                "Transactions Query",
                "Investments Query",
                "Asset Valuations Query",
                "Meta Accounts / Account Catalog",
              ]}
            />
          ) : null}

          {isTab("budget-fire") ? (
            <ProductPlaceholderPanel
              title="预算与 FIRE"
              description="该模块尚未进入 desktop Rust 迁移主线，当前聚焦导入、记录维护、收益与财富口径。"
              bullets={[
                "保留 TAB 作为产品信息架构占位",
                "后续会在核心账本能力稳定后再迁移预算与目标规划能力",
              ]}
            />
          ) : null}

          {isTab("income-analysis") ? (
            <ProductPlaceholderPanel
              title="收入分析"
              description="收入分析工作台尚未独立迁移。当前可先用 CMB Bank PDF 导入 + Transactions Query 验证收入数据入库与筛选。"
              bullets={[
                "先在导入中心完成 CMB Bank PDF 预览/导入",
                "再到基础查询查看 `statement_category` / 分类结果",
                "后续补专门的收入趋势与结构面板",
              ]}
            />
          ) : null}

      {isTab("admin") && status === "error" && (
        <section className="card alert-card" role="alert">
          <h2>Command Probe Failed</h2>
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
            <h2>Rust Command Probe</h2>
            <p>第一批基础命令：`health_ping` / `app_metadata` / `app_paths`</p>
          </div>

          <div className="stack">
            <div className="subcard">
              <h3>Health</h3>
              {isReady && probe ? (
                <dl className="kv-grid">
                  <dt>Status</dt>
                  <dd>{probe.health.status}</dd>
                  <dt>Mode</dt>
                  <dd>{probe.health.mode}</dd>
                  <dt>Unix Timestamp</dt>
                  <dd>{probe.health.unix_ts}</dd>
                </dl>
              ) : (
                <p className="placeholder">Waiting for command response...</p>
              )}
            </div>

            <div className="subcard">
              <h3>App Metadata</h3>
              {isReady && probe ? (
                <dl className="kv-grid">
                  <dt>App Name</dt>
                  <dd>{probe.metadata.app_name}</dd>
                  <dt>Version</dt>
                  <dd>{probe.metadata.app_version}</dd>
                  <dt>Identifier</dt>
                  <dd>{probe.metadata.app_identifier ?? "-"}</dd>
                  <dt>Build Mode</dt>
                  <dd>{probe.metadata.debug ? "debug" : "release"}</dd>
                  <dt>Tauri Major</dt>
                  <dd>{probe.metadata.tauri_major}</dd>
                </dl>
              ) : (
                <p className="placeholder">Waiting for command response...</p>
              )}
            </div>
          </div>
        </section>

        <section className="card panel">
          <div className="panel-header">
            <h2>App Paths</h2>
            <p>后续 SQLite、规则文件、日志、导入缓存都会基于这些目录能力落地。</p>
          </div>

          {isReady && probe ? (
            <div className="path-list">
              <PathRow label="App Data" probe={probe.paths.app_data_dir} />
              <PathRow label="App Config" probe={probe.paths.app_config_dir} />
              <PathRow label="App Cache" probe={probe.paths.app_cache_dir} />
              <PathRow label="App Log" probe={probe.paths.app_log_dir} />
              <PathRow label="App Local Data" probe={probe.paths.app_local_data_dir} />
            </div>
          ) : (
            <p className="placeholder">Waiting for path resolver results...</p>
          )}
        </section>
      </section> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>Desktop Ledger DB (SQLite)</h2>
          <p>第一条真实基础能力：在 Tauri desktop 内初始化数据库并执行嵌入迁移脚本。</p>
        </div>

        <div className="db-actions">
          <button type="button" className="primary-btn" onClick={() => void refreshDbStatus()} disabled={dbBusy}>
            Refresh DB Status
          </button>
          <button type="button" className="primary-btn" onClick={() => void handleRunMigrations()} disabled={dbBusy}>
            {dbBusy ? "Running..." : "Init / Migrate DB"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleImportRepoRuntimeDb()}
            disabled={dbBusy}
            title="复制仓库默认运行库 data/work/processed/ledger/keepwise.db 到 Tauri app 本地库"
          >
            {dbBusy ? "Running..." : "Import Repo Runtime DB"}
          </button>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>Import Existing DB From Path</span>
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
            Browse...
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleImportDbFromPath()}
            disabled={dbBusy || !dbImportPath.trim()}
            title="导入任意已有 keepwise.db 到 Tauri app 本地库（将覆盖当前 app 库）"
          >
            {dbBusy ? "Running..." : "Import DB From Path"}
          </button>
        </div>
        <p className="inline-hint">
          适用于导入任意已有 `keepwise.db`（例如历史备份、副本、其他环境生成的库）。开发期也可继续使用上面的
          `Import Repo Runtime DB` 快捷按钮。
        </p>

        {dbStatusError ? (
          <div className="inline-error" role="alert">
            {dbStatusError}
          </div>
        ) : null}

        {dbStatus ? (
          <div className="db-grid">
            <div className="subcard">
              <h3>Status</h3>
              <dl className="kv-grid">
                <dt>DB Exists</dt>
                <dd>{String(dbStatus.exists)}</dd>
                <dt>Schema Table</dt>
                <dd>{String(dbStatus.schema_migrations_table_exists)}</dd>
                <dt>Ready</dt>
                <dd>{String(dbStatus.ready)}</dd>
                <dt>Applied</dt>
                <dd>
                  {dbStatus.applied_versions.length} / {dbStatus.migration_files.length}
                </dd>
                <dt>Pending</dt>
                <dd>{dbStatus.pending_versions.length}</dd>
              </dl>
            </div>

            <div className="subcard">
              <h3>DB Path</h3>
              <code className="path-value">{dbStatus.db_path}</code>
            </div>
          </div>
        ) : (
          <p className="placeholder">Waiting for DB status...</p>
        )}

        {dbStatus ? (
          <div className="db-grid db-grid-lists">
            <div className="subcard">
              <h3>Applied Versions</h3>
              {dbStatus.applied_versions.length > 0 ? (
                <ul className="mono-list">
                  {dbStatus.applied_versions.map((v) => (
                    <li key={v}>
                      <code>{v}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">No migrations applied yet.</p>
              )}
            </div>
            <div className="subcard">
              <h3>Pending Versions</h3>
              {dbStatus.pending_versions.length > 0 ? (
                <ul className="mono-list">
                  {dbStatus.pending_versions.map((v) => (
                    <li key={v}>
                      <code>{v}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="placeholder">No pending migrations.</p>
              )}
            </div>
          </div>
        ) : null}

        {dbLastResult ? (
          <div className="subcard db-result-card">
            <h3>Last Migrate Result</h3>
            <dl className="kv-grid">
              <dt>Created</dt>
              <dd>{String(dbLastResult.created)}</dd>
              <dt>Applied Now</dt>
              <dd>{dbLastResult.applied_now.length}</dd>
              <dt>Skipped</dt>
              <dd>{dbLastResult.skipped.length}</dd>
              <dt>Applied Total</dt>
              <dd>{dbLastResult.applied_total}</dd>
              <dt>Pending Total</dt>
              <dd>{dbLastResult.pending_total}</dd>
            </dl>
          </div>
        ) : null}

        {dbImportLastResult ? (
          <div className="subcard db-result-card">
            <h3>Last Import Repo Runtime Result</h3>
            <dl className="kv-grid">
              <dt>Source DB</dt>
              <dd>
                <code className="path-value">{dbImportLastResult.source_db_path}</code>
              </dd>
              <dt>Target DB</dt>
              <dd>
                <code className="path-value">{dbImportLastResult.target_db_path}</code>
              </dd>
              <dt>Replaced Existing</dt>
              <dd>{String(dbImportLastResult.replaced_existing)}</dd>
              <dt>Copied Bytes</dt>
              <dd>{dbImportLastResult.copied_bytes}</dd>
              <dt>Migrate Applied Now</dt>
              <dd>{dbImportLastResult.migrate_result.applied_now.length}</dd>
              <dt>Migrate Pending Total</dt>
              <dd>{dbImportLastResult.migrate_result.pending_total}</dd>
            </dl>
          </div>
        ) : null}
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>Import Center (Desktop)</h2>
          <p>统一展示三条 Rust 导入链路的手动导入准备状态、Preview 摘要与最近 Import 结果（不在此处批量执行）。</p>
        </div>

        <div className="db-actions">
          <div className="smoke-last-run">
            Status Updated: {importCenterLastRunAt ? new Date(importCenterLastRunAt).toLocaleTimeString() : "-"}
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
            IMPORT CENTER {importCenterStatus.toUpperCase()}
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
                  {row.detail ?? "No run yet"}
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
          <h2>YZXY Import (Rust)</h2>
          <p>Rust 原生解析并导入有知有行导出文件（`.csv` / `.xlsx`），用于构建 desktop 端完整导入验证闭环。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>YZXY Export File</span>
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
            Browse...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>source_type</span>
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
            {yzxyPreviewBusy ? "Previewing..." : "Preview YZXY File"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleYzxyImport()}
            disabled={yzxyImportBusy || yzxyPreviewBusy || !yzxyFilePath.trim()}
            title="导入到 Tauri app 本地账本；导入成功后会自动刷新投资相关查询与分析面板"
          >
            {yzxyImportBusy ? "Importing..." : "Import YZXY Into Desktop DB"}
          </button>
        </div>

        <p className="inline-hint">
          建议流程：先 `Preview` 确认映射与样例，再 `Import`。导入成功后会自动刷新 `Investments / Meta Accounts /
          Account Catalog / Analytics` 面板，便于立即验证结果。
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
            <h3>Preview Result</h3>
            <YzxyPreviewSummaryReport data={yzxyPreviewResult} />
            {showRawJson ? (
              <JsonResultCard title="YZXY Preview JSON" data={yzxyPreviewResult} emptyText="No preview yet. Pick a YZXY file and run preview." />
            ) : null}
          </div>
          <div className="subcard">
            <h3>Import Result</h3>
            <YzxyImportSummaryReport data={yzxyImportResult} />
            {showRawJson ? (
              <JsonResultCard title="YZXY Import JSON" data={yzxyImportResult} emptyText="No import yet. Run import after preview." />
            ) : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>CMB EML Import (Rust)</h2>
          <p>Rust 原生解析招行信用卡 EML（支持单文件或目录递归扫描），完成 preview + import 并写入 `transactions`。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>EML File / Directory</span>
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
            Browse File...
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handlePickEmlFolder()}
            disabled={emlPreviewBusy || emlImportBusy}
          >
            Browse Folder...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>review_threshold</span>
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
            <span>source_type</span>
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
            {emlPreviewBusy ? "Previewing..." : "Preview CMB EML"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleCmbEmlImport()}
            disabled={emlImportBusy || emlPreviewBusy || !emlSourcePath.trim()}
            title="导入到 desktop 本地库，导入成功后自动刷新 Transactions/Admin Health 等面板"
          >
            {emlImportBusy ? "Importing..." : "Import CMB EML Into Desktop DB"}
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
            <h3>EML Preview Result</h3>
            <CmbEmlPreviewSummaryReport data={emlPreviewResult} />
            {showRawJson ? <JsonResultCard title="CMB EML Preview JSON" data={emlPreviewResult} emptyText="No preview yet." /> : null}
          </div>
          <div className="subcard">
            <h3>EML Import Result</h3>
            <CmbEmlImportSummaryReport data={emlImportResult} />
            {showRawJson ? <JsonResultCard title="CMB EML Import JSON" data={emlImportResult} emptyText="No import yet." /> : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <section className="card panel">
        <div className="panel-header">
          <h2>CMB Bank PDF Import (Rust)</h2>
          <p>Rust 原生解析招商银行流水 PDF，执行规则分类并导入 `transactions`（desktop-only 验证链路）。</p>
        </div>

        <div className="db-import-path-row">
          <label className="field db-import-path-field">
            <span>Bank Statement PDF</span>
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
            Browse PDF...
          </button>
        </div>

        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>review_threshold</span>
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
            <span>source_type</span>
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
            {cmbPdfPreviewBusy ? "Previewing..." : "Preview CMB Bank PDF"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleCmbBankPdfImport()}
            disabled={cmbPdfImportBusy || cmbPdfPreviewBusy || !cmbPdfPath.trim()}
            title="导入到 desktop 本地库，完成后自动刷新 Transactions/Health 面板"
          >
            {cmbPdfImportBusy ? "Importing..." : "Import CMB Bank PDF Into Desktop DB"}
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
            <h3>CMB PDF Preview Result</h3>
            <CmbBankPdfPreviewSummaryReport data={cmbPdfPreviewResult} />
            {showRawJson ? <JsonResultCard title="CMB Bank PDF Preview JSON" data={cmbPdfPreviewResult} emptyText="No preview yet." /> : null}
          </div>
          <div className="subcard">
            <h3>CMB PDF Import Result</h3>
            <CmbBankPdfImportSummaryReport data={cmbPdfImportResult} />
            {showRawJson ? <JsonResultCard title="CMB Bank PDF Import JSON" data={cmbPdfImportResult} emptyText="No import yet." /> : null}
          </div>
        </div>
      </section> : null}

      {isTab("import-center") ? <RulesAdminPanel showRawJson={showRawJson} /> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>Admin DB Health (Rust)</h2>
          <p>桌面侧运行库健康快照：对齐 Web 管理页的 `admin/db-stats` 核心口径（表计数 + 总行数）。</p>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRefreshAdminDbStats()}
            disabled={adminDbStatsBusy || dbBusy}
          >
            {adminDbStatsBusy ? "Refreshing..." : "Refresh Admin DB Stats"}
          </button>
          <div className="smoke-last-run">
            Last Run: {adminDbStatsLastRunAt ? new Date(adminDbStatsLastRunAt).toLocaleTimeString() : "-"}
          </div>
        </div>

        {adminDbStatsError ? (
          <div className="inline-error" role="alert">
            {adminDbStatsError}
          </div>
        ) : null}

        <AdminDbStatsPreview data={adminDbStatsResult} />
        <div className="subcard danger-zone">
          <h3>Admin Reset (Rust)</h3>
          <p className="inline-hint">
            Desktop 侧管理员重置能力（破坏性操作）。需输入确认口令 <code>{readString(adminDbStatsResult, "confirm_phrase") ?? "RESET KEEPWISE"}</code>。
          </p>

          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>confirm_text</span>
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
              {adminResetTxBusy ? "Resetting..." : "Reset Transaction Scope"}
            </button>
            <button
              type="button"
              className="danger-btn"
              onClick={() => void handleAdminResetAll()}
              disabled={dbBusy || adminResetAllBusy || adminResetTxBusy}
              title="清理管理员数据表（高风险）"
            >
              {adminResetAllBusy ? "Resetting..." : "Reset Admin DB Data (All)"}
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
              title="Admin Reset Transaction Scope Result"
              data={adminResetTxResult}
              emptyText="No transaction reset result."
            />
          ) : null}
          {adminResetAllResult ? (
            <JsonResultCard
              title="Admin Reset All Result"
              data={adminResetAllResult}
              emptyText="No admin reset-all result."
            />
          ) : null}
        </div>
        {showRawJson ? (
          <JsonResultCard
            title="Admin DB Stats JSON"
            data={adminDbStatsResult}
            emptyText="No admin DB stats yet. Import/init desktop DB and click Refresh Admin DB Stats."
          />
        ) : null}
      </section> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>Core Analytics Smoke (Desktop)</h2>
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
            {pipelineBusy ? "Running Pipeline..." : "Run Validation Pipeline"}
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRunCoreAnalyticsSmoke()}
            disabled={smokeBusy || pipelineBusy}
          >
            {smokeBusy ? "Running Smoke..." : "Run Core Analytics Smoke"}
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setShowRawJson((v) => !v)}
            disabled={pipelineBusy}
          >
            {showRawJson ? "Hide Raw JSON" : "Show Raw JSON"}
          </button>
          <div className="smoke-last-run">
            Last Run: {smokeLastRunAt ? new Date(smokeLastRunAt).toLocaleTimeString() : "-"}
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
            PIPELINE {pipelineStatus.toUpperCase()}
          </span>
          <span className="pipeline-last-run">
            Last Pipeline Run: {pipelineLastRunAt ? new Date(pipelineLastRunAt).toLocaleTimeString() : "-"}
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
                {row.detail ?? "No run yet"}
              </div>
            </div>
          ))}
        </div>
      </section> : null}

      {isTab("admin") ? <section className="card panel">
        <div className="panel-header">
          <h2>Runtime Health Check (Rust)</h2>
          <p>非破坏性健康巡检：组合 `db-stats`、基础表探针、财富总览与组合收益曲线检查。</p>
        </div>

        <div className="db-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => void handleRunRuntimeHealthCheck()}
            disabled={runtimeHealthBusy || dbBusy}
          >
            {runtimeHealthBusy ? "Running Health Check..." : "Run Runtime Health Check"}
          </button>
          <div className="smoke-last-run">
            Last Run: {runtimeHealthLastRunAt ? new Date(runtimeHealthLastRunAt).toLocaleTimeString() : "-"}
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
            title="Runtime Health Check JSON"
            data={runtimeHealthResult}
            emptyText="No runtime health result yet. Import/init desktop DB and click Run Runtime Health Check."
          />
        ) : null}
      </section> : null}

      {isTab("return-analysis") ? <section className="card panel">
        <div className="panel-header">
          <h2>Investment Returns Compare Probe (Rust)</h2>
          <p>批量账户收益率对比：`investment-returns`（用于账户横向比较与异常账户识别）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>preset</span>
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
            <span>from (custom)</span>
            <input
              value={`${invBatchQuery.from ?? ""}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>to (optional)</span>
            <input
              value={`${invBatchQuery.to ?? ""}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>keyword (optional)</span>
            <input
              value={`${invBatchQuery.keyword ?? ""}`}
              onChange={(e) => setInvBatchQuery((s) => ({ ...s, keyword: e.target.value }))}
              placeholder="account id / name"
            />
          </label>
          <label className="field">
            <span>limit</span>
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
            {invBatchBusy ? "Running..." : "Run investment-returns"}
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
            title="Investment Returns JSON"
            data={invBatchResult}
            emptyText="No result yet. Run investment-returns after importing desktop DB."
          />
        ) : null}
      </section> : null}

      {isTab("manual-entry", "consumption-analysis", "base-query") ? <section className="card panel">
        <div className="panel-header">
          <h2>Workbench Read Queries (Rust)</h2>
          <p>批量迁移的只读查询：`meta/accounts`、`query_transactions`、`query_investments`、`query_asset_valuations`。</p>
        </div>

        <div className="stack">
          <div className="subcard">
            <h3>Account Catalog Admin</h3>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>query kind</span>
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
                <span>query keyword</span>
                <input
                  value={`${acctCatalogQuery.keyword ?? ""}`}
                  onChange={(e) => setAcctCatalogQuery((s) => ({ ...s, keyword: e.target.value }))}
                  placeholder="account id / name / kind / type"
                />
              </label>
              <label className="field">
                <span>query limit</span>
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
                {acctCatalogBusy ? "Running..." : "Run account_catalog query"}
              </button>
            </div>

            {acctCatalogError ? (
              <div className="inline-error" role="alert">
                {acctCatalogError}
              </div>
            ) : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>upsert account_id (optional for edit)</span>
                <input
                  value={`${acctCatalogUpsertForm.account_id ?? ""}`}
                  onChange={(e) => setAcctCatalogUpsertForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="留空则按 account_kind + name 生成"
                />
              </label>
              <label className="field">
                <span>upsert account_name</span>
                <input
                  value={`${acctCatalogUpsertForm.account_name ?? ""}`}
                  onChange={(e) => setAcctCatalogUpsertForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="账户名称"
                />
              </label>
              <label className="field">
                <span>upsert account_kind</span>
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
                {acctCatalogUpsertBusy ? "Running..." : "Upsert account_catalog entry"}
              </button>
            </div>

            {acctCatalogUpsertError ? (
              <div className="inline-error" role="alert">
                {acctCatalogUpsertError}
              </div>
            ) : null}

            {acctCatalogUpsertResult ? (
              <JsonResultCard
                title="Account Catalog Upsert Result"
                data={acctCatalogUpsertResult}
                emptyText="No upsert result."
              />
            ) : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>delete account_id</span>
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
                {acctCatalogDeleteBusy ? "Running..." : "Delete account_catalog entry"}
              </button>
            </div>

            {acctCatalogDeleteError ? (
              <div className="inline-error" role="alert">
                {acctCatalogDeleteError}
              </div>
            ) : null}

            {acctCatalogDeleteResult ? (
              <JsonResultCard
                title="Account Catalog Delete Result"
                data={acctCatalogDeleteResult}
                emptyText="No delete result."
              />
            ) : null}

            <AccountCatalogPreview data={acctCatalogResult} />
            {showRawJson ? (
              <JsonResultCard
                title="Account Catalog JSON"
                data={acctCatalogResult}
                emptyText="No result yet. Run account_catalog query."
              />
            ) : null}
          </div>

          <div className="subcard">
            <h3>Record Mutations (Rust)</h3>
            <p className="inline-hint">
              用于 desktop 内验证投资记录与资产估值的新增/修改/删除。成功后会自动刷新 `query_investments` / `query_asset_valuations` / `meta/accounts` / `account_catalog`。
            </p>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>INV upsert snapshot_date</span>
                <input
                  value={`${manualInvForm.snapshot_date ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>INV upsert account_id (optional)</span>
                <input
                  value={`${manualInvForm.account_id ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_inv_xxx"
                />
              </label>
              <label className="field">
                <span>INV upsert account_name</span>
                <input
                  value={`${manualInvForm.account_name ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="手工投资账户"
                />
              </label>
              <label className="field">
                <span>INV upsert total_assets</span>
                <input
                  value={`${manualInvForm.total_assets ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, total_assets: e.target.value }))}
                  placeholder="10000.00"
                />
              </label>
              <label className="field">
                <span>INV upsert transfer_amount</span>
                <input
                  value={`${manualInvForm.transfer_amount ?? ""}`}
                  onChange={(e) => setManualInvForm((s) => ({ ...s, transfer_amount: e.target.value }))}
                  placeholder="0.00"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="secondary-btn" onClick={() => void handleUpsertManualInvestment()} disabled={manualInvBusy}>
                {manualInvBusy ? "Running..." : "Upsert manual investment"}
              </button>
            </div>
            {manualInvError ? <div className="inline-error" role="alert">{manualInvError}</div> : null}
            {manualInvResult ? <JsonResultCard title="Manual Investment Upsert Result" data={manualInvResult} emptyText="No result." /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>INV update id</span>
                <input
                  value={`${updateInvForm.id ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, id: e.target.value }))}
                  placeholder="investment record id"
                />
              </label>
              <label className="field">
                <span>INV update snapshot_date</span>
                <input
                  value={`${updateInvForm.snapshot_date ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>INV update account_id (optional)</span>
                <input
                  value={`${updateInvForm.account_id ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_inv_xxx"
                />
              </label>
              <label className="field">
                <span>INV update account_name</span>
                <input
                  value={`${updateInvForm.account_name ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="用于生成新账户ID（当 account_id 为空）"
                />
              </label>
              <label className="field">
                <span>INV update total_assets</span>
                <input
                  value={`${updateInvForm.total_assets ?? ""}`}
                  onChange={(e) => setUpdateInvForm((s) => ({ ...s, total_assets: e.target.value }))}
                  placeholder="10000.00"
                />
              </label>
              <label className="field">
                <span>INV update transfer_amount</span>
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
                {updateInvBusy ? "Running..." : "Update investment record"}
              </button>
            </div>
            {updateInvError ? <div className="inline-error" role="alert">{updateInvError}</div> : null}
            {updateInvResult ? <JsonResultCard title="Investment Record Update Result" data={updateInvResult} emptyText="No result." /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>INV delete id</span>
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
                {deleteInvBusy ? "Running..." : "Delete investment record"}
              </button>
            </div>
            {deleteInvError ? <div className="inline-error" role="alert">{deleteInvError}</div> : null}
            {deleteInvResult ? <JsonResultCard title="Investment Record Delete Result" data={deleteInvResult} emptyText="No result." /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>ASSET upsert class</span>
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
                <span>ASSET upsert snapshot_date</span>
                <input
                  value={`${manualAssetForm.snapshot_date ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>ASSET upsert account_id (optional)</span>
                <input
                  value={`${manualAssetForm.account_id ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_cash_xxx / acct_re_xxx / acct_liab_xxx"
                />
              </label>
              <label className="field">
                <span>ASSET upsert account_name</span>
                <input
                  value={`${manualAssetForm.account_name ?? ""}`}
                  onChange={(e) => setManualAssetForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="现金账户 / 不动产账户 / 负债账户"
                />
              </label>
              <label className="field">
                <span>ASSET upsert value</span>
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
                {manualAssetBusy ? "Running..." : "Upsert manual asset valuation"}
              </button>
            </div>
            {manualAssetError ? <div className="inline-error" role="alert">{manualAssetError}</div> : null}
            {manualAssetResult ? <JsonResultCard title="Manual Asset Valuation Upsert Result" data={manualAssetResult} emptyText="No result." /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>ASSET update id</span>
                <input
                  value={`${updateAssetForm.id ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, id: e.target.value }))}
                  placeholder="asset valuation id"
                />
              </label>
              <label className="field">
                <span>ASSET update class</span>
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
                <span>ASSET update snapshot_date</span>
                <input
                  value={`${updateAssetForm.snapshot_date ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>ASSET update account_id (optional)</span>
                <input
                  value={`${updateAssetForm.account_id ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_xxx"
                />
              </label>
              <label className="field">
                <span>ASSET update account_name</span>
                <input
                  value={`${updateAssetForm.account_name ?? ""}`}
                  onChange={(e) => setUpdateAssetForm((s) => ({ ...s, account_name: e.target.value }))}
                  placeholder="account name"
                />
              </label>
              <label className="field">
                <span>ASSET update value</span>
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
                {updateAssetBusy ? "Running..." : "Update asset valuation"}
              </button>
            </div>
            {updateAssetError ? <div className="inline-error" role="alert">{updateAssetError}</div> : null}
            {updateAssetResult ? <JsonResultCard title="Asset Valuation Update Result" data={updateAssetResult} emptyText="No result." /> : null}

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>ASSET delete id</span>
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
                {deleteAssetBusy ? "Running..." : "Delete asset valuation"}
              </button>
            </div>
            {deleteAssetError ? <div className="inline-error" role="alert">{deleteAssetError}</div> : null}
            {deleteAssetResult ? <JsonResultCard title="Asset Valuation Delete Result" data={deleteAssetResult} emptyText="No result." /> : null}
          </div>

          <div className="subcard">
            <h3>Meta Accounts</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>kind</span>
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
                {metaAccountsBusy ? "Running..." : "Run meta/accounts"}
              </button>
            </div>
            {metaAccountsError ? (
              <div className="inline-error" role="alert">
                {metaAccountsError}
              </div>
            ) : null}
            <MetaAccountsPreview data={metaAccountsResult} />
            {showRawJson ? (
              <JsonResultCard
                title="Meta Accounts JSON"
                data={metaAccountsResult}
                emptyText="No result yet. Run meta/accounts."
              />
            ) : null}
          </div>

          <div className="subcard">
            <h3>Transactions Query</h3>
            <div className="query-form-grid">
              <label className="field">
                <span>limit</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(txListQuery.limit, 20)}
                  onChange={(e) =>
                    setTxListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "20", 20),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>sort</span>
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
                <span>month_key</span>
                <input
                  value={`${txListQuery.month_key ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, month_key: e.target.value }))}
                  placeholder="YYYY-MM"
                />
              </label>
              <label className="field">
                <span>keyword</span>
                <input
                  value={`${txListQuery.keyword ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, keyword: e.target.value }))}
                  placeholder="merchant/description/category"
                />
              </label>
              <label className="field">
                <span>source_type</span>
                <input
                  value={`${txListQuery.source_type ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, source_type: e.target.value }))}
                  placeholder="cmb_eml / cmb_bank_pdf"
                />
              </label>
              <label className="field">
                <span>account_id</span>
                <input
                  value={`${txListQuery.account_id ?? ""}`}
                  onChange={(e) => setTxListQuery((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_xxx"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleTransactionsQuery()} disabled={txListBusy}>
                {txListBusy ? "Running..." : "Run query_transactions"}
              </button>
            </div>
            {txListError ? (
              <div className="inline-error" role="alert">
                {txListError}
              </div>
            ) : null}
            <TransactionsPreview data={txListResult} />
            {showRawJson ? (
              <JsonResultCard title="Transactions JSON" data={txListResult} emptyText="No result yet. Run query_transactions." />
            ) : null}
          </div>

          <div className="subcard">
            <h3>Transaction Analysis Exclusion (Rust)</h3>
            <p className="inline-hint">
              对齐 Web `update_transaction_analysis_exclusion`：可手动剔除/恢复交易的分析统计状态。先在 `Transactions Query` 中取 `id`。
            </p>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>transaction id</span>
                <input
                  value={`${txExclusionForm.id ?? ""}`}
                  onChange={(e) => setTxExclusionForm((s) => ({ ...s, id: e.target.value }))}
                  placeholder="transactions.id"
                />
              </label>
              <label className="field">
                <span>action</span>
                <select
                  value={txExclusionForm.action ?? "exclude"}
                  onChange={(e) =>
                    setTxExclusionForm((s) => ({
                      ...s,
                      action: e.target.value as UpdateTransactionAnalysisExclusionRequest["action"],
                    }))
                  }
                >
                  <option value="exclude">exclude</option>
                  <option value="restore">restore</option>
                </select>
              </label>
              <label className="field">
                <span>reason (exclude only)</span>
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
                {txExclusionBusy ? "Running..." : "Apply Transaction Exclusion Mutation"}
              </button>
            </div>

            {txExclusionError ? (
              <div className="inline-error" role="alert">
                {txExclusionError}
              </div>
            ) : null}
            {txExclusionResult ? (
              <JsonResultCard
                title="Transaction Analysis Exclusion Result"
                data={txExclusionResult}
                emptyText="No mutation result yet."
              />
            ) : null}
          </div>

          <div className="subcard">
            <h3>Investments Query</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>limit</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(invListQuery.limit, 20)}
                  onChange={(e) =>
                    setInvListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "20", 20),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>from</span>
                <input
                  value={`${invListQuery.from ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, from: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>to</span>
                <input
                  value={`${invListQuery.to ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, to: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>source_type</span>
                <input
                  value={`${invListQuery.source_type ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, source_type: e.target.value }))}
                  placeholder="manual / yzxy_xlsx / ..."
                />
              </label>
              <label className="field">
                <span>account_id</span>
                <input
                  value={`${invListQuery.account_id ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_inv_xxx"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleInvestmentsListQuery()} disabled={invListBusy}>
                {invListBusy ? "Running..." : "Run query_investments"}
              </button>
            </div>
            {invListError ? (
              <div className="inline-error" role="alert">
                {invListError}
              </div>
            ) : null}
            <InvestmentsListPreview data={invListResult} />
            {showRawJson ? (
              <JsonResultCard title="Investments JSON" data={invListResult} emptyText="No result yet. Run query_investments." />
            ) : null}
          </div>

          <div className="subcard">
            <h3>Asset Valuations Query</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>limit</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(assetListQuery.limit, 20)}
                  onChange={(e) =>
                    setAssetListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "20", 20),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>from</span>
                <input
                  value={`${assetListQuery.from ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, from: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>to</span>
                <input
                  value={`${assetListQuery.to ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, to: e.target.value }))}
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>asset_class</span>
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
                <span>account_id</span>
                <input
                  value={`${assetListQuery.account_id ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, account_id: e.target.value }))}
                  placeholder="acct_xxx"
                />
              </label>
            </div>
            <div className="db-actions">
              <button type="button" className="primary-btn" onClick={() => void handleAssetValuationsQuery()} disabled={assetListBusy}>
                {assetListBusy ? "Running..." : "Run query_asset_valuations"}
              </button>
            </div>
            {assetListError ? (
              <div className="inline-error" role="alert">
                {assetListError}
              </div>
            ) : null}
            <AssetValuationsPreview data={assetListResult} />
            {showRawJson ? (
              <JsonResultCard
                title="Asset Valuations JSON"
                data={assetListResult}
                emptyText="No result yet. Run query_asset_valuations."
              />
            ) : null}
          </div>
        </div>
      </section> : null}

      {isTab("return-analysis") ? <section className="card panel">
        <div className="panel-header">
          <h2>Investment Return Probe (Rust)</h2>
          <p>
            第一条业务口径迁移：`investment-return`（当前已支持单账户与 `__portfolio__` 组合查询，直接读取 desktop
            SQLite）。
          </p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>account_id</span>
            <input
              value={invQuery.account_id}
              onChange={(e) => setInvQuery((s) => ({ ...s, account_id: e.target.value }))}
              placeholder="acct_xxx or __portfolio__"
            />
          </label>
          <label className="field">
            <span>preset</span>
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
            <span>from (custom)</span>
            <input
              value={invQuery.from}
              onChange={(e) => setInvQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>to (optional)</span>
            <input
              value={invQuery.to}
              onChange={(e) => setInvQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
        </div>

        <div className="db-actions">
          <button type="button" className="primary-btn" onClick={() => void handleInvestmentReturnQuery()} disabled={invBusy}>
            {invBusy ? "Running..." : "Run investment-return"}
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
            emptyText="No result yet. Run migrations and then query."
          />
        ) : null}
      </section> : null}

      {isTab("return-analysis") ? <section className="card panel">
        <div className="panel-header">
          <h2>Investment Curve Probe (Rust)</h2>
          <p>第二条投资分析接口：`investment-curve`（单账户/组合，返回资产曲线与累计收益率曲线）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>account_id</span>
            <input
              value={invCurveQuery.account_id}
              onChange={(e) => setInvCurveQuery((s) => ({ ...s, account_id: e.target.value }))}
              placeholder="acct_xxx or __portfolio__"
            />
          </label>
          <label className="field">
            <span>preset</span>
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
            <span>from (custom)</span>
            <input
              value={invCurveQuery.from}
              onChange={(e) => setInvCurveQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>to (optional)</span>
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
            {invCurveBusy ? "Running..." : "Run investment-curve"}
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
            emptyText="No result yet. Run migrations and then query."
          />
        ) : null}
      </section> : null}

      {isTab("wealth-overview") ? <section className="card panel">
        <div className="panel-header">
          <h2>Wealth Overview Probe (Rust)</h2>
          <p>财富总览口径验证：`wealth-overview`（含筛选、对账校验、滞后天数）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>as_of (optional)</span>
            <input
              value={wealthOverviewQuery.as_of}
              onChange={(e) => setWealthOverviewQuery((s) => ({ ...s, as_of: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <BoolField
            label="include_investment"
            value={wealthOverviewQuery.include_investment}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_investment: value }))}
          />
          <BoolField
            label="include_cash"
            value={wealthOverviewQuery.include_cash}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_cash: value }))}
          />
          <BoolField
            label="include_real_estate"
            value={wealthOverviewQuery.include_real_estate}
            onChange={(value) => setWealthOverviewQuery((s) => ({ ...s, include_real_estate: value }))}
          />
          <BoolField
            label="include_liability"
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
            {wealthOverviewBusy ? "Running..." : "Run wealth-overview"}
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
            emptyText="No result yet. Run migrations and ensure desktop DB has sample/real data."
          />
        ) : null}
      </section> : null}

      {isTab("wealth-overview") ? <section className="card panel">
        <div className="panel-header">
          <h2>Wealth Curve Probe (Rust)</h2>
          <p>财富曲线口径验证：`wealth-curve`（区间预设 + 资产类型筛选）。</p>
        </div>

        <div className="query-form-grid">
          <label className="field">
            <span>preset</span>
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
            <span>from (custom)</span>
            <input
              value={wealthCurveQuery.from}
              onChange={(e) => setWealthCurveQuery((s) => ({ ...s, from: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <label className="field">
            <span>to (optional)</span>
            <input
              value={wealthCurveQuery.to}
              onChange={(e) => setWealthCurveQuery((s) => ({ ...s, to: e.target.value }))}
              placeholder="YYYY-MM-DD"
            />
          </label>
          <BoolField
            label="include_investment"
            value={wealthCurveQuery.include_investment}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_investment: value }))}
          />
          <BoolField
            label="include_cash"
            value={wealthCurveQuery.include_cash}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_cash: value }))}
          />
          <BoolField
            label="include_real_estate"
            value={wealthCurveQuery.include_real_estate}
            onChange={(value) => setWealthCurveQuery((s) => ({ ...s, include_real_estate: value }))}
          />
          <BoolField
            label="include_liability"
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
            {wealthCurveBusy ? "Running..." : "Run wealth-curve"}
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
            emptyText="No result yet. Run migrations and ensure desktop DB has sample/real data."
          />
        ) : null}
      </section> : null}

      {isTab("admin") ? <section className="card panel roadmap-panel">
        <div className="panel-header">
          <h2>Next Migration Steps</h2>
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
