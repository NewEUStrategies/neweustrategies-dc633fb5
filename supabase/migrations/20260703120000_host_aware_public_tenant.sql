-- ============================================================================
-- Multi-tenant: make the ANON CONTENT PLANE host-aware.
--
-- Problem (re-audit N2): public_tenant_id() was hard-coded to the seed tenant
-- (slug 'nes'), while host -> tenant resolution existed only on the
-- service-role crawler surfaces (sitemap/rss/llms.txt/redirects). Every anon
-- RLS policy says "tenant_id = public_tenant_id()", so EVERY domain served
-- the seed tenant's content: a second tenant's site rendered foreign content
-- and its own sitemap URLs 404-ed. Multi-tenancy did not work publicly.
--
-- Fix: resolve the tenant INSIDE public_tenant_id() from the request:
--   1. the x-tenant-host header (set by the app's Supabase clients: browser =
--      window.location.host, SSR = the active request host) matched against
--      tenants.domain - exact first, then the www./apex alias;
--   2. otherwise the default tenant (tenants.is_default - previews, unclaimed
--      hosts, requests without the header such as realtime or direct SQL);
--   3. otherwise the legacy seed tenant (slug 'nes') so installs migrated
--      before is_default existed keep working.
--
-- Because the fallback chain ends exactly where the old constant pointed, a
-- deployment with NO custom domains behaves byte-for-byte as before - this
-- migration only ADDS behaviour once a tenant claims a domain.
--
-- Security note: the header is client-controlled BY DESIGN. It only selects
-- which tenant's PUBLISHED content an anonymous caller reads - data that is
-- public on that tenant's own domain anyway - and which tenant anonymous
-- public INSERTs (newsletter signup, contact form) are attributed to, which
-- must follow the site being browsed. Staff/private access is scoped by
-- current_tenant_id() (profile-based) and is not influenced by this header.
-- ============================================================================

-- Normalized host from the PostgREST request headers: lowercase, port
-- stripped, IPv6 brackets unwrapped - mirrors normalizeHost() in
-- src/lib/http/host.ts. NULL outside PostgREST (direct connections, triggers)
-- and when the app did not send the header.
CREATE OR REPLACE FUNCTION public.request_public_host()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH raw AS (
    SELECT lower(trim(
      nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-host'
    )) AS h
  )
  SELECT CASE
           WHEN h IS NULL OR h = '' THEN NULL
           WHEN h ~ '^\[' THEN (regexp_match(h, '^\[([^\]]+)\]'))[1]
           ELSE nullif(split_part(h, ':', 1), '')
         END
    FROM raw
$$;

REVOKE ALL ON FUNCTION public.request_public_host() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_public_host()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.request_public_host() IS
  'Normalized site host (lowercase, no port/brackets) taken from the '
  'x-tenant-host request header set by the app''s Supabase clients. NULL when '
  'the header is absent or the call is not going through PostgREST. Input of '
  'public_tenant_id() - the host -> tenant switch of the anon content plane.';

-- Host-aware public tenant: request host -> tenants.domain (exact match wins
-- over the www./apex alias), else the default tenant, else the legacy seed.
CREATE OR REPLACE FUNCTION public.public_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH req AS (SELECT public.request_public_host() AS host)
  SELECT COALESCE(
    (SELECT t.id
       FROM public.tenants t, req r
      WHERE r.host IS NOT NULL
        AND lower(t.domain) IN (
              r.host,
              CASE WHEN r.host LIKE 'www.%'
                   THEN substr(r.host, 5)
                   ELSE 'www.' || r.host END
            )
      ORDER BY (lower(t.domain) = r.host) DESC
      LIMIT 1),
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  )
$$;

REVOKE ALL ON FUNCTION public.public_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_tenant_id()
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.public_tenant_id() IS
  'Tenant of the site the caller is browsing: x-tenant-host header -> '
  'tenants.domain (www./apex aliased), else the default tenant '
  '(tenants.is_default), else the legacy seed (slug ''nes''). Every anon RLS '
  'policy and DEFAULT tenant_id on public-facing tables goes through this '
  'function, which is what makes the whole anon content plane host-aware.';
