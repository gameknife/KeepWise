import { useState, type ComponentType } from "react";
import { isRecord, readArray, readNumber, readString } from "../../utils/value";

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

export function InvestmentReturnsPreview({
  data,
  listOnly = false,
  formatCentsShort,
  formatPresetLabel,
  PreviewStat,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  listOnly?: boolean;
  formatCentsShort: (cents?: number) => string;
  formatPresetLabel: (preset?: string) => string;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("return_rate_pct");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const errors = readArray(data, "errors").filter(isRecord);
  const totalEndAssetsCents = rows.reduce((sum, row) => {
    const endAssets = typeof row.end_assets_cents === "number" ? row.end_assets_cents : 0;
    return sum + endAssets;
  }, 0);
  const formatAssetShareText = (row: Record<string, unknown>) => {
    const endAssets = typeof row.end_assets_cents === "number" ? row.end_assets_cents : 0;
    if (totalEndAssetsCents <= 0 || endAssets < 0) return "-";
    return `${((endAssets / totalEndAssetsCents) * 100).toFixed(2)}%`;
  };
  const sortedRows = [...rows].sort((a, b) => {
    const calcAssetShareRatio = (row: Record<string, unknown>) => {
      const endAssets = typeof row.end_assets_cents === "number" ? row.end_assets_cents : 0;
      if (totalEndAssetsCents <= 0) return -1;
      return endAssets / totalEndAssetsCents;
    };
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "account_name":
          return typeof row.account_name === "string" && row.account_name
            ? row.account_name
            : row.account_id;
        case "asset_share_ratio":
          return calcAssetShareRatio(row);
        case "return_rate_pct":
          return row.return_rate_pct;
        case "annualized_rate_pct":
          return row.annualized_rate_pct;
        case "profit_cents":
          return row.profit_cents;
        case "effective_from":
          return row.effective_from;
        case "effective_to":
          return row.effective_to;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const toggleSort = (key: string) => {
    const next = nextSortState(sortKey, sortDir, key);
    setSortKey(next.key);
    setSortDir(next.dir);
  };
  const preset = readString(data, "range.preset") ?? "-";
  const presetLabel = formatPresetLabel(preset);
  const avgReturnPct = readString(data, "summary.avg_return_pct") ?? "-";
  const accountCount = readNumber(data, "summary.account_count");
  const computedCount = readNumber(data, "summary.computed_count");
  const errorCount = readNumber(data, "summary.error_count");

  return (
    <div className="subcard preview-card">
      {!listOnly ? (
        <>
          <div className="preview-header">
            <h3>账户收益率对比结果</h3>
            <div className="preview-subtle">
              统计区间：{presetLabel}
            </div>
          </div>
          <div className="preview-stat-grid">
            <PreviewStat label="账户数" value={accountCount ?? 0} />
            <PreviewStat label="成功计算" value={computedCount ?? 0} tone={(computedCount ?? 0) > 0 ? "good" : "warn"} />
            <PreviewStat label="错误数" value={errorCount ?? 0} tone={(errorCount ?? 0) > 0 ? "warn" : "good"} />
            <PreviewStat label="平均收益率" value={avgReturnPct} />
          </div>
        </>
      ) : null}
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="资金占比" sortKey="asset_share_ratio" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="收益率" sortKey="return_rate_pct" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="年化" sortKey="annualized_rate_pct" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="收益额" sortKey="profit_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th>
                  <SortableHeaderButton label="起始" sortKey="effective_from" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const name = (typeof row.account_name === "string" && row.account_name) || (typeof row.account_id === "string" ? row.account_id : "-");
                const rr = typeof row.return_rate_pct === "string" ? row.return_rate_pct : "-";
                const ar = typeof row.annualized_rate_pct === "string" ? row.annualized_rate_pct : "-";
                const profit = typeof row.profit_cents === "number" ? formatCentsShort(row.profit_cents) : "-";
                const from = typeof row.effective_from === "string" ? row.effective_from : "-";
                const to = typeof row.effective_to === "string" ? row.effective_to : "-";
                return (
                  <tr key={`${name}-${idx}`}>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td className="num">{formatAssetShareText(row)}</td>
                    <td className="num">{rr}</td>
                    <td className="num">{ar}</td>
                    <td className="num">{profit}</td>
                    <td>{from} ~ {to}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {!listOnly && errors.length > 0 ? (
        <div className="preview-note">
          <strong>错误示例</strong>
          <ul className="text-list">
            {errors.slice(0, 5).map((row, idx) => {
              const name = (typeof row.account_name === "string" && row.account_name) || (typeof row.account_id === "string" ? row.account_id : `row_${idx}`);
              const msg = typeof row.error === "string" ? row.error : "未知错误";
              return <li key={`${name}-${idx}`}>{name}: {msg}</li>;
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}


export function MetaAccountsPreview({
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
  const [sortKey, setSortKey] = useState<string>("latest_snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const kind = readString(data, "kind") ?? "-";
  const selected = readArray(data, "accounts").length;
  const inv = readArray(data, "investment_accounts").length;
  const cash = readArray(data, "cash_accounts").length;
  const re = readArray(data, "real_estate_accounts").length;
  const liab = readArray(data, "liability_accounts").length;
  const rows = readArray(data, "accounts").filter(isRecord);
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "account_name":
          return row.account_name ?? row.account_id;
        case "kind_or_type":
          return row.asset_class ?? row.account_type ?? "investment";
        case "record_count":
          return row.record_count;
        case "latest_snapshot_date":
          return row.latest_snapshot_date;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
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
        <h3>Meta Accounts</h3>
        <div className="preview-subtle">kind <code>{kind}</code></div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Selected" value={selected} />
        <PreviewStat label="Investment" value={inv} />
        <PreviewStat label="Cash" value={cash} />
        <PreviewStat label="Real Estate" value={re} />
        <PreviewStat label="Liability" value={liab} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="类型/分类" sortKey="kind_or_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="记录数" sortKey="record_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="最新日期" sortKey="latest_snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const name = (typeof row.account_name === "string" && row.account_name) || (typeof row.account_id === "string" ? row.account_id : "-");
                const typeOrClass =
                  (typeof row.asset_class === "string" && row.asset_class) ||
                  (typeof row.account_type === "string" && row.account_type) ||
                  "investment";
                const count = typeof row.record_count === "number" ? row.record_count : "-";
                const latest = typeof row.latest_snapshot_date === "string" ? row.latest_snapshot_date : "-";
                return (
                  <tr key={`${name}-${idx}`}>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td>{typeOrClass}</td>
                    <td className="num">{String(count)}</td>
                    <td>{latest}</td>
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


export function InvestmentsListPreview({
  data,
  deleteBusy = false,
  deletingId = "",
  onEditRow,
  onDeleteRow,
  formatCentsShort,
  PreviewStat,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  deleteBusy?: boolean;
  deletingId?: string;
  onEditRow?: (row: Record<string, unknown>) => void;
  onDeleteRow?: (id: string, row: Record<string, unknown>) => void;
  formatCentsShort: (cents?: number) => string;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const latestAssets = readNumber(data, "summary.latest_total_assets_cents");
  const netFlow = readNumber(data, "summary.net_transfer_amount_cents");
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "snapshot_date":
          return row.snapshot_date;
        case "account_name":
          return row.account_name ?? row.account_id;
        case "total_assets_cents":
          return row.total_assets_cents;
        case "transfer_amount_cents":
          return row.transfer_amount_cents;
        case "source_type":
          return row.source_type;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
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
        <h3>投资记录查询</h3>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Latest Assets (Yuan)" value={formatCentsShort(latestAssets)} />
        <PreviewStat label="Net Transfer (Yuan)" value={formatCentsShort(netFlow)} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="日期" sortKey="snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="总资产" sortKey="total_assets_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="净转入" sortKey="transfer_amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="来源" sortKey="source_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                {onEditRow || onDeleteRow ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const rowId = typeof row.id === "string" ? row.id : "";
                const date = typeof row.snapshot_date === "string" ? row.snapshot_date : "-";
                const name =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (typeof row.account_id === "string" ? row.account_id : "-");
                const assets = typeof row.total_assets_cents === "number" ? formatCentsShort(row.total_assets_cents) : "-";
                const transfer = typeof row.transfer_amount_cents === "number" ? formatCentsShort(row.transfer_amount_cents) : "-";
                const source = typeof row.source_type === "string" ? row.source_type : "-";
                return (
                  <tr key={`${date}-${idx}`}>
                    <td>{date}</td>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td className="num">{assets}</td>
                    <td className="num">{transfer}</td>
                    <td>{source}</td>
                    {onEditRow || onDeleteRow ? (
                      <td>
                        <div className="table-actions-inline">
                          {onEditRow ? (
                            <button
                              type="button"
                              className="secondary-btn table-inline-btn"
                              onClick={() => onEditRow(row)}
                              disabled={!rowId}
                            >
                              修正
                            </button>
                          ) : null}
                          {onDeleteRow ? (
                            <button
                              type="button"
                              className="danger-btn table-inline-btn"
                              onClick={() => rowId && onDeleteRow(rowId, row)}
                              disabled={!rowId || (deleteBusy && deletingId === rowId)}
                            >
                              {deleteBusy && deletingId === rowId ? "删除中..." : "删除"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
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


export function AssetValuationsPreview({
  data,
  formatCentsShort,
  PreviewStat,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  formatCentsShort: (cents?: number) => string;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("snapshot_date");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const total = readNumber(data, "summary.sum_value_cents");
  const assetClass = readString(data, "summary.asset_class") ?? "";
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "snapshot_date":
          return row.snapshot_date;
        case "account_name":
          return row.account_name ?? row.account_id;
        case "asset_class":
          return row.asset_class;
        case "value_cents":
          return row.value_cents;
        case "source_type":
          return row.source_type;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
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
        <h3>资产估值查询</h3>
        <div className="preview-subtle">
          class <code>{assetClass || "all"}</code>
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Count" value={count ?? 0} />
        <PreviewStat label="Sum Value (Yuan)" value={formatCentsShort(total)} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="日期" sortKey="snapshot_date" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="分类" sortKey="asset_class" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="数值" sortKey="value_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="来源" sortKey="source_type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const date = typeof row.snapshot_date === "string" ? row.snapshot_date : "-";
                const name =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (typeof row.account_id === "string" ? row.account_id : "-");
                const cls = typeof row.asset_class === "string" ? row.asset_class : "-";
                const value = typeof row.value_cents === "number" ? formatCentsShort(row.value_cents) : "-";
                const source = typeof row.source_type === "string" ? row.source_type : "-";
                return (
                  <tr key={`${date}-${idx}`}>
                    <td>{date}</td>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td>{cls}</td>
                    <td className="num">{value}</td>
                    <td>{source}</td>
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


export function AccountCatalogPreview({
  data,
  onDeleteRow,
  deleteBusy = false,
  deletingAccountId = "",
  PreviewStat,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  onDeleteRow?: (accountId: string, accountName: string) => void;
  deleteBusy?: boolean;
  deletingAccountId?: string;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("updated_at");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count");
  const kind = readString(data, "summary.kind") ?? "-";
  const keyword = readString(data, "summary.keyword") ?? "";
  const groups = ["investment", "cash", "real_estate", "bank", "credit_card", "wallet", "liability", "other"];
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "account_name":
          return row.account_name ?? row.account_id;
        case "account_kind":
          return row.account_kind;
        case "transaction_count":
          return row.transaction_count;
        case "investment_record_count":
          return row.investment_record_count;
        case "asset_valuation_count":
          return row.asset_valuation_count;
        case "updated_at":
          return row.updated_at;
        default:
          return "";
      }
    };
    const cmp = compareSortValues(valueFor(a), valueFor(b));
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
        <h3>账户目录</h3>
        <div className="preview-subtle">
          kind <code>{kind}</code> {keyword ? <>| keyword <code>{keyword}</code></> : null}
        </div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="Rows" value={count ?? 0} />
        {groups.slice(0, 7).map((g) => (
          <PreviewStat key={g} label={g} value={readArray(data, `groups.${g}`).length} />
        ))}
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="账户" sortKey="account_name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="账户种类" sortKey="account_kind" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="交易" sortKey="transaction_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="投资" sortKey="investment_record_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="资产" sortKey="asset_valuation_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="更新时间" sortKey="updated_at" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                {onDeleteRow ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const accountId = typeof row.account_id === "string" ? row.account_id : "";
                const name =
                  (typeof row.account_name === "string" && row.account_name) ||
                  (accountId || "-");
                const kindVal = typeof row.account_kind === "string" ? row.account_kind : "-";
                const typeVal = typeof row.account_type === "string" ? row.account_type : "-";
                const kindDisplay = kindVal !== "-" && typeVal !== "-" && kindVal !== typeVal
                  ? `${kindVal}（底层类型: ${typeVal}）`
                  : kindVal;
                const tx = typeof row.transaction_count === "number" ? row.transaction_count : 0;
                const inv = typeof row.investment_record_count === "number" ? row.investment_record_count : 0;
                const asset = typeof row.asset_valuation_count === "number" ? row.asset_valuation_count : 0;
                const updated = typeof row.updated_at === "string" ? row.updated_at : "-";
                return (
                  <tr key={`${name}-${idx}`}>
                    <td className="truncate-cell" title={name}>{name}</td>
                    <td className="truncate-cell" title={kindDisplay}>{kindDisplay}</td>
                    <td className="num">{tx}</td>
                    <td className="num">{inv}</td>
                    <td className="num">{asset}</td>
                    <td>{updated}</td>
                    {onDeleteRow ? (
                      <td>
                        <button
                          type="button"
                          className="secondary-btn table-inline-btn"
                          onClick={() => onDeleteRow(accountId, name)}
                          disabled={deleteBusy || !accountId}
                          title={accountId ? `删除账户：${accountId}` : "缺少账户 ID，无法删除"}
                        >
                          {deleteBusy && deletingAccountId === accountId ? "删除中..." : "删除"}
                        </button>
                      </td>
                    ) : null}
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
