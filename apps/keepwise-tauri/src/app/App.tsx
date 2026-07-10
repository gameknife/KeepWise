import { startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import "react-datepicker/dist/react-datepicker.css";
import "../App.css";
import keepwiseLogoSvg from "../assets/keepwise-logo.svg";
import { AdminDbStatsPreview, RuntimeHealthPreview } from "../features/admin/AdminRuntimePreviews";
import { AdminDbPanel } from "../features/admin/AdminDbPanel";
import { AdminProbePanels } from "../features/admin/AdminProbePanels";
import { AccountCatalogAdminPanel } from "../features/admin/AccountCatalogAdminPanel";
import { AdminSections } from "../features/admin/AdminSections";
import { ReturnAnalysisSection } from "../features/analytics/ReturnAnalysisSection";
import { WealthOverviewSection } from "../features/analytics/WealthOverviewSection";
import {
  BudgetItemsPreview,
  BudgetMonthlyReviewPreview,
  BudgetOverviewPreview,
  FireProgressPreview,
} from "../features/budget/BudgetFirePreviews";
import { ConsumptionOverviewPreview } from "../features/consumption/ConsumptionOverviewPreview";
import { AnalysisExportSection } from "../features/export/AnalysisExportSection";
import { ImportCenterSections } from "../features/import/ImportCenterSections";
import { SalaryIncomeOverviewPreview } from "../features/income/SalaryIncomeOverviewPreview";
import { MobileHomeGrid } from "../features/layout/MobileHomeGrid";
import { WorkspaceSidebar } from "../features/layout/WorkspaceSidebar";
import { WorkspaceContentPanels } from "../features/layout/WorkspaceContentPanels";
import { AppSettingsModal } from "../features/modals/AppSettingsModal";
import { InvestmentEditModal } from "../features/modals/InvestmentEditModal";
import { QuickManualAssetValuationModal } from "../features/modals/QuickManualAssetValuationModal";
import { QuickManualInvestmentModal } from "../features/modals/QuickManualInvestmentModal";
import { InvestmentCurvePreview } from "../features/records/InvestmentCurvePreview";
import {
  AccountCatalogPreview,
  AssetValuationsPreview,
  InvestmentReturnsPreview,
  InvestmentsListPreview,
  MetaAccountsPreview,
} from "../features/records/RecordsPreviews";
import { RulesAdminPanel } from "../features/rules/RulesAdminPanel";
import {
  AccountIdSelect,
  AutoRefreshHint,
  BaseJsonResultCard,
  BasePreviewStat,
  BoolField,
  DateInput,
  LineAreaChart,
  PathRow,
  SortableHeaderButton,
  accountKindsForAssetClass,
  buildAccountSelectOptionsFromCatalog,
  compareSortValues,
  nextSortState,
} from "../features/shared/UiPrimitives";
import { WealthCurvePreview, WealthOverviewPreview } from "../features/wealth/WealthPreviews";
import { useAsyncQuery } from "../hooks/useAsyncQuery";
import { useDebouncedAutoRun } from "../hooks/useDebouncedAutoRun";
import {
  deleteMonthlyBudgetItem,
  cmbBankPdfImport,
  cmbBankPdfPreview,
  cmbEmlImport,
  cmbEmlPreview,
  deleteAccountCatalogEntry,
  deleteInvestmentRecord,
  importLedgerDbFromPath,
  loadBootstrapProbe,
  loadLedgerDbAdminStats,
  loadLedgerDbStatus,
  queryImportJobs,
  queryAccountCatalog,
  queryBudgetMonthlyReview,
  queryBudgetOverview,
  queryConsumptionReport,
  queryAssetValuations,
  queryInvestments,
  queryInvestmentReturns,
  queryInvestmentCurveBenchmarks,
  queryInvestmentCurve,
  queryInvestmentReturn,
  queryMonthlyBudgetItems,
  queryMetaAccounts,
  queryFireProgress,
  querySalaryIncomeOverview,
  queryTransactions,
  queryWealthCurve,
  queryWealthOverview,
  runLedgerDbAdminResetAll,
  runLedgerDbAdminResetTransactions,
  runRuntimeDbHealthCheck,
  runLedgerDbMigrate,
  syncReconcile,
  syncPollRemoteUpdate,
  syncSetupCreate,
  syncSetupLink,
  syncShareCodeGenerate,
  syncStatus,
  confirmTransactionReview,
  updateTransactionAnalysisExclusion,
  updateInvestmentRecord,
  upsertAccountCatalogEntry,
  upsertManualAssetValuation,
  upsertMonthlyBudgetItem,
  upsertMerchantMapRule,
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
  type AccountCatalogDeletePayload,
  type AccountCatalogPayload,
  type AccountCatalogUpsertPayload,
  type DeleteByIdRequest,
  type LedgerAdminDbStats,
  type LedgerAdminResetAllResult,
  type LedgerAdminResetTransactionsResult,
  type LedgerDbImportRepoRuntimeResult,
  type InvestmentCurvePayload,
  type InvestmentCurveQueryRequest,
  type InvestmentReturnsPayload,
  type LedgerDbMigrateResult,
  type LedgerDbStatus,
  type MonthlyBudgetItemDeleteRequest,
  type MonthlyBudgetItemMutationPayload,
  type MonthlyBudgetItemsPayload,
  type MonthlyBudgetItemUpsertRequest,
  type MetaAccountsPayload,
  type MetaAccountsQueryRequest,
  type QueryAssetValuationsPayload,
  type QueryAssetValuationsRequest,
  type QueryInvestmentsPayload,
  type QueryInvestmentsRequest,
  type QueryTransactionsPayload,
  type QueryTransactionsRequest,
  type QueryAccountCatalogRequest,
  type RuntimeDbHealthCheckPayload,
  type SyncReconcilePayload,
  type SalaryIncomeOverviewPayload,
  type ImportJobsPayload,
  type SyncStatusPayload,
  type UpdateInvestmentRecordRequest,
  type UpsertManualInvestmentRequest,
  type UpsertManualAssetValuationRequest,
  type UpsertAccountCatalogEntryRequest,
  type QueryImportJobsRequest,
  type WealthCurvePayload,
  type WealthOverviewPayload,
  type YzxyImportPayload,
  type YzxyPreviewPayload,
  type FireProgressPayload,
  type FireProgressQueryRequest,
  type InvestmentReturnPayload,
} from "../lib/desktopApi";
import {
  configureAmountFormatting,
  formatCentsInputValue,
  formatCentsShort,
  formatCentsYuanText,
  formatPct,
  formatRatePct,
  formatSignedDeltaCentsShort,
  isAmountPrivacyMasked,
  isLikelyAmountJsonKey,
  maskAmountDisplayText,
  maskAmountValueByLabel,
  signedMetricTone,
} from "./amountFormatting";
import {
  computeMonthlyTotalAssetGrowthFromWealthCurve,
  formatMonthDayLabel,
  formatPresetLabel,
  getCurrentMonthDateRangeLocal,
  getTodayDateInputValueLocal,
  makeEnterToQueryHandler,
  makeInitialSmokeRows,
  parseMonthNumberFromMonthKey,
  parseNumericInputWithFallback,
  parseStoredAppSettings,
  parseYuanInputToNumber,
  safeNumericInputValue,
  withSmokeResult,
} from "./helpers";
import {
  summarizeInvestmentCurvePayload,
  summarizeInvestmentReturnPayload,
  summarizeWealthCurvePayload,
  summarizeWealthOverviewPayload,
} from "./summaries";
import {
  buildAccountCatalogQueryRequest,
  buildAccountCatalogUpsertRequest,
  buildAdminResetRequest,
  buildAssetValuationsQueryRequest,
  buildBudgetItemUpsertMutationRequest,
  buildBudgetYearQueryRequest,
  buildFireProgressQueryRequest,
  buildInvestmentCurveRequest,
  buildInvestmentReturnRequest,
  buildInvestmentReturnsRequest,
  buildInvestmentsListQueryRequest,
  buildMetaAccountsRequest,
  buildReturnTabQuickMetricRequest,
  buildTransactionsQueryRequest,
  buildWealthCurveRequest,
  buildWealthOverviewRequest,
  compactStringFields,
  toErrorMessage,
} from "./requestBuilders";
import {
  type AppSettings,
  type BoolString,
  type LoadStatus,
  type PipelineStatus,
  type MobileView,
  type ProductTabDef,
  type ProductTabKey,
  type SmokeRow,
} from "../types/app";
import { isRecord, readArray, readNumber, readString } from "../utils/value";

const PRODUCT_TABS: ProductTabDef[] = [
  { key: "manual-entry", icon: "✎", label: "更新收益", subtitle: "快捷录入投资快照", status: "partial" },
  { key: "manual-asset-entry", icon: "▣", label: "更新资产", subtitle: "快捷录入现金/房产快照", status: "partial" },
  { key: "wealth-overview", icon: "◔", label: "财富总览", subtitle: "总览与财富曲线", status: "ready" },
  { key: "return-analysis", icon: "↗", label: "投资收益", subtitle: "投资收益率与收益曲线", status: "ready" },
  { key: "budget-fire", icon: "◎", label: "FIRE进度", subtitle: "自由度、预算与复盘", status: "partial" },
  { key: "income-analysis", icon: "¥", label: "收入分析", subtitle: "收入结构与趋势", status: "partial" },
  { key: "consumption-analysis", icon: "¤", label: "消费分析", subtitle: "筛选、趋势与交易明细", status: "partial" },
  { key: "import-center", icon: "⇩", label: "数据导入", subtitle: "YZXY / EML / CMB PDF", status: "ready" },
  { key: "export-analysis", icon: "↑", label: "智能分析", subtitle: "生成 AI 分析所需的 Markdown 资产快照", status: "ready" },
  { key: "admin", icon: "⚙", label: "高级管理", subtitle: "调试、健康检查、管理操作", status: "ready" },
];

const APP_SETTINGS_STORAGE_KEY = "keepwise.desktop.app-settings.v1";
const QUICK_MANUAL_INV_LAST_ACCOUNT_ID_STORAGE_KEY = "keepwise.desktop.quick-manual-investment.last-account-id.v1";
const QUICK_MANUAL_ASSET_LAST_ACCOUNT_ID_STORAGE_KEY = "keepwise.desktop.quick-manual-asset.last-account-id.v1";
const QUICK_MANUAL_ASSET_LAST_ASSET_CLASS_STORAGE_KEY = "keepwise.desktop.quick-manual-asset.last-asset-class.v1";
const SYNC_REMOTE_POLL_INTERVAL_MS = 8000;

function getVisibleTabsForMode(tabs: ProductTabDef[], isMobileMode: boolean): ProductTabDef[] {
  if (!isMobileMode) return tabs;
  return tabs.filter((tab) => tab.key !== "admin");
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
  return (
    <BaseJsonResultCard
      title={title}
      data={data}
      emptyText={emptyText}
      jsonValueReplacer={(key, value) => {
        if (typeof value === "bigint") {
          return isLikelyAmountJsonKey(key) && isAmountPrivacyMasked() ? "****" : value.toString();
        }
        if (isLikelyAmountJsonKey(key) && isAmountPrivacyMasked()) {
          if (typeof value === "number" || typeof value === "string") return "****";
        }
        return value;
      }}
    />
  );
}

function normalizeQuickManualAssetClass(value?: string): "cash" | "real_estate" | "liability" {
  if (value === "real_estate" || value === "liability") return value;
  return "cash";
}

function accountKindMatchesAssetClass(assetClass: "cash" | "real_estate" | "liability", accountKind?: string): boolean {
  const allowedKinds = accountKindsForAssetClass(assetClass) ?? [];
  return !!accountKind && allowedKinds.includes(accountKind);
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
  return <BasePreviewStat label={label} value={value} tone={tone} valueFormatter={maskAmountValueByLabel} />;
}


function App() {
  // 应用与数据库基座状态：控制桌面探针、DB 状态与迁移/导入面板。
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [probe, setProbe] = useState<BootstrapProbe | null>(null);
  const [error, setError] = useState<string>("");
  const [dbStatus, setDbStatus] = useState<LedgerDbStatus | null>(null);
  const [dbStatusError, setDbStatusError] = useState<string>("");
  const [dbBusy, setDbBusy] = useState(false);
  const [dbImportPath, setDbImportPath] = useState("");
  // 数据导入输入源与执行结果：分别维护 YZXY / EML / CMB-PDF 三条导入链路。
  const [yzxyFilePath, setYzxyFilePath] = useState("");
  const [yzxyPreviewBusy, setYzxyPreviewBusy] = useState(false);
  const [yzxyPreviewError, setYzxyPreviewError] = useState("");
  const [yzxyPreviewResult, setYzxyPreviewResult] = useState<YzxyPreviewPayload | null>(null);
  const [yzxyImportBusy, setYzxyImportBusy] = useState(false);
  const [yzxyImportError, setYzxyImportError] = useState("");
  const [yzxyImportResult, setYzxyImportResult] = useState<YzxyImportPayload | null>(null);
  const [emlSourcePath, setEmlSourcePath] = useState("");
  const [emlPreviewBusy, setEmlPreviewBusy] = useState(false);
  const [emlPreviewError, setEmlPreviewError] = useState("");
  const [emlPreviewResult, setEmlPreviewResult] = useState<CmbEmlPreviewPayload | null>(null);
  const [emlImportBusy, setEmlImportBusy] = useState(false);
  const [emlImportError, setEmlImportError] = useState("");
  const [emlImportResult, setEmlImportResult] = useState<CmbEmlImportPayload | null>(null);
  const [cmbPdfPath, setCmbPdfPath] = useState("");
  const [cmbPdfPreviewBusy, setCmbPdfPreviewBusy] = useState(false);
  const [cmbPdfPreviewError, setCmbPdfPreviewError] = useState("");
  const [cmbPdfPreviewResult, setCmbPdfPreviewResult] = useState<CmbBankPdfPreviewPayload | null>(null);
  const [cmbPdfImportBusy, setCmbPdfImportBusy] = useState(false);
  const [cmbPdfImportError, setCmbPdfImportError] = useState("");
  const [cmbPdfImportResult, setCmbPdfImportResult] = useState<CmbBankPdfImportPayload | null>(null);
  // 管理与验证流水线：包含 DB 统计、重置、健康检查与 smoke/pipeline 汇总状态。
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
  const [importJobsBusy, setImportJobsBusy] = useState(false);
  const [importJobsError, setImportJobsError] = useState("");
  const [importJobsResult, setImportJobsResult] = useState<ImportJobsPayload | null>(null);
  const [importJobsLastRunAt, setImportJobsLastRunAt] = useState<number | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineLastRunAt, setPipelineLastRunAt] = useState<number | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState("");
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [smokeRows, setSmokeRows] = useState<SmokeRow[]>(() => makeInitialSmokeRows());
  const [smokeLastRunAt, setSmokeLastRunAt] = useState<number | null>(null);
  const [dbLastResult, setDbLastResult] = useState<LedgerDbMigrateResult | null>(null);
  const [dbImportLastResult, setDbImportLastResult] = useState<LedgerDbImportRepoRuntimeResult | null>(null);
  const [viewportSize, setViewportSize] = useState(() => {
    if (typeof window === "undefined") return { width: 0, height: 0 };
    return {
      width: Math.round(window.visualViewport?.width ?? window.innerWidth),
      height: Math.round(window.visualViewport?.height ?? window.innerHeight),
    };
  });
  // 核心分析 TAB（收益/财富）的查询条件与结果状态。
  const [invBusy, setInvBusy] = useState(false);
  const [invError, setInvError] = useState("");
  const [invResult, setInvResult] = useState<InvestmentReturnPayload | null>(null);
  const [invLastQueryKey, setInvLastQueryKey] = useState("");
  const [invQuery, setInvQuery] = useState({
    account_id: "__portfolio__",
    preset: "ytd",
    from: "",
    to: "",
  });
  const [invBatchBusy, setInvBatchBusy] = useState(false);
  const [invBatchError, setInvBatchError] = useState("");
  const [invBatchResult, setInvBatchResult] = useState<InvestmentReturnsPayload | null>(null);
  const [invBatchLastQueryKey, setInvBatchLastQueryKey] = useState("");
  const [invCurveBusy, setInvCurveBusy] = useState(false);
  const [invCurveError, setInvCurveError] = useState("");
  const [invCurveResult, setInvCurveResult] = useState<InvestmentCurvePayload | null>(null);
  const [invCurveBenchmarksBusy, setInvCurveBenchmarksBusy] = useState(false);
  const [invCurveLastQueryKey, setInvCurveLastQueryKey] = useState("");
  const invCurveRequestSeqRef = useRef(0);
  const invCurveRequestRef = useRef<InvestmentCurveQueryRequest | null>(null);
  const [invCurveQuery, setInvCurveQuery] = useState({
    account_id: "__portfolio__",
    preset: "ytd",
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
    preset: "ytd",
    from: "",
    to: "",
    include_investment: "true",
    include_cash: "true",
    include_real_estate: "true",
    include_liability: "true",
  });
  // 预算/FIRE/收入/消费模块状态。
  const [budgetItemsBusy, setBudgetItemsBusy] = useState(false);
  const [budgetItemsError, setBudgetItemsError] = useState("");
  const [budgetItemsResult, setBudgetItemsResult] = useState<MonthlyBudgetItemsPayload | null>(null);
  const [budgetItemUpsertBusy, setBudgetItemUpsertBusy] = useState(false);
  const [budgetItemUpsertError, setBudgetItemUpsertError] = useState("");
  const [budgetItemUpsertResult, setBudgetItemUpsertResult] = useState<MonthlyBudgetItemMutationPayload | null>(null);
  const [budgetItemDeleteBusy, setBudgetItemDeleteBusy] = useState(false);
  const [budgetItemDeleteError, setBudgetItemDeleteError] = useState("");
  const [budgetItemDeleteResult, setBudgetItemDeleteResult] = useState<MonthlyBudgetItemMutationPayload | null>(null);
  const [budgetItemCreateOpen, setBudgetItemCreateOpen] = useState(false);
  const [budgetItemDeletingRowId, setBudgetItemDeletingRowId] = useState("");
  const [budgetItemForm, setBudgetItemForm] = useState<MonthlyBudgetItemUpsertRequest>({
    id: "",
    name: "",
    monthly_amount: "",
    sort_order: "1000",
    is_active: "true",
  });
  const currentYearText = String(new Date().getFullYear());
  const budgetYearOptions = Array.from({ length: 7 }, (_v, idx) => String(new Date().getFullYear() - idx));
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
  const [salaryIncomeBusy, setSalaryIncomeBusy] = useState(false);
  const [salaryIncomeError, setSalaryIncomeError] = useState("");
  const [salaryIncomeResult, setSalaryIncomeResult] = useState<SalaryIncomeOverviewPayload | null>(null);
  const [salaryIncomeQuery, setSalaryIncomeQuery] = useState<BudgetYearQueryRequest>({
    year: currentYearText,
  });
  const consumptionOverview = useAsyncQuery<{ year?: string }, ConsumptionReportPayload>(
    queryConsumptionReport,
    { year: currentYearText },
    toErrorMessage,
  );
  const consumptionOverviewBusy = consumptionOverview.busy;
  const consumptionOverviewError = consumptionOverview.error;
  const consumptionOverviewResult = consumptionOverview.result;
  const [consumptionCategoryUpdatingMerchant, setConsumptionCategoryUpdatingMerchant] = useState("");
  const [consumptionYear, setConsumptionYear] = useState<string>(currentYearText);
  // 查询工作台（高级管理）状态：账户、交易、投资、估值等底层数据面板。
  const [metaAccountsBusy, setMetaAccountsBusy] = useState(false);
  const [metaAccountsError, setMetaAccountsError] = useState("");
  const [metaAccountsResult, setMetaAccountsResult] = useState<MetaAccountsPayload | null>(null);
  const [metaAccountsQuery, setMetaAccountsQuery] = useState<MetaAccountsQueryRequest>({ kind: "all" });
  const [_txListBusy, setTxListBusy] = useState(false);
  const [_txListError, setTxListError] = useState("");
  const [_txListResult, setTxListResult] = useState<QueryTransactionsPayload | null>(null);
  const [txListQuery, _setTxListQuery] = useState<QueryTransactionsRequest>({
    limit: 100,
    sort: "date_desc",
    month_key: "",
    source_type: "",
    account_id: "",
    keyword: "",
  });
  const [invListBusy, setInvListBusy] = useState(false);
  const [invListError, setInvListError] = useState("");
  const [invListResult, setInvListResult] = useState<QueryInvestmentsPayload | null>(null);
  const [invListQuery, setInvListQuery] = useState<QueryInvestmentsRequest>({
    limit: 30,
    from: "",
    to: "",
    source_type: "",
    account_id: "",
  });
  const [assetListBusy, setAssetListBusy] = useState(false);
  const [assetListError, setAssetListError] = useState("");
  const [assetListResult, setAssetListResult] = useState<QueryAssetValuationsPayload | null>(null);
  const [assetListQuery, setAssetListQuery] = useState<QueryAssetValuationsRequest>({
    limit: 30,
    from: "",
    to: "",
    asset_class: "",
    account_id: "",
  });
  const [acctCatalogBusy, setAcctCatalogBusy] = useState(false);
  const [acctCatalogError, setAcctCatalogError] = useState("");
  const [acctCatalogResult, setAcctCatalogResult] = useState<AccountCatalogPayload | null>(null);
  const [accountSelectCatalogBusy, setAccountSelectCatalogBusy] = useState(false);
  const [accountSelectCatalogResult, setAccountSelectCatalogResult] = useState<AccountCatalogPayload | null>(null);
  const [acctCatalogQuery, setAcctCatalogQuery] = useState<QueryAccountCatalogRequest>({
    kind: "all",
    keyword: "",
    limit: 200,
  });
  const [acctCatalogUpsertBusy, setAcctCatalogUpsertBusy] = useState(false);
  const [acctCatalogUpsertError, setAcctCatalogUpsertError] = useState("");
  const [acctCatalogUpsertResult, setAcctCatalogUpsertResult] = useState<AccountCatalogUpsertPayload | null>(null);
  const [acctCatalogCreateOpen, setAcctCatalogCreateOpen] = useState(false);
  const [acctCatalogModalMode, setAcctCatalogModalMode] = useState<"create" | "rename">("create");
  const [acctCatalogUpsertForm, setAcctCatalogUpsertForm] = useState<UpsertAccountCatalogEntryRequest>({
    account_id: "",
    account_name: "",
    account_kind: "cash",
  });
  const [acctCatalogDeleteBusy, setAcctCatalogDeleteBusy] = useState(false);
  const [acctCatalogDeleteError, setAcctCatalogDeleteError] = useState("");
  const [acctCatalogDeleteResult, setAcctCatalogDeleteResult] = useState<AccountCatalogDeletePayload | null>(null);
  const [acctCatalogDeletingRowId, setAcctCatalogDeletingRowId] = useState("");
  // “更新收益”主流程：弹窗录入、编辑、删除与侧边栏快捷指标。
  const [quickManualInvOpen, setQuickManualInvOpen] = useState(false);
  const [quickManualInvBusy, setQuickManualInvBusy] = useState(false);
  const [quickManualInvError, setQuickManualInvError] = useState("");
  const [quickManualInvAccountAssetsBusy, setQuickManualInvAccountAssetsBusy] = useState(false);
  const [quickManualInvAccountAssetsError, setQuickManualInvAccountAssetsError] = useState("");
  const [quickManualInvAccountAssetsCents, setQuickManualInvAccountAssetsCents] = useState<number | null>(null);
  const [quickManualInvAccountAssetsDate, setQuickManualInvAccountAssetsDate] = useState("");
  const [quickManualInvLastAccountId, setQuickManualInvLastAccountId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(QUICK_MANUAL_INV_LAST_ACCOUNT_ID_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [quickManualInvForm, setQuickManualInvForm] = useState<UpsertManualInvestmentRequest>({
    snapshot_date: "",
    account_id: "",
    account_name: "",
    total_assets: "",
    transfer_amount: "0",
  });
  const [quickManualAssetOpen, setQuickManualAssetOpen] = useState(false);
  const [quickManualAssetBusy, setQuickManualAssetBusy] = useState(false);
  const [quickManualAssetError, setQuickManualAssetError] = useState("");
  const [quickManualAssetAccountValueBusy, setQuickManualAssetAccountValueBusy] = useState(false);
  const [quickManualAssetAccountValueError, setQuickManualAssetAccountValueError] = useState("");
  const [quickManualAssetAccountValueCents, setQuickManualAssetAccountValueCents] = useState<number | null>(null);
  const [quickManualAssetAccountValueDate, setQuickManualAssetAccountValueDate] = useState("");
  const [quickManualAssetLastAccountId, setQuickManualAssetLastAccountId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(QUICK_MANUAL_ASSET_LAST_ACCOUNT_ID_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [quickManualAssetLastAssetClass, setQuickManualAssetLastAssetClass] = useState<"cash" | "real_estate" | "liability">(() => {
    if (typeof window === "undefined") return "cash";
    try {
      return normalizeQuickManualAssetClass(window.localStorage.getItem(QUICK_MANUAL_ASSET_LAST_ASSET_CLASS_STORAGE_KEY) ?? "");
    } catch {
      return "cash";
    }
  });
  const [quickManualAssetForm, setQuickManualAssetForm] = useState<UpsertManualAssetValuationRequest>({
    asset_class: "cash",
    snapshot_date: "",
    account_id: "",
    account_name: "",
    value: "",
  });
  const [returnTabYtdAnnualizedRate, setReturnTabYtdAnnualizedRate] = useState<number | null>(null);
  const [returnTabYtdNetGrowthCents, setReturnTabYtdNetGrowthCents] = useState<number | null>(null);
  const [manualEntryTabMonthCountBusy, setManualEntryTabMonthCountBusy] = useState(false);
  const [manualEntryTabMonthCount, setManualEntryTabMonthCount] = useState<number | null>(null);
  const [manualAssetEntryLastDateBusy, setManualAssetEntryLastDateBusy] = useState(false);
  const [manualAssetEntryLastDate, setManualAssetEntryLastDate] = useState<string>("");
  const [invEditModalOpen, setInvEditModalOpen] = useState(false);
  const [updateInvBusy, setUpdateInvBusy] = useState(false);
  const [updateInvError, setUpdateInvError] = useState("");
  const [updateInvForm, setUpdateInvForm] = useState<UpdateInvestmentRecordRequest>({
    id: "",
    snapshot_date: "",
    account_id: "",
    account_name: "",
    total_assets: "",
    transfer_amount: "0",
  });
  const [deleteInvBusy, setDeleteInvBusy] = useState(false);
  const [deleteInvId, setDeleteInvId] = useState("");
  const [syncRuntimeStatus, setSyncRuntimeStatus] = useState<SyncStatusPayload | null>(null);
  const [syncSetupBusy, setSyncSetupBusy] = useState(false);
  const [syncSetupError, setSyncSetupError] = useState("");
  const [syncActionMessage, setSyncActionMessage] = useState("");
  const [syncShareCode, setSyncShareCode] = useState("");
  const [syncCreateForm, setSyncCreateForm] = useState({
    secret_id: "",
    secret_key: "",
    region: "ap-shanghai",
    app_id: "",
    sync_password: "",
  });
  const [syncLinkForm, setSyncLinkForm] = useState({
    share_code: "",
    sync_password: "",
  });
  const syncReconcileBusyRef = useRef(false);
  const [syncPendingLocalWrite, setSyncPendingLocalWrite] = useState(false);
  const [syncQuickBusy, setSyncQuickBusy] = useState(false);

  function markLocalMutationForSync() {
    setSyncPendingLocalWrite(true);
  }

  // 基础探针与 DB 管理动作：用于启动可用性判定和高级管理面板操作。
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

  async function refreshSyncRuntimeStatus() {
    try {
      const next = await syncStatus();
      startTransition(() => {
        setSyncRuntimeStatus(next);
      });
    } catch {
      // Sync is optional before first setup; keep silent.
    }
  }

  function refreshDataViewsAfterManualSync() {
    void refreshDbStatus();
    void handleRefreshAdminDbStats();
    void handleImportJobsQuery();
    void handleRunRuntimeHealthCheck();
    void handleMetaAccountsQuery();
    void handleAccountCatalogQuery();
    void handleRefreshAccountSelectCatalog();
    void handleTransactionsQuery();
    void handleInvestmentsListQuery();
    void handleAssetValuationsQuery();
    void handleMonthlyBudgetItemsQuery();
    void handleBudgetOverviewQuery();
    void handleBudgetMonthlyReviewQuery();
    void handleSalaryIncomeOverviewQuery();
    void handleConsumptionOverviewQuery();
    void handleInvestmentReturnQuery();
    void handleInvestmentReturnsQuery();
    void handleInvestmentCurveQuery();
    void handleWealthOverviewQuery();
    void handleWealthCurveQuery();
    void handleFireProgressQuery();
    void handleRefreshManualEntryTabMonthCount();
    void handleRefreshManualAssetEntryLastDate();
  }

  async function triggerAutoSyncReconcile(
    _reason: "manual" | "remote_poll",
  ): Promise<SyncReconcilePayload | null> {
    if (syncReconcileBusyRef.current) return null;
    let syncStarted = false;
    try {
      const current = await syncStatus();
      startTransition(() => {
        setSyncRuntimeStatus(current);
      });
      if (!current.configured || current.syncing) return null;
      syncReconcileBusyRef.current = true;
      syncStarted = true;
      setSyncQuickBusy(true);
      startTransition(() => {
        setSyncRuntimeStatus({ ...current, syncing: true });
      });
      const result = await syncReconcile();
      startTransition(() => {
        setSyncRuntimeStatus(result.status);
      });
      if (result.ok && !result.status.conflict) {
        setSyncPendingLocalWrite(false);
      }
      return result;
    } catch {
      // Keep auto-sync best-effort, don't block business flows.
      if (syncStarted) void refreshSyncRuntimeStatus();
      return null;
    } finally {
      syncReconcileBusyRef.current = false;
      if (syncStarted) setSyncQuickBusy(false);
    }
  }

  async function handleManualSyncNow() {
    if (syncQuickBusy) return;
    setSyncQuickBusy(true);
    try {
      const result = await triggerAutoSyncReconcile("manual");
      if (result?.ok) {
        setSyncActionMessage("同步完成，正在刷新本地数据视图...");
        refreshDataViewsAfterManualSync();
      }
      await refreshSyncRuntimeStatus();
    } finally {
      setSyncQuickBusy(false);
    }
  }

  async function handleQuickSyncIndicatorClick() {
    if (!syncRuntimeStatus?.configured) {
      setSettingsOpen(true);
      setSyncActionMessage("请先在设置中完成云同步配置");
      return;
    }
    await handleManualSyncNow();
  }

  async function handleSyncSetupCreate() {
    const req = {
      secret_id: syncCreateForm.secret_id.trim(),
      secret_key: syncCreateForm.secret_key.trim(),
      region: syncCreateForm.region.trim(),
      app_id: syncCreateForm.app_id.trim(),
      sync_password: syncCreateForm.sync_password,
    };
    if (!req.secret_id || !req.secret_key || !req.region || !req.app_id || !req.sync_password) {
      setSyncSetupError("请完整填写 SecretId / SecretKey / Region / AppID / 同步密码");
      return;
    }

    setSyncSetupBusy(true);
    setSyncSetupError("");
    setSyncActionMessage("");
    try {
      const payload = await syncSetupCreate(req);
      startTransition(() => {
        setSyncShareCode(payload.share_code || "");
        setSyncRuntimeStatus(payload.status);
        setSyncActionMessage("同步库创建并绑定成功");
      });
      setSyncPendingLocalWrite(false);
    } catch (err) {
      setSyncSetupError(toErrorMessage(err));
    } finally {
      setSyncSetupBusy(false);
    }
  }

  async function handleSyncSetupLink() {
    const req = {
      share_code: syncLinkForm.share_code.trim(),
      sync_password: syncLinkForm.sync_password,
    };
    if (!req.share_code || !req.sync_password) {
      setSyncSetupError("请填写同步链接码与同步密码");
      return;
    }

    setSyncSetupBusy(true);
    setSyncSetupError("");
    setSyncActionMessage("");
    try {
      const payload = await syncSetupLink(req);
      startTransition(() => {
        setSyncRuntimeStatus(payload.status);
        setSyncActionMessage("同步库链接成功");
      });
      setSyncPendingLocalWrite(false);
    } catch (err) {
      setSyncSetupError(toErrorMessage(err));
    } finally {
      setSyncSetupBusy(false);
    }
  }

  async function handleSyncShareCodeRefresh() {
    const syncPassword = syncCreateForm.sync_password.trim();
    if (!syncPassword) {
      setSyncSetupError("请输入同步密码后再生成同步链接码");
      return;
    }
    setSyncSetupBusy(true);
    setSyncSetupError("");
    setSyncActionMessage("");
    try {
      const payload = await syncShareCodeGenerate({ sync_password: syncPassword });
      startTransition(() => {
        setSyncShareCode(payload.share_code || "");
        setSyncActionMessage("同步链接码已刷新");
      });
    } catch (err) {
      setSyncSetupError(toErrorMessage(err));
    } finally {
      setSyncSetupBusy(false);
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

  async function handleImportJobsQuery() {
    setImportJobsBusy(true);
    setImportJobsError("");
    try {
      const payload = await queryImportJobs({
        limit: 12,
      } satisfies QueryImportJobsRequest);
      startTransition(() => {
        setImportJobsResult(payload);
        setImportJobsLastRunAt(Date.now());
      });
    } catch (err) {
      setImportJobsError(toErrorMessage(err));
    } finally {
      setImportJobsBusy(false);
    }
  }

  async function handleAdminResetTransactions() {
    setAdminResetTxBusy(true);
    setAdminResetTxError("");
    try {
      const payload = await runLedgerDbAdminResetTransactions(buildAdminResetRequest(adminResetConfirmText));
      startTransition(() => {
        setAdminResetTxResult(payload);
      });
      void handleRefreshAdminDbStats();
      void handleImportJobsQuery();
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
      const payload = await runLedgerDbAdminResetAll(buildAdminResetRequest(adminResetConfirmText));
      startTransition(() => {
        setAdminResetAllResult(payload);
      });
      void handleRefreshAdminDbStats();
      void handleImportJobsQuery();
      void handleRunRuntimeHealthCheck();
      void handleTransactionsQuery();
      void handleConsumptionOverviewQuery();
      void handleInvestmentsListQuery();
      void handleAssetValuationsQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
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

  async function runDbImportSequence(): Promise<LedgerDbImportRepoRuntimeResult> {
    setDbBusy(true);
    setDbStatusError("");
    try {
      const result = await importLedgerDbFromPath(dbImportPath.trim());
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

  async function handleImportDbFromPath() {
    try {
      await runDbImportSequence();
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

  // 数据导入动作：导入按钮会串行执行预检与导入；完成后联动刷新相关业务面板。
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

  async function runYzxyPreviewRequest(sourcePath: string): Promise<YzxyPreviewPayload> {
    setYzxyPreviewBusy(true);
    setYzxyPreviewError("");
    try {
      const payload = await yzxyPreviewFile({ source_path: sourcePath });
      startTransition(() => {
        setYzxyPreviewResult(payload);
      });
      return payload;
    } catch (err) {
      setYzxyPreviewError(toErrorMessage(err));
      throw err;
    } finally {
      setYzxyPreviewBusy(false);
    }
  }

  async function runYzxyImportRequest(sourcePath: string): Promise<YzxyImportPayload> {
    setYzxyImportBusy(true);
    setYzxyImportError("");
    try {
      const payload = await yzxyImportFile({
        source_path: sourcePath,
        source_type: "yzxy_xlsx",
      });
      startTransition(() => {
        setYzxyImportResult(payload);
      });
      markLocalMutationForSync();
      void refreshDbStatus();
      void handleRefreshAdminDbStats();
      void handleImportJobsQuery();
      void handleRunRuntimeHealthCheck();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleInvestmentsListQuery();
      void handleInvestmentReturnsQuery();
      void handleInvestmentReturnQuery();
      void handleInvestmentCurveQuery();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
      return payload;
    } catch (err) {
      setYzxyImportError(toErrorMessage(err));
      throw err;
    } finally {
      setYzxyImportBusy(false);
    }
  }

  async function handleYzxyRunImportFlow() {
    const sourcePath = yzxyFilePath.trim();
    if (!sourcePath) {
      setYzxyPreviewError("请先选择有知有行导出文件（.csv / .xlsx）");
      return;
    }
    startTransition(() => {
      setYzxyPreviewError("");
      setYzxyImportError("");
      setYzxyPreviewResult(null);
      setYzxyImportResult(null);
    });
    try {
      await runYzxyPreviewRequest(sourcePath);
      await runYzxyImportRequest(sourcePath);
    } catch {
      // Step-level errors are already surfaced in the import panel.
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

  async function runCmbEmlPreviewRequest(sourcePath: string): Promise<CmbEmlPreviewPayload> {
    setEmlPreviewBusy(true);
    setEmlPreviewError("");
    try {
      const payload = await cmbEmlPreview({
        source_path: sourcePath,
        review_threshold: 0.7,
      });
      startTransition(() => {
        setEmlPreviewResult(payload);
      });
      return payload;
    } catch (err) {
      setEmlPreviewError(toErrorMessage(err));
      throw err;
    } finally {
      setEmlPreviewBusy(false);
    }
  }

  async function runCmbEmlImportRequest(sourcePath: string): Promise<CmbEmlImportPayload> {
    setEmlImportBusy(true);
    setEmlImportError("");
    try {
      const payload = await cmbEmlImport({
        source_path: sourcePath,
        source_type: "cmb_eml",
        review_threshold: 0.7,
      });
      startTransition(() => {
        setEmlImportResult(payload);
      });
      markLocalMutationForSync();
      void refreshDbStatus();
      void handleRefreshAdminDbStats();
      void handleImportJobsQuery();
      void handleRunRuntimeHealthCheck();
      void handleConsumptionOverviewQuery();
      void handleTransactionsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      return payload;
    } catch (err) {
      setEmlImportError(toErrorMessage(err));
      throw err;
    } finally {
      setEmlImportBusy(false);
    }
  }

  async function handleCmbEmlRunImportFlow() {
    const sourcePath = emlSourcePath.trim();
    if (!sourcePath) {
      setEmlPreviewError("请先选择 EML 文件或目录");
      return;
    }
    startTransition(() => {
      setEmlPreviewError("");
      setEmlImportError("");
      setEmlPreviewResult(null);
      setEmlImportResult(null);
    });
    try {
      await runCmbEmlPreviewRequest(sourcePath);
      await runCmbEmlImportRequest(sourcePath);
    } catch {
      // Step-level errors are already surfaced in the import panel.
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

  async function runCmbBankPdfPreviewRequest(sourcePath: string): Promise<CmbBankPdfPreviewPayload> {
    setCmbPdfPreviewBusy(true);
    setCmbPdfPreviewError("");
    try {
      const payload = await cmbBankPdfPreview({
        source_path: sourcePath,
        review_threshold: 0.7,
      });
      startTransition(() => {
        setCmbPdfPreviewResult(payload);
      });
      return payload;
    } catch (err) {
      setCmbPdfPreviewError(toErrorMessage(err));
      throw err;
    } finally {
      setCmbPdfPreviewBusy(false);
    }
  }

  async function runCmbBankPdfImportRequest(sourcePath: string): Promise<CmbBankPdfImportPayload> {
    setCmbPdfImportBusy(true);
    setCmbPdfImportError("");
    try {
      const payload = await cmbBankPdfImport({
        source_path: sourcePath,
        source_type: "cmb_bank_pdf",
        review_threshold: 0.7,
      });
      startTransition(() => {
        setCmbPdfImportResult(payload);
      });
      markLocalMutationForSync();
      void refreshDbStatus();
      void handleRefreshAdminDbStats();
      void handleImportJobsQuery();
      void handleRunRuntimeHealthCheck();
      void handleConsumptionOverviewQuery();
      void handleTransactionsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleSalaryIncomeOverviewQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      return payload;
    } catch (err) {
      setCmbPdfImportError(toErrorMessage(err));
      throw err;
    } finally {
      setCmbPdfImportBusy(false);
    }
  }

  async function handleCmbBankPdfRunImportFlow() {
    const sourcePath = cmbPdfPath.trim();
    if (!sourcePath) {
      setCmbPdfPreviewError("请先选择银行流水 PDF 文件");
      return;
    }
    startTransition(() => {
      setCmbPdfPreviewError("");
      setCmbPdfImportError("");
      setCmbPdfPreviewResult(null);
      setCmbPdfImportResult(null);
    });
    try {
      await runCmbBankPdfPreviewRequest(sourcePath);
      await runCmbBankPdfImportRequest(sourcePath);
    } catch {
      // Step-level errors are already surfaced in the import panel.
    }
  }

  // 跨面板共享的筛选条件：保证同一业务域（收益/财富）查询参数一致。
  function setInvestmentAnalysisSharedQuery(
    updater: (prev: typeof invCurveQuery) => typeof invCurveQuery,
  ) {
    setInvCurveQuery((prev) => {
      const next = updater(prev);
      setInvQuery({
        account_id: next.account_id,
        preset: next.preset,
        from: next.from,
        to: next.to,
      });
      return next;
    });
  }

  function setWealthSharedAssetFilters(
    updater: (prev: Pick<typeof wealthCurveQuery, "include_investment" | "include_cash" | "include_real_estate" | "include_liability">) => Pick<
      typeof wealthCurveQuery,
      "include_investment" | "include_cash" | "include_real_estate" | "include_liability"
    >,
  ) {
    setWealthCurveQuery((prev) => {
      const nextShared = updater({
        include_investment: prev.include_investment,
        include_cash: prev.include_cash,
        include_real_estate: prev.include_real_estate,
        include_liability: prev.include_liability,
      });
      setWealthOverviewQuery((prevOverview) => ({
        ...prevOverview,
        include_investment: nextShared.include_investment,
        include_cash: nextShared.include_cash,
        include_real_estate: nextShared.include_real_estate,
        include_liability: nextShared.include_liability,
      }));
      return { ...prev, ...nextShared };
    });
  }

  function toggleWealthAssetFilter(
    key: "include_investment" | "include_cash" | "include_real_estate" | "include_liability",
  ) {
    setWealthSharedAssetFilters((prev) => ({
      ...(() => {
        const nextValue = prev[key] === "true" ? "false" : "true";
        if (
          nextValue === "false" &&
          (key === "include_investment" || key === "include_cash" || key === "include_real_estate")
        ) {
          const otherPositiveStillOn = (
            [
              key === "include_investment" ? null : prev.include_investment,
              key === "include_cash" ? null : prev.include_cash,
              key === "include_real_estate" ? null : prev.include_real_estate,
            ].filter((v): v is BoolString => v !== null)
          ).some((v) => v === "true");
          if (!otherPositiveStillOn) return prev;
        }
        return {
          ...prev,
          [key]: nextValue,
        };
      })(),
    }));
  }

  function openBudgetItemCreateModal() {
    setBudgetItemUpsertError("");
    setBudgetItemForm({
      id: "",
      name: "",
      monthly_amount: "",
      sort_order: "1000",
      is_active: "true",
    });
    setBudgetItemCreateOpen(true);
  }

  function closeBudgetItemCreateModal() {
    if (budgetItemUpsertBusy) return;
    setBudgetItemCreateOpen(false);
  }

  // 预算/FIRE/收入/消费查询动作。
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
      const payload = await upsertMonthlyBudgetItem(buildBudgetItemUpsertMutationRequest(budgetItemForm));
      startTransition(() => {
        setBudgetItemUpsertResult(payload);
      });
      markLocalMutationForSync();
      setBudgetItemCreateOpen(false);
      setBudgetItemForm({
        id: "",
        name: "",
        monthly_amount: "",
        sort_order: "1000",
        is_active: "true",
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

  async function handleDeleteMonthlyBudgetItem(id: string) {
    setBudgetItemDeleteBusy(true);
    setBudgetItemDeletingRowId(id);
    setBudgetItemDeleteError("");
    try {
      const payload = await deleteMonthlyBudgetItem({ id } satisfies MonthlyBudgetItemDeleteRequest);
      startTransition(() => {
        setBudgetItemDeleteResult(payload);
      });
      markLocalMutationForSync();
      void handleMonthlyBudgetItemsQuery();
      void handleBudgetOverviewQuery();
      void handleBudgetMonthlyReviewQuery();
      void handleFireProgressQuery();
    } catch (err) {
      setBudgetItemDeleteError(toErrorMessage(err));
    } finally {
      setBudgetItemDeleteBusy(false);
      setBudgetItemDeletingRowId("");
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
      const payload = await queryFireProgress(buildFireProgressQueryRequest(fireProgressQuery));
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
    try {
      await consumptionOverview.run({ year: consumptionYear || undefined });
    } catch {
      // Error state is set by useAsyncQuery.
    }
  }

  // 账户目录维护：既服务管理页，也服务“更新收益”等下拉选项。
  async function handleRefreshAccountSelectCatalog() {
    setAccountSelectCatalogBusy(true);
    try {
      const payload = await queryAccountCatalog({
        kind: "all",
        keyword: "",
        limit: 2000,
      });
      startTransition(() => {
        setAccountSelectCatalogResult(payload);
      });
    } catch {
      // Keep existing options if refresh fails; query cards already surface detailed errors.
    } finally {
      setAccountSelectCatalogBusy(false);
    }
  }

  async function handleAccountCatalogQuery() {
    setAcctCatalogBusy(true);
    setAcctCatalogError("");
    try {
      const payload = await queryAccountCatalog(buildAccountCatalogQueryRequest(acctCatalogQuery));
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
      const payload = await upsertAccountCatalogEntry(buildAccountCatalogUpsertRequest(acctCatalogUpsertForm));
      startTransition(() => {
        setAcctCatalogUpsertResult(payload);
        setAcctCatalogCreateOpen(false);
        resetAccountCatalogCreateForm();
      });
      markLocalMutationForSync();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleMetaAccountsQuery();
    } catch (err) {
      setAcctCatalogUpsertError(toErrorMessage(err));
    } finally {
      setAcctCatalogUpsertBusy(false);
    }
  }

  async function handleAccountCatalogDelete(accountIdOverride?: string) {
    const accountId = `${accountIdOverride ?? ""}`.trim();
    if (!accountId) return;
    setAcctCatalogDeleteBusy(true);
    setAcctCatalogDeleteError("");
    setAcctCatalogDeletingRowId(accountId);
    try {
      const payload = await deleteAccountCatalogEntry({
        account_id: accountId,
      });
      startTransition(() => {
        setAcctCatalogDeleteResult(payload);
      });
      markLocalMutationForSync();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleMetaAccountsQuery();
    } catch (err) {
      setAcctCatalogDeleteError(toErrorMessage(err));
    } finally {
      setAcctCatalogDeleteBusy(false);
      setAcctCatalogDeletingRowId("");
    }
  }

  function normalizeAccountCatalogKind(raw: unknown): UpsertAccountCatalogEntryRequest["account_kind"] {
    switch (raw) {
      case "investment":
      case "cash":
      case "real_estate":
      case "bank":
      case "credit_card":
      case "wallet":
      case "liability":
      case "other":
        return raw;
      default:
        return "other";
    }
  }

  function resetAccountCatalogCreateForm() {
    setAcctCatalogModalMode("create");
    setAcctCatalogUpsertForm({
      account_id: "",
      account_name: "",
      account_kind: "cash",
    });
  }

  function openAccountCatalogCreateModal() {
    setAcctCatalogUpsertError("");
    resetAccountCatalogCreateForm();
    setAcctCatalogCreateOpen(true);
  }

  function openAccountCatalogRenameModal(accountId: string, accountName: string, accountKind: string) {
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) return;
    setAcctCatalogUpsertError("");
    setAcctCatalogModalMode("rename");
    setAcctCatalogUpsertForm({
      account_id: normalizedAccountId,
      account_name: accountName,
      account_kind: normalizeAccountCatalogKind(accountKind),
    });
    setAcctCatalogCreateOpen(true);
  }

  function closeAccountCatalogCreateModal() {
    if (acctCatalogUpsertBusy) return;
    setAcctCatalogCreateOpen(false);
    setAcctCatalogUpsertError("");
    resetAccountCatalogCreateForm();
  }

  function resetQuickManualInvestmentForm(nextAccountId = "") {
    setQuickManualInvForm({
      snapshot_date: getTodayDateInputValueLocal(),
      account_id: nextAccountId,
      account_name: "",
      total_assets: "",
      transfer_amount: "0",
    });
  }

  function openQuickManualInvestmentModal() {
    setQuickManualInvError("");
    setQuickManualInvAccountAssetsError("");
    setQuickManualInvAccountAssetsCents(null);
    setQuickManualInvAccountAssetsDate("");
    resetQuickManualInvestmentForm(quickManualInvLastAccountId);
    void handleRefreshAccountSelectCatalog();
    setQuickManualInvOpen(true);
  }

  function closeQuickManualInvestmentModal() {
    if (quickManualInvBusy) return;
    if (typeof document !== "undefined") {
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement) activeEl.blur();
    }
    setQuickManualInvOpen(false);
    setQuickManualInvError("");
    setQuickManualInvAccountAssetsError("");
    setQuickManualInvAccountAssetsCents(null);
    setQuickManualInvAccountAssetsDate("");
  }

  function resetQuickManualAssetForm(
    nextAssetClass: "cash" | "real_estate" | "liability" = "cash",
    nextAccountId = "",
  ) {
    setQuickManualAssetForm({
      asset_class: nextAssetClass,
      snapshot_date: getTodayDateInputValueLocal(),
      account_id: nextAccountId,
      account_name: "",
      value: "",
    });
  }

  function openQuickManualAssetValuationModal() {
    const nextAssetClass = normalizeQuickManualAssetClass(quickManualAssetLastAssetClass);
    setQuickManualAssetError("");
    setQuickManualAssetAccountValueError("");
    setQuickManualAssetAccountValueCents(null);
    setQuickManualAssetAccountValueDate("");
    resetQuickManualAssetForm(nextAssetClass, quickManualAssetLastAccountId);
    void handleRefreshAccountSelectCatalog();
    setQuickManualAssetOpen(true);
  }

  function closeQuickManualAssetValuationModal() {
    if (quickManualAssetBusy) return;
    if (typeof document !== "undefined") {
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement) activeEl.blur();
    }
    setQuickManualAssetOpen(false);
    setQuickManualAssetError("");
    setQuickManualAssetAccountValueError("");
    setQuickManualAssetAccountValueCents(null);
    setQuickManualAssetAccountValueDate("");
  }

  function handleQuickManualAssetClassChange(nextValue: string) {
    const nextAssetClass = normalizeQuickManualAssetClass(nextValue);
    setQuickManualAssetForm((prev) => {
      const currentAccountId = `${prev.account_id ?? ""}`.trim();
      const currentAccountKind = accountSelectOptions.find((opt) => opt.account_id === currentAccountId)?.account_kind;
      const keepAccount = accountKindMatchesAssetClass(nextAssetClass, currentAccountKind);
      return {
        ...prev,
        asset_class: nextAssetClass,
        account_id: keepAccount ? currentAccountId : "",
      };
    });
  }

  function closeInvestmentEditModal() {
    if (updateInvBusy) return;
    setInvEditModalOpen(false);
    setUpdateInvError("");
  }

  // 手动录入与编辑：写入后触发收益/财富/预算等多面板联动刷新。
  async function handleQuickManualAccountAssetsQuery() {
    const accountId = `${quickManualInvForm.account_id ?? ""}`.trim();
    if (!quickManualInvOpen || !accountId) {
      setQuickManualInvAccountAssetsBusy(false);
      setQuickManualInvAccountAssetsError("");
      setQuickManualInvAccountAssetsCents(null);
      setQuickManualInvAccountAssetsDate("");
      return;
    }
    setQuickManualInvAccountAssetsBusy(true);
    setQuickManualInvAccountAssetsError("");
    try {
      const payload = await queryInvestments({
        limit: 1,
        account_id: accountId,
      });
      const rows = readArray(payload, "rows").filter(isRecord);
      const latestAssetsCents = readNumber(payload, "summary.latest_total_assets_cents");
      const latestSnapshotDate = readString(payload, "rows.0.snapshot_date") ?? "";
      const hasSnapshot = rows.length > 0;
      startTransition(() => {
        setQuickManualInvAccountAssetsCents(hasSnapshot ? (latestAssetsCents ?? 0) : null);
        setQuickManualInvAccountAssetsDate(hasSnapshot ? latestSnapshotDate : "");
      });
    } catch (err) {
      setQuickManualInvAccountAssetsError(toErrorMessage(err));
      setQuickManualInvAccountAssetsCents(null);
      setQuickManualInvAccountAssetsDate("");
    } finally {
      setQuickManualInvAccountAssetsBusy(false);
    }
  }

  async function handleQuickManualInvestmentSubmit() {
    setQuickManualInvBusy(true);
    setQuickManualInvError("");
    try {
      await upsertManualInvestment(compactStringFields(quickManualInvForm));
      const accountId = `${quickManualInvForm.account_id ?? ""}`.trim();
      if (accountId) setQuickManualInvLastAccountId(accountId);
      markLocalMutationForSync();
      void handleInvestmentsListQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleInvestmentReturnQuery();
      void handleInvestmentCurveQuery();
      void handleInvestmentReturnsQuery();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
      void handleFireProgressQuery();
      void handleRefreshManualEntryTabMonthCount();
      if (typeof document !== "undefined") {
        const activeEl = document.activeElement;
        if (activeEl instanceof HTMLElement) activeEl.blur();
      }
      setQuickManualInvOpen(false);
    } catch (err) {
      setQuickManualInvError(toErrorMessage(err));
    } finally {
      setQuickManualInvBusy(false);
    }
  }

  async function handleQuickManualAssetAccountValueQuery() {
    const accountId = `${quickManualAssetForm.account_id ?? ""}`.trim();
    const assetClass = normalizeQuickManualAssetClass(quickManualAssetForm.asset_class);
    if (!quickManualAssetOpen || !accountId) {
      setQuickManualAssetAccountValueBusy(false);
      setQuickManualAssetAccountValueError("");
      setQuickManualAssetAccountValueCents(null);
      setQuickManualAssetAccountValueDate("");
      return;
    }
    setQuickManualAssetAccountValueBusy(true);
    setQuickManualAssetAccountValueError("");
    try {
      const payload = await queryAssetValuations({
        limit: 1,
        account_id: accountId,
        asset_class: assetClass,
      });
      const rows = readArray(payload, "rows").filter(isRecord);
      const latestValueCents = readNumber(payload, "rows.0.value_cents");
      const latestSnapshotDate = readString(payload, "rows.0.snapshot_date") ?? "";
      const hasSnapshot = rows.length > 0;
      startTransition(() => {
        setQuickManualAssetAccountValueCents(hasSnapshot ? (latestValueCents ?? 0) : null);
        setQuickManualAssetAccountValueDate(hasSnapshot ? latestSnapshotDate : "");
      });
    } catch (err) {
      setQuickManualAssetAccountValueError(toErrorMessage(err));
      setQuickManualAssetAccountValueCents(null);
      setQuickManualAssetAccountValueDate("");
    } finally {
      setQuickManualAssetAccountValueBusy(false);
    }
  }

  async function handleQuickManualAssetValuationSubmit() {
    setQuickManualAssetBusy(true);
    setQuickManualAssetError("");
    try {
      await upsertManualAssetValuation(compactStringFields(quickManualAssetForm));
      const accountId = `${quickManualAssetForm.account_id ?? ""}`.trim();
      const assetClass = normalizeQuickManualAssetClass(quickManualAssetForm.asset_class);
      if (accountId) setQuickManualAssetLastAccountId(accountId);
      setQuickManualAssetLastAssetClass(assetClass);
      markLocalMutationForSync();
      void handleAssetValuationsQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
      void handleFireProgressQuery();
      void handleRefreshManualAssetEntryLastDate();
      if (typeof document !== "undefined") {
        const activeEl = document.activeElement;
        if (activeEl instanceof HTMLElement) activeEl.blur();
      }
      setQuickManualAssetOpen(false);
    } catch (err) {
      setQuickManualAssetError(toErrorMessage(err));
    } finally {
      setQuickManualAssetBusy(false);
    }
  }

  async function handleUpdateInvestmentRecordMutation() {
    setUpdateInvBusy(true);
    setUpdateInvError("");
    try {
      await updateInvestmentRecord(compactStringFields(updateInvForm));
      markLocalMutationForSync();
      setInvEditModalOpen(false);
      void handleInvestmentsListQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleInvestmentReturnQuery();
      void handleInvestmentCurveQuery();
      void handleInvestmentReturnsQuery();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
      void handleFireProgressQuery();
      void handleRefreshManualEntryTabMonthCount();
    } catch (err) {
      setUpdateInvError(toErrorMessage(err));
    } finally {
      setUpdateInvBusy(false);
    }
  }

  function prefillInvestmentUpdateFormFromRow(row: Record<string, unknown>) {
    const id = typeof row.id === "string" ? row.id : "";
    const snapshotDate = typeof row.snapshot_date === "string" ? row.snapshot_date : "";
    const accountId = typeof row.account_id === "string" ? row.account_id : "";
    const accountName = typeof row.account_name === "string" ? row.account_name : "";
    const totalAssetsCents = typeof row.total_assets_cents === "number" ? row.total_assets_cents : undefined;
    const transferAmountCents = typeof row.transfer_amount_cents === "number" ? row.transfer_amount_cents : undefined;
    setUpdateInvError("");
    setUpdateInvForm({
      id,
      snapshot_date: snapshotDate,
      account_id: accountId,
      account_name: accountName,
      total_assets: formatCentsInputValue(totalAssetsCents),
      transfer_amount: formatCentsInputValue(transferAmountCents ?? 0),
    });
    setInvEditModalOpen(true);
  }

  async function handleDeleteInvestmentRecordById(id: string) {
    const targetId = id.trim();
    if (!targetId) return;
    setDeleteInvId(targetId);
    setDeleteInvBusy(true);
    try {
      await deleteInvestmentRecord({ id: targetId } satisfies DeleteByIdRequest);
      markLocalMutationForSync();
      void handleInvestmentsListQuery();
      void handleMetaAccountsQuery();
      void handleAccountCatalogQuery();
      void handleRefreshAccountSelectCatalog();
      void handleInvestmentReturnQuery();
      void handleInvestmentCurveQuery();
      void handleInvestmentReturnsQuery();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
      void handleFireProgressQuery();
      void handleRefreshManualEntryTabMonthCount();
    } catch {
      // The table-level auto-refresh flow treats delete failures as non-blocking.
    } finally {
      setDeleteInvBusy(false);
    }
  }

  async function handleRefreshManualEntryTabMonthCount() {
    setManualEntryTabMonthCountBusy(true);
    try {
      const range = getCurrentMonthDateRangeLocal();
      const payload = await queryInvestments({
        limit: 500,
        from: range.from,
        to: range.to,
        source_type: "manual",
        account_id: "",
      } satisfies QueryInvestmentsRequest);
      const rows = readArray(payload, "rows").filter(isRecord);
      const count = readNumber(payload, "summary.count");
      startTransition(() => {
        setManualEntryTabMonthCount(typeof count === "number" && Number.isFinite(count) ? count : rows.length);
      });
    } catch {
      // Keep this quick metric best-effort only.
    } finally {
      setManualEntryTabMonthCountBusy(false);
    }
  }

  async function handleRefreshManualAssetEntryLastDate() {
    setManualAssetEntryLastDateBusy(true);
    try {
      const payload = await queryAssetValuations({
        limit: 1,
      } satisfies QueryAssetValuationsRequest);
      const rows = readArray(payload, "rows").filter(isRecord);
      const latestDate = rows.length > 0
        ? (typeof rows[0]?.snapshot_date === "string" ? rows[0].snapshot_date : "")
        : "";
      startTransition(() => {
        setManualAssetEntryLastDate(latestDate);
      });
    } catch {
      // Keep this quick metric best-effort only.
    } finally {
      setManualAssetEntryLastDateBusy(false);
    }
  }

  useEffect(() => {
    startTransition(() => {
      setYzxyPreviewError("");
      setYzxyImportError("");
      setYzxyPreviewResult(null);
      setYzxyImportResult(null);
    });
  }, [yzxyFilePath]);

  useEffect(() => {
    startTransition(() => {
      setEmlPreviewError("");
      setEmlImportError("");
      setEmlPreviewResult(null);
      setEmlImportResult(null);
    });
  }, [emlSourcePath]);

  useEffect(() => {
    startTransition(() => {
      setCmbPdfPreviewError("");
      setCmbPdfImportError("");
      setCmbPdfPreviewResult(null);
      setCmbPdfImportResult(null);
    });
  }, [cmbPdfPath]);

  // 核心分析 smoke：串行验证四个核心接口并回填各自结果，供 pipeline 复用。
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
        () => queryInvestmentReturn(buildInvestmentReturnRequest(invQuery)),
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
        () => queryInvestmentCurve(buildInvestmentCurveRequest(invCurveQuery)),
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
        () => queryWealthOverview(buildWealthOverviewRequest(wealthOverviewQuery, wealthCurveQuery)),
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
        () => queryWealthCurve(buildWealthCurveRequest(wealthCurveQuery)),
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
      if (!dbImportPath.trim()) {
        startTransition(() => {
          setPipelineStatus("fail");
          setPipelineLastRunAt(Date.now());
          setPipelineMessage("请先选择要导入的 keepwise.db 文件");
        });
        return;
      }
      const importResult = await runDbImportSequence();
      const rows = await runCoreAnalyticsSmokeSequence();
      void handleRunRuntimeHealthCheck();
      const allPassed = rows.every((row) => row.status === "pass");
      startTransition(() => {
        setPipelineStatus(allPassed ? "pass" : "fail");
        setPipelineLastRunAt(Date.now());
        setPipelineMessage(
          `导入成功 from selected path | copied=${importResult.copied_bytes} bytes | smoke ${allPassed ? "PASS" : "FAIL"}`,
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

  // 业务查询动作：收益/财富/工作台各模块的主查询入口。
  async function handleInvestmentReturnQuery() {
    const req = buildInvestmentReturnRequest(invQuery);
    const queryKey = JSON.stringify(req);
    setInvBusy(true);
    setInvError("");
    try {
      const [payload, quickMetricPayload] = await Promise.all([
        queryInvestmentReturn(req),
        queryInvestmentReturn(buildReturnTabQuickMetricRequest(invQuery)),
      ]);
      const ytdAnnualizedRate = readNumber(quickMetricPayload, "metrics.annualized_rate");
      const ytdNetGrowthCents = readNumber(quickMetricPayload, "metrics.net_growth_cents");
      startTransition(() => {
        setInvResult(payload);
        setInvLastQueryKey(queryKey);
        setReturnTabYtdAnnualizedRate(ytdAnnualizedRate ?? null);
        setReturnTabYtdNetGrowthCents(ytdNetGrowthCents ?? null);
      });
    } catch (err) {
      const message = toErrorMessage(err);
      setInvError(message);
    } finally {
      setInvBusy(false);
    }
  }

  async function handleInvestmentReturnsQuery() {
    const req = buildInvestmentReturnsRequest(invCurveQuery);
    const queryKey = JSON.stringify(req);
    setInvBatchBusy(true);
    setInvBatchError("");
    try {
      const payload = await queryInvestmentReturns(req);
      startTransition(() => {
        setInvBatchResult(payload);
        setInvBatchLastQueryKey(queryKey);
      });
    } catch (err) {
      setInvBatchError(toErrorMessage(err));
    } finally {
      setInvBatchBusy(false);
    }
  }

  async function handleInvestmentCurveQuery() {
    const req = buildInvestmentCurveRequest(invCurveQuery);
    const queryKey = JSON.stringify(req);
    const requestSeq = invCurveRequestSeqRef.current + 1;
    invCurveRequestSeqRef.current = requestSeq;
    invCurveRequestRef.current = req;
    setInvCurveBusy(true);
    setInvCurveError("");
    try {
      const payload = await queryInvestmentCurve(req);
      if (requestSeq !== invCurveRequestSeqRef.current) return;
      startTransition(() => {
        setInvCurveResult(payload);
        setInvCurveLastQueryKey(queryKey);
      });
      scheduleInvestmentCurveBenchmarksHydration(req, requestSeq);
    } catch (err) {
      if (requestSeq !== invCurveRequestSeqRef.current) return;
      const message = toErrorMessage(err);
      setInvCurveError(message);
    } finally {
      if (requestSeq === invCurveRequestSeqRef.current) {
        setInvCurveBusy(false);
      }
    }
  }

  function scheduleInvestmentCurveBenchmarksHydration(
    req: InvestmentCurveQueryRequest,
    requestSeq: number,
  ) {
    const run = () => {
      void hydrateInvestmentCurveBenchmarks(req, requestSeq);
    };
    if (typeof window === "undefined") {
      setTimeout(run, 0);
      return;
    }
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.setTimeout(run, 0);
      });
      return;
    }
    window.setTimeout(run, 0);
  }

  async function hydrateInvestmentCurveBenchmarks(req: InvestmentCurveQueryRequest, requestSeq: number) {
    if (requestSeq !== invCurveRequestSeqRef.current) return;
    setInvCurveBenchmarksBusy(true);
    try {
      const benchmarksPayload = await queryInvestmentCurveBenchmarks({
        ...req,
        benchmark_source: appSettings.benchmarkMarketDataSource,
      });
      if (requestSeq !== invCurveRequestSeqRef.current) return;
      startTransition(() => {
        setInvCurveResult((prev: InvestmentCurvePayload | null) => {
          if (!isRecord(prev)) return prev;
          return {
            ...prev,
            benchmarks: benchmarksPayload,
          };
        });
      });
    } catch (err) {
      if (requestSeq !== invCurveRequestSeqRef.current) return;
      void err;
      const warningMessage = "拉取对比指标失败";
      startTransition(() => {
        setInvCurveResult((prev: InvestmentCurvePayload | null) => {
          if (!isRecord(prev)) return prev;
          return {
            ...prev,
            benchmarks: {
              source: "",
              summary: {
                requested_count: 0,
                available_count: 0,
                warning_count: 1,
              },
              curves: [],
              warnings: [warningMessage],
              load_failed: true,
            },
          };
        });
      });
    } finally {
      if (requestSeq === invCurveRequestSeqRef.current) {
        setInvCurveBenchmarksBusy(false);
      }
    }
  }

  async function handleRetryInvestmentCurveBenchmarks() {
    const req = invCurveRequestRef.current ?? buildInvestmentCurveRequest(invCurveQuery);
    invCurveRequestRef.current = req;
    await hydrateInvestmentCurveBenchmarks(req, invCurveRequestSeqRef.current);
  }

  async function handleWealthOverviewQuery() {
    setWealthOverviewBusy(true);
    setWealthOverviewError("");
    try {
      const payload = await queryWealthOverview(buildWealthOverviewRequest(wealthOverviewQuery, wealthCurveQuery));
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
      const payload = await queryWealthCurve(buildWealthCurveRequest(wealthCurveQuery));
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
      const payload = await queryMetaAccounts(buildMetaAccountsRequest(metaAccountsQuery));
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
      const payload = await queryTransactions(buildTransactionsQueryRequest(txListQuery));
      startTransition(() => {
        setTxListResult(payload);
      });
    } catch (err) {
      setTxListError(toErrorMessage(err));
    } finally {
      setTxListBusy(false);
    }
  }

  async function handleInvestmentsListQuery() {
    setInvListBusy(true);
    setInvListError("");
    try {
      const payload = await queryInvestments(buildInvestmentsListQueryRequest(invListQuery));
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
      const payload = await queryAssetValuations(buildAssetValuationsQueryRequest(assetListQuery));
      startTransition(() => {
        setAssetListResult(payload);
      });
    } catch (err) {
      setAssetListError(toErrorMessage(err));
    } finally {
      setAssetListBusy(false);
    }
  }

  // 首次挂载时只做一次探针 + DB 状态初始化。
  useEffect(() => {
    void Promise.all([refreshProbe(), refreshDbStatus(), refreshSyncRuntimeStatus()]);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!syncRuntimeStatus?.configured) return;
    let canceled = false;
    const pollOnce = async () => {
      if (canceled || syncReconcileBusyRef.current || syncQuickBusy) return;
      try {
        const poll = await syncPollRemoteUpdate();
        startTransition(() => {
          setSyncRuntimeStatus(poll.status);
        });
        if (!poll.configured || !poll.has_remote_update) return;
        const result = await triggerAutoSyncReconcile("remote_poll");
        if (result?.ok) {
          refreshDataViewsAfterManualSync();
        }
      } catch {
        // Keep remote polling best-effort.
      }
    };
    const timer = window.setInterval(() => {
      void pollOnce();
    }, SYNC_REMOTE_POLL_INTERVAL_MS);
    void pollOnce();
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [syncRuntimeStatus?.configured, syncQuickBusy]);

  // 壳层 UI 状态：TAB、侧边栏、设置、隐私开关、开发者模式。
  const isForcedMobilePreview = import.meta.env.VITE_FORCE_MOBILE === "1";
  const isNativeMobileUA = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isLandscapeViewport = viewportSize.width > 0 && viewportSize.width > viewportSize.height;
  const forceDesktopLayout = !isForcedMobilePreview && isNativeMobileUA && isLandscapeViewport;
  const isMobileMode = isForcedMobilePreview || (isNativeMobileUA && !forceDesktopLayout);
  const isDesktopApp =
    probe != null ? probe.metadata.target_os !== "android" && probe.metadata.target_os !== "ios" : !isNativeMobileUA;
  const [activeTab, setActiveTab] = useState<ProductTabKey>("wealth-overview");
  const [mobileView, setMobileView] = useState<MobileView>("home");
  const mobileSceneViewRef = useRef<MobileView>("home");
  const mobileBackTrapArmedRef = useRef(false);
  const [mobileSceneDirection, setMobileSceneDirection] = useState<"from-left" | "from-right">("from-right");
  const [mobileSceneSeq, setMobileSceneSeq] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    if (typeof window === "undefined") {
      return {
        gainLossColorScheme: "cn_red_up_green_down",
        defaultPrivacyMaskOnLaunch: false,
        uiMotionEnabled: true,
        fireWithdrawalRate: "0.03",
        consumptionExcludeNeedsReviewByDefault: true,
        benchmarkMarketDataSource: "eastmoney",
        aiApiEndpoint: "https://api.openai.com/v1",
        aiApiKey: "",
        aiModel: "gpt-4.1-mini",
        aiLocalCliEnabled: false,
      };
    }
    return parseStoredAppSettings(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY));
  });
  const benchmarkMarketDataSourceRef = useRef(appSettings.benchmarkMarketDataSource);
  const fireProgressQuery: FireProgressQueryRequest = {
    withdrawal_rate: appSettings.fireWithdrawalRate,
  };
  const [amountPrivacyMasked, setAmountPrivacyMasked] = useState(() => appSettings.defaultPrivacyMaskOnLaunch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  configureAmountFormatting({
    amountPrivacyMasked,
    gainLossColorScheme: appSettings.gainLossColorScheme,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewportSize = () => {
      const nextWidth = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const nextHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
      setViewportSize((prev) => (
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      ));
    };
    syncViewportSize();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", syncViewportSize);
    window.addEventListener("orientationchange", syncViewportSize);
    visualViewport?.addEventListener("resize", syncViewportSize);
    return () => {
      window.removeEventListener("resize", syncViewportSize);
      window.removeEventListener("orientationchange", syncViewportSize);
      visualViewport?.removeEventListener("resize", syncViewportSize);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
    } catch {
      // Ignore persistence errors (private mode / quota / disabled storage).
    }
  }, [appSettings]);

  useEffect(() => {
    try {
      if (quickManualInvLastAccountId.trim()) {
        window.localStorage.setItem(QUICK_MANUAL_INV_LAST_ACCOUNT_ID_STORAGE_KEY, quickManualInvLastAccountId.trim());
      } else {
        window.localStorage.removeItem(QUICK_MANUAL_INV_LAST_ACCOUNT_ID_STORAGE_KEY);
      }
    } catch {
      // Ignore localStorage persistence errors.
    }
  }, [quickManualInvLastAccountId]);

  useEffect(() => {
    try {
      if (quickManualAssetLastAccountId.trim()) {
        window.localStorage.setItem(QUICK_MANUAL_ASSET_LAST_ACCOUNT_ID_STORAGE_KEY, quickManualAssetLastAccountId.trim());
      } else {
        window.localStorage.removeItem(QUICK_MANUAL_ASSET_LAST_ACCOUNT_ID_STORAGE_KEY);
      }
      window.localStorage.setItem(QUICK_MANUAL_ASSET_LAST_ASSET_CLASS_STORAGE_KEY, quickManualAssetLastAssetClass);
    } catch {
      // Ignore localStorage persistence errors.
    }
  }, [quickManualAssetLastAccountId, quickManualAssetLastAssetClass]);

  useEffect(() => {
    if (!isMobileMode) return;
    setMobileView("home");
  }, [isMobileMode]);

  function handleMobileBackNavigation() {
    if (quickManualAssetOpen) {
      if (!quickManualAssetBusy) closeQuickManualAssetValuationModal();
      return true;
    }
    if (quickManualInvOpen) {
      if (!quickManualInvBusy) closeQuickManualInvestmentModal();
      return true;
    }
    if (invEditModalOpen) {
      if (!updateInvBusy) closeInvestmentEditModal();
      return true;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (mobileView !== "home") {
      setMobileView("home");
      return true;
    }
    return false;
  }

  // 统一接管移动端系统返回（含 Android 边缘返回手势）：先关模态，再从子页回首页。
  useEffect(() => {
    if (!isMobileMode || typeof window === "undefined") {
      mobileBackTrapArmedRef.current = false;
      return;
    }
    if (!mobileBackTrapArmedRef.current) {
      try {
        window.history.pushState({ keepwise_mobile_back_trap: true }, "");
        mobileBackTrapArmedRef.current = true;
      } catch {
        // Ignore history API failures.
      }
    }
    const onPopState = () => {
      const handled = handleMobileBackNavigation();
      if (handled) {
        try {
          window.history.pushState({ keepwise_mobile_back_trap: true }, "");
          mobileBackTrapArmedRef.current = true;
        } catch {
          // Ignore history API failures.
        }
      } else {
        mobileBackTrapArmedRef.current = false;
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [
    isMobileMode,
    mobileView,
    quickManualAssetOpen,
    quickManualAssetBusy,
    quickManualInvOpen,
    quickManualInvBusy,
    invEditModalOpen,
    updateInvBusy,
    settingsOpen,
  ]);

  useLayoutEffect(() => {
    if (!isMobileMode) {
      mobileSceneViewRef.current = "home";
      return;
    }
    const prevView = mobileSceneViewRef.current;
    if (prevView === mobileView) return;
    setMobileSceneDirection(mobileView === "home" ? "from-left" : "from-right");
    setMobileSceneSeq((v) => v + 1);
    mobileSceneViewRef.current = mobileView;
  }, [isMobileMode, mobileView]);

  const visibleTabs = getVisibleTabsForMode(PRODUCT_TABS, isMobileMode);
  const mobileSceneAnimClass = mobileSceneSeq > 0
    ? (mobileSceneDirection === "from-left" ? "mobile-scene-enter-from-left" : "mobile-scene-enter-from-right")
    : "";

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    setActiveTab("wealth-overview");
    if (isMobileMode) setMobileView("home");
  }, [activeTab, visibleTabs, isMobileMode]);

  // 视图模型：将原始查询结果规整为侧边栏指标、提示文案和面板开关。
  const isReady = status === "ready";
  const syncQuickState =
    (syncQuickBusy || !!syncRuntimeStatus?.syncing)
      ? "syncing"
      : (!syncRuntimeStatus?.configured || syncPendingLocalWrite ? "pending" : "synced");
  const syncQuickTitle =
    syncQuickState === "syncing"
      ? "同步中..."
      : syncQuickState === "pending"
        ? (syncRuntimeStatus?.configured ? "有本地更新待同步，点击立即同步" : "未配置云同步，点击前往设置")
        : "已同步";
  const syncQuickAriaLabel =
    syncQuickState === "syncing" ? "同步中" : syncQuickState === "pending" ? "待同步" : "已同步";
  const activeTabMeta = visibleTabs.find((tab) => tab.key === activeTab) ?? visibleTabs[0] ?? PRODUCT_TABS[0];
  const isTab = (...keys: ProductTabKey[]) => keys.includes(activeTab);
  const isAdminTab = isTab("admin");
  const isAdminDeveloperMode = isAdminTab && developerMode;
  const isAdminVisibleWorkbench = isAdminTab;
  const isManualEntryTab = isTab("manual-entry");
  const isReturnAnalysisTab = isTab("return-analysis");
  const isWealthOverviewTab = isTab("wealth-overview");
  const isBudgetFireTab = isTab("budget-fire");
  const isIncomeAnalysisTab = isTab("income-analysis");
  const isConsumptionAnalysisTab = isTab("consumption-analysis");
  const shouldAutoLoadAccountSelectCatalog =
    isAdminTab || isManualEntryTab || isReturnAnalysisTab || isConsumptionAnalysisTab;
  const accountSelectOptions = buildAccountSelectOptionsFromCatalog(accountSelectCatalogResult);

  useEffect(() => {
    const prevSource = benchmarkMarketDataSourceRef.current;
    benchmarkMarketDataSourceRef.current = appSettings.benchmarkMarketDataSource;
    if (prevSource === appSettings.benchmarkMarketDataSource) return;
    if (!isReturnAnalysisTab || !invCurveResult || invCurveBusy || invCurveBenchmarksBusy) return;
    void handleRetryInvestmentCurveBenchmarks();
  }, [appSettings.benchmarkMarketDataSource, isReturnAnalysisTab, invCurveResult, invCurveBusy, invCurveBenchmarksBusy]);
  const accountSelectOptionsLoading = accountSelectCatalogBusy && accountSelectOptions.length === 0;
  const returnTabAnnualizedRate = returnTabYtdAnnualizedRate ?? undefined;
  const returnTabQuickMetricLabel = `${new Date().getFullYear()}年预估`;
  const returnTabAnnualizedText = formatRatePct(returnTabAnnualizedRate);
  const returnTabAnnualizedTone = signedMetricTone(returnTabAnnualizedRate);
  const returnTabNetGrowthText = formatSignedDeltaCentsShort(returnTabYtdNetGrowthCents ?? undefined);
  const returnTabNetGrowthTone = signedMetricTone(returnTabYtdNetGrowthCents ?? undefined);
  const wealthTabMonthlyGrowth = computeMonthlyTotalAssetGrowthFromWealthCurve(wealthCurveResult);
  const wealthTabMonthlyGrowthText = formatSignedDeltaCentsShort(wealthTabMonthlyGrowth?.deltaCents);
  const wealthTabMonthlyGrowthTone = signedMetricTone(wealthTabMonthlyGrowth?.deltaCents);
  const wealthTabMonthlyGrowthLabel = wealthTabMonthlyGrowth?.baselineDate
    ? `相比${formatMonthDayLabel(wealthTabMonthlyGrowth.baselineDate)}`
    : "月度增长";
  const wealthTabNetAssetText = formatCentsShort(readNumber(wealthOverviewResult, "summary.net_asset_total_cents") ?? undefined);
  const wealthTabNetAssetTone: "default" = "default";
  const fireTabFreedomText = readString(fireProgressResult, "metrics.freedom_ratio_pct_text")
    ?? readString(fireProgressResult, "freedom_ratio_pct_text")
    ?? "-";
  const fireTabFreedomTone: "default" = "default";
  const fireTabInvestableText = formatCentsShort(readNumber(fireProgressResult, "investable_assets.total_cents") ?? undefined);
  const fireTabInvestableTone: "default" = "default";
  const manualEntryTabMonthCountText = manualEntryTabMonthCountBusy && manualEntryTabMonthCount === null
    ? "..."
    : `${manualEntryTabMonthCount ?? 0}笔`;
  const manualAssetEntryLastDateText = manualAssetEntryLastDateBusy && !manualAssetEntryLastDate
    ? "..."
    : (manualAssetEntryLastDate || "未更新");
  const manualAssetEntryLastDateLabel = "最后更新";
  const incomeMonthRows = readArray(salaryIncomeResult, "rows").filter(isRecord);
  const latestIncomeMonthWithData = incomeMonthRows.reduce<{ monthKey: string; totalIncomeCents: number } | null>((best, row) => {
    const monthKey = typeof row.month_key === "string" ? row.month_key : "";
    const monthNum = parseMonthNumberFromMonthKey(monthKey);
    const totalIncomeCents = typeof row.total_income_cents === "number" ? row.total_income_cents : 0;
    if (totalIncomeCents <= 0) return best;
    if (monthNum === null) return best;
    if (!best || monthKey > best.monthKey) return { monthKey, totalIncomeCents };
    return best;
  }, null);
  const salaryIncomeAsOfDate = readString(salaryIncomeResult, "as_of_date") ?? "";
  const asOfMonthNumber = salaryIncomeAsOfDate.length >= 7 ? Number(salaryIncomeAsOfDate.slice(5, 7)) : NaN;
  const fallbackIncomeMonthNumber = Number.isFinite(asOfMonthNumber) && asOfMonthNumber >= 1 && asOfMonthNumber <= 12
    ? asOfMonthNumber
    : (new Date().getMonth() + 1);
  const incomeMonthNumber = parseMonthNumberFromMonthKey(latestIncomeMonthWithData?.monthKey) ?? fallbackIncomeMonthNumber;
  const incomeTabMonthlyLabel = `${incomeMonthNumber}月收入`;
  const incomeTabMonthlyText = formatCentsShort(latestIncomeMonthWithData?.totalIncomeCents ?? 0);
  const incomeTabMonthlyTone: "default" = "default";
  const incomeTabYearTotalLabel = `${currentYearText}年收入`;
  const incomeTabYearTotalText = formatCentsShort(readNumber(salaryIncomeResult, "summary.total_income_cents") ?? undefined);
  const incomeTabYearTotalTone: "default" = "default";
  const consumptionMonthRows = readArray(consumptionOverviewResult, "months").filter(isRecord);
  const latestConsumptionMonth = consumptionMonthRows.reduce<{ monthKey: string; amountCents: number } | null>((best, row) => {
    const monthKey = typeof row.month === "string" ? row.month : "";
    const monthNum = parseMonthNumberFromMonthKey(monthKey);
    const amountYuan = typeof row.amount === "number" ? row.amount : 0;
    if (monthNum === null || !Number.isFinite(amountYuan)) return best;
    const amountCents = Math.round(amountYuan * 100);
    if (!best || monthKey > best.monthKey) return { monthKey, amountCents };
    return best;
  }, null);
  const consumptionMonthNumber = parseMonthNumberFromMonthKey(latestConsumptionMonth?.monthKey) ?? (new Date().getMonth() + 1);
  const consumptionTabMonthlyLabel = `${consumptionMonthNumber}月消费`;
  const consumptionTabMonthlyText = formatCentsShort(latestConsumptionMonth?.amountCents ?? 0);
  const consumptionTabMonthlyTone: "warn" = "warn";
  const consumptionTabYearTotalValue = readNumber(consumptionOverviewResult, "consumption_total_value");
  const consumptionTabYearTotalLabel = `${currentYearText}年消费`;
  const consumptionTabYearTotalText = formatCentsShort(
    typeof consumptionTabYearTotalValue === "number" && Number.isFinite(consumptionTabYearTotalValue)
      ? Math.round(consumptionTabYearTotalValue * 100)
      : undefined,
  );
  const consumptionTabYearTotalTone: "warn" = "warn";
  const mobileQuickMetricsByTab = {
    "manual-entry": [{ label: "本月已记", value: manualEntryTabMonthCountText, tone: "default" as const }],
    "manual-asset-entry": [{ label: manualAssetEntryLastDateLabel, value: manualAssetEntryLastDateText, tone: "default" as const }],
    "return-analysis": [
      { label: returnTabQuickMetricLabel, value: returnTabAnnualizedText, tone: returnTabAnnualizedTone },
      { label: `${currentYearText}年净增`, value: returnTabNetGrowthText, tone: returnTabNetGrowthTone },
    ],
    "wealth-overview": [
      { label: wealthTabMonthlyGrowthLabel, value: wealthTabMonthlyGrowthText, tone: wealthTabMonthlyGrowthTone },
      { label: "净资产", value: wealthTabNetAssetText, tone: wealthTabNetAssetTone },
    ],
    "budget-fire": [
      { label: "自由度", value: fireTabFreedomText, tone: fireTabFreedomTone },
      { label: "可投金额", value: fireTabInvestableText, tone: fireTabInvestableTone },
    ],
    "income-analysis": [
      { label: incomeTabMonthlyLabel, value: incomeTabMonthlyText, tone: incomeTabMonthlyTone },
      { label: incomeTabYearTotalLabel, value: incomeTabYearTotalText, tone: incomeTabYearTotalTone },
    ],
    "consumption-analysis": [
      { label: consumptionTabMonthlyLabel, value: consumptionTabMonthlyText, tone: consumptionTabMonthlyTone },
      { label: consumptionTabYearTotalLabel, value: consumptionTabYearTotalText, tone: consumptionTabYearTotalTone },
    ],
  };
  const quickManualAccountId = `${quickManualInvForm.account_id ?? ""}`.trim();
  const quickManualAccountHintText = !quickManualAccountId
    ? ""
    : quickManualInvAccountAssetsError
      ? quickManualInvAccountAssetsError
      : quickManualInvAccountAssetsBusy
        ? "当前总资金加载中..."
        : quickManualInvAccountAssetsCents !== null
          ? `当前总资金：${maskAmountDisplayText(formatCentsYuanText(quickManualInvAccountAssetsCents))} 元${
              quickManualInvAccountAssetsDate ? `（${quickManualInvAccountAssetsDate}）` : ""
            }`
          : "当前总资金：暂无历史快照";
  const quickManualAccountHintToneClass = quickManualInvAccountAssetsError ? "warn-text" : "";
  const quickManualTotalAssetsInputYuan = parseYuanInputToNumber(`${quickManualInvForm.total_assets ?? ""}`);
  const quickManualTotalAssetsWanText = quickManualTotalAssetsInputYuan !== null && Math.abs(quickManualTotalAssetsInputYuan) >= 100000
    ? maskAmountDisplayText(`${(quickManualTotalAssetsInputYuan / 10000).toFixed(2)} 万`)
    : "";
  const quickManualAssetClass = normalizeQuickManualAssetClass(quickManualAssetForm.asset_class);
  const quickManualAssetAccountKinds = accountKindsForAssetClass(quickManualAssetClass) ?? [];
  const quickManualAssetAccountId = `${quickManualAssetForm.account_id ?? ""}`.trim();
  const quickManualAssetHintText = !quickManualAssetAccountId
    ? ""
    : quickManualAssetAccountValueError
      ? quickManualAssetAccountValueError
      : quickManualAssetAccountValueBusy
        ? "当前快照加载中..."
        : quickManualAssetAccountValueCents !== null
          ? `当前快照：${maskAmountDisplayText(formatCentsYuanText(quickManualAssetAccountValueCents))} 元${
              quickManualAssetAccountValueDate ? `（${quickManualAssetAccountValueDate}）` : ""
            }`
          : "当前快照：暂无历史记录";
  const quickManualAssetHintToneClass = quickManualAssetAccountValueError ? "warn-text" : "";
  const quickManualAssetValueInputYuan = parseYuanInputToNumber(`${quickManualAssetForm.value ?? ""}`);
  const quickManualAssetValueWanText = quickManualAssetValueInputYuan !== null && Math.abs(quickManualAssetValueInputYuan) >= 100000
    ? maskAmountDisplayText(`${(quickManualAssetValueInputYuan / 10000).toFixed(2)} 万`)
    : "";
  const invReturnAutoQueryKey = JSON.stringify(buildInvestmentReturnRequest(invQuery));
  const invCurveAutoQueryKey = JSON.stringify(buildInvestmentCurveRequest(invCurveQuery));
  const invBatchAutoQueryKey = JSON.stringify(buildInvestmentReturnsRequest(invCurveQuery));
  const shouldAutoRefreshInvestmentReturn = invResult === null || invLastQueryKey !== invReturnAutoQueryKey;
  const shouldAutoRefreshInvestmentCurve = invCurveResult === null || invCurveLastQueryKey !== invCurveAutoQueryKey;
  const shouldAutoRefreshInvestmentReturns = invBatchResult === null || invBatchLastQueryKey !== invBatchAutoQueryKey;
  const shouldPrefetchReturnTabQuickMetric = Boolean(dbStatus?.ready) && returnTabYtdAnnualizedRate === null && !invBusy;
  const shouldPrefetchWealthOverviewTabQuickMetric = Boolean(dbStatus?.ready) && wealthOverviewResult === null && !wealthOverviewBusy;
  const shouldPrefetchWealthTabQuickMetric = Boolean(dbStatus?.ready) && wealthCurveResult === null && !wealthCurveBusy;
  const shouldPrefetchFireTabQuickMetric = Boolean(dbStatus?.ready) && fireProgressResult === null && !fireProgressBusy;
  const shouldPrefetchIncomeTabQuickMetric = Boolean(dbStatus?.ready) && salaryIncomeResult === null && !salaryIncomeBusy;
  const shouldPrefetchConsumptionTabQuickMetric = Boolean(dbStatus?.ready) && consumptionOverviewResult === null && !consumptionOverviewBusy;
  const shouldPrefetchManualEntryTabQuickMetric = Boolean(dbStatus?.ready) && manualEntryTabMonthCount === null && !manualEntryTabMonthCountBusy;
  const shouldPrefetchManualAssetEntryTabQuickMetric = Boolean(dbStatus?.ready) && !manualAssetEntryLastDate && !manualAssetEntryLastDateBusy;
  const showQueryWorkbench = isAdminVisibleWorkbench;
  const showDebugJson = showRawJson && isAdminDeveloperMode;
  const queryWorkbenchHeader = isManualEntryTab
    ? {
        title: "手动录入",
        description: "集中处理投资记录与资产估值的手工录入/修改/删除，形成桌面端数据修正闭环。",
      }
    : {
        title: "数据查询与维护",
        description: "高级管理中的底层数据核查入口：账户元数据、投资记录与资产估值查询。",
      };
  const queryWorkbenchModules = isManualEntryTab
    ? ["投资记录维护", "资产估值维护"]
    : ["账户元数据查询", "投资记录查询", "资产估值查询"];
  const queryWorkbenchFlow = isManualEntryTab
    ? ["如需新增/维护账户目录，请切换到高级管理（开发者模式）", "执行写入/修改/删除", "回到收益分析或财富总览验证结果"]
    : ["先刷新管理员数据库健康", "执行基础查询定位数据问题", "在查询表格内进行修正或删除后回到业务 TAB 复查结果"];
  const queryWorkbenchGridModeClass = isManualEntryTab
    ? "mode-manual"
    : "mode-base";

  // 自动刷新编排：按 TAB 可见性与关键筛选条件驱动查询，避免手动重复点击。
  useDebouncedAutoRun(
    handleRefreshAccountSelectCatalog,
    [activeTab],
    { enabled: shouldAutoLoadAccountSelectCatalog, delayMs: 220 },
  );
  useDebouncedAutoRun(
    handleAccountCatalogQuery,
    [acctCatalogQuery.kind ?? "all", acctCatalogQuery.keyword ?? "", acctCatalogQuery.limit ?? 200],
    { enabled: isAdminTab, delayMs: 220 },
  );
  useDebouncedAutoRun(handleMetaAccountsQuery, [metaAccountsQuery.kind ?? "all"], { enabled: isAdminTab, delayMs: 220 });
  useDebouncedAutoRun(
    handleInvestmentsListQuery,
    [
      invListQuery.limit ?? 30,
      invListQuery.from ?? "",
      invListQuery.to ?? "",
      invListQuery.source_type ?? "",
      invListQuery.account_id ?? "",
    ],
    { enabled: isAdminTab, delayMs: 220 },
  );
  useDebouncedAutoRun(
    handleAssetValuationsQuery,
    [
      assetListQuery.limit ?? 30,
      assetListQuery.from ?? "",
      assetListQuery.to ?? "",
      assetListQuery.asset_class ?? "",
      assetListQuery.account_id ?? "",
    ],
    { enabled: isAdminTab, delayMs: 220 },
  );
  useDebouncedAutoRun(handleImportJobsQuery, [activeTab], { enabled: isTab("import-center"), delayMs: 220 });

  useDebouncedAutoRun(
    handleQuickManualAccountAssetsQuery,
    [quickManualInvOpen ? "open" : "closed", `${quickManualInvForm.account_id ?? ""}`],
    { enabled: quickManualInvOpen, delayMs: 180 },
  );
  useDebouncedAutoRun(
    handleQuickManualAssetAccountValueQuery,
    [quickManualAssetOpen ? "open" : "closed", quickManualAssetClass, `${quickManualAssetForm.account_id ?? ""}`],
    { enabled: quickManualAssetOpen, delayMs: 180 },
  );
  useDebouncedAutoRun(
    handleConsumptionOverviewQuery,
    [consumptionYear],
    { enabled: isConsumptionAnalysisTab || shouldPrefetchConsumptionTabQuickMetric, delayMs: 220 },
  );
  useDebouncedAutoRun(handleRefreshManualAssetEntryLastDate, [], { enabled: shouldPrefetchManualAssetEntryTabQuickMetric, delayMs: 260 });
  useDebouncedAutoRun(
    handleInvestmentReturnQuery,
    [invQuery.account_id, invQuery.preset, invQuery.from, invQuery.to],
    { enabled: (isReturnAnalysisTab && shouldAutoRefreshInvestmentReturn) || shouldPrefetchReturnTabQuickMetric, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleInvestmentCurveQuery,
    [invCurveQuery.account_id, invCurveQuery.preset, invCurveQuery.from, invCurveQuery.to],
    { enabled: isReturnAnalysisTab && shouldAutoRefreshInvestmentCurve, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleInvestmentReturnsQuery,
    [invCurveQuery.preset ?? "ytd", invCurveQuery.from ?? "", invCurveQuery.to ?? ""],
    { enabled: isReturnAnalysisTab && shouldAutoRefreshInvestmentReturns, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleWealthOverviewQuery,
    [
      wealthOverviewQuery.include_investment ?? "true",
      wealthOverviewQuery.include_cash ?? "true",
      wealthOverviewQuery.include_real_estate ?? "true",
      wealthOverviewQuery.include_liability ?? "true",
    ],
    { enabled: isWealthOverviewTab || shouldPrefetchWealthOverviewTabQuickMetric, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleWealthCurveQuery,
    [
      wealthCurveQuery.preset ?? "ytd",
      wealthCurveQuery.from ?? "",
      wealthCurveQuery.to ?? "",
      wealthCurveQuery.include_investment ?? "true",
      wealthCurveQuery.include_cash ?? "true",
      wealthCurveQuery.include_real_estate ?? "true",
      wealthCurveQuery.include_liability ?? "true",
    ],
    { enabled: isWealthOverviewTab || shouldPrefetchWealthTabQuickMetric, delayMs: 260 },
  );
  useDebouncedAutoRun(handleMonthlyBudgetItemsQuery, [], { enabled: isBudgetFireTab, delayMs: 220 });
  useDebouncedAutoRun(handleBudgetOverviewQuery, [budgetOverviewQuery.year ?? ""], { enabled: isBudgetFireTab, delayMs: 260 });
  useDebouncedAutoRun(handleBudgetMonthlyReviewQuery, [budgetReviewQuery.year ?? ""], { enabled: isBudgetFireTab, delayMs: 260 });
  useDebouncedAutoRun(
    handleFireProgressQuery,
    [fireProgressQuery.withdrawal_rate ?? ""],
    { enabled: isBudgetFireTab || shouldPrefetchFireTabQuickMetric, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleSalaryIncomeOverviewQuery,
    [salaryIncomeQuery.year ?? ""],
    { enabled: isIncomeAnalysisTab || shouldPrefetchIncomeTabQuickMetric, delayMs: 260 },
  );
  useDebouncedAutoRun(handleRefreshManualEntryTabMonthCount, [], { enabled: shouldPrefetchManualEntryTabQuickMetric, delayMs: 260 });

  // 页面装配：左侧导航 + 全局弹窗 + 主内容区各业务面板。
  return (
    <main className={`app-shell ${isMobileMode ? "mobile-shell" : ""} ${forceDesktopLayout ? "force-desktop-layout" : ""}`}>
      <div
        className={`workspace-layout ${!isMobileMode && sidebarCollapsed ? "sidebar-collapsed" : ""} ${appSettings.uiMotionEnabled ? "" : "motion-disabled"} ${isMobileMode ? "mobile-layout" : ""} ${forceDesktopLayout ? "force-desktop-layout" : ""}`}
      >
        {!isMobileMode ? (
          <WorkspaceSidebar
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            keepwiseLogoSvg={keepwiseLogoSvg}
            PRODUCT_TABS={PRODUCT_TABS}
            activeTab={activeTab}
            openQuickManualInvestmentModal={openQuickManualInvestmentModal}
            openQuickManualAssetValuationModal={openQuickManualAssetValuationModal}
            setActiveTab={setActiveTab}
            returnTabQuickMetricLabel={returnTabQuickMetricLabel}
            incomeTabMonthlyLabel={incomeTabMonthlyLabel}
            consumptionTabMonthlyLabel={consumptionTabMonthlyLabel}
            wealthTabMonthlyGrowthLabel={wealthTabMonthlyGrowthLabel}
            returnTabAnnualizedText={returnTabAnnualizedText}
            returnTabNetGrowthText={returnTabNetGrowthText}
            manualEntryTabMonthCountText={manualEntryTabMonthCountText}
            manualAssetEntryLastDateLabel={manualAssetEntryLastDateLabel}
            manualAssetEntryLastDateText={manualAssetEntryLastDateText}
            wealthTabMonthlyGrowthText={wealthTabMonthlyGrowthText}
            wealthTabNetAssetText={wealthTabNetAssetText}
            fireTabFreedomText={fireTabFreedomText}
            fireTabInvestableText={fireTabInvestableText}
            incomeTabMonthlyText={incomeTabMonthlyText}
            incomeTabYearTotalLabel={incomeTabYearTotalLabel}
            incomeTabYearTotalText={incomeTabYearTotalText}
            consumptionTabMonthlyText={consumptionTabMonthlyText}
            consumptionTabYearTotalLabel={consumptionTabYearTotalLabel}
            consumptionTabYearTotalText={consumptionTabYearTotalText}
            returnTabAnnualizedTone={returnTabAnnualizedTone}
            returnTabNetGrowthTone={returnTabNetGrowthTone}
            wealthTabMonthlyGrowthTone={wealthTabMonthlyGrowthTone}
            wealthTabNetAssetTone={wealthTabNetAssetTone}
            fireTabFreedomTone={fireTabFreedomTone}
            fireTabInvestableTone={fireTabInvestableTone}
            incomeTabMonthlyTone={incomeTabMonthlyTone}
            incomeTabYearTotalTone={incomeTabYearTotalTone}
            consumptionTabMonthlyTone={consumptionTabMonthlyTone}
            consumptionTabYearTotalTone={consumptionTabYearTotalTone}
            setSettingsOpen={setSettingsOpen}
            amountPrivacyMasked={amountPrivacyMasked}
            setAmountPrivacyMasked={setAmountPrivacyMasked}
            syncQuickState={syncQuickState}
            syncQuickTitle={syncQuickTitle}
            syncQuickAriaLabel={syncQuickAriaLabel}
            handleQuickSyncIndicatorClick={handleQuickSyncIndicatorClick}
          />
        ) : null}

        <QuickManualInvestmentModal
          quickManualInvOpen={quickManualInvOpen}
          closeQuickManualInvestmentModal={closeQuickManualInvestmentModal}
          quickManualInvBusy={quickManualInvBusy}
          makeEnterToQueryHandler={makeEnterToQueryHandler}
          handleQuickManualInvestmentSubmit={handleQuickManualInvestmentSubmit}
          DateInput={DateInput}
          quickManualInvForm={quickManualInvForm}
          setQuickManualInvForm={setQuickManualInvForm}
          AccountIdSelect={AccountIdSelect}
          accountSelectOptions={accountSelectOptions}
          accountSelectOptionsLoading={accountSelectOptionsLoading}
          quickManualAccountHintToneClass={quickManualAccountHintToneClass}
          quickManualAccountHintText={quickManualAccountHintText}
          quickManualTotalAssetsWanText={quickManualTotalAssetsWanText}
          quickManualInvError={quickManualInvError}
        />

        <QuickManualAssetValuationModal
          quickManualAssetOpen={quickManualAssetOpen}
          closeQuickManualAssetValuationModal={closeQuickManualAssetValuationModal}
          quickManualAssetBusy={quickManualAssetBusy}
          makeEnterToQueryHandler={makeEnterToQueryHandler}
          handleQuickManualAssetValuationSubmit={handleQuickManualAssetValuationSubmit}
          DateInput={DateInput}
          quickManualAssetForm={quickManualAssetForm}
          setQuickManualAssetForm={setQuickManualAssetForm}
          handleQuickManualAssetClassChange={handleQuickManualAssetClassChange}
          AccountIdSelect={AccountIdSelect}
          accountSelectOptions={accountSelectOptions}
          accountSelectOptionsLoading={accountSelectOptionsLoading}
          quickManualAssetAccountKinds={quickManualAssetAccountKinds}
          quickManualAssetHintToneClass={quickManualAssetHintToneClass}
          quickManualAssetHintText={quickManualAssetHintText}
          quickManualAssetValueWanText={quickManualAssetValueWanText}
          quickManualAssetError={quickManualAssetError}
        />

        <InvestmentEditModal
          invEditModalOpen={invEditModalOpen}
          closeInvestmentEditModal={closeInvestmentEditModal}
          updateInvBusy={updateInvBusy}
          makeEnterToQueryHandler={makeEnterToQueryHandler}
          handleUpdateInvestmentRecordMutation={handleUpdateInvestmentRecordMutation}
          updateInvForm={updateInvForm}
          setUpdateInvForm={setUpdateInvForm}
          DateInput={DateInput}
          AccountIdSelect={AccountIdSelect}
          accountSelectOptions={accountSelectOptions}
          accountSelectOptionsLoading={accountSelectOptionsLoading}
          updateInvError={updateInvError}
        />

        <AppSettingsModal
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          isDesktopApp={isDesktopApp}
          syncStatus={syncRuntimeStatus}
          handleManualSyncNow={handleManualSyncNow}
          syncSetupBusy={syncSetupBusy}
          syncSetupError={syncSetupError}
          syncActionMessage={syncActionMessage}
          syncShareCode={syncShareCode}
          syncCreateForm={syncCreateForm}
          setSyncCreateForm={setSyncCreateForm}
          syncLinkForm={syncLinkForm}
          setSyncLinkForm={setSyncLinkForm}
          handleSyncSetupCreate={handleSyncSetupCreate}
          handleSyncSetupLink={handleSyncSetupLink}
          handleSyncShareCodeRefresh={handleSyncShareCodeRefresh}
        />

        {isMobileMode ? (
          <div className={`mobile-page-header ${mobileView === "home" ? "mode-home" : "mode-tab"}`}>
            <div className="mobile-page-header-left">
              {mobileView !== "home" ? (
                <button
                  type="button"
                  className="mobile-back-btn"
                  onClick={() => setMobileView("home")}
                  aria-label="返回首页"
                >
                  <span className="mobile-back-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 5 8 12l7 7" />
                    </svg>
                  </span>
                </button>
              ) : null}
              {mobileView === "home" ? (
                <div className="workspace-brand mobile-home-brand" aria-label="KeepWise 品牌">
                  <span className="workspace-brand-icon" aria-hidden="true">
                    <img src={keepwiseLogoSvg} alt="" />
                  </span>
                  <div className="workspace-brand-text">
                    <div className="workspace-brand-name">KeepWise | 知衡</div>
                  </div>
                </div>
              ) : (
                <div className="mobile-page-title-group">
                  <div className="mobile-page-title">{activeTabMeta.label}</div>
                  <div className="mobile-page-subtitle">{activeTabMeta.subtitle}</div>
                </div>
              )}
            </div>
            <div className="mobile-page-header-actions">
              <button
                type="button"
                className={`sidebar-tool-btn mobile-icon-btn sidebar-privacy-btn ${amountPrivacyMasked ? "active" : ""}`}
                onClick={() => setAmountPrivacyMasked((v) => !v)}
                aria-label={amountPrivacyMasked ? "关闭隐私显示" : "开启隐私显示"}
                aria-pressed={amountPrivacyMasked}
              >
                <span className="sidebar-privacy-icon" aria-hidden="true">
                  {amountPrivacyMasked ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3l18 18" />
                      <path d="M10.58 10.58a2 2 0 102.83 2.83" />
                      <path d="M9.36 5.37A10.9 10.9 0 0112 5c5.05 0 8.73 3.11 10 7-0.47 1.43-1.39 2.79-2.72 3.95" />
                      <path d="M6.23 6.23C4.85 7.35 3.86 8.74 3 12c1.27 3.89 4.95 7 10 7 1.06 0 2.07-.14 3.01-.4" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </span>
              </button>
              <button
                type="button"
                className={`sidebar-tool-btn mobile-icon-btn sidebar-sync-btn state-${syncQuickState}`}
                onClick={() => {
                  void handleQuickSyncIndicatorClick();
                }}
                title={syncQuickTitle}
                aria-label={syncQuickAriaLabel}
                disabled={syncQuickState === "syncing"}
              >
                <span className={`sidebar-sync-icon ${syncQuickState === "syncing" ? "sync-icon-spin" : ""}`} aria-hidden="true">
                  {syncQuickState === "synced" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="8.2" />
                      <path d="m8.4 12.3 2.4 2.5 4.8-5.1" />
                    </svg>
                  ) : syncQuickState === "pending" ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="8.2" />
                      <path d="M12 7.8v4.6" />
                      <path d="M12 12.4h3.5" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                      <path d="M20 4v5h-5" />
                    </svg>
                  )}
                </span>
              </button>
              <button
                type="button"
                className="sidebar-tool-btn mobile-icon-btn"
                onClick={() => setSettingsOpen(true)}
                aria-label="打开设置"
              >
                <span className="sidebar-tool-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3.1" />
                    <circle cx="12" cy="12" r="7.1" />
                    <path d="M12 2.9v2.2" />
                    <path d="M12 18.9v2.2" />
                    <path d="M21.1 12h-2.2" />
                    <path d="M5.1 12H2.9" />
                    <path d="M18.4 5.6 16.8 7.2" />
                    <path d="M7.2 16.8 5.6 18.4" />
                    <path d="M18.4 18.4 16.8 16.8" />
                    <path d="M7.2 7.2 5.6 5.6" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        ) : null}

        {isMobileMode && mobileView === "home" ? (
          <div key={`mobile-home-scene-${mobileSceneSeq}`} className={`mobile-scene ${mobileSceneAnimClass}`}>
            <MobileHomeGrid
              tabs={visibleTabs}
              activeTab={activeTab}
              onOpenManualEntry={openQuickManualInvestmentModal}
              onOpenManualAssetEntry={openQuickManualAssetValuationModal}
              onSelectTab={(tabKey: ProductTabKey) => {
                setActiveTab(tabKey);
                setMobileView(tabKey);
              }}
              quickMetricsByTab={mobileQuickMetricsByTab}
            />
          </div>
        ) : null}

        {!isMobileMode || mobileView !== "home" ? <div
          key={isMobileMode ? `mobile-page-scene-${mobileSceneSeq}` : "desktop-page-scene"}
          className={`workspace-content ${isMobileMode ? `mobile-page-body mobile-scene ${mobileSceneAnimClass}` : ""}`}
        >
          <WorkspaceContentPanels
            activeTabMeta={activeTabMeta}
            isAdminTab={isAdminTab}
            developerMode={developerMode}
            setShowRawJson={setShowRawJson}
            setDeveloperMode={setDeveloperMode}
            showRawJson={showRawJson}
            isTab={isTab}
            AutoRefreshHint={AutoRefreshHint}
            consumptionOverviewBusy={consumptionOverviewBusy}
            consumptionOverviewError={consumptionOverviewError}
            ConsumptionOverviewPreview={ConsumptionOverviewPreview}
            consumptionOverviewResult={consumptionOverviewResult}
            appSettings={appSettings}
            isMobileMode={isMobileMode}
            confirmTransactionReview={confirmTransactionReview}
            consumptionYear={consumptionYear}
            setConsumptionYear={setConsumptionYear}
            formatCentsShort={formatCentsShort}
            PreviewStat={PreviewStat}
            LineAreaChart={LineAreaChart}
            SortableHeaderButton={SortableHeaderButton}
            nextSortState={nextSortState}
            compareSortValues={compareSortValues}
            updateTransactionAnalysisExclusion={updateTransactionAnalysisExclusion}
            handleConsumptionOverviewQuery={handleConsumptionOverviewQuery}
            consumptionOverview={consumptionOverview}
            toErrorMessage={toErrorMessage}
            setConsumptionCategoryUpdatingMerchant={setConsumptionCategoryUpdatingMerchant}
            upsertMerchantMapRule={upsertMerchantMapRule}
            consumptionCategoryUpdatingMerchant={consumptionCategoryUpdatingMerchant}
            showDebugJson={showDebugJson}
            JsonResultCard={JsonResultCard}
            showQueryWorkbench={showQueryWorkbench}
            queryWorkbenchHeader={queryWorkbenchHeader}
            queryWorkbenchModules={queryWorkbenchModules}
            queryWorkbenchFlow={queryWorkbenchFlow}
            makeEnterToQueryHandler={makeEnterToQueryHandler}
            fireProgressBusy={fireProgressBusy}
            fireProgressError={fireProgressError}
            FireProgressPreview={FireProgressPreview}
            fireProgressResult={fireProgressResult}
            signedMetricTone={signedMetricTone}
            salaryIncomeQuery={salaryIncomeQuery}
            setSalaryIncomeQuery={setSalaryIncomeQuery}
            salaryIncomeBusy={salaryIncomeBusy}
            salaryIncomeError={salaryIncomeError}
            SalaryIncomeOverviewPreview={SalaryIncomeOverviewPreview}
            salaryIncomeResult={salaryIncomeResult}
            handleBudgetOverviewQuery={handleBudgetOverviewQuery}
            handleBudgetMonthlyReviewQuery={handleBudgetMonthlyReviewQuery}
            budgetOverviewQuery={budgetOverviewQuery}
            budgetReviewQuery={budgetReviewQuery}
            currentYearText={currentYearText}
            setBudgetOverviewQuery={setBudgetOverviewQuery}
            setBudgetReviewQuery={setBudgetReviewQuery}
            budgetYearOptions={budgetYearOptions}
            budgetOverviewBusy={budgetOverviewBusy}
            budgetReviewBusy={budgetReviewBusy}
            budgetOverviewError={budgetOverviewError}
            budgetReviewError={budgetReviewError}
            BudgetOverviewPreview={BudgetOverviewPreview}
            budgetOverviewResult={budgetOverviewResult}
            BudgetMonthlyReviewPreview={BudgetMonthlyReviewPreview}
            budgetReviewResult={budgetReviewResult}
            openBudgetItemCreateModal={openBudgetItemCreateModal}
            budgetItemUpsertBusy={budgetItemUpsertBusy}
            budgetItemsBusy={budgetItemsBusy}
            budgetItemsError={budgetItemsError}
            budgetItemDeleteError={budgetItemDeleteError}
            budgetItemUpsertError={budgetItemUpsertError}
            budgetItemUpsertResult={budgetItemUpsertResult}
            budgetItemDeleteResult={budgetItemDeleteResult}
            BudgetItemsPreview={BudgetItemsPreview}
            budgetItemsResult={budgetItemsResult}
            budgetItemDeleteBusy={budgetItemDeleteBusy}
            budgetItemDeletingRowId={budgetItemDeletingRowId}
            handleDeleteMonthlyBudgetItem={handleDeleteMonthlyBudgetItem}
            budgetItemCreateOpen={budgetItemCreateOpen}
            closeBudgetItemCreateModal={closeBudgetItemCreateModal}
            BoolField={BoolField}
            budgetItemForm={budgetItemForm}
            setBudgetItemForm={setBudgetItemForm}
            handleUpsertMonthlyBudgetItem={handleUpsertMonthlyBudgetItem}
          />

      <AdminProbePanels
        isAdminDeveloperMode={isAdminDeveloperMode}
        status={status}
        error={error}
        isReady={isReady}
        probe={probe}
        PathRow={PathRow}
      />

      <AccountCatalogAdminPanel
        isTab={isTab}
        makeEnterToQueryHandler={makeEnterToQueryHandler}
        handleAccountCatalogQuery={handleAccountCatalogQuery}
        acctCatalogQuery={acctCatalogQuery}
        setAcctCatalogQuery={setAcctCatalogQuery}
        safeNumericInputValue={safeNumericInputValue}
        parseNumericInputWithFallback={parseNumericInputWithFallback}
        openAccountCatalogCreateModal={openAccountCatalogCreateModal}
        openAccountCatalogRenameModal={openAccountCatalogRenameModal}
        acctCatalogUpsertBusy={acctCatalogUpsertBusy}
        acctCatalogModalMode={acctCatalogModalMode}
        AutoRefreshHint={AutoRefreshHint}
        acctCatalogBusy={acctCatalogBusy}
        acctCatalogError={acctCatalogError}
        acctCatalogDeleteError={acctCatalogDeleteError}
        acctCatalogUpsertResult={acctCatalogUpsertResult}
        showDebugJson={showDebugJson}
        JsonResultCard={JsonResultCard}
        acctCatalogDeleteResult={acctCatalogDeleteResult}
        AccountCatalogPreview={AccountCatalogPreview}
        acctCatalogResult={acctCatalogResult}
        acctCatalogDeleteBusy={acctCatalogDeleteBusy}
        acctCatalogDeletingRowId={acctCatalogDeletingRowId}
        PreviewStat={PreviewStat}
        SortableHeaderButton={SortableHeaderButton}
        nextSortState={nextSortState}
        compareSortValues={compareSortValues}
        handleAccountCatalogDelete={handleAccountCatalogDelete}
        acctCatalogCreateOpen={acctCatalogCreateOpen}
        closeAccountCatalogCreateModal={closeAccountCatalogCreateModal}
        acctCatalogUpsertForm={acctCatalogUpsertForm}
        setAcctCatalogUpsertForm={setAcctCatalogUpsertForm}
        acctCatalogUpsertError={acctCatalogUpsertError}
        handleAccountCatalogUpsert={handleAccountCatalogUpsert}
      />

      <AdminDbPanel
        isAdminDeveloperMode={isAdminDeveloperMode}
        refreshDbStatus={refreshDbStatus}
        dbBusy={dbBusy}
        handleRunMigrations={handleRunMigrations}
        dbImportPath={dbImportPath}
        setDbImportPath={setDbImportPath}
        handlePickDbImportPath={handlePickDbImportPath}
        handleImportDbFromPath={handleImportDbFromPath}
        dbStatusError={dbStatusError}
        dbStatus={dbStatus}
        dbLastResult={dbLastResult}
        dbImportLastResult={dbImportLastResult}
      />

      <ImportCenterSections
        isTab={isTab}
        handleImportJobsQuery={handleImportJobsQuery}
        importJobsBusy={importJobsBusy}
        importJobsError={importJobsError}
        importJobsResult={importJobsResult}
        importJobsLastRunAt={importJobsLastRunAt}
        yzxyFilePath={yzxyFilePath}
        setYzxyFilePath={setYzxyFilePath}
        handlePickYzxyFilePath={handlePickYzxyFilePath}
        yzxyPreviewBusy={yzxyPreviewBusy}
        yzxyImportBusy={yzxyImportBusy}
        handleYzxyRunImportFlow={handleYzxyRunImportFlow}
        yzxyPreviewError={yzxyPreviewError}
        yzxyImportError={yzxyImportError}
        yzxyPreviewResult={yzxyPreviewResult}
        yzxyImportResult={yzxyImportResult}
        PreviewStat={PreviewStat}
        emlSourcePath={emlSourcePath}
        setEmlSourcePath={setEmlSourcePath}
        handlePickEmlFile={handlePickEmlFile}
        handlePickEmlFolder={handlePickEmlFolder}
        emlPreviewBusy={emlPreviewBusy}
        emlImportBusy={emlImportBusy}
        handleCmbEmlRunImportFlow={handleCmbEmlRunImportFlow}
        emlPreviewError={emlPreviewError}
        emlImportError={emlImportError}
        emlPreviewResult={emlPreviewResult}
        emlImportResult={emlImportResult}
        cmbPdfPath={cmbPdfPath}
        setCmbPdfPath={setCmbPdfPath}
        handlePickCmbPdfFile={handlePickCmbPdfFile}
        cmbPdfPreviewBusy={cmbPdfPreviewBusy}
        cmbPdfImportBusy={cmbPdfImportBusy}
        handleCmbBankPdfRunImportFlow={handleCmbBankPdfRunImportFlow}
        cmbPdfPreviewError={cmbPdfPreviewError}
        cmbPdfImportError={cmbPdfImportError}
        cmbPdfPreviewResult={cmbPdfPreviewResult}
        cmbPdfImportResult={cmbPdfImportResult}
      />

      <AdminSections
        isTab={isTab}
        handleRefreshAdminDbStats={handleRefreshAdminDbStats}
        adminDbStatsBusy={adminDbStatsBusy}
        dbBusy={dbBusy}
        adminDbStatsLastRunAt={adminDbStatsLastRunAt}
        adminDbStatsError={adminDbStatsError}
        adminDbStatsResult={adminDbStatsResult}
        AdminDbStatsPreview={AdminDbStatsPreview}
        PreviewStat={PreviewStat}
        SortableHeaderButton={SortableHeaderButton}
        nextSortState={nextSortState}
        compareSortValues={compareSortValues}
        developerMode={developerMode}
        readString={readString}
        adminResetConfirmText={adminResetConfirmText}
        setAdminResetConfirmText={setAdminResetConfirmText}
        handleAdminResetTransactions={handleAdminResetTransactions}
        adminResetTxBusy={adminResetTxBusy}
        adminResetAllBusy={adminResetAllBusy}
        handleAdminResetAll={handleAdminResetAll}
        adminResetTxError={adminResetTxError}
        adminResetAllError={adminResetAllError}
        adminResetTxResult={adminResetTxResult}
        adminResetAllResult={adminResetAllResult}
        showDebugJson={showDebugJson}
        JsonResultCard={JsonResultCard}
        isAdminDeveloperMode={isAdminDeveloperMode}
        handleRunValidationPipeline={handleRunValidationPipeline}
        pipelineBusy={pipelineBusy}
        smokeBusy={smokeBusy}
        handleRunCoreAnalyticsSmoke={handleRunCoreAnalyticsSmoke}
        setShowRawJson={setShowRawJson}
        showRawJson={showRawJson}
        smokeLastRunAt={smokeLastRunAt}
        pipelineStatus={pipelineStatus}
        pipelineLastRunAt={pipelineLastRunAt}
        pipelineMessage={pipelineMessage}
        smokeRows={smokeRows}
        handleRunRuntimeHealthCheck={handleRunRuntimeHealthCheck}
        runtimeHealthBusy={runtimeHealthBusy}
        runtimeHealthLastRunAt={runtimeHealthLastRunAt}
        runtimeHealthError={runtimeHealthError}
        RuntimeHealthPreview={RuntimeHealthPreview}
        runtimeHealthResult={runtimeHealthResult}
        showQueryWorkbench={showQueryWorkbench}
        queryWorkbenchHeader={queryWorkbenchHeader}
        queryWorkbenchGridModeClass={queryWorkbenchGridModeClass}
        DateInput={DateInput}
        AccountIdSelect={AccountIdSelect}
        accountSelectOptions={accountSelectOptions}
        accountSelectOptionsLoading={accountSelectOptionsLoading}
        deleteInvId={deleteInvId}
        deleteInvBusy={deleteInvBusy}
        accountKindsForAssetClass={accountKindsForAssetClass}
        isAdminVisibleWorkbench={isAdminVisibleWorkbench}
        metaAccountsQuery={metaAccountsQuery}
        setMetaAccountsQuery={setMetaAccountsQuery}
        AutoRefreshHint={AutoRefreshHint}
        metaAccountsBusy={metaAccountsBusy}
        metaAccountsError={metaAccountsError}
        MetaAccountsPreview={MetaAccountsPreview}
        metaAccountsResult={metaAccountsResult}
        makeEnterToQueryHandler={makeEnterToQueryHandler}
        handleInvestmentsListQuery={handleInvestmentsListQuery}
        safeNumericInputValue={safeNumericInputValue}
        invListQuery={invListQuery}
        setInvListQuery={setInvListQuery}
        parseNumericInputWithFallback={parseNumericInputWithFallback}
        invListBusy={invListBusy}
        invListError={invListError}
        InvestmentsListPreview={InvestmentsListPreview}
        invListResult={invListResult}
        formatCentsShort={formatCentsShort}
        prefillInvestmentUpdateFormFromRow={prefillInvestmentUpdateFormFromRow}
        handleDeleteInvestmentRecordById={handleDeleteInvestmentRecordById}
        handleAssetValuationsQuery={handleAssetValuationsQuery}
        assetListQuery={assetListQuery}
        setAssetListQuery={setAssetListQuery}
        assetListBusy={assetListBusy}
        assetListError={assetListError}
        AssetValuationsPreview={AssetValuationsPreview}
        assetListResult={assetListResult}
        RulesAdminPanel={RulesAdminPanel}
        BoolField={BoolField}
        maskAmountDisplayText={maskAmountDisplayText}
      />

      <ReturnAnalysisSection
        isTab={isTab}
        makeEnterToQueryHandler={makeEnterToQueryHandler}
        handleInvestmentReturnQuery={handleInvestmentReturnQuery}
        handleInvestmentCurveQuery={handleInvestmentCurveQuery}
        handleRetryInvestmentCurveBenchmarks={handleRetryInvestmentCurveBenchmarks}
        handleInvestmentReturnsQuery={handleInvestmentReturnsQuery}
        AccountIdSelect={AccountIdSelect}
        invCurveQuery={invCurveQuery}
        setInvestmentAnalysisSharedQuery={setInvestmentAnalysisSharedQuery}
        accountSelectOptions={accountSelectOptions}
        accountSelectOptionsLoading={accountSelectOptionsLoading}
        AutoRefreshHint={AutoRefreshHint}
        invBusy={invBusy}
        invCurveBusy={invCurveBusy}
        invBatchBusy={invBatchBusy}
        invError={invError}
        invCurveError={invCurveError}
        invCurveBenchmarksBusy={invCurveBenchmarksBusy}
        invBatchError={invBatchError}
        InvestmentCurvePreview={InvestmentCurvePreview}
        invCurveResult={invCurveResult}
        invResult={invResult}
        formatCentsShort={formatCentsShort}
        formatRatePct={formatRatePct}
        signedMetricTone={signedMetricTone}
        PreviewStat={PreviewStat}
        LineAreaChart={LineAreaChart}
        InvestmentReturnsPreview={InvestmentReturnsPreview}
        invBatchResult={invBatchResult}
        formatPresetLabel={formatPresetLabel}
        SortableHeaderButton={SortableHeaderButton}
        nextSortState={nextSortState}
        compareSortValues={compareSortValues}
        showRawJson={showRawJson}
        JsonResultCard={JsonResultCard}
      />

      <AnalysisExportSection
        isActive={isTab("export-analysis")}
        currentYearText={currentYearText}
        defaultHideAmounts={amountPrivacyMasked}
        fireWithdrawalRate={appSettings.fireWithdrawalRate}
        appSettings={appSettings}
        allowLocalCli={isDesktopApp}
      />

      <WealthOverviewSection
        isTab={isTab}
        wealthCurveQuery={wealthCurveQuery}
        makeEnterToQueryHandler={makeEnterToQueryHandler}
        handleWealthOverviewQuery={handleWealthOverviewQuery}
        handleWealthCurveQuery={handleWealthCurveQuery}
        setWealthCurveQuery={setWealthCurveQuery}
        setWealthSharedAssetFilters={setWealthSharedAssetFilters}
        toggleWealthAssetFilter={toggleWealthAssetFilter}
        DateInput={DateInput}
        AutoRefreshHint={AutoRefreshHint}
        wealthOverviewBusy={wealthOverviewBusy}
        wealthCurveBusy={wealthCurveBusy}
        wealthOverviewError={wealthOverviewError}
        wealthCurveError={wealthCurveError}
        WealthOverviewPreview={WealthOverviewPreview}
        wealthOverviewResult={wealthOverviewResult}
        PreviewStat={PreviewStat}
        formatCentsShort={formatCentsShort}
        isAmountPrivacyMasked={isAmountPrivacyMasked}
        isMobileMode={isMobileMode}
        WealthCurvePreview={WealthCurvePreview}
        wealthCurveResult={wealthCurveResult}
        formatPct={formatPct}
        signedMetricTone={signedMetricTone}
        formatSignedDeltaCentsShort={formatSignedDeltaCentsShort}
        formatMonthDayLabel={formatMonthDayLabel}
        computeMonthlyTotalAssetGrowthFromWealthCurve={computeMonthlyTotalAssetGrowthFromWealthCurve}
        showRawJson={showRawJson}
        JsonResultCard={JsonResultCard}
      />

      {isAdminDeveloperMode ? <section className="card panel roadmap-panel">
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
        </div> : null}
      </div>
    </main>
  );
}

export default App;
