// @vitest-environment node
//
// ZESTAW BOOTU PER ŻĄDANIE (P2.1) - skład, tryb, węzeł w `<head>` i droga przez cały potok
// dokumentu.
//
// Trzy warstwy dowodu:
//   1. czyste funkcje (`composeBootSet`, `bootModeFor`, `bootSetJson`/`bootSetHtml`) - kolejność
//      serii, deduplikacja, filtr URL-i, reguła trybu, escapowanie;
//   2. `prepareBootSet` + `BootSetNode` - warunki składu (bez mapy, bez `serverSsr`, raz na router)
//      i PARYTET BAJTÓW: węzeł renderowany przez Reacta to dokładnie `bootSetHtml(set)` (regexy e2e
//      i `documentWeight.ts`), a w przeglądarce i bez routera - nic;
//   3. PRAWDZIWY render routera TanStack (`createRequestHandler` + `defaultStreamHandler` albo
//      `defaultRenderHandler`, te same handlery, które składa `createStartHandler`) w zasięgu żądania
//      Start (`createServerEntry`, `src/test/startRequestScope.ts`), przez PRAWDZIWE `src/server.ts`
//      (atrapą jest wyłącznie wirtualny moduł `server-entry`, którego build nie generuje w teście -
//      wzorzec `src/__tests__/serverEntryRequestOptions.test.ts`). Dowodzi tego, czego wymaga bramka
//      planu - i czego zabrakło przy pierwszym podejściu do podbicia TanStack (zestaw po cichu nie
//      trafiał do dokumentu, strona nie hydratowała się nigdy): `#nes-boot-set` stoi DOKŁADNIE RAZ
//      w `<head>` dokumentu ze ścieżki `allReady` (UA bota `Chrome-Lighthouse`, czyli PSI na MISS),
//      strumieniowej (UA przeglądarki) i `renderToString`, ten sam węzeł jest w ciele odtworzonym
//      z NES Edge Cache (HIT), `<` jest escapowane, a nagłówek `Link` dokumentu po LCP nie niesie
//      żadnego `modulepreload`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AnyRouter } from "@tanstack/react-router";

import { appendLinkHeader, readLinkHeader } from "@/lib/http/responseHeaders";
import { readBootMode } from "@/lib/http/frameworkPreloads.server";
import { startRequestScope } from "@/test/startRequestScope";

import {
  AFTER_LCP_ROUTE_IDS,
  BOOT_SET_ELEMENT_ID,
  bootModeFor,
  bootSetHtml,
  bootSetJson,
  composeBootSet,
  prepareBootSet,
  BOOT_LINK_PRELOAD_BUDGET_BYTES,
  bootPreloadLinkValue,
  bootPreloadLinkValues,
  type BootSet,
} from "../bootSet.server";
import type { BootManifest } from "../bootManifest";
import { BootSetNode } from "../bootSetNode";
import { getBootSetJson, setBootSetJson } from "../bootSetRegistry";

const MANIFEST: BootManifest = {
  entry: "/assets/index-E1e1E1e1.js",
  rootPreloads: ["/assets/index-E1e1E1e1.js", "/assets/vendor-react-V1v1V1v1.js"],
  routePreloads: {
    "/": ["/assets/index-route-R1r1R1r1.js", "/assets/vendor-react-V1v1V1v1.js"],
    "/konto": ["/assets/konto-K1k1K1k1.js"],
  },
};
const DICTIONARY_PL = "/assets/pl-P1p1P1p1.js";
const WIDGET_HINT = '</assets/widget-hero-W1w1W1w1.js>; rel="modulepreload"; crossorigin';
const CSS_HINT = '</assets/styles-S1.css>; rel="preload"; as="style"';
const IMAGE_HINT = '</media/hero.avif>; rel="preload"; as="image"; fetchpriority="high"';

const hoisted = vi.hoisted(() => ({
  render: null as null | ((request: Request) => Response | Promise<Response>),
}));

vi.mock("@/lib/seo/localeChunks", () => ({
  LOCALE_CHUNK_URLS: { pl: "/assets/pl-P1p1P1p1.js", en: "/assets/en-N1n1N1n1.js" },
}));

// Wirtualne entry: zasięg żądania Start jak w buildzie (`createServerEntry`); nagłówki trasy
// (`Link`, `Cache-Control`) i tryb bootu nakłada granica odpowiedzi w PRAWDZIWYM `src/server.ts`.
vi.mock("@tanstack/react-start/server-entry", async () => {
  const { startRequestScope: scope } = await import("@/test/startRequestScope");
  return {
    default: {
      fetch: scope(async (request) => {
        if (!hoisted.render) throw new Error("test nie ustawił renderu");
        return await hoisted.render(request);
      }),
    },
  };
});

describe("composeBootSet - skład serii", () => {
  it("kolejność: wejście, preloady korzenia, słownik, trasy, hinty modułów z `Link`; bez duplikatów", () => {
    const set = composeBootSet({
      manifest: MANIFEST,
      mode: "lcp",
      dictionary: DICTIONARY_PL,
      matches: [{ routeId: "__root__" }, { routeId: "/" }],
      linkHeader: [CSS_HINT, WIDGET_HINT, IMAGE_HINT, `<${DICTIONARY_PL}>; rel=modulepreload`].join(
        ", ",
      ),
    });
    expect(set).toEqual<BootSet>({
      m: "lcp",
      e: MANIFEST.entry,
      u: [
        "/assets/index-E1e1E1e1.js",
        "/assets/vendor-react-V1v1V1v1.js",
        DICTIONARY_PL,
        "/assets/index-route-R1r1R1r1.js",
        "/assets/widget-hero-W1w1W1w1.js",
      ],
    });
  });

  it("odrzuca URL-e spoza ścieżek/http(s) i id tras trafiające w prototyp", () => {
    const set = composeBootSet({
      manifest: {
        ...MANIFEST,
        rootPreloads: [MANIFEST.entry, "//evil.test/x.js", "javascript:alert(1)", '/a"b.js'],
      },
      mode: "now",
      dictionary: null,
      matches: [{ routeId: "constructor" }, { routeId: "__proto__" }],
      linkHeader: '<//cdn.evil/x.js>; rel="modulepreload"',
    });
    expect(set.u).toEqual([MANIFEST.entry]);
  });
});

describe("bootPreloadLinkValues - seria `now` w nagłówku `Link`", () => {
  const urls = Array.from(
    { length: 400 },
    (_, i) => `/assets/chunk-${String(i).padStart(3, "0")}-A1b2C3d4.js`,
  );

  it("cała seria, gdy się mieści; bez modułów podanych już przez loadery", () => {
    const small = urls.slice(0, 5);
    expect(bootPreloadLinkValues(small, new Set([small[2]]))).toEqual(
      [small[0], small[1], small[3], small[4]].map(bootPreloadLinkValue),
    );
  });

  it("długa seria: PREFIKS w kolejności zestawu, w budżecie bajtów (z separatorem)", () => {
    const values = bootPreloadLinkValues(urls, new Set());
    expect(values.length).toBeGreaterThan(50);
    expect(values.length).toBeLessThan(urls.length);
    expect(values).toEqual(urls.slice(0, values.length).map(bootPreloadLinkValue));
    const bytes = values.reduce((sum, value) => sum + value.length + 2, 0);
    expect(bytes).toBeLessThanOrEqual(BOOT_LINK_PRELOAD_BUDGET_BYTES);
    // Następny wpis już by się nie zmieścił - budżet wykorzystany, nie przycięty na zapas.
    expect(bytes + bootPreloadLinkValue(urls[values.length]).length + 2).toBeGreaterThan(
      BOOT_LINK_PRELOAD_BUDGET_BYTES,
    );
  });

  it("budżet po złączeniu: cały nagłówek serii mieści się w limicie klienta Node", () => {
    const header = bootPreloadLinkValues(urls, new Set()).join(", ");
    expect(header.length).toBeLessThan(BOOT_LINK_PRELOAD_BUDGET_BYTES);
    expect(BOOT_LINK_PRELOAD_BUDGET_BYTES).toBeLessThan(16 * 1024);
  });
});

describe("bootModeFor - tryb dokumentu", () => {
  it("`lcp` wyłącznie dla `/` i `/$` dopasowanych z sukcesem", () => {
    expect([...AFTER_LCP_ROUTE_IDS]).toEqual(["/", "/$"]);
    for (const routeId of ["/", "/$"]) {
      expect(bootModeFor([{ routeId: "__root__" }, { routeId, status: "success" }])).toBe("lcp");
    }
  });

  it("`now` dla reszty serwisu, 404/błędów, tras bez SSR i powłoki SPA", () => {
    const root = { routeId: "__root__", status: "success" };
    expect(bootModeFor([root, { routeId: "/admin", status: "success" }])).toBe("now");
    expect(bootModeFor([root, { routeId: "/$", status: "notFound" }])).toBe("now");
    expect(bootModeFor([root, { routeId: "/", status: "error" }])).toBe("now");
    expect(bootModeFor([root, { routeId: "/$", status: "success", ssr: false }])).toBe("now");
    expect(bootModeFor([root, { routeId: "/", status: "success", ssr: "data-only" }])).toBe("now");
    expect(bootModeFor([root, { routeId: "/", status: "success" }], true)).toBe("now");
    expect(bootModeFor([])).toBe("now");
  });
});

describe("bootSetJson / bootSetHtml - węzeł danych", () => {
  it("`<` jako `\\u003c`: treść nie domknie `</script>`, a JSON.parse odtwarza wartość", () => {
    const set: BootSet = { m: "lcp", e: "/a.js", u: ["/a.js", "/x</script><script>.js"] };
    const html = bootSetHtml(set);
    expect(html.startsWith(`<script type="application/json" id="${BOOT_SET_ELEMENT_ID}">`)).toBe(
      true,
    );
    const body = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(body).toBe(bootSetJson(set));
    expect(body).not.toContain("<");
    expect(JSON.parse(body)).toEqual(set);
  });
});

/** Router testowy (bez drzewa aplikacji) - instancja jest kluczem rejestru zestawu. */
async function bareRouter() {
  const { createRootRoute, createRouter } = await import("@tanstack/react-router");
  return createRouter({ routeTree: createRootRoute(), isServer: true });
}

/** `BootSetNode` w kontekście routera (bez `RouterProvider`, czyli bez dopasowań i powłoki). */
async function renderNode(router: AnyRouter): Promise<string> {
  const { RouterContextProvider } = await import("@tanstack/react-router");
  return renderToStaticMarkup(
    createElement(RouterContextProvider, { router, children: createElement(BootSetNode) }),
  );
}

describe("BootSetNode - węzeł w `<head>`", () => {
  const SET: BootSet = { m: "now", e: "/a.js", u: ["/a.js", "/b</c.js"] };

  it("PARYTET BAJTÓW: na serwerze renderuje dokładnie `bootSetHtml(set)`", async () => {
    const router = await bareRouter();
    setBootSetJson(router, bootSetJson(SET));
    expect(await renderNode(router)).toBe(bootSetHtml(SET));
  });

  it("w przeglądarce, bez zestawu i bez routera - nic", async () => {
    // Gałąź przeglądarki to `isServer ?? router.isServer` równe `false` (w bundlu klienta
    // `isServer` jest stałą `false`; pod vitest `undefined`, więc decyduje pole routera).
    // Routera przeglądarki nie zbudujemy w Node (konstruktor czyta `window`), więc ten sam
    // router serwerowy dostaje flagę przeglądarki.
    const browser = await bareRouter();
    setBootSetJson(browser, bootSetJson(SET));
    browser.isServer = false;
    expect(await renderNode(browser)).toBe("");
    expect(await renderNode(await bareRouter())).toBe("");
    expect(renderToStaticMarkup(createElement(BootSetNode))).toBe("");
  });
});

/** Wywołanie w PRAWDZIWYM zasięgu żądania Start: kanały trybu i `Link` są tu żywe. */
async function inRequestScope(body: (request: Request) => void): Promise<void> {
  const handler = startRequestScope(async (request) => {
    body(request);
    return new Response("ok");
  });
  const response = await handler(new Request("https://tenant-a.eu/"), {});
  expect(response.status).toBe(200);
}

describe("prepareBootSet - warunki", () => {
  it("bez mapy (vitest, dev, build bez wtyczki) i bez `serverSsr` - nic: bez zestawu, trybu i `Link`", async () => {
    const state = { matches: [{ routeId: "/konto", status: "success" }] };
    const noManifest = { serverSsr: {}, state };
    const outsideSsr = { state };
    await inRequestScope((request) => {
      prepareBootSet(noManifest, null);
      prepareBootSet(outsideSsr, MANIFEST);
      expect(getBootSetJson(noManifest)).toBeUndefined();
      expect(getBootSetJson(outsideSsr)).toBeUndefined();
      expect(readBootMode(request)).toBeNull();
      expect(readLinkHeader(request)).toBeNull();
    });
  });

  it("jeden zestaw na router: drugie wywołanie niczego nie składa od nowa", async () => {
    const router = { serverSsr: {}, state: { matches: [{ routeId: "/konto" }] } };
    await inRequestScope((request) => {
      prepareBootSet(router, MANIFEST);
      const first = getBootSetJson(router);
      const link = readLinkHeader(request);
      expect(readBootMode(request)).toBe("now");
      // Hint dołożony PO składzie - powtórny skład by go wciągnął do serii.
      appendLinkHeader(WIDGET_HINT);
      prepareBootSet(router, MANIFEST);
      expect(getBootSetJson(router)).toBe(first);
      expect(JSON.parse(first!).u).not.toContain("/assets/widget-hero-W1w1W1w1.js");
      expect(readLinkHeader(request)).toBe(`${link}, ${WIDGET_HINT}`);
    });
  });

  it("poza zasięgiem żądania (prerender) skład działa i nie rzuca (kanały trybu i `Link` - no-op)", () => {
    const router = { serverSsr: {}, state: { matches: [{ routeId: "/", status: "success" }] } };
    expect(() => prepareBootSet(router, MANIFEST)).not.toThrow();
    expect(JSON.parse(getBootSetJson(router)!)).toMatchObject({ m: "lcp", e: MANIFEST.entry });
  });
});

// ── PRAWDZIWY RENDER ROUTERA PRZEZ src/server.ts ─────────────────────────────

const CHROME_LIGHTHOUSE =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/136.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/136.0.0.0 Safari/537.36";

type RenderHandler = "stream" | "string";

async function routerRender(request: Request, handler: RenderHandler): Promise<Response> {
  const React = await import("react");
  const { HeadContent, Outlet, Scripts, createRootRoute, createRoute, createRouter } =
    await import("@tanstack/react-router");
  const { createRequestHandler, defaultRenderHandler, defaultStreamHandler } =
    await import("@tanstack/react-router/ssr/server");
  const h = React.createElement;

  const rootRoute = createRootRoute({
    // Loader korzenia dokłada hinty jak `__root.tsx`: CSS, widget nagłówka (modulepreload).
    loader: () => {
      appendLinkHeader(CSS_HINT);
      appendLinkHeader(WIDGET_HINT);
      return null;
    },
    // Ta sama kolejność co `RootShell` w `__root.tsx`: węzeł zestawu zaraz po `<HeadContent />`.
    shellComponent: ({ children }: { children: React.ReactNode }) =>
      h(
        "html",
        { lang: "pl" },
        h("head", null, h(HeadContent), h(BootSetNode)),
        h("body", null, children, h(Scripts)),
      ),
    component: () => h(Outlet),
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => {
      appendLinkHeader(IMAGE_HINT);
      return null;
    },
    component: () =>
      h("main", null, h("img", { "data-lcp-candidate": "", src: "/media/hero.avif", alt: "" })),
  });
  const account = createRoute({
    getParentRoute: () => rootRoute,
    path: "/konto",
    component: () => h("main", null, "konto"),
  });
  const routeTree = rootRoute.addChildren([home, account]);
  const createAppRouter = () => {
    const router = createRouter({ routeTree, isServer: true });
    // Ten sam hak co owijka w `src/router.tsx` (tam przez `createIsomorphicFn`).
    router.options.dehydrate = async () => {
      prepareBootSet(router, MANIFEST);
      return undefined;
    };
    return router;
  };
  const response = await createRequestHandler({ createRouter: createAppRouter, request })(
    handler === "stream" ? defaultStreamHandler : defaultRenderHandler,
  );
  // Dyrektywa cache'owa jak z `defaultCacheControlMiddleware` (wprost na odpowiedzi, w łańcuchu).
  response.headers.set(
    "cache-control",
    "public, max-age=60, s-maxage=900, stale-while-revalidate=86400",
  );
  return response;
}

function bootSetsIn(html: string): unknown[] {
  const re = new RegExp(
    `<script type="application/json" id="${BOOT_SET_ELEMENT_ID}">([^<]*)</script>`,
    "g",
  );
  return [...html.matchAll(re)].map((m) => JSON.parse(m[1]));
}

/** Węzeł zestawu stoi w `<head>` (loader bootu w `<head>` musi go zastać przy starcie). */
function expectBootSetInHead(html: string): void {
  const at = html.indexOf(`id="${BOOT_SET_ELEMENT_ID}"`);
  expect(at).toBeGreaterThan(html.indexOf("<head>"));
  expect(at).toBeLessThan(html.indexOf("</head>"));
}

function documentRequest(path: string, userAgent: string): Request {
  return new Request(`https://tenant-a.eu${path}`, {
    headers: {
      "x-forwarded-host": "tenant-a.eu",
      "user-agent": userAgent,
      accept: "text/html",
      "accept-language": "pl",
    },
  });
}

describe("dokument przez potok serwera: render, `Link`, cache", () => {
  beforeEach(async () => {
    const { resetDocumentCacheForTests, handleDocumentRequest } =
      await import("@/lib/http/documentCache.server");
    resetDocumentCacheForTests();
    hoisted.render = async (request) =>
      (await handleDocumentRequest(request, () => routerRender(request, "stream"))) as Response;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const expectedHomeSet: BootSet = {
    m: "lcp",
    e: MANIFEST.entry,
    u: [
      "/assets/index-E1e1E1e1.js",
      "/assets/vendor-react-V1v1V1v1.js",
      DICTIONARY_PL,
      "/assets/index-route-R1r1R1r1.js",
      "/assets/widget-hero-W1w1W1w1.js",
    ],
  };

  it.each([
    ["bot Chrome-Lighthouse (ścieżka allReady)", CHROME_LIGHTHOUSE, "stream"],
    ["przeglądarka (strumień)", BROWSER, "stream"],
    ["renderToString (`defaultRenderHandler`)", BROWSER, "string"],
  ] as const)(
    "%s: jeden `#nes-boot-set` w `<head>`, `Link` bez modulepreload",
    async (_label, userAgent, handler) => {
      if (handler === "string") {
        const { handleDocumentRequest } = await import("@/lib/http/documentCache.server");
        hoisted.render = async (request) =>
          (await handleDocumentRequest(request, () => routerRender(request, "string"))) as Response;
      }
      const { default: serverEntry } = await import("@/server");
      const response = await serverEntry.fetch(documentRequest("/", userAgent));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(bootSetsIn(html)).toEqual([expectedHomeSet]);
      expectBootSetInHead(html);
      // Bez skryptu wejścia i preloadów modułów w znacznikach dokumentu.
      expect(html).not.toMatch(/<link[^>]+rel="modulepreload"/);
      expect(html).not.toMatch(/<script[^>]+type="module"[^>]+src=/);
      const link = response.headers.get("link") ?? "";
      expect(link).not.toMatch(/modulepreload/);
      expect(link).toContain(CSS_HINT);
      expect(link).toContain(IMAGE_HINT);
    },
  );

  it("HIT z NES Edge Cache niesie ten sam węzeł i ten sam `Link` co MISS", async () => {
    const { default: serverEntry } = await import("@/server");
    const miss = await serverEntry.fetch(documentRequest("/", BROWSER));
    const missHtml = await miss.text();
    expect(miss.headers.get("x-nes-cache")).toBe("MISS");
    // Zapis do L1 kończy się po odczycie ciała (tee) - czekamy na wpis.
    const { getDocumentCacheSnapshot } = await import("@/lib/http/documentCache.server");
    await vi.waitFor(() => expect(getDocumentCacheSnapshot().entries).toBe(1));
    const { handleDocumentRequest } = await import("@/lib/http/documentCache.server");
    hoisted.render = async (request) =>
      (await handleDocumentRequest(request, () => {
        throw new Error("HIT nie może renderować");
      })) as Response;
    const hit = await serverEntry.fetch(documentRequest("/", BROWSER));
    const hitHtml = await hit.text();
    expect(hit.headers.get("x-nes-cache")).toBe("HIT");
    expect(bootSetsIn(hitHtml)).toEqual([expectedHomeSet]);
    expect(hitHtml).toBe(missHtml);
    expect(hit.headers.get("link")).toBe(miss.headers.get("link"));
  });

  it("trasa `now`: zestaw w trybie `now` i cała seria jako modulepreload w `Link`", async () => {
    const { default: serverEntry } = await import("@/server");
    const response = await serverEntry.fetch(documentRequest("/konto", BROWSER));
    const html = await response.text();
    const [set] = bootSetsIn(html) as BootSet[];
    expectBootSetInHead(html);
    expect(set.m).toBe("now");
    expect(set.u).toEqual([
      "/assets/index-E1e1E1e1.js",
      "/assets/vendor-react-V1v1V1v1.js",
      DICTIONARY_PL,
      "/assets/konto-K1k1K1k1.js",
      "/assets/widget-hero-W1w1W1w1.js",
    ]);
    const link = response.headers.get("link") ?? "";
    for (const url of set.u) expect(link).toContain(`<${url}>`);
    // Hint widgetu z loadera zostaje w swoim wpisie (bez dubla bez `crossorigin`).
    expect(link.split(", ").filter((entry) => entry.includes("widget-hero"))).toEqual([
      WIDGET_HINT,
    ]);
  });
});
