// @ts-nocheck
export function AdminSections(props: any) {
  const {
    isTab,
    handleRefreshAdminDbStats,
    adminDbStatsBusy,
    dbBusy,
    adminDbStatsLastRunAt,
    adminDbStatsError,
    AdminDbStatsPreview,
    adminDbStatsResult,
    PreviewStat,
    SortableHeaderButton,
    nextSortState,
    compareSortValues,
    developerMode,
    readString,
    adminResetConfirmText,
    setAdminResetConfirmText,
    handleAdminResetTransactions,
    adminResetTxBusy,
    adminResetAllBusy,
    handleAdminResetAll,
    adminResetTxError,
    adminResetAllError,
    adminResetTxResult,
    adminResetAllResult,
    showDebugJson,
    JsonResultCard,
    isAdminDeveloperMode,
    handleRunValidationPipeline,
    pipelineBusy,
    smokeBusy,
    handleRunCoreAnalyticsSmoke,
    setShowRawJson,
    showRawJson,
    smokeLastRunAt,
    pipelineStatus,
    pipelineLastRunAt,
    pipelineMessage,
    smokeRows,
    handleRunRuntimeHealthCheck,
    runtimeHealthBusy,
    runtimeHealthLastRunAt,
    runtimeHealthError,
    RuntimeHealthPreview,
    runtimeHealthResult,
    showQueryWorkbench,
    queryWorkbenchHeader,
    queryWorkbenchGridModeClass,
    DateInput,
    AccountIdSelect,
    accountSelectOptions,
    accountSelectOptionsLoading,
    deleteInvId,
    deleteInvBusy,
    accountKindsForAssetClass,
    isAdminVisibleWorkbench,
    metaAccountsQuery,
    setMetaAccountsQuery,
    AutoRefreshHint,
    metaAccountsBusy,
    metaAccountsError,
    MetaAccountsPreview,
    metaAccountsResult,
    makeEnterToQueryHandler,
    handleInvestmentsListQuery,
    safeNumericInputValue,
    invListQuery,
    setInvListQuery,
    parseNumericInputWithFallback,
    invListBusy,
    invListError,
    InvestmentsListPreview,
    invListResult,
    formatCentsShort,
    prefillInvestmentUpdateFormFromRow,
    handleDeleteInvestmentRecordById,
    handleAssetValuationsQuery,
    assetListQuery,
    setAssetListQuery,
    assetListBusy,
    assetListError,
    AssetValuationsPreview,
    assetListResult,
  } = props;
  return (
    <>
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

        <AdminDbStatsPreview
          data={adminDbStatsResult}
          PreviewStat={PreviewStat}
          SortableHeaderButton={SortableHeaderButton}
          nextSortState={nextSortState}
          compareSortValues={compareSortValues}
        />
        {!developerMode ? (
          <p className="inline-hint">更多管理员操作（重置、运行库健康检查、验证流程等）已隐藏。打开“开发者模式”后可见。</p>
        ) : null}
        {developerMode ? <div className="subcard danger-zone">
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
        </div> : null}
        {showDebugJson ? (
          <JsonResultCard
            title="管理员数据库统计 JSON"
            data={adminDbStatsResult}
            emptyText="暂无管理员数据库统计。请先初始化/导入桌面数据库后再刷新。"
          />
        ) : null}
      </section> : null}

      {isAdminDeveloperMode ? <section className="card panel">
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

      {isAdminDeveloperMode ? <section className="card panel">
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

        <RuntimeHealthPreview
          data={runtimeHealthResult}
          PreviewStat={PreviewStat}
        />
        {showRawJson ? (
          <JsonResultCard
            title="运行库健康检查 JSON"
            data={runtimeHealthResult}
            emptyText="暂无运行库健康检查结果。请先初始化/导入桌面数据库后再执行健康检查。"
          />
        ) : null}
      </section> : null}



      {showQueryWorkbench ? <section className="card panel workbench-shell-panel">
        <div className="panel-header">
          <h2>{queryWorkbenchHeader.title}</h2>
          <p>按功能分区展示操作面板，优先支持“查询 → 校正 → 复查”的桌面工作流。</p>
        </div>

        <div className={`workbench-card-grid ${queryWorkbenchGridModeClass}`}>
                    {isAdminVisibleWorkbench ? <div className="subcard workbench-span-full">
            <h3>账户元数据查询</h3>
            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>类型</span>
                <select
                  value={metaAccountsQuery.kind ?? "all"}
                  onChange={(e) =>
                    setMetaAccountsQuery({
                      kind: e.target.value as any,
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
            <AutoRefreshHint busy={metaAccountsBusy}>账户元数据已启用自动刷新：进入高级管理或修改筛选后会自动更新。</AutoRefreshHint>
            {metaAccountsError ? (
              <div className="inline-error" role="alert">
                {metaAccountsError}
              </div>
            ) : null}
            <MetaAccountsPreview
              data={metaAccountsResult}
              PreviewStat={PreviewStat}
              SortableHeaderButton={SortableHeaderButton}
              nextSortState={nextSortState}
              compareSortValues={compareSortValues}
            />
            {showDebugJson ? (
              <JsonResultCard
                title="账户元数据 JSON"
                data={metaAccountsResult}
                emptyText="暂无结果。请先查询账户元数据。"
              />
            ) : null}
          </div> : null}



          {isAdminVisibleWorkbench ? <div className="subcard workbench-span-full">
            <h3>投资记录查询</h3>
            <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleInvestmentsListQuery)}>
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(invListQuery.limit, 30)}
                  onChange={(e) =>
                    setInvListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "30", 30),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>开始日期</span>
                <DateInput
                  value={`${invListQuery.from ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, from: e.target.value }))}
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>结束日期</span>
                <DateInput
                  value={`${invListQuery.to ?? ""}`}
                  onChange={(e) => setInvListQuery((s) => ({ ...s, to: e.target.value }))}
                  type="date"
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
                <AccountIdSelect
                  value={`${invListQuery.account_id ?? ""}`}
                  onChange={(value) => setInvListQuery((s) => ({ ...s, account_id: value }))}
                  options={accountSelectOptions}
                  kinds={["investment"]}
                  emptyLabel={accountSelectOptionsLoading ? "加载账户中..." : "全部投资账户"}
                  disabled={accountSelectOptionsLoading}
                />
              </label>
            </div>
            <AutoRefreshHint busy={invListBusy}>投资记录列表已启用自动刷新：进入高级管理或修改筛选后会自动更新。</AutoRefreshHint>
            {invListError ? (
              <div className="inline-error" role="alert">
                {invListError}
              </div>
            ) : null}
            <InvestmentsListPreview
              data={invListResult}
              deleteBusy={deleteInvBusy}
              deletingId={deleteInvId}
              formatCentsShort={formatCentsShort}
              PreviewStat={PreviewStat}
              SortableHeaderButton={SortableHeaderButton}
              nextSortState={nextSortState}
              compareSortValues={compareSortValues}
              onEditRow={(row) => {
                prefillInvestmentUpdateFormFromRow(row);
              }}
              onDeleteRow={(id, row) => {
                const accountName =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (typeof row.account_id === "string" ? row.account_id : "该记录");
                const snapshotDate = typeof row.snapshot_date === "string" ? row.snapshot_date : "-";
                const ok = window.confirm(`确认删除投资记录？\n${accountName} · ${snapshotDate}\nID: ${id}`);
                if (!ok) return;
                void handleDeleteInvestmentRecordById(id);
              }}
            />
            <p className="inline-hint">可在表格行内点击“修正”打开弹窗修改，或直接删除该条投资记录。</p>
            {showDebugJson ? (
              <JsonResultCard title="投资记录查询 JSON" data={invListResult} emptyText="暂无结果。请先查询投资记录。" />
            ) : null}
          </div> : null}

          {isAdminVisibleWorkbench ? <div className="subcard workbench-span-full">
            <h3>资产估值查询</h3>
            <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleAssetValuationsQuery)}>
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={safeNumericInputValue(assetListQuery.limit, 30)}
                  onChange={(e) =>
                    setAssetListQuery((s) => ({
                      ...s,
                      limit: parseNumericInputWithFallback(e.target.value || "30", 30),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>开始日期</span>
                <DateInput
                  value={`${assetListQuery.from ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, from: e.target.value }))}
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
              </label>
              <label className="field">
                <span>结束日期</span>
                <DateInput
                  value={`${assetListQuery.to ?? ""}`}
                  onChange={(e) => setAssetListQuery((s) => ({ ...s, to: e.target.value }))}
                  type="date"
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
                      asset_class: e.target.value as any,
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
                <AccountIdSelect
                  value={`${assetListQuery.account_id ?? ""}`}
                  onChange={(value) => setAssetListQuery((s) => ({ ...s, account_id: value }))}
                  options={accountSelectOptions}
                  kinds={accountKindsForAssetClass(assetListQuery.asset_class ?? "") ?? undefined}
                  emptyLabel={accountSelectOptionsLoading ? "加载账户中..." : "全部账户"}
                  disabled={accountSelectOptionsLoading}
                />
              </label>
            </div>
            <AutoRefreshHint busy={assetListBusy}>资产估值列表已启用自动刷新：进入高级管理或修改筛选后会自动更新。</AutoRefreshHint>
            {assetListError ? (
              <div className="inline-error" role="alert">
                {assetListError}
              </div>
            ) : null}
            <AssetValuationsPreview
              data={assetListResult}
              formatCentsShort={formatCentsShort}
              PreviewStat={PreviewStat}
              SortableHeaderButton={SortableHeaderButton}
              nextSortState={nextSortState}
              compareSortValues={compareSortValues}
            />
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
    </>
  );
}
