// @vitest-environment node
// ETAP DEGRADACJI W PIERŚCIENIU DECYZJI (fala 3, P3.6a, R7c diagnozy `cache-dokumentu.md`).
//
// Pierścień decyzji to źródło prawdy karty /admin/performance (hosting zdejmuje nagłówki cache'u).
// MISS odrzucony z zapisu dopiero na granicy handlera albo W TRAKCIE strumieniowania był w nim
// zapisany jako CZYSTY - decyzja trafiała do pierścienia w middleware, zanim degradacja zapadła.
// Teraz ten sam wpis dostaje `degradedAt` (`loader` / `handler` / `stream`) i wynik planowania
// odświeżenia w tle, a czysty MISS zostaje bez tych pól.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestHandler } from "@tanstack/react-start/server";

import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  resetDocumentCacheForTests,
  setDocumentRevalidator,
} from "../documentCache.server";
import { setCacheControlHeader } from "../responseHeaders";

vi.mock("../requestHost", () => ({
  trustedPublicHost: async (request: Request) => new URL(request.url).hostname,
  currentTenantHost: async () => "example.org",
}));

const CACHEABLE = { "content-type": "text/html", "cache-control": "public, s-maxage=900" };
const req = (path = "/artykul") => new Request(`https://example.org${path}`);

function lastMiss() {
  const miss = getDocumentCacheSnapshot().recent.find((decision) => decision.status === "MISS");
  expect(miss).toBeDefined();
  return miss!;
}

/** Praca w tle biegnie bez `await` (runAfterResponse) - domknij mikrotaski i timery. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  resetDocumentCacheForTests();
  setDocumentRevalidator(vi.fn(async () => false));
});

afterEach(() => {
  resetDocumentCacheForTests();
});

describe("`degradedAt` w pierścieniu decyzji", () => {
  it("czysty MISS nie ma etapu degradacji ani odświeżenia w tle", async () => {
    const response = (await handleDocumentRequest(
      req(),
      () => new Response("ok", { headers: CACHEABLE }),
    )) as Response;
    const onOutcome = vi.fn();
    await applyDeferredDocumentStore(response, undefined, onOutcome).text();
    await flush();
    // Zapis bez degradacji: decyzja bez etapu (jeden argument).
    expect(onOutcome).toHaveBeenCalledWith("stored");
    const miss = lastMiss();
    expect(miss.degradedAt).toBeUndefined();
    expect(miss.degradedRevalidation).toBeUndefined();
  });

  it("`loader`: `no-store` widoczne już w middleware", async () => {
    const response = (await handleDocumentRequest(
      req(),
      () =>
        new Response("fallback", {
          headers: { "content-type": "text/html", "cache-control": "private, no-store" },
        }),
    )) as Response;
    await response.text();
    expect(lastMiss()).toMatchObject({ degradedAt: "loader", degradedRevalidation: "scheduled" });
  });

  it("`handler`: dyrektywa zawężona na granicy handlera dopisuje się do TEGO SAMEGO wpisu", async () => {
    const response = (await handleDocumentRequest(
      req(),
      () => new Response("ok", { headers: CACHEABLE }),
    )) as Response;
    expect(lastMiss().degradedAt).toBeUndefined();
    response.headers.set("cache-control", "private, no-store");

    // Linia logu dokumentu (R7c) dostaje etap razem z decyzją magazynu.
    const onOutcome = vi.fn();
    await applyDeferredDocumentStore(response, undefined, onOutcome).text();
    await flush();
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith("degraded", "handler");
    expect(getDocumentCacheSnapshot().recent.filter((d) => d.status === "MISS")).toHaveLength(1);
    expect(lastMiss()).toMatchObject({ degradedAt: "handler", degradedRevalidation: "scheduled" });
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });

  it("`stream`: degradacja odkryta w trakcie strumieniowania", async () => {
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
      // Kontekst żądania h3 musi przeżyć odroczone domknięcie strumienia.
      const { AsyncResource } = await import("node:async_hooks");
      complete = AsyncResource.bind(complete);
      return (await handleDocumentRequest(
        request,
        () => new Response(body, { headers: CACHEABLE }),
      )) as Response;
    });
    const response = await rendered(req(), {});
    let work: Promise<boolean> | undefined;
    const onOutcome = vi.fn();
    const final = applyDeferredDocumentStore(
      response,
      (pending) => {
        work = pending;
      },
      onOutcome,
    );
    complete();
    expect(await final.text()).toContain("fallback");
    await expect(work).resolves.toBe(false);
    expect(onOutcome).toHaveBeenCalledWith("degraded", "stream");
    await flush();
    expect(lastMiss()).toMatchObject({ degradedAt: "stream", degradedRevalidation: "scheduled" });
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });
});
