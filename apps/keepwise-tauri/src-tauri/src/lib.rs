#![recursion_limit = "512"]

mod account_catalog;
mod admin_health;
mod budget_fire_analytics;
mod cmb_bank_pdf_import;
mod cmb_eml_import;
mod commands;
pub mod investment_analytics;
mod ledger_db;
mod read_queries;
mod record_mutations;
mod rules_management;
mod rules_store;
mod transaction_mutations;
pub mod wealth_analytics;
mod yzxy_import;

pub use investment_analytics::{
    investment_curve_query_at_db_path, investment_return_query_at_db_path,
    investment_returns_query_at_db_path, InvestmentCurveQueryRequest, InvestmentReturnQueryRequest,
    InvestmentReturnsQueryRequest,
};
pub use wealth_analytics::{
    wealth_curve_query_at_db_path, wealth_overview_query_at_db_path, WealthCurveQueryRequest,
    WealthOverviewQueryRequest,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::health_ping,
            commands::app_metadata,
            commands::app_paths,
            ledger_db::ledger_db_status,
            ledger_db::ledger_db_migrate,
            ledger_db::ledger_db_import_repo_runtime,
            ledger_db::ledger_db_import_from_path,
            ledger_db::ledger_db_admin_stats,
            admin_health::runtime_db_health_check,
            investment_analytics::investment_return_query,
            investment_analytics::investment_returns_query,
            investment_analytics::investment_curve_query,
            wealth_analytics::wealth_overview_query,
            wealth_analytics::wealth_curve_query,
            budget_fire_analytics::query_monthly_budget_items,
            budget_fire_analytics::upsert_monthly_budget_item,
            budget_fire_analytics::delete_monthly_budget_item,
            budget_fire_analytics::query_budget_overview,
            budget_fire_analytics::query_budget_monthly_review,
            budget_fire_analytics::query_salary_income_overview,
            budget_fire_analytics::query_consumption_report,
            budget_fire_analytics::query_fire_progress,
            read_queries::meta_accounts_query,
            read_queries::query_transactions,
            read_queries::query_investments,
            read_queries::query_asset_valuations,
            account_catalog::query_account_catalog,
            account_catalog::upsert_account_catalog_entry,
            account_catalog::delete_account_catalog_entry,
            record_mutations::upsert_manual_investment,
            record_mutations::update_investment_record,
            record_mutations::delete_investment_record,
            record_mutations::upsert_manual_asset_valuation,
            record_mutations::update_asset_valuation,
            record_mutations::delete_asset_valuation,
            transaction_mutations::update_transaction_analysis_exclusion,
            ledger_db::ledger_db_admin_reset_all,
            ledger_db::ledger_db_admin_reset_transactions,
            yzxy_import::yzxy_preview_file,
            yzxy_import::yzxy_import_file,
            cmb_eml_import::cmb_eml_preview,
            cmb_eml_import::cmb_eml_import,
            cmb_bank_pdf_import::cmb_bank_pdf_preview,
            cmb_bank_pdf_import::cmb_bank_pdf_import,
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
            rules_management::query_merchant_rule_suggestions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
