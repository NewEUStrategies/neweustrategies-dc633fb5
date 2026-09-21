import { isSsrRequest } from "@/lib/ssr/isSsrRequest";

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

/**
 * BUDŻET TYLKO W RENDERZE SERWEROWYM - `withBudget` bramkowany `isSsrRequest()`.
 *
 * DLACZEGO BUDŻET CZASOWY NIE MA PRAWA DZIAŁAĆ W PRZEGLĄDARCE (recenzja PR
 * #382, P1). Wynik loadera jest NIEZMIENNY przez całe życie dopasowania trasy:
 * router liczy go raz i nie przelicza, dopóki czytelnik nie odejdzie z trasy
 * albo nie przeładuje strony. Termin, który wygasa przy nawigacji SPA, zasiewa
 * więc fallback i `degraded: true` NA STAŁE - czytelnik zostaje z komunikatem
 * awarii, choć to samo zapytanie dociąga prawdziwe dane sekundę później
 * (1,5 s na łączu mobilnym w zupełności wystarczy). Na serwerze ta sama
 * wymiana jest opłacalna, bo render i tak musi skończyć się przed watchdogiem
 * zapytań SSR, a zasiew z `updatedAt: 0` leczy się refetchem po hydratacji.
 *
 * Degradacja przez BŁĄD zostaje na obu ścieżkach bez zmian: odrzucone
 * zapytanie oddaje pusty `getQueryData`, więc gałąź fallbacku nadal biegnie -
 * i słusznie, bo komunikat awarii po realnej awarii jest prawdą.
 *
 * To samo rozstrzygnięcie, tylko dla loaderów czytających WYNIK, siedzi
 * centralnie w `lib/ssr/resilientLoad.ts` (nagłówek pliku niesie pełny wykład).
 * Ten wariant jest dla wywołań, które zostały przy gołym `withBudget`, bo ich
 * produktem jest sam zasiew cache'u, a nie wartość zwrotna.
 *
 * W przeglądarce praca jest po prostu awaitowana - bez wyścigu z zegarem.
 * `.then(noop, noop)` zostaje, bo kontrakt całego modułu brzmi „nigdy nie
 * odrzuca": wołający przekazuje tu obietnicę z własnym `.catch`, ale pojedyncze
 * przeoczenie nie ma prawa wywrócić potoku renderu nieobsłużonym odrzuceniem.
 */
export function withSsrBudget(
  work: Promise<unknown>,
  ms: number,
  deadlineAt?: number,
): Promise<void> {
  if (isSsrRequest()) return withBudget(work, ms, deadlineAt);
  return work.then(noop, noop);
}
