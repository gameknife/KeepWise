#!/usr/bin/env python3
"""Phase-1 differential regression runner scaffold for KeepWise Tauri migration.

Current scope:
- Load YAML case manifest (`tools/migration/cases/*.yaml`)
- Build deterministic local SQLite datasets for baseline execution
- Execute Python adapters (function-level query_* calls)
- Validate expected success/error outcomes
- Run invariant checks (subset used by analytics_core suite)
- Run cross-case checks
- Emit text summary and optional JSON report

Rust adapter integration is intentionally left as a later step.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import os
import re
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = ROOT_DIR / "apps" / "keepwise-legacy" / "scripts"


def _ensure_scripts_on_path() -> None:
    scripts = str(SCRIPTS_DIR)
    if scripts not in sys.path:
        sys.path.insert(0, scripts)


def _load_yaml(path: Path) -> Any:
    """Load YAML with PyYAML if available, otherwise fallback to Ruby stdlib."""
    try:
        import yaml  # type: ignore

        with path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except ModuleNotFoundError:
        # Ruby is present in this environment and ships YAML in stdlib (psych).
        cmd = [
            "ruby",
            "-rjson",
            "-ryaml",
            "-e",
            "print JSON.generate(YAML.load_file(ARGV[0]))",
            str(path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(
                "无法读取 YAML（未安装 PyYAML，且 Ruby YAML 回退失败）:\n"
                f"stdout:\n{proc.stdout}\n\nstderr:\n{proc.stderr}"
            )
        return json.loads(proc.stdout)


def _lazy_import_modules() -> dict[str, Any]:
    _ensure_scripts_on_path()
    import investment_analytics_service as investment_service  # type: ignore
    import migrate_ledger_db as migrate_mod  # type: ignore
    import validate_m1_analytics as validate_mod  # type: ignore
    import wealth_analytics_service as wealth_service  # type: ignore

    return {
        "investment_service": investment_service,
        "wealth_service": wealth_service,
        "migrate_mod": migrate_mod,
        "validate_mod": validate_mod,
    }


@dataclass
class SimpleConfig:
    db_path: Path


@dataclass
class DatasetRuntime:
    ref: str
    temp_dir: tempfile.TemporaryDirectory[str]
    db_path: Path
    fixtures: dict[str, Any]
    config: SimpleConfig


PLACEHOLDER_RE = re.compile(r"^\$\{fixture\.([A-Za-z0-9_]+)\}$")
PLACEHOLDER_INLINE_RE = re.compile(r"\$\{fixture\.([A-Za-z0-9_]+)\}")


def resolve_placeholders(value: Any, fixtures: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {k: resolve_placeholders(v, fixtures) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_placeholders(v, fixtures) for v in value]
    if isinstance(value, str):
        m = PLACEHOLDER_RE.match(value)
        if m:
            key = m.group(1)
            if key not in fixtures:
                raise KeyError(f"fixture 占位符未提供: {key}")
            return fixtures[key]

        def repl(match: re.Match[str]) -> str:
            key = match.group(1)
            if key not in fixtures:
                raise KeyError(f"fixture 占位符未提供: {key}")
            return str(fixtures[key])

        return PLACEHOLDER_INLINE_RE.sub(repl, value)
    return value


def path_exists(obj: Any, path: str) -> bool:
    try:
        _ = get_path(obj, path)
        return True
    except Exception:
        return False


def get_path(obj: Any, path: str) -> Any:
    """Resolve dot path with optional list indices like rows[-1].value."""
    if not path:
        return obj
    current = obj
    for part in path.split("."):
        if part == "":
            continue
        m = re.fullmatch(r"([A-Za-z0-9_]+)(\[(\-?\d+)\])?", part)
        if not m:
            raise KeyError(f"不支持的路径片段: {part}")
        key = m.group(1)
        idx_text = m.group(3)
        if not isinstance(current, dict):
            raise KeyError(f"路径 {path} 在 {part} 前不是对象")
        if key not in current:
            raise KeyError(f"路径不存在: {path}")
        current = current[key]
        if idx_text is not None:
            if not isinstance(current, list):
                raise KeyError(f"路径 {path} 片段 {part} 不是数组")
            idx = int(idx_text)
            current = current[idx]
    return current


def approx_equal(a: Any, b: Any, abs_tol: float = 1e-8) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(float(a), float(b), rel_tol=0.0, abs_tol=abs_tol)
    return a == b


def _strip_outer_parens(expr: str) -> str:
    text = expr.strip()
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        balanced = True
        for i, ch in enumerate(text):
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth < 0:
                    balanced = False
                    break
                if depth == 0 and i != len(text) - 1:
                    balanced = False
                    break
        if balanced and depth == 0:
            text = text[1:-1].strip()
        else:
            break
    return text


def _split_top_level(expr: str, op: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    bracket_depth = 0
    start = 0
    for i, ch in enumerate(expr):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "[":
            bracket_depth += 1
        elif ch == "]":
            bracket_depth -= 1
        elif ch == op and depth == 0 and bracket_depth == 0:
            parts.append(expr[start:i].strip())
            start = i + 1
    if parts:
        parts.append(expr[start:].strip())
    return parts


def eval_simple_value(expr: str, data: Any) -> Any:
    expr = _strip_outer_parens(expr)

    if re.fullmatch(r"-?\d+", expr):
        return int(expr)
    if re.fullmatch(r"-?\d+\.\d+", expr):
        return float(expr)

    if expr in {"true", "True"}:
        return True
    if expr in {"false", "False"}:
        return False
    if expr in {"null", "None"}:
        return None

    m_len = re.fullmatch(r"len\(([^)]+)\)", expr)
    if m_len:
        target = get_path(data, m_len.group(1).strip())
        if not isinstance(target, list):
            raise ValueError(f"len() 目标不是数组: {expr}")
        return len(target)

    m_count = re.fullmatch(r"count\(([^[]+)\[\*\] where ([A-Za-z0-9_]+) > 0\)", expr)
    if m_count:
        list_path = m_count.group(1).strip()
        field_name = m_count.group(2)
        arr = get_path(data, list_path)
        if not isinstance(arr, list):
            raise ValueError(f"count() 目标不是数组: {expr}")
        total = 0
        for item in arr:
            if isinstance(item, dict) and float(item.get(field_name, 0) or 0) > 0:
                total += 1
        return total

    # Arithmetic: support + and - at top level.
    minus_parts = _split_top_level(expr, "-")
    if minus_parts:
        value = eval_simple_value(minus_parts[0], data)
        for p in minus_parts[1:]:
            value = value - eval_simple_value(p, data)
        return value

    plus_parts = _split_top_level(expr, "+")
    if plus_parts:
        value = eval_simple_value(plus_parts[0], data)
        for p in plus_parts[1:]:
            value = value + eval_simple_value(p, data)
        return value

    return get_path(data, expr)


def eval_boolean_expr(expr: str, data: Any) -> bool:
    expr = _strip_outer_parens(expr)
    eq_parts = _split_top_level(expr, "=") if "==" in expr else []
    # _split_top_level can't distinguish '=' vs '==', handle explicit parse:
    if "==" in expr:
        depth = 0
        for i in range(len(expr) - 1):
            ch = expr[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif expr[i : i + 2] == "==" and depth == 0:
                left = expr[:i].strip()
                right = expr[i + 2 :].strip()
                return eval_simple_value(left, data) == eval_simple_value(right, data)
    value = eval_simple_value(expr, data)
    return bool(value)


def should_run_invariant_when(when: str | None, payload: Any) -> bool:
    if not when:
        return True
    if when == "rows_non_empty":
        rows = payload.get("rows", []) if isinstance(payload, dict) else []
        return isinstance(rows, list) and len(rows) > 0
    raise ValueError(f"未实现的 invariant when 条件: {when}")


def classify_error(exc: BaseException) -> tuple[str, str]:
    message = str(exc)
    if any(k in message for k in ["必填", "布尔参数不合法", "日期格式必须", "缺少字段", "preset 不支持", "至少需要选择"]):
        return "VALIDATION_ERROR", message
    if any(k in message for k in ["起始日期晚于结束日期", "结束日期早于最早可用记录"]):
        return "INVALID_RANGE_ERROR", message
    if any(k in message for k in ["没有可用", "有效快照不足", "当前没有可用于", "无可用时间范围"]):
        return "NO_DATA_ERROR", message
    return "UNKNOWN_ERROR", message


def load_rust_case_json(case_id: str, rust_json_dir: Path) -> dict[str, Any] | None:
    """Load simulated Rust output from `<dir>/<case_id>.json`.

    File formats supported:
    1) Success payload JSON object/array (treated as payload)
    2) Error envelope:
       {
         "__error__": {
           "category": "VALIDATION_ERROR",
           "message": "..."
         }
       }
    """
    path = rust_json_dir / f"{case_id}.json"
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def invoke_rust_adapter_cli(
    adapter_cmd: str,
    *,
    timeout_sec: float,
    case_id: str,
    case: dict[str, Any],
    endpoint_profile_key: str,
    endpoint_profile: dict[str, Any],
    dataset: DatasetRuntime,
    query: dict[str, Any],
    expected_outcome: str,
) -> dict[str, Any]:
    """Invoke external Rust adapter CLI via stdin/stdout JSON protocol.

    Request protocol (stdin JSON):
    {
      "schema_version": 1,
      "case": {"id", "tags", "expected_outcome"},
      "endpoint": {"profile", "method", "path"},
      "query": {...},
      "dataset": {"ref", "db_path", "fixtures"},
      "runtime": {"root_dir"}
    }

    Response protocol (stdout JSON):
    - Success: {"status":"success","payload":{...}}
    - Error:   {"status":"error","error":{"category":"...","message":"...","type":"..."}}
    """
    argv = shlex.split(adapter_cmd)
    if not argv:
        raise ValueError("rust adapter command is empty")

    request_obj = {
        "schema_version": 1,
        "case": {
            "id": case_id,
            "tags": list(case.get("tags") or []),
            "expected_outcome": expected_outcome,
        },
        "endpoint": {
            "profile": endpoint_profile_key,
            "method": endpoint_profile.get("method", "GET"),
            "path": endpoint_profile.get("path"),
            "contract": endpoint_profile.get("contract"),
        },
        "query": query,
        "dataset": {
            "ref": dataset.ref,
            "db_path": str(dataset.db_path),
            "fixtures": dataset.fixtures,
        },
        "runtime": {
            "root_dir": str(ROOT_DIR),
        },
    }

    proc = subprocess.run(
        argv,
        input=json.dumps(request_obj, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=timeout_sec,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "rust adapter command failed "
            f"(exit={proc.returncode})\nstdout:\n{proc.stdout}\n\nstderr:\n{proc.stderr}"
        )

    stdout = (proc.stdout or "").strip()
    if not stdout:
        raise RuntimeError("rust adapter returned empty stdout")
    try:
        resp = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"rust adapter stdout is not valid JSON: {exc}\nstdout:\n{stdout}") from exc
    if not isinstance(resp, dict):
        raise RuntimeError(f"rust adapter response must be object, got {type(resp).__name__}")
    return resp


def _sort_array_at_path(payload: Any, path: str, keys: list[str]) -> None:
    if not path:
        return
    current = payload
    parts = path.split(".")
    for part in parts[:-1]:
        if not isinstance(current, dict) or part not in current:
            return
        current = current[part]
    leaf = parts[-1]
    if not isinstance(current, dict) or leaf not in current:
        return
    arr = current.get(leaf)
    if not isinstance(arr, list):
        return

    def sort_key(item: Any) -> tuple[Any, ...]:
        if not isinstance(item, dict):
            return (repr(item),)
        values: list[Any] = []
        for k in keys:
            values.append(item.get(k))
        return tuple(values)

    current[leaf] = sorted(arr, key=sort_key)


def normalize_payload_for_compare(payload: Any, compare_spec: dict[str, Any]) -> Any:
    data = copy.deepcopy(payload)
    unordered_arrays = [str(x) for x in (compare_spec.get("unordered_arrays") or [])]
    unordered_keys_map = compare_spec.get("unordered_array_keys") or {}
    for path in unordered_arrays:
        keys = [str(x) for x in (unordered_keys_map.get(path) or [])]
        if not keys:
            continue
        _sort_array_at_path(data, path, keys)
    return data


def _parse_pattern_segments(pattern: str) -> list[tuple[str, bool]]:
    segments: list[tuple[str, bool]] = []
    for part in pattern.split("."):
        m = re.fullmatch(r"([A-Za-z0-9_]+)(\[\*\])?", part)
        if not m:
            raise ValueError(f"unsupported compare path pattern segment: {part}")
        segments.append((m.group(1), bool(m.group(2))))
    return segments


def expand_path_pattern(obj: Any, pattern: str) -> list[tuple[str, Any]]:
    """Expand path patterns like `rows[*].snapshot_date` into concrete paths."""
    segments = _parse_pattern_segments(pattern)
    out: list[tuple[str, Any]] = []

    def walk(current: Any, seg_idx: int, path_parts: list[str]) -> None:
        if seg_idx >= len(segments):
            out.append((".".join(path_parts), current))
            return
        key, wildcard = segments[seg_idx]
        if not isinstance(current, dict) or key not in current:
            raise KeyError(f"path missing while expanding pattern {pattern}: {'.'.join(path_parts + [key])}")
        nxt = current[key]
        if wildcard:
            if not isinstance(nxt, list):
                raise KeyError(f"path is not array for wildcard pattern {pattern}: {'.'.join(path_parts + [key])}")
            for idx, item in enumerate(nxt):
                walk(item, seg_idx + 1, path_parts + [f"{key}[{idx}]"])
        else:
            walk(nxt, seg_idx + 1, path_parts + [key])

    walk(obj, 0, [])
    return out


def compare_payloads_by_profile(
    py_payload: Any,
    rust_payload: Any,
    compare_spec: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (diff_errors, diff_warnings)."""
    diff_errors: list[dict[str, Any]] = []
    diff_warnings: list[dict[str, Any]] = []

    py_norm = normalize_payload_for_compare(py_payload, compare_spec)
    rust_norm = normalize_payload_for_compare(rust_payload, compare_spec)
    float_abs_tol = float(compare_spec.get("float_abs_tol", 1e-8))

    optional_patterns = {str(x) for x in (compare_spec.get("optional_paths") or [])}
    exact_patterns = [str(x) for x in (compare_spec.get("exact_paths") or [])]
    approx_patterns = [str(x) for x in (compare_spec.get("approx_paths") or [])]
    format_patterns = [str(x) for x in (compare_spec.get("format_paths") or [])]
    weak_patterns = [str(x) for x in (compare_spec.get("weak_text_paths") or [])]

    def add_item(level: str, kind: str, path: str, detail: str, py_value: Any = None, rust_value: Any = None) -> None:
        item = {
            "kind": kind,
            "path": path,
            "detail": detail,
        }
        if py_value is not None or rust_value is not None:
            item["python_value"] = py_value
            item["rust_value"] = rust_value
        if level == "error":
            diff_errors.append(item)
        else:
            diff_warnings.append(item)

    def compare_pattern(pattern: str, mode: str, severity: str) -> None:
        py_exists = True
        rust_exists = True
        try:
            py_expanded = expand_path_pattern(py_norm, pattern)
        except KeyError:
            py_exists = False
            py_expanded = []
        try:
            rust_expanded = expand_path_pattern(rust_norm, pattern)
        except KeyError:
            rust_exists = False
            rust_expanded = []

        if not py_exists and not rust_exists and pattern in optional_patterns:
            return
        if not py_exists or not rust_exists:
            add_item(
                severity,
                "missing_path",
                pattern,
                f"path missing (python_exists={py_exists}, rust_exists={rust_exists})",
            )
            return

        if len(py_expanded) != len(rust_expanded):
            add_item(
                severity,
                "array_length_mismatch",
                pattern,
                f"expanded item count mismatch: python={len(py_expanded)}, rust={len(rust_expanded)}",
            )
            return

        for (py_path, py_val), (rust_path, rust_val) in zip(py_expanded, rust_expanded):
            concrete_path = py_path
            if py_path != rust_path:
                add_item(
                    severity,
                    "expanded_path_mismatch",
                    pattern,
                    f"expanded path mismatch: python={py_path}, rust={rust_path}",
                )
                continue
            ok = False
            if mode == "exact":
                ok = py_val == rust_val
            elif mode == "approx":
                ok = approx_equal(py_val, rust_val, float_abs_tol)
            else:
                ok = py_val == rust_val
            if not ok:
                add_item(
                    severity,
                    "value_mismatch",
                    concrete_path,
                    f"{mode} compare mismatch",
                    py_val,
                    rust_val,
                )

    for pattern in exact_patterns:
        compare_pattern(pattern, "exact", "error")
    for pattern in approx_patterns:
        compare_pattern(pattern, "approx", "error")
    for pattern in format_patterns:
        compare_pattern(pattern, "exact", "warn")
    for pattern in weak_patterns:
        compare_pattern(pattern, "exact", "warn")

    return diff_errors, diff_warnings


def compare_error_results(
    py_error: dict[str, Any],
    rust_error: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    diff_errors: list[dict[str, Any]] = []
    diff_warnings: list[dict[str, Any]] = []

    py_cat = py_error.get("category")
    rust_cat = rust_error.get("category")
    if py_cat != rust_cat:
        diff_errors.append(
            {
                "kind": "error_category_mismatch",
                "path": "error.category",
                "detail": "error category mismatch",
                "python_value": py_cat,
                "rust_value": rust_cat,
            }
        )

    py_msg = str(py_error.get("message", ""))
    rust_msg = str(rust_error.get("message", ""))
    if py_msg != rust_msg:
        diff_warnings.append(
            {
                "kind": "error_message_mismatch",
                "path": "error.message",
                "detail": "error message differs (allowed warning in Phase 1 if category matches)",
                "python_value": py_msg,
                "rust_value": rust_msg,
            }
        )
    return diff_errors, diff_warnings


def _make_qs(query: dict[str, Any]) -> dict[str, list[str]]:
    return {str(k): [str(v)] for k, v in query.items()}


def _python_endpoint_dispatch(path: str):
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
        raise KeyError(f"Python adapter 尚未支持 endpoint: {path}")
    return table[path]


def build_dataset_runtime(dataset_ref: str) -> DatasetRuntime:
    mods = _lazy_import_modules()
    migrate_mod = mods["migrate_mod"]
    validate_mod = mods["validate_mod"]

    tmp = tempfile.TemporaryDirectory(prefix=f"kw_diff_{dataset_ref}_")
    db_path = Path(tmp.name) / "keepwise_diff.db"
    migrate_mod.apply_migrations(db_path, ROOT_DIR / "db" / "migrations")

    if dataset_ref == "m1_analytics_minimal":
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            meta = validate_mod.build_sample_dataset(conn)
            conn.commit()

            latest_row = conn.execute(
                """
                SELECT MAX(snapshot_date) AS max_date
                FROM (
                    SELECT snapshot_date FROM investment_records
                    UNION ALL
                    SELECT snapshot_date FROM account_valuations
                )
                """
            ).fetchone()
            latest_snapshot_date = str(latest_row[0]) if latest_row and latest_row[0] else meta["range_to"]

            history_row = conn.execute(
                """
                SELECT MAX(snapshot_date)
                FROM (
                    SELECT snapshot_date FROM investment_records
                    UNION ALL
                    SELECT snapshot_date FROM account_valuations
                )
                WHERE snapshot_date < ?
                """,
                (latest_snapshot_date,),
            ).fetchone()
            history_snapshot_date = str(history_row[0]) if history_row and history_row[0] else meta["range_from"]

            cash_row = conn.execute(
                "SELECT account_id FROM account_valuations WHERE asset_class='cash' ORDER BY account_id LIMIT 1"
            ).fetchone()
            re_row = conn.execute(
                "SELECT account_id FROM account_valuations WHERE asset_class='real_estate' ORDER BY account_id LIMIT 1"
            ).fetchone()
            liab_row = conn.execute(
                "SELECT account_id FROM account_valuations WHERE asset_class='liability' ORDER BY account_id LIMIT 1"
            ).fetchone()
        finally:
            conn.close()

        fixtures = {
            "inv_account_id": meta["investment_account_id"],
            "inv_account_id_alt": meta["investment_account_id"],
            "cash_account_id": str(cash_row[0]) if cash_row else "",
            "real_estate_account_id": str(re_row[0]) if re_row else "",
            "liability_account_id": str(liab_row[0]) if liab_row else "",
            "latest_snapshot_date": latest_snapshot_date,
            "history_snapshot_date": history_snapshot_date,
            "custom_from_date": meta["range_from"],
            "custom_to_date": meta["range_to"],
            "no_data_future_from": "2099-01-01",
            "no_data_future_to": "2099-01-31",
        }
    elif dataset_ref == "m1_analytics_edge_cases":
        conn = sqlite3.connect(db_path)
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            validate_mod.insert_account(conn, "acct_sparse_inv", "稀疏投资账户", "investment")
            validate_mod.insert_investment(
                conn,
                account_id="acct_sparse_inv",
                snapshot_date="2026-01-10",
                total_assets_cents=1_000_000,
                transfer_amount_cents=0,
            )
            conn.commit()
        finally:
            conn.close()

        fixtures = {
            "sparse_inv_account_id": "acct_sparse_inv",
            "sparse_from_date": "2026-01-01",
            "sparse_to_date": "2026-01-31",
        }
    else:
        tmp.cleanup()
        raise KeyError(f"未实现的数据集构建器: {dataset_ref}")

    return DatasetRuntime(
        ref=dataset_ref,
        temp_dir=tmp,
        db_path=db_path,
        fixtures=fixtures,
        config=SimpleConfig(db_path=db_path),
    )


def _normalize_query(query: dict[str, Any]) -> dict[str, Any]:
    # Keep strings for qs; preserve booleans only until qs conversion if needed.
    return query


def evaluate_expected_success(payload: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    for path in expected.get("required_paths", []) or []:
        if not path_exists(payload, str(path)):
            errors.append(f"required path missing: {path}")
    for check in expected.get("path_equals", []) or []:
        left = str(check["left"])
        if "right_path" in check:
            right = get_path(payload, str(check["right_path"]))
        elif "right" in check:
            candidate = check["right"]
            if isinstance(candidate, str) and path_exists(payload, candidate):
                right = get_path(payload, candidate)
            else:
                right = candidate
        else:
            right = check.get("right_value")
        left_value = get_path(payload, left)
        if left_value != right:
            errors.append(f"path_equals mismatch: {left}={left_value!r} != {right!r}")
    return errors


def evaluate_expected_error(exc: BaseException, expected: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    category, message = classify_error(exc)
    want_category = expected.get("category")
    if want_category and category != want_category:
        errors.append(f"error category mismatch: got {category}, want {want_category} (message={message!r})")

    keywords_all = [str(x) for x in (expected.get("message_keywords") or [])]
    for kw in keywords_all:
        if kw not in message:
            errors.append(f"error message missing keyword: {kw!r} (message={message!r})")

    keywords_any = [str(x) for x in (expected.get("message_keywords_any") or [])]
    if keywords_any and not any(kw in message for kw in keywords_any):
        errors.append(f"error message missing any keywords {keywords_any!r} (message={message!r})")

    return errors


def _eval_invariant(name: str, spec: dict[str, Any], payload: dict[str, Any]) -> tuple[bool, str]:
    if not should_run_invariant_when(spec.get("when"), payload):
        return True, "skipped by condition"

    inv_type = spec.get("type")
    try:
        if inv_type == "path_equals":
            left = get_path(payload, str(spec["left"]))
            right = get_path(payload, str(spec["right"]))
            ok = left == right
            return ok, f"{spec['left']} == {spec['right']} -> {left!r} vs {right!r}"

        if inv_type == "path_gt":
            left = get_path(payload, str(spec["path"]))
            target = spec["value"]
            ok = left > target
            return ok, f"{spec['path']} > {target!r} -> {left!r}"

        if inv_type == "path_equals_derived":
            left = get_path(payload, str(spec["left"]))
            right = eval_simple_value(str(spec["right_expr"]), payload)
            ok = left == right
            return ok, f"{spec['left']} == {spec['right_expr']} -> {left!r} vs {right!r}"

        if inv_type == "path_approx_equals_derived":
            left = get_path(payload, str(spec["left"]))
            right = eval_simple_value(str(spec["right_expr"]), payload)
            tol = float(spec.get("abs_tol", 1e-8))
            ok = approx_equal(left, right, tol)
            return ok, f"{spec['left']} ~= {spec['right_expr']} -> {left!r} vs {right!r} (tol={tol})"

        if inv_type == "array_sorted_by":
            arr = get_path(payload, str(spec["path"]))
            key = str(spec["key"])
            order = str(spec.get("order", "asc")).lower()
            if not isinstance(arr, list):
                return False, f"{spec['path']} is not array"
            extracted = [item.get(key) if isinstance(item, dict) else None for item in arr]
            sorted_vals = sorted(extracted)
            ok = extracted == (sorted_vals if order == "asc" else list(reversed(sorted_vals)))
            return ok, f"{spec['path']} sorted by {key} {order}"

        if inv_type == "boolean_matches_expression":
            actual = get_path(payload, str(spec["path"]))
            expected_bool = eval_boolean_expr(str(spec["expr"]), payload)
            ok = bool(actual) == bool(expected_bool)
            return ok, f"{spec['path']} == ({spec['expr']}) -> {actual!r} vs {expected_bool!r}"

        if inv_type == "expression_true":
            ok = eval_boolean_expr(str(spec["expr"]), payload)
            return bool(ok), f"{spec['expr']} -> {ok!r}"

        return False, f"unsupported invariant type: {inv_type}"
    except Exception as exc:  # pragma: no cover - defensive reporting path
        return False, f"invariant exception: {exc}"


def run_case(
    case: dict[str, Any],
    manifest: dict[str, Any],
    datasets_cache: dict[str, DatasetRuntime],
    *,
    rust_adapter_cmd: str | None = None,
    rust_adapter_timeout_sec: float = 10.0,
    rust_json_dir: Path | None = None,
    emit_python_case_json_dir: Path | None = None,
    verbose: bool = False,
) -> dict[str, Any]:
    case_id = str(case["id"])
    endpoint_profile_key = str(case["endpoint_profile"])
    endpoint_profiles = manifest.get("endpoint_profiles", {})
    endpoint_profile = endpoint_profiles.get(endpoint_profile_key)
    if not endpoint_profile:
        return {
            "case_id": case_id,
            "status": "fail",
            "errors": [f"missing endpoint_profile: {endpoint_profile_key}"],
        }

    dataset_ref = str(case["dataset_ref"])
    if dataset_ref not in datasets_cache:
        datasets_cache[dataset_ref] = build_dataset_runtime(dataset_ref)
    dataset = datasets_cache[dataset_ref]

    raw_query = dict(case.get("query") or {})
    expected = resolve_placeholders(case.get("expected") or {}, dataset.fixtures)
    query = _normalize_query(resolve_placeholders(raw_query, dataset.fixtures))
    qs = _make_qs(query)

    py_status_cfg = ((case.get("status") or {}).get("python") or "active")
    rust_status_cfg = ((case.get("status") or {}).get("rust") or "pending")

    result: dict[str, Any] = {
        "case_id": case_id,
        "endpoint_profile": endpoint_profile_key,
        "path": endpoint_profile.get("path"),
        "dataset_ref": dataset_ref,
        "query": query,
        "expected_outcome": expected.get("outcome", "success"),
        "python": {"configured_status": py_status_cfg},
        "rust": {"configured_status": rust_status_cfg},
        "status": "pending",
        "baseline_errors": [],
        "invariants": [],
        "diff_errors": [],
        "diff_warnings": [],
    }

    if py_status_cfg not in {"active", "python-only-baseline"}:
        result["status"] = "skip"
        result["python"]["status"] = "skipped"
        result["rust"]["status"] = "pending" if rust_status_cfg == "pending" else "skipped"
        return result

    handler = _python_endpoint_dispatch(str(endpoint_profile["path"]))
    expected_outcome = str(expected.get("outcome", "success"))
    payload: dict[str, Any] | None = None
    caught_exc: BaseException | None = None

    try:
        payload = handler(dataset.config, qs)
        result["python"]["status"] = "success"
        result["python"]["payload"] = payload
    except Exception as exc:  # noqa: BLE001
        caught_exc = exc
        category, message = classify_error(exc)
        result["python"]["status"] = "error"
        result["python"]["error"] = {
            "type": exc.__class__.__name__,
            "category": category,
            "message": message,
        }
        if verbose:
            result["python"]["traceback"] = traceback.format_exc()

    if expected_outcome == "success":
        if caught_exc is not None:
            result["baseline_errors"].append(
                f"expected success but got error: {result['python']['error']['category']} {result['python']['error']['message']}"
            )
        elif payload is not None:
            result["baseline_errors"].extend(evaluate_expected_success(payload, expected))
    elif expected_outcome == "error":
        if caught_exc is None:
            result["baseline_errors"].append("expected error but got success payload")
        else:
            result["baseline_errors"].extend(evaluate_expected_error(caught_exc, expected))
    else:
        result["baseline_errors"].append(f"unsupported expected.outcome: {expected_outcome}")

    # Invariants only on successful payloads.
    invariants = case.get("invariants") or []
    if payload is not None and expected_outcome == "success":
        inv_library = manifest.get("invariant_library", {})
        for inv_name in invariants:
            spec = inv_library.get(inv_name)
            if not spec:
                result["invariants"].append({"name": inv_name, "ok": False, "detail": "missing invariant spec"})
                result["baseline_errors"].append(f"missing invariant spec: {inv_name}")
                continue
            ok, detail = _eval_invariant(str(inv_name), spec, payload)
            result["invariants"].append({"name": inv_name, "ok": ok, "detail": detail})
            if not ok:
                result["baseline_errors"].append(f"invariant failed: {inv_name} ({detail})")

    if emit_python_case_json_dir:
        emit_python_case_json_dir.mkdir(parents=True, exist_ok=True)
        out_path = emit_python_case_json_dir / f"{case_id}.json"
        if result["python"]["status"] == "success":
            out_obj: Any = result["python"]["payload"]
        elif result["python"]["status"] == "error":
            out_obj = {"__error__": result["python"]["error"]}
        else:
            out_obj = {"__meta__": {"status": result["python"]["status"]}}
        out_path.write_text(json.dumps(out_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    result["rust"]["status"] = "pending" if rust_status_cfg == "pending" else "not_implemented"
    result["diff_status"] = "pending"

    rust_case_obj: dict[str, Any] | None = None
    rust_adapter_response: dict[str, Any] | None = None
    if rust_adapter_cmd:
        try:
            rust_adapter_response = invoke_rust_adapter_cli(
                rust_adapter_cmd,
                timeout_sec=rust_adapter_timeout_sec,
                case_id=case_id,
                case=case,
                endpoint_profile_key=endpoint_profile_key,
                endpoint_profile=endpoint_profile,
                dataset=dataset,
                query=query,
                expected_outcome=expected_outcome,
            )
        except Exception as exc:  # noqa: BLE001
            result["rust"]["status"] = "adapter_error"
            result["rust"]["error"] = {
                "category": "ADAPTER_EXEC_ERROR",
                "message": str(exc),
                "type": exc.__class__.__name__,
            }
            if verbose:
                result["rust"]["adapter_traceback"] = traceback.format_exc()
            result["diff_errors"].append(
                {
                    "kind": "adapter_exec_error",
                    "path": "",
                    "detail": str(exc),
                }
            )
            result["diff_status"] = "fail"
            # Continue to final status aggregation below.
        else:
            # Normalize CLI envelope to same internal object model.
            if "status" not in rust_adapter_response:
                result["rust"]["status"] = "adapter_error"
                result["rust"]["error"] = {
                    "category": "ADAPTER_PROTOCOL_ERROR",
                    "message": "adapter response missing status",
                }
                result["diff_errors"].append(
                    {
                        "kind": "adapter_protocol_error",
                        "path": "status",
                        "detail": "adapter response missing status",
                    }
                )
                result["diff_status"] = "fail"
            else:
                rust_state = str(rust_adapter_response.get("status"))
                if rust_state == "success":
                    result["rust"]["status"] = "success"
                    result["rust"]["payload"] = rust_adapter_response.get("payload")
                elif rust_state == "error":
                    rust_err = dict(rust_adapter_response.get("error") or {})
                    if "category" not in rust_err and "message" in rust_err:
                        category, _ = classify_error(RuntimeError(str(rust_err.get("message"))))
                        rust_err["category"] = category
                    result["rust"]["status"] = "error"
                    result["rust"]["error"] = rust_err
                else:
                    result["rust"]["status"] = "adapter_error"
                    result["rust"]["error"] = {
                        "category": "ADAPTER_PROTOCOL_ERROR",
                        "message": f"unsupported adapter status: {rust_state}",
                    }
                    result["diff_errors"].append(
                        {
                            "kind": "adapter_protocol_error",
                            "path": "status",
                            "detail": f"unsupported adapter status: {rust_state}",
                        }
                    )
                    result["diff_status"] = "fail"

    if rust_json_dir is not None and "status" not in result["rust"]:
        rust_case_obj = load_rust_case_json(case_id, rust_json_dir)

    if "status" in result["rust"] and result["rust"]["status"] in {"success", "error", "adapter_error"}:
        pass
    elif rust_case_obj is None:
        result["rust"]["status"] = "pending" if rust_status_cfg == "pending" else "missing_fixture"
        result["diff_status"] = "pending"
    else:
        # Interpret rust fixture envelope
        if isinstance(rust_case_obj, dict) and "__error__" in rust_case_obj:
            rust_error = rust_case_obj.get("__error__") or {}
            result["rust"]["status"] = "error"
            result["rust"]["error"] = rust_error
        else:
            result["rust"]["status"] = "success"
            result["rust"]["payload"] = rust_case_obj

    if result["rust"].get("status") in {"success", "error"}:
        compare_spec = dict((endpoint_profile.get("compare") or {}))
        if result["python"]["status"] == "success" and result["rust"]["status"] == "success":
            diff_errors, diff_warnings = compare_payloads_by_profile(
                result["python"]["payload"],
                result["rust"]["payload"],
                compare_spec,
            )
            result["diff_errors"].extend(diff_errors)
            result["diff_warnings"].extend(diff_warnings)
        elif result["python"]["status"] == "error" and result["rust"]["status"] == "error":
            diff_errors, diff_warnings = compare_error_results(
                result["python"]["error"],
                result["rust"]["error"],
            )
            result["diff_errors"].extend(diff_errors)
            result["diff_warnings"].extend(diff_warnings)
        else:
            result["diff_errors"].append(
                {
                    "kind": "outcome_mismatch",
                    "path": "",
                    "detail": (
                        "python/rust outcome mismatch "
                        f"(python={result['python']['status']}, rust={result['rust']['status']})"
                    ),
                }
            )

        if result["diff_errors"]:
            result["diff_status"] = "fail"
        elif result["diff_warnings"]:
            result["diff_status"] = "warn"
        else:
            result["diff_status"] = "pass"
    elif result["rust"].get("status") == "adapter_error":
        result["diff_status"] = "fail"

    result["status"] = "pass"
    if result["baseline_errors"]:
        result["status"] = "fail"
    elif result["diff_status"] == "fail":
        result["status"] = "fail"
    elif result["diff_status"] in {"warn"}:
        result["status"] = "warn"
    return result


def run_cross_case_checks(
    manifest: dict[str, Any],
    case_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {str(r.get("case_id")): r for r in case_results}
    checks: list[dict[str, Any]] = []

    for check in manifest.get("cross_case_checks") or []:
        check_id = str(check.get("id"))
        status = str(check.get("status", "active"))
        if status != "active":
            checks.append({"id": check_id, "status": "skipped", "reason": f"status={status}"})
            continue

        depends = [str(x) for x in (check.get("depends_on") or [])]
        missing = [cid for cid in depends if cid not in by_id]
        if missing:
            checks.append({"id": check_id, "status": "skipped", "reason": f"missing dependent cases: {missing}"})
            continue

        dep_failures = [cid for cid in depends if by_id[cid].get("status") != "pass"]
        if dep_failures:
            checks.append({"id": check_id, "status": "skipped", "reason": f"dependent case not pass: {dep_failures}"})
            continue

        if str(check.get("type")) == "path_approx_equal_between_cases":
            left_case = by_id[str(check["left_case"])]
            right_case = by_id[str(check["right_case"])]
            try:
                left_value = get_path(left_case["python"]["payload"], str(check["left_path"]))
                right_value = get_path(right_case["python"]["payload"], str(check["right_path"]))
                tol = float(check.get("abs_tol", 1e-8))
                ok = approx_equal(left_value, right_value, tol)
                checks.append(
                    {
                        "id": check_id,
                        "status": "pass" if ok else "fail",
                        "detail": (
                            f"{check['left_case']}.{check['left_path']} ~= "
                            f"{check['right_case']}.{check['right_path']} -> {left_value!r} vs {right_value!r} (tol={tol})"
                        ),
                    }
                )
            except Exception as exc:  # noqa: BLE001
                checks.append({"id": check_id, "status": "fail", "detail": f"exception: {exc}"})
        else:
            checks.append({"id": check_id, "status": "fail", "detail": f"unsupported cross_case_checks type: {check.get('type')}"})

    return checks


def filter_cases(
    cases: list[dict[str, Any]],
    manifest: dict[str, Any],
    *,
    case_ids: set[str] | None,
    endpoint_filter: str | None,
    tags: set[str] | None,
) -> list[dict[str, Any]]:
    endpoint_profiles = manifest.get("endpoint_profiles", {})
    selected: list[dict[str, Any]] = []
    for case in cases:
        cid = str(case.get("id"))
        if case_ids and cid not in case_ids:
            continue
        if endpoint_filter:
            profile_key = str(case.get("endpoint_profile"))
            profile = endpoint_profiles.get(profile_key, {})
            path = str(profile.get("path", ""))
            if endpoint_filter not in {profile_key, path, path.rsplit("/", 1)[-1]}:
                continue
        if tags:
            case_tags = {str(t) for t in (case.get("tags") or [])}
            if not tags.issubset(case_tags):
                continue
        selected.append(case)
    return selected


def print_case_list(cases: list[dict[str, Any]], manifest: dict[str, Any]) -> None:
    endpoint_profiles = manifest.get("endpoint_profiles", {})
    for case in cases:
        profile = endpoint_profiles.get(str(case.get("endpoint_profile")), {})
        tags = ",".join(str(t) for t in (case.get("tags") or []))
        print(f"{case.get('id')}\t{profile.get('path')}\t{case.get('dataset_ref')}\t{tags}")


def summarize(results: list[dict[str, Any]], cross_checks: list[dict[str, Any]]) -> dict[str, Any]:
    status_counts: dict[str, int] = {}
    for r in results:
        status = str(r.get("status"))
        status_counts[status] = status_counts.get(status, 0) + 1

    cross_counts: dict[str, int] = {}
    for c in cross_checks:
        status = str(c.get("status"))
        cross_counts[status] = cross_counts.get(status, 0) + 1

    return {
        "cases": {
            "total": len(results),
            "status_counts": status_counts,
        },
        "cross_case_checks": {
            "total": len(cross_checks),
            "status_counts": cross_counts,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run KeepWise migration diff regression baseline/diff suites")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=ROOT_DIR / "tools" / "migration" / "cases" / "analytics_core.yaml",
        help="YAML case manifest path",
    )
    parser.add_argument("--case", action="append", dest="cases", help="Run specific case id (repeatable)")
    parser.add_argument("--endpoint", help="Filter by endpoint profile key, full path, or path tail")
    parser.add_argument("--tag", action="append", dest="tags", help="Require tag (repeatable)")
    parser.add_argument("--list-cases", action="store_true", help="List available cases after filters and exit")
    parser.add_argument("--json-out", type=Path, help="Write JSON report to file")
    parser.add_argument(
        "--rust-json-dir",
        type=Path,
        help="Directory of simulated Rust case JSON files (<case_id>.json) for diff comparison",
    )
    parser.add_argument(
        "--rust-adapter-cmd",
        help="External adapter command (stdin/stdout JSON protocol) to invoke Rust implementation per case",
    )
    parser.add_argument(
        "--rust-adapter-timeout-sec",
        type=float,
        default=10.0,
        help="Timeout in seconds for --rust-adapter-cmd (default: 10)",
    )
    parser.add_argument(
        "--emit-python-case-json-dir",
        type=Path,
        help="Export Python baseline result of each case to <dir>/<case_id>.json",
    )
    parser.add_argument("--verbose", action="store_true", help="Include verbose details (tracebacks)")
    args = parser.parse_args()

    manifest = _load_yaml(args.manifest)
    all_cases = list(manifest.get("cases") or [])
    selected_cases = filter_cases(
        all_cases,
        manifest,
        case_ids=set(args.cases or []) if args.cases else None,
        endpoint_filter=args.endpoint,
        tags=set(args.tags or []) if args.tags else None,
    )

    if args.list_cases:
        print_case_list(selected_cases, manifest)
        return 0

    if not selected_cases:
        print("No cases selected.")
        return 1

    datasets_cache: dict[str, DatasetRuntime] = {}
    results: list[dict[str, Any]] = []
    try:
        for case in selected_cases:
            results.append(
                run_case(
                    case,
                    manifest,
                    datasets_cache,
                    rust_adapter_cmd=args.rust_adapter_cmd,
                    rust_adapter_timeout_sec=args.rust_adapter_timeout_sec,
                    rust_json_dir=args.rust_json_dir,
                    emit_python_case_json_dir=args.emit_python_case_json_dir,
                    verbose=args.verbose,
                )
            )

        cross_checks = run_cross_case_checks(manifest, results)
        summary = summarize(results, cross_checks)

        # Text summary
        print(f"Manifest: {args.manifest}")
        print(f"Selected cases: {len(selected_cases)}")
        print("Case status counts:", summary["cases"]["status_counts"])
        if cross_checks:
            print("Cross-case check counts:", summary["cross_case_checks"]["status_counts"])

        for r in results:
            cid = r["case_id"]
            status = r["status"]
            endpoint = r.get("path")
            dataset = r.get("dataset_ref")
            print(f"[{status.upper():4}] {cid}  ({endpoint}, {dataset})")
            if r.get("baseline_errors"):
                for err in r["baseline_errors"]:
                    print(f"  - {err}")
            if r.get("diff_status") not in {None, "pending", "pass"}:
                print(f"  - diff_status={r.get('diff_status')}")
            if r.get("diff_errors"):
                for err in r["diff_errors"]:
                    print(f"  - DIFF {err.get('kind')}: {err.get('detail')} @ {err.get('path')}")
            if r.get("diff_warnings") and args.verbose:
                for warn in r["diff_warnings"]:
                    print(f"  - DIFF-WARN {warn.get('kind')}: {warn.get('detail')} @ {warn.get('path')}")

        for c in cross_checks:
            if c.get("status") != "pass":
                print(f"[XCHK {c.get('status', '').upper()}] {c.get('id')}: {c.get('detail') or c.get('reason')}")

        report = {
            "manifest": str(args.manifest),
            "summary": summary,
            "results": results,
            "cross_case_checks": cross_checks,
            "environment": {
                "cwd": os.getcwd(),
                "root_dir": str(ROOT_DIR),
                "scripts_dir": str(SCRIPTS_DIR),
            },
        }
        if args.json_out:
            args.json_out.parent.mkdir(parents=True, exist_ok=True)
            args.json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"JSON report written: {args.json_out}")

        case_fail = summary["cases"]["status_counts"].get("fail", 0)
        case_warn = summary["cases"]["status_counts"].get("warn", 0)
        cross_fail = summary["cross_case_checks"]["status_counts"].get("fail", 0)
        # Phase 1 warnings (format/weak text) should not fail the run.
        _ = case_warn
        return 1 if (case_fail or cross_fail) else 0
    finally:
        for dataset in datasets_cache.values():
            dataset.temp_dir.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
