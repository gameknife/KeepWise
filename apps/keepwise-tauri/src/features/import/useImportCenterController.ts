import { startTransition, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  cmbBankPdfImport,
  cmbBankPdfPreview,
  cmbEmlImport,
  cmbEmlPreview,
  queryImportJobs,
  yzxyImportFile,
  yzxyPreviewFile,
  type CmbBankPdfImportPayload,
  type CmbBankPdfPreviewPayload,
  type CmbEmlImportPayload,
  type CmbEmlPreviewPayload,
  type ImportJobsPayload,
  type YzxyImportPayload,
  type YzxyPreviewPayload,
} from "../../api/desktop";
export type ImportSource = "yzxy" | "cmb-eml" | "cmb-pdf";

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

export function useImportCenterController({
  active,
  invalidationEpoch,
  onImported,
}: {
  active: boolean;
  invalidationEpoch: number;
  onImported: (source: ImportSource) => void;
}) {
  const [importJobsBusy, setImportJobsBusy] = useState(false);
  const [importJobsError, setImportJobsError] = useState("");
  const [importJobsResult, setImportJobsResult] = useState<ImportJobsPayload | null>(null);
  const [importJobsLastRunAt, setImportJobsLastRunAt] = useState<number | null>(null);
  const [yzxyFilePath, setYzxyFilePath] = useState("");
  const [yzxyPreviewBusy, setYzxyPreviewBusy] = useState(false);
  const [yzxyPreviewError, setYzxyPreviewError] = useState("");
  const [yzxyPreviewResult, setYzxyPreviewResult] = useState<YzxyPreviewPayload | null>(null);
  const [yzxyImportBusy, setYzxyImportBusy] = useState(false);
  const [yzxyImportError, setYzxyImportError] = useState("");
  const [yzxyImportResult, setYzxyImportResult] = useState<YzxyImportPayload | null>(null);
  const [emlSourcePath, setEmlSourcePath] = useState("");
  const [emlPreviewBusy, setEmlPreviewBusy] = useState(false);
  const [emlPreviewError, setEmlPreviewError] = useState("");
  const [emlPreviewResult, setEmlPreviewResult] = useState<CmbEmlPreviewPayload | null>(null);
  const [emlImportBusy, setEmlImportBusy] = useState(false);
  const [emlImportError, setEmlImportError] = useState("");
  const [emlImportResult, setEmlImportResult] = useState<CmbEmlImportPayload | null>(null);
  const [cmbPdfPath, setCmbPdfPath] = useState("");
  const [cmbPdfPreviewBusy, setCmbPdfPreviewBusy] = useState(false);
  const [cmbPdfPreviewError, setCmbPdfPreviewError] = useState("");
  const [cmbPdfPreviewResult, setCmbPdfPreviewResult] = useState<CmbBankPdfPreviewPayload | null>(null);
  const [cmbPdfImportBusy, setCmbPdfImportBusy] = useState(false);
  const [cmbPdfImportError, setCmbPdfImportError] = useState("");
  const [cmbPdfImportResult, setCmbPdfImportResult] = useState<CmbBankPdfImportPayload | null>(null);

  async function handleImportJobsQuery() {
    setImportJobsBusy(true);
    setImportJobsError("");
    try {
      const payload = await queryImportJobs({ limit: 12 });
      startTransition(() => {
        setImportJobsResult(payload);
        setImportJobsLastRunAt(Date.now());
      });
    } catch (err) {
      setImportJobsError(toErrorMessage(err));
    } finally {
      setImportJobsBusy(false);
    }
  }

  useEffect(() => {
    if (!active && invalidationEpoch === 0) return;
    const timer = window.setTimeout(() => void handleImportJobsQuery(), 220);
    return () => window.clearTimeout(timer);
  }, [active, invalidationEpoch]);

  useEffect(() => {
    startTransition(() => {
      setYzxyPreviewError("");
      setYzxyImportError("");
      setYzxyPreviewResult(null);
      setYzxyImportResult(null);
    });
  }, [yzxyFilePath]);

  useEffect(() => {
    startTransition(() => {
      setEmlPreviewError("");
      setEmlImportError("");
      setEmlPreviewResult(null);
      setEmlImportResult(null);
    });
  }, [emlSourcePath]);

  useEffect(() => {
    startTransition(() => {
      setCmbPdfPreviewError("");
      setCmbPdfImportError("");
      setCmbPdfPreviewResult(null);
      setCmbPdfImportResult(null);
    });
  }, [cmbPdfPath]);

  async function handlePickYzxyFilePath() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择有知有行导出文件（CSV / XLSX）",
        filters: [
          { name: "YZXY Export", extensions: ["xlsx", "csv"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (typeof selected === "string" && selected.trim()) setYzxyFilePath(selected);
    } catch (err) {
      setYzxyPreviewError(toErrorMessage(err));
    }
  }

  async function handleYzxyRunImportFlow() {
    const sourcePath = yzxyFilePath.trim();
    if (!sourcePath) {
      setYzxyPreviewError("请先选择有知有行导出文件（.csv / .xlsx）");
      return;
    }
    setYzxyPreviewBusy(true);
    setYzxyPreviewError("");
    setYzxyImportError("");
    setYzxyPreviewResult(null);
    setYzxyImportResult(null);
    try {
      const preview = await yzxyPreviewFile({ source_path: sourcePath });
      startTransition(() => setYzxyPreviewResult(preview));
    } catch (err) {
      setYzxyPreviewError(toErrorMessage(err));
      return;
    } finally {
      setYzxyPreviewBusy(false);
    }
    setYzxyImportBusy(true);
    try {
      const result = await yzxyImportFile({ source_path: sourcePath, source_type: "yzxy_xlsx" });
      startTransition(() => setYzxyImportResult(result));
      onImported("yzxy");
      void handleImportJobsQuery();
    } catch (err) {
      setYzxyImportError(toErrorMessage(err));
    } finally {
      setYzxyImportBusy(false);
    }
  }

  async function pickEml(directory: boolean) {
    try {
      const selected = await open({
        multiple: false,
        directory,
        title: directory ? "选择包含招行 EML 账单的目录（递归扫描）" : "选择招行 EML 账单文件",
        ...(directory ? {} : { filters: [{ name: "EML", extensions: ["eml"] }, { name: "All Files", extensions: ["*"] }] }),
      });
      if (typeof selected === "string" && selected.trim()) setEmlSourcePath(selected);
    } catch (err) {
      setEmlPreviewError(toErrorMessage(err));
    }
  }

  async function handleCmbEmlRunImportFlow() {
    const sourcePath = emlSourcePath.trim();
    if (!sourcePath) {
      setEmlPreviewError("请先选择 EML 文件或目录");
      return;
    }
    setEmlPreviewBusy(true);
    setEmlPreviewError("");
    setEmlImportError("");
    setEmlPreviewResult(null);
    setEmlImportResult(null);
    try {
      const preview = await cmbEmlPreview({ source_path: sourcePath, review_threshold: 0.7 });
      startTransition(() => setEmlPreviewResult(preview));
    } catch (err) {
      setEmlPreviewError(toErrorMessage(err));
      return;
    } finally {
      setEmlPreviewBusy(false);
    }
    setEmlImportBusy(true);
    try {
      const result = await cmbEmlImport({ source_path: sourcePath, source_type: "cmb_eml", review_threshold: 0.7 });
      startTransition(() => setEmlImportResult(result));
      onImported("cmb-eml");
      void handleImportJobsQuery();
    } catch (err) {
      setEmlImportError(toErrorMessage(err));
    } finally {
      setEmlImportBusy(false);
    }
  }

  async function handlePickCmbPdfFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "选择招行银行流水 PDF 文件",
        filters: [{ name: "PDF", extensions: ["pdf"] }, { name: "All Files", extensions: ["*"] }],
      });
      if (typeof selected === "string" && selected.trim()) setCmbPdfPath(selected);
    } catch (err) {
      setCmbPdfPreviewError(toErrorMessage(err));
    }
  }

  async function handleCmbBankPdfRunImportFlow() {
    const sourcePath = cmbPdfPath.trim();
    if (!sourcePath) {
      setCmbPdfPreviewError("请先选择银行流水 PDF 文件");
      return;
    }
    setCmbPdfPreviewBusy(true);
    setCmbPdfPreviewError("");
    setCmbPdfImportError("");
    setCmbPdfPreviewResult(null);
    setCmbPdfImportResult(null);
    try {
      const preview = await cmbBankPdfPreview({ source_path: sourcePath, review_threshold: 0.7 });
      startTransition(() => setCmbPdfPreviewResult(preview));
    } catch (err) {
      setCmbPdfPreviewError(toErrorMessage(err));
      return;
    } finally {
      setCmbPdfPreviewBusy(false);
    }
    setCmbPdfImportBusy(true);
    try {
      const result = await cmbBankPdfImport({ source_path: sourcePath, source_type: "cmb_bank_pdf", review_threshold: 0.7 });
      startTransition(() => setCmbPdfImportResult(result));
      onImported("cmb-pdf");
      void handleImportJobsQuery();
    } catch (err) {
      setCmbPdfImportError(toErrorMessage(err));
    } finally {
      setCmbPdfImportBusy(false);
    }
  }

  return {
    importJobsBusy, importJobsError, importJobsResult, importJobsLastRunAt, handleImportJobsQuery,
    yzxyFilePath, setYzxyFilePath, yzxyPreviewBusy, yzxyPreviewError, yzxyPreviewResult,
    yzxyImportBusy, yzxyImportError, yzxyImportResult, handlePickYzxyFilePath, handleYzxyRunImportFlow,
    emlSourcePath, setEmlSourcePath, emlPreviewBusy, emlPreviewError, emlPreviewResult,
    emlImportBusy, emlImportError, emlImportResult, handlePickEmlFile: () => pickEml(false),
    handlePickEmlFolder: () => pickEml(true), handleCmbEmlRunImportFlow,
    cmbPdfPath, setCmbPdfPath, cmbPdfPreviewBusy, cmbPdfPreviewError, cmbPdfPreviewResult,
    cmbPdfImportBusy, cmbPdfImportError, cmbPdfImportResult, handlePickCmbPdfFile, handleCmbBankPdfRunImportFlow,
  };
}
