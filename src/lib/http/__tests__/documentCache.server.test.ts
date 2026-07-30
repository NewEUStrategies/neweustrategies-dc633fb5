import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NES_CACHE_HEADER } from "@/lib/http/documentCache";
import {
  applyDeferredDocumentStore,
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

/**
 * Pełny cykl produkcyjny jednego żądania dokumentu: middleware (decyzja
 * HIT/STALE/MISS + rejestracja odroczonego zapisu) i warstwa server.ts
 * (`applyDeferredDocumentStore` - tee + zbieranie kopii do magazynu).
 */
async function renderThroughEdge(
  path: string,
  next: () => Response | Promise<Response>,
  host?: string,
): Promise<Response> {
  const result = await handleDocumentRequest(docRequest(path, host), next);
  return applyDeferredDocumentStore(result as Response);
}

/** Zapis zbiera się asynchronicznie - domknij mikrotaski/timery. */
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

    const first = await renderThroughEdge("/analiza", next);
    expect(first.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    expect(await first.text()).toBe("<html>doc-1</html>");
    await settle();

    const second = await renderThroughEdge("/analiza", next);
    expect(second.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(second.headers.get("content-type")).toContain("text/html");
    expect(await second.text()).toBe("<html>doc-1</html>");
    expect(next).toHaveBeenCalledTimes(1);

    const snapshot = getDocumentCacheSnapshot();
    expect(snapshot.hits).toBe(1);
    expect(snapshot.misses).toBe(1);
    expect(snapshot.entries).toBe(1);
  });

  it("MISS zachowuje tożsamość strumienia body w łańcuchu middleware (regresja ~61 s)", async () => {
    // Egzekutor middleware TanStack Start porównuje tożsamość `response.body`
    // finalnej odpowiedzi z ciałem koperty SSR; rozbieżność uruchamia
    // `dispose()` -> `serverSsr.cleanup()` W TRAKCIE streamowania i dokument
    // wisi do 60-sekundowego limitu serializacji frameworka. Middleware nie
    // wolno tee-ować - tee wykonuje dopiero applyDeferredDocumentStore
    // w src/server.ts, poza zasięgiem tego porównania.
    const rendered = htmlResponse("<html>stream</html>");
    const originalBody = rendered.body;

    const decorated = (await handleDocumentRequest(
      docRequest("/tozsamosc"),
      () => rendered,
    )) as Response;
    expect(decorated.body).toBe(originalBody);

    // Zapis dzieje się dopiero w warstwie server.ts - tee jest tutaj legalne.
    const finalized = applyDeferredDocumentStore(decorated);
    expect(finalized.body).not.toBe(originalBody);
    expect(await finalized.text()).toBe("<html>stream</html>");
    await settle();
    expect(getDocumentCacheSnapshot().entries).toBe(1);
  });

  it("applyDeferredDocumentStore jest no-opem dla odpowiedzi bez rejestracji", () => {
    const passthrough = new Response("plain", { headers: { "content-type": "text/plain" } });
    expect(applyDeferredDocumentStore(passthrough)).toBe(passthrough);
  });

  it("does not store responses that did not opt into shared caching", async () => {
    const next = vi.fn(
      async () =>
        new Response("private", {
          status: 200,
          headers: { "content-type": "text/html", "cache-control": "private, no-store" },
        }),
    );
    await renderThroughEdge("/profile-adjacent", next);
    await settle();
    await renderThroughEdge("/profile-adjacent", next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });

  it("bypasses authenticated requests entirely", async () => {
    const next = vi.fn(async () => htmlResponse("x"));
    const request = new Request("https://tenant-a.eu/analiza", {
      headers: { host: "tenant-a.eu", authorization: "Bearer t" },
    });
    const result = await handleDocumentRequest(request, next);
    applyDeferredDocumentStore(result as Response);
    await settle();
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    expect(getDocumentCacheSnapshot().bypass).toBe(1);
  });

  it("falls back to STALE when the revalidating render throws", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const next = vi.fn(async () => htmlResponse("<html>stale-me</html>"));
    await renderThroughEdge("/wpis", next);
    await vi.waitFor(async () => {
      expect(getDocumentCacheSnapshot().entries).toBe(1);
    });

    // Poza oknem świeżości (cap 3 min), wewnątrz okna SWR.
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    const failingNext = vi.fn(async () => {
      throw new Error("db hiccup");
    });
    const res = await renderThroughEdge("/wpis", failingNext);
    expect(res.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await res.text()).toBe("<html>stale-me</html>");
  });

  it("purges per tenant host without touching other tenants", async () => {
    const nextA = vi.fn(async () => htmlResponse("A"));
    const nextB = vi.fn(async () => htmlResponse("B"));
    await renderThroughEdge("/x", nextA, "tenant-a.eu");
    await renderThroughEdge("/x", nextB, "tenant-b.eu");
    await settle();
    expect(getDocumentCacheSnapshot().entries).toBe(2);

    expect(purgeDocumentCache("tenant-a.eu")).toBe(1);

    await renderThroughEdge("/x", nextA, "tenant-a.eu");
    const hitB = await renderThroughEdge("/x", nextB, "tenant-b.eu");
    expect(nextA).toHaveBeenCalledTimes(2);
    expect(nextB).toHaveBeenCalledTimes(1);
    expect(hitB.headers.get(NES_CACHE_HEADER)).toBe("HIT");
  });

  it("honors the NES_EDGE_CACHE=off kill switch", async () => {
    vi.stubEnv("NES_EDGE_CACHE", "off");
    const next = vi.fn(async () => htmlResponse("x"));
    await renderThroughEdge("/y", next);
    await renderThroughEdge("/y", next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(getDocumentCacheSnapshot().enabled).toBe(false);
  });
});

describe("obserwowalność bez nagłówków (hosting je zdejmuje)", () => {
  it("zapisuje decyzje MISS i HIT w rejestrze snapshotu", async () => {
    await renderThroughEdge("/analizy", () => htmlResponse("<html>a</html>"));
    await settle();
    await renderThroughEdge("/analizy", () => htmlResponse("<html>a</html>"));

    const recent = getDocumentCacheSnapshot().recent;
    expect(recent[0]?.status).toBe("HIT");
    expect(recent[0]?.path).toBe("/analizy");
    expect(recent[1]?.status).toBe("MISS");
    expect(recent[1]?.cacheControl).toContain("s-maxage=900");
  });

  it("sonda raportuje stan wpisu dla ścieżki", async () => {
    const { probeDocumentCache } = await import("../documentCache.server");

    const before = await probeDocumentCache("/analizy", "tenant-a.eu");
    expect(before.cached).toBe(false);
    expect(before.status).toBe("MISS");

    await renderThroughEdge("/analizy", () => htmlResponse("<html>a</html>"));
    await settle();

    const after = await probeDocumentCache("/analizy", "tenant-a.eu");
    expect(after.cached).toBe(true);
    expect(after.status).toBe("HIT");
    expect(after.bytes).toBeGreaterThan(0);
  });
});
