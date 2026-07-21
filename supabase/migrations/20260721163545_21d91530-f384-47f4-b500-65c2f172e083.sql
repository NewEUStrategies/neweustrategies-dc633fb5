
-- Hide password_hash from anon and authenticated at column level.
-- Public read policy remains, but SELECT on password_hash is revoked
-- so anon/authenticated cannot fetch the bcrypt hash. Password check
-- runs server-side via SECURITY DEFINER RPC (verify_content_password),
-- which executes as owner and can still read the column.

REVOKE SELECT (password_hash) ON public.content_access FROM anon;
REVOKE SELECT (password_hash) ON public.content_access FROM authenticated;

-- Re-grant SELECT on the remaining (non-secret) columns explicitly so
-- roles keep row-level read access to everything else the app needs.
GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency,
  teaser_pl, teaser_en, password_hint_pl, password_hint_en,
  metering_policy, created_at, updated_at
) ON public.content_access TO anon, authenticated;

-- service_role and definer functions retain full access.
GRANT ALL ON public.content_access TO service_role;
