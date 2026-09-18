// Czysta część telemetrii SSR (współdzielona przez grafy klienta i serwera):
// typy + budowa nagłówka Server-Timing. Część server-only (licznik round-tripów
// per żądanie na getRequest/WeakMap) żyje w `ssrTiming.server.ts` i jest
// ładowana WYŁĄCZNIE dynamicznie za bramką `import.meta.env.SSR` - statyczny
// import `@tanstack/react-start/server` z modułu osiągalnego w grafie klienta
// (documentCache.server -> start.ts) zatrzymuje build na import-protection.

export interface SsrDbTiming {
  /** Liczba round-tripów HTTP do PostgREST/RPC w trakcie renderu. */
  count: number;
  /** Suma czasów wszystkich round-tripów (ms). Równoległe fale się nakładają,
   *  więc to miara KOSZTU, nie latencji ściany zegara. */
  totalMs: number;
}

/**
 * Faza potoku żądania mierzona ZEGAREM ŚCIENNYM, nie kosztem.
 *
 * PO CO OSOBNY TYP OBOK `SsrDbTiming`. Dotychczasowe `db;dur` mierzy WYŁĄCZNIE
 * plan anon (wspólny fetch klienta publicznego) i WYŁĄCZNIE sumę kosztów, a
 * nie czas ścienny. Poza jego zasięgiem zostaje cały odcinek PRZED routerem:
 * katalog tenantów i indeks przekierowań idą planem service-role, SZEREGOWO
 * (host -> tenant, potem reguły) i - co najważniejsze - PRZED konsultacją
 * NES Edge Cache, więc nawet gorące trafienie w cache dokumentów nie ratuje
 * czytelnika przed tym czekaniem.
 *
 * Skutek praktyczny przed tą zmianą: przy TTFB p75 = 2,5-3,2 s na produkcji
 * nagłówek `Server-Timing` pozwalał odróżnić render (`ssr;dur`) od reszty
 * (`app;dur` z `src/server.ts`), ale NIE pozwalał powiedzieć, czy ta reszta
 * to odczyt routingu na zimnym izolacie, czy sama sieć. Diagnoza sprowadzała
 * się więc do zgadywania - a zlecenie wydania mówi wprost: „zprofiluj,
 * wyszukaj zapytania > 500 ms".
 */
export interface SsrPhaseTiming {
  /**
   * Nazwa metryki Server-Timing. MUSI być tokenem (litery, cyfry, `-`, `_`) -
   * wartość z niedozwolonym znakiem psuje parsowanie CAŁEGO nagłówka
   * w przeglądarce, więc `buildServerTimingValue` takie wpisy odrzuca.
   */
  name: string;
  /** Czas ŚCIENNY fazy w ms. */
  durationMs: number;
}

/** Token metryki Server-Timing wg RFC 7230 (podzbiór, bezpiecznie wąski). */
const METRIC_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * Zbuduj wartość nagłówka Server-Timing dla dokumentu SSR: status NES Edge
 * Cache + czas renderu + (jeśli zmierzono) koszt bazy + (na HIT/STALE) wiek
 * serwowanego wpisu. Czysta funkcja - testowalna bez Response.
 */
export function buildServerTimingValue(
  status: string,
  renderMs?: number,
  db?: SsrDbTiming | null,
  /** Wiek wpisu cache w ms (HIT/STALE) - `nes-age;dur=` dla korelacji RUM:
   *  bez niego nie da się odróżnić świeżego trafienia od dokumentu z końca
   *  okna SWR przy analizie regresji LCP. */
  cacheAgeMs?: number,
  /**
   * Fazy potoku zmierzone zegarem ściennym (dziś: `edge-routing`). Dopisywane
   * NA KOŃCU i pomijane, gdy pusta - kolejność istniejących metryk i kształt
   * nagłówka dla wołających sprzed tej zmiany zostają bajt w bajt te same.
   */
  phases?: readonly SsrPhaseTiming[] | null,
): string {
  const parts = [`nes-edge;desc="${status}"`];
  if (typeof renderMs === "number" && Number.isFinite(renderMs) && renderMs >= 0) {
    parts.push(`ssr;dur=${renderMs.toFixed(1)}`);
  }
  if (
    db &&
    Number.isSafeInteger(db.count) &&
    db.count > 0 &&
    Number.isFinite(db.totalMs) &&
    db.totalMs >= 0
  ) {
    parts.push(`db;dur=${db.totalMs.toFixed(1)};desc="n=${db.count}"`);
  }
  if (typeof cacheAgeMs === "number" && Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0) {
    parts.push(`nes-age;dur=${Math.round(cacheAgeMs)}`);
  }
  for (const phase of phases ?? []) {
    // Nazwa spoza tokenu psuje parsowanie CAŁEGO nagłówka, więc pomijamy wpis
    // zamiast wypuścić go „jakoś" - telemetria nie może zepsuć diagnostyki,
    // której służy.
    if (!METRIC_NAME_RE.test(phase.name)) continue;
    if (!Number.isFinite(phase.durationMs) || phase.durationMs < 0) continue;
    parts.push(`${phase.name};dur=${phase.durationMs.toFixed(1)}`);
  }
  return parts.join(", ");
}
