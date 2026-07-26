// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAsyncQuery } from "./useAsyncQuery";

describe("useAsyncQuery", () => {
  it("tracks success, busy and last run time", async () => {
    const api = vi.fn(async (req: { id: number }) => ({ id: req.id }));
    const { result } = renderHook(() => useAsyncQuery(api, { id: 1 }));
    let pending!: Promise<{ id: number }>;
    act(() => { pending = result.current.run(); });
    expect(result.current.busy).toBe(true);
    await act(async () => { await pending; });
    expect(result.current.busy).toBe(false);
    expect(result.current.result).toEqual({ id: 1 });
    expect(result.current.lastRunAt).toEqual(expect.any(Number));
  });

  it("keeps the current error contract and rethrows", async () => {
    const failure = new Error("boom");
    const { result } = renderHook(() => useAsyncQuery(async () => { throw failure; }, { id: 1 }));
    await act(async () => { await expect(result.current.run()).rejects.toBe(failure); });
    expect(result.current.error).toBe("boom");
    expect(result.current.busy).toBe(false);
  });
});
