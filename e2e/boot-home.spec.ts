import { expect, test } from "@playwright/test";

// Same production-artifact server as boot-timing. Backend-agnostic: this
// asserts content OR an honest recoverable fallback, never only body != empty.
for (const [path, lang] of [
  ["/", "pl"],
  ["/en", "en"],
] as const) {
  test(`homepage SSR and hydration remain usable (${lang})`, async ({ page, request }) => {
    const document = await request.get(path, { headers: { accept: "text/html" } });
    expect(document.status()).toBe(200);
    const html = await document.text();
    expect(html).toContain("data-site-shell");
    expect(html).toContain('id="main-content"');
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
        /hydration|hydrating|didn't match|Minified React error #(418|423|425)/i.test(message.text())
      ) {
        errors.push(message.text());
      }
    });
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.locator("[data-site-shell]")).toBeVisible();
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__nesAppReady === true)).toBe(true);
    const notice = page.locator("[data-home-loading]");
    if (await notice.count()) {
      await expect(notice.getByRole("status")).toBeVisible();
      await expect(notice.getByRole("button")).toBeEnabled();
    }
    expect(errors).toEqual([]);
  });
}
