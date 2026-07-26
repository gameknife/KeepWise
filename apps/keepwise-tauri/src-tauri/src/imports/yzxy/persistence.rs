use super::*;

pub(super) fn account_id_from_name(account_name: &str) -> String {
    let digest = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("keepwise:investment:{account_name}").as_bytes(),
    );
    let hex = digest.simple().to_string();
    format!("acct_inv_{}", &hex[..12])
}

pub(super) fn ensure_schema_ready(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('accounts','investment_records','import_jobs')",
        )
        .map_err(|e| format!("检查数据库表失败: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("读取数据库表失败: {e}"))?;
    let mut table_names = HashSet::new();
    for row in rows {
        table_names.insert(row.map_err(|e| format!("读取数据库表失败: {e}"))?);
    }
    let required_tables = ["accounts", "investment_records", "import_jobs"];
    let missing_tables = required_tables
        .iter()
        .filter(|t| !table_names.contains(**t))
        .copied()
        .collect::<Vec<_>>();
    if !missing_tables.is_empty() {
        return Err(format!(
            "数据库缺少必要表: {}。请先执行迁移。",
            missing_tables.join(", ")
        ));
    }

    let mut stmt = conn
        .prepare("PRAGMA table_info(investment_records)")
        .map_err(|e| format!("读取 investment_records 字段失败: {e}"))?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("读取 investment_records 字段失败: {e}"))?;
    let mut col_set = HashSet::new();
    for col in cols {
        col_set.insert(col.map_err(|e| format!("读取 investment_records 字段失败: {e}"))?);
    }
    let required_cols = [
        "account_id",
        "snapshot_date",
        "total_assets_cents",
        "transfer_amount_cents",
        "source_type",
        "source_file",
        "import_job_id",
    ];
    let missing_cols = required_cols
        .iter()
        .filter(|c| !col_set.contains(**c))
        .copied()
        .collect::<Vec<_>>();
    if !missing_cols.is_empty() {
        return Err(format!(
            "investment_records 缺少字段: {}。请执行最新迁移。",
            missing_cols.join(", ")
        ));
    }

    Ok(())
}

pub(super) fn ensure_account(
    conn: &Connection,
    account_id: &str,
    account_name: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO accounts(id, name, account_type, currency, initial_balance_cents)
        VALUES (?1, ?2, 'investment', 'CNY', 0)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            updated_at=datetime('now')
        "#,
        params![account_id, account_name],
    )
    .map_err(|e| format!("写入投资账户失败: {e}"))?;
    Ok(())
}

pub(super) fn upsert_investment_record(
    conn: &Connection,
    account_id: &str,
    row: &ParsedInvestmentRow,
    source_type: &str,
    source_file: Option<&str>,
    import_job_id: Option<&str>,
) -> Result<(), String> {
    let rec_id = Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!("{account_id}:{}:{source_type}", row.snapshot_date).as_bytes(),
    )
    .to_string();

    conn.execute(
        r#"
        INSERT INTO investment_records(
            id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents,
            source_type, source_file, import_job_id
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
            total_assets_cents=excluded.total_assets_cents,
            transfer_amount_cents=excluded.transfer_amount_cents,
            source_type=excluded.source_type,
            source_file=excluded.source_file,
            import_job_id=excluded.import_job_id,
            updated_at=datetime('now')
        "#,
        params![
            rec_id,
            account_id,
            row.snapshot_date,
            row.total_assets_cents,
            row.transfer_amount_cents,
            source_type,
            source_file,
            import_job_id,
        ],
    )
    .map_err(|e| format!("写入投资记录失败: {e}"))?;
    Ok(())
}
