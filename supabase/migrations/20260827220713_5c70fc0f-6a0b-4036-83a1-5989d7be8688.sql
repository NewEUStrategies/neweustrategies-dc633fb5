-- 1. BILETY: kod dostepu, early-bird, lista rezerwowa -----------------------
ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS access_code_hash text,
  ADD COLUMN IF NOT EXISTS access_code_hint text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS early_bird_price_cents integer,
  ADD COLUMN IF NOT EXISTS early_bird_until timestamptz,
  ADD COLUMN IF NOT EXISTS waitlist_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.event_ticket_types
  DROP CONSTRAINT IF EXISTS event_ticket_types_early_bird_pair;
ALTER TABLE public.event_ticket_types
  ADD CONSTRAINT event_ticket_types_early_bird_pair CHECK (
    (early_bird_price_cents IS NULL AND early_bird_until IS NULL)
    OR (
      early_bird_price_cents IS NOT NULL
      AND early_bird_until IS NOT NULL
      AND early_bird_price_cents >= 0
      AND early_bird_price_cents <= price_cents
    )
  );

ALTER TABLE public.event_ticket_types
  DROP CONSTRAINT IF EXISTS event_ticket_types_access_code_hint_len;
ALTER TABLE public.event_ticket_types
  ADD CONSTRAINT event_ticket_types_access_code_hint_len
    CHECK (char_length(access_code_hint) <= 120);

COMMENT ON COLUMN public.event_ticket_types.access_code_hash IS
  'SHA-256 kodu dostepu (hex). Kod jawny nigdy nie jest przechowywany ani zwracany.';
COMMENT ON COLUMN public.event_ticket_types.early_bird_price_cents IS
  'Cena obowiazujaca do early_bird_until wlacznie; potem obowiazuje price_cents.';
COMMENT ON COLUMN public.event_ticket_types.waitlist_enabled IS
  'Gdy false, brak miejsc konczy zapis bledem sold_out zamiast lista rezerwowa.';

-- 2. POLA FORMULARZA: odnosnik do dokumentu zgody ----------------------------
ALTER TABLE public.event_registration_fields
  ADD COLUMN IF NOT EXISTS consent_url_pl text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS consent_url_en text NOT NULL DEFAULT '';

ALTER TABLE public.event_registration_fields
  DROP CONSTRAINT IF EXISTS event_registration_fields_consent_urls;
ALTER TABLE public.event_registration_fields
  ADD CONSTRAINT event_registration_fields_consent_urls CHECK (
    (consent_url_pl = '' OR consent_url_pl ~ '^https://')
    AND (consent_url_en = '' OR consent_url_en ~ '^https://')
    AND char_length(consent_url_pl) <= 500
    AND char_length(consent_url_en) <= 500
  );

-- 3. Cena obowiazujaca dzis --------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_ticket_effective_price(
  p_price_cents integer,
  p_early_price_cents integer,
  p_early_until timestamptz
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_early_price_cents IS NOT NULL
      AND p_early_until IS NOT NULL
      AND now() <= p_early_until
      THEN p_early_price_cents
    ELSE p_price_cents
  END;
$$;

REVOKE ALL ON FUNCTION public._event_ticket_effective_price(integer, integer, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._event_ticket_effective_price(integer, integer, timestamptz)
  TO anon, authenticated, service_role;

-- 4. Lista biletow dla redaktora --------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_tickets_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_tickets_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  price_cents integer,
  currency text,
  early_bird_price_cents integer,
  early_bird_until timestamptz,
  effective_price_cents integer,
  has_access_code boolean,
  access_code_hint text,
  waitlist_enabled boolean,
  quota integer,
  sold_count integer,
  seats_left integer,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer,
  requires_approval boolean,
  group_id uuid,
  group_name_pl text,
  group_name_en text,
  is_active boolean,
  sort_order integer,
  availability text,
  pending_count integer,
  waitlist_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.description_pl, t.description_en, t.price_cents, t.currency,
    t.early_bird_price_cents, t.early_bird_until,
    public._event_ticket_effective_price(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until),
    (t.access_code_hash IS NOT NULL), t.access_code_hint, t.waitlist_enabled,
    t.quota, t.sold_count,
    public._event_seats_left(v_tenant, t.event_id, t.id),
    t.sales_from, t.sales_to, t.min_tier_rank, t.requires_approval,
    t.group_id, g.name_pl, g.name_en,
    t.is_active, t.sort_order,
    CASE
      WHEN NOT t.is_active THEN 'inactive'
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale'
    END,
    (SELECT count(*)::integer FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.ticket_type_id = t.id AND r.status = 'pending'),
    (SELECT count(*)::integer FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.ticket_type_id = t.id AND r.status = 'waitlist'),
    t.created_at, t.updated_at
  FROM public.event_ticket_types t
  LEFT JOIN public.event_groups g
    ON g.id = t.group_id AND g.tenant_id = v_tenant
  WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_tickets_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_tickets_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_tickets_list(uuid) IS
  'Bilety wydarzenia: cena i cena early-bird, kod dostepu tylko jako fakt i podpowiedz, lista rezerwowa, wolne miejsca i liczniki zgloszen.';

-- 5. Zapis biletu przez redaktora -------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_ticket_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_ticket_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_group_id uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_quota integer;
  v_sold integer;
  v_code text := btrim(COALESCE(p_payload->>'access_code', ''));
  v_has_code_key boolean := p_payload ? 'access_code';
  v_code_hash text;
  v_early_price integer;
  v_early_until timestamptz;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT t.event_id, t.sold_count INTO v_event_id, v_sold
    FROM public.event_ticket_types t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: ticket does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  IF v_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_groups g
    WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: group does not exist for this event';
  END IF;

  IF p_payload ? 'quota' THEN
    v_quota := (NULLIF(p_payload->>'quota', ''))::integer;
    IF v_quota IS NOT NULL AND v_id IS NOT NULL AND v_quota < COALESCE(v_sold, 0) THEN
      RAISE EXCEPTION 'quota_below_sold: % seats are already taken', v_sold;
    END IF;
  END IF;

  IF v_has_code_key AND v_code <> '' THEN
    IF char_length(v_code) < 4 OR char_length(v_code) > 64 THEN
      RAISE EXCEPTION 'invalid_access_code: the code must have 4 to 64 characters';
    END IF;
    v_code_hash := encode(digest(upper(v_code), 'sha256'), 'hex');
  END IF;

  v_early_price := (NULLIF(p_payload->>'early_bird_price_cents', ''))::integer;
  v_early_until := (NULLIF(p_payload->>'early_bird_until', ''))::timestamptz;
  IF (v_early_price IS NULL) <> (v_early_until IS NULL) THEN
    RAISE EXCEPTION 'invalid_early_bird: the early-bird price and its deadline go together';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_ticket_types t SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), t.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), t.description_en),
      price_cents = COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, t.price_cents),
      currency = COALESCE(NULLIF(p_payload->>'currency', ''), t.currency),
      quota = CASE WHEN p_payload ? 'quota' THEN v_quota ELSE t.quota END,
      early_bird_price_cents = CASE
        WHEN p_payload ? 'early_bird_price_cents' THEN v_early_price
        ELSE t.early_bird_price_cents
      END,
      early_bird_until = CASE
        WHEN p_payload ? 'early_bird_price_cents' THEN v_early_until
        ELSE t.early_bird_until
      END,
      access_code_hash = CASE
        WHEN NOT v_has_code_key THEN t.access_code_hash
        WHEN v_code = '' THEN NULL
        ELSE v_code_hash
      END,
      access_code_hint = CASE
        WHEN p_payload ? 'access_code_hint'
          THEN left(btrim(COALESCE(p_payload->>'access_code_hint', '')), 120)
        ELSE t.access_code_hint
      END,
      waitlist_enabled =
        COALESCE((NULLIF(p_payload->>'waitlist_enabled', ''))::boolean, t.waitlist_enabled),
      sales_from = CASE
        WHEN p_payload ? 'sales_from' THEN (NULLIF(p_payload->>'sales_from', ''))::timestamptz
        ELSE t.sales_from
      END,
      sales_to = CASE
        WHEN p_payload ? 'sales_to' THEN (NULLIF(p_payload->>'sales_to', ''))::timestamptz
        ELSE t.sales_to
      END,
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, t.min_tier_rank),
      requires_approval =
        COALESCE((NULLIF(p_payload->>'requires_approval', ''))::boolean, t.requires_approval),
      group_id = CASE WHEN p_payload ? 'group_id' THEN v_group_id ELSE t.group_id END,
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, t.is_active),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, t.sort_order)
    WHERE t.id = v_id AND t.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  INSERT INTO public.event_ticket_types (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    price_cents, currency, quota, sales_from, sales_to, min_tier_rank,
    requires_approval, group_id, is_active, sort_order,
    early_bird_price_cents, early_bird_until,
    access_code_hash, access_code_hint, waitlist_enabled
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    btrim(COALESCE(p_payload->>'description_pl', '')),
    btrim(COALESCE(p_payload->>'description_en', '')),
    COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, 0),
    COALESCE(NULLIF(p_payload->>'currency', ''), 'PLN'),
    (NULLIF(p_payload->>'quota', ''))::integer,
    (NULLIF(p_payload->>'sales_from', ''))::timestamptz,
    (NULLIF(p_payload->>'sales_to', ''))::timestamptz,
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'requires_approval', ''))::boolean, false),
    v_group_id,
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 0),
    v_early_price, v_early_until,
    v_code_hash,
    left(btrim(COALESCE(p_payload->>'access_code_hint', '')), 120),
    COALESCE((NULLIF(p_payload->>'waitlist_enabled', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_upsert(jsonb) IS
  'Dodanie albo edycja biletu. Kod dostepu zapisywany jako skrot SHA-256 (puste = kasowanie), early-bird w parze cena+termin, pula nie schodzi ponizej sprzedanych.';

-- 6. Zapis pola formularza: odnosnik do dokumentu zgody ----------------------
CREATE OR REPLACE FUNCTION public._event_consent_url(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_value, '')) = '' THEN ''
    WHEN btrim(p_value) ~ '^https://' THEN left(btrim(p_value), 500)
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public._event_consent_url(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._event_consent_url(text) TO authenticated, service_role;
