import { useDebouncedAutoRun } from "../hooks/useDebouncedAutoRun";
import { type useAccountCatalogController } from "../features/accounts/useAccountCatalogController";
import { type useManualEntryController } from "../features/accounts/useManualEntryController";
import { type useBudgetController } from "../features/budget/useBudgetController";
import { type useConsumptionController } from "../features/consumption/useConsumptionController";
import { type useInvestmentController } from "../features/investment/useInvestmentController";
import { type useRecordsController } from "../features/records/useRecordsController";
import { type useWealthController } from "../features/wealth/useWealthController";
import { buildInvestmentCurveRequest, buildInvestmentReturnRequest, buildInvestmentReturnsRequest } from "./requestBuilders";

type Inputs = {
  activeTab: string;
  dbReady: boolean;
  fireWithdrawalRate: string;
  isAdminTab: boolean;
  isBudgetFireTab: boolean;
  isConsumptionAnalysisTab: boolean;
  isIncomeAnalysisTab: boolean;
  isReturnAnalysisTab: boolean;
  isWealthOverviewTab: boolean;
  shouldAutoLoadAccountSelectCatalog: boolean;
  accountCatalog: ReturnType<typeof useAccountCatalogController>;
  manualEntry: ReturnType<typeof useManualEntryController>;
  budget: ReturnType<typeof useBudgetController>;
  consumption: ReturnType<typeof useConsumptionController>;
  investment: ReturnType<typeof useInvestmentController>;
  records: ReturnType<typeof useRecordsController>;
  wealth: ReturnType<typeof useWealthController>;
};

export function useAppAutoRefresh(inputs: Inputs): void {
  const { accountCatalog, manualEntry, budget, consumption, investment, records, wealth } = inputs;
  const returnKey = JSON.stringify(buildInvestmentReturnRequest(investment.query));
  const curveKey = JSON.stringify(buildInvestmentCurveRequest(investment.curveQuery));
  const batchKey = JSON.stringify(buildInvestmentReturnsRequest(investment.curveQuery));
  const refreshReturn = investment.result === null || investment.lastQueryKey !== returnKey;
  const refreshCurve = investment.curveResult === null || investment.curveLastQueryKey !== curveKey;
  const refreshBatch = investment.batchResult === null || investment.batchLastQueryKey !== batchKey;
  const prefetchReturn = inputs.dbReady && investment.ytdAnnualizedRate === null && !investment.busy;
  const prefetchWealthOverview = inputs.dbReady && wealth.overviewResult === null && !wealth.overviewBusy;
  const prefetchWealthCurve = inputs.dbReady && wealth.curveResult === null && !wealth.curveBusy;
  const prefetchFire = inputs.dbReady && budget.fireResult === null && !budget.fireBusy;
  const prefetchIncome = inputs.dbReady && budget.incomeResult === null && !budget.incomeBusy;
  const prefetchConsumption = inputs.dbReady && consumption.result === null && !consumption.busy;
  const prefetchManual = inputs.dbReady && manualEntry.monthCount === null && !manualEntry.monthCountBusy;
  const prefetchManualAsset = inputs.dbReady && !manualEntry.assetLastDate && !manualEntry.assetLastDateBusy;

  useDebouncedAutoRun(accountCatalog.refreshSelectOptions, [inputs.activeTab], { enabled: inputs.shouldAutoLoadAccountSelectCatalog, delayMs: 220 });
  useDebouncedAutoRun(accountCatalog.refresh, [accountCatalog.query.kind ?? "all", accountCatalog.query.keyword ?? "", accountCatalog.query.limit ?? 200], { enabled: inputs.isAdminTab, delayMs: 220 });
  useDebouncedAutoRun(records.refreshMeta, [records.metaQuery.kind ?? "all"], { enabled: inputs.isAdminTab, delayMs: 220 });
  useDebouncedAutoRun(records.refreshInvestments, [records.investmentsQuery.limit ?? 30, records.investmentsQuery.from ?? "", records.investmentsQuery.to ?? "", records.investmentsQuery.source_type ?? "", records.investmentsQuery.account_id ?? ""], { enabled: inputs.isAdminTab, delayMs: 220 });
  useDebouncedAutoRun(records.refreshAssets, [records.assetsQuery.limit ?? 30, records.assetsQuery.from ?? "", records.assetsQuery.to ?? "", records.assetsQuery.asset_class ?? "", records.assetsQuery.account_id ?? ""], { enabled: inputs.isAdminTab, delayMs: 220 });
  useDebouncedAutoRun(manualEntry.refreshInvestmentAssets, [manualEntry.investmentOpen ? "open" : "closed", `${manualEntry.investmentForm.account_id ?? ""}`], { enabled: manualEntry.investmentOpen, delayMs: 180 });
  useDebouncedAutoRun(manualEntry.refreshAssetValue, [manualEntry.assetOpen ? "open" : "closed", manualEntry.assetForm.asset_class ?? "cash", `${manualEntry.assetForm.account_id ?? ""}`], { enabled: manualEntry.assetOpen, delayMs: 180 });
  useDebouncedAutoRun(consumption.refresh, [consumption.year], { enabled: inputs.isConsumptionAnalysisTab || prefetchConsumption, delayMs: 220 });
  useDebouncedAutoRun(manualEntry.refreshAssetLastDate, [], { enabled: prefetchManualAsset, delayMs: 260 });
  useDebouncedAutoRun(investment.refreshReturn, [investment.query.account_id, investment.query.preset, investment.query.from, investment.query.to], { enabled: (inputs.isReturnAnalysisTab && refreshReturn) || prefetchReturn, delayMs: 260 });
  useDebouncedAutoRun(investment.refreshCurve, [investment.curveQuery.account_id, investment.curveQuery.preset, investment.curveQuery.from, investment.curveQuery.to], { enabled: inputs.isReturnAnalysisTab && refreshCurve, delayMs: 260 });
  useDebouncedAutoRun(investment.refreshReturns, [investment.curveQuery.preset ?? "ytd", investment.curveQuery.from ?? "", investment.curveQuery.to ?? ""], { enabled: inputs.isReturnAnalysisTab && refreshBatch, delayMs: 260 });
  useDebouncedAutoRun(wealth.refreshOverview, [wealth.overviewQuery.include_investment ?? "true", wealth.overviewQuery.include_cash ?? "true", wealth.overviewQuery.include_real_estate ?? "true", wealth.overviewQuery.include_liability ?? "true"], { enabled: inputs.isWealthOverviewTab || prefetchWealthOverview, delayMs: 260 });
  useDebouncedAutoRun(wealth.refreshCurve, [wealth.curveQuery.preset ?? "ytd", wealth.curveQuery.from ?? "", wealth.curveQuery.to ?? "", wealth.curveQuery.include_investment ?? "true", wealth.curveQuery.include_cash ?? "true", wealth.curveQuery.include_real_estate ?? "true", wealth.curveQuery.include_liability ?? "true"], { enabled: inputs.isWealthOverviewTab || prefetchWealthCurve, delayMs: 260 });
  useDebouncedAutoRun(budget.refreshItems, [], { enabled: inputs.isBudgetFireTab, delayMs: 220 });
  useDebouncedAutoRun(budget.refreshOverview, [budget.overviewQuery.year ?? ""], { enabled: inputs.isBudgetFireTab, delayMs: 260 });
  useDebouncedAutoRun(budget.refreshReview, [budget.reviewQuery.year ?? ""], { enabled: inputs.isBudgetFireTab, delayMs: 260 });
  useDebouncedAutoRun(budget.refreshFire, [inputs.fireWithdrawalRate], { enabled: inputs.isBudgetFireTab || prefetchFire, delayMs: 260 });
  useDebouncedAutoRun(budget.refreshIncome, [budget.incomeQuery.year ?? ""], { enabled: inputs.isIncomeAnalysisTab || prefetchIncome, delayMs: 260 });
  useDebouncedAutoRun(manualEntry.refreshMonthCount, [], { enabled: prefetchManual, delayMs: 260 });
}
