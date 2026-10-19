// `queryOptions` zdrowia e-mail (S1, §4.5): klucz z fabryki I0, świeżość
// zależna od domknięcia okna, wyłączenie bez najemcy, wywołanie server fn.
import { keepPreviousData } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revenueKeys } from "@/lib/revenue/keys";

const h = vi.hoisted(() => ({ getRevenueEmailHealth: vi.fn() }));

vi.mock("@/lib/revenue/email/emailHealth.functions", () => ({
  getRevenueEmailHealth: h.getRevenueEmailHealth,
}));

import {
  EMAIL_HEALTH_GC_MS,
  EMAIL_HEALTH_STALE_COMPLETE_MS,
  EMAIL_HEALTH_STALE_OPEN_MS,
  revenueEmailHealthQueryOptions,
} from "@/lib/revenue/email/queries";

const TENANT = "tenant-1";

function range(complete: boolean) {
  return {
    period: "month" as const,
    current: {
      sinceIso: "2026-09-01T00:00:00.000Z",
      untilIso: "2026-10-01T00:00:00.000Z",
    },
    complete,
  };
}

beforeEach(() => {
  h.getRevenueEmailHealth.mockReset();
  h.getRevenueEmailHealth.mockResolvedValue({ state: "forbidden" });
});

describe("revenueEmailHealthQueryOptions", () => {
  it("klucz = revenueKeys.query('email', najemca, okno) - prefiks reguł szyny", () => {
    const options = revenueEmailHealthQueryOptions(TENANT, range(false));

    expect(options.queryKey).toEqual(revenueKeys.query("email", TENANT, range(false)));
    expect(options.queryKey.slice(0, 3)).toEqual(revenueKeys.domainTenant("email", TENANT));
  });

  it("okno otwarte: 60 s świeżości, domknięte: 30 min", () => {
    expect(revenueEmailHealthQueryOptions(TENANT, range(false)).staleTime).toBe(
      EMAIL_HEALTH_STALE_OPEN_MS,
    );
    expect(EMAIL_HEALTH_STALE_OPEN_MS).toBe(60_000);
    expect(revenueEmailHealthQueryOptions(TENANT, range(true)).staleTime).toBe(
      EMAIL_HEALTH_STALE_COMPLETE_MS,
    );
    expect(EMAIL_HEALTH_STALE_COMPLETE_MS).toBe(30 * 60_000);
  });

  it("bez najemcy zapytanie jest wyłączone", () => {
    expect(revenueEmailHealthQueryOptions(null, range(false)).enabled).toBe(false);
    expect(revenueEmailHealthQueryOptions(TENANT, range(false)).enabled).toBe(true);
  });

  it("jedno ponowienie, 10 min w cache, poprzednie liczby przy zmianie okna", () => {
    const options = revenueEmailHealthQueryOptions(TENANT, range(false));

    expect(options.retry).toBe(1);
    expect(options.gcTime).toBe(EMAIL_HEALTH_GC_MS);
    expect(EMAIL_HEALTH_GC_MS).toBe(10 * 60_000);
    expect(options.placeholderData).toBe(keepPreviousData);
  });

  it("queryFn woła server fn z granicami okna (bez najemcy) i oddaje stan bez rzucania", async () => {
    const options = revenueEmailHealthQueryOptions(TENANT, range(true));
    const queryFn = options.queryFn as () => Promise<unknown>;

    await expect(queryFn()).resolves.toEqual({ state: "forbidden" });
    expect(h.getRevenueEmailHealth).toHaveBeenCalledWith({
      data: { sinceIso: "2026-09-01T00:00:00.000Z", untilIso: "2026-10-01T00:00:00.000Z" },
    });
  });
});
