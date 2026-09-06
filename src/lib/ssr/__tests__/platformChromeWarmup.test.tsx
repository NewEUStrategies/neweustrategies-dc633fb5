// @vitest-environment node
import { PassThrough } from "node:stream";
import { Suspense } from "react";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerChromeWarmup, readChromeWarmup, ChromeDataGate } from "../chromeWarmup";
import { sweepQueryCacheForSerialization } from "../postRenderSweep";

afterEach(() => {
  vi.unstubAllEnvs();
});
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
function pending() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function readPromise(qc: QueryClient): Promise<unknown> {
  try {
    readChromeWarmup(qc);
  } catch (p) {
    expect(p).toBeInstanceOf(Promise);
    return p as Promise<unknown>;
  }
  throw new Error("expected a suspended chrome boundary");
}

describe("non-blocking chrome warmup", () => {
  it("returns immediately, and isolates request records", async () => {
    const qc = client();
    const work = pending();
    const warm = vi.fn(() => work.promise);
    const markDegraded = vi.fn();
    registerChromeWarmup(qc, { ready: () => false, expired: () => false, warm, markDegraded });
    expect(warm).toHaveBeenCalledTimes(1);
    expect(() => readChromeWarmup(client())).not.toThrow();
    const a = readPromise(qc);
    const b = readPromise(qc);
    expect(a).toBe(b);
    expect(warm).toHaveBeenCalledTimes(2);
    expect(markDegraded).toHaveBeenCalledTimes(1);
    work.resolve();
    await a;
    expect(() => readChromeWarmup(qc)).not.toThrow();
    qc.clear();
  });
  it("keeps a settled, fully warmed document cacheable", async () => {
    const qc = client();
    const markDegraded = vi.fn();
    registerChromeWarmup(qc, {
      ready: () => true,
      expired: () => false,
      warm: async () => {},
      markDegraded,
    });
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(markDegraded).not.toHaveBeenCalled();
    qc.clear();
  });
  it("does not grant an expired homepage a fresh 500 ms", () => {
    const qc = client();
    const markDegraded = vi.fn();
    const warm = vi.fn(async () => {});
    registerChromeWarmup(qc, { ready: () => false, expired: () => true, warm, markDegraded });
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(markDegraded).toHaveBeenCalledOnce();
    expect(warm).toHaveBeenCalledOnce();
    qc.clear();
  });
  it("consumes failures from initial work and from render-time retry", async () => {
    const qc = client();
    const markDegraded = vi.fn();
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => false,
      warm: async () => {
        throw new Error("offline");
      },
      markDegraded,
    });
    await readPromise(qc);
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(markDegraded.mock.calls.length).toBeGreaterThanOrEqual(2);
    qc.clear();
  });
  it("restarts queries cancelled by the real pre-render sweep", async () => {
    const qc = client();
    const work = pending();
    let fetches = 0;
    const options = {
      queryKey: ["chrome", "main"],
      queryFn: async () => {
        fetches++;
        await work.promise;
        return ["navigation"];
      },
    };
    registerChromeWarmup(qc, {
      ready: () => !!qc.getQueryData(options.queryKey),
      expired: () => false,
      warm: () => qc.ensureQueryData(options),
      markDegraded: vi.fn(),
    });
    sweepQueryCacheForSerialization(qc, { quiet: true });
    await Promise.resolve();
    const renderWork = readPromise(qc);
    work.resolve();
    await renderWork;
    expect(fetches).toBe(2);
    expect(qc.getQueryData(options.queryKey)).toEqual(["navigation"]);
    qc.clear();
  });
  it("streams route content before chrome settles, then streams resolved chrome", async () => {
    vi.stubEnv("SSR", true);
    const qc = client();
    const work = pending();
    let ready = false;
    const markDegraded = vi.fn();
    registerChromeWarmup(qc, {
      ready: () => ready,
      expired: () => false,
      warm: () => work.promise,
      markDegraded,
    });
    let html = "";
    const sink = new PassThrough();
    let firstByte!: () => void;
    const firstByteReady = new Promise<void>((r) => {
      firstByte = r;
    });
    sink.on("data", (chunk) => {
      html += chunk.toString();
      firstByte();
    });
    const ended = new Promise<void>((resolve, reject) => {
      sink.on("end", resolve);
      sink.on("error", reject);
    });
    let shell!: () => void;
    const shellReady = new Promise<void>((r) => {
      shell = r;
    });
    const stream = renderToPipeableStream(
      <html>
        <body>
          <QueryClientProvider client={qc}>
            <Suspense fallback={<header>chrome-loading</header>}>
              <ChromeDataGate>
                <header>navigation-ready</header>
              </ChromeDataGate>
            </Suspense>
            <main>article-first</main>
          </QueryClientProvider>
        </body>
      </html>,
      {
        onShellReady() {
          stream.pipe(sink);
          shell();
        },
        onError(error) {
          sink.destroy(error as Error);
        },
      },
    );
    await shellReady;
    await firstByteReady;
    expect(html).toContain("article-first");
    expect(html).toContain("chrome-loading");
    expect(html).not.toContain("navigation-ready");
    expect(markDegraded).toHaveBeenCalledOnce();
    ready = true;
    work.resolve();
    await ended;
    expect(html).toContain("navigation-ready");
    expect(html.indexOf("article-first")).toBeLessThan(html.indexOf("navigation-ready"));
    qc.clear();
  });
  it("adds no render-time fetch in the browser", () => {
    vi.stubEnv("SSR", false);
    const qc = client();
    const warm = vi.fn(async () => {});
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => false,
      warm,
      markDegraded: vi.fn(),
    });
    expect(
      renderToString(
        <QueryClientProvider client={qc}>
          <ChromeDataGate>
            <nav>menu</nav>
          </ChromeDataGate>
        </QueryClientProvider>,
      ),
    ).toBe("<nav>menu</nav>");
    expect(warm).toHaveBeenCalledOnce();
    qc.clear();
  });
});
