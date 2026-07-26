import { invoke } from "./invoke";

export type SyncStatusPayload = {
  configured: boolean;
  provider: string | null;
  workspace_id: string | null;
  device_id: string | null;
  local_head: string | null;
  remote_head: string | null;
  syncing: boolean;
  last_sync_at: string | null;
  last_push_at: string | null;
  last_pull_at: string | null;
  last_error: string | null;
  conflict: boolean;
  auto_sync_enabled: boolean;
  interval_minutes: number;
  next_sync_at: string | null;
};
export type SyncSetupCreatePayload = {
  configured: boolean;
  endpoint: string;
  bucket: string;
  prefix: string;
  workspace_id: string;
  share_code: string;
  status: SyncStatusPayload;
};
export type SyncSetupLinkPayload = Omit<SyncSetupCreatePayload, "share_code">;
export type SyncShareCodePayload = { share_code: string };
export type SyncShareCodeParsePayload = {
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  workspace_id: string;
  access_key_id: string;
  app_id?: string | null;
  path_style: boolean;
};
export type SyncConnectionTestPayload = { ok: boolean; endpoint: string | null; message: string };
export type SyncRemotePollPayload = {
  configured: boolean;
  has_remote_update: boolean;
  remote_head: string | null;
  message: string;
  status: SyncStatusPayload;
};
export type SyncReconcilePayload = { ok: boolean; message: string; status: SyncStatusPayload };
export type SyncResolveConflictPayload = { action: string; status: SyncStatusPayload };
export type SyncAutoPolicyPayload = { status: SyncStatusPayload };
export type SyncSetupCreateRequest = {
  secret_id?: string;
  secret_key?: string;
  region?: string;
  sync_password?: string;
  app_id?: string;
  endpoint?: string;
  bucket?: string;
  prefix?: string;
  workspace_id?: string;
  path_style?: boolean;
};
export type SyncSetupLinkRequest = { share_code?: string; sync_password?: string };
export type SyncShareCodeGenerateRequest = { sync_password?: string };
export type SyncShareCodeParseRequest = { share_code?: string; sync_password?: string };
export type SyncResolveConflictRequest = { action?: "remote_first" | "local_first" | "keep_both" };
export type SyncSetAutoPolicyRequest = {
  enabled?: boolean;
  interval_minutes?: number;
  startup_delay_seconds?: number;
  change_debounce_seconds?: number;
};

export async function syncSetupCreate(req: SyncSetupCreateRequest): Promise<SyncSetupCreatePayload> {
  return invoke<SyncSetupCreatePayload>("sync_setup_create", { req });
}
export async function syncShareCodeGenerate(req: SyncShareCodeGenerateRequest): Promise<SyncShareCodePayload> {
  return invoke<SyncShareCodePayload>("sync_share_code_generate", { req });
}
export async function syncShareCodeParse(req: SyncShareCodeParseRequest): Promise<SyncShareCodeParsePayload> {
  return invoke<SyncShareCodeParsePayload>("sync_share_code_parse", { req });
}
export async function syncSetupLink(req: SyncSetupLinkRequest): Promise<SyncSetupLinkPayload> {
  return invoke<SyncSetupLinkPayload>("sync_setup_link", { req });
}
export async function syncTestConnection(): Promise<SyncConnectionTestPayload> {
  return invoke<SyncConnectionTestPayload>("sync_test_connection");
}
export async function syncStatus(): Promise<SyncStatusPayload> {
  return invoke<SyncStatusPayload>("sync_status");
}
export async function syncPollRemoteUpdate(): Promise<SyncRemotePollPayload> {
  return invoke<SyncRemotePollPayload>("sync_poll_remote_update");
}
export async function syncReconcile(): Promise<SyncReconcilePayload> {
  return invoke<SyncReconcilePayload>("sync_reconcile");
}
export async function syncResolveConflict(req: SyncResolveConflictRequest): Promise<SyncResolveConflictPayload> {
  return invoke<SyncResolveConflictPayload>("sync_resolve_conflict", { req });
}
export async function syncSetAutoPolicy(req: SyncSetAutoPolicyRequest): Promise<SyncAutoPolicyPayload> {
  return invoke<SyncAutoPolicyPayload>("sync_set_auto_policy", { req });
}
