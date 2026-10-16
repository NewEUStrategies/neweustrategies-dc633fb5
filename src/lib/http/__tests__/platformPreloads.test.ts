// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RequestHandler } from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import {
  fetchWithFrameworkPreloads,
  linkHeaderEntries,
  modulePreloadTargets,
  recordBootMode,
  withoutModulePreloads,
  type BootMode,
} from "../frameworkPreloads.server";
import { appendLinkHeader, setCacheControlHeader } from "../responseHeaders";
import { startRequestScope } from "@/test/startRequestScope";

const req = () => new Request("https://example.org/blog");
const script = "</assets/entry-12345678.js>; rel=modulepreload";
const font = "</assets/font.woff2>; rel=preload; as=font; crossorigin";
const hint = { href: "/assets/entry-12345678.js", rel: "modulepreload" as const };

function handler(response: () => Response, emit = true): RequestHandler<Register> {
  const boundary = startRequestScope(async () => {
    appendLinkHeader(font);
    return response();
  });
  return async (request, options) => {
    if (emit) {
      for (const phase of ["static", "dynamic"] as const) {
        await options?.onEarlyHints?.({
          phase,
          hints: [hint, { href: "/unused.png", rel: "preload", as: "image" }],
          links: [script, "</unused.png>; rel=preload; as=image"],
          allHints: [hint],
          allLinks: [script],
        });
      }
    }
    return boundary(request, options);
  };
}

describe("manifest preloads after the real Start request scope", () => {
  it("combines manifest and loader hints, once, without teeing the body", async () => {
    const original = new Response("<html>content</html>", {
      headers: { "content-type": "text/html" },
    });
    const res = await fetchWithFrameworkPreloads(
      handler(() => original),
      req(),
    );
    expect(res.headers.get("link")).toBe(`${font}, ${script}`);
    expect(res.body).toBe(original.body);
    expect(await res.text()).toContain("content");
  });
  it.each([302, 404, 500])(
    "does not append successful-route scripts to HTTP %s",
    async (status) => {
      const res = await fetchWithFrameworkPreloads(
        handler(() => new Response(null, { status, headers: { "content-type": "text/html" } })),
        req(),
      );
      expect(res.headers.get("link") ?? "").not.toContain(script);
    },
  );
  it.each(["application/json", ""])("leaves %s responses alone", async (type) => {
    const res = await fetchWithFrameworkPreloads(
      handler(() => new Response(null, { headers: type ? { "content-type": type } : {} })),
      req(),
    );
    expect(res.headers.get("link") ?? "").not.toContain(script);
  });
  it("does nothing when the framework is in dev mode and emits no hints", async () => {
    const res = await fetchWithFrameworkPreloads(
      handler(() => new Response("ok", { headers: { "content-type": "text/html" } }), false),
      req(),
    );
    expect(res.headers.get("link")).toBe(font);
  });
  it("deduplicates a hint already present on the final Response", async () => {
    const original = new Response("ok", { headers: { "content-type": "text/html", link: script } });
    const fetch: RequestHandler<Register> = async (_req, opts) => {
      await opts?.onEarlyHints?.({
        phase: "static",
        hints: [hint],
        links: [script],
        allHints: [hint],
        allLinks: [script],
      });
      return original;
    };
    expect(await fetchWithFrameworkPreloads(fetch, req())).toBe(original);
  });
  it("leaves a response without route headers untouched (same object, no rebuild)", async () => {
    const original = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(await fetchWithFrameworkPreloads(async () => original, req())).toBe(original);
  });
  it("handles a response with no loader Link header", async () => {
    const fetch: RequestHandler<Register> = async (_req, opts) => {
      await opts?.onEarlyHints?.({
        phase: "static",
        hints: [hint],
        links: [script],
        allHints: [hint],
        allLinks: [script],
      });
      return new Response("ok", { headers: { "content-type": "text/html" } });
    };
    expect((await fetchWithFrameworkPreloads(fetch, req())).headers.get("link")).toBe(script);
  });
});

// NAGŁÓWKI TRASY NA GRANICY ODPOWIEDZI. `Cache-Control` i `Link` loaderów żyją w kanałach
// per `Request`, nie w stanie pomocników Start (ten od 1.169 uzgadnia się dla każdego
// statusu). Granica nakłada je z regułą h3: tylko odpowiedź `ok`, z nadpisaniem jej własnego
// nagłówka - 503 crawlera i strona 500 zachowują `no-store`.
function routeHandler(status: number, own: Record<string, string>): RequestHandler<Register> {
  return startRequestScope(async () => {
    setCacheControlHeader("public, max-age=60, s-maxage=900");
    appendLinkHeader(font);
    return new Response(status === 302 ? null : "<html>dokument</html>", {
      status,
      headers: { "content-type": "text/html; charset=utf-8", ...own },
    });
  });
}

describe("nagłówki trasy na granicy odpowiedzi", () => {
  it("odpowiedź `ok`: dyrektywa i `Link` loadera nadpisują jej własne nagłówki", async () => {
    const res = await fetchWithFrameworkPreloads(
      routeHandler(200, { "cache-control": "no-cache", link: "</own.css>; rel=preload" }),
      req(),
    );
    expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=900");
    expect(res.headers.get("link")).toBe(font);
    expect(await res.text()).toContain("dokument");
  });

  it.each([302, 404, 500, 503])(
    "HTTP %s zachowuje własne nagłówki - bez dyrektywy i hintów loadera",
    async (status) => {
      const own = { "cache-control": "no-store", ...(status === 302 ? { location: "/x" } : {}) };
      const res = await fetchWithFrameworkPreloads(routeHandler(status, own), req());
      expect(res.status).toBe(status);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("link")).toBeNull();
    },
  );

  it("odpowiedź `ok` spoza HTML (GET server fn) też dostaje dyrektywę trasy, bez preloadów manifestu", async () => {
    // Jak w h3: nagłówki trasy idą na KAŻDĄ odpowiedź `ok`. Na tym stoi
    // `memberSlug.functions.ts`, który zawęża własną odpowiedź do `no-store`.
    const rpc = startRequestScope(async () => {
      setCacheControlHeader("private, no-store");
      return new Response("true", { headers: { "content-type": "application/json" } });
    });
    const res = await fetchWithFrameworkPreloads(async (request, options) => {
      await options?.onEarlyHints?.({
        phase: "static",
        hints: [hint],
        links: [script],
        allHints: [hint],
        allLinks: [script],
      });
      return rpc(request, options);
    }, req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("link")).toBeNull();
  });

  it("wartość `Link` spoza ByteString odpada przy dołożeniu, nie zatruwa pozostałych hintów", async () => {
    const poster = '</media/poster.avif>; rel="preload"; as="image"';
    const res = await fetchWithFrameworkPreloads(
      startRequestScope(async () => {
        appendLinkHeader(font);
        appendLinkHeader("</zażółć.css>; rel=preload; as=style");
        appendLinkHeader(poster);
        return new Response("<html>dokument</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }),
      req(),
    );
    expect(res.headers.get("link")).toBe(`${font}, ${poster}`);
  });

  it("kanały są per `Request`: inne żądanie nie dostaje cudzych nagłówków", async () => {
    const scoped = req();
    const res = await fetchWithFrameworkPreloads(routeHandler(200, {}), scoped);
    expect(res.headers.get("cache-control")).toContain("s-maxage=900");
    const plain = new Response("ok", { headers: { "content-type": "text/html" } });
    const other = await fetchWithFrameworkPreloads(async () => plain, req());
    expect(other).toBe(plain);
  });
});

// DOKUMENT Z ZESTAWEM BOOTU (P2.1). Render zapisuje tryb w kanale per `Request`
// (`recordBootMode` z `lib/boot/bootSet.server.ts`), a `Link` dokumentu po LCP traci każdy
// `modulepreload` - także te dołożone przez loadery (słownik, widgety), bo ich moduły są już
// w `#nes-boot-set`, a JS nie może ruszyć przed wpisem LCP.
const dictionary = '</assets/pl-12345678.js>; rel="modulepreload"';
const widget = '</assets/widget-hero-1.js>; rel="modulepreload"; crossorigin';
const image = '</media/hero.avif>; rel="preload"; as="image"; fetchpriority="high"';

function bootHandler(
  mode: BootMode | null,
  hints: readonly string[],
  status = 200,
): RequestHandler<Register> {
  return startRequestScope(async () => {
    for (const value of hints) appendLinkHeader(value);
    if (mode !== null) recordBootMode(mode);
    return new Response("<html>dokument</html>", {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}

describe("dokument z zestawem bootu: `Link` według trybu", () => {
  it("`lcp`: z `Link` znika każdy modulepreload, zostają CSS, fonty i obraz", async () => {
    const res = await fetchWithFrameworkPreloads(
      bootHandler("lcp", [font, dictionary, widget, image]),
      req(),
    );
    expect(res.headers.get("link")).toBe(`${font}, ${image}`);
    expect(await res.text()).toContain("dokument");
  });

  it("`lcp` bez innych wpisów: nagłówek `Link` znika w całości", async () => {
    const res = await fetchWithFrameworkPreloads(bootHandler("lcp", [dictionary]), req());
    expect(res.headers.has("link")).toBe(false);
  });

  it("`now`: `Link` bez zmian (render dopisał w nim serię bootu)", async () => {
    const res = await fetchWithFrameworkPreloads(bootHandler("now", [font, dictionary]), req());
    expect(res.headers.get("link")).toBe(`${font}, ${dictionary}`);
  });

  it("tryb nie rusza odpowiedzi innej niż `ok` (404/500 wychodzą bez nagłówków trasy)", async () => {
    const res = await fetchWithFrameworkPreloads(bootHandler("now", [dictionary], 404), req());
    expect(res.status).toBe(404);
    expect(res.headers.get("link")).toBeNull();
  });

  it("dokument z zestawem nie dostaje preloadów manifestu z `onEarlyHints`", async () => {
    const inner = bootHandler("lcp", [font]);
    const fetch: RequestHandler<Register> = async (request, options) => {
      await options?.onEarlyHints?.({
        phase: "static",
        hints: [hint],
        links: [script],
        allHints: [hint],
        allLinks: [script],
      });
      return inner(request, options);
    };
    const res = await fetchWithFrameworkPreloads(fetch, req());
    expect(res.headers.get("link")).toBe(font);
  });

  it("body zostaje tym samym strumieniem (odroczony zapis cache jest kluczowany tożsamością)", async () => {
    const request = req();
    recordBootMode("lcp", request);
    const original = new Response("ok", {
      headers: { "content-type": "text/html", link: dictionary },
    });
    const res = await fetchWithFrameworkPreloads(async () => original, request);
    expect(res.headers.has("link")).toBe(false);
    expect(res.body).toBe(original.body);
  });
});

describe("parser nagłówka `Link`", () => {
  it("dzieli wpisy po przecinkach poza `<...>` i cudzysłowami", () => {
    const value = `</a,b.js>; rel="modulepreload", </c.css>; rel=preload; title="x, y", </d.js>; rel=modulepreload`;
    expect(linkHeaderEntries(value)).toEqual([
      '</a,b.js>; rel="modulepreload"',
      '</c.css>; rel=preload; title="x, y"',
      "</d.js>; rel=modulepreload",
    ]);
    expect(modulePreloadTargets(value)).toEqual(["/a,b.js", "/d.js"]);
    expect(withoutModulePreloads(value)).toBe('</c.css>; rel=preload; title="x, y"');
  });

  it("rozpoznaje `modulepreload` w liście relacji i bez cudzysłowów; puste wejście", () => {
    expect(modulePreloadTargets('</x.js>; rel="preload modulepreload"')).toEqual(["/x.js"]);
    expect(modulePreloadTargets("</x.js>; rel=MODULEPRELOAD")).toEqual(["/x.js"]);
    expect(modulePreloadTargets('</x.css>; rel="preload"; as="style"')).toEqual([]);
    expect(modulePreloadTargets(null)).toEqual([]);
    expect(withoutModulePreloads("")).toBeNull();
  });
});
