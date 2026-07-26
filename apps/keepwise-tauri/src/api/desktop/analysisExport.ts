import { invoke } from "./invoke";

export type AnalysisExportSnapshotRequest = {
  year?: string;
  wealth_curve_preset?: string;
  include_consumption_detail?: "true" | "false";
  fire_withdrawal_rate?: string;
};
export type AnalysisExportWriteFileRequest = { path: string; content: string };
export type AnalysisExportLocalCli = {
  cli_key: string;
  label: string;
  executable: string;
  path: string;
};
export type AnalysisExportRunLocalCliRequest = {
  cli_key: string;
  content: string;
  analysis_prompt?: string;
  timeout_seconds?: number;
  run_id?: string;
};
export type AnalysisExportRunOpenAiCompatibleRequest = {
  endpoint: string;
  api_key: string;
  model: string;
  content: string;
  analysis_prompt?: string;
  timeout_seconds?: number;
  run_id?: string;
};
export type AnalysisExportRunCodexRequest = Omit<AnalysisExportRunLocalCliRequest, "cli_key">;

export type AnalysisExportSnapshotPayload = Record<string, unknown>;
export type AnalysisExportWriteFilePayload = { written: true; path: string; bytes: number };
export type AnalysisExportListLocalClisPayload = { rows: AnalysisExportLocalCli[] };
export type AnalysisExportProgressPayload = {
  run_id: string;
  cli_key?: string;
  cli_label?: string;
  stage?: string;
  message?: string;
  elapsed_ms?: number;
  timeout_seconds?: number;
  stdout_tail?: string;
  stderr_tail?: string;
  stdout_bytes?: number;
  stderr_bytes?: number;
  timestamp?: string;
};
export type AnalysisExportRunLocalCliPayload = {
  run_id: string;
  cli_key: string;
  provider: "local_cli";
  provider_label: string;
  cli_label: string;
  success: boolean;
  exit_code: number | null;
  timed_out: boolean;
  cli_path: string;
  markdown_path: string;
  stdout: string;
  stderr: string;
};
export type AnalysisExportRunOpenAiCompatiblePayload = {
  run_id: string;
  provider: "openai_compatible";
  provider_label: string;
  success: true;
  analysis_mode: string;
  endpoint: string;
  model: string;
  markdown_path: string;
  content: string;
  response_id: unknown;
  usage: unknown;
  fallback_note: string | null;
  passes: { fact_sheet: string; draft: string; review: string };
};
export type AnalysisExportRunCodexPayload = AnalysisExportRunLocalCliPayload;

export async function queryAnalysisExportSnapshot(
  req: AnalysisExportSnapshotRequest,
): Promise<AnalysisExportSnapshotPayload> {
  return invoke<AnalysisExportSnapshotPayload>("analysis_export_snapshot", { req });
}
export async function writeAnalysisExportFile(
  req: AnalysisExportWriteFileRequest,
): Promise<AnalysisExportWriteFilePayload> {
  return invoke<AnalysisExportWriteFilePayload>("analysis_export_write_file", req);
}
export async function listAnalysisExportLocalClis(): Promise<AnalysisExportListLocalClisPayload> {
  return invoke<AnalysisExportListLocalClisPayload>("analysis_export_list_local_clis");
}
export async function runAnalysisExportLocalCli(
  req: AnalysisExportRunLocalCliRequest,
): Promise<AnalysisExportRunLocalCliPayload> {
  return invoke<AnalysisExportRunLocalCliPayload>("analysis_export_run_local_cli", { req });
}
export async function runAnalysisExportOpenAiCompatible(
  req: AnalysisExportRunOpenAiCompatibleRequest,
): Promise<AnalysisExportRunOpenAiCompatiblePayload> {
  return invoke<AnalysisExportRunOpenAiCompatiblePayload>("analysis_export_run_openai_compatible", { req });
}
export async function runAnalysisExportCodex(
  req: AnalysisExportRunCodexRequest,
): Promise<AnalysisExportRunCodexPayload> {
  return invoke<AnalysisExportRunCodexPayload>("analysis_export_run_codex", { req });
}
