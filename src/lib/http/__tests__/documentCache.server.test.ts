import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NES_CACHE_HEADER } from "@/lib/http/documentCache";
import {
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  purgeDocumentCache,
  resetDocumentCacheForTests,
} from "../documentCache.server";

const CACHEABLE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
};

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: CACHEABLE_HEADERS });
}

function docRequest(path: string, host = "tenant-a.eu"): Request {
  // undici wycina zakazany nagłówek `host` w konstruktorze Request, więc testy
  // podają hosta tak jak proxy produkcyjne: przez `x-forwarded-host`
  // (pierwszeństwo w requestPublicHost).
  return new Request(`https://${host}${path}`, {
    method: "GET",
    headers: { "x-forwarded-host": host },
  });
}

/** Tee-store zbiera się asynchronicznie - domknij mikrotaski/timery. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetDocumentCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("handleDocumentRequest", () => {
  it("serves MISS then HIT with the branded header, without re-rendering", async () => {
    const next = vi.fn(async () => htmlResponse("<html>doc-1</html>"));

    const first = (await handleDocumentRequest(docRequest("/analiza"), next)) as Response;
    expect(first.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    expect(await first.text()).toBe("<html>doc-1</html>");
    await settle();

    const second = (await handleDocumentRequest(docRequest("/analiza"), next)) as Response;
    expect(second.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(second.headers.get("content-type")).toContain("text/html");
    expect(await second.text()).toBe("<html>doc-1</html>");
    expect(next).toHaveBeenCalledTimes(1);

    const snapshot = getDocumentCacheSnapshot();
    expect(snapshot.hits).toBe(1);
    expect(snapshot.misses).toBe(1);
    expect(snapshot.entries).toBe(1);
  });

  it("does not store responses that did not opt into shared caching", async () => {
    const next = vi.fn(
      async () =>
        new Response("private", {
          status: 200,
          headers: { "content-type": "text/html", "cache-control": "private, no-store" },
        }),
    );
    await handleDocumentRequest(docRequest("/profile-adjacent"), next);
    await settle();
    await handleDocumentRequest(docRequest("/profile-adjacent"), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });

  it("bypasses authenticated requests entirely", async () => {
    const next = vi.fn(async () => htmlResponse("x"));
    const request = new Request("https://tenant-a.eu/analiza", {
      headers: { host: "tenant-a.eu", authorization: "Bearer t" },
    });
    await handleDocumentRequest(request, next);
    await settle();
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    expect(getDocumentCacheSnapshot().bypass).toBe(1);
  });

  it("falls back to STALE when the revalidating render throws", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const next = vi.fn(async () => htmlResponse("<html>stale-me</html>"));
    await handleDocumentRequest(docRequest("/wpis"), next);
    await vi.waitFor(async () => {
      expect(getDocumentCacheSnapshot().entries).toBe(1);
    });

    // Poza oknem świeżości (cap 3 min), wewnątrz okna SWR.
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    const failingNext = vi.fn(async () => {
      throw new Error("db hiccup");
    });
    const res = (await handleDocumentRequest(docRequest("/wpis"), failingNext)) as Response;
    expect(res.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await res.text()).toBe("<html>stale-me</html>");
  });

  it("purges per tenant host without touching other tenants", async () => {
    const nextA = vi.fn(async () => htmlResponse("A"));
    const nextB = vi.fn(async () => htmlResponse("B"));
    await handleDocumentRequest(docRequest("/x", "tenant-a.eu"), nextA);
    await handleDocumentRequest(docRequest("/x", "tenant-b.eu"), nextB);
    await settle();
    expect(getDocumentCacheSnapshot().entries).toBe(2);

    expect(purgeDocumentCache("tenant-a.eu")).toBe(1);

    await handleDocumentRequest(docRequest("/x", "tenant-a.eu"), nextA);
    const hitB = (await handleDocumentRequest(docRequest("/x", "tenant-b.eu"), nextB)) as Response;
    expect(nextA).toHaveBeenCalledTimes(2);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(hitB.headers.get(NES_CACHE_HEADER)).toBe("HIT");
  });

  it("honors the NES_EDGE_CACHE=off kill switch", async () => {
    vi.stubEnv("NES_EDGE_CACHE", "off");
    const next = vi.fn(async () => htmlResponse("x"));
    await handleDocumentRequest(docRequest("/y"), next);
    await handleDocumentRequest(docRequest("/y"), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(getDocumentCacheSnapshot().enabled).toBe(false);
  });
});
