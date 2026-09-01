// Isomorphic, server-only response-header effects. createIsomorphicFn keeps the
// server-only `@tanstack/react-start/server` import out of the client bundle and
// makes these no-ops during client-side navigation (where there is no HTTP
// response to mutate).
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

/**
 * Intencja cache'owa TRASY per ŻĄDANIE - drugi, równoległy kanał obok nagłówka
 * zdarzenia h3. Bez niego decyzja loadera („ten render jest zdegradowany, nie
 * zapisuj go") fizycznie NIE DOCIERA do polityki zapisu NES Edge Cache.
 *
 * DOWÓD MECHANIZMU (zainstalowane wersje, nie domysł):
 * - `setResponseHeader` odkłada nagłówek na `h3Event.res.headers`;
 * - `@tanstack/start-server-core/dist/esm/request-response.js:46` woła
 *   `toResponse(attachResponseHeaders(eventStorage.run({ h3Event }, handler), h3Event), h3Event)`,
 *   czyli scalenie dzieje się ZA całym łańcuchem request-middleware
 *   (`attachResponseHeaders` scala przy tym WYŁĄCZNIE `Set-Cookie` i tylko dla
 *   odpowiedzi non-ok - `mergeEventResponseHeaders`, ten sam plik, :17-25);
 * - realne scalenie robi h3: `prepareResponse` -> `mergeHeaders(val.headers,
 *   preparedHeaders, val.headers)` (`h3-v2/dist/h3-Bz4OPZv_.mjs:245-247`,
 *   `:256-260`), gdzie nagłówki ZDARZENIA nadpisują nagłówki odpowiedzi
 *   (`target.set`) - i tylko dla `val.ok`.
 *
 * Skutek bez tego kanału był PEŁNYM rozjazdem: `documentStorePolicy` czyta
 * `response.headers.get("cache-control")` W ŚRODKU łańcucha, więc dla renderu
 * zdegradowanego widziała `null`, dostawała od `defaultCacheControlMiddleware`
 * domyślne `public, s-maxage=900, stale-while-revalidate=86400` i ZAPISYWAŁA
 * pustą powłokę do L1/L2 na 24 h - a czytelnik dostawał `private, no-store`
 * dopiero z nadpisania w `toResponse()`, czyli w miejscu, którego brzeg już nie
 * widzi. Jedna czkawka bazy w chwili zimnego MISS-a zamrażała pustą powłokę
 * archiwum na dobę.
 *
 * Kluczem jest obiekt `Request` pobrany przez `getRequest()` po OBU stronach
 * (`getRequest() === h3Event.req`, tamże `:54-56`), więc tożsamość klucza jest
 * gwarantowana konstrukcyjnie - ta sama doktryna, co akumulator `Link` niżej.
 * WeakMap = zero wycieków: wpis znika razem z żądaniem.
 */
const routeCacheDirectives = new WeakMap<Request, string>();

/**
 * Set the Cache-Control header on the current SSR response. No-op on the client
 * and outside a request scope (e.g. prerender), so it is always safe to call
 * from a route loader.
 *
 * Zapisuje przy tym intencję trasy w kanale poza nagłówkami zdarzenia h3 (patrz
 * `routeCacheDirectives`), żeby TA SAMA wartość rządziła decyzją o zapisie do
 * NES Edge Cache, a nie tylko tym, co ostatecznie zobaczy przeglądarka.
 */
export const setCacheControlHeader = createIsomorphicFn()
  .server((value: string) => {
    try {
      setResponseHeader("cache-control", value);
    } catch {
      /* not inside a request scope - ignore */
    }
    try {
      routeCacheDirectives.set(getRequest(), value);
    } catch {
      /* not inside a request scope - ignore */
    }
  })
  .client(() => {});

/**
 * Intencja cache'owa ustawiona przez loader tego żądania, albo `null`.
 * Czytana przez `defaultCacheControlMiddleware` (najgłębsze middleware, jeszcze
 * PRZED `documentCacheMiddleware` na drodze powrotnej), żeby polityka zapisu
 * widziała decyzję trasy. Na kliencie i poza zasięgiem żądania zwraca `null`.
 */
export const readRouteCacheDirective = createIsomorphicFn()
  .server((): string | null => {
    try {
      return routeCacheDirectives.get(getRequest()) ?? null;
    } catch {
      /* not inside a request scope - ignore */
      return null;
    }
  })
  .client((): string | null => null);

/**
 * Akumulator wartości nagłówka `Link` per ŻĄDANIE. Loadery tras (root + trasa
 * potomna) biegną równolegle, więc naiwny odczyt-scal-zapis na samym nagłówku
 * gubiłby jeden z wpisów. Każde dołożenie odkłada wartość do zbioru w WeakMap
 * kluczowanej obiektem Request i ustawia PEŁNĄ złączoną wartość - wynik jest
 * identyczny niezależnie od kolejności wywołań. Set deduplikuje, więc podwójny
 * render loadera (np. rewalidacja) nie mnoży wpisów. WeakMap = zero wycieków:
 * wpis znika razem z żądaniem.
 */
const linkHeaderValues = new WeakMap<Request, Set<string>>();

/**
 * Append a `Link` response-header value (RFC 8288) to the current SSR
 * response - e.g. a `rel=preload` hint for the LCP image or critical fonts.
 * Multiple values are comma-joined into one header. Browsers act on preload
 * Link headers before parsing HTML, and Cloudflare can replay them as 103
 * Early Hints - both start the critical fetch ahead of the document parse.
 * No-op on the client and outside a request scope, safe in any loader.
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
    if (!values) {
      values = new Set<string>();
      linkHeaderValues.set(request, values);
    }
    if (values.has(value)) return;
    values.add(value);
    try {
      setResponseHeader("link", Array.from(values).join(", "));
    } catch {
      // Wartość spoza ByteString (znak > 0xFF na spec-zgodnym Headers) rzuca
      // TypeError. Zatruty wpis MUSI wypaść ze zbioru, inaczej każde kolejne
      // dołożenie w tym żądaniu składałoby tę samą złą wartość i po cichu
      // gubiło wszystkie dalsze hinty (CSS/fonty/obraz).
      values.delete(value);
    }
  })
  .client(() => {});
