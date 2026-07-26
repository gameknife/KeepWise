import { describe, expect, it } from "vitest";
import { parseStoredAppSettings, parseYuanInputToNumber } from "./helpers";

describe("app helpers", () => {
  it("keeps supported stored settings and falls back for incompatible values", () => {
    expect(
      parseStoredAppSettings(
        JSON.stringify({
          gainLossColorScheme: "intl_green_up_red_down",
          fireWithdrawalRate: "0.04",
          benchmarkMarketDataSource: "yahoo",
          uiMotionEnabled: false,
          aiApiKey: "secret",
          aiLocalCliEnabled: true,
          unsupported: "ignored",
        }),
      ),
    ).toMatchObject({
      gainLossColorScheme: "intl_green_up_red_down",
      fireWithdrawalRate: "0.04",
      benchmarkMarketDataSource: "yahoo",
      uiMotionEnabled: false,
      aiApiKey: "secret",
      aiLocalCliEnabled: true,
    });
    expect(parseStoredAppSettings("not-json").fireWithdrawalRate).toBe("0.03");
  });

  it("parses yuan input after removing visual separators", () => {
    expect(parseYuanInputToNumber(" 1,234.50 ")).toBe(1234.5);
    expect(parseYuanInputToNumber(" ")).toBeNull();
    expect(parseYuanInputToNumber("not-a-number")).toBeNull();
  });
});
