// @vitest-environment node
//
// PREDYKAT KOMPLETNOŚCI DOKUMENTU (fala 3, P3.6b, R2a diagnozy
// `faza3/diagnoza/cache-dokumentu.md`).
//
// Werdykt zapisu do NES Edge Cache zapada teraz NA KOŃCU STRUMIENIA, więc
// predykat jest jedyną zaporą przed zamrożeniem niekompletnego dokumentu na
// 3 min świeżości i dobę STALE. Ten plik dowodzi obu kierunków na prawdziwym
// `QueryClient`:
//  * NEGATYWNE - każde odstępstwo to brak zapisu: zasiew awaryjny
//    (`updatedAt: 0`), błąd, dane pobierane w renderze i zgubione (bramka
//    sekcji, której minął budżet, anuluje i USUWA swoje zapytania), dane wciąż
//    w locie;
//  * POZYTYWNE - dokument kompletny przechodzi: sekcja dostrumieniowana po
//    terminie loadera (B2), celowy zasiew zadeklarowany w korzeniu, dekoracja
//    (reklama), obserwator renderu, który na serwerze z założenia nie pobiera,
//    zapytanie loadera zamiecione przed renderem i nieponowione (widget
//    niewidoczny na tym urządzeniu);
//  * ZAMROŻENIE - integracja router<->query czyści cache (`clear()`) ZANIM
//    kolektor zapisu przeczyta koniec dokumentu; werdykt musi to przeżyć.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sweepQueryCacheForSerialization } from "../postRenderSweep";
import { markDeliberateSeed, queryLabel, trackSsrQueryCompleteness } from "../resilientLoad";

const clients: QueryClient[] = [];

function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(qc);
  return qc;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Zamiatarka usuwa anulowane zapytania w `.finally` - domknij mikrotaski i jeden tik. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
  vi.restoreAllMocks();
});

describe("negatywne: każde odstępstwo = brak zapisu", () => {
  it("zasiew awaryjny `updatedAt: 0` (np. typ A: brak strony głównej)", () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    qc.setQueryData(["public", "home-page"], null, { updatedAt: 0 });
    expect(check()).toEqual({ complete: false, reasons: ["seed:public.home-page"] });
  });

  it("zapytanie z błędem", async () => {
    const qc = client();
    await qc
      .fetchQuery({
        queryKey: ["header_ticker", "trending"],
        queryFn: async () => {
          throw new Error("offline");
        },
      })
      .catch(() => undefined);
    const check = trackSsrQueryCompleteness(qc);
    expect(check()).toEqual({ complete: false, reasons: ["error:header_ticker.trending"] });
  });

  it("dane pobierane w renderze, anulowane i usunięte (bramka sekcji po budżecie)", async () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    const key = ["builder-post-list", { limit: 6 }];
    void qc.prefetchQuery({ queryKey: key, queryFn: () => new Promise<string[]>(() => {}) });
    // Dokładnie to robi `ServerSectionGate` po wyczerpaniu budżetu.
    await qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key, exact: true });
    expect(check()).toEqual({ complete: false, reasons: ["dropped:builder-post-list"] });
  });

  it("...także gdy widget odtworzy po nim pusty wpis obserwatora", async () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    const key = ["builder-post-list", { limit: 6 }];
    void qc.prefetchQuery({ queryKey: key, queryFn: () => new Promise<string[]>(() => {}) });
    await qc.cancelQueries({ queryKey: key });
    qc.removeQueries({ queryKey: key, exact: true });
    // `useQuery` widgetu w renderze serwerowym: wpis `pending` bez pobrania.
    qc.getQueryCache().build(qc, { queryKey: key });
    expect(check().complete).toBe(false);
  });

  it("dane wciąż w locie w chwili werdyktu", () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    void qc.prefetchQuery({
      queryKey: ["menu-with-items", "main"],
      queryFn: () => new Promise<string[]>(() => {}),
    });
    expect(check()).toEqual({ complete: false, reasons: ["dropped:menu-with-items.main"] });
  });

  it("zasiew `updatedAt: 0` bez deklaracji celowości nie jest wyjątkiem", () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    markDeliberateSeed(qc, ["post-layout-settings"]);
    qc.setQueryData(["post-layout-settings"], { gap: 1 }, { updatedAt: 0 });
    qc.setQueryData(["site_settings"], {}, { updatedAt: 0 });
    expect(check()).toEqual({ complete: false, reasons: ["seed:site_settings"] });
  });

  it("deklaracja celowego zasiewu jest per żądanie (`QueryClient`), nie globalna", () => {
    markDeliberateSeed(client(), ["post-layout-settings"]);
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    qc.setQueryData(["post-layout-settings"], { gap: 1 }, { updatedAt: 0 });
    expect(check().complete).toBe(false);
  });
});

describe("pozytywne: dokument kompletny przechodzi", () => {
  it("B2: sekcja pobrana PO terminie loadera i dostrumieniowana przed końcem", async () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    const late = deferred<string[]>();
    const work = qc.prefetchQuery({
      queryKey: ["builder-post-list", 1],
      queryFn: () => late.promise,
    });
    late.resolve(["wpis"]);
    await work;
    expect(check()).toEqual({ complete: true, reasons: [] });
  });

  it("celowy zasiew zadeklarowany w korzeniu (`post-layout-settings`)", () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    qc.setQueryData(["post-layout-settings"], { gap: 1 }, { updatedAt: 0 });
    markDeliberateSeed(qc, ["post-layout-settings"]);
    expect(check().complete).toBe(true);
  });

  it("dekoracja: błąd albo brak danych reklamy nie blokuje zapisu", async () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    await qc
      .fetchQuery({
        queryKey: ["ad_placements", "header_banner", "home", null],
        queryFn: async () => {
          throw new Error("ads down");
        },
      })
      .catch(() => undefined);
    void qc.prefetchQuery({
      queryKey: ["ad_placements", "sidebar", "home", null],
      queryFn: () => new Promise<string[]>(() => {}),
    });
    expect(check().complete).toBe(true);
  });

  it("obserwator renderu, który na serwerze nie pobiera (`useQuery` bez suspense)", () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    qc.getQueryCache().build(qc, { queryKey: ["profile-first-name", "anon"] });
    expect(check().complete).toBe(true);
  });

  it("zapytanie loadera zamiecione przed renderem i nieponowione nie jest zgubionymi danymi", async () => {
    const qc = client();
    // Faza loaderów: rozgrzewka widgetu, którego bramka renderu nie ponowi
    // (niewidoczny na tym urządzeniu), wciąż leci przy dehydratacji.
    void qc.prefetchQuery({
      queryKey: ["builder-post-list", "mobile-only"],
      queryFn: () => new Promise<string[]>(() => {}),
    });
    // Koniec loadera trasy: tu predykat jest uzbrajany.
    const check = trackSsrQueryCompleteness(qc);
    sweepQueryCacheForSerialization(qc, { quiet: true });
    await settle();
    expect(qc.getQueryState(["builder-post-list", "mobile-only"])).toBeUndefined();
    expect(check().complete).toBe(true);
  });

  it("zapytanie zamiecione przed renderem i POWTÓRZONE przez bramkę z sukcesem", async () => {
    const qc = client();
    const key = ["menu-with-items", "main"];
    const check = trackSsrQueryCompleteness(qc);
    // Ogon loadera korzenia: rozgrzewka chrome'u startuje po uzbrojeniu.
    void qc.prefetchQuery({ queryKey: key, queryFn: () => new Promise<string[]>(() => {}) });
    sweepQueryCacheForSerialization(qc, { quiet: true });
    await settle();
    expect(qc.getQueryState(key)).toBeUndefined();
    // Bramka chrome'u w renderze pobiera ponownie i dostaje dane.
    await qc.prefetchQuery({ queryKey: key, queryFn: async () => ["nawigacja"] });
    expect(check().complete).toBe(true);
  });
});

describe("zamrożenie werdyktu przed sprzątaniem integracji router<->query", () => {
  it("werdykt kompletny przeżywa `clear()`, a `clear()` nadal czyści cache", async () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    await qc.prefetchQuery({ queryKey: ["builder-post-list", 1], queryFn: async () => ["wpis"] });
    // Kolejność `serverSsr.cleanup()`: anulowanie, potem czyszczenie.
    await qc.cancelQueries();
    qc.clear();
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    // Bez zamrożenia pobrane zapytanie „zniknęłoby" i wyglądało na zgubione.
    expect(check()).toEqual({ complete: true, reasons: [] });
  });

  it("werdykt niekompletny też przeżywa `clear()`", () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    qc.setQueryData(["public", "home-mode"], "", { updatedAt: 0 });
    qc.clear();
    expect(check()).toEqual({ complete: false, reasons: ["seed:public.home-mode"] });
  });

  it("zdarzenia po zamrożeniu nie zmieniają werdyktu", async () => {
    const qc = client();
    const check = trackSsrQueryCompleteness(qc);
    qc.clear();
    qc.setQueryData(["site_settings"], {}, { updatedAt: 0 });
    await qc.prefetchQuery({ queryKey: ["x"], queryFn: async () => 1 });
    expect(check().complete).toBe(true);
  });
});

describe("queryLabel - etykieta do logu bez wartości", () => {
  it.each([
    [["public", "home-page"], "public.home-page"],
    [["header_ticker", "trending", 7, 8, null], "header_ticker.trending"],
    [["builder-post-list", { limit: 6, slug: "tajne" }], "builder-post-list"],
    [["menu-with-items", "main", "extra"], "menu-with-items.main"],
    [[{ only: "object" }], "query"],
    [['zły klucz "z cudzysłowem"'], "zykluczzcudzysowem"],
  ])("%j -> %s", (key, label) => {
    expect(queryLabel(key)).toBe(label);
  });
});
