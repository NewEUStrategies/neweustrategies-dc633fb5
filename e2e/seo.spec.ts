import { test, expect } from "@playwright/test";

// SEO surface smoke: pilnuje, ze publiczne powierzchnie GEO/SEO nadal odpowiadaja
// i ze /admin/seo jest zamontowany za guardem auth. Backend-agnostyczne - CI
// uzywa danych zastepczych, wiec sprawdzamy status kodu i podstawowa strukture,
// nie konkretnych rekordow.

test.describe("SEO surfaces", () => {
  test("sitemap.xml is a sitemapindex pointing at shard files", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status(), "sitemap status").toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("xml");
    const body = await res.text();
    expect(body).toContain("<?xml");
    // /sitemap.xml jest INDEKSEM (limit 50 000 adresow na plik), a nie jednym
    // wielkim <urlset> - adresy mieszkaja w shardach /sitemaps/<sekcja>.xml.
    expect(body).toContain("<sitemapindex");
    expect(body).toContain("</sitemapindex>");
    expect(body).toMatch(/<loc>[^<]*\/sitemaps\/core\.xml<\/loc>/);
    // Rewalidacja: cache musi pozwolic edge/CDN odswiezyc bez rucznej akcji.
    const cc = res.headers()["cache-control"] ?? "";
    expect(cc, "sitemap cache-control").toMatch(/max-age=0|no-cache|must-revalidate/);
  });

  test("every sitemap listed in the index resolves to a urlset", async ({ request }) => {
    const index = await (await request.get("/sitemap.xml")).text();
    const locs = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length, "index nie moze byc pusty").toBeGreaterThan(0);
    for (const loc of locs) {
      const path = new URL(loc, "http://localhost").pathname;
      const res = await request.get(path);
      expect(res.status(), `${path} status`).toBe(200);
      const body = await res.text();
      // news-sitemap ma wlasny format (news:), pozostale shardy to <urlset>.
      expect(body, `${path} zawartosc`).toMatch(/<urlset/);
    }
  });

  test("an unknown sitemap shard is a 404, not an empty urlset", async ({ request }) => {
    // Pusty plik w Search Console wyglada jak blad publikacji; 404 czysci wpis.
    expect((await request.get("/sitemaps/nie-ma-takiej-sekcji.xml")).status()).toBe(404);
    // Shard pierwszy mieszka pod "core.xml" - "-1" byloby duplikatem adresu.
    expect((await request.get("/sitemaps/core-1.xml")).status()).toBe(404);
  });

  test("sitemap-index.xml redirects to the canonical index", async ({ request }) => {
    const res = await request.get("/sitemap-index.xml", { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"] ?? "").toContain("/sitemap.xml");
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
    // Na hoscie kanonicznym KAZDA zadeklarowana sitemapa musi byc osiagalna -
    // robots kierujacy crawlera na 404 to gotowy blad w Search Console.
    // (Na hostach podgladowych robots celowo nie deklaruje zadnej sitemapy.)
    for (const line of body.split("\n").filter((l) => l.startsWith("Sitemap:"))) {
      const url = line.slice("Sitemap:".length).trim();
      expect(url, "Sitemap musi byc adresem absolutnym").toMatch(/^https?:\/\//);
    }
  });

  // REGRESJA WDROZENIOWA (audyt 2026-08-06): `public/robots.txt` trafial do
  // `.output/public/`, ktore wrangler wiaze jako `assets`, a warstwa assetow
  // odpowiada PRZED workerem - dynamiczna trasa byla na produkcji nieosiagalna
  // i KAZDY host dostawal statyczne `Allow: /` z jedna sitemapa. Ten test
  // sprawdza dwie rzeczy, ktorych plik statyczny miec nie moze: naglowek
  // `X-Robots-Tag` (warstwa assetow go nie dokłada) i polityke ZALEZNA od hosta.
  // Suite jedzie po hoscie podgladowym (127.0.0.1), wiec kontraktem jest tu
  // pelny zakaz - dokladne przeciwienstwo tresci starego statycznego pliku.
  test("robots.txt is served by the route, not by a static asset", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    // Naglowek = dowod, ze odpowiedziala trasa.
    expect(res.headers()["x-robots-tag"] ?? "", "X-Robots-Tag").toContain("noindex");

    const body = await res.text();
    // Host podgladowy: pelny zakaz i ZERO deklaracji sitemap. Gdyby wrocil
    // statyczny plik (`Allow: /` + `Sitemap:`), obie asercje padna.
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("Allow: /");
    expect(body).not.toContain("Sitemap:");

    // Sfalszowany `X-Forwarded-Host` wskazujacy niezarejestrowana domene NIE
    // MOZE otworzyc indeksowania - host jest walidowany wzgledem tenants.domain
    // (pickTrustedHost), a powierzchnie crawlera sa fail-closed.
    const spoofed = await request.get("/robots.txt", {
      headers: { "x-forwarded-host": "squatter.invalid" },
    });
    expect(spoofed.headers()["x-robots-tag"] ?? "").toContain("noindex");
    expect(await spoofed.text()).toContain("Disallow: /");
  });

  test("content feeds respond for the tracker and live coverage", async ({ request }) => {
    // Dwa kanaly dopisane w audycie - 404 jest akceptowalny tylko gdy redakcja
    // wylaczyla RSS w ustawieniach SEO (wtedy /rss.xml tez zwraca 404).
    const site = await request.get("/rss.xml");
    for (const path of ["/tracker/rss.xml", "/live/rss.xml"]) {
      const res = await request.get(path);
      if (site.status() === 404) {
        expect(res.status(), `${path} przy wylaczonym RSS`).toBe(404);
        continue;
      }
      expect(res.status(), `${path} status`).toBe(200);
      const body = await res.text();
      expect(body).toContain("<?xml");
      expect(body).toContain("<rss");
    }
  });

  test("podcast feed is auto-discoverable from the podcast pages", async ({ page }) => {
    await page.goto("/podcasts");
    // Autodiscovery to jedyny sposob, w jaki czytnik RSS / Apple Podcasts znajduje
    // kanal bez znajomosci naszej konwencji URL.
    const feed = page.locator('link[rel="alternate"][type="application/rss+xml"]');
    expect(await feed.count()).toBeGreaterThan(0);
    const hrefs = await feed.evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
    expect(hrefs.some((h) => h.includes("/podcast/rss.xml"))).toBe(true);
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

  // Regresyjny kontrakt <head>: og:image / og:title / viewport / lang muszą byc
  // obecne na kazdej publicznej powierzchni - to te same findingi, ktore wracaly.
  for (const path of ["/", "/en", "/blog", "/qa"]) {
    test(`head contract on ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), "status").toBeLessThan(400);
      const lang = await page.locator("html").getAttribute("lang");
      expect(lang, "html[lang]").toMatch(/^(pl|en)$/);
      const viewport = await page.locator('meta[name="viewport"]').first().getAttribute("content");
      expect(viewport ?? "", "viewport").toContain("width=device-width");
      const ogTitle = await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute("content");
      expect((ogTitle ?? "").length, "og:title").toBeGreaterThan(3);
      const ogImage = await page
        .locator('meta[property="og:image"]')
        .first()
        .getAttribute("content");
      expect(ogImage ?? "", "og:image absolute").toMatch(/^https?:\/\//);
      const canonical = await page.locator('link[rel="canonical"]').first().getAttribute("href");
      expect(canonical ?? "", "canonical absolute").toMatch(/^https?:\/\//);
      const title = await page.title();
      expect(title.toLowerCase()).not.toContain("lovable");
    });
  }

  test("Q&A session emits QAPage or breadcrumb JSON-LD", async ({ page }) => {
    await page.goto("/qa");
    const first = page.locator('a[href^="/qa/"]').first();
    if ((await first.count()) === 0) test.skip(true, "brak publicznych sesji Q&A w tym srodowisku");
    await first.click();
    await page.waitForLoadState("domcontentloaded");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const types = blocks.flatMap((b) => {
      try {
        const parsed: unknown = JSON.parse(b);
        return [(parsed as { "@type"?: string })["@type"] ?? ""];
      } catch {
        return [];
      }
    });
    expect(types).toContain("BreadcrumbList");
  });

  test("/admin/seo is auth-gated (redirects to /auth or /login)", async ({ page }) => {
    await page.goto("/admin/seo");
    await page.waitForLoadState("domcontentloaded");
    // Auth gate w _authenticated/route.tsx robi redirect na /auth; niektore
    // starsze setupy uzywają /login. Akceptujemy oba - kluczowe jest, ze
    // niezalogowany uzytkownik NIE widzi surowego dashboardu.
    // Timeout 30 s, nie 5 s: suita jedzie na dev-serverze (patrz e2e.yml),
    // a pierwsze wejście w /admin/* kompiluje cały graf panelu na zimno -
    // guard klienta odpala się dopiero po dociągnięciu chunka trasy.
    await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(/\/(auth|login)/);
  });
});
