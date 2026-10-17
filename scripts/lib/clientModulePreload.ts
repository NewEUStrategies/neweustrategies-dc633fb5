// Listy preloadu `import()` bundla PRZEGLĄDARKI: `build.modulePreload.resolveDependencies`.
//
// JEDNO ŹRÓDŁO dla vite.config.ts i vite.smoke.config.ts (oba presety biorą jeden obiekt
// `clientModulePreload()`: `modulePreload` w środowisku `client` + `plugin` w `plugins` - parytet:
// src/lib/ci/__tests__/viteChunkParity.test.ts), więc boot-test smoke bada te same listy, które
// jadą na produkcję. Worker i SSR list nie mają (Vite wstawia `__vitePreload` wyłącznie
// konsumentowi `client`).
//
// CO TO JEST. Vite przepisuje każdy `import()` klienta na `__vitePreload(() => import(x), deps)`.
// `deps` to cel i CAŁE domknięcie jego statycznych importów: przy `hoistTransitiveImports: false`
// (vite.config.ts) nagłówek chunku niesie tylko bezpośrednie krawędzie, więc bez listy
// przeglądarka odkrywa domknięcie poziom po poziomie. Nazwy plików lądują w tablicy `m.f`
// chunku, który robi import (`__vite__mapDeps`), indeksy - przy każdym wywołaniu. Drzewo tras
// siedzi w `app-initial` (boot każdej strony), więc to on płacił za listy WSZYSTKICH tras:
// 30,7 KB gzip z 265 KB chunku (main 75d90e1: 1265 nazw, 392 z nich wyłącznie adminowe).
//
// DWIE REGUŁY (obie wyłącznie dla `hostType: "js"`; lista HTML-owa to preload wejścia, nie rusza):
//
// 1. CEL W KORZENIU /admin -> PUSTA LISTA. Korzeń to chunk trasy /admin (`admin.*-<hash>.js`)
//    albo jej layoutu (`admin-<hash>.js`) - ta sama granica produktu i TO SAMO wyrażenie co
//    `ADMIN_ROOT` w scripts/check-bundle-size.ts (test pilnuje równości). Chunki tras /admin
//    importuje wyłącznie drzewo tras, więc ich listy czytelnik pobierał na każdej stronie, a nie
//    używał nigdy. CENA, NAZWANA UCZCIWIE: pierwsza nawigacja SPA do ekranu /admin w sesji pobiera
//    zależności chunku trasy kaskadą (bez hoistowania: tyle rund, ile poziomów statycznego grafu
//    trasy poza bootem - na 75d90e1 zwykle 4-5, najgłębiej 8). Łagodzi to preload trasy na
//    intencję (`defaultPreload: "intent"`, src/router.tsx: import rusza po 50 ms najechania,
//    przed kliknięciem), kolejne ekrany dzielą większość chunków (już w pamięci modułów), a pełne
//    wejście na URL /admin w ogóle tej listy nie używa - serwer daje dopasowanym trasom pełne
//    domknięcie w zestawie bootu (`routePreloads`, src/lib/boot/bootManifest.ts). Wyjątek jak
//    niżej: import celu /admin, który niesie CSS, zachowuje `[cel]` (na 75d90e1 żaden).
//
// 2. CHUNKI DOMKNIĘCIA BOOTU WYPADAJĄ Z KAŻDEJ LISTY. Wejście importuje je statycznie, a moduł nie
//    wykona się, zanim przeglądarka nie pobierze i nie zlinkuje CAŁEGO jego statycznego grafu - więc
//    gdy biegnie jakikolwiek `import()`, te chunki są już w pamięci modułów i ich preload niczego nie
//    pobiera (Vite i tak pomijał je w runtime, jeśli `<link>` już był). Nazwy z oznaczeń `boot(...)`
//    przy definicjach grup (`BOOT_CHUNK_NAMES`, scripts/lib/clientChunkGroups.ts), nie z ręcznej
//    listy; że każda z nich naprawdę jest w domknięciu wejścia artefaktu, sprawdza
//    check:entry-purity (`isBootChunkFile` niżej - ten sam predykat).
//
// SAMOTNY CEL ROZSTRZYGA CSS. Gdy z listy zostaje najwyżej sam cel, Vite (bez tej funkcji) dałby
// `[]` - preload celu rusza razem z jego `import()` i nic nie daje. ALE Vite wyjmuje zależności
// CSS przed tą funkcją i dokleja je PO niej, a runtime `__vitePreload` czeka na `load` każdego
// nowego arkusza, zanim wywoła `import()`: pusta lista + arkusz = JS celu żądany dopiero po CSS
// (+1 runda; na 75d90e1 Lightbox z GalleryBlock). Import, który niesie CSS, zachowuje więc
// `[cel]`; bez CSS lista jest pusta. Samo `resolveDependencies` CSS-u nie widzi - widzi go
// `plugin` z tego samego obiektu: bierze bundle w `generateBundle` (`order: "pre"`, przed
// vite:build-import-analysis, która woła tę funkcję), a reguła czyta `viteMetadata.importedCss`
// plików listy w chwili wywołania, więc już po scaleniu chunków czysto-CSS-owych do importerów.
// Bez bundla (wtyczka niepodpięta) reguła zakłada CSS i zachowuje KAŻDY samotny cel, także 211
// celów /admin - bezpiecznie, ale drogo (same 34 publiczne listy `[cel]` bez CSS to +0,7 KB gzip
// public: 6 chunków dostaje przez nie cały helper `m.f`); podpięcie wtyczki w obu presetach
// pilnuje viteChunkParity.test.ts.
//
// CZEGO NIE RUSZAMY. Zależności CSS: Vite wyjmuje je przed tą funkcją i dokleja po niej, więc
// trasa z arkuszem dostaje go zawsze. Listy w chunkach leniwych (np. leniwe panele w chunkach
// adminowych) - zdjęcie ich byłoby kaskadą także w panelu, za ~3,8 KB tylko w OVERALL.
//
// ZMIERZONE (`BUNDLE_INVENTORY=1 bun run build:smoke` + check:bundle, baza 75d90e1, Bun gzip):
// public 2919,6 -> 2903,4 (-16,2), overall 4965,7 -> 4948,6 (-17,1), `app-initial` (największy
// chunk) 265,3 -> 252,8, boot 479,1 -> 466,7 KB; moduły i podział chunków bez zmian. Tablice `m.f`:
// 37 -> 31 chunków, 2219 -> 1443 nazw, 341 -> 0 nazw bootu, 211 celów /admin z `[]`; jedyny
// samotny cel z CSS (Lightbox w BlocksRenderer) ma `[Lightbox.js, Lightbox.css]` (+4 B gzip).
// PUŁAPKA: Vite wpisuje listy PO policzeniu hashy, więc sama zmiana tej polityki zmienia treść
// plików bez zmiany ich nazw (stara kopia z cache ma po prostu dłuższe, nadal poprawne listy).
import { posix } from "node:path";

import type { ModulePreloadOptions, Plugin, Rolldown } from "vite";

import { BOOT_CHUNK_NAMES } from "./clientChunkGroups.ts";

/** Korzeń tras /admin po nazwie pliku - DOKŁADNIE `ADMIN_ROOT` z scripts/check-bundle-size.ts. */
export const ADMIN_ROUTE_CHUNK_RE = /^admin[.-]/;

/** `[name]-[hash].js` - domyślny `chunkFileNames` Vite; Rolldown daje 8 znaków hasha. */
const CHUNK_HASH_RE = /-[A-Za-z0-9_-]{8}\.js$/;

/** Nazwa chunku (`[name]`) z ścieżki pliku albo `null`, gdy plik nie ma kształtu chunku. */
export function chunkNameOf(file: string): string | null {
  const base = posix.basename(file);
  return CHUNK_HASH_RE.test(base) ? base.replace(CHUNK_HASH_RE, "") : null;
}

const BOOT_CHUNKS: ReadonlySet<string> = new Set(BOOT_CHUNK_NAMES);

/** Chunk, który reguła 2 zdejmuje z list preloadu (grupa `boot(...)` albo runtime Rolldowna). */
export function isBootChunkFile(file: string): boolean {
  const name = chunkNameOf(file);
  return name !== null && BOOT_CHUNKS.has(name);
}

/** Cel `import()` w korzeniu tras /admin (reguła 1). */
export function isAdminRouteChunkFile(file: string): boolean {
  return ADMIN_ROUTE_CHUNK_RE.test(posix.basename(file));
}

/** Czy któryś plik JS listy niesie CSS, który Vite dołoży do niej po `resolveDependencies`. */
export type CssProbe = (files: readonly string[]) => boolean;

/** Bez wglądu w bundle: zakładamy CSS (samotny cel zostaje - bezpiecznie, kosztuje bajty). */
const ASSUME_CSS: CssProbe = () => true;

/** `resolveDependencies` klienta: obie reguły i samotny cel z nagłówka pliku. */
export function resolveClientPreloadDependencies(
  filename: string,
  deps: string[],
  context: { hostId: string; hostType: "html" | "js" },
  carriesCss: CssProbe = ASSUME_CSS,
): string[] {
  if (context.hostType !== "js") return deps;
  const kept = isAdminRouteChunkFile(filename) ? [] : deps.filter((dep) => !isBootChunkFile(dep));
  if (kept.some((dep) => dep !== filename)) return kept;
  // Najwyżej sam cel. `deps.includes`: cel spoza bundla (chunk czysto-CSS-owy, który Vite zastąpił
  // `Promise.resolve({})`) nie trafia na listę - jak u Vite.
  return deps.includes(filename) && carriesCss(deps) ? [filename] : [];
}

/** CSS z metadanych chunków bundla w chwili wywołania (po scaleniu chunków czysto-CSS-owych). */
export function bundleCssProbe(bundle: () => Rolldown.OutputBundle | undefined): CssProbe {
  return (files) => {
    const output = bundle();
    if (!output) return true;
    return files.some((file) => {
      const chunk = output[file];
      return chunk?.type === "chunk" && (chunk.viteMetadata?.importedCss.size ?? 0) > 0;
    });
  };
}

export interface ClientModulePreload {
  /** `build.modulePreload` środowiska `client`. Bez `polyfill` - Vite zostawia domyślne `true`. */
  readonly modulePreload: ModulePreloadOptions;
  /** Daje regułom wgląd w CSS celów - w `plugins` TEGO SAMEGO presetu. */
  readonly plugin: Plugin;
}

/**
 * Listy preloadu `import()` klienta obu presetów: reguły i wtyczka dzielą stan jednego buildu
 * (bundle klienta). Świeży obiekt przy każdym wywołaniu, jak `clientCodeSplitting()`.
 */
export function clientModulePreload(): ClientModulePreload {
  let bundle: Rolldown.OutputBundle | undefined;
  const carriesCss = bundleCssProbe(() => bundle);
  return {
    modulePreload: {
      resolveDependencies: (filename, deps, context) =>
        resolveClientPreloadDependencies(filename, deps, context, carriesCss),
    },
    plugin: {
      name: "nes:client-module-preload",
      apply: "build",
      applyToEnvironment: (environment) => environment.config.consumer === "client",
      generateBundle: {
        order: "pre",
        handler(_options, output) {
          bundle = output;
        },
      },
    },
  };
}
