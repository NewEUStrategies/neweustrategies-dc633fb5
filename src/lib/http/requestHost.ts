// Isomorphic access to "the host the visitor is browsing" - the single input
// of the host -> tenant plane.
//
//   * Browser: window.location.host (the tab's own origin).
//   * SSR / server functions / server routes: the active request's
//     X-Forwarded-Host or Host header, read through TanStack Start's
//     AsyncLocalStorage-backed request context.
//
// The server branch loads "@tanstack/react-start/server" via a dynamic import
// behind `import.meta.env.SSR`, which Vite replaces statically - so the
// node:async_hooks server entry is dead-code-eliminated from the client
// bundle (see the warning in vite.config.ts).
import { normalizeHost } from "./host";

/** Host from an explicit Request (server routes/middleware already hold one). */
export function requestPublicHost(request: Request): string | null {
  return normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
}

/**
 * Normalized host of the current execution context, or null when there is no
 * host to speak of (background work outside a request). Never throws - every
 * consumer (cache scoping, header injection) treats null as "no tenant hint".
 */
export async function currentTenantHost(): Promise<string | null> {
  if (typeof window !== "undefined") {
    return normalizeHost(window.location.host);
  }
  if (!import.meta.env.SSR) return null;
  try {
    // The *.server.ts suffix keeps @tanstack/react-start/server out of the
    // client bundle (Vite's import protection denies that specifier).
    const mod = await import("./requestHost.server");
    return mod.currentServerHost();
  } catch {
    // Outside a request scope (warmup, tests) - no host, callers fall back.
    return null;
  }
}
