import { type SidebarQuickMetric } from "./WorkspaceSidebar";
import {
  formatCentsShort,
  formatRatePct,
  formatSignedDeltaCentsShort,
  signedMetricTone,
} from "../../app/amountFormatting";
import {
  computeMonthlyTotalAssetGrowthFromWealthCurve,
  formatMonthDayLabel,
  parseMonthNumberFromMonthKey,
} from "../../app/helpers";
import { type ProductTabKey } from "../../types/app";
import { isRecord, readArray, readNumber, readString } from "../../utils/value";

type MetricInputs = {
  wealthCurveResult: unknown;
  wealthOverviewResult: unknown;
  fireProgressResult: unknown;
  salaryIncomeResult: unknown;
  consumptionOverviewResult: unknown;
  returnYtdAnnualizedRate: number | null;
  returnYtdNetGrowthCents: number | null;
  manualEntryMonthCountBusy: boolean;
  manualEntryMonthCount: number | null;
  manualAssetLastDateBusy: boolean;
  manualAssetLastDate: string;
};

export function useSidebarMetrics(inputs: MetricInputs): {
  sidebar: Partial<Record<ProductTabKey, SidebarQuickMetric[]>>;
  mobile: Partial<Record<ProductTabKey, SidebarQuickMetric[]>>;
} {
  const currentYearText = String(new Date().getFullYear());
  const returnAnnualizedText = formatRatePct(inputs.returnYtdAnnualizedRate ?? undefined);
  const returnAnnualizedTone = signedMetricTone(inputs.returnYtdAnnualizedRate ?? undefined);
  const returnNetGrowthText = formatSignedDeltaCentsShort(inputs.returnYtdNetGrowthCents ?? undefined);
  const returnNetGrowthTone = signedMetricTone(inputs.returnYtdNetGrowthCents ?? undefined);
  const monthlyGrowth = computeMonthlyTotalAssetGrowthFromWealthCurve(inputs.wealthCurveResult);
  const monthlyGrowthLabel = monthlyGrowth?.baselineDate
    ? `相比${formatMonthDayLabel(monthlyGrowth.baselineDate)}`
    : "月度增长";
  const fireFreedomText = readString(inputs.fireProgressResult, "metrics.freedom_ratio_pct_text")
    ?? readString(inputs.fireProgressResult, "freedom_ratio_pct_text")
    ?? "-";
  const manualEntryText = inputs.manualEntryMonthCountBusy && inputs.manualEntryMonthCount === null
    ? "..."
    : `${inputs.manualEntryMonthCount ?? 0}笔`;
  const manualAssetText = inputs.manualAssetLastDateBusy && !inputs.manualAssetLastDate
    ? "..."
    : (inputs.manualAssetLastDate || "未更新");

  const incomeRows = readArray(inputs.salaryIncomeResult, "rows").filter(isRecord);
  const latestIncome = incomeRows.reduce<{ monthKey: string; totalIncomeCents: number } | null>((best, row) => {
    const monthKey = typeof row.month_key === "string" ? row.month_key : "";
    const monthNum = parseMonthNumberFromMonthKey(monthKey);
    const totalIncomeCents = typeof row.total_income_cents === "number" ? row.total_income_cents : 0;
    if (totalIncomeCents <= 0 || monthNum === null) return best;
    return !best || monthKey > best.monthKey ? { monthKey, totalIncomeCents } : best;
  }, null);
  const incomeAsOfDate = readString(inputs.salaryIncomeResult, "as_of_date") ?? "";
  const asOfMonth = incomeAsOfDate.length >= 7 ? Number(incomeAsOfDate.slice(5, 7)) : NaN;
  const fallbackIncomeMonth = Number.isFinite(asOfMonth) && asOfMonth >= 1 && asOfMonth <= 12
    ? asOfMonth
    : new Date().getMonth() + 1;
  const incomeMonth = parseMonthNumberFromMonthKey(latestIncome?.monthKey) ?? fallbackIncomeMonth;

  const consumptionRows = readArray(inputs.consumptionOverviewResult, "months").filter(isRecord);
  const latestConsumption = consumptionRows.reduce<{ monthKey: string; amountCents: number } | null>((best, row) => {
    const monthKey = typeof row.month === "string" ? row.month : "";
    const monthNum = parseMonthNumberFromMonthKey(monthKey);
    const amountYuan = typeof row.amount === "number" ? row.amount : 0;
    if (monthNum === null || !Number.isFinite(amountYuan)) return best;
    const next = { monthKey, amountCents: Math.round(amountYuan * 100) };
    return !best || monthKey > best.monthKey ? next : best;
  }, null);
  const consumptionMonth = parseMonthNumberFromMonthKey(latestConsumption?.monthKey) ?? new Date().getMonth() + 1;
  const consumptionYearValue = readNumber(inputs.consumptionOverviewResult, "consumption_total_value");

  const metrics: Partial<Record<ProductTabKey, SidebarQuickMetric[]>> = {
    "manual-entry": [{ label: "本月已记", value: manualEntryText, tone: "default" }],
    "manual-asset-entry": [{ label: "最后更新", value: manualAssetText, tone: "default" }],
    "return-analysis": [
      { label: `${currentYearText}年预估`, value: returnAnnualizedText, tone: returnAnnualizedTone },
      { label: `${currentYearText}年净增`, value: returnNetGrowthText, tone: returnNetGrowthTone },
    ],
    "wealth-overview": [
      { label: monthlyGrowthLabel, value: formatSignedDeltaCentsShort(monthlyGrowth?.deltaCents), tone: signedMetricTone(monthlyGrowth?.deltaCents) },
      { label: "净资产", value: formatCentsShort(readNumber(inputs.wealthOverviewResult, "summary.net_asset_total_cents") ?? undefined), tone: "default" },
    ],
    "budget-fire": [
      { label: "自由度", value: fireFreedomText, tone: "default" },
      { label: "可投金额", value: formatCentsShort(readNumber(inputs.fireProgressResult, "investable_assets.total_cents") ?? undefined), tone: "default" },
    ],
    "income-analysis": [
      { label: `${incomeMonth}月收入`, value: formatCentsShort(latestIncome?.totalIncomeCents ?? 0), tone: "default" },
      { label: `${currentYearText}年收入`, value: formatCentsShort(readNumber(inputs.salaryIncomeResult, "summary.total_income_cents") ?? undefined), tone: "default" },
    ],
    "consumption-analysis": [
      { label: `${consumptionMonth}月消费`, value: formatCentsShort(latestConsumption?.amountCents ?? 0), tone: "warn" },
      { label: `${currentYearText}年消费`, value: formatCentsShort(typeof consumptionYearValue === "number" && Number.isFinite(consumptionYearValue) ? Math.round(consumptionYearValue * 100) : undefined), tone: "warn" },
    ],
  };
  return { sidebar: metrics, mobile: metrics };
}
