import { expect, test } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  fixtureImage,
  fixtureResponse,
  homeFixture,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

declare global {
  interface Window {
    __firstVisit: {
      readyAt: number | null;
      lcp: number;
      cls: number;
      shifts: Array<{ at: number; value: number; nodes: string[] }>;
      serverTitle?: Element;
    };
  }
}

// Same production artifact, synthetic homepage with representative builder
// layout, controlled 40 ms DB round trips and one SVG. Lab budgets, not production
// p75 or a claim about reader networks. Blank/degraded HTML cannot pass.
for (const [path, lang] of [
  ["/", "pl"],
  ["/en", "en"],
] as const) {
  for (const sample of [1, 2, 3]) {
    test(`first visit ${lang}, sample ${sample}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      await page.setExtraHTTPHeaders({ "accept-language": lang });
      await page.route("**/*", async (route) => {
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
            // Gather every missing fixture in a run, without letting an
            // unrecorded request escape to a real backend or pass the test.
            errors.push(String(error));
            return Response.json({ message: String(error) }, { status: 501 });
          });
          return route.fulfill({
            status: reply.status,
            headers: Object.fromEntries(reply.headers),
            body: await reply.text(),
          });
        }
        // Stable test image, no external CDN variance in before/after.
        if (req.resourceType() === "image" && new URL(req.url()).hostname !== "127.0.0.1") {
          return route.fulfill({ body: fixtureImage, contentType: homeFixture.fixture_image_type });
        }
        await route.continue();
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          /hydration|Minified React error|Unrecorded performance fixture/.test(message.text())
        )
          errors.push(message.text());
      });
      await page.addInitScript(() => {
        window.__firstVisit = { readyAt: null, lcp: 0, cls: 0, shifts: [] };
        const serverContent = new MutationObserver(() => {
          const title = document.querySelector("main .cms-post-title");
          if (title) {
            window.__firstVisit.serverTitle = title;
            serverContent.disconnect();
          }
        });
        serverContent.observe(document, { childList: true, subtree: true });
        let ready = false;
        Object.defineProperty(window, "__nesAppReady", {
          configurable: true,
          get: () => ready,
          set: (value: boolean) => {
            ready = value;
            if (value && window.__firstVisit.readyAt === null)
              window.__firstVisit.readyAt = performance.now();
          },
        });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__firstVisit.lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        let sessionStart = 0;
        let lastShift = 0;
        let sessionValue = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
              sources?: Array<{ node?: Element }>;
            }
          >) {
            if (!entry.hadRecentInput) {
              // CLS is the largest session window: gaps below 1 s, at most
              // 5 s per window. Keep individual entries for attribution too.
              if (entry.startTime - lastShift < 1000 && entry.startTime - sessionStart < 5000) {
                sessionValue += entry.value;
              } else {
                sessionStart = entry.startTime;
                sessionValue = entry.value;
              }
              lastShift = entry.startTime;
              window.__firstVisit.cls = Math.max(window.__firstVisit.cls, sessionValue);
              window.__firstVisit.shifts.push({
                at: entry.startTime,
                value: entry.value,
                nodes: (entry.sources ?? []).map(({ node }) =>
                  node
                    ? `${node.tagName}.${node.className} widget=${node.closest("[data-widget-id]")?.getAttribute("data-widget-id") ?? ""}`
                    : "detached",
                ),
              });
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      const html = await response!.text();
      expect(html).not.toContain("data-home-loading");
      expect(html).not.toContain("ssr-doc-guard:truncated");
      expect(html).not.toContain("$RX(");
      expect(html).toContain("data-builder-renderer");
      const title = String(homeFixture.posts[0][lang === "pl" ? "title_pl" : "title_en"]);
      await expect(
        page.locator("main").getByRole("heading", { name: title, exact: true }).first(),
      ).toBeVisible();
      await page.waitForFunction(() => window.__nesAppReady === true);
      const beforeInteraction = await page.evaluate(() => ({
        at: performance.now(),
        cls: window.__firstVisit.cls,
        lcp: window.__firstVisit.lcp,
      }));
      // A painted shell/ready flag alone is insufficient: exercise its handler.
      const darkBefore = await page
        .locator("html")
        .evaluate((node) => node.classList.contains("dark"));
      const themeLabel =
        lang === "pl"
          ? darkBefore
            ? "Tryb jasny"
            : "Tryb ciemny"
          : darkBefore
            ? "Light mode"
            : "Dark mode";
      await page.getByRole("button", { name: themeLabel, exact: true }).first().click();
      await expect
        .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
        .toBe(!darkBefore);
      const browser = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        return {
          ttfbMs: nav.responseStart,
          fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
          readyMs: window.__firstVisit.readyAt,
          interactionCompleteMs: performance.now(),
          lcpMs: window.__firstVisit.lcp,
          cls: window.__firstVisit.cls,
          shifts: window.__firstVisit.shifts,
          serverTitleRetained: window.__firstVisit.serverTitle?.isConnected ?? false,
          jsBytes: resources
            .filter((entry) => /\.js(?:\?|$)/.test(entry.name))
            .reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        };
      });
      const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
        (match) => match[1],
      );
      const result = {
        path,
        sample,
        cache: response!.headers()["x-nes-cache"],
        serverTiming: response!.headers()["server-timing"],
        htmlBytes: Buffer.byteLength(html),
        inlineCssBytes: Buffer.byteLength(inlineStyles.join("")),
        styleBlocks: inlineStyles.length,
        beforeInteraction,
        ...browser,
      };
      console.log("FIRST_VISIT " + JSON.stringify(result));
      mkdirSync("reports/first-visit", { recursive: true });
      writeFileSync(
        `reports/first-visit/${lang}-${sample}.json`,
        JSON.stringify(result, null, 2) + "\n",
      );
      await testInfo.attach("first-visit", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
      });
      expect(errors).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${lang}-${sample}.png`) });
      // The comparison job measures the base commit with the same content and
      // interaction assertions. Only the candidate must meet the new budgets.
      if (process.env.NES_PERFORMANCE_BASELINE === "1") return;
      expect(result.serverTitleRetained, "hydration must retain the server-rendered article").toBe(
        true,
      );
      expect(
        result.inlineCssBytes,
        "inline builder CSS is part of the first document",
      ).toBeLessThan(160_000);
      expect(result.htmlBytes).toBeLessThan(650_000);
      expect(result.ttfbMs).toBeLessThan(2000);
      expect(result.fcpMs).toBeGreaterThan(0);
      expect(result.fcpMs).toBeLessThan(2500);
      expect(result.lcpMs).toBeGreaterThan(0);
      expect(result.lcpMs).toBeLessThan(2500);
      expect(result.readyMs).not.toBeNull();
      expect(result.readyMs!).toBeLessThan(3000);
      expect(result.interactionCompleteMs).toBeLessThan(3500);
      expect(result.cls).toBeLessThan(0.1);
    });
  }
}
