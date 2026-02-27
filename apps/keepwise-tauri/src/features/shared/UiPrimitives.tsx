import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import DatePicker from "react-datepicker";
import { type AccountCatalogPayload, type PathProbe } from "../../lib/desktopApi";
import { isRecord, readArray } from "../../utils/value";

export type BoolFieldProps = {
  label: string;
  value: "true" | "false";
  onChange: (value: "true" | "false") => void;
};

export type InputLikeChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

export type PickerInputProps = {
  value?: string | number | null;
  onChange?: (event: InputLikeChangeEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  id?: string;
  name?: string;
  autoFocus?: boolean;
  onBlur?: (event: unknown) => void;
  onKeyDown?: (event: unknown) => void;
  type?: string;
};

export type JsonResultCardProps = {
  title?: string;
  data: unknown;
  emptyText: string;
  jsonValueReplacer?: (key: string, value: unknown) => unknown;
};

export type AccountSelectOption = {
  account_id: string;
  account_name: string;
  account_kind: string;
};

export type PreviewStatProps = {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "warn";
  valueFormatter?: (label: string, value: string | number) => string;
};

export type LineAreaChartProps = {
  points: Array<{ label: string; value: number }>;
  color?: string;
  xLabelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (point: { label: string; value: number }) => string;
  height?: number;
  preferZeroBaseline?: boolean;
  maxXTicks?: number;
};

export type AutoRefreshHintProps = {
  busy?: boolean;
  children: ReactNode;
};

export type TableSortDirection = "asc" | "desc";

export type SortableHeaderButtonProps = {
  label: string;
  sortKey: string;
  activeSortKey: string | null;
  sortDir: TableSortDirection;
  onToggle: (sortKey: string) => void;
};

export function PathRow({ label, probe }: { label: string; probe: PathProbe }) {
  return (
    <div className="path-row">
      <div className="path-label">{label}</div>
      {probe.path ? (
        <code className="path-value" title={probe.path}>
          {probe.path}
        </code>
      ) : (
        <div className="path-error" title={probe.error ?? undefined}>
          {probe.error ?? "Unavailable"}
        </div>
      )}
    </div>
  );
}

export function BoolField({ label, value, onChange }: BoolFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as "true" | "false")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    </label>
  );
}

function parseDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function formatDateInputValue(date: Date): string {
  const year = `${date.getFullYear()}`;
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emitPickerInputChange(onChange: PickerInputProps["onChange"], nextValue: string) {
  if (!onChange) {
    return;
  }
  onChange({
    target: { value: nextValue },
    currentTarget: { value: nextValue },
  });
}

export function DateInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  title,
  id,
  name,
  autoFocus,
  onBlur,
  onKeyDown,
}: PickerInputProps) {
  const selected = parseDateInputValue(value == null ? "" : String(value));
  const mergedClassName = ["kw-date-picker-input", className].filter(Boolean).join(" ");

  return (
    <div className="kw-date-input-shell">
      <DatePicker
        selected={selected}
        onChange={(date: Date | null) => emitPickerInputChange(onChange, date instanceof Date ? formatDateInputValue(date) : "")}
        dateFormat="yyyy-MM-dd"
        placeholderText={placeholder}
        className={mergedClassName}
        calendarClassName="kw-date-calendar"
        popperClassName="kw-date-popper"
        showPopperArrow={false}
        shouldCloseOnSelect
        disabled={disabled}
        title={title}
        id={id}
        name={name}
        autoFocus={autoFocus}
        onBlur={onBlur as never}
        onKeyDown={onKeyDown as never}
        todayButton="今天"
        isClearable
        clearButtonTitle="清空日期"
      />
    </div>
  );
}

export function BaseJsonResultCard({
  title = "Result JSON",
  data,
  emptyText,
  jsonValueReplacer,
}: JsonResultCardProps) {
  let rendered = emptyText;
  if (data) {
    try {
      rendered = JSON.stringify(
        data,
        (key, value) => {
          if (jsonValueReplacer) {
            return jsonValueReplacer(key, value);
          }
          if (typeof value === "bigint") {
            return value.toString();
          }
          return value;
        },
        2,
      );
    } catch (err) {
      rendered = `Unable to render JSON: ${
        err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error"
      }`;
    }
  }

  return (
    <div className="subcard db-result-card">
      <h3>{title}</h3>
      <pre className="json-pre">{rendered}</pre>
    </div>
  );
}

export function buildAccountSelectOptionsFromCatalog(data: AccountCatalogPayload | null): AccountSelectOption[] {
  if (!data) return [];
  const rows = readArray(data, "rows").filter(isRecord);
  const dedup = new Map<string, AccountSelectOption>();
  for (const row of rows) {
    const accountId = typeof row.account_id === "string" ? row.account_id : "";
    if (!accountId) continue;
    const accountName =
      (typeof row.account_name === "string" && row.account_name.trim()) ||
      accountId;
    const accountKind = typeof row.account_kind === "string" && row.account_kind ? row.account_kind : "other";
    if (!dedup.has(accountId)) {
      dedup.set(accountId, {
        account_id: accountId,
        account_name: accountName,
        account_kind: accountKind,
      });
    }
  }
  return [...dedup.values()].sort((a, b) => {
    const kindCmp = a.account_kind.localeCompare(b.account_kind);
    if (kindCmp !== 0) return kindCmp;
    const nameCmp = a.account_name.localeCompare(b.account_name, undefined, { numeric: true });
    if (nameCmp !== 0) return nameCmp;
    return a.account_id.localeCompare(b.account_id);
  });
}

function normalizeAccountKindsFilter(kinds?: string[]): string[] | null {
  if (!kinds || kinds.length === 0) return null;
  return [...new Set(kinds)];
}

function accountKindInFilter(kind: string, filter: string[] | null): boolean {
  if (!filter) return true;
  return filter.includes(kind);
}

export function accountKindsForAssetClass(assetClass: string): string[] | null {
  if (assetClass === "cash") return ["cash", "bank", "wallet"];
  if (assetClass === "real_estate") return ["real_estate"];
  if (assetClass === "liability") return ["liability", "credit_card"];
  return null;
}

export function AccountIdSelect({
  value,
  onChange,
  options,
  kinds,
  emptyLabel = "全部账户",
  includePortfolio = false,
  portfolioLabel = "投资组合（全部投资账户）",
  disabled = false,
}: {
  value?: string;
  onChange: (value: string) => void;
  options: AccountSelectOption[];
  kinds?: string[];
  emptyLabel?: string;
  includePortfolio?: boolean;
  portfolioLabel?: string;
  disabled?: boolean;
}) {
  const filter = normalizeAccountKindsFilter(kinds);
  const visible = options.filter((opt) => accountKindInFilter(opt.account_kind, filter));
  const grouped = new Map<string, AccountSelectOption[]>();
  for (const opt of visible) {
    const key = opt.account_kind || "other";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(opt);
  }
  const groupOrder = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  return (
    <select className="account-id-select" value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{emptyLabel}</option>
      {includePortfolio ? <option value="__portfolio__">{portfolioLabel}</option> : null}
      {groupOrder.map((kind) => (
        <optgroup key={kind} label={kind}>
          {(grouped.get(kind) ?? []).map((opt) => (
            <option key={opt.account_id} value={opt.account_id}>
              {opt.account_name} ({opt.account_id})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function BasePreviewStat({
  label,
  value,
  tone = "default",
  valueFormatter,
}: PreviewStatProps) {
  const displayValue = valueFormatter ? valueFormatter(label, value) : String(value);
  return (
    <div className={`preview-stat tone-${tone}`}>
      <div className="preview-stat-label">{label}</div>
      <div className="preview-stat-value">{displayValue}</div>
    </div>
  );
}

export function LineAreaChart({
  points,
  color = "#7cc3ff",
  xLabelFormatter,
  valueFormatter,
  tooltipFormatter,
  height = 240,
  preferZeroBaseline = false,
  maxXTicks = 8,
}: LineAreaChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(560);
  const gradientId = useId().replace(/[:]/g, "_");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const next = Math.max(320, Math.round(el.clientWidth || 560));
      setMeasuredWidth((prev) => (prev === next ? prev : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => update());
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const clean = points.filter((p) => Number.isFinite(p.value));
  if (clean.length === 0) {
    return <div ref={wrapRef} className="line-area-chart-empty">暂无趋势数据</div>;
  }

  const width = measuredWidth;
  const formattedValue = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const baseMargin = { top: 14, right: 16, bottom: 42 };
  const yTickCount = 4;
  const innerH = height - baseMargin.top - baseMargin.bottom;

  const minRaw = Math.min(...clean.map((p) => p.value));
  const maxRaw = Math.max(...clean.map((p) => p.value));
  let yMin = preferZeroBaseline ? Math.min(0, minRaw) : minRaw;
  let yMax = preferZeroBaseline ? Math.max(0, maxRaw) : maxRaw;
  if (yMin === yMax) {
    const bump = Math.max(Math.abs(yMin) * 0.1, 1);
    yMin -= bump;
    yMax += bump;
  } else {
    const pad = (yMax - yMin) * 0.08;
    if (preferZeroBaseline && minRaw >= 0) {
      yMax += pad;
      yMin = 0;
    } else if (preferZeroBaseline && maxRaw <= 0) {
      yMin -= pad;
      yMax = 0;
    } else {
      yMin -= pad;
      yMax += pad;
    }
  }
  const ySpan = yMax - yMin || 1;
  const yTickMeta = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const ratio = i / yTickCount;
    const value = yMax - ySpan * ratio;
    return {
      ratio,
      value,
      label: formattedValue(value),
    };
  });

  const maxYLabelLen = Math.max(...yTickMeta.map((tick) => tick.label.length), 1);
  const margin = {
    top: baseMargin.top,
    right: baseMargin.right,
    bottom: baseMargin.bottom,
    left: Math.min(152, Math.max(76, 20 + maxYLabelLen * 7)),
  };
  const innerW = Math.max(120, width - margin.left - margin.right);
  const stepX = clean.length > 1 ? innerW / (clean.length - 1) : 0;

  const toX = (idx: number) => margin.left + (clean.length > 1 ? idx * stepX : innerW / 2);
  const toY = (value: number) => margin.top + innerH - ((value - yMin) / ySpan) * innerH;

  const yTicks = yTickMeta.map((tick) => ({
    ...tick,
    y: margin.top + innerH * tick.ratio,
  }));

  const linePath = clean
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${toX(idx).toFixed(2)} ${toY(p.value).toFixed(2)}`)
    .join(" ");
  const areaPath =
    clean.length > 0
      ? [
          `M ${toX(0).toFixed(2)} ${(margin.top + innerH).toFixed(2)}`,
          ...clean.map((p, idx) => `L ${toX(idx).toFixed(2)} ${toY(p.value).toFixed(2)}`),
          `L ${toX(clean.length - 1).toFixed(2)} ${(margin.top + innerH).toFixed(2)}`,
          "Z",
        ].join(" ")
      : "";

  const effectiveMaxXTicks = Math.max(3, Math.min(maxXTicks, Math.floor(width / 72)));
  const tickStride =
    clean.length <= effectiveMaxXTicks ? 1 : Math.ceil(clean.length / Math.max(2, effectiveMaxXTicks));
  const xTicks = clean.map((p, idx) => ({
    label: xLabelFormatter ? xLabelFormatter(p.label) : p.label,
    rawLabel: p.label,
    x: toX(idx),
    idx,
  })).filter((_tick, idx, arr) => idx === 0 || idx === arr.length - 1 || idx % tickStride === 0);

  const active = hoverIndex != null ? clean[hoverIndex] : null;
  const activeX = hoverIndex != null ? toX(hoverIndex) : null;
  const activeY = hoverIndex != null && active ? toY(active.value) : null;

  return (
    <div ref={wrapRef} className="line-area-chart-wrap" style={{ height: `${height}px` }}>
      <svg
        className="line-area-chart"
        viewBox={`0 0 ${width} ${height}`}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width <= 0 || clean.length === 0) return;
          const clientX = e.clientX;
          const px = ((clientX - rect.left) / rect.width) * width;
          const clamped = Math.max(margin.left, Math.min(margin.left + innerW, px));
          const idx =
            clean.length === 1 ? 0 : Math.round(((clamped - margin.left) / innerW) * (clean.length - 1));
          setHoverIndex(Math.max(0, Math.min(clean.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="65%" stopColor={color} stopOpacity="0.08" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick, idx) => (
          <g key={`y-${idx}`}>
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={tick.y}
              y2={tick.y}
              className={`line-area-grid ${idx === yTicks.length - 1 ? "axis-baseline" : ""}`}
            />
            <text x={margin.left - 8} y={tick.y + 4} className="line-area-axis-label line-area-axis-label-y" textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}

        {xTicks.map((tick) => (
          <g key={`x-${tick.rawLabel}`}>
            <line
              x1={tick.x}
              x2={tick.x}
              y1={margin.top + innerH}
              y2={margin.top + innerH + 6}
              className="line-area-axis-tick"
            />
            <text x={tick.x} y={height - 14} className="line-area-axis-label line-area-axis-label-x" textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /> : null}

        {clean.map((p, idx) => {
          const x = toX(idx);
          const y = toY(p.value);
          const isActive = hoverIndex === idx;
          return (
            <circle
              key={`pt-${p.label}-${idx}`}
              cx={x}
              cy={y}
              r={isActive ? 4.2 : 2.4}
              className={isActive ? "line-area-point active" : "line-area-point"}
              style={{ fill: color, fillOpacity: isActive ? 1 : 0.72 }}
            />
          );
        })}

        {active && activeX != null && activeY != null ? (
          <g>
            <line
              x1={activeX}
              x2={activeX}
              y1={margin.top}
              y2={margin.top + innerH}
              className="line-area-crosshair"
              style={{ stroke: color, strokeOpacity: 0.36 }}
            />
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={activeY}
              y2={activeY}
              className="line-area-crosshair horizontal"
              style={{ stroke: color, strokeOpacity: 0.22 }}
            />
            <circle
              cx={activeX}
              cy={activeY}
              r={5.2}
              className="line-area-point-ring"
              style={{ fill: color, fillOpacity: 0.16, stroke: color, strokeOpacity: 0.72 }}
            />
          </g>
        ) : null}

        <rect
          x={margin.left}
          y={margin.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          pointerEvents="all"
        />
      </svg>

      {active && activeX != null && activeY != null ? (
        <div
          className="line-area-tooltip"
          style={{
            left: `${Math.max(7, Math.min(93, (activeX / width) * 100))}%`,
            top: `${(activeY / height) * 100}%`,
          }}
        >
          <div className="line-area-tooltip-title">{xLabelFormatter ? xLabelFormatter(active.label) : active.label}</div>
          <div className="line-area-tooltip-value">
            {tooltipFormatter ? tooltipFormatter(active) : formattedValue(active.value)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineProgressSpinner({ active }: { active?: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!active || !visible) return null;
  return <span className="inline-progress-spinner" aria-hidden="true" />;
}

export function AutoRefreshHint({ busy, children }: AutoRefreshHintProps) {
  return (
    <p className="inline-hint auto-refresh-hint">
      <span>{children}</span>
      <InlineProgressSpinner active={busy} />
    </p>
  );
}

export function nextSortState(
  currentKey: string | null,
  currentDir: TableSortDirection,
  clickedKey: string,
): { key: string; dir: TableSortDirection } {
  if (currentKey !== clickedKey) {
    return { key: clickedKey, dir: "asc" };
  }
  return { key: clickedKey, dir: currentDir === "asc" ? "desc" : "asc" };
}

export function compareSortValues(a: unknown, b: unknown): number {
  const normalize = (value: unknown): string | number => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      const num = Number(trimmed);
      if (trimmed !== "" && Number.isFinite(num)) return num;
      return value.toLowerCase();
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value == null) return "";
    return String(value).toLowerCase();
  };
  const av = normalize(a);
  const bv = normalize(b);
  if (typeof av === "number" && typeof bv === "number") {
    return av - bv;
  }
  return String(av).localeCompare(String(bv), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

export function SortableHeaderButton({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onToggle,
}: SortableHeaderButtonProps) {
  return (
    <button
      type="button"
      className="table-sort-btn"
      onClick={() => onToggle(sortKey)}
      title={`按 ${label} 排序`}
    >
      <span>{label}</span>
      <span className="table-sort-indicator">
        {activeSortKey === sortKey ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
      </span>
    </button>
  );
}
