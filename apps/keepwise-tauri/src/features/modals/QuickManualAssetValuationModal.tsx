type QuickManualAssetValuationModalProps = Record<string, unknown>;
type LooseUiEvent = {
  target: EventTarget & { value?: string; checked?: boolean };
  currentTarget: { getBoundingClientRect: () => DOMRect; select?: () => void };
  clientX?: number;
  clientY?: number;
  stopPropagation: () => void;
};

export function QuickManualAssetValuationModal(props: QuickManualAssetValuationModalProps) {
  const {
    quickManualAssetOpen,
    closeQuickManualAssetValuationModal,
    quickManualAssetBusy,
    makeEnterToQueryHandler,
    handleQuickManualAssetValuationSubmit,
    DateInput,
    quickManualAssetForm,
    setQuickManualAssetForm,
    handleQuickManualAssetClassChange,
    AccountIdSelect,
    accountSelectOptions,
    accountSelectOptionsLoading,
    quickManualAssetAccountKinds,
    quickManualAssetHintToneClass,
    quickManualAssetHintText,
    quickManualAssetValueWanText,
    quickManualAssetError,
  } = props as Record<string, any>;

  return (
    <>
      {quickManualAssetOpen ? (
        <div className="kw-modal-overlay" role="presentation" onClick={closeQuickManualAssetValuationModal}>
          <div
            className="kw-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-manual-asset-modal-title"
            onClick={(e: LooseUiEvent) => e.stopPropagation()}
          >
            <div className="kw-modal-head">
              <div>
                <p className="eyebrow">手动录入</p>
                <h3 id="quick-manual-asset-modal-title">非投资资产快照录入</h3>
              </div>
              <button
                type="button"
                className="secondary-btn table-inline-btn"
                onClick={closeQuickManualAssetValuationModal}
                disabled={quickManualAssetBusy}
                aria-label="关闭"
                title="关闭"
              >
                ×
              </button>
            </div>

            <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleQuickManualAssetValuationSubmit)}>
              <label className="field">
                <span>快照日期</span>
                <DateInput
                  value={`${quickManualAssetForm.snapshot_date ?? ""}`}
                  onChange={(e: LooseUiEvent) => setQuickManualAssetForm((s: Record<string, any>) => ({ ...s, snapshot_date: e.target.value }))}
                  type="date"
                  placeholder="YYYY-MM-DD"
                />
                <div className="quick-manual-inline-hint-slot" aria-hidden="true">
                  <div className="quick-manual-inline-hint" />
                </div>
              </label>
              <label className="field">
                <span>资产分类</span>
                <select
                  value={`${quickManualAssetForm.asset_class ?? "cash"}`}
                  onChange={(e: LooseUiEvent) => handleQuickManualAssetClassChange(e.target.value)}
                  disabled={quickManualAssetBusy}
                >
                  <option value="cash">现金资产</option>
                  <option value="real_estate">不动产</option>
                  <option value="liability">负债</option>
                </select>
                <div className="quick-manual-inline-hint-slot" aria-hidden="true">
                  <div className="quick-manual-inline-hint" />
                </div>
              </label>
              <label className="field">
                <span>目标账户</span>
                <AccountIdSelect
                  value={`${quickManualAssetForm.account_id ?? ""}`}
                  onChange={(value: string) => setQuickManualAssetForm((s: Record<string, any>) => ({ ...s, account_id: value }))}
                  options={accountSelectOptions}
                  kinds={quickManualAssetAccountKinds}
                  emptyLabel={accountSelectOptionsLoading ? "加载账户中..." : "请选择非投资账户"}
                  disabled={accountSelectOptionsLoading || quickManualAssetBusy}
                />
                <div className="quick-manual-inline-hint-slot" aria-live="polite">
                  <div className={`quick-manual-inline-hint ${quickManualAssetHintToneClass}`}>
                    {quickManualAssetHintText}
                  </div>
                </div>
              </label>
              <label className="field">
                <span>快照数值（元）</span>
                <input
                  value={`${quickManualAssetForm.value ?? ""}`}
                  onChange={(e: LooseUiEvent) => setQuickManualAssetForm((s: Record<string, any>) => ({ ...s, value: e.target.value }))}
                  placeholder="100000.00"
                />
                <div className="quick-manual-inline-hint-slot" aria-live="polite">
                  <div className="quick-manual-inline-hint">{quickManualAssetValueWanText ? `约 ${quickManualAssetValueWanText}` : ""}</div>
                </div>
              </label>
            </div>

            <p className="inline-hint">默认使用今天作为快照日期；同一账户、同一分类、同一天会直接覆盖原有快照。</p>

            {quickManualAssetError ? <div className="inline-error" role="alert">{quickManualAssetError}</div> : null}

            <div className="db-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={() => void handleQuickManualAssetValuationSubmit()}
                disabled={
                  quickManualAssetBusy ||
                  !`${quickManualAssetForm.snapshot_date ?? ""}`.trim() ||
                  !`${quickManualAssetForm.asset_class ?? ""}`.trim() ||
                  !`${quickManualAssetForm.account_id ?? ""}`.trim() ||
                  !`${quickManualAssetForm.value ?? ""}`.trim()
                }
              >
                {quickManualAssetBusy ? "提交中..." : "提交录入"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
