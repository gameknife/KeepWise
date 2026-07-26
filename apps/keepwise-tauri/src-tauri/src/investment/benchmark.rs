use super::*;

pub(super) fn parse_benchmark_market_data_source(
    raw: Option<&str>,
) -> Result<BenchmarkMarketDataSource, String> {
    match raw.unwrap_or("eastmoney").trim().to_lowercase().as_str() {
        "" | "eastmoney" => Ok(BenchmarkMarketDataSource::Eastmoney),
        "yahoo" => Ok(BenchmarkMarketDataSource::Yahoo),
        _ => Err("benchmark_source 仅支持 eastmoney/yahoo".to_string()),
    }
}

pub(super) fn build_market_data_client() -> Result<Client, String> {
    Client::builder()
        .timeout(StdDuration::from_secs(8))
        .user_agent("KeepWise Desktop/0.1.0")
        .build()
        .map_err(|e| format!("创建基准指数请求客户端失败: {e}"))
}

pub(super) fn build_yahoo_chart_url(
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

pub(super) fn build_eastmoney_kline_url(
    secid: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Url, String> {
    let mut url = Url::parse("https://push2his.eastmoney.com/api/qt/stock/kline/get")
        .map_err(|e| format!("构造东方财富行情 URL 失败: {e}"))?;
    url.query_pairs_mut()
        .append_pair("secid", secid)
        .append_pair("fields1", "f1,f2,f3,f4,f5,f6")
        .append_pair("fields2", "f51,f52,f53,f54,f55,f56,f57,f58")
        .append_pair("klt", "101")
        .append_pair("fqt", "1")
        .append_pair("beg", &from_date.format("%Y%m%d").to_string())
        .append_pair("end", &to_date.format("%Y%m%d").to_string());
    Ok(url)
}

pub(super) fn timestamp_to_market_date(
    timestamp: i64,
    gmtoffset: i64,
) -> Result<NaiveDate, String> {
    let utc_dt = chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp, 0)
        .ok_or_else(|| format!("无效行情时间戳: {timestamp}"))?;
    Ok((utc_dt + Duration::seconds(gmtoffset)).date_naive())
}

pub(super) fn parse_yahoo_chart_history(
    payload: &Value,
) -> Result<Vec<BenchmarkHistoryRow>, String> {
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

pub(super) fn parse_eastmoney_kline_history(
    payload: &Value,
) -> Result<Vec<BenchmarkHistoryRow>, String> {
    let rc = payload.get("rc").and_then(Value::as_i64).unwrap_or(-1);
    if rc != 0 {
        return Err(format!("东方财富行情返回异常 rc={rc}"));
    }
    let klines = payload
        .get("data")
        .and_then(|data| data.get("klines"))
        .and_then(Value::as_array)
        .ok_or("东方财富行情返回为空")?;

    let mut by_date = BTreeMap::<NaiveDate, f64>::new();
    for item in klines {
        let Some(line) = item.as_str() else {
            continue;
        };
        let fields = line.split(',').collect::<Vec<_>>();
        if fields.len() < 3 {
            continue;
        }
        let market_date = NaiveDate::parse_from_str(fields[0].trim(), "%Y-%m-%d")
            .map_err(|_| "东方财富行情日期格式异常".to_string())?;
        let Ok(close) = fields[2].trim().parse::<f64>() else {
            continue;
        };
        if !close.is_finite() || close <= 0.0 {
            continue;
        }
        by_date.insert(market_date, close);
    }
    if by_date.is_empty() {
        return Err("东方财富行情没有可用收盘价".to_string());
    }

    Ok(by_date
        .into_iter()
        .map(|(market_date, close)| BenchmarkHistoryRow { market_date, close })
        .collect())
}

pub(super) fn fetch_yahoo_benchmark_history(
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

pub(super) fn fetch_eastmoney_benchmark_history(
    client: &Client,
    secid: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<BenchmarkHistoryRow>, String> {
    let url = build_eastmoney_kline_url(secid, from_date, to_date)?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("请求东方财富行情失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("请求东方财富行情失败: {e}"))?;
    let body = response
        .text()
        .map_err(|e| format!("读取东方财富行情响应失败: {e}"))?;
    let payload: Value =
        serde_json::from_str(&body).map_err(|e| format!("解析东方财富行情响应失败: {e}"))?;
    parse_eastmoney_kline_history(&payload)
}

pub(super) fn fetch_benchmark_history_with_fallback(
    client: &Client,
    spec: &BenchmarkSpec,
    from_date: NaiveDate,
    to_date: NaiveDate,
    preferred_source: BenchmarkMarketDataSource,
) -> Result<(&'static str, Vec<BenchmarkHistoryRow>), String> {
    if preferred_source == BenchmarkMarketDataSource::Eastmoney {
        return match fetch_eastmoney_benchmark_history(
            client,
            spec.eastmoney_secid,
            from_date,
            to_date,
        ) {
            Ok(history) => Ok((EASTMONEY_SOURCE_NAME, history)),
            Err(eastmoney_err) => {
                match fetch_yahoo_benchmark_history(client, spec.symbol, from_date, to_date) {
                    Ok(history) => Ok((YAHOO_FINANCE_SOURCE_NAME, history)),
                    Err(yahoo_err) => Err(format!(
                        "{EASTMONEY_SOURCE_NAME}: {eastmoney_err}; {YAHOO_FINANCE_SOURCE_NAME}: {yahoo_err}"
                    )),
                }
            }
        };
    }

    match fetch_yahoo_benchmark_history(client, spec.symbol, from_date, to_date) {
        Ok(history) => Ok((YAHOO_FINANCE_SOURCE_NAME, history)),
        Err(yahoo_err) => match fetch_eastmoney_benchmark_history(
            client,
            spec.eastmoney_secid,
            from_date,
            to_date,
        ) {
            Ok(history) => Ok((EASTMONEY_SOURCE_NAME, history)),
            Err(eastmoney_err) => Err(format!(
                "{YAHOO_FINANCE_SOURCE_NAME}: {yahoo_err}; {EASTMONEY_SOURCE_NAME}: {eastmoney_err}"
            )),
        },
    }
}

pub(super) fn build_benchmark_curve_rows(
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

pub(super) fn build_benchmark_comparison_payload(
    curve_dates: &[NaiveDate],
    effective_from: NaiveDate,
    effective_to: NaiveDate,
    preferred_source: BenchmarkMarketDataSource,
) -> Value {
    if curve_dates.is_empty() {
        return json!({
            "source": "",
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
                        "source": Value::Null,
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
                "source": "",
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
    let mut sources = Vec::<&'static str>::new();
    let mut next_preferred_source = preferred_source;

    for spec in BENCHMARK_SPECS {
        match fetch_benchmark_history_with_fallback(
            &client,
            spec,
            buffered_from,
            buffered_to,
            next_preferred_source,
        )
        .and_then(|(source, history)| {
            build_benchmark_curve_rows(curve_dates, &history, effective_from).map(
                |(baseline_date, baseline_close, rows)| {
                    (source, baseline_date, baseline_close, rows)
                },
            )
        }) {
            Ok((source, baseline_date, baseline_close, rows)) => {
                available_count += 1;
                if source == EASTMONEY_SOURCE_NAME {
                    next_preferred_source = BenchmarkMarketDataSource::Eastmoney;
                } else if source == YAHOO_FINANCE_SOURCE_NAME {
                    next_preferred_source = BenchmarkMarketDataSource::Yahoo;
                }
                if !sources.contains(&source) {
                    sources.push(source);
                }
                let end_return_rate = rows
                    .last()
                    .and_then(|row| row.get("cumulative_return_rate"))
                    .and_then(Value::as_f64);
                curves.push(json!({
                    "key": spec.key,
                    "label": spec.label,
                    "symbol": spec.symbol,
                    "source": source,
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
                    "source": Value::Null,
                    "rows": [],
                    "error": err,
                }));
            }
        }
    }

    json!({
        "source": sources.join(" / "),
        "summary": {
            "requested_count": BENCHMARK_SPECS.len(),
            "available_count": available_count,
            "warning_count": warnings.len(),
        },
        "curves": curves,
        "warnings": warnings,
    })
}

pub(super) fn build_benchmark_payload_from_curve_payload(
    curve_payload: &Value,
    preferred_source: BenchmarkMarketDataSource,
) -> Result<Value, String> {
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
        preferred_source,
    ))
}
