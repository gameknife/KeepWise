export type LoadStatus = "idle" | "loading" | "ready" | "error";
export type BoolString = "true" | "false";
export type GainLossColorScheme = "cn_red_up_green_down" | "intl_green_up_red_down";

export type AppSettings = {
  gainLossColorScheme: GainLossColorScheme;
  defaultPrivacyMaskOnLaunch: boolean;
  uiMotionEnabled: boolean;
};

export type SmokeStatus = "idle" | "pass" | "fail";
export type SmokeKey = "investment-return" | "investment-curve" | "wealth-overview" | "wealth-curve";
export type PipelineStatus = "idle" | "running" | "pass" | "fail";
export type ImportStepStatus = "idle" | "running" | "pass" | "fail" | "skip";
export type ImportStepKey = "yzxy" | "cmb-eml" | "cmb-pdf";

export type ProductTabKey =
  | "import-center"
  | "manual-entry"
  | "return-analysis"
  | "wealth-overview"
  | "budget-fire"
  | "income-analysis"
  | "consumption-analysis"
  | "admin";

export type MobileView = "home" | ProductTabKey;

export type SmokeRow = {
  key: SmokeKey;
  label: string;
  status: SmokeStatus;
  durationMs?: number;
  detail?: string;
};

export type ImportStepRow = {
  key: ImportStepKey;
  label: string;
  status: ImportStepStatus;
  durationMs?: number;
  detail?: string;
};

export type ProductTabDef = {
  key: ProductTabKey;
  icon: string;
  label: string;
  subtitle: string;
  status: "ready" | "partial" | "todo";
};
