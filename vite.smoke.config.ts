import { routeSplitBehavior } from "./scripts/lib/routeCodeSplitting.ts";
import { widgetChunkPlugin } from "./scripts/lib/widgetChunkPlugin.ts";
// Wariant SMOKE-TESTOWY builda: identyczna konfiguracja jak vite.config.ts,
// ale nitro celuje w node-server zamiast cloudflare-module, więc produkcyjny
// artefakt da się uruchomić lokalnie (node .output/server/index.mjs) i
// przetestować BOOT KLIENTA prawdziwą przeglądarką. Incydent 2026-07-20
// (cykl chunków vendor -> martwa hydratacja na każdej stronie) był
// niewykrywalny w dev (brak chunków) i w testach jednostkowych - wyłącznie
// prawdziwy build + przeglądarka go łapią.
//
// Użycie:
//   bunx vite build --config vite.smoke.config.ts
//   node .output/server/index.mjs   # + test Playwright przeciw :3000
//   bun run scripts/check-chunk-graph.ts
//
// UWAGA: trzymać w synchronizacji z vite.config.ts (kopiuj sekcję vite).
// @lovable.dev/vite-tanstack-config already includes the following - do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { chunkInventoryPlugin } from "./scripts/lib/chunkInventoryPlugin.ts";
import { localeChunkPlugin } from "./scripts/lib/localeChunkPlugin.ts";
import { adminCssPlugin } from "./scripts/lib/adminCssPlugin.ts";
import { officeParserTrimPlugin } from "./scripts/lib/officeParserTrim.ts";
import { bootAfterLcpPlugin } from "./scripts/lib/bootAfterLcpPlugin.ts";
import { clientOnlyRouteStubPlugin } from "./scripts/lib/clientOnlyRouteStubPlugin.ts";
import { staticCssPlugin } from "./scripts/lib/staticCssPlugin.ts";
import { devBuildKeepNamesPlugin } from "./scripts/lib/devBuildKeepNames.ts";
import { clientCodeSplitting } from "./scripts/lib/clientChunkGroups.ts";
import { clientModulePreload } from "./scripts/lib/clientModulePreload.ts";
import {
  browserBaselineLightningcssTargets,
  LIGHTNINGCSS_EXCLUDED_FEATURES,
  browserBaselineTarget,
} from "./scripts/lib/browserBaseline.ts";

// Identyfikator buildu dla kluczy L2 (P3.6a): segment kluczy dokumentów i migawek danych w
// Cache API kolonii (`l2BuildId()` w src/lib/http/documentCacheL2.server.ts), więc HTML i dane
// poprzedniego deployu nie przeżywają wdrożenia. `LOVABLE_BUILD_ID`, a bez niego znacznik czasu
// policzony RAZ przy ładowaniu konfiguracji - wspólny dla klienta i serwera jednego `vite build`,
// inny w każdym buildzie. Przycięty do [A-Za-z0-9_-], bo trafia do ścieżki klucza. Czyta go
// wyłącznie kod serwera (za bramką SSR), więc hashe chunków klienta się nie zmieniają. Ten sam
// blok w obu presetach (parytet: src/lib/ci/__tests__/viteChunkParity.test.ts).
const NES_BUILD_ID = (process.env.LOVABLE_BUILD_ID || `t${Date.now().toString(36)}`)
  .replace(/[^A-Za-z0-9_-]/g, "_")
  .slice(0, 64);

// `minify: true` jak w produkcyjnym vite.config.ts - smoke ma odwzorowywać
// realny artefakt (różni się wyłącznie presetem: node-server zamiast
// cloudflare-module, żeby dało się go odpalić lokalnie). Zmienna pośrednia:
// typy pakietu deklarują podzbiór opcji nitro - patrz komentarz w vite.config.ts.
const nitroOptions = { preset: "node-server", minify: true };

// Parytet z vite.config.ts: reguły list preloadu `import()` i wtyczka z CSS celów - jeden obiekt.
const clientPreload = clientModulePreload();

export default defineConfig({
  nitro: nitroOptions,
  // Parytet z vite.config.ts: produkcyjny wrapper SSR entry (src/server.ts -
  // normalizacja h3-500 + strażnik strumienia dokumentu) musi być objęty
  // smoke-testem; bez tego override'u smoke omijał całą warstwę wrappera.
  tanstackStart: {
    server: { entry: "server" },
    router: {
      codeSplittingOptions: { splitBehavior: routeSplitBehavior },
      routeFileIgnorePattern: "(__tests__|__snapshots__)|\\.(test|spec)\\.[jt]sx?$",
    },
  },
  vite: {
    // Parytet z vite.config.ts: bez tej wtyczki artefakt smoke'owy nie niesie
    // hintu `modulepreload` dla rdzenia słownika, czyli boot-test mierzyłby
    // dokument o innym zestawie nagłówków niż produkcja. The inventory must
    // describe THIS smoke build: browser timing classifies static imports
    // from its graph, independently of Chromium's initiatorType labels.
    plugins: [
      localeChunkPlugin(),
      widgetChunkPlugin(),
      adminCssPlugin(),
      chunkInventoryPlugin(true),
      // Parytet z vite.config.ts: boot-test ma mierzyć ten sam bundel parsera
      // .docx, który jedzie na produkcję.
      officeParserTrimPlugin(),
      // Parytet z vite.config.ts: manifest bez preloadów i skryptu wejścia (P2.1).
      bootAfterLcpPlugin(),
      // Parytet z vite.config.ts: komponenty podstron `/admin/*` poza artefaktem serwera.
      clientOnlyRouteStubPlugin(),
      // Parytet z vite.config.ts: zminifikowane statyczne literały CSS (P3.7a).
      staticCssPlugin(),
      // Parytet z vite.config.ts: `keepNames` dla buildu w trybie development.
      devBuildKeepNamesPlugin(),
      // Parytet z vite.config.ts: CSS celów `import()` dla list preloadu.
      clientPreload.plugin,
    ],

    // P3.6a: identyfikator buildu kluczy L2 (patrz `NES_BUILD_ID` wyżej).
    define: { __NES_BUILD_ID__: JSON.stringify(NES_BUILD_ID) },

    // These are only reached through TanStack Start's dev-time SSR/client
    // bridge, so Vite's initial crawl misses them and discovers them during the
    // FIRST page load - "new dependencies optimized: ... reloading" then forces
    // a full page reload mid-session (the page visibly loads twice after every
    // dev-server restart). Pre-bundling them up front removes that reload.
    // @tanstack/react-start stays out because its server entry must never be
    // pulled into the browser dependency graph.
    optimizeDeps: {
      include: [
        "@tanstack/history",
        "@tanstack/router-core",
        "@tanstack/router-core/ssr/client",
        "@tanstack/router-core/ssr/server",
        "seroval",
      ],
    },
    // Minifikacja wszystkich środowisk builda Oxc-iem - lustrzane odbicie
    // vite.config.ts (2026-07-24; historia OOM i uzasadnienie tam), z tym samym
    // celem CSS i tą samą transformacją arkuszy (baza przeglądarek Vite 7,
    // scripts/lib/browserBaseline.ts).
    //
    // `external: cloudflare:*` - waitUntil.server.ts robi dynamiczny import
    // `cloudflare:workers` (za try/catch); preset cloudflare stubuje ten
    // specyfikator, ale node-server próbuje go rozwiązać bundlerem (minifikator -
    // Oxc, wcześniej esbuild - inline'uje zmienną specyfikatora, więc @vite-ignore
    // znika) i cały build nitro pada. Externalizacja odtwarza kontrakt runtime'owy:
    // na Node import rzuca, moduł łapie wyjątek i degraduje do fire-and-forget -
    // dokładnie tak, jak opisuje to waitUntil.server.ts.
    build: {
      minify: "oxc",
      cssTarget: browserBaselineTarget(),
      rolldownOptions: {
        external: [/^cloudflare:/],
      },
    },
    css: {
      lightningcss: {
        targets: browserBaselineLightningcssTargets(),
        exclude: LIGHTNINGCSS_EXCLUDED_FEATURES,
      },
    },
    // Do not set top-level `codeSplitting` (formerly Rollup `manualChunks`) here.
    // This config is shared by the browser and Cloudflare server environments;
    // forcing vendor chunks at this level also splits the Worker entry into files
    // that are not available to the deployed runtime, so module initialization
    // fails and every route becomes an opaque h3 HTTPError 500. TanStack's
    // route-level splitting and the bundler's client defaults still provide safe
    // browser code splitting.
    //
    // Vendor split ONLY for the browser bundle, scoped via the Vite environments
    // API to the "client" environment (TanStack Start's
    // VITE_ENVIRONMENT_NAMES.client) - the Worker/server build above stays a
    // single self-contained entry, so the 2026 h3-500 incident cannot recur.
    // Why: without it every shared dependency collapses into one giant entry
    // chunk (react-dom + supabase + router + radix + i18n ≈ 1 MB gzip) that
    // every first visit must download and parse before ANY page hydrates.
    // Splitting restores parallel fetch + long-term caching (vendor hashes
    // change rarely; a content deploy no longer invalidates react-dom).
    environments: {
      client: {
        build: {
          // Ten sam minifikator i ta sama baza przeglądarek co vite.config.ts.
          minify: "oxc",
          target: browserBaselineTarget(),
          // Te same listy preloadu `import()` co vite.config.ts (scripts/lib/clientModulePreload.ts).
          modulePreload: clientPreload.modulePreload,
          rolldownOptions: {
            output: {
              // Kontrakt check:chunks i podział z JEDNEGO modułu - uzasadnienie
              // w vite.config.ts i w scripts/lib/clientChunkGroups.ts.
              hoistTransitiveImports: false,
              codeSplitting: clientCodeSplitting(),
            },
          },
        },
      },
    },
  },
});
