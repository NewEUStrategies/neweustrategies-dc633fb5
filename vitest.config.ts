import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // To samo mapowanie, które aplikacja dostaje z `@lovable.dev/vite-tanstack-config`
    // (`@` -> `src`), i jedyny wpis `paths` w `tsconfig.json` (`@/*`). Jawny
    // alias zamiast wtyczki `vite-tsconfig-paths`: Vite 8 ostrzega przy każdym
    // starcie, że wtyczka jest zbędna, a alias - w przeciwieństwie do niej -
    // działa niezależnie od tego, który `tsconfig*.json` obejmuje importujący
    // plik, więc test może wciągnąć także moduł z `scripts/` importujący
    // `@/lib/...` (dziś robi tak `scripts/lib/i18nDictionaries.ts`, spoza
    // `include` głównego tsconfiga). Nowy wpis w `paths` wymaga wpisu tutaj.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    // Vitest 5 odwrócił domyślne `clearMocks` na `true` (przewodnik migracji
    // 5.0, „clearMocks is Enabled by Default"). Wracamy jawnie do semantyki
    // Vitesta 4: historia wywołań mocków NIE jest czyszczona przed każdym
    // testem. Suita powstała przy tej semantyce - ~1400 plików sprawdza
    // historię mocków, a część z nich (`beforeAll` + asercje na wywołaniach,
    // `it.fails` zależne od historii z poprzedniego testu) mogłaby zmienić
    // wynik bez jednej zmiany w kodzie. Przejście na `true` to osobna zmiana
    // z pełnym przebiegiem suity, nie efekt uboczny podbicia wersji.
    clearMocks: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Rachunek „ZEBRANE = ZARAPORTOWANE" obok domyślnego raportu. Bez tego
    // utrata forka (SIGKILL od jądra przy braku pamięci) kończy się ZIELONYM
    // logiem, w którym brakuje setek testów (przebieg CI 33059185577: 927
    // przypadków bez wyniku, zero porażek). Szczegóły i mechanizm:
    // `scripts/vitest/testAccountingReporter.ts`.
    reporters: ["default", "./scripts/vitest/testAccountingReporter.ts"],
    // Zużycie sterty per plik w logu: fork ubity SIGKILL-em nie zdąża nic
    // napisać, więc plik rosnący do gigabajtów trzeba widzieć, zanim zabije
    // przebieg.
    logHeapUsage: true,
    // Ciężkie przejazdy paneli buildera przechodzą pojedynczo w ~1-2 s na
    // test, ale pod pełną równoległością suity przekraczały domyślne 5 s.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Pokrycie NIE jest bramką CI. `bun run test:coverage` liczy je lokalnie
    // nad całym `src/` z jednym progiem globalnym; progi per plik usunięto
    // 2026-10-05, bo każdy nowy plik bez testu przewracał CI i wymuszał
    // pisanie testów pod liczbę zamiast pod zachowanie.
    coverage: {
      // V8 remapping produced negative implicit-else counters on Node 22 and
      // 24 (PostEditor, PostBlockEditor, usePendingCounters).
      provider: "istanbul",
      reporter: ["text-summary", "text", "html", "json-summary", "json", "lcov"],
      reportOnFailure: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx}",
        // Generated artifacts - not hand-written code.
        "src/routeTree.gen.ts",
        "src/integrations/supabase/types.ts",
        "src/lib/icons/lucideIconNodes.generated.ts",
        // Test-only helpers.
        "src/test/**",
        // Pure code-splitting glue (React.lazy + Suspense wrappers).
        "**/widget-view/lazyWidgets.tsx",
      ],
      thresholds: {
        statements: 79,
        functions: 77,
        lines: 80,
        branches: 73,
      },
    },
  },
});
