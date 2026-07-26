import { invoke } from "./invoke";

export type UpdateTransactionAnalysisExclusionRequest = {
  id?: string;
  action?: "exclude" | "restore";
  excluded_in_analysis?: boolean;
  reason?: string;
};

export type ConfirmTransactionReviewRequest = {
  id?: string;
};

export type TransactionAnalysisExclusionMutationPayload = {
  id: string;
  excluded_in_analysis: 0 | 1;
  manual_excluded: boolean;
  exclude_reason: string;
  manual_exclude_reason: string;
  action: "exclude" | "restore";
};

export type TransactionReviewConfirmationPayload = {
  id: string;
  needs_review: 0;
  confirmed: true;
};

export async function updateTransactionAnalysisExclusion(
  req: UpdateTransactionAnalysisExclusionRequest,
): Promise<TransactionAnalysisExclusionMutationPayload> {
  return invoke<TransactionAnalysisExclusionMutationPayload>("update_transaction_analysis_exclusion", { req });
}

export async function confirmTransactionReview(
  req: ConfirmTransactionReviewRequest,
): Promise<TransactionReviewConfirmationPayload> {
  return invoke<TransactionReviewConfirmationPayload>("confirm_transaction_review", { req });
}
