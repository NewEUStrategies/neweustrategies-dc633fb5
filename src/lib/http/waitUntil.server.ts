// Praca "za odpowiedzią" na Cloudflare Workers (server-only).
//
// Workerd może ubić izolat natychmiast po domknięciu odpowiedzi - każda
// obietnica pozostawiona jako `void promise` (log 404, dokładka wpisu do NES
// Edge Cache, bump wersji L2) bywa ucinana w połowie. Oficjalnym kontraktem
// na dokończenie takiej pracy jest `ctx.waitUntil`; od compatibility_date
// 2024-09-02 jest on dostępny bez przewlekania kontekstu przez cały stos jako
// eksport modułu wbudowanego `cloudflare:workers`.
//
// Moduł jest defensywny z konstrukcji:
//   - poza Workers (vite dev na Node, vitest, preview) importu `cloudflare:*`
//     nie da się rozwiązać - wtedy degradujemy do dzisiejszego zachowania
//     (fire-and-forget), które na długo żyjącym procesie Node jest poprawne;
//   - starszy runtime bez eksportu `waitUntil` również degraduje;
//   - `runAfterResponse` nigdy nie rzuca i nigdy nie zwraca odrzuconej
//     obietnicy - błąd pracy w tle nie może zerwać potoku SSR.
//
// `/* @vite-ignore */` jest konieczne: specyfikator `cloudflare:workers` ma
// istnieć wyłącznie w runtime workerd; bundler nie może próbować go
// rozwiązywać w czasie builda.

type WaitUntilFn = (promise: Promise<unknown>) => void;

let cachedWaitUntil: WaitUntilFn | null | undefined;

async function resolveWaitUntil(): Promise<WaitUntilFn | null> {
  if (cachedWaitUntil !== undefined) return cachedWaitUntil;
  try {
    const specifier = "cloudflare:workers";
    const mod = (await import(/* @vite-ignore */ specifier)) as { waitUntil?: unknown };
    cachedWaitUntil = typeof mod.waitUntil === "function" ? (mod.waitUntil as WaitUntilFn) : null;
  } catch {
    cachedWaitUntil = null;
  }
  return cachedWaitUntil;
}

/**
 * Zarejestruj pracę, która ma się dokończyć po wysłaniu odpowiedzi. Na
 * Workers deleguje do `ctx.waitUntil` (runtime trzyma izolat przy życiu do
 * rozstrzygnięcia obietnicy); poza Workers degraduje do fire-and-forget.
 * Zawsze bezpieczne do wywołania z middleware - nie rzuca i nie blokuje.
 */
export function runAfterResponse(work: Promise<unknown>): void {
  // Obietnica ma połknięty błąd ZANIM trafi do waitUntil - odrzucenie wewnątrz
  // waitUntil jest raportowane jako błąd żądania, a praca w tle jest u nas
  // zawsze best-effort.
  const settled = work.catch(() => undefined);
  void resolveWaitUntil().then((waitUntil) => {
    if (waitUntil) waitUntil(settled);
    // Bez waitUntil: `settled` już biegnie samodzielnie (fire-and-forget).
  });
}
