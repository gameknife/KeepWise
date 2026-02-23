#!/usr/bin/env python3
"""HTTP route table builders for KeepWise M0 web app."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs


def build_get_page_file_routes() -> dict[str, str]:
    return {
        "/": "m0_app.html",
        "/consumption": "consumption_dashboard.html",
        "/consumption/": "consumption_dashboard.html",
        "/rules": "rules_admin.html",
        "/rules/": "rules_admin.html",
    }


def build_get_text_asset_routes() -> dict[str, tuple[str, str]]:
    return {
        "/assets/m0_app.css": ("m0_app.css", "text/css"),
        "/assets/consumption_report.css": ("consumption_report.css", "text/css"),
        "/assets/rules_admin.css": ("rules_admin.css", "text/css"),
    }


def build_get_api_routes(
    *,
    query_admin_db_stats: Any,
    query_merchant_map_rules: Any,
    query_category_rules: Any,
    query_bank_transfer_whitelist_rules: Any,
    query_merchant_rule_suggestions: Any,
    query_transactions: Any,
    query_investments: Any,
    query_asset_valuations: Any,
    query_accounts: Any,
    query_account_catalog: Any,
    query_monthly_budget_items: Any,
    query_investment_return: Any,
    query_investment_returns: Any,
    query_investment_curve: Any,
    query_wealth_overview: Any,
    query_wealth_curve: Any,
    query_budget_overview: Any,
    query_budget_monthly_review: Any,
    query_consumption_report: Any,
    query_salary_income_overview: Any,
    query_fire_progress: Any,
) -> dict[str, Any]:
    def _get_health_payload(handler: Any, parsed: Any) -> dict[str, Any]:
        _ = handler, parsed
        return {"ok": True, "time": datetime.now().isoformat(timespec="seconds")}

    def _get_query_payload(handler: Any, parsed: Any, fn: Any) -> dict[str, Any]:
        return fn(handler.config, parse_qs(parsed.query))

    def _get_noquery_payload(handler: Any, parsed: Any, fn: Any) -> dict[str, Any]:
        _ = parsed
        return fn(handler.config)

    return {
        "/api/health": _get_health_payload,
        "/api/admin/db-stats": lambda handler, parsed: _get_noquery_payload(handler, parsed, query_admin_db_stats),
        "/api/rules/merchant-map": lambda handler, parsed: _get_query_payload(handler, parsed, query_merchant_map_rules),
        "/api/rules/category-rules": lambda handler, parsed: _get_query_payload(handler, parsed, query_category_rules),
        "/api/rules/bank-transfer-whitelist": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_bank_transfer_whitelist_rules
        ),
        "/api/rules/merchant-suggestions": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_merchant_rule_suggestions
        ),
        "/api/query/transactions": lambda handler, parsed: _get_query_payload(handler, parsed, query_transactions),
        "/api/query/investments": lambda handler, parsed: _get_query_payload(handler, parsed, query_investments),
        "/api/query/assets": lambda handler, parsed: _get_query_payload(handler, parsed, query_asset_valuations),
        "/api/meta/accounts": lambda handler, parsed: _get_query_payload(handler, parsed, query_accounts),
        "/api/accounts/catalog": lambda handler, parsed: _get_query_payload(handler, parsed, query_account_catalog),
        "/api/budgets/monthly-items": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_monthly_budget_items
        ),
        "/api/analytics/investment-return": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_investment_return
        ),
        "/api/analytics/investment-returns": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_investment_returns
        ),
        "/api/analytics/investment-curve": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_investment_curve
        ),
        "/api/analytics/wealth-overview": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_wealth_overview
        ),
        "/api/analytics/wealth-curve": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_wealth_curve
        ),
        "/api/analytics/budget-overview": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_budget_overview
        ),
        "/api/analytics/budget-monthly-review": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_budget_monthly_review
        ),
        "/api/analytics/consumption-report": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_consumption_report
        ),
        "/api/analytics/salary-income": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_salary_income_overview
        ),
        "/api/analytics/fire-progress": lambda handler, parsed: _get_query_payload(
            handler, parsed, query_fire_progress
        ),
    }


def build_post_api_routes(
    *,
    preview_eml: Any,
    run_eml_import: Any,
    yzxy_preview_file: Any,
    yzxy_import_file: Any,
    preview_cmb_bank_pdf: Any,
    run_cmb_bank_pdf_import: Any,
    ensure_db: Any,
    parse_bool_param: Any,
    upsert_manual_investment: Any,
    update_investment_record: Any,
    delete_investment_record: Any,
    upsert_manual_asset_valuation: Any,
    update_asset_valuation: Any,
    delete_asset_valuation: Any,
    update_transaction_analysis_exclusion: Any,
    upsert_monthly_budget_item: Any,
    delete_monthly_budget_item: Any,
    upsert_account_catalog_entry: Any,
    delete_account_catalog_entry: Any,
    reset_admin_db_data: Any,
    reset_admin_transaction_data: Any,
    upsert_merchant_map_rule: Any,
    delete_merchant_map_rule: Any,
    upsert_category_rule: Any,
    delete_category_rule: Any,
    upsert_bank_transfer_whitelist_rule: Any,
    delete_bank_transfer_whitelist_rule: Any,
) -> dict[str, Any]:
    def _post_eml_preview(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        files = body.get("files") or []
        if not isinstance(files, list) or not files:
            raise ValueError("请上传至少一个 EML 文件")
        review_threshold = float(body.get("review_threshold", 0.70))
        session = handler.session_store.create_eml_session(files)
        summary = preview_eml(handler.config, session.input_dir or Path("."), review_threshold)
        return {"preview_token": session.token, "summary": summary}

    def _post_eml_import(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        token = str(body.get("preview_token", "")).strip()
        review_threshold = float(body.get("review_threshold", 0.70))
        session = handler.session_store.get(token, kind="eml")
        return run_eml_import(handler.config, session.input_dir or Path("."), review_threshold)

    def _post_yzxy_preview(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        item = body.get("file")
        if not isinstance(item, dict):
            raise ValueError("请上传有知有行导出文件")
        session = handler.session_store.create_single_file_session("yzxy", item, (".csv", ".xlsx"))
        preview = yzxy_preview_file(session.file_path or Path("."))
        return {"preview_token": session.token, "preview": preview}

    def _post_yzxy_import(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        token = str(body.get("preview_token", "")).strip()
        session = handler.session_store.get(token, kind="yzxy")
        ensure_db(handler.config)
        imported_count, error_count, import_job_id = yzxy_import_file(
            handler.config.db_path,
            session.file_path or Path("."),
        )
        return {
            "imported_count": imported_count,
            "error_count": error_count,
            "import_job_id": import_job_id,
            "db_path": str(handler.config.db_path),
        }

    def _post_cmb_bank_pdf_preview(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        item = body.get("file")
        if not isinstance(item, dict):
            raise ValueError("请上传招商银行流水 PDF 文件")
        session = handler.session_store.create_single_file_session("cmb_bank_pdf", item, (".pdf",))
        preview = preview_cmb_bank_pdf(handler.config, session.file_path or Path("."))
        return {"preview_token": session.token, "preview": preview}

    def _post_cmb_bank_pdf_import(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        token = str(body.get("preview_token", "")).strip()
        session = handler.session_store.get(token, kind="cmb_bank_pdf")
        return run_cmb_bank_pdf_import(handler.config, session.file_path or Path("."))

    def _post_json_body_to_fn(handler: Any, fn: Any) -> dict[str, Any]:
        body = handler._read_json()
        return fn(handler.config, body)

    def _post_admin_reset_db(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        confirm_text = str(body.get("confirm_text", "")).strip()
        clear_sessions = parse_bool_param(str(body.get("clear_import_sessions", "true")), default=True)
        payload = reset_admin_db_data(handler.config, confirm_text=confirm_text)
        if clear_sessions:
            payload["cleared_preview_sessions"] = handler.session_store.clear_all()
        else:
            payload["cleared_preview_sessions"] = 0
        payload["clear_import_sessions"] = clear_sessions
        return payload

    def _post_admin_reset_transactions(handler: Any) -> dict[str, Any]:
        body = handler._read_json()
        confirm_text = str(body.get("confirm_text", "")).strip()
        clear_sessions = parse_bool_param(str(body.get("clear_import_sessions", "true")), default=True)
        payload = reset_admin_transaction_data(handler.config, confirm_text=confirm_text)
        if clear_sessions:
            payload["cleared_preview_sessions"] = handler.session_store.clear_all()
        else:
            payload["cleared_preview_sessions"] = 0
        payload["clear_import_sessions"] = clear_sessions
        return payload

    return {
        "/api/eml/preview": _post_eml_preview,
        "/api/eml/import": _post_eml_import,
        "/api/yzxy/preview": _post_yzxy_preview,
        "/api/yzxy/import": _post_yzxy_import,
        "/api/cmb-bank-pdf/preview": _post_cmb_bank_pdf_preview,
        "/api/cmb-bank-pdf/import": _post_cmb_bank_pdf_import,
        "/api/investments/manual": lambda handler: _post_json_body_to_fn(handler, upsert_manual_investment),
        "/api/investments/update": lambda handler: _post_json_body_to_fn(handler, update_investment_record),
        "/api/investments/delete": lambda handler: _post_json_body_to_fn(handler, delete_investment_record),
        "/api/assets/manual": lambda handler: _post_json_body_to_fn(handler, upsert_manual_asset_valuation),
        "/api/assets/update": lambda handler: _post_json_body_to_fn(handler, update_asset_valuation),
        "/api/assets/delete": lambda handler: _post_json_body_to_fn(handler, delete_asset_valuation),
        "/api/transactions/exclusion": lambda handler: _post_json_body_to_fn(handler, update_transaction_analysis_exclusion),
        "/api/budgets/monthly-items/upsert": lambda handler: _post_json_body_to_fn(handler, upsert_monthly_budget_item),
        "/api/budgets/monthly-items/delete": lambda handler: _post_json_body_to_fn(handler, delete_monthly_budget_item),
        "/api/accounts/upsert": lambda handler: _post_json_body_to_fn(handler, upsert_account_catalog_entry),
        "/api/accounts/delete": lambda handler: _post_json_body_to_fn(handler, delete_account_catalog_entry),
        "/api/admin/reset-db": _post_admin_reset_db,
        "/api/admin/reset-transactions": _post_admin_reset_transactions,
        "/api/rules/merchant-map/upsert": lambda handler: _post_json_body_to_fn(handler, upsert_merchant_map_rule),
        "/api/rules/merchant-map/delete": lambda handler: _post_json_body_to_fn(handler, delete_merchant_map_rule),
        "/api/rules/category-rules/upsert": lambda handler: _post_json_body_to_fn(handler, upsert_category_rule),
        "/api/rules/category-rules/delete": lambda handler: _post_json_body_to_fn(handler, delete_category_rule),
        "/api/rules/bank-transfer-whitelist/upsert": lambda handler: _post_json_body_to_fn(
            handler, upsert_bank_transfer_whitelist_rule
        ),
        "/api/rules/bank-transfer-whitelist/delete": lambda handler: _post_json_body_to_fn(
            handler, delete_bank_transfer_whitelist_rule
        ),
    }
