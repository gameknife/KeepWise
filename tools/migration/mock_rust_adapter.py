#!/usr/bin/env python3
"""Mock Rust adapter for KeepWise diff runner.

Purpose:
- Validate the `--rust-adapter-cmd` protocol before real Rust adapter exists.
- Replay per-case JSON outputs from a directory.

Usage example:
  python3 tools/migration/run_diff_regression.py \
    --emit-python-case-json-dir /tmp/kw_py

  python3 tools/migration/run_diff_regression.py \
    --rust-adapter-cmd "python3 tools/migration/mock_rust_adapter.py --replay-json-dir /tmp/kw_py"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Mock Rust adapter for diff runner")
    parser.add_argument("--replay-json-dir", type=Path, required=True, help="Directory with <case_id>.json replay files")
    parser.add_argument("--verbose", action="store_true", help="Emit debug info to stderr")
    args = parser.parse_args()

    req = _read_request()
    case = req.get("case") or {}
    case_id = str(case.get("id") or "").strip()
    if not case_id:
        raise RuntimeError("request.case.id missing")

    replay_path = args.replay_json_dir / f"{case_id}.json"
    if not replay_path.exists():
        raise FileNotFoundError(f"replay file not found: {replay_path}")

    payload = json.loads(replay_path.read_text(encoding="utf-8"))
    if args.verbose:
        endpoint = (req.get("endpoint") or {}).get("path")
        print(f"[mock_rust_adapter] replay {case_id} -> {replay_path} ({endpoint})", file=sys.stderr)

    if isinstance(payload, dict) and "__error__" in payload:
        err = payload.get("__error__") or {}
        resp = {
            "status": "error",
            "error": {
                "category": err.get("category"),
                "message": err.get("message"),
                "type": err.get("type"),
            },
        }
    else:
        resp = {
            "status": "success",
            "payload": payload,
        }

    sys.stdout.write(json.dumps(resp, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

