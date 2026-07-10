import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { listen } from "@tauri-apps/api/event";
import {
  deleteAccountNote,
  listAnalysisExportLocalClis,
  queryAccountCatalog,
  queryAccountNotes,
  queryAnalysisExportSnapshot,
  runAnalysisExportLocalCli,
  runAnalysisExportOpenAiCompatible,
  upsertAccountNote,
  writeAnalysisExportFile,
  type AccountNote,
  type AnalysisExportLocalCli,
  type AnalysisExportSnapshotPayload,
  type AnalysisExportSnapshotRequest,
  type LoosePayload,
} from "../../lib/desktopApi";
import { useAsyncQuery } from "../../hooks/useAsyncQuery";
import { useDebouncedAutoRun } from "../../hooks/useDebouncedAutoRun";
import { readArray, readBool, readNumber, readString } from "../../utils/value";
import { AccountNotesEditor } from "./AccountNotesEditor";
import {
  buildAnalysisMarkdown,
  type AnalysisExportOptions,
  type AnalysisExportProfile,
} from "./buildMarkdown";
import { type AppSettings } from "../../types/app";

const EXPORT_PROFILE_STORAGE_KEY = "keepwise.desktop.export-profile.v1";
const EXPORT_LOCAL_ANALYSIS_STORAGE_KEY = "keepwise.desktop.export-local-analysis.v1";
const LEGACY_EXPORT_CODEX_ANALYSIS_STORAGE_KEY = "keepwise.desktop.export-codex-analysis.v1";
const ANALYSIS_AMOUNT_MASK_TOKEN = "KW_ANALYSIS_AMOUNT_MASK";

type AnalysisExportSectionProps = {
  isActive: boolean;
  currentYearText: string;
  defaultHideAmounts: boolean;
  fireWithdrawalRate: string;
  appSettings: AppSettings;
  allowLocalCli: boolean;
};

type StoredExportState = {
  profile?: Partial<AnalysisExportProfile>;
  options?: Partial<AnalysisExportOptions>;
  wealthCurvePreset?: string;
  noteVisibleKind?: string;
  selectedCliKey?: string;
};

type CodexProgressEvent = {
  run_id?: string;
  cli_key?: string;
  cli_label?: string;
  stage?: string;
  message?: string;
  elapsed_ms?: number;
  timeout_seconds?: number;
  stdout_tail?: string;
  stderr_tail?: string;
  stdout_bytes?: number;
  stderr_bytes?: number;
  timestamp?: string;
};

type StoredCodexAnalysis = {
  content: string;
  analyzedAt: string;
  markdownPath?: string;
  providerKind?: "api" | "local_cli";
  providerLabel?: string;
  endpoint?: string;
  model?: string;
  cliKey?: string;
  cliLabel?: string;
  cliPath?: string;
};

function defaultProfile(): AnalysisExportProfile {
  return {
    personaSummary: "",
    riskAppetite: "平衡",
    liquidityNeed: "",
    investmentGoals: "",
    analysisAsk: "请帮我分析现有资产配置是否过度集中、是否需要再平衡，以及 FIRE 进度是否合理。",
    currency: "CNY",
  };
}

function defaultOptions(defaultHideAmounts: boolean): AnalysisExportOptions {
  return {
    includeAmounts: !defaultHideAmounts,
    includeConsumptionDetail: false,
    includeEmployerNames: false,
    includeAccountIds: false,
    roundAmountsToWan: false,
    includeJsonAppendix: false,
  };
}

function parseStoredExportState(defaultHideAmounts: boolean): {
  profile: AnalysisExportProfile;
  options: AnalysisExportOptions;
  wealthCurvePreset: string;
  noteVisibleKind: string;
  selectedCliKey: string;
} {
  if (typeof window === "undefined") {
    return {
      profile: defaultProfile(),
      options: defaultOptions(defaultHideAmounts),
      wealthCurvePreset: "since_inception",
      noteVisibleKind: "investment",
      selectedCliKey: "",
    };
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(EXPORT_PROFILE_STORAGE_KEY) ?? "{}") as StoredExportState;
    return {
      profile: { ...defaultProfile(), ...(parsed.profile ?? {}) },
      options: { ...defaultOptions(defaultHideAmounts), ...(parsed.options ?? {}) },
      wealthCurvePreset: parsed.wealthCurvePreset ?? "since_inception",
      noteVisibleKind: parsed.noteVisibleKind ?? "investment",
      selectedCliKey: typeof parsed.selectedCliKey === "string" ? parsed.selectedCliKey : "",
    };
  } catch {
    return {
      profile: defaultProfile(),
      options: defaultOptions(defaultHideAmounts),
      wealthCurvePreset: "since_inception",
      noteVisibleKind: "investment",
      selectedCliKey: "",
    };
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds.toString().padStart(2, "0")}秒` : `${seconds}秒`;
}

function parseStoredCodexAnalysis(): StoredCodexAnalysis | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(EXPORT_LOCAL_ANALYSIS_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_EXPORT_CODEX_ANALYSIS_STORAGE_KEY) ??
      "null";
    const parsed = JSON.parse(raw) as Partial<StoredCodexAnalysis> | null;
    if (!parsed || typeof parsed.content !== "string" || !parsed.content.trim()) return null;
    return {
      content: parsed.content,
      analyzedAt: typeof parsed.analyzedAt === "string" ? parsed.analyzedAt : new Date().toISOString(),
      markdownPath: typeof parsed.markdownPath === "string" ? parsed.markdownPath : undefined,
      providerKind:
        parsed.providerKind === "api" || parsed.providerKind === "local_cli" ? parsed.providerKind : undefined,
      providerLabel: typeof parsed.providerLabel === "string" ? parsed.providerLabel : undefined,
      endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      cliKey: typeof parsed.cliKey === "string" ? parsed.cliKey : undefined,
      cliLabel: typeof parsed.cliLabel === "string" ? parsed.cliLabel : undefined,
      cliPath: typeof parsed.cliPath === "string" ? parsed.cliPath : undefined,
    };
  } catch {
    return null;
  }
}

function formatAnalysisDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseLocalCliRows(payload: unknown): AnalysisExportLocalCli[] {
  return readArray(payload, "rows")
    .map((row) => {
      const cliKey = readString(row, "cli_key");
      const label = readString(row, "label");
      const executable = readString(row, "executable");
      const path = readString(row, "path");
      if (!cliKey || !label || !executable || !path) return null;
      return {
        cli_key: cliKey,
        label,
        executable,
        path,
      };
    })
    .filter((row): row is AnalysisExportLocalCli => row !== null);
}

function maskAnalysisAmountText(content: string): string {
  const numberPattern = "[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
  const moneyLikeNumberPattern = "[+-]?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+\\.\\d{2})";
  const moneyUnitPattern = "(?:亿元|万元|元|CNY|RMB|人民币|万|亿)";
  return content
    .replace(
      new RegExp(`${numberPattern}\\s*(?:-|~|～|至|到)\\s*${numberPattern}\\s*${moneyUnitPattern}`, "gi"),
      ANALYSIS_AMOUNT_MASK_TOKEN,
    )
    .replace(new RegExp(`[<>]=?\\s*${numberPattern}\\s*${moneyUnitPattern}`, "gi"), ANALYSIS_AMOUNT_MASK_TOKEN)
    .replace(new RegExp(`[￥¥]\\s*${numberPattern}`, "g"), ANALYSIS_AMOUNT_MASK_TOKEN)
    .replace(new RegExp(`\\b(?:CNY|RMB)\\s*${numberPattern}`, "gi"), ANALYSIS_AMOUNT_MASK_TOKEN)
    .replace(new RegExp(`${numberPattern}\\s*${moneyUnitPattern}`, "gi"), ANALYSIS_AMOUNT_MASK_TOKEN)
    .replace(new RegExp(`(^|[|\\s:*（(])(${moneyLikeNumberPattern})(?=$|[|\\s,，。;；)）])`, "g"), `$1${ANALYSIS_AMOUNT_MASK_TOKEN}`);
}

function MarkdownReport({ content, hideAmounts = false }: { content: string; hideAmounts?: boolean }) {
  const displayContent = hideAmounts ? maskAnalysisAmountText(content) : content;
  const lines = displayContent.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;

  const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const splitTableRow = (line: string) => {
    const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = [];
    let current = "";
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (char === "\\" && trimmed[index + 1] === "|") {
        current += "|";
        index += 1;
        continue;
      }
      if (char === "|") {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };
  const renderInlineMarkdown = (text: string, keyPrefix: string): ReactNode[] => {
    const tokens = text.split(/(<br\s*\/?>|\n|`[^`]+`|\*\*[^*]+\*\*)/g);
    const rendered: ReactNode[] = [];
    let partIndex = 0;
    const renderTextWithAmountMasks = (value: string, prefix: string): ReactNode[] => {
      const parts = value.split(ANALYSIS_AMOUNT_MASK_TOKEN);
      if (parts.length === 1) return [value];
      return parts.flatMap((part, index) => {
        const next: ReactNode[] = [];
        if (part) next.push(part);
        if (index < parts.length - 1) next.push(<span className="analysis-export-amount-mask" key={`${prefix}-mask-${index}`}>****</span>);
        return next;
      });
    };
    for (const token of tokens) {
      if (!token) continue;
      if (token === "\n" || /^<br\s*\/?>$/.test(token)) {
        rendered.push(<br key={`${keyPrefix}-br-${partIndex}`} />);
        partIndex += 1;
        continue;
      }
      const strongMatch = /^\*\*([\s\S]+)\*\*$/.exec(token);
      if (strongMatch) {
        rendered.push(<strong key={`${keyPrefix}-strong-${partIndex}`}>{renderTextWithAmountMasks(strongMatch[1], `${keyPrefix}-strong-${partIndex}`)}</strong>);
        partIndex += 1;
        continue;
      }
      const codeMatch = /^`([\s\S]+)`$/.exec(token);
      if (codeMatch) {
        rendered.push(<code key={`${keyPrefix}-code-${partIndex}`}>{renderTextWithAmountMasks(codeMatch[1], `${keyPrefix}-code-${partIndex}`)}</code>);
        partIndex += 1;
        continue;
      }
      rendered.push(...renderTextWithAmountMasks(token, `${keyPrefix}-text-${partIndex}`));
      partIndex += 1;
    }
    return rendered;
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      if (level === 1) {
        nodes.push(<h3 key={`h-${i}`}>{renderInlineMarkdown(text, `h-${i}`)}</h3>);
      } else if (level === 2) {
        nodes.push(<h4 key={`h-${i}`}>{renderInlineMarkdown(text, `h-${i}`)}</h4>);
      } else {
        nodes.push(<h5 key={`h-${i}`}>{renderInlineMarkdown(text, `h-${i}`)}</h5>);
      }
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <pre className="analysis-export-markdown-codeblock" key={`codeblock-${i}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      nodes.push(<hr key={`hr-${i}`} />);
      i += 1;
      continue;
    }

    if (trimmed.startsWith("|") && isTableSeparator(lines[i + 1] ?? "")) {
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i] ?? ""));
        i += 1;
      }
      nodes.push(
        <div className="analysis-export-report-table-wrap" key={`table-${i}`}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, index) => (
                  <th key={`${index}-${cell}`}>{renderInlineMarkdown(cell, `th-${i}-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${cellIndex}-${cell}`}>{renderInlineMarkdown(cell, `td-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^[-*]\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ul key={`ul-${i}`}>
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{renderInlineMarkdown(item, `ul-${i}-${index}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trim())) {
        items.push((lines[i] ?? "").trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      nodes.push(
        <ol key={`ol-${i}`}>
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>{renderInlineMarkdown(item, `ol-${i}-${index}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quotes: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? "").trim())) {
        quotes.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i += 1;
      }
      nodes.push(<blockquote key={`quote-${i}`}>{renderInlineMarkdown(quotes.join("\n"), `quote-${i}`)}</blockquote>);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^(#{1,4})\s+/.test((lines[i] ?? "").trim()) &&
      !/^[-*]\s+/.test((lines[i] ?? "").trim()) &&
      !/^\d+\.\s+/.test((lines[i] ?? "").trim()) &&
      !/^>\s?/.test((lines[i] ?? "").trim()) &&
      !((lines[i] ?? "").trim().startsWith("|") && isTableSeparator(lines[i + 1] ?? ""))
    ) {
      para.push((lines[i] ?? "").trim());
        i += 1;
    }
    nodes.push(<p key={`p-${i}`}>{renderInlineMarkdown(para.join("\n"), `p-${i}`)}</p>);
  }

  return <div className="analysis-export-report-markdown">{nodes}</div>;
}

export function AnalysisExportSection({
  isActive,
  currentYearText,
  defaultHideAmounts,
  fireWithdrawalRate,
  appSettings,
  allowLocalCli,
}: AnalysisExportSectionProps) {
  const stored = useMemo(() => parseStoredExportState(defaultHideAmounts), [defaultHideAmounts]);
  const [profile, setProfile] = useState<AnalysisExportProfile>(stored.profile);
  const [options, setOptions] = useState<AnalysisExportOptions>(stored.options);
  const [year, setYear] = useState(currentYearText);
  const [wealthCurvePreset, setWealthCurvePreset] = useState(stored.wealthCurvePreset);
  const [noteVisibleKind, setNoteVisibleKind] = useState(stored.noteVisibleKind);
  const [selectedCliKey, setSelectedCliKey] = useState(stored.selectedCliKey);
  const [accountCatalog, setAccountCatalog] = useState<LoosePayload | null>(null);
  const [notesByAccountId, setNotesByAccountId] = useState<Record<string, AccountNote>>({});
  const [catalogError, setCatalogError] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [availableCliRows, setAvailableCliRows] = useState<AnalysisExportLocalCli[]>([]);
  const [cliScanBusy, setCliScanBusy] = useState(false);
  const [cliScanAttempted, setCliScanAttempted] = useState(false);
  const [cliScanError, setCliScanError] = useState("");
  const [pendingNoteIds, setPendingNoteIds] = useState<string[]>([]);
  const [noteSaveStatus, setNoteSaveStatus] = useState("");
  const [actionStatus, setActionStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexResult, setCodexResult] = useState<LoosePayload | null>(null);
  const [latestRunAnalyzedAt, setLatestRunAnalyzedAt] = useState("");
  const [runningAnalysisKind, setRunningAnalysisKind] = useState<"api" | "local_cli" | null>(null);
  const [codexProgress, setCodexProgress] = useState<CodexProgressEvent | null>(null);
  const [codexProgressLog, setCodexProgressLog] = useState<CodexProgressEvent[]>([]);
  const [storedCodexAnalysis, setStoredCodexAnalysis] = useState<StoredCodexAnalysis | null>(() => parseStoredCodexAnalysis());
  const [storedAnalysisExpanded, setStoredAnalysisExpanded] = useState(true);
  const codexRunIdRef = useRef("");
  const selectedCli = availableCliRows.find((item) => item.cli_key === selectedCliKey) ?? availableCliRows[0] ?? null;
  const localCliEnabled = allowLocalCli && appSettings.aiLocalCliEnabled;
  const apiEndpoint = appSettings.aiApiEndpoint.trim();
  const apiKey = appSettings.aiApiKey.trim();
  const apiModel = appSettings.aiModel.trim();
  const apiConfigured = Boolean(apiEndpoint && apiKey && apiModel);

  const loadAvailableCliRows = async () => {
    if (!localCliEnabled) return;
    setCliScanBusy(true);
    setCliScanError("");
    try {
      const payload = await listAnalysisExportLocalClis();
      const rows = parseLocalCliRows(payload);
      setAvailableCliRows(rows);
      setSelectedCliKey((prev) => (rows.some((item) => item.cli_key === prev) ? prev : (rows[0]?.cli_key ?? "")));
      if (rows.length === 0) {
        setCliScanError("未扫描到可用的本地 CLI。请安装并登录 Codex CLI、Copilot CLI 或 Claude CLI。");
      }
    } catch (err) {
      setCliScanError(`扫描本地 CLI 失败：${toErrorMessage(err)}`);
    } finally {
      setCliScanBusy(false);
      setCliScanAttempted(true);
    }
  };

  const snapshotQuery = useAsyncQuery<AnalysisExportSnapshotRequest, AnalysisExportSnapshotPayload>(
    queryAnalysisExportSnapshot,
    {
      year,
      wealth_curve_preset: wealthCurvePreset,
      include_consumption_detail: options.includeConsumptionDetail ? "true" : "false",
      fire_withdrawal_rate: fireWithdrawalRate,
    },
    toErrorMessage,
  );

  const markdown = useMemo(() => {
    if (!snapshotQuery.result) return "";
    return buildAnalysisMarkdown(snapshotQuery.result, profile, options);
  }, [snapshotQuery.result, profile, options]);

  useDebouncedAutoRun(
    async () => {
      if (!isActive || accountCatalog || catalogBusy) return;
      setCatalogBusy(true);
      setCatalogError("");
      try {
        const [catalog, notesPayload] = await Promise.all([
          queryAccountCatalog({ kind: "all", limit: 1000 }),
          queryAccountNotes({}),
        ]);
        const nextNotes: Record<string, AccountNote> = {};
        for (const item of readArray(notesPayload, "rows")) {
          const note = item as AccountNote;
          if (note.account_id) nextNotes[note.account_id] = note;
        }
        setAccountCatalog(catalog);
        setNotesByAccountId(nextNotes);
      } catch (err) {
        setCatalogError(toErrorMessage(err));
      } finally {
        setCatalogBusy(false);
      }
    },
    [isActive, accountCatalog, catalogBusy],
    { enabled: isActive, delayMs: 120 },
  );

  useDebouncedAutoRun(
    () => {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(
        EXPORT_PROFILE_STORAGE_KEY,
        JSON.stringify({ profile, options, wealthCurvePreset, noteVisibleKind, selectedCliKey }),
      );
    },
    [profile, options, wealthCurvePreset, noteVisibleKind, selectedCliKey],
    { enabled: true, delayMs: 300 },
  );

  useDebouncedAutoRun(
    async () => {
      if (!isActive || !localCliEnabled || cliScanBusy || cliScanAttempted) return;
      await loadAvailableCliRows();
    },
    [isActive, localCliEnabled, cliScanBusy, cliScanAttempted],
    { enabled: isActive && localCliEnabled && !cliScanAttempted, delayMs: 120 },
  );

  useEffect(() => {
    if (localCliEnabled) {
      setCliScanAttempted(false);
      return;
    }
    setAvailableCliRows([]);
    setCliScanBusy(false);
    setCliScanAttempted(false);
    setCliScanError("");
    setSelectedCliKey("");
  }, [localCliEnabled]);

  useDebouncedAutoRun(
    async () => {
      if (!isActive || pendingNoteIds.length === 0) return;
      const ids = [...pendingNoteIds];
      setNoteSaveStatus("备注保存中...");
      try {
        for (const accountId of ids) {
          const note = notesByAccountId[accountId];
          const holdingsText = `${note?.holdings_text ?? ""}`.trim();
          const riskNote = `${note?.risk_note ?? ""}`.trim();
          const noteText = `${note?.note_text ?? ""}`.trim();
          if (holdingsText || riskNote || noteText) {
            await upsertAccountNote({
              account_id: accountId,
              holdings_text: holdingsText,
              risk_note: riskNote,
              note_text: noteText,
            });
          } else {
            await deleteAccountNote({ account_id: accountId });
          }
        }
        setPendingNoteIds((prev) => prev.filter((id) => !ids.includes(id)));
        setNoteSaveStatus("备注已自动保存");
      } catch (err) {
        setNoteSaveStatus(`备注保存失败：${toErrorMessage(err)}`);
      }
    },
    [isActive, pendingNoteIds.join("|"), notesByAccountId],
    { enabled: isActive && pendingNoteIds.length > 0, delayMs: 800 },
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<LoosePayload>("analysis-export-cli-progress", (event) => {
      const payload = event.payload;
      const runId = readString(payload, "run_id") ?? "";
      if (!codexRunIdRef.current || runId !== codexRunIdRef.current) return;
      const progress: CodexProgressEvent = {
        run_id: runId,
        cli_key: readString(payload, "cli_key"),
        cli_label: readString(payload, "cli_label"),
        stage: readString(payload, "stage"),
        message: readString(payload, "message"),
        elapsed_ms: readNumber(payload, "elapsed_ms"),
        timeout_seconds: readNumber(payload, "timeout_seconds"),
        stdout_tail: readString(payload, "stdout_tail"),
        stderr_tail: readString(payload, "stderr_tail"),
        stdout_bytes: readNumber(payload, "stdout_bytes"),
        stderr_bytes: readNumber(payload, "stderr_bytes"),
        timestamp: readString(payload, "timestamp"),
      };
      setCodexProgress(progress);
      const isLowValueWaiting = progress.stage === "running" && progress.message === "Codex 正在分析，等待下一段输出";
      if (!isLowValueWaiting) {
        setCodexProgressLog((prev) => [...prev, progress].slice(-8));
      }
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  if (!isActive) return null;

  const updateProfile = (key: keyof AnalysisExportProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };
  const updateOption = (key: keyof AnalysisExportOptions, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };
  const updateNote = (accountId: string, field: "holdings_text" | "risk_note" | "note_text", value: string) => {
    setNotesByAccountId((prev) => ({
      ...prev,
      [accountId]: {
        account_id: accountId,
        holdings_text: prev[accountId]?.holdings_text ?? "",
        risk_note: prev[accountId]?.risk_note ?? "",
        note_text: prev[accountId]?.note_text ?? "",
        updated_at: prev[accountId]?.updated_at ?? "",
        [field]: value,
      },
    }));
    setPendingNoteIds((prev) => (prev.includes(accountId) ? prev : [...prev, accountId]));
  };

  const handleGenerate = async () => {
    setActionError("");
    setActionStatus("");
    await snapshotQuery.run({
      year,
      wealth_curve_preset: wealthCurvePreset,
      include_consumption_detail: options.includeConsumptionDetail ? "true" : "false",
      fire_withdrawal_rate: fireWithdrawalRate,
    });
  };

  const handleCopy = async () => {
    if (!markdown) return;
    setActionError("");
    try {
      await writeText(markdown);
      setActionStatus("已复制到剪贴板");
    } catch (err) {
      setActionError(`复制失败：${toErrorMessage(err)}`);
    }
  };

  const handleSave = async () => {
    if (!markdown) return;
    setActionError("");
    try {
      const path = await save({
        title: "保存 KeepWise 资产分析 Markdown",
        defaultPath: `keepwise-analysis-${year}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeAnalysisExportFile({ path, content: markdown });
      setActionStatus(`已保存：${path}`);
    } catch (err) {
      setActionError(`保存失败：${toErrorMessage(err)}`);
    }
  };

  const handleRunApiAnalysis = async () => {
    if (!markdown || codexBusy) return;
    if (!apiConfigured) {
      setActionError("请先在设置 > AI 中填写 API endpoint、API key 和模型名称。");
      return;
    }
    const runId = `openai-compatible-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    codexRunIdRef.current = runId;
    setActionError("");
    setActionStatus("");
    setCodexBusy(true);
    setRunningAnalysisKind("api");
    setCodexResult(null);
    setLatestRunAnalyzedAt("");
    setCodexProgress(null);
    setCodexProgressLog([]);
    try {
      const result = await runAnalysisExportOpenAiCompatible({
        endpoint: apiEndpoint,
        api_key: apiKey,
        model: apiModel,
        content: markdown,
        analysis_prompt: profile.analysisAsk,
        timeout_seconds: 180,
        run_id: runId,
      });
      setCodexResult(result);
      const analyzedAt = new Date().toISOString();
      setLatestRunAnalyzedAt(analyzedAt);
      const success = readBool(result, "success");
      const outputPath = readString(result, "markdown_path");
      const content = readString(result, "content") ?? "";
      if (success && content.trim()) {
        const nextAnalysis = {
          content,
          analyzedAt,
          markdownPath: outputPath,
          providerKind: "api" as const,
          providerLabel: readString(result, "provider_label") ?? "OpenAI 兼容 API",
          endpoint: readString(result, "endpoint") ?? apiEndpoint,
          model: readString(result, "model") ?? apiModel,
        };
        setStoredCodexAnalysis(nextAnalysis);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(EXPORT_LOCAL_ANALYSIS_STORAGE_KEY, JSON.stringify(nextAnalysis));
        }
      }
      setActionStatus(success ? `AI API 分析完成：${outputPath ?? ""}` : "AI API 分析未成功，请查看返回结果。");
    } catch (err) {
      setActionError(`AI API 分析失败：${toErrorMessage(err)}`);
    } finally {
      setCodexBusy(false);
      setRunningAnalysisKind(null);
    }
  };

  const handleRunLocalCliAnalysis = async () => {
    if (!markdown || codexBusy || !selectedCli || !localCliEnabled) return;
    const runId = `${selectedCli.cli_key}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    codexRunIdRef.current = runId;
    setActionError("");
    setActionStatus("");
    setCodexBusy(true);
    setRunningAnalysisKind("local_cli");
    setCodexResult(null);
    setLatestRunAnalyzedAt("");
    setCodexProgress({
      run_id: runId,
      cli_key: selectedCli.cli_key,
      cli_label: selectedCli.label,
      stage: "queued",
      message: `正在准备 ${selectedCli.label} 分析任务`,
      elapsed_ms: 0,
      timeout_seconds: 900,
    });
    setCodexProgressLog([]);
    try {
      const result = await runAnalysisExportLocalCli({
        cli_key: selectedCli.cli_key,
        content: markdown,
        analysis_prompt: profile.analysisAsk,
        timeout_seconds: 900,
        run_id: runId,
      });
      setCodexResult(result);
      const analyzedAt = new Date().toISOString();
      setLatestRunAnalyzedAt(analyzedAt);
      const success = readBool(result, "success");
      const outputPath = readString(result, "markdown_path");
      const stdout = readString(result, "stdout") ?? "";
      if (success && stdout.trim()) {
        const nextAnalysis = {
          content: stdout,
          analyzedAt,
          markdownPath: outputPath,
          providerKind: "local_cli" as const,
          providerLabel: readString(result, "provider_label") ?? selectedCli.label,
          cliKey: readString(result, "cli_key") ?? selectedCli.cli_key,
          cliLabel: readString(result, "cli_label") ?? selectedCli.label,
          cliPath: readString(result, "cli_path") ?? selectedCli.path,
        };
        setStoredCodexAnalysis(nextAnalysis);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(EXPORT_LOCAL_ANALYSIS_STORAGE_KEY, JSON.stringify(nextAnalysis));
        }
      }
      setActionStatus(success ? `${selectedCli.label} 分析完成：${outputPath ?? ""}` : `${selectedCli.label} 分析未成功，请查看输出。`);
    } catch (err) {
      setActionError(`${selectedCli.label} 分析失败：${toErrorMessage(err)}`);
    } finally {
      setCodexBusy(false);
      setRunningAnalysisKind(null);
      setCodexProgress(null);
      setCodexProgressLog([]);
    }
  };

  const codexStderr = readString(codexResult, "stderr") ?? "";
  const codexStdout = readString(codexResult, "stdout") ?? readString(codexResult, "content") ?? "";
  const codexSuccess = readBool(codexResult, "success");
  const codexElapsedMs = codexProgress?.elapsed_ms ?? 0;
  const codexTimeoutMs = (codexProgress?.timeout_seconds ?? 900) * 1000;
  const codexRemainingMs = Math.max(0, codexTimeoutMs - codexElapsedMs);
  const codexProgressPct = Math.max(4, Math.min(100, (codexElapsedMs / codexTimeoutMs) * 100));
  const codexLatestOutput = codexProgress?.stdout_tail || codexProgress?.stderr_tail || "";
  const storedAnalysisProviderLabel =
    storedCodexAnalysis?.providerLabel ?? storedCodexAnalysis?.cliLabel ?? "";
  const latestRunProviderLabel =
    readString(codexResult, "provider_label") ?? readString(codexResult, "cli_label") ?? "";
  const latestRunModel = readString(codexResult, "model") ?? "";
  const renderedAnalysisContent = codexStdout.trim();
  const shouldShowRunResult = Boolean(codexResult && (!storedCodexAnalysis || !codexSuccess));

  return (
    <>
      {storedCodexAnalysis ? (
        <details
          className="card panel analysis-export-codex-result analysis-export-latest-card"
          open={storedAnalysisExpanded}
          onToggle={(event) => setStoredAnalysisExpanded(event.currentTarget.open)}
        >
          <summary className="analysis-export-result-summary">
            <span>
              <strong>上一次智能分析</strong>
              <small>来自本机保存的最近一次分析结果。</small>
            </span>
            <span className="analysis-export-assist-indicator">{storedAnalysisExpanded ? "点击收起" : "点击展开"}</span>
          </summary>
          {storedAnalysisExpanded ? (
            <>
              <div className="analysis-export-codex-meta">
                {storedAnalysisProviderLabel ? <span>方式：{storedAnalysisProviderLabel}</span> : null}
                {storedCodexAnalysis.model ? <span>模型：{storedCodexAnalysis.model}</span> : null}
                <span>分析日期：{formatAnalysisDate(storedCodexAnalysis.analyzedAt)}</span>
              </div>
              <MarkdownReport content={storedCodexAnalysis.content} hideAmounts={defaultHideAmounts} />
            </>
          ) : null}
        </details>
      ) : null}

      <section className="card panel analysis-export-preview">
        <div className="panel-header analysis-export-preview-header">
          <div>
            <h2>智能分析预览</h2>
            <p>生成结果为只读渲染视图；请通过下方“辅助信息”和本页选项调整内容后重新生成，再调用 AI API 分析。桌面版也可在设置 &gt; AI 中手动开启本地 CLI 备用模式。</p>
          </div>
          <button type="button" className="primary-btn" onClick={() => void handleGenerate()} disabled={snapshotQuery.busy}>
            {snapshotQuery.busy ? "生成中..." : "生成预览"}
          </button>
        </div>
        {snapshotQuery.error ? <div className="inline-error" role="alert">{snapshotQuery.error}</div> : null}
        {localCliEnabled && cliScanError ? <div className="inline-error" role="alert">{cliScanError}</div> : null}
        {actionError ? <div className="inline-error" role="alert">{actionError}</div> : null}
        {actionStatus ? <div className="inline-success">{actionStatus}</div> : null}
        <div className="analysis-export-cli-meta">
          {apiConfigured ? (
            <>默认方式：OpenAI 兼容 API · {apiModel} · {apiEndpoint}</>
          ) : (
            <>默认方式：OpenAI 兼容 API。请先在设置 &gt; AI 中填写 API endpoint、API key 和模型名称。</>
          )}
        </div>
        {localCliEnabled ? (
          <>
            <div className="analysis-export-cli-toolbar">
              <label className="field">
                <span>本地 CLI</span>
                <select
                  value={selectedCli?.cli_key ?? ""}
                  onChange={(e) => setSelectedCliKey(e.target.value)}
                  disabled={cliScanBusy || availableCliRows.length === 0}
                >
                  {availableCliRows.length === 0 ? (
                    <option value="">未发现可用 CLI</option>
                  ) : (
                    availableCliRows.map((item) => (
                      <option key={item.cli_key} value={item.cli_key}>
                        {item.label}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <button type="button" className="secondary-btn" onClick={() => void loadAvailableCliRows()} disabled={cliScanBusy}>
                {cliScanBusy ? "扫描中..." : "重新扫描 CLI"}
              </button>
            </div>
            {selectedCli ? (
              <div className="analysis-export-cli-meta">
                本地备用：{selectedCli.label} · {selectedCli.path}
              </div>
            ) : null}
          </>
        ) : allowLocalCli ? (
          <div className="analysis-export-cli-meta">本地 CLI 备用模式默认关闭，可在设置 &gt; AI 中手动开启。</div>
        ) : null}
        <div className="analysis-export-markdown-preview" aria-label="Markdown 渲染预览">
          {markdown ? (
            <MarkdownReport content={markdown} hideAmounts={defaultHideAmounts} />
          ) : (
            <div className="analysis-export-empty-preview">点击“生成预览”后显示只读 Markdown 渲染结果。</div>
          )}
        </div>
        <div className="db-actions analysis-export-actions">
          <button type="button" className="secondary-btn" onClick={() => void handleCopy()} disabled={!markdown}>
            复制到剪贴板
          </button>
          <button type="button" className="secondary-btn" onClick={() => void handleSave()} disabled={!markdown}>
            保存为 .md
          </button>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void handleRunApiAnalysis()}
            disabled={!markdown || codexBusy || !apiConfigured}
          >
            {codexBusy && runningAnalysisKind === "api" ? "AI API 分析中..." : "用 AI API 分析"}
          </button>
          {localCliEnabled ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => void handleRunLocalCliAnalysis()}
              disabled={!markdown || codexBusy || !selectedCli}
            >
              {codexBusy && runningAnalysisKind === "local_cli"
                ? `${codexProgress?.cli_label ?? selectedCli?.label ?? "本地 CLI"} 分析中...`
                : `用 ${selectedCli?.label ?? "本地 CLI"} 本地分析`}
            </button>
          ) : null}
        </div>
        {codexBusy && runningAnalysisKind === "local_cli" && codexProgress ? (
          <div className="analysis-export-codex-status">
            <div className="analysis-export-codex-status-head">
              <div>
                <strong>{codexProgress?.message ?? `${codexProgress?.cli_label ?? "本地 CLI"} 正在分析`}</strong>
                <span>
                  已运行 {formatDuration(codexElapsedMs)}；最长剩余 {formatDuration(codexRemainingMs)}
                </span>
              </div>
              <span>{codexProgress?.stage ?? "running"}</span>
            </div>
            <div className="analysis-export-codex-progressbar" aria-hidden="true">
              <span style={{ width: `${codexProgressPct}%` }} />
            </div>
            <div className="analysis-export-codex-log">
              {codexProgressLog.length > 0 ? (
                codexProgressLog.map((item, index) => (
                  <div key={`${item.timestamp ?? index}-${item.stage ?? "stage"}`}>
                    <span>{formatDuration(item.elapsed_ms ?? 0)}</span>
                    <p>{item.message ?? item.stage ?? "Codex 正在运行"}</p>
                  </div>
                ))
              ) : (
                <div>
                  <span>0秒</span>
                  <p>等待 Codex 返回运行状态。</p>
                </div>
              )}
            </div>
            {codexLatestOutput ? (
              <pre className="analysis-export-codex-tail">{codexLatestOutput}</pre>
            ) : null}
          </div>
        ) : null}
        {shouldShowRunResult ? (
          <div className="analysis-export-codex-result">
            <div className="analysis-export-codex-meta">
              {latestRunProviderLabel ? <span>方式：{latestRunProviderLabel}</span> : null}
              {latestRunModel ? <span>模型：{latestRunModel}</span> : null}
              {latestRunAnalyzedAt ? <span>分析日期：{formatAnalysisDate(latestRunAnalyzedAt)}</span> : null}
            </div>
            {renderedAnalysisContent ? (
              <MarkdownReport content={renderedAnalysisContent} hideAmounts={defaultHideAmounts} />
            ) : (
              <div className="analysis-export-empty-preview">本次分析没有返回可展示的文本内容。</div>
            )}
            {codexStderr ? <pre className="analysis-export-codex-stderr">{codexStderr}</pre> : null}
          </div>
        ) : null}
      </section>

      <section className="card panel analysis-export-settings-card">
        <div className="panel-header">
          <h2>隐私与范围</h2>
          <p>这些选项会影响下一次生成的 Markdown 内容。</p>
        </div>
        <div className="query-form-grid query-form-grid-compact">
          <label className="field">
            <span>年份</span>
            <input value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label className="field">
            <span>财富曲线</span>
            <select value={wealthCurvePreset} onChange={(e) => setWealthCurvePreset(e.target.value)}>
              <option value="ytd">年初至今</option>
              <option value="3m">近三月</option>
              <option value="6m">近半年</option>
              <option value="1y">近1年</option>
              <option value="3y">近3年</option>
              <option value="since_inception">成立以来</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={options.includeAmounts} onChange={(e) => updateOption("includeAmounts", e.target.checked)} />
            <span>包含具体金额</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={options.roundAmountsToWan} onChange={(e) => updateOption("roundAmountsToWan", e.target.checked)} />
            <span>金额四舍五入到万元</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={options.includeConsumptionDetail} onChange={(e) => updateOption("includeConsumptionDetail", e.target.checked)} />
            <span>包含消费明细</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={options.includeEmployerNames} onChange={(e) => updateOption("includeEmployerNames", e.target.checked)} />
            <span>包含工资雇主名称</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={options.includeAccountIds} onChange={(e) => updateOption("includeAccountIds", e.target.checked)} />
            <span>包含账户 ID</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={options.includeJsonAppendix} onChange={(e) => updateOption("includeJsonAppendix", e.target.checked)} />
            <span>输出 JSON 附录</span>
          </label>
        </div>
      </section>

      <details className="card panel analysis-export-assist-card">
        <summary className="analysis-export-assist-summary">
          <span>
            <strong>辅助信息</strong>
            <small>补充用户画像、账户持仓、风险备注和分析诉求</small>
          </span>
          <span className="analysis-export-assist-indicator">点击展开 / 收起</span>
        </summary>
        <div className="analysis-export-assist-body stack">
          <div className="panel-header">
            <h2>用户画像</h2>
            <p>这些内容只写入导出的 Markdown，用来补足账户持仓和分析目标。</p>
          </div>
          <div className="query-form-grid query-form-grid-compact analysis-export-profile-grid">
            <label className="field analysis-export-wide-field">
              <span>用户画像</span>
              <textarea
                value={profile.personaSummary}
                onChange={(e) => updateProfile("personaSummary", e.target.value)}
                placeholder="如：30 岁，一线城市，计划 2040 退休，可承受 30% 回撤"
              />
            </label>
            <label className="field">
              <span>风险偏好</span>
              <select value={profile.riskAppetite} onChange={(e) => updateProfile("riskAppetite", e.target.value)}>
                <option value="保守">保守</option>
                <option value="平衡">平衡</option>
                <option value="进取">进取</option>
              </select>
            </label>
            <label className="field">
              <span>货币单位</span>
              <input value={profile.currency} onChange={(e) => updateProfile("currency", e.target.value)} />
            </label>
            <label className="field analysis-export-wide-field">
              <span>短期流动性需求</span>
              <textarea value={profile.liquidityNeed} onChange={(e) => updateProfile("liquidityNeed", e.target.value)} />
            </label>
            <label className="field analysis-export-wide-field">
              <span>长期目标</span>
              <textarea value={profile.investmentGoals} onChange={(e) => updateProfile("investmentGoals", e.target.value)} />
            </label>
            <label className="field analysis-export-wide-field">
              <span>希望分析师关注</span>
              <textarea value={profile.analysisAsk} onChange={(e) => updateProfile("analysisAsk", e.target.value)} />
            </label>
          </div>
          <div className="panel-header">
            <h2>账户备注</h2>
            <p>{catalogBusy ? "账户加载中..." : noteSaveStatus || "备注会在停止输入后自动保存。"}</p>
          </div>
          {catalogError ? <div className="inline-error" role="alert">{catalogError}</div> : null}
          <AccountNotesEditor
            accountCatalog={accountCatalog}
            notesByAccountId={notesByAccountId}
            visibleKind={noteVisibleKind}
            onVisibleKindChange={setNoteVisibleKind}
            onNoteChange={updateNote}
          />
        </div>
      </details>
    </>
  );
}
