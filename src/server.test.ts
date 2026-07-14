/**
 * Regression tests for the SSR fetch wrapper (`src/server.ts`).
 *
 * The wrapper defends `/` (and every other route) against three failure modes
 * that historically returned an opaque
 *   `{"status":500,"unhandled":true,"message":"HTTPError"}`
 * to the user with no stack in Server Logs:
 *
 *   1. h3 swallowed an in-handler throw into a 500 JSON Response - the wrapper
 *      MUST detect the payload shape, log the correlated captured error, and
 *      replace the body with a clean HTML fallback (no-store).
 *   2. The lazy `import()` of `@tanstack/react-start/server-entry` rejected
 *      (module-init crash). The wrapper MUST log, return the HTML fallback,
 *      AND clear the cached promise so the NEXT request can retry a fresh
 *      module load instead of the whole worker being poisoned.
 *   3. Everything else (200s, non-JSON 5xx, unrelated JSON 5xx) MUST pass
 *      through unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordCapturedError, consumeLastCapturedError } from "./lib/error-capture";

// The wrapper lazily imports this module. We swap it per-test with vi.doMock
// so each scenario gets a fresh implementation without a cached handler
// leaking across tests.
const SERVER_ENTRY = "@tanstack/react-start/server-entry";

async function loadWrapper(handler: (req: Request) => Promise<Response> | Response) {
  vi.resetModules();
  vi.doMock(SERVER_ENTRY, () => ({ default: { fetch: handler } }));
  // Fresh import so the module-level `serverEntryPromise` cache is empty.
  const mod = (await import("./server")) as { default: { fetch: typeof handler } };
  return mod.default;
}

async function loadWrapperWithRejectedImport(reason: unknown) {
  vi.resetModules();
  vi.doMock(SERVER_ENTRY, () => {
    throw reason;
  });
  const mod = (await import("./server")) as {
    default: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
  };
  return mod.default;
}

beforeEach(() => {
  consumeLastCapturedError();
});

afterEach(() => {
  vi.doUnmock(SERVER_ENTRY);
  vi.restoreAllMocks();
});

describe("SSR wrapper - happy path", () => {
  it("passes a 200 response straight through", async () => {
    const wrapper = await loadWrapper(
      () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>ok</html>");
  });

  it("does not touch non-JSON 5xx responses (real HTML error pages)", async () => {
    const wrapper = await loadWrapper(
      () =>
        new Response("<h1>Internal Error</h1>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    );
    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("<h1>Internal Error</h1>");
  });

  it("does not touch unrelated JSON 5xx responses (real API errors)", async () => {
    const body = JSON.stringify({ error: "validation failed", code: "E_VAL" });
    const wrapper = await loadWrapper(
      () =>
        new Response(body, { status: 500, headers: { "content-type": "application/json" } }),
    );
    const res = await wrapper.fetch(new Request("http://localhost/api/x"), {}, {});
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(body);
  });
});

describe("SSR wrapper - h3 swallowed HTTPError normalization", () => {
  const H3_SWALLOWED = JSON.stringify({ status: 500, unhandled: true, message: "HTTPError" });

  it("replaces the opaque h3 payload with an HTML fallback (no-store)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = await loadWrapper(
      () =>
        new Response(H3_SWALLOWED, {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.text();
    // The user MUST NEVER see the swallowed JSON payload again.
    expect(body).not.toContain('"unhandled":true');
    expect(body).not.toContain('"HTTPError"');
    // The wrapper logged something (the captured error or a synthetic one).
    expect(errSpy).toHaveBeenCalled();
  });

  it("correlates a globally-captured error with the swallowed response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const original = new Error("real DB failure with full stack");
    // Simulate what the globalThis error listeners do inside the SSR handler:
    // they stash the real error before h3 swallows it.
    recordCapturedError(original);

    const wrapper = await loadWrapper(
      () =>
        new Response(H3_SWALLOWED, {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    await wrapper.fetch(new Request("http://localhost/"), {}, {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logged = (console.error as unknown as { mock: { calls: any[][] } }).mock.calls[0][0];
    expect(logged).toBe(original);
    // Consumed exactly once - a subsequent request must not correlate to it.
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("still returns HTML fallback when no captured error is available", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = await loadWrapper(
      () =>
        new Response(H3_SWALLOWED, {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(res.status).toBe(500);
    // A synthetic Error is logged so the incident is still visible.
    const arg = errSpy.mock.calls[0]?.[0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toContain("h3 swallowed SSR error");
  });
});

describe("SSR wrapper - module init failure recovery", () => {
  it("returns an HTML fallback when the server entry import rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = await loadWrapperWithRejectedImport(new Error("module init crash"));

    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("clears the cached import promise so the next request can retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    // First mount: import throws.
    vi.resetModules();
    let attempt = 0;
    vi.doMock(SERVER_ENTRY, () => {
      attempt += 1;
      if (attempt === 1) throw new Error("cold start crash");
      return { default: { fetch: () => new Response("healed", { status: 200 }) } };
    });
    const mod = (await import("./server")) as {
      default: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
    };

    const first = await mod.default.fetch(new Request("http://localhost/"), {}, {});
    expect(first.status).toBe(500);

    // Second request MUST hit the mock a second time (cache was cleared) and
    // succeed. If the wrapper poisoned itself, attempt would stay at 1 and we
    // would get another 500 instead.
    const second = await mod.default.fetch(new Request("http://localhost/"), {}, {});
    expect(attempt).toBe(2);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe("healed");
  });
});

describe("SSR wrapper - thrown-error safety net", () => {
  it("catches synchronous throws from the entry handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = await loadWrapper(() => {
      throw new Error("sync throw");
    });
    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("catches rejected async handlers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = await loadWrapper(async () => {
      throw new Error("async throw");
    });
    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
