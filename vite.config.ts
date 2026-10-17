import { routeSplitBehavior } from "./scripts/lib/routeCodeSplitting.ts";
import { widgetChunkPlugin } from "./scripts/lib/widgetChunkPlugin.ts";
// @lovable.dev/vite-tanstack-config already includes the following - do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

import { chunkInventoryPlugin } from "./scripts/lib/chunkInventoryPlugin.ts";
import { localeChunkPlugin } from "./scripts/lib/localeChunkPlugin.ts";
import { adminCssPlugin } from "./scripts/lib/adminCssPlugin.ts";
import { officeParserTrimPlugin } from "./scripts/lib/officeParserTrim.ts";
import { bootAfterLcpPlugin } from "./scripts/lib/bootAfterLcpPlugin.ts";
import { staticCssPlugin } from "./scripts/lib/staticCssPlugin.ts";
import { devBuildKeepNamesPlugin } from "./scripts/lib/devBuildKeepNames.ts";
import { clientCodeSplitting } from "./scripts/lib/clientChunkGroups.ts";
import { clientModulePreload } from "./scripts/lib/clientModulePreload.ts";
import {
  browserBaselineLightningcssTargets,
  LIGHTNINGCSS_EXCLUDED_FEATURES,
  browserBaselineTarget,
} from "./scripts/lib/browserBaseline.ts";
import { MACHINE_SURFACES } from "./src/lib/seo/machineSurfaces.ts";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Trasy serwerowe (m.in. /platform/email/*) czytają sekrety BEZ prefiksu VITE_
// (SUPABASE_SERVICE_ROLE_KEY, LOVABLE_API_KEY). Domyślna konfiguracja wstrzykuje
// wyłącznie VITE_*, więc dokładamy je do process.env - tylko po stronie serwera,
// nigdy do envDefine/bundla klienta.
Object.assign(process.env, loadEnv(process.env.NODE_ENV ?? "development", rootDir, ""));

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

// Minifikacja artefaktu WORKERA (2026-07-24). Chunki serwera składa NITRO we
// własnym środowisku Vite, z `minify` z opcji Nitro, więc nasze `build.minify`
// ich nie dotyka - bez tej opcji deploy niósł 21 MB nieminifikowanego kodu
// (wolniejszy parse na zimnym starcie izolatu, większy artefakt; po
// minifikacji 13 MB raw / ~3,0 MB gzip). Vite 8 rozwiązuje `minify: true` na
// Oxc (natywny Rust w Rolldownie, poza heapem V8; na Vite 7 był to esbuild,
// proces Go), więc historyczny OOM `build:dev` przy minifikacji SSR go nie
// dotyczy - na esbuildzie zweryfikowane pełnym `build` i `build:dev`
// (docs/WDROZENIE_SSR_2026-07-24.md).
//
// Zmienna pośrednia zamiast literalu: typy @lovable.dev/vite-tanstack-config
// deklarują tylko podzbiór opcji nitro (preset/output/cloudflare), ale runtime
// forwarduje CAŁY obiekt do nitro() z nitro/vite, a `minify` jest oficjalną
// opcją Nitro (https://nitro.build/config#minify). Przypisanie przez zmienną
// omija excess-property-check bez żadnego rzutowania; jawny `preset` powtarza
// dotychczasowy default (cloudflare-module) i spełnia weak-type check.

// Powierzchnie maszynowe MUSZĄ odpowiadać z workera, nigdy z warstwy assetów
// (audyt 2026-08-06). Wrangler wiąże `.output/public/` jako `assets`, a Asset
// Worker odpowiada PRZED naszym workerem - dlatego zacommitowany
// `public/robots.txt` unieruchamiał dynamiczną trasę /robots.txt na produkcji
// (statyczne `Allow: /` dla każdego hosta, bez klasyfikacji hostów, bez
// `X-Robots-Tag`, bez news sitemap) i nie dawało się tego zauważyć: dev-server
// serwuje trasę normalnie. `run_worker_first` odwraca pierwszeństwo dla
// DOKŁADNIE tych adresów, więc powrót takiego pliku niczego już nie zepsuje
// (pierwsza bariera to bramka CI `check:public-assets`).
//
// Lista pochodzi z rejestru powierzchni maszynowych, więc nowy feed/sitemapa
// jest chroniona automatycznie - bez drugiego miejsca do pamiętania.
// Nitro scala `cloudflare.wrangler` (defu) z własnymi `overrides`, więc
// `assets.binding`/`assets.directory` pozostają nitrowe, a dokładamy tylko
// `run_worker_first`. Build loguje przy tym ostrzeżenie "[cloudflare] Wrangler
// config `assets` ... is overridden" - dotyczy nadpisywanych podkluczy, nie
// naszego; tak wygląda poprawne działanie tego scalania.
const WORKER_FIRST_PATHS = MACHINE_SURFACES.map((surface) => surface.path);

// `deployConfig: true` powtarza domyślne zachowanie presetu (nitro robi
// `deployConfig ??= true`) i jest potrzebne z powodu typów: zadeklarowany
// podzbiór `cloudflare` zna tylko `nodeCompat`/`deployConfig`, a typ złożony
// wyłącznie z opcjonalnych pól jest "weak type" - obiekt z samym `wrangler`
// nie miałby z nim ANI JEDNEGO wspólnego pola i nie przeszedłby kompilacji.
// Ten sam mechanizm co przy jawnym `preset` powyżej; runtime forwarduje CAŁY
// obiekt `cloudflare` do nitro (w sandboxie przez spread), więc `wrangler`
// dociera na miejsce bez żadnego rzutowania.
// Listy preloadu `import()` klienta: reguły (`modulePreload` środowiska `client`) i wtyczka, która
// daje im wgląd w CSS celów, dzielą stan jednego buildu - stąd JEDEN obiekt dla obu miejsc.
const clientPreload = clientModulePreload();

const nitroOptions = {
  preset: "cloudflare-module",
  minify: true,
  cloudflare: {
    deployConfig: true,
    wrangler: { assets: { run_worker_first: WORKER_FIRST_PATHS } },
  },
};

export default defineConfig({
  nitro: nitroOptions,
  // Override TanStack Start server entry so nasz wrapper (src/server.ts) opakowuje
  // wirtualny `@tanstack/react-start/server-entry` lazy importem, try/catch i
  // normalizacją h3-swallowed 500 (skill: tanstack-ssr-error-handling).
  tanstackStart: {
    server: { entry: "server" },
    // Pliki testowe/snapshoty pod src/routes nie są trasami. Bez tego wzorca
    // generator próbuje je zarejestrować, loguje ostrzeżenie i przy każdej
    // zmianie przebudowuje routeTree.gen.ts => pełny "program reload" w dev,
    // co objawia się migotaniem / niestabilnym renderowaniem podglądu.
    router: {
      codeSplittingOptions: { splitBehavior: routeSplitBehavior },
      routeFileIgnorePattern: "(__tests__|__snapshots__)|\\.(test|spec)\\.[jt]sx?$",
    },
  },

  vite: {
    // Przyrząd pomiarowy składu bundla - INERTNY, dopóki nie ustawisz
    // BUNDLE_INVENTORY=1 (patrz nagłówek wtyczki). Nie duplikuje żadnej wtyczki
    // z @lovable.dev/vite-tanstack-config: ma wyłącznie hook `generateBundle`.
    // `officeParserTrimPlugin`: martwy kod parsera .docx (zapis XML mammoth,
    // tablica encji HTML xmldom) poza bundlem przeglądarki, a bluebird i tablica
    // dingbatów mammoth zastąpione odpowiednikami o tej samej semantyce -
    // przekierowania zawężone do importera, uzasadnienie w nagłówku wtyczki.
    plugins: [
      chunkInventoryPlugin(),
      localeChunkPlugin(),
      widgetChunkPlugin(),
      adminCssPlugin(),
      officeParserTrimPlugin(),
      // P2.1: manifest TanStack Start bez preloadów i skryptu wejścia (zestaw bootu w
      // BOOT_MANIFEST serwera). Tylko build, tylko środowisko `ssr`; ta sama wtyczka
      // w vite.smoke.config.ts (parytet: viteChunkParity.test.ts).
      bootAfterLcpPlugin(),
      // P3.7a: minifikacja oznaczonych statycznych literałów CSS (tylko build, oba
      // środowiska, surowy TS); ta sama wtyczka w vite.smoke.config.ts.
      staticCssPlugin(),
      // `keepNames` dla `build:dev` (Lovable ustawia go esbuildowi, którego Vite 8
      // już nie używa do minifikacji); ta sama wtyczka w vite.smoke.config.ts.
      devBuildKeepNamesPlugin(),
      // CSS celów `import()` dla list preloadu (`modulePreload` środowiska `client` niżej).
      clientPreload.plugin,
    ],

    // P3.6a: identyfikator buildu kluczy L2 (patrz `NES_BUILD_ID` wyżej).
    define: { __NES_BUILD_ID__: JSON.stringify(NES_BUILD_ID) },

    // React Email ciągnie htmlparser2 -> entities. Wersje 5+ usunęły
    // `entities/lib/decode.js`, więc każdy zagnieżdżony nowszy egzemplarz
    // wywraca SSR. Alias przypina WSZYSTKIE importy do hoistowanej 4.5.0.
    resolve: {
      alias: {
        "entities/lib/decode.js": path.resolve(rootDir, "node_modules/entities/lib/decode.js"),
        "entities/lib/encode.js": path.resolve(rootDir, "node_modules/entities/lib/encode.js"),
        entities: path.resolve(rootDir, "node_modules/entities"),
      },
    },

    // These are only reached through TanStack Start's dev-time SSR/client
    // bridge, so Vite's initial crawl misses them and discovers them during the
    // FIRST page load - "new dependencies optimized: ... reloading" then forces
    // a full page reload mid-session (the page visibly loads twice after every
    // dev-server restart). Pre-bundling them up front removes that reload.
    // @tanstack/react-start stays out because its server entry must never be
    // pulled into the browser dependency graph.
    optimizeDeps: {
      // Projekt ma setki tras i leniwych widgetów CMS. Automatyczny crawler
      // przechodził cały graf przed zatwierdzeniem `deps_temp`, blokując w tym
      // czasie kolejne dokumenty i moduły klienta. Prebundle jest w pełni
      // jawny poniżej; zależności ekranów otwieranych później Vite transformuje
      // normalnie bez globalnego restartu optimizer-a.
      noDiscovery: true,
      // Pełna lista "gorących" zależności klienta. Bez niej Vite odkrywa je
      // dopiero w trakcie ładowania strony, przeładowuje optimizer w locie i
      // żądania modułów wysłane ze starym `?v=` hashem nigdy się nie kończą -
      // React nie hydratuje, a strona zostaje statycznym HTML-em (przyciski,
      // logowanie i linki nie reagują).
      include: [
        "react",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "react-dom",
        "react-dom/client",
        "use-sync-external-store",
        "use-sync-external-store/shim",
        "use-sync-external-store/shim/index.js",
        "use-sync-external-store/shim/with-selector",
        "use-sync-external-store/shim/with-selector.js",
        // Edytor wpisu (TipTap) ładuje się leniwie, a `noDiscovery: true`
        // wyłącza automatyczne wykrywanie - bez tych wpisów Vite serwował
        // surowy CJS `use-sync-external-store/shim` importowany przez
        // @tiptap/react i przeglądarka wywalała się na braku nazwanego
        // eksportu `useSyncExternalStore` (biały błąd przy otwarciu wpisu).
        "@tiptap/react",
        "@tiptap/core",
        "@tiptap/pm/state",
        "@tiptap/pm/view",
        "@tiptap/starter-kit",
        "@tiptap/extension-color",
        "@tiptap/extension-highlight",
        "@tiptap/extension-image",
        "@tiptap/extension-link",
        "@tiptap/extension-subscript",
        "@tiptap/extension-superscript",
        "@tiptap/extension-text-align",
        "@tiptap/extension-text-style",
        "@tiptap/extension-underline",
        "@tanstack/react-store",
        // Avatar radixa też sięga po ten sam shim (lazy w panelu admina).
        "@radix-ui/react-avatar",
        // Każdy wpis poniżej to pakiet ładowany z leniwych ekranów admina,
        // którego graf zawiera zależności CJS-only. Przy `noDiscovery: true`
        // nieprebundlowany moduł CJS jest serwowany surowo i import defaulta
        // kończy się "does not provide an export named 'default'" - dokładnie
        // tak wywalał się edytor wpisu (react-markdown -> style-to-js), a
        // pozostałe czekały w kolejce: kadrowanie okładki (react-easy-crop ->
        // normalize-wheel), bilety QR (qrcode), słownik krajów
        // (i18n-iso-countries) i normalizacja HTML buildera (node-html-parser
        // -> css-select -> boolbase).
        //
        // WYKRESÓW TU JUŻ NIE MA. Pulpity rysowały przez `echarts-for-react`,
        // czyli moduł CJS wymagający prebundlingu; nasz silnik jest zwykłym
        // komponentem Reacta w tym repozytorium, więc nie ma czego prebundlować.
        "react-markdown",
        "react-easy-crop",
        "qrcode",
        "i18n-iso-countries",
        "node-html-parser",
        // Stripe: @stripe/react-stripe-js importuje CJS-owy `prop-types`
        // przez default import. Bez prebundlingu przeglądarka wywalała się na
        // "does not provide an export named 'default'", a że paywall wpisu
        // ładuje ten moduł leniwie - CAŁA strona wpisu lądowała na error
        // boundary ("Nie udało się załadować strony").
        "@stripe/stripe-js",
        "@stripe/react-stripe-js",
        "prop-types",

        "@tanstack/react-router",
        "@tanstack/react-router-ssr-query",
        "@tanstack/react-query",
        "@tanstack/history",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@supabase/supabase-js",
        "i18next",
        "react-i18next",
        // lucide-react bez prebundlingu = ~1690 osobnych modułów ikon
        // serwowanych po jednym na żądanie (dev, `noDiscovery: true`).
        // Przeglądarka dławi się kolejką i strona nigdy nie kończy ładowania
        // (podgląd zostaje pustym/statycznym HTML-em).
        "lucide-react",
      ],
    },

    // --- DEV-ONLY: pamięć i zimny start SSR (incydent: OOM `heap out of
    // memory` po serii renderów SSR w trybie dev). Przyczyna jest artefaktem
    // dev-a, nie produkcji: w dev każdy `React.lazy(() => import(...))` z
    // lazyWidgets.tsx jest transformowany i trzymany JAKO OSOBNY moduł w
    // module-graph runnera SSR (razem z sourcemapami), a graf tras jest
    // ogromny - stąd rosnący heap i 30-40 s pierwszego zimnego żądania.
    // Wszystkie poniższe opcje są ignorowane przy `vite build`, więc artefakt
    // produkcyjny (worker) pozostaje bit-w-bit taki sam.
    //
    // 1) Prebundling zależności także dla środowiska SSR: setki modułów
    //    node_modules zwijają się do kilku plików ESM => mniej wpisów w
    //    module-graph i mniej pracy transformera przy każdym renderze.
    ssr: {
      optimizeDeps: {
        noDiscovery: true,
        include: [
          "react",
          "react-dom",
          "react-dom/server",
          "@tanstack/react-router",
          "@tanstack/react-query",
          "@supabase/supabase-js",
          "i18next",
          "react-i18next",
        ],
      },
    },
    server: {
      // 2) Rozgrzewka najcięższych wejść SSR - transform startuje przy starcie
      //    dev-servera, a nie dopiero przy pierwszym żądaniu użytkownika.
      warmup: {
        ssrFiles: ["./src/routes/__root.tsx", "./src/routes/index.tsx"],
        clientFiles: ["./src/routes/__root.tsx", "./src/routes/index.tsx"],
      },
      // 3) Watcher nie trzyma w pamięci katalogów, które nigdy nie wchodzą do
      //    grafu aplikacji (migracje, dokumentacja, artefakty testów).
      //    Dodatkowo ignorujemy pliki `.env*`: platforma cyklicznie zapisuje je
      //    ponownie z IDENTYCZNĄ treścią (sync tokenów płatności), a Vite
      //    traktuje każdy zapis jako zmianę env => pełny restart serwera.
      //    Przy tej wielkości grafu restart trwa minuty, w trakcie których
      //    podgląd zwraca "connection refused" albo nieinteraktywny HTML.
      watch: {
        ignored: [
          "**/supabase/**",
          "**/docs/**",
          "**/test-results/**",
          "**/playwright-report/**",
          "**/coverage/**",
          "**/.lovable/**",
          "**/.env",
          "**/.env.*",
        ],
      },
    },

    // Minifikacja WSZYSTKICH środowisk builda (2026-07-24; od Vite 8 Oxc-iem, wcześniej
    // esbuildem). Historia: top-level `minify: false` wprowadzono, gdy V8 wyczerpywał pamięć
    // podczas minifikacji chunka SSR >2.5 MB przy `build:dev` - ale efektem ubocznym był 21 MB
    // NIEminifikowany bundel workera (wolniejszy parse na zimnym starcie izolatu, większy
    // artefakt deployu). Minifikator Oxc jest natywny (Rust w Rolldownie), poza heapem V8 - jak
    // esbuild (proces Go), na którym zweryfikowano to pełnym `build` i `build:dev` na 8 GB heapu
    // (docs/WDROZENIE_SSR_2026-07-24.md). Gdyby OOM wrócił na CI, pierwszy krok diagnostyki:
    // przywrócić `minify: false` wyłącznie dla środowiska SSR/workera (environments), NIE
    // globalnie - klient musi pozostać minifikowany. `"oxc"`, nie `"esbuild"`: Vite 8 traktuje
    // esbuild jako opcjonalny peer, którego repo nie deklaruje, a top-level `"esbuild"` dokładał
    // drugi przebieg transpilacji także chunkom serwera.
    build: {
      minify: "oxc",
      // Cel minifikacji CSS = baza przeglądarek Vite 7 (scripts/lib/browserBaseline.ts). Na tym
      // poziomie, bo wtyczkę CSS współdzielą wszystkie środowiska i czyta ona `build` configu
      // najwyższego poziomu; cel JS workera zostaje nietknięty.
      cssTarget: browserBaselineTarget(),
    },
    // Transformacja arkuszy (lightningcss) - ta sama baza przeglądarek Vite 7.
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
          // Minifikacja bundla przeglądarki jawnie także na poziomie środowiska, TYM SAMYM
          // minifikatorem co top-level: Vite rozwiązuje `minify` per środowisko, a rozjazd
          // (np. top-level `"oxc"` przy środowiskowym `"esbuild"`) zostawia klienta
          // nieminifikowanego.
          minify: "oxc",
          // Składnia JS dla bazy przeglądarek Vite 7 (scripts/lib/browserBaseline.ts).
          target: browserBaselineTarget(),
          // Listy preloadu `import()` (`__vite__mapDeps`) bez celów w korzeniu /admin i bez
          // chunków domknięcia bootu - reguły, zmierzony zysk i cena w nagłówku
          // scripts/lib/clientModulePreload.ts.
          modulePreload: clientPreload.modulePreload,
          rolldownOptions: {
            output: {
              // Bez hoistowania importów tranzytywnych: nagłówki chunków
              // zawierają wtedy wyłącznie PRAWDZIWE krawędzie modułów, więc
              // graf inicjalizacji jest deterministyczny i audytowalny
              // (scripts/check-chunk-graph.ts). Koszt (głębszy waterfall przy
              // dynamic importach) pokrywa modulepreload z mapDeps - poza
              // celami w korzeniu /admin (pierwsza nawigacja SPA do panelu
              // idzie kaskadą; `modulePreload` wyżej). Rolldown
              // i tak nie hoistuje (opcja przyjmuje wyłącznie `false`) - jawna
              // wartość przypina kontrakt bramki na wypadek zmiany domyślnej.
              hoistTransitiveImports: false,
              // Podział vendorów i przypięte chunki aplikacji: grupy z priorytetami
              // w scripts/lib/clientChunkGroups.ts (tam zasada priorytetów,
              // pułapka modułu wejściowego i historia każdej grupy).
              codeSplitting: clientCodeSplitting(),
            },
          },
        },
      },
    },
  },
});
