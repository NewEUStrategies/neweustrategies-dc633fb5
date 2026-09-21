// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestHandler } from "@tanstack/react-start/server";
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  resetDocumentCacheForTests,
  revalidationHeader,
  setDocumentRevalidator,
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

/** Praca w tle biegnie bez `await` (runAfterResponse) - domknij mikrotaski. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("zdegradowany MISS planuje odświeżenie w tle (F02)", () => {
  const degraded = { "content-type": "text/html", "cache-control": "private, no-store" };
  const render = () => new Response("degraded", { headers: degraded });
  function scheduledKinds(): Array<string | undefined> {
    return getDocumentCacheSnapshot()
      .recent.filter((d) => d.status === "MISS")
      .map((d) => d.degradedRevalidation);
  }

  it("`no-store` z loadera nie zasiewa magazynu, ale uruchamia rewalidację z limitem 2 prób na klucz", async () => {
    const revalidator = vi.fn(async () => false);
    setDocumentRevalidator(revalidator);

    await ((await handleDocumentRequest(req(), render)) as Response).text();
    await flush();
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    expect(revalidator).toHaveBeenCalledTimes(1);
    expect(getDocumentCacheSnapshot().degradedRevalidations).toBe(1);
    expect(scheduledKinds()).toContain("scheduled");

    await ((await handleDocumentRequest(req(), render)) as Response).text();
    await flush();
    expect(revalidator).toHaveBeenCalledTimes(2);

    // Trzecia degradacja w oknie: klucz wyczerpał limit - żadnego renderu w tle.
    await ((await handleDocumentRequest(req(), render)) as Response).text();
    await flush();
    expect(revalidator).toHaveBeenCalledTimes(2);
    expect(scheduledKinds()).toContain("throttled");
    expect(getDocumentCacheSnapshot().degradedRevalidations).toBe(2);
  });

  it("żądanie REWALIDACYJNE nigdy nie planuje kolejnej rewalidacji (brak rekurencji)", async () => {
    const revalidator = vi.fn(async () => false);
    setDocumentRevalidator(revalidator);
    const [marker, nonce] = revalidationHeader();
    const request = new Request("https://example.org/article", { headers: { [marker]: nonce } });
    await ((await handleDocumentRequest(request, render)) as Response).text();
    await flush();
    expect(revalidator).not.toHaveBeenCalled();
    expect(scheduledKinds()).not.toContain("scheduled");
  });

  it("czysty MISS nie jest liczony jako degradacja i nie planuje niczego", async () => {
    const revalidator = vi.fn(async () => false);
    setDocumentRevalidator(revalidator);
    const clean = (await handleDocumentRequest(
      req(),
      () => new Response("content", { headers }),
    )) as Response;
    await applyDeferredDocumentStore(clean).text();
    await flush();
    expect(revalidator).not.toHaveBeenCalled();
    expect(getDocumentCacheSnapshot().degradedRevalidations).toBe(0);
  });
});
