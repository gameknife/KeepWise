import { invoke } from "./invoke";

export type RulesListQueryRequest = { keyword?: string; limit?: number };
export type MerchantMapUpsertRequest = {
  merchant_normalized?: string;
  expense_category?: string;
  confidence?: string;
  note?: string;
};
export type MerchantMapDeleteRequest = { merchant_normalized?: string };
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
export type BankTransferWhitelistQueryRequest = { keyword?: string; limit?: number; active_only?: string };
export type BankTransferWhitelistUpsertRequest = { name?: string; is_active?: string; note?: string };
export type BankTransferWhitelistDeleteRequest = { name?: string };
export type AnalysisExclusionQueryRequest = { keyword?: string; limit?: number; enabled_only?: string };
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
export type AnalysisExclusionDeleteRequest = { rule_name?: string };
export type MerchantRuleSuggestionsQueryRequest = { keyword?: string; limit?: number; only_unmapped?: string };

export type RulesQueryPayload = Record<string, unknown>;
export type RuleMutationPayload = Record<string, unknown>;

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
