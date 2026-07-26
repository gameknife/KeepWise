import { type Dispatch, type SetStateAction } from "react";
import { formatCentsYuanText, maskAmountDisplayText } from "../../app/amountFormatting";
import { makeEnterToQueryHandler, parseYuanInputToNumber } from "../../app/helpers";
import { type AppSettings } from "../../types/app";
import { type useAccountCatalogController } from "../accounts/useAccountCatalogController";
import { type useManualEntryController } from "../accounts/useManualEntryController";
import { accountKindsForAssetClass } from "../shared/UiPrimitives";
import { type useSyncRuntimeController } from "../sync/useSyncRuntimeController";
import { AppSettingsModal } from "./AppSettingsModal";
import { InvestmentEditModal } from "./InvestmentEditModal";
import { QuickManualAssetValuationModal } from "./QuickManualAssetValuationModal";
import { QuickManualInvestmentModal } from "./QuickManualInvestmentModal";

export function AppGlobalModals(props: {
  manualEntry: ReturnType<typeof useManualEntryController>;
  accounts: ReturnType<typeof useAccountCatalogController>;
  sync: ReturnType<typeof useSyncRuntimeController>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  appSettings: AppSettings;
  setAppSettings: Dispatch<SetStateAction<AppSettings>>;
  isDesktopApp: boolean;
}) {
  const { manualEntry, accounts, sync } = props;
  const accountLoading = accounts.selectBusy && accounts.selectOptions.length === 0;
  const investmentAccountId = `${manualEntry.investmentForm.account_id ?? ""}`.trim();
  const investmentHint = !investmentAccountId ? "" : manualEntry.investmentAssetsError
    ? manualEntry.investmentAssetsError
    : manualEntry.investmentAssetsBusy ? "当前总资金加载中..."
      : manualEntry.investmentAssetsCents !== null
        ? `当前总资金：${maskAmountDisplayText(formatCentsYuanText(manualEntry.investmentAssetsCents))} 元${manualEntry.investmentAssetsDate ? `（${manualEntry.investmentAssetsDate}）` : ""}`
        : "当前总资金：暂无历史快照";
  const investmentYuan = parseYuanInputToNumber(`${manualEntry.investmentForm.total_assets ?? ""}`);
  const investmentWan = investmentYuan !== null && Math.abs(investmentYuan) >= 100000
    ? maskAmountDisplayText(`${(investmentYuan / 10000).toFixed(2)} 万`) : "";
  const assetClass = manualEntry.assetForm.asset_class === "real_estate" || manualEntry.assetForm.asset_class === "liability"
    ? manualEntry.assetForm.asset_class : "cash";
  const assetAccountId = `${manualEntry.assetForm.account_id ?? ""}`.trim();
  const assetHint = !assetAccountId ? "" : manualEntry.assetValueError
    ? manualEntry.assetValueError
    : manualEntry.assetValueBusy ? "当前快照加载中..."
      : manualEntry.assetValueCents !== null
        ? `当前快照：${maskAmountDisplayText(formatCentsYuanText(manualEntry.assetValueCents))} 元${manualEntry.assetValueDate ? `（${manualEntry.assetValueDate}）` : ""}`
        : "当前快照：暂无历史记录";
  const assetYuan = parseYuanInputToNumber(`${manualEntry.assetForm.value ?? ""}`);
  const assetWan = assetYuan !== null && Math.abs(assetYuan) >= 100000
    ? maskAmountDisplayText(`${(assetYuan / 10000).toFixed(2)} 万`) : "";

  return <>
    <QuickManualInvestmentModal
      quickManualInvOpen={manualEntry.investmentOpen} closeQuickManualInvestmentModal={manualEntry.closeInvestment}
      quickManualInvBusy={manualEntry.investmentBusy} makeEnterToQueryHandler={makeEnterToQueryHandler}
      handleQuickManualInvestmentSubmit={manualEntry.submitInvestment} quickManualInvForm={manualEntry.investmentForm}
      setQuickManualInvForm={manualEntry.setInvestmentForm} accountSelectOptions={accounts.selectOptions}
      accountSelectOptionsLoading={accountLoading} quickManualAccountHintToneClass={manualEntry.investmentAssetsError ? "warn-text" : ""}
      quickManualAccountHintText={investmentHint} quickManualTotalAssetsWanText={investmentWan}
      quickManualInvError={manualEntry.investmentError}
    />
    <QuickManualAssetValuationModal
      quickManualAssetOpen={manualEntry.assetOpen} closeQuickManualAssetValuationModal={manualEntry.closeAsset}
      quickManualAssetBusy={manualEntry.assetBusy} makeEnterToQueryHandler={makeEnterToQueryHandler}
      handleQuickManualAssetValuationSubmit={manualEntry.submitAsset} quickManualAssetForm={manualEntry.assetForm}
      setQuickManualAssetForm={manualEntry.setAssetForm} handleQuickManualAssetClassChange={manualEntry.changeAssetClass}
      accountSelectOptions={accounts.selectOptions} accountSelectOptionsLoading={accountLoading}
      quickManualAssetAccountKinds={accountKindsForAssetClass(assetClass) ?? []}
      quickManualAssetHintToneClass={manualEntry.assetValueError ? "warn-text" : ""}
      quickManualAssetHintText={assetHint} quickManualAssetValueWanText={assetWan} quickManualAssetError={manualEntry.assetError}
    />
    <InvestmentEditModal
      invEditModalOpen={manualEntry.editOpen} closeInvestmentEditModal={manualEntry.closeEdit}
      updateInvBusy={manualEntry.editBusy} makeEnterToQueryHandler={makeEnterToQueryHandler}
      handleUpdateInvestmentRecordMutation={manualEntry.submitEdit} updateInvForm={manualEntry.editForm}
      setUpdateInvForm={manualEntry.setEditForm} accountSelectOptions={accounts.selectOptions}
      accountSelectOptionsLoading={accountLoading} updateInvError={manualEntry.editError}
    />
    <AppSettingsModal
      settingsOpen={props.settingsOpen} setSettingsOpen={props.setSettingsOpen}
      appSettings={props.appSettings} setAppSettings={props.setAppSettings} isDesktopApp={props.isDesktopApp}
      syncStatus={sync.status} handleManualSyncNow={sync.syncNow} syncSetupBusy={sync.setupBusy}
      syncSetupError={sync.setupError} syncActionMessage={sync.actionMessage} syncShareCode={sync.shareCode}
      syncCreateForm={sync.createForm} setSyncCreateForm={sync.setCreateForm}
      syncLinkForm={sync.linkForm} setSyncLinkForm={sync.setLinkForm}
      handleSyncSetupCreate={sync.setupCreate} handleSyncSetupLink={sync.setupLink}
      handleSyncShareCodeRefresh={sync.refreshShareCode}
    />
  </>;
}
