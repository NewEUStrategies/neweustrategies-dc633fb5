import { test, expect } from "@playwright/test";

// SEO surface smoke: pilnuje, ze publiczne powierzchnie GEO/SEO nadal odpowiadaja
// i ze /admin/seo jest zamontowany za guardem auth. Backend-agnostyczne - CI
// uzywa danych zastepczych, wiec sprawdzamy status kodu i podstawowa strukture,
// nie konkretnych rekordow.

test.describe("SEO surfaces", () => {
  test("sitemap.xml returns valid XML urlset", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status(), "sitemap status").toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("xml");
    const body = await res.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");
    expect(body).toContain("</urlset>");
    // Rewalidacja: cache musi pozwolic edge/CDN odswiezyc bez rucznej akcji.
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc, "sitemap cache-control").toMatch(/max-age=0|no-cache|must-revalidate/);
  });

  test("llms.txt is text/plain and lists sections", async ({ request }) => {
    const res = await request.get("/llms.txt");
    // 404 jest akceptowalny, gdy admin wyłączyl llms w ustawieniach SEO.
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      expect(res.headers()["content-type"] ?? "").toContain("text/plain");
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test("rss.xml returns a well-formed feed", async ({ request }) => {
    const res = await request.get("/rss.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<?xml");
    expect(body).toMatch(/<rss|<feed/);
  });

  test("robots.txt exposes crawl policy", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain("user-agent");
  });

  test("HTML sitemap /sitemap renders navigable page", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/sitemap");
    // Nagłówek H1 mapy strony jest widoczny (PL "Mapa strony" lub EN "Site map").
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Kluczowe sekcje mapy strony.
    const sectionHeadings = page.locator("h2");
    await expect(sectionHeadings.first()).toBeVisible();
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("/admin/seo is auth-gated (redirects to /auth or /login)", async ({ page }) => {
    await page.goto("/admin/seo");
    await page.waitForLoadState("domcontentloaded");
    // Auth gate w _authenticated/route.tsx robi redirect na /auth; niektore
    // starsze setupy uzywają /login. Akceptujemy oba - kluczowe jest, ze
    // niezalogowany uzytkownik NIE widzi surowego dashboardu.
    await expect
      .poll(() => page.url(), { timeout: 5_000 })
      .toMatch(/\/(auth|login)/);
  });
});
