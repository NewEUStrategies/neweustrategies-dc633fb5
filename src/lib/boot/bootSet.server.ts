// ZESTAW BOOTU PER ŻĄDANIE (P2.1, krok 1; P3.4) - serwer składa listę modułów, które przeglądarka
// pobierze serią w chwili bootu (w trybie `lcp` trzema grupami), i wstrzykuje ją do dokumentu poza
// drzewem Reacta.
//
// PO CO. Manifest TanStack Start nie niesie już preloadów ani skryptu wejścia
// (`scripts/lib/bootAfterLcpPlugin.ts`), więc dokument nie startuje JS-a sam. Startuje go
// klasyczny skrypt z `<head>` (`bootLoaderScript.ts`) - po wpisie LCP na stronach z kandydatem,
// od razu wszędzie indziej. Loader potrzebuje listy URL-i, a ta zależy od żądania: języka
// (słownik), dopasowanych tras (chunki tras) i dokumentu buildera (chunki widgetów nad zgięciem
// i nagłówka). Nie może więc stać w drzewie Reacta - klient nie zna nazw chunków słownika ani
// widgetów (`localeChunks.ts`, `widgetPreloads.ts`), a węzeł obecny tylko w HTML-u serwera to
// rozjazd tożsamości korzenia dokumentu.
//
// SKŁAD, w tej kolejności (kolejność żądań serii):
//   1. wejście klienta + preloady korzenia (statyczne domknięcie wejścia) z `BOOT_MANIFEST`;
//   2. chunk rdzenia słownika aktywnego języka (`LOCALE_CHUNK_URLS`);
//   3. preloady dopasowanych tras (chunki komponentów tras + ich bezpośrednie importy);
//   4. każdy `modulepreload` dołożony przez loadery tego żądania do akumulatora nagłówka `Link`
//      (`appendLinkHeader`): chunki widgetów nagłówka (`__root.tsx`) i sekcji nad zgięciem
//      (`index.tsx`, `$.tsx`), czyli warunek CLS 0 z werdyktu boot-js C3 (leniwa granica
//      widgetu nad zgięciem ma swój chunk w tej samej serii co wejście).
// Punkt 4 czyta nagłówek zdarzenia h3 w chwili dehydratacji: loadery już się skończyły, a ich
// hinty modułów leżą w jednym miejscu (akumulator `Link` per żądanie, `responseHeaders.ts`).
// Dzięki temu każdy hint modułu dołożony przez loader trafia do serii bootu.
//
// GRUPY SERII (P3.4). Seria trybu `lcp` idzie w trzech grupach, każda w osobnym zadaniu loadera
// (`bootLoaderScript.ts`, „SERIA GRUPAMI”): (1) punkt 1 - domknięcie wejścia, (2) punkty 2-3 -
// słownik i chunki trasy, (3) punkt 4 - widgety nad zgięciem. Zestaw niesie granice w `g`
// (indeksy w `u` po deduplikacji, rosnące, bez pustych grup), a `u` zostaje pełną listą w tej
// samej kolejności - format jest zgodny wstecz (`documentWeight.ts`, e2e i loader bez `g` widzą
// jedną grupę). Tryb `now` startuje całą serię naraz, więc granic nie dostaje (bajty `<head>`).
//
// NAGŁÓWEK `Link`. Tryb dokumentu idzie wewnętrznym nagłówkiem `x-nes-boot-mode`, który
// `frameworkPreloads.server.ts` czyta i zdejmuje z odpowiedzi (nie trafia do klienta ani do
// cache dokumentu):
//   - `lcp`: z `Link` znika KAŻDY `modulepreload` (słownik, widgety) - żaden JS nie rusza przed
//     wyzwalaczem loadera, zostają CSS, fonty i obraz kandydata;
//   - `now`: `Link` dostaje `modulepreload` całej serii (jak dawniej preloady manifestu), więc
//     panel, konto i trasy bez SSR pobierają JS od nagłówków odpowiedzi, a nie dopiero po
//     arkuszu stylów, na który czeka loader w `<head>`.
// Na HIT nagłówek pochodzi z wpisu cache (zapisanego już po tej decyzji), więc znacznika nie ma.
//
// TRYB. `lcp` (boot po wpisie LCP kandydata) wyłącznie dla publicznych tras SSR z kandydatem LCP:
// strona główna (`/`, także `/en` po przepisaniu adresu) i strony treści (`/$`), dopasowane
// z sukcesem i renderowane na serwerze. Wszędzie indziej `now` - trasy `ssr: false`, panel,
// konto, 404 i błędy nie mają kandydata, a odroczenie tylko opóźniłoby ich start. Decyzje per
// użytkownik (zapisana sesja, ramka edytora, `document.prerendering`) podejmuje loader
// w przeglądarce: dokument jest anonimowy i trafia do NES Edge Cache razem z zestawem.
//
// GDZIE WSTRZYKNIĘCIE. `router.serverSsr.injectHtml` z owijki `router.options.dehydrate`
// (`src/router.tsx`): biegnie po `router.load()` (dopasowania i loadery gotowe), przed renderem
// Reacta, raz na żądanie, tak samo na ścieżce strumieniowej i `allReady` (boty, w tym
// `Chrome-Lighthouse`, którego PSI dostaje na MISS). HTML trafia do bufora routera i wychodzi
// przy pierwszej granicy strumienia (zmierzone w spike'u: zawsze w `<head>`). NIE
// `onRenderFinished`: wynik lądowałby przed `</body>`, a szybka ścieżka strumienia pomija go
// po cichu (`reserveStreamFastPath`).
//
// BEZPIECZEŃSTWO TREŚCI. URL-e pochodzą z builda (manifest, mapy chunków), nie z żądania; mimo
// to każdy przechodzi wąski filtr ścieżki/adresu, a JSON ma `<` zamienione na `\u003c`, więc
// treść nie domknie `</script>`.
import { getResponseHeader, setResponseHeader } from "@tanstack/react-start/server";

import { appendLinkHeader } from "@/lib/http/responseHeaders";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { LOCALE_CHUNK_URLS } from "@/lib/seo/localeChunks";

import {
  BOOT_MODE_HEADER,
  modulePreloadTargets,
  type BootMode,
} from "@/lib/http/frameworkPreloads.server";

import { BOOT_MANIFEST, type BootManifest } from "./bootManifest";
import { BOOT_SET_ELEMENT_ID } from "./bootLoaderScript";

export { BOOT_SET_ELEMENT_ID };
export type { BootMode };

/**
 * Zestaw bootu w dokumencie. Klucze jednoliterowe, bo węzeł stoi w `<head>` każdego dokumentu
 * (budżet `headRawBytes`): `m` tryb, `e` wejście, `u` URL-e serii (wejście pierwsze), `g` granice
 * grup serii - indeksy w `u`, od których zaczyna się grupa 2 i 3 (tylko tryb `lcp`, bez pustych
 * grup; brak = jedna grupa).
 */
export interface BootSet {
  readonly m: BootMode;
  readonly e: string;
  readonly u: readonly string[];
  readonly g?: readonly number[];
}

/** Trasy publiczne SSR z kandydatem LCP (id tras routera; `/en` przepisuje się na `/`). */
export const AFTER_LCP_ROUTE_IDS: ReadonlySet<string> = new Set(["/", "/$"]);

/** Dopasowanie trasy - tylko pola, które czyta skład zestawu. */
export interface BootMatch {
  readonly routeId: string;
  readonly status?: string;
  readonly ssr?: boolean | "data-only";
}

/** Router w chwili dehydratacji - tylko to, czego potrzebuje wstrzyknięcie. */
export interface BootRouterLike {
  readonly serverSsr?: { injectHtml: (html: string) => void };
  readonly state: { readonly matches: readonly BootMatch[] };
  isShell?: () => boolean;
}

/** Ścieżka bezwzględna (nie `//host`) albo adres http(s), bez znaków, które coś domykają. */
const BOOT_URL_RE = /^(?:\/(?!\/)|https?:\/\/)[^\s"'<>\\]+$/;

function isBootUrl(value: unknown): value is string {
  return typeof value === "string" && BOOT_URL_RE.test(value);
}

/**
 * Tryb bootu dla dopasowania: `lcp` wyłącznie dla liścia z {@link AFTER_LCP_ROUTE_IDS},
 * dopasowanego z sukcesem, gdy żadna trasa nie wyłącza SSR i dokument nie jest powłoką SPA.
 */
export function bootModeFor(matches: readonly BootMatch[], isShell = false): BootMode {
  if (isShell) return "now";
  if (matches.some((match) => match.ssr === false || match.ssr === "data-only")) return "now";
  const leaf = matches.at(-1);
  if (!leaf || leaf.status !== "success") return "now";
  return AFTER_LCP_ROUTE_IDS.has(leaf.routeId) ? "lcp" : "now";
}

export interface ComposeBootSetInput {
  readonly manifest: BootManifest;
  readonly mode: BootMode;
  /** Chunk rdzenia słownika aktywnego języka (`null` poza buildem). */
  readonly dictionary: string | null;
  readonly matches: readonly BootMatch[];
  /** Akumulator nagłówka `Link` tego żądania w chwili dehydratacji. */
  readonly linkHeader?: string | null;
}

/** Skład zestawu (kolejność, grupy i reguły w nagłówku pliku). Funkcja czysta. */
export function composeBootSet(input: ComposeBootSetInput): BootSet {
  const { manifest } = input;
  const urls = new Set<string>();
  const add = (url: unknown) => {
    if (isBootUrl(url)) urls.add(url);
  };
  // Granica = liczba URL-i po domknięciu grupy; URL powtórzony w późniejszej grupie zostaje
  // w pierwszej (deduplikacja `Set`), więc granice liczą się po deduplikacji.
  const bounds: number[] = [];
  add(manifest.entry);
  manifest.rootPreloads.forEach(add);
  bounds.push(urls.size);
  add(input.dictionary);
  for (const match of input.matches) {
    // `hasOwn`: id trasy jest kluczem danych - `constructor` czy `__proto__` nie mogą trafić
    // w prototyp obiektu.
    if (Object.hasOwn(manifest.routePreloads, match.routeId)) {
      manifest.routePreloads[match.routeId].forEach(add);
    }
  }
  bounds.push(urls.size);
  modulePreloadTargets(input.linkHeader).forEach(add);
  const set: BootSet = { m: input.mode, e: manifest.entry, u: [...urls] };
  if (input.mode !== "lcp") return set;
  // Bez pustych grup: granica na początku, na końcu albo równa poprzedniej nic nie dzieli.
  const g = bounds.filter((at, i) => at > 0 && at < urls.size && at !== bounds[i - 1]);
  return g.length ? { ...set, g } : set;
}

/** Węzeł danych zestawu: `<` jako `\u003c`, więc treść nie domknie `</script>`. */
export function bootSetHtml(set: BootSet): string {
  const json = JSON.stringify(set).replace(/</g, "\\u003c");
  return `<script type="application/json" id="${BOOT_SET_ELEMENT_ID}">${json}</script>`;
}

/** Instancje `serverSsr`, które już dostały zestaw (jeden węzeł na dokument). */
const injectedInto = new WeakSet<object>();

function requestLinkHeader(): string | null {
  try {
    return getResponseHeader("link") ?? null;
  } catch {
    // Poza zasięgiem żądania h3 (test, prerender) - bez hintów loaderów.
    return null;
  }
}

/** Wartość `Link` dla jednego modułu serii (dokument w trybie `now`). */
export function bootPreloadLinkValue(url: string): string {
  return `<${url}>; rel="modulepreload"`;
}

/**
 * Wstrzykuje `#nes-boot-set` do dokumentu tego żądania i ustawia nagłówki trybu (patrz
 * „NAGŁÓWEK `Link`" wyżej). No-op bez `serverSsr` (render poza żądaniem), bez mapy
 * (`BOOT_MANIFEST === null`: vitest, dev, build bez wtyczki - dokument startuje wtedy przez
 * `<Scripts>` frameworka) i przy drugim wywołaniu dla tego samego dokumentu. `manifest` -
 * wyłącznie dla testu.
 */
export function injectBootSet(
  router: BootRouterLike,
  manifest: BootManifest | null = BOOT_MANIFEST,
): void {
  const ssr = router.serverSsr;
  if (!ssr || !manifest || injectedInto.has(ssr)) return;
  injectedInto.add(ssr);
  const matches = router.state.matches;
  const linkHeader = requestLinkHeader();
  const set = composeBootSet({
    manifest,
    mode: bootModeFor(matches, router.isShell?.() ?? false),
    dictionary: LOCALE_CHUNK_URLS[currentLang()],
    matches,
    linkHeader,
  });
  ssr.injectHtml(bootSetHtml(set));
  try {
    setResponseHeader(BOOT_MODE_HEADER, set.m);
  } catch {
    // Poza zasięgiem żądania h3 - nie ma odpowiedzi, której `Link` trzeba by przyciąć.
    return;
  }
  if (set.m !== "now") return;
  // Moduły, które loadery już podały w `Link` (słownik, widgety), zostają w swoim wpisie.
  const hinted = new Set(modulePreloadTargets(linkHeader));
  for (const url of set.u) if (!hinted.has(url)) appendLinkHeader(bootPreloadLinkValue(url));
}
