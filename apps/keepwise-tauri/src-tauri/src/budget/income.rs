use super::*;

pub fn query_salary_income_overview_at_db_path(
    db_path: &Path,
    req: BudgetYearQueryRequest,
) -> Result<Value, String> {
    let today = Local::now().date_naive();
    let year = parse_year_param(req.year.as_deref(), today.year())?;
    let month_start = format!("{year:04}-01");
    let month_end = format!("{year:04}-12");
    let deduped_income_cte = deduped_cmb_pdf_income_cte();

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    let mut monthly_stmt = conn
        .prepare(&format!(
            r#"
            {deduped_income_cte}
            SELECT
                month_key,
                statement_category,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount_cents), 0) AS amount_cents
            FROM deduped_income
            GROUP BY month_key, statement_category
            ORDER BY month_key ASC, statement_category ASC
            "#,
        ))
        .map_err(|e| format!("查询收入月度明细失败: {e}"))?;
    let monthly_iter = monthly_stmt
        .query_map(params![month_start, month_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("查询收入月度明细失败: {e}"))?;
    let mut monthly_rows = Vec::<(String, String, i64, i64)>::new();
    for row in monthly_iter {
        monthly_rows.push(row.map_err(|e| format!("读取收入月度明细失败: {e}"))?);
    }

    let mut employer_stmt = conn
        .prepare(&format!(
            r#"
            {deduped_income_cte}
            SELECT
                employer,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount_cents), 0) AS amount_cents
            FROM deduped_income
            WHERE statement_category = '代发工资'
            GROUP BY employer
            ORDER BY amount_cents DESC, employer ASC
            "#,
        ))
        .map_err(|e| format!("查询收入雇主分布失败: {e}"))?;
    let employer_iter = employer_stmt
        .query_map(params![month_start, month_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| format!("查询收入雇主分布失败: {e}"))?;
    let mut employers = Vec::<Value>::new();
    for row in employer_iter {
        let (employer, tx_count, amount_cents) =
            row.map_err(|e| format!("读取收入雇主分布失败: {e}"))?;
        employers.push(json!({
            "employer": employer,
            "tx_count": tx_count,
            "amount_cents": amount_cents,
            "amount_yuan": cents_to_yuan_text(amount_cents),
        }));
    }

    let totals = conn
        .query_row(
            &format!(
                r#"
            {deduped_income_cte}
            SELECT
                COALESCE(SUM(CASE WHEN statement_category = '代发工资' THEN amount_cents ELSE 0 END), 0) AS salary_cents,
                COALESCE(SUM(CASE WHEN statement_category = '代发住房公积金' THEN amount_cents ELSE 0 END), 0) AS housing_fund_cents,
                COALESCE(SUM(CASE WHEN statement_category = '代发工资' THEN 1 ELSE 0 END), 0) AS salary_count,
                COALESCE(SUM(CASE WHEN statement_category = '代发住房公积金' THEN 1 ELSE 0 END), 0) AS housing_fund_count
            FROM deduped_income
            "#,
            ),
            params![month_start, month_end],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询收入汇总失败: {e}"))?;

    let mut month_map = std::collections::HashMap::<String, (i64, i64, i64, i64)>::new();
    for (month_key, statement_category, tx_count, amount_cents) in monthly_rows {
        let entry = month_map.entry(month_key).or_insert((0, 0, 0, 0)); // salary_cents, salary_tx, fund_cents, fund_tx
        match statement_category.as_str() {
            "代发工资" => {
                entry.0 += amount_cents;
                entry.1 += tx_count;
            }
            "代发住房公积金" => {
                entry.2 += amount_cents;
                entry.3 += tx_count;
            }
            _ => {}
        }
    }

    let mut rows = Vec::<Value>::new();
    let mut months_with_salary = 0_i64;
    let mut months_with_housing_fund = 0_i64;
    for month in 1..=12 {
        let month_key = format!("{year:04}-{month:02}");
        let (salary_cents, salary_tx_count, housing_fund_cents, housing_fund_tx_count) =
            month_map.get(&month_key).copied().unwrap_or((0, 0, 0, 0));
        if salary_cents > 0 {
            months_with_salary += 1;
        }
        if housing_fund_cents > 0 {
            months_with_housing_fund += 1;
        }
        let total_income_cents = salary_cents + housing_fund_cents;
        rows.push(json!({
            "month_key": month_key,
            "salary_cents": salary_cents,
            "salary_yuan": cents_to_yuan_text(salary_cents),
            "salary_tx_count": salary_tx_count,
            "housing_fund_cents": housing_fund_cents,
            "housing_fund_yuan": cents_to_yuan_text(housing_fund_cents),
            "housing_fund_tx_count": housing_fund_tx_count,
            "total_income_cents": total_income_cents,
            "total_income_yuan": cents_to_yuan_text(total_income_cents),
        }));
    }

    let (salary_total_cents, housing_fund_total_cents, salary_tx_count, housing_fund_tx_count) =
        totals;

    Ok(json!({
        "year": year,
        "as_of_date": today.format("%Y-%m-%d").to_string(),
        "source_type": "cmb_bank_pdf",
        "summary": {
            "salary_total_cents": salary_total_cents,
            "salary_total_yuan": cents_to_yuan_text(salary_total_cents),
            "salary_tx_count": salary_tx_count,
            "housing_fund_total_cents": housing_fund_total_cents,
            "housing_fund_total_yuan": cents_to_yuan_text(housing_fund_total_cents),
            "housing_fund_tx_count": housing_fund_tx_count,
            "total_income_cents": salary_total_cents + housing_fund_total_cents,
            "total_income_yuan": cents_to_yuan_text(salary_total_cents + housing_fund_total_cents),
            "months_with_salary": months_with_salary,
            "months_with_housing_fund": months_with_housing_fund,
            "employer_count": employers.len(),
        },
        "employers": employers,
        "rows": rows,
    }))
}
