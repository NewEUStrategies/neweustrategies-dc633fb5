// @vitest-environment node
import { PassThrough } from "node:stream";
import { Suspense } from "react";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerChromeWarmup,
  readChromeWarmup,
  ChromeDataGate,
  type ChromeDegradation,
} from "../chromeWarmup";
import { sweepQueryCacheForSerialization } from "../postRenderSweep";
import { HOME_CHROME_LATE_BUDGET_MS } from "../homeSsrBudget";

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
  it("awaited loader warmup survives the pre-render sweep without a degraded shell", async () => {
    const qc = client();
    const work = pending();
    const options = {
      queryKey: ["chrome", "loader"],
      queryFn: async () => {
        await work.promise;
        return ["navigation"];
      },
    };
    const markDegraded = vi.fn();
    const initial = registerChromeWarmup(qc, {
      ready: () => !!qc.getQueryData(options.queryKey),
      expired: () => false,
      warm: () => qc.ensureQueryData(options),
      markDegraded,
    });
    work.resolve();
    await initial;
    expect(sweepQueryCacheForSerialization(qc, { quiet: true }).cancelled).toBe(0);
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(qc.getQueryData(options.queryKey)).toEqual(["navigation"]);
    expect(markDegraded).not.toHaveBeenCalled();
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

describe("rodzaj degradacji zgłaszany bramce (F02)", () => {
  function recorder() {
    const kinds: ChromeDegradation[] = [];
    return { kinds, markDegraded: (kind?: ChromeDegradation) => void kinds.push(kind ?? "chrome") };
  }

  it("pierwszy odczyt bez gotowych danych, gdy rozgrzewka biegnie, zgłasza `chrome` (nie `failed`)", async () => {
    const qc = client();
    const work = pending();
    const rec = recorder();
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => false,
      warm: () => work.promise,
      markDegraded: rec.markDegraded,
    });
    const gate = readPromise(qc);
    expect(rec.kinds).toEqual(["chrome"]);
    work.resolve();
    await gate;
    expect(rec.kinds).toEqual(["chrome"]);
    qc.clear();
  });

  it("wyczerpany budżet dokumentu zgłasza `failed`", () => {
    const qc = client();
    const rec = recorder();
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => true,
      warm: async () => {},
      markDegraded: rec.markDegraded,
    });
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(rec.kinds).toEqual(["failed"]);
    qc.clear();
  });

  it("awaria `warm()` zgłasza `failed` - z rozgrzewki startowej i z ponowienia przy renderze", async () => {
    const qc = client();
    const rec = recorder();
    const initial = registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => false,
      warm: async () => {
        throw new Error("offline");
      },
      markDegraded: rec.markDegraded,
    });
    await initial;
    expect(rec.kinds).toEqual(["failed"]);
    await readPromise(qc);
    // Odczyt: najpierw ostrożne `chrome` (rozgrzewka wystartowała), potem
    // `failed`, gdy ponowienie padło - `no-store` wygrywa w scaleniu nagłówka.
    expect(rec.kinds).toEqual(["failed", "chrome", "failed"]);
    qc.clear();
  });
});

describe("strona główna po terminie: dogrzanie z własnym budżetem (P3.6b, R2c)", () => {
  function recorder() {
    const kinds: ChromeDegradation[] = [];
    return { kinds, markDegraded: (kind?: ChromeDegradation) => void kinds.push(kind ?? "chrome") };
  }

  it("wyczerpany termin NIE daje już `failed` od ręki: bramka czeka i oznacza `chrome`", async () => {
    const qc = client();
    const rec = recorder();
    const late = pending();
    let ready = false;
    const warmLate = vi.fn((budgetMs: number) => {
      expect(budgetMs).toBeGreaterThan(0);
      expect(budgetMs).toBeLessThanOrEqual(HOME_CHROME_LATE_BUDGET_MS);
      return late.promise;
    });
    registerChromeWarmup(qc, {
      ready: () => ready,
      expired: () => true,
      warm: async () => {},
      warmLate,
      markDegraded: rec.markDegraded,
    });
    const gate = readPromise(qc);
    expect(rec.kinds).toEqual(["chrome"]);
    await vi.waitFor(() => expect(warmLate).toHaveBeenCalledOnce());
    ready = true;
    late.resolve();
    await gate;
    // Pasek dojechał w budżecie bramki: dokument kompletny, krótka polityka.
    expect(rec.kinds).toEqual(["chrome"]);
    expect(() => readChromeWarmup(qc)).not.toThrow();
    qc.clear();
  });

  // Recenzja rundy 9 (m4): `warmLate` grzeje też dekorację (reklama nagłówka),
  // której klucz nie wchodzi do `ready()`. Granica czeka na gotowość powłoki,
  // nie na całą pracę - wolna emisja nie może trzymać nagłówka do końca budżetu.
  it("gotowe dane powłoki zwalniają granicę od razu - wolna dekoracja jej nie trzyma", async () => {
    const qc = client();
    const rec = recorder();
    const key = ["menu-with-items", "main"];
    const menu = pending();
    const ad = pending();
    const warmLate = vi.fn(() =>
      Promise.allSettled([
        qc.ensureQueryData({
          queryKey: key,
          queryFn: async () => {
            await menu.promise;
            return ["nawigacja"];
          },
        }),
        ad.promise,
      ]),
    );
    registerChromeWarmup(qc, {
      ready: () => qc.getQueryData(key) !== undefined,
      expired: () => true,
      warm: async () => {},
      warmLate,
      markDegraded: rec.markDegraded,
    });
    const gate = readPromise(qc);
    let released = false;
    void gate.then(() => {
      released = true;
    });
    await vi.waitFor(() => expect(warmLate).toHaveBeenCalledOnce());
    expect(released).toBe(false);
    menu.resolve();
    // Reklama nadal wisi, a nagłówek już się dostrumieniowuje.
    await vi.waitFor(() => expect(released).toBe(true), { timeout: 500 });
    expect(rec.kinds).toEqual(["chrome"]);
    expect(() => readChromeWarmup(qc)).not.toThrow();
    ad.resolve();
    qc.clear();
  });

  it("dane nadal niegotowe po budżecie bramki: nagłówek na fallbackach i `failed`", async () => {
    const qc = client();
    const rec = recorder();
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => true,
      warm: async () => {},
      warmLate: async () => {},
      markDegraded: rec.markDegraded,
    });
    await readPromise(qc);
    expect(rec.kinds).toEqual(["chrome", "failed"]);
    expect(() => readChromeWarmup(qc)).not.toThrow();
    qc.clear();
  });

  it("`warm()` z resztką terminu skończyło się bez danych: dogrzanie do końca budżetu bramki", async () => {
    const qc = client();
    const rec = recorder();
    let ready = false;
    const warmLate = vi.fn(async () => {
      ready = true;
    });
    registerChromeWarmup(qc, {
      ready: () => ready,
      expired: () => false,
      warm: async () => {},
      warmLate,
      markDegraded: rec.markDegraded,
    });
    await readPromise(qc);
    expect(warmLate).toHaveBeenCalledOnce();
    expect(rec.kinds).toEqual(["chrome"]);
    qc.clear();
  });

  it("awaria dogrzania to `failed`, jak awaria `warm()`", async () => {
    const qc = client();
    const rec = recorder();
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => true,
      warm: async () => {},
      warmLate: async () => {
        throw new Error("offline");
      },
      markDegraded: rec.markDegraded,
    });
    await readPromise(qc);
    expect(rec.kinds).toEqual(["chrome", "failed"]);
    qc.clear();
  });

  it("trasy bez `warmLate` (poza stroną główną) zachowują się jak dotąd", async () => {
    const qc = client();
    const rec = recorder();
    registerChromeWarmup(qc, {
      ready: () => false,
      expired: () => false,
      warm: async () => {},
      markDegraded: rec.markDegraded,
    });
    await readPromise(qc);
    // Bez dogrzania: `warm()` się skończyło, nagłówek renderuje się z tym, co jest.
    expect(rec.kinds).toEqual(["chrome"]);
    qc.clear();
  });
});
