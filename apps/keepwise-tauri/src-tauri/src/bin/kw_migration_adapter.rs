use appskeepwise_tauri_lib::{
    investment_curve_query_at_db_path, investment_return_query_at_db_path,
    investment_returns_query_at_db_path, wealth_curve_query_at_db_path,
    wealth_overview_query_at_db_path, InvestmentCurveQueryRequest, InvestmentReturnQueryRequest,
    InvestmentReturnsQueryRequest, WealthCurveQueryRequest, WealthOverviewQueryRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::io::{self, Read};
use std::path::Path;

#[derive(Debug, Deserialize)]
struct AdapterRequest {
    schema_version: u64,
    case: Option<AdapterCaseMeta>,
    endpoint: AdapterEndpoint,
    query: Value,
    dataset: AdapterDataset,
}

#[derive(Debug, Deserialize)]
struct AdapterCaseMeta {
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AdapterEndpoint {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AdapterDataset {
    db_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct AdapterErrorBody {
    category: String,
    message: String,
    #[serde(rename = "type")]
    error_type: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status")]
enum AdapterResponse {
    #[serde(rename = "success")]
    Success { payload: Value },
    #[serde(rename = "error")]
    Error { error: AdapterErrorBody },
}

fn classify_error_message(message: &str) -> String {
    let validation_keywords = [
        "必填",
        "布尔参数不合法",
        "日期格式必须",
        "缺少字段",
        "preset 不支持",
        "至少需要选择",
    ];
    if validation_keywords.iter().any(|k| message.contains(k)) {
        return "VALIDATION_ERROR".to_string();
    }

    let invalid_range_keywords = ["起始日期晚于结束日期", "结束日期早于最早可用记录"];
    if invalid_range_keywords.iter().any(|k| message.contains(k)) {
        return "INVALID_RANGE_ERROR".to_string();
    }

    let no_data_keywords = [
        "没有可用",
        "有效快照不足",
        "当前没有可用于",
        "无可用时间范围",
    ];
    if no_data_keywords.iter().any(|k| message.contains(k)) {
        return "NO_DATA_ERROR".to_string();
    }

    "UNKNOWN_ERROR".to_string()
}

fn error_response(
    category: impl Into<String>,
    message: impl Into<String>,
    error_type: impl Into<String>,
) -> AdapterResponse {
    AdapterResponse::Error {
        error: AdapterErrorBody {
            category: category.into(),
            message: message.into(),
            error_type: error_type.into(),
        },
    }
}

fn parse_bool_flag(args: &[String], flag: &str) -> bool {
    args.iter().any(|arg| arg == flag)
}

fn read_stdin_json() -> Result<Value, String> {
    let mut raw = String::new();
    io::stdin()
        .read_to_string(&mut raw)
        .map_err(|e| format!("读取 stdin 失败: {e}"))?;
    if raw.trim().is_empty() {
        return Err("empty stdin request".to_string());
    }
    serde_json::from_str::<Value>(&raw).map_err(|e| format!("invalid JSON request: {e}"))
}

fn dispatch(req: AdapterRequest) -> Result<Value, String> {
    if req.schema_version != 1 {
        return Err(format!(
            "unsupported schema_version: {}",
            req.schema_version
        ));
    }

    let path = req
        .endpoint
        .path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "request.endpoint.path missing".to_string())?;
    let db_path = req
        .dataset
        .db_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "request.dataset.db_path missing".to_string())?;

    match path {
        "/api/analytics/investment-return" => {
            let query_req: InvestmentReturnQueryRequest = serde_json::from_value(req.query)
                .map_err(|e| {
                    let msg = e.to_string();
                    if msg.contains("missing field `account_id`") {
                        "account_id 必填".to_string()
                    } else {
                        format!("request.query invalid for investment-return: {msg}")
                    }
                })?;
            investment_return_query_at_db_path(Path::new(db_path), query_req)
        }
        "/api/analytics/investment-curve" => {
            let query_req: InvestmentCurveQueryRequest = serde_json::from_value(req.query)
                .map_err(|e| {
                    let msg = e.to_string();
                    if msg.contains("missing field `account_id`") {
                        "account_id 必填".to_string()
                    } else {
                        format!("request.query invalid for investment-curve: {msg}")
                    }
                })?;
            investment_curve_query_at_db_path(Path::new(db_path), query_req)
        }
        "/api/analytics/investment-returns" => {
            let query_req: InvestmentReturnsQueryRequest = serde_json::from_value(req.query)
                .map_err(|e| format!("request.query invalid for investment-returns: {e}"))?;
            investment_returns_query_at_db_path(Path::new(db_path), query_req)
        }
        "/api/analytics/wealth-overview" => {
            let query_req: WealthOverviewQueryRequest = serde_json::from_value(req.query)
                .map_err(|e| format!("request.query invalid for wealth-overview: {e}"))?;
            wealth_overview_query_at_db_path(Path::new(db_path), query_req)
        }
        "/api/analytics/wealth-curve" => {
            let query_req: WealthCurveQueryRequest = serde_json::from_value(req.query)
                .map_err(|e| format!("request.query invalid for wealth-curve: {e}"))?;
            wealth_curve_query_at_db_path(Path::new(db_path), query_req)
        }
        _ => Err(format!("unsupported endpoint path: {path}")),
    }
}

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let pretty = parse_bool_flag(&args, "--pretty");
    let verbose = parse_bool_flag(&args, "--verbose");

    let resp = match read_stdin_json()
        .and_then(|v| {
            serde_json::from_value::<AdapterRequest>(v)
                .map_err(|e| format!("request root invalid: {e}"))
        })
        .and_then(|req| {
            if verbose {
                if let Some(case_meta) = &req.case {
                    if let Some(case_id) = &case_meta.id {
                        eprintln!("[kw_migration_adapter] case={case_id}");
                    }
                }
                if let Some(path) = req.endpoint.path.as_deref() {
                    eprintln!("[kw_migration_adapter] endpoint={path}");
                }
                if let Some(db_path) = req.dataset.db_path.as_deref() {
                    eprintln!("[kw_migration_adapter] db={db_path}");
                }
            }
            dispatch(req)
        }) {
        Ok(payload) => AdapterResponse::Success { payload },
        Err(message) => {
            let category = if message.starts_with("unsupported endpoint path:") {
                "UNSUPPORTED_ENDPOINT".to_string()
            } else if message.starts_with("unsupported schema_version:")
                || message.starts_with("request.")
                || message.starts_with("invalid JSON request:")
                || message == "empty stdin request"
            {
                "ADAPTER_PROTOCOL_ERROR".to_string()
            } else {
                classify_error_message(&message)
            };
            error_response(category, message, "AdapterError")
        }
    };

    let out = if pretty {
        serde_json::to_string_pretty(&resp)
    } else {
        serde_json::to_string(&resp)
    }
    .unwrap_or_else(|e| {
        json!({
            "status": "error",
            "error": {
                "category": "ADAPTER_PROTOCOL_ERROR",
                "message": format!("serialize response failed: {e}"),
                "type": "SerializeError",
            }
        })
        .to_string()
    });

    print!("{out}");
}
