import { describe, expect, it } from "vitest";

import { buildAnalysisMarkdown, type AnalysisExportOptions, type AnalysisExportProfile } from "./buildMarkdown";

const profile: AnalysisExportProfile = {
  personaSummary: "长期投资者",
  riskAppetite: "平衡",
  liquidityNeed: "保留应急金",
  investmentGoals: "长期增值",
  analysisAsk: "检查集中度",
  currency: "CNY",
};

const options: AnalysisExportOptions = {
  includeAmounts: true,
  includeConsumptionDetail: false,
  includeEmployerNames: false,
  includeAccountIds: false,
  roundAmountsToWan: false,
  includeJsonAppendix: false,
};

const payload = {
  generated_at: "2026-07-16T10:00:00+08:00",
  as_of: "2026-07-15",
  wealth_overview: {
    summary: {
      as_of: "2026-07-15",
      investment_total_cents: 12_000_000,
      cash_total_cents: 3_000_000,
      real_estate_total_cents: 0,
      liability_total_cents: 0,
      net_asset_total_cents: 15_000_000,
    },
    rows: [{ account_id: "secret-id", account_name: "证券账户", asset_class: "investment", value_cents: 12_000_000 }],
  },
  account_notes: [{ account_id: "secret-id", holdings_text: "沪深300", risk_note: "波动", note_text: "长期" }],
};

describe("buildAnalysisMarkdown", () => {
  it("emits stable report sections and account notes", () => {
    const markdown = buildAnalysisMarkdown(payload, profile, options);
    expect(markdown).toContain("# KeepWise 资产分析快照");
    expect(markdown).toContain("长期投资者");
    expect(markdown).toContain("沪深300");
    expect(markdown).not.toContain("secret-id");
  });

  it("uses amount buckets when exact amounts are hidden", () => {
    const markdown = buildAnalysisMarkdown(payload, profile, { ...options, includeAmounts: false });
    expect(markdown).toContain("金额分桶");
    expect(markdown).toContain("10-50 万");
    expect(markdown).not.toContain("120,000.00");
  });
});
