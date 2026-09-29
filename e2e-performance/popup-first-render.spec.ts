import { expect, test } from "@playwright/test";
import { popupFixtureSettings } from "../scripts/performance/popupFixture";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

// Production artifact + synthetic CMS settings. No accounts or database writes.
// Run via test:e2e:performance or with NES_PERFORMANCE_CASE=popup-first-render.
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`popup renders complete after a slow chunk: ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    const imageRequests: string[] = [];
    let releaseChunk: () => void = () => {};
    let requested = false;
    const pendingChunk = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (/\/SignupPopupPanel-[^/]+\.js$/.test(url.pathname)) {
        requested = true;
        await pendingChunk;
        return route.continue();
      }
      if (url.pathname === "/rest/v1/newsletter_settings" && request.method() === "GET") {
        const settings = popupFixtureSettings;
        return route.fulfill({
          json: request.headers().accept?.includes("application/vnd.pgrst.object+json")
            ? settings
            : [settings],
          headers: { "access-control-allow-origin": "*" },
        });
      }
      if (isFixtureBackend(url.href)) {
        const response = await fixtureResponse(
          new Request(url, {
            method: request.method(),
            headers: request.headers(),
            body: request.method() === "POST" ? request.postData() : undefined,
          }),
          { delayMs: 40 },
        );
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      }
      if (url.pathname.startsWith("/media/popup-test/")) {
        imageRequests.push(url.href);
        // A CDN transform failure must recover using the same-origin original.
        if (url.pathname.endsWith("/2.jpg") && url.searchParams.has("width"))
          return route.fulfill({ status: 404 });
        return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
      }
      if (isAnalyticsScript(url.href))
        return route.fulfill({ body: "", contentType: "application/javascript" });
      if (request.resourceType() === "image" && url.hostname !== "127.0.0.1")
        return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
      return route.continue();
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__nesAppReady === true);
      await page.getByRole("button", { name: /Akceptuj wszystkie|Accept all/i }).click();
      await expect
        .poll(() => requested, { message: "popup content chunk requested", timeout: 15_000 })
        .toBe(true);
      // Warmup starts 1.5s before the configured trigger. Keep the chunk pending
      // beyond that trigger and assert the old empty-overlay state cannot occur.
      await page.waitForTimeout(1700);
      const popup = page.getByRole("dialog").filter({ has: page.locator("#nl-popup-title") });
      await expect(popup).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
      releaseChunk();
      await expect(popup).toBeVisible();
      await expect(popup.locator('input[type="email"]')).toBeVisible();
      await expect(popup.getByRole("button", { name: "Zamknij", exact: true })).toBeVisible();
      await expect(popup.locator('[aria-busy="true"]')).toHaveCount(0);
      const images = popup.locator("[data-showcase-grid] img");
      await expect(images).toHaveCount(4);
      await expect
        .poll(() =>
          images.evaluateAll((nodes) =>
            nodes.every(
              (node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
            ),
          ),
        )
        .toBe(true);
      expect(imageRequests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
      expect(imageRequests.some((url) => new URL(url).searchParams.has("width"))).toBe(true);
      expect(
        imageRequests.some(
          (url) =>
            new URL(url).pathname.endsWith("/2.jpg") && !new URL(url).searchParams.has("width"),
        ),
      ).toBe(true);
      expect(
        await images.evaluateAll((nodes) =>
          nodes.every((node) => node.getAttribute("loading") === "eager"),
        ),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath("popup.png") });
      const hydration = await page.evaluate(() => ({
        ready: window.__nesAppReadyAt ?? 0,
        popup: performance
          .getEntriesByType("resource")
          .filter((entry) =>
            /\/(?:NewsletterPopup|SignupPopupPanel|PopupSignupForm)-/.test(
              new URL(entry.name).pathname,
            ),
          )
          .map((entry) => entry.startTime),
      }));
      expect(hydration.popup.length).toBeGreaterThan(0);
      expect(hydration.popup.every((start) => start >= hydration.ready)).toBe(true);
      if (viewport.width < 500) {
        await page.setViewportSize({ width: 390, height: 420 });
        await popup.locator('input[type="email"]').focus();
        await expect(popup.locator('input[type="email"]')).toBeInViewport({ ratio: 1 });
      }
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      releaseChunk();
    }
  });
}
