// Isomorphic, server-only response-header effects. createIsomorphicFn keeps the
// server-only `@tanstack/react-start/server` import out of the client bundle and
// makes these no-ops during client-side navigation (where there is no HTTP
// response to mutate).
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

/**
 * Set the Cache-Control header on the current SSR response. No-op on the client
 * and outside a request scope (e.g. prerender), so it is always safe to call
 * from a route loader.
 */
export const setCacheControlHeader = createIsomorphicFn()
  .server((value: string) => {
    try {
      setResponseHeader("cache-control", value);
    } catch {
      /* not inside a request scope - ignore */
    }
  })
  .client(() => {});

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
