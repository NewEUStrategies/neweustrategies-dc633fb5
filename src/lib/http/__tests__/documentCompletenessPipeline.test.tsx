// @vitest-environment node
//
// SMOKE W PROCESIE (fala 3, P3.6b): werdykt zapisu NA KOŃCU STRUMIENIA na
// prawdziwych elementach potoku, bez sieci i bez builda:
//   * `requestHandler` z @tanstack/react-start/server - realny zasięg żądania
//     (AsyncLocalStorage, `getRequest()`), w którym loader ustawia dyrektywę
//     i rejestruje predykat;
//   * prawdziwe `handleDocumentRequest` + `applyDeferredDocumentStore` (ten sam
//     duet, który składa `src/server.ts`);
//   * prawdziwy render strumieniowy Reacta z PRAWDZIWĄ bramką sekcji
//     (`ServerSectionGate`, budżet 2 s) - atrapą są wyłącznie opcje zapytań
//     widgetu (`@/lib/builder/prefetch`), czyli „backend z opóźnieniem";
//   * zamiatanie przed renderem (`sweepQueryCacheForSerialization`) i
//     sprzątanie integracji router<->query PO zamknięciu strumienia
//     (`cancelQueries()` + `clear()`), w tej samej kolejności co
//     `transformStreamWithRouter` -> `serverSsr.cleanup()`.
//
// Dowodzi trzech zdań z planu:
//   1. dokument, którego sekcje dostrumieniowały się PO terminie loadera (B2),
//      zostaje zapisany - drugie żądanie to HIT, z krótką świeżością;
//   2. dokument „typu A" (zasiew strony głównej) nie zostaje zapisany;
//   3. dokument z sekcją, której minął budżet bramki, nie zostaje zapisany,
//      choć jego nagłówek w chwili loadera pozwalał na zapis.
import { PassThrough, Readable } from "node:stream";
import { Suspense } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { requestHandler } from "@tanstack/react-start/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SectionNode } from "@/lib/builder/types";

const backend = vi.hoisted(() => ({
  /** Opóźnienie odpowiedzi „backendu" widgetu w ms; `null` = nigdy nie odpowiada. */
  delayMs: 0 as number | null,
  fetches: 0,
}));

const WIDGET_KEY: QueryKey = ["builder-post-list", { section: "hero" }];

function widgetOptions() {
  return {
    queryKey: WIDGET_KEY,
    queryFn: () => {
      backend.fetches += 1;
      const delay = backend.delayMs;
      return new Promise<string[]>((resolve) => {
        if (delay !== null) setTimeout(() => resolve(["Wpis z bazy"]), delay);
      });
    },
  };
}

vi.mock("@/lib/builder/prefetch", () => ({
  sectionQueryOptionsList: () => [widgetOptions()],
  pendingSectionQueries: (qc: QueryClient) => {
    const status = qc.getQueryState(WIDGET_KEY)?.status;
    return status === "success" || status === "error" ? [] : [widgetOptions()];
  },
  prefetchBuilderSectionQuery: (qc: QueryClient, options: ReturnType<typeof widgetOptions>) =>
    qc.prefetchQuery(options),
}));

vi.mock("@/lib/builder/accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/builder/accessControl")>()),
  useAccessContext: () => ({ isAuthenticated: false, roles: [] }),
}));

const { ServerSectionGate } = await import("@/lib/builder/sectionStreaming");
const { useQuery } = await import("@tanstack/react-query");
const {
  applyDeferredDocumentStore,
  getDocumentCacheSnapshot,
  handleDocumentRequest,
  probeDocumentCache,
  resetDocumentCacheForTests,
} = await import("../documentCache.server");
const { planDefaultCacheControl } = await import("../defaultCacheControl");
const { readRouteCacheDirective, registerDocumentCompletenessCheck, setCacheControlHeader } =
  await import("../responseHeaders");
const { chromeDegradedCacheControl } = await import("../cachePolicy");
const { resilientCacheControl, trackSsrQueryCompleteness } =
  await import("@/lib/ssr/resilientLoad");
const { sweepQueryCacheForSerialization } = await import("@/lib/ssr/postRenderSweep");

const HOST = "tenant-a.eu";
const SECTION = {
  id: "hero",
  kind: "section",
  children: [
    {
      id: "c1",
      kind: "column",
      span: { desktop: 12 },
      children: [{ id: "w1", kind: "widget", type: "post-list", content: {} }],
    },
  ],
} as unknown as SectionNode;

function HeroWidget() {
  const { data } = useQuery({ ...widgetOptions(), enabled: false });
  return <section data-hero>{data?.join(", ") ?? "pusta sekcja"}</section>;
}

function Document({ qc }: { qc: QueryClient }) {
  return (
    <html>
      <body>
        <QueryClientProvider client={qc}>
          <main>powłoka</main>
          <Suspense fallback={<div data-skeleton>szkielet</div>}>
            <ServerSectionGate section={SECTION} lang="pl">
              <HeroWidget />
            </ServerSectionGate>
          </Suspense>
        </QueryClientProvider>
      </body>
    </html>
  );
}

/**
 * Render strumieniowy jak router: body wychodzi po gotowej powłoce, a PO jego
 * zamknięciu biegnie sprzątanie integracji (`cancelQueries()` + `clear()`) -
 * zanim kolektor zapisu przeczyta koniec strumienia.
 */
function renderDocument(qc: QueryClient): Promise<ReadableStream<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const sink = new PassThrough();
    const web = Readable.toWeb(sink) as ReadableStream<Uint8Array>;
    const reader = web.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          void qc.cancelQueries();
          qc.clear();
          return;
        }
        controller.enqueue(value);
      },
    });
    const stream = renderToPipeableStream(<Document qc={qc} />, {
      onShellReady() {
        stream.pipe(sink);
        resolve(body);
      },
      onShellError: reject,
    });
  });
}

/** Odwzorowanie `defaultCacheControlMiddleware` (najgłębsze middleware). */
function defaultCacheControlLayer(request: Request, response: Response): Response {
  const plan = planDefaultCacheControl(request, response, readRouteCacheDirective());
  if (!plan) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", plan);
  return new Response(response.body, { status: response.status, headers });
}

type Loader = (qc: QueryClient) => void;

/** Jedno żądanie `/` przez potok: loader -> zamiatanie -> render -> zapis odroczony. */
async function visit(loader: Loader): Promise<{ response: Response; html: string }> {
  const handler = requestHandler(async (request: Request) => {
    const routed = await handleDocumentRequest(request, async () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      });
      loader(qc);
      sweepQueryCacheForSerialization(qc, { quiet: true });
      const body = await renderDocument(qc);
      const rendered = new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      return defaultCacheControlLayer(request, rendered);
    });
    return routed as Response;
  });
  const response = applyDeferredDocumentStore(
    await handler(new Request(`https://${HOST}/`, { headers: { "x-forwarded-host": HOST } }), {}),
  );
  const html = await response.text();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { response, html };
}

/** Loader strony głównej po P3.6b, sprowadzony do decyzji o cache'u. */
function homeLoader(header: string): Loader {
  return (qc) => {
    setCacheControlHeader(header);
    registerDocumentCompletenessCheck(trackSsrQueryCompleteness(qc));
  };
}

beforeEach(() => {
  resetDocumentCacheForTests();
  backend.delayMs = 0;
  backend.fetches = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetDocumentCacheForTests();
  vi.restoreAllMocks();
});

describe("werdykt zapisu na końcu strumienia (P3.6b)", () => {
  it("B2: sekcja dostrumieniowana po terminie loadera - dokument ZAPISANY, drugie żądanie to HIT", async () => {
    backend.delayMs = 40;
    // Dane nad zgięciem spóźnione względem loadera: krótka polityka wspólna.
    const first = await visit(homeLoader(chromeDegradedCacheControl()));
    expect(first.response.headers.get("x-nes-cache")).toBe("MISS");
    expect(first.html).toContain("Wpis z bazy");
    expect(getDocumentCacheSnapshot().entries).toBe(1);

    const second = await visit(() => {
      throw new Error("HIT nie renderuje");
    });
    expect(second.response.headers.get("x-nes-cache")).toBe("HIT");
    expect(second.html).toContain("Wpis z bazy");
    // Świeżość z dyrektywy: 30 s, nie 3 min - render czysty zastąpi go przy STALE.
    const probe = await probeDocumentCache("/", HOST);
    expect(probe.freshForS).toBeLessThanOrEqual(30);
  });

  it("czysty render: zapis z pełną świeżością", async () => {
    backend.delayMs = 0;
    await visit(homeLoader(resilientCacheControl(false)));
    const probe = await probeDocumentCache("/", HOST);
    expect(probe.status).toBe("HIT");
    expect(probe.freshForS).toBeGreaterThan(30);
  });

  it("typ A (zasiew strony głównej) - dokument NIE zostaje zapisany", async () => {
    const typeA: Loader = (qc) => {
      qc.setQueryData(["public", "home-page"], null, { updatedAt: 0 });
      setCacheControlHeader(resilientCacheControl(true));
      registerDocumentCompletenessCheck(trackSsrQueryCompleteness(qc));
    };
    const first = await visit(typeA);
    expect(first.response.headers.get("cache-control")).toBe("private, no-store");
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    const second = await visit(typeA);
    expect(second.response.headers.get("x-nes-cache")).toBe("MISS");
  });

  it("typ A z nagłówkiem, który by przepuścił - predykat i tak blokuje zapis", async () => {
    // Obrona w głąb: nawet gdyby loader zapomniał o `no-store`, zasiew wychodzi
    // na końcu strumienia.
    await visit((qc) => {
      qc.setQueryData(["public", "home-page"], null, { updatedAt: 0 });
      setCacheControlHeader(resilientCacheControl(false));
      registerDocumentCompletenessCheck(trackSsrQueryCompleteness(qc));
    });
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    expect(getDocumentCacheSnapshot().recent[0]).toMatchObject({
      status: "MISS",
      degradedAt: "stream",
    });
  });

  it("sekcja, której minął budżet bramki - dokument NIE zostaje zapisany", async () => {
    backend.delayMs = null;
    const first = await visit(homeLoader(chromeDegradedCacheControl()));
    expect(first.html).toContain("pusta sekcja");
    expect(getDocumentCacheSnapshot().entries).toBe(0);
    expect(getDocumentCacheSnapshot().recent[0]).toMatchObject({ degradedAt: "stream" });
    backend.delayMs = 0;
    const second = await visit(homeLoader(resilientCacheControl(false)));
    expect(second.response.headers.get("x-nes-cache")).toBe("MISS");
  }, 10_000);
});
