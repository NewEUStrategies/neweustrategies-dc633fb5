// WOLNY PAS INWALIDACJI (SPEC §3.3): agregaty huba po 5 s, listy po 250 ms.
//
// CO TU MOŻE PÓJŚĆ ŹLE, a nic się nie wywróci:
//   * wspólny timer dla obu pasów - albo listy modułów czekają 5 s po każdej
//     zmianie (admin widzi „nie zapisało się"), albo agregaty huba liczą się
//     po każdej ramce realtime (burza RPC przy imporcie CSV albo ticku silnika);
//   * timer wolnego pasa przesuwany każdym zdarzeniem - ciągła seria odkłada
//     odświeżenie kokpitu w nieskończoność;
//   * powrót karty albo zmiana trasy opróżnia tylko szybki pas - zaległy
//     agregat ginie i hub pokazuje liczby sprzed zdarzenia.
// Asercje dotyczą tego, KTÓRY klucz i KIEDY trafił do `invalidateQueries`
// (wzór `useModuleRealtime.test.tsx`), a nie refetchu - to kontrakt React Query.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { journeyKeys } from "@/lib/journeys/keys";
import { revenueKeys } from "@/lib/revenue/keys";
import { crmKeys } from "@/lib/crm/keys";
import {
  SLOW_INVALIDATION_MS,
  isSlowInvalidationKey,
  useDebouncedInvalidation,
} from "@/lib/realtime/useModuleRealtime";

const TENANT = "11111111-1111-4111-a111-111111111111";
const JOURNEY = "22222222-2222-4222-a222-222222222222";

const SLOW: QueryKey = revenueKeys.domainTenant("mrr", TENANT);
const FAST: QueryKey = crmKeys.leadsAll();

function trackInvalidations(queryClient: QueryClient): QueryKey[] {
  const seen: QueryKey[] = [];
  vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async (filters) => {
    seen.push(filters?.queryKey ?? []);
  });
  return seen;
}

// happy-dom trzyma `visibilityState` jako getter na prototypie Document, więc
// test nadpisuje go WŁASNĄ właściwością instancji i kasuje ją po sobie.
let visibilityPatched = false;
function setVisibility(state: "visible" | "hidden"): void {
  visibilityPatched = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

function fireVisibilityChange(): void {
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function mountLanes() {
  const view = renderHookWithQueryClient(() => useDebouncedInvalidation());
  return { ...view, seen: trackInvalidations(view.queryClient) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (visibilityPatched) {
    Reflect.deleteProperty(document, "visibilityState");
    visibilityPatched = false;
  }
});

describe("isSlowInvalidationKey", () => {
  it("okno wolnego pasa to 5 s", () => {
    expect(SLOW_INVALIDATION_MS).toBe(5_000);
  });

  it("wolne: każdy agregat huba i statystyki ścieżek", () => {
    const range = { period: "month" as const, current: { sinceIso: "a", untilIso: "b" } };
    for (const key of [
      revenueKeys.root(),
      revenueKeys.domainTenant("funnel", TENANT),
      revenueKeys.query("mrr", TENANT, range),
      revenueKeys.facts(TENANT),
      journeyKeys.statsFor(JOURNEY),
      journeyKeys.stats(JOURNEY, null, null, null),
    ]) {
      expect(isSlowInvalidationKey(key), JSON.stringify(key)).toBe(true);
    }
  });

  it("szybkie: listy, szczegóły i kontakty ścieżek oraz klucze modułów", () => {
    for (const key of [
      journeyKeys.root(),
      journeyKeys.listAll(),
      journeyKeys.detail(JOURNEY),
      journeyKeys.enrollmentsFor(JOURNEY),
      journeyKeys.forLeadAll(),
      crmKeys.leadsAll(),
      ["admin"],
      ["admin", "monetization"],
      // Równość elementu, nie prefiks napisu.
      ["admin-revenue-legacy"],
      [],
    ] as QueryKey[]) {
      expect(isSlowInvalidationKey(key), JSON.stringify(key)).toBe(false);
    }
  });
});

describe("useDebouncedInvalidation - dwa pasy", () => {
  it("szybki klucz po 250 ms, wolny dopiero po 5 s - nie wcześniej", () => {
    const { result, seen, unmount } = mountLanes();

    act(() => result.current([FAST, SLOW]));
    act(() => vi.advanceTimersByTime(250));
    expect(seen).toEqual([FAST]);

    act(() => vi.advanceTimersByTime(SLOW_INVALIDATION_MS - 251));
    expect(seen).toEqual([FAST]);

    act(() => vi.advanceTimersByTime(1));
    expect(seen).toEqual([FAST, SLOW]);

    unmount();
    // Nic nie zostało w kolejce - odmontowanie nie powtarza inwalidacji.
    expect(seen).toEqual([FAST, SLOW]);
  });

  it("seria zdarzeń nie przesuwa okna wolnego pasa i zbija się do jednej inwalidacji", () => {
    const { result, seen, unmount } = mountLanes();

    act(() => result.current([SLOW]));
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current([revenueKeys.domainTenant("mrr", TENANT)]));
    act(() => vi.advanceTimersByTime(2_000));

    // 5 s od PIERWSZEGO zdarzenia, a nie od ostatniego.
    expect(seen).toEqual([SLOW]);
    unmount();
  });

  it("szybkie zdarzenie w trakcie okna wolnego pasa nie przyspiesza agregatów", () => {
    const { result, seen, unmount } = mountLanes();

    act(() => result.current([SLOW]));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current([FAST]));
    act(() => vi.advanceTimersByTime(250));
    expect(seen).toEqual([FAST]);

    act(() => vi.advanceTimersByTime(3_750));
    expect(seen).toEqual([FAST, SLOW]);
    unmount();
  });

  it("ukryta karta nie stawia ŻADNEGO timera; powrót opróżnia oba pasy od razu", () => {
    setVisibility("hidden");
    const { result, seen, unmount } = mountLanes();

    act(() => result.current([SLOW, FAST]));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(60_000));
    expect(seen).toEqual([]);

    setVisibility("visible");
    fireVisibilityChange();
    // Zero przesunięcia zegara - także wolny pas nie czeka swoich 5 s.
    expect(seen).toEqual([FAST, SLOW]);
    unmount();
  });

  it("powrót na kartę w trakcie okna opróżnia wolny pas i kasuje jego timer", () => {
    const { result, seen, unmount } = mountLanes();

    act(() => result.current([SLOW]));
    act(() => vi.advanceTimersByTime(1_000));
    fireVisibilityChange();
    expect(seen).toEqual([SLOW]);

    act(() => vi.advanceTimersByTime(SLOW_INVALIDATION_MS));
    expect(seen).toEqual([SLOW]);
    unmount();
  });

  it("odmontowanie opróżnia oba pasy - zaległy agregat nie ginie przy zmianie trasy", () => {
    const { result, seen, unmount } = mountLanes();

    act(() => result.current([SLOW, FAST]));
    expect(seen).toEqual([]);

    unmount();
    expect(seen).toEqual([FAST, SLOW]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("okno wolnego pasa jest parametrem (drugi argument)", () => {
    const view = renderHookWithQueryClient(() => useDebouncedInvalidation(10, 100));
    const seen = trackInvalidations(view.queryClient);

    act(() => view.result.current([SLOW, FAST]));
    act(() => vi.advanceTimersByTime(10));
    expect(seen).toEqual([FAST]);
    act(() => vi.advanceTimersByTime(90));
    expect(seen).toEqual([FAST, SLOW]);
    view.unmount();
  });
});
