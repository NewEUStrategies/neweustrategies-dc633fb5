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
// używają go też przy nawigacji po stronie klienta - tam budżet po prostu
// rzadko dochodzi do głosu.
import type { EnsureQueryDataOptions, QueryClient, QueryKey } from "@tanstack/react-query";

import { withBudget } from "@/lib/asyncBudget";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";

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
  /** Budżet oczekiwania w ms. Domyślnie `RESILIENT_LOAD_BUDGET_MS`. */
  readonly budgetMs?: number;
  /** Absolute request deadline. Consecutive phases share the remaining time. */
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
 * Rozgrzewa zapytanie pod budżetem i NIGDY nie rzuca. Gdy dane nie dojechały
 * na czas (albo backend zwrócił błąd), anuluje spóźniony fetch i zasiewa
 * `fallback`, żeby `useSuspenseQuery` w komponencie zobaczył stan `success`.
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

  // `.catch()` PRZED budżetem: `withBudget` z założenia dostaje obietnicę,
  // która już nie odrzuca - inaczej odrzucenie po wygaśnięciu budżetu byłoby
  // nieobsłużone i wywróciłoby proces renderu.
  const remaining =
    deadlineAt === undefined ? budgetMs : Math.min(budgetMs, deadlineAt - Date.now());
  // withBudget(0) means UNBOUNDED, not expired. Do not even start a new
  // upstream request when the caller's absolute deadline has already elapsed.
  if (deadlineAt === undefined || remaining > 0) {
    await withBudget(queryClient.ensureQueryData(options).then(noop, noop), remaining);
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
