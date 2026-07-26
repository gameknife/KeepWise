import { invoke } from "./invoke";

export type AccountKind =
  | "investment"
  | "cash"
  | "real_estate"
  | "bank"
  | "credit_card"
  | "wallet"
  | "liability"
  | "other";

export type QueryAccountCatalogRequest = {
  kind?: "all" | AccountKind;
  keyword?: string;
  limit?: number;
};

export type UpsertAccountCatalogEntryRequest = {
  account_id?: string;
  account_name?: string;
  account_kind?: AccountKind;
};

export type DeleteAccountCatalogEntryRequest = {
  account_id?: string;
};

export type AccountCatalogRow = {
  account_id: string;
  account_name: string;
  account_type: string;
  account_kind: AccountKind;
  currency: string;
  initial_balance_cents: number;
  initial_balance_yuan: string;
  transaction_count: number;
  investment_record_count: number;
  asset_valuation_count: number;
  cash_valuation_count: number;
  real_estate_valuation_count: number;
  created_at: string;
  updated_at: string;
};

export type AccountCatalogPayload = {
  summary: {
    count: number;
    kind: "all" | AccountKind;
    keyword: string;
    limit: number;
  };
  rows: AccountCatalogRow[];
  groups: Record<AccountKind, AccountCatalogRow[]>;
};

export type AccountCatalogUpsertPayload = {
  created: boolean;
  updated: boolean;
  row:
    | AccountCatalogRow
    | {
        account_id: string;
        account_name: string;
        account_kind: AccountKind;
        account_type: string;
      };
};

export type AccountCatalogDeletePayload = {
  deleted: true;
  account_id: string;
  account_name: string;
};

export type AccountNotesQueryRequest = {
  account_id?: string;
};

export type AccountNote = {
  account_id: string;
  holdings_text: string;
  risk_note: string;
  note_text: string;
  updated_at: string;
};

export type UpsertAccountNoteRequest = {
  account_id?: string;
  holdings_text?: string;
  risk_note?: string;
  note_text?: string;
};

export type DeleteAccountNoteRequest = {
  account_id?: string;
};

export type AccountNotesPayload = {
  summary: {
    count: number;
    account_id: string | null;
  };
  rows: AccountNote[];
};

export type AccountNoteMutationPayload =
  | {
      saved: true;
      row: AccountNote | { account_id: string };
    }
  | {
      deleted: boolean;
      account_id: string;
    };

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

export async function queryAccountNotes(req: AccountNotesQueryRequest = {}): Promise<AccountNotesPayload> {
  return invoke<AccountNotesPayload>("query_account_notes", { req });
}

export async function upsertAccountNote(req: UpsertAccountNoteRequest): Promise<AccountNoteMutationPayload> {
  return invoke<AccountNoteMutationPayload>("upsert_account_note", { req });
}

export async function deleteAccountNote(req: DeleteAccountNoteRequest): Promise<AccountNoteMutationPayload> {
  return invoke<AccountNoteMutationPayload>("delete_account_note", { req });
}
