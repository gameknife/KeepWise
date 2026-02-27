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

export function ConsumptionOverviewPreview({
  data,
  selectedYear,
  onYearChange,
  onExcludeTransaction,
  onMerchantCategoryChange,
  merchantCategoryUpdatingMerchant = "",
  formatCentsShort,
  PreviewStat,
  LineAreaChart,
  SortableHeaderButton,
  nextSortState,
  compareSortValues,
}: {
  data: unknown;
  selectedYear: string;
  onYearChange: (year: string) => void;
  onExcludeTransaction?: (id: string, action: "exclude" | "restore", reason: string) => Promise<void>;
  onMerchantCategoryChange?: (merchant: string, expenseCategory: string) => Promise<void>;
  merchantCategoryUpdatingMerchant?: string;
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
  const [catSortKey, setCatSortKey] = useState<string>("amount");
  const [catSortDir, setCatSortDir] = useState<TableSortDirection>("desc");
  const [monthSortKey, setMonthSortKey] = useState<string>("month");
  const [monthSortDir, setMonthSortDir] = useState<TableSortDirection>("asc");
  const [merchantSortKey, setMerchantSortKey] = useState<string>("amount");
  const [merchantSortDir, setMerchantSortDir] = useState<TableSortDirection>("desc");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMerchants, setSelectedMerchants] = useState<string[]>([]);
  const [excludeNeedsReview, setExcludeNeedsReview] = useState(true);
  const [txSearchKeyword, setTxSearchKeyword] = useState<string>("");
  const [txPage, setTxPage] = useState<number>(0);
  const [pendingExcludeId, setPendingExcludeId] = useState<string>("");
  const [excludeBusy, setExcludeBusy] = useState(false);
  const TX_PAGE_SIZE = 50;
  if (!isRecord(data)) return null;

  type TxRow = {
    id: string;
    month: string;
    date: string;
    merchant: string;
    description: string;
    category: string;
    amount: number;
    needsReview: boolean;
    confidence: number;
    sourcePath: string;
  };

  const transactions = readArray(data, "transactions").filter(isRecord);
  const txRows: TxRow[] = transactions.map((row) => ({
    id: typeof row.id === "string" ? row.id : "",
    month: typeof row.month === "string" ? row.month : "",
    date: typeof row.date === "string" ? row.date : "",
    merchant: typeof row.merchant === "string" && row.merchant ? row.merchant : "未知商户",
    description: typeof row.description === "string" ? row.description : "",
    category: typeof row.category === "string" && row.category ? row.category : "待分类",
    amount: typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : 0,
    needsReview: typeof row.needs_review === "boolean" ? row.needs_review : false,
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0,
    sourcePath: typeof row.source_path === "string" ? row.source_path : "",
  }));

  const availableYears = readArray(data, "available_years")
    .map((v) => (typeof v === "string" ? v : ""))
    .filter((v) => v.length === 4);

  const total = readNumber(data, "consumption_total_value");
  const totalText = readString(data, "consumption_total") ?? "-";
  const count = readNumber(data, "consumption_count");
  const reviewCount = readNumber(data, "needs_review_count");
  const excludedCount = readNumber(data, "excluded_consumption_count");
  const excludedTotalText = readString(data, "excluded_consumption_total") ?? "-";
  const allExpenseCategoryOptions = readArray(data, "all_expense_categories")
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v && v !== "待分类");

  const monthOptions = Array.from(new Set(txRows.map((r) => r.month).filter((m) => m)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));

  const monthScopedTx = txRows.filter((r) => {
    if (excludeNeedsReview && r.needsReview) return false;
    if (selectedMonth && r.month !== selectedMonth) return false;
    return true;
  });

  const buildAgg = <K extends string>(
    rows: TxRow[],
    keySelector: (row: TxRow) => K,
  ): Array<Record<string, unknown>> => {
    const buckets = new Map<K, { amountCents: number; count: number; reviewCount: number; sampleCategory?: string }>();
    for (const row of rows) {
      const key = keySelector(row);
      const item = buckets.get(key) ?? { amountCents: 0, count: 0, reviewCount: 0, sampleCategory: row.category };
      item.amountCents += Math.round(row.amount * 100);
      item.count += 1;
      item.reviewCount += row.needsReview ? 1 : 0;
      if (!item.sampleCategory) item.sampleCategory = row.category;
      buckets.set(key, item);
    }
    return Array.from(buckets.entries()).map(([key, stat]) => ({
      key,
      amount_cents: stat.amountCents,
      amount: Number((stat.amountCents / 100).toFixed(2)),
      count: stat.count,
      review_count: stat.reviewCount,
      category: stat.sampleCategory ?? "",
    }));
  };

  const categoryOptionsAgg = buildAgg(monthScopedTx, (r) => r.category)
    .map((x) => ({
      category: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const categoryScopedTx = monthScopedTx.filter((r) =>
    selectedCategories.length === 0 ? true : selectedCategories.includes(r.category),
  );

  const merchantOptionsAgg = buildAgg(categoryScopedTx, (r) => r.merchant)
    .map((x) => ({
      merchant: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const filteredTx = categoryScopedTx.filter((r) =>
    selectedMerchants.length === 0 ? true : selectedMerchants.includes(r.merchant),
  );

  const categories = buildAgg(filteredTx, (r) => r.category)
    .map((x) => ({
      category: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);

  const months = buildAgg(filteredTx, (r) => r.month)
    .map((x) => ({
      month: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      review_count: x.review_count as number,
    }))
    .sort((a, b) => a.month.localeCompare(b.month, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));

  const merchants = buildAgg(filteredTx, (r) => r.merchant)
    .map((x) => ({
      merchant: x.key as string,
      amount: x.amount as number,
      count: x.count as number,
      category: (x.category as string) || "待分类",
      review_count: x.review_count as number,
    }))
    .sort((a, b) => b.amount - a.amount);
  const merchantCategoryOptions = [
    "待分类",
    ...Array.from(new Set(
      [
        ...allExpenseCategoryOptions,
        ...categoryOptionsAgg.map((x) => x.category),
        ...txRows.map((x) => x.category),
      ]
        .map((v) => `${v ?? ""}`.trim())
        .filter((v) => v && v !== "待分类"),
    )).sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { sensitivity: "base" })),
  ];

  const filteredTotalCents = filteredTx.reduce((sum, r) => sum + Math.round(r.amount * 100), 0);

  const categorySorted = [...categories].sort((a, b) => {
    const cmp = compareSortValues(
      (a as Record<string, unknown>)[catSortKey],
      (b as Record<string, unknown>)[catSortKey],
    );
    return catSortDir === "asc" ? cmp : -cmp;
  });
  const monthSorted = [...months].sort((a, b) => {
    const cmp = compareSortValues(
      (a as Record<string, unknown>)[monthSortKey],
      (b as Record<string, unknown>)[monthSortKey],
    );
    return monthSortDir === "asc" ? cmp : -cmp;
  });
  const merchantSorted = [...merchants].sort((a, b) => {
    const cmp = compareSortValues(
      (a as Record<string, unknown>)[merchantSortKey],
      (b as Record<string, unknown>)[merchantSortKey],
    );
    return merchantSortDir === "asc" ? cmp : -cmp;
  });
  const monthChartPoints = months
    .map((m) => {
      const label = typeof m.month === "string" ? m.month : "";
      const amount = typeof m.amount === "number" ? Math.round(m.amount * 100) : NaN;
      return label && Number.isFinite(amount) ? { label, value: amount } : null;
    })
    .filter((v): v is { label: string; value: number } => v !== null);

  const donutRows = categories
    .slice(0, 8)
    .map((row) => ({
      category: row.category,
      amount: row.amount,
      count: row.count,
    }))
    .filter((r) => r.amount > 0);
  const donutTotal = donutRows.reduce((sum, r) => sum + r.amount, 0);
  const palette = ["#7cc3ff", "#88d8aa", "#ffd27d", "#ff9f8a", "#a8a4ff", "#59d2c9", "#f3a6ff", "#9ad36a"];
  let acc = 0;
  const donutStops = donutRows.map((row, idx) => {
    const start = donutTotal > 0 ? (acc / donutTotal) * 100 : 0;
    acc += row.amount;
    const end = donutTotal > 0 ? (acc / donutTotal) * 100 : 0;
    return { ...row, color: palette[idx % palette.length], start, end };
  });
  const donutStyle =
    donutStops.length > 0
      ? {
          background: `conic-gradient(${donutStops
            .map((s) => `${s.color} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`)
            .join(", ")})`,
        }
      : undefined;

  const toggleMulti = (values: string[], value: string, setter: (next: string[]) => void) => {
    if (!value) return;
    if (values.includes(value)) {
      setter(values.filter((v) => v !== value));
    } else {
      setter([...values, value]);
    }
  };

  const filterPills = [
    ...(selectedMonth ? [{ kind: "month" as const, label: `月份: ${selectedMonth}` }] : []),
    ...(excludeNeedsReview ? [{ kind: "hide_review" as const, label: "已排除待确认" }] : []),
    ...selectedCategories.map((v) => ({ kind: "category" as const, value: v, label: `分类: ${v}` })),
    ...selectedMerchants.map((v) => ({ kind: "merchant" as const, value: v, label: `商户: ${v}` })),
  ];

  // 交易明细：基于筛选后数据 + 搜索
  const searchedTx = txSearchKeyword.trim()
    ? filteredTx.filter((r) => {
        const kw = txSearchKeyword.trim().toLowerCase();
        return (
          r.merchant.toLowerCase().includes(kw) ||
          r.description.toLowerCase().includes(kw) ||
          r.category.toLowerCase().includes(kw)
        );
      })
    : filteredTx;
  const txTotalPages = Math.max(1, Math.ceil(searchedTx.length / TX_PAGE_SIZE));
  const safeTxPage = Math.min(txPage, txTotalPages - 1);
  const pagedTx = searchedTx.slice(safeTxPage * TX_PAGE_SIZE, (safeTxPage + 1) * TX_PAGE_SIZE);

  // 月均消费
  const monthCount = months.length || 1;
  const monthlyAvgCents = Math.round(filteredTotalCents / monthCount);

  return (
    <div className="subcard preview-card">
      {/* 年度 Tab */}
      {availableYears.length > 0 ? (
        <div className="consumption-year-tabs">
          {availableYears.map((year) => (
            <button
              key={year}
              type="button"
              className={`consumption-year-tab ${selectedYear === year ? "active" : ""}`}
              onClick={() => {
                onYearChange(year);
                setSelectedMonth("");
                setSelectedCategories([]);
                setSelectedMerchants([]);
                setTxPage(0);
              }}
            >
              {year}年
            </button>
          ))}
          <button
            type="button"
            className={`consumption-year-tab ${selectedYear === "" ? "active" : ""}`}
            onClick={() => {
              onYearChange("");
              setSelectedMonth("");
              setSelectedCategories([]);
              setSelectedMerchants([]);
              setTxPage(0);
            }}
          >
            全部
          </button>
        </div>
      ) : null}

      <div className="consumption-filter-bar">
        <div className="consumption-filter-row">
          <label className="field checkbox-field">
            <span>排除待确认（默认）</span>
            <input
              type="checkbox"
              checked={excludeNeedsReview}
              onChange={(e) => setExcludeNeedsReview(e.target.checked)}
            />
          </label>
          <div className="consumption-filter-inline">
            <span className="consumption-filter-label">月份</span>
            <div className="consumption-chip-group">
              <button
                type="button"
                className={`consumption-chip ${selectedMonth === "" ? "active" : ""}`}
                onClick={() => setSelectedMonth("")}
              >
                全部
              </button>
              {monthOptions.map((month) => (
                <button
                  key={month}
                  type="button"
                  className={`consumption-chip ${selectedMonth === month ? "active" : ""}`}
                  onClick={() => setSelectedMonth(month)}
                >
                  {month.length >= 7 ? month.slice(5) + "月" : month}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="consumption-filter-inline">
          <span className="consumption-filter-label">分类（多选）</span>
          <div className="consumption-chip-group">
            <button
              type="button"
              className={`consumption-chip ${selectedCategories.length === 0 ? "active" : ""}`}
              onClick={() => setSelectedCategories([])}
            >
              全部
            </button>
            {categoryOptionsAgg.slice(0, 24).map((row) => (
              <button
                key={row.category}
                type="button"
                className={`consumption-chip ${selectedCategories.includes(row.category) ? "active" : ""}`}
                onClick={() => toggleMulti(selectedCategories, row.category, setSelectedCategories)}
                title={`${row.category} | ${row.amount.toFixed(2)} 元 | ${row.count} 笔`}
              >
                {row.category}
              </button>
            ))}
          </div>
        </div>

        <div className="consumption-filter-inline">
          <span className="consumption-filter-label">商户（多选）</span>
          <div className="consumption-chip-group">
            <button
              type="button"
              className={`consumption-chip ${selectedMerchants.length === 0 ? "active" : ""}`}
              onClick={() => setSelectedMerchants([])}
            >
              全部
            </button>
            {merchantOptionsAgg.slice(0, 30).map((row) => (
              <button
                key={row.merchant}
                type="button"
                className={`consumption-chip ${selectedMerchants.includes(row.merchant) ? "active" : ""}`}
                onClick={() => toggleMulti(selectedMerchants, row.merchant, setSelectedMerchants)}
                title={`${row.merchant} | ${row.amount.toFixed(2)} 元 | ${row.count} 笔`}
              >
                {row.merchant}
              </button>
            ))}
          </div>
        </div>

        {filterPills.length > 0 ? (
          <div className="consumption-pill-bar">
            {filterPills.map((pill) => (
              <span key={`${pill.kind}-${"value" in pill ? pill.value : ""}`} className="consumption-pill">
                <span>{pill.label}</span>
                <button
                  type="button"
                  aria-label={`移除筛选：${pill.label}`}
                  onClick={() => {
                    if (pill.kind === "month") setSelectedMonth("");
                    if (pill.kind === "hide_review") setExcludeNeedsReview(false);
                    if (pill.kind === "category" && "value" in pill) {
                      setSelectedCategories((prev) => prev.filter((v) => v !== pill.value));
                    }
                    if (pill.kind === "merchant" && "value" in pill) {
                      setSelectedMerchants((prev) => prev.filter((v) => v !== pill.value));
                    }
                  }}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="secondary-btn table-inline-btn"
              onClick={() => {
                setSelectedMonth("");
                setSelectedCategories([]);
                setSelectedMerchants([]);
                setExcludeNeedsReview(true);
              }}
            >
              清空筛选
            </button>
          </div>
        ) : null}
      </div>

      <div className="preview-stat-grid">
        <PreviewStat label="消费总额(元)" value={formatCentsShort(filteredTotalCents)} tone={filteredTotalCents > 0 ? "good" : "warn"} />
        <PreviewStat label="消费笔数" value={filteredTx.length} />
        <PreviewStat label="月均消费(元)" value={formatCentsShort(monthlyAvgCents)} />
        <PreviewStat label="待确认笔数" value={(reviewCount ?? 0)} tone={(reviewCount ?? 0) > 0 ? "warn" : "good"} />
        <PreviewStat label="已剔除笔数" value={excludedCount ?? 0} />
        <PreviewStat label="已剔除金额(元)" value={excludedTotalText} />
        <PreviewStat label="全量消费总额(元)" value={totalText} tone={(total ?? 0) > 0 ? "default" : "warn"} />
        <PreviewStat label="全量笔数" value={count ?? 0} />
      </div>

      <div className="preview-chart-grid">
        <div className="sparkline-card">
          <div className="sparkline-title">月度消费趋势</div>
          <LineAreaChart
            points={monthChartPoints}
            color="#7cc3ff"
            height={230}
            preferZeroBaseline
            maxXTicks={12}
            xLabelFormatter={(label) => (label.length >= 7 ? label.slice(5) : label)}
            valueFormatter={(v) => formatCentsShort(v)}
            tooltipFormatter={(p) => `${p.label} · ${formatCentsShort(p.value)} 元`}
          />
        </div>
        <div className="sparkline-card">
          <div className="sparkline-title">分类分布（Top 8）</div>
          <div className="consumption-donut-wrap">
            <div className="consumption-donut" style={donutStyle}>
              <div className="consumption-donut-hole">
                <div className="consumption-donut-total-label">总额</div>
                <div className="consumption-donut-total-value">{formatCentsShort(filteredTotalCents)}</div>
              </div>
            </div>
            <div className="consumption-donut-legend">
              {donutStops.length > 0 ? (
                donutStops.map((item) => (
                  <div key={item.category} className="consumption-legend-row" title={`${item.category}: ${item.amount.toFixed(2)}`}>
                    <span className="consumption-legend-dot" style={{ backgroundColor: item.color }} />
                    <span className="consumption-legend-label">{item.category}</span>
                    <span className="consumption-legend-value">
                      {item.amount.toFixed(2)} ({donutTotal > 0 ? ((item.amount / donutTotal) * 100).toFixed(1) : "0.0"}%)
                    </span>
                  </div>
                ))
              ) : (
                <p className="placeholder">暂无分类分布数据。</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {categorySorted.length > 0 ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                <th><SortableHeaderButton label="分类" sortKey="category" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="笔数" sortKey="count" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
                <th className="num"><SortableHeaderButton label="待确认" sortKey="review_count" activeSortKey={catSortKey} sortDir={catSortDir} onToggle={(key) => {
                  const next = nextSortState(catSortKey, catSortDir, key); setCatSortKey(next.key); setCatSortDir(next.dir);
                }} /></th>
              </tr>
            </thead>
            <tbody>
              {categorySorted.map((row, idx) => {
                const category = row.category;
                const amount = row.amount;
                const rowCount = row.count;
                const review = row.review_count;
                return (
                  <tr key={`${category}-${idx}`}>
                    <td className="truncate-cell" title={category}>{category}</td>
                    <td className="num">{amount.toFixed(2)}</td>
                    <td className="num">{rowCount}</td>
                    <td className={`num ${review > 0 ? "warn-text" : ""}`}>{review}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="preview-chart-grid">
        {monthSorted.length > 0 ? (
          <div className="sparkline-card">
            <div className="sparkline-title">月度分布</div>
            <div className="preview-table-wrap">
              <table className="preview-table compact">
                <thead>
                  <tr>
                    <th><SortableHeaderButton label="月份" sortKey="month" activeSortKey={monthSortKey} sortDir={monthSortDir} onToggle={(key) => {
                      const next = nextSortState(monthSortKey, monthSortDir, key); setMonthSortKey(next.key); setMonthSortDir(next.dir);
                    }} /></th>
                    <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount" activeSortKey={monthSortKey} sortDir={monthSortDir} onToggle={(key) => {
                      const next = nextSortState(monthSortKey, monthSortDir, key); setMonthSortKey(next.key); setMonthSortDir(next.dir);
                    }} /></th>
                    <th className="num"><SortableHeaderButton label="笔数" sortKey="count" activeSortKey={monthSortKey} sortDir={monthSortDir} onToggle={(key) => {
                      const next = nextSortState(monthSortKey, monthSortDir, key); setMonthSortKey(next.key); setMonthSortDir(next.dir);
                    }} /></th>
                  </tr>
                </thead>
                <tbody>
                  {monthSorted.map((row, idx) => (
                    <tr key={`${String(row.month)}-${idx}`}>
                      <td>{typeof row.month === "string" ? row.month : "-"}</td>
                      <td className="num">{typeof row.amount === "number" ? row.amount.toFixed(2) : "-"}</td>
                      <td className="num">{typeof row.count === "number" ? row.count : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {merchantSorted.length > 0 ? (
          <div className="sparkline-card">
            <div className="sparkline-title">高频商户（Top 20）</div>
            <div className="preview-table-wrap">
              <table className="preview-table compact">
                <thead>
                  <tr>
                    <th><SortableHeaderButton label="商户" sortKey="merchant" activeSortKey={merchantSortKey} sortDir={merchantSortDir} onToggle={(key) => {
                      const next = nextSortState(merchantSortKey, merchantSortDir, key); setMerchantSortKey(next.key); setMerchantSortDir(next.dir);
                    }} /></th>
                    <th><SortableHeaderButton label="分类" sortKey="category" activeSortKey={merchantSortKey} sortDir={merchantSortDir} onToggle={(key) => {
                      const next = nextSortState(merchantSortKey, merchantSortDir, key); setMerchantSortKey(next.key); setMerchantSortDir(next.dir);
                    }} /></th>
                    <th className="num"><SortableHeaderButton label="金额(元)" sortKey="amount" activeSortKey={merchantSortKey} sortDir={merchantSortDir} onToggle={(key) => {
                      const next = nextSortState(merchantSortKey, merchantSortDir, key); setMerchantSortKey(next.key); setMerchantSortDir(next.dir);
                    }} /></th>
                  </tr>
                </thead>
                <tbody>
                  {merchantSorted.slice(0, 20).map((row, idx) => {
                    const merchant = typeof row.merchant === "string" ? row.merchant : "";
                    const rowCategory = typeof row.category === "string" && row.category ? row.category : "待分类";
                    const isCategoryUpdating = merchantCategoryUpdatingMerchant === merchant;
                    return (
                      <tr key={`${String(row.merchant)}-${idx}`}>
                        <td className="truncate-cell" title={merchant || undefined}>
                          {merchant || "-"}
                        </td>
                        <td>
                          {merchant && onMerchantCategoryChange ? (
                            <select
                              className="consumption-merchant-category-select"
                              value={rowCategory}
                              disabled={isCategoryUpdating}
                              onChange={(e) => {
                                const nextCategory = e.target.value;
                                if (!nextCategory || nextCategory === rowCategory) return;
                                void onMerchantCategoryChange(merchant, nextCategory);
                              }}
                            >
                              {merchantCategoryOptions.map((option) => (
                                <option key={`${merchant}-${option}`} value={option}>{option}</option>
                              ))}
                            </select>
                          ) : (
                            rowCategory
                          )}
                        </td>
                        <td className="num">{typeof row.amount === "number" ? row.amount.toFixed(2) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {/* 交易明细表格（内联） */}
      <div className="consumption-tx-section">
        <div className="consumption-tx-header">
          <h4>交易明细</h4>
          <div className="consumption-tx-search">
            <input
              type="text"
              placeholder="搜索商户 / 摘要 / 分类..."
              value={txSearchKeyword}
              onChange={(e) => { setTxSearchKeyword(e.target.value); setTxPage(0); }}
            />
            {txSearchKeyword ? (
              <button type="button" className="consumption-tx-search-clear" onClick={() => { setTxSearchKeyword(""); setTxPage(0); }}>×</button>
            ) : null}
          </div>
          <span className="consumption-tx-count">{searchedTx.length} 笔</span>
        </div>
        {pagedTx.length > 0 ? (
          <div className="preview-table-wrap">
            <table className="preview-table consumption-tx-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>商户</th>
                  <th>分类</th>
                  <th className="num">金额(元)</th>
                  <th>摘要</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pagedTx.map((row) => (
                  <tr key={row.id || `${row.date}-${row.merchant}-${row.amount}`} className={row.needsReview ? "row-needs-review" : ""}>
                    <td>{row.date}</td>
                    <td className="truncate-cell" title={row.merchant}>{row.merchant}</td>
                    <td>{row.category}</td>
                    <td className="num">{row.amount.toFixed(2)}</td>
                    <td className="truncate-cell" title={row.description}>{row.description}</td>
                    <td>
                      {pendingExcludeId === row.id ? (
                        <span className="consumption-tx-confirm">
                          <span>确认剔除？</span>
                          <button
                            type="button"
                            className="consumption-tx-action-btn danger"
                            disabled={excludeBusy}
                            onClick={async () => {
                              if (!onExcludeTransaction) return;
                              setExcludeBusy(true);
                              try {
                                await onExcludeTransaction(row.id, "exclude", "消费分析页剔除");
                              } finally {
                                setExcludeBusy(false);
                                setPendingExcludeId("");
                              }
                            }}
                          >
                            {excludeBusy ? "..." : "确认"}
                          </button>
                          <button type="button" className="consumption-tx-action-btn" onClick={() => setPendingExcludeId("")}>取消</button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="consumption-tx-action-btn danger"
                          title="从分析统计中剔除此交易"
                          disabled={!row.id || !onExcludeTransaction}
                          onClick={() => setPendingExcludeId(row.id)}
                        >
                          剔除
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="placeholder">暂无交易数据。</p>
        )}
        {txTotalPages > 1 ? (
          <div className="consumption-tx-pagination">
            <button type="button" disabled={safeTxPage <= 0} onClick={() => setTxPage(safeTxPage - 1)}>上一页</button>
            <span>{safeTxPage + 1} / {txTotalPages}</span>
            <button type="button" disabled={safeTxPage >= txTotalPages - 1} onClick={() => setTxPage(safeTxPage + 1)}>下一页</button>
          </div>
        ) : null}
      </div>

    </div>
  );
}

