// @ts-nocheck
export function AccountCatalogAdminPanel(props: any) {
  const {
    isTab,
    makeEnterToQueryHandler,
    handleAccountCatalogQuery,
    acctCatalogQuery,
    setAcctCatalogQuery,
    safeNumericInputValue,
    parseNumericInputWithFallback,
    openAccountCatalogCreateModal,
    acctCatalogUpsertBusy,
    AutoRefreshHint,
    acctCatalogBusy,
    acctCatalogError,
    acctCatalogDeleteError,
    acctCatalogUpsertResult,
    showDebugJson,
    JsonResultCard,
    acctCatalogDeleteResult,
    AccountCatalogPreview,
    acctCatalogResult,
    acctCatalogDeleteBusy,
    acctCatalogDeletingRowId,
    PreviewStat,
    SortableHeaderButton,
    nextSortState,
    compareSortValues,
    handleAccountCatalogDelete,
    acctCatalogCreateOpen,
    closeAccountCatalogCreateModal,
    acctCatalogUpsertForm,
    setAcctCatalogUpsertForm,
    acctCatalogUpsertError,
    handleAccountCatalogUpsert,
  } = props;

  return isTab("admin") ? (
    <section className="card panel">
      <div className="panel-header">
        <h2>账户目录维护</h2>
        <p>独立账户目录管理模块：默认展示列表，支持筛选、行内删除和新建账户（自动生成账户 ID）。</p>
      </div>

      <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleAccountCatalogQuery)}>
        <label className="field">
          <span>查询种类</span>
          <select
            value={acctCatalogQuery.kind ?? "all"}
            onChange={(e) =>
              setAcctCatalogQuery((s) => ({
                ...s,
                kind: e.target.value as any,
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
            placeholder="账户 ID / 名称 / 种类"
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
        <button type="button" className="secondary-btn" onClick={openAccountCatalogCreateModal} disabled={acctCatalogUpsertBusy}>
          新建账户
        </button>
      </div>
      <AutoRefreshHint busy={acctCatalogBusy}>首次进入高级管理会自动加载；修改筛选条件后将自动刷新账户目录列表。</AutoRefreshHint>

      {acctCatalogError ? (
        <div className="inline-error" role="alert">
          {acctCatalogError}
        </div>
      ) : null}
      {acctCatalogDeleteError ? (
        <div className="inline-error" role="alert">
          {acctCatalogDeleteError}
        </div>
      ) : null}

      {acctCatalogUpsertResult && showDebugJson ? (
        <JsonResultCard title="账户目录写入结果" data={acctCatalogUpsertResult} emptyText="暂无写入结果。" />
      ) : null}
      {acctCatalogDeleteResult && showDebugJson ? (
        <JsonResultCard title="账户目录删除结果" data={acctCatalogDeleteResult} emptyText="暂无删除结果。" />
      ) : null}

      <AccountCatalogPreview
        data={acctCatalogResult}
        deleteBusy={acctCatalogDeleteBusy}
        deletingAccountId={acctCatalogDeletingRowId}
        PreviewStat={PreviewStat}
        SortableHeaderButton={SortableHeaderButton}
        nextSortState={nextSortState}
        compareSortValues={compareSortValues}
        onDeleteRow={(accountId, accountName) => {
          const ok = window.confirm(`确认删除账户「${accountName}」？\n${accountId}\n\n若存在交易/投资/资产引用，系统会阻止删除。`);
          if (!ok) return;
          void handleAccountCatalogDelete(accountId);
        }}
      />
      {showDebugJson ? (
        <JsonResultCard title="账户目录 JSON" data={acctCatalogResult} emptyText="暂无结果。请先查询账户目录。" />
      ) : null}

      {acctCatalogCreateOpen ? (
        <div className="kw-modal-overlay" role="presentation" onClick={closeAccountCatalogCreateModal}>
          <div
            className="kw-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="acct-catalog-create-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="kw-modal-head">
              <div>
                <p className="eyebrow">账户目录维护</p>
                <h3 id="acct-catalog-create-modal-title">新建账户</h3>
              </div>
              <button type="button" className="secondary-btn table-inline-btn" onClick={closeAccountCatalogCreateModal} disabled={acctCatalogUpsertBusy}>
                关闭
              </button>
            </div>

            <div className="query-form-grid query-form-grid-compact">
              <label className="field">
                <span>账户名称</span>
                <input
                  autoFocus
                  value={`${acctCatalogUpsertForm.account_name ?? ""}`}
                  onChange={(e) =>
                    setAcctCatalogUpsertForm((s) => ({
                      ...s,
                      account_id: "",
                      account_name: e.target.value,
                    }))
                  }
                  placeholder="账户名称"
                />
              </label>
              <label className="field">
                <span>账户种类</span>
                <select
                  value={acctCatalogUpsertForm.account_kind ?? "cash"}
                  onChange={(e) =>
                    setAcctCatalogUpsertForm((s) => ({
                      ...s,
                      account_id: "",
                      account_kind: e.target.value as any,
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

            <p className="inline-hint">保存后将自动生成账户 ID，并刷新账户目录与账户元数据查询。</p>

            {acctCatalogUpsertError ? (
              <div className="inline-error" role="alert">
                {acctCatalogUpsertError}
              </div>
            ) : null}

            <div className="db-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleAccountCatalogUpsert()}
                disabled={acctCatalogUpsertBusy || !`${acctCatalogUpsertForm.account_name ?? ""}`.trim()}
              >
                {acctCatalogUpsertBusy ? "保存中..." : "保存新账户"}
              </button>
              <button type="button" className="secondary-btn" onClick={closeAccountCatalogCreateModal} disabled={acctCatalogUpsertBusy}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  ) : null;
}
