// `queryOptions` finansów huba (S2, §5.4): klucze z fabryki I0, świeżość
// per pas, wyłączenie bez najemcy albo roli i odświeżenie po zapisie.
import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revenueKeys } from "@/lib/revenue/keys";

const h = vi.hoisted(() => ({
  getRevenueMrrBridge: vi.fn(),
  getRevenueMrrSeries: vi.fn(),
  getRevenueRealized: vi.fn(),
  getRevenueChurn: vi.fn(),
  getRevenueCohorts: vi.fn(),
  getRevenueDunning: vi.fn(),
  getRevenueRetentionOffers: vi.fn(),
  getRevenueOfferMatrix: vi.fn(),
  getRevenueInputs: vi.fn(),
  getRevenueEconomics: vi.fn(),
  saveRevenueInput: vi.fn(),
}));

vi.mock("@/lib/revenue/finance/finance.functions", () => h);

import {
  FINANCE_GC_MS,
  FINANCE_STALE_COMPLETE_MS,
  FINANCE_STALE_OFFER_MS,
  FINANCE_STALE_OPEN_MS,
  FINANCE_STALE_SLOW_MS,
  revenueChurnQueryOptions,
  revenueCohortsQueryOptions,
  revenueDunningQueryOptions,
  revenueEconomicsQueryOptions,
  revenueInputSaveInvalidationKeys,
  revenueInputsQueryOptions,
  revenueMrrBridgeQueryOptions,
  revenueMrrSeriesQueryOptions,
  revenueOfferMatrixQueryOptions,
  revenueRealizedQueryOptions,
  revenueRetentionOffersQueryOptions,
  useSaveRevenueInput,
} from "@/lib/revenue/finance/queries";

const TENANT = "tenant-1";

function range(complete: boolean) {
  return {
    period: "month" as const,
    current: { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    complete,
  };
}

beforeEach(() => {
  for (const fn of Object.values(h)) {
    fn.mockReset();
    fn.mockResolvedValue({ state: "forbidden" });
  }
});

describe("klucze z fabryki I0 (prefiks reguł szyny)", () => {
  it.each([
    ["mrr", revenueMrrBridgeQueryOptions(TENANT, range(false)).queryKey],
    ["mrr", revenueMrrSeriesQueryOptions(TENANT, range(false), "week", "Europe/Warsaw").queryKey],
    ["realized", revenueRealizedQueryOptions(TENANT, range(false)).queryKey],
    ["retention", revenueRetentionOffersQueryOptions(TENANT, range(false)).queryKey],
    ["churn", revenueChurnQueryOptions(TENANT, range(false)).queryKey],
    ["dunning", revenueDunningQueryOptions(TENANT, range(false)).queryKey],
    ["cohorts", revenueCohortsQueryOptions(TENANT, "2026-01-01", "2026-09-01").queryKey],
    ["inputs", revenueInputsQueryOptions(TENANT, "2026-01-01", "2026-09-01").queryKey],
    ["economics", revenueEconomicsQueryOptions(TENANT, "2026-01-01", "2026-09-01", "UTC").queryKey],
    ["offer", revenueOfferMatrixQueryOptions(TENANT).queryKey],
  ] as const)("%s", (domain, key) => {
    expect(key.slice(0, 3)).toEqual(revenueKeys.domainTenant(domain, TENANT));
  });

  it("most = revenueKeys.query('mrr', …, { segment }) - ten sam klucz w hubie i /admin/billing", () => {
    expect(revenueMrrBridgeQueryOptions(TENANT, range(false), "b2c_reduced").queryKey).toEqual(
      revenueKeys.query("mrr", TENANT, range(false), { segment: "b2c_reduced" }),
    );
  });

  it("most i szereg w dziedzinie `mrr` nie dzielą wpisu", () => {
    const bridge = revenueMrrBridgeQueryOptions(TENANT, range(false)).queryKey;
    const series = revenueMrrSeriesQueryOptions(TENANT, range(false), "month", "UTC").queryKey;
    expect(series).not.toEqual(bridge);
    expect(series.slice(0, bridge.length)).not.toEqual(bridge);
  });

  it("dane wejściowe i macierz = dedykowane funkcje fabryki", () => {
    expect(revenueInputsQueryOptions(TENANT, "2026-01-01", "2026-09-01").queryKey).toEqual(
      revenueKeys.manualInputs(TENANT, "2026-01-01", "2026-09-01"),
    );
    expect(revenueOfferMatrixQueryOptions(TENANT).queryKey).toEqual(
      revenueKeys.offerMatrix(TENANT),
    );
  });
});

describe("świeżość (§5.4)", () => {
  it("pas szybki: 60 s okno otwarte, 30 min domknięte; poprzednie liczby przy zmianie okna", () => {
    expect(revenueMrrBridgeQueryOptions(TENANT, range(false)).staleTime).toBe(
      FINANCE_STALE_OPEN_MS,
    );
    expect(revenueRealizedQueryOptions(TENANT, range(true)).staleTime).toBe(
      FINANCE_STALE_COMPLETE_MS,
    );
    expect(FINANCE_STALE_OPEN_MS).toBe(60_000);
    expect(FINANCE_STALE_COMPLETE_MS).toBe(30 * 60_000);
    expect(revenueMrrBridgeQueryOptions(TENANT, range(false)).placeholderData).toBe(
      keepPreviousData,
    );
  });

  it("pas wolny 5 min, macierz 30 s, gc 10 min, jedno ponowienie", () => {
    expect(revenueChurnQueryOptions(TENANT, range(true)).staleTime).toBe(FINANCE_STALE_SLOW_MS);
    expect(FINANCE_STALE_SLOW_MS).toBe(5 * 60_000);
    expect(revenueOfferMatrixQueryOptions(TENANT).staleTime).toBe(FINANCE_STALE_OFFER_MS);
    expect(FINANCE_STALE_OFFER_MS).toBe(30_000);
    const o = revenueDunningQueryOptions(TENANT, range(true));
    expect(o.gcTime).toBe(FINANCE_GC_MS);
    expect(FINANCE_GC_MS).toBe(10 * 60_000);
    expect(o.retry).toBe(1);
  });
});

describe("enabled = najemca && rola", () => {
  it("bez najemcy albo bez roli zapytanie jest wyłączone", () => {
    expect(revenueMrrBridgeQueryOptions(null, range(false)).enabled).toBe(false);
    expect(
      revenueMrrBridgeQueryOptions(TENANT, range(false), null, { roleOk: false }).enabled,
    ).toBe(false);
    expect(revenueMrrBridgeQueryOptions(TENANT, range(false)).enabled).toBe(true);
  });
});

describe("queryFn", () => {
  it("most woła server fn z oknem i segmentem (bez najemcy)", async () => {
    const queryFn = revenueMrrBridgeQueryOptions(TENANT, range(true), "other")
      .queryFn as () => Promise<unknown>;
    await expect(queryFn()).resolves.toEqual({ state: "forbidden" });
    expect(h.getRevenueMrrBridge).toHaveBeenCalledWith({
      data: {
        sinceIso: "2026-09-01T00:00:00.000Z",
        untilIso: "2026-10-01T00:00:00.000Z",
        segment: "other",
      },
    });
  });

  it("ekonomika i kohorty wołają z zakresem miesięcy", async () => {
    await (
      revenueEconomicsQueryOptions(TENANT, "2026-01-01", "2026-09-01", "UTC")
        .queryFn as () => Promise<unknown>
    )();
    expect(h.getRevenueEconomics).toHaveBeenCalledWith({
      data: { fromMonth: "2026-01-01", toMonth: "2026-09-01", timeZone: "UTC" },
    });
    await (
      revenueCohortsQueryOptions(TENANT, "2026-01-01", "2026-09-01")
        .queryFn as () => Promise<unknown>
    )();
    expect(h.getRevenueCohorts).toHaveBeenCalledWith({
      data: { fromMonth: "2026-01-01", toMonth: "2026-09-01" },
    });
  });
});

describe("useSaveRevenueInput", () => {
  function wrapper(qc: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
  }

  it("po zapisie i po konflikcie odświeża dane wejściowe i ekonomikę", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.saveRevenueInput.mockResolvedValue({ state: "conflict" });
    const { result } = renderHook(() => useSaveRevenueInput(TENANT), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({
        periodMonth: "2026-09-01",
        kind: "cogs",
        segment: "all",
        currency: "PLN",
        amountMinor: 1,
        ratio: null,
        note: null,
        expectedUpdatedAt: null,
      });
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([
      ...revenueInputSaveInvalidationKeys(TENANT),
    ]);
  });

  it("odmowa roli nie odświeża niczego", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    h.saveRevenueInput.mockResolvedValue({ state: "forbidden" });
    const { result } = renderHook(() => useSaveRevenueInput(TENANT), { wrapper: wrapper(qc) });
    await act(async () => {
      await result.current.mutateAsync({
        periodMonth: "2026-09-01",
        kind: "gross_margin_pct",
        segment: "all",
        currency: null,
        amountMinor: null,
        ratio: 0.6,
        note: null,
        expectedUpdatedAt: null,
      });
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
