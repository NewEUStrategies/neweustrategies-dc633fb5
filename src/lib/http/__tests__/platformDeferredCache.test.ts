// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestHandler } from "@tanstack/react-start/server";
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  resetDocumentCacheForTests,
} from "../documentCache.server";
import { setCacheControlHeader } from "../responseHeaders";
const h = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("../documentCacheL2.server", async (original) => ({
  ...(await original<typeof import("../documentCacheL2.server")>()),
  l2Match: async () => null,
  l2Put: h.put,
}));
vi.mock("../requestHost", () => ({
  trustedPublicHost: async (r: Request) => new URL(r.url).hostname,
  currentTenantHost: async () => "example.org",
}));
const headers = { "content-type": "text/html", "cache-control": "public, s-maxage=900" };
const req = () => new Request("https://example.org/article");
beforeEach(() => {
  resetDocumentCacheForTests();
  h.put.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("deferred write respects final and late stream policy", () => {
  it.each(["private, no-store", "no-store", "private"])(
    "does not persist a final %s response",
    async (policy) => {
      const response = (await handleDocumentRequest(
        req(),
        () => new Response("content", { headers }),
      )) as Response;
      response.headers.set("cache-control", policy);
      const onStore = vi.fn();
      const out = applyDeferredDocumentStore(response, onStore);
      expect(await out.text()).toBe("content");
      expect(out.headers.get("cache-control")).toContain("no-store");
      expect(onStore).not.toHaveBeenCalled();
      expect(getDocumentCacheSnapshot().entries).toBe(0);
      expect(h.put).not.toHaveBeenCalled();
    },
  );
  it("does not persist when an outer layer changes status after registration", async () => {
    const r = (await handleDocumentRequest(
      req(),
      () => new Response("failure", { headers }),
    )) as Response;
    const res = applyDeferredDocumentStore(
      new Response(r.body, { status: 500, headers: r.headers }),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("failure");
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });
  it("rejects a degradation discovered while Suspense is still streaming", async () => {
    let complete!: () => void;
    const rendered = requestHandler(async (request) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<html>"));
          complete = () => {
            setCacheControlHeader("private, no-store");
            controller.enqueue(new TextEncoder().encode("fallback</html>"));
            controller.close();
          };
        },
      });
      // Keep the h3 request context across the deferred callback.
      const { AsyncResource } = await import("node:async_hooks");
      complete = AsyncResource.bind(complete);
      return (await handleDocumentRequest(
        request,
        () => new Response(body, { headers }),
      )) as Response;
    });
    const response = await rendered(req(), {});
    let work: Promise<boolean> | undefined;
    const final = applyDeferredDocumentStore(response, (pending) => {
      work = pending;
    });
    complete();
    expect(await final.text()).toContain("fallback");
    await expect(work).resolves.toBe(false);
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    expect(h.put).not.toHaveBeenCalled();
  });
  it("stores a complete document and its merged preload header in L1 and L2", async () => {
    const r = (await handleDocumentRequest(
      req(),
      () => new Response("complete", { headers }),
    )) as Response;
    r.headers.set("link", "</assets/entry.js>; rel=modulepreload");
    let work: Promise<boolean> | undefined;
    const res = applyDeferredDocumentStore(r, (p) => {
      work = p;
    });
    expect(await res.text()).toBe("complete");
    await expect(work).resolves.toBe(true);
    expect(h.put).toHaveBeenCalledOnce();
    expect(h.put.mock.calls[0][2].link).toContain("modulepreload");
    const replay = (await handleDocumentRequest(req(), () => {
      throw new Error("must hit cache");
    })) as Response;
    expect(replay.headers.get("x-nes-cache")).toBe("HIT");
    expect(replay.headers.get("link")).toBe(res.headers.get("link"));
  });
});
