import { expect, test, type Request as BrowserRequest } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  CMS_ENGINES,
  CMS_FORMS,
  CMS_TITLES,
  cmsFixtureResponse,
} from "../scripts/performance/cmsFixture";
import { fixtureImage, homeFixture, isFixtureBackend } from "../scripts/performance/homeFixture";

declare global {
  interface Window {
    __nesAppReady?: boolean;
    __cmsVisit: {
      readyAt: number | null;
      lcp: number;
      cls: number;
      longTasks: Array<{ at: number; duration: number }>;
      title?: Element;
      form?: Element;
      titleRemoved: boolean;
      formEvents: Array<{ at: number; event: string; node: string; parent: string }>;
      layoutShifts: Array<{
        at: number;
        value: number;
        sources: Array<{ node: string; previous: DOMRectReadOnly; current: DOMRectReadOnly }>;
      }>;
    };
  }
}

// Run through run-cms-widgets.mjs: every sample owns a new artifact server and
// browser. "Warm" means SERVER cache; browser cache is cold (routing disables
// HTTP cache). Mobile emulates viewport/touch, not a real phone CPU or network.
for (const engine of CMS_ENGINES)
  for (const variant of CMS_FORMS)
    for (const lang of ["pl", "en"] as const)
      for (const serverCache of ["cold", "warm"] as const)
        for (const sample of [1, 2, 3]) {
          test(`cms ${engine} ${variant} ${lang} ${serverCache} ${sample}`, async ({
            page,
            request,
          }, testInfo) => {
            const errors: string[] = [];
            const pendingScripts = new Set<BrowserRequest>();
            let lastScriptActivity = Date.now();
            let requestCount = 0;
            page.on("request", (req) => {
              requestCount++;
              if (req.resourceType() === "script") {
                pendingScripts.add(req);
                lastScriptActivity = Date.now();
              }
            });
            page.on("requestfinished", (req) => {
              if (pendingScripts.delete(req)) lastScriptActivity = Date.now();
            });
            page.on("requestfailed", (req) => {
              if (pendingScripts.delete(req)) errors.push(`Script failed: ${req.url()}`);
            });
            page.on("pageerror", (err) => errors.push(err.message));
            page.on("console", (msg) => {
              if (
                msg.type() === "error" &&
                /hydration|Minified React error|Unrecorded.*fixture/.test(msg.text())
              )
                errors.push(msg.text());
            });
            await page.setExtraHTTPHeaders({ "accept-language": lang });
            await page.route(
              (url) => url.hostname !== "127.0.0.1" || isFixtureBackend(url.href),
              async (route) => {
                const req = route.request();
                if (isFixtureBackend(req.url())) {
                  const reply = await cmsFixtureResponse(
                    new Request(req.url(), {
                      method: req.method(),
                      headers: req.headers(),
                      body: req.method() === "POST" ? req.postData() : undefined,
                    }),
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
                if (req.resourceType() === "image")
                  return route.fulfill({
                    body: fixtureImage,
                    contentType: homeFixture.fixture_image_type,
                  });
                errors.push(`Unrecorded external resource: ${req.url()}`);
                await route.abort();
              },
            );
            await page.addInitScript(
              ({ title }) => {
                performance.setResourceTimingBufferSize(3000);
                window.__cmsVisit = {
                  readyAt: null,
                  lcp: 0,
                  cls: 0,
                  longTasks: [],
                  titleRemoved: false,
                  formEvents: [],
                  layoutShifts: [],
                };
                const state = window.__cmsVisit;
                const describe = (node: Node | null | undefined): string =>
                  node instanceof Element
                    ? node.tagName.toLowerCase() + " " + node.outerHTML.slice(0, 350)
                    : (node?.nodeName ?? "unknown");
                let lastForm: Element | null = null;
                let formRemoved = false;
                new MutationObserver(() => {
                  state.title ??= Array.from(document.querySelectorAll("main h2")).find(
                    (node) => node.textContent === title,
                  );
                  const currentForm = document.querySelector("main form");
                  state.form ??= currentForm ?? undefined;
                  if (currentForm !== lastForm) {
                    state.formEvents.push({
                      at: performance.now(),
                      event: currentForm ? "observed" : "absent",
                      node: describe(currentForm),
                      parent: describe(currentForm?.parentElement),
                    });
                    lastForm = currentForm;
                  }
                  if (state.form && !state.form.isConnected && !formRemoved) {
                    formRemoved = true;
                    state.formEvents.push({
                      at: performance.now(),
                      event: "original-removed",
                      node: describe(state.form),
                      parent: describe(state.form.parentElement),
                    });
                  }
                  if (state.title && !state.title.isConnected) state.titleRemoved = true;
                }).observe(document, { childList: true, subtree: true });
                let ready = false;
                Object.defineProperty(window, "__nesAppReady", {
                  configurable: true,
                  get: () => ready,
                  set: (value: boolean) => {
                    ready = value;
                    if (value && state.readyAt === null) state.readyAt = performance.now();
                  },
                });
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries()) state.lcp = entry.startTime;
                }).observe({ type: "largest-contentful-paint", buffered: true });
                let start = 0,
                  last = 0,
                  value = 0;
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries() as Array<
                    PerformanceEntry & {
                      value: number;
                      hadRecentInput: boolean;
                      sources?: Array<{
                        node?: Node;
                        previousRect: DOMRectReadOnly;
                        currentRect: DOMRectReadOnly;
                      }>;
                    }
                  >) {
                    if (entry.hadRecentInput) continue;
                    state.layoutShifts.push({
                      at: entry.startTime,
                      value: entry.value,
                      sources: (entry.sources ?? []).map((source) => ({
                        node: describe(source.node),
                        previous: source.previousRect.toJSON(),
                        current: source.currentRect.toJSON(),
                      })),
                    });
                    if (entry.startTime - last < 1000 && entry.startTime - start < 5000)
                      value += entry.value;
                    else {
                      start = entry.startTime;
                      value = entry.value;
                    }
                    last = entry.startTime;
                    state.cls = Math.max(state.cls, value);
                  }
                }).observe({ type: "layout-shift", buffered: true });
                new PerformanceObserver((list) => {
                  for (const entry of list.getEntries())
                    state.longTasks.push({ at: entry.startTime, duration: entry.duration });
                }).observe({ type: "longtask", buffered: true });
              },
              { title: CMS_TITLES[lang] },
            );
            const path = `${lang === "en" ? "/en" : ""}/cms-${engine}-${variant}`;
            const warmupResponses: Array<{ cache?: string; cacheControl?: string }> = [];
            if (serverCache === "warm") {
              // A cold historical artifact can mark its first chrome render
              // no-store. Warm until a COMPLETE cached HTML response exists,
              // with a bounded attempt count. Never count a MISS as a warm visit.
              for (let attempt = 0; attempt < 5; attempt++) {
                const warmup = await request.get(path, {
                  headers: { "accept-language": lang, accept: "text/html" },
                });
                expect(warmup.status()).toBe(200);
                const headers = warmup.headers();
                warmupResponses.push({
                  cache: headers["x-nes-cache"],
                  cacheControl: headers["cache-control"],
                });
                if (attempt === 0) expect(headers["x-nes-cache"]).toBe("MISS");
                if (headers["x-nes-cache"] === "HIT") break;
              }
              expect(warmupResponses.at(-1)?.cache).toBe("HIT");
              expect(warmupResponses.at(-1)?.cacheControl).toContain("public");
            }
            const response = await page.goto(path, { waitUntil: "domcontentloaded" });
            expect(response?.status()).toBe(200);
            expect(response?.headers()["x-nes-cache"]).toBe(
              serverCache === "cold" ? "MISS" : "HIT",
            );
            const html = await response!.text();
            expect(html).toContain(CMS_TITLES[lang]);
            expect(html).toContain("CMS END");
            expect(html).not.toContain("ssr-doc-guard:truncated");
            expect(html).not.toContain("$RX(");
            if (variant === "form") expect(html).toContain("<form");
            await expect(
              page.locator("main").getByRole("heading", { name: CMS_TITLES[lang], exact: true }),
            ).toBeVisible();
            await page.waitForFunction(() => window.__nesAppReady === true);
            // Cover the entire existing idle warmer (rIC timeout 4 s / timer 1.5 s).
            // Paint/CLS are sampled before user input; no click prematurely ends LCP.
            await page.waitForFunction(
              () => performance.now() - (window.__cmsVisit.readyAt ?? Infinity) >= 5000,
            );
            await expect
              .poll(() => pendingScripts.size === 0 && Date.now() - lastScriptActivity >= 500, {
                timeout: 10_000,
              })
              .toBe(true);
            const measured = await page.evaluate(() => {
              const state = window.__cmsVisit;
              const nav = performance.getEntriesByType(
                "navigation",
              )[0] as PerformanceNavigationTiming;
              const scripts = (
                performance.getEntriesByType("resource") as PerformanceResourceTiming[]
              )
                .filter((entry) => /\.js(?:\?|$)/.test(entry.name))
                .map((entry) => ({
                  file: new URL(entry.name).pathname,
                  bodyBytes: entry.encodedBodySize,
                  transferBytes: entry.transferSize,
                  startMs: entry.startTime,
                  endMs: entry.responseEnd,
                }));
              return {
                ttfbMs: nav.responseStart,
                fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
                lcpMs: state.lcp,
                cls: state.cls,
                // Navigation -> root effect. This is a readiness milestone, not CPU
                // hydration duration and not proof that every Suspense boundary committed.
                hydrationReadyMs: state.readyAt,
                serverTitleRetained: !!state.title?.isConnected && !state.titleRemoved,
                serverFormRetained: state.form?.isConnected ?? false,
                formEvents: state.formEvents,
                layoutShifts: state.layoutShifts,
                longTasks: state.longTasks,
                longTaskMs: state.longTasks.reduce((sum, task) => sum + task.duration, 0),
                jsBodyBytes: scripts.reduce((sum, script) => sum + script.bodyBytes, 0),
                jsTransferBytes: scripts.reduce((sum, script) => sum + script.transferBytes, 0),
                jsRequests: scripts.length,
                scripts,
                accountingAtMs: performance.now(),
              };
            });
            const firstVisitRequestCount = requestCount;
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
            const interactionStart = await page.evaluate(() => performance.now());
            await page.getByRole("button", { name: themeLabel, exact: true }).first().click();
            await expect
              .poll(() => page.locator("html").evaluate((node) => node.classList.contains("dark")))
              .toBe(!darkBefore);
            const interactionMs = await page.evaluate(
              (start) => performance.now() - start,
              interactionStart,
            );
            if (variant === "form") {
              const form = page.locator("main form").first();
              await expect(form).toBeVisible();
              // Invoke React validation without sending a message. Native constraint
              // validation would otherwise stop an empty form before its React handler.
              await form.dispatchEvent("submit");
              const validation =
                engine === "builder"
                  ? lang === "pl"
                    ? "Pole wymagane"
                    : "Required field"
                  : lang === "pl"
                    ? "Wymagana zgoda na przetwarzanie danych."
                    : "Consent is required to submit.";
              await expect(form.getByText(validation, { exact: true }).first()).toBeVisible();
            }
            await expect(page.locator("main").getByText("CMS END", { exact: true })).toHaveCount(1);
            expect(errors).toEqual([]);
            const result = {
              engine,
              variant,
              lang,
              device: testInfo.project.name,
              serverCache,
              browserCache: "cold-routing-disables-http-cache",
              sample,
              path,
              cache: response!.headers()["x-nes-cache"],
              cacheControl: response!.headers()["cache-control"],
              warmupResponses,
              serverTiming: response!.headers()["server-timing"],
              htmlBytes: Buffer.byteLength(html),
              requestCount: firstVisitRequestCount,
              interactionMs,
              ...measured,
            };
            console.log(
              "CMS_VISIT " +
                JSON.stringify({
                  ...result,
                  scripts: undefined,
                  longTasks: undefined,
                  largestScripts: [...result.scripts]
                    .sort((a, b) => b.bodyBytes - a.bodyBytes)
                    .slice(0, 15),
                }),
            );
            mkdirSync("reports/cms-widgets", { recursive: true });
            const name = `${engine}-${variant}-${lang}-${testInfo.project.name}-${serverCache}-${sample}`;
            writeFileSync(
              `reports/cms-widgets/${name}.json`,
              JSON.stringify(result, null, 2) + "\n",
            );
            await testInfo.attach("cms-measurement", {
              body: JSON.stringify(result, null, 2),
              contentType: "application/json",
            });
            await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
            expect(measured.serverTitleRetained).toBe(true);
            // The baseline has a reproduced historical form-remount defect.
            // Record it explicitly; only the candidate may satisfy this gate.
            // Both versions still require complete SSR and working handlers.
            if (variant === "form" && process.env.NES_PERFORMANCE_BASELINE === "1") {
              if (!measured.serverFormRetained)
                console.warn("CMS_BASELINE_DEFECT: original SSR form was replaced");
            } else if (variant === "form") expect(measured.serverFormRetained).toBe(true);
            expect(measured.jsRequests).toBeGreaterThan(0);
            expect(measured.jsBodyBytes).toBeGreaterThan(0);
            if (process.env.NES_PERFORMANCE_BASELINE === "1") return;
            expect(result.htmlBytes).toBeLessThan(650_000);
            expect(measured.ttfbMs).toBeLessThan(2000);
            expect(measured.fcpMs).toBeGreaterThan(0);
            expect(measured.fcpMs).toBeLessThan(2500);
            expect(measured.lcpMs).toBeGreaterThan(0);
            expect(measured.lcpMs).toBeLessThan(2500);
            expect(measured.hydrationReadyMs).not.toBeNull();
            expect(measured.hydrationReadyMs!).toBeLessThan(3000);
            expect(measured.cls).toBeLessThan(0.1);
            expect(interactionMs).toBeLessThan(1000);
          });
        }
