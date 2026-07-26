import { startTransition, useState } from "react";

import {
  deleteMonthlyBudgetItem,
  queryBudgetMonthlyReview,
  queryBudgetOverview,
  queryFireProgress,
  queryMonthlyBudgetItems,
  querySalaryIncomeOverview,
  upsertMonthlyBudgetItem,
  type BudgetMonthlyReviewPayload,
  type BudgetOverviewPayload,
  type BudgetYearQueryRequest,
  type FireProgressPayload,
  type MonthlyBudgetItemMutationPayload,
  type MonthlyBudgetItemsPayload,
  type MonthlyBudgetItemUpsertRequest,
  type SalaryIncomeOverviewPayload,
} from "../../api/desktop";
import {
  buildBudgetItemUpsertMutationRequest,
  buildBudgetYearQueryRequest,
  buildFireProgressQueryRequest,
} from "../../app/requestBuilders";
import { type FireWithdrawalRate } from "../../types/app";

const EMPTY_BUDGET_ITEM: MonthlyBudgetItemUpsertRequest = {
  id: "",
  name: "",
  monthly_amount: "",
  sort_order: "1000",
  is_active: "true",
};

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

export function useBudgetController({
  fireWithdrawalRate,
  onMutation,
}: {
  fireWithdrawalRate: FireWithdrawalRate;
  onMutation: () => void;
}) {
  const currentYearText = String(new Date().getFullYear());
  const yearOptions = Array.from({ length: 7 }, (_value, index) => String(new Date().getFullYear() - index));
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsError, setItemsError] = useState("");
  const [itemsResult, setItemsResult] = useState<MonthlyBudgetItemsPayload | null>(null);
  const [itemUpsertBusy, setItemUpsertBusy] = useState(false);
  const [itemUpsertError, setItemUpsertError] = useState("");
  const [itemUpsertResult, setItemUpsertResult] = useState<MonthlyBudgetItemMutationPayload | null>(null);
  const [itemDeleteBusy, setItemDeleteBusy] = useState(false);
  const [itemDeleteError, setItemDeleteError] = useState("");
  const [itemDeleteResult, setItemDeleteResult] = useState<MonthlyBudgetItemMutationPayload | null>(null);
  const [itemCreateOpen, setItemCreateOpen] = useState(false);
  const [itemDeletingRowId, setItemDeletingRowId] = useState("");
  const [itemForm, setItemForm] = useState<MonthlyBudgetItemUpsertRequest>(EMPTY_BUDGET_ITEM);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [overviewResult, setOverviewResult] = useState<BudgetOverviewPayload | null>(null);
  const [overviewQuery, setOverviewQuery] = useState<BudgetYearQueryRequest>({ year: currentYearText });
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewResult, setReviewResult] = useState<BudgetMonthlyReviewPayload | null>(null);
  const [reviewQuery, setReviewQuery] = useState<BudgetYearQueryRequest>({ year: currentYearText });
  const [fireBusy, setFireBusy] = useState(false);
  const [fireError, setFireError] = useState("");
  const [fireResult, setFireResult] = useState<FireProgressPayload | null>(null);
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [incomeError, setIncomeError] = useState("");
  const [incomeResult, setIncomeResult] = useState<SalaryIncomeOverviewPayload | null>(null);
  const [incomeQuery, setIncomeQuery] = useState<BudgetYearQueryRequest>({ year: currentYearText });

  function openItemCreateModal() {
    setItemUpsertError("");
    setItemForm(EMPTY_BUDGET_ITEM);
    setItemCreateOpen(true);
  }

  function closeItemCreateModal() {
    if (!itemUpsertBusy) setItemCreateOpen(false);
  }

  async function refreshItems() {
    setItemsBusy(true);
    setItemsError("");
    try {
      const payload = await queryMonthlyBudgetItems();
      startTransition(() => setItemsResult(payload));
    } catch (err) {
      setItemsError(toErrorMessage(err));
    } finally {
      setItemsBusy(false);
    }
  }

  async function refreshOverview() {
    setOverviewBusy(true);
    setOverviewError("");
    try {
      const payload = await queryBudgetOverview(buildBudgetYearQueryRequest(overviewQuery));
      startTransition(() => setOverviewResult(payload));
    } catch (err) {
      setOverviewError(toErrorMessage(err));
    } finally {
      setOverviewBusy(false);
    }
  }

  async function refreshReview() {
    setReviewBusy(true);
    setReviewError("");
    try {
      const payload = await queryBudgetMonthlyReview(buildBudgetYearQueryRequest(reviewQuery));
      startTransition(() => setReviewResult(payload));
    } catch (err) {
      setReviewError(toErrorMessage(err));
    } finally {
      setReviewBusy(false);
    }
  }

  async function refreshFire() {
    setFireBusy(true);
    setFireError("");
    try {
      const payload = await queryFireProgress(buildFireProgressQueryRequest({ withdrawal_rate: fireWithdrawalRate }));
      startTransition(() => setFireResult(payload));
    } catch (err) {
      setFireError(toErrorMessage(err));
    } finally {
      setFireBusy(false);
    }
  }

  async function refreshIncome() {
    setIncomeBusy(true);
    setIncomeError("");
    try {
      const payload = await querySalaryIncomeOverview(buildBudgetYearQueryRequest(incomeQuery));
      startTransition(() => setIncomeResult(payload));
    } catch (err) {
      setIncomeError(toErrorMessage(err));
    } finally {
      setIncomeBusy(false);
    }
  }

  async function upsertItem() {
    setItemUpsertBusy(true);
    setItemUpsertError("");
    try {
      const payload = await upsertMonthlyBudgetItem(buildBudgetItemUpsertMutationRequest(itemForm));
      startTransition(() => setItemUpsertResult(payload));
      onMutation();
      setItemCreateOpen(false);
      setItemForm(EMPTY_BUDGET_ITEM);
      void refreshItems();
      void refreshOverview();
      void refreshReview();
      void refreshFire();
    } catch (err) {
      setItemUpsertError(toErrorMessage(err));
    } finally {
      setItemUpsertBusy(false);
    }
  }

  async function deleteItem(id: string) {
    setItemDeleteBusy(true);
    setItemDeletingRowId(id);
    setItemDeleteError("");
    try {
      const payload = await deleteMonthlyBudgetItem({ id });
      startTransition(() => setItemDeleteResult(payload));
      onMutation();
      void refreshItems();
      void refreshOverview();
      void refreshReview();
      void refreshFire();
    } catch (err) {
      setItemDeleteError(toErrorMessage(err));
    } finally {
      setItemDeleteBusy(false);
      setItemDeletingRowId("");
    }
  }

  return {
    currentYearText, yearOptions,
    itemsBusy, itemsError, itemsResult, refreshItems,
    itemUpsertBusy, itemUpsertError, itemUpsertResult, upsertItem,
    itemDeleteBusy, itemDeleteError, itemDeleteResult, deleteItem,
    itemCreateOpen, openItemCreateModal, closeItemCreateModal, itemDeletingRowId, itemForm, setItemForm,
    overviewBusy, overviewError, overviewResult, overviewQuery, setOverviewQuery, refreshOverview,
    reviewBusy, reviewError, reviewResult, reviewQuery, setReviewQuery, refreshReview,
    fireBusy, fireError, fireResult, refreshFire,
    incomeBusy, incomeError, incomeResult, incomeQuery, setIncomeQuery, refreshIncome,
  };
}
