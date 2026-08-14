import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NES_CACHE_HEADER } from "@/lib/http/documentCache";
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  probeDocumentCache,
  purgeDocumentCache,
  resetDocumentCacheForTests,
  revalidationHeader,
  setDocumentRevalidator,
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
  // podają hosta tak jak proxy produkcyjne: przez `x-forwarded-host`. Katalog
  // tenantów jest tu pusty (brak env Supabase), więc trustedPublicHost działa
  // w gałęzi bootstrap i honoruje XFH - dokładnie jak instalacja bez domen.
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

/**
 * Driver rewalidacji w tle odwzorowujący `src/server.ts`: syntetyczne żądanie
 * ze znacznikiem izolatu przechodzi PEŁNY przebieg (handleDocumentRequest +
 * applyDeferredDocumentStore) i rozwiązuje się dopiero po zapisie wpisu.
 */
function backgroundRevalidator(render: () => Response | Promise<Response>) {
  const [marker, nonce] = revalidationHeader();
  return vi.fn(async (request: Request): Promise<boolean> => {
    const headers = new Headers({ [marker]: nonce });
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);

    const result = await handleDocumentRequest(
      new Request(request.url, { method: "GET", headers }),
      render,
    );
    let work: Promise<boolean> | null = null;
    const finalized = applyDeferredDocumentStore(result as Response, (pending) => {
      work = pending;
    });
    await finalized.arrayBuffer();
    const stored = work as Promise<boolean> | null;
    return stored ? await stored : false;
  });
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

  it("utrwala nagłówek Link scalony na GRANICY handlera i wiek wpisu na replay HIT", async () => {
    // ŚCIEŻKA PRODUKCYJNA: loadery ustawiają Link przez setResponseHeader na
    // nagłówkach ZDARZENIA h3, więc wewnątrz łańcucha middleware odpowiedź
    // renderu nagłówka NIE MA - h3 scala go na Response dopiero w toResponse()
    // na granicy requestHandlera. Odroczony zapis musi więc czytać nagłówek
    // z odpowiedzi PO granicy (applyDeferredDocumentStore w src/server.ts),
    // nie z tej widzianej w middleware. Bez tego wpisy trzymały link=null
    // i HIT/STALE (dominująca ścieżka czytelników, jedyna zdatna na 103 Early
    // Hints) wychodziły bez preloadów.
    const LINK_VALUE =
      '<https://cdn/cover.jpg>; rel="preload"; as="image"; fetchpriority=high, ' +
      '</assets/font.woff2>; rel="preload"; as="font"; type="font/woff2"; crossorigin';
    // Render BEZ nagłówka Link - tak wygląda odpowiedź wewnątrz łańcucha.
    const next = vi.fn(async () => htmlResponse("<html>hero</html>"));

    const inChain = (await handleDocumentRequest(docRequest("/z-preloadem"), next)) as Response;
    expect(inChain.headers.get("link")).toBeNull();
    // Granica handlera (h3 toResponse): scalone nagłówki zdarzenia lądują na
    // odpowiedzi. Tożsamość strumienia body pozostaje nienaruszona - to ona
    // jest kluczem WeakMap odroczonego zapisu.
    const mergedHeaders = new Headers(inChain.headers);
    mergedHeaders.set("link", LINK_VALUE);
    const boundary = new Response(inChain.body, { status: inChain.status, headers: mergedHeaders });
    const first = applyDeferredDocumentStore(boundary);
    expect(first.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    await first.text();
    await settle();

    const second = await renderThroughEdge("/z-preloadem", next);
    expect(second.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(second.headers.get("link")).toBe(LINK_VALUE);
    // Wiek wpisu w Server-Timing (`nes-age;dur=<ms>`) - korelacja RUM.
    expect(second.headers.get("server-timing")).toMatch(/nes-age;dur=\d+/);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("render bez nagłówka Link daje replay bez nagłówka Link (zero wymyślania)", async () => {
    const next = vi.fn(async () => htmlResponse("<html>plain</html>"));
    await (await renderThroughEdge("/bez-preloadu", next)).text();
    await settle();
    const hit = await renderThroughEdge("/bez-preloadu", next);
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(hit.headers.get("link")).toBeNull();
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

describe("stale-while-revalidate za odpowiedzią", () => {
  // Odświeżenia biegną ZA odpowiedzią - bez odczekania ich zapisy wpadałyby
  // do magazynu już w kolejnym teście.
  afterEach(async () => {
    setDocumentRevalidator(null);
    await settle();
  });

  /** Wpis w cache'u, przesunięty poza okno świeżości (cap 3 min), w oknie SWR. */
  async function seedStaleEntry(path: string, body: string): Promise<void> {
    vi.useFakeTimers({ toFake: ["Date"] });
    await renderThroughEdge(path, () => htmlResponse(body));
    // Asercja PO ŚCIEŻCE, nie po liczniku wpisów: odświeżenia w tle z innych
    // testów tej suity mogą jeszcze dosypywać własne klucze do magazynu.
    await vi.waitFor(async () => {
      expect((await probeDocumentCache(path, "tenant-a.eu")).cached).toBe(true);
    });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
  }

  it("czytelnik dostaje STALE bez czekania na render, a wpis odświeża się w tle", async () => {
    await seedStaleEntry("/wpis", "<html>v1</html>");

    const backgroundRender = vi.fn(async () => htmlResponse("<html>v2</html>"));
    setDocumentRevalidator(backgroundRevalidator(backgroundRender));

    // Render podstawiony czytelnikowi: NIE wolno go tknąć - od tego jest tło.
    const readerRender = vi.fn(async () => htmlResponse("<html>reader-paid</html>"));
    const stale = await renderThroughEdge("/wpis", readerRender);

    expect(stale.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await stale.text()).toBe("<html>v1</html>");
    expect(readerRender).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(backgroundRender).toHaveBeenCalledTimes(1);
    });
    await settle();

    // Odświeżony wpis jest już świeży - kolejny czytelnik dostaje HIT z v2.
    const refreshed = await renderThroughEdge("/wpis", readerRender);
    expect(refreshed.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(await refreshed.text()).toBe("<html>v2</html>");
    expect(readerRender).not.toHaveBeenCalled();
    expect(getDocumentCacheSnapshot().revalidations).toBe(1);
    expect(getDocumentCacheSnapshot().revalidationFailures).toBe(0);
  });

  it("odświeżenie w tle nie zaniża współczynnika trafień (nie jest MISS-em)", async () => {
    await seedStaleEntry("/raport", "<html>v1</html>");
    const before = getDocumentCacheSnapshot().misses;

    setDocumentRevalidator(backgroundRevalidator(() => htmlResponse("<html>v2</html>")));
    const stale = await renderThroughEdge("/raport", () => htmlResponse("<html>unused</html>"));
    expect(stale.headers.get(NES_CACHE_HEADER)).toBe("STALE");

    await vi.waitFor(() => {
      expect(getDocumentCacheSnapshot().revalidations).toBe(1);
      expect(getDocumentCacheSnapshot().revalidationFailures).toBe(0);
    });
    await settle();

    // Render odświeżający jest KONSEKWENCJĄ trafienia w cache, nie kosztem
    // wizyty - karta /admin/performance liczy hitRatio z (hits+stale)/(+misses).
    expect(getDocumentCacheSnapshot().misses).toBe(before);
  });

  it("single-flight: równoległe trafienia STALE uruchamiają JEDNO odświeżenie", async () => {
    await seedStaleEntry("/archiwum", "<html>old</html>");

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backgroundRender = vi.fn(async () => {
      await gate;
      return htmlResponse("<html>new</html>");
    });
    setDocumentRevalidator(backgroundRevalidator(backgroundRender));

    const readerRender = vi.fn(async () => htmlResponse("<html>unused</html>"));
    const responses = await Promise.all([
      renderThroughEdge("/archiwum", readerRender),
      renderThroughEdge("/archiwum", readerRender),
      renderThroughEdge("/archiwum", readerRender),
    ]);

    for (const response of responses) {
      expect(response.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    }
    expect(readerRender).not.toHaveBeenCalled();
    expect(backgroundRender).toHaveBeenCalledTimes(1);
    expect(getDocumentCacheSnapshot().revalidations).toBe(1);

    release?.();
    await vi.waitFor(() => {
      expect(getDocumentCacheSnapshot().revalidationFailures).toBe(0);
    });
  });

  it("nieudane odświeżenie zostawia wpis STALE zamiast zepsuć odpowiedź", async () => {
    await seedStaleEntry("/kategoria", "<html>zachowane</html>");

    setDocumentRevalidator(
      vi.fn(async () => {
        throw new Error("db hiccup");
      }),
    );

    const readerRender = vi.fn(async () => htmlResponse("<html>unused</html>"));
    const stale = await renderThroughEdge("/kategoria", readerRender);
    expect(stale.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await stale.text()).toBe("<html>zachowane</html>");

    await vi.waitFor(() => {
      expect(getDocumentCacheSnapshot().revalidationFailures).toBe(1);
    });

    // Wpis nietknięty, więc następny czytelnik znów dostaje treść, nie 500 -
    // i uruchamia kolejną próbę (single-flight został zwolniony).
    const retry = await renderThroughEdge("/kategoria", readerRender);
    expect(retry.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await retry.text()).toBe("<html>zachowane</html>");
    expect(readerRender).not.toHaveBeenCalled();
  });

  it("żądanie odświeżające pomija cache i zapisuje świeży dokument", async () => {
    await seedStaleEntry("/program", "<html>stary</html>");
    const [marker, nonce] = revalidationHeader();

    const render = vi.fn(async () => htmlResponse("<html>nowy</html>"));
    const result = await handleDocumentRequest(
      new Request("https://tenant-a.eu/program", {
        method: "GET",
        headers: { "x-forwarded-host": "tenant-a.eu", [marker]: nonce },
      }),
      render,
    );
    const response = applyDeferredDocumentStore(result as Response);
    // Znacznik wymusza pełny render mimo obecnego wpisu (inaczej odświeżenie
    // odczytałoby własny nieświeży dokument i nic by nie odświeżyło).
    expect(response.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    expect(await response.text()).toBe("<html>nowy</html>");
    expect(render).toHaveBeenCalledTimes(1);
    await settle();

    const reader = vi.fn(async () => htmlResponse("<html>unused</html>"));
    const hit = await renderThroughEdge("/program", reader);
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(await hit.text()).toBe("<html>nowy</html>");
  });

  it("podrobiony znacznik z zewnątrz jest ignorowany (nonce izolatu)", async () => {
    await seedStaleEntry("/analiza", "<html>z-cache</html>");
    setDocumentRevalidator(backgroundRevalidator(() => htmlResponse("<html>tlo</html>")));

    const render = vi.fn(async () => htmlResponse("<html>wymuszony</html>"));
    const result = await handleDocumentRequest(
      new Request("https://tenant-a.eu/analiza", {
        method: "GET",
        headers: { "x-forwarded-host": "tenant-a.eu", "x-nes-revalidate": "1" },
      }),
      render,
    );
    // Bez trafienia w nonce nagłówek nie znaczy nic: żądanie jest traktowane
    // jak zwykła wizyta (STALE z cache'a), więc nie jest darmowym
    // cache-busterem wymuszającym pełny render na każde żądanie z zewnątrz.
    expect((result as Response).headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(await (result as Response).text()).toBe("<html>z-cache</html>");
    expect(render).not.toHaveBeenCalled();
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
