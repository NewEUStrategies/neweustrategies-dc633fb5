import { test, expect } from "@playwright/test";

// SSR completeness smoke: a hanging render-phase query used to freeze the
// dehydrate stream mid-payload, so crawlers got HTTP 200 with truncated HTML
// (no `</html>`, no hydration script) and reported the page as broken.
// These tests fail the build if any key page stops returning COMPLETE HTML
// within the threshold.

/** Max time a fully-streamed SSR document may take. */
const SSR_BUDGET_MS = 20_000;

const PAGES = [
  { path: "/", label: "home (PL)" },
  { path: "/en", label: "home (EN)" },
  { path: "/blog", label: "blog listing" },
  // Trasa PLIKOWA bez zapytań suspense: suita jest backend-agnostyczna
  // (placeholderowe Supabase w CI). Strony CMS-owe (np. /o-nas) nie istnieją
  // bez seeda, a /experts (useSuspenseQuery) odpowiada 500, gdy SSR-owe
  // zapytanie zostanie ubite po timeoutcie. /cookies degraduje z założenia
  // (loader z catch -> null) - zweryfikowane: 200 + pełny dokument bez bazy.
  { path: "/cookies", label: "cookie policy" },
];

test.describe("SSR HTML completeness", () => {
  for (const { path, label } of PAGES) {
    test(`${label} (${path}) streams complete HTML in time`, async ({ request }) => {
      const started = Date.now();
      const res = await request.get(path, { timeout: SSR_BUDGET_MS });
      const body = await res.text();
      const elapsed = Date.now() - started;

      expect(res.status(), `${path} status`).toBeLessThan(400);
      expect(body, `${path} must open a document`).toContain("<html");
      // The regression signature: the stream stalls before the closing tag.
      expect(body.trimEnd().endsWith("</html>"), `${path} must close </html>`).toBe(true);
      expect(elapsed, `${path} SSR budget`).toBeLessThan(SSR_BUDGET_MS);
    });
  }

  test("home page renders an h1 without hydration-blocking errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/", { waitUntil: "load", timeout: SSR_BUDGET_MS });
    await expect(page.locator("h1").first()).toBeVisible();
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });
});
