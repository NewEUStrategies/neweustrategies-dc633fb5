/**
 * Regression tests for the request `errorMiddleware` classifier.
 *
 * The bug we defend against: h3 catches any throw inside a request handler and
 * serializes it into a `Response(500, { unhandled: true, message: "HTTPError" })`
 * with the original stack lost. The old `"statusCode" in error` check let any
 * library error that happened to expose `statusCode` (DB clients, fetch wrappers,
 * etc.) fall through, so h3 replaced them with the opaque payload.
 *
 * The rule is now strict: only errors whose `name === "HTTPError"` AND with a
 * numeric `status` are treated as control flow and rethrown. Everything else is
 * captured (so the SSR wrapper can log the real stack) and answered with a
 * clean HTML 500 - never a swallowed JSON HTTPError.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleMiddlewareError, isHttpError } from "./start";
import { consumeLastCapturedError } from "./lib/error-capture";

beforeEach(() => {
  // Drain the capture ring so cross-test errors do not correlate.
  consumeLastCapturedError();
  vi.restoreAllMocks();
});

describe("isHttpError", () => {
  it("accepts genuine h3 HTTPError (name + numeric status)", () => {
    const e = Object.assign(new Error("nope"), { name: "HTTPError", status: 404 });
    expect(isHttpError(e)).toBe(true);
  });

  it("rejects library errors that happen to expose statusCode/status", () => {
    // The old regression: postgrest / fetch clients set `statusCode` on their
    // own error subclasses. They are NOT HTTP control flow - they are bugs the
    // wrapper must log and turn into a real 500 HTML page.
    const pgError = Object.assign(new Error("relation missing"), {
      name: "PostgrestError",
      statusCode: 500,
      status: 500,
    });
    expect(isHttpError(pgError)).toBe(false);

    const fetchError = Object.assign(new TypeError("fetch failed"), { statusCode: 502 });
    expect(isHttpError(fetchError)).toBe(false);
  });

  it("rejects null / primitives / plain strings", () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(undefined)).toBe(false);
    expect(isHttpError("HTTPError")).toBe(false);
    expect(isHttpError({ name: "HTTPError" })).toBe(false); // no status
    expect(isHttpError({ name: "HTTPError", status: "500" })).toBe(false); // not numeric
  });
});

describe("handleMiddlewareError", () => {
  it("rethrows a genuine HTTPError so h3 can serialize it", () => {
    const http = Object.assign(new Error("not found"), { name: "HTTPError", status: 404 });
    const outcome = handleMiddlewareError(http);
    expect(outcome).toEqual({ rethrow: http });
  });

  it("captures 5xx HTTPErrors for the SSR wrapper to log", () => {
    const http = Object.assign(new Error("boom"), { name: "HTTPError", status: 500 });
    handleMiddlewareError(http);
    expect(consumeLastCapturedError()).toBe(http);
  });

  it("does NOT capture 4xx HTTPErrors (they are expected control flow)", () => {
    const http = Object.assign(new Error("nf"), { name: "HTTPError", status: 404 });
    handleMiddlewareError(http);
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("captures + logs any non-HTTPError and returns a 500 HTML response", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bug = new Error("database exploded");

    const outcome = handleMiddlewareError(bug);

    expect("response" in outcome).toBe(true);
    if (!("response" in outcome)) return; // narrow

    expect(outcome.response.status).toBe(500);
    expect(outcome.response.headers.get("content-type")).toContain("text/html");
    // The fallback MUST NOT be edge-cached - a stale error page is worse than a retry.
    expect(outcome.response.headers.get("cache-control")).toBe("no-store");

    const body = await outcome.response.text();
    // Never leak the swallowed h3 payload shape - that is the regression.
    expect(body).not.toContain('"unhandled":true');
    expect(body).not.toContain('"HTTPError"');
    // The real error is preserved for the SSR wrapper.
    expect(consumeLastCapturedError()).toBe(bug);
    expect(errSpy).toHaveBeenCalledWith(bug);
  });

  it("does not swallow the error - the captured value is the original object with its stack", () => {
    const bug = new Error("with stack");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    handleMiddlewareError(bug);
    const captured = consumeLastCapturedError() as Error;
    // Identity, not a wrapper: `.stack` and message survive verbatim.
    expect(captured).toBe(bug);
    expect(captured.stack).toBe(bug.stack);
  });
});
