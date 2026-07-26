import { isAmountPrivacyMasked, isLikelyAmountJsonKey, maskAmountValueByLabel } from "../../app/amountFormatting";
import { BaseJsonResultCard, BasePreviewStat } from "./UiPrimitives";

export function PrivacyJsonResultCard({ title, data, emptyText }: { title?: string; data: unknown; emptyText: string }) {
  return <BaseJsonResultCard title={title} data={data} emptyText={emptyText} jsonValueReplacer={(key, value) => {
    if (typeof value === "bigint") return isLikelyAmountJsonKey(key) && isAmountPrivacyMasked() ? "****" : value.toString();
    if (isLikelyAmountJsonKey(key) && isAmountPrivacyMasked() && (typeof value === "number" || typeof value === "string")) return "****";
    return value;
  }} />;
}

export function PrivacyPreviewStat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "good" | "warn" }) {
  return <BasePreviewStat label={label} value={value} tone={tone} valueFormatter={maskAmountValueByLabel} />;
}
