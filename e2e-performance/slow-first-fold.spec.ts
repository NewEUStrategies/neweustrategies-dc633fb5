import { expect, test } from "@playwright/test";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

interface ShiftSample {
  at: number;
  value: number;
  nodes: string[];
}
declare global {
  interface Window {
    __slowFold: { title?: Element; shifts: ShiftSample[]; cls: number };
  }
}

// A three-column page whose central hero becomes the first mobile column.
// The SSR fixture delays posts beyond the loader deadline; hold app scripts
// until streamed HTML paints so hydration cannot conceal a collapsed shell.
for (const width of [390, 1440]) {
  test(`slow first fold keeps SSR content and geometry at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|Minified React error/.test(message.text()))
        errors.push(message.text());
    });
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (isFixtureBackend(request.url())) {
        const reply = await fixtureResponse(
          new Request(request.url(), {
            method: request.method(),
            headers: request.headers(),
            body: request.method() === "POST" ? request.postData() : undefined,
          }),
          { delayMs: 40 },
        );
        return route.fulfill({
          status: reply.status,
          headers: Object.fromEntries(reply.headers),
          body: await reply.text(),
        });
      }
      if (isAnalyticsScript(request.url()))
        return route.fulfill({ body: "", contentType: "application/javascript" });
      if (request.resourceType() === "image")
        return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
      if (request.resourceType() === "script") await scriptsReady;
      await route.continue();
    });
    await page.addInitScript(() => {
      window.__slowFold = { shifts: [], cls: 0 };
      let sessionStart = 0;
      let lastShift = 0;
      let sessionValue = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources?: Array<{ node?: Node }>;
          }
        >) {
          if (entry.hadRecentInput) continue;
          if (entry.startTime - lastShift < 1000 && entry.startTime - sessionStart < 5000) {
            sessionValue += entry.value;
          } else {
            sessionStart = entry.startTime;
            sessionValue = entry.value;
          }
          lastShift = entry.startTime;
          window.__slowFold.cls = Math.max(window.__slowFold.cls, sessionValue);
          window.__slowFold.shifts.push({
            at: entry.startTime,
            value: entry.value,
            nodes: (entry.sources ?? []).map(({ node }) =>
              node instanceof Element ? node.outerHTML.slice(0, 450) : "detached",
            ),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    const response = await page.goto("/", { waitUntil: "commit" });
    try {
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      expect(html).not.toContain("ssr-doc-guard:truncated");
      expect(html).not.toContain("$RX(");
      const hero = page.locator('main .eh-slider[data-variant="editorial-hero"]').first();
      await expect(hero.locator(".cms-post-title")).toHaveText(
        String(homeFixture.posts[0].title_pl),
      );
      await expect(hero.locator("img.eh-img").first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const initial = await hero.evaluate((element) => {
        const widget = element.closest("[data-widget-id]")!;
        const image = element.querySelector("img.eh-img")!;
        const title = element.querySelector(".cms-post-title")!;
        window.__slowFold.title = title;
        return {
          widget: widget.getBoundingClientRect().toJSON(),
          image: image.getBoundingClientRect().toJSON(),
        };
      });
      // Catch shrink-to-content media even when title text has a smaller width.
      expect(initial.image.width).toBeGreaterThan(initial.widget.width * 0.95);
      releaseScripts();
      await page.waitForFunction(() => window.__nesAppReady === true);
      await expect(page.locator("main [data-builder-renderer]").first()).toHaveAttribute(
        "data-device",
        width < 768 ? "mobile" : "desktop",
      );
      // Observe the first post-hydration paints without a user click suppressing CLS.
      await page.waitForTimeout(1000);
      const settled = await hero.evaluate((element) => {
        const state = window.__slowFold;
        return {
          retained: element.querySelector(".cms-post-title") === state.title,
          rect: element.closest("[data-widget-id]")!.getBoundingClientRect().toJSON(),
          shifts: state.shifts,
          cls: state.cls,
        };
      });
      console.log("FIRST_FOLD_GEOMETRY", JSON.stringify({ initial, settled, errors }));
      await testInfo.attach("first-fold-geometry", {
        body: JSON.stringify({ initial, settled, errors }, null, 2),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      expect(settled.retained).toBe(true);
      expect(Math.abs(settled.rect.width - initial.widget.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(settled.rect.y - initial.widget.y)).toBeLessThanOrEqual(1);
      expect(settled.cls).toBeLessThan(0.1);
    } finally {
      releaseScripts();
    }
  });
}
