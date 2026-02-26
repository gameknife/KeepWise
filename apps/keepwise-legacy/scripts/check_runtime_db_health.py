#!/usr/bin/env python3
"""Non-destructive health check for the local KeepWise runtime database."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import keepwise_web_app as app_mod


def build_config(root: Path, db_path: Path | None) -> app_mod.AppConfig:
    base = app_mod.build_config(root)
    if db_path is None:
        return base
    return app_mod.AppConfig(
        root_dir=base.root_dir,
        work_dir=base.work_dir,
        rules_dir=base.rules_dir,
        db_path=db_path.resolve(),
        migrations_dir=base.migrations_dir,
        assets_dir=base.assets_dir,
        session_dir=base.session_dir,
    )


def run_health_check(cfg: app_mod.AppConfig) -> dict[str, Any]:
    checks: dict[str, Any] = {}
    failures: list[str] = []
    warnings: list[str] = []

    try:
        stats = app_mod.query_admin_db_stats(cfg)
        checks["db_stats"] = stats["summary"]
        checks["db_path"] = stats["db_path"]
    except Exception as exc:  # noqa: BLE001
        failures.append(f"db_stats 失败: {exc}")
        return {"ok": False, "failures": failures, "warnings": warnings, "checks": checks}

    total_rows = int(checks["db_stats"]["total_rows"])

    try:
        accounts = app_mod.query_accounts(cfg, {"kind": ["all"]})
        checks["accounts"] = {
            "investment_count": len(accounts.get("investment_accounts") or []),
            "cash_count": len(accounts.get("cash_accounts") or []),
            "real_estate_count": len(accounts.get("real_estate_accounts") or []),
        }
    except Exception as exc:  # noqa: BLE001
        failures.append(f"meta_accounts 失败: {exc}")
        accounts = {"investment_accounts": [], "cash_accounts": [], "real_estate_accounts": []}

    for name, func, params in (
        ("query_transactions", app_mod.query_transactions, {"limit": ["1"]}),
        ("query_investments", app_mod.query_investments, {"limit": ["1"]}),
        ("query_assets", app_mod.query_asset_valuations, {"limit": ["1"]}),
    ):
        try:
            payload = func(cfg, params)
            checks[name] = {
                "ok": True,
                "rows": len(payload.get("rows") or []),
            }
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{name} 失败: {exc}")

    try:
        wealth = app_mod.query_wealth_overview(cfg, {})
        checks["wealth_overview"] = {
            "ok": True,
            "as_of": wealth.get("as_of"),
            "reconciliation_ok": bool(wealth.get("summary", {}).get("reconciliation_ok")),
            "stale_account_count": int(wealth.get("summary", {}).get("stale_account_count") or 0),
            "row_count": len(wealth.get("rows") or []),
        }
        if not checks["wealth_overview"]["reconciliation_ok"]:
            warnings.append(
                "wealth_overview 对账不一致（selected_rows_total 与 wealth_total 存在差异）"
            )
    except ValueError as exc:
        warnings.append(f"wealth_overview 无可用数据: {exc}")
        checks["wealth_overview"] = {"ok": False, "reason": str(exc)}
    except Exception as exc:  # noqa: BLE001
        failures.append(f"wealth_overview 失败: {exc}")

    investment_accounts = accounts.get("investment_accounts") or []
    if investment_accounts:
        try:
            curve = app_mod.query_investment_curve(
                cfg,
                {
                    "account_id": [app_mod.PORTFOLIO_ACCOUNT_ID],
                    "preset": ["1y"],
                },
            )
            checks["portfolio_curve"] = {
                "ok": True,
                "points": int(curve.get("summary", {}).get("count") or 0),
                "end_cumulative_return_pct_text": curve.get("summary", {}).get("end_cumulative_return_pct_text"),
                "end_net_growth_yuan": curve.get("summary", {}).get("end_net_growth_yuan"),
            }
        except ValueError as exc:
            warnings.append(f"portfolio_curve 数据不足: {exc}")
            checks["portfolio_curve"] = {"ok": False, "reason": str(exc)}
        except Exception as exc:  # noqa: BLE001
            failures.append(f"portfolio_curve 失败: {exc}")
    else:
        warnings.append("当前无投资账户，跳过组合收益曲线检查")
        checks["portfolio_curve"] = {"ok": False, "reason": "no_investment_accounts"}

    if total_rows == 0:
        warnings.append("数据库当前无业务数据（total_rows = 0）")

    return {
        "ok": len(failures) == 0,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "failures": failures,
        "warnings": warnings,
        "checks": checks,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run non-destructive runtime DB health checks")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[3],
        help="Project root (default: repo root)",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="Override database path (default: data/work/processed/ledger/keepwise.db)",
    )
    parser.add_argument("--json", action="store_true", help="Output JSON only")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = build_config(args.root.resolve(), args.db)
    result = run_health_check(cfg)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("KeepWise 运行库健康检查")
        print(f"  ok: {result['ok']}")
        print(f"  db_path: {result['checks'].get('db_path', cfg.db_path)}")
        for key, value in result["checks"].items():
            if key == "db_path":
                continue
            print(f"  {key}: {value}")
        if result["warnings"]:
            print("  warnings:")
            for item in result["warnings"]:
                print(f"    - {item}")
        if result["failures"]:
            print("  failures:")
            for item in result["failures"]:
                print(f"    - {item}")

    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
