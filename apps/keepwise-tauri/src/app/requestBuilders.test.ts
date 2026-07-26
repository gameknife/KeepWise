import { describe, expect, it } from "vitest";
import {
  buildInvestmentCurveRequest,
  buildTransactionsQueryRequest,
  buildWealthOverviewRequest,
} from "./requestBuilders";

describe("request builders", () => {
  it("trims optional investment curve dates without changing the selected account", () => {
    expect(
      buildInvestmentCurveRequest({
        account_id: " account-1 ",
        preset: "custom",
        from: " 2026-01-01 ",
        to: "  ",
      }),
    ).toEqual({ account_id: " account-1 ", preset: "custom", from: "2026-01-01" });
  });

  it("omits blank list filters and keeps list defaults", () => {
    expect(
      buildTransactionsQueryRequest({
        limit: 50,
        sort: "amount_desc",
        month_key: " ",
        source_type: " manual ",
        account_id: "",
        keyword: " grocery ",
      }),
    ).toEqual({ limit: 50, sort: "amount_desc", source_type: "manual", keyword: "grocery" });
  });

  it("uses the custom curve end date as the wealth overview as-of date", () => {
    expect(
      buildWealthOverviewRequest(
        {
          include_investment: "true",
          include_cash: "true",
          include_real_estate: "false",
          include_liability: "true",
        },
        { preset: "custom", to: " 2026-06-30 " },
      ),
    ).toEqual({
      include_investment: "true",
      include_cash: "true",
      include_real_estate: "false",
      include_liability: "true",
      as_of: "2026-06-30",
    });
  });
});
