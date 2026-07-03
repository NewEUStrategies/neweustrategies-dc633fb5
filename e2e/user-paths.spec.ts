// Real user journeys over SEEDED data (supabase/seed.sql). These are the
// data-driven complement to the structural smokes in public/seo/checkout:
// article reading (incl. the raw-SSR crawler check), language switch,
// taxonomy archive, full-text search, sign-in and the crawler feeds.
//
// They require a running local Supabase with the seed applied:
//   supabase db reset            # migrations + seed.sql
//   E2E_SEEDED=1 bun run test:e2e
// Without E2E_SEEDED the whole file is skipped (CI without a DB stays green
// and honest - a skip is visible, a fake pass is not).
import { test, expect } from "@playwright/test";

const SEEDED = process.env.E2E_SEEDED === "1";

const POST = {
  path: "/blog/seed-wpis-1",
  title_pl: "Nowa architektura bezpieczeństwa Europy",
  title_en: "A new security architecture for Europe",
};

test.describe("user paths (seeded)", () => {
  test.skip(!SEEDED, "requires seeded local Supabase (E2E_SEEDED=1 after supabase db reset)");

  test("reader finds an article from the blog list and reads it", async ({ page }) => {
    await page.goto("/blog");
    const link = page.getByText(POST.title_pl).first();
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(`**${POST.path}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(POST.title_pl);
    // Body content rendered (not a skeleton).
    await expect(page.getByText("Kontekst").first()).toBeVisible();
  });

  test("SSR delivers the full article to crawlers (no JS executed)", async ({ request }) => {
    // Raw fetch = what Googlebot's first wave and every RSS/AI crawler sees.
    const res = await request.get(POST.path);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain(POST.title_pl);
    // The article body must be part of the HTML payload, not hydrated later.
    expect(html).toContain("Kontekst");
    // JSON-LD article graph is emitted server-side.
    expect(html).toContain("application/ld+json");
  });

  test("language switch serves the English variant under /en", async ({ page }) => {
    await page.goto(`/en${POST.path}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(POST.title_en);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("category archive lists the seeded posts", async ({ page }) => {
    await page.goto("/category/polityka-europejska");
    await expect(page.getByText(POST.title_pl).first()).toBeVisible();
  });

  test("full-text search finds a seeded article", async ({ page }) => {
    await page.goto("/search?q=bezpiecze%C5%84stwa");
    await expect(page.getByText(POST.title_pl).first()).toBeVisible();
  });

  test("staff sign-in lands in the admin panel", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("admin@nes.local");
    await page.locator('input[type="password"]').fill("nes-dev-1234");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL("**/admin**", { timeout: 15_000 });
    expect(page.url()).toContain("/admin");
  });

  test("crawler surfaces advertise the seeded article", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain(POST.path);
    const rss = await (await request.get("/rss.xml")).text();
    expect(rss).toContain(POST.title_pl);
  });

  test("legacy /post/<slug> URL redirects permanently (301) to the canonical path", async ({
    request,
  }) => {
    // 301 (not 307) so crawlers transfer link equity to the canonical URL.
    const res = await request.get("/post/seed-wpis-1", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"] ?? "").toContain(POST.path);
  });
});
