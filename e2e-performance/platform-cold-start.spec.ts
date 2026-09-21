import { expect, test } from "@playwright/test";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

// Run through run-platform-cold-start.mjs: every catalog gets a new server and
// browser. Empty catalogs are deliberate; populated data and outage recovery
// are covered by route tests. This checks the real SSR/chunk/hydration boundary.
for (const path of ["/events", "/experts", "/programs", "/podcasts", "/live", "/web-stories"]) {
  test(`platform cold entry ${path}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|Minified React error/i.test(message.text()))
        errors.push(message.text());
    });
    await page.route(
      (url) => url.hostname !== "127.0.0.1" || isFixtureBackend(url.href),
      async (route) => {
        const req = route.request();
        if (isFixtureBackend(req.url())) {
          const reply = await fixtureResponse(
            new Request(req.url(), {
              method: req.method(),
              headers: req.headers(),
              body: req.method() === "POST" ? req.postData() : undefined,
            }),
            { delayMs: 40 },
          ).catch((error: unknown) => {
            errors.push(String(error));
            return Response.json({ message: String(error) }, { status: 501 });
          });
          return route.fulfill({
            status: reply.status,
            headers: Object.fromEntries(reply.headers),
            body: await reply.text(),
          });
        }
        if (isAnalyticsScript(req.url()))
          return route.fulfill({ body: "", contentType: "text/javascript" });
        if (req.resourceType() === "image")
          return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
        return route.continue();
      },
    );
    await page.addInitScript(() => {
      const metrics = { lcp: 0, cls: 0, interaction: 0 };
      Object.assign(window, { __platformMetrics: metrics });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      let start = 0,
        last = 0,
        value = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { value: number; hadRecentInput: boolean }
        >) {
          if (entry.hadRecentInput) continue;
          if (entry.startTime - last < 1000 && entry.startTime - start < 5000) value += entry.value;
          else {
            start = entry.startTime;
            value = entry.value;
          }
          last = entry.startTime;
          metrics.cls = Math.max(metrics.cls, value);
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & { interactionId: number }
        >) {
          if (entry.interactionId)
            metrics.interaction = Math.max(metrics.interaction, entry.duration);
        }
      }).observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    });
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-nes-cache"]).toBe("MISS");
    const html = await response!.text();
    expect(html).toMatch(/<h1\b/);
    expect(html).not.toMatch(/ssr-doc-guard:truncated|\$RX\(/);
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.getByText("Ta sekcja chwilowo nie ma danych", { exact: true })).toHaveCount(
      0,
    );
    await page.waitForFunction(() => window.__nesAppReady === true);
    const darkBefore = await page
      .locator("html")
      .evaluate((node) => node.classList.contains("dark"));
    await page
      .getByRole("button", { name: darkBefore ? "Tryb jasny" : "Tryb ciemny", exact: true })
      .first()
      .click();
    await expect
      .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
      .toBe(!darkBefore);
    // The consent surface loads after the route. Include its first interaction
    // so a ready body alone cannot hide a broken shared overlay.
    await page.getByRole("button", { name: "Tylko niezbędne", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Zarządzaj swoją prywatnością" })).toHaveCount(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const measured = (
        window as unknown as {
          __platformMetrics: { lcp: number; cls: number; interaction: number };
        }
      ).__platformMetrics;
      return {
        ttfbMs: nav.responseStart,
        fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
        lcpMs: measured.lcp,
        cls: measured.cls,
        // Lab event duration for the tested interactions, not field INP/p75.
        maxInteractionMs: measured.interaction,
      };
    });
    await testInfo.attach("platform-cold-entry", {
      body: JSON.stringify({ path, ...metrics }, null, 2),
      contentType: "application/json",
    });
    console.log("PLATFORM_COLD_ENTRY", JSON.stringify({ path, ...metrics }));
    expect(errors).toEqual([]);
    expect(metrics.ttfbMs).toBeLessThan(2000);
    expect(metrics.fcpMs).toBeGreaterThan(0);
    expect(metrics.lcpMs).toBeGreaterThan(0);
    expect(metrics.lcpMs).toBeLessThan(2500);
    expect(metrics.cls).toBeLessThan(0.1);
  });
}
