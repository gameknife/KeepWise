import { useState, type ComponentType } from "react";
import { isRecord, readArray, readBool, readNumber, readString } from "../../utils/value";

type TableSortDirection = "asc" | "desc";

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

type SortableHeaderButtonProps = {
  label: string;
  sortKey: string;
  activeSortKey: string;
  sortDir: TableSortDirection;
  onToggle: (nextSortKey: string) => void;
};

export function AdminDbStatsPreview({
  data,
  PreviewStat,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("row_count");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const dbPath = readString(data, "db_path") ?? "-";
  const confirmPhrase = readString(data, "confirm_phrase") ?? "-";
  const tableCount = readNumber(data, "summary.table_count");
  const totalRows = readNumber(data, "summary.total_rows");
  const sortedRows = [...rows].sort((a, b) => {
    const cmp = compareSortValues(
      sortKey === "table" ? a.table : a.row_count,
      sortKey === "table" ? b.table : b.row_count,
    );
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>DB Health Preview</h3>
        <div className="preview-subtle">
          <code>{dbPath}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Tables" value={tableCount ?? rows.length} />
        <PreviewStat
          label="Total Rows"
          value={typeof totalRows === "number" ? totalRows.toLocaleString() : "-"}
          tone={typeof totalRows === "number" && totalRows > 0 ? "good" : "warn"}
        />
        <PreviewStat label="Confirm Phrase" value={confirmPhrase} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="表名" sortKey="table" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="行数" sortKey="row_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const table = typeof row.table === "string" ? row.table : `row_${idx}`;
                const count = typeof row.row_count === "number" ? row.row_count : undefined;
                return (
                  <tr key={`${table}-${idx}`}>
                    <td>{table}</td>
                    <td className="num">{typeof count === "number" ? count.toLocaleString() : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="preview-note">No admin tables found in the current desktop DB.</p>
      )}
    </div>
  );
}


export function RuntimeHealthPreview({
  data,
  PreviewStat,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  if (!isRecord(data)) return null;
  const ok = readBool(data, "ok");
  const checkedAt = readString(data, "checked_at") ?? "-";
  const warnings = readArray(data, "warnings").filter((v): v is string => typeof v === "string");
  const failures = readArray(data, "failures").filter((v): v is string => typeof v === "string");
  const dbPath = readString(data, "checks.db_path") ?? "-";
  const totalRows = readNumber(data, "checks.db_stats.total_rows");
  const tableCount = readNumber(data, "checks.db_stats.table_count");
  const invCount = readNumber(data, "checks.accounts.investment_count");
  const cashCount = readNumber(data, "checks.accounts.cash_count");
  const reCount = readNumber(data, "checks.accounts.real_estate_count");
  const liabCount = readNumber(data, "checks.accounts.liability_count");
  const wealthRecon = readBool(data, "checks.wealth_overview.reconciliation_ok");
  const wealthRowCount = readNumber(data, "checks.wealth_overview.row_count");
  const wealthStale = readNumber(data, "checks.wealth_overview.stale_account_count");
  const portfolioCurveOk = readBool(data, "checks.portfolio_curve.ok");
  const portfolioCurveReturn = readString(data, "checks.portfolio_curve.end_cumulative_return_pct_text") ?? "-";
  const portfolioCurveGrowth = readString(data, "checks.portfolio_curve.end_net_growth_yuan") ?? "-";

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>Runtime Health Preview</h3>
        <div className="preview-subtle">
          checked_at <code>{checkedAt}</code>
        </div>
      </div>
      <div className="preview-subtle">
        DB: <code>{dbPath}</code>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Overall" value={ok ? "PASS" : "FAIL"} tone={ok ? "good" : "warn"} />
        <PreviewStat label="Warnings" value={warnings.length} tone={warnings.length > 0 ? "warn" : "good"} />
        <PreviewStat label="Failures" value={failures.length} tone={failures.length > 0 ? "warn" : "good"} />
        <PreviewStat label="Tables" value={tableCount ?? "-"} />
        <PreviewStat
          label="Total Rows"
          value={typeof totalRows === "number" ? totalRows.toLocaleString() : "-"}
          tone={typeof totalRows === "number" && totalRows > 0 ? "good" : "warn"}
        />
        <PreviewStat label="Investment Accts" value={invCount ?? 0} />
        <PreviewStat label="Cash Accts" value={cashCount ?? 0} />
        <PreviewStat label="RE Accts" value={reCount ?? 0} />
        <PreviewStat label="Liability Accts" value={liabCount ?? 0} />
        <PreviewStat
          label="Wealth Recon"
          value={wealthRecon === undefined ? "-" : wealthRecon ? "OK" : "Mismatch"}
          tone={wealthRecon === false ? "warn" : wealthRecon ? "good" : "default"}
        />
        <PreviewStat label="Wealth Rows" value={wealthRowCount ?? "-"} />
        <PreviewStat label="Stale Accts" value={wealthStale ?? "-"} tone={(wealthStale ?? 0) > 0 ? "warn" : "good"} />
      </div>

      <div className="preview-stat-grid">
        <PreviewStat
          label="Portfolio Curve"
          value={portfolioCurveOk === undefined ? "-" : portfolioCurveOk ? "OK" : "Skipped/Warn"}
          tone={portfolioCurveOk === false ? "warn" : portfolioCurveOk ? "good" : "default"}
        />
        <PreviewStat label="Curve Return" value={portfolioCurveReturn} />
        <PreviewStat label="Curve Growth (Yuan)" value={portfolioCurveGrowth} />
      </div>

      {warnings.length > 0 ? (
        <div className="preview-note">
          <strong>Warnings</strong>
          <ul className="text-list">
            {warnings.map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <div className="inline-error" role="alert">
          <strong>Failures</strong>
          <ul className="text-list">
            {failures.map((item, idx) => (
              <li key={`${item}-${idx}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

