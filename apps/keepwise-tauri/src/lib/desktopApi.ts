import { invoke as tauriInvoke } from "@tauri-apps/api/core";

function normalizeTauriValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (value <= max && value >= min) return Number(value);
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeTauriValue(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = normalizeTauriValue(v);
    }
    return out;
  }

  return value;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const raw = await tauriInvoke<unknown>(command, args);
  return normalizeTauriValue(raw) as T;
}

export type HealthPing = {
  status: "ok";
  unix_ts: number;
  mode: "desktop";
};

export type AppMetadata = {
  app_name: string;
  app_version: string;
  app_identifier: string | null;
  target_os: string;
  target_arch: string;
  debug: boolean;
  tauri_major: number;
};

export type PathProbe = {
  path: string | null;
  error: string | null;
};

export type AppPaths = {
  app_data_dir: PathProbe;
  app_config_dir: PathProbe;
  app_cache_dir: PathProbe;
  app_log_dir: PathProbe;
  app_local_data_dir: PathProbe;
};

export type BootstrapProbe = {
  health: HealthPing;
  metadata: AppMetadata;
  paths: AppPaths;
};

export type LedgerDbStatus = {
  db_path: string;
  exists: boolean;
  migration_files: string[];
  applied_versions: string[];
  pending_versions: string[];
  schema_migrations_table_exists: boolean;
  ready: boolean;
};

export type LedgerDbMigrateResult = {
  db_path: string;
  created: boolean;
  applied_now: string[];
  skipped: string[];
  applied_total: number;
  pending_total: number;
};

export type LedgerDbImportRepoRuntimeResult = {
  source_db_path: string;
  target_db_path: string;
  replaced_existing: boolean;
  copied_bytes: number;
  migrate_result: LedgerDbMigrateResult;
};

export type LedgerAdminDbTableCountRow = {
  table: string;
  row_count: number;
};

export type LedgerAdminDbStats = {
  db_path: string;
  confirm_phrase: string;
  summary: {
    table_count: number;
    total_rows: number;
  };
  rows: LedgerAdminDbTableCountRow[];
};

export type LedgerAdminResetRequest = {
  confirm_text?: string;
};

export type LedgerAdminResetAllResult = unknown;
export type LedgerAdminResetTransactionsResult = unknown;

export type RuntimeDbHealthCheckPayload = unknown;

export type InvestmentReturnQueryRequest = {
  account_id: string;
  preset?: string;
  from?: string;
  to?: string;
};

export type InvestmentCurveQueryRequest = {
  account_id: string;
  preset?: string;
  from?: string;
  to?: string;
};

export type InvestmentReturnsQueryRequest = {
  preset?: string;
  from?: string;
  to?: string;
  keyword?: string;
  limit?: number;
};

export type WealthOverviewQueryRequest = {
  as_of?: string;
  include_investment?: string;
  include_cash?: string;
  include_real_estate?: string;
  include_liability?: string;
};

export type WealthCurveQueryRequest = {
  preset?: string;
  from?: string;
  to?: string;
  include_investment?: string;
  include_cash?: string;
  include_real_estate?: string;
  include_liability?: string;
};

export type InvestmentReturnPayload = unknown;
export type InvestmentReturnsPayload = unknown;
export type InvestmentCurvePayload = unknown;
export type WealthOverviewPayload = unknown;
export type WealthCurvePayload = unknown;
export type MetaAccountsPayload = unknown;
export type QueryTransactionsPayload = unknown;
export type QueryInvestmentsPayload = unknown;
export type QueryAssetValuationsPayload = unknown;
export type AccountCatalogPayload = unknown;
export type AccountCatalogUpsertPayload = unknown;
export type AccountCatalogDeletePayload = unknown;
export type ManualInvestmentMutationPayload = unknown;
export type InvestmentRecordMutationPayload = unknown;
export type ManualAssetValuationMutationPayload = unknown;
export type AssetValuationMutationPayload = unknown;
export type TransactionAnalysisExclusionMutationPayload = unknown;
export type YzxyPreviewPayload = unknown;
export type YzxyImportPayload = unknown;
export type CmbEmlPreviewPayload = unknown;
export type CmbEmlImportPayload = unknown;
export type CmbBankPdfPreviewPayload = unknown;
export type CmbBankPdfImportPayload = unknown;
export type RulesQueryPayload = unknown;
export type RuleMutationPayload = unknown;

export type MetaAccountsQueryRequest = {
  kind?: "all" | "investment" | "cash" | "real_estate" | "liability";
};

export type QueryTransactionsRequest = {
  limit?: number;
  month_key?: string;
  source_type?: string;
  account_id?: string;
  keyword?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
};

export type QueryInvestmentsRequest = {
  limit?: number;
  from?: string;
  to?: string;
  source_type?: string;
  account_id?: string;
};

export type QueryAssetValuationsRequest = {
  limit?: number;
  from?: string;
  to?: string;
  asset_class?: "" | "cash" | "real_estate" | "liability";
  account_id?: string;
};

export type QueryAccountCatalogRequest = {
  kind?: "all" | "investment" | "cash" | "real_estate" | "bank" | "credit_card" | "wallet" | "liability" | "other";
  keyword?: string;
  limit?: number;
};

export type UpsertAccountCatalogEntryRequest = {
  account_id?: string;
  account_name?: string;
  account_kind?: "investment" | "cash" | "real_estate" | "bank" | "credit_card" | "wallet" | "liability" | "other";
};

export type DeleteAccountCatalogEntryRequest = {
  account_id?: string;
};

export type UpsertManualInvestmentRequest = {
  snapshot_date?: string;
  account_id?: string;
  account_name?: string;
  total_assets?: string;
  transfer_amount?: string;
};

export type UpdateInvestmentRecordRequest = {
  id?: string;
  snapshot_date?: string;
  account_id?: string;
  account_name?: string;
  total_assets?: string;
  transfer_amount?: string;
};

export type DeleteByIdRequest = {
  id?: string;
};

export type UpdateTransactionAnalysisExclusionRequest = {
  id?: string;
  action?: "exclude" | "restore";
  excluded_in_analysis?: boolean;
  reason?: string;
};

export type UpsertManualAssetValuationRequest = {
  asset_class?: "cash" | "real_estate" | "liability";
  snapshot_date?: string;
  account_id?: string;
  account_name?: string;
  value?: string;
};

export type YzxyPreviewRequest = {
  source_path?: string;
};

export type YzxyImportRequest = {
  source_path?: string;
  source_type?: string;
};

export type CmbEmlPreviewRequest = {
  source_path?: string;
  review_threshold?: number;
};

export type CmbEmlImportRequest = {
  source_path?: string;
  review_threshold?: number;
  source_type?: string;
};

export type CmbBankPdfPreviewRequest = {
  source_path?: string;
  review_threshold?: number;
};

export type CmbBankPdfImportRequest = {
  source_path?: string;
  review_threshold?: number;
  source_type?: string;
};

export type RulesListQueryRequest = {
  keyword?: string;
  limit?: number;
};

export type MerchantMapUpsertRequest = {
  merchant_normalized?: string;
  expense_category?: string;
  confidence?: string;
  note?: string;
};

export type MerchantMapDeleteRequest = {
  merchant_normalized?: string;
};

export type CategoryRuleUpsertRequest = {
  priority?: string;
  match_type?: "exact" | "contains" | "prefix" | "regex";
  pattern?: string;
  expense_category?: string;
  confidence?: string;
  note?: string;
};

export type CategoryRuleDeleteRequest = {
  match_type?: "exact" | "contains" | "prefix" | "regex";
  pattern?: string;
};

export type BankTransferWhitelistQueryRequest = {
  keyword?: string;
  limit?: number;
  active_only?: string;
};

export type BankTransferWhitelistUpsertRequest = {
  name?: string;
  is_active?: string;
  note?: string;
};

export type BankTransferWhitelistDeleteRequest = {
  name?: string;
};

export type AnalysisExclusionQueryRequest = {
  keyword?: string;
  limit?: number;
  enabled_only?: string;
};

export type AnalysisExclusionUpsertRequest = {
  enabled?: string;
  rule_name?: string;
  merchant_contains?: string;
  description_contains?: string;
  expense_category?: string;
  min_amount?: string;
  max_amount?: string;
  start_date?: string;
  end_date?: string;
  reason?: string;
};

export type AnalysisExclusionDeleteRequest = {
  rule_name?: string;
};

export type MerchantRuleSuggestionsQueryRequest = {
  keyword?: string;
  limit?: number;
  only_unmapped?: string;
};

export type UpdateAssetValuationRequest = {
  id?: string;
  asset_class?: "cash" | "real_estate" | "liability";
  snapshot_date?: string;
  account_id?: string;
  account_name?: string;
  value?: string;
};

export async function loadBootstrapProbe(): Promise<BootstrapProbe> {
  const [health, metadata, paths] = await Promise.all([
    invoke<HealthPing>("health_ping"),
    invoke<AppMetadata>("app_metadata"),
    invoke<AppPaths>("app_paths"),
  ]);
  return { health, metadata, paths };
}

export async function loadLedgerDbStatus(): Promise<LedgerDbStatus> {
  return invoke<LedgerDbStatus>("ledger_db_status");
}

export async function runLedgerDbMigrate(): Promise<LedgerDbMigrateResult> {
  return invoke<LedgerDbMigrateResult>("ledger_db_migrate");
}

export async function importRepoRuntimeLedgerDb(): Promise<LedgerDbImportRepoRuntimeResult> {
  return invoke<LedgerDbImportRepoRuntimeResult>("ledger_db_import_repo_runtime");
}

export async function importLedgerDbFromPath(
  source_path: string,
): Promise<LedgerDbImportRepoRuntimeResult> {
  return invoke<LedgerDbImportRepoRuntimeResult>("ledger_db_import_from_path", {
    sourcePath: source_path,
    source_path,
  });
}

export async function yzxyPreviewFile(req: YzxyPreviewRequest): Promise<YzxyPreviewPayload> {
  return invoke<YzxyPreviewPayload>("yzxy_preview_file", { req });
}

export async function yzxyImportFile(req: YzxyImportRequest): Promise<YzxyImportPayload> {
  return invoke<YzxyImportPayload>("yzxy_import_file", { req });
}

export async function cmbEmlPreview(req: CmbEmlPreviewRequest): Promise<CmbEmlPreviewPayload> {
  return invoke<CmbEmlPreviewPayload>("cmb_eml_preview", { req });
}

export async function cmbEmlImport(req: CmbEmlImportRequest): Promise<CmbEmlImportPayload> {
  return invoke<CmbEmlImportPayload>("cmb_eml_import", { req });
}

export async function cmbBankPdfPreview(
  req: CmbBankPdfPreviewRequest,
): Promise<CmbBankPdfPreviewPayload> {
  return invoke<CmbBankPdfPreviewPayload>("cmb_bank_pdf_preview", { req });
}

export async function cmbBankPdfImport(
  req: CmbBankPdfImportRequest,
): Promise<CmbBankPdfImportPayload> {
  return invoke<CmbBankPdfImportPayload>("cmb_bank_pdf_import", { req });
}

export async function loadLedgerDbAdminStats(): Promise<LedgerAdminDbStats> {
  return invoke<LedgerAdminDbStats>("ledger_db_admin_stats");
}

export async function runLedgerDbAdminResetAll(
  req: LedgerAdminResetRequest,
): Promise<LedgerAdminResetAllResult> {
  return invoke<LedgerAdminResetAllResult>("ledger_db_admin_reset_all", { req });
}

export async function runLedgerDbAdminResetTransactions(
  req: LedgerAdminResetRequest,
): Promise<LedgerAdminResetTransactionsResult> {
  return invoke<LedgerAdminResetTransactionsResult>("ledger_db_admin_reset_transactions", { req });
}

export async function runRuntimeDbHealthCheck(): Promise<RuntimeDbHealthCheckPayload> {
  return invoke<RuntimeDbHealthCheckPayload>("runtime_db_health_check");
}

export async function queryInvestmentReturn(
  req: InvestmentReturnQueryRequest,
): Promise<InvestmentReturnPayload> {
  return invoke<InvestmentReturnPayload>("investment_return_query", { req });
}

export async function queryInvestmentReturns(
  req: InvestmentReturnsQueryRequest,
): Promise<InvestmentReturnsPayload> {
  return invoke<InvestmentReturnsPayload>("investment_returns_query", { req });
}

export async function queryInvestmentCurve(
  req: InvestmentCurveQueryRequest,
): Promise<InvestmentCurvePayload> {
  return invoke<InvestmentCurvePayload>("investment_curve_query", { req });
}

export async function queryWealthOverview(
  req: WealthOverviewQueryRequest,
): Promise<WealthOverviewPayload> {
  return invoke<WealthOverviewPayload>("wealth_overview_query", { req });
}

export async function queryWealthCurve(
  req: WealthCurveQueryRequest,
): Promise<WealthCurvePayload> {
  return invoke<WealthCurvePayload>("wealth_curve_query", { req });
}

export async function queryMetaAccounts(req: MetaAccountsQueryRequest): Promise<MetaAccountsPayload> {
  return invoke<MetaAccountsPayload>("meta_accounts_query", { req });
}

export async function queryTransactions(req: QueryTransactionsRequest): Promise<QueryTransactionsPayload> {
  return invoke<QueryTransactionsPayload>("query_transactions", { req });
}

export async function queryInvestments(req: QueryInvestmentsRequest): Promise<QueryInvestmentsPayload> {
  return invoke<QueryInvestmentsPayload>("query_investments", { req });
}

export async function queryAssetValuations(
  req: QueryAssetValuationsRequest,
): Promise<QueryAssetValuationsPayload> {
  return invoke<QueryAssetValuationsPayload>("query_asset_valuations", { req });
}

export async function queryAccountCatalog(req: QueryAccountCatalogRequest): Promise<AccountCatalogPayload> {
  return invoke<AccountCatalogPayload>("query_account_catalog", { req });
}

export async function upsertAccountCatalogEntry(
  req: UpsertAccountCatalogEntryRequest,
): Promise<AccountCatalogUpsertPayload> {
  return invoke<AccountCatalogUpsertPayload>("upsert_account_catalog_entry", { req });
}

export async function deleteAccountCatalogEntry(
  req: DeleteAccountCatalogEntryRequest,
): Promise<AccountCatalogDeletePayload> {
  return invoke<AccountCatalogDeletePayload>("delete_account_catalog_entry", { req });
}

export async function upsertManualInvestment(
  req: UpsertManualInvestmentRequest,
): Promise<ManualInvestmentMutationPayload> {
  return invoke<ManualInvestmentMutationPayload>("upsert_manual_investment", { req });
}

export async function updateInvestmentRecord(
  req: UpdateInvestmentRecordRequest,
): Promise<InvestmentRecordMutationPayload> {
  return invoke<InvestmentRecordMutationPayload>("update_investment_record", { req });
}

export async function deleteInvestmentRecord(req: DeleteByIdRequest): Promise<InvestmentRecordMutationPayload> {
  return invoke<InvestmentRecordMutationPayload>("delete_investment_record", { req });
}

export async function upsertManualAssetValuation(
  req: UpsertManualAssetValuationRequest,
): Promise<ManualAssetValuationMutationPayload> {
  return invoke<ManualAssetValuationMutationPayload>("upsert_manual_asset_valuation", { req });
}

export async function updateAssetValuation(
  req: UpdateAssetValuationRequest,
): Promise<AssetValuationMutationPayload> {
  return invoke<AssetValuationMutationPayload>("update_asset_valuation", { req });
}

export async function deleteAssetValuation(req: DeleteByIdRequest): Promise<AssetValuationMutationPayload> {
  return invoke<AssetValuationMutationPayload>("delete_asset_valuation", { req });
}

export async function updateTransactionAnalysisExclusion(
  req: UpdateTransactionAnalysisExclusionRequest,
): Promise<TransactionAnalysisExclusionMutationPayload> {
  return invoke<TransactionAnalysisExclusionMutationPayload>("update_transaction_analysis_exclusion", { req });
}

export async function queryMerchantMapRules(req: RulesListQueryRequest): Promise<RulesQueryPayload> {
  return invoke<RulesQueryPayload>("query_merchant_map_rules", { req });
}

export async function upsertMerchantMapRule(req: MerchantMapUpsertRequest): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("upsert_merchant_map_rule", { req });
}

export async function deleteMerchantMapRule(req: MerchantMapDeleteRequest): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("delete_merchant_map_rule", { req });
}

export async function queryCategoryRules(req: RulesListQueryRequest): Promise<RulesQueryPayload> {
  return invoke<RulesQueryPayload>("query_category_rules", { req });
}

export async function upsertCategoryRule(req: CategoryRuleUpsertRequest): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("upsert_category_rule", { req });
}

export async function deleteCategoryRule(req: CategoryRuleDeleteRequest): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("delete_category_rule", { req });
}

export async function queryBankTransferWhitelistRules(
  req: BankTransferWhitelistQueryRequest,
): Promise<RulesQueryPayload> {
  return invoke<RulesQueryPayload>("query_bank_transfer_whitelist_rules", { req });
}

export async function upsertBankTransferWhitelistRule(
  req: BankTransferWhitelistUpsertRequest,
): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("upsert_bank_transfer_whitelist_rule", { req });
}

export async function deleteBankTransferWhitelistRule(
  req: BankTransferWhitelistDeleteRequest,
): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("delete_bank_transfer_whitelist_rule", { req });
}

export async function queryAnalysisExclusionRules(
  req: AnalysisExclusionQueryRequest,
): Promise<RulesQueryPayload> {
  return invoke<RulesQueryPayload>("query_analysis_exclusion_rules", { req });
}

export async function upsertAnalysisExclusionRule(
  req: AnalysisExclusionUpsertRequest,
): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("upsert_analysis_exclusion_rule", { req });
}

export async function deleteAnalysisExclusionRule(
  req: AnalysisExclusionDeleteRequest,
): Promise<RuleMutationPayload> {
  return invoke<RuleMutationPayload>("delete_analysis_exclusion_rule", { req });
}

export async function queryMerchantRuleSuggestions(
  req: MerchantRuleSuggestionsQueryRequest,
): Promise<RulesQueryPayload> {
  return invoke<RulesQueryPayload>("query_merchant_rule_suggestions", { req });
}
