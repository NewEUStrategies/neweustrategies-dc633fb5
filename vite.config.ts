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

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Trasy serwerowe (m.in. /lovable/email/*) czytają sekrety BEZ prefiksu VITE_
// (SUPABASE_SERVICE_ROLE_KEY, LOVABLE_API_KEY). Domyślna konfiguracja wstrzykuje
// wyłącznie VITE_*, więc dokładamy je do process.env - tylko po stronie serwera,
// nigdy do envDefine/bundla klienta.
Object.assign(process.env, loadEnv(process.env.NODE_ENV ?? "development", rootDir, ""));


// Minifikacja artefaktu WORKERA (2026-07-24). Chunki serwera składa NITRO
// własnym rollupem, więc vite-owe `build.minify` ich nie dotyka - bez tej
// opcji deploy niósł 21 MB nieminifikowanego kodu (wolniejszy parse na
// zimnym starcie izolatu, większy artefakt; po minifikacji 13 MB raw /
// ~3,0 MB gzip). Nitro minifikuje esbuildem (proces Go, poza heapem V8),
// więc historyczny OOM `build:dev` przy minifikacji SSR go nie dotyczy -
// zweryfikowane pełnym `build` i `build:dev` (docs/WDROZENIE_SSR_2026-07-24.md).
//
// Zmienna pośrednia zamiast literalu: typy @lovable.dev/vite-tanstack-config
// deklarują tylko podzbiór opcji nitro (preset/output/cloudflare), ale runtime
// forwarduje CAŁY obiekt do nitro() z nitro/vite, a `minify` jest oficjalną
// opcją Nitro (https://nitro.build/config#minify). Przypisanie przez zmienną
// omija excess-property-check bez żadnego rzutowania; jawny `preset` powtarza
// dotychczasowy default (cloudflare-module) i spełnia weak-type check.
const nitroOptions = { preset: "cloudflare-module", minify: true };

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
      routeFileIgnorePattern: "(__tests__|__snapshots__)|\\.(test|spec)\\.[jt]sx?$",
    },
  },

  vite: {
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
        "@tanstack/react-router",
        "@tanstack/react-router-ssr-query",
        "@tanstack/react-query",
        "@tanstack/react-start",
        "@tanstack/history",
        "@tanstack/router-core",
        "@tanstack/router-core/isServer",
        "@tanstack/router-core/ssr/client",
        "@tanstack/router-core/ssr/server",
        "@supabase/supabase-js",
        "i18next",
        "react-i18next",
        "h3-v2",
        "seroval",
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
        ssrFiles: [
          "./src/routes/__root.tsx",
          "./src/routes/index.tsx",
          "./src/components/admin/builder/BuilderRenderer.tsx",
          "./src/components/admin/builder/WidgetView.tsx",
          "./src/components/admin/builder/ui/organisms/widget-view/lazyWidgets.tsx",
        ],
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

    // Minifikacja WSZYSTKICH środowisk builda esbuildem (2026-07-24). Historia:
    // top-level `minify: false` wprowadzono, gdy V8 wyczerpywał pamięć podczas
    // minifikacji chunka SSR >2.5 MB przy `build:dev` - ale efektem ubocznym
    // był 21 MB NIEminifikowany bundel workera (wolniejszy parse na zimnym
    // starcie izolatu, większy artefakt deployu). Esbuild minifikuje we
    // własnym procesie Go, poza heapem V8, więc historyczny OOM go nie
    // dotyczy - zweryfikowane pełnym `build` i `build:dev` na 8 GB heapu
    // (patrz docs/WDROZENIE_SSR_2026-07-24.md). Gdyby OOM wrócił na CI,
    // pierwszy krok diagnostyki: przywrócić `minify: false` wyłącznie dla
    // środowiska SSR/workera (environments), NIE globalnie - klient musi
    // pozostać minifikowany.
    build: {
      minify: "esbuild",
    },
    // Do not set top-level Rollup `manualChunks` here. This config is shared by
    // the browser and Cloudflare server environments; forcing vendor chunks at
    // this level also splits the Worker entry into files that are not available
    // to the deployed runtime, so module initialization fails and every route
    // becomes an opaque h3 HTTPError 500. TanStack's route-level splitting and
    // Vite's client defaults still provide safe browser code splitting.
    //
    // Vendor split ONLY for the browser bundle, scoped via the Vite 7
    // environments API to the "client" environment (TanStack Start's
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
          // Przywraca minifikację bundla przeglądarki (patrz komentarz przy
          // top-level `minify: false`, które jest dla SSR/workera).
          minify: "esbuild",
          rollupOptions: {
            output: {
              // Bez hoistowania importów tranzytywnych: nagłówki chunków
              // zawierają wtedy wyłącznie PRAWDZIWE krawędzie modułów, więc
              // graf inicjalizacji jest deterministyczny i audytowalny
              // (scripts/check-chunk-graph.ts). Koszt (głębszy waterfall przy
              // dynamic importach) pokrywa modulepreload z mapDeps.
              hoistTransitiveImports: false,
              manualChunks(id: string) {
                if (!id.includes("/node_modules/")) return undefined;
                // ZASADA (incydent 2026-07-20, martwa hydratacja na KAŻDEJ
                // stronie): chunk vendorowy musi zawierać DOMKNIĘCIE
                // zależności swoich pakietów spoza vendor-react. Rozdzielenie
                // pakietu od jego zależności (use-sync-external-store poza
                // radixem, html-parse-stringify poza react-i18next) tworzy
                // cykl chunków entry <-> vendor; przy CJS-interop kolejność
                // inicjalizacji się wywraca ("Cannot set properties of
                // undefined (setting 'useSyncExternalStore')") i boot klienta
                // pada przed hydrateRoot - strona zostaje statycznym SSR-em,
                // bez żadnego błędu widocznego dla użytkownika. Dev i testy
                // jednostkowe tej klasy NIE ŁAPIĄ (w dev nie ma chunków);
                // gate: scripts/check-chunk-graph.ts (cykle) + boot-test
                // przeglądarkowy na buildzie vite.smoke.config.ts.
                if (
                  /\/node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id)
                ) {
                  return "vendor-react";
                }
                if (id.includes("/node_modules/@supabase/")) return "vendor-supabase";
                if (id.includes("/node_modules/@tanstack/")) return "vendor-tanstack";
                // Radix + jego sidecary (scroll-lock, aria-hidden, floating-ui)
                // w JEDNYM chunku - patrz zasada domknięcia wyżej.
                if (
                  /\/node_modules\/(@radix-ui|@floating-ui|aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|get-nonce)\//.test(
                    id,
                  )
                ) {
                  return "vendor-radix";
                }
                if (
                  /\/node_modules\/(i18next|react-i18next|html-parse-stringify|void-elements)\//.test(
                    id,
                  )
                ) {
                  return "vendor-i18n";
                }
                return undefined;
              },
            },
          },
        },
      },
    },
  },
});
