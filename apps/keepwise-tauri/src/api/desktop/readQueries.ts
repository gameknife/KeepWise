import { invoke } from "./invoke";

export type ReadAssetClass = "cash" | "real_estate" | "liability";
export type AccountQueryKind = "all" | "investment" | ReadAssetClass;

export type MetaAccountsQueryRequest = {
  kind?: AccountQueryKind;
};

export type QueryTransactionsRequest = {
  limit?: number;
  month_key?: string;
  source_type?: string;
  account_id?: string;
  keyword?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
};

export type QueryInvestmentsRequest = {
  limit?: number;
  from?: string;
  to?: string;
  source_type?: string;
  account_id?: string;
};

export type QueryAssetValuationsRequest = {
  limit?: number;
  from?: string;
  to?: string;
  asset_class?: "" | ReadAssetClass;
  account_id?: string;
};

export type QueryImportJobsRequest = {
  limit?: number;
};

export type MetaInvestmentAccount = {
  account_id: string;
  account_name: string;
  record_count: number;
  first_snapshot_date: string;
  latest_snapshot_date: string;
};

export type MetaAssetAccount = MetaInvestmentAccount & {
  asset_class: ReadAssetClass;
};

export type MetaAccountsPayload = {
  kind: AccountQueryKind;
  accounts: Array<MetaInvestmentAccount | MetaAssetAccount>;
  investment_accounts: MetaInvestmentAccount[];
  cash_accounts: MetaAssetAccount[];
  real_estate_accounts: MetaAssetAccount[];
  liability_accounts: MetaAssetAccount[];
};

export type QueryTransactionRow = {
  id: string;
  posted_at: string | null;
  occurred_at: string | null;
  direction: string;
  merchant: string | null;
  merchant_normalized: string | null;
  description: string | null;
  amount_cents: number;
  statement_category: string | null;
  source_type: string | null;
  category_id: string | null;
  excluded_in_analysis: 0 | 1;
  exclude_reason: string;
  expense_category: string;
  manual_excluded: boolean;
  manual_exclude_reason: string;
};

export type QueryTransactionsPayload = {
  summary: {
    count: number;
    total_amount_cents: number;
    total_amount_yuan: string;
    source_type: string;
    excluded_count_in_rows: number;
    excluded_total_abs_cents_in_rows: number;
    excluded_total_abs_yuan_in_rows: string;
    sort: string;
  };
  rows: QueryTransactionRow[];
};

export type QueryInvestmentRow = {
  id: string;
  snapshot_date: string;
  account_id: string;
  account_name: string | null;
  total_assets_cents: number;
  transfer_amount_cents: number;
  source_type: string | null;
};

export type QueryInvestmentsPayload = {
  summary: {
    count: number;
    latest_total_assets_cents: number;
    latest_total_assets_yuan: string;
    net_transfer_amount_cents: number;
    net_transfer_amount_yuan: string;
    source_type: string;
  };
  rows: QueryInvestmentRow[];
};

export type QueryAssetValuationRow = {
  id: string;
  account_id: string;
  account_name: string;
  asset_class: ReadAssetClass;
  snapshot_date: string;
  value_cents: number;
  source_type: string | null;
};

export type QueryAssetValuationsPayload = {
  summary: {
    count: number;
    sum_value_cents: number;
    sum_value_yuan: string;
    asset_class: "" | ReadAssetClass;
  };
  rows: QueryAssetValuationRow[];
};

export type ImportJobRow = {
  id: string;
  source_type: string;
  source_file: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  total_count: number;
  imported_count: number;
  error_count: number;
  error_message: string | null;
  transaction_count: number;
  investment_record_count: number;
  data_kind: "mixed" | "transaction" | "investment_snapshot" | "unknown";
  data_label: string;
  data_date_from: string | null;
  data_date_to: string | null;
};

export type ImportJobsPayload = {
  summary: {
    total_count: number;
    success_count: number;
    failed_count: number;
    running_count: number;
    returned_count: number;
    limit: number;
  };
  rows: ImportJobRow[];
};

export async function queryMetaAccounts(req: MetaAccountsQueryRequest): Promise<MetaAccountsPayload> {
  return invoke<MetaAccountsPayload>("meta_accounts_query", { req });
}

export async function queryTransactions(req: QueryTransactionsRequest): Promise<QueryTransactionsPayload> {
  return invoke<QueryTransactionsPayload>("query_transactions", { req });
}

export async function queryInvestments(req: QueryInvestmentsRequest): Promise<QueryInvestmentsPayload> {
  return invoke<QueryInvestmentsPayload>("query_investments", { req });
}

export async function queryAssetValuations(
  req: QueryAssetValuationsRequest,
): Promise<QueryAssetValuationsPayload> {
  return invoke<QueryAssetValuationsPayload>("query_asset_valuations", { req });
}

export async function queryImportJobs(req: QueryImportJobsRequest = {}): Promise<ImportJobsPayload> {
  return invoke<ImportJobsPayload>("query_import_jobs", { req });
}
