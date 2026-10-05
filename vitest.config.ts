import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "happy-dom",
    globals: true,
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
      all: true,
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
