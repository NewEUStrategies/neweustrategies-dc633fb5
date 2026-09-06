// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RequestHandler } from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import { requestHandler } from "@tanstack/react-start/server";
import { fetchWithFrameworkPreloads } from "../frameworkPreloads.server";
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
