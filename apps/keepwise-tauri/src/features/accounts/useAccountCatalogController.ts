import { startTransition, useMemo, useState } from "react";

import {
  deleteAccountCatalogEntry,
  queryAccountCatalog,
  upsertAccountCatalogEntry,
  type AccountCatalogDeletePayload,
  type AccountCatalogPayload,
  type AccountCatalogUpsertPayload,
  type QueryAccountCatalogRequest,
  type UpsertAccountCatalogEntryRequest,
} from "../../api/desktop";
import { buildAccountCatalogQueryRequest, buildAccountCatalogUpsertRequest, toErrorMessage } from "../../app/requestBuilders";
import { buildAccountSelectOptionsFromCatalog } from "../shared/UiPrimitives";

const EMPTY_FORM: UpsertAccountCatalogEntryRequest = { account_id: "", account_name: "", account_kind: "cash" };

function normalizeKind(raw: unknown): UpsertAccountCatalogEntryRequest["account_kind"] {
  switch (raw) {
    case "investment": case "cash": case "real_estate": case "bank": case "credit_card":
    case "wallet": case "liability": case "other": return raw;
    default: return "other";
  }
}

export function useAccountCatalogController({
  onMutation,
  onChanged,
}: {
  onMutation: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AccountCatalogPayload | null>(null);
  const [selectBusy, setSelectBusy] = useState(false);
  const [selectResult, setSelectResult] = useState<AccountCatalogPayload | null>(null);
  const [query, setQuery] = useState<QueryAccountCatalogRequest>({ kind: "all", keyword: "", limit: 200 });
  const [upsertBusy, setUpsertBusy] = useState(false);
  const [upsertError, setUpsertError] = useState("");
  const [upsertResult, setUpsertResult] = useState<AccountCatalogUpsertPayload | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "rename">("create");
  const [form, setForm] = useState<UpsertAccountCatalogEntryRequest>(EMPTY_FORM);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteResult, setDeleteResult] = useState<AccountCatalogDeletePayload | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const selectOptions = useMemo(() => buildAccountSelectOptionsFromCatalog(selectResult), [selectResult]);

  async function refreshSelectOptions() {
    setSelectBusy(true);
    try {
      const payload = await queryAccountCatalog({ kind: "all", keyword: "", limit: 2000 });
      startTransition(() => setSelectResult(payload));
    } catch {
      // Existing options remain usable; the management query surfaces detailed errors.
    } finally {
      setSelectBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const payload = await queryAccountCatalog(buildAccountCatalogQueryRequest(query));
      startTransition(() => setResult(payload));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setModalMode("create");
    setForm(EMPTY_FORM);
  }

  function openCreateModal() {
    setUpsertError("");
    resetForm();
    setModalOpen(true);
  }

  function openRenameModal(accountId: string, accountName: string, accountKind: string) {
    const id = accountId.trim();
    if (!id) return;
    setUpsertError("");
    setModalMode("rename");
    setForm({ account_id: id, account_name: accountName, account_kind: normalizeKind(accountKind) });
    setModalOpen(true);
  }

  function closeModal() {
    if (upsertBusy) return;
    setModalOpen(false);
    setUpsertError("");
    resetForm();
  }

  async function upsert() {
    setUpsertBusy(true);
    setUpsertError("");
    try {
      const payload = await upsertAccountCatalogEntry(buildAccountCatalogUpsertRequest(form));
      startTransition(() => {
        setUpsertResult(payload);
        setModalOpen(false);
        resetForm();
      });
      onMutation();
      void refresh();
      void refreshSelectOptions();
      onChanged();
    } catch (err) {
      setUpsertError(toErrorMessage(err));
    } finally {
      setUpsertBusy(false);
    }
  }

  async function remove(accountIdOverride?: string) {
    const accountId = `${accountIdOverride ?? ""}`.trim();
    if (!accountId) return;
    setDeleteBusy(true);
    setDeleteError("");
    setDeletingId(accountId);
    try {
      const payload = await deleteAccountCatalogEntry({ account_id: accountId });
      startTransition(() => setDeleteResult(payload));
      onMutation();
      void refresh();
      void refreshSelectOptions();
      onChanged();
    } catch (err) {
      setDeleteError(toErrorMessage(err));
    } finally {
      setDeleteBusy(false);
      setDeletingId("");
    }
  }

  return {
    busy, error, result, query, setQuery, refresh,
    selectBusy, selectResult, selectOptions, refreshSelectOptions,
    upsertBusy, upsertError, upsertResult, upsert,
    modalOpen, modalMode, form, setForm, openCreateModal, openRenameModal, closeModal,
    deleteBusy, deleteError, deleteResult, deletingId, remove,
  };
}
