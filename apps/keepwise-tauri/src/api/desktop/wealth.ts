import { invoke } from "./invoke";

export type WealthOverviewQueryRequest = {
  as_of?: string;
  include_investment?: string;
  include_cash?: string;
  include_real_estate?: string;
  include_liability?: string;
};

export type WealthCurveQueryRequest = {
  preset?: string;
  from?: string;
  to?: string;
  include_investment?: string;
  include_cash?: string;
  include_real_estate?: string;
  include_liability?: string;
};

export type WealthFilters = {
  include_investment: boolean;
  include_cash: boolean;
  include_real_estate: boolean;
  include_liability: boolean;
};

export type WealthOverviewRow = {
  account_id: string;
  account_name: string;
  asset_class: "investment" | "cash" | "real_estate" | "liability";
  snapshot_date: string;
  stale_days: number;
  value_cents: number;
  value_yuan: string;
};

export type WealthOverviewSummary = {
  cash_total_cents: number;
  cash_total_yuan: string;
  gross_assets_total_cents: number;
  gross_assets_total_yuan: string;
  investment_total_cents: number;
  investment_total_yuan: string;
  liability_total_cents: number;
  liability_total_yuan: string;
  net_asset_total_cents: number;
  net_asset_total_yuan: string;
  real_estate_total_cents: number;
  real_estate_total_yuan: string;
  reconciliation_delta_cents: number;
  reconciliation_delta_yuan: string;
  reconciliation_ok: boolean;
  selected_rows_assets_total_cents: number;
  selected_rows_assets_total_yuan: string;
  selected_rows_liability_total_cents: number;
  selected_rows_liability_total_yuan: string;
  selected_rows_total_cents: number;
  selected_rows_total_yuan: string;
  stale_account_count: number;
  wealth_total_cents: number;
  wealth_total_yuan: string;
};

export type WealthOverviewPayload = {
  as_of: string;
  requested_as_of: string;
  filters: WealthFilters;
  rows: WealthOverviewRow[];
  summary: WealthOverviewSummary;
};

export type WealthCurveRow = {
  snapshot_date: string;
  cash_total_cents: number;
  cash_net_growth_cents: number;
  investment_total_cents: number;
  investment_net_growth_cents: number;
  real_estate_total_cents: number;
  real_estate_net_growth_cents: number;
  liability_total_cents: number;
  liability_net_growth_cents: number;
  net_asset_total_cents: number;
  net_asset_total_yuan: string;
  net_asset_net_growth_cents: number;
  wealth_total_cents: number;
  wealth_total_yuan: string;
  wealth_net_growth_cents: number;
  wealth_net_growth_yuan: string;
};

type WealthCurveAsset = "cash" | "investment" | "real_estate" | "liability" | "net_asset" | "wealth";
type WealthCurveChangeAsset = Exclude<WealthCurveAsset, "wealth">;

export type WealthCurveSummary = {
  [Key in `${WealthCurveAsset}_${"net_growth_cents" | "net_growth_yuan"}`]: number | string;
} & {
  [Key in `${"start" | "end"}_${WealthCurveAsset}_cents`]: number;
} & {
  [Key in `${"start" | "end"}_${WealthCurveAsset}_yuan`]: string;
} & {
  [Key in `${WealthCurveChangeAsset}_change_pct`]: number | null;
} & {
  [Key in `${WealthCurveChangeAsset}_change_pct_text`]: string | null;
} & {
  change_cents: number;
  change_yuan: string;
  change_pct: number | null;
  change_pct_text: string | null;
};

export type WealthCurvePayload = {
  filters: WealthFilters;
  range: {
    preset: string;
    requested_from: string;
    requested_to: string;
    effective_from: string;
    effective_to: string;
    points: number;
  };
  rows: WealthCurveRow[];
  summary: WealthCurveSummary;
};

export async function queryWealthOverview(
  req: WealthOverviewQueryRequest,
): Promise<WealthOverviewPayload> {
  return invoke<WealthOverviewPayload>("wealth_overview_query", { req });
}

export async function queryWealthCurve(req: WealthCurveQueryRequest): Promise<WealthCurvePayload> {
  return invoke<WealthCurvePayload>("wealth_curve_query", { req });
}
