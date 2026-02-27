// @ts-nocheck
export function InvestmentEditModal(props: any) {
  const {
    invEditModalOpen,
    closeInvestmentEditModal,
    updateInvBusy,
    makeEnterToQueryHandler,
    handleUpdateInvestmentRecordMutation,
    updateInvForm,
    setUpdateInvForm,
    DateInput,
    AccountIdSelect,
    accountSelectOptions,
    accountSelectOptionsLoading,
    updateInvError,
  } = props;

  return (
    <>
        {invEditModalOpen ? (
          <div className="kw-modal-overlay" role="presentation" onClick={closeInvestmentEditModal}>
            <div
              className="kw-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="investment-edit-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="kw-modal-head">
                <div>
                  <p className="eyebrow">投资记录查询</p>
                  <h3 id="investment-edit-modal-title">修正投资记录</h3>
                </div>
                <button
                  type="button"
                  className="secondary-btn table-inline-btn"
                  onClick={closeInvestmentEditModal}
                  disabled={updateInvBusy}
                  aria-label="关闭"
                  title="关闭"
                >
                  ×
                </button>
              </div>

              <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleUpdateInvestmentRecordMutation)}>
                <label className="field">
                  <span>记录 ID</span>
                  <input
                    value={`${updateInvForm.id ?? ""}`}
                    onChange={(e) => setUpdateInvForm((s) => ({ ...s, id: e.target.value }))}
                    placeholder="investment record id"
                    disabled={updateInvBusy}
                  />
                </label>
                <label className="field">
                  <span>快照日期</span>
                  <DateInput
                    value={`${updateInvForm.snapshot_date ?? ""}`}
                    onChange={(e) => setUpdateInvForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                    type="date"
                    placeholder="YYYY-MM-DD"
                  />
                </label>
                <label className="field">
                  <span>账户</span>
                  <AccountIdSelect
                    value={`${updateInvForm.account_id ?? ""}`}
                    onChange={(value) => setUpdateInvForm((s) => ({ ...s, account_id: value }))}
                    options={accountSelectOptions}
                    kinds={["investment"]}
                    emptyLabel={accountSelectOptionsLoading ? "加载账户中..." : "留空（按账户名称自动生成）"}
                    disabled={accountSelectOptionsLoading || updateInvBusy}
                  />
                </label>
                <label className="field">
                  <span>账户名称（可选）</span>
                  <input
                    value={`${updateInvForm.account_name ?? ""}`}
                    onChange={(e) => setUpdateInvForm((s) => ({ ...s, account_name: e.target.value }))}
                    placeholder="当账户为空时用于自动生成账户"
                    disabled={updateInvBusy}
                  />
                </label>
                <label className="field">
                  <span>总资产（元）</span>
                  <input
                    value={`${updateInvForm.total_assets ?? ""}`}
                    onChange={(e) => setUpdateInvForm((s) => ({ ...s, total_assets: e.target.value }))}
                    placeholder="10000.00"
                    disabled={updateInvBusy}
                  />
                </label>
                <label className="field">
                  <span>净转入/转出（元）</span>
                  <input
                    value={`${updateInvForm.transfer_amount ?? ""}`}
                    onChange={(e) => setUpdateInvForm((s) => ({ ...s, transfer_amount: e.target.value }))}
                    placeholder="转入为正，转出为负"
                    disabled={updateInvBusy}
                  />
                </label>
              </div>

              {updateInvError ? <div className="inline-error" role="alert">{updateInvError}</div> : null}

              <div className="db-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleUpdateInvestmentRecordMutation()}
                  disabled={updateInvBusy || !`${updateInvForm.id ?? ""}`.trim()}
                >
                  {updateInvBusy ? "保存中..." : "保存修正"}
                </button>
                <button type="button" className="secondary-btn" onClick={closeInvestmentEditModal} disabled={updateInvBusy}>
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </>
  );
}
