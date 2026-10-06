import { expect, test, type Request as BrowserRequest } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { installFirstVisitLcpObserver } from "../scripts/performance/firstVisitLcp";
import { installFirstVisitMainThreadObserver } from "../scripts/performance/firstVisitMainThread";
import { installFirstVisitStreamingObserver } from "../scripts/performance/firstVisitStreaming";
import {
  firstVisitCacheStates,
  firstVisitPages,
  firstVisitSamples,
} from "../scripts/performance/firstVisitPlan";
import {
  fixtureImageFor,
  fixtureResponse,
  homeFixture,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

declare global {
  interface Window {
    __firstVisit: {
      readyAt: number | null;
      cls: number;
      shifts: Array<{ at: number; value: number; nodes: string[] }>;
      serverTitle?: Element;
    };
    /** Wyspy sekcji i stopki (P2.2): stan przy kliknięciu, klasa motywu po klatce, przesunięcia w wyspach. */
    __p22: {
      pendingAtClick: number | null;
      classAfterFrame: boolean | null;
      islandShifts: Array<{ at: number; value: number }>;
    };
  }
}

/** Wyspy hydratacji sekcji treści (P2.2) i stopki. */
const CONTENT_ISLANDS = '[data-island-id^="sec-"], [data-island-id="site-footer"]';

// Same production artifact, synthetic homepage with representative builder
// layout, controlled 40 ms DB round trips, one SVG for logos and icons and one
// raster cover for the hero and the cards. Lab budgets, not production p75 or a
// claim about reader networks. Blank/degraded HTML cannot pass.
for (const { path, lang } of firstVisitPages) {
  for (const cacheState of firstVisitCacheStates) {
    for (const sample of firstVisitSamples) {
      test(`first visit ${lang}, ${cacheState}, sample ${sample}`, async ({
        page,
        request,
      }, testInfo) => {
        const errors: string[] = [];
        const pendingScripts = new Set<BrowserRequest>();
        let lastScriptActivity = Date.now();
        page.on("request", (request) => {
          if (request.resourceType() !== "script") return;
          pendingScripts.add(request);
          lastScriptActivity = Date.now();
        });
        const scriptFinished = (request: BrowserRequest) => {
          if (pendingScripts.delete(request)) lastScriptActivity = Date.now();
        };
        page.on("requestfinished", scriptFinished);
        page.on("requestfailed", scriptFinished);
        await page.setExtraHTTPHeaders({ "accept-language": lang });
        // Local CSS/JS/fonts go directly to the artifact server. Intercepting
        // every asset makes the Playwright driver part of the loading waterfall.
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
            // Stable test images, no external CDN variance in before/after.
            if (req.resourceType() === "image" && new URL(req.url()).hostname !== "127.0.0.1") {
              return route.fulfill(fixtureImageFor(req.url()));
            }
            await route.continue();
          },
        );
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (
            message.type() === "error" &&
            /hydration|Minified React error|Unrecorded performance fixture/.test(message.text())
          )
            errors.push(message.text());
        });
        await page.addInitScript(installFirstVisitLcpObserver);
        await page.addInitScript(installFirstVisitMainThreadObserver);
        await page.addInitScript(installFirstVisitStreamingObserver);
        // WYSPY (P2.2): przy pierwszym kliknięciu (przełącznik motywu) zapisz,
        // ile wysp jeszcze czeka i czy klasa motywu jest na `<html>` już w
        // następnej klatce; przesunięcia układu wewnątrz wysp (także te po
        // interakcji) zbierane osobno - hydratacja wysp ma ich nie robić.
        await page.addInitScript((islands: string) => {
          window.__p22 = { pendingAtClick: null, classAfterFrame: null, islandShifts: [] };
          window.addEventListener(
            "click",
            () => {
              if (window.__p22.pendingAtClick !== null) return;
              window.__p22.pendingAtClick = [...document.querySelectorAll(islands)].filter(
                (island) => island.getAttribute("data-island-state") === "pending",
              ).length;
              requestAnimationFrame(() => {
                window.__p22.classAfterFrame = document.documentElement.classList.contains("dark");
              });
            },
            { capture: true },
          );
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as Array<
              PerformanceEntry & { value: number; sources?: Array<{ node?: Node | null }> }
            >) {
              const inIsland = (entry.sources ?? []).some(({ node }) => {
                const element = node instanceof Element ? node : node?.parentElement;
                return element?.closest(islands) != null;
              });
              if (inIsland)
                window.__p22.islandShifts.push({ at: entry.startTime, value: entry.value });
            }
          }).observe({ type: "layout-shift", buffered: true });
        }, CONTENT_ISLANDS);
        await page.addInitScript(() => {
          window.__firstVisit = { readyAt: null, cls: 0, shifts: [] };
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
                  nodes: (entry.sources ?? []).map(({ node }) => {
                    // LayoutShiftAttribution may point to a text node, which
                    // has no closest(). Attribute it to its containing element.
                    const element = node instanceof Element ? node : node?.parentElement;
                    return element
                      ? `${element.tagName}.${element.className} widget=${element.closest("[data-widget-id]")?.getAttribute("data-widget-id") ?? ""}`
                      : "detached";
                  }),
                });
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
        });
        if (cacheState === "warm") {
          // This primes only the server's document cache. Each case has a new
          // browser context, and page.route also disables its HTTP cache.
          const warmup = await request.get(path, { headers: { "accept-language": lang } });
          expect(warmup.status()).toBe(200);
          expect(warmup.headers()["x-nes-cache"]).toBe("MISS");
        }
        const response = await page.goto(path, { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);
        expect(response?.headers()["x-nes-cache"]).toBe(cacheState === "cold" ? "MISS" : "HIT");
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
          lcp: window.__firstVisitLcp.read().lcpMs,
        }));
        // Wyspy przed interakcją: znacznik na węźle serwera każdej z nich - render
        // klienta wyspy podmieniłby węzeł (DOM zachowany = te same węzły po hydratacji).
        const islandsBefore = await page.evaluate((selector) => {
          const islands = [...document.querySelectorAll(selector)];
          for (const island of islands) {
            const node = island.querySelector("[data-sec-id]");
            if (node) Reflect.set(node, "__p22Server", true);
          }
          return {
            total: islands.length,
            pending: islands.filter(
              (island) => island.getAttribute("data-island-state") === "pending",
            ).length,
          };
        }, CONTENT_ISLANDS);
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
        // Zegar interakcji ZARAZ po zmianie klasy motywu - tak samo jak na bazie
        // bez wysp. Czekanie na wyspy niżej to osobna asercja (P2.2); odczyt po
        // nim mierzyłby u kandydata hydratację wysp i interwały polla, a nie
        // przełącznik (artefakt w `check:first-visit-regression`, dowód P2.2 §5).
        const interactionCompleteMs = await page.evaluate(() => performance.now());
        // Pierwsza interakcja otwiera pozostałe wyspy po jednej na klatkę.
        await expect
          .poll(
            () =>
              page.evaluate(
                (selector) =>
                  [...document.querySelectorAll(selector)].filter(
                    (island) => island.getAttribute("data-island-state") !== "hydrated",
                  ).length,
                CONTENT_ISLANDS,
              ),
            { timeout: 10_000, message: "islands must hydrate after the first interaction" },
          )
          .toBe(0);
        const islands = await page.evaluate((selector) => {
          const all = [...document.querySelectorAll(selector)];
          return {
            pendingAtClick: window.__p22.pendingAtClick,
            classAfterFrame: window.__p22.classAfterFrame,
            retained: all.filter((island) => {
              const node = island.querySelector("[data-sec-id]");
              return node !== null && Reflect.get(node, "__p22Server") === true;
            }).length,
            withSection: all.filter((island) => island.querySelector("[data-sec-id]") !== null)
              .length,
            islandShift: window.__p22.islandShifts.reduce((sum, shift) => sum + shift.value, 0),
          };
        }, CONTENT_ISLANDS);
        const browser = await page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          return {
            ttfbMs: nav.responseStart,
            fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
            readyMs: window.__firstVisit.readyAt,
            cls: window.__firstVisit.cls,
            shifts: window.__firstVisit.shifts,
            serverTitleRetained: window.__firstVisit.serverTitle?.isConnected ?? false,
          };
        });
        // ResourceTiming only contains completed requests. Reading it at the
        // click boundary randomly omitted ~450 kB of lazy modules even between
        // identical baseline samples. Keep the interaction clock above, then
        // account for the full script waterfall after 500 ms of script quiet.
        // Do not wait for unrelated analytics/heartbeat requests to become idle.
        await expect
          .poll(() => pendingScripts.size === 0 && Date.now() - lastScriptActivity >= 500, {
            timeout: 10_000,
            message: "initial JavaScript requests must finish before byte accounting",
          })
          .toBe(true);
        const scriptAccounting = await page.evaluate(() => {
          const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          const scripts = resources
            .filter((entry) => /\.js(?:\?|$)/.test(entry.name))
            .map((entry) => ({
              url: entry.name,
              bytes: entry.encodedBodySize,
              startMs: entry.startTime,
              endMs: entry.responseEnd,
            }));
          return {
            // The theme click already ends native LCP candidate collection.
            // Read after the existing script accounting wait so late observer
            // delivery cannot turn a newer paint into an artificially fast LCP.
            ...window.__firstVisitLcp.read(),
            // Main-thread windows explain a candidate painted long after its
            // bytes arrived. Tasks after beforeInteraction.at belong to the
            // interaction and script accounting, not to the first paint.
            ...window.__firstVisitMainThread.read(),
            // Streamed widget placeholders: a first-fold widget whose swappedAt
            // is after fcpMs was not part of the first paint at all.
            ...window.__firstVisitStreaming.read(),
            jsAccountingAtMs: performance.now(),
            jsBytes: scripts.reduce((sum, entry) => sum + entry.bytes, 0),
            scripts,
            paintResources: resources
              .filter((entry) => /\.(?:woff2?|svg|jpe?g|css)(?:\?|$)/.test(entry.name))
              .map((entry) => ({
                url: entry.name,
                start: entry.startTime,
                end: entry.responseEnd,
              })),
          };
        });
        const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(
          (match) => match[1],
        );
        const result = {
          path,
          sample,
          cacheState,
          browserCache: "cold-routing-disables-http-cache",
          cache: response!.headers()["x-nes-cache"],
          serverTiming: response!.headers()["server-timing"],
          htmlBytes: Buffer.byteLength(html),
          inlineCssBytes: Buffer.byteLength(inlineStyles.join("")),
          styleBlocks: inlineStyles.length,
          beforeInteraction,
          islands: { ...islandsBefore, ...islands },
          ...browser,
          interactionCompleteMs,
          ...scriptAccounting,
        };
        console.log("FIRST_VISIT " + JSON.stringify(result));
        const reportDirectory = process.env.NES_PERFORMANCE_REPORT_DIR ?? "reports/first-visit";
        mkdirSync(reportDirectory, { recursive: true });
        writeFileSync(
          join(reportDirectory, `${lang}-${cacheState}-${sample}.json`),
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
        expect(
          result.serverTitleRetained,
          "hydration must retain the server-rendered article",
        ).toBe(true);
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
        // WYSPY SEKCJI I STOPKI (P2.2): odroczone do interakcji, motyw stosowany
        // synchronicznie mimo czekających wysp, hydratacja na tym samym HTML i
        // bez przesunięć układu.
        expect(result.islands.total, "section >= 1 and footer islands").toBeGreaterThan(0);
        expect(
          result.islands.pending,
          "islands deferred before the first interaction",
        ).toBeGreaterThan(0);
        expect(result.islands.pendingAtClick).toBeGreaterThan(0);
        expect(result.islands.classAfterFrame, "theme class within one frame").toBe(!darkBefore);
        expect(result.islands.retained, "islands hydrate the server DOM").toBe(
          result.islands.withSection,
        );
        expect(result.islands.islandShift, "island hydration without layout shift").toBeLessThan(
          0.0005,
        );
      });
    }
  }
}
