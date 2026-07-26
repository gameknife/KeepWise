import { Suspense, lazy, useEffect, useRef, useState } from "react";
import "react-datepicker/dist/react-datepicker.css";
import "../styles/index.css";
import { AdminDbPanel } from "../features/admin/AdminDbPanel";
import { AdminProbePanels } from "../features/admin/AdminProbePanels";
import { useDatabaseRuntimeController } from "../features/admin/useDatabaseRuntimeController";
import { useValidationController } from "../features/admin/useValidationController";
import { AccountCatalogAdminPanel } from "../features/admin/AccountCatalogAdminPanel";
import { ReturnAnalysisSection } from "../features/analytics/ReturnAnalysisSection";
import { WealthOverviewSection } from "../features/analytics/WealthOverviewSection";
import { useAccountCatalogController } from "../features/accounts/useAccountCatalogController";
import { useManualEntryController } from "../features/accounts/useManualEntryController";
import { useBudgetController } from "../features/budget/useBudgetController";
import { useConsumptionController } from "../features/consumption/useConsumptionController";
import { type ImportSource } from "../features/import/useImportCenterController";
import { useInvestmentController } from "../features/investment/useInvestmentController";
import { MobileHomeGrid } from "../features/layout/MobileHomeGrid";
import { MobileWorkspaceHeader } from "../features/layout/MobileWorkspaceHeader";
import { WorkspaceSidebar } from "../features/layout/WorkspaceSidebar";
import { WorkspaceContentPanels } from "../features/layout/WorkspaceContentPanels";
import { useSidebarMetrics } from "../features/layout/useSidebarMetrics";
import { AppGlobalModals } from "../features/modals/AppGlobalModals";
import { useRecordsController } from "../features/records/useRecordsController";
import { useSyncRuntimeController } from "../features/sync/useSyncRuntimeController";
import { useWealthController } from "../features/wealth/useWealthController";
import { useAppAutoRefresh } from "./useAppAutoRefresh";
import { useAppShellController } from "./useAppShellController";

const AdminSections = lazy(() => import("../features/admin/AdminSections").then((module) => ({ default: module.AdminSections })));
const AnalysisExportSection = lazy(() => import("../features/export/AnalysisExportSection").then((module) => ({ default: module.AnalysisExportSection })));
const ImportCenterSections = lazy(() => import("../features/import/ImportCenterSections").then((module) => ({ default: module.ImportCenterSections })));
import { configureAmountFormatting } from "./amountFormatting";
import {
  type ProductTabDef,
  type ProductTabKey,
} from "../types/app";

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

function App() {
  const [importInvalidationEpoch, setImportInvalidationEpoch] = useState(0);
  const [showRawJson, setShowRawJson] = useState(false);
  const databaseController = useDatabaseRuntimeController({
    onTransactionsReset: refreshAfterTransactionsReset,
    onAllReset: refreshAfterAllReset,
  });
  const {
    status, probe, error, dbStatus, dbStatusError, dbBusy, dbImportPath, setDbImportPath,
    dbLastResult, dbImportLastResult, refreshStatus: refreshDbStatus,
    migrate: handleRunMigrations, importSequence: runDbImportSequence,
    importFromPath: handleImportDbFromPath, pickImportPath: handlePickDbImportPath,
    refreshAdminStats: handleRefreshAdminDbStats,
    refreshHealth: handleRunRuntimeHealthCheck,
  } = databaseController;
  const wealthController = useWealthController();
  const {
    overviewResult: wealthOverviewResult,
    curveResult: wealthCurveResult,
    refreshOverview: handleWealthOverviewQuery, refreshCurve: handleWealthCurveQuery,
  } = wealthController;
  const currentYearText = String(new Date().getFullYear());
  const consumptionController = useConsumptionController();
  const {
    result: consumptionOverviewResult,
    refresh: handleConsumptionOverviewQuery,
  } = consumptionController;
  const recordsController = useRecordsController();
  const {
    refreshMeta: handleMetaAccountsQuery,
    refreshTransactions: handleTransactionsQuery,
    refreshInvestments: handleInvestmentsListQuery,
    refreshAssets: handleAssetValuationsQuery,
  } = recordsController;
  const accountCatalogController = useAccountCatalogController({
    onMutation: markLocalMutationForSync,
    onChanged: () => { void handleMetaAccountsQuery(); },
  });
  const {
    busy: acctCatalogBusy, error: acctCatalogError, result: acctCatalogResult,
    query: acctCatalogQuery, setQuery: setAcctCatalogQuery, refresh: handleAccountCatalogQuery,
    selectBusy: accountSelectCatalogBusy, selectOptions: accountSelectOptions,
    refreshSelectOptions: handleRefreshAccountSelectCatalog,
    upsertBusy: acctCatalogUpsertBusy, upsertError: acctCatalogUpsertError,
    upsertResult: acctCatalogUpsertResult, upsert: handleAccountCatalogUpsert,
    modalOpen: acctCatalogCreateOpen, modalMode: acctCatalogModalMode,
    form: acctCatalogUpsertForm, setForm: setAcctCatalogUpsertForm,
    openCreateModal: openAccountCatalogCreateModal, openRenameModal: openAccountCatalogRenameModal,
    closeModal: closeAccountCatalogCreateModal,
    deleteBusy: acctCatalogDeleteBusy, deleteError: acctCatalogDeleteError,
    deleteResult: acctCatalogDeleteResult, deletingId: acctCatalogDeletingRowId,
    remove: handleAccountCatalogDelete,
  } = accountCatalogController;
  function refreshAfterInvestmentMutation() {
    void handleInvestmentReturnQuery(); void handleInvestmentCurveQuery(); void handleInvestmentReturnsQuery();
    void handleWealthOverviewQuery(); void handleWealthCurveQuery(); void handleFireProgressQuery();
  }
  function refreshAfterAssetMutation() {
    void handleWealthOverviewQuery(); void handleWealthCurveQuery(); void handleFireProgressQuery();
  }
  const manualEntryController = useManualEntryController({
    accountOptions: accountSelectOptions,
    refreshAccountOptions: handleRefreshAccountSelectCatalog,
    refreshCatalog: handleAccountCatalogQuery,
    refreshMeta: handleMetaAccountsQuery,
    refreshInvestments: handleInvestmentsListQuery,
    refreshAssets: handleAssetValuationsQuery,
    onMutation: markLocalMutationForSync,
    onInvestmentChanged: refreshAfterInvestmentMutation,
    onAssetChanged: refreshAfterAssetMutation,
  });
  const {
    openInvestment: openQuickManualInvestmentModal,
    openAsset: openQuickManualAssetValuationModal,
    monthCountBusy: manualEntryTabMonthCountBusy, monthCount: manualEntryTabMonthCount,
    refreshMonthCount: handleRefreshManualEntryTabMonthCount,
    assetLastDateBusy: manualAssetEntryLastDateBusy, assetLastDate: manualAssetEntryLastDate,
    refreshAssetLastDate: handleRefreshManualAssetEntryLastDate,
  } = manualEntryController;
  const syncController = useSyncRuntimeController({
    onDataRefresh: refreshDataViewsAfterManualSync,
    onNeedsSettings: () => setSettingsOpen(true),
  });
  const {
    quickState: syncQuickState,
    quickTitle: syncQuickTitle,
    quickAriaLabel: syncQuickAriaLabel,
    handleQuickIndicatorClick: handleQuickSyncIndicatorClick,
  } = syncController;

  function markLocalMutationForSync() {
    syncController.markLocalMutation();
  }

  function refreshAfterTransactionsReset() {
    setImportInvalidationEpoch((epoch) => epoch + 1);
    void handleTransactionsQuery();
    void handleConsumptionOverviewQuery();
  }

  function refreshAfterAllReset() {
    setImportInvalidationEpoch((epoch) => epoch + 1);
    void handleTransactionsQuery(); void handleConsumptionOverviewQuery();
    void handleInvestmentsListQuery(); void handleAssetValuationsQuery(); void handleMetaAccountsQuery();
    void handleAccountCatalogQuery(); void handleRefreshAccountSelectCatalog();
  }

  function refreshDataViewsAfterManualSync() {
    void refreshDbStatus(); void handleRefreshAdminDbStats();
    setImportInvalidationEpoch((epoch) => epoch + 1); void handleRunRuntimeHealthCheck();
    void handleMetaAccountsQuery(); void handleAccountCatalogQuery(); void handleRefreshAccountSelectCatalog();
    void handleTransactionsQuery(); void handleInvestmentsListQuery(); void handleAssetValuationsQuery();
    void handleMonthlyBudgetItemsQuery(); void handleBudgetOverviewQuery(); void handleBudgetMonthlyReviewQuery();
    void handleSalaryIncomeOverviewQuery(); void handleConsumptionOverviewQuery();
    void handleInvestmentReturnQuery(); void handleInvestmentReturnsQuery(); void handleInvestmentCurveQuery();
    void handleWealthOverviewQuery(); void handleWealthCurveQuery(); void handleFireProgressQuery();
    void handleRefreshManualEntryTabMonthCount(); void handleRefreshManualAssetEntryLastDate();
  }

  function handleImportCompleted(source: ImportSource) {
    markLocalMutationForSync();
    void refreshDbStatus();
    void handleRefreshAdminDbStats();
    void handleRunRuntimeHealthCheck();
    void handleMetaAccountsQuery();
    void handleAccountCatalogQuery();
    void handleRefreshAccountSelectCatalog();
    if (source === "yzxy") {
      void handleInvestmentsListQuery();
      void handleInvestmentReturnsQuery();
      void handleInvestmentReturnQuery();
      void handleInvestmentCurveQuery();
      void handleWealthOverviewQuery();
      void handleWealthCurveQuery();
      return;
    }
    void handleConsumptionOverviewQuery();
    void handleTransactionsQuery();
    void handleBudgetOverviewQuery();
    void handleBudgetMonthlyReviewQuery();
    if (source === "cmb-pdf") void handleSalaryIncomeOverviewQuery();
  }

  const shellController = useAppShellController({
    tabs: PRODUCT_TABS,
    targetOs: probe?.metadata.target_os,
    manualEntry: manualEntryController,
  });
  const {
    activeTab, setActiveTab, activeTabMeta, visibleTabs,
    mobileView, setMobileView, mobileSceneSeq, mobileSceneAnimClass,
    sidebarCollapsed, setSidebarCollapsed,
    appSettings, setAppSettings,
    amountPrivacyMasked, setAmountPrivacyMasked,
    settingsOpen, setSettingsOpen,
    developerMode, setDeveloperMode,
    isMobileMode, forceDesktopLayout, isDesktopApp,
  } = shellController;
  const investmentController = useInvestmentController({
    benchmarkSource: appSettings.benchmarkMarketDataSource,
  });
  const {
    curveBusy: invCurveBusy,
    curveResult: invCurveResult,
    curveBenchmarksBusy: invCurveBenchmarksBusy,
    ytdAnnualizedRate: returnTabYtdAnnualizedRate,
    ytdNetGrowthCents: returnTabYtdNetGrowthCents,
    refreshReturn: handleInvestmentReturnQuery,
    refreshReturns: handleInvestmentReturnsQuery,
    refreshCurve: handleInvestmentCurveQuery,
    retryBenchmarks: handleRetryInvestmentCurveBenchmarks,
  } = investmentController;
  const budgetController = useBudgetController({
    fireWithdrawalRate: appSettings.fireWithdrawalRate,
    onMutation: markLocalMutationForSync,
  });
  const {
    refreshItems: handleMonthlyBudgetItemsQuery,
    refreshOverview: handleBudgetOverviewQuery,
    refreshReview: handleBudgetMonthlyReviewQuery,
    fireResult: fireProgressResult,
    refreshFire: handleFireProgressQuery,
    incomeResult: salaryIncomeResult,
    refreshIncome: handleSalaryIncomeOverviewQuery,
  } = budgetController;
  const validationController = useValidationController({
    investment: investmentController,
    wealth: wealthController,
    dbImportPath,
    importDatabase: runDbImportSequence,
    refreshHealth: handleRunRuntimeHealthCheck,
  });
  const benchmarkMarketDataSourceRef = useRef(appSettings.benchmarkMarketDataSource);
  configureAmountFormatting({
    amountPrivacyMasked,
    gainLossColorScheme: appSettings.gainLossColorScheme,
  });
  // 视图模型：将原始查询结果规整为侧边栏指标、提示文案和面板开关。
  const isReady = status === "ready";
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
  useEffect(() => {
    const prevSource = benchmarkMarketDataSourceRef.current;
    benchmarkMarketDataSourceRef.current = appSettings.benchmarkMarketDataSource;
    if (prevSource === appSettings.benchmarkMarketDataSource) return;
    if (!isReturnAnalysisTab || !invCurveResult || invCurveBusy || invCurveBenchmarksBusy) return;
    void handleRetryInvestmentCurveBenchmarks();
  }, [appSettings.benchmarkMarketDataSource, isReturnAnalysisTab, invCurveResult, invCurveBusy, invCurveBenchmarksBusy]);
  const accountSelectOptionsLoading = accountSelectCatalogBusy && accountSelectOptions.length === 0;
  const { sidebar: sidebarQuickMetricsByTab, mobile: mobileQuickMetricsByTab } = useSidebarMetrics({
    wealthCurveResult,
    wealthOverviewResult,
    fireProgressResult,
    salaryIncomeResult,
    consumptionOverviewResult,
    returnYtdAnnualizedRate: returnTabYtdAnnualizedRate,
    returnYtdNetGrowthCents: returnTabYtdNetGrowthCents,
    manualEntryMonthCountBusy: manualEntryTabMonthCountBusy,
    manualEntryMonthCount: manualEntryTabMonthCount,
    manualAssetLastDateBusy: manualAssetEntryLastDateBusy,
    manualAssetLastDate: manualAssetEntryLastDate,
  });
  const showQueryWorkbench = isAdminVisibleWorkbench;
  const showDebugJson = showRawJson && isAdminDeveloperMode;
  const queryWorkbenchHeader = isManualEntryTab
    ? { title: "手动录入", description: "集中处理投资记录与资产估值的手工录入/修改/删除，形成桌面端数据修正闭环。" }
    : { title: "数据查询与维护", description: "高级管理中的底层数据核查入口：账户元数据、投资记录与资产估值查询。" };
  const queryWorkbenchModules = isManualEntryTab
    ? ["投资记录维护", "资产估值维护"]
    : ["账户元数据查询", "投资记录查询", "资产估值查询"];
  const queryWorkbenchFlow = isManualEntryTab
    ? ["如需新增/维护账户目录，请切换到高级管理（开发者模式）", "执行写入/修改/删除", "回到收益分析或财富总览验证结果"]
    : ["先刷新管理员数据库健康", "执行基础查询定位数据问题", "在查询表格内进行修正或删除后回到业务 TAB 复查结果"];
  const queryWorkbenchGridModeClass = isManualEntryTab ? "mode-manual" : "mode-base";
  useAppAutoRefresh({
    activeTab,
    dbReady: Boolean(dbStatus?.ready),
    fireWithdrawalRate: appSettings.fireWithdrawalRate,
    isAdminTab,
    isBudgetFireTab,
    isConsumptionAnalysisTab,
    isIncomeAnalysisTab,
    isReturnAnalysisTab,
    isWealthOverviewTab,
    shouldAutoLoadAccountSelectCatalog,
    accountCatalog: accountCatalogController,
    manualEntry: manualEntryController,
    budget: budgetController,
    consumption: consumptionController,
    investment: investmentController,
    records: recordsController,
    wealth: wealthController,
  });

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
            tabs={PRODUCT_TABS}
            activeTab={activeTab}
            quickMetricsByTab={sidebarQuickMetricsByTab}
            openQuickManualInvestmentModal={openQuickManualInvestmentModal}
            openQuickManualAssetValuationModal={openQuickManualAssetValuationModal}
            setActiveTab={setActiveTab}
            setSettingsOpen={setSettingsOpen}
            amountPrivacyMasked={amountPrivacyMasked}
            setAmountPrivacyMasked={setAmountPrivacyMasked}
            syncQuickState={syncQuickState}
            syncQuickTitle={syncQuickTitle}
            syncQuickAriaLabel={syncQuickAriaLabel}
            handleQuickSyncIndicatorClick={handleQuickSyncIndicatorClick}
          />
        ) : null}

        <AppGlobalModals
          manualEntry={manualEntryController}
          accounts={accountCatalogController}
          sync={syncController}
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          isDesktopApp={isDesktopApp}
        />

        <MobileWorkspaceHeader shell={shellController} sync={syncController} />

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
            consumptionController={consumptionController}
            budgetController={budgetController}
            appSettings={appSettings}
            isMobileMode={isMobileMode}
            showDebugJson={showDebugJson}
            showQueryWorkbench={showQueryWorkbench}
            queryWorkbenchHeader={queryWorkbenchHeader}
            queryWorkbenchModules={queryWorkbenchModules}
            queryWorkbenchFlow={queryWorkbenchFlow}
          />

      <AdminProbePanels
        isAdminDeveloperMode={isAdminDeveloperMode}
        status={status}
        error={error}
        isReady={isReady}
        probe={probe}
      />

      <AccountCatalogAdminPanel
        isTab={isTab}
        handleAccountCatalogQuery={handleAccountCatalogQuery}
        acctCatalogQuery={acctCatalogQuery}
        setAcctCatalogQuery={setAcctCatalogQuery}
        openAccountCatalogCreateModal={openAccountCatalogCreateModal}
        openAccountCatalogRenameModal={openAccountCatalogRenameModal}
        acctCatalogUpsertBusy={acctCatalogUpsertBusy}
        acctCatalogModalMode={acctCatalogModalMode}
        acctCatalogBusy={acctCatalogBusy}
        acctCatalogError={acctCatalogError}
        acctCatalogDeleteError={acctCatalogDeleteError}
        acctCatalogUpsertResult={acctCatalogUpsertResult}
        showDebugJson={showDebugJson}
        acctCatalogDeleteResult={acctCatalogDeleteResult}
        acctCatalogResult={acctCatalogResult}
        acctCatalogDeleteBusy={acctCatalogDeleteBusy}
        acctCatalogDeletingRowId={acctCatalogDeletingRowId}
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

      <Suspense fallback={isTab("import-center") ? <section className="card panel">数据导入模块加载中...</section> : null}>
      <ImportCenterSections
        active={isTab("import-center")}
        invalidationEpoch={importInvalidationEpoch}
        onImported={handleImportCompleted}
      />
      </Suspense>

      <Suspense fallback={isTab("admin") ? <section className="card panel">高级管理模块加载中...</section> : null}>
      <AdminSections
        isTab={isTab}
        developerMode={developerMode}
        showDebugJson={showDebugJson}
        isAdminDeveloperMode={isAdminDeveloperMode}
        setShowRawJson={setShowRawJson}
        showRawJson={showRawJson}
        showQueryWorkbench={showQueryWorkbench}
        queryWorkbenchHeader={queryWorkbenchHeader}
        queryWorkbenchGridModeClass={queryWorkbenchGridModeClass}
        isAdminVisibleWorkbench={isAdminVisibleWorkbench}
        databaseController={databaseController}
        validationController={validationController}
        accountCatalogController={accountCatalogController}
        recordsController={recordsController}
        manualEntryController={manualEntryController}
      />
      </Suspense>

      <ReturnAnalysisSection
        isActive={isTab("return-analysis")}
        controller={investmentController}
        accountSelectOptions={accountSelectOptions}
        accountSelectOptionsLoading={accountSelectOptionsLoading}
        showRawJson={showRawJson}
      />

      <Suspense fallback={isTab("export-analysis") ? <section className="card panel">智能分析模块加载中...</section> : null}>
      <AnalysisExportSection
        isActive={isTab("export-analysis")}
        currentYearText={currentYearText}
        defaultHideAmounts={amountPrivacyMasked}
        fireWithdrawalRate={appSettings.fireWithdrawalRate}
        appSettings={appSettings}
        allowLocalCli={isDesktopApp}
      />

      <WealthOverviewSection
        isActive={isTab("wealth-overview")}
        controller={wealthController}
        isMobileMode={isMobileMode}
        showRawJson={showRawJson}
      />
      </Suspense>

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
