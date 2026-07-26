use super::*;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn create_temp_path(prefix: &str, ext: &str) -> PathBuf {
    let unique = format!("{prefix}_{}_{}.{}", std::process::id(), Uuid::new_v4(), ext);
    std::env::temp_dir().join(unique)
}

fn apply_all_migrations_for_test(db_path: &Path) {
    let conn = Connection::open(db_path).expect("open temp db");
    let mut entries = fs::read_dir(repo_root().join("db/migrations"))
        .expect("read migrations dir")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("sql"))
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        let sql = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read migration {:?} failed: {e}", path));
        conn.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("apply migration {:?} failed: {e}", path));
    }
}

fn write_sample_yzxy_csv(path: &Path) {
    let csv = "\
日期,账户,总资产,转入转出金额\n\
2026-01-31,测试组合A,10000.00,1000.00\n\
2026-02-28,测试组合A,10800.00,-200.00\n";
    fs::write(path, csv).expect("write temp yzxy csv");
}

#[test]
fn yzxy_csv_preview_and_import_are_idempotent() {
    let db_path = create_temp_path("keepwise_yzxy_import_test", "db");
    let csv_path = create_temp_path("keepwise_yzxy_fixture", "csv");
    write_sample_yzxy_csv(&csv_path);
    apply_all_migrations_for_test(&db_path);

    let preview = yzxy_preview_file_at_path(&csv_path).expect("preview yzxy csv");
    assert_eq!(preview.get("parsed_count").and_then(Value::as_i64), Some(2));
    assert_eq!(preview.get("error_count").and_then(Value::as_i64), Some(0));
    assert_eq!(
        preview.get("parser_kind").and_then(Value::as_str),
        Some("summary")
    );

    let import1 =
        yzxy_import_file_at_db_path(&db_path, &csv_path, "yzxy_csv").expect("first import");
    let import2 =
        yzxy_import_file_at_db_path(&db_path, &csv_path, "yzxy_csv").expect("second import");
    assert_eq!(
        import1.get("imported_count").and_then(Value::as_i64),
        Some(2)
    );
    assert_eq!(
        import2.get("imported_count").and_then(Value::as_i64),
        Some(2)
    );
    assert_eq!(import1.get("error_count").and_then(Value::as_i64), Some(0));
    assert_eq!(import2.get("error_count").and_then(Value::as_i64), Some(0));

    let conn = Connection::open(&db_path).expect("open temp db for verification");
    let inv_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM investment_records", [], |row| {
            row.get(0)
        })
        .expect("count investment_records");
    let acct_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM accounts WHERE account_type='investment'",
            [],
            |row| row.get(0),
        )
        .expect("count investment accounts");
    let import_job_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM import_jobs WHERE source_type='yzxy_csv'",
            [],
            |row| row.get(0),
        )
        .expect("count import_jobs");
    let latest_assets: i64 = conn
        .query_row(
            "SELECT total_assets_cents FROM investment_records WHERE snapshot_date='2026-02-28'",
            [],
            |row| row.get(0),
        )
        .expect("query latest assets");

    assert_eq!(
        inv_count, 2,
        "same file re-import should upsert, not duplicate"
    );
    assert_eq!(
        acct_count, 1,
        "same account name should map to one investment account"
    );
    assert_eq!(
        import_job_count, 2,
        "import jobs should record each import run"
    );
    assert_eq!(latest_assets, 1_080_000);

    let _ = fs::remove_file(&csv_path);
    let _ = fs::remove_file(&db_path);
}
