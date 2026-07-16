/**
 * SSR fetch wrapper. Redirects TanStack Start's bundled server entry through
 * this file (`vite.config.ts` → `tanstackStart.server.entry: "server"`) so
 * we can defend `/` and every route against three failure modes that
 * historically returned an opaque
 *   `{"status":500,"unhandled":true,"message":"HTTPError"}`
 * to the user with no stack in Server Logs:
 *
 *   1. h3 swallowed an in-handler throw → JSON 500 with the original stack
 *      lost. Detect the payload shape, log the correlated captured error,
 *      replace the body with a clean HTML fallback (no-store).
 *   2. The lazy `import()` of the server entry rejected (module-init crash).
 *      Log, return the HTML fallback, and clear the cached promise so the
 *      next request can retry a fresh module load instead of poisoning the
 *      whole worker.
 *   3. A route module throws at module-init time inside the framework's
 *      uncatchable `getEntries()` — that self-poisons the framework's
 *      internal singleton with an opaque rejection our try/catch never
 *      sees. We pre-warm the route-module graph ourselves BEFORE calling
 *      into the framework, catching the real error (with stack) here.
 */
import "./lib/ssr-error-capture";

import { consumeLastCapturedError } from "./lib/ssr-error-capture";
import { renderErrorPage } from "./lib/ssr-error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;
let routeGraphPromise: Promise<unknown> | undefined;

// Default warm-graph loader: mirrors what the framework's getEntries() loads
// on the first request. `./router` transitively imports routeTree.gen (every
// route module); `./start` imports every request middleware. A rejection
// here surfaces to OUR try/catch with the real stack instead of the
// framework caching an opaque rejection forever.
let routeGraphLoader: () => Promise<unknown> = () =>
  Promise.all([import("./router"), import("./start")]);

/** @internal test-only — swap the graph loader so unit tests do not evaluate every route. */
export function __setRouteGraphLoader(loader: () => Promise<unknown>): void {
  routeGraphLoader = loader;
  routeGraphPromise = undefined;
}

const TRANSIENT_MODULE_RUNNER_ERRORS = [
  "transport was disconnected",
  "module runner has been closed",
  "cannot call \"fetchModule\"",
] as const;

const FALLBACK_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
} as const;

function fallbackResponse(): Response {
  return new Response(renderErrorPage(), { status: 500, headers: FALLBACK_HEADERS });
}

function resetEntryState(): void {
  serverEntryPromise = undefined;
  routeGraphPromise = undefined;
}

async function warmRouteGraph(): Promise<void> {
  if (!routeGraphPromise) routeGraphPromise = routeGraphLoader();
  try {
    await routeGraphPromise;
  } catch (error) {
    // Drop the cached rejection so the next request re-evaluates a fresh
    // graph (transient module-runner reloads self-heal); a deterministic
    // fault rejects again — but now with the real stack.
    routeGraphPromise = undefined;
    throw error;
  }
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
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

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires
// for those. Detect the payload shape, log the correlated captured cause,
// and replace with a clean HTML fallback.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isOpaqueH3Error(body)) return response;

  // The preview server can replace its SSR module graph while an older
  // streamed render is still resolving lazy widget imports. Vite closes
  // that module runner and h3 turns the rejection into this opaque 500.
  // Drop the cached entry so the next request resolves the healthy graph.
  resetEntryState();

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  // Request context helps correlate the swallowed body with the failing
  // route when the captured cause is missing. Logged AFTER the error so
  // `console.error.mock.calls[0][0]` in tests stays the Error itself.
  try {
    const url = new URL(request.url);
    console.error(
      `[ssr] h3 swallowed 500 · ${request.method} ${url.pathname}${url.search} · body=${body}`,
    );
  } catch {
    /* malformed URL — already logged above */
  }
  return fallbackResponse();
}

async function fetchWithFreshEntry(
  request: Request,
  env: unknown,
  ctx: unknown,
): Promise<Response> {
  try {
    // Evaluate the route-module graph in our own try/catch BEFORE the
    // framework's (uncatchable, self-poisoning) getEntries() runs.
    await warmRouteGraph();
    const handler = await getServerEntry();
    return await handler.fetch(request, env, ctx);
  } catch (error) {
    if (!isTransientModuleRunnerError(error)) throw error;
    // The dev server can replace its module graph mid-request. Retry once
    // after the current restart turn against a fresh entry.
    resetEntryState();
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
      // A rejected lazy import must not poison every following request in
      // the same worker. Clear the cache; the next request retries fresh.
      resetEntryState();
      console.error(error);
      return fallbackResponse();
    }
  },
};
