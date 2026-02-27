// @ts-nocheck
export function WorkspaceContentPanels(props: any) {
  const {
    activeTabMeta,
    isAdminTab,
    developerMode,
    setShowRawJson,
    setDeveloperMode,
    showRawJson,
    status,
    isTab,
    AutoRefreshHint,
    consumptionOverviewBusy,
    consumptionOverviewError,
    ConsumptionOverviewPreview,
    consumptionOverviewResult,
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
    handleFireProgressQuery,
    fireProgressQuery,
    setFireProgressQuery,
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
  } = props;

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
                      setDeveloperMode((v) => !v);
                    }}
                  >
                    {developerMode ? "关闭开发者模式" : "打开开发者模式"}
                  </button>
                  {developerMode ? (
                    <button type="button" className="secondary-btn" onClick={() => setShowRawJson((v) => !v)}>
                      {showRawJson ? "隐藏原始 JSON" : "显示原始 JSON"}
                    </button>
                  ) : null}
                  <div className={`status-pill status-${developerMode ? "loading" : "idle"}`}>
                    开发者模式 {developerMode ? "ON" : "OFF"}
                  </div>
                </>
              ) : null}
              <div className={`status-pill status-${status}`}>桌面 {status.toUpperCase()}</div>
            </div>
          </section>

          {isTab("consumption-analysis") ? (
            <section className="card panel">
              <div className="panel-header">
                <h2>消费分析</h2>
                <p>按年度查看消费分析（分类分布、月度趋势、商户分布），支持交易检索与剔除管理。</p>
              </div>

              <AutoRefreshHint busy={consumptionOverviewBusy}>消费总览已启用自动刷新：切换年份、导入或剔除后自动更新。</AutoRefreshHint>

              {consumptionOverviewError ? (
                <div className="inline-error" role="alert">
                  {consumptionOverviewError}
                </div>
              ) : null}

              <ConsumptionOverviewPreview
                data={consumptionOverviewResult}
                selectedYear={consumptionYear}
                onYearChange={setConsumptionYear}
                formatCentsShort={formatCentsShort}
                PreviewStat={PreviewStat}
                LineAreaChart={LineAreaChart}
                SortableHeaderButton={SortableHeaderButton}
                nextSortState={nextSortState}
                compareSortValues={compareSortValues}
                onExcludeTransaction={async (id, action, reason) => {
                  try {
                    await updateTransactionAnalysisExclusion({ id, action, reason });
                    void handleConsumptionOverviewQuery();
                  } catch (err) {
                    consumptionOverview.setError(toErrorMessage(err));
                  }
                }}
                onMerchantCategoryChange={async (merchant, expenseCategory) => {
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
              <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleFireProgressQuery)}>
                <label className="field">
                  <span>提取率（0~1）</span>
                  <select
                    value={`${fireProgressQuery.withdrawal_rate ?? ""}`}
                    onChange={(e) => setFireProgressQuery((s) => ({ ...s, withdrawal_rate: e.target.value }))}
                  >
                    <option value="0.03">3%</option>
                    <option value="0.04">4%</option>
                    <option value="0.05">5%</option>
                  </select>
                </label>
              </div>
              <AutoRefreshHint busy={fireProgressBusy}>进入本 TAB 或调整参数后将自动刷新结果。</AutoRefreshHint>
              {fireProgressError ? <div className="inline-error" role="alert">{fireProgressError}</div> : null}
              <FireProgressPreview
                data={fireProgressResult}
                PreviewStat={PreviewStat}
                formatCentsShort={formatCentsShort}
                signedMetricTone={signedMetricTone}
              />
              {showRawJson ? <JsonResultCard title="FIRE 进度 JSON" data={fireProgressResult} emptyText="暂无 FIRE 进度结果。" /> : null}
            </section>
          ) : null}

          {isTab("income-analysis") ? (
            <section className="card panel">
              <div className="query-form-grid query-form-grid-compact">
                <label className="field">
                  <span>年份</span>
                  <select
                    value={`${salaryIncomeQuery.year ?? currentYearText}`}
                    onChange={(e) => setSalaryIncomeQuery((s) => ({ ...s, year: e.target.value }))}
                  >
                    {budgetYearOptions.map((year) => (
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
            <section className="card panel">
              <div className="panel-header">
                <h2>预算概览与复盘</h2>
                <p>按年份查看预算执行情况与月度复盘明细，用于跟踪全年预算节奏。</p>
              </div>

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
                    onChange={(e) => {
                      const nextYear = e.target.value;
                      setBudgetOverviewQuery((s) => ({ ...s, year: nextYear }));
                      setBudgetReviewQuery((s) => ({ ...s, year: nextYear }));
                    }}
                  >
                    {budgetYearOptions.map((year) => (
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
                PreviewStat={PreviewStat}
                formatCentsShort={formatCentsShort}
                signedMetricTone={signedMetricTone}
              />
              <BudgetMonthlyReviewPreview
                data={budgetReviewResult}
                PreviewStat={PreviewStat}
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
                <h2>预算项管理</h2>
                <p>默认展示预算项列表；支持行内删除与新建预算项。变更后会自动刷新预算概览、月度复盘与 FIRE 进度。</p>
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
                onDeleteRow={(id, name) => {
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
                    onClick={(e) => e.stopPropagation()}
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
                          onChange={(e) => setBudgetItemForm((s) => ({ ...s, id: "", name: e.target.value }))}
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

                    <p className="inline-hint">新建后将自动刷新预算项列表、预算概览、月度复盘与 FIRE 进度。</p>

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
