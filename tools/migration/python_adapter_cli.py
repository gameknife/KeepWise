#!/usr/bin/env python3
"""Reference adapter CLI implementing the diff-runner stdin/stdout JSON protocol.

This is a Python implementation of the planned Rust adapter contract, useful for:
- validating the adapter protocol end-to-end before Rust toolchain is ready
- serving as executable spec for future Rust CLI implementation

Input:  stdin JSON request (see `run_diff_regression.py::invoke_rust_adapter_cli`)
Output: stdout JSON response:
  success -> {"status":"success","payload":{...}}
  error   -> {"status":"error","error":{"category","message","type"}}
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT_DIR / "apps" / "keepwise-legacy" / "scripts"


def _ensure_scripts_on_path() -> None:
    scripts = str(SCRIPTS_DIR)
    if scripts not in sys.path:
        sys.path.insert(0, scripts)


def _lazy_import_modules() -> dict[str, Any]:
    _ensure_scripts_on_path()
    import investment_analytics_service as investment_service  # type: ignore
    import wealth_analytics_service as wealth_service  # type: ignore

    return {
        "investment_service": investment_service,
        "wealth_service": wealth_service,
    }


@dataclass
class SimpleConfig:
    db_path: Path


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise RuntimeError("empty stdin request")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON request: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("request root must be object")
    return data


def _classify_error(exc: BaseException) -> tuple[str, str]:
    message = str(exc)
    if any(k in message for k in ["必填", "布尔参数不合法", "日期格式必须", "缺少字段", "preset 不支持", "至少需要选择"]):
        return "VALIDATION_ERROR", message
    if any(k in message for k in ["起始日期晚于结束日期", "结束日期早于最早可用记录"]):
        return "INVALID_RANGE_ERROR", message
    if any(k in message for k in ["没有可用", "有效快照不足", "当前没有可用于", "无可用时间范围"]):
        return "NO_DATA_ERROR", message
    return "UNKNOWN_ERROR", message


def _to_qs(query: dict[str, Any]) -> dict[str, list[str]]:
    qs: dict[str, list[str]] = {}
    for k, v in query.items():
        if isinstance(v, list):
            qs[str(k)] = [str(x) for x in v]
        else:
            qs[str(k)] = [str(v)]
    return qs


def _dispatch_handler(path: str):
    mods = _lazy_import_modules()
    investment_service = mods["investment_service"]
    wealth_service = mods["wealth_service"]
    table = {
        "/api/analytics/investment-return": investment_service.query_investment_return,
        "/api/analytics/investment-curve": investment_service.query_investment_curve,
        "/api/analytics/wealth-overview": wealth_service.query_wealth_overview,
        "/api/analytics/wealth-curve": wealth_service.query_wealth_curve,
    }
    if path not in table:
        raise KeyError(f"unsupported endpoint path: {path}")
    return table[path]


def main() -> int:
    parser = argparse.ArgumentParser(description="Python reference adapter for migration diff runner protocol")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument("--verbose", action="store_true", help="Print debug info to stderr")
    args = parser.parse_args()

    try:
        req = _read_request()
        schema_version = req.get("schema_version")
        if schema_version != 1:
            raise RuntimeError(f"unsupported schema_version: {schema_version}")

        endpoint = req.get("endpoint") or {}
        dataset = req.get("dataset") or {}
        query = req.get("query") or {}

        path = str(endpoint.get("path") or "").strip()
        db_path_raw = str(dataset.get("db_path") or "").strip()
        if not path:
            raise RuntimeError("request.endpoint.path missing")
        if not db_path_raw:
            raise RuntimeError("request.dataset.db_path missing")

        handler = _dispatch_handler(path)
        cfg = SimpleConfig(db_path=Path(db_path_raw))
        qs = _to_qs(query if isinstance(query, dict) else {})

        if args.verbose:
            case = req.get("case") or {}
            print(f"[python_adapter_cli] {case.get('id')} -> {path} db={db_path_raw}", file=sys.stderr)

        payload = handler(cfg, qs)
        resp = {"status": "success", "payload": payload}
    except Exception as exc:  # noqa: BLE001
        category, message = _classify_error(exc)
        resp = {
            "status": "error",
            "error": {
                "category": category,
                "message": message,
                "type": exc.__class__.__name__,
            },
        }

    if args.pretty:
        sys.stdout.write(json.dumps(resp, ensure_ascii=False, indent=2))
    else:
        sys.stdout.write(json.dumps(resp, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

