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

import { consumeLastCapturedError } from "./lib/ssr-error-capture";

// The wrapper lazily imports this module. We swap it per-test with vi.doMock
// so each scenario gets a fresh implementation without a cached handler
// leaking across tests.
const SERVER_ENTRY = "@tanstack/react-start/server-entry";

type EntryFetch = (req: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;

async function loadWrapper(handler: EntryFetch) {
  vi.resetModules();
  vi.doMock(SERVER_ENTRY, () => ({ default: { fetch: handler } }));
  // Fresh import so the module-level `serverEntryPromise` cache is empty.
  const mod = (await import("./server")) as typeof import("./server") & {
    default: { fetch: EntryFetch };
  };
  // Warm-up would otherwise evaluate the whole real route graph; inject a
  // healthy stub so these tests exercise the entry-handler paths in isolation.
  mod.__setRouteGraphLoader(() => Promise.resolve({}));
  return mod.default;
}

async function loadWrapperWithRejectedImport(reason: unknown) {
  vi.resetModules();
  vi.doMock(SERVER_ENTRY, () => {
    throw reason;
  });
  const mod = (await import("./server")) as typeof import("./server") & {
    default: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
  };
  mod.__setRouteGraphLoader(() => Promise.resolve({}));
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

    const wrapper = await loadWrapper(
      () =>
        new Response(H3_SWALLOWED, {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );

    // Record via the SAME module graph the wrapper reads from (vi.resetModules
    // gave us a fresh copy of ./lib/error-capture inside the wrapper's graph).
    // This is what the SSR handler's globalThis error listeners do in prod.
    const cap = (await import("./lib/error-capture")) as typeof import("./lib/error-capture");
    cap.recordCapturedError(original);

    await wrapper.fetch(new Request("http://localhost/"), {}, {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logged = (console.error as unknown as { mock: { calls: any[][] } }).mock.calls[0][0];
    expect(logged).toBe(original);
    // Consumed exactly once - a subsequent request must not correlate to it.
    expect(cap.consumeLastCapturedError()).toBeUndefined();
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

  it("clears a poisoned entry after an opaque response so the next request can reload it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = await loadWrapper(
      () =>
        new Response(H3_SWALLOWED, {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const mod = (await import("./server")) as typeof import("./server");

    expect(mod.isServerEntryCached()).toBe(false);
    const first = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(first.status).toBe(500);
    expect(mod.isServerEntryCached()).toBe(false);
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
    const mod = (await import("./server")) as typeof import("./server") & {
      default: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
    };
    mod.__setRouteGraphLoader(() => Promise.resolve({}));

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
  it("retries once when the dev module transport disconnects", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let attempt = 0;
    const wrapper = await loadWrapper(() => {
      attempt += 1;
      if (attempt === 1) {
        throw Object.assign(new Error("HTTPError"), {
          cause: new Error('transport was disconnected, cannot call "fetchModule"'),
        });
      }
      return new Response("healed", { status: 200 });
    });

    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(attempt).toBe(2);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("healed");
    expect(errSpy).not.toHaveBeenCalled();
  });

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

describe("SSR wrapper - route-graph warm-up (module-init capture)", () => {
  async function loadWrapperWithGraph(
    handler: EntryFetch,
    graphLoader: () => Promise<unknown>,
  ) {
    vi.resetModules();
    vi.doMock(SERVER_ENTRY, () => ({ default: { fetch: handler } }));
    const mod = (await import("./server")) as typeof import("./server") & {
      default: { fetch: EntryFetch };
    };
    mod.__setRouteGraphLoader(graphLoader);
    return mod.default;
  }

  it("surfaces the REAL module-init error (with stack) instead of the opaque h3 body", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // A deterministic module-init fault in a route module (e.g. a workerd-only
    // global-scope operation) — the class that historically produced an opaque,
    // stackless 500 the framework cached forever.
    const realError = new Error("Disallowed operation called within global scope");
    const wrapper = await loadWrapperWithGraph(
      () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } }),
      () => Promise.reject(realError),
    );

    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The offending module's real error is logged, so the culprit is nameable.
    expect(errSpy).toHaveBeenCalledWith(realError);
    // The user never sees the opaque payload.
    expect(await res.text()).not.toContain('"HTTPError"');
  });

  it("does NOT poison the entry handler when the graph fails (handler stays untouched)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let handlerCalls = 0;
    const wrapper = await loadWrapperWithGraph(
      () => {
        handlerCalls += 1;
        return new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } });
      },
      () => Promise.reject(new Error("route module crash")),
    );
    await wrapper.fetch(new Request("http://localhost/"), {}, {});
    // The framework entry handler is never reached (short-circuited before its
    // uncatchable, self-poisoning getEntries() can run).
    expect(handlerCalls).toBe(0);
  });

  it("retries a transient module-runner reload during warm-up, then succeeds", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let attempt = 0;
    const wrapper = await loadWrapperWithGraph(
      () => new Response("healed", { status: 200 }),
      () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error("module runner has been closed"));
        }
        return Promise.resolve({});
      },
    );

    const res = await wrapper.fetch(new Request("http://localhost/"), {}, {});
    expect(attempt).toBe(2);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("healed");
    // A transient reload self-heals silently — no error surfaced to logs.
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("caches a healthy graph — warms once across requests", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let loads = 0;
    const wrapper = await loadWrapperWithGraph(
      () => new Response("ok", { status: 200 }),
      () => {
        loads += 1;
        return Promise.resolve({});
      },
    );
    await wrapper.fetch(new Request("http://localhost/"), {}, {});
    await wrapper.fetch(new Request("http://localhost/a"), {}, {});
    await wrapper.fetch(new Request("http://localhost/b"), {}, {});
    expect(loads).toBe(1);
  });
});
