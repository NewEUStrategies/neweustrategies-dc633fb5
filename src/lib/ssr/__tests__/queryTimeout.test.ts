// Strażnik czasu zapytań SSR - `installSsrQueryTimeout`.
//
// CO TO DOWODZI. Serializer trzyma odpowiedź HTTP otwartą, dopóki każde
// zapytanie fazy renderu się nie rozstrzygnie. JEDNO zapytanie, którego
// `queryFn` nigdy nie kończy (zawieszony upstream, obietnica, której nikt nie
// odrzuca, żądanie po cichu porzucone przez runtime), zamraża strumień
// w połowie payloadu: przeglądarka i crawler dostają HTTP 200 z UCIĘTYM
// HTML-em - bez `</html>`, bez skryptu hydracji. Ten moduł jest jedyną rzeczą,
// która ten stan przerywa, i miał 0% pokrycia.
//
// DWIE RZECZY MUSZĄ BYĆ SPRAWDZONE RAZEM:
//   1. ANULOWANIE - zawieszone zapytanie zostaje przerwane po `timeoutMs`
//      z `revert: true`, więc dehydratacja emituje ostatnie znane dane albo
//      stan pusty. Widget renderuje swój zwykły fallback, a klient dociąga po
//      hydracji: sekcja ZDEGRADOWANA zamiast martwej strony;
//   2. NIETYKALNOŚĆ ZDROWYCH ZAPYTAŃ - zapytanie, które zdążyło, NIE MOŻE być
//      anulowane. Fałszywe anulowanie jest gorsze niż brak strażnika: zabiera
//      dane, które już dojechały.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `isUnresolvableQuery` /
// `pruneUnresolvedQueries` mają własne testy; tutaj sprawdzamy DECYZJĘ
// strażnika i to, że sprzątanie jest w ogóle wołane. Zamykania samego
// strumienia dowodzi `queryStreamGuard.test.ts` - to inny moduł i inna warstwa.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installSsrQueryTimeout,
  SSR_PENDING_REPORT_MS,
  SSR_QUERY_TIMEOUT_MS,
} from "../queryTimeout";

let error: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
let qc: QueryClient;
let dispose: () => void;

/** Wszystkie komunikaty strażnika w jednym ciągu. */
function log(): string {
  return error.mock.calls.map((call) => String(call[0])).join("\n");
}

/** Zapytanie, które nigdy się nie rozstrzyga - zamraża strumień SSR. */
function hangingQuery(key: string): void {
  void qc
    .fetchQuery({ queryKey: [key], queryFn: () => new Promise(() => undefined) })
    .catch(() => undefined);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Data bazowa ustalona - strażnik działa wyłącznie na licznikach czasu.
  vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  error = vi.fn<(...args: unknown[]) => void>();
  vi.spyOn(console, "error").mockImplementation(error);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  dispose = () => undefined;
});

afterEach(() => {
  dispose();
  qc.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("stałe kontraktu", () => {
  it("limity są jawne i w rozsądnej relacji", () => {
    // Raport MUSI wypadać PO anulowaniu - inaczej opisywałby zapytania, które
    // strażnik zaraz i tak przerwie, i nie wskazywałby chronicznie wiszących.
    expect(SSR_QUERY_TIMEOUT_MS).toBe(5_000);
    expect(SSR_PENDING_REPORT_MS).toBe(8_000);
    expect(SSR_PENDING_REPORT_MS).toBeGreaterThan(SSR_QUERY_TIMEOUT_MS);
  });
});

describe("anulowanie zawieszonego zapytania", () => {
  it("po upływie limitu anuluje i loguje PEŁNY klucz", async () => {
    // Pełny klucz w logu jest jedyną drogą do zidentyfikowania wiszącego
    // zapytania bez lokalnego repro.
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 10_000 });
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(50);
    expect(log()).toBe("");

    await vi.advanceTimersByTimeAsync(100);
    expect(log()).toContain("query exceeded 100ms during SSR and was cancelled");
    expect(log()).toContain('["wisi"]');
  });

  it("anulowane zapytanie przestaje pobierać - strumień może się domknąć", async () => {
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 10_000 });
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(300);
    // To jest cały sens modułu: `isFetching()` musi spaść do zera, inaczej
    // serializer trzyma odpowiedź otwartą do końca życia żądania.
    expect(qc.isFetching()).toBe(0);
  });

  it("pierwsze pobranie zakończone anulowaniem jest USUWANE z cache", async () => {
    // `revert: true` na pierwszym pobraniu zostawia zapytanie w stanie
    // pending z nierozstrzygniętą obietnicą wewnętrzną - dokładnie tym, co
    // zatrzymuje seroval. Dlatego taki wpis musi wylecieć z cache.
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 10_000 });
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(300);
    expect(qc.getQueryCache().find({ queryKey: ["wisi"] })).toBeUndefined();
  });

  it("anuluje KAŻDE wiszące zapytanie, nie tylko pierwsze", async () => {
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 10_000 });
    hangingQuery("a");
    hangingQuery("b");
    hangingQuery("c");
    await vi.advanceTimersByTimeAsync(300);
    for (const key of ['["a"]', '["b"]', '["c"]']) {
      expect(log()).toContain(key);
    }
    expect(qc.isFetching()).toBe(0);
  });

  it("na to samo zapytanie zakłada JEDEN licznik", async () => {
    // Każde zdarzenie cache dla tego samego zapytania (obserwator, ponowienie
    // powiadomienia) nie może dokładać kolejnego licznika - inaczej ten sam
    // klucz byłby anulowany i logowany wielokrotnie.
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 10_000 });
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(10);
    // Wymuszamy dodatkowe zdarzenia na tym samym zapytaniu.
    qc.getQueryCache().notify({
      type: "updated",
      query: qc.getQueryCache().findAll()[0],
      action: { type: "fetch" },
    });
    await vi.advanceTimersByTimeAsync(300);
    const trafienia = log().split("query exceeded").length - 1;
    expect(trafienia).toBe(1);
  });
});

describe("zdrowe zapytania są nietykalne", () => {
  it("zapytanie, które zdążyło, NIE jest anulowane ani logowane", async () => {
    // Fałszywe anulowanie zabiera dane, które już dojechały - gorsze niż brak
    // strażnika.
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 200, reportMs: 10_000 });
    await qc.fetchQuery({ queryKey: ["szybkie"], queryFn: () => Promise.resolve("v") });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log()).toBe("");
    expect(qc.getQueryData(["szybkie"])).toBe("v");
  });

  it("licznik jest ZDEJMOWANY, gdy zapytanie przejdzie w bezczynność", async () => {
    // Bez tego zapytanie, które się rozstrzygnęło tuż przed limitem, zostałoby
    // anulowane po fakcie - i straciłoby dane.
    let rozwiaz: ((v: string) => void) | undefined;
    void qc
      .fetchQuery({
        queryKey: ["prawie"],
        queryFn: () => new Promise<string>((res) => (rozwiaz = res)),
      })
      .catch(() => undefined);
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 200, reportMs: 10_000 });
    await vi.advanceTimersByTimeAsync(150);
    rozwiaz?.("na czas");
    await vi.advanceTimersByTimeAsync(500);
    expect(log()).toBe("");
    expect(qc.getQueryData(["prawie"])).toBe("na czas");
  });

  it("zapytanie odrzucone nie jest anulowane - samo się rozstrzygnęło", async () => {
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 200, reportMs: 10_000 });
    await qc
      .fetchQuery({ queryKey: ["blad"], queryFn: () => Promise.reject(new Error("odmowa")) })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log()).not.toContain("query exceeded");
  });
});

describe("jednorazowy spis chronicznie wiszących", () => {
  it("raportuje to, co po czasie raportu NADAL pobiera", async () => {
    // Raport jest wyłącznie obserwacyjny - nigdy nie anuluje. Dlatego limit
    // anulowania jest tu ustawiony wysoko: interesuje nas sam spis.
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 10_000, reportMs: 200 });
    hangingQuery("chronicznie-wisi");
    await vi.advanceTimersByTimeAsync(400);
    expect(log()).toContain("still fetching after 200ms");
    expect(log()).toContain('["chronicznie-wisi"]');
    // NIE anulował - zapytanie nadal pobiera.
    expect(qc.isFetching()).toBe(1);
  });

  it("MILCZY, gdy nic nie wisi", async () => {
    // Raport przy zdrowym renderze byłby szumem w logach każdego żądania.
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 10_000, reportMs: 200 });
    await qc.fetchQuery({ queryKey: ["ok"], queryFn: () => Promise.resolve("v") });
    await vi.advanceTimersByTimeAsync(400);
    expect(log()).toBe("");
  });

  it("wypisuje WSZYSTKIE wiszące klucze w jednej linii", async () => {
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 10_000, reportMs: 200 });
    hangingQuery("a");
    hangingQuery("b");
    await vi.advanceTimersByTimeAsync(400);
    const linia = log()
      .split("\n")
      .find((l) => l.includes("still fetching"));
    expect(linia).toContain('["a"]');
    expect(linia).toContain('["b"]');
  });

  it("jest JEDNORAZOWY - nie powtarza się co interwał", async () => {
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 10_000, reportMs: 200 });
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(2_000);
    const trafienia = log().split("still fetching").length - 1;
    expect(trafienia).toBe(1);
  });
});

describe("wartości domyślne i sprzątanie", () => {
  it("bez opcji używa limitów z kontraktu", async () => {
    dispose = installSsrQueryTimeout(qc);
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(SSR_QUERY_TIMEOUT_MS - 1);
    expect(log()).toBe("");
    await vi.advanceTimersByTimeAsync(2);
    expect(log()).toContain(`query exceeded ${SSR_QUERY_TIMEOUT_MS}ms`);
  });

  it("sprzątaczka wyłącza strażnika - żaden licznik nie strzela po niej", async () => {
    // Strażnik jest per-żądanie. Niezdjęte liczniki anulowałyby zapytania
    // NASTĘPNEGO żądania w tym samym izolacie.
    const zdejmij = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 200 });
    hangingQuery("wisi");
    await vi.advanceTimersByTimeAsync(10);
    zdejmij();
    dispose = () => undefined;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(log()).toBe("");
    // Zapytanie nadal wisi - strażnika już nie ma, więc nikt go nie przerwał.
    expect(qc.isFetching()).toBe(1);
  });

  it("sprzątaczkę można wołać wielokrotnie bez skutków ubocznych", async () => {
    const zdejmij = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 200 });
    hangingQuery("wisi");
    zdejmij();
    expect(() => zdejmij()).not.toThrow();
    dispose = () => undefined;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log()).toBe("");
  });

  it("instalacja na PUSTYM kliencie nic nie robi i nie rzuca", async () => {
    dispose = installSsrQueryTimeout(qc, { timeoutMs: 100, reportMs: 200 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(log()).toBe("");
  });
});
