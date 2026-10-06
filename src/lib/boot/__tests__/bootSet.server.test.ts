// @vitest-environment node
//
// ZESTAW BOOTU PER ŻĄDANIE (P2.1) - skład, tryb, wstrzyknięcie i droga przez cały potok dokumentu.
//
// Dwie warstwy dowodu:
//   1. czyste funkcje (`composeBootSet`, `bootModeFor`, `bootSetHtml`) - kolejność serii,
//      deduplikacja, filtr URL-i, reguła trybu;
//   2. PRAWDZIWY render routera TanStack (`createRequestHandler` + `defaultStreamHandler`, ta sama
//      para, którą składa `createStartHandler`) w zasięgu żądania h3, przez PRAWDZIWE `src/server.ts`
//      (atrapą jest wyłącznie wirtualny moduł `server-entry`, którego build nie generuje w teście -
//      wzorzec `src/__tests__/serverEntryRequestOptions.test.ts`). Dowodzi tego, czego wymaga bramka
//      planu: `#nes-boot-set` jest DOKŁADNIE RAZ w dokumencie ze ścieżki `allReady` (UA bota
//      `Chrome-Lighthouse`, czyli PSI na MISS) i strumieniowej (UA przeglądarki), ten sam węzeł jest
//      w ciele odtworzonym z NES Edge Cache (HIT), `<` jest escapowane, a nagłówek `Link`
//      dokumentu po LCP nie niesie żadnego `modulepreload`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AFTER_LCP_ROUTE_IDS,
  BOOT_SET_ELEMENT_ID,
  bootModeFor,
  bootSetHtml,
  composeBootSet,
  injectBootSet,
  type BootSet,
} from "../bootSet.server";
import type { BootManifest } from "../bootManifest";

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

vi.mock("@tanstack/react-start/server-entry", async () => {
  const { requestHandler } = await import("@tanstack/react-start/server");
  const boundary = requestHandler(async (request: Request) => {
    if (!hoisted.render) throw new Error("test nie ustawił renderu");
    return await hoisted.render(request);
  });
  return {
    default: {
      fetch: (request: Request, opts?: unknown) =>
        boundary(request, opts as Parameters<typeof boundary>[1]),
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

describe("bootSetHtml - węzeł danych", () => {
  it("`<` jako `\\u003c`: treść nie domknie `</script>`, a JSON.parse odtwarza wartość", () => {
    const set: BootSet = { m: "lcp", e: "/a.js", u: ["/a.js", "/x</script><script>.js"] };
    const html = bootSetHtml(set);
    expect(html.startsWith(`<script type="application/json" id="${BOOT_SET_ELEMENT_ID}">`)).toBe(
      true,
    );
    const body = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(body).not.toContain("<");
    expect(JSON.parse(body)).toEqual(set);
  });
});

describe("injectBootSet - warunki", () => {
  it("bez mapy (vitest, dev, build bez wtyczki) i bez `serverSsr` - nic", () => {
    const injectHtml = vi.fn();
    const state = { matches: [{ routeId: "/", status: "success" }] };
    injectBootSet({ serverSsr: { injectHtml }, state }, null);
    injectBootSet({ state }, MANIFEST);
    expect(injectHtml).not.toHaveBeenCalled();
  });

  it("jeden węzeł na dokument, także przy powtórnym wywołaniu", () => {
    const injectHtml = vi.fn();
    const router = { serverSsr: { injectHtml }, state: { matches: [{ routeId: "/konto" }] } };
    injectBootSet(router, MANIFEST);
    injectBootSet(router, MANIFEST);
    expect(injectHtml).toHaveBeenCalledTimes(1);
  });
});

// ── PRAWDZIWY RENDER ROUTERA PRZEZ src/server.ts ─────────────────────────────

const CHROME_LIGHTHOUSE =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/136.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
const BROWSER =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/136.0.0.0 Safari/537.36";

async function routerRender(request: Request): Promise<Response> {
  const React = await import("react");
  const { HeadContent, Outlet, Scripts, createRootRoute, createRoute, createRouter } =
    await import("@tanstack/react-router");
  const { createRequestHandler, defaultStreamHandler } =
    await import("@tanstack/react-router/ssr/server");
  const { appendLinkHeader } = await import("@/lib/http/responseHeaders");
  const h = React.createElement;

  const rootRoute = createRootRoute({
    // Loader korzenia dokłada hinty jak `__root.tsx`: CSS, widget nagłówka (modulepreload).
    loader: () => {
      appendLinkHeader(CSS_HINT);
      appendLinkHeader(WIDGET_HINT);
      return null;
    },
    shellComponent: ({ children }: { children: React.ReactNode }) =>
      h(
        "html",
        { lang: "pl" },
        h("head", null, h(HeadContent)),
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
      injectBootSet(router, MANIFEST);
      return undefined;
    };
    return router;
  };
  const response = await createRequestHandler({ createRouter: createAppRouter, request })(
    defaultStreamHandler,
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
      (await handleDocumentRequest(request, () => routerRender(request))) as Response;
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
    ["bot Chrome-Lighthouse (ścieżka allReady)", CHROME_LIGHTHOUSE],
    ["przeglądarka (strumień)", BROWSER],
  ])("%s: jeden `#nes-boot-set`, `Link` bez modulepreload", async (_label, userAgent) => {
    const { default: serverEntry } = await import("@/server");
    const response = await serverEntry.fetch(documentRequest("/", userAgent));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(bootSetsIn(html)).toEqual([expectedHomeSet]);
    // Bez skryptu wejścia i preloadów modułów w znacznikach dokumentu.
    expect(html).not.toMatch(/<link[^>]+rel="modulepreload"/);
    expect(html).not.toMatch(/<script[^>]+type="module"[^>]+src=/);
    const link = response.headers.get("link") ?? "";
    expect(link).not.toMatch(/modulepreload/);
    expect(link).toContain(CSS_HINT);
    expect(link).toContain(IMAGE_HINT);
    // Znacznik trybu jest wewnętrzny - nie wychodzi do klienta.
    expect(response.headers.get("x-nes-boot-mode")).toBeNull();
  });

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
    expect(response.headers.get("x-nes-boot-mode")).toBeNull();
  });
});
