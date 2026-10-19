// `useBenchmark` - jedno zapytanie o GRUPĘ i język, wybór wpisu przez
// `select` (SPEC §5.5, AD-09).
//
// Klasy defektów:
//   1. KLUCZ. `["benchmarks", grupa, język]` jest kontraktem z serwerem
//      i z innymi ekranami (hub, słownik) - inny kształt to drugi odczyt tej
//      samej grupy i rozjazd cache między ekranami.
//   2. ŚWIEŻOŚĆ. Treść zmienia się wyłącznie z wdrożeniem; `staleTime` inne niż
//      nieskończoność to ponowny odczyt przy każdym fokusie okna.
//   3. WYBÓR WPISU. Trzy wpisy e-maili ścieżek wskazują jedną metrykę - hook
//      musi wybrać wpis WIODĄCY (`primary`), a jawny `benchKey` wygrywa.
//   4. BRAK BENCHMARKU TO STAN, NIE BŁĄD. Metryka bez wpisu nie woła serwera.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ fetchGroup: vi.fn() }));

vi.mock("@/lib/analytics/semantic/benchmarks/benchmarks.functions", () => ({
  getBenchmarkGroup: (...args: unknown[]) => h.fetchGroup(...args),
}));

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { payloadFor } from "../../__tests__/benchmarkFixtures";
import {
  benchmarkEntryFor,
  benchmarkGroupQueryOptions,
  benchmarkKeys,
  useBenchmark,
  usePrefetchBenchmark,
} from "../useBenchmark";

beforeEach(() => {
  h.fetchGroup.mockReset();
  h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
    payloadFor(data.group, data.lang),
  );
});
afterEach(cleanup);

describe("benchmarkKeys i benchmarkGroupQueryOptions", () => {
  it("klucz grupy to dokładnie [benchmarks, grupa, język] - bez najemcy (treść globalna)", () => {
    expect(benchmarkKeys.group("retention", "pl")).toEqual(["benchmarks", "retention", "pl"]);
    expect(benchmarkKeys.all()).toEqual(["benchmarks"]);
  });

  it("treść żyje całą sesję: staleTime i gcTime = ∞, jedno ponowienie", () => {
    const opts = benchmarkGroupQueryOptions("email", "en");
    expect(opts.queryKey).toEqual(["benchmarks", "email", "en"]);
    expect(opts.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(opts.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(opts.retry).toBe(1);
  });

  it("queryFn woła server fn z grupą i językiem, niczym więcej", async () => {
    const opts = benchmarkGroupQueryOptions("funnel", "pl");
    const fn = opts.queryFn;
    if (typeof fn !== "function") throw new Error("test: brak queryFn");
    await (fn as () => Promise<unknown>)();
    expect(h.fetchGroup).toHaveBeenCalledWith({ data: { group: "funnel", lang: "pl" } });
  });
});

describe("benchmarkEntryFor - wybór wpisu", () => {
  it("metryka z jednym wpisem → ten wpis; z wieloma → wpis wiodący", () => {
    expect(benchmarkEntryFor({ metricId: "logo_churn_monthly" })?.key).toBe("logo_churn_monthly");
    expect(benchmarkEntryFor({ metricId: "journey_open_rate" })?.key).toBe(
      "welcome_email_open_rate",
    );
  });

  it("jawny wpis wygrywa z metryką; metryka bez benchmarku → brak wpisu", () => {
    expect(
      benchmarkEntryFor({
        metricId: "journey_open_rate",
        benchKey: "abandoned_cart_email_open_rate",
      })?.key,
    ).toBe("abandoned_cart_email_open_rate");
    expect(benchmarkEntryFor({ metricId: "sessions" })).toBeUndefined();
    expect(benchmarkEntryFor({ metricId: "revenue_realized" })).toBeUndefined();
  });
});

describe("useBenchmark", () => {
  it("ładowanie → gotowe: wpis z grupy w wybranym języku i źródła grupy", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useBenchmark({ metricId: "logo_churn_monthly", lang: "en" }),
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.bench?.key).toBe("logo_churn_monthly");
    expect(result.current.bench?.levers).toBe(
      payloadFor("retention", "en").benchmarks.find((b) => b.key === "logo_churn_monthly")?.levers,
    );
    expect(result.current.sources.length).toBeGreaterThan(0);
    expect(h.fetchGroup).toHaveBeenCalledWith({ data: { group: "retention", lang: "en" } });
  });

  it("dwa wskaźniki z jednej grupy = JEDEN odczyt (cache per grupa)", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => ({
      a: useBenchmark({ metricId: "logo_churn_monthly", lang: "pl" }),
      b: useBenchmark({ metricId: "net_revenue_retention", lang: "pl" }),
    }));
    await waitFor(() => expect(result.current.b.status).toBe("ready"));
    expect(result.current.a.bench?.key).toBe("logo_churn_monthly");
    expect(result.current.b.bench?.key).toBe("net_revenue_retention");
    expect(h.fetchGroup).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["benchmarks", "retention", "pl"])).toBeTruthy();
  });

  it("metryka bez benchmarku: stan `none`, zero zapytań", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useBenchmark({ metricId: "sessions", lang: "pl" }),
    );
    await act(async () => {});
    expect(result.current.status).toBe("none");
    expect(result.current.bench).toBeNull();
    expect(h.fetchGroup).not.toHaveBeenCalled();
  });

  it("`enabled: false` wstrzymuje odczyt (stan `idle`)", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useBenchmark({ metricId: "arr", lang: "pl", enabled: false }),
    );
    await act(async () => {});
    expect(result.current.status).toBe("idle");
    expect(h.fetchGroup).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(["benchmarks", "revenue", "pl"])).toBeUndefined();
  });

  it("błąd po ponowieniu: stan `error`, `refetch` ponawia", async () => {
    h.fetchGroup.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHookWithQueryClient(() =>
      useBenchmark({ metricId: "arr", lang: "pl" }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"), { timeout: 5000 });
    expect(h.fetchGroup).toHaveBeenCalledTimes(2);
    h.fetchGroup.mockImplementation(async ({ data }: { data: { group: never; lang: never } }) =>
      payloadFor(data.group, data.lang),
    );
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("wpis bez metryki (NPS) przez benchKey", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useBenchmark({ benchKey: "nps", lang: "pl" }),
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.bench?.metricId).toBeUndefined();
    expect(result.current.bench?.noMetricReason).toBeTruthy();
  });
});

describe("usePrefetchBenchmark", () => {
  it("pobiera grupę do cache; bez wpisu - nic", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => usePrefetchBenchmark());
    act(() => result.current({ metricId: "sessions", lang: "pl" }));
    await act(async () => {});
    expect(h.fetchGroup).not.toHaveBeenCalled();
    act(() => result.current({ metricId: "email_open_rate", lang: "pl" }));
    await waitFor(() =>
      expect(queryClient.getQueryData(["benchmarks", "email", "pl"])).toBeTruthy(),
    );
    // Drugie wywołanie trafia w świeży cache (staleTime ∞).
    act(() => result.current({ metricId: "email_ctr", lang: "pl" }));
    await act(async () => {});
    expect(h.fetchGroup).toHaveBeenCalledTimes(1);
  });
});
