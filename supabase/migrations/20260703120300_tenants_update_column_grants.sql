-- ============================================================================
-- tenants: column-scope the admin UPDATE surface (re-audit N6).
--
-- The RLS policy "Admins update own tenant" (20260531181120) allows a tenant
-- admin to UPDATE their own tenants row, with no column restriction. Today it
-- is dormant - authenticated only ever received GRANT SELECT - but it is a
-- loaded footgun: the moment anyone adds a broad "GRANT UPDATE ON tenants TO
-- authenticated" (the usual reflex when a branding form appears), a tenant
-- admin could rewrite
--   * slug       - the tenant's identity, referenced by provisioning/seeds,
--   * domain     - hijack another site's traffic by claiming its host,
--   * is_default - make their tenant the fallback for every unclaimed host.
--
-- Fix at the PRIVILEGE layer (same doctrine as the profiles/body-column
-- grants): revoke any table-wide UPDATE and grant UPDATE only on the
-- branding-safe column. Adding a column to the safe list is a deliberate,
-- reviewable one-line grant; routing/identity columns stay service-role-only.
-- ============================================================================

REVOKE UPDATE ON public.tenants FROM anon, authenticated;

-- Branding-safe: the display name. Routing/identity columns (slug, domain,
-- is_default) and timestamps stay writable only via the service role.
GRANT UPDATE (name) ON public.tenants TO authenticated;

COMMENT ON TABLE public.tenants IS
  'Tenant directory. UPDATE for authenticated is column-scoped (name only) - '
  'the RLS policy "Admins update own tenant" limits WHICH row, the column '
  'grant limits WHAT can change. slug/domain/is_default are service-role-only '
  '(domain + is_default drive host -> tenant routing).';
