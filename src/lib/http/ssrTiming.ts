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

// ── Log dokumentu do Workers Logs (audyt 0.1 / F40) ─────────────────────────
//
// Warstwa hostingu ZDEJMUJE `Server-Timing` i `x-nes-cache` z odpowiedzi
// wychodzącej, więc rozkład TTFB na fazy (start izolatu, routing krawędziowy,
// render, baza) i udział HIT/STALE/MISS/BYPASS w ruchu nie docierają ani do
// przeglądarki, ani do RUM. Jedynym miejscem, w którym te liczby przeżywają,
// jest strumień logów Workers - stąd jedna linia JSON per dokument HTML,
// budowana tu jako czysta funkcja, żeby jej kształt był testowalny bez
// runtime'u i żeby `src/server.ts` nie parsował nagłówka „na miejscu".

/** Jedna metryka nagłówka Server-Timing po sparsowaniu. */
export interface ServerTimingEntry {
  name: string;
  /** `dur=` w ms; brak, gdy metryka jest sama nazwą lub `dur` nie jest liczbą. */
  durationMs?: number;
  /** `desc=` bez cudzysłowów. */
  description?: string;
}

/**
 * Parser Server-Timing wystarczający dla nagłówków, które SAMI wystawiamy
 * (`buildServerTimingValue` + `server-init`/`app` z `src/server.ts`): metryki
 * po przecinku, parametry po średniku, `desc` w cudzysłowach. Przecinek
 * wewnątrz cudzysłowu nie rozcina metryki. Nigdy nie rzuca - wpis, którego nie
 * da się odczytać, jest pomijany, bo log nie może zerwać potoku dokumentu.
 */
export function parseServerTiming(header: string | null | undefined): ServerTimingEntry[] {
  if (!header) return [];
  const metrics: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      metrics.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  metrics.push(current);

  const out: ServerTimingEntry[] = [];
  for (const raw of metrics) {
    const [name, ...params] = raw.split(";").map((part) => part.trim());
    if (!name || !METRIC_NAME_RE.test(name)) continue;
    const entry: ServerTimingEntry = { name };
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq < 0) continue;
      const key = param.slice(0, eq).trim().toLowerCase();
      const value = param.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
      if (key === "dur") {
        const dur = Number.parseFloat(value);
        if (Number.isFinite(dur) && dur >= 0) entry.durationMs = dur;
      } else if (key === "desc") {
        entry.description = value;
      }
    }
    out.push(entry);
  }
  return out;
}

/** Linia logu dokumentu - klucze stałe, żeby zapytania w Workers Logs były proste. */
export interface DocumentLogLine {
  kind: "doc";
  /** Sama ścieżka: bez query string, bez hosta - zero PII i zero tokenów z `?`. */
  path: string;
  status: number;
  /** Status NES Edge Cache z `x-nes-cache` (HIT/STALE/MISS/BYPASS) albo null. */
  cache: string | null;
  /** Czy to syntetyczne odświeżenie wpisu w tle, a nie żądanie czytelnika. */
  revalidation: boolean;
  serverInitMs: number;
  appMs: number;
  edgeRoutingMs?: number;
  ssrMs?: number;
  dbMs?: number;
  dbCount?: number;
}

export interface DocumentLogInput {
  path: string;
  status: number;
  cacheStatus: string | null | undefined;
  /** Wartość nagłówka Server-Timing zbudowana przez potok routera. */
  serverTiming: string | null | undefined;
  serverInitMs: number;
  appMs: number;
  revalidation?: boolean;
}

/** Ścieżka w logu ma górny limit - URL od klienta może mieć kilobajty. */
const LOG_PATH_MAX = 2048;

/**
 * Zbuduj linię logu dokumentu. Fazy z Server-Timing są opcjonalne: brak
 * metryki = brak klucza (nie zero), żeby w logach dało się odróżnić „render
 * trwał 0 ms" od „tego żądania render nie dotyczył" (HIT z cache).
 * `dbCount` czyta `desc="n=18"` metryki `db` - kontrakt `buildServerTimingValue`.
 */
export function buildDocumentLogLine(input: DocumentLogInput): DocumentLogLine {
  const line: DocumentLogLine = {
    kind: "doc",
    path: input.path.slice(0, LOG_PATH_MAX),
    status: input.status,
    cache: input.cacheStatus || null,
    revalidation: input.revalidation === true,
    serverInitMs: safeMs(input.serverInitMs),
    appMs: safeMs(input.appMs),
  };
  for (const entry of parseServerTiming(input.serverTiming)) {
    if (entry.name === "edge-routing" && entry.durationMs !== undefined) {
      line.edgeRoutingMs = entry.durationMs;
    } else if (entry.name === "ssr" && entry.durationMs !== undefined) {
      line.ssrMs = entry.durationMs;
    } else if (entry.name === "db" && entry.durationMs !== undefined) {
      line.dbMs = entry.durationMs;
      const count = /^n=(\d+)$/.exec(entry.description ?? "");
      if (count) line.dbCount = Number.parseInt(count[1], 10);
    }
  }
  return line;
}

function safeMs(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
