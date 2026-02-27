import { formatCentsShort, formatPct, formatRatePct } from "./amountFormatting";
import { readArray, readBool, readNumber, readString } from "../utils/value";

export function summarizeInvestmentReturnPayload(payload: unknown): string {
  const account = readString(payload, "account_name") ?? readString(payload, "account_id") ?? "-";
  const rate = formatRatePct(readNumber(payload, "metrics.return_rate"));
  const profit = formatCentsShort(readNumber(payload, "metrics.profit_cents"));
  return `${account} | return=${rate} | profit=${profit}`;
}

export function summarizeInvestmentCurvePayload(payload: unknown): string {
  const points = readNumber(payload, "summary.count") ?? readArray(payload, "rows").length;
  const endAssets = formatCentsShort(readNumber(payload, "summary.end_assets_cents"));
  const endReturn = formatRatePct(readNumber(payload, "summary.end_cumulative_return_rate"));
  return `points=${points} | end_assets=${endAssets} | end_return=${endReturn}`;
}

export function summarizeWealthOverviewPayload(payload: unknown): string {
  const asOf = readString(payload, "as_of") ?? "-";
  const netAssets = formatCentsShort(readNumber(payload, "summary.net_asset_total_cents"));
  const stale = readNumber(payload, "summary.stale_account_count") ?? 0;
  const recon = readBool(payload, "summary.reconciliation_ok") ? "OK" : "Mismatch";
  return `as_of=${asOf} | net=${netAssets} | stale=${stale} | recon=${recon}`;
}

export function summarizeWealthCurvePayload(payload: unknown): string {
  const points = readNumber(payload, "range.points") ?? readArray(payload, "rows").length;
  const endWealth = formatCentsShort(readNumber(payload, "summary.end_wealth_cents"));
  const changePct = formatPct(readNumber(payload, "summary.change_pct"));
  return `points=${points} | end_wealth=${endWealth} | change=${changePct}`;
}

export function summarizeYzxyPreviewPayload(payload: unknown): string {
  const parserKind = readString(payload, "parser_kind") ?? "-";
  const parsedCount = readNumber(payload, "parsed_count") ?? 0;
  const errorCount = readNumber(payload, "error_count") ?? 0;
  return `parser=${parserKind} | parsed=${parsedCount} | errors=${errorCount}`;
}

export function summarizeYzxyImportPayload(payload: unknown): string {
  const imported = readNumber(payload, "imported_count") ?? 0;
  const errors = readNumber(payload, "error_count") ?? 0;
  const parserKind = readString(payload, "preview.parser_kind") ?? "-";
  return `imported=${imported} | errors=${errors} | parser=${parserKind}`;
}

export function summarizeCmbEmlPreviewPayload(payload: unknown): string {
  const files = readNumber(payload, "summary.input_files_count") ?? 0;
  const records = readNumber(payload, "summary.records_count") ?? 0;
  const review = readNumber(payload, "summary.needs_review_count") ?? 0;
  return `files=${files} | records=${records} | needs_review=${review}`;
}

export function summarizeCmbEmlImportPayload(payload: unknown): string {
  const imported = readNumber(payload, "imported_count") ?? 0;
  const errors = readNumber(payload, "import_error_count") ?? 0;
  const records = readNumber(payload, "summary.records_count") ?? 0;
  return `imported=${imported} | errors=${errors} | records=${records}`;
}

export function summarizeCmbBankPdfPreviewPayload(payload: unknown): string {
  const importRows = readNumber(payload, "summary.import_rows_count") ?? 0;
  const total = readNumber(payload, "summary.total_records") ?? 0;
  const expense = readNumber(payload, "summary.expense_rows_count") ?? 0;
  const income = readNumber(payload, "summary.income_rows_count") ?? 0;
  return `records=${total} | import_rows=${importRows} | expense=${expense} | income=${income}`;
}

export function summarizeCmbBankPdfImportPayload(payload: unknown): string {
  const imported = readNumber(payload, "imported_count") ?? 0;
  const errors = readNumber(payload, "import_error_count") ?? 0;
  const importRows = readNumber(payload, "preview.summary.import_rows_count") ?? 0;
  return `imported=${imported} | errors=${errors} | import_rows=${importRows}`;
}
