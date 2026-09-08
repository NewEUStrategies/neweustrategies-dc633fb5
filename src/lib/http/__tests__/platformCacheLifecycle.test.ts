// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { L2DocumentEntry } from "../documentCacheL2.server";
import { DOCUMENT_CACHE_MAX_ENTRY_BYTES, DOCUMENT_CACHE_MAX_TOTAL_BYTES } from "../documentCache";
const h = vi.hoisted(() => ({
  now: 1_000_000,
  entry: null as L2DocumentEntry | null,
  host: vi.fn(),
}));
vi.mock("../documentCacheL2.server", async (o) => ({
  ...(await o<typeof import("../documentCacheL2.server")>()),
  l2Match: async () => h.entry,
  l2Put: async () => {},
  bumpL2Version: async () => {},
}));
vi.mock("../requestHost", () => ({
  trustedPublicHost: async (r: Request) => new URL(r.url).hostname,
  currentTenantHost: h.host,
}));
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  probeDocumentCache,
  purgeDocumentCache,
  purgeDocumentCacheForCurrentHost,
  resetDocumentCacheForTests,
  setDocumentRevalidator,
} from "../documentCache.server";

const headers = {
  "content-type": "text/html",
  "content-language": "en",
  "cache-control": "public, s-maxage=1, stale-while-revalidate=60",
};
const req = (path = "/article") => new Request(`https://example.org${path}`);
const html = (body = "<html>fresh</html>") => new Response(body, { headers });
async function store(path = "/article", body?: string) {
  const result = await handleDocumentRequest(req(path), () => html(body));
  if (!(result instanceof Response)) throw new Error("response required");
  let work: Promise<boolean> | undefined;
  const final = applyDeferredDocumentStore(result, (pending) => {
    work = pending;
  });
  await final.arrayBuffer();
  expect(await work).toBe(true);
}
function l2(age: number): L2DocumentEntry {
  return {
    body: new TextEncoder().encode("<html>L2</html>"),
    contentType: "text/html",
    contentLanguage: "en",
    cacheControl: headers["cache-control"],
    link: "</entry.js>; rel=modulepreload",
    storedAt: h.now - age,
    freshMs: 1_000,
    swrMs: 60_000,
  };
}
beforeEach(() => {
  resetDocumentCacheForTests();
  setDocumentRevalidator(null);
  h.now = 1_000_000;
  h.entry = null;
  h.host.mockReset().mockResolvedValue("example.org");
  vi.spyOn(Date, "now").mockImplementation(() => h.now);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetDocumentCacheForTests();
});

describe("cache lifecycle under expiry, revalidation and eviction", () => {
  it("replays the content language and expires bytes outside SWR before rendering", async () => {
    await store();
    const hit = await handleDocumentRequest(req(), () => html("unexpected"));
    expect(hit.headers.get("content-language")).toBe("en");
    expect(hit.headers.get("x-nes-cache")).toBe("HIT");
    h.now += 61_001;
    const miss = await handleDocumentRequest(req(), () => html("new"));
    expect(miss.headers.get("x-nes-cache")).toBe("MISS");
    expect(getDocumentCacheSnapshot().bytes).toBe(0);
    expect(await miss.text()).toBe("new");
  });
  it.each(["L1", "L2"])("only one synchronous refresh runs for a stale %s entry", async (layer) => {
    if (layer === "L1") {
      await store();
      h.now += 2_000;
    } else h.entry = l2(2_000);
    let release!: (r: Response) => void;
    const render = vi.fn(
      () =>
        new Promise<Response>((r) => {
          release = r;
        }),
    );
    const first = handleDocumentRequest(req(), render);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    const second = await handleDocumentRequest(req(), render);
    expect(second.headers.get("x-nes-cache")).toBe("STALE");
    release(html("replacement"));
    const fresh = await first;
    expect(fresh.headers.get("x-nes-cache")).toBe("MISS");
    expect(await fresh.text()).toBe("replacement");
    expect(render).toHaveBeenCalledOnce();
  });
  it.each(["L1", "L2", "MISS"])(
    "preserves a non-Response middleware result on %s",
    async (layer) => {
      if (layer === "L1") {
        await store();
        h.now += 2_000;
      }
      if (layer === "L2") h.entry = l2(2_000);
      const value = { context: { handled: true } };
      expect(await handleDocumentRequest(req(), () => value)).toBe(value);
    },
  );
  it("does not reuse expired L2 content", async () => {
    h.entry = l2(61_001);
    const response = await handleDocumentRequest(req(), () => html("rendered"));
    expect(response.headers.get("x-nes-cache")).toBe("MISS");
    expect(await response.text()).toBe("rendered");
  });
  it("serves stale L2 immediately and counts an unsuccessful background refresh", async () => {
    h.entry = l2(2_000);
    const revalidate = vi.fn(async () => false);
    setDocumentRevalidator(revalidate);
    const render = vi.fn(() => html());
    const response = await handleDocumentRequest(req(), render);
    expect(response.headers.get("x-nes-cache")).toBe("STALE");
    expect(response.headers.get("link")).toContain("modulepreload");
    expect(render).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(getDocumentCacheSnapshot().revalidationFailures).toBe(1));
  });
  it("leaves request-method bypasses out of document metrics", async () => {
    const response = html();
    expect(
      await handleDocumentRequest(new Request(req(), { method: "POST" }), () => response),
    ).toBe(response);
    expect(getDocumentCacheSnapshot()).toMatchObject({ bypass: 0, recent: [] });
    const empty = new Response(null);
    expect(applyDeferredDocumentStore(empty)).toBe(empty);
  });
  it("evicts least recently used documents within the byte budget", async () => {
    const body = "x".repeat(DOCUMENT_CACHE_MAX_ENTRY_BYTES - 10);
    const count = Math.floor(DOCUMENT_CACHE_MAX_TOTAL_BYTES / body.length) + 1;
    for (let i = 0; i < count; i++) await store(`/page-${i}`, body);
    expect(getDocumentCacheSnapshot().evictions).toBeGreaterThan(0);
    expect(getDocumentCacheSnapshot().bytes).toBeLessThanOrEqual(DOCUMENT_CACHE_MAX_TOTAL_BYTES);
    expect((await probeDocumentCache("/page-0")).status).toBe("MISS");
    expect((await probeDocumentCache(`/page-${count - 1}`)).status).toBe("HIT");
  });
  it("caps decision history while retaining the newest requests", async () => {
    for (let i = 0; i < 102; i++)
      await handleDocumentRequest(req(`/admin/page-${i}`), () => html());
    expect(getDocumentCacheSnapshot().recent.length).toBeLessThan(102);
    expect(getDocumentCacheSnapshot().recent[0].path).toBe("/admin/page-101");
  });
});
describe("non-mutating cache diagnostics and purge", () => {
  it.each([
    [0, "HIT", true],
    [2_000, "STALE", true],
    [61_001, "MISS", false],
  ] as const)("reports L2 age %i as %s", async (age, status, cached) => {
    h.entry = l2(age);
    expect(await probeDocumentCache("/article")).toMatchObject({ status, cached, cacheable: true });
    expect(getDocumentCacheSnapshot()).toMatchObject({ entries: 0, hits: 0, stale: 0 });
  });
  it("reports absent, private and hostless paths without a render", async () => {
    expect(await probeDocumentCache("/unknown")).toMatchObject({ status: "MISS", cached: false });
    expect(await probeDocumentCache("/admin")).toMatchObject({
      status: "BYPASS",
      cacheable: false,
    });
    expect(await probeDocumentCache("/article", null)).toMatchObject({
      status: "MISS",
      cacheable: true,
    });
  });
  it("purges all local entries and leaves counters unchanged on an empty purge", async () => {
    await store();
    await store("/second");
    expect(purgeDocumentCache()).toBe(2);
    expect(getDocumentCacheSnapshot()).toMatchObject({ entries: 0, bytes: 0, purges: 1 });
    expect(purgeDocumentCache()).toBe(0);
    expect(getDocumentCacheSnapshot().purges).toBe(1);
  });
  it("purges the request tenant and tolerates failed tenant lookup", async () => {
    await store();
    expect(await purgeDocumentCacheForCurrentHost()).toBe(1);
    h.host.mockRejectedValueOnce(new Error("no request context"));
    expect(await purgeDocumentCacheForCurrentHost()).toBe(0);
  });
});
