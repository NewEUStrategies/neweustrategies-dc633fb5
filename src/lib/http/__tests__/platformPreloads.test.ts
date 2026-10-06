// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RequestHandler } from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import { requestHandler } from "@tanstack/react-start/server";
import { setResponseHeader } from "@tanstack/react-start/server";
import {
  BOOT_MODE_HEADER,
  fetchWithFrameworkPreloads,
  linkHeaderEntries,
  modulePreloadTargets,
  parseBootMode,
  withoutModulePreloads,
} from "../frameworkPreloads.server";
import { appendLinkHeader } from "../responseHeaders";

const req = () => new Request("https://example.org/blog");
const script = "</assets/entry-12345678.js>; rel=modulepreload";
const font = "</assets/font.woff2>; rel=preload; as=font; crossorigin";
const hint = { href: "/assets/entry-12345678.js", rel: "modulepreload" as const };

function handler(response: () => Response, emit = true): RequestHandler<Register> {
  const boundary = requestHandler(async () => {
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

describe("manifest preloads after the real h3 boundary", () => {
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

// DOKUMENT Z ZESTAWEM BOOTU (P2.1). Render oznacza tryb wewnętrznym nagłówkiem zdarzenia h3
// (`lib/boot/bootSet.server.ts`); tu znacznik znika, a `Link` dokumentu po LCP traci każdy
// `modulepreload` - także te dołożone przez loadery (słownik, widgety), bo ich moduły są już
// w `#nes-boot-set`, a JS nie może ruszyć przed wpisem LCP.
const dictionary = '</assets/pl-12345678.js>; rel="modulepreload"';
const widget = '</assets/widget-hero-1.js>; rel="modulepreload"; crossorigin';
const image = '</media/hero.avif>; rel="preload"; as="image"; fetchpriority="high"';

function bootHandler(mode: string | null, hints: readonly string[]): RequestHandler<Register> {
  return requestHandler(async () => {
    for (const value of hints) appendLinkHeader(value);
    if (mode !== null) setResponseHeader(BOOT_MODE_HEADER, mode);
    return new Response("<html>dokument</html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}

describe("dokument z zestawem bootu: `Link` według trybu", () => {
  it("`lcp`: z `Link` znika każdy modulepreload, zostają CSS, fonty i obraz; znacznik zdjęty", async () => {
    const res = await fetchWithFrameworkPreloads(
      bootHandler("lcp", [font, dictionary, widget, image]),
      req(),
    );
    expect(res.headers.get("link")).toBe(`${font}, ${image}`);
    expect(res.headers.get(BOOT_MODE_HEADER)).toBeNull();
    expect(await res.text()).toContain("dokument");
  });

  it("`lcp` bez innych wpisów: nagłówek `Link` znika w całości", async () => {
    const res = await fetchWithFrameworkPreloads(bootHandler("lcp", [dictionary]), req());
    expect(res.headers.has("link")).toBe(false);
  });

  it("`now`: `Link` bez zmian (render dopisał w nim serię bootu), znacznik zdjęty", async () => {
    const res = await fetchWithFrameworkPreloads(bootHandler("now", [font, dictionary]), req());
    expect(res.headers.get("link")).toBe(`${font}, ${dictionary}`);
    expect(res.headers.get(BOOT_MODE_HEADER)).toBeNull();
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
    const original = new Response("ok", {
      headers: { "content-type": "text/html", [BOOT_MODE_HEADER]: "lcp", link: dictionary },
    });
    const res = await fetchWithFrameworkPreloads(async () => original, req());
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

  it("tryb z nagłówka: tylko `lcp` i `now`", () => {
    expect(parseBootMode("lcp")).toBe("lcp");
    expect(parseBootMode("now")).toBe("now");
    expect(parseBootMode("LCP")).toBeNull();
    expect(parseBootMode(null)).toBeNull();
  });
});
