import { useState } from "react";

import {
  confirmTransactionReview,
  queryConsumptionReport,
  updateTransactionAnalysisExclusion,
  upsertMerchantMapRule,
  type ConsumptionReportPayload,
} from "../../api/desktop";
import { useAsyncQuery } from "../../hooks/useAsyncQuery";

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

export function useConsumptionController() {
  const currentYearText = String(new Date().getFullYear());
  const query = useAsyncQuery<{ year?: string }, ConsumptionReportPayload>(
    queryConsumptionReport,
    { year: currentYearText },
    toErrorMessage,
  );
  const [year, setYear] = useState(currentYearText);
  const [categoryUpdatingMerchant, setCategoryUpdatingMerchant] = useState("");

  async function refresh() {
    try {
      await query.run({ year: year || undefined });
    } catch {
      // useAsyncQuery owns the visible error state.
    }
  }

  async function excludeTransaction(id: string, action: "exclude" | "restore", reason: string) {
    try {
      await updateTransactionAnalysisExclusion({ id, action, reason });
      void refresh();
    } catch (err) {
      query.setError(toErrorMessage(err));
    }
  }

  async function confirmReview(id: string) {
    try {
      await confirmTransactionReview({ id });
      void refresh();
    } catch (err) {
      query.setError(toErrorMessage(err));
    }
  }

  async function changeMerchantCategory(merchant: string, expenseCategory: string) {
    setCategoryUpdatingMerchant(merchant);
    try {
      await upsertMerchantMapRule({
        merchant_normalized: merchant,
        expense_category: expenseCategory,
        confidence: "0.95",
        note: "消费分析页快捷改分类",
      });
      void refresh();
    } catch (err) {
      query.setError(toErrorMessage(err));
    } finally {
      setCategoryUpdatingMerchant("");
    }
  }

  return {
    year,
    setYear,
    busy: query.busy,
    error: query.error,
    result: query.result,
    refresh,
    excludeTransaction,
    confirmReview,
    changeMerchantCategory,
    categoryUpdatingMerchant,
  };
}
