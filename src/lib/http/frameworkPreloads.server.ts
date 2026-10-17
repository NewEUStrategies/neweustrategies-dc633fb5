import type { Register } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import type { RequestHandler } from "@tanstack/react-start/server";

import { readLinkHeader, readRouteCacheDirective } from "./responseHeaders";

/** `lcp` - boot po wpisie LCP kandydata; `now` - boot od razu. */
export type BootMode = "lcp" | "now";

/**
 * Tryb dokumentu per ŻĄDANIE (kanał poza nagłówkami odpowiedzi - powód jak dla `Link`
 * i `Cache-Control`: `routeCacheDirectives` w `responseHeaders.ts`). Klucz: obiekt `Request`
 * z `getRequest()` - ten sam, który `fetchWithFrameworkPreloads` dostaje wprost
 * (`runInStartRequest` przechowuje `event.request = request`). WeakMap = zero wycieków.
 */
const bootModes = new WeakMap<Request, BootMode>();

/**
 * Zapisz tryb bootu dokumentu bieżącego żądania (render serwera, `lib/boot/bootSet.server.ts`).
 * No-op poza zasięgiem żądania (test, prerender).
 */
export function recordBootMode(mode: BootMode, request?: Request): void {
  let scoped = request;
  if (!scoped) {
    try {
      scoped = getRequest();
    } catch {
      /* not inside a request scope - ignore */
      return;
    }
  }
  bootModes.set(scoped, mode);
}

/**
 * Tryb bootu zapisany dla żądania, albo `null` (dokument bez zestawu bootu). Granica
 * odpowiedzi (`fetchWithFrameworkPreloads`) bierze go pod uwagę wyłącznie dla odpowiedzi `ok`.
 */
export function readBootMode(request: Request): BootMode | null {
  return bootModes.get(request) ?? null;
}

/**
 * Wpisy wartości nagłówka `Link` (RFC 8288: przecinki poza `<...>` i cudzysłowami rozdzielają
 * wpisy), bez białych znaków na brzegach.
 */
export function linkHeaderEntries(linkHeader: string | null | undefined): string[] {
  if (!linkHeader) return [];
  const out: string[] = [];
  let current = "";
  let inAngle = false;
  let inQuote = false;
  for (const ch of linkHeader) {
    if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    else if (ch === '"' && !inAngle) inQuote = !inQuote;
    if (ch === "," && !inAngle && !inQuote) {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Cel wpisu `Link` z `rel=modulepreload` (obie pisownie `rel`), inaczej `null`. */
export function modulePreloadTarget(entry: string): string | null {
  const match = /^<([^>]*)>(.*)$/s.exec(entry);
  if (!match) return null;
  const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(match[2]);
  const rels = (rel?.[1] ?? rel?.[2] ?? "").toLowerCase().split(/\s+/);
  return rels.includes("modulepreload") ? match[1] : null;
}

/** Cele `rel=modulepreload` z wartości nagłówka `Link`, w kolejności wpisów. */
export function modulePreloadTargets(linkHeader: string | null | undefined): string[] {
  return linkHeaderEntries(linkHeader)
    .map(modulePreloadTarget)
    .filter((target): target is string => target !== null);
}

/** Wartość `Link` bez wpisów `modulepreload` (`null`, gdy nic nie zostało). */
export function withoutModulePreloads(linkHeader: string | null | undefined): string | null {
  const kept = linkHeaderEntries(linkHeader).filter((entry) => modulePreloadTarget(entry) === null);
  return kept.length ? kept.join(", ") : null;
}

/**
 * GRANICA ODPOWIEDZI: ostatnie słowo o nagłówkach `Cache-Control` i `Link` dokumentu, tuż za
 * `handler.fetch` (oba miejsca wołania w `src/server.ts`: czytelnik i rewalidacja w tle). Body
 * zostaje TYM SAMYM obiektem: odroczony zapis NES Edge Cache jest kluczowany jego tożsamością.
 *
 * NAGŁÓWKI TRASY. Intencję cache'ową (`setCacheControlHeader`) i hinty `Link`
 * (`appendLinkHeader`) loadery odkładają w kanałach per `Request` (`responseHeaders.ts`), nie
 * w stanie pomocników odpowiedzi Start - ten od 1.169 uzgadnia się na każdej granicy middleware
 * i dla każdego statusu (pełny wywód przy `routeCacheDirectives`). Tutaj trafiają na drut
 * według reguły, którą miał h3 i na której stoi aplikacja: WYŁĄCZNIE odpowiedź `ok`, raz, za
 * całym łańcuchem middleware, nadpisując własny nagłówek odpowiedzi (`set`). Dlatego 503
 * crawlera i strona 500 zachowują swoje `no-store`, a 404 i przekierowania nie niosą ani
 * publicznej polityki loadera, ani preloadów udanego renderu.
 *
 * DOKUMENT Z ZESTAWEM BOOTU (P2.1). Render serwera zapisuje tryb w kanale per `Request`
 * (`recordBootMode` z `lib/boot/bootSet.server.ts`), więc znacznik nie istnieje na odpowiedzi
 * i nie ma czego zdejmować. Tryb liczy się tylko dla odpowiedzi `ok` (404/500 wychodzą bez
 * nagłówków trasy, więc nie ma czego przycinać):
 *   - `lcp` (strona główna, strony treści): z `Link` znika każdy `modulepreload`. Moduły
 *     z hintów loaderów (słownik, widgety nad zgięciem i nagłówka) są już w `#nes-boot-set`,
 *     a JS ma ruszyć dopiero po wpisie LCP - hint w nagłówku pobrałby go przed LCP (Lantern
 *     liczy każdy skrypt zakończony przed obserwowanym LCP). Zostają CSS, fonty i obraz kandydata;
 *   - `now`: `Link` bez zmian - render dopisał w nim całą serię bootu.
 * Kolektor `onEarlyHints` dla takiego dokumentu nie ma czego dać: manifest Start jest bez
 * preloadów (`scripts/lib/bootAfterLcpPlugin.ts`), a seria pochodzi z zestawu.
 *
 * DOKUMENT BEZ TRYBU - jak dotąd: preloady manifestu z `onEarlyHints` dochodzą do `Link`.
 * To dev i build bez wtyczki (manifest z preloadami, start przez `<Scripts>`) oraz HIT cache
 * dokumentu, którego `Link` zapisano już po decyzji wyżej (wtedy kolektor milczy, a kanały
 * są puste, bo router nie biegnie).
 */
export async function fetchWithFrameworkPreloads(
  fetch: RequestHandler<Register>,
  request: Request,
): Promise<Response> {
  const links = new Set<string>();
  const rendered = await fetch(request, {
    onEarlyHints: ({ hints, links: emitted }) => {
      hints.forEach((hint, index) => {
        if (hint.rel === "modulepreload") links.add(emitted[index]);
      });
    },
  });
  // Redirects and errors get neither the route's headers nor its client code.
  if (!rendered.ok) return rendered;
  // Route headers go on EVERY ok response, as h3 did - also a server-fn GET
  // (`memberSlug.functions.ts` narrows its own reply to `private, no-store`).
  const response = withRouteHeaders(rendered, request);
  const mode = readBootMode(request);
  if (mode !== null) return withBootModeLink(response, mode);
  // Manifest modulepreloads are for HTML documents only, never for APIs.
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const existing = response.headers.get("link");
  const additional = [...links].filter((link) => !existing?.includes(link));
  if (!additional.length) return response;
  const headers = new Headers(response.headers);
  headers.set("link", [existing, ...additional].filter(Boolean).join(", "));
  return rebuild(response, headers);
}

/** Odpowiedź `ok` z nagłówkami trasy z kanałów per `Request` (opis wyżej). */
function withRouteHeaders(response: Response, request: Request): Response {
  const cacheControl = readRouteCacheDirective(request);
  const link = readLinkHeader(request);
  if (cacheControl === null && link === null) return response;
  const headers = new Headers(response.headers);
  if (cacheControl !== null) headers.set("cache-control", cacheControl);
  if (link !== null) headers.set("link", link);
  return rebuild(response, headers);
}

/** Odpowiedź dokumentu z zestawem: `Link` według trybu (opis wyżej). */
function withBootModeLink(response: Response, mode: BootMode): Response {
  if (mode !== "lcp" || !response.headers.has("link")) return response;
  const headers = new Headers(response.headers);
  const kept = withoutModulePreloads(headers.get("link"));
  if (kept === null) headers.delete("link");
  else headers.set("link", kept);
  return rebuild(response, headers);
}

function rebuild(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
