// Server-only helper: reads the active request host via TanStack Start's
// AsyncLocalStorage-backed request context and validates it against the
// tenant directory (tenants.domain) - the edge trust boundary of the whole
// host -> tenant plane (see pickTrustedHost in src/lib/server/tenant.server.ts).
// Kept in a *.server.ts file so Vite's client-bundle import protection strips
// it (the raw specifier "@tanstack/react-start/server" is denied in the
// client graph even behind a `import.meta.env.SSR` dynamic import).
import { getRequest } from "@tanstack/react-start/server";
import { resolveTrustedRequestHost } from "@/lib/server/tenant.server";

export async function currentServerHost(): Promise<string | null> {
  try {
    const request = getRequest();
    if (!request) return null;
    return await resolveTrustedRequestHost(request);
  } catch {
    return null;
  }
}
