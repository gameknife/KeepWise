import { readArray, readNumber, readString } from "../../utils/value";

export type AnalysisExportProfile = {
  personaSummary: string;
  riskAppetite: "保守" | "平衡" | "进取";
  liquidityNeed: string;
  investmentGoals: string;
  analysisAsk: string;
  currency: string;
};

export type AnalysisExportOptions = {
  includeAmounts: boolean;
  includeConsumptionDetail: boolean;
  includeEmployerNames: boolean;
  includeAccountIds: boolean;
  roundAmountsToWan: boolean;
  includeJsonAppendix: boolean;
};

type NoteMap = Record<string, { holdings_text?: string; risk_note?: string; note_text?: string }>;

const ASSET_CLASS_LABELS: Record<string, string> = {
  investment: "投资",
  cash: "现金",
  real_estate: "不动产",
  liability: "负债",
};

function escapeCell(value: unknown): string {
  const text = `${value ?? ""}`.trim();
  if (!text) return "-";
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function centsAt(root: unknown, path: string): number | undefined {
  const value = readNumber(root, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatAmount(cents: number | undefined, options: AnalysisExportOptions): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  const sign = cents < 0 ? "-" : "";
  const absCents = Math.abs(cents);
  if (!options.includeAmounts) {
    const yuan = absCents / 100;
    if (yuan >= 1_000_000) return `${sign}>= 100 万`;
    if (yuan >= 500_000) return `${sign}50-100 万`;
    if (yuan >= 100_000) return `${sign}10-50 万`;
    return `${sign}< 10 万`;
  }
  if (options.roundAmountsToWan) {
    return `${sign}${(absCents / 100 / 10000).toFixed(1)} 万`;
  }
  return `${sign}${(absCents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(part: number | undefined, total: number | undefined): string {
  if (
    typeof part !== "number" ||
    typeof total !== "number" ||
    !Number.isFinite(part) ||
    !Number.isFinite(total) ||
    total === 0
  ) {
    return "-";
  }
  return `${((part / total) * 100).toFixed(1)}%`;
}

function noteMapFromPayload(payload: unknown): NoteMap {
  const notes: NoteMap = {};
  for (const item of readArray(payload, "account_notes")) {
    const accountId = readString(item, "account_id");
    if (!accountId) continue;
    notes[accountId] = {
      holdings_text: readString(item, "holdings_text") ?? "",
      risk_note: readString(item, "risk_note") ?? "",
      note_text: readString(item, "note_text") ?? "",
    };
  }
  return notes;
}

function markdownTable(headers: string[], rows: string[][], emptyText: string): string {
  if (rows.length === 0) return emptyText;
  const align = headers.map((_, idx) => (idx === 0 ? "---" : "---:"));
  return [
    `| ${headers.join(" | ")} |`,
    `| ${align.join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function wealthSummaryRows(payload: unknown, options: AnalysisExportOptions): string[][] {
  const summary = {
    investment: centsAt(payload, "wealth_overview.summary.investment_total_cents"),
    cash: centsAt(payload, "wealth_overview.summary.cash_total_cents"),
    realEstate: centsAt(payload, "wealth_overview.summary.real_estate_total_cents"),
    liability: centsAt(payload, "wealth_overview.summary.liability_total_cents"),
    netAsset: centsAt(payload, "wealth_overview.summary.net_asset_total_cents"),
  };
  const asOf = readString(payload, "wealth_overview.summary.as_of") ?? readString(payload, "as_of") ?? "-";
  const total = summary.netAsset;
  return [
    ["投资", formatAmount(summary.investment, options), percent(summary.investment, total), asOf],
    ["现金", formatAmount(summary.cash, options), percent(summary.cash, total), asOf],
    ["不动产", formatAmount(summary.realEstate, options), percent(summary.realEstate, total), asOf],
    ["负债", formatAmount(summary.liability, options), percent(summary.liability, total), asOf],
    ["**净资产**", `**${formatAmount(summary.netAsset, options)}**`, "100%", "-"],
  ];
}

function accountRows(payload: unknown, assetClass: string, notes: NoteMap, options: AnalysisExportOptions): string[][] {
  return readArray(payload, "wealth_overview.rows")
    .filter((row) => readString(row, "asset_class") === assetClass)
    .map((row) => {
      const accountId = readString(row, "account_id") ?? "";
      const account = options.includeAccountIds
        ? `${readString(row, "account_name") ?? accountId} (${accountId})`
        : readString(row, "account_name") ?? accountId;
      return [
        account,
        formatAmount(centsAt(row, "value_cents"), options),
        readString(row, "snapshot_date") ?? "-",
        `${readNumber(row, "stale_days") ?? 0}`,
        notes[accountId]?.holdings_text ?? "",
        notes[accountId]?.risk_note ?? "",
      ];
    });
}

function sampledCurveRows(payload: unknown, options: AnalysisExportOptions): string[][] {
  const rows = readArray(payload, "wealth_curve.rows");
  if (rows.length <= 14) {
    return rows.map((row) => [
      readString(row, "snapshot_date") ?? "-",
      formatAmount(centsAt(row, "wealth_total_cents"), options),
      formatAmount(centsAt(row, "net_asset_total_cents"), options),
      formatAmount(centsAt(row, "wealth_net_growth_cents"), options),
    ]);
  }
  const step = Math.max(1, Math.floor(rows.length / 12));
  return rows
    .filter((_, idx) => idx === 0 || idx === rows.length - 1 || idx % step === 0)
    .slice(0, 14)
    .map((row) => [
      readString(row, "snapshot_date") ?? "-",
      formatAmount(centsAt(row, "wealth_total_cents"), options),
      formatAmount(centsAt(row, "net_asset_total_cents"), options),
      formatAmount(centsAt(row, "wealth_net_growth_cents"), options),
    ]);
}

function portfolioReturnRows(payload: unknown, options: AnalysisExportOptions): string[][] {
  return [
    ["YTD", "portfolio_ytd"],
    ["近 1 年", "portfolio_1y"],
    ["近 3 年", "portfolio_3y"],
    ["成立以来", "portfolio_since_inception"],
  ].map(([label, key]) => {
    const root = `investment_returns.${key}.metrics`;
    return [
      label,
      formatAmount(centsAt(payload, `${root}.begin_assets_cents`), options),
      formatAmount(centsAt(payload, `${root}.end_assets_cents`), options),
      formatAmount(centsAt(payload, `${root}.net_flow_cents`), options),
      formatAmount(centsAt(payload, `${root}.profit_cents`), options),
      readString(payload, `${root}.return_rate_pct`) ?? "-",
      readString(payload, `${root}.annualized_rate_pct`) ?? "-",
    ];
  });
}

function accountReturnRows(payload: unknown, options: AnalysisExportOptions): string[][] {
  const netAsset = centsAt(payload, "wealth_overview.summary.net_asset_total_cents");
  return readArray(payload, "investment_returns.accounts_since_inception.rows").map((row) => [
    readString(row, "account_name") ?? readString(row, "account_id") ?? "-",
    formatAmount(centsAt(row, "begin_assets_cents"), options),
    formatAmount(centsAt(row, "end_assets_cents"), options),
    formatAmount(centsAt(row, "net_flow_cents"), options),
    formatAmount(centsAt(row, "profit_cents"), options),
    readString(row, "return_rate_pct") ?? "-",
    readString(row, "annualized_rate_pct") ?? "-",
    percent(centsAt(row, "end_assets_cents"), netAsset),
  ]);
}

function incomeLines(payload: unknown, options: AnalysisExportOptions): string[] {
  const year = readString(payload, "year") ?? "-";
  const employers = readArray(payload, "salary_income.employers").map((item, idx) => {
    const name = options.includeEmployerNames ? readString(item, "employer") ?? "未知雇主" : `雇主 ${String.fromCharCode(65 + idx)}`;
    const amount = formatAmount(centsAt(item, "amount_cents"), options);
    return `${name} ${amount}`;
  });
  return [
    `- ${year} 年累计工资：${formatAmount(centsAt(payload, "salary_income.summary.salary_total_cents"), options)} 元`,
    `- 累计住房公积金：${formatAmount(centsAt(payload, "salary_income.summary.housing_fund_total_cents"), options)} 元`,
    `- 雇主分布：${employers.length > 0 ? employers.join(" / ") : "暂无记录"}`,
  ];
}

function consumptionLines(payload: unknown, options: AnalysisExportOptions): string[] {
  const year = readString(payload, "year") ?? "-";
  const topCategories = readArray(payload, "consumption.top_expense_categories")
    .slice(0, 5)
    .map((item) => `${readString(item, "expense_category") ?? "待分类"} ${readString(item, "amount") ?? "-"}`);
  const months = readArray(payload, "consumption.months");
  const total = centsAt(payload, "consumption.consumption_total_value") !== undefined
    ? Math.round((readNumber(payload, "consumption.consumption_total_value") ?? 0) * 100)
    : undefined;
  const monthlyAvg = months.length > 0 && typeof total === "number" ? Math.round(total / months.length) : undefined;
  return [
    `- ${year} 年累计消费：${formatAmount(total, options)} 元`,
    `- TOP 5 类别：${topCategories.length > 0 ? topCategories.join(" / ") : "暂无记录"}`,
    `- 月均支出：${formatAmount(monthlyAvg, options)} 元`,
    `- 消费明细：${options.includeConsumptionDetail ? "已包含商户与交易明细" : "已脱敏，仅保留汇总"}`,
  ];
}

function budgetFireLines(payload: unknown, options: AnalysisExportOptions): string[] {
  return [
    `- 年度预算：${formatAmount(centsAt(payload, "budget_overview.budget.annual_total_cents"), options)} 元；YTD 已用：${formatAmount(centsAt(payload, "budget_overview.actual.spent_total_cents"), options)} 元（usage_rate ${readString(payload, "budget_overview.metrics.usage_rate_pct_text") ?? "-"})`,
    `- 投资性资产：${formatAmount(centsAt(payload, "fire.investable_assets.investable_assets_cents"), options)} 元`,
    `- 自由度（4% 法则）：${readString(payload, "fire.metrics.freedom_ratio_pct_text") ?? "-"}`,
    `- 覆盖年限：${readString(payload, "fire.metrics.coverage_years_text") ?? "-"}`,
    `- 距 FIRE 目标：${formatAmount(centsAt(payload, "fire.metrics.goal_gap_cents"), options)} 元`,
  ];
}

export function buildAnalysisMarkdown(
  payload: unknown,
  profile: AnalysisExportProfile,
  options: AnalysisExportOptions,
): string {
  const notes = noteMapFromPayload(payload);
  const generatedAt = readString(payload, "generated_at") ?? "-";
  const asOf = readString(payload, "as_of") || readString(payload, "wealth_overview.summary.as_of") || "-";
  const privacy = [
    options.includeAmounts ? "金额可见" : "金额分桶",
    options.includeConsumptionDetail ? "消费明细可见" : "消费明细已脱敏",
    options.includeEmployerNames ? "雇主名称可见" : "雇主名称已匿名",
    options.includeAccountIds ? "账户 ID 可见" : "账户 ID 已隐藏",
  ].join("、");
  const sections: string[] = [
    "# KeepWise 资产分析快照",
    "",
    `- 生成时间：${generatedAt}`,
    `- 数据截至：${asOf}`,
    `- 货币单位：${profile.currency || "CNY"}`,
    `- 隐私模式：${privacy}`,
    "",
    "## 1. 用户画像",
    profile.personaSummary.trim() || "暂无补充。",
    "",
    `- 风险偏好：${profile.riskAppetite}`,
    `- 短期流动性需求：${profile.liquidityNeed.trim() || "暂无补充。"}`,
    `- 长期目标：${profile.investmentGoals.trim() || "暂无补充。"}`,
    "",
    "## 2. 净资产摘要",
    "",
    markdownTable(["资产类别", "金额（元）", "占比", "最近更新"], wealthSummaryRows(payload, options), "暂无净资产摘要。"),
    "",
    "> 数据口径：净资产 = 投资 + 现金 + 不动产 - 负债；过期超过 30 天的账户以 stale_days 标注。",
    "",
    "## 3. 账户明细",
  ];

  for (const assetClass of ["investment", "cash", "real_estate", "liability"]) {
    sections.push(
      "",
      `### 3.${["investment", "cash", "real_estate", "liability"].indexOf(assetClass) + 1} ${ASSET_CLASS_LABELS[assetClass]}账户`,
      "",
      markdownTable(
        ["账户", "最新资产", "快照日期", "stale_days", "用户备注（持仓）", "风险备注"],
        accountRows(payload, assetClass, notes, options),
        `暂无${ASSET_CLASS_LABELS[assetClass]}账户记录。`,
      ),
    );
  }

  sections.push(
    "",
    "## 4. 财富曲线（采样）",
    "",
    markdownTable(
      ["日期", "总资产（元）", "净资产（元）", "期间净增长"],
      sampledCurveRows(payload, options),
      "暂无财富曲线记录。",
    ),
    "",
    "> 数据口径：曲线采样自 wealth_curve_query，期间净增长 = 当点 - 起点。",
    "",
    "## 5. 投资收益分析",
    "",
    "### 5.1 组合层（Modified Dietz）",
    "",
    markdownTable(
      ["区间", "期初", "期末", "净流", "净利", "区间收益率", "年化"],
      portfolioReturnRows(payload, options),
      "暂无组合收益记录。",
    ),
    "",
    "### 5.2 账户层（since_inception）",
    "",
    markdownTable(
      ["账户", "期初", "期末", "净流", "净利", "收益率", "年化", "占比"],
      accountReturnRows(payload, options),
      "暂无账户层收益记录。",
    ),
    "",
    "## 6. 收入与消费现状",
    "",
    "### 6.1 收入（基于招行 PDF 流水）",
    ...incomeLines(payload, options),
    "",
    "### 6.2 消费",
    ...consumptionLines(payload, options),
    "",
    "## 7. 预算与 FIRE 进度",
    ...budgetFireLines(payload, options),
    "",
    "## 8. 我希望分析师关注的问题",
    profile.analysisAsk.trim() || "请基于上述资产、现金流、风险偏好和账户备注，给出资产配置、风险集中度、再平衡和 FIRE 进度建议。",
    "",
    "---",
    "",
    "## 附录 A：数据口径说明",
    "- 金额单位：元；关闭具体金额时输出区间标签。",
    "- 投资收益率算法：Modified Dietz（现金加权）。",
    "- 消费默认排除 needs_review 与 excluded_in_analysis 的支出交易。",
    "- stale_days = 数据快照日期距 as_of 的天数。",
  );

  if (options.includeJsonAppendix) {
    sections.push("", "## 附录 B：原始 JSON 摘要", "", "```json", JSON.stringify(payload, null, 2), "```");
  }

  return sections.join("\n").trimEnd();
}
