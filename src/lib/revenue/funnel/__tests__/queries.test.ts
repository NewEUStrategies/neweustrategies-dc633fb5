// `queryOptions` lejka (S3, §5.4): klucz z fabryki I0 z segmentem i torem,
// świeżość zależna od domknięcia okna, wyłączenie bez najemcy.
import { keepPreviousData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revenueKeys } from "@/lib/revenue/keys";

const h = vi.hoisted(() => ({ getRevenueFunnel: vi.fn() }));

vi.mock("@/lib/revenue/funnel/funnel.functions", () => ({
  getRevenueFunnel: h.getRevenueFunnel,
}));

import {
  FUNNEL_GC_MS,
  FUNNEL_STALE_COMPLETE_MS,
  FUNNEL_STALE_OPEN_MS,
  revenueFunnelQueryOptions,
} from "@/lib/revenue/funnel/queries";

const TENANT = "tenant-1";

function range(complete: boolean) {
  return {
    period: "month" as const,
    current: { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    complete,
  };
}

beforeEach(() => {
  h.getRevenueFunnel.mockReset();
  h.getRevenueFunnel.mockResolvedValue({ state: "forbidden" });
});

describe("revenueFunnelQueryOptions", () => {
  it("klucz = revenueKeys.query('funnel', najemca, okno, {segment, track})", () => {
    const options = revenueFunnelQueryOptions(TENANT, range(false), {
      segment: "b2c_reduced",
      track: "sales",
    });
    expect(options.queryKey).toEqual(
      revenueKeys.query("funnel", TENANT, range(false), { segment: "b2c_reduced", track: "sales" }),
    );
    // Prefiks reguł szyny (`funK`) trafia w każde okno i tor.
    expect(options.queryKey.slice(0, 3)).toEqual(revenueKeys.domainTenant("funnel", TENANT));
  });

  it("domyślny segment i tor są w kluczu jawnie (ten sam odczyt = ten sam klucz)", () => {
    expect(revenueFunnelQueryOptions(TENANT, range(false)).queryKey).toEqual(
      revenueFunnelQueryOptions(TENANT, range(false), { segment: "all", track: "all" }).queryKey,
    );
  });

  it("okno otwarte 60 s, domknięte 30 min; gc 10 min; jedno ponowienie", () => {
    expect(revenueFunnelQueryOptions(TENANT, range(false)).staleTime).toBe(FUNNEL_STALE_OPEN_MS);
    expect(revenueFunnelQueryOptions(TENANT, range(true)).staleTime).toBe(FUNNEL_STALE_COMPLETE_MS);
    expect(FUNNEL_STALE_OPEN_MS).toBe(60_000);
    expect(FUNNEL_STALE_COMPLETE_MS).toBe(30 * 60_000);
    expect(revenueFunnelQueryOptions(TENANT, range(false)).gcTime).toBe(FUNNEL_GC_MS);
    expect(revenueFunnelQueryOptions(TENANT, range(false)).retry).toBe(1);
    expect(revenueFunnelQueryOptions(TENANT, range(false)).placeholderData).toBe(keepPreviousData);
  });

  it("bez najemcy zapytanie jest wyłączone", () => {
    expect(revenueFunnelQueryOptions(null, range(false)).enabled).toBe(false);
    expect(revenueFunnelQueryOptions(TENANT, range(false)).enabled).toBe(true);
  });

  it("queryFn woła server fn z granicami okna, segmentem i torem", async () => {
    const options = revenueFunnelQueryOptions(TENANT, range(false), { track: "self_serve" });
    await (options.queryFn as () => Promise<unknown>)();
    expect(h.getRevenueFunnel).toHaveBeenCalledWith({
      data: {
        sinceIso: "2026-09-01T00:00:00.000Z",
        untilIso: "2026-10-01T00:00:00.000Z",
        segment: "all",
        track: "self_serve",
      },
    });
  });
});
