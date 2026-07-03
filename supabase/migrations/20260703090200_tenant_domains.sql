-- ============================================================================
-- Multi-tenant: host -> tenant resolution for the public path.
--
-- Until now nothing mapped an incoming request host to a tenant:
--   * anon RLS pins reads to the hard-coded public_tenant_id() ('nes'),
--   * the crawler surfaces (sitemap.xml / rss.xml / news-sitemap.xml /
--     llms.txt) read with the service role and NO tenant filter at all,
--     so a second tenant's published content would leak into them.
--
-- This migration adds the data model: each tenant may claim a primary domain
-- (host, no scheme/port) and exactly one tenant is the default fallback for
-- unknown hosts (previews, *.pages.dev, localhost). The server-side resolver
-- (src/lib/server/tenant.server.ts) reads this table with the service role
-- and every service-role public surface filters by the resolved tenant_id.
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Hosts are matched case-insensitively; store them lowercased.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_domain_key
  ON public.tenants (lower(domain))
  WHERE domain IS NOT NULL;

-- Exactly one default tenant (the fallback when no domain matches).
CREATE UNIQUE INDEX IF NOT EXISTS tenants_single_default
  ON public.tenants (is_default)
  WHERE is_default;

UPDATE public.tenants SET is_default = true WHERE slug = 'nes';
