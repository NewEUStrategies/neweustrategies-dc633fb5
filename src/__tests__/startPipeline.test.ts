// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestHandler } from "@tanstack/react-start/server";
import { startInstance, applySecurityHeaders } from "../start";
import { setCacheControlHeader } from "../lib/http/responseHeaders";
import { getMiddlewareResponse } from "../lib/http/middlewareResult";

const h = vi.hoisted(() => ({ redirect: vi.fn(), log404: vi.fn(), background: vi.fn() }));
vi.mock("@/lib/seo/redirects.server", () => ({
  resolveRedirectForRequest: h.redirect,
  maybeLog404: h.log404,
}));
vi.mock("@/lib/http/waitUntil.server", () => ({ runAfterResponse: h.background }));

type Input = { request: Request; next: () => Promise<unknown>; handlerType: "router" | "serverFn" };
type ServerMiddleware = { options: { server: (input: Input) => unknown } };
const options = await startInstance.getOptions();
const middleware = options.requestMiddleware as unknown as ServerMiddleware[];
const HTML = { "content-type": "text/html; charset=utf-8" };
const document = () => new Response("<html>treść</html>", { headers: HTML });
const request = (path = "/blog", headers: HeadersInit = {}, method = "GET") =>
  new Request(`https://example.org${path}`, { headers, method });
async function run(
  index: number,
  req: Request,
  next: () => Promise<unknown> = async () => document(),
) {
  return middleware[index].options.server({ request: req, next, handlerType: "router" });
}
const response = (result: unknown): Response => {
  const res = getMiddlewareResponse(result);
  if (!res) throw new Error("Expected a Response");
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.redirect.mockResolvedValue(null);
  h.log404.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("registered request middleware", () => {
  it("retains auth attacher and the registered request chain", () => {
    expect(options.functionMiddleware).toHaveLength(1);
    expect(middleware).toHaveLength(11);
  });
  it.each([new Response(null, { status: 401 }), { statusCode: 404 }, { status: 403 }])(
    "preserves intentional HTTP short circuits: %s",
    async (error) => {
      await expect(
        run(0, request(), async () => {
          throw error;
        }),
      ).rejects.toBe(error);
    },
  );
  it.each([new Error("private stack"), null, "failure", { status: "broken" }])(
    "normalizes unexpected errors without leaking details",
    async (error) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response(
        await run(0, request(), async () => {
          throw error;
        }),
      );
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).not.toContain("private stack");
    },
  );
  it("passes a successful result and preserves middleware envelopes", async () => {
    const envelope = { response: document(), serverSsrCleanup: "stream", dispose: vi.fn() };
    expect(await run(0, request(), async () => envelope)).toBe(envelope);
    const secured = (await run(1, request(), async () => envelope)) as typeof envelope;
    expect(secured.dispose).toBe(envelope.dispose);
    expect(secured.response.body).toBe(envelope.response.body);
    expect(secured.response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it.each([1, 3, 6, 10])("passes a non-response result through middleware %s", async (index) => {
    const token = { handled: true };
    const req = request("/", { accept: "text/html", "accept-language": "pl" });
    expect(await run(index, req, async () => token)).toBe(token);
  });
  it("does not wait for 404 telemetry", async () => {
    h.log404.mockReturnValue(new Promise(() => {}));
    const res = document();
    expect(await run(3, request(), async () => res)).toBe(res);
    expect(h.background).toHaveBeenCalledWith(expect.any(Promise));
  });
  it("consumes failed telemetry without an unhandled rejection", async () => {
    h.log404.mockRejectedValue(new Error("offline"));
    await run(3, request());
    await expect(h.background.mock.calls[0][0]).resolves.toBeUndefined();
  });
  it.each(["/platform/email/send", "/lovable/email/send", "/email/unsubscribe"])(
    "internal route %s bypasses SEO and language redirects",
    async (path) => {
      for (const index of [4, 5]) {
        const next = vi.fn(async () => document());
        await run(index, request(path + "?lang=en"), next);
        expect(next).toHaveBeenCalledOnce();
      }
      expect(h.redirect).not.toHaveBeenCalled();
    },
  );
  it.each([301, 302, 307, 308, 410])("applies a configured %s redirect", async (status) => {
    h.redirect.mockResolvedValue({ status, target: "/destination" });
    const next = vi.fn();
    const res = response(await run(4, request(), next));
    expect(res.status).toBe(status);
    expect(next).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe(status === 410 ? null : "/destination");
  });
  it("continues rendering when the redirect database is unavailable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.redirect.mockRejectedValue(new Error("offline"));
    expect(response(await run(4, request())).status).toBe(200);
  });
  it.each(["/admin?lang=en", "/admin/posts?lang=en", "/blog?lang=de", "/blog"])(
    "preserves app/unsupported query state: %s",
    async (path) => {
      const next = vi.fn(async () => document());
      await run(5, request(path), next);
      expect(next).toHaveBeenCalledOnce();
    },
  );
  it.each([
    ["/blog?lang=en&page=2", "/en/blog?page=2"],
    ["/en/blog?lang=pl", "/blog"],
  ])("canonicalizes %s without losing search", async (path, location) => {
    const res = response(await run(5, request(path)));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(location);
  });
  it.each(["https", "http"])(
    "stores language for a non-localizable app path (%s)",
    async (proto) => {
      const res = response(
        await run(5, request("/profile?lang=en&tab=about", { "x-forwarded-proto": proto })),
      );
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/profile?tab=about");
      expect(res.headers.get("set-cookie")).toContain("=en;");
      expect(res.headers.get("set-cookie")!.includes("Secure")).toBe(proto === "https");
    },
  );
  it.each([
    ["/blog", "GET", "text/html"],
    ["/", "POST", "text/html"],
    ["/", "GET", "application/json"],
  ])("skips homepage negotiation for %s %s %s", async (path, method, accept) => {
    const next = vi.fn(async () => document());
    await run(6, request(path, { accept }, method), next);
    expect(next).toHaveBeenCalledOnce();
  });
  it("negotiates EN with an uncacheable redirect preserving search", async () => {
    const res = response(
      await run(6, request("/?utm_source=mail", { accept: "text/html", "accept-language": "en" })),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/en?utm_source=mail");
    expect(res.headers.get("vary")).toBe("Cookie, Accept-Language");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
  it("persists PL without changing body identity or another cookie", async () => {
    const original = document();
    original.headers.append("set-cookie", "other=1");
    const res = response(
      await run(
        6,
        request("/", { accept: "text/html", "accept-language": "pl" }),
        async () => original,
      ),
    );
    expect(res.body).toBe(original.body);
    expect(res.headers.getSetCookie()).toHaveLength(2);
    expect(res.headers.get("vary")).toContain("Accept-Language");
  });
  it.each(["pl", "en"])(
    "uses the existing %s preference instead of Accept-Language",
    async (lang) => {
      const res = response(
        await run(
          6,
          request("/", {
            accept: "text/html",
            cookie: `nes_lang=${lang}`,
            "accept-language": "pl",
          }),
        ),
      );
      expect(res.status).toBe(lang === "en" ? 302 : 200);
      expect(res.headers.get("set-cookie")).toBeNull();
    },
  );
  it("turns the loader's out-of-band no-store into an actual Response header", async () => {
    const handler = requestHandler(async (req) =>
      response(
        await run(10, req, async () => {
          setCacheControlHeader("private, no-store");
          return document();
        }),
      ),
    );
    const res = await handler(request(), {});
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
  it("preserves explicit policies and does not put cache headers on APIs", async () => {
    const res = document();
    res.headers.set("cache-control", "no-store");
    expect(await run(10, request(), async () => res)).toBe(res);
    const api = Response.json({ ok: true });
    expect(await run(10, request("/api/health"), async () => api)).toBe(api);
  });
  it("gives an anonymous document its default policy", async () => {
    const res = response(await run(10, request()));
    expect(res.headers.get("cache-control")).toContain("s-maxage=900");
  });
});

describe("security headers across deployment modes", () => {
  it.each(["https://db.example.org", "invalid", ""])("handles Supabase URL %s", (value) => {
    vi.stubEnv("VITE_SUPABASE_URL", value);
    vi.stubEnv("SUPABASE_URL", "");
    const res = applySecurityHeaders(request(), document());
    expect(res.headers.get("content-security-policy")).toContain(
      value.startsWith("https") ? "wss://db.example.org" : "connect-src 'self' https: wss:",
    );
  });
  it("preserves existing CSP and HSTS", () => {
    const res = document();
    res.headers.set("content-security-policy", "default-src 'none'");
    res.headers.set("strict-transport-security", "max-age=10");
    const out = applySecurityHeaders(request(), res);
    expect(out.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(out.headers.get("strict-transport-security")).toBe("max-age=10");
  });
  it("permits framing only for preview hosts and omits HSTS on HTTP", () => {
    const res = document();
    res.headers.set("x-frame-options", "DENY");
    const out = applySecurityHeaders(new Request("http://localhost/"), res);
    expect(out.headers.get("x-frame-options")).toBeNull();
    expect(out.headers.get("strict-transport-security")).toBeNull();
    expect(out.headers.get("content-security-policy")).toContain("'unsafe-eval'");
  });
});
