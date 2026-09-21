// Odporne ładowanie danych w loaderze trasy - JEDEN prymityw zamiast doktryny
// przepisywanej ręcznie w każdej trasie.
//
// PROBLEM (potwierdzony empirycznie). Trasa, której loader robi gołe
// `await ensureQueryData(...)`, zamienia KAŻDY blip backendu w twarde HTTP 500:
//
//   ensureQueryData rzuca (błąd PostgREST albo anulowanie przez watchdoga SSR
//   po SSR_QUERY_TIMEOUT_MS) -> loader rzuca -> Start ustawia status 500.
//
// Dokument bywa przy tym w pełni wyrenderowany (errorComponent trasy), ale
// status 500 niesie realne skutki: CDN nie zapisze odpowiedzi, monitory
// raportują serwis jako offline, a crawler traktuje stronę jak awarię serwera
// i wypada ona z indeksu. Zmierzone przed tą zmianą (backend niedostępny):
// /experts, /events, /live, /podcasts, /programs, /web-stories, /author/$slug
// -> 500. Strona główna, /blog i /tracker przeżywały, bo miały tę samą logikę
// wklejoną ręcznie.
//
// DOKTRYNA (wcześniej powielana w index.tsx, blog.index.tsx, tracker.index.tsx):
//   1. BUDŻET krótszy niż watchdog SSR - loader oddaje sterowanie SAM, zanim
//      watchdog anuluje zapytanie i zamieni je w rzut.
//   2. ANULOWANIE spóźnionego fetcha PRZED zasiewem fallbacku. Gdyby rozstrzygnął
//      się między renderem a dehydracją, klient hydratowałby się z innymi danymi
//      niż HTML serwera, a React 19 odpowiada na to przebudową całego drzewa.
//   3. ZASIEW fallbacku z `updatedAt: 0` - dane są natychmiast przeterminowane,
//      więc przeglądarka refetchuje po zamontowaniu i strona sama się leczy,
//      gdy backend wróci. Komponent z `useSuspenseQuery` widzi stan `success`,
//      więc nie rzuca w fazie renderu.
//   4. Sygnał `degraded` w górę - wywołujący MUSI zdjąć nagłówek cache'a
//      wspólnego (patrz `resilientCacheControl`), żeby zdegradowany render nie
//      trafił na brzeg i nie był serwowany kolejnym czytelnikom.
//
// Prymityw jest izomorficzny (żadnych importów server-only), więc te same trasy
// używają go też przy nawigacji po stronie klienta - ale BUDŻET CZASOWY
// obowiązuje WYŁĄCZNIE na serwerze.
//
// DLACZEGO BUDŻET NIE MA PRAWA DZIAŁAĆ W PRZEGLĄDARCE (recenzja PR #382, P1).
// Punkty 1-4 opisują wymianę opłacalną w SSR: render i tak musi skończyć się
// przed watchdogiem, a zasiew sam się leczy refetchem po hydratacji. Przy
// nawigacji SPA ta sama wymiana jest czystą stratą, bo znikają OBA warunki:
// nie ma TTFB do obrony (czytelnik patrzy na `pendingComponent` routera),
// a WYNIK LOADERA JEST NIEZMIENNY przez całe życie dopasowania trasy. Zwykły
// fetch, który przekroczył budżet - 1,5 s na łączu mobilnym wystarczy -
// zostawiał więc komponentowi `degraded: true` NA STAŁE: strona pokazywała
// komunikat awarii, choć to samo zapytanie dociągało prawdziwe dane sekundę
// później, a czytelnik wychodził z fałszywej awarii dopiero kolejną nawigacją
// albo przeładowaniem.
//
// W przeglądarce loader po prostu CZEKA na zapytanie, a degradacja zostaje
// zarezerwowana dla BŁĘDU - fallback i `degraded: true` po odrzuceniu działają
// tam bez zmian, bo komunikat awarii po realnej awarii jest prawdą.
import type { EnsureQueryDataOptions, QueryClient, QueryKey } from "@tanstack/react-query";

import { withBudget } from "@/lib/asyncBudget";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";
import { isSsrRequest } from "@/lib/ssr/isSsrRequest";

/**
 * Domyślny budżet loadera. Świadomie NIŻSZY niż `SSR_QUERY_TIMEOUT_MS` (5 s):
 * loader ma zdążyć zdegradować się sam, zanim watchdog anuluje zapytanie
 * i `ensureQueryData` odrzuci obietnicę. Zgodny z budżetami, które trasy
 * dobierały wcześniej ręcznie (blog/tracker: 4 s).
 */
export const RESILIENT_LOAD_BUDGET_MS = 4_000;

/** Wynik odpornego ładowania: dane zawsze są, `degraded` mówi czy prawdziwe. */
export interface ResilientLoad<TData> {
  /** Dane z backendu albo fallback - nigdy `undefined`. */
  readonly data: TData;
  /** `true` = render powstał na fallbacku i NIE nadaje się do wspólnego cache'a. */
  readonly degraded: boolean;
}

export interface ResilientLoadOptions {
  /** Budżet oczekiwania w ms (TYLKO SSR). Domyślnie `RESILIENT_LOAD_BUDGET_MS`. */
  readonly budgetMs?: number;
  /**
   * Absolute request deadline. Consecutive phases share the remaining time.
   * Jak `budgetMs` liczy się WYŁĄCZNIE na serwerze - w przeglądarce jest
   * ignorowany, więc wołający nie musi już bramkować go pod `isServer`.
   */
  readonly deadlineAt?: number;
  /** Etykieta do logu diagnostycznego (domyślnie serializowany klucz zapytania). */
  readonly label?: string;
}

function keyLabel(queryKey: QueryKey): string {
  try {
    return JSON.stringify(queryKey);
  } catch {
    return String(queryKey);
  }
}

/**
 * Rozgrzewa zapytanie i NIGDY nie rzuca. Gdy backend zwrócił błąd - a na
 * SERWERZE także wtedy, gdy dane nie dojechały w budżecie - anuluje spóźniony
 * fetch i zasiewa `fallback`, żeby `useSuspenseQuery` w komponencie zobaczył
 * stan `success`.
 *
 * W przeglądarce budżetu NIE MA (patrz nagłówek pliku): loader czeka na
 * zapytanie, bo jego wynik jest niezmienny i „spóźniony" fetch zamarzłby jako
 * fałszywa awaria.
 *
 * Zwraca dane i informację, czy render jest zdegradowany.
 */
export async function loadResilient<
  TQueryFnData,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryClient: QueryClient,
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  fallback: TData,
  { budgetMs = RESILIENT_LOAD_BUDGET_MS, deadlineAt, label }: ResilientLoadOptions = {},
): Promise<ResilientLoad<TData>> {
  const queryKey = options.queryKey;

  // `.then(noop, noop)` PRZED budżetem: `withBudget` z założenia dostaje
  // obietnicę, która już nie odrzuca - inaczej odrzucenie po wygaśnięciu
  // budżetu byłoby nieobsłużone i wywróciłoby proces renderu. Na obu ścieżkach
  // pochłonięty błąd wraca potem przez STAN zapytania, nie przez rzut.
  if (!isSsrRequest()) {
    // PRZEGLĄDARKA: żadnego wyścigu z zegarem (patrz nagłówek pliku). Powolny
    // fetch ma po prostu dojechać - wynik loadera jest niezmienny, więc
    // degradacja z powodu czasu zamarzłaby jako fałszywy komunikat awarii.
    await queryClient.ensureQueryData(options).then(noop, noop);
  } else {
    const remaining =
      deadlineAt === undefined ? budgetMs : Math.min(budgetMs, deadlineAt - Date.now());
    // withBudget(0) means UNBOUNDED, not expired. Do not even start a new
    // upstream request when the caller's absolute deadline has already elapsed.
    if (deadlineAt === undefined || remaining > 0) {
      await withBudget(queryClient.ensureQueryData(options).then(noop, noop), remaining);
    }
  }

  const state = queryClient.getQueryState<TData, TError>(queryKey);
  if (state?.status === "success" && state.data !== undefined) {
    // Another parallel loader may have seeded this shared query. Empty data
    // from a successful backend response is valid; updatedAt=0 is the explicit
    // fallback contract, and must not silently become shared-cacheable.
    return { data: state.data, degraded: state.dataUpdatedAt === 0 };
  }

  // Anulowanie MUSI poprzedzać zasiew (patrz punkt 2. doktryny wyżej).
  await queryClient.cancelQueries({ queryKey, exact: true }).catch(noop);
  queryClient.setQueryData<TData>(queryKey, fallback, { updatedAt: 0 });

  console.warn(
    `[ssr-resilient] degraded render, seeded fallback for ${label ?? keyLabel(queryKey)}`,
  );
  return { data: fallback, degraded: true };
}

/**
 * Zbiorczy sygnał degradacji dla trasy ładującej KILKA zapytań.
 *
 * Zapytania odpalamy równolegle (`Promise.all([loadResilient(...), ...])`), więc
 * budżety biegną współbieżnie i N wolnych zapytań kosztuje tyle co jedno -
 * sekwencyjne `await` sumowałoby budżety i samo stałoby się źródłem wolnego
 * TTFB. Ta funkcja tylko składa wyniki w jedną decyzję o nagłówku cache'a.
 */
export function anyDegraded(...results: readonly ResilientLoad<unknown>[]): boolean {
  return results.some((result) => result.degraded);
}

/**
 * Nagłówek `Cache-Control` bramkowany czystością renderu - jedyne poprawne
 * domknięcie odpornego loadera.
 *
 * Render zdegradowany NIE MOŻE trafić do cache'a wspólnego: brzeg serwowałby
 * pustą powłokę kolejnym czytelnikom przez cały okres świeżości, długo po tym,
 * jak backend wrócił do zdrowia. `no-store` sprawia, że blip kosztuje jedno
 * żądanie, a nie okno cache'a.
 *
 * `cleanPolicy` pozwala trasie podać WŁASNĄ politykę czystego renderu. Domyślne
 * `contentCacheControl()` (s-maxage 900) jest poprawne dla archiwów i list, ale
 * NIE dla powierzchni „żywych": `/live` deklaruje w
 * `lib/http/defaultCacheControl.ts` świeżość w sekundach
 * (`liveCacheControl()`, s-maxage 30) i przed 2026-09-01 nadpisywał ją tutaj
 * na 900 - czytelnik relacji na żywo mógł dostać wpis sprzed 15 minut wbrew
 * deklaracji. Parametr jest wartością czystej polityki, nie nowym wariantem.
 */
export function resilientCacheControl(
  degraded: boolean,
  cleanPolicy: string = contentCacheControl(),
): string {
  return degraded ? cacheControlHeader({ cacheable: false }) : cleanPolicy;
}

function noop(): void {}
