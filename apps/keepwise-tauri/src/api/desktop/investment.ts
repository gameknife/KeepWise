import { invoke } from "./invoke";

export type InvestmentReturnQueryRequest = {
  account_id: string;
  preset?: string;
  from?: string;
  to?: string;
};

export type InvestmentCurveQueryRequest = {
  account_id: string;
  preset?: string;
  from?: string;
  to?: string;
  benchmark_source?: "eastmoney" | "yahoo";
};

export type InvestmentReturnsQueryRequest = {
  preset?: string;
  from?: string;
  to?: string;
  keyword?: string;
  limit?: number;
};

export type InvestmentCashFlow = {
  snapshot_date: string;
  transfer_amount_cents: number;
  transfer_amount_yuan: string;
  weight: number;
};

export type InvestmentReturnMetrics = {
  annualized_rate: number | null;
  annualized_rate_pct: string | null;
  begin_assets_cents: number;
  begin_assets_yuan: string;
  end_assets_cents: number;
  end_assets_yuan: string;
  net_flow_cents: number;
  net_flow_yuan: string;
  net_growth_cents: number;
  net_growth_yuan: string;
  note: string;
  profit_cents: number;
  profit_yuan: string;
  return_rate: number | null;
  return_rate_pct: string | null;
  weighted_capital_cents: number;
  weighted_capital_yuan: string;
};

export type InvestmentReturnRange = {
  effective_from: string;
  effective_to: string;
  interval_days: number;
  preset: string;
  requested_from: string;
  requested_to: string;
};

export type InvestmentReturnPayload = {
  account_id: string;
  account_name: string;
  account_count?: number;
  cash_flows: InvestmentCashFlow[];
  metrics: InvestmentReturnMetrics;
  range: InvestmentReturnRange;
};

export type InvestmentCurveTransferDetail = {
  account_id: string;
  account_name: string;
  transfer_amount_cents: number;
  transfer_amount_yuan: string;
};

export type InvestmentCurveRow = {
  anchor_from_snapshot_date: string;
  anchor_to_snapshot_date: string;
  cumulative_net_growth_cents: number;
  cumulative_net_growth_yuan: string;
  cumulative_return_pct: number | null;
  cumulative_return_pct_text: string | null;
  cumulative_return_rate: number | null;
  effective_snapshot_date: string;
  is_interpolated: boolean;
  snapshot_date: string;
  total_assets_cents: number;
  total_assets_yuan: string;
  transfer_amount_cents: number;
  transfer_amount_yuan: string;
  transfer_details?: InvestmentCurveTransferDetail[];
};

export type InvestmentCurveSummary = {
  change_cents: number;
  change_pct: number | null;
  change_pct_text: string | null;
  change_yuan: string;
  count: number;
  end_assets_cents: number;
  end_assets_yuan: string;
  end_cumulative_return_pct_text: string | null;
  end_cumulative_return_rate: number | null;
  end_net_growth_cents: number;
  end_net_growth_yuan: string;
  start_assets_cents: number;
  start_assets_yuan: string;
};

export type InvestmentBenchmarkCurveRow = {
  snapshot_date: string;
  effective_market_date: string;
  close: number;
  cumulative_return_rate: number;
  cumulative_return_pct: number;
  cumulative_return_pct_text: string;
};

export type InvestmentBenchmarkCurveAvailable = {
  key: "sse" | "hsi" | "sp500";
  label: string;
  symbol: string;
  source: string;
  baseline_date: string;
  baseline_close: number;
  end_return_rate: number | null;
  end_return_pct_text: string | null;
  rows: InvestmentBenchmarkCurveRow[];
  error: null;
};

export type InvestmentBenchmarkCurveUnavailable = {
  key: "sse" | "hsi" | "sp500";
  label: string;
  symbol: string;
  source: null;
  rows: [];
  error: string;
};

export type InvestmentBenchmarkCurve = InvestmentBenchmarkCurveAvailable | InvestmentBenchmarkCurveUnavailable;

export type InvestmentCurveBenchmarksPayload = {
  source: string;
  summary: {
    requested_count: number;
    available_count: number;
    warning_count: number;
  };
  curves: InvestmentBenchmarkCurve[];
  warnings: string[];
  load_failed?: boolean;
};

export type InvestmentCurvePayload = {
  account_id: string;
  account_name: string;
  account_count?: number;
  range: Omit<InvestmentReturnRange, "interval_days">;
  summary: InvestmentCurveSummary;
  rows: InvestmentCurveRow[];
  benchmarks?: InvestmentCurveBenchmarksPayload;
};

export type InvestmentReturnsRow = {
  account_id: string;
  account_name: string;
  record_count: number;
  first_snapshot_date: string;
  latest_snapshot_date: string;
  effective_from: string;
  effective_to: string;
  interval_days: number;
  begin_assets_cents: number;
  begin_assets_yuan: string;
  end_assets_cents: number;
  end_assets_yuan: string;
  net_flow_cents: number;
  net_flow_yuan: string;
  profit_cents: number;
  profit_yuan: string;
  net_growth_cents: number;
  net_growth_yuan: string;
  return_rate: number | null;
  return_rate_pct: string | null;
  annualized_rate: number | null;
  annualized_rate_pct: string | null;
  note: string;
};

export type InvestmentReturnsPayload = {
  range: {
    preset: string;
    requested_from: string;
    requested_to: string;
    input_limit: number;
    keyword: string;
  };
  summary: {
    account_count: number;
    computed_count: number;
    error_count: number;
    avg_return_rate: number | null;
    avg_return_pct: string | null;
  };
  rows: InvestmentReturnsRow[];
  errors: Array<{
    account_id: string;
    account_name: string;
    error: string;
  }>;
};

export async function queryInvestmentReturn(
  req: InvestmentReturnQueryRequest,
): Promise<InvestmentReturnPayload> {
  return invoke<InvestmentReturnPayload>("investment_return_query", { req });
}

export async function queryInvestmentReturns(
  req: InvestmentReturnsQueryRequest,
): Promise<InvestmentReturnsPayload> {
  return invoke<InvestmentReturnsPayload>("investment_returns_query", { req });
}

export async function queryInvestmentCurve(
  req: InvestmentCurveQueryRequest,
): Promise<InvestmentCurvePayload> {
  return invoke<InvestmentCurvePayload>("investment_curve_query", { req });
}

export async function queryInvestmentCurveBenchmarks(
  req: InvestmentCurveQueryRequest,
): Promise<InvestmentCurveBenchmarksPayload> {
  return invoke<InvestmentCurveBenchmarksPayload>("investment_curve_benchmarks_query", { req });
}
