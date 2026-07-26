import { startTransition, useState } from "react";

import {
  queryAssetValuations,
  queryInvestments,
  queryMetaAccounts,
  queryTransactions,
  type MetaAccountsPayload,
  type MetaAccountsQueryRequest,
  type QueryAssetValuationsPayload,
  type QueryAssetValuationsRequest,
  type QueryInvestmentsPayload,
  type QueryInvestmentsRequest,
  type QueryTransactionsPayload,
  type QueryTransactionsRequest,
} from "../../api/desktop";
import {
  buildAssetValuationsQueryRequest,
  buildInvestmentsListQueryRequest,
  buildMetaAccountsRequest,
  buildTransactionsQueryRequest,
  toErrorMessage,
} from "../../app/requestBuilders";

export function useRecordsController() {
  const [metaBusy, setMetaBusy] = useState(false);
  const [metaError, setMetaError] = useState("");
  const [metaResult, setMetaResult] = useState<MetaAccountsPayload | null>(null);
  const [metaQuery, setMetaQuery] = useState<MetaAccountsQueryRequest>({ kind: "all" });
  const [transactionsBusy, setTransactionsBusy] = useState(false);
  const [transactionsError, setTransactionsError] = useState("");
  const [transactionsResult, setTransactionsResult] = useState<QueryTransactionsPayload | null>(null);
  const [transactionsQuery, setTransactionsQuery] = useState<QueryTransactionsRequest>({
    limit: 100, sort: "date_desc", month_key: "", source_type: "", account_id: "", keyword: "",
  });
  const [investmentsBusy, setInvestmentsBusy] = useState(false);
  const [investmentsError, setInvestmentsError] = useState("");
  const [investmentsResult, setInvestmentsResult] = useState<QueryInvestmentsPayload | null>(null);
  const [investmentsQuery, setInvestmentsQuery] = useState<QueryInvestmentsRequest>({
    limit: 30, from: "", to: "", source_type: "", account_id: "",
  });
  const [assetsBusy, setAssetsBusy] = useState(false);
  const [assetsError, setAssetsError] = useState("");
  const [assetsResult, setAssetsResult] = useState<QueryAssetValuationsPayload | null>(null);
  const [assetsQuery, setAssetsQuery] = useState<QueryAssetValuationsRequest>({
    limit: 30, from: "", to: "", asset_class: "", account_id: "",
  });

  async function refreshMeta() {
    setMetaBusy(true);
    setMetaError("");
    try {
      const payload = await queryMetaAccounts(buildMetaAccountsRequest(metaQuery));
      startTransition(() => setMetaResult(payload));
    } catch (err) {
      setMetaError(toErrorMessage(err));
    } finally {
      setMetaBusy(false);
    }
  }

  async function refreshTransactions() {
    setTransactionsBusy(true);
    setTransactionsError("");
    try {
      const payload = await queryTransactions(buildTransactionsQueryRequest(transactionsQuery));
      startTransition(() => setTransactionsResult(payload));
    } catch (err) {
      setTransactionsError(toErrorMessage(err));
    } finally {
      setTransactionsBusy(false);
    }
  }

  async function refreshInvestments() {
    setInvestmentsBusy(true);
    setInvestmentsError("");
    try {
      const payload = await queryInvestments(buildInvestmentsListQueryRequest(investmentsQuery));
      startTransition(() => setInvestmentsResult(payload));
    } catch (err) {
      setInvestmentsError(toErrorMessage(err));
    } finally {
      setInvestmentsBusy(false);
    }
  }

  async function refreshAssets() {
    setAssetsBusy(true);
    setAssetsError("");
    try {
      const payload = await queryAssetValuations(buildAssetValuationsQueryRequest(assetsQuery));
      startTransition(() => setAssetsResult(payload));
    } catch (err) {
      setAssetsError(toErrorMessage(err));
    } finally {
      setAssetsBusy(false);
    }
  }

  return {
    metaBusy, metaError, metaResult, metaQuery, setMetaQuery, refreshMeta,
    transactionsBusy, transactionsError, transactionsResult, transactionsQuery, setTransactionsQuery, refreshTransactions,
    investmentsBusy, investmentsError, investmentsResult, investmentsQuery, setInvestmentsQuery, refreshInvestments,
    assetsBusy, assetsError, assetsResult, assetsQuery, setAssetsQuery, refreshAssets,
  };
}
