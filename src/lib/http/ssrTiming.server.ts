// Telemetria potoku SSR per żądanie (server-only): liczba i łączny czas
// round-tripów do Supabase wykonanych podczas renderu dokumentu.
//
// Zasilanie: `fetchWithTenantHost` (wspólny fetch klienta anon - plan, którym
// idą wszystkie loadery tras publicznych) raportuje tu czas każdego wywołania.
// Odczyt: `documentCacheMiddleware` po rozstrzygnięciu `next()` dokleja wynik
// do nagłówka `Server-Timing` (`db;dur=...;desc="n=..."`), obok czasu samego
// renderu (`ssr;dur=...` - patrz czysty moduł `ssrTiming.ts`). Przeglądarka
// wystawia Server-Timing w PerformanceResourceTiming, więc istniejący RUM może
// korelować TTFB z kosztem bazy bez żadnej dodatkowej infrastruktury.
//
// Zakres świadomie ograniczony do planu anon: zapytania service-role
// (supabaseAdmin - redirecty, server functions chrome) idą własnym klientem
// spoza tego fetcha. Dominujący koszt renderu publicznego to plan anon, a
// mieszanie obu planów w jednej liczbie zaciemniłoby odczyt.
//
// Klucz kontekstu: obiekt Request żądania (przez AsyncLocalStorage TanStack
// Start), w WeakMap - zero wycieków między żądaniami, zero globalnego stanu
// współdzielonego, brak wpływu na współbieżne rendery.
//
// UWAGA importowa: ten moduł statycznie dotyka `@tanstack/react-start/server`,
// więc każdy konsument osiągalny w grafie klienta (documentCache.server przez
// start.ts, tenant-host-fetch) MUSI go ładować dynamicznie za bramką
// `import.meta.env.SSR` - inaczej import-protection zatrzyma build klienta.
import { getRequest } from "@tanstack/react-start/server";

import type { SsrDbTiming, SsrPhaseTiming } from "./ssrTiming";

const timings = new WeakMap<Request, SsrDbTiming>();
/**
 * Fazy potoku mierzone zegarem ściennym, per żądanie.
 *
 * KLUCZ JEST JAWNYM `Request`, nie `getRequest()` - i to nie jest kosmetyka.
 * Faza, o którą tu chodzi (`edge-routing`), biegnie w MIDDLEWARE, czyli
 * w miejscu, w którym kontekst żądania TanStack Start jest dostępny, ale
 * wołający i tak trzyma obiekt `Request` w ręku. Przekazanie go wprost zdejmuje
 * jedyne pytanie, które mogłoby uczynić tę telemetrię cicho pustą: „czy to na
 * pewno ten sam obiekt, którego szuka odczyt".
 */
const phases = new WeakMap<Request, SsrPhaseTiming[]>();

/** Ile faz wolno zapamiętać per żądanie - bezpiecznik przed pętlą w wołającym. */
const PHASE_LIMIT = 8;

function activeRequest(): Request | null {
  try {
    return getRequest() ?? null;
  } catch {
    return null;
  }
}

/** Doliczyć jeden round-trip DB do telemetrii bieżącego żądania. */
export function recordDbRoundTrip(durationMs: number): void {
  // A clock correction or invalid sample must not poison this request's sum.
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const request = activeRequest();
  if (!request) return;
  const entry = timings.get(request);
  if (entry) {
    entry.count += 1;
    entry.totalMs += durationMs;
    return;
  }
  timings.set(request, { count: 1, totalMs: durationMs });
}

/** Migawka telemetrii DB dla danego żądania (null, gdy nic nie zmierzono). */
export function readDbTiming(request: Request): SsrDbTiming | null {
  const entry = timings.get(request);
  if (!entry) return null;
  return { count: entry.count, totalMs: entry.totalMs };
}

/**
 * Dolicz fazę potoku (czas ŚCIENNY) do telemetrii danego żądania. Powtórzone
 * wywołanie z tą samą nazwą SUMUJE - faza może biec w kilku odcinkach.
 * Nigdy nie rzuca: telemetria nie może zerwać potoku dokumentu.
 */
export function recordRequestPhase(request: Request, name: string, durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const list = phases.get(request);
  if (!list) {
    phases.set(request, [{ name, durationMs }]);
    return;
  }
  const existing = list.find((phase) => phase.name === name);
  if (existing) {
    existing.durationMs += durationMs;
    return;
  }
  if (list.length >= PHASE_LIMIT) return;
  list.push({ name, durationMs });
}

/** Migawka faz danego żądania (pusta tablica, gdy nic nie zmierzono). */
export function readRequestPhases(request: Request): SsrPhaseTiming[] {
  return (phases.get(request) ?? []).map((phase) => ({ ...phase }));
}
