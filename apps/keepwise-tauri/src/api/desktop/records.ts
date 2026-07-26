import { invoke } from "./invoke";

export type AssetClass = "cash" | "real_estate" | "liability";

export type UpsertManualInvestmentRequest = {
  snapshot_date?: string;
  account_id?: string;
  account_name?: string;
  total_assets?: string;
  transfer_amount?: string;
};

export type UpdateInvestmentRecordRequest = UpsertManualInvestmentRequest & {
  id?: string;
};

export type DeleteByIdRequest = {
  id?: string;
};

export type UpsertManualAssetValuationRequest = {
  asset_class?: AssetClass;
  snapshot_date?: string;
  account_id?: string;
  account_name?: string;
  value?: string;
};

export type UpdateAssetValuationRequest = UpsertManualAssetValuationRequest & {
  id?: string;
};

export type ManualInvestmentMutationPayload = {
  account_id: string;
  account_name: string;
  snapshot_date: string;
};

export type InvestmentRecordMutationPayload =
  | {
      id: string;
      account_id: string;
      account_name: string;
      snapshot_date: string;
      total_assets_cents: number;
      transfer_amount_cents: number;
    }
  | {
      id: string;
      account_id: string;
      account_name: string;
      snapshot_date: string;
      deleted: true;
    };

export type ManualAssetValuationMutationPayload = {
  account_id: string;
  account_name: string;
  asset_class: AssetClass;
  snapshot_date: string;
  value_cents: number;
  value_yuan: string;
};

export type AssetValuationMutationPayload =
  | ({
      id: string;
    } & ManualAssetValuationMutationPayload)
  | {
      id: string;
      account_id: string;
      account_name: string;
      asset_class: AssetClass;
      snapshot_date: string;
      deleted: true;
    };

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
