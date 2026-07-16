/**
 * Regression tests for `applySecurityHeaders`.
 *
 * The SSR error wrapper (previously `errorMiddleware` + `handleMiddlewareError`
 * + `isHttpError`, plus the `src/server.ts` fetch shim) was removed - the
 * framework's default h3 error path is now the single source of truth. Only
 * the security-headers helper remains public and needs regression coverage.
 */
import { describe, expect, it, vi } from "vitest";

import { applySecurityHeaders } from "./start";

describe("applySecurityHeaders", () => {
  it("adds document security headers without mutating an immutable response", () => {
    const immutable = Response.redirect("https://example.com/destination", 302);
    const setSpy = vi.spyOn(immutable.headers, "set").mockImplementation(() => {
      throw new TypeError("immutable");
    });

    const secured = applySecurityHeaders(
      new Request("https://example.com/", {
        headers: { "x-forwarded-proto": "https" },
      }),
      immutable,
    );

    expect(secured.status).toBe(302);
    expect(secured.headers.get("location")).toBe("https://example.com/destination");
    expect(secured.headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("preserves a streaming HTML body and existing headers", async () => {
    const original = new Response("<html>ok</html>", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });

    const secured = applySecurityHeaders(new Request("https://example.com/"), original);

    expect(await secured.text()).toBe("<html>ok</html>");
    expect(secured.headers.get("cache-control")).toBe("public, max-age=60");
    expect(secured.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
