import { invoke } from "./invoke";

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

type DynamicImportPayload = Record<string, unknown>;

export type YzxyPreviewPayload = DynamicImportPayload;
export type YzxyImportPayload = DynamicImportPayload;
export type CmbEmlPreviewPayload = DynamicImportPayload;
export type CmbEmlImportPayload = DynamicImportPayload;
export type CmbBankPdfPreviewPayload = DynamicImportPayload;
export type CmbBankPdfImportPayload = DynamicImportPayload;

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

export async function cmbBankPdfImport(req: CmbBankPdfImportRequest): Promise<CmbBankPdfImportPayload> {
  return invoke<CmbBankPdfImportPayload>("cmb_bank_pdf_import", { req });
}
