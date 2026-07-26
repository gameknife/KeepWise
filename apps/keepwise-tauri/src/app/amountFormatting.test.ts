import { describe, expect, it } from "vitest";
import {
  configureAmountFormatting,
  formatCentsShort,
  maskAmountValueByLabel,
  signedMetricTone,
} from "./amountFormatting";

describe("amount formatting", () => {
  it("masks monetary values without masking ratio labels", () => {
    configureAmountFormatting({ amountPrivacyMasked: true, gainLossColorScheme: "cn_red_up_green_down" });

    expect(formatCentsShort(123456)).toBe("****");
    expect(maskAmountValueByLabel("收益率", "12.3%")).toBe("12.3%");
    expect(maskAmountValueByLabel("净资产", "1234.56")).toBe("****");
  });

  it("uses the configured gain/loss color convention", () => {
    configureAmountFormatting({ amountPrivacyMasked: false, gainLossColorScheme: "cn_red_up_green_down" });
    expect(signedMetricTone(1)).toBe("warn");

    configureAmountFormatting({ amountPrivacyMasked: false, gainLossColorScheme: "intl_green_up_red_down" });
    expect(signedMetricTone(1)).toBe("good");
    expect(formatCentsShort(123456)).toBe("1,234.56");
  });
});
