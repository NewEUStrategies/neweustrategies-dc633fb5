import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINUTA, advanceClock } from "@/test/time";

import {
  DOCUMENT_CACHE_MAX_ENTRY_BYTES,
  NES_CACHE_HEADER,
  NES_EDGE_CACHE_NAME,
} from "@/lib/http/documentCache";
import {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  probeDocumentCache,
  purgeDocumentCache,
  purgeDocumentPaths,
  resetDocumentCacheForTests,
  revalidationHeader,
  setDocumentRevalidator,
} from "../documentCache.server";
import { setColoCacheForTests, type ColoCache } from "../documentCacheL2.server";
import { DOC_GUARD_MAX_MS } from "../documentStreamGuard.server";
import type { DocumentStoreOutcome } from "../ssrTiming";

/**
 * Praca „za odpowiedzią" (`runAfterResponse`) przechwycona do asercji. Poza
 * Workers prawdziwa funkcja i tak jest fire-and-forget (`cloudflare:workers`
 * się nie rozwiązuje) - atrapa robi to samo, a do tego pozwala sprawdzić, że
 * obietnica końca body linii logu trafia pod `waitUntil` (recenzja P0.4,
 * MAJOR 1). Kolejność rejestracji w `src/server.ts`: praca zapisu (tee), potem
 * obietnica linii - więc linia to zawsze OSTATNI wpis żądania.
 */
const afterResponse = vi.hoisted(() => ({ work: [] as Promise<unknown>[] }));

vi.mock("@/lib/http/waitUntil.server", () => ({
  runAfterResponse: (work: Promise<unknown>): void => {
    afterResponse.work.push(work);
    void work.catch(() => undefined);
  },
}));

/**
 * Atrapa WYŁĄCZNIE wirtualnego entry frameworka (build go generuje, test nie):
 * żądanie przechodzi przez PRAWDZIWY `handleDocumentRequest`, a dalej przez
 * prawdziwy `src/server.ts` (tee zapisu, strażnik, owijka końca strumienia,
 * linia logu). Render podstawia pojedynczy test.
 */
const entryHarness = vi.hoisted(() => ({
  render: null as null | ((request: Request) => Response | Promise<Response>),
}));

vi.mock("@tanstack/react-start/server-entry", async () => {
  const cache = await import("../documentCache.server");
  return {
    default: {
      fetch: (request: Request) =>
        cache.handleDocumentRequest(request, () => {
          const render = entryHarness.render;
          if (!render) throw new Error("test nie ustawił renderu");
          return render(request);
        }),
    },
  };
});

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
  afterResponse.work.length = 0;
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
    advanceClock(10 * MINUTA);
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

  it("działa w środowisku BEZ globalnego `process` (workerd bez nodejs_compat)", () => {
    // Kill-switch czyta `process.env.NES_EDGE_CACHE`. Gołe odwołanie do
    // `process` w runtimie, który go nie ma, rzuca ReferenceError - i nie
    // w migawce admina, tylko w `cacheEnabled()`, czyli w PIERWSZEJ linii
    // obsługi KAŻDEGO żądania dokumentu. Bez osłony `typeof` cała warstwa
    // dokumentów padałaby na Workers bez `nodejs_compat`, a testy w Node
    // nigdy by tego nie zobaczyły.
    const realProcess = globalThis.process;
    try {
      Reflect.deleteProperty(globalThis, "process");
      const snapshot = getDocumentCacheSnapshot();
      // Brak zmiennej środowiskowej = brak wyłącznika, czyli cache WŁĄCZONY.
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.name).toBe(NES_EDGE_CACHE_NAME);
    } finally {
      globalThis.process = realProcess;
    }
  });

  it("MISS bez nagłówka Cache-Control zostawia w pierścieniu PUSTE pole polityki", async () => {
    // Pierścień decyzji jest jedynym źródłem prawdy karty /admin/performance:
    // warstwa hostingu zdejmuje `x-nes-cache` i nadpisuje `Cache-Control`,
    // więc z zewnątrz nie da się zobaczyć, co aplikacja naprawdę policzyła.
    // Render bez Cache-Control (trasa poza defaultCacheControlMiddleware,
    // błąd loadera) musi zostawić pole PUSTE. Gdyby wpadał tam napis "null",
    // karta pokazywałaby politykę cache'a, której nigdy nie było, i nikt by
    // nie zauważył, że ta trasa nie ma szans trafić do magazynu.
    const next = vi.fn(
      async () =>
        new Response("<html>bez-cc</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    const res = await renderThroughEdge("/bez-cache-control", next);
    expect(res.headers.get(NES_CACHE_HEADER)).toBe("MISS");

    const recent = getDocumentCacheSnapshot().recent;
    expect(recent[0]?.status).toBe("MISS");
    expect(recent[0]?.path).toBe("/bez-cache-control");
    expect(recent[0]?.cacheControl).toBeUndefined();

    // Bez `s-maxage` polityka zapisu nie przepuszcza wpisu, więc kolejny
    // czytelnik znów płaci pełny render. Sonda pyta o TĘ ścieżkę, a nie
    // o licznik wpisów - odświeżenia w tle z innych przypadków tej suity
    // mogą jeszcze dosypywać własne klucze do magazynu.
    await settle();
    const probe = await probeDocumentCache("/bez-cache-control", "tenant-a.eu");
    expect(probe.cached).toBe(false);
    expect(probe.status).toBe("MISS");
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
    advanceClock(10 * MINUTA);
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

describe("odrzut rozmiarowy (dokument > limit wpisu)", () => {
  it("liczy odrzut, loguje go i NIE zapisuje wpisu - kolejne żądanie to znów MISS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const oversized = "x".repeat(DOCUMENT_CACHE_MAX_ENTRY_BYTES + 1);
      const render = vi.fn(() => htmlResponse(oversized));

      const first = await renderThroughEdge("/za-duzy", render);
      await first.arrayBuffer();
      await settle();

      let snapshot = getDocumentCacheSnapshot();
      expect(snapshot.oversize).toBe(1);
      expect(snapshot.stores).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("/za-duzy"));

      // Wpis nie istnieje, więc drugi czytelnik płaci pełny render (MISS) -
      // dokładnie ten stan ma być odtąd WIDOCZNY w liczniku, nie cichy.
      const second = await renderThroughEdge("/za-duzy", render);
      expect(second.headers.get(NES_CACHE_HEADER)).toBe("MISS");
      expect(render).toHaveBeenCalledTimes(2);
      // Dren kopii tee + domknięcie zapisu: bez tego licznik drugiego odrzutu
      // wystrzeliłby asynchronicznie już PO resecie następnego testu.
      await second.arrayBuffer();
      await settle();
      snapshot = getDocumentCacheSnapshot();
      expect(snapshot.misses).toBe(2);
      expect(snapshot.oversize).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("dokument RÓWNY limitowi wchodzi do cache'a bez odrzutu (warunek brzegowy)", async () => {
    // Dokładnie na granicy: kontrakt to `received > maxBytes` - dokument równy
    // limitowi MUSI wejść; o bajt większy odpada (test wyżej). Regresja `>` na
    // `>=` ma tu oblać, a nie przejść niezauważona.
    const body = "y".repeat(DOCUMENT_CACHE_MAX_ENTRY_BYTES);
    const render = vi.fn(() => htmlResponse(body));

    const first = await renderThroughEdge("/w-limicie", render);
    await first.arrayBuffer();
    await settle();

    const snapshot = getDocumentCacheSnapshot();
    expect(snapshot.oversize).toBe(0);
    expect(snapshot.stores).toBe(1);

    const second = await renderThroughEdge("/w-limicie", render);
    expect(second.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(render).toHaveBeenCalledTimes(1);
  });
});

// TELEMETRIA FAZ NA GAŁĘZI BYPASS.
//
// `edge-routing` mierzy odcinek przed routerem (katalog tenantów + indeks
// przekierowań, szeregowo, planem service-role) i powstał po to, żeby dało się
// rozstrzygnąć, z czego składa się zmierzone na produkcji TTFB. Deny-lista NES
// Edge Cache obejmuje `/admin` - czyli DOKŁADNIE jedną z powierzchni, których
// TTFB był zgłoszony (3,15 s). Gdyby faza wypadała na BYPASS-ie, instrument
// byłby ślepy tam, gdzie postawiono pytanie: `/admin`, `/profile`, `/checkout`
// i całe `/api` nie niosłyby ani jednej liczby o tym odcinku.
//
// KONTROLA NEGATYWNA jest w drugim teście: bez zmierzonej fazy nagłówek NIE
// POWSTAJE, więc BYPASS nie zaczyna nagle deklarować pomiaru, którego nie ma.
describe("handleDocumentRequest - fazy Server-Timing na BYPASS", () => {
  it("ścieżka z deny-listy (/admin) NIESIE zmierzoną fazę edge-routing", async () => {
    // Telemetria jest server-only (`if (!import.meta.env.SSR) return []`), a ta
    // suita biegnie w happy-dom. Bez podstawienia flagi test mierzyłby wyłącznie
    // gałąź "nie jesteśmy na serwerze" - czyli nie mierzyłby niczego.
    vi.stubEnv("SSR", true);
    const request = docRequest("/admin");
    const timing = await import("../ssrTiming.server");
    timing.recordRequestPhase(request, "edge-routing", 284.2);

    const result = (await handleDocumentRequest(request, () =>
      htmlResponse("<html>panel</html>"),
    )) as Response;

    expect(result.headers.get("server-timing")).toBe(
      'nes-edge;desc="BYPASS", edge-routing;dur=284.2',
    );
    vi.unstubAllEnvs();
  });

  it("bez zmierzonej fazy BYPASS nie dokłada nagłówka - pomiar, nie deklaracja", async () => {
    const request = docRequest("/admin/posts");

    const result = (await handleDocumentRequest(request, () =>
      htmlResponse("<html>panel</html>"),
    )) as Response;

    expect(result.headers.get("server-timing")).toBeNull();
  });
});

describe("purgeDocumentPaths (purge selektywny L1)", () => {
  it("usuwa dokument zmienionej ścieżki w OBU językach i jego warianty z query, sąsiada zostawia HIT", async () => {
    const next = vi.fn(async () => htmlResponse("<html>doc</html>"));
    for (const path of ["/analizy/tekst", "/en/analizy/tekst", "/analizy/tekst?page=2", "/blog"]) {
      await (await renderThroughEdge(path, next)).text();
    }
    await settle();
    const before = getDocumentCacheSnapshot();

    const removed = purgeDocumentPaths("tenant-a.eu", ["/analizy/tekst/"]);
    await settle();
    expect(removed).toBeGreaterThanOrEqual(2);
    const after = getDocumentCacheSnapshot();
    expect(after.entries).toBe(before.entries - removed);
    expect(after.purges).toBe(before.purges + 1);

    const blog = await renderThroughEdge("/blog", next);
    expect(blog.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    const pl = await renderThroughEdge("/analizy/tekst", next);
    expect(pl.headers.get(NES_CACHE_HEADER)).toBe("MISS");
    const en = await renderThroughEdge("/en/analizy/tekst", next);
    expect(en.headers.get(NES_CACHE_HEADER)).toBe("MISS");
  });

  it("nie dotyka dokumentów innego hosta i zwraca 0 dla ścieżek niepoprawnych", async () => {
    const next = vi.fn(async () => htmlResponse("<html>doc</html>"));
    await (await renderThroughEdge("/blog", next, "tenant-b.eu")).text();
    await settle();
    expect(purgeDocumentPaths("tenant-a.eu", ["/blog"])).toBe(0);
    expect(purgeDocumentPaths("tenant-b.eu", ["", "https://x.example/blog"])).toBe(0);
    const still = await renderThroughEdge("/blog", next, "tenant-b.eu");
    expect(still.headers.get(NES_CACHE_HEADER)).toBe("HIT");
  });
});

// NES-LAYER (plan PSI 85/95, P0.4 = SC-1): status `nes-edge` mówi „z cache'a
// czy nie", warstwa mówi „z KTÓREGO poziomu". HIT z L2 to świeży izolat grzany
// kolonią - bez tej metryki udział zimnych izolatów wśród trafień jest
// niewidoczny. Nagłówek jest budowany na świeżo przy każdym odtworzeniu, więc
// asercje są dokładnymi napisami (zegar zamrożony: nes-age i ssr = 0).
describe("nes-layer: który poziom podał dokument", () => {
  /** Wierny funkcjonalnie zamiennik `caches.default` (mapa URL -> Response). */
  function memoryColoCache(): ColoCache {
    const entries = new Map<string, { body: Uint8Array; headers: Headers }>();
    return {
      async match(request: Request) {
        const hit = entries.get(request.url);
        return hit
          ? new Response(hit.body.slice(), { headers: new Headers(hit.headers) })
          : undefined;
      },
      async put(request: Request, response: Response) {
        entries.set(request.url, {
          body: new Uint8Array(await response.arrayBuffer()),
          headers: new Headers(response.headers),
        });
      },
    };
  }

  afterEach(() => {
    setColoCacheForTests(undefined);
  });

  it("MISS = `render`, kolejne trafienie tego izolatu = `L1`; `nes-edge` zawsze pierwszy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const next = vi.fn(async () => htmlResponse("<html>warstwy</html>"));

    const miss = await renderThroughEdge("/warstwy", next);
    expect(miss.headers.get("server-timing")).toBe(
      'nes-edge;desc="MISS", ssr;dur=0.0, nes-layer;desc="render"',
    );
    await miss.text();
    await settle();

    const hit = await renderThroughEdge("/warstwy", next);
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(hit.headers.get("server-timing")).toBe(
      'nes-edge;desc="HIT", nes-age;dur=0, nes-layer;desc="L1"',
    );
  });

  it("świeży izolat (pusty L1) trafiający wpis kolonii = `L2`, a następne trafienie już `L1`", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    setColoCacheForTests(memoryColoCache());
    const next = vi.fn(async () => htmlResponse("<html>kolonia</html>"));
    await (await renderThroughEdge("/kolonia", next)).text();
    await settle();

    // Rotacja izolatu: L1 znika, kolonia zostaje.
    resetDocumentCacheForTests();
    const fromColo = await renderThroughEdge("/kolonia", next);
    expect(fromColo.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(fromColo.headers.get("server-timing")).toBe(
      'nes-edge;desc="HIT", nes-age;dur=0, nes-layer;desc="L2"',
    );
    expect(await fromColo.text()).toBe("<html>kolonia</html>");

    // Odczyt L2 zasiał L1 - warstwa opisuje koszt BIEŻĄCEGO żądania.
    const fromMemory = await renderThroughEdge("/kolonia", next);
    expect(fromMemory.headers.get("server-timing")).toContain('nes-layer;desc="L1"');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("STALE z pamięci izolatu niesie `L1` (także gdy render odświeżający padł)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await (await renderThroughEdge("/stary", () => htmlResponse("<html>stary</html>"))).text();
    await settle();
    advanceClock(10 * MINUTA);

    const stale = await renderThroughEdge("/stary", async () => {
      throw new Error("db hiccup");
    });
    expect(stale.headers.get(NES_CACHE_HEADER)).toBe("STALE");
    expect(stale.headers.get("server-timing")).toBe(
      `nes-edge;desc="STALE", nes-age;dur=${10 * MINUTA}, nes-layer;desc="L1"`,
    );
  });

  it("BYPASS nie deklaruje warstwy - cache nie był konsultowany", async () => {
    const result = (await handleDocumentRequest(
      new Request("https://tenant-a.eu/analiza", {
        headers: { "x-forwarded-host": "tenant-a.eu", authorization: "Bearer t" },
      }),
      () => htmlResponse("<html>prywatne</html>"),
    )) as Response;
    expect(result.headers.get("server-timing") ?? "").not.toContain("nes-layer");
  });
});

// Recenzja P0.4, MAJOR 2 (ii): magazyn zgłasza PRAWDZIWY wynik zapisu, żeby
// linia logu dokumentu nie zgadywała go z nagłówków wysłanych przed body.
describe("applyDeferredDocumentStore: wynik decyzji zapisu (`onOutcome`)", () => {
  async function registeredMiss(path: string, body: BodyInit | null): Promise<Response> {
    return (await handleDocumentRequest(
      docRequest(path),
      () => new Response(body, { status: 200, headers: CACHEABLE_HEADERS }),
    )) as Response;
  }

  it("`stored` przychodzi PRZED wpisem w L1 - kontrakt kolejności linii rewalidacji z harnessem", async () => {
    const seen: Array<{ outcome: DocumentStoreOutcome; entries: number }> = [];
    const miss = await registeredMiss("/zapis", "<html>zapis</html>");
    let work: Promise<boolean> | null = null;
    const finalized = applyDeferredDocumentStore(
      miss,
      (pending) => {
        work = pending;
      },
      (outcome) => {
        seen.push({ outcome, entries: getDocumentCacheSnapshot().entries });
      },
    );
    expect(await finalized.text()).toBe("<html>zapis</html>");
    expect(await (work as Promise<boolean> | null)).toBe(true);
    // W chwili zgłoszenia wpisu jeszcze nie ma; zaraz po nim już jest.
    expect(seen).toEqual([{ outcome: "stored", entries: 0 }]);
    expect(getDocumentCacheSnapshot().entries).toBe(1);
  });

  it("`degraded` synchronicznie, gdy polityka zawęziła się na granicy handlera", async () => {
    const miss = await registeredMiss("/granica", "<html>granica</html>");
    const headers = new Headers(miss.headers);
    headers.set("cache-control", "private, no-store");
    const boundary = new Response(miss.body, { status: 200, headers });
    const seen: DocumentStoreOutcome[] = [];
    const finalized = applyDeferredDocumentStore(boundary, undefined, (outcome) => {
      seen.push(outcome);
    });
    expect(seen).toEqual(["degraded"]);
    expect(finalized.headers.get("cache-control")).toBe("private, no-store");
    await finalized.text();
    await settle();
    expect(seen).toEqual(["degraded"]);
  });

  it("`oversize` dla dokumentu ponad limit wpisu", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const miss = await registeredMiss("/duzy", "x".repeat(DOCUMENT_CACHE_MAX_ENTRY_BYTES + 1));
    const seen: DocumentStoreOutcome[] = [];
    const finalized = applyDeferredDocumentStore(miss, undefined, (outcome) => {
      seen.push(outcome);
    });
    await finalized.text();
    await settle();
    expect(seen).toEqual(["oversize"]);
    vi.restoreAllMocks();
  });

  it("`failed`, gdy strumień renderu pada przed zebraniem kopii", async () => {
    const miss = await registeredMiss(
      "/padl",
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("render padł"));
        },
      }),
    );
    const seen: DocumentStoreOutcome[] = [];
    const finalized = applyDeferredDocumentStore(miss, undefined, (outcome) => {
      seen.push(outcome);
    });
    await finalized.text().catch(() => undefined);
    await settle();
    expect(seen).toEqual(["failed"]);
  });

  it("brak rejestracji = brak wywołania; wyjątek z telemetrii nie zmienia losu zapisu", async () => {
    const seen: DocumentStoreOutcome[] = [];
    const passthrough = new Response("plain", { headers: { "content-type": "text/plain" } });
    expect(applyDeferredDocumentStore(passthrough, undefined, (o) => seen.push(o))).toBe(
      passthrough,
    );
    expect(seen).toEqual([]);

    const miss = await registeredMiss("/telemetria-padla", "<html>ok</html>");
    const finalized = applyDeferredDocumentStore(miss, undefined, () => {
      throw new Error("log padł");
    });
    expect(await finalized.text()).toBe("<html>ok</html>");
    await settle();
    expect(getDocumentCacheSnapshot().entries).toBe(1);
  });
});

// PEŁNY POTOK `src/server.ts` (P0.4): linia logu PO KOŃCU body z `streamMs`
// i licznikiem izolatu, `colo` w Server-Timing ZA nagłówkiem potoku, owijka
// strumienia ZA tee zapisu (MISS dalej zasiewa magazyn - tożsamość body w
// łańcuchu nienaruszona, regresja ~61 s wykluczona).
describe("src/server.ts: telemetria dokumentu na końcu strumienia", () => {
  const LIGHTHOUSE_UA =
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
  const RAY = "8c5a3b2e9f1d4e7a-WAW";
  const encoder = new TextEncoder();

  function entryRequest(path: string, init: { method?: string; ua?: string } = {}): Request {
    return new Request(`https://tenant-a.eu${path}`, {
      method: init.method ?? "GET",
      headers: {
        "x-forwarded-host": "tenant-a.eu",
        "cf-ray": RAY,
        ...(init.ua ? { "user-agent": init.ua } : {}),
      },
    });
  }

  function docLines(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
    return log.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('{"kind":"doc"'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  async function loadEntry() {
    return (await import("../../../server")).default;
  }

  afterEach(() => {
    entryHarness.render = null;
    vi.restoreAllMocks();
  });

  it("MISS: log dopiero po ostatnim bajcie, z streamMs/isoReq/klasą UA/ray/kolonią; potem HIT z L1", async () => {
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    entryHarness.render = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
          },
        }),
        { status: 200, headers: CACHEABLE_HEADERS },
      );

    const response = await entry.fetch(entryRequest("/strumien", { ua: LIGHTHOUSE_UA }));
    const timing = response.headers.get("server-timing") ?? "";
    expect(timing.startsWith('nes-edge;desc="MISS"')).toBe(true);
    expect(timing).toContain('nes-layer;desc="render"');
    expect(timing).toMatch(/server-init;dur=\d+, app;dur=\d+, colo;desc="WAW"$/);
    expect(timing).not.toMatch(/stream/);

    const reader = response.body!.getReader();
    source!.enqueue(encoder.encode("<html><body>"));
    await reader.read();
    // Body jeszcze płynie - linii logu nie ma (dawniej powstawała tu, przed body).
    expect(docLines(log)).toHaveLength(0);

    source!.enqueue(encoder.encode("</body></html>"));
    source!.close();
    let html = "<html><body>";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
    }
    expect(html).toBe("<html><body></body></html>");

    const [miss] = docLines(log);
    expect(miss).toMatchObject({
      kind: "doc",
      path: "/strumien",
      status: 200,
      cache: "MISS",
      layer: "render",
      colo: "WAW",
      ray: RAY,
      uaClass: "lighthouse",
      degraded: false,
      revalidation: false,
      // Recenzja P0.4, MAJOR 2: linia niesie decyzję magazynu, a czytelnik
      // zobaczył `done` dopiero po niej (asercja tuż po pętli odczytu).
      store: "stored",
    });
    expect(docLines(log)).toHaveLength(1);
    expect(miss).not.toHaveProperty("streamEnd");
    expect(typeof miss!.streamMs).toBe("number");
    expect(miss!.streamMs as number).toBeGreaterThanOrEqual(miss!.appMs as number);
    expect(Number.isSafeInteger(miss!.isoReq)).toBe(true);
    // Prywatność: z UA do logu trafia wyłącznie klasa.
    expect(JSON.stringify(miss)).not.toContain("moto g power");

    // Owijka siedzi ZA tee zapisu: MISS zasiał magazyn, więc kolejne żądanie
    // to HIT z pamięci izolatu - i kolejny numer żądania tego izolatu.
    await settle();
    const hit = await entry.fetch(entryRequest("/strumien", { ua: LIGHTHOUSE_UA }));
    expect(hit.headers.get(NES_CACHE_HEADER)).toBe("HIT");
    expect(hit.headers.get("server-timing")).toContain('nes-layer;desc="L1"');
    expect(await hit.text()).toBe("<html><body></body></html>");
    const second = docLines(log)[1];
    expect(second).toMatchObject({ cache: "HIT", layer: "L1", colo: "WAW" });
    expect(second).not.toHaveProperty("degraded");
    expect(second!.isoReq).toBe((miss!.isoReq as number) + 1);
  });

  it("zdegradowany MISS (`private, no-store` z odpornego loadera) ma `degraded: true`", async () => {
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    entryHarness.render = () =>
      new Response("<html>fallback</html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
        },
      });

    await (await entry.fetch(entryRequest("/zdegradowany"))).text();
    expect(docLines(log)).toHaveLength(1);
    expect(docLines(log)[0]).toMatchObject({
      cache: "MISS",
      degraded: true,
      // Brak nagłówka user-agent to też automat (ta sama lista co beacony).
      uaClass: "bot",
    });
    // Magazyn takiego MISS-a nie rejestrował - nie ma wyniku zapisu.
    expect(docLines(log)[0]).not.toHaveProperty("store");
  });

  it("zerwany klient: linia logu powstaje od razu z `streamEnd: aborted`, a zerwanie dochodzi do renderu", async () => {
    // Render NIE do zapisu (bez tee): zerwanie idzie owijka -> strażnik ->
    // render wprost. Przy MISS-ie do zapisu gałąź tee kolektora celowo trzyma
    // render do końca (zachowanie sprzed P0.4) - linia logu i tak powstaje
    // natychmiast, bo owijka zgłasza zerwanie, nie czekając na źródło.
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cancelled: unknown[] = [];
    entryHarness.render = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("<html><body>"));
          },
          cancel(reason) {
            cancelled.push(reason);
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, no-store",
          },
        },
      );

    const response = await entry.fetch(entryRequest("/zerwany"));
    const reader = response.body!.getReader();
    await reader.read();
    expect(docLines(log)).toHaveLength(0);
    void reader.cancel(new Error("klient zniknął"));

    expect(docLines(log)).toHaveLength(1);
    expect(docLines(log)[0]).toMatchObject({ path: "/zerwany", streamEnd: "aborted" });
    await vi.waitFor(() => {
      expect(cancelled.length).toBeGreaterThan(0);
    });
    await settle();
    expect(docLines(log)).toHaveLength(1);
  });

  // Recenzja P0.4, MINOR 6: wariant, dla którego owijka NIE jest
  // `TransformStream` - MISS do zapisu, tee aktywne, a anulowanie gałęzi
  // czytelnika czeka na kolektor zapisu (spec ReadableStreamDefaultTee).
  it("zerwany klient na MISS-ie DO ZAPISU (tee aktywne): jedna linia `aborted` od razu, render dalej zasiewa magazyn", async () => {
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    entryHarness.render = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
            controller.enqueue(encoder.encode("<html><body>"));
          },
        }),
        { status: 200, headers: CACHEABLE_HEADERS },
      );

    const response = await entry.fetch(entryRequest("/zerwany-do-zapisu"));
    const reader = response.body!.getReader();
    await reader.read();
    expect(docLines(log)).toHaveLength(0);
    void reader.cancel(new Error("klient zniknął"));

    // OD RAZU, nie po renderze: decyzja magazynu jeszcze nie zapadła, więc
    // linia nie ma `store`, a `degraded` mówi to, co nagłówki.
    expect(docLines(log)).toHaveLength(1);
    expect(docLines(log)[0]).toMatchObject({
      path: "/zerwany-do-zapisu",
      cache: "MISS",
      streamEnd: "aborted",
      degraded: false,
    });
    expect(docLines(log)[0]).not.toHaveProperty("store");

    // Kolektor zapisu czyta swoją gałąź do końca renderu (zachowanie sprzed
    // P0.4) - koniec źródła nie dokłada drugiej linii.
    source!.enqueue(encoder.encode("</body></html>"));
    source!.close();
    await settle();
    expect(docLines(log)).toHaveLength(1);
    expect(getDocumentCacheSnapshot().entries).toBe(1);
  });

  it("GET z body `null` (204): jedna linia od razu, bez `streamMs`", async () => {
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    entryHarness.render = () =>
      new Response(null, { status: 204, headers: { "content-type": "text/html; charset=utf-8" } });

    const response = await entry.fetch(entryRequest("/bez-tresci"));
    expect(response.body).toBeNull();
    expect(docLines(log)).toHaveLength(1);
    expect(docLines(log)[0]).toMatchObject({ path: "/bez-tresci", status: 204, colo: "WAW" });
    expect(docLines(log)[0]).not.toHaveProperty("streamMs");
    // Nic nie czeka na koniec body, więc nic nie trafia pod `waitUntil`.
    expect(afterResponse.work).toHaveLength(0);
  });

  it("dokument za duży na wpis: `store: oversize`, `degraded: false` (MAJOR 2)", async () => {
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const huge = `<html><body>${"x".repeat(DOCUMENT_CACHE_MAX_ENTRY_BYTES)}</body></html>`;
    entryHarness.render = () => htmlResponse(huge);

    const response = await entry.fetch(entryRequest("/za-duzy"));
    expect((await response.text()).length).toBe(huge.length);
    expect(docLines(log)).toHaveLength(1);
    expect(docLines(log)[0]).toMatchObject({ cache: "MISS", degraded: false, store: "oversize" });
    expect(getDocumentCacheSnapshot().entries).toBe(0);
  });

  // Recenzja P0.4, MAJOR 1: przed P0.4 linia szła synchronicznie przed
  // zwrotem Response; teraz powstaje na końcu body, więc obietnica końca body
  // MUSI jechać pod `waitUntil` z bezpiecznikiem poniżej 30 s.
  it("klient ani nie czyta, ani nie anuluje: obietnica linii pod `runAfterResponse`, bezpiecznik daje jedną linię `aborted`", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    entryHarness.render = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("<html><body>"));
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, no-store",
          },
        },
      );

    const response = await entry.fetch(entryRequest("/porzucony"));
    expect(response.headers.get("x-ssr-doc-guard")).toBe("on");
    const line = afterResponse.work.at(-1);
    if (!line) throw new Error("obietnica linii nie trafiła pod runAfterResponse");
    let lineSettled = false;
    void line.then(() => {
      lineSettled = true;
    });

    // Strażnik domyka SWOJE wyjście (idle 12 s, max 20 s), ale owijki nikt
    // nie ciągnie - bez bezpiecznika linii nie byłoby nigdy.
    await vi.advanceTimersByTimeAsync(DOC_GUARD_MAX_MS + 2_000 - 1);
    expect(docLines(log)).toHaveLength(0);
    expect(lineSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(docLines(log)).toHaveLength(1);
    const [aborted] = docLines(log);
    expect(aborted).toMatchObject({ path: "/porzucony", streamEnd: "aborted", degraded: true });
    expect(aborted!.streamMs).toBe(DOC_GUARD_MAX_MS + 2_000);
    expect(lineSettled).toBe(true);

    // Późny czytelnik nie dokłada drugiej linii.
    vi.useRealTimers();
    await response.text();
    expect(docLines(log)).toHaveLength(1);
  });

  // Recenzja P0.4, runda 2: strażnik pompuje źródło sam i domyka SWOJE
  // wyjście niezależnie od tempa klienta, a owijka idzie w tempie czytelnika.
  // Bezpiecznik odpala więc też przy wolnym czytelniku, a liczy się od powrotu
  // handlera - `streamMs` linii to `appMs` + 22 000, nie 22 000.
  it("wolny czytelnik: jedna linia `aborted` ze `streamMs - appMs` = 22 000, a dokument dochodzi w całości", async () => {
    vi.useFakeTimers({ now: 3_000_000 });
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const RENDER_MS = 400;
    const parts = ["<html><head></head>", "<body>wolny czytelnik</body></html>"];
    entryHarness.render = async () => {
      await new Promise((resolve) => setTimeout(resolve, RENDER_MS));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) controller.enqueue(encoder.encode(part));
            controller.close();
          },
        }),
        { status: 200, headers: CACHEABLE_HEADERS },
      );
    };

    const pending = entry.fetch(entryRequest("/wolny-czytelnik"));
    await vi.advanceTimersByTimeAsync(RENDER_MS);
    const response = await pending;
    expect(response.headers.get("x-ssr-doc-guard")).toBe("on");
    const decoder = new TextDecoder();
    const reader = response.body!.getReader();
    const first = await reader.read();
    let text = decoder.decode(first.value, { stream: true });

    // Render skończony, strażnik domknięty, kopia w magazynie - tylko klient
    // nie doczytał reszty body.
    await vi.advanceTimersByTimeAsync(DOC_GUARD_MAX_MS + 2_000 - 1);
    expect(docLines(log)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(docLines(log)).toHaveLength(1);
    const [line] = docLines(log);
    expect(line).toMatchObject({
      path: "/wolny-czytelnik",
      cache: "MISS",
      streamEnd: "aborted",
      appMs: RENDER_MS,
      degraded: false,
      store: "stored",
    });
    expect(Number(line!.streamMs) - Number(line!.appMs)).toBe(DOC_GUARD_MAX_MS + 2_000);

    // Bezpiecznik zamyka wyłącznie telemetrię: reszta body dochodzi bez
    // ucięcia, a drugiej linii nie ma.
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
    expect(text + decoder.decode()).toBe(parts.join(""));
    expect(docLines(log)).toHaveLength(1);
  });

  // Recenzja P0.4, MINOR 9: kill-switch strażnika oznacza wiszącą
  // serializację do ~60 s - bezpiecznik daje linię po 22 s, nie po minucie.
  it("SSR_DOC_GUARD=off i wiszący render: linia `aborted` po bezpieczniku, mimo że klient czyta", async () => {
    vi.stubEnv("SSR_DOC_GUARD", "off");
    vi.useFakeTimers({ now: 2_000_000 });
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    entryHarness.render = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            source = controller;
            controller.enqueue(encoder.encode("<html><body>"));
          },
        }),
        { status: 200, headers: CACHEABLE_HEADERS },
      );

    const response = await entry.fetch(entryRequest("/bez-straznika"));
    expect(response.headers.get("x-ssr-doc-guard")).toBeNull();
    const line = afterResponse.work.at(-1);
    const reader = response.body!.getReader();
    await reader.read();
    const stalled = reader.read();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(docLines(log)).toHaveLength(1);
    expect(docLines(log)[0]).toMatchObject({
      path: "/bez-straznika",
      cache: "MISS",
      streamEnd: "aborted",
      streamMs: DOC_GUARD_MAX_MS + 2_000,
    });
    await expect(line).resolves.toBeUndefined();
    // Sprzątanie: anulowanie gałęzi tee czeka na kolektor zapisu, więc nie
    // czekamy na nie, tylko domykamy render. Drugiej linii nie ma.
    void reader.cancel();
    expect((await stalled).done).toBe(true);
    source!.close();
    expect(docLines(log)).toHaveLength(1);
  });

  it("HEAD loguje od razu, bez streamMs - runtime takiego body nie czyta", async () => {
    const entry = await loadEntry();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    entryHarness.render = () => htmlResponse("<html>naglowki</html>");

    const response = await entry.fetch(entryRequest("/naglowki", { method: "HEAD" }));
    const [line] = docLines(log);
    expect(line).toMatchObject({ path: "/naglowki", colo: "WAW", ray: RAY });
    expect(line).not.toHaveProperty("streamMs");
    expect(response.headers.get("server-timing")).toMatch(/colo;desc="WAW"$/);
  });
});
