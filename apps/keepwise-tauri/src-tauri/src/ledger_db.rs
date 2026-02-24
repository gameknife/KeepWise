use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const DEFAULT_LEDGER_DB_RELATIVE_PATH: &str = "ledger/keepwise.db";
const DEFAULT_REPO_RUNTIME_DB_RELATIVE_PATH: &str = "data/work/processed/ledger/keepwise.db";
const ADMIN_RESET_CONFIRM_PHRASE: &str = "RESET KEEPWISE";
const TRANSACTION_IMPORT_SOURCE_TYPES: &[&str] = &["cmb_eml", "cmb_bank_pdf"];
const ADMIN_TRANSACTION_RESET_SCOPES: &[&str] = &[
    "transactions",
    "reconciliations",
    "import_jobs:transaction_sources",
];
const ADMIN_DATA_TABLES: &[&str] = &[
    "transactions",
    "reconciliations",
    "investment_records",
    "account_valuations",
    "monthly_budget_items",
    "assets",
    "budgets",
    "ai_suggestions",
    "import_jobs",
    "categories",
    "accounts",
];

const MIGRATIONS: &[(&str, &str)] = &[
    (
        "0001_init.sql",
        include_str!("../../../../db/migrations/0001_init.sql"),
    ),
    (
        "0002_m0_investment_import_support.sql",
        include_str!("../../../../db/migrations/0002_m0_investment_import_support.sql"),
    ),
    (
        "0003_simplify_investment_records.sql",
        include_str!("../../../../db/migrations/0003_simplify_investment_records.sql"),
    ),
    (
        "0004_add_account_valuations.sql",
        include_str!("../../../../db/migrations/0004_add_account_valuations.sql"),
    ),
    (
        "0005_account_valuations_add_liability.sql",
        include_str!("../../../../db/migrations/0005_account_valuations_add_liability.sql"),
    ),
    (
        "0006_add_monthly_budget_items.sql",
        include_str!("../../../../db/migrations/0006_add_monthly_budget_items.sql"),
    ),
];

#[derive(Debug, Serialize)]
pub struct LedgerDbStatus {
    pub db_path: String,
    pub exists: bool,
    pub migration_files: Vec<String>,
    pub applied_versions: Vec<String>,
    pub pending_versions: Vec<String>,
    pub schema_migrations_table_exists: bool,
    pub ready: bool,
}

#[derive(Debug, Serialize)]
pub struct LedgerDbMigrateResult {
    pub db_path: String,
    pub created: bool,
    pub applied_now: Vec<String>,
    pub skipped: Vec<String>,
    pub applied_total: usize,
    pub pending_total: usize,
}

#[derive(Debug, Serialize)]
pub struct LedgerDbImportRepoRuntimeResult {
    pub source_db_path: String,
    pub target_db_path: String,
    pub replaced_existing: bool,
    pub copied_bytes: u64,
    pub migrate_result: LedgerDbMigrateResult,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminDbStatsSummary {
    pub table_count: usize,
    pub total_rows: i64,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminDbTableCountRow {
    pub table: String,
    pub row_count: i64,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminDbStatsResult {
    pub db_path: String,
    pub confirm_phrase: String,
    pub summary: LedgerAdminDbStatsSummary,
    pub rows: Vec<LedgerAdminDbTableCountRow>,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminResetSummary {
    pub table_count: usize,
    pub total_rows_before: i64,
    pub total_rows_after: i64,
    pub deleted_rows: i64,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminResetResult {
    pub db_path: String,
    pub confirm_phrase: String,
    pub summary: LedgerAdminResetSummary,
    pub before_rows: Vec<LedgerAdminDbTableCountRow>,
    pub after_rows: Vec<LedgerAdminDbTableCountRow>,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminTransactionResetSummary {
    pub scope_count: usize,
    pub total_rows_before: i64,
    pub total_rows_after: i64,
    pub deleted_rows: i64,
}

#[derive(Debug, Serialize)]
pub struct LedgerAdminTransactionResetResult {
    pub db_path: String,
    pub confirm_phrase: String,
    pub scopes: Vec<String>,
    pub summary: LedgerAdminTransactionResetSummary,
    pub before_rows: Vec<LedgerAdminDbTableCountRow>,
    pub after_rows: Vec<LedgerAdminDbTableCountRow>,
}

#[derive(Debug, serde::Deserialize)]
pub struct LedgerAdminResetRequest {
    pub confirm_text: Option<String>,
}

pub(crate) fn resolve_ledger_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("无法解析 app_local_data_dir: {e}"))?;
    Ok(base.join(DEFAULT_LEDGER_DB_RELATIVE_PATH))
}

fn resolve_repo_runtime_db_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("../../..")
        .join(DEFAULT_REPO_RUNTIME_DB_RELATIVE_PATH)
}

fn import_db_file_to_app(
    app: &AppHandle,
    source_db_path: &Path,
) -> Result<LedgerDbImportRepoRuntimeResult, String> {
    if !source_db_path.exists() {
        return Err(format!(
            "未找到数据库文件: {}",
            source_db_path.to_string_lossy()
        ));
    }
    if !source_db_path.is_file() {
        return Err(format!(
            "导入路径不是文件: {}",
            source_db_path.to_string_lossy()
        ));
    }

    // Best-effort checkpoint to reduce stale WAL risk before file copy.
    if let Ok(conn) = Connection::open(source_db_path) {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }

    let target_db_path = resolve_ledger_db_path(app)?;
    if let Some(parent) = target_db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目标数据库目录失败: {e}"))?;
    }
    let replaced_existing = target_db_path.exists();
    let copied_bytes = std::fs::copy(source_db_path, &target_db_path)
        .map_err(|e| format!("复制数据库文件失败: {e}"))?;
    let migrate_result = apply_embedded_migrations(&target_db_path)?;

    Ok(LedgerDbImportRepoRuntimeResult {
        source_db_path: source_db_path.to_string_lossy().to_string(),
        target_db_path: target_db_path.to_string_lossy().to_string(),
        replaced_existing,
        copied_bytes,
        migrate_result,
    })
}

fn ensure_schema_migrations_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        "#,
    )
}

fn has_schema_migrations_table(conn: &Connection) -> rusqlite::Result<bool> {
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map(|v| v != 0)?;
    Ok(exists)
}

fn load_applied_versions(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT version FROM schema_migrations ORDER BY version ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut versions = Vec::new();
    for row in rows {
        versions.push(row?);
    }
    Ok(versions)
}

fn list_non_system_tables(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .map_err(|e| format!("读取 sqlite_master 失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("查询 sqlite_master 失败: {e}"))?;
    let mut names = HashSet::new();
    for row in rows {
        names.insert(row.map_err(|e| format!("读取表名失败: {e}"))?);
    }
    Ok(names)
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn query_admin_db_stats_at_path(db_path: &Path) -> Result<LedgerAdminDbStatsResult, String> {
    if !db_path.exists() {
        return Err(format!("数据库不存在: {}", db_path.to_string_lossy()));
    }

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let existing = list_non_system_tables(&conn)?;

    let mut rows = Vec::new();
    let mut total_rows = 0_i64;
    for table in ADMIN_DATA_TABLES {
        if !existing.contains(*table) {
            continue;
        }
        let sql = format!("SELECT COUNT(*) FROM {}", quote_ident(table));
        let row_count = conn
            .query_row(&sql, [], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("统计表 {table} 行数失败: {e}"))?;
        total_rows += row_count;
        rows.push(LedgerAdminDbTableCountRow {
            table: (*table).to_string(),
            row_count,
        });
    }

    Ok(LedgerAdminDbStatsResult {
        db_path: db_path.to_string_lossy().to_string(),
        confirm_phrase: ADMIN_RESET_CONFIRM_PHRASE.to_string(),
        summary: LedgerAdminDbStatsSummary {
            table_count: rows.len(),
            total_rows,
        },
        rows,
    })
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .map_err(|e| format!("检查表 {table} 是否存在失败: {e}"))
}

fn build_admin_table_counts(
    conn: &Connection,
    tables: &[String],
) -> Result<Vec<LedgerAdminDbTableCountRow>, String> {
    let mut rows = Vec::new();
    for table in tables {
        let sql = format!("SELECT COUNT(*) FROM {}", quote_ident(table));
        let row_count = conn
            .query_row(&sql, [], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("统计表 {table} 行数失败: {e}"))?;
        rows.push(LedgerAdminDbTableCountRow {
            table: table.clone(),
            row_count,
        });
    }
    Ok(rows)
}

fn build_admin_transaction_scope_counts(
    conn: &Connection,
) -> Result<Vec<LedgerAdminDbTableCountRow>, String> {
    let mut rows = Vec::new();

    let tx_count = conn
        .query_row("SELECT COUNT(*) FROM transactions", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|e| format!("统计 transactions 行数失败: {e}"))?;
    rows.push(LedgerAdminDbTableCountRow {
        table: "transactions".to_string(),
        row_count: tx_count,
    });

    if table_exists(conn, "reconciliations")? {
        let rec_count = conn
            .query_row("SELECT COUNT(*) FROM reconciliations", [], |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|e| format!("统计 reconciliations 行数失败: {e}"))?;
        rows.push(LedgerAdminDbTableCountRow {
            table: "reconciliations".to_string(),
            row_count: rec_count,
        });
    }

    if table_exists(conn, "import_jobs")? {
        let cmb_jobs_count = conn
            .query_row(
                "SELECT COUNT(*) FROM import_jobs WHERE source_type IN (?1, ?2)",
                [
                    TRANSACTION_IMPORT_SOURCE_TYPES[0],
                    TRANSACTION_IMPORT_SOURCE_TYPES[1],
                ],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("统计 import_jobs(transaction_sources) 行数失败: {e}"))?;
        rows.push(LedgerAdminDbTableCountRow {
            table: "import_jobs(transaction_sources)".to_string(),
            row_count: cmb_jobs_count,
        });
    }

    Ok(rows)
}

fn reset_admin_db_data_at_path(
    db_path: &Path,
    confirm_text: &str,
) -> Result<LedgerAdminResetResult, String> {
    if confirm_text.trim() != ADMIN_RESET_CONFIRM_PHRASE {
        return Err(format!(
            "confirm_text 不正确，请输入: {}",
            ADMIN_RESET_CONFIRM_PHRASE
        ));
    }
    if !db_path.exists() {
        return Err(format!("数据库不存在: {}", db_path.to_string_lossy()));
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    let existing = list_non_system_tables(&conn)?;
    let tables = ADMIN_DATA_TABLES
        .iter()
        .filter(|name| existing.contains(**name))
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();

    let before_rows = build_admin_table_counts(&conn, &tables)?;
    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始重置事务失败: {e}"))?;
        for table in &tables {
            let sql = format!("DELETE FROM {}", quote_ident(table));
            tx.execute(&sql, [])
                .map_err(|e| format!("清空表 {table} 失败: {e}"))?;
        }
        tx.commit().map_err(|e| format!("提交重置事务失败: {e}"))?;
    }
    let after_rows = build_admin_table_counts(&conn, &tables)?;

    let total_before = before_rows.iter().map(|r| r.row_count).sum::<i64>();
    let total_after = after_rows.iter().map(|r| r.row_count).sum::<i64>();
    let deleted_rows = total_before - total_after;

    Ok(LedgerAdminResetResult {
        db_path: db_path.to_string_lossy().to_string(),
        confirm_phrase: ADMIN_RESET_CONFIRM_PHRASE.to_string(),
        summary: LedgerAdminResetSummary {
            table_count: tables.len(),
            total_rows_before: total_before,
            total_rows_after: total_after,
            deleted_rows,
        },
        before_rows,
        after_rows,
    })
}

fn reset_admin_transaction_data_at_path(
    db_path: &Path,
    confirm_text: &str,
) -> Result<LedgerAdminTransactionResetResult, String> {
    if confirm_text.trim() != ADMIN_RESET_CONFIRM_PHRASE {
        return Err(format!(
            "confirm_text 不正确，请输入: {}",
            ADMIN_RESET_CONFIRM_PHRASE
        ));
    }
    if !db_path.exists() {
        return Err(format!("数据库不存在: {}", db_path.to_string_lossy()));
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;

    let before_rows = build_admin_transaction_scope_counts(&conn)?;
    {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始事务范围重置失败: {e}"))?;
        tx.execute("DELETE FROM transactions", [])
            .map_err(|e| format!("清空 transactions 失败: {e}"))?;

        let rec_exists = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='reconciliations')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("检查 reconciliations 是否存在失败: {e}"))?
            != 0;
        if rec_exists {
            tx.execute("DELETE FROM reconciliations", [])
                .map_err(|e| format!("清空 reconciliations 失败: {e}"))?;
        }

        let import_jobs_exists = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_jobs')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("检查 import_jobs 是否存在失败: {e}"))?
            != 0;
        if import_jobs_exists {
            tx.execute(
                "DELETE FROM import_jobs WHERE source_type IN (?1, ?2)",
                [
                    TRANSACTION_IMPORT_SOURCE_TYPES[0],
                    TRANSACTION_IMPORT_SOURCE_TYPES[1],
                ],
            )
            .map_err(|e| format!("清空 import_jobs(transaction_sources) 失败: {e}"))?;
        }

        tx.commit()
            .map_err(|e| format!("提交事务范围重置失败: {e}"))?;
    }

    let after_rows = build_admin_transaction_scope_counts(&conn)?;
    let total_before = before_rows.iter().map(|r| r.row_count).sum::<i64>();
    let total_after = after_rows.iter().map(|r| r.row_count).sum::<i64>();

    Ok(LedgerAdminTransactionResetResult {
        db_path: db_path.to_string_lossy().to_string(),
        confirm_phrase: ADMIN_RESET_CONFIRM_PHRASE.to_string(),
        scopes: ADMIN_TRANSACTION_RESET_SCOPES
            .iter()
            .map(|v| (*v).to_string())
            .collect(),
        summary: LedgerAdminTransactionResetSummary {
            scope_count: before_rows.len(),
            total_rows_before: total_before,
            total_rows_after: total_after,
            deleted_rows: total_before - total_after,
        },
        before_rows,
        after_rows,
    })
}

fn inspect_status_at_path(db_path: &Path) -> Result<LedgerDbStatus, String> {
    let migration_files = MIGRATIONS
        .iter()
        .map(|(v, _)| (*v).to_string())
        .collect::<Vec<_>>();
    let exists = db_path.exists();
    if !exists {
        return Ok(LedgerDbStatus {
            db_path: db_path.to_string_lossy().to_string(),
            exists: false,
            migration_files: migration_files.clone(),
            applied_versions: Vec::new(),
            pending_versions: migration_files,
            schema_migrations_table_exists: false,
            ready: false,
        });
    }

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let schema_table_exists = has_schema_migrations_table(&conn)
        .map_err(|e| format!("检查 schema_migrations 失败: {e}"))?;

    let applied_versions = if schema_table_exists {
        load_applied_versions(&conn).map_err(|e| format!("读取 schema_migrations 失败: {e}"))?
    } else {
        Vec::new()
    };
    let applied_set = applied_versions.iter().cloned().collect::<HashSet<_>>();
    let pending_versions = migration_files
        .iter()
        .filter(|v| !applied_set.contains(*v))
        .cloned()
        .collect::<Vec<_>>();

    Ok(LedgerDbStatus {
        db_path: db_path.to_string_lossy().to_string(),
        exists: true,
        migration_files,
        applied_versions,
        pending_versions: pending_versions.clone(),
        schema_migrations_table_exists: schema_table_exists,
        ready: pending_versions.is_empty(),
    })
}

fn apply_embedded_migrations(db_path: &Path) -> Result<LedgerDbMigrateResult, String> {
    let created = !db_path.exists();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("设置 foreign_keys 失败: {e}"))?;
    ensure_schema_migrations_table(&conn)
        .map_err(|e| format!("初始化 schema_migrations 失败: {e}"))?;

    let already = load_applied_versions(&conn)
        .map_err(|e| format!("读取已应用迁移失败: {e}"))?
        .into_iter()
        .collect::<HashSet<_>>();

    let mut applied_now = Vec::new();
    let mut skipped = Vec::new();

    for (version, sql) in MIGRATIONS {
        if already.contains(*version) {
            skipped.push((*version).to_string());
            continue;
        }
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始迁移事务失败 ({version}): {e}"))?;
        tx.execute_batch(sql)
            .map_err(|e| format!("执行迁移失败 ({version}): {e}"))?;
        tx.execute(
            "INSERT INTO schema_migrations(version) VALUES (?1)",
            [*version],
        )
        .map_err(|e| format!("写入 schema_migrations 失败 ({version}): {e}"))?;
        tx.commit()
            .map_err(|e| format!("提交迁移事务失败 ({version}): {e}"))?;
        applied_now.push((*version).to_string());
    }

    let final_applied_total = load_applied_versions(&conn)
        .map_err(|e| format!("读取迁移结果失败: {e}"))?
        .len();
    let pending_total = MIGRATIONS.len().saturating_sub(final_applied_total);

    Ok(LedgerDbMigrateResult {
        db_path: db_path.to_string_lossy().to_string(),
        created,
        applied_now,
        skipped,
        applied_total: final_applied_total,
        pending_total,
    })
}

#[tauri::command]
pub fn ledger_db_status(app: AppHandle) -> Result<LedgerDbStatus, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    inspect_status_at_path(&db_path)
}

#[tauri::command]
pub fn ledger_db_migrate(app: AppHandle) -> Result<LedgerDbMigrateResult, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    apply_embedded_migrations(&db_path)
}

#[tauri::command]
pub fn ledger_db_import_repo_runtime(
    app: AppHandle,
) -> Result<LedgerDbImportRepoRuntimeResult, String> {
    let source_db_path = resolve_repo_runtime_db_path();
    if !source_db_path.exists() {
        return Err(format!(
            "未找到仓库运行库: {}",
            source_db_path.to_string_lossy()
        ));
    }
    import_db_file_to_app(&app, &source_db_path)
}

#[tauri::command]
pub fn ledger_db_import_from_path(
    app: AppHandle,
    source_path: String,
) -> Result<LedgerDbImportRepoRuntimeResult, String> {
    let source_text = source_path.trim();
    if source_text.is_empty() {
        return Err("source_path 必填".to_string());
    }
    import_db_file_to_app(&app, Path::new(source_text))
}

#[tauri::command]
pub fn ledger_db_admin_stats(app: AppHandle) -> Result<LedgerAdminDbStatsResult, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    query_admin_db_stats_at_path(&db_path)
}

#[tauri::command]
pub fn ledger_db_admin_reset_all(
    app: AppHandle,
    req: LedgerAdminResetRequest,
) -> Result<LedgerAdminResetResult, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    reset_admin_db_data_at_path(&db_path, req.confirm_text.unwrap_or_default().as_str())
}

#[tauri::command]
pub fn ledger_db_admin_reset_transactions(
    app: AppHandle,
    req: LedgerAdminResetRequest,
) -> Result<LedgerAdminTransactionResetResult, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    reset_admin_transaction_data_at_path(&db_path, req.confirm_text.unwrap_or_default().as_str())
}
