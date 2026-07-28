import { describe, expect, it } from "vitest";

import { getMiddlewareResponse, withMiddlewareResponse } from "../middlewareResult";

describe("middlewareResult", () => {
  it("reads a bare Response", () => {
    const res = new Response("x");
    expect(getMiddlewareResponse(res)).toBe(res);
  });

  it("reads the response carried by the framework result object", () => {
    const res = new Response("x");
    const result = { request: new Request("https://e.dev/"), response: res, extra: 1 };
    expect(getMiddlewareResponse(result)).toBe(res);
  });

  it("returns null for a result without a response", () => {
    expect(getMiddlewareResponse({ context: {} })).toBeNull();
    expect(getMiddlewareResponse(undefined)).toBeNull();
  });

  it("replaces a bare Response", () => {
    const next = new Response("y");
    expect(withMiddlewareResponse(new Response("x"), next)).toBe(next);
  });

  it("preserves the carrier shape when replacing", () => {
    const result = { handlerType: "document", response: new Response("x"), extra: 1 };
    const next = new Response("y");
    const out = withMiddlewareResponse(result, next);
    expect(out.response).toBe(next);
    expect(out.extra).toBe(1);
    expect(out.handlerType).toBe("document");
  });
});
