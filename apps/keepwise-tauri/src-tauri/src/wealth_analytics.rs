use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

const SUPPORTED_PRESETS: &[&str] = &["ytd", "1y", "3y", "since_inception", "custom"];

#[derive(Debug, Deserialize)]
pub struct WealthOverviewQueryRequest {
    #[serde(rename = "as_of")]
    pub as_of_date: Option<String>,
    pub include_investment: Option<String>,
    pub include_cash: Option<String>,
    pub include_real_estate: Option<String>,
    pub include_liability: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WealthCurveQueryRequest {
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub include_investment: Option<String>,
    pub include_cash: Option<String>,
    pub include_real_estate: Option<String>,
    pub include_liability: Option<String>,
}

#[derive(Debug, Clone)]
struct Window {
    requested_from: NaiveDate,
    effective_from: NaiveDate,
    effective_to: NaiveDate,
    latest: NaiveDate,
}

#[derive(Debug, Clone)]
struct AsOfHistoryRow {
    account_id: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
    flow_cents: i64,
}

#[derive(Debug, Clone)]
struct OverviewItemRow {
    account_id: String,
    account_name: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
}

#[derive(Debug, Clone)]
struct AssetValuationRow {
    account_id: String,
    account_name: String,
    asset_class: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
}

#[derive(Debug, Clone, Copy)]
struct WealthFilters {
    include_investment: bool,
    include_cash: bool,
    include_real_estate: bool,
    include_liability: bool,
}

fn parse_iso_date(raw: &str, field_name: &str) -> Result<NaiveDate, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(format!("缺少字段: {field_name}"));
    }
    NaiveDate::parse_from_str(text, "%Y-%m-%d")
        .map_err(|_| format!("{field_name} 日期格式必须为 YYYY-MM-DD"))
}

fn cents_to_yuan_text(cents: i64) -> String {
    format!("{:.2}", cents as f64 / 100.0)
}

fn round_to(value: f64, digits: i32) -> f64 {
    let factor = 10_f64.powi(digits);
    (value * factor).round() / factor
}

fn parse_preset_with_default(raw: Option<&str>, default_preset: &str) -> Result<String, String> {
    let preset = raw.unwrap_or(default_preset).trim().to_lowercase();
    let preset = if preset.is_empty() {
        default_preset.to_string()
    } else {
        preset
    };
    if SUPPORTED_PRESETS.iter().any(|x| *x == preset) {
        Ok(preset)
    } else {
        Err(format!(
            "preset 不支持: {preset}，可选 {}",
            SUPPORTED_PRESETS.join(", ")
        ))
    }
}

fn resolve_window(
    preset: &str,
    from_raw: &str,
    to_raw: &str,
    earliest: NaiveDate,
    latest: NaiveDate,
) -> Result<Window, String> {
    if latest < earliest {
        return Err("无可用时间范围".to_string());
    }

    let requested_to = if to_raw.trim().is_empty() {
        latest
    } else {
        parse_iso_date(to_raw, "to")?
    };
    let effective_to = if requested_to < latest {
        requested_to
    } else {
        latest
    };
    if effective_to < earliest {
        return Err("结束日期早于最早可用记录".to_string());
    }

    let requested_from = match preset {
        "custom" => parse_iso_date(from_raw, "from")?,
        "ytd" => NaiveDate::from_ymd_opt(effective_to.year(), 1, 1).ok_or("无效 ytd 日期范围")?,
        "1y" => effective_to - Duration::days(365),
        "3y" => effective_to - Duration::days(365 * 3),
        "since_inception" => earliest,
        _ => return Err(format!("preset 不支持: {preset}")),
    };

    let effective_from = if requested_from > earliest {
        requested_from
    } else {
        earliest
    };
    if effective_from > effective_to {
        return Err("起始日期晚于结束日期".to_string());
    }

    Ok(Window {
        requested_from,
        effective_from,
        effective_to,
        latest,
    })
}

fn parse_bool_param(raw: Option<&str>, default: bool) -> Result<bool, String> {
    let text = raw.unwrap_or("").trim().to_lowercase();
    if text.is_empty() {
        return Ok(default);
    }
    if ["1", "true", "yes", "y", "on"].contains(&text.as_str()) {
        return Ok(true);
    }
    if ["0", "false", "no", "n", "off"].contains(&text.as_str()) {
        return Ok(false);
    }
    Err(format!("布尔参数不合法: {}", raw.unwrap_or("")))
}

fn parse_wealth_filters(
    include_investment: Option<&str>,
    include_cash: Option<&str>,
    include_real_estate: Option<&str>,
    include_liability: Option<&str>,
) -> Result<WealthFilters, String> {
    let filters = WealthFilters {
        include_investment: parse_bool_param(include_investment, true)?,
        include_cash: parse_bool_param(include_cash, true)?,
        include_real_estate: parse_bool_param(include_real_estate, true)?,
        include_liability: parse_bool_param(include_liability, true)?,
    };
    if !(filters.include_investment
        || filters.include_cash
        || filters.include_real_estate
        || filters.include_liability)
    {
        return Err("至少需要选择一个资产类型".to_string());
    }
    Ok(filters)
}

fn build_asof_totals(dates: &[NaiveDate], history_rows: &[AsOfHistoryRow]) -> HashMap<String, i64> {
    let mut totals = HashMap::<String, i64>::new();
    for d in dates {
        totals.insert(d.format("%Y-%m-%d").to_string(), 0);
    }

    let mut by_account: HashMap<String, Vec<&AsOfHistoryRow>> = HashMap::new();
    for row in history_rows {
        by_account
            .entry(row.account_id.clone())
            .or_default()
            .push(row);
    }

    for series in by_account.values_mut() {
        series.sort_by_key(|r| r.snapshot_date);
        let mut idx = 0usize;
        let mut current = 0_i64;
        for d in dates {
            while idx < series.len() && series[idx].snapshot_date <= *d {
                let raw_value = series[idx].value_cents;
                let flow_cents = series[idx].flow_cents;
                if raw_value == 0 && flow_cents != 0 && current > 0 {
                    // Compatibility with Python importer behavior when only flow is present.
                } else {
                    current = raw_value;
                }
                idx += 1;
            }
            let key = d.format("%Y-%m-%d").to_string();
            if let Some(total) = totals.get_mut(&key) {
                *total += current;
            }
        }
    }
    totals
}

fn query_latest_union_date(conn: &Connection) -> Result<Option<NaiveDate>, String> {
    let row = conn
        .query_row(
            r#"
            SELECT MAX(snapshot_date) AS max_date
            FROM (
                SELECT snapshot_date FROM investment_records
                UNION ALL
                SELECT snapshot_date FROM account_valuations
            )
            "#,
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .map_err(|e| format!("查询最大日期失败: {e}"))?;
    row.map(|s| parse_iso_date(&s, "max_date")).transpose()
}

fn query_union_bounds(conn: &Connection) -> Result<Option<(NaiveDate, NaiveDate)>, String> {
    let row = conn
        .query_row(
            r#"
            SELECT
                MIN(snapshot_date) AS min_date,
                MAX(snapshot_date) AS max_date
            FROM (
                SELECT snapshot_date FROM investment_records
                UNION ALL
                SELECT snapshot_date FROM account_valuations
            )
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        )
        .map_err(|e| format!("查询日期边界失败: {e}"))?;
    let (min_raw, max_raw) = row;
    match (min_raw, max_raw) {
        (Some(min_raw), Some(max_raw)) => Ok(Some((
            parse_iso_date(&min_raw, "min_date")?,
            parse_iso_date(&max_raw, "max_date")?,
        ))),
        _ => Ok(None),
    }
}

fn load_overview_investment_rows(
    conn: &Connection,
    as_of: &str,
) -> Result<Vec<OverviewItemRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                r.snapshot_date,
                r.total_assets_cents AS value_cents
            FROM investment_records r
            JOIN (
                SELECT account_id, MAX(snapshot_date) AS snapshot_date
                FROM investment_records
                WHERE snapshot_date <= ?1 AND total_assets_cents > 0
                GROUP BY account_id
            ) latest
              ON latest.account_id = r.account_id
             AND latest.snapshot_date = r.snapshot_date
            LEFT JOIN accounts a ON a.id = r.account_id
            ORDER BY value_cents DESC, account_name
            "#,
        )
        .map_err(|e| format!("查询投资账户总览失败: {e}"))?;
    let iter = stmt
        .query_map(params![as_of], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|e| format!("查询投资账户总览失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, account_name, snapshot_date_raw, value_cents) =
            row.map_err(|e| format!("读取投资账户总览失败: {e}"))?;
        out.push(OverviewItemRow {
            account_id,
            account_name,
            snapshot_date: parse_iso_date(&snapshot_date_raw, "snapshot_date")?,
            value_cents,
        });
    }
    Ok(out)
}

fn load_overview_asset_rows(
    conn: &Connection,
    as_of: &str,
) -> Result<Vec<AssetValuationRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                v.account_id,
                v.account_name,
                v.asset_class,
                v.snapshot_date,
                v.value_cents
            FROM account_valuations v
            JOIN (
                SELECT account_id, asset_class, MAX(snapshot_date) AS snapshot_date
                FROM account_valuations
                WHERE snapshot_date <= ?1
                GROUP BY account_id, asset_class
            ) latest
              ON latest.account_id = v.account_id
             AND latest.asset_class = v.asset_class
             AND latest.snapshot_date = v.snapshot_date
            ORDER BY v.asset_class, v.value_cents DESC, v.account_name
            "#,
        )
        .map_err(|e| format!("查询资产估值总览失败: {e}"))?;
    let iter = stmt
        .query_map(params![as_of], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| format!("查询资产估值总览失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, account_name, asset_class, snapshot_date_raw, value_cents) =
            row.map_err(|e| format!("读取资产估值总览失败: {e}"))?;
        out.push(AssetValuationRow {
            account_id,
            account_name,
            asset_class,
            snapshot_date: parse_iso_date(&snapshot_date_raw, "snapshot_date")?,
            value_cents,
        });
    }
    Ok(out)
}

fn map_overview_items(
    rows: &[OverviewItemRow],
    effective_as_of: NaiveDate,
    asset_class: &str,
) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let stale_days = (effective_as_of - row.snapshot_date).num_days();
            json!({
                "asset_class": asset_class,
                "account_id": row.account_id,
                "account_name": row.account_name,
                "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
                "value_cents": row.value_cents,
                "value_yuan": cents_to_yuan_text(row.value_cents),
                "stale_days": stale_days,
            })
        })
        .collect()
}

fn map_asset_items(
    rows: &[AssetValuationRow],
    effective_as_of: NaiveDate,
    asset_class: &str,
) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            let stale_days = (effective_as_of - row.snapshot_date).num_days();
            json!({
                "asset_class": asset_class,
                "account_id": row.account_id,
                "account_name": row.account_name,
                "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
                "value_cents": row.value_cents,
                "value_yuan": cents_to_yuan_text(row.value_cents),
                "stale_days": stale_days,
            })
        })
        .collect()
}

pub fn wealth_overview_query_at_db_path(
    db_path: &Path,
    req: WealthOverviewQueryRequest,
) -> Result<Value, String> {
    let as_of_raw = req.as_of_date.unwrap_or_default();
    let filters = parse_wealth_filters(
        req.include_investment.as_deref(),
        req.include_cash.as_deref(),
        req.include_real_estate.as_deref(),
        req.include_liability.as_deref(),
    )?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let latest_available = query_latest_union_date(&conn)?
        .ok_or_else(|| "当前没有可用于财富总览的数据".to_string())?;
    let requested_as_of = if as_of_raw.trim().is_empty() {
        latest_available
    } else {
        parse_iso_date(&as_of_raw, "as_of")?
    };
    let effective_as_of = if requested_as_of < latest_available {
        requested_as_of
    } else {
        latest_available
    };
    let as_of = effective_as_of.format("%Y-%m-%d").to_string();

    let investment_rows = load_overview_investment_rows(&conn, &as_of)?;
    let asset_rows = load_overview_asset_rows(&conn, &as_of)?;

    let investment_total = investment_rows.iter().map(|r| r.value_cents).sum::<i64>();
    let cash_rows = asset_rows
        .iter()
        .filter(|r| r.asset_class == "cash")
        .cloned()
        .collect::<Vec<_>>();
    let real_estate_rows = asset_rows
        .iter()
        .filter(|r| r.asset_class == "real_estate")
        .cloned()
        .collect::<Vec<_>>();
    let liability_rows = asset_rows
        .iter()
        .filter(|r| r.asset_class == "liability")
        .cloned()
        .collect::<Vec<_>>();
    let cash_total = cash_rows.iter().map(|r| r.value_cents).sum::<i64>();
    let real_estate_total = real_estate_rows.iter().map(|r| r.value_cents).sum::<i64>();
    let liability_total = liability_rows.iter().map(|r| r.value_cents).sum::<i64>();

    let gross_assets_total = (if filters.include_investment {
        investment_total
    } else {
        0
    }) + (if filters.include_cash { cash_total } else { 0 })
        + (if filters.include_real_estate {
            real_estate_total
        } else {
            0
        });
    let selected_liability_total = if filters.include_liability {
        liability_total
    } else {
        0
    };
    let net_asset_total = gross_assets_total - selected_liability_total;

    let investment_items = map_overview_items(&investment_rows, effective_as_of, "investment");
    let cash_items = map_asset_items(&cash_rows, effective_as_of, "cash");
    let real_estate_items = map_asset_items(&real_estate_rows, effective_as_of, "real_estate");
    let liability_items = map_asset_items(&liability_rows, effective_as_of, "liability");

    let mut selected_rows = Vec::<Value>::new();
    if filters.include_investment {
        selected_rows.extend(investment_items);
    }
    if filters.include_cash {
        selected_rows.extend(cash_items);
    }
    if filters.include_real_estate {
        selected_rows.extend(real_estate_items);
    }
    if filters.include_liability {
        selected_rows.extend(liability_items);
    }

    let selected_rows_assets_total_cents = selected_rows
        .iter()
        .filter(|row| row.get("asset_class").and_then(Value::as_str) != Some("liability"))
        .map(|row| row.get("value_cents").and_then(Value::as_i64).unwrap_or(0))
        .sum::<i64>();
    let selected_rows_liability_total_cents = selected_rows
        .iter()
        .filter(|row| row.get("asset_class").and_then(Value::as_str) == Some("liability"))
        .map(|row| row.get("value_cents").and_then(Value::as_i64).unwrap_or(0))
        .sum::<i64>();
    let selected_rows_total_cents =
        selected_rows_assets_total_cents - selected_rows_liability_total_cents;
    let reconciliation_delta_cents = selected_rows_total_cents - net_asset_total;
    let stale_account_count = selected_rows
        .iter()
        .filter(|row| row.get("stale_days").and_then(Value::as_i64).unwrap_or(0) > 0)
        .count();

    Ok(json!({
        "as_of": as_of,
        "requested_as_of": requested_as_of.format("%Y-%m-%d").to_string(),
        "filters": {
            "include_investment": filters.include_investment,
            "include_cash": filters.include_cash,
            "include_real_estate": filters.include_real_estate,
            "include_liability": filters.include_liability,
        },
        "summary": {
            "investment_total_cents": investment_total,
            "investment_total_yuan": cents_to_yuan_text(investment_total),
            "cash_total_cents": cash_total,
            "cash_total_yuan": cents_to_yuan_text(cash_total),
            "real_estate_total_cents": real_estate_total,
            "real_estate_total_yuan": cents_to_yuan_text(real_estate_total),
            "liability_total_cents": liability_total,
            "liability_total_yuan": cents_to_yuan_text(liability_total),
            "wealth_total_cents": gross_assets_total,
            "wealth_total_yuan": cents_to_yuan_text(gross_assets_total),
            "gross_assets_total_cents": gross_assets_total,
            "gross_assets_total_yuan": cents_to_yuan_text(gross_assets_total),
            "net_asset_total_cents": net_asset_total,
            "net_asset_total_yuan": cents_to_yuan_text(net_asset_total),
            "selected_rows_total_cents": selected_rows_total_cents,
            "selected_rows_total_yuan": cents_to_yuan_text(selected_rows_total_cents),
            "selected_rows_assets_total_cents": selected_rows_assets_total_cents,
            "selected_rows_assets_total_yuan": cents_to_yuan_text(selected_rows_assets_total_cents),
            "selected_rows_liability_total_cents": selected_rows_liability_total_cents,
            "selected_rows_liability_total_yuan": cents_to_yuan_text(selected_rows_liability_total_cents),
            "reconciliation_delta_cents": reconciliation_delta_cents,
            "reconciliation_delta_yuan": cents_to_yuan_text(reconciliation_delta_cents),
            "reconciliation_ok": reconciliation_delta_cents == 0,
            "stale_account_count": stale_account_count,
        },
        "rows": selected_rows,
    }))
}

fn load_investment_history_for_curve(
    conn: &Connection,
    effective_to: NaiveDate,
) -> Result<Vec<AsOfHistoryRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                account_id,
                snapshot_date,
                total_assets_cents AS value_cents,
                transfer_amount_cents AS flow_cents
            FROM investment_records
            WHERE snapshot_date <= ?1
            ORDER BY account_id, snapshot_date
            "#,
        )
        .map_err(|e| format!("查询投资历史失败: {e}"))?;
    let iter = stmt
        .query_map(
            params![effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询投资历史失败: {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, date_raw, value_cents, flow_cents) =
            row.map_err(|e| format!("读取投资历史失败: {e}"))?;
        out.push(AsOfHistoryRow {
            account_id,
            snapshot_date: parse_iso_date(&date_raw, "snapshot_date")?,
            value_cents,
            flow_cents,
        });
    }
    Ok(out)
}

fn load_asset_history_for_curve(
    conn: &Connection,
    asset_class: &str,
    effective_to: NaiveDate,
) -> Result<Vec<AsOfHistoryRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT account_id, snapshot_date, value_cents
            FROM account_valuations
            WHERE asset_class = ?1 AND snapshot_date <= ?2
            ORDER BY account_id, snapshot_date
            "#,
        )
        .map_err(|e| format!("查询资产历史失败 ({asset_class}): {e}"))?;
    let iter = stmt
        .query_map(
            params![asset_class, effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|e| format!("查询资产历史失败 ({asset_class}): {e}"))?;
    let mut out = Vec::new();
    for row in iter {
        let (account_id, date_raw, value_cents) =
            row.map_err(|e| format!("读取资产历史失败 ({asset_class}): {e}"))?;
        out.push(AsOfHistoryRow {
            account_id,
            snapshot_date: parse_iso_date(&date_raw, "snapshot_date")?,
            value_cents,
            flow_cents: 0,
        });
    }
    Ok(out)
}

pub fn wealth_curve_query_at_db_path(
    db_path: &Path,
    req: WealthCurveQueryRequest,
) -> Result<Value, String> {
    let preset = parse_preset_with_default(req.preset.as_deref(), "1y")?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();
    let filters = parse_wealth_filters(
        req.include_investment.as_deref(),
        req.include_cash.as_deref(),
        req.include_real_estate.as_deref(),
        req.include_liability.as_deref(),
    )?;

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let (earliest, latest) =
        query_union_bounds(&conn)?.ok_or_else(|| "当前没有可用于曲线展示的数据".to_string())?;
    let window = resolve_window(&preset, &from_raw, &to_raw, earliest, latest)?;

    let mut date_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date
            FROM (
                SELECT snapshot_date FROM investment_records WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
                UNION
                SELECT snapshot_date FROM account_valuations WHERE snapshot_date >= ?3 AND snapshot_date <= ?4
            )
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询财富曲线日期点失败: {e}"))?;
    let date_iter = date_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string(),
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询财富曲线日期点失败: {e}"))?;

    let mut date_set = Vec::<NaiveDate>::new();
    for row in date_iter {
        let d_raw = row.map_err(|e| format!("读取财富曲线日期点失败: {e}"))?;
        date_set.push(parse_iso_date(&d_raw, "snapshot_date")?);
    }
    date_set.push(window.effective_from);
    date_set.push(window.effective_to);
    date_set.sort_unstable();
    date_set.dedup();
    let dates = date_set;

    let investment_history = load_investment_history_for_curve(&conn, window.effective_to)?;
    let cash_history = load_asset_history_for_curve(&conn, "cash", window.effective_to)?;
    let real_estate_history =
        load_asset_history_for_curve(&conn, "real_estate", window.effective_to)?;
    let liability_history = load_asset_history_for_curve(&conn, "liability", window.effective_to)?;

    let investment_totals = build_asof_totals(&dates, &investment_history);
    let cash_totals = build_asof_totals(&dates, &cash_history);
    let real_estate_totals = build_asof_totals(&dates, &real_estate_history);
    let liability_totals = build_asof_totals(&dates, &liability_history);

    let mut rows = Vec::<Value>::new();
    let mut first_investment_total = 0_i64;
    let mut first_cash_total = 0_i64;
    let mut first_real_estate_total = 0_i64;
    let mut first_liability_total = 0_i64;
    let mut first_wealth_total = 0_i64;
    let mut first_net_asset_total = 0_i64;

    for d in &dates {
        let key = d.format("%Y-%m-%d").to_string();
        let inv = *investment_totals.get(&key).unwrap_or(&0);
        let cash = *cash_totals.get(&key).unwrap_or(&0);
        let re = *real_estate_totals.get(&key).unwrap_or(&0);
        let liability = *liability_totals.get(&key).unwrap_or(&0);

        let wealth = (if filters.include_investment { inv } else { 0 })
            + (if filters.include_cash { cash } else { 0 })
            + (if filters.include_real_estate { re } else { 0 });
        let selected_liability = if filters.include_liability {
            liability
        } else {
            0
        };
        let net_asset = wealth - selected_liability;

        if rows.is_empty() {
            first_investment_total = inv;
            first_cash_total = cash;
            first_real_estate_total = re;
            first_liability_total = liability;
            first_wealth_total = wealth;
            first_net_asset_total = net_asset;
        }

        let wealth_net_growth_cents = wealth - first_wealth_total;
        let liability_net_growth_cents = liability - first_liability_total;
        let net_asset_net_growth_cents = net_asset - first_net_asset_total;
        let investment_net_growth_cents = inv - first_investment_total;
        let cash_net_growth_cents = cash - first_cash_total;
        let real_estate_net_growth_cents = re - first_real_estate_total;

        rows.push(json!({
            "snapshot_date": key,
            "investment_total_cents": inv,
            "cash_total_cents": cash,
            "real_estate_total_cents": re,
            "liability_total_cents": liability,
            "wealth_total_cents": wealth,
            "wealth_total_yuan": cents_to_yuan_text(wealth),
            "net_asset_total_cents": net_asset,
            "net_asset_total_yuan": cents_to_yuan_text(net_asset),
            "wealth_net_growth_cents": wealth_net_growth_cents,
            "wealth_net_growth_yuan": cents_to_yuan_text(wealth_net_growth_cents),
            "liability_net_growth_cents": liability_net_growth_cents,
            "net_asset_net_growth_cents": net_asset_net_growth_cents,
            "investment_net_growth_cents": investment_net_growth_cents,
            "cash_net_growth_cents": cash_net_growth_cents,
            "real_estate_net_growth_cents": real_estate_net_growth_cents,
        }));
    }

    let first_total = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("wealth_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let last_total = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("wealth_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let change_cents = last_total - first_total;
    let change_pct = if first_total > 0 {
        Some(change_cents as f64 / first_total as f64)
    } else {
        None
    };

    let start_liability_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("liability_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_liability_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("liability_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let liability_total_change_cents = end_liability_cents - start_liability_cents;
    let liability_change_pct = if start_liability_cents > 0 {
        Some(liability_total_change_cents as f64 / start_liability_cents as f64)
    } else {
        None
    };

    let start_net_asset_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("net_asset_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_net_asset_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("net_asset_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let net_asset_change_cents = end_net_asset_cents - start_net_asset_cents;
    let net_asset_change_pct = if start_net_asset_cents > 0 {
        Some(net_asset_change_cents as f64 / start_net_asset_cents as f64)
    } else {
        None
    };

    let start_investment_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("investment_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_investment_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("investment_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let investment_net_growth_cents = end_investment_cents - start_investment_cents;
    let investment_change_pct = if start_investment_cents > 0 {
        Some(investment_net_growth_cents as f64 / start_investment_cents as f64)
    } else {
        None
    };

    let start_cash_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("cash_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_cash_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("cash_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let cash_net_growth_cents = end_cash_cents - start_cash_cents;
    let cash_change_pct = if start_cash_cents > 0 {
        Some(cash_net_growth_cents as f64 / start_cash_cents as f64)
    } else {
        None
    };

    let start_real_estate_cents = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("real_estate_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let end_real_estate_cents = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("real_estate_total_cents"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let real_estate_net_growth_cents = end_real_estate_cents - start_real_estate_cents;
    let real_estate_change_pct = if start_real_estate_cents > 0 {
        Some(real_estate_net_growth_cents as f64 / start_real_estate_cents as f64)
    } else {
        None
    };

    let requested_to = if to_raw.trim().is_empty() {
        window.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(&to_raw, "to")?
            .format("%Y-%m-%d")
            .to_string()
    };
    let effective_from_out = rows
        .first()
        .and_then(Value::as_object)
        .and_then(|o| o.get("snapshot_date"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| window.effective_from.format("%Y-%m-%d").to_string());
    let effective_to_out = rows
        .last()
        .and_then(Value::as_object)
        .and_then(|o| o.get("snapshot_date"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| window.effective_to.format("%Y-%m-%d").to_string());

    let range = json!({
        "preset": preset,
        "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
        "requested_to": requested_to,
        "effective_from": effective_from_out,
        "effective_to": effective_to_out,
        "points": rows.len(),
    });
    let filters_json = json!({
        "include_investment": filters.include_investment,
        "include_cash": filters.include_cash,
        "include_real_estate": filters.include_real_estate,
        "include_liability": filters.include_liability,
    });
    let summary = json!({
            "start_wealth_cents": first_total,
            "start_wealth_yuan": cents_to_yuan_text(first_total),
            "end_wealth_cents": last_total,
            "end_wealth_yuan": cents_to_yuan_text(last_total),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "net_growth_cents": change_cents,
            "net_growth_yuan": cents_to_yuan_text(change_cents),
            "change_pct": change_pct.map(|v| round_to(v, 8)),
            "change_pct_text": change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_liability_cents": start_liability_cents,
            "start_liability_yuan": cents_to_yuan_text(start_liability_cents),
            "end_liability_cents": end_liability_cents,
            "end_liability_yuan": cents_to_yuan_text(end_liability_cents),
            "liability_net_growth_cents": liability_total_change_cents,
            "liability_net_growth_yuan": cents_to_yuan_text(liability_total_change_cents),
            "liability_change_pct": liability_change_pct.map(|v| round_to(v, 8)),
            "liability_change_pct_text": liability_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_net_asset_cents": start_net_asset_cents,
            "start_net_asset_yuan": cents_to_yuan_text(start_net_asset_cents),
            "end_net_asset_cents": end_net_asset_cents,
            "end_net_asset_yuan": cents_to_yuan_text(end_net_asset_cents),
            "net_asset_change_cents": net_asset_change_cents,
            "net_asset_change_yuan": cents_to_yuan_text(net_asset_change_cents),
            "net_asset_net_growth_cents": net_asset_change_cents,
            "net_asset_net_growth_yuan": cents_to_yuan_text(net_asset_change_cents),
            "net_asset_change_pct": net_asset_change_pct.map(|v| round_to(v, 8)),
            "net_asset_change_pct_text": net_asset_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_investment_cents": start_investment_cents,
            "start_investment_yuan": cents_to_yuan_text(start_investment_cents),
            "end_investment_cents": end_investment_cents,
            "end_investment_yuan": cents_to_yuan_text(end_investment_cents),
            "investment_net_growth_cents": investment_net_growth_cents,
            "investment_net_growth_yuan": cents_to_yuan_text(investment_net_growth_cents),
            "investment_change_pct": investment_change_pct.map(|v| round_to(v, 8)),
            "investment_change_pct_text": investment_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_cash_cents": start_cash_cents,
            "start_cash_yuan": cents_to_yuan_text(start_cash_cents),
            "end_cash_cents": end_cash_cents,
            "end_cash_yuan": cents_to_yuan_text(end_cash_cents),
            "cash_net_growth_cents": cash_net_growth_cents,
            "cash_net_growth_yuan": cents_to_yuan_text(cash_net_growth_cents),
            "cash_change_pct": cash_change_pct.map(|v| round_to(v, 8)),
            "cash_change_pct_text": cash_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "start_real_estate_cents": start_real_estate_cents,
            "start_real_estate_yuan": cents_to_yuan_text(start_real_estate_cents),
            "end_real_estate_cents": end_real_estate_cents,
            "end_real_estate_yuan": cents_to_yuan_text(end_real_estate_cents),
            "real_estate_net_growth_cents": real_estate_net_growth_cents,
            "real_estate_net_growth_yuan": cents_to_yuan_text(real_estate_net_growth_cents),
            "real_estate_change_pct": real_estate_change_pct.map(|v| round_to(v, 8)),
            "real_estate_change_pct_text": real_estate_change_pct.map(|v| format!("{:.2}%", v * 100.0)),
    });

    Ok(json!({
        "range": range,
        "filters": filters_json,
        "summary": summary,
        "rows": rows,
    }))
}

#[tauri::command]
pub fn wealth_overview_query(
    app: AppHandle,
    req: WealthOverviewQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    wealth_overview_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn wealth_curve_query(app: AppHandle, req: WealthCurveQueryRequest) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    wealth_curve_query_at_db_path(&db_path, req)
}
