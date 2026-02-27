// @ts-nocheck
export function QuickManualInvestmentModal(props: any) {
  const {
    quickManualInvOpen,
    closeQuickManualInvestmentModal,
    quickManualInvBusy,
    makeEnterToQueryHandler,
    handleQuickManualInvestmentSubmit,
    DateInput,
    quickManualInvForm,
    setQuickManualInvForm,
    AccountIdSelect,
    accountSelectOptions,
    accountSelectOptionsLoading,
    quickManualAccountHintToneClass,
    quickManualAccountHintText,
    quickManualTotalAssetsWanText,
    quickManualInvError,
  } = props;

  return (
    <>
        {quickManualInvOpen ? (
          <div className="kw-modal-overlay" role="presentation" onClick={closeQuickManualInvestmentModal}>
            <div
              className="kw-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="quick-manual-investment-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="kw-modal-head">
                <div>
                  <p className="eyebrow">手动录入</p>
                  <h3 id="quick-manual-investment-modal-title">投资快照录入</h3>
                </div>
                <button
                  type="button"
                  className="secondary-btn table-inline-btn"
                  onClick={closeQuickManualInvestmentModal}
                  disabled={quickManualInvBusy}
                  aria-label="关闭"
                  title="关闭"
                >
                  ×
                </button>
              </div>

              <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleQuickManualInvestmentSubmit)}>
                <label className="field">
                  <span>快照日期</span>
                  <DateInput
                    value={`${quickManualInvForm.snapshot_date ?? ""}`}
                    onChange={(e) => setQuickManualInvForm((s) => ({ ...s, snapshot_date: e.target.value }))}
                    type="date"
                    placeholder="YYYY-MM-DD"
                  />
                  <div className="quick-manual-inline-hint-slot" aria-hidden="true">
                    <div className="quick-manual-inline-hint" />
                  </div>
                </label>
                <label className="field">
                  <span>投资账户</span>
                  <AccountIdSelect
                    value={`${quickManualInvForm.account_id ?? ""}`}
                    onChange={(value) => setQuickManualInvForm((s) => ({ ...s, account_id: value }))}
                    options={accountSelectOptions}
                    kinds={["investment"]}
                    emptyLabel={accountSelectOptionsLoading ? "加载账户中..." : "请选择投资账户"}
                    disabled={accountSelectOptionsLoading || quickManualInvBusy}
                  />
                  <div className="quick-manual-inline-hint-slot" aria-live="polite">
                    <div className={`quick-manual-inline-hint ${quickManualAccountHintToneClass}`}>
                      {quickManualAccountHintText}
                    </div>
                  </div>
                </label>
                <label className="field">
                  <span>总资产（元）</span>
                  <input
                    value={`${quickManualInvForm.total_assets ?? ""}`}
                    onChange={(e) => setQuickManualInvForm((s) => ({ ...s, total_assets: e.target.value }))}
                    placeholder="10000.00"
                  />
                  <div className="quick-manual-inline-hint-slot" aria-live="polite">
                    <div className="quick-manual-inline-hint">{quickManualTotalAssetsWanText ? `约 ${quickManualTotalAssetsWanText}` : ""}</div>
                  </div>
                </label>
                <label className="field">
                  <span>净转入/转出（元）</span>
                  <input
                    value={`${quickManualInvForm.transfer_amount ?? ""}`}
                    onChange={(e) => setQuickManualInvForm((s) => ({ ...s, transfer_amount: e.target.value }))}
                    placeholder="转入为正，转出为负，默认 0"
                  />
                </label>
              </div>

              <p className="inline-hint">默认使用今天作为快照日期；账户会优先选中上次录入使用的投资账户。</p>

              {quickManualInvError ? <div className="inline-error" role="alert">{quickManualInvError}</div> : null}

              <div className="db-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleQuickManualInvestmentSubmit()}
                  disabled={
                    quickManualInvBusy ||
                    !`${quickManualInvForm.snapshot_date ?? ""}`.trim() ||
                    !`${quickManualInvForm.account_id ?? ""}`.trim() ||
                    !`${quickManualInvForm.total_assets ?? ""}`.trim()
                  }
                >
                  {quickManualInvBusy ? "提交中..." : "提交录入"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
    </>
  );
}
