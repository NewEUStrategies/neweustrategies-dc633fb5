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
): string {
  const parts = [`nes-edge;desc="${status}"`];
  if (typeof renderMs === "number" && Number.isFinite(renderMs)) {
    parts.push(`ssr;dur=${renderMs.toFixed(1)}`);
  }
  if (db && db.count > 0) {
    parts.push(`db;dur=${db.totalMs.toFixed(1)};desc="n=${db.count}"`);
  }
  if (typeof cacheAgeMs === "number" && Number.isFinite(cacheAgeMs) && cacheAgeMs >= 0) {
    parts.push(`nes-age;dur=${Math.round(cacheAgeMs)}`);
  }
  return parts.join(", ");
}
