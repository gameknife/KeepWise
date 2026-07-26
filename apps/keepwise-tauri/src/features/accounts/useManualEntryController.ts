import { startTransition, useEffect, useState } from "react";

import {
  deleteInvestmentRecord,
  queryAssetValuations,
  queryInvestments,
  updateInvestmentRecord,
  upsertManualAssetValuation,
  upsertManualInvestment,
  type DeleteByIdRequest,
  type QueryAssetValuationsRequest,
  type QueryInvestmentsRequest,
  type UpdateInvestmentRecordRequest,
  type UpsertManualAssetValuationRequest,
  type UpsertManualInvestmentRequest,
} from "../../api/desktop";
import { formatCentsInputValue } from "../../app/amountFormatting";
import { getCurrentMonthDateRangeLocal, getTodayDateInputValueLocal } from "../../app/helpers";
import { compactStringFields, toErrorMessage } from "../../app/requestBuilders";
import { isRecord, readArray, readNumber, readString } from "../../utils/value";
import { accountKindsForAssetClass, type AccountSelectOption } from "../shared/UiPrimitives";

const LAST_INV_ACCOUNT_KEY = "keepwise.desktop.quick-manual-investment.last-account-id.v1";
const LAST_ASSET_ACCOUNT_KEY = "keepwise.desktop.quick-manual-asset.last-account-id.v1";
const LAST_ASSET_CLASS_KEY = "keepwise.desktop.quick-manual-asset.last-asset-class.v1";
type ManualAssetClass = "cash" | "real_estate" | "liability";

function normalizeAssetClass(value?: string | null): ManualAssetClass {
  return value === "real_estate" || value === "liability" ? value : "cash";
}

function storedValue(key: string) {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; }
}

function blurActiveElement() {
  if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function useManualEntryController({
  accountOptions,
  refreshAccountOptions,
  refreshCatalog,
  refreshMeta,
  refreshInvestments,
  refreshAssets,
  onMutation,
  onInvestmentChanged,
  onAssetChanged,
}: {
  accountOptions: AccountSelectOption[];
  refreshAccountOptions: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshInvestments: () => Promise<void>;
  refreshAssets: () => Promise<void>;
  onMutation: () => void;
  onInvestmentChanged: () => void;
  onAssetChanged: () => void;
}) {
  const [investmentOpen, setInvestmentOpen] = useState(false);
  const [investmentBusy, setInvestmentBusy] = useState(false);
  const [investmentError, setInvestmentError] = useState("");
  const [investmentAssetsBusy, setInvestmentAssetsBusy] = useState(false);
  const [investmentAssetsError, setInvestmentAssetsError] = useState("");
  const [investmentAssetsCents, setInvestmentAssetsCents] = useState<number | null>(null);
  const [investmentAssetsDate, setInvestmentAssetsDate] = useState("");
  const [lastInvestmentAccountId, setLastInvestmentAccountId] = useState(() => storedValue(LAST_INV_ACCOUNT_KEY));
  const [investmentForm, setInvestmentForm] = useState<UpsertManualInvestmentRequest>({
    snapshot_date: "", account_id: "", account_name: "", total_assets: "", transfer_amount: "0",
  });
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [assetValueBusy, setAssetValueBusy] = useState(false);
  const [assetValueError, setAssetValueError] = useState("");
  const [assetValueCents, setAssetValueCents] = useState<number | null>(null);
  const [assetValueDate, setAssetValueDate] = useState("");
  const [lastAssetAccountId, setLastAssetAccountId] = useState(() => storedValue(LAST_ASSET_ACCOUNT_KEY));
  const [lastAssetClass, setLastAssetClass] = useState<ManualAssetClass>(() => normalizeAssetClass(storedValue(LAST_ASSET_CLASS_KEY)));
  const [assetForm, setAssetForm] = useState<UpsertManualAssetValuationRequest>({
    asset_class: "cash", snapshot_date: "", account_id: "", account_name: "", value: "",
  });
  const [monthCountBusy, setMonthCountBusy] = useState(false);
  const [monthCount, setMonthCount] = useState<number | null>(null);
  const [assetLastDateBusy, setAssetLastDateBusy] = useState(false);
  const [assetLastDate, setAssetLastDate] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [editForm, setEditForm] = useState<UpdateInvestmentRecordRequest>({
    id: "", snapshot_date: "", account_id: "", account_name: "", total_assets: "", transfer_amount: "0",
  });
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (lastInvestmentAccountId.trim()) window.localStorage.setItem(LAST_INV_ACCOUNT_KEY, lastInvestmentAccountId.trim());
      else window.localStorage.removeItem(LAST_INV_ACCOUNT_KEY);
    } catch { /* Storage may be unavailable in private mode. */ }
  }, [lastInvestmentAccountId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (lastAssetAccountId.trim()) window.localStorage.setItem(LAST_ASSET_ACCOUNT_KEY, lastAssetAccountId.trim());
      else window.localStorage.removeItem(LAST_ASSET_ACCOUNT_KEY);
      window.localStorage.setItem(LAST_ASSET_CLASS_KEY, lastAssetClass);
    } catch { /* Storage may be unavailable in private mode. */ }
  }, [lastAssetAccountId, lastAssetClass]);

  function resetInvestmentForm(accountId = "") {
    setInvestmentForm({ snapshot_date: getTodayDateInputValueLocal(), account_id: accountId, account_name: "", total_assets: "", transfer_amount: "0" });
  }
  function openInvestment() {
    setInvestmentError(""); setInvestmentAssetsError(""); setInvestmentAssetsCents(null); setInvestmentAssetsDate("");
    resetInvestmentForm(lastInvestmentAccountId); void refreshAccountOptions(); setInvestmentOpen(true);
  }
  function closeInvestment() {
    if (investmentBusy) return;
    blurActiveElement(); setInvestmentOpen(false); setInvestmentError(""); setInvestmentAssetsError("");
    setInvestmentAssetsCents(null); setInvestmentAssetsDate("");
  }
  function resetAssetForm(assetClass: ManualAssetClass = "cash", accountId = "") {
    setAssetForm({ asset_class: assetClass, snapshot_date: getTodayDateInputValueLocal(), account_id: accountId, account_name: "", value: "" });
  }
  function openAsset() {
    const assetClass = normalizeAssetClass(lastAssetClass);
    setAssetError(""); setAssetValueError(""); setAssetValueCents(null); setAssetValueDate("");
    resetAssetForm(assetClass, lastAssetAccountId); void refreshAccountOptions(); setAssetOpen(true);
  }
  function closeAsset() {
    if (assetBusy) return;
    blurActiveElement(); setAssetOpen(false); setAssetError(""); setAssetValueError(""); setAssetValueCents(null); setAssetValueDate("");
  }
  function changeAssetClass(value: string) {
    const assetClass = normalizeAssetClass(value);
    setAssetForm((previous) => {
      const accountId = `${previous.account_id ?? ""}`.trim();
      const kind = accountOptions.find((option) => option.account_id === accountId)?.account_kind;
      const allowed = accountKindsForAssetClass(assetClass) ?? [];
      return { ...previous, asset_class: assetClass, account_id: kind && allowed.includes(kind) ? accountId : "" };
    });
  }
  function closeEdit() { if (!editBusy) { setEditOpen(false); setEditError(""); } }

  async function refreshInvestmentAssets() {
    const accountId = `${investmentForm.account_id ?? ""}`.trim();
    if (!investmentOpen || !accountId) {
      setInvestmentAssetsBusy(false); setInvestmentAssetsError(""); setInvestmentAssetsCents(null); setInvestmentAssetsDate(""); return;
    }
    setInvestmentAssetsBusy(true); setInvestmentAssetsError("");
    try {
      const payload = await queryInvestments({ limit: 1, account_id: accountId });
      const hasSnapshot = readArray(payload, "rows").filter(isRecord).length > 0;
      startTransition(() => {
        setInvestmentAssetsCents(hasSnapshot ? (readNumber(payload, "summary.latest_total_assets_cents") ?? 0) : null);
        setInvestmentAssetsDate(hasSnapshot ? (readString(payload, "rows.0.snapshot_date") ?? "") : "");
      });
    } catch (err) {
      setInvestmentAssetsError(toErrorMessage(err)); setInvestmentAssetsCents(null); setInvestmentAssetsDate("");
    } finally { setInvestmentAssetsBusy(false); }
  }

  async function submitInvestment() {
    setInvestmentBusy(true); setInvestmentError("");
    try {
      await upsertManualInvestment(compactStringFields(investmentForm));
      const accountId = `${investmentForm.account_id ?? ""}`.trim();
      if (accountId) setLastInvestmentAccountId(accountId);
      onMutation(); void refreshInvestments(); void refreshMeta(); void refreshCatalog(); void refreshAccountOptions();
      onInvestmentChanged(); void refreshMonthCount(); blurActiveElement(); setInvestmentOpen(false);
    } catch (err) { setInvestmentError(toErrorMessage(err)); } finally { setInvestmentBusy(false); }
  }

  async function refreshAssetValue() {
    const accountId = `${assetForm.account_id ?? ""}`.trim();
    const assetClass = normalizeAssetClass(assetForm.asset_class);
    if (!assetOpen || !accountId) {
      setAssetValueBusy(false); setAssetValueError(""); setAssetValueCents(null); setAssetValueDate(""); return;
    }
    setAssetValueBusy(true); setAssetValueError("");
    try {
      const payload = await queryAssetValuations({ limit: 1, account_id: accountId, asset_class: assetClass });
      const hasSnapshot = readArray(payload, "rows").filter(isRecord).length > 0;
      startTransition(() => {
        setAssetValueCents(hasSnapshot ? (readNumber(payload, "rows.0.value_cents") ?? 0) : null);
        setAssetValueDate(hasSnapshot ? (readString(payload, "rows.0.snapshot_date") ?? "") : "");
      });
    } catch (err) { setAssetValueError(toErrorMessage(err)); setAssetValueCents(null); setAssetValueDate(""); }
    finally { setAssetValueBusy(false); }
  }

  async function submitAsset() {
    setAssetBusy(true); setAssetError("");
    try {
      await upsertManualAssetValuation(compactStringFields(assetForm));
      const accountId = `${assetForm.account_id ?? ""}`.trim();
      const assetClass = normalizeAssetClass(assetForm.asset_class);
      if (accountId) setLastAssetAccountId(accountId);
      setLastAssetClass(assetClass); onMutation(); void refreshAssets(); void refreshMeta(); void refreshCatalog(); void refreshAccountOptions();
      onAssetChanged(); void refreshAssetLastDate(); blurActiveElement(); setAssetOpen(false);
    } catch (err) { setAssetError(toErrorMessage(err)); } finally { setAssetBusy(false); }
  }

  async function submitEdit() {
    setEditBusy(true); setEditError("");
    try {
      await updateInvestmentRecord(compactStringFields(editForm));
      onMutation(); setEditOpen(false); void refreshInvestments(); void refreshMeta(); void refreshCatalog(); void refreshAccountOptions();
      onInvestmentChanged(); void refreshMonthCount();
    } catch (err) { setEditError(toErrorMessage(err)); } finally { setEditBusy(false); }
  }

  function editRow(row: Record<string, unknown>) {
    setEditError("");
    setEditForm({
      id: typeof row.id === "string" ? row.id : "",
      snapshot_date: typeof row.snapshot_date === "string" ? row.snapshot_date : "",
      account_id: typeof row.account_id === "string" ? row.account_id : "",
      account_name: typeof row.account_name === "string" ? row.account_name : "",
      total_assets: formatCentsInputValue(typeof row.total_assets_cents === "number" ? row.total_assets_cents : undefined),
      transfer_amount: formatCentsInputValue(typeof row.transfer_amount_cents === "number" ? row.transfer_amount_cents : 0),
    });
    setEditOpen(true);
  }

  async function removeInvestment(id: string) {
    const targetId = id.trim(); if (!targetId) return;
    setDeletingId(targetId); setDeleteBusy(true);
    try {
      await deleteInvestmentRecord({ id: targetId } satisfies DeleteByIdRequest);
      onMutation(); void refreshInvestments(); void refreshMeta(); void refreshCatalog(); void refreshAccountOptions();
      onInvestmentChanged(); void refreshMonthCount();
    } catch { /* Table refresh keeps deletion failure non-blocking. */ }
    finally { setDeleteBusy(false); setDeletingId(""); }
  }

  async function refreshMonthCount() {
    setMonthCountBusy(true);
    try {
      const range = getCurrentMonthDateRangeLocal();
      const payload = await queryInvestments({ limit: 500, from: range.from, to: range.to, source_type: "manual", account_id: "" } satisfies QueryInvestmentsRequest);
      const rows = readArray(payload, "rows").filter(isRecord); const count = readNumber(payload, "summary.count");
      startTransition(() => setMonthCount(typeof count === "number" && Number.isFinite(count) ? count : rows.length));
    } catch { /* Best-effort sidebar metric. */ } finally { setMonthCountBusy(false); }
  }

  async function refreshAssetLastDate() {
    setAssetLastDateBusy(true);
    try {
      const payload = await queryAssetValuations({ limit: 1 } satisfies QueryAssetValuationsRequest);
      const row = readArray(payload, "rows").filter(isRecord)[0];
      startTransition(() => setAssetLastDate(typeof row?.snapshot_date === "string" ? row.snapshot_date : ""));
    } catch { /* Best-effort sidebar metric. */ } finally { setAssetLastDateBusy(false); }
  }

  return {
    investmentOpen, investmentBusy, investmentError, investmentAssetsBusy, investmentAssetsError,
    investmentAssetsCents, investmentAssetsDate, investmentForm, setInvestmentForm,
    openInvestment, closeInvestment, refreshInvestmentAssets, submitInvestment,
    assetOpen, assetBusy, assetError, assetValueBusy, assetValueError, assetValueCents, assetValueDate,
    assetForm, setAssetForm, openAsset, closeAsset, changeAssetClass, refreshAssetValue, submitAsset,
    monthCountBusy, monthCount, refreshMonthCount, assetLastDateBusy, assetLastDate, refreshAssetLastDate,
    editOpen, editBusy, editError, editForm, setEditForm, closeEdit, submitEdit, editRow,
    deleteBusy, deletingId, removeInvestment,
  };
}
