ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS benefits_pl text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS benefits_en text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS price_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.event_ticket_types
  DROP CONSTRAINT IF EXISTS event_ticket_types_price_schedule_array;
ALTER TABLE public.event_ticket_types
  ADD CONSTRAINT event_ticket_types_price_schedule_array
  CHECK (jsonb_typeof(price_schedule) = 'array' AND jsonb_array_length(price_schedule) <= 12);

COMMENT ON COLUMN public.event_ticket_types.benefits_pl IS
  'Lista korzysci biletu (PL) pokazywana na karcie biletu.';
COMMENT ON COLUMN public.event_ticket_types.benefits_en IS
  'Lista korzysci biletu (EN) pokazywana na karcie biletu.';
COMMENT ON COLUMN public.event_ticket_types.price_schedule IS
  'Progi cenowe w czasie: [{label_pl,label_en,from,to,price_cents}]. Pierwszy pasujacy prog wygrywa, potem early bird, potem cena bazowa.';

CREATE OR REPLACE FUNCTION public._event_ticket_phase(
  p_price_cents integer,
  p_early_price_cents integer,
  p_early_until timestamptz,
  p_schedule jsonb,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH phases AS (
    SELECT
      (NULLIF(e->>'price_cents', ''))::integer AS price_cents,
      (NULLIF(e->>'from', ''))::timestamptz AS from_at,
      (NULLIF(e->>'to', ''))::timestamptz AS to_at,
      COALESCE(e->>'label_pl', '') AS label_pl,
      COALESCE(e->>'label_en', '') AS label_en,
      ord
    FROM jsonb_array_elements(COALESCE(p_schedule, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    WHERE jsonb_typeof(e) = 'object'
  ),
  active AS (
    SELECT * FROM phases
    WHERE price_cents IS NOT NULL
      AND (from_at IS NULL OR p_at >= from_at)
      AND (to_at IS NULL OR p_at <= to_at)
    ORDER BY ord
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'source', 'schedule',
       'price_cents', price_cents,
       'label_pl', label_pl,
       'label_en', label_en,
       'ends_at', to_at)
     FROM active),
    CASE
      WHEN p_early_price_cents IS NOT NULL
        AND p_early_until IS NOT NULL
        AND p_at <= p_early_until
      THEN jsonb_build_object(
        'source', 'early_bird',
        'price_cents', p_early_price_cents,
        'label_pl', '',
        'label_en', '',
        'ends_at', p_early_until)
      ELSE jsonb_build_object(
        'source', 'standard',
        'price_cents', COALESCE(p_price_cents, 0),
        'label_pl', '',
        'label_en', '',
        'ends_at', NULL)
    END
  );
$$;

CREATE OR REPLACE FUNCTION public._event_ticket_price_now(
  p_price_cents integer,
  p_early_price_cents integer,
  p_early_until timestamptz,
  p_schedule jsonb
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT (public._event_ticket_phase(
    p_price_cents, p_early_price_cents, p_early_until, p_schedule, now())->>'price_cents')::integer;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_ticket_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
  v_benefits_pl text[];
  v_benefits_en text[];
  v_schedule jsonb;
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

  IF p_payload ? 'benefits_pl' THEN
    SELECT COALESCE(array_agg(left(btrim(value), 200)) FILTER (WHERE btrim(value) <> ''), '{}'::text[])
    INTO v_benefits_pl
    FROM jsonb_array_elements_text(COALESCE(p_payload->'benefits_pl', '[]'::jsonb)) AS value;
    IF COALESCE(array_length(v_benefits_pl, 1), 0) > 20 THEN
      RAISE EXCEPTION 'invalid_benefits: at most 20 benefits per ticket';
    END IF;
  END IF;

  IF p_payload ? 'benefits_en' THEN
    SELECT COALESCE(array_agg(left(btrim(value), 200)) FILTER (WHERE btrim(value) <> ''), '{}'::text[])
    INTO v_benefits_en
    FROM jsonb_array_elements_text(COALESCE(p_payload->'benefits_en', '[]'::jsonb)) AS value;
    IF COALESCE(array_length(v_benefits_en, 1), 0) > 20 THEN
      RAISE EXCEPTION 'invalid_benefits: at most 20 benefits per ticket';
    END IF;
  END IF;

  IF p_payload ? 'price_schedule' THEN
    IF jsonb_typeof(p_payload->'price_schedule') <> 'array' THEN
      RAISE EXCEPTION 'invalid_price_schedule: the schedule must be a list of phases';
    END IF;
    v_schedule := p_payload->'price_schedule';
    IF jsonb_array_length(v_schedule) > 12 THEN
      RAISE EXCEPTION 'invalid_price_schedule: at most 12 pricing phases';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_schedule) AS e
      WHERE jsonb_typeof(e) <> 'object'
         OR (NULLIF(e->>'price_cents', ''))::integer IS NULL
         OR (NULLIF(e->>'price_cents', ''))::integer < 0
         OR (NULLIF(e->>'price_cents', ''))::integer > 10000000
         OR (
              (NULLIF(e->>'from', ''))::timestamptz IS NOT NULL
              AND (NULLIF(e->>'to', ''))::timestamptz IS NOT NULL
              AND (NULLIF(e->>'to', ''))::timestamptz <= (NULLIF(e->>'from', ''))::timestamptz
            )
    ) THEN
      RAISE EXCEPTION 'invalid_price_schedule: each phase needs a valid price and a window that ends after it starts';
    END IF;
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
      benefits_pl = CASE WHEN p_payload ? 'benefits_pl' THEN v_benefits_pl ELSE t.benefits_pl END,
      benefits_en = CASE WHEN p_payload ? 'benefits_en' THEN v_benefits_en ELSE t.benefits_en END,
      price_schedule = CASE WHEN p_payload ? 'price_schedule' THEN v_schedule ELSE t.price_schedule END,
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
    access_code_hash, access_code_hint, waitlist_enabled,
    benefits_pl, benefits_en, price_schedule
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
    COALESCE((NULLIF(p_payload->>'waitlist_enabled', ''))::boolean, true),
    COALESCE(v_benefits_pl, '{}'::text[]),
    COALESCE(v_benefits_en, '{}'::text[]),
    COALESCE(v_schedule, '[]'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_event_tickets_list(uuid);
CREATE FUNCTION public.admin_event_tickets_list(p_event_id uuid)
RETURNS TABLE(
  id uuid, event_id uuid, key text, name_pl text, name_en text,
  description_pl text, description_en text, price_cents integer, currency text,
  early_bird_price_cents integer, early_bird_until timestamptz,
  effective_price_cents integer, price_schedule jsonb, current_phase jsonb,
  benefits_pl text[], benefits_en text[],
  has_access_code boolean, access_code_hint text, waitlist_enabled boolean,
  quota integer, sold_count integer, seats_left integer,
  sales_from timestamptz, sales_to timestamptz, min_tier_rank integer,
  requires_approval boolean, group_id uuid, group_name_pl text, group_name_en text,
  is_active boolean, sort_order integer, availability text,
  pending_count integer, waitlist_count integer,
  created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.description_pl, t.description_en, t.price_cents, t.currency,
    t.early_bird_price_cents, t.early_bird_until,
    public._event_ticket_price_now(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule),
    t.price_schedule,
    public._event_ticket_phase(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now()),
    t.benefits_pl, t.benefits_en,
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
$function$;

REVOKE ALL ON FUNCTION public.admin_event_tickets_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_tickets_list(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.event_ticket_checkout_quote(
  p_ticket_type_id uuid,
  p_access_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  t public.event_ticket_types;
  e public.events;
  v_phase jsonb;
  v_seats integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to buy a ticket';
  END IF;
  IF v_tenant IS NULL OR p_ticket_type_id IS NULL THEN
    RAISE EXCEPTION 'ticket_not_available';
  END IF;

  SELECT * INTO t FROM public.event_ticket_types x
  WHERE x.id = p_ticket_type_id AND x.tenant_id = v_tenant;
  IF t.id IS NULL OR NOT t.is_active THEN
    RAISE EXCEPTION 'ticket_not_available';
  END IF;

  SELECT * INTO e FROM public.events x
  WHERE x.id = t.event_id AND x.tenant_id = v_tenant AND x.status = 'published';
  IF e.id IS NULL OR e.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ticket_not_available';
  END IF;
  IF e.starts_at IS NOT NULL AND e.starts_at < now() THEN
    RAISE EXCEPTION 'event_finished';
  END IF;

  IF t.sales_from IS NOT NULL AND now() < t.sales_from THEN
    RAISE EXCEPTION 'ticket_sales_not_open';
  END IF;
  IF t.sales_to IS NOT NULL AND now() > t.sales_to THEN
    RAISE EXCEPTION 'ticket_sales_closed';
  END IF;
  IF t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank) THEN
    RAISE EXCEPTION 'ticket_tier_required';
  END IF;
  IF t.access_code_hash IS NOT NULL THEN
    IF p_access_code IS NULL
      OR encode(digest(upper(btrim(p_access_code)), 'sha256'), 'hex') <> t.access_code_hash THEN
      RAISE EXCEPTION 'ticket_access_code_invalid';
    END IF;
  END IF;

  v_seats := public._event_seats_left(v_tenant, t.event_id, t.id);
  IF v_seats IS NOT NULL AND v_seats <= 0 THEN
    RAISE EXCEPTION 'ticket_sold_out';
  END IF;

  v_phase := public._event_ticket_phase(
    t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now());

  RETURN jsonb_build_object(
    'ticket_type_id', t.id,
    'event_id', t.event_id,
    'event_slug', e.slug,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'name_pl', t.name_pl,
    'name_en', t.name_en,
    'amount_cents', (v_phase->>'price_cents')::integer,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'seats_left', v_seats,
    'phase', v_phase
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.event_ticket_checkout_quote(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ticket_checkout_quote(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_ticket_checkout_quote(uuid, text) IS
  'Serwerowa wycena biletu przed platnoscia: prog cenowy, okno sprzedazy, miejsca, ranga czlonkostwa i kod dostepu. Klient nigdy nie podaje kwoty.';

CREATE OR REPLACE FUNCTION public.event_registration_form(p_event_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_slug text := NULLIF(btrim(COALESCE(p_event_slug, '')), '');
  v_seats_left integer;
  v_reason text;
  v_fields jsonb;
  v_tickets jsonb;
  v_terms jsonb;
  v_active_tickets integer;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  v_seats_left := public._event_seats_left(v_tenant, v_event.id, NULL);

  SELECT count(*)::integer INTO v_active_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  v_reason := CASE
    WHEN v_event.cancelled_at IS NOT NULL THEN 'event_cancelled'
    WHEN v_event.registration_mode = 'none' THEN 'registration_disabled'
    WHEN v_event.registration_mode = 'external' THEN 'registration_external'
    WHEN v_event.rsvp_opens_at IS NOT NULL
      AND v_event.rsvp_opens_at > now()
      AND NOT (
        v_event.early_rsvp_rank IS NOT NULL
        AND public.has_tier_rank(v_event.early_rsvp_rank)
      ) THEN 'registration_not_open'
    WHEN v_event.visibility = 'members'
      AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN 'membership_required'
    WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'
    ELSE NULL
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'key', f.key,
    'field_type', f.field_type,
    'label_pl', f.label_pl,
    'label_en', f.label_en,
    'help_pl', f.help_pl,
    'help_en', f.help_en,
    'is_required', f.is_required,
    'options', f.options,
    'sort_order', f.sort_order
  ) ORDER BY f.sort_order, f.key), '[]'::jsonb)
  INTO v_fields
  FROM public.event_registration_fields f
  WHERE f.tenant_id = v_tenant
    AND f.event_id = v_event.id
    AND f.is_active
    AND f.field_type <> 'consent';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'key', t.key,
    'name_pl', t.name_pl,
    'name_en', t.name_en,
    'description_pl', t.description_pl,
    'description_en', t.description_en,
    'price_cents', t.price_cents,
    'effective_price_cents', public._event_ticket_price_now(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule),
    'phase', public._event_ticket_phase(
      t.price_cents, t.early_bird_price_cents, t.early_bird_until, t.price_schedule, now()),
    'benefits_pl', to_jsonb(t.benefits_pl),
    'benefits_en', to_jsonb(t.benefits_en),
    'requires_access_code', (t.access_code_hash IS NOT NULL),
    'access_code_hint', t.access_code_hint,
    'currency', t.currency,
    'requires_approval', t.requires_approval,
    'min_tier_rank', t.min_tier_rank,
    'sales_from', t.sales_from,
    'sales_to', t.sales_to,
    'seats_left', public._event_seats_left(v_tenant, v_event.id, t.id),
    'availability', CASE
      WHEN t.sales_from IS NOT NULL AND now() < t.sales_from THEN 'scheduled'
      WHEN t.sales_to IS NOT NULL AND now() > t.sales_to THEN 'ended'
      WHEN t.quota IS NOT NULL AND t.sold_count >= t.quota THEN 'sold_out'
      ELSE 'on_sale'
    END,
    'tier_locked', (t.min_tier_rank > 0 AND NOT public.has_tier_rank(t.min_tier_rank)),
    'sort_order', t.sort_order
  ) ORDER BY t.sort_order, t.key), '[]'::jsonb)
  INTO v_tickets
  FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant AND t.event_id = v_event.id AND t.is_active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', tr.id,
    'key', tr.key,
    'label_pl', tr.label_pl,
    'label_en', tr.label_en,
    'body_pl', tr.body_pl,
    'body_en', tr.body_en,
    'external_url', tr.external_url,
    'is_required', tr.is_required,
    'version', tr.version,
    'sort_order', tr.sort_order
  ) ORDER BY tr.sort_order, tr.key), '[]'::jsonb)
  INTO v_terms
  FROM public.event_terms tr
  WHERE tr.tenant_id = v_tenant
    AND tr.event_id = v_event.id
    AND tr.is_active
    AND tr.display IN ('registration', 'registration_and_access');

  RETURN jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'slug', v_event.slug,
      'title_pl', v_event.title_pl,
      'title_en', v_event.title_en,
      'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at,
      'timezone', v_event.timezone,
      'registration_mode', v_event.registration_mode,
      'registration_flow', v_event.registration_flow,
      'external_registration_url', v_event.external_registration_url,
      'capacity', v_event.capacity,
      'seats_left', v_seats_left,
      'rsvp_opens_at', v_event.rsvp_opens_at
    ),
    'is_open', (v_reason IS NULL),
    'closed_reason', v_reason,
    'fields', v_fields,
    'tickets', v_tickets,
    'terms', v_terms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_form(text) TO anon, authenticated, service_role;