type ReturnAnalysisSectionProps = Record<string, unknown>;
type LooseUiEvent = {
  target: EventTarget & { value?: string; checked?: boolean };
  currentTarget: { getBoundingClientRect: () => DOMRect; select?: () => void };
  clientX?: number;
  clientY?: number;
  stopPropagation: () => void;
};

export function ReturnAnalysisSection(props: ReturnAnalysisSectionProps) {
  const {
    isTab,
    makeEnterToQueryHandler,
    handleInvestmentReturnQuery,
    handleInvestmentCurveQuery,
    handleRetryInvestmentCurveBenchmarks,
    handleInvestmentReturnsQuery,
    AccountIdSelect,
    invCurveQuery,
    setInvestmentAnalysisSharedQuery,
    accountSelectOptions,
    accountSelectOptionsLoading,
    DateInput,
    AutoRefreshHint,
    invBusy,
    invCurveBusy,
    invBatchBusy,
    invError,
    invCurveError,
    invCurveBenchmarksBusy,
    invBatchError,
    InvestmentCurvePreview,
    invCurveResult,
    invResult,
    formatCentsShort,
    formatRatePct,
    signedMetricTone,
    PreviewStat,
    LineAreaChart,
    InvestmentReturnsPreview,
    invBatchResult,
    formatPresetLabel,
    SortableHeaderButton,
    nextSortState,
    compareSortValues,
    showRawJson,
    JsonResultCard,
  } = props as Record<string, any>;
  return (
    <>
      {isTab("return-analysis") ? <section className="card panel panel-flat-content panel-return-analysis">
        <div
          className="query-form-grid"
          onKeyDown={makeEnterToQueryHandler(async () => {
            await Promise.all([handleInvestmentReturnQuery(), handleInvestmentCurveQuery(), handleInvestmentReturnsQuery()]);
          })}
        >
          <label className="field">
            <span>账户</span>
            <AccountIdSelect
              value={invCurveQuery.account_id}
              onChange={(value: string) =>
                setInvestmentAnalysisSharedQuery((s: Record<string, any>) => ({
                  ...s,
                  account_id: value,
                }))
              }
              options={accountSelectOptions}
              kinds={["investment"]}
              includePortfolio
              portfolioLabel="投资组合（全部投资账户）"
              emptyLabel={accountSelectOptionsLoading ? "加载账户中..." : "请选择账户"}
              disabled={accountSelectOptionsLoading}
            />
          </label>
          <label className="field">
            <span>预设区间</span>
            <select
              value={invCurveQuery.preset}
              onChange={(e: LooseUiEvent) =>
                setInvestmentAnalysisSharedQuery((s: Record<string, any>) => ({
                  ...s,
                  preset: e.target.value,
                }))
              }
            >
              <option value="ytd">年初至今</option>
              <option value="3m">近三月</option>
              <option value="6m">近半年</option>
              <option value="1y">近1年</option>
              <option value="3y">近3年</option>
              <option value="since_inception">成立以来</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          {invCurveQuery.preset === "custom" ? (
            <>
              <label className="field">
                <span>开始日期（自定义）</span>
                <DateInput
                  value={invCurveQuery.from}
                  onChange={(e: LooseUiEvent) =>
                    setInvestmentAnalysisSharedQuery((s: Record<string, any>) => ({
                      ...s,
                      from: e.target.value,
                    }))
                  }
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>结束日期（可选）</span>
                <DateInput
                  value={invCurveQuery.to}
                  onChange={(e: LooseUiEvent) =>
                    setInvestmentAnalysisSharedQuery((s: Record<string, any>) => ({
                      ...s,
                      to: e.target.value,
                    }))
                  }
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
              </label>
            </>
          ) : null}
        </div>

        <AutoRefreshHint busy={invBusy || invCurveBusy || invBatchBusy}>调整筛选条件后将自动刷新结果。</AutoRefreshHint>
        {invError ? <div className="inline-error" role="alert">{invError}</div> : null}
        {invCurveError ? <div className="inline-error" role="alert">{invCurveError}</div> : null}
        {invBatchError ? <div className="inline-error" role="alert">{invBatchError}</div> : null}

        <InvestmentCurvePreview
          data={invCurveResult}
          returnData={invResult}
          onRetryBenchmarks={handleRetryInvestmentCurveBenchmarks}
          benchmarkRetryBusy={invCurveBenchmarksBusy}
          formatCentsShort={formatCentsShort}
          formatRatePct={formatRatePct}
          signedMetricTone={signedMetricTone}
          PreviewStat={PreviewStat}
          LineAreaChart={LineAreaChart}
        />
        <InvestmentReturnsPreview
          data={invBatchResult}
          listOnly
          formatCentsShort={formatCentsShort}
          formatPresetLabel={formatPresetLabel}
          PreviewStat={PreviewStat}
          SortableHeaderButton={SortableHeaderButton}
          nextSortState={nextSortState}
          compareSortValues={compareSortValues}
        />
        {showRawJson ? (
          <div className="stack">
            <JsonResultCard title="投资区间收益率 JSON" data={invResult} emptyText="暂无结果。请先执行数据库迁移后再查询。" />
            <JsonResultCard title="投资曲线 JSON" data={invCurveResult} emptyText="暂无结果。请先执行数据库迁移后再查询。" />
            <JsonResultCard
              title="投资收益率对比 JSON"
              data={invBatchResult}
              emptyText="暂无结果。请先导入桌面数据库后再查询账户收益率对比。"
            />
          </div>
        ) : null}
      </section> : null}

    </>
  );
}
