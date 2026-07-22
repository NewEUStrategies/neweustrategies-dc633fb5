
-- Prevent anonymous readers from harvesting password_hash (and hints) from
-- content_access. Password verification happens server-side via SECURITY
-- DEFINER RPCs; the anon/authenticated Data API roles never need these
-- columns. Grant only the non-sensitive columns that teaser rendering needs.
REVOKE SELECT ON public.content_access FROM anon;
REVOKE SELECT ON public.content_access FROM authenticated;

GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency,
  teaser_pl, teaser_en, password_hint_pl, password_hint_en,
  metering_policy, created_at, updated_at
) ON public.content_access TO anon;

GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency,
  teaser_pl, teaser_en, password_hint_pl, password_hint_en,
  metering_policy, created_at, updated_at
) ON public.content_access TO authenticated;

-- Staff still need to insert/update/delete (RLS "content_access staff manage"
-- gates rows; column grants must permit the write to reach PostgREST).
GRANT INSERT, UPDATE, DELETE ON public.content_access TO authenticated;
