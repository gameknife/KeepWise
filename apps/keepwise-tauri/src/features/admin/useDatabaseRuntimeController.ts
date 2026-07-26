import { startTransition, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  importLedgerDbFromPath,
  loadBootstrapProbe,
  loadLedgerDbAdminStats,
  loadLedgerDbStatus,
  runLedgerDbAdminResetAll,
  runLedgerDbAdminResetTransactions,
  runLedgerDbMigrate,
  runRuntimeDbHealthCheck,
  type BootstrapProbe,
  type LedgerAdminDbStats,
  type LedgerAdminResetAllResult,
  type LedgerAdminResetTransactionsResult,
  type LedgerDbImportRepoRuntimeResult,
  type LedgerDbMigrateResult,
  type LedgerDbStatus,
  type RuntimeDbHealthCheckPayload,
} from "../../api/desktop";
import { buildAdminResetRequest, toErrorMessage } from "../../app/requestBuilders";
import { type LoadStatus } from "../../types/app";

export function useDatabaseRuntimeController({
  onTransactionsReset,
  onAllReset,
}: {
  onTransactionsReset: () => void;
  onAllReset: () => void;
}) {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [probe, setProbe] = useState<BootstrapProbe | null>(null);
  const [error, setError] = useState("");
  const [dbStatus, setDbStatus] = useState<LedgerDbStatus | null>(null);
  const [dbStatusError, setDbStatusError] = useState("");
  const [dbBusy, setDbBusy] = useState(false);
  const [dbImportPath, setDbImportPath] = useState("");
  const [dbLastResult, setDbLastResult] = useState<LedgerDbMigrateResult | null>(null);
  const [dbImportLastResult, setDbImportLastResult] = useState<LedgerDbImportRepoRuntimeResult | null>(null);
  const [adminStatsBusy, setAdminStatsBusy] = useState(false);
  const [adminStatsError, setAdminStatsError] = useState("");
  const [adminStatsResult, setAdminStatsResult] = useState<LedgerAdminDbStats | null>(null);
  const [adminStatsLastRunAt, setAdminStatsLastRunAt] = useState<number | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetTransactionsBusy, setResetTransactionsBusy] = useState(false);
  const [resetTransactionsError, setResetTransactionsError] = useState("");
  const [resetTransactionsResult, setResetTransactionsResult] = useState<LedgerAdminResetTransactionsResult | null>(null);
  const [resetAllBusy, setResetAllBusy] = useState(false);
  const [resetAllError, setResetAllError] = useState("");
  const [resetAllResult, setResetAllResult] = useState<LedgerAdminResetAllResult | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [healthResult, setHealthResult] = useState<RuntimeDbHealthCheckPayload | null>(null);
  const [healthLastRunAt, setHealthLastRunAt] = useState<number | null>(null);

  async function refreshProbe() {
    setStatus("loading"); setError("");
    try {
      const payload = await loadBootstrapProbe();
      startTransition(() => { setProbe(payload); setStatus("ready"); });
    } catch (err) { setError(toErrorMessage(err)); setStatus("error"); }
  }

  async function refreshStatus() {
    setDbStatusError("");
    try { const payload = await loadLedgerDbStatus(); startTransition(() => setDbStatus(payload)); }
    catch (err) { setDbStatusError(toErrorMessage(err)); }
  }

  async function refreshAdminStats() {
    setAdminStatsBusy(true); setAdminStatsError("");
    try {
      const payload = await loadLedgerDbAdminStats();
      startTransition(() => { setAdminStatsResult(payload); setAdminStatsLastRunAt(Date.now()); });
    } catch (err) { setAdminStatsError(toErrorMessage(err)); }
    finally { setAdminStatsBusy(false); }
  }

  async function refreshHealth() {
    setHealthBusy(true); setHealthError("");
    try {
      const payload = await runRuntimeDbHealthCheck();
      startTransition(() => { setHealthResult(payload); setHealthLastRunAt(Date.now()); });
    } catch (err) { setHealthError(toErrorMessage(err)); }
    finally { setHealthBusy(false); }
  }

  async function resetTransactions() {
    setResetTransactionsBusy(true); setResetTransactionsError("");
    try {
      const payload = await runLedgerDbAdminResetTransactions(buildAdminResetRequest(resetConfirmText));
      startTransition(() => setResetTransactionsResult(payload));
      void refreshAdminStats(); void refreshHealth(); onTransactionsReset();
    } catch (err) { setResetTransactionsError(toErrorMessage(err)); }
    finally { setResetTransactionsBusy(false); }
  }

  async function resetAll() {
    setResetAllBusy(true); setResetAllError("");
    try {
      const payload = await runLedgerDbAdminResetAll(buildAdminResetRequest(resetConfirmText));
      startTransition(() => setResetAllResult(payload));
      void refreshAdminStats(); void refreshHealth(); onAllReset();
    } catch (err) { setResetAllError(toErrorMessage(err)); }
    finally { setResetAllBusy(false); }
  }

  async function migrate() {
    setDbBusy(true); setDbStatusError("");
    try {
      const payload = await runLedgerDbMigrate(); startTransition(() => setDbLastResult(payload));
      await refreshStatus(); await refreshProbe(); void refreshAdminStats(); void refreshHealth();
    } catch (err) { setDbStatusError(toErrorMessage(err)); }
    finally { setDbBusy(false); }
  }

  async function importSequence(): Promise<LedgerDbImportRepoRuntimeResult> {
    setDbBusy(true); setDbStatusError("");
    try {
      const payload = await importLedgerDbFromPath(dbImportPath.trim());
      startTransition(() => setDbImportLastResult(payload));
      await refreshStatus(); await refreshProbe(); void refreshAdminStats(); void refreshHealth();
      return payload;
    } catch (err) { setDbStatusError(toErrorMessage(err)); throw err; }
    finally { setDbBusy(false); }
  }

  async function importFromPath() { try { await importSequence(); } catch { /* Visible state owns the error. */ } }

  async function pickImportPath() {
    try {
      const selected = await open({
        multiple: false, directory: false, title: "选择 KeepWise SQLite 数据库",
        filters: [{ name: "SQLite DB", extensions: ["db", "sqlite", "sqlite3"] }, { name: "All Files", extensions: ["*"] }],
      });
      if (typeof selected === "string" && selected.trim()) setDbImportPath(selected);
    } catch (err) { setDbStatusError(toErrorMessage(err)); }
  }

  useEffect(() => { void Promise.all([refreshProbe(), refreshStatus()]); }, []);

  return {
    status, probe, error, dbStatus, dbStatusError, dbBusy, dbImportPath, setDbImportPath,
    dbLastResult, dbImportLastResult, refreshProbe, refreshStatus, migrate, importSequence, importFromPath, pickImportPath,
    adminStatsBusy, adminStatsError, adminStatsResult, adminStatsLastRunAt, refreshAdminStats,
    resetConfirmText, setResetConfirmText, resetTransactionsBusy, resetTransactionsError, resetTransactionsResult, resetTransactions,
    resetAllBusy, resetAllError, resetAllResult, resetAll,
    healthBusy, healthError, healthResult, healthLastRunAt, refreshHealth,
  };
}
