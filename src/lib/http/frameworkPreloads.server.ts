import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

/** `lcp` - boot po wpisie LCP kandydata; `now` - boot od razu. */
export type BootMode = "lcp" | "now";

/**
 * Wewnętrzny nagłówek trybu dokumentu: render serwera (`lib/boot/bootSet.server.ts`) -> ta
 * funkcja, która go zdejmuje. Nie wychodzi do klienta i nie trafia do wpisu NES Edge Cache.
 */
export const BOOT_MODE_HEADER = "x-nes-boot-mode";

/** Tryb z wartości nagłówka {@link BOOT_MODE_HEADER} (`null` - dokument bez zestawu). */
export function parseBootMode(value: string | null | undefined): BootMode | null {
  return value === "lcp" || value === "now" ? value : null;
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
 * Ostatnie słowo o nagłówku `Link` dokumentu, po scaleniu nagłówków loaderów przez h3 (sam
 * `responseLinkHeader` gubi je w `set(Link)` h3). Body zostaje TYM SAMYM obiektem: odroczony zapis
 * NES Edge Cache jest kluczowany jego tożsamością.
 *
 * DOKUMENT Z ZESTAWEM BOOTU (P2.1). Render serwera oznacza tryb wewnętrznym nagłówkiem
 * `x-nes-boot-mode` (`lib/boot/bootSet.server.ts`), który tutaj znika z odpowiedzi:
 *   - `lcp` (strona główna, strony treści): z `Link` znika każdy `modulepreload`. Moduły
 *     z hintów loaderów (słownik, widgety nad zgięciem i nagłówka) są już w `#nes-boot-set`,
 *     a JS ma ruszyć dopiero po wpisie LCP - hint w nagłówku pobrałby go przed LCP (Lantern
 *     liczy każdy skrypt zakończony przed obserwowanym LCP). Zostają CSS, fonty i obraz kandydata;
 *   - `now`: `Link` bez zmian - render dopisał w nim całą serię bootu.
 * Kolektor `onEarlyHints` dla takiego dokumentu nie ma czego dać: manifest Start jest bez
 * preloadów (`scripts/lib/bootAfterLcpPlugin.ts`), a seria pochodzi z zestawu.
 *
 * DOKUMENT BEZ ZNACZNIKA - jak dotąd: preloady manifestu z `onEarlyHints` dochodzą do `Link`.
 * To dev i build bez wtyczki (manifest z preloadami, start przez `<Scripts>`) oraz HIT cache
 * dokumentu, którego `Link` zapisano już po decyzji wyżej (wtedy kolektor milczy, bo router nie
 * biegnie).
 */
export async function fetchWithFrameworkPreloads(
  fetch: RequestHandler<Register>,
  request: Request,
): Promise<Response> {
  const links = new Set<string>();
  const response = await fetch(request, {
    onEarlyHints: ({ hints, links: emitted }) => {
      hints.forEach((hint, index) => {
        if (hint.rel === "modulepreload") links.add(emitted[index]);
      });
    },
  });
  const marker = response.headers.get(BOOT_MODE_HEADER);
  if (marker !== null) return withBootModeLink(response, parseBootMode(marker));
  // Do not load a successful route's client code on redirects, errors or APIs.
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }
  const existing = response.headers.get("link");
  const additional = [...links].filter((link) => !existing?.includes(link));
  if (!additional.length) return response;
  const headers = new Headers(response.headers);
  headers.set("link", [existing, ...additional].filter(Boolean).join(", "));
  return rebuild(response, headers);
}

/** Odpowiedź dokumentu z zestawem: bez znacznika trybu, `Link` według trybu (opis wyżej). */
function withBootModeLink(response: Response, mode: ReturnType<typeof parseBootMode>): Response {
  const headers = new Headers(response.headers);
  headers.delete(BOOT_MODE_HEADER);
  if (mode === "lcp") {
    const kept = withoutModulePreloads(headers.get("link"));
    if (kept === null) headers.delete("link");
    else headers.set("link", kept);
  }
  return rebuild(response, headers);
}

function rebuild(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
