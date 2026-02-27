import { type ComponentType } from "react";
import { isRecord, readArray, readNumber, readPath, readString } from "../../utils/value";

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

export function YzxyPreviewSummaryReport({
  data,
  PreviewStat,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行预览，查看解析摘要与样例行。</p>;
  }
  const file = readString(data, "file") ?? "-";
  const parserKind = readString(data, "parser_kind") ?? "-";
  const parsedCount = readNumber(data, "parsed_count") ?? 0;
  const errorCount = readNumber(data, "error_count") ?? 0;
  const previewRows = readArray(data, "preview_rows").length;
  const mapping = readPath(data, "mapping");
  const mappingCount = isRecord(mapping) ? Object.keys(mapping).length : 0;
  const errors = readArray(data, "errors").filter((v): v is string => typeof v === "string").slice(0, 5);

  return (
    <>
      <div className="preview-subtle">
        文件： <code>{file}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Parser" value={parserKind} />
        <PreviewStat label="解析行数" value={parsedCount} tone={parsedCount > 0 ? "good" : "warn"} />
        <PreviewStat label="预览行数" value={previewRows} />
        <PreviewStat label="映射字段数" value={mappingCount} />
        <PreviewStat label="错误数" value={errorCount} tone={errorCount > 0 ? "warn" : "good"} />
      </div>
      {errors.length > 0 ? (
        <ul className="text-list">
          {errors.map((err, idx) => (
            <li key={`${idx}-${err}`}>{err}</li>
          ))}
        </ul>
      ) : (
        <div className="preview-note">预览结果正常，可以继续导入。</div>
      )}
    </>
  );
}


export function YzxyImportSummaryReport({
  data,
  PreviewStat,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  if (!isRecord(data)) return <p className="placeholder">尚未导入。请先确认预览结果后执行导入。</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const sourceType = readString(data, "source_type") ?? "-";
  const parserKind = readString(data, "preview.parser_kind") ?? "-";
  return (
    <>
      <div className="preview-subtle">
        source_type <code>{sourceType}</code> | parser <code>{parserKind}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="导入成功" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="错误数" value={errors} tone={errors > 0 ? "warn" : "good"} />
      </div>
      <div className="preview-note">
        导入任务 ID： <code>{jobId}</code>
      </div>
    </>
  );
}


export function CmbEmlPreviewSummaryReport({
  data,
  PreviewStat,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行预览，查看解析/分类摘要后再导入。</p>;
  }
  const files = readNumber(data, "summary.input_files_count") ?? 0;
  const records = readNumber(data, "summary.records_count") ?? 0;
  const consume = readNumber(data, "summary.consume_count") ?? 0;
  const review = readNumber(data, "summary.needs_review_count") ?? 0;
  const excluded = readNumber(data, "summary.excluded_count") ?? 0;
  const failed = readNumber(data, "summary.failed_files_count") ?? 0;
  const failedFiles = readArray(data, "summary.failed_files").filter(isRecord).slice(0, 5);

  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="EML 文件数" value={files} />
        <PreviewStat label="记录数" value={records} tone={records > 0 ? "good" : "warn"} />
        <PreviewStat label="消费记录数" value={consume} />
        <PreviewStat label="待确认数" value={review} tone={review > 0 ? "warn" : "good"} />
        <PreviewStat label="排除数" value={excluded} />
        <PreviewStat label="失败文件数" value={failed} tone={failed > 0 ? "warn" : "good"} />
      </div>
      {failedFiles.length > 0 ? (
        <ul className="text-list">
          {failedFiles.map((row, idx) => {
            const file = typeof row.file === "string" ? row.file : "unknown";
            const err = typeof row.error === "string" ? row.error : "unknown";
            return <li key={`${idx}-${file}`}>{`${file}: ${err}`}</li>;
          })}
        </ul>
      ) : (
        <div className="preview-note">预览摘要已生成，请确认数量和待确认项后再导入。</div>
      )}
    </>
  );
}


export function CmbEmlImportSummaryReport({
  data,
  PreviewStat,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  if (!isRecord(data)) return <p className="placeholder">尚未导入。请先确认预览结果后执行导入。</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "import_error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const records = readNumber(data, "summary.records_count") ?? 0;
  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="导入成功" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="导入错误数" value={errors} tone={errors > 0 ? "warn" : "good"} />
        <PreviewStat label="预览记录数" value={records} />
      </div>
      <div className="preview-note">
        导入任务 ID： <code>{jobId}</code>
      </div>
    </>
  );
}


export function CmbBankPdfPreviewSummaryReport({
  data,
  PreviewStat,
  formatCentsShort,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
  formatCentsShort: (cents?: number) => string;
}) {
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行预览，确认规则分类摘要后再导入。</p>;
  }
  const accountLast4 = readString(data, "header.account_last4") ?? "-";
  const rangeStart = readString(data, "header.range_start") ?? "-";
  const rangeEnd = readString(data, "header.range_end") ?? "-";
  const total = readNumber(data, "summary.total_records") ?? 0;
  const importRows = readNumber(data, "summary.import_rows_count") ?? 0;
  const expenseRows = readNumber(data, "summary.expense_rows_count") ?? 0;
  const incomeRows = readNumber(data, "summary.income_rows_count") ?? 0;
  const expenseTotal = readNumber(data, "summary.expense_total_cents");
  const incomeTotal = readNumber(data, "summary.income_total_cents");
  const ruleCountsRaw = readPath(data, "rule_counts");
  const ruleEntries = isRecord(ruleCountsRaw)
    ? Object.entries(ruleCountsRaw)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number")
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : [];

  return (
    <>
      <div className="preview-subtle">
        账户尾号 <code>{accountLast4}</code> | 区间 <code>{rangeStart}</code> ~ <code>{rangeEnd}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="总记录数" value={total} />
        <PreviewStat label="可导入行数" value={importRows} tone={importRows > 0 ? "good" : "warn"} />
        <PreviewStat label="支出行数" value={expenseRows} />
        <PreviewStat label="收入行数" value={incomeRows} />
        <PreviewStat label="支出合计（元）" value={formatCentsShort(expenseTotal)} />
        <PreviewStat label="收入合计（元）" value={formatCentsShort(incomeTotal)} />
      </div>
      {ruleEntries.length > 0 ? (
        <div className="preview-subtle">
          规则命中统计：{" "}
          {ruleEntries.map(([k, v]) => (
            <span key={k}>
              <code>{k}</code>={v}{" "}
            </span>
          ))}
        </div>
      ) : null}
      <div className="preview-note">请确认规则命中统计与样例后再导入。</div>
    </>
  );
}


export function CmbBankPdfImportSummaryReport({
  data,
  PreviewStat,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  if (!isRecord(data)) return <p className="placeholder">尚未导入。请先确认预览结果后执行导入。</p>;
  const imported = readNumber(data, "imported_count") ?? 0;
  const errors = readNumber(data, "import_error_count") ?? 0;
  const jobId = readString(data, "import_job_id") ?? "-";
  const importRows = readNumber(data, "preview.summary.import_rows_count") ?? 0;
  const expenseRows = readNumber(data, "preview.summary.expense_rows_count") ?? 0;
  const incomeRows = readNumber(data, "preview.summary.income_rows_count") ?? 0;
  return (
    <>
      <div className="preview-stat-grid">
        <PreviewStat label="导入成功" value={imported} tone={imported > 0 ? "good" : "warn"} />
        <PreviewStat label="导入错误数" value={errors} tone={errors > 0 ? "warn" : "good"} />
        <PreviewStat label="预览可导入行数" value={importRows} />
        <PreviewStat label="支出行数" value={expenseRows} />
        <PreviewStat label="收入行数" value={incomeRows} />
      </div>
      <div className="preview-note">
        导入任务 ID： <code>{jobId}</code>
      </div>
    </>
  );
}
