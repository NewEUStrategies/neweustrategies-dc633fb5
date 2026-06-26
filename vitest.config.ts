import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage is scoped to the builder widget rendering surface. The
      // thresholds below guard this layer against regressions - run with
      // `bun run test:coverage`. `coverage.all` (default) keeps every file in
      // this set reported even when no test imports it, so a brand-new widget
      // with no test lowers the numbers and fails the gate.
      include: [
        "src/components/admin/builder/WidgetView.tsx",
        "src/components/admin/builder/ui/organisms/widget-view/**",
        "src/lib/builder/registry.tsx",
        "src/lib/builder/sliderVariants.tsx",
        "src/lib/builder/sectionLabelVariants.tsx",
        "src/lib/builder/animatedHeadingVariants.tsx",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx}",
        // Pure code-splitting glue (React.lazy + Suspense wrappers). The actual
        // widget implementations are covered via their own view components.
        "**/widget-view/lazyWidgets.tsx",
      ],
      thresholds: {
        statements: 98,
        functions: 98,
        lines: 98,
        // Branch coverage of the widget layer sits at ~92%. The remaining gap is
        // a long tail of cosmetic className-ternary arms and defensive guards;
        // 98% statements/functions/lines already exercise every widget behaviour.
        // Floored a touch below the achieved level to guard against regressions.
        branches: 90,
      },
    },
  },
});
