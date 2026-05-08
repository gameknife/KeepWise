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
  series?: Array<{
    id: string;
    label: string;
    points: Array<{ label: string; value: number }>;
    color?: string;
    dashed?: boolean;
  }>;
  color?: string;
  xLabelFormatter?: (label: string) => string;
  valueFormatter?: (value: number) => string;
  tooltipFormatter?: (point: { label: string; value: number }) => string;
  multiTooltipFormatter?: (item: { label: string; seriesLabel: string; value: number }) => string;
  height?: number;
  preferZeroBaseline?: boolean;
  maxXTicks?: number;
  smooth?: boolean;
  sourceLabel?: string;
  showZeroLine?: boolean;
  markers?: Array<{
    label: string;
    color?: string;
    tooltipTitle?: string;
    tooltipLines?: string[];
  }>;
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
  series,
  color = "#7cc3ff",
  xLabelFormatter,
  valueFormatter,
  tooltipFormatter,
  multiTooltipFormatter,
  height = 240,
  preferZeroBaseline = false,
  maxXTicks = 8,
  smooth = false,
  sourceLabel,
  showZeroLine = false,
  markers,
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

  const normalizedSeries = (series && series.length > 0
    ? series.map((item, idx) => ({
        id: item.id || `series-${idx}`,
        label: item.label || `系列${idx + 1}`,
        color: item.color ?? (idx === 0 ? color : "#9fb6ff"),
        dashed: item.dashed ?? false,
        points: item.points.filter((point) => Number.isFinite(point.value)),
      }))
    : [
        {
          id: "primary",
          label: "primary",
          color,
          dashed: false,
          points: points.filter((point) => Number.isFinite(point.value)),
        },
      ]).filter((item) => item.points.length > 0);
  const isMultiSeries = normalizedSeries.length > 1;
  const clean = normalizedSeries[0]?.points ?? [];
  if (clean.length === 0 || normalizedSeries.length === 0) {
    return <div ref={wrapRef} className="line-area-chart-empty">暂无趋势数据</div>;
  }
  const seriesValueMaps = normalizedSeries.map((item) => ({
    ...item,
    valueMap: new Map(item.points.map((point) => [point.label, point.value])),
  }));
  const markerMap = new Map(
    (markers ?? [])
      .filter((marker) => marker.label)
      .map((marker) => [marker.label, marker] as const),
  );
  const allValues = seriesValueMaps.flatMap((item) => item.points.map((point) => point.value));

  const width = measuredWidth;
  const formattedValue = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const effectiveHeight = (() => {
    if (width > 560) return height;
    return Math.max(140, Math.round(height * 0.7));
  })();
  const compactYAxisLabel = (value: number) => {
    const raw = formattedValue(value);
    if (/\*/.test(raw)) return raw;
    if (/%/.test(raw)) return raw;
    const abs = Math.abs(value);
    // Monetary series are passed in cents; when >= 1,000,000 cents (10,000 yuan),
    // compact y-axis labels to "万" to save horizontal space for plotting area.
    if (abs < 1_000_000) return raw;
    const wan = value / 1_000_000;
    const absWan = Math.abs(wan);
    const digits = absWan >= 1000 ? 0 : absWan >= 100 ? 1 : 2;
    return `${wan.toFixed(digits)}万`;
  };

  const baseMargin = { top: 14, right: 12, bottom: 42 };
  const yTickCount = 4;
  const innerH = effectiveHeight - baseMargin.top - baseMargin.bottom;

  const minRaw = Math.min(...allValues);
  const maxRaw = Math.max(...allValues);
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
      label: compactYAxisLabel(value),
    };
  });

  const margin = {
    top: baseMargin.top,
    right: baseMargin.right,
    bottom: baseMargin.bottom,
    left: 10,
  };
  const innerW = Math.max(120, width - margin.left - margin.right);
  const stepX = clean.length > 1 ? innerW / (clean.length - 1) : 0;

  const toX = (idx: number) => margin.left + (clean.length > 1 ? idx * stepX : innerW / 2);
  const toY = (value: number) => margin.top + innerH - ((value - yMin) / ySpan) * innerH;

  const yTicks = yTickMeta.map((tick) => ({
    ...tick,
    y: margin.top + innerH * tick.ratio,
  }));
  const zeroY = yMin <= 0 && yMax >= 0 ? toY(0) : null;

  const buildSegmentPath = (coords: Array<{ x: number; y: number }>) => {
    if (coords.length === 0) return "";
    if (!smooth || coords.length <= 2) {
      return coords
        .map((coord, idx) => `${idx === 0 ? "M" : "L"} ${coord.x.toFixed(2)} ${coord.y.toFixed(2)}`)
        .join(" ");
    }
    const commands = [`M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`];
    const tensionDivisor = 8;
    for (let idx = 0; idx < coords.length - 1; idx += 1) {
      const prev = coords[idx - 1] ?? coords[idx];
      const current = coords[idx];
      const next = coords[idx + 1];
      const afterNext = coords[idx + 2] ?? next;
      const cp1x = current.x + (next.x - prev.x) / tensionDivisor;
      const cp1y = current.y + (next.y - prev.y) / tensionDivisor;
      const cp2x = next.x - (afterNext.x - current.x) / tensionDivisor;
      const cp2y = next.y - (afterNext.y - current.y) / tensionDivisor;
      commands.push(
        `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
      );
    }
    return commands.join(" ");
  };
  const buildSeriesPath = (valueMap: Map<string, number>) => {
    const segments: Array<Array<{ x: number; y: number }>> = [];
    let currentSegment: Array<{ x: number; y: number }> = [];
    clean.forEach((point, idx) => {
      const value = valueMap.get(point.label);
      if (typeof value !== "number" || !Number.isFinite(value)) {
        if (currentSegment.length > 0) segments.push(currentSegment);
        currentSegment = [];
        return;
      }
      currentSegment.push({ x: toX(idx), y: toY(value) });
    });
    if (currentSegment.length > 0) segments.push(currentSegment);
    return segments.map((segment) => buildSegmentPath(segment)).filter((path) => path).join(" ");
  };
  const primaryLinePath = buildSeriesPath(seriesValueMaps[0].valueMap);
  const areaPath = (() => {
    if (!primaryLinePath || clean.length === 0) return "";
    const baselineY = (margin.top + innerH).toFixed(2);
    const firstX = toX(0).toFixed(2);
    const lastX = toX(clean.length - 1).toFixed(2);
    return `${primaryLinePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
  })();

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
  const activePrimaryValue =
    hoverIndex != null && active
      ? seriesValueMaps[0].valueMap.get(active.label) ?? active.value
      : null;
  const activeY =
    hoverIndex != null && active && typeof activePrimaryValue === "number"
      ? toY(activePrimaryValue)
      : null;
  const tooltipAlignClass =
    activeX == null ? "line-area-tooltip-center" : activeX / width <= 0.22 ? "line-area-tooltip-left" : activeX / width >= 0.78 ? "line-area-tooltip-right" : "line-area-tooltip-center";
  const activeSeries = active
    ? seriesValueMaps
        .map((item) => {
          const value = item.valueMap.get(active.label);
          if (typeof value !== "number" || !Number.isFinite(value)) return null;
          return {
            id: item.id,
            label: item.label,
            color: item.color,
            dashed: item.dashed,
            value,
          };
        })
        .filter((item): item is { id: string; label: string; color: string; dashed: boolean; value: number } => item !== null)
    : [];
  const activeMarker = active ? markerMap.get(active.label) ?? null : null;
  const markerPoints = clean
    .map((point, idx) => {
      const marker = markerMap.get(point.label);
      if (!marker) return null;
      return {
        label: point.label,
        marker,
        x: toX(idx),
        y: toY(point.value),
        isActive: active?.label === point.label,
      };
    })
    .filter(
      (
        point,
      ): point is {
        label: string;
        marker: { label: string; color?: string; tooltipTitle?: string; tooltipLines?: string[] };
        x: number;
        y: number;
        isActive: boolean;
      } => point !== null,
    );

  return (
    <div ref={wrapRef} className="line-area-chart-wrap" style={{ height: `${effectiveHeight}px` }}>
      <svg
        className="line-area-chart"
        viewBox={`0 0 ${width} ${effectiveHeight}`}
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
            <text x={margin.left + 6} y={tick.y + 4} className="line-area-axis-label line-area-axis-label-y" textAnchor="start">
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
            <text x={tick.x} y={effectiveHeight - 14} className="line-area-axis-label line-area-axis-label-x" textAnchor="middle">
              {tick.label}
            </text>
          </g>
        ))}

        {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" /> : null}
        {showZeroLine && zeroY != null ? (
          <line
            x1={margin.left}
            x2={margin.left + innerW}
            y1={zeroY}
            y2={zeroY}
            className="line-area-zero-line"
          />
        ) : null}
        {seriesValueMaps.map((item, idx) => {
          const path = idx === 0 ? primaryLinePath : buildSeriesPath(item.valueMap);
          if (!path) return null;
          return (
            <path
              key={item.id}
              d={path}
              fill="none"
              stroke={item.color}
              strokeWidth={idx === 0 ? 1.5 : 1.2}
              strokeOpacity={idx === 0 ? 1 : 0.44}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={item.dashed ? "6 4" : undefined}
            />
          );
        })}
        {markerPoints.map((point) => (
          <g key={`marker-${point.label}`}>
            {point.isActive ? (
              <circle
                cx={point.x}
                cy={point.y}
                r={8}
                className="line-area-marker-ring"
                style={{ stroke: point.marker.color ?? "#dcb06a" }}
              />
            ) : null}
            <circle
              cx={point.x}
              cy={point.y}
              r={point.isActive ? 4.6 : 3.6}
              className="line-area-marker"
              style={{ fill: point.marker.color ?? "#dcb06a" }}
            />
          </g>
        ))}

        {active && activeX != null && activeY != null ? (
          <g>
            <line
              x1={activeX}
              x2={activeX}
              y1={margin.top}
              y2={margin.top + innerH}
              className="line-area-crosshair"
               style={{ stroke: seriesValueMaps[0].color, strokeOpacity: 0.36 }}
             />
             <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={activeY}
              y2={activeY}
              className="line-area-crosshair horizontal"
               style={{ stroke: seriesValueMaps[0].color, strokeOpacity: 0.22 }}
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
          className={`line-area-tooltip ${tooltipAlignClass}`}
          style={{
            left: `${Math.max(10, Math.min(90, (activeX / width) * 100))}%`,
            top: `${(activeY / effectiveHeight) * 100}%`,
          }}
        >
          <div className="line-area-tooltip-title">{xLabelFormatter ? xLabelFormatter(active.label) : active.label}</div>
          {isMultiSeries ? (
            <div className="line-area-tooltip-list">
              {activeSeries.map((item) => (
                <div key={item.id} className="line-area-tooltip-row">
                  <div className="line-area-tooltip-label">
                    <span
                      className={`line-area-tooltip-swatch${item.dashed ? " is-dashed" : ""}`}
                      style={item.dashed ? { borderTopColor: item.color } : { backgroundColor: item.color }}
                    />
                    <span className="line-area-tooltip-series-label">{item.label}</span>
                  </div>
                  <div className="line-area-tooltip-series-value">
                    {multiTooltipFormatter
                      ? multiTooltipFormatter({
                          label: active.label,
                          seriesLabel: item.label,
                          value: item.value,
                        })
                      : formattedValue(item.value)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="line-area-tooltip-value">
              {tooltipFormatter ? tooltipFormatter(active) : formattedValue(active.value)}
            </div>
          )}
          {activeMarker && ((activeMarker.tooltipTitle && activeMarker.tooltipTitle !== "") || activeMarker.tooltipLines?.length) ? (
            <div className="line-area-tooltip-extra">
              {activeMarker.tooltipTitle ? <div className="line-area-tooltip-extra-title">{activeMarker.tooltipTitle}</div> : null}
              {activeMarker.tooltipLines && activeMarker.tooltipLines.length > 0 ? (
                <div className="line-area-tooltip-extra-list">
                  {activeMarker.tooltipLines.map((line) => (
                    <div key={line} className="line-area-tooltip-extra-line">
                      {line}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {sourceLabel ? <div className="line-area-source-label">{sourceLabel}</div> : null}
    </div>
  );
}

export function AutoRefreshHint({ busy, children }: AutoRefreshHintProps) {
  void busy;
  void children;
  return null;
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
