// BUDŻET CZASOWY WOLNO EGZEKWOWAĆ WYŁĄCZNIE W RENDERZE SERWEROWYM.
//
// CO TU DOWODZIMY (recenzja PR #382, P1). `withBudget` ścina oczekiwanie
// zegarem, a wołający traktuje „nie ma danych po terminie" jak awarię: sieje
// fallback i podnosi `degraded`. W SSR to wymiana opłacalna - render i tak musi
// skończyć się przed watchdogiem zapytań, a zasiew z `updatedAt: 0` leczy się
// refetchem po hydratacji. Przy nawigacji SPA znikają OBA warunki: nie ma TTFB
// do obrony, a WYNIK LOADERA JEST NIEZMIENNY przez całe życie dopasowania
// trasy. Powolny - nie błędny - fetch zostawiał więc czytelnikowi komunikat
// awarii NA STAŁE, choć dane dociągały sekundę później.
//
// `withSsrBudget` domyka to dla loaderów, które zostały przy gołym
// `withBudget` (ich produktem jest sam zasiew cache'u, nie wartość zwrotna);
// dla `loadResilient` to samo rozstrzygnięcie stoi w `lib/ssr/resilientLoad.ts`.
//
// ŚRODOWISKO. Suita biegnie w happy-dom, gdzie `document` istnieje zawsze -
// czyli DOMYŚLNIE jesteśmy w przeglądarce. Ścieżkę serwerową modeluje stub
// globalu, bo `isSsrRequest()` liczy `typeof document` PRZY KAŻDYM WYWOŁANIU
// (`lib/ssr/isSsrRequest.ts`), a nie raz przy imporcie.
import { afterEach, describe, expect, it, vi } from "vitest";

import { withBudget, withSsrBudget } from "@/lib/asyncBudget";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Przestaw JEDEN test na RENDER SERWEROWY - patrz nagłówek pliku. */
function renderOnServer(): void {
  vi.stubGlobal("document", undefined);
}

/** Obietnica rozstrzygająca się po `ms` na ZEGARZE TESTU (fake timers). */
function resolvesAfter(ms: number): Promise<string> {
  return new Promise<string>((resolve) => setTimeout(() => resolve("dane z backendu"), ms));
}

/** Czy obietnica jest już rozstrzygnięta - bez czekania na nią w teście. */
function settled(promise: Promise<unknown>): () => boolean {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
}

describe("withSsrBudget - serwer", () => {
  it("ucina oczekiwanie po `ms`, tak samo jak gołe `withBudget`", async () => {
    renderOnServer();
    vi.useFakeTimers();
    // Kanarek środowiska: bez niego przypadek przejechałby ścieżką
    // przeglądarki i „zielony" wynik nie mówiłby nic o kontrakcie SSR.
    expect(typeof document).toBe("undefined");

    const zwis = new Promise<void>(() => {});
    const done = settled(withSsrBudget(zwis, 30));

    await vi.advanceTimersByTimeAsync(29);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done(), "budżet SSR nie zadziałał - loader czekałby do watchdoga").toBe(true);
  });

  it("honoruje TERMIN ABSOLUTNY, który skraca budżet fazy", async () => {
    renderOnServer();
    vi.useFakeTimers();

    const zwis = new Promise<void>(() => {});
    const done = settled(withSsrBudget(zwis, 500, Date.now() + 40));

    await vi.advanceTimersByTimeAsync(39);
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
  });
});

describe("withSsrBudget - przeglądarka", () => {
  it("CZEKA na powolne zapytanie mimo budżetu 30 ms - wynik loadera jest niezmienny", async () => {
    vi.useFakeTimers();
    // Kontrola środowiska w drugą stronę: to jest ścieżka przeglądarki.
    expect(typeof document).not.toBe("undefined");

    const powolne = resolvesAfter(5_000);
    const done = settled(withSsrBudget(powolne, 30));

    // SEDNO: po terminie, który obowiązywałby w SSR, loader NADAL czeka.
    // Gdyby się tu rozstrzygnął, wołający zasiałby fallback i zamroził
    // `degraded: true` na całe życie dopasowania trasy.
    await vi.advanceTimersByTimeAsync(4_999);
    expect(done(), "budżet zadziałał w przeglądarce - to jest naprawiany defekt").toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(done()).toBe(true);
    await expect(powolne).resolves.toBe("dane z backendu");
  });

  it("KONTROLA POZYTYWNA: gołe `withBudget` w tym samym układzie ŚCINA po 30 ms", async () => {
    // Bez tej pary test wyżej dowodziłby tylko tego, że zegar testu działa -
    // różnicę robi PRYMITYW, a nie środowisko samo z siebie.
    vi.useFakeTimers();

    const done = settled(withBudget(resolvesAfter(5_000), 30));

    await vi.advanceTimersByTimeAsync(30);
    expect(done()).toBe(true);
  });

  it("degradacja przez BŁĄD zostaje - odrzucenie rozstrzyga od razu i nie wypływa", async () => {
    // Wyłączony jest BUDŻET, nie odporność: odrzucone zapytanie nadal kończy
    // fazę natychmiast, a wołający zobaczy pustkę w `getQueryData` i pójdzie
    // gałęzią fallbacku. Komunikat awarii po realnej awarii jest prawdą.
    const awaria = Promise.reject(new Error("test: backend odmówił"));

    await expect(withSsrBudget(awaria, 30)).resolves.toBeUndefined();
  });
});
