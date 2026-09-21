// SONDA BOOTU - kontrakt skryptu, który jest STRINGIEM, a nie modułem.
//
// PO CO TESTOWAĆ STRING. Ten skrypt jedzie do `<head>` jako klasyczny, inline'owy
// `<script>` i jest PIERWSZĄ rzeczą wykonywaną w dokumencie - właśnie dlatego,
// że musi przeżyć rzut w chunku vendorowym, którego żaden handler zainstalowany
// z modułu nie zobaczy (awaria 2026-07-20: boot padał PRZED `hydrateRoot`,
// strona zostawała statycznym SSR-em bez żadnego objawu). Skoro nie jest modułem,
// nic go nie typuje i nic nie sprawdza - jedyny sposób to WYKONAĆ go i zmierzyć
// skutki, dokładnie tak jak zrobi to przeglądarka.
//
// Trzy rzeczy są tu przedmiotem dowodu, każda z ceną awarii:
//   1. skrypt NIGDY nie rzuca - rzut w `<head>` wywróciłby cały dokument, więc
//      byłby lekiem gorszym od choroby;
//   2. bufor jest OGRANICZONY - pętla rzucająca w każdej klatce nie może zjeść
//      pamięci karty, którą sonda ma zdiagnozować;
//   3. sonda NIE DOTYKA SIECI ANI STORAGE - bufor, który nie opuszcza strony,
//      nie jest przetwarzaniem danych, i tylko dlatego wolno jej działać PRZED
//      bramką zgody analitycznej.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOOT_DEAD_TIMEOUT_MS,
  BOOT_ERROR_BUFFER_LIMIT,
  BOOT_PROBE_SCRIPT,
} from "../bootProbeScript";

/**
 * BEZ WŁASNEGO TYPU I BEZ RZUTOWANIA. Kształt tego, co sonda zapisuje na
 * `window`, deklaruje `bootProbeScript.ts` przez `declare global` - ten sam
 * wzorzec, co `lib/watchdog/appReady.ts`. Lokalna kopia typu (z `as unknown as`)
 * mogłaby się od produkcyjnej rozjechać i test przechodziłby na własnym,
 * życzeniowym kształcie. Pola `m`/`s`/`f` są OPCJONALNE i asercje niżej to
 * respektują.
 */
function w(): Window {
  return window;
}

/**
 * Wykonuje sondę DOKŁADNIE tak, jak zrobi to przeglądarka: jako kod, nie import.
 *
 * UWAGA O AKUMULACJI: sonda instaluje nasłuchy anonimowymi funkcjami, więc nie
 * da się ich odwiesić, a `window` jest w pliku testowym JEDNO. Kolejne
 * wywołania w kolejnych przypadkach dokładają więc kolejne nasłuchy i jedno
 * zdarzenie trafia do bufora wielokrotnie. W PRODUKCJI sonda wykonuje się RAZ
 * na dokument, więc to jest artefakt testu, nie zachowanie - dlatego asercje
 * niżej mierzą TREŚĆ wpisów, a nie ich dokładną liczbę. Wyjątkiem jest limit
 * bufora, który obowiązuje niezależnie od liczby nasłuchów i dlatego jest
 * sprawdzany dokładnie.
 */
function runProbe(): void {
  new Function(BOOT_PROBE_SCRIPT)();
}

beforeEach(() => {
  delete w().__nesBootErrors;
  delete w().__nesBootT0;
  delete w().__nesBootDead;
  delete w().__nesAppReady;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BOOT_PROBE_SCRIPT", () => {
  it("instaluje bufor i znacznik czasu, nie rzucając", () => {
    expect(() => runProbe()).not.toThrow();
    expect(w().__nesBootErrors).toEqual([]);
    expect(typeof w().__nesBootT0).toBe("number");
  });

  it("łapie odrzuconą obietnicę bez `catch`", () => {
    runProbe();
    // `PromiseRejectionEvent` nie jest konstruowalny w happy-dom, więc składamy
    // zdarzenie tak, jak widzi je nasłuch: typ plus pole `reason`.
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    event.reason = new Error("odrzucone w boocie");
    window.dispatchEvent(event);
    const buffered = w().__nesBootErrors ?? [];
    expect(buffered.length).toBeGreaterThan(0);
    expect(buffered.every((e) => (e.m ?? "").includes("odrzucone w boocie"))).toBe(true);
  });

  it("łapie niewychwycony błąd okna", () => {
    runProbe();
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom w vendorze", filename: "/assets/vendor-x.js" }),
    );
    const buffered = w().__nesBootErrors ?? [];
    expect(buffered.length).toBeGreaterThan(0);
    expect(buffered.every((e) => (e.m ?? "").includes("boom w vendorze"))).toBe(true);
    expect(buffered.every((e) => e.f === "/assets/vendor-x.js")).toBe(true);
  });

  it("BUFOR JEST OGRANICZONY - pętla rzucająca nie zje pamięci karty", () => {
    runProbe();
    for (let i = 0; i < BOOT_ERROR_BUFFER_LIMIT + 25; i += 1) {
      window.dispatchEvent(new ErrorEvent("error", { message: `blad ${i}` }));
    }
    expect(w().__nesBootErrors).toHaveLength(BOOT_ERROR_BUFFER_LIMIT);
  });

  it("oznacza MARTWY BOOT, gdy flaga gotowości nie przyjdzie w budżecie", () => {
    // To jest sygnał POZYTYWNY: pozwala odróżnić „wolno" od „nie ożyło".
    // Przed 2026-09-01 nie dawało się tego odróżnić niczym.
    vi.useFakeTimers();
    runProbe();
    vi.advanceTimersByTime(BOOT_DEAD_TIMEOUT_MS - 1);
    expect(w().__nesBootDead).toBeUndefined();
    vi.advanceTimersByTime(2);
    expect(typeof w().__nesBootDead).toBe("number");
  });

  it("NIE oznacza martwego bootu, gdy aplikacja zgłosiła gotowość", () => {
    vi.useFakeTimers();
    runProbe();
    w().__nesAppReady = true;
    vi.advanceTimersByTime(BOOT_DEAD_TIMEOUT_MS + 100);
    expect(w().__nesBootDead).toBeUndefined();
  });

  it("nie dotyka sieci ani storage - wysyłka jest za bramką zgody, nie tutaj", () => {
    // Sonda działa PRZED zgodą analityczną, więc gdyby cokolwiek wysyłała albo
    // zapisywała, byłaby przetwarzaniem danych bez podstawy. Dowód po treści
    // skryptu, bo happy-dom i tak nie wykonałby żądania.
    for (const forbidden of ["fetch", "sendBeacon", "XMLHttpRequest", "localStorage", "cookie"]) {
      expect(BOOT_PROBE_SCRIPT, `sonda dotyka ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("jest KLASYCZNYM skryptem - żadnej składni modułowej", () => {
    // `type="module"` odroczyłoby wykonanie do momentu po parsowaniu dokumentu
    // i sonda przestałaby łapać awarię, dla której istnieje.
    expect(BOOT_PROBE_SCRIPT).not.toMatch(/\bimport\b|\bexport\b/);
    // Jedno IIFE, wszystko w try - doktryna `lib/theme/themeInitScript.ts`.
    expect(BOOT_PROBE_SCRIPT.startsWith("(function(){try{")).toBe(true);
  });
});
