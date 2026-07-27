// @lovable.dev/vite-tanstack-config already includes the following - do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

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
  },
  vite: {
    plugins: [
      // Dev-only: wyłącz HMR na trasie głównej (`src/routes/__root.tsx`).
      // Gdy Vite próbuje partial-HMR-em podmienić root layout w trakcie
      // strumienia SSR, TanStack anuluje zapytania w locie (`CancelledError`
      // na `menu-with-items:main`), a przeglądarka zostaje z połowicznym
      // HTML-em i zawiesza się do twardego reloadu. Zamiast partial HMR
      // wymuszamy pełny reload przez WS - strumień domyka się czysto,
      // klient startuje od nowa. Nie dotyczy buildu produkcyjnego.
      {
        name: "lovable-disable-hmr-on-root-route",
        apply: "serve" as const,
        handleHotUpdate(ctx: {
          file: string;
          server: { ws: { send: (payload: { type: string; path?: string }) => void } };
        }) {
          if (ctx.file.endsWith("/src/routes/__root.tsx")) {
            ctx.server.ws.send({ type: "full-reload", path: "*" });
            return [];
          }
          return undefined;
        },
      },
    ],
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
        "h3-v2",
        "seroval",
      ],
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
