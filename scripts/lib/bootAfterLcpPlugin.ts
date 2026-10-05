// Wtyczka: manifest TanStack Start BEZ preloadów i BEZ skryptu wejścia (P2.1, krok 0 - spike
// parytetu). Plan: docs/performance/2026-10-03-pagespeed-85-95/faza2/PLAN-FALE-1-2.md §3.2.
//
// PO CO. Boot po LCP wymaga, żeby dokument NIE startował JS-a sam: dziś `<HeadContent>` renderuje
// z manifestu `<link rel="modulepreload">` korzenia i dopasowanych tras, `<Scripts>` renderuje
// `<script type="module" async src="/assets/index-*.js">`, a `fetchWithFrameworkPreloads`
// (`src/lib/http/frameworkPreloads.server.ts`) kopiuje te same preloady do nagłówka `Link`.
// Lantern liczy każdy taki chunk zakończony przed obserwowanym LCP do grafu LCP (werdykt
// boot-js C3), więc zestaw bootu ma ruszyć dopiero po LCP - a to umie tylko loader spoza
// manifestu.
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
// AWARIA JEST GŁOŚNA. Moduł w nieznanym kształcie (aktualizacja TanStack Start) przerywa build
// (`this.error`): ciche pominięcie oznaczałoby dokument z loaderem bootu I skryptem wejścia,
// a ciche częściowe przepisanie - dokument bez żadnej drogi do JS-a (martwa hydratacja na
// każdej stronie, klasa incydentu 2026-07-20).
//
// TYLKO BUILD. W dev manifest jest pusty z konstrukcji (TanStack zwraca wpis klienta deweloperskiego
// `/@id/...`), a dev-server nie ma chunków - przepisywać nie ma czego.
//
// SPIKE: `BOOT_MANIFEST` trafia dodatkowo pod `globalThis[Symbol.for("nes.bootManifest")]` przy
// ewaluacji modułu (moduł ładuje `getStartManifest()` przed `router.load()` każdego dokumentu).
// To przekazanie istnieje wyłącznie dla rusztowania spike'u w `src/routes/__root.tsx`; docelowo
// `bootSet.server.ts` czyta mapę z pliku-zaślepki podmienianego tą wtyczką (wzorzec
// `localeChunks.ts`), a ten wpis znika.
import type { Plugin } from "vite";

/** Id wirtualnego modułu manifestu po rozwiązaniu (`resolveViteId` = prefiks `\0`). */
export const START_MANIFEST_MODULE_ID = "\0tanstack-start-manifest:v";

/** Nazwa środowiska serwera TanStack Start (`START_ENVIRONMENT_NAMES.server`). */
const SERVER_ENVIRONMENT = "ssr";

/** Klucz przekazania mapy rusztowaniu spike'u (patrz nagłówek). */
export const BOOT_MANIFEST_GLOBAL_KEY = "nes.bootManifest";

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

/** Serwerowa mapa zestawu bootu (BOOT_MANIFEST). */
export interface BootManifest {
  /** Moduł wejściowy klienta (dotąd `<script type="module" async>` z `<Scripts>`). */
  readonly entry: string;
  /** Preloady korzenia: entry + jego statyczne importy (jeden poziom, kolejność manifestu). */
  readonly rootPreloads: readonly string[];
  /** Preloady pozostałych tras: id trasy -> chunki trasy + ich bezpośrednie importy. */
  readonly routePreloads: Readonly<Record<string, readonly string[]>>;
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
    "// SPIKE P2.1: przekazanie rusztowaniu w src/routes/__root.tsx (patrz nagłówek wtyczki).",
    `globalThis[Symbol.for(${JSON.stringify(BOOT_MANIFEST_GLOBAL_KEY)})] = nesBootManifest;`,
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

export function bootAfterLcpPlugin(): Plugin {
  return {
    name: "nes:boot-after-lcp",
    apply: "build",
    // Po `load()` frameworka; kolejność transformów wirtualnego modułu nie ma innych chętnych.
    enforce: "post",
    transform(code, id) {
      if (id !== START_MANIFEST_MODULE_ID) return null;
      const env = environmentOf(this);
      // Klient i inne środowiska dostają od frameworka pusty manifest deweloperski - nie nasz.
      if (env?.name !== SERVER_ENVIRONMENT) return null;
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
