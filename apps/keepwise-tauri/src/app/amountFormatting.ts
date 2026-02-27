import { type GainLossColorScheme } from "../types/app";

let amountPrivacyMaskedGlobal = false;
let gainLossColorSchemeGlobal: GainLossColorScheme = "cn_red_up_green_down";

export function configureAmountFormatting({
  amountPrivacyMasked,
  gainLossColorScheme,
}: {
  amountPrivacyMasked: boolean;
  gainLossColorScheme: GainLossColorScheme;
}) {
  amountPrivacyMaskedGlobal = amountPrivacyMasked;
  gainLossColorSchemeGlobal = gainLossColorScheme;
}

export function isAmountPrivacyMasked(): boolean {
  return amountPrivacyMaskedGlobal;
}

function isChinaGainLossColors(): boolean {
  return gainLossColorSchemeGlobal === "cn_red_up_green_down";
}

export function signedMetricTone(value?: number): "default" | "good" | "warn" {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "default";
  if (isChinaGainLossColors()) {
    return value > 0 ? "warn" : "good";
  }
  return value > 0 ? "good" : "warn";
}

export function maskAmountDisplayText(text: string): string {
  if (!isAmountPrivacyMasked()) return text;
  const trimmed = text.trim();
  if (!trimmed || trimmed === "-") return text;
  return "****";
}

function isMonetaryLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  if (
    /收益率|年化|占比|比例|进度|自由度|覆盖年数|滞后|笔数|账户数|文件数|数量|对账|状态|天数|days?|count|rate|ratio|pct|%/.test(
      normalized,
    )
  ) {
    return false;
  }
  return /元|yuan|金额|总额|资产|预算|支出|收入|工资|公积金|净增长|净资产|负债|差额|剩余|财富|现金流|value|amount|wealth|asset|liability|income|expense|salary|fund|profit|budget|growth/.test(
    normalized,
  );
}

export function maskAmountValueByLabel(label: string, value: string | number): string {
  const raw = String(value);
  if (!isMonetaryLabel(label)) return raw;
  return maskAmountDisplayText(raw);
}

export function isLikelyAmountJsonKey(key: string): boolean {
  return /(?:_cents|_yuan)$/i.test(key);
}

export function formatCentsShort(cents?: number): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  return maskAmountDisplayText(
    (cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  );
}

export function formatSignedDeltaCentsShort(cents?: number): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "-";
  const base = formatCentsShort(cents);
  if (base === "-") return base;
  return cents > 0 ? `+${base}` : base;
}

export function formatCentsInputValue(cents?: number): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

export function formatRatePct(rate?: number): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "-";
  return `${(rate * 100).toFixed(2)}%`;
}

export function formatPct(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatCentsYuanText(valueCents?: number): string {
  if (typeof valueCents !== "number" || !Number.isFinite(valueCents)) return "-";
  return (valueCents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
