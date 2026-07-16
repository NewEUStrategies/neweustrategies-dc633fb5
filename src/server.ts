import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

// The route-module graph, evaluated in OUR try/catch on the first request.
//
// Why this exists: TanStack Start's request resolver calls `getEntries()`
// (createStartHandler) BEFORE our request middleware chain is installed, so a
// throw while it imports `#tanstack-router-entry -> routeTree.gen -> every route
// module` runs OUTSIDE `errorMiddleware`. h3 then serializes that throw as the
// opaque `{"unhandled":true,"message":"HTTPError"}` 500 AND the framework caches
// the rejected promise in a module-level singleton we cannot reach - so every
// later request returns the same opaque 500 with the ORIGINAL stack lost, and no
// reset here can recover it. A single route/module that throws at module-init
// time on the deployed runtime (e.g. a workerd-only global-scope fault that Node
// tolerates) therefore takes the WHOLE site down, undiagnosably.
//
// Warming the graph ourselves first (a) surfaces the real module-init error WITH
// its stack to our own handlers/logs so the offending module is nameable, (b)
// lets a transient dev/module-runner reload retry instead of poisoning the
// worker, and (c) short-circuits to the controlled fallback before the framework
// can cache its opaque rejection.
let routeGraphPromise: Promise<unknown> | undefined;

/**
 * Test seam: swap the graph loader so unit tests need not evaluate every route.
 *
 * The default mirrors exactly what the framework's getEntries() loads: the router
 * entry and the start instance. getEntries() imports `#tanstack-router-entry`,
 * which the Start plugin aliases to `src/router.tsx` (NOT routeTree.gen directly);
 * router.tsx in turn imports routeTree.gen, so warming `./router` evaluates every
 * route module AND router.tsx's own module-init graph (QueryClient, the router <->
 * query SSR integration, i18n locale runtime) - the part that would otherwise sit
 * outside this net and could still fault first inside the framework's uncatchable
 * getEntries(). Its failure set is a strict subset of the framework's, so warming
 * it can never reject where the framework would have succeeded.
 */
let routeGraphLoader: () => Promise<unknown> = () =>
  Promise.all([import("./router"), import("./start")]);

/** @internal test-only */
export function __setRouteGraphLoader(loader: () => Promise<unknown>): void {
  routeGraphLoader = loader;
  routeGraphPromise = undefined;
}

async function warmRouteGraph(): Promise<void> {
  if (!routeGraphPromise) routeGraphPromise = routeGraphLoader();
  try {
    await routeGraphPromise;
  } catch (error) {
    // Drop the cached rejection so the next request re-evaluates a fresh graph
    // (a transient module-runner swap self-heals); a deterministic fault simply
    // rejects again - but now with the real stack, surfaced to the caller.
    routeGraphPromise = undefined;
    throw error;
  }
}

const TRANSIENT_MODULE_RUNNER_ERRORS = [
  "transport was disconnected",
  "module runner has been closed",
  "cannot call \"fetchModule\"",
] as const;

/** Test seam for the preview-recovery invariant; no server entry details escape. */
export function isServerEntryCached(): boolean {
  return serverEntryPromise !== undefined;
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} - try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request?: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isOpaqueH3Error(body)) return response;

  // The preview server can replace its SSR module graph while an older
  // streamed render is still resolving React.lazy widget imports. Vite then
  // closes that module runner and h3 turns the rejection into this opaque 500.
  // Keeping the resolved entry in our module-level cache made every following
  // request reuse the dead graph, so the preview stayed poisoned after the
  // rebuild had finished. Drop it here just like we do for a rejected import;
  // the next request resolves the current, healthy server entry.
  serverEntryPromise = undefined;
  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  // Request-level context helps correlate the swallowed body with the failing
  // route when the captured cause is missing (workerd rarely fires global
  // `error` events for framework-caught throws). Logged AFTER the error so
  // `console.error.mock.calls[0][0]` in `src/server.test.ts` stays the Error.
  if (request) {
    try {
      const url = new URL(request.url);
      console.error(
        `[ssr] h3 swallowed 500 · ${request.method} ${url.pathname}${url.search} · body=${body}`,
      );
    } catch {
      /* malformed URL - already logged above */
    }
  }
  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isOpaqueH3Error(body: string): boolean {
  try {
    const payload: unknown = JSON.parse(body);
    if (payload == null || typeof payload !== "object") return false;
    const candidate = payload as { unhandled?: unknown; message?: unknown };
    return candidate.unhandled === true && candidate.message === "HTTPError";
  } catch {
    return false;
  }
}

function isTransientModuleRunnerError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (TRANSIENT_MODULE_RUNNER_ERRORS.some((fragment) => message.includes(fragment))) return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function fetchWithFreshEntry(
  request: Request,
  env: unknown,
  ctx: unknown,
): Promise<Response> {
  try {
    // Evaluate the route-module graph in our own try/catch BEFORE the framework's
    // (uncatchable, self-poisoning) getEntries() runs inside handler.fetch.
    await warmRouteGraph();
    const handler = await getServerEntry();
    return await handler.fetch(request, env, ctx);
  } catch (error) {
    if (!isTransientModuleRunnerError(error)) throw error;
    // The dev server can replace its module graph while a request is resolving
    // the route entry. Retry once after the current restart turn and resolve a
    // fresh outer entry instead of returning the opaque h3 500 immediately.
    serverEntryPromise = undefined;
    routeGraphPromise = undefined;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await warmRouteGraph();
    const handler = await getServerEntry();
    return await handler.fetch(request, env, ctx);
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const response = await fetchWithFreshEntry(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response, request);
    } catch (error) {
      // A rejected lazy import must not poison every subsequent request in the
      // same worker. Clear it once; the next request gets a fresh module load.
      serverEntryPromise = undefined;
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
  },
};
