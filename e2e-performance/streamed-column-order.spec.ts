import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import {
  fixtureImageFor,
  fixtureResponse,
  isAnalyticsScript,
  isFixtureBackend,
} from "../scripts/performance/homeFixture";

// CLS PSI mobile 0,16 (2026-11-18): sekcja hero strony głównej ma kolumny
// [A order.mobile 2][B slider, order.mobile 1][C order.mobile 3]. Gdy sekcja
// jedzie w powłoce SSR, telefon maluje A, zanim parser dojdzie do B, a reguła
// `order` przestawia je dopiero po wczytaniu B - A zjeżdża o wysokość slidera.
// Lokalnie dokument przychodzi w jednym kawałku i tego nie widać, więc test
// wstawia między przeglądarkę a artefakt proxy, które WSTRZYMUJE strumień HTML
// tuż przed drugą kolumną sekcji z mobilną kolejnością (jak przestój sieci
// komórkowej). Bez bramki kolejności (`@/lib/builder/columnOrderGate`) baseline
// mierzy tu CLS ~0,3-0,4 na 390 px; z bramką rząd odsłania się w całości.

const STALL_MS = 1500;

interface ShiftSample {
  at: number;
  value: number;
  /** `data-sec-id` sekcji, w których leżały źródła przesunięcia (w chwili przesunięcia). */
  sections: string[];
}
declare global {
  interface Window {
    __orderShift: { shifts: ShiftSample[]; cls: number };
  }
}

/** Offset drugiej kolumny pierwszej sekcji z mobilną regułą `order` (punkt przestoju). */
function stallPoint(html: string): { offset: number; sectionId: string } | null {
  const rule = /\[data-sec-id="([^"]+)"\] \[data-col-id="[^"]+"\]\{order:/.exec(html);
  if (!rule) return null;
  const slot = /<div data-column-slot="true"/g;
  slot.lastIndex = rule.index;
  if (!slot.exec(html)) return null;
  const second = slot.exec(html);
  return second ? { offset: second.index, sectionId: rule[1] } : null;
}

interface StallProxy {
  origin: string;
  /** Sekcja, przed której drugą kolumną proxy wstrzymało dokument (`null` = brak punktu). */
  stalledSection: () => string | null;
  close: () => Promise<void>;
}

/** Proxy do artefaktu, które wstrzymuje dokument HTML w punkcie `stallPoint`. */
async function startStallProxy(upstream: string): Promise<StallProxy> {
  let stalled: string | null = null;
  const proxy: Server = createServer((req, res) => {
    void (async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === "string" && !["host", "connection", "accept-encoding"].includes(name))
          headers.set(name, value);
      }
      const body =
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await new Promise<Buffer>((done) => {
              const parts: Buffer[] = [];
              req.on("data", (part: Buffer) => parts.push(part));
              req.on("end", () => done(Buffer.concat(parts)));
            });
      const reply = await fetch(upstream + (req.url ?? "/"), {
        method: req.method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        redirect: "manual",
      });
      const out: Record<string, string> = {};
      reply.headers.forEach((value, name) => {
        if (!["content-length", "content-encoding", "transfer-encoding"].includes(name))
          out[name] = value;
      });
      const bytes = Buffer.from(await reply.arrayBuffer());
      const isDocument = (reply.headers.get("content-type") ?? "").includes("text/html");
      const text = isDocument ? bytes.toString("utf8") : "";
      const point = isDocument ? stallPoint(text) : null;
      res.writeHead(reply.status, out);
      if (!point) return res.end(bytes);
      stalled = point.sectionId;
      const cut = Buffer.byteLength(text.slice(0, point.offset));
      res.write(bytes.subarray(0, cut));
      await new Promise((done) => setTimeout(done, STALL_MS));
      res.end(bytes.subarray(cut));
    })().catch((error: unknown) => {
      res.writeHead(502);
      res.end(String(error));
    });
  });
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  return {
    origin: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    stalledSection: () => stalled,
    close: () =>
      new Promise<void>((done) => {
        // Połączenia keep-alive przeglądarki trzymałyby `close` do zamknięcia strony.
        proxy.closeAllConnections();
        proxy.close(() => done());
      }),
  };
}

for (const width of [390, 1440]) {
  test(`reordered columns do not shift while HTML streams at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    const proxy = await startStallProxy(String(baseURL));
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydration|Minified React error/.test(message.text()))
        errors.push(message.text());
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
      if (request.resourceType() === "image") {
        const image = fixtureImageFor(request.url());
        return route.fulfill({ body: image.body, contentType: image.contentType });
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      window.__orderShift = { shifts: [], cls: 0 };
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
          window.__orderShift.cls = Math.max(window.__orderShift.cls, sessionValue);
          window.__orderShift.shifts.push({
            at: entry.startTime,
            value: entry.value,
            sections: (entry.sources ?? []).map(({ node }) => {
              const element = node instanceof Element ? node : node?.parentElement;
              return element?.closest("[data-sec-id]")?.getAttribute("data-sec-id") ?? "";
            }),
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    try {
      await page.goto(proxy.origin + "/", { waitUntil: "commit" });
      // Bez sekcji z odwróconą kolejnością test niczego by nie dowodził.
      const sectionId = proxy.stalledSection();
      expect(sectionId).not.toBeNull();
      await page.waitForLoadState("load");
      await page.waitForFunction(() => window.__nesAppReady === true);
      await page.waitForTimeout(1000);
      const result = await page.evaluate(() => window.__orderShift);
      console.log("STREAMED_COLUMN_ORDER", JSON.stringify({ width, ...result, errors }));
      expect(errors).toEqual([]);
      expect(result.shifts.filter((shift) => shift.sections.includes(sectionId!))).toEqual([]);
      expect(result.cls).toBeLessThan(0.1);
    } finally {
      await proxy.close();
    }
  });
}
