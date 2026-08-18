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
import type { Rollup } from "vite";

// `minify: true` jak w produkcyjnym vite.config.ts - smoke ma odwzorowywać
// realny artefakt (różni się wyłącznie presetem: node-server zamiast
// cloudflare-module, żeby dało się go odpalić lokalnie). Zmienna pośrednia:
// typy pakietu deklarują podzbiór opcji nitro - patrz komentarz w vite.config.ts.
const nitroOptions = { preset: "node-server", minify: true };

export default defineConfig({
  nitro: nitroOptions,
  // Parytet z vite.config.ts: produkcyjny wrapper SSR entry (src/server.ts -
  // normalizacja h3-500 + strażnik strumienia dokumentu) musi być objęty
  // smoke-testem; bez tego override'u smoke omijał całą warstwę wrappera.
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
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
    // Minifikacja wszystkich środowisk builda esbuildem - lustrzane odbicie
    // vite.config.ts (2026-07-24; historia OOM i uzasadnienie tam).
    //
    // `external: cloudflare:*` - waitUntil.server.ts robi dynamiczny import
    // `cloudflare:workers` (za try/catch); preset cloudflare stubuje ten
    // specyfikator, ale node-server próbuje go rozwiązać rollupem (esbuild po
    // minifikacji inline'uje zmienną specyfikatora, więc @vite-ignore znika)
    // i cały build nitro pada. Externalizacja odtwarza kontrakt runtime'owy:
    // na Node import rzuca, moduł łapie wyjątek i degraduje do
    // fire-and-forget - dokładnie tak, jak opisuje to waitUntil.server.ts.
    build: {
      minify: "esbuild",
      rollupOptions: {
        external: [/^cloudflare:/],
      },
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
              manualChunks(id: string, meta: Rollup.ManualChunkMeta) {
                if (!id.includes("/node_modules/")) return undefined;
                // PUŁAPKA (2026-08-06): Rollup NIE POTRAFI przenieść modułu
                // WEJŚCIOWEGO do nazwanego chunku. Gdy `manualChunks` przypisze
                // entry do nazwy X, cały chunk X zapada się z powrotem w chunk
                // wejściowy - razem z każdym innym modułem przypisanym do X.
                // Dokładnie tak umarł `vendor-tanstack`: wejściem klienta jest
                // `@tanstack/react-start/dist/plugin/default-entry/client.tsx`,
                // czyli plik POD /node_modules/@tanstack/, więc reguła niżej
                // przypisywała entry do "vendor-tanstack" i ~320 KB (surowo)
                // routera, react-query i start-client-core jechało w
                // `index-*.js` mimo pozornie poprawnej konfiguracji. Chunk po
                // prostu nigdy nie powstawał - bez ostrzeżenia.
                if (meta.getModuleInfo(id)?.isEntry) return undefined;
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
                // Router + react-query + ich domknięcie spoza vendor-react:
                // seroval / seroval-plugins (serializacja SSR w router-core),
                // cookie-es (router-core), isbot (react-router). Bez tych
                // czterech vendor-tanstack importowałby je z chunku
                // wejściowego, a entry importuje vendor-tanstack - czyli CYKL,
                // ta sama klasa awarii co 2026-07-20. `use-sync-external-store`
                // zostaje w vendor-react (krawędź vendor-tanstack ->
                // vendor-react jest jednokierunkowa).
                //
                // ŚWIADOMIE POZA CHUNKIEM: rodzina `@tanstack/*start*`
                // (react-start, react-start-client, start-client-core,
                // start-fn-stubs). To RUNTIME BOOTSTRAPU, przez który biegnie
                // droga od modułu wejściowego do `src/router.tsx`. Przypisanie
                // jej do nazwanego chunku sprawia, że Rollup barwi tym chunkiem
                // cały osiągalny stąd graf APLIKACJI: zmierzone - entry spadał
                // do 0,2 KB, a vendor-tanstack puchł do 1,59 MB (cały kod
                // aplikacji + vendor w jednym pliku), czyli dokładnie odwrotnie
                // do celu. Bootstrap zostaje więc w entry, a wydzielamy tylko
                // biblioteki liściowe.
                if (
                  /\/node_modules\/(@tanstack\/(react-router|router-core|history|store|react-store|query-core|react-query|router-ssr-query-core|react-router-ssr-query)|seroval|seroval-plugins|cookie-es|isbot)\//.test(
                    id,
                  )
                ) {
                  return "vendor-tanstack";
                }
                // Ikony w JEDNYM chunku vendorowym. Bez tej reguły Rollup
                // rozsypywał je na dziesiątki 300-400-bajtowych plików (każda
                // ikona współdzielona przez >=2 leniwe chunki dostawała własny)
                // - 45 takich odprysków kosztowało ~22 KB gzip samego
                // narzutu nagłówków, bo pliki tej wielkości praktycznie się nie
                // kompresują. Jeden chunk jest też trwale cache'owalny: zestaw
                // ikon zmienia się rzadziej niż kod aplikacji. Domknięcie
                // trywialne - lucide-react importuje wyłącznie React.
                if (id.includes("/node_modules/lucide-react/")) return "vendor-lucide";
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
                // Biblioteki bez zależności (zod / tailwind-merge / dompurify)
                // i sonner (zależny wyłącznie od react) - własne chunki
                // vendorowe zamiast zapadania się w chunk wejściowy. Dla zod i
                // tailwind-merge (nadal statycznie osiągalne z entry) nie
                // zmniejsza to bajtów pierwszej wizyty, ale zdejmuje ~230 kB
                // źródeł z NAJWIĘKSZEGO pliku (budżet largest-chunk) i daje
                // trwały cache między deployami. dompurify i sonner są od
                // 2026-08-18 poza grafem bootowania (patrz lib/sanitizePure.ts
                // i lib/notify.ts) - nazwany chunk stabilizuje ich adres,
                // a bramka check-entry-purity pilnuje, żeby nie wróciły.
                // Domknięcie zależności (incydent 2026-07-20): zod,
                // tailwind-merge i dompurify nie importują niczego; sonner
                // importuje wyłącznie react/react-dom (vendor-react, krawędź
                // jednokierunkowa).
                // Tylko zod TOP-LEVEL: @tanstack/react-start wozi ZAGNIEŻDŻONĄ
                // kopię zod 4 (node_modules/@tanstack/.../node_modules/zod) -
                // mieszanie dwóch wersji w jednym cache-stabilnym chunku
                // sprzęgałoby jego unieważnianie z bumpami frameworka.
                if (
                  /\/node_modules\/zod\//.test(id) &&
                  !/\/node_modules\/[^]*?\/node_modules\/zod\//.test(id)
                )
                  return "vendor-zod";
                if (id.includes("/node_modules/tailwind-merge/")) return "vendor-tw-merge";
                if (id.includes("/node_modules/dompurify/")) return "vendor-dompurify";
                if (id.includes("/node_modules/sonner/")) return "vendor-sonner";
                return undefined;
              },
            },
          },
        },
      },
    },
  },
});
