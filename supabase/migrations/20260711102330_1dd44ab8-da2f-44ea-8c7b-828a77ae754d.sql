-- Domknięcie P0: kolumnowy REVOKE nie działa, gdy istnieje table-level SELECT.
-- Przenosimy anon/authenticated na jawną listę bezpiecznych kolumn (bez password_hash).

REVOKE SELECT ON public.content_access FROM anon, authenticated;

GRANT SELECT (
  id, tenant_id, entity_type, entity_id, mode, plan_ids,
  one_time_price_cents, one_time_currency,
  teaser_pl, teaser_en,
  password_hint_pl, password_hint_en,
  created_at, updated_at
) ON public.content_access TO anon, authenticated;
