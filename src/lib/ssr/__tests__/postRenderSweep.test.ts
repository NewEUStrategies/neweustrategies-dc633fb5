import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { sweepQueryCacheForSerialization } from "../postRenderSweep";

describe("sweepQueryCacheForSerialization", () => {
  it("usuwa zapytania pending/idle bez danych", () => {
    const qc = new QueryClient();
    qc.getQueryCache().build(qc, { queryKey: ["dead"], queryFn: () => new Promise(() => {}) });

    const result = sweepQueryCacheForSerialization(qc, { quiet: true });

    expect(result.pruned).toContain(JSON.stringify(["dead"]));
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("anuluje wiszący fetch i nie rusza rozstrzygniętych danych", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["ok"], { value: 1 });
    void qc.prefetchQuery({ queryKey: ["hang"], queryFn: () => new Promise(() => {}) });
    await vi.waitFor(() => {
      expect(qc.isFetching()).toBe(1);
    });

    const result = sweepQueryCacheForSerialization(qc, { quiet: true });

    expect(result.cancelled).toBe(1);
    expect(qc.getQueryData(["ok"])).toEqual({ value: 1 });
  });
});
