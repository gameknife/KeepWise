import { startTransition, useEffect, useState } from "react";
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
import {
  CmbBankPdfImportSummaryReport,
  CmbBankPdfPreviewSummaryReport,
  CmbEmlImportSummaryReport,
  CmbEmlPreviewSummaryReport,
  YzxyImportSummaryReport,
  YzxyPreviewSummaryReport,
} from "../features/import/ImportSummaryPreviews";
import { ImportCenterSections } from "../features/import/ImportCenterSections";
import { SalaryIncomeOverviewPreview } from "../features/income/SalaryIncomeOverviewPreview";
import { MobileHomeGrid } from "../features/layout/MobileHomeGrid";
import { WorkspaceSidebar } from "../features/layout/WorkspaceSidebar";
import { WorkspaceContentPanels } from "../features/layout/WorkspaceContentPanels";
import { AppSettingsModal } from "../features/modals/AppSettingsModal";
import { InvestmentEditModal } from "../features/modals/InvestmentEditModal";
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
  importRepoRuntimeLedgerDb,
  importLedgerDbFromPath,
  loadBootstrapProbe,
  loadLedgerDbAdminStats,
  loadLedgerDbStatus,
  queryAccountCatalog,
  queryBudgetMonthlyReview,
  queryBudgetOverview,
  queryConsumptionReport,
  queryAssetValuations,
  queryInvestments,
  queryInvestmentReturns,
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
  updateTransactionAnalysisExclusion,
  updateInvestmentRecord,
  upsertAccountCatalogEntry,
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
  type SalaryIncomeOverviewPayload,
  type UpdateInvestmentRecordRequest,
  type UpsertManualInvestmentRequest,
  type UpsertAccountCatalogEntryRequest,
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
  makeInitialImportStepRows,
  makeInitialSmokeRows,
  parseMonthNumberFromMonthKey,
  parseNumericInputWithFallback,
  parseStoredAppSettings,
  parseYuanInputToNumber,
  safeNumericInputValue,
  withSmokeResult,
} from "./helpers";
import {
  summarizeCmbBankPdfImportPayload,
  summarizeCmbBankPdfPreviewPayload,
  summarizeCmbEmlImportPayload,
  summarizeCmbEmlPreviewPayload,
  summarizeInvestmentCurvePayload,
  summarizeInvestmentReturnPayload,
  summarizeWealthCurvePayload,
  summarizeWealthOverviewPayload,
  summarizeYzxyImportPayload,
  summarizeYzxyPreviewPayload,
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
  type ImportStepKey,
  type ImportStepRow,
  type ImportStepStatus,
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
  { key: "wealth-overview", icon: "◔", label: "财富总览", subtitle: "总览与财富曲线", status: "ready" },
  { key: "return-analysis", icon: "↗", label: "投资收益", subtitle: "投资收益率与收益曲线", status: "ready" },
  { key: "budget-fire", icon: "◎", label: "FIRE进度", subtitle: "FIRE 进度、预算与复盘", status: "partial" },
  { key: "income-analysis", icon: "¥", label: "收入分析", subtitle: "工资/公积金收入结构与趋势", status: "partial" },
  { key: "consumption-analysis", icon: "¤", label: "消费分析", subtitle: "交易筛选与排除规则", status: "partial" },
  { key: "import-center", icon: "⇩", label: "导入中心", subtitle: "YZXY / EML / CMB PDF", status: "ready" },
  { key: "admin", icon: "⚙", label: "高级管理", subtitle: "调试、健康检查、管理操作", status: "ready" },
];

const APP_SETTINGS_STORAGE_KEY = "keepwise.desktop.app-settings.v1";
const QUICK_MANUAL_INV_LAST_ACCOUNT_ID_STORAGE_KEY = "keepwise.desktop.quick-manual-investment.last-account-id.v1";

function getVisibleTabsForMode(tabs: ProductTabDef[], isMobileMode: boolean): ProductTabDef[] {
  if (!isMobileMode) return tabs;
  return tabs.filter((tab) => tab.key !== "admin" && tab.key !== "import-center");
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
  // 导入中心输入源与执行结果：分别维护 YZXY / EML / CMB-PDF 三条导入链路。
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
  // 核心分析 TAB（收益/财富）的查询条件与结果状态。
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
  const [invCurveBusy, setInvCurveBusy] = useState(false);
  const [invCurveError, setInvCurveError] = useState("");
  const [invCurveResult, setInvCurveResult] = useState<InvestmentCurvePayload | null>(null);
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
  const [fireProgressQuery, setFireProgressQuery] = useState<FireProgressQueryRequest>({
    withdrawal_rate: "0.03",
  });
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
  const [returnTabYtdAnnualizedRate, setReturnTabYtdAnnualizedRate] = useState<number | null>(null);
  const [manualEntryTabMonthCountBusy, setManualEntryTabMonthCountBusy] = useState(false);
  const [manualEntryTabMonthCount, setManualEntryTabMonthCount] = useState<number | null>(null);
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
      const payload = await runLedgerDbAdminResetTransactions(buildAdminResetRequest(adminResetConfirmText));
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
      const payload = await runLedgerDbAdminResetAll(buildAdminResetRequest(adminResetConfirmText));
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

  // 导入中心动作：先预览再导入；导入完成后联动刷新相关业务面板。
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
      void handleRefreshAccountSelectCatalog();
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
      void handleRefreshAccountSelectCatalog();
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
      void handleRefreshAccountSelectCatalog();
    } catch (err) {
      setCmbPdfImportError(toErrorMessage(err));
    } finally {
      setCmbPdfImportBusy(false);
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

  function resetAccountCatalogCreateForm() {
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
    setQuickManualInvOpen(false);
    setQuickManualInvError("");
    setQuickManualInvAccountAssetsError("");
    setQuickManualInvAccountAssetsCents(null);
    setQuickManualInvAccountAssetsDate("");
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
      setQuickManualInvOpen(false);
    } catch (err) {
      setQuickManualInvError(toErrorMessage(err));
    } finally {
      setQuickManualInvBusy(false);
    }
  }

  async function handleUpdateInvestmentRecordMutation() {
    setUpdateInvBusy(true);
    setUpdateInvError("");
    try {
      await updateInvestmentRecord(compactStringFields(updateInvForm));
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

  // 导入中心总状态推导：把三条导入链路折叠成统一的进度摘要卡片。
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

  // 业务查询动作：收益/财富/工作台各模块的主查询入口。
  async function handleInvestmentReturnQuery() {
    setInvBusy(true);
    setInvError("");
    try {
      const [payload, quickMetricPayload] = await Promise.all([
        queryInvestmentReturn(buildInvestmentReturnRequest(invQuery)),
        queryInvestmentReturn(buildReturnTabQuickMetricRequest(invQuery)),
      ]);
      const ytdAnnualizedRate = readNumber(quickMetricPayload, "metrics.annualized_rate");
      startTransition(() => {
        setInvResult(payload);
        setReturnTabYtdAnnualizedRate(ytdAnnualizedRate ?? null);
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
      const payload = await queryInvestmentReturns(buildInvestmentReturnsRequest(invCurveQuery));
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
      const payload = await queryInvestmentCurve(buildInvestmentCurveRequest(invCurveQuery));
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
    void Promise.all([refreshProbe(), refreshDbStatus()]);
  }, []);

  // 壳层 UI 状态：TAB、侧边栏、设置、隐私开关、开发者模式。
  const isForcedMobilePreview = import.meta.env.VITE_FORCE_MOBILE === "1";
  const isNativeMobileUA = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isMobileMode = isForcedMobilePreview || isNativeMobileUA;
  const [activeTab, setActiveTab] = useState<ProductTabKey>("wealth-overview");
  const [mobileView, setMobileView] = useState<MobileView>("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    if (typeof window === "undefined") {
      return {
        gainLossColorScheme: "cn_red_up_green_down",
        defaultPrivacyMaskOnLaunch: false,
        uiMotionEnabled: true,
      };
    }
    return parseStoredAppSettings(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY));
  });
  const [amountPrivacyMasked, setAmountPrivacyMasked] = useState(() => appSettings.defaultPrivacyMaskOnLaunch);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  configureAmountFormatting({
    amountPrivacyMasked,
    gainLossColorScheme: appSettings.gainLossColorScheme,
  });

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
    if (!isMobileMode) return;
    setMobileView("home");
  }, [isMobileMode]);

  const visibleTabs = getVisibleTabsForMode(PRODUCT_TABS, isMobileMode);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    setActiveTab("wealth-overview");
    if (isMobileMode) setMobileView("home");
  }, [activeTab, visibleTabs, isMobileMode]);

  // 视图模型：将原始查询结果规整为侧边栏指标、提示文案和面板开关。
  const isReady = status === "ready";
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
  const accountSelectOptionsLoading = accountSelectCatalogBusy && accountSelectOptions.length === 0;
  const returnTabAnnualizedRate = returnTabYtdAnnualizedRate ?? undefined;
  const returnTabQuickMetricLabel = `${new Date().getFullYear()}年预估`;
  const returnTabAnnualizedText = formatRatePct(returnTabAnnualizedRate);
  const returnTabAnnualizedTone = signedMetricTone(returnTabAnnualizedRate);
  const wealthTabMonthlyGrowth = computeMonthlyTotalAssetGrowthFromWealthCurve(wealthCurveResult);
  const wealthTabMonthlyGrowthText = formatSignedDeltaCentsShort(wealthTabMonthlyGrowth?.deltaCents);
  const wealthTabMonthlyGrowthTone = signedMetricTone(wealthTabMonthlyGrowth?.deltaCents);
  const wealthTabMonthlyGrowthLabel = wealthTabMonthlyGrowth?.baselineDate
    ? `相比${formatMonthDayLabel(wealthTabMonthlyGrowth.baselineDate)}`
    : "月度增长";
  const fireTabFreedomText = readString(fireProgressResult, "metrics.freedom_ratio_pct_text")
    ?? readString(fireProgressResult, "freedom_ratio_pct_text")
    ?? "-";
  const fireTabFreedomTone: "default" = "default";
  const manualEntryTabMonthCountText = manualEntryTabMonthCountBusy && manualEntryTabMonthCount === null
    ? "..."
    : `${manualEntryTabMonthCount ?? 0}笔`;
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
  const mobileQuickMetricsByTab = {
    "manual-entry": { label: "本月已记", value: manualEntryTabMonthCountText, tone: "default" as const },
    "return-analysis": { label: returnTabQuickMetricLabel, value: returnTabAnnualizedText, tone: returnTabAnnualizedTone },
    "wealth-overview": { label: wealthTabMonthlyGrowthLabel, value: wealthTabMonthlyGrowthText, tone: wealthTabMonthlyGrowthTone },
    "budget-fire": { label: "自由度", value: fireTabFreedomText, tone: fireTabFreedomTone },
    "income-analysis": { label: incomeTabMonthlyLabel, value: incomeTabMonthlyText, tone: incomeTabMonthlyTone },
    "consumption-analysis": { label: consumptionTabMonthlyLabel, value: consumptionTabMonthlyText, tone: consumptionTabMonthlyTone },
  };
  const quickManualAccountId = `${quickManualInvForm.account_id ?? ""}`.trim();
  const quickManualAccountHintText = !quickManualAccountId
    ? ""
    : quickManualInvAccountAssetsError
      ? quickManualInvAccountAssetsError
      : quickManualInvAccountAssetsBusy
        ? "当前总资金加载中..."
        : quickManualInvAccountAssetsCents !== null
          ? `当前总资金：${formatCentsYuanText(quickManualInvAccountAssetsCents)} 元${
              quickManualInvAccountAssetsDate ? `（${quickManualInvAccountAssetsDate}）` : ""
            }`
          : "当前总资金：暂无历史快照";
  const quickManualAccountHintToneClass = quickManualInvAccountAssetsError ? "warn-text" : "";
  const quickManualTotalAssetsInputYuan = parseYuanInputToNumber(`${quickManualInvForm.total_assets ?? ""}`);
  const quickManualTotalAssetsWanText = quickManualTotalAssetsInputYuan !== null && Math.abs(quickManualTotalAssetsInputYuan) >= 100000
    ? `${(quickManualTotalAssetsInputYuan / 10000).toFixed(2)} 万`
    : "";
  const shouldPrefetchReturnTabQuickMetric = Boolean(dbStatus?.ready) && returnTabYtdAnnualizedRate === null && !invBusy;
  const shouldPrefetchWealthTabQuickMetric = Boolean(dbStatus?.ready) && wealthCurveResult === null && !wealthCurveBusy;
  const shouldPrefetchFireTabQuickMetric = Boolean(dbStatus?.ready) && fireProgressResult === null && !fireProgressBusy;
  const shouldPrefetchIncomeTabQuickMetric = Boolean(dbStatus?.ready) && salaryIncomeResult === null && !salaryIncomeBusy;
  const shouldPrefetchConsumptionTabQuickMetric = Boolean(dbStatus?.ready) && consumptionOverviewResult === null && !consumptionOverviewBusy;
  const shouldPrefetchManualEntryTabQuickMetric = Boolean(dbStatus?.ready) && manualEntryTabMonthCount === null && !manualEntryTabMonthCountBusy;
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

  useDebouncedAutoRun(
    handleQuickManualAccountAssetsQuery,
    [quickManualInvOpen ? "open" : "closed", `${quickManualInvForm.account_id ?? ""}`],
    { enabled: quickManualInvOpen, delayMs: 180 },
  );
  useDebouncedAutoRun(
    handleConsumptionOverviewQuery,
    [consumptionYear],
    { enabled: isConsumptionAnalysisTab || shouldPrefetchConsumptionTabQuickMetric, delayMs: 220 },
  );
  useDebouncedAutoRun(
    handleInvestmentReturnQuery,
    [invQuery.account_id, invQuery.preset, invQuery.from, invQuery.to],
    { enabled: isReturnAnalysisTab || shouldPrefetchReturnTabQuickMetric, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleInvestmentCurveQuery,
    [invCurveQuery.account_id, invCurveQuery.preset, invCurveQuery.from, invCurveQuery.to],
    { enabled: isReturnAnalysisTab, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleInvestmentReturnsQuery,
    [invCurveQuery.preset ?? "ytd", invCurveQuery.from ?? "", invCurveQuery.to ?? ""],
    { enabled: isReturnAnalysisTab, delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleWealthOverviewQuery,
    [
      wealthOverviewQuery.include_investment ?? "true",
      wealthOverviewQuery.include_cash ?? "true",
      wealthOverviewQuery.include_real_estate ?? "true",
      wealthOverviewQuery.include_liability ?? "true",
    ],
    { enabled: isWealthOverviewTab, delayMs: 260 },
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
    <main className={`app-shell ${isMobileMode ? "mobile-shell" : ""}`}>
      <div
        className={`workspace-layout ${!isMobileMode && sidebarCollapsed ? "sidebar-collapsed" : ""} ${appSettings.uiMotionEnabled ? "" : "motion-disabled"} ${isMobileMode ? "mobile-layout" : ""}`}
      >
        {!isMobileMode ? (
          <WorkspaceSidebar
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            keepwiseLogoSvg={keepwiseLogoSvg}
            PRODUCT_TABS={PRODUCT_TABS}
            activeTab={activeTab}
            openQuickManualInvestmentModal={openQuickManualInvestmentModal}
            setActiveTab={setActiveTab}
            returnTabQuickMetricLabel={returnTabQuickMetricLabel}
            incomeTabMonthlyLabel={incomeTabMonthlyLabel}
            consumptionTabMonthlyLabel={consumptionTabMonthlyLabel}
            wealthTabMonthlyGrowthLabel={wealthTabMonthlyGrowthLabel}
            returnTabAnnualizedText={returnTabAnnualizedText}
            manualEntryTabMonthCountText={manualEntryTabMonthCountText}
            wealthTabMonthlyGrowthText={wealthTabMonthlyGrowthText}
            fireTabFreedomText={fireTabFreedomText}
            incomeTabMonthlyText={incomeTabMonthlyText}
            consumptionTabMonthlyText={consumptionTabMonthlyText}
            returnTabAnnualizedTone={returnTabAnnualizedTone}
            wealthTabMonthlyGrowthTone={wealthTabMonthlyGrowthTone}
            fireTabFreedomTone={fireTabFreedomTone}
            incomeTabMonthlyTone={incomeTabMonthlyTone}
            consumptionTabMonthlyTone={consumptionTabMonthlyTone}
            setSettingsOpen={setSettingsOpen}
            amountPrivacyMasked={amountPrivacyMasked}
            setAmountPrivacyMasked={setAmountPrivacyMasked}
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
          <MobileHomeGrid
            tabs={visibleTabs}
            activeTab={activeTab}
            onOpenManualEntry={openQuickManualInvestmentModal}
            onSelectTab={(tabKey: ProductTabKey) => {
              setActiveTab(tabKey);
              setMobileView(tabKey);
            }}
            quickMetricsByTab={mobileQuickMetricsByTab}
          />
        ) : null}

        {!isMobileMode || mobileView !== "home" ? <div className={`workspace-content ${isMobileMode ? "mobile-page-body" : ""}`}>
          <WorkspaceContentPanels
            activeTabMeta={activeTabMeta}
            isAdminTab={isAdminTab}
            developerMode={developerMode}
            setShowRawJson={setShowRawJson}
            setDeveloperMode={setDeveloperMode}
            showRawJson={showRawJson}
            status={status}
            isTab={isTab}
            AutoRefreshHint={AutoRefreshHint}
            consumptionOverviewBusy={consumptionOverviewBusy}
            consumptionOverviewError={consumptionOverviewError}
            ConsumptionOverviewPreview={ConsumptionOverviewPreview}
            consumptionOverviewResult={consumptionOverviewResult}
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
            handleFireProgressQuery={handleFireProgressQuery}
            fireProgressQuery={fireProgressQuery}
            setFireProgressQuery={setFireProgressQuery}
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
        acctCatalogUpsertBusy={acctCatalogUpsertBusy}
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
        handleImportRepoRuntimeDb={handleImportRepoRuntimeDb}
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
        importCenterLastRunAt={importCenterLastRunAt}
        importCenterStatus={importCenterStatus}
        importCenterMessage={importCenterMessage}
        importCenterRows={importCenterRows}
        yzxyFilePath={yzxyFilePath}
        setYzxyFilePath={setYzxyFilePath}
        handlePickYzxyFilePath={handlePickYzxyFilePath}
        yzxyPreviewBusy={yzxyPreviewBusy}
        yzxyImportBusy={yzxyImportBusy}
        yzxySourceType={yzxySourceType}
        setYzxySourceType={setYzxySourceType}
        handleYzxyPreview={handleYzxyPreview}
        handleYzxyImport={handleYzxyImport}
        yzxyPreviewError={yzxyPreviewError}
        yzxyImportError={yzxyImportError}
        yzxyPreviewResult={yzxyPreviewResult}
        yzxyImportResult={yzxyImportResult}
        PreviewStat={PreviewStat}
        showRawJson={showRawJson}
        JsonResultCard={JsonResultCard}
        emlSourcePath={emlSourcePath}
        setEmlSourcePath={setEmlSourcePath}
        handlePickEmlFile={handlePickEmlFile}
        handlePickEmlFolder={handlePickEmlFolder}
        emlPreviewBusy={emlPreviewBusy}
        emlImportBusy={emlImportBusy}
        safeNumericInputValue={safeNumericInputValue}
        emlReviewThreshold={emlReviewThreshold}
        setEmlReviewThreshold={setEmlReviewThreshold}
        parseNumericInputWithFallback={parseNumericInputWithFallback}
        emlSourceType={emlSourceType}
        setEmlSourceType={setEmlSourceType}
        handleCmbEmlPreview={handleCmbEmlPreview}
        handleCmbEmlImport={handleCmbEmlImport}
        emlPreviewError={emlPreviewError}
        emlImportError={emlImportError}
        emlPreviewResult={emlPreviewResult}
        emlImportResult={emlImportResult}
        cmbPdfPath={cmbPdfPath}
        setCmbPdfPath={setCmbPdfPath}
        handlePickCmbPdfFile={handlePickCmbPdfFile}
        cmbPdfPreviewBusy={cmbPdfPreviewBusy}
        cmbPdfImportBusy={cmbPdfImportBusy}
        cmbPdfReviewThreshold={cmbPdfReviewThreshold}
        setCmbPdfReviewThreshold={setCmbPdfReviewThreshold}
        cmbPdfSourceType={cmbPdfSourceType}
        setCmbPdfSourceType={setCmbPdfSourceType}
        handleCmbBankPdfPreview={handleCmbBankPdfPreview}
        handleCmbBankPdfImport={handleCmbBankPdfImport}
        cmbPdfPreviewError={cmbPdfPreviewError}
        cmbPdfImportError={cmbPdfImportError}
        cmbPdfPreviewResult={cmbPdfPreviewResult}
        cmbPdfImportResult={cmbPdfImportResult}
        formatCentsShort={formatCentsShort}
        YzxyPreviewSummaryReport={YzxyPreviewSummaryReport}
        YzxyImportSummaryReport={YzxyImportSummaryReport}
        CmbEmlPreviewSummaryReport={CmbEmlPreviewSummaryReport}
        CmbEmlImportSummaryReport={CmbEmlImportSummaryReport}
        CmbBankPdfPreviewSummaryReport={CmbBankPdfPreviewSummaryReport}
        CmbBankPdfImportSummaryReport={CmbBankPdfImportSummaryReport}
        RulesAdminPanel={RulesAdminPanel}
        BoolField={BoolField}
        DateInput={DateInput}
        AutoRefreshHint={AutoRefreshHint}
        maskAmountDisplayText={maskAmountDisplayText}
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
      />

      <ReturnAnalysisSection
        isTab={isTab}
        makeEnterToQueryHandler={makeEnterToQueryHandler}
        handleInvestmentReturnQuery={handleInvestmentReturnQuery}
        handleInvestmentCurveQuery={handleInvestmentCurveQuery}
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
