// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryInvestmentReturn } = vi.hoisted(() => ({ queryInvestmentReturn: vi.fn() }));

vi.mock("../../api/desktop", () => ({
  queryInvestmentReturn,
  queryInvestmentReturns: vi.fn(),
  queryInvestmentCurve: vi.fn(),
  queryInvestmentCurveBenchmarks: vi.fn(),
}));

import { useInvestmentController } from "./useInvestmentController";

describe("useInvestmentController", () => {
  beforeEach(() => queryInvestmentReturn.mockReset());

  it("loads the main result and sidebar YTD metrics together", async () => {
    queryInvestmentReturn
      .mockResolvedValueOnce({ metrics: { annualized_rate: 0.1 } })
      .mockResolvedValueOnce({ metrics: { annualized_rate: 0.2, net_growth_cents: 12345 } });
    const { result } = renderHook(() => useInvestmentController({ benchmarkSource: "eastmoney" }));
    await act(async () => { await result.current.refreshReturn(); });
    expect(result.current.result).toEqual({ metrics: { annualized_rate: 0.1 } });
    expect(result.current.ytdAnnualizedRate).toBe(0.2);
    expect(result.current.ytdNetGrowthCents).toBe(12345);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("surfaces request failures without replacing the previous result", async () => {
    queryInvestmentReturn
      .mockRejectedValueOnce(new Error("查询失败"))
      .mockResolvedValueOnce({ metrics: {} });
    const { result } = renderHook(() => useInvestmentController({ benchmarkSource: "eastmoney" }));
    await act(async () => { await result.current.refreshReturn(); });
    expect(result.current.error).toBe("查询失败");
    expect(result.current.result).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
