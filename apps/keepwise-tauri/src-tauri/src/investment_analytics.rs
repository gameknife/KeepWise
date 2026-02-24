use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use tauri::AppHandle;

use crate::ledger_db::resolve_ledger_db_path;

const PORTFOLIO_ACCOUNT_ID: &str = "__portfolio__";
const PORTFOLIO_ACCOUNT_NAME: &str = "全部投资账户（组合）";
const SUPPORTED_PRESETS: &[&str] = &["ytd", "1y", "3y", "since_inception", "custom"];

#[derive(Debug, Deserialize)]
pub struct InvestmentReturnQueryRequest {
    pub account_id: String,
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentCurveQueryRequest {
    pub account_id: String,
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct InvestmentReturnsQueryRequest {
    pub preset: Option<String>,
    #[serde(rename = "from")]
    pub from_date: Option<String>,
    #[serde(rename = "to")]
    pub to_date: Option<String>,
    pub keyword: Option<String>,
    pub limit: Option<u32>,
}

pub fn investment_return_query_at_db_path(
    db_path: &Path,
    req: InvestmentReturnQueryRequest,
) -> Result<Value, String> {
    let account_id = req.account_id.trim().to_string();
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }
    let preset = parse_preset(req.preset.as_deref())?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;

    if account_id == PORTFOLIO_ACCOUNT_ID {
        build_portfolio_investment_return_payload(&conn, &preset, &from_raw, &to_raw)
    } else {
        build_single_account_investment_return_payload(
            &conn,
            &account_id,
            &preset,
            &from_raw,
            &to_raw,
        )
    }
}

#[derive(Debug, Clone)]
struct Window {
    requested_from: NaiveDate,
    effective_from: NaiveDate,
    effective_to: NaiveDate,
    latest: NaiveDate,
}

#[derive(Debug)]
struct TransferRow {
    snapshot_date: NaiveDate,
    transfer_amount_cents: i64,
}

#[derive(Debug)]
struct ModifiedDietzCalc {
    interval_days: i64,
    net_flow_cents: i64,
    profit_cents: i64,
    weighted_capital_cents: i64,
    return_rate: Option<f64>,
    annualized_rate: Option<f64>,
    note: String,
    cash_flows: Vec<Value>,
}

#[derive(Debug)]
struct AccountBounds {
    account_name: String,
    earliest: NaiveDate,
    latest: NaiveDate,
}

#[derive(Debug)]
struct SnapshotRow {
    snapshot_date: NaiveDate,
    total_assets_cents: i64,
}

#[derive(Debug)]
struct PortfolioBounds {
    earliest: NaiveDate,
    latest: NaiveDate,
    account_count: i64,
}

#[derive(Debug)]
struct PortfolioHistoryRow {
    account_id: String,
    snapshot_date: NaiveDate,
    value_cents: i64,
    flow_cents: i64,
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

fn parse_preset(raw: Option<&str>) -> Result<String, String> {
    parse_preset_with_default(raw, "ytd")
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

fn parse_db_date(s: String, field: &str) -> Result<NaiveDate, String> {
    parse_iso_date(&s, field)
}

fn load_investment_account_bounds(
    conn: &Connection,
    account_id: &str,
) -> Result<AccountBounds, String> {
    let row = conn
        .query_row(
            r#"
            SELECT
              COALESCE(a.name, r.account_id) AS account_name,
              MIN(r.snapshot_date) AS earliest_date,
              MAX(r.snapshot_date) AS latest_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            WHERE r.account_id = ?1
            GROUP BY r.account_id
            "#,
            params![account_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("查询投资账户边界失败: {e}"))?;

    let Some((account_name, earliest_raw, latest_raw)) = row else {
        return Err("未找到该投资账户的记录".to_string());
    };

    Ok(AccountBounds {
        account_name,
        earliest: parse_db_date(earliest_raw, "earliest_date")?,
        latest: parse_db_date(latest_raw, "latest_date")?,
    })
}

fn load_portfolio_bounds(conn: &Connection) -> Result<PortfolioBounds, String> {
    let row = conn
        .query_row(
            r#"
            SELECT
              MIN(snapshot_date) AS earliest_date,
              MAX(snapshot_date) AS latest_date,
              COUNT(DISTINCT account_id) AS account_count
            FROM investment_records
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .map_err(|e| format!("查询组合边界失败: {e}"))?;

    let (earliest_raw, latest_raw, account_count) = row;
    let Some(earliest_raw) = earliest_raw else {
        return Err("未找到可用的投资记录".to_string());
    };
    let Some(latest_raw) = latest_raw else {
        return Err("未找到可用的投资记录".to_string());
    };
    if account_count <= 0 {
        return Err("未找到可用的投资账户".to_string());
    }

    Ok(PortfolioBounds {
        earliest: parse_db_date(earliest_raw, "earliest_date")?,
        latest: parse_db_date(latest_raw, "latest_date")?,
        account_count,
    })
}

fn select_begin_snapshot(
    conn: &Connection,
    account_id: &str,
    window_from: NaiveDate,
    window_to: NaiveDate,
) -> Result<Option<SnapshotRow>, String> {
    let fetch =
        |sql: &str, params_any: &[&dyn rusqlite::ToSql]| -> Result<Option<SnapshotRow>, String> {
            conn.query_row(sql, params_any, |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .optional()
            .map_err(|e| format!("查询期初快照失败: {e}"))?
            .map(|(date_raw, total_assets_cents)| {
                Ok(SnapshotRow {
                    snapshot_date: parse_db_date(date_raw, "snapshot_date")?,
                    total_assets_cents,
                })
            })
            .transpose()
        };

    let wf = window_from.format("%Y-%m-%d").to_string();
    let wt = window_to.format("%Y-%m-%d").to_string();

    if let Some(row) = fetch(
        r#"
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ?1 AND snapshot_date <= ?2 AND total_assets_cents > 0
        ORDER BY snapshot_date DESC
        LIMIT 1
        "#,
        &[&account_id, &wf],
    )? {
        return Ok(Some(row));
    }

    if let Some(row) = fetch(
        r#"
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3 AND total_assets_cents > 0
        ORDER BY snapshot_date ASC
        LIMIT 1
        "#,
        &[&account_id, &wf, &wt],
    )? {
        return Ok(Some(row));
    }

    fetch(
        r#"
        SELECT snapshot_date, total_assets_cents
        FROM investment_records
        WHERE account_id = ?1 AND snapshot_date <= ?2
        ORDER BY snapshot_date DESC
        LIMIT 1
        "#,
        &[&account_id, &wf],
    )
}

fn select_end_snapshot(
    conn: &Connection,
    account_id: &str,
    begin_date: NaiveDate,
    window_to: NaiveDate,
) -> Result<Option<SnapshotRow>, String> {
    let bd = begin_date.format("%Y-%m-%d").to_string();
    let wt = window_to.format("%Y-%m-%d").to_string();
    let first = conn
        .query_row(
            r#"
            SELECT snapshot_date, total_assets_cents
            FROM investment_records
            WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3 AND total_assets_cents > 0
            ORDER BY snapshot_date DESC
            LIMIT 1
            "#,
            params![account_id, bd, wt],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|e| format!("查询期末快照失败: {e}"))?;
    let row = match first {
        Some(r) => Some(r),
        None => conn
            .query_row(
                r#"
                SELECT snapshot_date, total_assets_cents
                FROM investment_records
                WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3
                ORDER BY snapshot_date DESC
                LIMIT 1
                "#,
                params![
                    account_id,
                    begin_date.format("%Y-%m-%d").to_string(),
                    window_to.format("%Y-%m-%d").to_string()
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|e| format!("查询期末快照失败: {e}"))?,
    };
    row.map(|(date_raw, total_assets_cents)| {
        Ok(SnapshotRow {
            snapshot_date: parse_db_date(date_raw, "snapshot_date")?,
            total_assets_cents,
        })
    })
    .transpose()
}

fn load_transfer_rows(
    conn: &Connection,
    account_id: &str,
    begin_date: NaiveDate,
    end_date: NaiveDate,
) -> Result<Vec<TransferRow>, String> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, transfer_amount_cents
            FROM investment_records
            WHERE account_id = ?1
              AND snapshot_date > ?2
              AND snapshot_date <= ?3
              AND transfer_amount_cents != 0
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询资金流失败: {e}"))?;

    let rows = stmt
        .query_map(
            params![
                account_id,
                begin_date.format("%Y-%m-%d").to_string(),
                end_date.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询资金流失败: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let (date_raw, cents) = row.map_err(|e| format!("读取资金流行失败: {e}"))?;
        out.push(TransferRow {
            snapshot_date: parse_db_date(date_raw, "flow_date")?,
            transfer_amount_cents: cents,
        });
    }
    Ok(out)
}

fn calculate_modified_dietz(
    begin_date: NaiveDate,
    end_date: NaiveDate,
    begin_assets_cents: i64,
    end_assets_cents: i64,
    flow_rows: &[TransferRow],
    allow_zero_interval: bool,
) -> Result<ModifiedDietzCalc, String> {
    let interval_days = (end_date - begin_date).num_days();
    if interval_days < 0 {
        return Err("结束日期不能早于开始日期".to_string());
    }
    if interval_days == 0 && !allow_zero_interval {
        return Err("区间内有效快照不足，无法计算收益率".to_string());
    }

    let net_flow_cents = flow_rows
        .iter()
        .map(|r| r.transfer_amount_cents)
        .sum::<i64>();
    let profit_cents = end_assets_cents - begin_assets_cents - net_flow_cents;

    let mut weighted_flow = 0.0_f64;
    let mut cash_flows = Vec::new();
    for row in flow_rows {
        let flow_cents = row.transfer_amount_cents;
        if flow_cents == 0 {
            continue;
        }
        let weight = if interval_days > 0 {
            (end_date - row.snapshot_date).num_days() as f64 / interval_days as f64
        } else {
            0.0
        };
        weighted_flow += (flow_cents as f64) * weight;
        cash_flows.push(json!({
            "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
            "transfer_amount_cents": flow_cents,
            "transfer_amount_yuan": cents_to_yuan_text(flow_cents),
            "weight": round_to(weight, 6),
        }));
    }

    let denominator = begin_assets_cents as f64 + weighted_flow;
    let (return_rate, annualized_rate, note) = if interval_days == 0 {
        if denominator <= 0.0 {
            (
                None,
                None,
                "加权本金小于等于 0，无法计算现金加权收益率。".to_string(),
            )
        } else {
            (Some(0.0), None, String::new())
        }
    } else if denominator <= 0.0 {
        (
            None,
            None,
            "加权本金小于等于 0，无法计算现金加权收益率。".to_string(),
        )
    } else {
        let rr = profit_cents as f64 / denominator;
        let annualized = if 1.0 + rr > 0.0 {
            Some((1.0 + rr).powf(365.0 / interval_days as f64) - 1.0)
        } else {
            None
        };
        (Some(rr), annualized, String::new())
    };

    Ok(ModifiedDietzCalc {
        interval_days,
        net_flow_cents,
        profit_cents,
        weighted_capital_cents: denominator.round() as i64,
        return_rate,
        annualized_rate,
        note,
        cash_flows,
    })
}

fn build_portfolio_asof_totals(
    dates: &[NaiveDate],
    history_rows: &[PortfolioHistoryRow],
) -> HashMap<String, i64> {
    let mut totals = HashMap::<String, i64>::new();
    for d in dates {
        totals.insert(d.format("%Y-%m-%d").to_string(), 0);
    }

    let mut by_account: HashMap<String, Vec<&PortfolioHistoryRow>> = HashMap::new();
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
                    // keep previous current for compatibility with Python behavior
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

fn build_single_account_investment_return_payload(
    conn: &Connection,
    account_id: &str,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_investment_account_bounds(conn, account_id)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;

    let begin_row =
        select_begin_snapshot(conn, account_id, window.effective_from, window.effective_to)?
            .ok_or_else(|| "区间内没有可用的期初资产记录".to_string())?;
    let begin_date = begin_row.snapshot_date;
    let begin_assets = begin_row.total_assets_cents;

    let end_row = select_end_snapshot(conn, account_id, begin_date, window.effective_to)?
        .ok_or_else(|| "区间内没有可用的期末资产记录".to_string())?;
    let end_date = end_row.snapshot_date;
    if begin_date >= end_date {
        return Err("区间内有效快照不足，无法计算收益率".to_string());
    }
    let end_assets = end_row.total_assets_cents;

    let flow_rows = load_transfer_rows(conn, account_id, begin_date, end_date)?;
    let calc = calculate_modified_dietz(
        begin_date,
        end_date,
        begin_assets,
        end_assets,
        &flow_rows,
        false,
    )?;

    let requested_to = if to_raw.trim().is_empty() {
        window.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };
    let return_rate = calc.return_rate.map(|v| round_to(v, 8));
    let annualized_rate = calc.annualized_rate.map(|v| round_to(v, 8));

    Ok(json!({
        "account_id": account_id,
        "account_name": bounds.account_name,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": begin_date.format("%Y-%m-%d").to_string(),
            "effective_to": end_date.format("%Y-%m-%d").to_string(),
            "interval_days": calc.interval_days,
        },
        "metrics": {
            "begin_assets_cents": begin_assets,
            "begin_assets_yuan": cents_to_yuan_text(begin_assets),
            "end_assets_cents": end_assets,
            "end_assets_yuan": cents_to_yuan_text(end_assets),
            "net_flow_cents": calc.net_flow_cents,
            "net_flow_yuan": cents_to_yuan_text(calc.net_flow_cents),
            "profit_cents": calc.profit_cents,
            "profit_yuan": cents_to_yuan_text(calc.profit_cents),
            "net_growth_cents": calc.profit_cents,
            "net_growth_yuan": cents_to_yuan_text(calc.profit_cents),
            "weighted_capital_cents": calc.weighted_capital_cents,
            "weighted_capital_yuan": cents_to_yuan_text(calc.weighted_capital_cents),
            "return_rate": return_rate,
            "return_rate_pct": return_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "annualized_rate": annualized_rate,
            "annualized_rate_pct": annualized_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "note": calc.note,
        },
        "cash_flows": calc.cash_flows,
    }))
}

fn build_portfolio_investment_return_payload(
    conn: &Connection,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_portfolio_bounds(conn)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;
    if window.effective_from >= window.effective_to {
        return Err("区间内有效快照不足，无法计算收益率".to_string());
    }

    let mut dates = Vec::<NaiveDate>::new();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合日期点失败: {e}"))?;
    let rows = stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询组合日期点失败: {e}"))?;
    for row in rows {
        let d = parse_db_date(
            row.map_err(|e| format!("读取组合日期点失败: {e}"))?,
            "snapshot_date",
        )?;
        dates.push(d);
    }
    if !dates.contains(&window.effective_from) {
        dates.push(window.effective_from);
    }
    if !dates.contains(&window.effective_to) {
        dates.push(window.effective_to);
    }
    dates.sort_unstable();
    dates.dedup();

    let mut history_stmt = conn
        .prepare(
            r#"
            SELECT account_id, snapshot_date, total_assets_cents AS value_cents, transfer_amount_cents AS flow_cents
            FROM investment_records
            WHERE snapshot_date <= ?1
            ORDER BY account_id, snapshot_date
            "#,
        )
        .map_err(|e| format!("查询组合历史失败: {e}"))?;
    let history_iter = history_stmt
        .query_map(
            params![window.effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询组合历史失败: {e}"))?;

    let mut history_rows = Vec::new();
    for row in history_iter {
        let (account_id, snapshot_date_raw, value_cents, flow_cents) =
            row.map_err(|e| format!("读取组合历史失败: {e}"))?;
        history_rows.push(PortfolioHistoryRow {
            account_id,
            snapshot_date: parse_db_date(snapshot_date_raw, "snapshot_date")?,
            value_cents,
            flow_cents,
        });
    }
    if history_rows.is_empty() {
        return Err("区间内没有可用的投资记录".to_string());
    }

    let totals = build_portfolio_asof_totals(&dates, &history_rows);
    let begin_assets = *totals
        .get(&window.effective_from.format("%Y-%m-%d").to_string())
        .unwrap_or(&0);
    let end_assets = *totals
        .get(&window.effective_to.format("%Y-%m-%d").to_string())
        .unwrap_or(&0);

    let mut flow_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records
            WHERE snapshot_date > ?1 AND snapshot_date <= ?2 AND transfer_amount_cents != 0
            GROUP BY snapshot_date
            HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合资金流失败: {e}"))?;
    let flow_iter = flow_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询组合资金流失败: {e}"))?;
    let mut flow_rows = Vec::new();
    for row in flow_iter {
        let (d_raw, amount) = row.map_err(|e| format!("读取组合资金流失败: {e}"))?;
        flow_rows.push(TransferRow {
            snapshot_date: parse_db_date(d_raw, "snapshot_date")?,
            transfer_amount_cents: amount,
        });
    }
    let calc = calculate_modified_dietz(
        window.effective_from,
        window.effective_to,
        begin_assets,
        end_assets,
        &flow_rows,
        false,
    )?;

    let requested_to = if to_raw.trim().is_empty() {
        window.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };
    let return_rate = calc.return_rate.map(|v| round_to(v, 8));
    let annualized_rate = calc.annualized_rate.map(|v| round_to(v, 8));

    Ok(json!({
        "account_id": PORTFOLIO_ACCOUNT_ID,
        "account_name": PORTFOLIO_ACCOUNT_NAME,
        "account_count": bounds.account_count,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": window.effective_from.format("%Y-%m-%d").to_string(),
            "effective_to": window.effective_to.format("%Y-%m-%d").to_string(),
            "interval_days": calc.interval_days,
        },
        "metrics": {
            "begin_assets_cents": begin_assets,
            "begin_assets_yuan": cents_to_yuan_text(begin_assets),
            "end_assets_cents": end_assets,
            "end_assets_yuan": cents_to_yuan_text(end_assets),
            "net_flow_cents": calc.net_flow_cents,
            "net_flow_yuan": cents_to_yuan_text(calc.net_flow_cents),
            "profit_cents": calc.profit_cents,
            "profit_yuan": cents_to_yuan_text(calc.profit_cents),
            "net_growth_cents": calc.profit_cents,
            "net_growth_yuan": cents_to_yuan_text(calc.profit_cents),
            "weighted_capital_cents": calc.weighted_capital_cents,
            "weighted_capital_yuan": cents_to_yuan_text(calc.weighted_capital_cents),
            "return_rate": return_rate,
            "return_rate_pct": return_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "annualized_rate": annualized_rate,
            "annualized_rate_pct": annualized_rate.map(|v| format!("{:.2}%", v * 100.0)),
            "note": calc.note,
        },
        "cash_flows": calc.cash_flows,
    }))
}

fn build_single_account_investment_curve_payload(
    conn: &Connection,
    account_id: &str,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_investment_account_bounds(conn, account_id)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;

    let begin_row =
        select_begin_snapshot(conn, account_id, window.effective_from, window.effective_to)?
            .ok_or_else(|| "区间内没有可用的期初资产记录".to_string())?;
    let begin_date = begin_row.snapshot_date;
    let begin_assets = begin_row.total_assets_cents;

    let final_end_row = select_end_snapshot(conn, account_id, begin_date, window.effective_to)?
        .ok_or_else(|| "区间内没有可用的期末资产记录".to_string())?;
    let final_end_date = final_end_row.snapshot_date;
    if final_end_date < begin_date {
        return Err("区间内有效快照不足，无法生成曲线".to_string());
    }

    let mut date_stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE account_id = ?1 AND snapshot_date >= ?2 AND snapshot_date <= ?3
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询投资曲线日期点失败: {e}"))?;
    let date_iter = date_stmt
        .query_map(
            params![
                account_id,
                begin_date.format("%Y-%m-%d").to_string(),
                final_end_date.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询投资曲线日期点失败: {e}"))?;
    let mut candidate_dates = Vec::<NaiveDate>::new();
    for row in date_iter {
        candidate_dates.push(parse_db_date(
            row.map_err(|e| format!("读取投资曲线日期点失败: {e}"))?,
            "snapshot_date",
        )?);
    }
    candidate_dates.push(begin_date);
    candidate_dates.push(final_end_date);
    candidate_dates.sort_unstable();
    candidate_dates.dedup();

    let mut transfer_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records
            WHERE account_id = ?1
              AND snapshot_date >= ?2
              AND snapshot_date <= ?3
              AND transfer_amount_cents != 0
            GROUP BY snapshot_date
            HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
            "#,
        )
        .map_err(|e| format!("查询投资曲线资金流失败: {e}"))?;
    let transfer_iter = transfer_stmt
        .query_map(
            params![
                account_id,
                begin_date.format("%Y-%m-%d").to_string(),
                final_end_date.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询投资曲线资金流失败: {e}"))?;
    let mut transfer_by_date = HashMap::<String, i64>::new();
    for row in transfer_iter {
        let (d, cents) = row.map_err(|e| format!("读取投资曲线资金流失败: {e}"))?;
        transfer_by_date.insert(d, cents);
    }

    let mut rows = Vec::<Value>::new();
    for point_date in &candidate_dates {
        let point_date_text = point_date.format("%Y-%m-%d").to_string();
        let point_end_row = select_end_snapshot(conn, account_id, begin_date, *point_date)?;
        let Some(point_end_row) = point_end_row else {
            continue;
        };

        let point_end_date = point_end_row.snapshot_date;
        let point_end_assets = point_end_row.total_assets_cents;
        let point_flows = load_transfer_rows(conn, account_id, begin_date, point_end_date)?;
        let point_calc = calculate_modified_dietz(
            begin_date,
            point_end_date,
            begin_assets,
            point_end_assets,
            &point_flows,
            true,
        )?;
        let cumulative_return = point_calc.return_rate.map(|v| round_to(v, 8));
        let cumulative_net_growth_cents = point_calc.profit_cents;
        let transfer_amount_cents = *transfer_by_date.get(&point_date_text).unwrap_or(&0);

        rows.push(json!({
            "snapshot_date": point_date_text,
            "effective_snapshot_date": point_end_date.format("%Y-%m-%d").to_string(),
            "total_assets_cents": point_end_assets,
            "total_assets_yuan": cents_to_yuan_text(point_end_assets),
            "transfer_amount_cents": transfer_amount_cents,
            "transfer_amount_yuan": cents_to_yuan_text(transfer_amount_cents),
            "cumulative_net_growth_cents": cumulative_net_growth_cents,
            "cumulative_net_growth_yuan": cents_to_yuan_text(cumulative_net_growth_cents),
            "cumulative_return_rate": cumulative_return,
            "cumulative_return_pct": cumulative_return.map(|v| round_to(v * 100.0, 4)),
            "cumulative_return_pct_text": cumulative_return.map(|v| format!("{:.2}%", v * 100.0)),
        }));
    }

    let requested_to = if to_raw.trim().is_empty() {
        bounds.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };

    if rows.is_empty() {
        return Ok(json!({
            "account_id": account_id,
            "account_name": bounds.account_name,
            "range": {
                "preset": preset,
                "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
                "requested_to": requested_to,
                "effective_from": begin_date.format("%Y-%m-%d").to_string(),
                "effective_to": final_end_date.format("%Y-%m-%d").to_string(),
            },
            "summary": {
                "count": 0,
                "change_cents": 0,
                "change_pct": Value::Null,
                "end_net_growth_cents": 0,
                "end_net_growth_yuan": cents_to_yuan_text(0),
                "end_cumulative_return_rate": Value::Null,
                "end_cumulative_return_pct_text": Value::Null,
            },
            "rows": rows,
        }));
    }

    let first_row = rows
        .first()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let last_row = rows
        .last()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let first_value = first_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let last_value = last_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let change_cents = last_value - first_value;
    let change_pct = if first_value > 0 {
        Some(change_cents as f64 / first_value as f64)
    } else {
        None
    };
    let end_net_growth_cents = last_row
        .get("cumulative_net_growth_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let end_cumulative_return_rate = last_row
        .get("cumulative_return_rate")
        .and_then(Value::as_f64)
        .map(|v| round_to(v, 8));
    let effective_to = last_row
        .get("effective_snapshot_date")
        .and_then(Value::as_str)
        .ok_or("曲线结果格式错误")?;

    Ok(json!({
        "account_id": account_id,
        "account_name": bounds.account_name,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": begin_date.format("%Y-%m-%d").to_string(),
            "effective_to": effective_to,
        },
        "summary": {
            "count": rows.len(),
            "start_assets_cents": first_value,
            "start_assets_yuan": cents_to_yuan_text(first_value),
            "end_assets_cents": last_value,
            "end_assets_yuan": cents_to_yuan_text(last_value),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": change_pct.map(|v| round_to(v, 8)),
            "change_pct_text": change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "end_net_growth_cents": end_net_growth_cents,
            "end_net_growth_yuan": cents_to_yuan_text(end_net_growth_cents),
            "end_cumulative_return_rate": end_cumulative_return_rate,
            "end_cumulative_return_pct_text": end_cumulative_return_rate.map(|v| format!("{:.2}%", v * 100.0)),
        },
        "rows": rows,
    }))
}

fn build_portfolio_investment_curve_payload(
    conn: &Connection,
    preset: &str,
    from_raw: &str,
    to_raw: &str,
) -> Result<Value, String> {
    let bounds = load_portfolio_bounds(conn)?;
    let window = resolve_window(preset, from_raw, to_raw, bounds.earliest, bounds.latest)?;
    if window.effective_from > window.effective_to {
        return Err("区间内有效快照不足，无法生成曲线".to_string());
    }

    let mut date_stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT snapshot_date
            FROM investment_records
            WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合曲线日期点失败: {e}"))?;
    let date_iter = date_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| format!("查询组合曲线日期点失败: {e}"))?;
    let mut dates = Vec::<NaiveDate>::new();
    for row in date_iter {
        dates.push(parse_db_date(
            row.map_err(|e| format!("读取组合曲线日期点失败: {e}"))?,
            "snapshot_date",
        )?);
    }
    dates.push(window.effective_from);
    dates.push(window.effective_to);
    dates.sort_unstable();
    dates.dedup();

    let mut history_stmt = conn
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
        .map_err(|e| format!("查询组合曲线历史失败: {e}"))?;
    let history_iter = history_stmt
        .query_map(
            params![window.effective_to.format("%Y-%m-%d").to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|e| format!("查询组合曲线历史失败: {e}"))?;
    let mut history_rows = Vec::new();
    for row in history_iter {
        let (account_id, snapshot_date_raw, value_cents, flow_cents) =
            row.map_err(|e| format!("读取组合曲线历史失败: {e}"))?;
        history_rows.push(PortfolioHistoryRow {
            account_id,
            snapshot_date: parse_db_date(snapshot_date_raw, "snapshot_date")?,
            value_cents,
            flow_cents,
        });
    }
    if history_rows.is_empty() {
        return Err("区间内没有可用的投资记录".to_string());
    }
    let totals = build_portfolio_asof_totals(&dates, &history_rows);
    let begin_assets = *totals
        .get(&window.effective_from.format("%Y-%m-%d").to_string())
        .unwrap_or(&0);

    let mut flow_stmt = conn
        .prepare(
            r#"
            SELECT snapshot_date, COALESCE(SUM(transfer_amount_cents), 0) AS transfer_amount_cents
            FROM investment_records
            WHERE snapshot_date > ?1 AND snapshot_date <= ?2 AND transfer_amount_cents != 0
            GROUP BY snapshot_date
            HAVING COALESCE(SUM(transfer_amount_cents), 0) != 0
            ORDER BY snapshot_date ASC
            "#,
        )
        .map_err(|e| format!("查询组合曲线资金流失败: {e}"))?;
    let flow_iter = flow_stmt
        .query_map(
            params![
                window.effective_from.format("%Y-%m-%d").to_string(),
                window.effective_to.format("%Y-%m-%d").to_string()
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|e| format!("查询组合曲线资金流失败: {e}"))?;
    let mut flow_points = Vec::<(String, i64)>::new();
    let mut transfer_by_date = HashMap::<String, i64>::new();
    for row in flow_iter {
        let (d, amount) = row.map_err(|e| format!("读取组合曲线资金流失败: {e}"))?;
        flow_points.push((d.clone(), amount));
        transfer_by_date.insert(d, amount);
    }

    let mut rows = Vec::<Value>::new();
    for point_date in &dates {
        let point_date_text = point_date.format("%Y-%m-%d").to_string();
        if point_date_text < window.effective_from.format("%Y-%m-%d").to_string() {
            continue;
        }
        let point_assets = *totals.get(&point_date_text).unwrap_or(&0);

        let mut point_flows = Vec::<TransferRow>::new();
        for (flow_date, flow_amount) in &flow_points {
            if flow_date > &point_date_text {
                break;
            }
            point_flows.push(TransferRow {
                snapshot_date: parse_db_date(flow_date.clone(), "snapshot_date")?,
                transfer_amount_cents: *flow_amount,
            });
        }

        let point_calc = calculate_modified_dietz(
            window.effective_from,
            *point_date,
            begin_assets,
            point_assets,
            &point_flows,
            true,
        )?;
        let cumulative_return = point_calc.return_rate.map(|v| round_to(v, 8));
        let cumulative_net_growth_cents = point_calc.profit_cents;
        let transfer_amount_cents = *transfer_by_date.get(&point_date_text).unwrap_or(&0);

        rows.push(json!({
            "snapshot_date": point_date_text,
            "effective_snapshot_date": point_date.format("%Y-%m-%d").to_string(),
            "total_assets_cents": point_assets,
            "total_assets_yuan": cents_to_yuan_text(point_assets),
            "transfer_amount_cents": transfer_amount_cents,
            "transfer_amount_yuan": cents_to_yuan_text(transfer_amount_cents),
            "cumulative_net_growth_cents": cumulative_net_growth_cents,
            "cumulative_net_growth_yuan": cents_to_yuan_text(cumulative_net_growth_cents),
            "cumulative_return_rate": cumulative_return,
            "cumulative_return_pct": cumulative_return.map(|v| round_to(v * 100.0, 4)),
            "cumulative_return_pct_text": cumulative_return.map(|v| format!("{:.2}%", v * 100.0)),
        }));
    }

    let requested_to = if to_raw.trim().is_empty() {
        bounds.latest.format("%Y-%m-%d").to_string()
    } else {
        parse_iso_date(to_raw, "to")?.format("%Y-%m-%d").to_string()
    };

    if rows.is_empty() {
        return Ok(json!({
            "account_id": PORTFOLIO_ACCOUNT_ID,
            "account_name": PORTFOLIO_ACCOUNT_NAME,
            "account_count": bounds.account_count,
            "range": {
                "preset": preset,
                "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
                "requested_to": requested_to,
                "effective_from": window.effective_from.format("%Y-%m-%d").to_string(),
                "effective_to": window.effective_to.format("%Y-%m-%d").to_string(),
            },
            "summary": {
                "count": 0,
                "change_cents": 0,
                "change_pct": Value::Null,
                "end_net_growth_cents": 0,
                "end_net_growth_yuan": cents_to_yuan_text(0),
                "end_cumulative_return_rate": Value::Null,
                "end_cumulative_return_pct_text": Value::Null,
            },
            "rows": rows,
        }));
    }

    let first_row = rows
        .first()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let last_row = rows
        .last()
        .and_then(Value::as_object)
        .ok_or("曲线结果格式错误")?;
    let first_value = first_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let last_value = last_row
        .get("total_assets_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let change_cents = last_value - first_value;
    let change_pct = if first_value > 0 {
        Some(change_cents as f64 / first_value as f64)
    } else {
        None
    };
    let end_net_growth_cents = last_row
        .get("cumulative_net_growth_cents")
        .and_then(Value::as_i64)
        .ok_or("曲线结果格式错误")?;
    let end_cumulative_return_rate = last_row
        .get("cumulative_return_rate")
        .and_then(Value::as_f64)
        .map(|v| round_to(v, 8));
    let effective_to = last_row
        .get("effective_snapshot_date")
        .and_then(Value::as_str)
        .ok_or("曲线结果格式错误")?;

    Ok(json!({
        "account_id": PORTFOLIO_ACCOUNT_ID,
        "account_name": PORTFOLIO_ACCOUNT_NAME,
        "account_count": bounds.account_count,
        "range": {
            "preset": preset,
            "requested_from": window.requested_from.format("%Y-%m-%d").to_string(),
            "requested_to": requested_to,
            "effective_from": window.effective_from.format("%Y-%m-%d").to_string(),
            "effective_to": effective_to,
        },
        "summary": {
            "count": rows.len(),
            "start_assets_cents": first_value,
            "start_assets_yuan": cents_to_yuan_text(first_value),
            "end_assets_cents": last_value,
            "end_assets_yuan": cents_to_yuan_text(last_value),
            "change_cents": change_cents,
            "change_yuan": cents_to_yuan_text(change_cents),
            "change_pct": change_pct.map(|v| round_to(v, 8)),
            "change_pct_text": change_pct.map(|v| format!("{:.2}%", v * 100.0)),
            "end_net_growth_cents": end_net_growth_cents,
            "end_net_growth_yuan": cents_to_yuan_text(end_net_growth_cents),
            "end_cumulative_return_rate": end_cumulative_return_rate,
            "end_cumulative_return_pct_text": end_cumulative_return_rate.map(|v| format!("{:.2}%", v * 100.0)),
        },
        "rows": rows,
    }))
}

pub fn investment_curve_query_at_db_path(
    db_path: &Path,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let account_id = req.account_id.trim().to_string();
    if account_id.is_empty() {
        return Err("account_id 必填".to_string());
    }
    let preset = parse_preset_with_default(req.preset.as_deref(), "1y")?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    if account_id == PORTFOLIO_ACCOUNT_ID {
        build_portfolio_investment_curve_payload(&conn, &preset, &from_raw, &to_raw)
    } else {
        build_single_account_investment_curve_payload(
            &conn,
            &account_id,
            &preset,
            &from_raw,
            &to_raw,
        )
    }
}

pub fn investment_returns_query_at_db_path(
    db_path: &Path,
    req: InvestmentReturnsQueryRequest,
) -> Result<Value, String> {
    let preset = parse_preset(req.preset.as_deref())?;
    let from_raw = req.from_date.unwrap_or_default();
    let to_raw = req.to_date.unwrap_or_default();
    let keyword = req.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = req.limit.unwrap_or(200).clamp(1, 500) as usize;

    if preset == "custom" {
        let _ = parse_iso_date(&from_raw, "from")?;
    }
    let requested_to_text = if to_raw.trim().is_empty() {
        String::new()
    } else {
        parse_iso_date(&to_raw, "to")?
            .format("%Y-%m-%d")
            .to_string()
    };

    let conn = Connection::open(db_path).map_err(|e| format!("打开数据库失败: {e}"))?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                r.account_id,
                COALESCE(a.name, r.account_id) AS account_name,
                COUNT(*) AS record_count,
                MIN(r.snapshot_date) AS first_snapshot_date,
                MAX(r.snapshot_date) AS latest_snapshot_date
            FROM investment_records r
            LEFT JOIN accounts a ON a.id = r.account_id
            GROUP BY r.account_id
            ORDER BY latest_snapshot_date DESC, account_name
            "#,
        )
        .map_err(|e| format!("查询投资账户列表失败: {e}"))?;
    let mapped = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("查询投资账户列表失败: {e}"))?;

    let mut account_rows: Vec<(String, String, i64, String, String)> = Vec::new();
    for row in mapped {
        let row = row.map_err(|e| format!("读取投资账户列表失败: {e}"))?;
        if !keyword.is_empty()
            && !row.0.to_lowercase().contains(&keyword)
            && !row.1.to_lowercase().contains(&keyword)
        {
            continue;
        }
        account_rows.push(row);
        if account_rows.len() >= limit {
            break;
        }
    }

    let mut rows: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for (account_id, account_name, record_count, first_snapshot_date, latest_snapshot_date) in
        &account_rows
    {
        let payload = match build_single_account_investment_return_payload(
            &conn, account_id, &preset, &from_raw, &to_raw,
        ) {
            Ok(v) => v,
            Err(e) => {
                errors.push(json!({
                    "account_id": account_id,
                    "account_name": account_name,
                    "error": e,
                }));
                continue;
            }
        };
        let metrics = payload
            .get("metrics")
            .and_then(Value::as_object)
            .ok_or_else(|| "investment-return payload 缺少 metrics".to_string())?;
        let range = payload
            .get("range")
            .and_then(Value::as_object)
            .ok_or_else(|| "investment-return payload 缺少 range".to_string())?;

        let get_i64 = |obj: &serde_json::Map<String, Value>, key: &str| -> Result<i64, String> {
            obj.get(key)
                .and_then(Value::as_i64)
                .ok_or_else(|| format!("investment-return payload 缺少整数字段: {key}"))
        };
        let get_str = |obj: &serde_json::Map<String, Value>, key: &str| -> Result<String, String> {
            obj.get(key)
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .ok_or_else(|| format!("investment-return payload 缺少字符串字段: {key}"))
        };
        let get_opt_f64 = |obj: &serde_json::Map<String, Value>, key: &str| -> Option<f64> {
            obj.get(key).and_then(Value::as_f64)
        };
        let get_opt_str = |obj: &serde_json::Map<String, Value>, key: &str| -> Option<String> {
            obj.get(key).and_then(Value::as_str).map(|s| s.to_string())
        };

        rows.push(json!({
            "account_id": account_id,
            "account_name": account_name,
            "record_count": *record_count,
            "first_snapshot_date": first_snapshot_date,
            "latest_snapshot_date": latest_snapshot_date,
            "effective_from": get_str(range, "effective_from")?,
            "effective_to": get_str(range, "effective_to")?,
            "interval_days": get_i64(range, "interval_days")?,
            "begin_assets_cents": get_i64(metrics, "begin_assets_cents")?,
            "begin_assets_yuan": get_str(metrics, "begin_assets_yuan")?,
            "end_assets_cents": get_i64(metrics, "end_assets_cents")?,
            "end_assets_yuan": get_str(metrics, "end_assets_yuan")?,
            "net_flow_cents": get_i64(metrics, "net_flow_cents")?,
            "net_flow_yuan": get_str(metrics, "net_flow_yuan")?,
            "profit_cents": get_i64(metrics, "profit_cents")?,
            "profit_yuan": get_str(metrics, "profit_yuan")?,
            "net_growth_cents": get_i64(metrics, "net_growth_cents")?,
            "net_growth_yuan": get_str(metrics, "net_growth_yuan")?,
            "return_rate": get_opt_f64(metrics, "return_rate"),
            "return_rate_pct": get_opt_str(metrics, "return_rate_pct"),
            "annualized_rate": get_opt_f64(metrics, "annualized_rate"),
            "annualized_rate_pct": get_opt_str(metrics, "annualized_rate_pct"),
            "note": get_opt_str(metrics, "note").unwrap_or_default(),
        }));
    }

    rows.sort_by(|a, b| {
        let a_rate = a.get("return_rate").and_then(Value::as_f64);
        let b_rate = b.get("return_rate").and_then(Value::as_f64);
        match (a_rate, b_rate) {
            (Some(ra), Some(rb)) => rb
                .partial_cmp(&ra)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    let an = a
                        .get("account_name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let bn = b
                        .get("account_name")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    an.cmp(bn)
                }),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => {
                let an = a
                    .get("account_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let bn = b
                    .get("account_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                an.cmp(bn)
            }
        }
    });

    let valid_rates: Vec<f64> = rows
        .iter()
        .filter_map(|row| row.get("return_rate").and_then(Value::as_f64))
        .collect();
    let avg_rate = if valid_rates.is_empty() {
        None
    } else {
        Some(valid_rates.iter().sum::<f64>() / valid_rates.len() as f64)
    };
    let avg_rate_rounded = avg_rate.map(|v| round_to(v, 8));

    Ok(json!({
        "range": {
            "preset": preset,
            "requested_from": if from_raw.trim().is_empty() { "".to_string() } else { from_raw },
            "requested_to": requested_to_text,
            "input_limit": limit,
            "keyword": keyword,
        },
        "summary": {
            "account_count": account_rows.len(),
            "computed_count": rows.len(),
            "error_count": errors.len(),
            "avg_return_rate": avg_rate_rounded,
            "avg_return_pct": avg_rate.map(|v| format!("{:.2}%", v * 100.0)),
        },
        "rows": rows,
        "errors": errors,
    }))
}

#[tauri::command]
pub fn investment_return_query(
    app: AppHandle,
    req: InvestmentReturnQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_return_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn investment_curve_query(
    app: AppHandle,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_curve_query_at_db_path(&db_path, req)
}

#[tauri::command]
pub fn investment_returns_query(
    app: AppHandle,
    req: InvestmentReturnsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_returns_query_at_db_path(&db_path, req)
}
