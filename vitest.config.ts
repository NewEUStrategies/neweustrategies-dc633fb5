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
        // Public-pipeline modules guarded beyond the widget surface: content
        // engine selection, builder-doc validation, cache policy, the
        // observability transport, SEO meta and access gating. Each carries its
        // own per-file threshold below, so the widget gate stays independent.
        "src/lib/content/contentEngine.ts",
        "src/lib/builder/schema.ts",
        "src/lib/http/cachePolicy.ts",
        "src/lib/observability/report.ts",
        "src/lib/seo/meta.ts",
        "src/lib/access/gating.ts",
        // Public critical path: the URL-splat resolver helpers and the single-post
        // layout renderer (cover LCP optimization + layout presets).
        "src/lib/routing/publicSegments.ts",
        "src/components/PostLayoutRenderer.tsx",
        // RUM analytics: the pure Web Vitals aggregator + shared thresholds that
        // back the admin performance dashboard.
        "src/lib/observability/aggregate.ts",
        "src/lib/observability/vitalsThresholds.ts",
        // Billing critical path: the Stripe webhook reconciliation handler and
        // the single entitlement-grant point (what turns payment into access).
        "src/routes/api/public/webhooks.stripe.ts",
        "src/lib/billing/grant.server.ts",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx}",
        // Pure code-splitting glue (React.lazy + Suspense wrappers). The actual
        // widget implementations are covered via their own view components.
        "**/widget-view/lazyWidgets.tsx",
      ],
      thresholds: {
        // Global bar = the builder widget rendering surface. Files with a
        // per-glob threshold below are checked against that instead and excluded
        // from this aggregate.
        statements: 98,
        functions: 98,
        lines: 98,
        // Branch coverage of the widget layer sits at ~92%. The remaining gap is
        // a long tail of cosmetic className-ternary arms and defensive guards;
        // 98% statements/functions/lines already exercise every widget behaviour.
        // Floored a touch below the achieved level to guard against regressions.
        branches: 90,
        // Per-file bars for the newly-guarded public-pipeline modules. Floored a
        // touch below the achieved coverage to catch regressions without being
        // brittle.
        "src/lib/content/contentEngine.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/http/cachePolicy.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/lib/builder/schema.ts": { statements: 98, functions: 100, lines: 100, branches: 95 },
        // report.ts line 14 is the defensive `catch` around import.meta.env,
        // which cannot be exercised from a test - hence < 100 here.
        "src/lib/observability/report.ts": {
          statements: 94,
          functions: 100,
          lines: 93,
          branches: 90,
        },
        // meta.ts: statements/lines/functions are fully covered; the optional
        // OpenGraph/article/paywall arms keep branch coverage lower.
        "src/lib/seo/meta.ts": { statements: 100, functions: 100, lines: 100, branches: 70 },
        "src/lib/access/gating.ts": { statements: 95, functions: 100, lines: 100, branches: 95 },
        // publicSegments: two pure helpers, fully exercised.
        "src/lib/routing/publicSegments.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // PostLayoutRenderer: every statement/line/function hit; the remaining
        // branch arms are unreachable `hasSidebar`/center fallbacks on presets
        // that never take them (floored just below the achieved ~91%).
        "src/components/PostLayoutRenderer.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // RUM aggregator + thresholds: pure, fully exercised.
        "src/lib/observability/aggregate.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/observability/vitalsThresholds.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Billing critical path (payment -> access). Floored just below the
        // achieved coverage. webhooks.stripe: the un-hit arms are the framework
        // POST route-arrow (handle() is tested directly) and the catch-all 500,
        // which is why functions/branches sit below 100.
        "src/routes/api/public/webhooks.stripe.ts": {
          statements: 90,
          functions: 85,
          lines: 90,
          branches: 75,
        },
        "src/lib/billing/grant.server.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
      },
    },
  },
});
