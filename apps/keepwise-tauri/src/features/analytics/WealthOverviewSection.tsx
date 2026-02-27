// @ts-nocheck
export function WealthOverviewSection(props: any) {
  const {
    isTab,
    wealthCurveQuery,
    makeEnterToQueryHandler,
    handleWealthOverviewQuery,
    handleWealthCurveQuery,
    setWealthCurveQuery,
    setWealthSharedAssetFilters,
    toggleWealthAssetFilter,
    DateInput,
    AutoRefreshHint,
    wealthOverviewBusy,
    wealthCurveBusy,
    wealthOverviewError,
    wealthCurveError,
    WealthOverviewPreview,
    wealthOverviewResult,
    PreviewStat,
    formatCentsShort,
    isAmountPrivacyMasked,
    WealthCurvePreview,
    wealthCurveResult,
    formatPct,
    signedMetricTone,
    formatSignedDeltaCentsShort,
    formatMonthDayLabel,
    computeMonthlyTotalAssetGrowthFromWealthCurve,
    showRawJson,
    JsonResultCard,
  } = props;
  return (
    <>
      {isTab("wealth-overview") ? <section className="card panel">
        {(() => {
          const wealthVisibility = {
            investment: wealthCurveQuery.include_investment === "true",
            cash: wealthCurveQuery.include_cash === "true",
            realEstate: wealthCurveQuery.include_real_estate === "true",
            liability: wealthCurveQuery.include_liability === "true",
          };
          return (
            <>
        <div
          className="wealth-filter-stack"
          onKeyDown={makeEnterToQueryHandler(async () => {
            await Promise.all([handleWealthOverviewQuery(), handleWealthCurveQuery()]);
          })}
        >
          <div className="wealth-filter-main-row">
            <label className="field">
              <span>趋势区间</span>
              <select
                value={wealthCurveQuery.preset}
                onChange={(e) => setWealthCurveQuery((s) => ({ ...s, preset: e.target.value }))}
              >
                <option value="ytd">年初至今</option>
                <option value="1y">近1年</option>
                <option value="3y">近3年</option>
                <option value="since_inception">成立以来</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            <div className="field wealth-asset-filter-field wealth-asset-filter-field-inline">
              <span>资产类型</span>
              <div className="wealth-asset-chip-group">
                <button
                  type="button"
                  className={`consumption-chip ${
                    wealthCurveQuery.include_investment === "true" &&
                    wealthCurveQuery.include_cash === "true" &&
                    wealthCurveQuery.include_real_estate === "true" &&
                    wealthCurveQuery.include_liability === "true"
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    setWealthSharedAssetFilters((prev) => ({
                      ...prev,
                      include_investment: "true",
                      include_cash: "true",
                      include_real_estate: "true",
                      include_liability: "true",
                    }))
                  }
                >
                  全部
                </button>
                <button
                  type="button"
                  className={`consumption-chip ${wealthCurveQuery.include_investment === "true" ? "active" : ""}`}
                  onClick={() => toggleWealthAssetFilter("include_investment")}
                >
                  投资
                </button>
                <button
                  type="button"
                  className={`consumption-chip ${wealthCurveQuery.include_cash === "true" ? "active" : ""}`}
                  onClick={() => toggleWealthAssetFilter("include_cash")}
                >
                  现金
                </button>
                <button
                  type="button"
                  className={`consumption-chip ${wealthCurveQuery.include_real_estate === "true" ? "active" : ""}`}
                  onClick={() => toggleWealthAssetFilter("include_real_estate")}
                >
                  不动产
                </button>
                <button
                  type="button"
                  className={`consumption-chip ${wealthCurveQuery.include_liability === "true" ? "active" : ""}`}
                  onClick={() => toggleWealthAssetFilter("include_liability")}
                >
                  负债
                </button>
              </div>
            </div>
          </div>
          {wealthCurveQuery.preset === "custom" ? (
            <div className="wealth-filter-date-row">
              <label className="field">
                <span>开始日期（自定义）</span>
                <DateInput
                  value={wealthCurveQuery.from}
                  onChange={(e) => setWealthCurveQuery((s) => ({ ...s, from: e.target.value }))}
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>结束日期（可选）</span>
                <DateInput
                  value={wealthCurveQuery.to}
                  onChange={(e) => setWealthCurveQuery((s) => ({ ...s, to: e.target.value }))}
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
              </label>
            </div>
          ) : null}
        </div>

        <AutoRefreshHint busy={wealthOverviewBusy || wealthCurveBusy}>调整筛选条件后将自动刷新结果。</AutoRefreshHint>

        {wealthOverviewError ? (
          <div className="inline-error" role="alert">
            {wealthOverviewError}
          </div>
        ) : null}
        {wealthCurveError ? (
          <div className="inline-error" role="alert">
            {wealthCurveError}
          </div>
        ) : null}

        <WealthOverviewPreview
          data={wealthOverviewResult}
          visibility={wealthVisibility}
          PreviewStat={PreviewStat}
          formatCentsShort={formatCentsShort}
          isAmountPrivacyMasked={isAmountPrivacyMasked}
        />
        <WealthCurvePreview
          data={wealthCurveResult}
          visibility={wealthVisibility}
          PreviewStat={PreviewStat}
          formatCentsShort={formatCentsShort}
          formatPct={formatPct}
          signedMetricTone={signedMetricTone}
          formatSignedDeltaCentsShort={formatSignedDeltaCentsShort}
          formatMonthDayLabel={formatMonthDayLabel}
          computeMonthlyTotalAssetGrowthFromWealthCurve={computeMonthlyTotalAssetGrowthFromWealthCurve}
        />

        {showRawJson ? (
          <div className="stack">
            <JsonResultCard
              title="财富总览 JSON"
              data={wealthOverviewResult}
              emptyText="暂无结果。请先执行迁移，并确认桌面数据库已有样本/真实数据。"
            />
            <JsonResultCard
              title="财富曲线 JSON"
              data={wealthCurveResult}
              emptyText="暂无结果。请先执行迁移，并确认桌面数据库已有样本/真实数据。"
            />
          </div>
        ) : null}
            </>
          );
        })()}
      </section> : null}
    </>
  );
}
