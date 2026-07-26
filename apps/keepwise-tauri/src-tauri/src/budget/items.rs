use super::*;

pub fn query_monthly_budget_items_at_db_path(
    db_path: &Path,
    _req: MonthlyBudgetItemsQueryRequest,
) -> Result<Value, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let rows = load_monthly_budget_items(&conn)?;
    let summary = summarize_monthly_budget_items(&rows);
    Ok(json!({
        "summary": {
            "total_count": summary.total_count,
            "active_count": summary.active_count,
            "monthly_budget_total_cents": summary.monthly_total_cents,
            "monthly_budget_total_yuan": cents_to_yuan_text(summary.monthly_total_cents),
            "annual_budget_cents": summary.annual_total_cents,
            "annual_budget_yuan": cents_to_yuan_text(summary.annual_total_cents),
        },
        "rows": rows.iter().map(monthly_budget_item_row_to_json).collect::<Vec<_>>(),
    }))
}

pub fn upsert_monthly_budget_item_at_db_path(
    db_path: &Path,
    req: MonthlyBudgetItemUpsertRequest,
) -> Result<Value, String> {
    let mut item_id = req.id.unwrap_or_default().trim().to_string();
    let name = req.name.unwrap_or_default().trim().to_string();
    if name.is_empty() {
        return Err("name 必填".to_string());
    }
    let monthly_amount_cents = parse_amount_to_cents(
        req.monthly_amount
            .unwrap_or_else(|| "0".to_string())
            .as_str(),
    )?;
    if monthly_amount_cents < 0 {
        return Err("monthly_amount 不能为负数".to_string());
    }
    let is_active = parse_bool_param(req.is_active.as_deref(), true)?;
    let sort_order = parse_sort_order(req.sort_order.as_deref())?;

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| format!("启用外键失败: {e}"))?;

    let save_result: Result<MonthlyBudgetItemRow, String> = (|| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;
        if !item_id.is_empty() {
            let exists = tx
                .query_row(
                    "SELECT id FROM monthly_budget_items WHERE id = ?1",
                    [item_id.as_str()],
                    |_row| Ok(()),
                )
                .map(|_| true)
                .unwrap_or(false);
            if !exists {
                return Err("未找到要修改的预算项".to_string());
            }
            tx.execute(
                r#"
                UPDATE monthly_budget_items
                SET name = ?1,
                    monthly_amount_cents = ?2,
                    sort_order = ?3,
                    is_active = ?4,
                    updated_at = datetime('now')
                WHERE id = ?5
                "#,
                params![
                    name,
                    monthly_amount_cents,
                    sort_order,
                    if is_active { 1 } else { 0 },
                    item_id
                ],
            )
            .map_err(|e| format!("预算项保存失败（名称可能重复）: {e}"))?;
        } else {
            item_id = Uuid::new_v4().to_string();
            tx.execute(
                r#"
                INSERT INTO monthly_budget_items(
                    id, name, monthly_amount_cents, sort_order, is_active, is_builtin
                ) VALUES (?1, ?2, ?3, ?4, ?5, 0)
                "#,
                params![
                    item_id,
                    name,
                    monthly_amount_cents,
                    sort_order,
                    if is_active { 1 } else { 0 }
                ],
            )
            .map_err(|e| format!("预算项保存失败（名称可能重复）: {e}"))?;
        }

        let saved = tx
            .query_row(
                r#"
                SELECT id, name, monthly_amount_cents, sort_order, is_active, is_builtin, created_at, updated_at
                FROM monthly_budget_items
                WHERE id = ?1
                "#,
                [item_id.as_str()],
                |row| {
                    Ok(MonthlyBudgetItemRow {
                        id: row.get::<_, String>(0)?,
                        name: row.get::<_, String>(1)?,
                        monthly_amount_cents: row.get::<_, i64>(2)?,
                        sort_order: row.get::<_, i64>(3)?,
                        is_active: row.get::<_, i64>(4)? != 0,
                        is_builtin: row.get::<_, i64>(5)? != 0,
                        created_at: row.get::<_, String>(6)?,
                        updated_at: row.get::<_, String>(7)?,
                    })
                },
            )
            .map_err(|_| "预算项保存后读取失败".to_string())?;
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        Ok(saved)
    })();

    save_result.map(|row| monthly_budget_item_row_to_json(&row))
}

pub fn delete_monthly_budget_item_at_db_path(
    db_path: &Path,
    req: MonthlyBudgetItemDeleteRequest,
) -> Result<Value, String> {
    let item_id = req.id.unwrap_or_default().trim().to_string();
    if item_id.is_empty() {
        return Err("id 必填".to_string());
    }

    let mut conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    conn.execute("PRAGMA foreign_keys = ON", [])
        .map_err(|e| format!("启用外键失败: {e}"))?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("开启事务失败: {e}"))?;
    let row = tx
        .query_row(
            "SELECT id, name, monthly_amount_cents, is_builtin FROM monthly_budget_items WHERE id = ?1",
            [item_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .map_err(|_| "未找到要删除的预算项".to_string())?;
    tx.execute(
        "DELETE FROM monthly_budget_items WHERE id = ?1",
        [item_id.as_str()],
    )
    .map_err(|e| format!("删除预算项失败: {e}"))?;
    tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;

    Ok(json!({
        "id": row.0,
        "name": row.1,
        "monthly_amount_cents": row.2,
        "is_builtin": row.3,
        "deleted": true,
    }))
}
