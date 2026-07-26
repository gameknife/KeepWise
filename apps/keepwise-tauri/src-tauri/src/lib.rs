#![recursion_limit = "512"]

mod account_catalog;
mod account_notes;
mod admin_health;
mod analysis_export;
mod budget;
mod commands;
mod error;
mod imports;
pub mod investment;
mod ledger_db;
mod read_queries;
mod record_mutations;
mod rules_management;
mod rules_store;
mod sync;
#[cfg(test)]
mod test_support;
mod transaction_mutations;
pub mod wealth;

pub use investment::{
    investment_curve_benchmarks_query_at_db_path, investment_curve_query_at_db_path,
    investment_return_query_at_db_path, investment_returns_query_at_db_path,
    InvestmentCurveQueryRequest, InvestmentReturnQueryRequest, InvestmentReturnsQueryRequest,
};
pub use wealth::{
    wealth_curve_query_at_db_path, wealth_overview_query_at_db_path, WealthCurveQueryRequest,
    WealthOverviewQueryRequest,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::health_ping,
            commands::app_metadata,
            commands::app_paths,
            ledger_db::ledger_db_status,
            ledger_db::ledger_db_migrate,
            ledger_db::ledger_db_import_from_path,
            ledger_db::ledger_db_admin_stats,
            admin_health::runtime_db_health_check,
            investment::investment_return_query,
            investment::investment_returns_query,
            investment::investment_curve_query,
            investment::investment_curve_benchmarks_query,
            wealth::wealth_overview_query,
            wealth::wealth_curve_query,
            budget::query_monthly_budget_items,
            budget::upsert_monthly_budget_item,
            budget::delete_monthly_budget_item,
            budget::query_budget_overview,
            budget::query_budget_monthly_review,
            budget::query_salary_income_overview,
            budget::query_consumption_report,
            budget::query_fire_progress,
            read_queries::meta_accounts_query,
            read_queries::query_transactions,
            read_queries::query_investments,
            read_queries::query_asset_valuations,
            read_queries::query_import_jobs,
            account_catalog::query_account_catalog,
            account_catalog::upsert_account_catalog_entry,
            account_catalog::delete_account_catalog_entry,
            account_notes::query_account_notes,
            account_notes::upsert_account_note,
            account_notes::delete_account_note,
            analysis_export::analysis_export_snapshot,
            analysis_export::analysis_export_write_file,
            analysis_export::analysis_export_list_local_clis,
            analysis_export::analysis_export_run_local_cli,
            analysis_export::analysis_export_run_openai_compatible,
            analysis_export::analysis_export_run_codex,
            record_mutations::upsert_manual_investment,
            record_mutations::update_investment_record,
            record_mutations::delete_investment_record,
            record_mutations::upsert_manual_asset_valuation,
            record_mutations::update_asset_valuation,
            record_mutations::delete_asset_valuation,
            transaction_mutations::update_transaction_analysis_exclusion,
            transaction_mutations::confirm_transaction_review,
            ledger_db::ledger_db_admin_reset_all,
            ledger_db::ledger_db_admin_reset_transactions,
            imports::yzxy::yzxy_preview_file,
            imports::yzxy::yzxy_import_file,
            imports::cmb_eml::cmb_eml_preview,
            imports::cmb_eml::cmb_eml_import,
            imports::cmb_pdf::cmb_bank_pdf_preview,
            imports::cmb_pdf::cmb_bank_pdf_import,
            rules_management::query_merchant_map_rules,
            rules_management::upsert_merchant_map_rule,
            rules_management::delete_merchant_map_rule,
            rules_management::query_category_rules,
            rules_management::upsert_category_rule,
            rules_management::delete_category_rule,
            rules_management::query_bank_transfer_whitelist_rules,
            rules_management::upsert_bank_transfer_whitelist_rule,
            rules_management::delete_bank_transfer_whitelist_rule,
            rules_management::query_analysis_exclusion_rules,
            rules_management::upsert_analysis_exclusion_rule,
            rules_management::delete_analysis_exclusion_rule,
            rules_management::query_merchant_rule_suggestions,
            sync::sync_setup_create,
            sync::sync_share_code_generate,
            sync::sync_share_code_parse,
            sync::sync_setup_link,
            sync::sync_test_connection,
            sync::sync_status,
            sync::sync_poll_remote_update,
            sync::sync_reconcile,
            sync::sync_resolve_conflict,
            sync::sync_set_auto_policy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
