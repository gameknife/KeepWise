use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(crate) fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub(crate) fn create_temp_test_db() -> PathBuf {
    std::env::temp_dir().join(format!("keepwise_test_{}.db", Uuid::new_v4()))
}

pub(crate) fn apply_all_migrations_for_test(db_path: &Path) {
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

#[allow(dead_code)]
pub(crate) fn approx_eq(a: f64, b: f64, eps: f64) -> bool {
    (a - b).abs() < eps
}
