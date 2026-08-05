// Server-only helper: reads the active request host via TanStack Start's
// AsyncLocalStorage-backed request context and validates it against the
// tenant directory (tenants.domain) - the edge trust boundary of the whole
// host -> tenant plane (see pickTrustedHost in src/lib/server/tenant.server.ts).
// Kept in a *.server.ts file so Vite's client-bundle import protection strips
// it (the raw specifier "@tanstack/react-start/server" is denied in the
// client graph even behind a `import.meta.env.SSR` dynamic import).
import { getRequest } from "@tanstack/react-start/server";
import { resolveTrustedRequestHost } from "@/lib/server/tenant.server";
import { mintTenantHostAssertion } from "@/lib/server/tenantAssertion.server";

export async function currentServerHost(): Promise<string | null> {
  try {
    const request = getRequest();
    if (!request) return null;
    return await resolveTrustedRequestHost(request);
  } catch {
    return null;
  }
}

/**
 * Poświadczenie krawędzi dla hosta BIEŻĄCEGO żądania (SSR / server functions).
 * Podpisywany jest host już zwalidowany względem `tenants.domain`, więc
 * sfałszowany `X-Forwarded-Host` nie zostanie nigdy poświadczony. Null =
 * brak klucza albo brak wskazówki tenanta; wołający idzie wtedy szczeblem
 * ASSERTED (patrz src/lib/http/tenantAssertion.ts).
 */
export async function currentServerAssertion(): Promise<string | null> {
  try {
    const host = await currentServerHost();
    if (!host) return null;
    return await mintTenantHostAssertion(host);
  } catch {
    return null;
  }
}

/** Poświadczenie dla jawnego Requestu (middleware, trasy serwerowe). */
export async function assertionForRequest(request: Request): Promise<string | null> {
  try {
    const host = await resolveTrustedRequestHost(request);
    if (!host) return null;
    return await mintTenantHostAssertion(host);
  } catch {
    return null;
  }
}

/**
 * Trusted host of an explicit Request. Lives here (a *.server.ts module) so
 * the client graph never reaches src/lib/server/** - Vite's import protection
 * denies that directory even behind an `import.meta.env.SSR` dynamic import.
 */
export async function trustedHostFromRequest(request: Request): Promise<string | null> {
  return await resolveTrustedRequestHost(request);
}
