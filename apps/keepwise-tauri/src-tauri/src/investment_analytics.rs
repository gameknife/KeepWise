use chrono::{Datelike, Duration, NaiveDate};
use reqwest::blocking::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration as StdDuration;
use tauri::AppHandle;
use url::Url;

use crate::ledger_db::resolve_ledger_db_path;

const PORTFOLIO_ACCOUNT_ID: &str = "__portfolio__";
const PORTFOLIO_ACCOUNT_NAME: &str = "全部投资账户（组合）";
const SUPPORTED_PRESETS: &[&str] = &["ytd", "1y", "3y", "since_inception", "custom"];
const BENCHMARK_SOURCE_NAME: &str = "Yahoo Finance";

#[derive(Debug, Clone, Copy)]
struct BenchmarkSpec {
    key: &'static str,
    label: &'static str,
    symbol: &'static str,
}

const BENCHMARK_SPECS: &[BenchmarkSpec] = &[
    BenchmarkSpec {
        key: "sse",
        label: "上证指数",
        symbol: "000001.SS",
    },
    BenchmarkSpec {
        key: "hsi",
        label: "恒生指数",
        symbol: "^HSI",
    },
    BenchmarkSpec {
        key: "sp500",
        label: "标普500",
        symbol: "^GSPC",
    },
];

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

#[derive(Debug, Clone)]
struct BenchmarkHistoryRow {
    market_date: NaiveDate,
    close: f64,
}

#[derive(Debug, Clone)]
struct CurveAnchorRow {
    snapshot_date: NaiveDate,
    effective_snapshot_date: NaiveDate,
    total_assets_cents: i64,
    transfer_amount_cents: i64,
    cumulative_net_growth_cents: i64,
    cumulative_return_rate: Option<f64>,
    is_observed: bool,
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

fn build_market_data_client() -> Result<Client, String> {
    Client::builder()
        .timeout(StdDuration::from_secs(8))
        .user_agent("KeepWise Desktop/0.1.0")
        .build()
        .map_err(|e| format!("创建基准指数请求客户端失败: {e}"))
}

fn build_yahoo_chart_url(
    symbol: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Url, String> {
    let from_ts = from_date
        .and_hms_opt(0, 0, 0)
        .ok_or("无效 benchmark 起始时间")?
        .and_utc()
        .timestamp();
    let to_ts = (to_date + Duration::days(1))
        .and_hms_opt(0, 0, 0)
        .ok_or("无效 benchmark 结束时间")?
        .and_utc()
        .timestamp();
    let mut url = Url::parse("https://query1.finance.yahoo.com")
        .map_err(|e| format!("构造 benchmark URL 失败: {e}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "构造 benchmark URL 失败".to_string())?;
        segments.extend(["v8", "finance", "chart", symbol]);
    }
    url.query_pairs_mut()
        .append_pair("interval", "1d")
        .append_pair("includeAdjustedClose", "true")
        .append_pair("period1", &from_ts.to_string())
        .append_pair("period2", &to_ts.to_string());
    Ok(url)
}

fn timestamp_to_market_date(timestamp: i64, gmtoffset: i64) -> Result<NaiveDate, String> {
    let utc_dt = chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp, 0)
        .ok_or_else(|| format!("无效行情时间戳: {timestamp}"))?;
    Ok((utc_dt + Duration::seconds(gmtoffset)).date_naive())
}

fn parse_yahoo_chart_history(payload: &Value) -> Result<Vec<BenchmarkHistoryRow>, String> {
    if let Some(chart_error) = payload.get("chart").and_then(|chart| chart.get("error")) {
        if !chart_error.is_null() {
            let code = chart_error
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let description = chart_error
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            return Err(format!("{code}: {description}"));
        }
    }

    let result = payload
        .get("chart")
        .and_then(|chart| chart.get("result"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or("Yahoo 行情返回为空")?;

    let gmtoffset = result
        .get("meta")
        .and_then(|meta| meta.get("gmtoffset"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let timestamps = result
        .get("timestamp")
        .and_then(Value::as_array)
        .ok_or("Yahoo 行情缺少 timestamp")?;
    let price_values = result
        .get("indicators")
        .and_then(|indicators| indicators.get("adjclose"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|first| first.get("adjclose"))
        .and_then(Value::as_array)
        .or_else(|| {
            result
                .get("indicators")
                .and_then(|indicators| indicators.get("quote"))
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|first| first.get("close"))
                .and_then(Value::as_array)
        })
        .ok_or("Yahoo 行情缺少 close")?;

    let mut by_date = BTreeMap::<NaiveDate, f64>::new();
    for idx in 0..timestamps.len().min(price_values.len()) {
        let Some(timestamp) = timestamps[idx].as_i64() else {
            continue;
        };
        let Some(close) = price_values[idx].as_f64() else {
            continue;
        };
        if !close.is_finite() || close <= 0.0 {
            continue;
        }
        let market_date = timestamp_to_market_date(timestamp, gmtoffset)?;
        by_date.insert(market_date, close);
    }
    if by_date.is_empty() {
        return Err("Yahoo 行情没有可用收盘价".to_string());
    }

    Ok(by_date
        .into_iter()
        .map(|(market_date, close)| BenchmarkHistoryRow { market_date, close })
        .collect())
}

fn fetch_benchmark_history(
    client: &Client,
    symbol: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<BenchmarkHistoryRow>, String> {
    let url = build_yahoo_chart_url(symbol, from_date, to_date)?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("请求行情失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("请求行情失败: {e}"))?;
    let body = response
        .text()
        .map_err(|e| format!("读取行情响应失败: {e}"))?;
    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("解析行情响应失败: {e}"))?;
    parse_yahoo_chart_history(&payload)
}

fn build_benchmark_curve_rows(
    curve_dates: &[NaiveDate],
    history: &[BenchmarkHistoryRow],
    effective_from: NaiveDate,
) -> Result<(String, f64, Vec<Value>), String> {
    if curve_dates.is_empty() {
        return Ok((String::new(), 0.0, Vec::new()));
    }
    if history.is_empty() {
        return Err("无可用指数历史数据".to_string());
    }

    let baseline_idx = history
        .iter()
        .rposition(|row| row.market_date <= effective_from)
        .or_else(|| {
            history
                .iter()
                .position(|row| row.market_date >= effective_from)
        })
        .ok_or("未找到可用指数基准日")?;
    let baseline = &history[baseline_idx];
    if !baseline.close.is_finite() || baseline.close <= 0.0 {
        return Err("指数基准收盘价无效".to_string());
    }

    let mut rows = Vec::<Value>::new();
    let mut history_idx = baseline_idx;
    for curve_date in curve_dates {
        while history_idx + 1 < history.len() && history[history_idx + 1].market_date <= *curve_date
        {
            history_idx += 1;
        }
        let market_row = &history[history_idx];
        if market_row.market_date > *curve_date {
            continue;
        }
        let cumulative_return_rate = round_to(market_row.close / baseline.close - 1.0, 8);
        rows.push(json!({
            "snapshot_date": curve_date.format("%Y-%m-%d").to_string(),
            "effective_market_date": market_row.market_date.format("%Y-%m-%d").to_string(),
            "close": round_to(market_row.close, 4),
            "cumulative_return_rate": cumulative_return_rate,
            "cumulative_return_pct": round_to(cumulative_return_rate * 100.0, 4),
            "cumulative_return_pct_text": format!("{:.2}%", cumulative_return_rate * 100.0),
        }));
    }
    if rows.is_empty() {
        return Err("所选区间内无可对齐的指数交易日".to_string());
    }

    Ok((
        baseline.market_date.format("%Y-%m-%d").to_string(),
        round_to(baseline.close, 4),
        rows,
    ))
}

fn build_benchmark_comparison_payload(
    curve_dates: &[NaiveDate],
    effective_from: NaiveDate,
    effective_to: NaiveDate,
) -> Value {
    if curve_dates.is_empty() {
        return json!({
            "source": BENCHMARK_SOURCE_NAME,
            "summary": {
                "requested_count": BENCHMARK_SPECS.len(),
                "available_count": 0,
                "warning_count": 0,
            },
            "curves": [],
            "warnings": [],
        });
    }

    let client = match build_market_data_client() {
        Ok(client) => client,
        Err(err) => {
            let curves = BENCHMARK_SPECS
                .iter()
                .map(|spec| {
                    json!({
                        "key": spec.key,
                        "label": spec.label,
                        "symbol": spec.symbol,
                        "rows": [],
                        "error": err,
                    })
                })
                .collect::<Vec<_>>();
            let warnings = BENCHMARK_SPECS
                .iter()
                .map(|spec| format!("{} 对比曲线不可用：{}", spec.label, err))
                .collect::<Vec<_>>();
            return json!({
                "source": BENCHMARK_SOURCE_NAME,
                "summary": {
                    "requested_count": BENCHMARK_SPECS.len(),
                    "available_count": 0,
                    "warning_count": warnings.len(),
                },
                "curves": curves,
                "warnings": warnings,
            });
        }
    };

    let buffered_from = effective_from - Duration::days(10);
    let buffered_to = effective_to + Duration::days(3);
    let mut available_count = 0usize;
    let mut warnings = Vec::<String>::new();
    let mut curves = Vec::<Value>::new();

    for spec in BENCHMARK_SPECS {
        match fetch_benchmark_history(&client, spec.symbol, buffered_from, buffered_to)
            .and_then(|history| build_benchmark_curve_rows(curve_dates, &history, effective_from))
        {
            Ok((baseline_date, baseline_close, rows)) => {
                available_count += 1;
                let end_return_rate = rows
                    .last()
                    .and_then(|row| row.get("cumulative_return_rate"))
                    .and_then(Value::as_f64);
                curves.push(json!({
                    "key": spec.key,
                    "label": spec.label,
                    "symbol": spec.symbol,
                    "baseline_date": baseline_date,
                    "baseline_close": baseline_close,
                    "end_return_rate": end_return_rate,
                    "end_return_pct_text": end_return_rate.map(|v| format!("{:.2}%", v * 100.0)),
                    "rows": rows,
                    "error": Value::Null,
                }));
            }
            Err(err) => {
                warnings.push(format!("{} 对比曲线不可用：{}", spec.label, err));
                curves.push(json!({
                    "key": spec.key,
                    "label": spec.label,
                    "symbol": spec.symbol,
                    "rows": [],
                    "error": err,
                }));
            }
        }
    }

    json!({
        "source": BENCHMARK_SOURCE_NAME,
        "summary": {
            "requested_count": BENCHMARK_SPECS.len(),
            "available_count": available_count,
            "warning_count": warnings.len(),
        },
        "curves": curves,
        "warnings": warnings,
    })
}

fn build_benchmark_payload_from_curve_payload(curve_payload: &Value) -> Result<Value, String> {
    let effective_from = curve_payload
        .get("range")
        .and_then(|range| range.get("effective_from"))
        .and_then(Value::as_str)
        .ok_or("投资曲线缺少 effective_from")?;
    let effective_to = curve_payload
        .get("range")
        .and_then(|range| range.get("effective_to"))
        .and_then(Value::as_str)
        .ok_or("投资曲线缺少 effective_to")?;
    let curve_rows = curve_payload
        .get("rows")
        .and_then(Value::as_array)
        .ok_or("投资曲线缺少 rows")?;

    let mut curve_dates = Vec::<NaiveDate>::new();
    for row in curve_rows {
        let Some(snapshot_date) = row.get("snapshot_date").and_then(Value::as_str) else {
            continue;
        };
        curve_dates.push(parse_iso_date(snapshot_date, "snapshot_date")?);
    }

    Ok(build_benchmark_comparison_payload(
        &curve_dates,
        parse_iso_date(effective_from, "effective_from")?,
        parse_iso_date(effective_to, "effective_to")?,
    ))
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

fn interpolate_i64(start: i64, end: i64, ratio: f64) -> i64 {
    round_to(start as f64 + (end - start) as f64 * ratio, 0) as i64
}

fn interpolate_opt_f64(start: Option<f64>, end: Option<f64>, ratio: f64) -> Option<f64> {
    match (start, end) {
        (Some(a), Some(b)) => Some(round_to(a + (b - a) * ratio, 8)),
        (Some(a), None) => Some(round_to(a, 8)),
        (None, Some(b)) => Some(round_to(b, 8)),
        (None, None) => None,
    }
}

fn curve_row_to_json(
    row: &CurveAnchorRow,
    is_interpolated: bool,
    anchor_from_date: NaiveDate,
    anchor_to_date: NaiveDate,
) -> Value {
    let row_is_interpolated = is_interpolated || !row.is_observed;
    json!({
        "snapshot_date": row.snapshot_date.format("%Y-%m-%d").to_string(),
        "effective_snapshot_date": row.effective_snapshot_date.format("%Y-%m-%d").to_string(),
        "total_assets_cents": row.total_assets_cents,
        "total_assets_yuan": cents_to_yuan_text(row.total_assets_cents),
        "transfer_amount_cents": row.transfer_amount_cents,
        "transfer_amount_yuan": cents_to_yuan_text(row.transfer_amount_cents),
        "cumulative_net_growth_cents": row.cumulative_net_growth_cents,
        "cumulative_net_growth_yuan": cents_to_yuan_text(row.cumulative_net_growth_cents),
        "cumulative_return_rate": row.cumulative_return_rate,
        "cumulative_return_pct": row
            .cumulative_return_rate
            .map(|value| round_to(value * 100.0, 4)),
        "cumulative_return_pct_text": row
            .cumulative_return_rate
            .map(|value| format!("{:.2}%", value * 100.0)),
        "is_interpolated": row_is_interpolated,
        "anchor_from_snapshot_date": anchor_from_date.format("%Y-%m-%d").to_string(),
        "anchor_to_snapshot_date": anchor_to_date.format("%Y-%m-%d").to_string(),
    })
}

fn interpolate_curve_rows_daily(anchors: &[CurveAnchorRow]) -> Vec<Value> {
    if anchors.is_empty() {
        return Vec::new();
    }

    let mut rows = Vec::<Value>::new();
    for (index, anchor) in anchors.iter().enumerate() {
        rows.push(curve_row_to_json(
            anchor,
            false,
            anchor.snapshot_date,
            anchor.snapshot_date,
        ));

        let Some(next_anchor) = anchors.get(index + 1) else {
            continue;
        };
        let gap_days = (next_anchor.snapshot_date - anchor.snapshot_date).num_days();
        if gap_days <= 1 {
            continue;
        }

        for day_offset in 1..gap_days {
            let snapshot_date = anchor.snapshot_date + Duration::days(day_offset);
            let ratio = day_offset as f64 / gap_days as f64;
            let interpolated_row = CurveAnchorRow {
                snapshot_date,
                effective_snapshot_date: snapshot_date,
                total_assets_cents: interpolate_i64(
                    anchor.total_assets_cents,
                    next_anchor.total_assets_cents,
                    ratio,
                ),
                transfer_amount_cents: 0,
                cumulative_net_growth_cents: interpolate_i64(
                    anchor.cumulative_net_growth_cents,
                    next_anchor.cumulative_net_growth_cents,
                    ratio,
                ),
                cumulative_return_rate: interpolate_opt_f64(
                    anchor.cumulative_return_rate,
                    next_anchor.cumulative_return_rate,
                    ratio,
                ),
                is_observed: false,
            };
            rows.push(curve_row_to_json(
                &interpolated_row,
                true,
                anchor.snapshot_date,
                next_anchor.snapshot_date,
            ));
        }
    }

    rows
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

    let mut anchors = Vec::<CurveAnchorRow>::new();
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

        anchors.push(CurveAnchorRow {
            snapshot_date: *point_date,
            effective_snapshot_date: point_end_date,
            total_assets_cents: point_end_assets,
            transfer_amount_cents,
            cumulative_net_growth_cents,
            cumulative_return_rate: cumulative_return,
            is_observed: true,
        });
    }
    let rows = interpolate_curve_rows_daily(&anchors);

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
    let mut observed_dates = HashMap::<String, bool>::new();
    for row in date_iter {
        let point_date = parse_db_date(
            row.map_err(|e| format!("读取组合曲线日期点失败: {e}"))?,
            "snapshot_date",
        )?;
        observed_dates.insert(point_date.format("%Y-%m-%d").to_string(), true);
        dates.push(point_date);
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

    let mut anchors = Vec::<CurveAnchorRow>::new();
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

        anchors.push(CurveAnchorRow {
            snapshot_date: *point_date,
            effective_snapshot_date: *point_date,
            total_assets_cents: point_assets,
            transfer_amount_cents,
            cumulative_net_growth_cents,
            cumulative_return_rate: cumulative_return,
            is_observed: observed_dates.contains_key(&point_date_text),
        });
    }
    let rows = interpolate_curve_rows_daily(&anchors);

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

pub fn investment_curve_benchmarks_query_at_db_path(
    db_path: &Path,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let curve_payload = investment_curve_query_at_db_path(db_path, req)?;
    build_benchmark_payload_from_curve_payload(&curve_payload)
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
pub async fn investment_curve_benchmarks_query(
    app: AppHandle,
    req: InvestmentCurveQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        investment_curve_benchmarks_query_at_db_path(&db_path, req)
    })
    .await;
    match join_result {
        Ok(result) => result,
        Err(err) => Err(format!("加载指数对比失败: {err}")),
    }
}

#[tauri::command]
pub fn investment_returns_query(
    app: AppHandle,
    req: InvestmentReturnsQueryRequest,
) -> Result<Value, String> {
    let db_path = resolve_ledger_db_path(&app)?;
    investment_returns_query_at_db_path(&db_path, req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    fn create_temp_test_db() -> PathBuf {
        let unique = format!(
            "keepwise_investment_analytics_test_{}_{}.db",
            std::process::id(),
            Uuid::new_v4()
        );
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

    fn seed_investment_fixture(db_path: &Path) {
        let conn = Connection::open(db_path).expect("open db");
        conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_inv_alpha', 'Alpha策略', 'investment'),
              ('acct_inv_beta', 'Beta策略', 'investment');

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type) VALUES
              ('alpha_1', 'acct_inv_alpha', '2026-01-01', 1000000, 0, 'manual'),
              ('alpha_2', 'acct_inv_alpha', '2026-03-01', 1100000, 0, 'manual'),
              ('beta_1', 'acct_inv_beta', '2026-01-01', 2000000, 0, 'manual'),
              ('beta_2', 'acct_inv_beta', '2026-03-01', 2020000, 0, 'manual');
            "#,
        )
        .expect("seed investment fixture");
    }

    fn seed_daily_curve_fixture(db_path: &Path) {
        let conn = Connection::open(db_path).expect("open db");
        conn.execute_batch(
            r#"
            INSERT INTO accounts(id, name, account_type) VALUES
              ('acct_curve_alpha', '日频Alpha', 'investment'),
              ('acct_curve_beta', '日频Beta', 'investment');

            INSERT INTO investment_records(id, account_id, snapshot_date, total_assets_cents, transfer_amount_cents, source_type) VALUES
              ('curve_alpha_1', 'acct_curve_alpha', '2026-01-01', 1000000, 0, 'manual'),
              ('curve_alpha_2', 'acct_curve_alpha', '2026-01-03', 1200000, 0, 'manual'),
              ('curve_beta_1', 'acct_curve_beta', '2026-01-01', 2000000, 0, 'manual'),
              ('curve_beta_2', 'acct_curve_beta', '2026-01-03', 2600000, 0, 'manual');
            "#,
        )
        .expect("seed daily curve fixture");
    }

    fn approx_eq(a: f64, b: f64, eps: f64) {
        assert!(
            (a - b).abs() <= eps,
            "approx not equal: left={a} right={b} eps={eps}"
        );
    }

    #[test]
    fn investment_returns_query_sorts_by_return_rate_and_supports_filter_limit() {
        let db_path = create_temp_test_db();
        apply_all_migrations_for_test(&db_path);
        seed_investment_fixture(&db_path);

        let payload = investment_returns_query_at_db_path(
            &db_path,
            InvestmentReturnsQueryRequest {
                preset: Some("custom".to_string()),
                from_date: Some("2026-01-01".to_string()),
                to_date: Some("2026-03-01".to_string()),
                keyword: None,
                limit: Some(10),
            },
        )
        .expect("query investment returns");

        assert_eq!(
            payload
                .get("summary")
                .and_then(|v| v.get("computed_count"))
                .and_then(Value::as_i64),
            Some(2)
        );
        assert_eq!(
            payload
                .get("summary")
                .and_then(|v| v.get("error_count"))
                .and_then(Value::as_i64),
            Some(0)
        );

        let rows = payload
            .get("rows")
            .and_then(Value::as_array)
            .expect("rows array");
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[0].get("account_id").and_then(Value::as_str),
            Some("acct_inv_alpha"),
            "higher return account should be ranked first"
        );
        approx_eq(
            rows[0]
                .get("return_rate")
                .and_then(Value::as_f64)
                .expect("alpha return_rate"),
            0.10,
            1e-8,
        );
        approx_eq(
            rows[1]
                .get("return_rate")
                .and_then(Value::as_f64)
                .expect("beta return_rate"),
            0.01,
            1e-8,
        );

        let filtered = investment_returns_query_at_db_path(
            &db_path,
            InvestmentReturnsQueryRequest {
                preset: Some("custom".to_string()),
                from_date: Some("2026-01-01".to_string()),
                to_date: Some("2026-03-01".to_string()),
                keyword: Some("beta".to_string()),
                limit: Some(1),
            },
        )
        .expect("query filtered investment returns");
        let filtered_rows = filtered
            .get("rows")
            .and_then(Value::as_array)
            .expect("filtered rows");
        assert_eq!(filtered_rows.len(), 1);
        assert_eq!(
            filtered_rows[0].get("account_id").and_then(Value::as_str),
            Some("acct_inv_beta")
        );
        assert_eq!(
            filtered
                .get("range")
                .and_then(|v| v.get("input_limit"))
                .and_then(Value::as_i64),
            Some(1)
        );

        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn single_account_curve_query_expands_to_calendar_days_with_interpolated_rows() {
        let db_path = create_temp_test_db();
        apply_all_migrations_for_test(&db_path);
        seed_daily_curve_fixture(&db_path);

        let payload = investment_curve_query_at_db_path(
            &db_path,
            InvestmentCurveQueryRequest {
                account_id: "acct_curve_alpha".to_string(),
                preset: Some("custom".to_string()),
                from_date: Some("2026-01-01".to_string()),
                to_date: Some("2026-01-03".to_string()),
            },
        )
        .expect("query single account daily curve");

        let rows = payload
            .get("rows")
            .and_then(Value::as_array)
            .expect("rows array");
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[1].get("snapshot_date").and_then(Value::as_str),
            Some("2026-01-02")
        );
        assert_eq!(
            rows[1].get("is_interpolated").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            rows[1].get("total_assets_cents").and_then(Value::as_i64),
            Some(1100000)
        );
        approx_eq(
            rows[1]
                .get("cumulative_return_rate")
                .and_then(Value::as_f64)
                .expect("interpolated return"),
            0.10,
            1e-8,
        );

        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn portfolio_curve_query_expands_to_calendar_days_with_interpolated_rows() {
        let db_path = create_temp_test_db();
        apply_all_migrations_for_test(&db_path);
        seed_daily_curve_fixture(&db_path);

        let payload = investment_curve_query_at_db_path(
            &db_path,
            InvestmentCurveQueryRequest {
                account_id: PORTFOLIO_ACCOUNT_ID.to_string(),
                preset: Some("custom".to_string()),
                from_date: Some("2026-01-01".to_string()),
                to_date: Some("2026-01-03".to_string()),
            },
        )
        .expect("query portfolio daily curve");

        let rows = payload
            .get("rows")
            .and_then(Value::as_array)
            .expect("rows array");
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[1].get("snapshot_date").and_then(Value::as_str),
            Some("2026-01-02")
        );
        assert_eq!(
            rows[1].get("is_interpolated").and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            rows[1].get("total_assets_cents").and_then(Value::as_i64),
            Some(3400000)
        );
        approx_eq(
            rows[2]
                .get("cumulative_return_rate")
                .and_then(Value::as_f64)
                .expect("portfolio end return"),
            0.26666667,
            1e-8,
        );

        let _ = fs::remove_file(&db_path);
    }

    #[test]
    fn parse_yahoo_chart_history_reads_adjusted_close_dates() {
        let market_ts = NaiveDate::from_ymd_opt(2026, 1, 2)
            .expect("date")
            .and_hms_opt(8, 0, 0)
            .expect("time")
            .and_utc()
            .timestamp();
        let payload = json!({
            "chart": {
                "result": [{
                    "meta": {
                        "gmtoffset": 28800
                    },
                    "timestamp": [market_ts],
                    "indicators": {
                        "adjclose": [{
                            "adjclose": [3210.55]
                        }]
                    }
                }],
                "error": null
            }
        });

        let rows = parse_yahoo_chart_history(&payload).expect("parse yahoo history");
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].market_date,
            NaiveDate::from_ymd_opt(2026, 1, 2).expect("expected date")
        );
        approx_eq(rows[0].close, 3210.55, 1e-8);
    }

    #[test]
    fn build_benchmark_curve_rows_aligns_to_latest_available_market_close() {
        let history = vec![
            BenchmarkHistoryRow {
                market_date: NaiveDate::from_ymd_opt(2026, 1, 2).expect("date"),
                close: 100.0,
            },
            BenchmarkHistoryRow {
                market_date: NaiveDate::from_ymd_opt(2026, 1, 5).expect("date"),
                close: 110.0,
            },
        ];
        let curve_dates = vec![
            NaiveDate::from_ymd_opt(2026, 1, 4).expect("date"),
            NaiveDate::from_ymd_opt(2026, 1, 6).expect("date"),
        ];

        let (baseline_date, baseline_close, rows) = build_benchmark_curve_rows(
            &curve_dates,
            &history,
            NaiveDate::from_ymd_opt(2026, 1, 4).expect("date"),
        )
        .expect("build benchmark rows");

        assert_eq!(baseline_date, "2026-01-02");
        approx_eq(baseline_close, 100.0, 1e-8);
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[0].get("effective_market_date").and_then(Value::as_str),
            Some("2026-01-02")
        );
        approx_eq(
            rows[0]
                .get("cumulative_return_rate")
                .and_then(Value::as_f64)
                .expect("first rate"),
            0.0,
            1e-8,
        );
        assert_eq!(
            rows[1].get("effective_market_date").and_then(Value::as_str),
            Some("2026-01-05")
        );
        approx_eq(
            rows[1]
                .get("cumulative_return_rate")
                .and_then(Value::as_f64)
                .expect("second rate"),
            0.10,
            1e-8,
        );
    }
}
