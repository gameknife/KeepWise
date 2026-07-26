use super::*;

pub(super) fn create_sync_snapshot_id() -> String {
    format!("snap-{}", Uuid::new_v4().simple())
}

pub(super) fn sqlite_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub(super) fn merge_sqlite_db_bytes(remote_db: &[u8], local_db: &[u8]) -> Result<Vec<u8>, String> {
    let temp_root =
        std::env::temp_dir().join(format!("keepwise-sync-merge-{}", Uuid::new_v4().simple()));
    fs::create_dir_all(&temp_root).map_err(|e| format!("创建临时目录失败: {e}"))?;
    let remote_path = temp_root.join("remote.db");
    let local_path = temp_root.join("local.db");
    let merged_path = temp_root.join("merged.db");

    let result = (|| -> Result<Vec<u8>, String> {
        fs::write(&remote_path, remote_db).map_err(|e| format!("写入远端临时数据库失败: {e}"))?;
        fs::write(&local_path, local_db).map_err(|e| format!("写入本地临时数据库失败: {e}"))?;
        fs::copy(&remote_path, &merged_path).map_err(|e| format!("初始化合并数据库失败: {e}"))?;

        let conn = rusqlite::Connection::open(&merged_path)
            .map_err(|e| format!("打开合并数据库失败: {e}"))?;
        let local_escaped = local_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("ATTACH DATABASE '{local_escaped}' AS src;"))
            .map_err(|e| format!("附加本地数据库失败: {e}"))?;

        let tables = {
            let mut stmt = conn
                .prepare(
                    "SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )
                .map_err(|e| format!("读取远端表清单失败: {e}"))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("遍历远端表清单失败: {e}"))?;
            let mut out = Vec::<String>::new();
            for row in rows {
                out.push(row.map_err(|e| format!("读取远端表名失败: {e}"))?);
            }
            out
        };

        for table in tables {
            let src_exists: i64 = conn
                .query_row(
                    "SELECT COUNT(1) FROM src.sqlite_master WHERE type='table' AND name=?1",
                    [&table],
                    |row| row.get(0),
                )
                .map_err(|e| format!("检测本地表存在失败 ({table}): {e}"))?;
            if src_exists == 0 {
                continue;
            }

            let columns = {
                let pragma_sql = format!("PRAGMA main.table_info({})", sqlite_ident(&table));
                let mut stmt = conn
                    .prepare(&pragma_sql)
                    .map_err(|e| format!("读取表结构失败 ({table}): {e}"))?;
                let rows = stmt
                    .query_map([], |row| row.get::<_, String>(1))
                    .map_err(|e| format!("遍历字段失败 ({table}): {e}"))?;
                let mut cols = Vec::<String>::new();
                for row in rows {
                    cols.push(row.map_err(|e| format!("读取字段名失败 ({table}): {e}"))?);
                }
                cols
            };
            if columns.is_empty() {
                continue;
            }

            let table_q = sqlite_ident(&table);
            let cols_csv = columns
                .iter()
                .map(|c| sqlite_ident(c))
                .collect::<Vec<_>>()
                .join(", ");
            let merge_sql = format!(
                "INSERT OR REPLACE INTO main.{table_q} ({cols_csv}) SELECT {cols_csv} FROM src.{table_q};"
            );
            conn.execute_batch(&merge_sql)
                .map_err(|e| format!("合并数据失败 ({table}): {e}"))?;
        }

        conn.execute_batch("DETACH DATABASE src;")
            .map_err(|e| format!("分离本地数据库失败: {e}"))?;
        fs::read(&merged_path).map_err(|e| format!("读取合并数据库失败: {e}"))
    })();

    let _ = fs::remove_dir_all(&temp_root);
    result
}

pub(super) fn merge_sync_material(
    remote: &LocalSyncMaterial,
    local: &LocalSyncMaterial,
) -> Result<LocalSyncMaterial, String> {
    let db_bytes = merge_sqlite_db_bytes(&remote.db_bytes, &local.db_bytes)?;
    let mut rules_by_name = BTreeMap::<String, Vec<u8>>::new();
    for rule in &remote.rules {
        rules_by_name.insert(rule.name.clone(), rule.bytes.clone());
    }
    for rule in &local.rules {
        rules_by_name.insert(rule.name.clone(), rule.bytes.clone());
    }
    let rules = rules_by_name
        .into_iter()
        .map(|(name, bytes)| RuleFileBinary { name, bytes })
        .collect::<Vec<_>>();
    Ok(LocalSyncMaterial { db_bytes, rules })
}
