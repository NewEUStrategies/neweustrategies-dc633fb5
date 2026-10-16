// ZESTAW BOOTU PER ŻĄDANIE (P2.1, krok 1) - serwer składa listę modułów, które przeglądarka
// pobierze JEDNĄ serią w chwili bootu; węzeł `#nes-boot-set` z tą listą renderuje w `<head>`
// `BootSetNode` (`bootSetNode.tsx`).
//
// PO CO. Manifest TanStack Start nie niesie już preloadów ani skryptu wejścia
// (`scripts/lib/bootAfterLcpPlugin.ts`), więc dokument nie startuje JS-a sam. Startuje go
// klasyczny skrypt z `<head>` (`bootLoaderScript.ts`) - po wpisie LCP na stronach z kandydatem,
// od razu wszędzie indziej. Loader potrzebuje listy URL-i, a ta zależy od żądania: języka
// (słownik), dopasowanych tras (chunki tras) i dokumentu buildera (chunki widgetów nad zgięciem
// i nagłówka). Klient tej listy nie policzy - nie zna nazw chunków słownika ani widgetów
// (`localeChunks.ts`, `widgetPreloads.ts`) - więc węzeł istnieje wyłącznie w HTML-u serwera,
// a w przeglądarce `BootSetNode` renderuje w tym miejscu `null` (tożsamość hydratacji: opis
// w `bootSetNode.tsx`).
//
// SKŁAD, w tej kolejności (kolejność żądań serii):
//   1. wejście klienta + preloady korzenia (statyczne domknięcie wejścia) z `BOOT_MANIFEST`;
//   2. chunk rdzenia słownika aktywnego języka (`LOCALE_CHUNK_URLS`);
//   3. preloady dopasowanych tras (chunki komponentów tras i ich statyczne domknięcie importów -
//      `bootManifest.ts`);
//   4. każdy `modulepreload` dołożony przez loadery tego żądania do akumulatora nagłówka `Link`
//      (`appendLinkHeader`): chunki widgetów nagłówka (`__root.tsx`) i sekcji nad zgięciem
//      (`index.tsx`, `$.tsx`), czyli warunek CLS 0 z werdyktu boot-js C3 (leniwa granica
//      widgetu nad zgięciem ma swój chunk w tej samej serii co wejście).
// Punkt 4 czyta akumulator `Link` per żądanie (`readLinkHeader`, `responseHeaders.ts`) w chwili
// dehydratacji: loadery już się skończyły, a ich hinty modułów leżą w jednym miejscu. Dzięki
// temu każdy hint modułu dołożony przez loader trafia do serii bootu.
//
// NAGŁÓWEK `Link`. Tryb dokumentu idzie kanałem per żądanie (`recordBootMode`,
// `frameworkPreloads.server.ts`), który czyta granica odpowiedzi `fetchWithFrameworkPreloads` -
// nie trafia ani do klienta, ani do cache dokumentu:
//   - `lcp`: z `Link` znika KAŻDY `modulepreload` (słownik, widgety) - żaden JS nie rusza przed
//     wyzwalaczem loadera, zostają CSS, fonty i obraz kandydata;
//   - `now`: `Link` dostaje `modulepreload` serii (jak dawniej preloady manifestu), więc
//     panel, konto i trasy bez SSR pobierają JS od nagłówków odpowiedzi, a nie dopiero po
//     arkuszu stylów, na który czeka loader w `<head>`. Seria w nagłówku ma budżet bajtów
//     (`BOOT_LINK_PRELOAD_BUDGET_BYTES`), bo preloady manifestu to od start-plugin-core 1.171.53
//     pełne domknięcie statyczne: na Rolldownie bez grupy `app-initial` `/cookies` dostawał
//     ~330 wpisów i klient Node (llhttp, limit 16 KB na nagłówki) odrzucał odpowiedź
//     („Header overflow" w boot-teście artefaktu); proxy z buforem nagłówków 4-8 KB (nginx) też.
//     Ogon ponad budżet i tak pobiera loader bootu z `#nes-boot-set` - obcięcie zmienia tylko,
//     jak wcześnie rusza; kolejność serii (wejście, korzeń, słownik, trasa) zostaje.
// Na HIT `Link` pochodzi z wpisu cache (zapisanego już po tej decyzji), a render nie biegnie,
// więc trybu nie ma.
//
// TRYB. `lcp` (boot po wpisie LCP kandydata) wyłącznie dla publicznych tras SSR z kandydatem LCP:
// strona główna (`/`, także `/en` po przepisaniu adresu) i strony treści (`/$`), dopasowane
// z sukcesem i renderowane na serwerze. Wszędzie indziej `now` - trasy `ssr: false`, panel,
// konto, 404 i błędy nie mają kandydata, a odroczenie tylko opóźniłoby ich start. Decyzje per
// użytkownik (zapisana sesja, ramka edytora, `document.prerendering`) podejmuje loader
// w przeglądarce: dokument jest anonimowy i trafia do NES Edge Cache razem z zestawem.
//
// GDZIE SKŁAD, GDZIE WĘZEŁ. Skład biegnie w owijce `router.options.dehydrate` (`src/router.tsx`):
// po `router.load()` (dopasowania i loadery gotowe), przed renderem Reacta, raz na żądanie.
// Wynik czeka w rejestrze kluczowanym routerem żądania (`bootSetRegistry.ts`), a renderuje go
// `BootSetNode` w `<head>` zaraz po `<HeadContent />`, przed sondą i loaderem bootu. Powłoka
// dokumentu wychodzi tak samo na ścieżce strumieniowej, `allReady` (boty, w tym
// `Chrome-Lighthouse`, którego PSI dostaje na MISS) i `renderToString`, więc węzeł stoi w tym
// samym miejscu na każdej z nich. Router-core 1.171.37 nie ma już kanału HTML (`injectHtml`
// zniknęło), a skrypty hydratacji (`<Scripts>`) stoją w `<body>` - za późno dla loadera.
//
// BEZPIECZEŃSTWO TREŚCI. URL-e pochodzą z builda (manifest, mapy chunków), nie z żądania; mimo
// to każdy przechodzi wąski filtr ścieżki/adresu, a JSON ma `<` zamienione na `\u003c`, więc
// treść nie domknie `</script>`.
import { appendLinkHeader, readLinkHeader } from "@/lib/http/responseHeaders";
import { currentLang } from "@/lib/i18n/localeRuntime";
import { LOCALE_CHUNK_URLS } from "@/lib/seo/localeChunks";

import {
  modulePreloadTargets,
  recordBootMode,
  type BootMode,
} from "@/lib/http/frameworkPreloads.server";

import { BOOT_MANIFEST, type BootManifest } from "./bootManifest";
import { BOOT_SET_ELEMENT_ID } from "./bootSetId";
import { getBootSetJson, setBootSetJson } from "./bootSetRegistry";

export { BOOT_SET_ELEMENT_ID };
export type { BootMode };

/**
 * Zestaw bootu w dokumencie. Klucze jednoliterowe, bo węzeł stoi w `<head>` każdego dokumentu
 * (budżet `headRawBytes`): `m` tryb, `e` wejście, `u` URL-e serii (wejście pierwsze).
 */
export interface BootSet {
  readonly m: BootMode;
  readonly e: string;
  readonly u: readonly string[];
}

/** Trasy publiczne SSR z kandydatem LCP (id tras routera; `/en` przepisuje się na `/`). */
export const AFTER_LCP_ROUTE_IDS: ReadonlySet<string> = new Set(["/", "/$"]);

/** Dopasowanie trasy - tylko pola, które czyta skład zestawu. */
export interface BootMatch {
  readonly routeId: string;
  readonly status?: string;
  readonly ssr?: boolean | "data-only";
}

/**
 * Router w chwili dehydratacji - tylko to, czego potrzebuje skład. `serverSsr` jest obecny
 * wyłącznie w zasięgu renderu żądania SSR (router-core dokłada go przed dehydratacją i zdejmuje
 * w sprzątaniu); jego API nie jest tu potrzebne.
 */
export interface BootRouterLike {
  readonly serverSsr?: object;
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

/** Skład zestawu (kolejność i reguły w nagłówku pliku). Funkcja czysta. */
export function composeBootSet(input: ComposeBootSetInput): BootSet {
  const { manifest } = input;
  const urls = new Set<string>();
  const add = (url: unknown) => {
    if (isBootUrl(url)) urls.add(url);
  };
  add(manifest.entry);
  manifest.rootPreloads.forEach(add);
  add(input.dictionary);
  for (const match of input.matches) {
    // `hasOwn`: id trasy jest kluczem danych - `constructor` czy `__proto__` nie mogą trafić
    // w prototyp obiektu.
    if (Object.hasOwn(manifest.routePreloads, match.routeId)) {
      manifest.routePreloads[match.routeId].forEach(add);
    }
  }
  modulePreloadTargets(input.linkHeader).forEach(add);
  return { m: input.mode, e: manifest.entry, u: [...urls] };
}

/** Treść węzła danych zestawu: JSON z `<` jako `\u003c`, więc nie domknie `</script>`. */
export function bootSetJson(set: BootSet): string {
  return JSON.stringify(set).replace(/</g, "\\u003c");
}

/**
 * Znaczniki węzła danych zestawu - bajt w bajt to, co renderuje `BootSetNode` (kontrakt
 * regexów e2e i `documentWeight.ts`; parytet pilnuje `bootSet.server.test.ts`).
 */
export function bootSetHtml(set: BootSet): string {
  return `<script type="application/json" id="${BOOT_SET_ELEMENT_ID}">${bootSetJson(set)}</script>`;
}

/** Wartość `Link` dla jednego modułu serii (dokument w trybie `now`). */
export function bootPreloadLinkValue(url: string): string {
  return `<${url}>; rel="modulepreload"`;
}

/**
 * Budżet serii `modulepreload` w nagłówku `Link` dokumentu `now`, w bajtach (z separatorem
 * `", "` każdego wpisu). Zmierzone 2026-10-16 na artefakcie z grupą `app-initial`: 223 z 336 tras
 * mieści się w 2 KB, najdłuższa (`/admin/posts/$slug`, 127 modułów) zajmuje 7,3 KB - ta i kilka
 * podobnych tras adminowych tracą w nagłówku sam ogon serii. 6 KB serii obok CSS, fontów i obrazu
 * kandydata trzyma cały blok nagłówków daleko od 16 KB klienta Node.
 */
export const BOOT_LINK_PRELOAD_BUDGET_BYTES = 6 * 1024;

/**
 * Wpisy `Link` serii trybu `now`: moduły zestawu w jego kolejności, bez tych, które loadery już
 * podały w `Link` (`hinted`), dopóki mieszczą się w budżecie - pierwszy, który się nie mieści,
 * kończy serię (prefiks, nie wybór „co się zmieści"). Funkcja czysta.
 */
export function bootPreloadLinkValues(
  urls: readonly string[],
  hinted: ReadonlySet<string>,
  budget = BOOT_LINK_PRELOAD_BUDGET_BYTES,
): string[] {
  const out: string[] = [];
  let left = budget;
  for (const url of urls) {
    if (hinted.has(url)) continue;
    const value = bootPreloadLinkValue(url);
    left -= value.length + 2;
    if (left < 0) break;
    out.push(value);
  }
  return out;
}

/**
 * Składa zestaw `#nes-boot-set` dla dokumentu tego żądania (render: `BootSetNode`), zapisuje
 * tryb i dokłada nagłówek `Link` trybu `now` (patrz „NAGŁÓWEK `Link`" wyżej). No-op bez
 * `serverSsr` (render poza żądaniem), bez mapy (`BOOT_MANIFEST === null`: vitest, dev, build bez
 * wtyczki - dokument startuje wtedy przez `<Scripts>` frameworka) i przy drugim wywołaniu dla
 * tego samego routera. Poza zasięgiem żądania (test, prerender) kanały trybu i `Link` są no-opem.
 * `manifest` - wyłącznie dla testu.
 */
export function prepareBootSet(
  router: BootRouterLike,
  manifest: BootManifest | null = BOOT_MANIFEST,
): void {
  if (!router.serverSsr || !manifest || getBootSetJson(router) !== undefined) return;
  const matches = router.state.matches;
  const linkHeader = readLinkHeader();
  const set = composeBootSet({
    manifest,
    mode: bootModeFor(matches, router.isShell?.() ?? false),
    dictionary: LOCALE_CHUNK_URLS[currentLang()],
    matches,
    linkHeader,
  });
  setBootSetJson(router, bootSetJson(set));
  recordBootMode(set.m);
  if (set.m !== "now") return;
  // Moduły, które loadery już podały w `Link` (słownik, widgety), zostają w swoim wpisie.
  const hinted = new Set(modulePreloadTargets(linkHeader));
  for (const value of bootPreloadLinkValues(set.u, hinted)) appendLinkHeader(value);
}
