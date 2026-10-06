// Wtyczka: manifest TanStack Start BEZ preloadów i BEZ skryptu wejścia (P2.1, boot po LCP).
// Plan: docs/performance/2026-10-03-pagespeed-85-95/faza2/PLAN-FALE-1-2.md §3.2; dowód parytetu
// (krok 0): faza2/raporty/P2.1-SPIKE.md.
//
// PO CO. Boot po LCP wymaga, żeby dokument NIE startował JS-a sam: bez tej wtyczki `<HeadContent>`
// renderuje z manifestu `<link rel="modulepreload">` korzenia i dopasowanych tras, `<Scripts>`
// renderuje `<script type="module" async src="/assets/index-*.js">`, a kolektor `onEarlyHints`
// (`src/lib/http/frameworkPreloads.server.ts`) dawał te same preloady do nagłówka `Link`.
// Lantern liczy każdy taki chunk zakończony przed obserwowanym LCP do grafu LCP (werdykt
// boot-js C3), więc zestaw bootu ma ruszyć dopiero po LCP - a to umie tylko loader spoza
// manifestu (`src/lib/boot/bootLoaderScript.ts` + zestaw `#nes-boot-set` z `bootSet.server.ts`).
//
// GDZIE. Wirtualny moduł `tanstack-start-manifest:v` w środowisku SERWERA (`ssr`), czyli JEDYNE
// źródło manifestu: z niego `getStartManifest()` (start-server-core `router-manifest.js`) składa
// manifest bazowy, który (a) renderują `<HeadContent>`/`<Scripts>` na serwerze, (b) zbiera
// kolektor `onEarlyHints` (`Link`) i (c) jedzie do klienta w odwodnionym `$_TSR.router.manifest`
// (router-core `ssr-server.js` `dehydrate`), skąd klient renderuje te same komponenty
// (`ssr-client.js`: `router.ssr = { manifest }`). Przepisanie modułu zmienia więc wszystkie trzy
// drogi NARAZ - serwer i klient renderują to samo (nic), parytet hydratacji trzyma się
// konstrukcyjnie, a nie dzięki dyscyplinie dwóch kopii.
//
// DLACZEGO NIE `transformAssets` FRAMEWORKA. Umie przepisać wyłącznie `href`/`crossOrigin`
// (`start-server-core/transformAssetUrls.js`), nie usunie preloadów ani skryptu wejścia.
//
// CO ZOSTAJE. CSS tras (`css`), format skryptów, inline CSS i pola tras (`filePath`,
// `children`) - bez zmian. Znika WYŁĄCZNIE `preloads` każdej trasy i modułowy skrypt wejścia
// korzenia; oba przechodzą do `BOOT_MANIFEST` (eksport `nesBootManifest` tego samego modułu).
//
// JAK SERWER CZYTA MAPĘ. Plik-zaślepka `src/lib/boot/bootManifest.ts` (`BOOT_MANIFEST = null`)
// wtyczka zamienia w `ssr` na reeksport `nesBootManifest` z przepisanego modułu - ten sam wzorzec
// co `localeChunks.ts`. Vitest i dev widzą jawne `null`. Słownika i mapy widgetów tu NIE MA:
// serwer ma je w `LOCALE_CHUNK_URLS` i `WIDGET_CHUNK_URLS` (własne wtyczki), a duplikat byłby
// drugim kontraktem bez zysku.
//
// AWARIA JEST GŁOŚNA. Moduł w nieznanym kształcie (aktualizacja TanStack Start) albo zaślepka bez
// deklaracji do podmiany przerywa build (`this.error`): ciche pominięcie oznaczałoby dokument
// z loaderem bootu I skryptem wejścia albo bez mapy, a ciche częściowe przepisanie - dokument bez
// żadnej drogi do JS-a (martwa hydratacja na każdej stronie, klasa incydentu 2026-07-20).
//
// TYLKO BUILD. W dev manifest jest pusty z konstrukcji (TanStack zwraca wpis klienta deweloperskiego
// `/@id/...`), a dev-server nie ma chunków - przepisywać nie ma czego.
import type { Plugin } from "vite";

import type { BootManifest } from "../../src/lib/boot/bootManifest";

export type { BootManifest };

/** Id wirtualnego modułu manifestu po rozwiązaniu (`resolveViteId` = prefiks `\0`). */
export const START_MANIFEST_MODULE_ID = "\0tanstack-start-manifest:v";

/** Nazwa środowiska serwera TanStack Start (`START_ENVIRONMENT_NAMES.server`). */
const SERVER_ENVIRONMENT = "ssr";

/** Zaślepka mapy w źródłach - podmieniana w `ssr` na reeksport `nesBootManifest`. */
export const BOOT_MANIFEST_MODULE_SUFFIX = "/src/lib/boot/bootManifest.ts";

/**
 * Deklaracja zaślepki PO transpilacji TS (wtyczka biegnie z `enforce: "post"`, więc adnotacja
 * typu jest już zdjęta). Wąsko: nazwa i `null`, bez flagi `g` (`lastIndex` współdzielonego
 * wyrażenia fałszowałby kolejne wywołania).
 */
const BOOT_MANIFEST_PLACEHOLDER_RE = /export\s+const\s+BOOT_MANIFEST\s*=\s*null\s*;?/;

/** Reeksport mapy z przepisanego modułu manifestu (rozwiązuje go `resolveId` frameworka). */
const BOOT_MANIFEST_REEXPORT =
  'export { nesBootManifest as BOOT_MANIFEST } from "tanstack-start-manifest:v";';

/** Szablon `load()` z `start-plugin-core/vite/start-manifest-plugin/plugin.js`. */
const MODULE_PREFIX = "export const tsrStartManifest = ";

/** Trasa manifestu - tylko pola, które wtyczka czyta lub przepisuje. */
interface StartManifestRoute {
  preloads?: unknown;
  scripts?: unknown;
  [key: string]: unknown;
}

interface StartManifest {
  routes: Record<string, StartManifestRoute>;
  scriptFormat?: unknown;
  [key: string]: unknown;
}

export interface SplitStartManifest {
  /** Manifest dla TanStack Start: bez `preloads`, korzeń bez skryptu wejścia. */
  readonly manifest: StartManifest;
  readonly boot: BootManifest;
}

const ROOT_ROUTE_ID = "__root__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Skrypt wejścia z `appendEntryChunkScripts` (manifestBuilder.js): moduł z `src`, bez treści. */
function isEntryScript(value: unknown): value is { attrs: { src: string } } {
  return (
    isRecord(value) &&
    isRecord(value.attrs) &&
    value.attrs.type === "module" &&
    typeof value.attrs.src === "string" &&
    value.children === undefined
  );
}

/**
 * Wartość musi przejść przez JSON bez strat - emitujemy ją literałem JSON. Wyjątek: pole obiektu
 * równe `undefined` (seroval pisze `children:void 0` dla trasy-liścia) - JSON je pomija, a
 * nieobecne pole i `undefined` czytają się w frameworku tak samo (`route.children?.length`).
 */
function assertJsonData(value: unknown, path: string): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonData(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) assertJsonData(item, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path}: wartość spoza JSON (${typeof value})`);
}

/**
 * Dzieli manifest na manifest frameworka i BOOT_MANIFEST. Funkcja czysta; rzuca przy każdym
 * odstępstwie od znanego kształtu (wołający zamienia to na błąd builda).
 */
export function splitStartManifest(input: unknown): SplitStartManifest {
  if (!isRecord(input) || !isRecord(input.routes)) throw new Error("manifest bez `routes`");
  assertJsonData(input, "manifest");
  if (input.scriptFormat !== undefined && input.scriptFormat !== "module") {
    // `iife` dokłada importy wejścia jako osobne skrypty - innego kształtu nie znamy.
    throw new Error(`nieobsługiwany scriptFormat: ${String(input.scriptFormat)}`);
  }
  const root = input.routes[ROOT_ROUTE_ID];
  if (!isRecord(root)) throw new Error("manifest bez trasy korzenia");
  const scripts = Array.isArray(root.scripts) ? root.scripts : [];
  const entryScripts = scripts.filter(isEntryScript);
  if (entryScripts.length !== 1) {
    throw new Error(`korzeń ma ${entryScripts.length} modułowych skryptów wejścia (oczekiwano 1)`);
  }
  const [entryScript] = entryScripts;
  const entry = entryScript.attrs.src;

  const routes: Record<string, StartManifestRoute> = {};
  const routePreloads: Record<string, string[]> = {};
  let rootPreloads: string[] = [];
  for (const [routeId, route] of Object.entries(input.routes)) {
    if (!isRecord(route)) throw new Error(`trasa ${routeId} nie jest obiektem`);
    const { preloads, ...rest } = route;
    if (preloads !== undefined && !isStringArray(preloads)) {
      throw new Error(`trasa ${routeId}: preloads nie są listą adresów`);
    }
    const list = isStringArray(preloads) ? preloads : [];
    if (routeId === ROOT_ROUTE_ID) {
      rootPreloads = list;
      const remaining = scripts.filter((script) => script !== entryScript);
      if (remaining.length > 0) rest.scripts = remaining;
      else delete rest.scripts;
    } else if (list.length > 0) {
      routePreloads[routeId] = list;
    }
    routes[routeId] = rest;
  }
  return {
    manifest: { ...input, routes },
    boot: { entry, rootPreloads, routePreloads },
  };
}

/** Ewaluuje kod modułu z `load()` frameworka i zwraca wynik `tsrStartManifest()`. */
export function evaluateStartManifestModule(code: string): unknown {
  const source = code.trim();
  if (!source.startsWith(MODULE_PREFIX)) {
    throw new Error(`moduł nie zaczyna się od "${MODULE_PREFIX.trim()}"`);
  }
  // Kod jest wynikiem `seroval.serialize()` na danych builda (nie na danych z żądania), bez
  // importów - samodzielne wyrażenie. Ewaluacja zamiast parsowania tekstu, bo seroval może
  // wyciągać współdzielone referencje do IIFE i żaden wzorzec tekstowy tego nie przeżyje.
  const factory: unknown = new Function(
    `"use strict"; return ${source.slice(MODULE_PREFIX.length)}`,
  )();
  if (typeof factory !== "function") throw new Error("tsrStartManifest nie jest funkcją");
  const manifest: unknown = Reflect.apply(factory, undefined, []);
  return manifest;
}

/** Nowy kod modułu: manifest bez preloadów i skryptu wejścia + BOOT_MANIFEST. */
export function rewriteStartManifestModule(code: string): {
  code: string;
  boot: BootManifest;
} {
  const { manifest, boot } = splitStartManifest(evaluateStartManifestModule(code));
  const out = [
    "// nes:boot-after-lcp (scripts/lib/bootAfterLcpPlugin.ts): preloady i skrypt wejścia",
    "// przeniesione z manifestu TanStack Start do BOOT_MANIFEST (P2.1).",
    `export const nesBootManifest = ${JSON.stringify(boot)};`,
    // Funkcja zwraca NOWY obiekt przy każdym wywołaniu, jak oryginał frameworka.
    `export const tsrStartManifest = () => (${JSON.stringify(manifest)});`,
    "",
  ].join("\n");
  return { code: out, boot };
}

/** Kształt środowiska z kontekstu hooka (Vite 6+ wstrzykuje `this.environment`). */
type EnvironmentLike = { name?: string; config?: { consumer?: string } };

function environmentOf(ctx: unknown): EnvironmentLike | undefined {
  const env = (ctx as { environment?: EnvironmentLike } | null | undefined)?.environment;
  return env && typeof env === "object" ? env : undefined;
}

/**
 * Kod zaślepki `bootManifest.ts` z reeksportem mapy zamiast `null`, albo `null`, gdy deklaracji
 * nie ma (wołający zamienia to na błąd builda). Funkcja czysta; zmienia WYŁĄCZNIE deklarację, więc
 * ewentualne inne eksporty pliku zostają.
 */
export function rewriteBootManifestPlaceholder(code: string): string | null {
  if (!BOOT_MANIFEST_PLACEHOLDER_RE.test(code)) return null;
  return code.replace(BOOT_MANIFEST_PLACEHOLDER_RE, () => BOOT_MANIFEST_REEXPORT);
}

export function bootAfterLcpPlugin(): Plugin {
  return {
    name: "nes:boot-after-lcp",
    apply: "build",
    // Po `load()` frameworka (kolejność transformów wirtualnego modułu nie ma innych chętnych)
    // i po transpilacji TS zaślepki (wzorzec deklaracji bez adnotacji typu).
    enforce: "post",
    transform(code, id) {
      const env = environmentOf(this);
      // Klient i inne środowiska dostają od frameworka pusty manifest deweloperski - nie nasz;
      // zaślepka w bundlu przeglądarki zostaje `null` (klient jej nie importuje).
      if (env?.name !== SERVER_ENVIRONMENT) return null;
      if (id.replaceAll("\\", "/").endsWith(BOOT_MANIFEST_MODULE_SUFFIX)) {
        const rewritten = rewriteBootManifestPlaceholder(code);
        if (rewritten === null) {
          this.error(
            "nes:boot-after-lcp - brak deklaracji `export const BOOT_MANIFEST = null` w " +
              `${BOOT_MANIFEST_MODULE_SUFFIX}; serwer nie dostałby mapy zestawu bootu`,
          );
        }
        return { code: rewritten, map: null };
      }
      if (id !== START_MANIFEST_MODULE_ID) return null;
      try {
        const { code: rewritten, boot } = rewriteStartManifestModule(code);
        const routes = Object.keys(boot.routePreloads).length;
        this.info(
          `nes:boot-after-lcp - manifest bez preloadów: entry ${boot.entry}, ` +
            `korzeń ${boot.rootPreloads.length}, trasy ${routes}`,
        );
        return { code: rewritten, map: null };
      } catch (error) {
        this.error(
          `nes:boot-after-lcp - nieznany kształt manifestu TanStack Start (${
            error instanceof Error ? error.message : String(error)
          }); boot po LCP wymaga aktualizacji wtyczki`,
        );
      }
    },
  };
}
