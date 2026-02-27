import { useState, type ComponentType } from "react";
import { isRecord, readArray, readNumber, readString } from "../../utils/value";

type TableSortDirection = "asc" | "desc";

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

type LineAreaChartProps = {
  points: Array<{ label: string; value: number }>;
  color?: string;
  xLabelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (point: { label: string; value: number }) => string;
  height?: number;
  preferZeroBaseline?: boolean;
  maxXTicks?: number;
};

type SortableHeaderButtonProps = {
  label: string;
  sortKey: string;
  activeSortKey: string;
  sortDir: TableSortDirection;
  onToggle: (nextSortKey: string) => void;
};

export function SalaryIncomeOverviewPreview({
  data,
  formatCentsShort,
  PreviewStat,
  LineAreaChart,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  formatCentsShort: (cents?: number) => string;
  PreviewStat: ComponentType<PreviewStatProps>;
  LineAreaChart: ComponentType<LineAreaChartProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [rowSortKey, setRowSortKey] = useState<string>("month_key");
  const [rowSortDir, setRowSortDir] = useState<TableSortDirection>("asc");
  const [employerSortKey, setEmployerSortKey] = useState<string>("amount_cents");
  const [employerSortDir, setEmployerSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const year = readNumber(data, "year");
  const asOf = readString(data, "as_of_date") ?? "-";
  const sourceType = readString(data, "source_type") ?? "-";
  const rows = readArray(data, "rows").filter(isRecord);
  const employers = readArray(data, "employers").filter(isRecord);
  const salaryTotal = readNumber(data, "summary.salary_total_cents");
  const fundTotal = readNumber(data, "summary.housing_fund_total_cents");
  const totalIncome = readNumber(data, "summary.total_income_cents");
  const salaryCount = readNumber(data, "summary.salary_tx_count");
  const fundCount = readNumber(data, "summary.housing_fund_tx_count");
  const monthsWithSalary = readNumber(data, "summary.months_with_salary");
  const monthsWithFund = readNumber(data, "summary.months_with_housing_fund");
  const employerCount = readNumber(data, "summary.employer_count");
  const incomeChartPoints = rows
    .map((r) => {
      const label = typeof r.month_key === "string" ? r.month_key : "";
      const value = typeof r.total_income_cents === "number" ? r.total_income_cents : NaN;
      return label && Number.isFinite(value) ? { label, value } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);
  const sortedRows = [...rows].sort((a, b) => {
    const cmp = compareSortValues(a[rowSortKey], b[rowSortKey]);
    return rowSortDir === "asc" ? cmp : -cmp;
  });
  const sortedEmployers = [...employers].sort((a, b) => {
    const cmp = compareSortValues(a[employerSortKey], b[employerSortKey]);
    return employerSortDir === "asc" ? cmp : -cmp;
  });
  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>工资收入概览预览</h3>
        <div className="preview-subtle">
          {year ?? "-"} 年 · {sourceType} · as_of {asOf}
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="工资总额(元)" value={formatCentsShort(salaryTotal)} />
        <PreviewStat label="公积金总额(元)" value={formatCentsShort(fundTotal)} />
        <PreviewStat label="总收入(元)" value={formatCentsShort(totalIncome)} tone={(totalIncome ?? 0) > 0 ? "good" : "warn"} />
        <PreviewStat label="工资笔数" value={salaryCount ?? 0} />
        <PreviewStat label="公积金笔数" value={fundCount ?? 0} />
        <PreviewStat label="工资到账月数" value={monthsWithSalary ?? 0} />
        <PreviewStat label="公积金到账月数" value={monthsWithFund ?? 0} />
        <PreviewStat label="雇主数" value={employerCount ?? 0} />
      </div>
      <div className="preview-chart-grid">
        <div className="sparkline-card">
          <div className="sparkline-title">月度总收入</div>
          <LineAreaChart
            points={incomeChartPoints}
            color="#88d8aa"
            height={220}
            preferZeroBaseline
            maxXTicks={12}
            xLabelFormatter={(label) => (label.length >= 7 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
      </div>
      {sortedEmployers.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="雇主" sortKey="employer" activeSortKey={employerSortKey} sortDir={employerSortDir} onToggle={(key) => {
                  const next = nextSortState(employerSortKey, employerSortDir, key);
                  setEmployerSortKey(next.key);
                  setEmployerSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="笔数" sortKey="tx_count" activeSortKey={employerSortKey} sortDir={employerSortDir} onToggle={(key) => {
                  const next = nextSortState(employerSortKey, employerSortDir, key);
                  setEmployerSortKey(next.key);
                  setEmployerSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount_cents" activeSortKey={employerSortKey} sortDir={employerSortDir} onToggle={(key) => {
                  const next = nextSortState(employerSortKey, employerSortDir, key);
                  setEmployerSortKey(next.key);
                  setEmployerSortDir(next.dir);
                }} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedEmployers.map((row, idx) => {
                const employer = typeof row.employer === "string" ? row.employer : `row_${idx}`;
                const txCount = typeof row.tx_count === "number" ? row.tx_count : 0;
                const amount = typeof row.amount_cents === "number" ? row.amount_cents : undefined;
                return (
                  <tr key={`${employer}-${idx}`}>
                    <td className="truncate-cell" title={employer}>{employer}</td>
                    <td className="num">{txCount}</td>
                    <td className="num">{formatCentsShort(amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="月份" sortKey="month_key" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="工资(元)" sortKey="salary_cents" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="公积金(元)" sortKey="housing_fund_cents" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="总收入(元)" sortKey="total_income_cents" activeSortKey={rowSortKey} sortDir={rowSortDir} onToggle={(key) => {
                  const next = nextSortState(rowSortKey, rowSortDir, key);
                  setRowSortKey(next.key);
                  setRowSortDir(next.dir);
                }} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const monthKey = typeof row.month_key === "string" ? row.month_key : `m_${idx}`;
                const salary = typeof row.salary_cents === "number" ? row.salary_cents : undefined;
                const fund = typeof row.housing_fund_cents === "number" ? row.housing_fund_cents : undefined;
                const total = typeof row.total_income_cents === "number" ? row.total_income_cents : undefined;
                return (
                  <tr key={`${monthKey}-${idx}`}>
                    <td>{monthKey}</td>
                    <td className="num">{formatCentsShort(salary)}</td>
                    <td className="num">{formatCentsShort(fund)}</td>
                    <td className="num">{formatCentsShort(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

