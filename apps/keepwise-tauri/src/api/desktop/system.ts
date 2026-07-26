import { invoke } from "./invoke";

export type HealthPing = {
  status: "ok";
  unix_ts: number;
  mode: "desktop";
};

export type AppMetadata = {
  app_name: string;
  app_version: string;
  app_identifier: string | null;
  target_os: string;
  target_arch: string;
  debug: boolean;
  tauri_major: number;
};

export type PathProbe = {
  path: string | null;
  error: string | null;
};

export type AppPaths = {
  app_data_dir: PathProbe;
  app_config_dir: PathProbe;
  app_cache_dir: PathProbe;
  app_log_dir: PathProbe;
  app_local_data_dir: PathProbe;
};

export type BootstrapProbe = {
  health: HealthPing;
  metadata: AppMetadata;
  paths: AppPaths;
};

export type LedgerDbStatus = {
  db_path: string;
  exists: boolean;
  migration_files: string[];
  applied_versions: string[];
  pending_versions: string[];
  schema_migrations_table_exists: boolean;
  ready: boolean;
};

export type LedgerDbMigrateResult = {
  db_path: string;
  created: boolean;
  applied_now: string[];
  skipped: string[];
  applied_total: number;
  pending_total: number;
};

export type LedgerDbImportRepoRuntimeResult = {
  source_db_path: string;
  target_db_path: string;
  replaced_existing: boolean;
  copied_bytes: number;
  migrate_result: LedgerDbMigrateResult;
};

export type LedgerAdminDbTableCountRow = {
  table: string;
  row_count: number;
};

export type LedgerAdminDbStats = {
  db_path: string;
  confirm_phrase: string;
  summary: {
    table_count: number;
    total_rows: number;
  };
  rows: LedgerAdminDbTableCountRow[];
};

export type LedgerAdminResetRequest = {
  confirm_text?: string;
};

export type LedgerAdminResetSummary = {
  table_count: number;
  total_rows_before: number;
  total_rows_after: number;
  deleted_rows: number;
};

export type LedgerAdminResetAllResult = {
  db_path: string;
  confirm_phrase: string;
  summary: LedgerAdminResetSummary;
  before_rows: LedgerAdminDbTableCountRow[];
  after_rows: LedgerAdminDbTableCountRow[];
};

export type LedgerAdminResetTransactionsResult = {
  db_path: string;
  confirm_phrase: string;
  scopes: string[];
  summary: {
    scope_count: number;
    total_rows_before: number;
    total_rows_after: number;
    deleted_rows: number;
  };
  before_rows: LedgerAdminDbTableCountRow[];
  after_rows: LedgerAdminDbTableCountRow[];
};

export type RuntimeDbHealthCheckPayload = {
  ok: boolean;
  checked_at: string;
  failures: string[];
  warnings: string[];
  checks: Record<string, unknown>;
};

export async function loadBootstrapProbe(): Promise<BootstrapProbe> {
  const [health, metadata, paths] = await Promise.all([
    invoke<HealthPing>("health_ping"),
    invoke<AppMetadata>("app_metadata"),
    invoke<AppPaths>("app_paths"),
  ]);
  return { health, metadata, paths };
}

export async function loadLedgerDbStatus(): Promise<LedgerDbStatus> {
  return invoke<LedgerDbStatus>("ledger_db_status");
}

export async function runLedgerDbMigrate(): Promise<LedgerDbMigrateResult> {
  return invoke<LedgerDbMigrateResult>("ledger_db_migrate");
}

export async function importLedgerDbFromPath(source_path: string): Promise<LedgerDbImportRepoRuntimeResult> {
  return invoke<LedgerDbImportRepoRuntimeResult>("ledger_db_import_from_path", {
    sourcePath: source_path,
    source_path,
  });
}

export async function loadLedgerDbAdminStats(): Promise<LedgerAdminDbStats> {
  return invoke<LedgerAdminDbStats>("ledger_db_admin_stats");
}

export async function runLedgerDbAdminResetAll(
  req: LedgerAdminResetRequest,
): Promise<LedgerAdminResetAllResult> {
  return invoke<LedgerAdminResetAllResult>("ledger_db_admin_reset_all", { req });
}

export async function runLedgerDbAdminResetTransactions(
  req: LedgerAdminResetRequest,
): Promise<LedgerAdminResetTransactionsResult> {
  return invoke<LedgerAdminResetTransactionsResult>("ledger_db_admin_reset_transactions", { req });
}

export async function runRuntimeDbHealthCheck(): Promise<RuntimeDbHealthCheckPayload> {
  return invoke<RuntimeDbHealthCheckPayload>("runtime_db_health_check");
}
