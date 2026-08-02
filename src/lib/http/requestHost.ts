// Isomorphic access to "the host the visitor is browsing" - the single input
// of the host -> tenant plane.
//
//   * Browser: window.location.host (the tab's own origin - not forgeable by
//     a remote attacker, it IS the site being browsed).
//   * SSR / server functions / server routes: the active request's host,
//     VALIDATED against the tenant directory (tenants.domain) - see
//     pickTrustedHost() in src/lib/server/tenant.server.ts. A client-supplied
//     X-Forwarded-Host is honored only when it maps to a registered tenant
//     domain AND the authoritative Host header does not; anything else falls
//     back to the Host header, preview-host rules or "no tenant hint".
//
// The server branch loads the *.server.ts modules via a dynamic import behind
// `import.meta.env.SSR`, which Vite replaces statically - so the server-only
// graph (node:async_hooks, supabase admin client) is dead-code-eliminated
// from the client bundle (see the warning in vite.config.ts).
import { normalizeHost } from "./host";

/**
 * RAW host from an explicit Request: X-Forwarded-Host first, then Host,
 * normalized - NO trust decision. Untrusted input by definition; the only
 * legitimate consumers are the trusted resolver itself (as its bootstrap
 * fallback) and tests. Everything tenant-scoped goes through
 * trustedPublicHost() / currentTenantHost().
 */
export function requestPublicHost(request: Request): string | null {
  return normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
}

/**
 * TRUSTED host of an explicit Request (server routes / middleware): the
 * header pair validated against tenants.domain at the edge. Null means "no
 * tenant hint" - an unknown host on a deployment that already claimed custom
 * domains (callers fall back to the default tenant / a shared cache scope
 * instead of trusting attacker-chosen input). Never throws.
 */
export async function trustedPublicHost(request: Request): Promise<string | null> {
  if (!import.meta.env.SSR) return requestPublicHost(request);
  try {
    // The *.server.ts suffix keeps the supabase admin graph out of the
    // client bundle (Vite's import protection denies that subtree).
    const mod = await import("@/lib/server/tenant.server");
    return await mod.resolveTrustedRequestHost(request);
  } catch {
    // Directory layer unavailable (tests, warmup) - degrade to the raw
    // reader; the DB side still matches the header against tenants.domain.
    return requestPublicHost(request);
  }
}

/**
 * Normalized host of the current execution context, or null when there is no
 * host to speak of (background work outside a request) or the request host
 * fails the tenants.domain validation. Never throws - every consumer (cache
 * scoping, header injection, tenant_id attribution) treats null as "no
 * tenant hint".
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
    return await mod.currentServerHost();
  } catch {
    // Outside a request scope (warmup, tests) - no host, callers fall back.
    return null;
  }
}
