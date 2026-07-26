import { invoke } from "./invoke";

export type BudgetYearQueryRequest = { year?: string };
export type FireProgressQueryRequest = { year?: string; withdrawal_rate?: string };
export type MonthlyBudgetItemsQueryRequest = Record<string, never>;
export type ConsumptionReportQueryRequest = { year?: string };
export type MonthlyBudgetItemUpsertRequest = {
  id?: string;
  name?: string;
  monthly_amount?: string;
  sort_order?: string;
  is_active?: "true" | "false";
};
export type MonthlyBudgetItemDeleteRequest = { id?: string };

type DynamicBudgetPayload = Record<string, unknown>;
export type MonthlyBudgetItemsPayload = DynamicBudgetPayload;
export type MonthlyBudgetItemMutationPayload = DynamicBudgetPayload;
export type BudgetOverviewPayload = DynamicBudgetPayload;
export type BudgetMonthlyReviewPayload = DynamicBudgetPayload;
export type SalaryIncomeOverviewPayload = DynamicBudgetPayload;
export type FireProgressPayload = DynamicBudgetPayload;
export type ConsumptionReportPayload = DynamicBudgetPayload;

export async function queryMonthlyBudgetItems(
  req: MonthlyBudgetItemsQueryRequest = {},
): Promise<MonthlyBudgetItemsPayload> {
  return invoke<MonthlyBudgetItemsPayload>("query_monthly_budget_items", { req });
}
export async function upsertMonthlyBudgetItem(
  req: MonthlyBudgetItemUpsertRequest,
): Promise<MonthlyBudgetItemMutationPayload> {
  return invoke<MonthlyBudgetItemMutationPayload>("upsert_monthly_budget_item", { req });
}
export async function deleteMonthlyBudgetItem(
  req: MonthlyBudgetItemDeleteRequest,
): Promise<MonthlyBudgetItemMutationPayload> {
  return invoke<MonthlyBudgetItemMutationPayload>("delete_monthly_budget_item", { req });
}
export async function queryBudgetOverview(req: BudgetYearQueryRequest): Promise<BudgetOverviewPayload> {
  return invoke<BudgetOverviewPayload>("query_budget_overview", { req });
}
export async function queryBudgetMonthlyReview(req: BudgetYearQueryRequest): Promise<BudgetMonthlyReviewPayload> {
  return invoke<BudgetMonthlyReviewPayload>("query_budget_monthly_review", { req });
}
export async function querySalaryIncomeOverview(req: BudgetYearQueryRequest): Promise<SalaryIncomeOverviewPayload> {
  return invoke<SalaryIncomeOverviewPayload>("query_salary_income_overview", { req });
}
export async function queryConsumptionReport(
  req: ConsumptionReportQueryRequest = {},
): Promise<ConsumptionReportPayload> {
  return invoke<ConsumptionReportPayload>("query_consumption_report", { req });
}
export async function queryFireProgress(req: FireProgressQueryRequest): Promise<FireProgressPayload> {
  return invoke<FireProgressPayload>("query_fire_progress", { req });
}
