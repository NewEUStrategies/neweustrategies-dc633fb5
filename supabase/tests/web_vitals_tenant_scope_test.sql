-- pgTAP: web_vitals is tenant-scoped, so one workspace's admin analytics can
-- never aggregate another workspace's RUM samples.
--
-- Verifies migration 20260708150000_web_vitals_tenant_scope.sql:
--   1. web_vitals.tenant_id is mandatory (NOT NULL).
--   2. web_vitals_daily_p75(since, tenant) counts ONLY the requested tenant.
--   3. another tenant's (extreme) samples never influence the requested
--      tenant's p75.

BEGIN;
SELECT plan(3);

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-1111111111aa', 'wv-tenant-a', 'WV Tenant A'),
  ('b2222222-2222-2222-2222-2222222222bb', 'wv-tenant-b', 'WV Tenant B');

-- Two samples for tenant A, one (deliberately extreme) for tenant B, same
-- metric + UTC day so any leak would show up in A's aggregation.
INSERT INTO public.web_vitals (tenant_id, metric, value, created_at) VALUES
  ('a1111111-1111-1111-1111-1111111111aa', 'LCP', 1000, now()),
  ('a1111111-1111-1111-1111-1111111111aa', 'LCP', 2000, now()),
  ('b2222222-2222-2222-2222-2222222222bb', 'LCP', 99000, now());

SELECT col_not_null(
  'public', 'web_vitals', 'tenant_id',
  'web_vitals.tenant_id is NOT NULL (isolation column is mandatory)'
);

SELECT is(
  (SELECT coalesce(sum(samples), 0)::int
     FROM public.web_vitals_daily_p75(now() - interval '1 day',
                                      'a1111111-1111-1111-1111-1111111111aa')),
  2,
  'web_vitals_daily_p75 aggregates only the requested tenant''s samples'
);

SELECT ok(
  (SELECT max(p75)
     FROM public.web_vitals_daily_p75(now() - interval '1 day',
                                      'a1111111-1111-1111-1111-1111111111aa')) < 90000,
  'another tenant''s extreme sample never bleeds into this tenant''s p75'
);

SELECT * FROM finish();
ROLLBACK;
