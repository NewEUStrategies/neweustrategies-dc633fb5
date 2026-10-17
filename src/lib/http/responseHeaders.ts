// Isomorphic, server-only response-header effects. createIsomorphicFn keeps the
// server-only `@tanstack/react-start/server` import out of the client bundle and
// makes these no-ops during client-side navigation (where there is no HTTP
// response to mutate).
//
// `Cache-Control` i `Link` z loaderów NIE idą przez stan pomocników odpowiedzi
// Start (`setResponseHeader`) - żyją wyłącznie w kanałach per `Request` niżej,
// a na drut nakłada je granica odpowiedzi (`fetchWithFrameworkPreloads`,
// `frameworkPreloads.server.ts`). Uzasadnienie przy `routeCacheDirectives`.
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { narrowestCacheControl } from "./cachePolicy";

/**
 * Intencja cache'owa TRASY per ŻĄDANIE - JEDYNY kanał decyzji loadera o cache'u.
 * Czytają go trzy miejsca: polityka zapisu NES Edge Cache W ŚRODKU łańcucha
 * (`defaultCacheControlMiddleware` -> `documentCacheMiddleware`), odroczony
 * zapis w `src/server.ts` (`applyDeferredDocumentStore`, druga kontrola na
 * końcu strumienia) i granica odpowiedzi, która nadaje wartość nagłówkowi na
 * drucie (`fetchWithFrameworkPreloads`).
 *
 * DLACZEGO NIE `setResponseHeader` (zainstalowane wersje, nie domysł). Od
 * TanStack Start 1.169 (`@tanstack/start-server-core` 1.169.43; 1.169.17 miał
 * jeszcze h3) stan pomocników odpowiedzi jest uzgadniany
 * z odpowiedzią na KAŻDEJ granicy request-middleware (`reconcileResponse`)
 * i przy wyjściu z potoku (`finalizeResponse`), dla KAŻDEGO statusu
 * (`applyResponseState` w `internal-request-response.ts` nie sprawdza `ok`),
 * a wartość pomocnika nadpisuje własny nagłówek odpowiedzi. Na tej drodze:
 *   - 503 crawlera (`crawlerUnavailableResponse`) i strona 500 z `errorMiddleware`
 *     traciłyby swoje `no-store` na rzecz publicznej dyrektywy loadera - strona
 *     błędu stawałaby się cache'owalna na CDN;
 *   - 404, błąd routera i przekierowania niosłyby `Cache-Control` i `Link` (preloady
 *     modułów udanego renderu) loadera;
 *   - middleware w łańcuchu widziałyby dyrektywę loadera NA ODPOWIEDZI:
 *     `planDefaultCacheControl` wychodzi wtedy przed deny-listą i regułą ścieżki
 *     `/live`, a zapis odroczony brałby nieprzycięty `Link`.
 * Granica odpowiedzi stosuje tę samą regułę, którą miał h3 (`requestHandler`
 * sprzed Start 1.169) i na której ta aplikacja stoi: nagłówki trasy dostaje WYŁĄCZNIE
 * odpowiedź `ok`, raz, za całym łańcuchem middleware, i nadpisują one własny
 * nagłówek odpowiedzi.
 *
 * Skutek braku tego kanału był kiedyś PEŁNYM rozjazdem: `documentStorePolicy`
 * czyta `response.headers.get("cache-control")` W ŚRODKU łańcucha, więc dla
 * renderu zdegradowanego widziała `null`, dostawała od
 * `defaultCacheControlMiddleware` domyślne
 * `public, s-maxage=900, stale-while-revalidate=86400` i ZAPISYWAŁA pustą powłokę
 * do L1/L2 na 24 h - a czytelnik dostawał `private, no-store` dopiero na granicy,
 * której brzeg już nie widzi. Jedna czkawka bazy w chwili zimnego MISS-a
 * zamrażała pustą powłokę archiwum na dobę.
 *
 * Kluczem jest obiekt `Request` zdarzenia Start: `getRequest()` zwraca
 * `event.request`, czyli dokładnie obiekt podany do `handler.fetch`
 * (`runInStartRequest` w `internal-request-response.ts`), więc granica w
 * `src/server.ts` czyta wpis tym samym kluczem, który zapisał loader - ta sama
 * doktryna, co akumulator `Link` niżej. WeakMap = zero wycieków: wpis znika
 * razem z żądaniem.
 */
const routeCacheDirectives = new WeakMap<Request, string>();

/**
 * Record the route's Cache-Control intent for the current SSR request. The
 * response boundary (`fetchWithFrameworkPreloads`) puts it on the wire for
 * `ok` responses only. No-op on the client and outside a request scope (e.g.
 * prerender), so it is always safe to call from a route loader.
 *
 * TA SAMA wartość rządzi decyzją o zapisie do NES Edge Cache i tym, co zobaczy
 * przeglądarka (patrz `routeCacheDirectives`).
 */
export const setCacheControlHeader = createIsomorphicFn()
  .server((value: string) => {
    try {
      const request = getRequest();
      // Loadery korzenia, trasy i bramka chrome biegną równolegle - wygrywa
      // zawsze OSTRZEJSZA intencja: raz ustawiony opt-out (`private`/`no-store`)
      // nie da się cofnąć, a krótkiej świeżości (chrome zdegradowany, 30 s)
      // późniejszy czysty loader nie podniesie do 900 s. Reguła i jej dowód:
      // `narrowestCacheControl` (cachePolicy.ts).
      routeCacheDirectives.set(
        request,
        narrowestCacheControl(routeCacheDirectives.get(request), value),
      );
    } catch {
      /* not inside a request scope - ignore */
    }
  })
  .client(() => {});

/**
 * Intencja cache'owa ustawiona przez loader tego żądania, albo `null`.
 * Czytana przez `defaultCacheControlMiddleware` (najgłębsze middleware, jeszcze
 * PRZED `documentCacheMiddleware` na drodze powrotnej), żeby polityka zapisu
 * widziała decyzję trasy, przez odroczony zapis i przez granicę odpowiedzi
 * (`fetchWithFrameworkPreloads`), która podaje `request` wprost. Na kliencie
 * i poza zasięgiem żądania zwraca `null`.
 */
export const readRouteCacheDirective = createIsomorphicFn()
  .server((request?: Request): string | null => {
    try {
      return routeCacheDirectives.get(request ?? getRequest()) ?? null;
    } catch {
      /* not inside a request scope - ignore */
      return null;
    }
  })
  .client((): string | null => null);

/**
 * Werdykt kompletności dokumentu wydawany NA KOŃCU STRUMIENIA (fala 3, P3.6b,
 * R2 diagnozy `faza3/diagnoza/cache-dokumentu.md`). `reasons` to krótkie
 * etykiety odstępstw (np. `dropped:builder-post-list`) - trafiają do linii
 * logu dokumentu jako `degradedBy`.
 */
export interface DocumentCompleteness {
  readonly complete: boolean;
  readonly reasons: readonly string[];
}

/**
 * Predykat kompletności rejestrowany przez loader trasy. Wołany przez magazyn
 * NES Edge Cache dopiero po zebraniu CAŁEGO dokumentu, więc widzi to, co
 * dostrumieniowało się po flushu powłoki - werdykt loadera (~600 ms) tego nie
 * widział i odrzucał dokumenty kompletne (klasa B2 diagnozy).
 */
export type DocumentCompletenessCheck = () => DocumentCompleteness;

/** Werdykt „kompletny" - pola tylko do odczytu w typie; bez wywołań w zasięgu modułu. */
const COMPLETE: DocumentCompleteness = { complete: true, reasons: [] };

/**
 * Predykaty i etykiety degradacji per ŻĄDANIE - ten sam rodzaj kanału poza
 * nagłówkami odpowiedzi i ta sama tożsamość klucza (`getRequest() ===
 * event.request`) co `routeCacheDirectives` wyżej. Czytający spoza zasięgu
 * żądania (magazyn w `applyDeferredDocumentStore`, linia logu w `src/server.ts`)
 * podaje obiekt `Request` wprost. WeakMap = zero wycieków.
 */
const completenessChecks = new WeakMap<Request, DocumentCompletenessCheck[]>();
const degradationLabels = new WeakMap<Request, Set<string>>();

/** Sufit etykiet na żądanie: linia logu ma być krótka, a pętla nie może jej rozdmuchać. */
const MAX_DEGRADATION_LABELS = 16;

function scopedRequest(request?: Request): Request | null {
  if (request) return request;
  try {
    return getRequest();
  } catch {
    /* not inside a request scope - ignore */
    return null;
  }
}

/**
 * Zarejestruj predykat kompletności dokumentu bieżącego żądania. Kilka
 * predykatów składa się koniunkcją. No-op na kliencie i poza zasięgiem żądania.
 */
export const registerDocumentCompletenessCheck = createIsomorphicFn()
  .server((check: DocumentCompletenessCheck, request?: Request) => {
    const scoped = scopedRequest(request);
    if (!scoped) return;
    const checks = completenessChecks.get(scoped);
    if (checks) checks.push(check);
    else completenessChecks.set(scoped, [check]);
  })
  .client(() => {});

/**
 * Werdykt wszystkich predykatów żądania. Brak predykatu = kompletny (trasy
 * bez predykatu zachowują się jak dotąd). Predykat, który rzuca, to odstępstwo:
 * konserwatywnie brak zapisu, nigdy wyjątek w potoku dokumentu.
 */
export const readDocumentCompleteness = createIsomorphicFn()
  .server((request?: Request): DocumentCompleteness => {
    const scoped = scopedRequest(request);
    const checks = scoped ? completenessChecks.get(scoped) : undefined;
    if (!checks?.length) return COMPLETE;
    const reasons: string[] = [];
    for (const check of checks) {
      try {
        const verdict = check();
        if (!verdict.complete)
          reasons.push(...(verdict.reasons.length ? verdict.reasons : ["incomplete"]));
      } catch {
        reasons.push("check-failed");
      }
    }
    return reasons.length ? { complete: false, reasons } : COMPLETE;
  })
  .client((): DocumentCompleteness => COMPLETE);

/**
 * Odnotuj przyczynę degradacji renderu (etykieta odpornego loadera, chrome,
 * odstępstwo predykatu kompletności) - R7c, pole `degradedBy` linii logu
 * dokumentu. Kolejność pierwszego zgłoszenia, bez duplikatów, z sufitem.
 */
export const noteDocumentDegradation = createIsomorphicFn()
  .server((label: string, request?: Request) => {
    if (!label) return;
    const scoped = scopedRequest(request);
    if (!scoped) return;
    let labels = degradationLabels.get(scoped);
    if (!labels) {
      labels = new Set<string>();
      degradationLabels.set(scoped, labels);
    }
    if (labels.size < MAX_DEGRADATION_LABELS) labels.add(label);
  })
  .client(() => {});

/** Etykiety degradacji odnotowane dla żądania (pusta lista, gdy brak). */
export const readDocumentDegradations = createIsomorphicFn()
  .server((request?: Request): string[] => {
    const scoped = scopedRequest(request);
    const labels = scoped ? degradationLabels.get(scoped) : undefined;
    return labels ? [...labels] : [];
  })
  .client((): string[] => []);

/**
 * Żądania, dla których loader stwierdził, że CRAWLER INDEKSUJĄCY dostałby
 * dokument bez treści (strona główna po terminie treści - patrz
 * `lib/http/crawlerUnavailable.ts`). Ten sam kanał per `Request` co intencja
 * cache'owa wyżej: loader znaczy, a najgłębsze middleware w `start.ts` zamienia
 * odpowiedź na 503 z `Retry-After` i `no-store` w JEDNYM miejscu. Kanał powstał,
 * bo status ustawiony z loadera przez h3 przegrywał ze statusem renderu routera.
 * Dziś ten status pochodzi z `router._serverResult` (`getSsrStatus` w
 * `@tanstack/router-core`, `ssr/handlerCallback.js`), a Start 1.169 stosuje już
 * status pomocnika (`setResponseStatus`) przy uzgadnianiu odpowiedzi - ale sam
 * status nie niósłby `Retry-After` ani `no-store`, więc przepisanie zostaje
 * w middleware.
 */
const crawlerUnavailableRequests = new WeakSet<Request>();

export const markCrawlerUnavailable = createIsomorphicFn()
  .server((request?: Request) => {
    const scoped = scopedRequest(request);
    if (scoped) crawlerUnavailableRequests.add(scoped);
  })
  .client(() => {});

export const readCrawlerUnavailable = createIsomorphicFn()
  .server((request?: Request): boolean => {
    const scoped = scopedRequest(request);
    return scoped ? crawlerUnavailableRequests.has(scoped) : false;
  })
  .client((): boolean => false);

/**
 * Akumulator wartości nagłówka `Link` per ŻĄDANIE - jedyne miejsce, w którym
 * żyją hinty loaderów (powód, dla którego nie stan pomocników odpowiedzi Start:
 * `routeCacheDirectives` wyżej). Loadery tras (root + trasa potomna) biegną
 * równolegle, więc naiwny odczyt-scal-zapis na samym nagłówku gubiłby jeden
 * z wpisów. Każde dołożenie odkłada wartość do zbioru w WeakMap kluczowanej
 * obiektem Request, a złączoną wartość czytają skład zestawu bootu i granica
 * odpowiedzi (`readLinkHeader`) - wynik jest identyczny niezależnie od
 * kolejności wywołań. Set deduplikuje, więc podwójny render loadera (np.
 * rewalidacja) nie mnoży wpisów. WeakMap = zero wycieków: wpis znika razem
 * z żądaniem.
 */
const linkHeaderValues = new WeakMap<Request, Set<string>>();

/**
 * Append a `Link` response-header value (RFC 8288) for the current SSR
 * request - e.g. a `rel=preload` hint for the LCP image or critical fonts.
 * Multiple values are comma-joined into one header, which the response
 * boundary (`fetchWithFrameworkPreloads`) puts on `ok` responses. Browsers act
 * on preload Link headers before parsing HTML, and Cloudflare can replay them
 * as 103 Early Hints - both start the critical fetch ahead of the document
 * parse. No-op on the client and outside a request scope, safe in any loader.
 */
export const appendLinkHeader = createIsomorphicFn()
  .server((value: string) => {
    if (!value) return;
    let request: Request;
    try {
      request = getRequest();
    } catch {
      /* not inside a request scope - ignore */
      return;
    }
    let values = linkHeaderValues.get(request);
    if (values?.has(value)) return;
    try {
      // Walidacja ByteString TUTAJ, nie dopiero na granicy: wartość spoza
      // ByteString (znak > 0xFF na spec-zgodnym Headers) rzuca TypeError.
      // Zatruty wpis NIE MOŻE wejść do zbioru, inaczej złączona wartość
      // rzucałaby przy każdym nadaniu i po cichu gubiła wszystkie hinty
      // żądania (CSS/fonty/obraz).
      new Headers({ link: value });
    } catch {
      return;
    }
    if (!values) {
      values = new Set<string>();
      linkHeaderValues.set(request, values);
    }
    values.add(value);
  })
  .client(() => {});

/**
 * Złączona wartość akumulatora `Link` tego żądania (kolejność pierwszego dołożenia), albo
 * `null`, gdy loadery niczego nie dołożyły. Czytają ją skład zestawu bootu
 * (`lib/boot/bootSet.server.ts`) w chwili dehydratacji i granica odpowiedzi
 * (`fetchWithFrameworkPreloads`, z `request` podanym wprost). Na kliencie i poza zasięgiem
 * żądania zwraca `null`.
 */
export const readLinkHeader = createIsomorphicFn()
  .server((request?: Request): string | null => {
    const scoped = scopedRequest(request);
    const values = scoped ? linkHeaderValues.get(scoped) : undefined;
    return values?.size ? Array.from(values).join(", ") : null;
  })
  .client((): string | null => null);
