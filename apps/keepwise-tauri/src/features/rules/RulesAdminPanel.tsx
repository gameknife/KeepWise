import { startTransition, useState, type ComponentType, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useDebouncedAutoRun } from "../../hooks/useDebouncedAutoRun";
import {
  deleteAnalysisExclusionRule,
  deleteBankTransferWhitelistRule,
  deleteCategoryRule,
  deleteMerchantMapRule,
  queryAnalysisExclusionRules,
  queryBankTransferWhitelistRules,
  queryCategoryRules,
  queryMerchantMapRules,
  queryMerchantRuleSuggestions,
  upsertAnalysisExclusionRule,
  upsertBankTransferWhitelistRule,
  upsertCategoryRule,
  upsertMerchantMapRule,
  type AnalysisExclusionDeleteRequest,
  type AnalysisExclusionQueryRequest,
  type AnalysisExclusionUpsertRequest,
  type BankTransferWhitelistDeleteRequest,
  type BankTransferWhitelistQueryRequest,
  type BankTransferWhitelistUpsertRequest,
  type CategoryRuleDeleteRequest,
  type CategoryRuleUpsertRequest,
  type MerchantMapDeleteRequest,
  type MerchantMapUpsertRequest,
  type MerchantRuleSuggestionsQueryRequest,
  type RuleMutationPayload,
  type RulesListQueryRequest,
  type RulesQueryPayload,
} from "../../lib/desktopApi";
import { type BoolString } from "../../types/app";
import { isRecord, readArray, readBool, readNumber, readString } from "../../utils/value";

type InputLikeChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
};

type BoolFieldProps = {
  label: string;
  value: "true" | "false";
  onChange: (value: "true" | "false") => void;
};

type DateInputProps = {
  value?: string | number | null;
  onChange?: (event: InputLikeChangeEvent) => void;
  placeholder?: string;
  type?: string;
};

type JsonResultCardProps = {
  title?: string;
  data: unknown;
  emptyText: string;
};

type AutoRefreshHintProps = {
  busy?: boolean;
  children: ReactNode;
};

type TableSortDirection = "asc" | "desc";

function safeNumericInputValue(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNumericInputWithFallback(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function makeEnterToQueryHandler(run: () => void | Promise<void>) {
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

function nextSortState(
  currentKey: string | null,
  currentDir: TableSortDirection,
  clickedKey: string,
): { key: string; dir: TableSortDirection } {
  if (currentKey !== clickedKey) {
    return { key: clickedKey, dir: "asc" };
  }
  return { key: clickedKey, dir: currentDir === "asc" ? "desc" : "asc" };
}
function MerchantSuggestionsPreview({
  data,
  onPickRow,
  PreviewStat,
  maskAmountDisplayText,
}: {
  data: unknown;
  onPickRow?: (row: {
    merchant_normalized: string;
    suggested_expense_category: string;
    mapped_expense_category: string;
  }) => void;
  PreviewStat: ComponentType<PreviewStatProps>;
  maskAmountDisplayText: (text: string) => string;
}) {
  const [sortKey, setSortKey] = useState<string>("review_count");
  const [sortDir, setSortDir] = useState<TableSortDirection>("desc");
  if (!isRecord(data)) {
    return <p className="placeholder">请先执行查询，查看可用于规则回填的商户建议。</p>;
  }
  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count") ?? rows.length;
  const onlyUnmapped = readBool(data, "summary.only_unmapped");
  const keyword = readString(data, "summary.keyword") ?? "";
  const sortedRows = [...rows].sort((a, b) => {
    const normalize = (row: Record<string, unknown>) => {
      const raw = row[sortKey];
      if (typeof raw === "number") return raw;
      if (typeof raw === "string") {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) return n;
        return raw.toLowerCase();
      }
      if (raw == null) return "";
      return String(raw).toLowerCase();
    };
    const av = normalize(a);
    const bv = normalize(b);
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const columns: Array<{ key: string; label: string; sortable?: boolean; className?: string }> = [
    { key: "__action__", label: "操作", sortable: false },
    { key: "merchant_normalized", label: "商户" },
    { key: "suggested_expense_category", label: "建议分类" },
    { key: "mapped_expense_category", label: "已映射分类" },
    { key: "txn_count", label: "交易数", className: "num" },
    { key: "review_count", label: "待确认数", className: "num" },
    { key: "total_amount_cents", label: "总金额(元)", className: "num" },
  ];

  return (
    <div className="subcard">
      <h3>商户建议预览</h3>
      <div className="preview-stat-grid">
        <PreviewStat label="记录数" value={count} tone={count > 0 ? "good" : "warn"} />
        <PreviewStat label="仅未映射" value={String(onlyUnmapped ?? false)} />
        <PreviewStat label="关键词" value={keyword || "-"} />
      </div>
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={col.className ?? ""}>
                    {col.sortable === false ? (
                      col.label
                    ) : (
                      <button
                        type="button"
                        className="table-sort-btn"
                        onClick={() => {
                          const next = nextSortState(sortKey, sortDir, col.key);
                          setSortKey(next.key);
                          setSortDir(next.dir);
                        }}
                        title={`按 ${col.label} 排序`}
                      >
                        <span>{col.label}</span>
                        <span className="table-sort-indicator">
                          {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => {
                const merchant = typeof row.merchant_normalized === "string" ? row.merchant_normalized : "-";
                const suggested =
                  typeof row.suggested_expense_category === "string" && row.suggested_expense_category
                    ? row.suggested_expense_category
                    : "-";
                const mapped =
                  typeof row.mapped_expense_category === "string" && row.mapped_expense_category
                    ? row.mapped_expense_category
                    : "-";
                const txnCount = typeof row.txn_count === "number" ? row.txn_count : 0;
                const reviewCount = typeof row.review_count === "number" ? row.review_count : 0;
                const totalYuan =
                  typeof row.total_amount_yuan === "string"
                    ? maskAmountDisplayText(row.total_amount_yuan)
                    : typeof row.total_amount_cents === "number"
                      ? maskAmountDisplayText((row.total_amount_cents / 100).toFixed(2))
                      : "-";
                return (
                  <tr key={`${merchant}-${idx}`}>
                    <td>
                      <button
                        type="button"
                        className="secondary-btn table-inline-btn"
                        onClick={() =>
                          onPickRow?.({
                            merchant_normalized: merchant,
                            suggested_expense_category:
                              typeof row.suggested_expense_category === "string"
                                ? row.suggested_expense_category
                                : "",
                            mapped_expense_category:
                              typeof row.mapped_expense_category === "string"
                                ? row.mapped_expense_category
                                : "",
                          })
                        }
                        disabled={!onPickRow || merchant === "-"}
                        title="回填到 Merchant Map 表单"
                      >
                        回填
                      </button>
                    </td>
                    <td className="truncate-cell" title={merchant}>{merchant}</td>
                    <td>{suggested}</td>
                    <td>{mapped}</td>
                    <td className="num">{txnCount}</td>
                    <td className="num">{reviewCount}</td>
                    <td className="num">{totalYuan}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="placeholder">暂无建议记录（可能没有消费交易，或商户都已映射）。</p>
      )}
    </div>
  );
}

type RulesPreviewColumn = {
  key: string;
  label: string;
  kind?: "text" | "bool01";
};

function RulesRowsPreview({
  title,
  data,
  emptyText,
  columns,
  PreviewStat,
}: {
  title: string;
  data: unknown;
  emptyText: string;
  columns: RulesPreviewColumn[];
  PreviewStat: ComponentType<PreviewStatProps>;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<TableSortDirection>("asc");

  if (!isRecord(data)) {
    return <p className="placeholder">{emptyText}</p>;
  }

  const rows = readArray(data, "rows").filter(isRecord);
  const count = readNumber(data, "summary.count") ?? rows.length;
  const filePath = readString(data, "summary.file_path") ?? "";

  const sortedRows = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return 0;

    const normalize = (row: Record<string, unknown>) => {
      const raw = row[sortKey];
      if (col.kind === "bool01") {
        if (typeof raw === "number") return raw;
        const n = Number(raw ?? 0);
        return Number.isFinite(n) ? n : 0;
      }
      if (typeof raw === "number") return raw;
      if (typeof raw === "string") {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) return n;
        return raw.toLowerCase();
      }
      if (raw == null) return "";
      return String(raw).toLowerCase();
    };

    const av = normalize(a);
    const bv = normalize(b);
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const renderCell = (row: Record<string, unknown>, col: RulesPreviewColumn) => {
    const value = row[col.key];
    if (col.kind === "bool01") {
      const num = typeof value === "number" ? value : Number(value ?? 0);
      return num === 1 ? "是" : "否";
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (typeof value === "string") {
      return value || "-";
    }
    if (value == null) {
      return "-";
    }
    return String(value);
  };

  return (
    <div className="subcard">
      <h3>{title}</h3>
      <div className="preview-stat-grid">
        <PreviewStat label="记录数" value={count} tone={count > 0 ? "good" : "warn"} />
        <PreviewStat label="当前显示" value={sortedRows.length} />
      </div>
      {filePath ? (
        <div className="preview-subtle">
          文件：<code>{filePath}</code>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table compact">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>
                    <button
                      type="button"
                      className="table-sort-btn"
                      onClick={() => {
                        const next = nextSortState(sortKey, sortDir, col.key);
                        setSortKey(next.key);
                        setSortDir(next.dir);
                      }}
                      title={`按 ${col.label} 排序`}
                    >
                      <span>{col.label}</span>
                      <span className="table-sort-indicator">
                        {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => (
                <tr key={idx}>
                  {columns.map((col) => (
                    <td key={col.key} className={String(renderCell(row, col)).length > 30 ? "truncate-cell" : ""} title={String(renderCell(row, col))}>
                      {renderCell(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="placeholder">查询成功，但当前没有匹配规则行。</p>
      )}
    </div>
  );
}

export function RulesAdminPanel({
  showRawJson,
  PreviewStat,
  BoolField,
  DateInput,
  JsonResultCard,
  AutoRefreshHint,
  maskAmountDisplayText,
}: {
  showRawJson: boolean;
  PreviewStat: ComponentType<PreviewStatProps>;
  BoolField: ComponentType<BoolFieldProps>;
  DateInput: ComponentType<DateInputProps>;
  JsonResultCard: ComponentType<JsonResultCardProps>;
  AutoRefreshHint: ComponentType<AutoRefreshHintProps>;
  maskAmountDisplayText: (text: string) => string;
}) {
  const errMsg = (err: unknown) =>
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";

  const [merchantQueryBusy, setMerchantQueryBusy] = useState(false);
  const [merchantQueryError, setMerchantQueryError] = useState("");
  const [merchantQueryResult, setMerchantQueryResult] = useState<RulesQueryPayload | null>(null);
  const [merchantQuery, setMerchantQuery] = useState<RulesListQueryRequest>({ keyword: "", limit: 100 });
  const [merchantUpsertBusy, setMerchantUpsertBusy] = useState(false);
  const [merchantUpsertError, setMerchantUpsertError] = useState("");
  const [merchantUpsertResult, setMerchantUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [merchantUpsertForm, setMerchantUpsertForm] = useState<MerchantMapUpsertRequest>({
    merchant_normalized: "",
    expense_category: "",
    confidence: "0.95",
    note: "",
  });
  const [merchantDeleteBusy, setMerchantDeleteBusy] = useState(false);
  const [merchantDeleteError, setMerchantDeleteError] = useState("");
  const [merchantDeleteResult, setMerchantDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [merchantDeleteForm, setMerchantDeleteForm] = useState<MerchantMapDeleteRequest>({
    merchant_normalized: "",
  });
  const [merchantSuggestionsBusy, setMerchantSuggestionsBusy] = useState(false);
  const [merchantSuggestionsError, setMerchantSuggestionsError] = useState("");
  const [merchantSuggestionsResult, setMerchantSuggestionsResult] = useState<RulesQueryPayload | null>(null);
  const [merchantSuggestionsQuery, setMerchantSuggestionsQuery] = useState<MerchantRuleSuggestionsQueryRequest>({
    keyword: "",
    limit: 100,
    only_unmapped: "true",
  });

  const [categoryQueryBusy, setCategoryQueryBusy] = useState(false);
  const [categoryQueryError, setCategoryQueryError] = useState("");
  const [categoryQueryResult, setCategoryQueryResult] = useState<RulesQueryPayload | null>(null);
  const [categoryQuery, setCategoryQuery] = useState<RulesListQueryRequest>({ keyword: "", limit: 100 });
  const [categoryUpsertBusy, setCategoryUpsertBusy] = useState(false);
  const [categoryUpsertError, setCategoryUpsertError] = useState("");
  const [categoryUpsertResult, setCategoryUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [categoryUpsertForm, setCategoryUpsertForm] = useState<CategoryRuleUpsertRequest>({
    priority: "500",
    match_type: "contains",
    pattern: "",
    expense_category: "",
    confidence: "0.70",
    note: "",
  });
  const [categoryDeleteBusy, setCategoryDeleteBusy] = useState(false);
  const [categoryDeleteError, setCategoryDeleteError] = useState("");
  const [categoryDeleteResult, setCategoryDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [categoryDeleteForm, setCategoryDeleteForm] = useState<CategoryRuleDeleteRequest>({
    match_type: "contains",
    pattern: "",
  });

  const [bankQueryBusy, setBankQueryBusy] = useState(false);
  const [bankQueryError, setBankQueryError] = useState("");
  const [bankQueryResult, setBankQueryResult] = useState<RulesQueryPayload | null>(null);
  const [bankQuery, setBankQuery] = useState<BankTransferWhitelistQueryRequest>({
    keyword: "",
    limit: 100,
    active_only: "false",
  });
  const [bankUpsertBusy, setBankUpsertBusy] = useState(false);
  const [bankUpsertError, setBankUpsertError] = useState("");
  const [bankUpsertResult, setBankUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [bankUpsertForm, setBankUpsertForm] = useState<BankTransferWhitelistUpsertRequest>({
    name: "",
    is_active: "true",
    note: "",
  });
  const [bankDeleteBusy, setBankDeleteBusy] = useState(false);
  const [bankDeleteError, setBankDeleteError] = useState("");
  const [bankDeleteResult, setBankDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [bankDeleteForm, setBankDeleteForm] = useState<BankTransferWhitelistDeleteRequest>({ name: "" });

  const [exclQueryBusy, setExclQueryBusy] = useState(false);
  const [exclQueryError, setExclQueryError] = useState("");
  const [exclQueryResult, setExclQueryResult] = useState<RulesQueryPayload | null>(null);
  const [exclQuery, setExclQuery] = useState<AnalysisExclusionQueryRequest>({
    keyword: "",
    limit: 100,
    enabled_only: "false",
  });
  const [exclUpsertBusy, setExclUpsertBusy] = useState(false);
  const [exclUpsertError, setExclUpsertError] = useState("");
  const [exclUpsertResult, setExclUpsertResult] = useState<RuleMutationPayload | null>(null);
  const [exclUpsertForm, setExclUpsertForm] = useState<AnalysisExclusionUpsertRequest>({
    enabled: "true",
    rule_name: "",
    merchant_contains: "",
    description_contains: "",
    expense_category: "",
    min_amount: "",
    max_amount: "",
    start_date: "",
    end_date: "",
    reason: "排除分析",
  });
  const [exclDeleteBusy, setExclDeleteBusy] = useState(false);
  const [exclDeleteError, setExclDeleteError] = useState("");
  const [exclDeleteResult, setExclDeleteResult] = useState<RuleMutationPayload | null>(null);
  const [exclDeleteForm, setExclDeleteForm] = useState<AnalysisExclusionDeleteRequest>({ rule_name: "" });

  const anyBusy =
    merchantQueryBusy ||
    merchantUpsertBusy ||
    merchantDeleteBusy ||
    merchantSuggestionsBusy ||
    categoryQueryBusy ||
    categoryUpsertBusy ||
    categoryDeleteBusy ||
    bankQueryBusy ||
    bankUpsertBusy ||
    bankDeleteBusy ||
    exclQueryBusy ||
    exclUpsertBusy ||
    exclDeleteBusy;

  async function handleMerchantQuery() {
    setMerchantQueryBusy(true);
    setMerchantQueryError("");
    try {
      const payload = await queryMerchantMapRules({
        keyword: `${merchantQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(merchantQuery.limit, 100),
      });
      startTransition(() => setMerchantQueryResult(payload));
    } catch (err) {
      setMerchantQueryError(errMsg(err));
    } finally {
      setMerchantQueryBusy(false);
    }
  }

  async function handleMerchantUpsert() {
    setMerchantUpsertBusy(true);
    setMerchantUpsertError("");
    try {
      const payload = await upsertMerchantMapRule({
        merchant_normalized: `${merchantUpsertForm.merchant_normalized ?? ""}`.trim(),
        expense_category: `${merchantUpsertForm.expense_category ?? ""}`.trim(),
        confidence: `${merchantUpsertForm.confidence ?? ""}`.trim(),
        note: `${merchantUpsertForm.note ?? ""}`.trim(),
      });
      startTransition(() => setMerchantUpsertResult(payload));
      void handleMerchantQuery();
    } catch (err) {
      setMerchantUpsertError(errMsg(err));
    } finally {
      setMerchantUpsertBusy(false);
    }
  }

  async function handleMerchantDelete() {
    setMerchantDeleteBusy(true);
    setMerchantDeleteError("");
    try {
      const payload = await deleteMerchantMapRule({
        merchant_normalized: `${merchantDeleteForm.merchant_normalized ?? ""}`.trim(),
      });
      startTransition(() => setMerchantDeleteResult(payload));
      void handleMerchantQuery();
    } catch (err) {
      setMerchantDeleteError(errMsg(err));
    } finally {
      setMerchantDeleteBusy(false);
    }
  }

  async function handleMerchantSuggestionsQuery() {
    setMerchantSuggestionsBusy(true);
    setMerchantSuggestionsError("");
    try {
      const payload = await queryMerchantRuleSuggestions({
        keyword: `${merchantSuggestionsQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(merchantSuggestionsQuery.limit, 100),
        only_unmapped: merchantSuggestionsQuery.only_unmapped ?? "true",
      });
      startTransition(() => setMerchantSuggestionsResult(payload));
    } catch (err) {
      setMerchantSuggestionsError(errMsg(err));
    } finally {
      setMerchantSuggestionsBusy(false);
    }
  }

  function handlePickMerchantSuggestion(row: {
    merchant_normalized: string;
    suggested_expense_category: string;
    mapped_expense_category: string;
  }) {
    const preferredCategory =
      row.mapped_expense_category.trim() || row.suggested_expense_category.trim() || "";
    setMerchantUpsertForm((prev) => ({
      ...prev,
      merchant_normalized: row.merchant_normalized,
      expense_category: preferredCategory || prev.expense_category || "",
      note:
        prev.note && prev.note.trim()
          ? prev.note
          : "from merchant suggestions (desktop)",
    }));
  }

  async function handleCategoryQuery() {
    setCategoryQueryBusy(true);
    setCategoryQueryError("");
    try {
      const payload = await queryCategoryRules({
        keyword: `${categoryQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(categoryQuery.limit, 100),
      });
      startTransition(() => setCategoryQueryResult(payload));
    } catch (err) {
      setCategoryQueryError(errMsg(err));
    } finally {
      setCategoryQueryBusy(false);
    }
  }

  async function handleCategoryUpsert() {
    setCategoryUpsertBusy(true);
    setCategoryUpsertError("");
    try {
      const payload = await upsertCategoryRule({
        priority: `${categoryUpsertForm.priority ?? ""}`.trim(),
        match_type: (categoryUpsertForm.match_type ?? "contains") as CategoryRuleUpsertRequest["match_type"],
        pattern: `${categoryUpsertForm.pattern ?? ""}`.trim(),
        expense_category: `${categoryUpsertForm.expense_category ?? ""}`.trim(),
        confidence: `${categoryUpsertForm.confidence ?? ""}`.trim(),
        note: `${categoryUpsertForm.note ?? ""}`.trim(),
      });
      startTransition(() => setCategoryUpsertResult(payload));
      void handleCategoryQuery();
    } catch (err) {
      setCategoryUpsertError(errMsg(err));
    } finally {
      setCategoryUpsertBusy(false);
    }
  }

  async function handleCategoryDelete() {
    setCategoryDeleteBusy(true);
    setCategoryDeleteError("");
    try {
      const payload = await deleteCategoryRule({
        match_type: (categoryDeleteForm.match_type ?? "contains") as CategoryRuleDeleteRequest["match_type"],
        pattern: `${categoryDeleteForm.pattern ?? ""}`.trim(),
      });
      startTransition(() => setCategoryDeleteResult(payload));
      void handleCategoryQuery();
    } catch (err) {
      setCategoryDeleteError(errMsg(err));
    } finally {
      setCategoryDeleteBusy(false);
    }
  }

  async function handleBankQuery() {
    setBankQueryBusy(true);
    setBankQueryError("");
    try {
      const payload = await queryBankTransferWhitelistRules({
        keyword: `${bankQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(bankQuery.limit, 100),
        active_only: bankQuery.active_only ?? "false",
      });
      startTransition(() => setBankQueryResult(payload));
    } catch (err) {
      setBankQueryError(errMsg(err));
    } finally {
      setBankQueryBusy(false);
    }
  }

  async function handleBankUpsert() {
    setBankUpsertBusy(true);
    setBankUpsertError("");
    try {
      const payload = await upsertBankTransferWhitelistRule({
        name: `${bankUpsertForm.name ?? ""}`.trim(),
        is_active: bankUpsertForm.is_active ?? "true",
        note: `${bankUpsertForm.note ?? ""}`.trim(),
      });
      startTransition(() => setBankUpsertResult(payload));
      void handleBankQuery();
      void handleCmbBankPdfPreviewAutoHint();
    } catch (err) {
      setBankUpsertError(errMsg(err));
    } finally {
      setBankUpsertBusy(false);
    }
  }

  async function handleBankDelete() {
    setBankDeleteBusy(true);
    setBankDeleteError("");
    try {
      const payload = await deleteBankTransferWhitelistRule({
        name: `${bankDeleteForm.name ?? ""}`.trim(),
      });
      startTransition(() => setBankDeleteResult(payload));
      void handleBankQuery();
      void handleCmbBankPdfPreviewAutoHint();
    } catch (err) {
      setBankDeleteError(errMsg(err));
    } finally {
      setBankDeleteBusy(false);
    }
  }

  async function handleExclQuery() {
    setExclQueryBusy(true);
    setExclQueryError("");
    try {
      const payload = await queryAnalysisExclusionRules({
        keyword: `${exclQuery.keyword ?? ""}`.trim(),
        limit: safeNumericInputValue(exclQuery.limit, 100),
        enabled_only: exclQuery.enabled_only ?? "false",
      });
      startTransition(() => setExclQueryResult(payload));
    } catch (err) {
      setExclQueryError(errMsg(err));
    } finally {
      setExclQueryBusy(false);
    }
  }

  async function handleExclUpsert() {
    setExclUpsertBusy(true);
    setExclUpsertError("");
    try {
      const payload = await upsertAnalysisExclusionRule({
        enabled: exclUpsertForm.enabled ?? "true",
        rule_name: `${exclUpsertForm.rule_name ?? ""}`.trim(),
        merchant_contains: `${exclUpsertForm.merchant_contains ?? ""}`.trim(),
        description_contains: `${exclUpsertForm.description_contains ?? ""}`.trim(),
        expense_category: `${exclUpsertForm.expense_category ?? ""}`.trim(),
        min_amount: `${exclUpsertForm.min_amount ?? ""}`.trim(),
        max_amount: `${exclUpsertForm.max_amount ?? ""}`.trim(),
        start_date: `${exclUpsertForm.start_date ?? ""}`.trim(),
        end_date: `${exclUpsertForm.end_date ?? ""}`.trim(),
        reason: `${exclUpsertForm.reason ?? ""}`.trim(),
      });
      startTransition(() => setExclUpsertResult(payload));
      void handleExclQuery();
      void handleCmbEmlPreviewAutoHint();
    } catch (err) {
      setExclUpsertError(errMsg(err));
    } finally {
      setExclUpsertBusy(false);
    }
  }

  async function handleExclDelete() {
    setExclDeleteBusy(true);
    setExclDeleteError("");
    try {
      const payload = await deleteAnalysisExclusionRule({
        rule_name: `${exclDeleteForm.rule_name ?? ""}`.trim(),
      });
      startTransition(() => setExclDeleteResult(payload));
      void handleExclQuery();
      void handleCmbEmlPreviewAutoHint();
    } catch (err) {
      setExclDeleteError(errMsg(err));
    } finally {
      setExclDeleteBusy(false);
    }
  }

  // Lightweight hint trigger: re-query file-based summaries only if user already has a path entered.
  async function handleCmbEmlPreviewAutoHint() {
    return;
  }
  async function handleCmbBankPdfPreviewAutoHint() {
    return;
  }

  useDebouncedAutoRun(
    handleMerchantQuery,
    [merchantQuery.keyword ?? "", merchantQuery.limit ?? 100],
    { delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleMerchantSuggestionsQuery,
    [
      merchantSuggestionsQuery.keyword ?? "",
      merchantSuggestionsQuery.limit ?? 100,
      merchantSuggestionsQuery.only_unmapped ?? "true",
    ],
    { delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleCategoryQuery,
    [categoryQuery.keyword ?? "", categoryQuery.limit ?? 100],
    { delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleBankQuery,
    [bankQuery.keyword ?? "", bankQuery.limit ?? 100, bankQuery.active_only ?? "false"],
    { delayMs: 260 },
  );
  useDebouncedAutoRun(
    handleExclQuery,
    [exclQuery.keyword ?? "", exclQuery.limit ?? 100, exclQuery.enabled_only ?? "false"],
    { delayMs: 260 },
  );

  return (
    <section className="card panel">
      <div className="panel-header">
        <h2>规则管理</h2>
        <p>在 desktop 内维护导入规则文件（当前写入仓库 `data/rules/*.csv`），供 EML / CMB PDF 导入即时生效。</p>
      </div>

      <AutoRefreshHint busy={merchantQueryBusy || merchantSuggestionsBusy || categoryQueryBusy || bankQueryBusy || exclQueryBusy}>
        规则查询已改为自动刷新：首次进入本页会自动加载，修改筛选条件后会自动更新下方列表。
      </AutoRefreshHint>

      <div className="db-grid rules-admin-grid">
        <div className="subcard">
          <h3>商户映射</h3>
          <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleMerchantQuery)}>
            <label className="field">
              <span>关键词</span>
              <input
                value={merchantQuery.keyword ?? ""}
                onChange={(e) => setMerchantQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="merchant/category/note"
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(merchantQuery.limit, 100)}
                onChange={(e) =>
                  setMerchantQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>标准化商户名</span>
              <input
                value={merchantUpsertForm.merchant_normalized ?? ""}
                onChange={(e) =>
                  setMerchantUpsertForm((prev) => ({ ...prev, merchant_normalized: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>消费分类</span>
              <input
                value={merchantUpsertForm.expense_category ?? ""}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>置信度</span>
              <input
                value={merchantUpsertForm.confidence ?? "0.95"}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, confidence: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>备注</span>
              <input
                value={merchantUpsertForm.note ?? ""}
                onChange={(e) => setMerchantUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="primary-btn" onClick={() => void handleMerchantUpsert()} disabled={anyBusy}>
              {merchantUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>删除目标（标准化商户名）</span>
              <input
                value={merchantDeleteForm.merchant_normalized ?? ""}
                onChange={(e) =>
                  setMerchantDeleteForm((prev) => ({ ...prev, merchant_normalized: e.target.value }))
                }
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleMerchantDelete()} disabled={anyBusy}>
              {merchantDeleteBusy ? "删除中..." : "删除"}
            </button>
          </div>
          {merchantQueryError || merchantUpsertError || merchantDeleteError ? (
            <div className="inline-error" role="alert">
              {[merchantQueryError, merchantUpsertError, merchantDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="商户映射预览"
            data={merchantQueryResult}
            emptyText="尚未查询商户映射。"
            PreviewStat={PreviewStat}
            columns={[
              { key: "merchant_normalized", label: "标准化商户名" },
              { key: "expense_category", label: "消费分类" },
              { key: "confidence", label: "置信度" },
              { key: "note", label: "备注" },
            ]}
          />
          <AutoRefreshHint busy={merchantQueryBusy}>建议先查询查看现有规则，再写入/删除。可打开原始 JSON 查看结果详情。</AutoRefreshHint>
          {showRawJson ? (
            <>
              <JsonResultCard title="商户映射查询" data={merchantQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="商户映射写入" data={merchantUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="商户映射删除" data={merchantDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>

        <div className="subcard">
          <h3>商户建议</h3>
          <p className="inline-hint">
            基于 desktop 本地库交易聚合生成建议回填清单。建议先用 `only_unmapped=true` 看未映射商户，再把结果回填到 商户映射。
          </p>
          <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleMerchantSuggestionsQuery)}>
            <label className="field">
              <span>关键词</span>
              <input
                value={merchantSuggestionsQuery.keyword ?? ""}
                onChange={(e) =>
                  setMerchantSuggestionsQuery((prev) => ({ ...prev, keyword: e.target.value }))
                }
                placeholder="商户关键词"
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(merchantSuggestionsQuery.limit, 100)}
                onChange={(e) =>
                  setMerchantSuggestionsQuery((prev) => ({
                    ...prev,
                    limit: parseNumericInputWithFallback(e.target.value, 100),
                  }))
                }
              />
            </label>
            <BoolField
              label="仅显示未映射"
              value={(merchantSuggestionsQuery.only_unmapped ?? "true") as BoolString}
              onChange={(value) =>
                setMerchantSuggestionsQuery((prev) => ({ ...prev, only_unmapped: value }))
              }
            />
          </div>
          <AutoRefreshHint busy={merchantSuggestionsBusy}>首次进入会自动加载；修改关键词、数量或“仅显示未映射”后会自动刷新建议列表。</AutoRefreshHint>
          {merchantSuggestionsError ? (
            <div className="inline-error" role="alert">
              {merchantSuggestionsError}
            </div>
          ) : null}
          <MerchantSuggestionsPreview
            data={merchantSuggestionsResult}
            onPickRow={handlePickMerchantSuggestion}
            PreviewStat={PreviewStat}
            maskAmountDisplayText={maskAmountDisplayText}
          />
          {showRawJson ? (
            <JsonResultCard
              title="商户建议 JSON"
              data={merchantSuggestionsResult}
              emptyText="尚未查询。"
            />
          ) : null}
        </div>

        <div className="subcard">
          <h3>分类规则</h3>
          <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleCategoryQuery)}>
            <label className="field">
              <span>关键词</span>
              <input
                value={categoryQuery.keyword ?? ""}
                onChange={(e) => setCategoryQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                placeholder="pattern/category/note"
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(categoryQuery.limit, 100)}
                onChange={(e) =>
                  setCategoryQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>优先级</span>
              <input
                value={categoryUpsertForm.priority ?? "500"}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, priority: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>匹配类型</span>
              <select
                value={categoryUpsertForm.match_type ?? "contains"}
                onChange={(e) =>
                  setCategoryUpsertForm((prev) => ({
                    ...prev,
                    match_type: e.target.value as CategoryRuleUpsertRequest["match_type"],
                  }))
                }
              >
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="prefix">prefix</option>
                <option value="regex">regex</option>
              </select>
            </label>
            <label className="field">
              <span>匹配模式</span>
              <input
                value={categoryUpsertForm.pattern ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, pattern: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>消费分类</span>
              <input
                value={categoryUpsertForm.expense_category ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>置信度</span>
              <input
                value={categoryUpsertForm.confidence ?? "0.70"}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, confidence: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>备注</span>
              <input
                value={categoryUpsertForm.note ?? ""}
                onChange={(e) => setCategoryUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="primary-btn" onClick={() => void handleCategoryUpsert()} disabled={anyBusy}>
              {categoryUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>删除目标匹配类型</span>
              <select
                value={categoryDeleteForm.match_type ?? "contains"}
                onChange={(e) =>
                  setCategoryDeleteForm((prev) => ({
                    ...prev,
                    match_type: e.target.value as CategoryRuleDeleteRequest["match_type"],
                  }))
                }
              >
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="prefix">prefix</option>
                <option value="regex">regex</option>
              </select>
            </label>
            <label className="field">
              <span>删除目标模式</span>
              <input
                value={categoryDeleteForm.pattern ?? ""}
                onChange={(e) => setCategoryDeleteForm((prev) => ({ ...prev, pattern: e.target.value }))}
              />
            </label>
            <div className="field field-inline-button">
              <span>&nbsp;</span>
              <button type="button" className="danger-btn" onClick={() => void handleCategoryDelete()} disabled={anyBusy}>
                {categoryDeleteBusy ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
          {categoryQueryError || categoryUpsertError || categoryDeleteError ? (
            <div className="inline-error" role="alert">
              {[categoryQueryError, categoryUpsertError, categoryDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="分类规则预览"
            data={categoryQueryResult}
            emptyText="尚未查询分类规则。"
            PreviewStat={PreviewStat}
            columns={[
              { key: "priority", label: "优先级" },
              { key: "match_type", label: "匹配类型" },
              { key: "pattern", label: "匹配模式" },
              { key: "expense_category", label: "消费分类" },
              { key: "confidence", label: "置信度" },
            ]}
          />
          <AutoRefreshHint busy={categoryQueryBusy}>EML/PDF 分类会读取这里的规则，修改后重新预览即可验证效果。</AutoRefreshHint>
          {showRawJson ? (
            <>
              <JsonResultCard title="分类规则查询" data={categoryQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="分类规则写入" data={categoryUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="分类规则删除" data={categoryDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>

        <div className="subcard">
          <h3>银行转账白名单</h3>
          <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleBankQuery)}>
            <label className="field">
              <span>关键词</span>
              <input
                value={bankQuery.keyword ?? ""}
                onChange={(e) => setBankQuery((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(bankQuery.limit, 100)}
                onChange={(e) =>
                  setBankQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
            <BoolField
              label="仅显示启用"
              value={(bankQuery.active_only ?? "false") as BoolString}
              onChange={(value) => setBankQuery((prev) => ({ ...prev, active_only: value }))}
            />
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <label className="field">
              <span>名称</span>
              <input
                value={bankUpsertForm.name ?? ""}
                onChange={(e) => setBankUpsertForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <BoolField
              label="is_active"
              value={(bankUpsertForm.is_active ?? "true") as BoolString}
              onChange={(value) => setBankUpsertForm((prev) => ({ ...prev, is_active: value }))}
            />
            <label className="field">
              <span>备注</span>
              <input
                value={bankUpsertForm.note ?? ""}
                onChange={(e) => setBankUpsertForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="primary-btn" onClick={() => void handleBankUpsert()} disabled={anyBusy}>
              {bankUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>删除目标名称</span>
              <input
                value={bankDeleteForm.name ?? ""}
                onChange={(e) => setBankDeleteForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleBankDelete()} disabled={anyBusy}>
              {bankDeleteBusy ? "删除中..." : "删除"}
            </button>
          </div>
          {bankQueryError || bankUpsertError || bankDeleteError ? (
            <div className="inline-error" role="alert">
              {[bankQueryError, bankUpsertError, bankDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="转账白名单预览"
            data={bankQueryResult}
            emptyText="尚未查询转账白名单。"
            PreviewStat={PreviewStat}
            columns={[
              { key: "name", label: "名称" },
              { key: "is_active", label: "启用", kind: "bool01" },
              { key: "note", label: "备注" },
            ]}
          />
          <AutoRefreshHint busy={bankQueryBusy}>该白名单用于招行 PDF 导入中识别银行卡个人转账消费。</AutoRefreshHint>
          {showRawJson ? (
            <>
              <JsonResultCard title="白名单查询" data={bankQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="白名单写入" data={bankUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="白名单删除" data={bankDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>

        <div className="subcard">
          <h3>分析排除规则</h3>
          <div className="query-form-grid query-form-grid-compact" onKeyDown={makeEnterToQueryHandler(handleExclQuery)}>
            <label className="field">
              <span>关键词</span>
              <input
                value={exclQuery.keyword ?? ""}
                onChange={(e) => setExclQuery((prev) => ({ ...prev, keyword: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>数量</span>
              <input
                type="number"
                min={1}
                max={500}
                value={safeNumericInputValue(exclQuery.limit, 100)}
                onChange={(e) =>
                  setExclQuery((prev) => ({ ...prev, limit: parseNumericInputWithFallback(e.target.value, 100) }))
                }
              />
            </label>
            <BoolField
              label="仅显示启用"
              value={(exclQuery.enabled_only ?? "false") as BoolString}
              onChange={(value) => setExclQuery((prev) => ({ ...prev, enabled_only: value }))}
            />
          </div>
          <div className="query-form-grid query-form-grid-compact">
            <BoolField
              label="enabled"
              value={(exclUpsertForm.enabled ?? "true") as BoolString}
              onChange={(value) => setExclUpsertForm((prev) => ({ ...prev, enabled: value }))}
            />
            <label className="field">
              <span>规则名</span>
              <input
                value={exclUpsertForm.rule_name ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, rule_name: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>商户包含</span>
              <input
                value={exclUpsertForm.merchant_contains ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, merchant_contains: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>描述包含</span>
              <input
                value={exclUpsertForm.description_contains ?? ""}
                onChange={(e) =>
                  setExclUpsertForm((prev) => ({ ...prev, description_contains: e.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>消费分类</span>
              <input
                value={exclUpsertForm.expense_category ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, expense_category: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>最小金额（分）</span>
              <input
                value={exclUpsertForm.min_amount ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, min_amount: e.target.value }))}
                placeholder="100000"
              />
            </label>
            <label className="field">
              <span>最大金额（分）</span>
              <input
                value={exclUpsertForm.max_amount ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, max_amount: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>开始日期</span>
              <DateInput
                value={exclUpsertForm.start_date ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, start_date: e.target.value }))}
                type="date"
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>结束日期</span>
              <DateInput
                value={exclUpsertForm.end_date ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, end_date: e.target.value }))}
                type="date"
                placeholder="YYYY-MM-DD"
              />
            </label>
            <label className="field">
              <span>原因</span>
              <input
                value={exclUpsertForm.reason ?? ""}
                onChange={(e) => setExclUpsertForm((prev) => ({ ...prev, reason: e.target.value }))}
              />
            </label>
          </div>
          <div className="db-actions">
            <button type="button" className="primary-btn" onClick={() => void handleExclUpsert()} disabled={anyBusy}>
              {exclUpsertBusy ? "保存中..." : "写入"}
            </button>
          </div>
          <div className="db-import-path-row">
            <label className="field db-import-path-field">
              <span>删除目标规则名</span>
              <input
                value={exclDeleteForm.rule_name ?? ""}
                onChange={(e) => setExclDeleteForm((prev) => ({ ...prev, rule_name: e.target.value }))}
              />
            </label>
            <button type="button" className="danger-btn" onClick={() => void handleExclDelete()} disabled={anyBusy}>
              {exclDeleteBusy ? "删除中..." : "删除"}
            </button>
          </div>
          {exclQueryError || exclUpsertError || exclDeleteError ? (
            <div className="inline-error" role="alert">
              {[exclQueryError, exclUpsertError, exclDeleteError].filter(Boolean).join(" | ")}
            </div>
          ) : null}
          <RulesRowsPreview
            title="分析排除规则预览"
            data={exclQueryResult}
            emptyText="尚未查询分析排除规则。"
            PreviewStat={PreviewStat}
            columns={[
              { key: "enabled", label: "启用", kind: "bool01" },
              { key: "rule_name", label: "规则名" },
              { key: "merchant_contains", label: "商户包含" },
              { key: "expense_category", label: "消费分类" },
              { key: "reason", label: "原因" },
            ]}
          />
          <AutoRefreshHint busy={exclQueryBusy}>EML 导入会在分类后应用这些排除规则，修改后重新预览招行 EML 即可观察变化。</AutoRefreshHint>
          {showRawJson ? (
            <>
              <JsonResultCard title="排除规则查询" data={exclQueryResult} emptyText="尚未查询。" />
              <JsonResultCard title="排除规则写入" data={exclUpsertResult} emptyText="尚未写入。" />
              <JsonResultCard title="排除规则删除" data={exclDeleteResult} emptyText="尚未删除。" />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
