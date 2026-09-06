import { expect, test } from "@playwright/test";

// Same production-artifact server as boot-timing. Backend-agnostic: this
// asserts content OR an honest recoverable fallback, never only body != empty.
for (const [path, lang] of [
  ["/", "pl"],
  ["/en", "en"],
] as const) {
  test.describe(`homepage locale ${lang}`, () => {
    test.use({ locale: lang === "pl" ? "pl-PL" : "en-GB" });
    test(`homepage SSR and hydration remain usable (${lang})`, async ({ page, request }) => {
      // The bare homepage negotiates Accept-Language. Pin the same input for
      // both the no-JS document request and the browser's navigation.
      await page.setExtraHTTPHeaders({ "accept-language": lang });
      const document = await request.get(path, {
        headers: { accept: "text/html", "accept-language": lang },
      });
      expect(document.status()).toBe(200);
      const html = await document.text();
      expect(html).toContain("data-site-shell");
      expect(html).toContain('id="main-content"');
      // The admin sheet has its own total budget and must never become a
      // public render-blocking dependency. Inspect real links, not JS strings
      // in the router manifest (which legitimately contains every route).
      expect(html).not.toMatch(/<link\b[^>]*href=["'][^"']*admin-styles[^"']*\.css/i);
      expect(document.headers()["link"]).toMatch(
        new RegExp(`/assets/${lang}-[\\w-]+\\.js[^,]*modulepreload`),
      );
      expect(document.headers()["link"]).toMatch(/\/assets\/index-[\w-]+\.js[^,]*modulepreload/);
      // Inspect the actual SSR body before JavaScript has a chance to repair it.
      if (html.includes("data-home-loading")) {
        expect(document.headers()["cache-control"]).toContain("no-store");
        expect(html).toContain(lang === "pl" ? "Wczytujemy stronę główną" : "Loading the homepage");
      }

      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          /hydration|hydrating|didn't match|Minified React error #(418|423|425)/i.test(
            message.text(),
          )
        ) {
          errors.push(message.text());
        }
      });
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("[data-site-shell]")).toBeVisible();
      await expect(page.locator("main#main-content")).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
      await expect(page.locator('link[rel="stylesheet"][href*="admin-styles"]')).toHaveCount(0);
      const notice = page.locator("[data-home-loading]");
      if (await notice.count()) {
        await expect(notice.getByRole("status")).toBeVisible();
        await expect(notice.getByRole("button")).toBeEnabled();
      }
      expect(errors).toEqual([]);
    });
  });
}
