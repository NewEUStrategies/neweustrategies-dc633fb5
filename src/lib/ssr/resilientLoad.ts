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
import {
  hashKey,
  type EnsureQueryDataOptions,
  type QueryCacheNotifyEvent,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { withBudget } from "@/lib/asyncBudget";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";
import { noteDocumentDegradation, type DocumentCompleteness } from "@/lib/http/responseHeaders";
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
  // R7c: KTÓRY loader się zdegradował trafia do linii logu dokumentu
  // (`degradedBy`), a nie tylko do osobnej linii konsoli.
  if (import.meta.env.SSR) noteDocumentDegradation(label ?? queryLabel(queryKey));
  return { data: fallback, degraded: true };
}

// ── KOMPLETNOŚĆ DOKUMENTU NA KOŃCU STRUMIENIA (fala 3, P3.6b, R2a) ─────────────
//
// Zasiew z `updatedAt: 0` (wyżej) jest jedną z trzech dróg, którymi render
// gubi dane. Druga to zapytanie z błędem. Trzecia nie zostawia śladu w stanie
// końcowym: bramka sekcji (`ServerSectionGate`), której minął budżet, anuluje
// i USUWA swoje zapytania, a sekcja renderuje się bez danych - w stanie
// końcowym cache'u zapytania po prostu nie ma. Dlatego predykat śledzi
// zdarzenia `fetch` od chwili uzbrojenia: zapytanie pobierane po uzbrojeniu,
// którego na końcu nie ma albo które nie ma danych, to dane zgubione
// (`dropped`).
//
// KIEDY UZBROIĆ. Loader trasy uzbraja predykat na swoim KOŃCU. Pobrania
// z fazy loaderów i tak nie przeżywają dehydratacji: zamiatanie przed renderem
// (`lib/ssr/postRenderSweep.ts`) anuluje wszystko, co jeszcze leci, a bramki
// renderu pobierają ponownie to, czego potrzebują - i te pobrania predykat
// widzi. Gdyby uzbroić go wcześniej, zapytanie rozgrzane w loaderze dla widgetu
// niewidocznego na tym urządzeniu (bramka go nie ponawia) wyglądałoby na
// zgubione i blokowało zapis kompletnego dokumentu.
//
// KIEDY ODCZYTAĆ. Integracja router<->query (`@tanstack/router-ssr-query-core`)
// w `serverSsr.cleanup()` woła `queryClient.cancelQueries()` i
// `queryClient.clear()` ZARAZ po zamknięciu strumienia dokumentu - zanim
// kolektor zapisu NES Edge Cache przeczyta ostatni fragment. W chwili decyzji
// o zapisie cache zapytań jest więc pusty. Predykat zamraża werdykt w ostatnim
// momencie, w którym cache opisuje wyrenderowany dokument: tuż przed
// `QueryCache.clear()` tego żądania. Bez sprzątania (testy, przerwany potok)
// werdykt liczy się na żywo.
//
// Konserwatywnie: każde odstępstwo = brak zapisu (dokument idzie `degraded`
// i rusza odświeżenie w tle). Zbyt luźny predykat zamroziłby niekompletny
// dokument na 180 s świeżości i do doby STALE.

/**
 * Pierwsze elementy klucza zapytań DEKORACYJNYCH, których stan (zasiew, błąd,
 * brak) nie czyni dokumentu niekompletnym:
 *  - reklamy - doktryna korzenia (`routes/__root.tsx`, komentarz przy
 *    `headerAds`): „brak sprzedanej emisji kosztowałby cache CAŁEGO serwisu",
 *    więc klucz reklamy nie wchodzi też do listy gotowości chrome'u;
 *  - popupy buildera - nakładka spoza HTML-a SSR. Fala chrome korzenia (P3.8)
 *    zapisuje pod tym kluczem sygnał „brak aktywnych popupów": pustą listę
 *    z `updatedAt: 0`, żeby redakcja omijająca bramkę i tak pobrała pełną
 *    listę. To nie fallback awarii - bez tego wyjątku KAŻDY render `/` u
 *    najemcy bez popupów kończyłby się `seed:builder-popups-active` i strona
 *    główna nie trafiałaby do NES Edge Cache ani z przebiegu czytelnika, ani
 *    z odświeżenia w tle.
 */
const DECORATIVE_QUERY_ROOTS: ReadonlySet<string> = new Set([
  "ad_placements",
  WIDGET_QUERY_ROOTS.popupsActive,
]);

/**
 * Jawna lista CELOWYCH zasiewów żądania: klucze zasiane z `updatedAt: 0` nie
 * jako fallback awarii, tylko dla parytetu SSR/klienta (dziś
 * `post-layout-settings` w loaderze korzenia). Deklaruje je wołający w miejscu
 * zasiewu (`markDeliberateSeed`), więc wyjątek dotyczy wyłącznie tego, co
 * naprawdę zasiano w tym żądaniu.
 */
const deliberateSeeds = new WeakMap<QueryClient, Set<string>>();

/** Zadeklaruj celowy zasiew (`updatedAt: 0`), którego predykat kompletności nie liczy. */
export function markDeliberateSeed(queryClient: QueryClient, queryKey: QueryKey): void {
  let seeds = deliberateSeeds.get(queryClient);
  if (!seeds) {
    seeds = new Set<string>();
    deliberateSeeds.set(queryClient, seeds);
  }
  seeds.add(hashKey(queryKey));
}

/**
 * Krótka etykieta klucza do logu: najwyżej dwa WIODĄCE elementy tekstowe
 * (`["public","home-page"]` -> `public.home-page`), po oczyszczeniu do
 * `[A-Za-z0-9._-]` i 48 znaków. Odpada wszystko od pierwszego elementu
 * nietekstowego (obiekty parametrów, liczby, `null`) i wszystko po drugim
 * elemencie. Tekstowy DRUGI element przechodzi jednak bez zmian - także
 * identyfikator z adresu (`["public-profile","<handle>"]` ->
 * `public-profile.<handle>`). Dziś to slug ze ścieżki żądania, którą ta sama
 * linia logu i tak niesie w `path`; klucz z identyfikatorem spoza adresu
 * wymaga jawnej etykiety (`label` w `loadResilient`).
 */
export function queryLabel(queryKey: QueryKey): string {
  const parts: string[] = [];
  for (const part of queryKey) {
    if (typeof part !== "string" || parts.length === 2) break;
    parts.push(part);
  }
  return (
    parts
      .join(".")
      .replace(/[^A-Za-z0-9._-]/g, "")
      .slice(0, 48) || "query"
  );
}

function isDecorative(queryKey: QueryKey): boolean {
  const root = queryKey[0];
  return typeof root === "string" && DECORATIVE_QUERY_ROOTS.has(root);
}

/**
 * Uzbrój predykat kompletności dokumentu nad `QueryClient` żądania SSR
 * (opis wyżej). Zwraca predykat do `registerDocumentCompletenessCheck`.
 * Tylko serwer: w przeglądarce `QueryClient` żyje całą sesję.
 */
export function trackSsrQueryCompleteness(queryClient: QueryClient): () => DocumentCompleteness {
  const cache = queryClient.getQueryCache();
  const fetched = new Map<string, QueryKey>();
  let frozen: DocumentCompleteness | null = null;

  const unsubscribe = cache.subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type === "updated" && event.action.type === "fetch") {
      fetched.set(event.query.queryHash, event.query.queryKey);
    }
  });

  const evaluate = (): DocumentCompleteness => {
    const seeds = deliberateSeeds.get(queryClient);
    const reasons = new Set<string>();
    const present = new Set<string>();
    for (const query of cache.getAll()) {
      present.add(query.queryHash);
      if (isDecorative(query.queryKey)) continue;
      const { status, dataUpdatedAt, fetchStatus } = query.state;
      const label = queryLabel(query.queryKey);
      if (status === "error") reasons.add(`error:${label}`);
      else if (status === "success") {
        if (dataUpdatedAt <= 0 && !seeds?.has(query.queryHash)) reasons.add(`seed:${label}`);
      } else if (fetched.has(query.queryHash) || fetchStatus !== "idle") {
        // Pobierane w renderze (albo wciąż w locie), a bez danych na końcu.
        reasons.add(`dropped:${label}`);
      }
      // Pozostałe `pending` to obserwatory renderu, które na serwerze z założenia
      // nie pobierają (`useQuery` bez suspense) - nie są danymi tego dokumentu.
    }
    for (const [hash, queryKey] of fetched) {
      if (!present.has(hash) && !isDecorative(queryKey)) {
        reasons.add(`dropped:${queryLabel(queryKey)}`);
      }
    }
    return { complete: reasons.size === 0, reasons: [...reasons] };
  };

  const clear = cache.clear.bind(cache);
  cache.clear = () => {
    if (!frozen) {
      frozen = evaluate();
      unsubscribe();
    }
    clear();
  };

  return () => frozen ?? evaluate();
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
