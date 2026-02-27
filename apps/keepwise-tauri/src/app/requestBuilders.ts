import {
  type BudgetYearQueryRequest,
  type FireProgressQueryRequest,
  type InvestmentCurveQueryRequest,
  type InvestmentReturnQueryRequest,
  type InvestmentReturnsQueryRequest,
  type MetaAccountsQueryRequest,
  type MonthlyBudgetItemUpsertRequest,
  type QueryAccountCatalogRequest,
  type QueryAssetValuationsRequest,
  type QueryInvestmentsRequest,
  type QueryTransactionsRequest,
  type WealthCurveQueryRequest,
  type WealthOverviewQueryRequest,
  type UpsertAccountCatalogEntryRequest,
} from "../lib/desktopApi";

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

export function buildInvestmentReturnRequest(invQuery: {
  account_id?: string;
  preset?: string;
  from?: string;
  to?: string;
}): InvestmentReturnQueryRequest {
  const req: InvestmentReturnQueryRequest = {
    account_id: `${invQuery.account_id ?? "__portfolio__"}`,
    preset: `${invQuery.preset ?? "ytd"}`,
  };
  if (`${invQuery.from ?? ""}`.trim()) req.from = `${invQuery.from}`.trim();
  if (`${invQuery.to ?? ""}`.trim()) req.to = `${invQuery.to}`.trim();
  return req;
}

export function buildReturnTabQuickMetricRequest(invQuery: {
  account_id?: string;
}): InvestmentReturnQueryRequest {
  const accountId = `${invQuery.account_id ?? ""}`.trim();
  return {
    account_id: accountId || "__portfolio__",
    preset: "ytd",
  };
}

export function buildInvestmentCurveRequest(invCurveQuery: {
  account_id?: string;
  preset?: string;
  from?: string;
  to?: string;
}): InvestmentCurveQueryRequest {
  const req: InvestmentCurveQueryRequest = {
    account_id: `${invCurveQuery.account_id ?? "__portfolio__"}`,
    preset: `${invCurveQuery.preset ?? "ytd"}`,
  };
  if (`${invCurveQuery.from ?? ""}`.trim()) req.from = `${invCurveQuery.from}`.trim();
  if (`${invCurveQuery.to ?? ""}`.trim()) req.to = `${invCurveQuery.to}`.trim();
  return req;
}

export function buildInvestmentReturnsRequest(invCurveQuery: {
  preset?: string;
  from?: string;
  to?: string;
}): InvestmentReturnsQueryRequest {
  const req: InvestmentReturnsQueryRequest = {
    preset: invCurveQuery.preset || "ytd",
    limit: 500,
  };
  const from = `${invCurveQuery.from ?? ""}`.trim();
  const to = `${invCurveQuery.to ?? ""}`.trim();
  if (from) req.from = from;
  if (to) req.to = to;
  return req;
}

export function buildMetaAccountsRequest(metaAccountsQuery: { kind?: MetaAccountsQueryRequest["kind"] }): MetaAccountsQueryRequest {
  return { kind: metaAccountsQuery.kind ?? "all" };
}

export function buildWealthOverviewRequest(
  wealthOverviewQuery: {
    include_investment: WealthOverviewQueryRequest["include_investment"];
    include_cash: WealthOverviewQueryRequest["include_cash"];
    include_real_estate: WealthOverviewQueryRequest["include_real_estate"];
    include_liability: WealthOverviewQueryRequest["include_liability"];
  },
  wealthCurveQuery: {
    preset?: string;
    to?: string;
  },
): WealthOverviewQueryRequest {
  const req: WealthOverviewQueryRequest = {
    include_investment: wealthOverviewQuery.include_investment,
    include_cash: wealthOverviewQuery.include_cash,
    include_real_estate: wealthOverviewQuery.include_real_estate,
    include_liability: wealthOverviewQuery.include_liability,
  };
  if (wealthCurveQuery.preset === "custom" && `${wealthCurveQuery.to ?? ""}`.trim()) {
    req.as_of = `${wealthCurveQuery.to}`.trim();
  }
  return req;
}

export function buildWealthCurveRequest(wealthCurveQuery: {
  preset?: string;
  from?: string;
  to?: string;
  include_investment: WealthCurveQueryRequest["include_investment"];
  include_cash: WealthCurveQueryRequest["include_cash"];
  include_real_estate: WealthCurveQueryRequest["include_real_estate"];
  include_liability: WealthCurveQueryRequest["include_liability"];
}): WealthCurveQueryRequest {
  const req: WealthCurveQueryRequest = {
    preset: `${wealthCurveQuery.preset ?? "ytd"}`,
    include_investment: wealthCurveQuery.include_investment,
    include_cash: wealthCurveQuery.include_cash,
    include_real_estate: wealthCurveQuery.include_real_estate,
    include_liability: wealthCurveQuery.include_liability,
  };
  if (`${wealthCurveQuery.from ?? ""}`.trim()) req.from = `${wealthCurveQuery.from}`.trim();
  if (`${wealthCurveQuery.to ?? ""}`.trim()) req.to = `${wealthCurveQuery.to}`.trim();
  return req;
}

export function buildBudgetYearQueryRequest(query: BudgetYearQueryRequest): BudgetYearQueryRequest {
  const req: BudgetYearQueryRequest = {};
  const year = `${query.year ?? ""}`.trim();
  if (year) req.year = year;
  return req;
}

export function buildFireProgressQueryRequest(fireProgressQuery: FireProgressQueryRequest): FireProgressQueryRequest {
  const req: FireProgressQueryRequest = {};
  const withdrawalRate = `${fireProgressQuery.withdrawal_rate ?? ""}`.trim();
  if (withdrawalRate) req.withdrawal_rate = withdrawalRate;
  return req;
}

export function buildBudgetItemUpsertMutationRequest(
  budgetItemForm: MonthlyBudgetItemUpsertRequest,
): MonthlyBudgetItemUpsertRequest {
  const req: MonthlyBudgetItemUpsertRequest = {
    name: `${budgetItemForm.name ?? ""}`.trim(),
    monthly_amount: `${budgetItemForm.monthly_amount ?? ""}`.trim(),
    sort_order: `${budgetItemForm.sort_order ?? ""}`.trim(),
    is_active: budgetItemForm.is_active ?? "true",
  };
  const id = `${budgetItemForm.id ?? ""}`.trim();
  if (id) req.id = id;
  return req;
}

export function buildTransactionsQueryRequest(txListQuery: QueryTransactionsRequest): QueryTransactionsRequest {
  const req: QueryTransactionsRequest = {
    limit: Number(txListQuery.limit ?? 20),
    sort: txListQuery.sort ?? "date_desc",
  };
  const monthKey = `${txListQuery.month_key ?? ""}`.trim();
  const sourceType = `${txListQuery.source_type ?? ""}`.trim();
  const accountId = `${txListQuery.account_id ?? ""}`.trim();
  const keyword = `${txListQuery.keyword ?? ""}`.trim();
  if (monthKey) req.month_key = monthKey;
  if (sourceType) req.source_type = sourceType;
  if (accountId) req.account_id = accountId;
  if (keyword) req.keyword = keyword;
  return req;
}

export function buildInvestmentsListQueryRequest(invListQuery: QueryInvestmentsRequest): QueryInvestmentsRequest {
  const req: QueryInvestmentsRequest = {
    limit: Number(invListQuery.limit ?? 30),
  };
  const from = `${invListQuery.from ?? ""}`.trim();
  const to = `${invListQuery.to ?? ""}`.trim();
  const sourceType = `${invListQuery.source_type ?? ""}`.trim();
  const accountId = `${invListQuery.account_id ?? ""}`.trim();
  if (from) req.from = from;
  if (to) req.to = to;
  if (sourceType) req.source_type = sourceType;
  if (accountId) req.account_id = accountId;
  return req;
}

export function buildAssetValuationsQueryRequest(
  assetListQuery: QueryAssetValuationsRequest,
): QueryAssetValuationsRequest {
  const req: QueryAssetValuationsRequest = {
    limit: Number(assetListQuery.limit ?? 30),
  };
  const from = `${assetListQuery.from ?? ""}`.trim();
  const to = `${assetListQuery.to ?? ""}`.trim();
  const assetClass = `${assetListQuery.asset_class ?? ""}`.trim() as QueryAssetValuationsRequest["asset_class"];
  const accountId = `${assetListQuery.account_id ?? ""}`.trim();
  if (from) req.from = from;
  if (to) req.to = to;
  if (assetClass) req.asset_class = assetClass;
  if (accountId) req.account_id = accountId;
  return req;
}

export function buildAccountCatalogQueryRequest(acctCatalogQuery: QueryAccountCatalogRequest): QueryAccountCatalogRequest {
  const req: QueryAccountCatalogRequest = {
    kind: acctCatalogQuery.kind ?? "all",
    limit: Number(acctCatalogQuery.limit ?? 200),
  };
  const keyword = `${acctCatalogQuery.keyword ?? ""}`.trim();
  if (keyword) req.keyword = keyword;
  return req;
}

export function buildAccountCatalogUpsertRequest(
  acctCatalogUpsertForm: UpsertAccountCatalogEntryRequest,
): UpsertAccountCatalogEntryRequest {
  return {
    account_name: `${acctCatalogUpsertForm.account_name ?? ""}`.trim(),
    account_kind: acctCatalogUpsertForm.account_kind,
  };
}

export function buildAdminResetRequest(adminResetConfirmText: string): { confirm_text?: string } {
  return { confirm_text: adminResetConfirmText.trim() };
}

export function compactStringFields<T extends Record<string, unknown>>(input: T): T {
  const out = { ...input } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = value.trim();
  }
  return out as T;
}
