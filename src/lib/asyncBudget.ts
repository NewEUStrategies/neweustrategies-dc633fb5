// Cap a best-effort async task by a wall-clock budget. Never rejects: the work
// is expected to already be internally allSettled/try/catched, so a budget
// race can never surface an unhandled error into an SSR loader chain.
//
// Shared between the builder-widget prefetch (aboveFold, cached route) and the
// content-loader `/$`/`category`/`author` prefetches so a single slow upstream
// (blocks_data, related config, ...) cannot hang a public SSR response.
export function withBudget(work: Promise<unknown>, ms: number, deadlineAt?: number): Promise<void> {
  if (deadlineAt !== undefined) {
    ms = Math.min(ms, deadlineAt - Date.now());
    if (ms <= 0) {
      void work.then(noop, noop);
      return Promise.resolve();
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) return work.then(noop, noop);
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    unrefTimer(timer);
    work.then(finish, finish);
  });
}

function noop() {}

/**
 * Zdejmij uchwyt zegara z licznika żywotności procesu, jeśli runtime to
 * wspiera. JEDNO miejsce z rzutowaniem w tym module i jedyne, jakie tu jest
 * potrzebne: `setTimeout` ma dwa różne typy zwrotu (`number` w lib.dom,
 * `NodeJS.Timeout` w Node) i tylko ten drugi zna `unref`. To jest REALNA
 * granica typów izomorficznego kodu, a nie obejście - i dlatego stoi raz,
 * a nie przy każdym `setTimeout` w pliku.
 */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = timer as unknown as { unref?: () => void };
  if (typeof maybeUnref.unref === "function") maybeUnref.unref();
}

/**
 * WARTOŚĆ POD TERMINEM - wariant `withBudget` dla wywołań, których WYNIK jest
 * potrzebny, a nie tylko ich rozgrzewający efekt uboczny.
 *
 * PO CO OSOBNA FUNKCJA. `withBudget` rozstrzyga się na `void`: nadaje się do
 * prefetchu, którego produktem jest wpis w cache'u zapytań, ale nie do
 * round-tripu, z którego wołający czyta wiersze. Płaszczyzna roli serwisowej
 * przed routerem (katalog tenantów, indeks przekierowań) to dokładnie ten drugi
 * przypadek - i do 2026-09-12 nie miała terminu W OGÓLE: `try/catch` broni przed
 * BŁĘDEM, nie przed POWOLNOŚCIĄ. Zawieszone połączenie nie rzuca; ono czeka -
 * a czeka PRZED `documentCacheMiddleware`, więc nawet trafienie w gorący wpis
 * nie ratuje czytelnika przed tym czekaniem.
 *
 * KONTRAKT, wprost:
 *   * budżet minął  -> `BUDGET_LAPSED` (spóźniona praca biegnie dalej, a jej
 *     ewentualne późne odrzucenie jest tu pochłaniane - żadnych unhandled
 *     rejections w potoku SSR);
 *   * praca odrzuciła PRZED budżetem -> ta obietnica odrzuca tym samym błędem,
 *     żeby istniejące `try/catch` wołającego zadziałało jak dotychczas;
 *   * `ms <= 0` albo nieskończone -> BRAK terminu (ta sama konwencja co
 *     `withBudget`: zero znaczy „bez ograniczenia", nie „już minęło").
 */
export const BUDGET_LAPSED: unique symbol = Symbol("nes.budget-lapsed");

export function settleWithinBudget<T>(
  work: PromiseLike<T>,
  ms: number,
): Promise<T | typeof BUDGET_LAPSED> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(work);
  return new Promise<T | typeof BUDGET_LAPSED>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(BUDGET_LAPSED);
    }, ms);
    unrefTimer(timer);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
