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

export function BudgetItemsPreview({
  data,
  deleteBusy = false,
  deletingItemId = "",
  onDeleteRow,
  PreviewStat,
  SortableHeaderButton,
  formatCentsShort,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  deleteBusy?: boolean;
  deletingItemId?: string;
  onDeleteRow?: (id: string, name: string) => void;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  formatCentsShort: (cents?: number) => string;
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("sort_order");
  const [sortDir, setSortDir] = useState<TableSortDirection>("asc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const totalCount = readNumber(data, "summary.total_count");
  const activeCount = readNumber(data, "summary.active_count");
  const monthlyTotal = readNumber(data, "summary.monthly_budget_total_cents");
  const annualTotal = readNumber(data, "summary.annual_budget_cents");
  const sortedRows = [...rows].sort((a, b) => {
    const valueFor = (row: Record<string, unknown>) => {
      switch (sortKey) {
        case "name":
          return row.name ?? "";
        case "monthly_amount_cents":
          return row.monthly_amount_cents ?? 0;
        case "annual_amount_cents":
          return row.annual_amount_cents ?? 0;
        case "is_active":
          return row.is_active ?? false;
        case "sort_order":
          return row.sort_order ?? 0;
        case "updated_at":
          return row.updated_at ?? "";
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
        <h3>预算项预览</h3>
        <div className="preview-subtle">按月预算条目</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="总条目" value={totalCount ?? rows.length} />
        <PreviewStat label="启用条目" value={activeCount ?? 0} tone={(activeCount ?? 0) > 0 ? "good" : "warn"} />
        <PreviewStat label="月预算(元)" value={formatCentsShort(monthlyTotal)} />
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualTotal)} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="名称" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="月预算" sortKey="monthly_amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="年预算" sortKey="annual_amount_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="排序" sortKey="sort_order" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="启用" sortKey="is_active" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="更新时间" sortKey="updated_at" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                {onDeleteRow ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const id = typeof row.id === "string" ? row.id : `row_${idx}`;
                const name = typeof row.name === "string" ? row.name : "-";
                const monthly = typeof row.monthly_amount_cents === "number" ? row.monthly_amount_cents : undefined;
                const annual = typeof row.annual_amount_cents === "number" ? row.annual_amount_cents : undefined;
                const sort = typeof row.sort_order === "number" ? row.sort_order : "-";
                const active = typeof row.is_active === "boolean" ? row.is_active : false;
                const builtin = typeof row.is_builtin === "boolean" ? row.is_builtin : false;
                const updatedAt = typeof row.updated_at === "string" ? row.updated_at : "-";
                const rowDeleteDisabled = deleteBusy || builtin || !id;
                const rowDeleteBusy = deleteBusy && deletingItemId === id;
                return (
                  <tr key={id}>
                    <td className="truncate-cell" title={name}>{name}{builtin ? "（内置）" : ""}</td>
                    <td className="num">{formatCentsShort(monthly)}</td>
                    <td className="num">{formatCentsShort(annual)}</td>
                    <td className="num">{String(sort)}</td>
                    <td>{active ? "是" : "否"}</td>
                    <td>{updatedAt}</td>
                    {onDeleteRow ? (
                      <td>
                        <button
                          type="button"
                          className="danger-btn table-inline-btn"
                          onClick={() => onDeleteRow(id, name)}
                          disabled={rowDeleteDisabled}
                          title={builtin ? "内置预算项暂不支持删除" : "删除预算项"}
                        >
                          {rowDeleteBusy ? "删除中..." : "删除"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="placeholder">暂无预算项，请先新增预算项。</p>
      )}
    </div>
  );
}

export function BudgetOverviewPreview({
  data,
  PreviewStat,
  formatCentsShort,
  signedMetricTone,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
  formatCentsShort: (cents?: number) => string;
  signedMetricTone: (value?: number) => "default" | "good" | "warn";
}) {
  if (!isRecord(data)) return null;
  const year = readNumber(data, "year");
  const asOf = readString(data, "as_of_date") ?? "-";
  const monthlyBudget = readNumber(data, "budget.monthly_total_cents");
  const annualBudget = readNumber(data, "budget.annual_total_cents");
  const ytdBudget = readNumber(data, "budget.ytd_budget_cents");
  const actual = readNumber(data, "actual.spent_total_cents");
  const ytdActual = readNumber(data, "actual.ytd_spent_cents");
  const annualRemaining = readNumber(data, "metrics.annual_remaining_cents");
  const ytdVariance = readNumber(data, "metrics.ytd_variance_cents");
  const usageRateText = readString(data, "metrics.usage_rate_pct_text") ?? "-";
  const ytdUsageRateText = readString(data, "metrics.ytd_usage_rate_pct_text") ?? "-";
  const elapsedMonths = readNumber(data, "analysis_scope.elapsed_months");

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>预算概览预览</h3>
        <div className="preview-subtle">{year ?? "-"} 年 · as_of {asOf}</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="月预算(元)" value={formatCentsShort(monthlyBudget)} />
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualBudget)} />
        <PreviewStat label="累计支出(元)" value={formatCentsShort(actual)} />
        <PreviewStat label="年剩余(元)" value={formatCentsShort(annualRemaining)} tone={signedMetricTone(annualRemaining)} />
        <PreviewStat label="YTD预算(元)" value={formatCentsShort(ytdBudget)} />
        <PreviewStat label="YTD支出(元)" value={formatCentsShort(ytdActual)} />
        <PreviewStat label="YTD偏差(元)" value={formatCentsShort(ytdVariance)} tone={signedMetricTone(ytdVariance)} />
        <PreviewStat label="全年使用率" value={usageRateText} />
        <PreviewStat label="YTD使用率" value={ytdUsageRateText} />
        <PreviewStat label="已过月数" value={elapsedMonths ?? "-"} />
      </div>
    </div>
  );
}

export function BudgetMonthlyReviewPreview({
  data,
  PreviewStat,
  SortableHeaderButton,
  formatCentsShort,
  signedMetricTone,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
  SortableHeaderButton: ComponentType<SortableHeaderButtonProps>;
  formatCentsShort: (cents?: number) => string;
  signedMetricTone: (value?: number) => "default" | "good" | "warn";
  nextSortState: (
    activeSortKey: string,
    activeSortDir: TableSortDirection,
    targetSortKey: string,
  ) => { key: string; dir: TableSortDirection };
  compareSortValues: (a: unknown, b: unknown) => number;
}) {
  const [sortKey, setSortKey] = useState<string>("month_key");
  const [sortDir, setSortDir] = useState<TableSortDirection>("asc");
  if (!isRecord(data)) return null;
  const rows = readArray(data, "rows").filter(isRecord);
  const year = readNumber(data, "year");
  const annualBudget = readNumber(data, "summary.annual_budget_cents");
  const annualSpent = readNumber(data, "summary.annual_spent_cents");
  const annualVariance = readNumber(data, "summary.annual_variance_cents");
  const annualUsageRateText = readString(data, "summary.annual_usage_rate_pct_text") ?? "-";
  const overMonths = readNumber(data, "summary.over_budget_months");
  const underMonths = readNumber(data, "summary.under_budget_months");
  const equalMonths = readNumber(data, "summary.equal_months");
  const sortedRows = [...rows].sort((a, b) => {
    const cmp = compareSortValues(a[sortKey], b[sortKey]);
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
        <h3>预算月度复盘预览</h3>
        <div className="preview-subtle">{year ?? "-"} 年 12 个月</div>
      </div>
      <div className="preview-stat-grid">
        <PreviewStat label="年预算(元)" value={formatCentsShort(annualBudget)} />
        <PreviewStat label="年支出(元)" value={formatCentsShort(annualSpent)} />
        <PreviewStat label="年偏差(元)" value={formatCentsShort(annualVariance)} tone={signedMetricTone(annualVariance)} />
        <PreviewStat label="年使用率" value={annualUsageRateText} />
        <PreviewStat label="超预算月" value={overMonths ?? 0} tone={(overMonths ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="低于预算月" value={underMonths ?? 0} tone={(underMonths ?? 0) > 0 ? "good" : "default"} />
        <PreviewStat label="持平月" value={equalMonths ?? 0} />
      </div>
      {sortedRows.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="月份" sortKey="month_key" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="交易数" sortKey="tx_count" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="预算" sortKey="budget_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="支出" sortKey="spent_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th className="num"><SortableHeaderButton label="偏差" sortKey="variance_cents" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="使用率" sortKey="usage_rate" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
                <th><SortableHeaderButton label="状态" sortKey="status" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} /></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const monthKey = typeof row.month_key === "string" ? row.month_key : `m_${idx}`;
                const txCount = typeof row.tx_count === "number" ? row.tx_count : 0;
                const budget = typeof row.budget_cents === "number" ? row.budget_cents : undefined;
                const spent = typeof row.spent_cents === "number" ? row.spent_cents : undefined;
                const variance = typeof row.variance_cents === "number" ? row.variance_cents : undefined;
                const usageText = typeof row.usage_rate_pct_text === "string" ? row.usage_rate_pct_text : "-";
                const statusText = typeof row.status === "string" ? row.status : "-";
                return (
                  <tr key={`${monthKey}-${idx}`}>
                    <td>{monthKey}</td>
                    <td className="num">{txCount}</td>
                    <td className="num">{formatCentsShort(budget)}</td>
                    <td className="num">{formatCentsShort(spent)}</td>
                    <td className={`num ${typeof variance === "number" && variance < 0 ? "warn-text" : ""}`}>
                      {formatCentsShort(variance)}
                    </td>
                    <td>{usageText}</td>
                    <td>{statusText}</td>
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

export function FireProgressPreview({
  data,
  PreviewStat,
  formatCentsShort,
  signedMetricTone,
}: {
  data: unknown;
  PreviewStat: ComponentType<PreviewStatProps>;
  formatCentsShort: (cents?: number) => string;
  signedMetricTone: (value?: number) => "default" | "good" | "warn";
}) {
  if (!isRecord(data)) return null;
  const rateText = readString(data, "withdrawal_rate_pct_text") ?? "-";
  const asOfDate = readString(data, "as_of_date") ?? readString(data, "wealth_snapshot.as_of_date") ?? "-";
  const annualBudget = readNumber(data, "budget.annual_total_cents");
  const investableTotal = readNumber(data, "investable_assets.total_cents");
  const coverageYearsText = readString(data, "metrics.coverage_years_text") ?? "-";
  const freedomRatioText = readString(data, "metrics.freedom_ratio_pct_text") ?? "-";
  const freedomRatioPct =
    readNumber(data, "metrics.freedom_ratio_pct") ??
    (() => {
      const m = freedomRatioText.match(/-?\d+(?:\.\d+)?/);
      return m ? Number(m[0]) : undefined;
    })();
  const requiredAssets = readNumber(data, "metrics.required_assets_cents");
  const remainingToGoal = readNumber(data, "metrics.remaining_to_goal_cents");
  const goalGap = readNumber(data, "metrics.goal_gap_cents");
  const freedomToneClass =
    typeof freedomRatioPct === "number" && Number.isFinite(freedomRatioPct)
      ? freedomRatioPct >= 100
        ? "good"
        : freedomRatioPct >= 60
          ? "mid"
          : "warn"
      : "default";

  return (
    <div className="subcard preview-card">
      <div className="preview-header">
        <h3>FIRE 进度预览</h3>
        <div className="preview-subtle">按最新资产快照计算 · {asOfDate !== "-" ? <>快照日期 <code>{asOfDate}</code> · </> : null}提取率 {rateText}</div>
      </div>
      <div className="fire-progress-stat-layout">
        <div className={`preview-stat fire-progress-focus tone-${freedomToneClass}`}>
          <div className="preview-stat-label">自由度</div>
          <div className="fire-progress-focus-value">{freedomRatioText}</div>
          <div className="fire-progress-focus-subtle">覆盖年数 {coverageYearsText}</div>
        </div>
        <div className="preview-stat-grid fire-progress-stat-grid">
          <PreviewStat label="年预算(元)" value={formatCentsShort(annualBudget)} />
          <PreviewStat label="可投资产(元)" value={formatCentsShort(investableTotal)} />
          <PreviewStat label="覆盖年数" value={coverageYearsText} />
          <PreviewStat label="目标资产(元)" value={formatCentsShort(requiredAssets)} />
          <PreviewStat label="距离目标(元)" value={formatCentsShort(remainingToGoal)} tone={(remainingToGoal ?? 0) === 0 ? "good" : "warn"} />
          <PreviewStat label="目标差额(元)" value={formatCentsShort(goalGap)} tone={signedMetricTone(goalGap)} />
        </div>
      </div>
    </div>
  );
}
