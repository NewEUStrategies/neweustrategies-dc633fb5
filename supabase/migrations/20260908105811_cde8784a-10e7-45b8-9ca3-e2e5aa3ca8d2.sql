-- Remove table-wide read on content_access from client roles (it re-exposed
-- password_hash + password hints) and restore explicit column grants.
REVOKE SELECT ON public.content_access FROM anon, authenticated;

GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency, teaser_pl, teaser_en,
  metering_policy, min_tier_rank, created_at, updated_at
) ON public.content_access TO anon;

GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency, teaser_pl, teaser_en,
  metering_policy, min_tier_rank, created_at, updated_at
) ON public.content_access TO authenticated;

-- Staff writes stay intact; secrets remain server-side only.
GRANT INSERT, UPDATE, DELETE ON public.content_access TO authenticated;
GRANT ALL ON public.content_access TO service_role;