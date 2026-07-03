// Fetch wrapper for the Supabase clients on the PUBLIC (anon) plane.
//
// Injects `x-tenant-host` - the host the visitor is browsing - into every
// PostgREST/RPC call, so the database side (public.request_public_host() ->
// public.public_tenant_id()) can resolve the tenant per request. This is what
// makes every existing anon RLS policy ("tenant_id = public_tenant_id()")
// host-aware WITHOUT touching individual queries:
//
//   * browser: window.location.host - each tenant domain reads its own site;
//   * SSR / server functions: the active request's host via TanStack Start's
//     request context - server-rendered HTML matches what the client fetches.
//
// Requests with no resolvable host (background jobs, previews without a
// claimed domain) carry no header and the database falls back to the DEFAULT
// tenant - exactly the pre-multi-domain behaviour.
//
// Wired into src/integrations/supabase/client.ts (that file is generated - if
// it is ever regenerated, re-add `global: { fetch: fetchWithTenantHost }` to
// its createClient options) and into the per-call anon clients in server
// functions (src/lib/views/postViews.functions.ts).
import { TENANT_HOST_HEADER } from "@/lib/http/host";
import { currentTenantHost } from "@/lib/http/requestHost";

export async function fetchWithTenantHost(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const host = await currentTenantHost();
  if (!host) return fetch(input, init);

  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  // Never clobber an explicitly-set header (tests, targeted overrides).
  if (!headers.has(TENANT_HOST_HEADER)) headers.set(TENANT_HOST_HEADER, host);

  if (init || !(input instanceof Request)) {
    return fetch(input, { ...init, headers });
  }
  return fetch(new Request(input, { headers }));
}
