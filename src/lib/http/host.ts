// Pure, isomorphic host helpers shared by the whole host -> tenant plane:
// the server-side resolver (tenant.server.ts), the Supabase fetch wrapper
// (x-tenant-host header) and the SSR edge cache scoping. One definition of
// "what is the request host" so the SQL side (public.request_public_host())
// and the TS side can never drift apart.

/**
 * Header carrying the public site host to PostgREST. The SQL function
 * public.request_public_host() reads exactly this header, and
 * public.public_tenant_id() maps it to the owning tenant - which makes every
 * anon RLS policy host-aware without touching individual queries.
 *
 * The value is client-controlled by design: it only ever selects WHICH
 * tenant's PUBLISHED content the caller reads (data that is public on that
 * tenant's own domain anyway). Staff/private reads are scoped by
 * current_tenant_id() (profile-based) and never by this header.
 */
export const TENANT_HOST_HEADER = "x-tenant-host";

/** Normalize a Host header / URL host: lowercase, strip port and brackets. */
export function normalizeHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.trim().toLowerCase();
  if (!host) return null;
  // IPv6 literals ("[::1]:8080") - keep the bracket content only.
  const bracketMatch = host.match(/^\[([^\]]+)\]/);
  if (bracketMatch) return bracketMatch[1];
  return host.split(":")[0] || null;
}

/**
 * "www." is an alias of the apex domain (and vice versa). Returns the
 * counterpart host so resolvers can match either registration.
 */
export function wwwToggledHost(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

/**
 * Hosts that are legitimate previews of the DEFAULT tenant: local dev and the
 * platform-issued preview domains of this deployment (Cloudflare + Lovable).
 * Crawler surfaces fail CLOSED for every other unknown host (see
 * resolveCrawlerTenantForHost) - an unclaimed production domain must never
 * serve, advertise or index another tenant's content.
 */
const PREVIEW_HOST_SUFFIXES = [
  ".localhost",
  ".pages.dev",
  ".workers.dev",
  ".lovable.app",
  ".lovable.dev",
  ".lovableproject.com",
] as const;

const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** True for local/dev/platform-preview hosts (never for customer domains). */
export function isPreviewHost(rawHost: string | null | undefined): boolean {
  const host = normalizeHost(rawHost);
  if (!host) return false;
  if (PREVIEW_HOSTS.has(host)) return true;
  return PREVIEW_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
