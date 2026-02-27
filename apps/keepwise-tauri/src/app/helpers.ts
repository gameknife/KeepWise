import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { type AppSettings, type ImportStepRow, type SmokeRow } from "../types/app";
import { isRecord, readArray } from "../utils/value";

export function getTodayDateInputValueLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthDateRangeLocal(): { from: string; to: string } {
  const to = getTodayDateInputValueLocal();
  return { from: `${to.slice(0, 7)}-01`, to };
}

export function parseStoredAppSettings(raw: string | null): AppSettings {
  const fallback: AppSettings = {
    gainLossColorScheme: "cn_red_up_green_down",
    defaultPrivacyMaskOnLaunch: false,
    uiMotionEnabled: true,
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const scheme =
      parsed.gainLossColorScheme === "intl_green_up_red_down" || parsed.gainLossColorScheme === "cn_red_up_green_down"
        ? parsed.gainLossColorScheme
        : fallback.gainLossColorScheme;
    return {
      gainLossColorScheme: scheme,
      defaultPrivacyMaskOnLaunch: parsed.defaultPrivacyMaskOnLaunch === true,
      uiMotionEnabled: parsed.uiMotionEnabled !== false,
    };
  } catch {
    return fallback;
  }
}

export function formatMonthDayLabel(dateIso?: string): string {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return "-";
  const month = Number(dateIso.slice(5, 7));
  const day = Number(dateIso.slice(8, 10));
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "-";
  return `${month}月${day}日`;
}

export function parseMonthNumberFromMonthKey(monthKey?: string): number | null {
  if (!monthKey || !/^\d{4}-(\d{2})$/.test(monthKey)) return null;
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  return month;
}

export function parseYuanInputToNumber(raw?: string): number | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeMonthlyTotalAssetGrowthFromWealthCurve(data: unknown):
  | { deltaCents: number; baselineDate: string; latestDate: string }
  | undefined {
  if (!isRecord(data)) return undefined;
  const rows = readArray(data, "rows").filter(isRecord);
  if (rows.length < 2) return undefined;
  const points = rows
    .map((row) => {
      const snapshotDate = typeof row.snapshot_date === "string" ? row.snapshot_date : "";
      if (!snapshotDate) return null;
      const cash = typeof row.cash_total_cents === "number" ? row.cash_total_cents : 0;
      const realEstate = typeof row.real_estate_total_cents === "number" ? row.real_estate_total_cents : 0;
      const investment = typeof row.investment_total_cents === "number" ? row.investment_total_cents : 0;
      return {
        snapshotDate,
        totalAssetsCents: cash + realEstate + investment,
      };
    })
    .filter((v): v is { snapshotDate: string; totalAssetsCents: number } => v !== null)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  if (points.length < 2) return undefined;
  const curr = points[points.length - 1];
  if (!curr) return undefined;
  const latestDate = curr.snapshotDate;
  if (!latestDate || latestDate.length < 7) return undefined;
  const currentMonthStart = `${latestDate.slice(0, 7)}-01`;
  const prevCandidates = points.filter((p) => p.snapshotDate < currentMonthStart);
  const prev = prevCandidates[prevCandidates.length - 1];
  if (!prev || !Number.isFinite(prev.totalAssetsCents)) return undefined;
  if (!Number.isFinite(curr.totalAssetsCents)) return undefined;
  return {
    deltaCents: curr.totalAssetsCents - prev.totalAssetsCents,
    baselineDate: prev.snapshotDate,
    latestDate: curr.snapshotDate,
  };
}

export function formatPresetLabel(preset?: string): string {
  switch (preset) {
    case "ytd":
      return "年初至今";
    case "1y":
      return "近1年";
    case "3y":
      return "近3年";
    case "since_inception":
      return "成立以来";
    case "custom":
      return "自定义";
    default:
      return preset && String(preset).trim() ? String(preset) : "-";
  }
}

export function safeNumericInputValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseNumericInputWithFallback(raw: string, fallback: number): number {
  const next = Number(raw);
  return Number.isFinite(next) ? next : fallback;
}

export function makeEnterToQueryHandler(run: () => void | Promise<void>) {
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    if (target instanceof HTMLInputElement && target.type === "checkbox") return;
    e.preventDefault();
    void run();
  };
}

export function makeInitialSmokeRows(): SmokeRow[] {
  return [
    { key: "investment-return", label: "投资区间收益率", status: "idle" },
    { key: "investment-curve", label: "投资曲线", status: "idle" },
    { key: "wealth-overview", label: "财富总览", status: "idle" },
    { key: "wealth-curve", label: "财富曲线", status: "idle" },
  ];
}

export function withSmokeResult(rows: SmokeRow[], next: SmokeRow): SmokeRow[] {
  return rows.map((row) => (row.key === next.key ? next : row));
}

export function makeInitialImportStepRows(): ImportStepRow[] {
  return [
    { key: "yzxy", label: "有知有行 XLSX/CSV", status: "idle" },
    { key: "cmb-eml", label: "招行信用卡 EML", status: "idle" },
    { key: "cmb-pdf", label: "招行银行流水 PDF", status: "idle" },
  ];
}
