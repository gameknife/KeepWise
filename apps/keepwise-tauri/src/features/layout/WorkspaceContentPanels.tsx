type WorkspaceContentPanelsProps = Record<string, unknown>;
type LooseUiEvent = {
  target: EventTarget & { value?: string; checked?: boolean };
  currentTarget: { getBoundingClientRect: () => DOMRect; select?: () => void };
  clientX?: number;
  clientY?: number;
  stopPropagation: () => void;
};

export function WorkspaceContentPanels(props: WorkspaceContentPanelsProps) {
  const {
    activeTabMeta,
    isAdminTab,
    developerMode,
    setShowRawJson,
    setDeveloperMode,
    showRawJson,
    isTab,
    AutoRefreshHint,
    consumptionOverviewBusy,
    consumptionOverviewError,
    ConsumptionOverviewPreview,
    consumptionOverviewResult,
    appSettings,
    isMobileMode,
    confirmTransactionReview,
    consumptionYear,
    setConsumptionYear,
    formatCentsShort,
    PreviewStat,
    LineAreaChart,
    SortableHeaderButton,
    nextSortState,
    compareSortValues,
    updateTransactionAnalysisExclusion,
    handleConsumptionOverviewQuery,
    consumptionOverview,
    toErrorMessage,
    setConsumptionCategoryUpdatingMerchant,
    upsertMerchantMapRule,
    consumptionCategoryUpdatingMerchant,
    showDebugJson,
    JsonResultCard,
    showQueryWorkbench,
    queryWorkbenchHeader,
    queryWorkbenchModules,
    queryWorkbenchFlow,
    makeEnterToQueryHandler,
    fireProgressBusy,
    fireProgressError,
    FireProgressPreview,
    fireProgressResult,
    signedMetricTone,
    salaryIncomeQuery,
    setSalaryIncomeQuery,
    salaryIncomeBusy,
    salaryIncomeError,
    SalaryIncomeOverviewPreview,
    salaryIncomeResult,
    handleBudgetOverviewQuery,
    handleBudgetMonthlyReviewQuery,
    budgetOverviewQuery,
    budgetReviewQuery,
    currentYearText,
    setBudgetOverviewQuery,
    setBudgetReviewQuery,
    budgetYearOptions,
    budgetOverviewBusy,
    budgetReviewBusy,
    budgetOverviewError,
    budgetReviewError,
    BudgetOverviewPreview,
    budgetOverviewResult,
    BudgetMonthlyReviewPreview,
    budgetReviewResult,
    openBudgetItemCreateModal,
    budgetItemUpsertBusy,
    budgetItemsBusy,
    budgetItemsError,
    budgetItemDeleteError,
    budgetItemUpsertError,
    budgetItemUpsertResult,
    budgetItemDeleteResult,
    BudgetItemsPreview,
    budgetItemsResult,
    budgetItemDeleteBusy,
    budgetItemDeletingRowId,
    handleDeleteMonthlyBudgetItem,
    budgetItemCreateOpen,
    closeBudgetItemCreateModal,
    BoolField,
    budgetItemForm,
    setBudgetItemForm,
    handleUpsertMonthlyBudgetItem,
  } = props as Record<string, any>;

  return (
    <>
          <section className="card workspace-tab-header">
            <div>
              <p className="eyebrow">工作区</p>
              <h2>{activeTabMeta.label}</h2>
              <p className="workspace-tab-copy">{activeTabMeta.subtitle}</p>
            </div>
            <div className="workspace-tab-actions">
              {isAdminTab ? (
                <>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      if (developerMode) {
                        setShowRawJson(false);
                      }
                      setDeveloperMode((v: string) => !v);
                    }}
                  >
                    {developerMode ? "关闭开发者模式" : "打开开发者模式"}
                  </button>
                  {developerMode ? (
                    <button type="button" className="secondary-btn" onClick={() => setShowRawJson((v: string) => !v)}>
                      {showRawJson ? "隐藏原始 JSON" : "显示原始 JSON"}
                    </button>
                  ) : null}
                  <div className={`status-pill status-${developerMode ? "loading" : "idle"}`}>
                    开发者模式 {developerMode ? "ON" : "OFF"}
                  </div>
                </>
              ) : null}
            </div>
          </section>

          {isTab("consumption-analysis") ? (
            <section className="card panel panel-flat-content panel-consumption-analysis">
              <AutoRefreshHint busy={consumptionOverviewBusy}>消费总览已启用自动刷新：切换年份、导入或剔除后自动更新。</AutoRefreshHint>

              {consumptionOverviewError ? (
                <div className="inline-error" role="alert">
                  {consumptionOverviewError}
                </div>
              ) : null}

              <ConsumptionOverviewPreview
                data={consumptionOverviewResult}
                appSettings={appSettings}
                isMobileMode={isMobileMode}
                selectedYear={consumptionYear}
                onYearChange={setConsumptionYear}
                flat
                formatCentsShort={formatCentsShort}
                PreviewStat={PreviewStat}
                LineAreaChart={LineAreaChart}
                SortableHeaderButton={SortableHeaderButton}
                nextSortState={nextSortState}
                compareSortValues={compareSortValues}
                onExcludeTransaction={async (id: string, action: string, reason: string) => {
                  try {
                    await updateTransactionAnalysisExclusion({ id, action, reason });
                    void handleConsumptionOverviewQuery();
                  } catch (err) {
                    consumptionOverview.setError(toErrorMessage(err));
                  }
                }}
                onConfirmTransactionReview={async (id: string) => {
                  try {
                    await confirmTransactionReview({ id });
                    void handleConsumptionOverviewQuery();
                  } catch (err) {
                    consumptionOverview.setError(toErrorMessage(err));
                  }
                }}
                onMerchantCategoryChange={async (merchant: string, expenseCategory: string) => {
                  setConsumptionCategoryUpdatingMerchant(merchant);
                  try {
                    await upsertMerchantMapRule({
                      merchant_normalized: merchant,
                      expense_category: expenseCategory,
                      confidence: "0.95",
                      note: "消费分析页快捷改分类",
                    });
                    void handleConsumptionOverviewQuery();
                  } catch (err) {
                    consumptionOverview.setError(toErrorMessage(err));
                  } finally {
                    setConsumptionCategoryUpdatingMerchant("");
                  }
                }}
                merchantCategoryUpdatingMerchant={consumptionCategoryUpdatingMerchant}
              />
              {showDebugJson ? (
                <JsonResultCard
                  title="消费总览 JSON"
                  data={consumptionOverviewResult}
                  emptyText="暂无消费总览结果。请先导入招行 EML / 招行 PDF 后再刷新。"
                />
              ) : null}
            </section>
          ) : null}

          {showQueryWorkbench ? (
            <section className="card panel workbench-intro-panel">
              <div className="panel-header">
                <h2>{queryWorkbenchHeader.title} 导览</h2>
                <p>{queryWorkbenchHeader.description}</p>
              </div>
              <div className="workbench-module-strip">
                {queryWorkbenchModules.map((label: string) => (
                  <span key={label} className="workbench-module-pill">{label}</span>
                ))}
              </div>
              <ol className="workbench-flow-list">
                {queryWorkbenchFlow.map((step: string) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel panel-flat-content panel-fire-progress">
              <AutoRefreshHint busy={fireProgressBusy}>进入本 TAB 或在设置中调整 FIRE 提取率后将自动刷新结果。</AutoRefreshHint>
              {fireProgressError ? <div className="inline-error" role="alert">{fireProgressError}</div> : null}
              <FireProgressPreview
                data={fireProgressResult}
                flat
                PreviewStat={PreviewStat}
                formatCentsShort={formatCentsShort}
              />
              {showRawJson ? <JsonResultCard title="FIRE 进度 JSON" data={fireProgressResult} emptyText="暂无 FIRE 进度结果。" /> : null}
            </section>
          ) : null}

          {isTab("income-analysis") ? (
            <section className="card panel panel-flat-content panel-income-analysis">
              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>年份</span>
                  <select
                    value={`${salaryIncomeQuery.year ?? currentYearText}`}
                    onChange={(e: LooseUiEvent) => setSalaryIncomeQuery((s: Record<string, any>) => ({ ...s, year: e.target.value }))}
                  >
                    {budgetYearOptions.map((year: string) => (
                      <option key={year} value={year}>
                        {year}年
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <AutoRefreshHint busy={salaryIncomeBusy}>调整筛选条件后将自动刷新结果。</AutoRefreshHint>

              {salaryIncomeError ? <div className="inline-error" role="alert">{salaryIncomeError}</div> : null}
              <SalaryIncomeOverviewPreview
                data={salaryIncomeResult}
                formatCentsShort={formatCentsShort}
                PreviewStat={PreviewStat}
                LineAreaChart={LineAreaChart}
                SortableHeaderButton={SortableHeaderButton}
                nextSortState={nextSortState}
                compareSortValues={compareSortValues}
              />
              {showRawJson ? (
                <JsonResultCard title="工资收入概览 JSON" data={salaryIncomeResult} emptyText="暂无结果。请先导入招行银行流水后再查询。" />
              ) : null}
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel panel-flat-content">
              <div
                className="query-form-grid query-form-grid-compact"
                onKeyDown={makeEnterToQueryHandler(async () => {
                  await Promise.all([handleBudgetOverviewQuery(), handleBudgetMonthlyReviewQuery()]);
                })}
              >
                <label className="field">
                  <span>年份</span>
                  <select
                    value={`${budgetOverviewQuery.year ?? budgetReviewQuery.year ?? currentYearText}`}
                    onChange={(e: LooseUiEvent) => {
                      const nextYear = e.target.value;
                      setBudgetOverviewQuery((s: Record<string, any>) => ({ ...s, year: nextYear }));
                      setBudgetReviewQuery((s: Record<string, any>) => ({ ...s, year: nextYear }));
                    }}
                  >
                    {budgetYearOptions.map((year: string) => (
                      <option key={year} value={year}>
                        {year}年
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <AutoRefreshHint busy={budgetOverviewBusy || budgetReviewBusy}>进入本 TAB 或调整年份后将自动刷新结果。</AutoRefreshHint>
              {budgetOverviewError ? <div className="inline-error" role="alert">{budgetOverviewError}</div> : null}
              {budgetReviewError ? <div className="inline-error" role="alert">{budgetReviewError}</div> : null}
              <BudgetOverviewPreview
                data={budgetOverviewResult}
                flat
                PreviewStat={PreviewStat}
                formatCentsShort={formatCentsShort}
                signedMetricTone={signedMetricTone}
              />
              <BudgetMonthlyReviewPreview
                data={budgetReviewResult}
                flat
                SortableHeaderButton={SortableHeaderButton}
                formatCentsShort={formatCentsShort}
                nextSortState={nextSortState}
                compareSortValues={compareSortValues}
              />
              {showRawJson ? (
                <div className="stack">
                  <JsonResultCard title="预算概览 JSON" data={budgetOverviewResult} emptyText="暂无预算概览结果。" />
                  <JsonResultCard title="预算月度复盘 JSON" data={budgetReviewResult} emptyText="暂无预算月度复盘结果。" />
                </div>
              ) : null}
            </section>
          ) : null}

          {isTab("budget-fire") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>预算项</h2>
              </div>
              <div className="db-actions">
                <button type="button" className="secondary-btn" onClick={openBudgetItemCreateModal} disabled={budgetItemUpsertBusy}>
                  新建预算项
                </button>
              </div>
              <AutoRefreshHint busy={budgetItemsBusy}>进入本 TAB 会自动加载预算项；新增或删除后将自动刷新列表与相关分析结果。</AutoRefreshHint>

              {budgetItemsError ? <div className="inline-error" role="alert">{budgetItemsError}</div> : null}
              {budgetItemDeleteError ? <div className="inline-error" role="alert">{budgetItemDeleteError}</div> : null}
              {budgetItemUpsertError && !budgetItemCreateOpen ? <div className="inline-error" role="alert">{budgetItemUpsertError}</div> : null}

              {budgetItemUpsertResult && showDebugJson ? <JsonResultCard title="预算项写入结果" data={budgetItemUpsertResult} emptyText="暂无结果。" /> : null}
              {budgetItemDeleteResult && showDebugJson ? <JsonResultCard title="预算项删除结果" data={budgetItemDeleteResult} emptyText="暂无结果。" /> : null}

              <BudgetItemsPreview
                data={budgetItemsResult}
                deleteBusy={budgetItemDeleteBusy}
                deletingItemId={budgetItemDeletingRowId}
                SortableHeaderButton={SortableHeaderButton}
                formatCentsShort={formatCentsShort}
                nextSortState={nextSortState}
                compareSortValues={compareSortValues}
                onDeleteRow={(id: string, name: string) => {
                  const ok = window.confirm(`确认删除预算项「${name}」？\n${id}`);
                  if (!ok) return;
                  void handleDeleteMonthlyBudgetItem(id);
                }}
              />
              {showRawJson ? (
                <JsonResultCard title="预算项列表 JSON" data={budgetItemsResult} emptyText="暂无预算项结果。" />
              ) : null}

              {budgetItemCreateOpen ? (
                <div className="kw-modal-overlay" role="presentation" onClick={closeBudgetItemCreateModal}>
                  <div
                    className="kw-modal-card"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="budget-item-create-modal-title"
                    onClick={(e: LooseUiEvent) => e.stopPropagation()}
                  >
                    <div className="kw-modal-head">
                      <div>
                        <p className="eyebrow">预算项管理</p>
                        <h3 id="budget-item-create-modal-title">新建预算项</h3>
                      </div>
                      <button type="button" className="secondary-btn table-inline-btn" onClick={closeBudgetItemCreateModal} disabled={budgetItemUpsertBusy}>
                        关闭
                      </button>
                    </div>

                    <div className="query-form-grid query-form-grid-compact">
                      <label className="field">
                        <span>预算项名称</span>
                        <input
                          autoFocus
                          value={`${budgetItemForm.name ?? ""}`}
                          onChange={(e: LooseUiEvent) => setBudgetItemForm((s: Record<string, any>) => ({ ...s, id: "", name: e.target.value }))}
                          placeholder="如：日常开销"
                        />
                      </label>
                      <label className="field">
                        <span>月预算金额（元）</span>
                        <input
                          value={`${budgetItemForm.monthly_amount ?? ""}`}
                          onChange={(e: LooseUiEvent) => setBudgetItemForm((s: Record<string, any>) => ({ ...s, monthly_amount: e.target.value }))}
                          placeholder="3000.00"
                        />
                      </label>
                      <label className="field">
                        <span>排序</span>
                        <input
                          value={`${budgetItemForm.sort_order ?? ""}`}
                          onChange={(e: LooseUiEvent) => setBudgetItemForm((s: Record<string, any>) => ({ ...s, sort_order: e.target.value }))}
                          placeholder="1000"
                        />
                      </label>
                      <BoolField
                        label="是否启用"
                        value={budgetItemForm.is_active ?? "true"}
                        onChange={(value: string) => setBudgetItemForm((s: Record<string, any>) => ({ ...s, is_active: value }))}
                      />
                    </div>

                    {budgetItemUpsertError ? <div className="inline-error" role="alert">{budgetItemUpsertError}</div> : null}

                    <div className="db-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => void handleUpsertMonthlyBudgetItem()}
                        disabled={
                          budgetItemUpsertBusy ||
                          !`${budgetItemForm.name ?? ""}`.trim() ||
                          !`${budgetItemForm.monthly_amount ?? ""}`.trim()
                        }
                      >
                        {budgetItemUpsertBusy ? "保存中..." : "保存预算项"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
    </>
  );
}
