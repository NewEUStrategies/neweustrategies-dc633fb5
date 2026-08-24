DROP FUNCTION IF EXISTS public.admin_event_registration_fields_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_registration_fields_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  field_type text,
  label_pl text,
  label_en text,
  help_pl text,
  help_en text,
  is_required boolean,
  options jsonb,
  sort_order integer,
  is_qualifying boolean,
  qualify_operator text,
  qualify_value jsonb,
  qualify_outcome text,
  is_active boolean,
  answers_count integer,
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
    f.id, f.event_id, f.key, f.field_type, f.label_pl, f.label_en,
    f.help_pl, f.help_en, f.is_required, f.options, f.sort_order,
    f.is_qualifying, f.qualify_operator, f.qualify_value, f.qualify_outcome,
    f.is_active,
    COALESCE(a.cnt, 0)::integer,
    f.created_at, f.updated_at
  FROM public.event_registration_fields f
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_registrations r
    WHERE r.tenant_id = f.tenant_id
      AND r.event_id = f.event_id
      AND r.answers ? f.key
  ) a ON true
  WHERE f.tenant_id = v_tenant AND f.event_id = p_event_id
  ORDER BY f.sort_order, f.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_fields_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_fields_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_fields_list(uuid) IS
  'Pola formularza zapisu wydarzenia z licznikiem zlozonych odpowiedzi. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_registration_field_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_registration_field_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_label_pl text := btrim(COALESCE(p_payload->>'label_pl', ''));
  v_label_en text := btrim(COALESCE(p_payload->>'label_en', ''));
  v_options jsonb := COALESCE(p_payload->'options', '[]'::jsonb);
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT f.event_id INTO v_event_id
    FROM public.event_registration_fields f
    WHERE f.id = v_id AND f.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: field does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_label_pl = '' OR v_label_en = '' THEN
    RAISE EXCEPTION 'invalid_labels: the label is required in both languages';
  END IF;

  IF jsonb_typeof(v_options) <> 'array' THEN
    RAISE EXCEPTION 'invalid_options: options must be a JSON array';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_registration_fields f SET
      field_type = COALESCE(NULLIF(p_payload->>'field_type', ''), f.field_type),
      label_pl = v_label_pl,
      label_en = v_label_en,
      help_pl = COALESCE(btrim(p_payload->>'help_pl'), f.help_pl),
      help_en = COALESCE(btrim(p_payload->>'help_en'), f.help_en),
      is_required = COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, f.is_required),
      options = CASE WHEN p_payload ? 'options' THEN v_options ELSE f.options END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, f.sort_order),
      is_qualifying = COALESCE((NULLIF(p_payload->>'is_qualifying', ''))::boolean, f.is_qualifying),
      qualify_operator = COALESCE(NULLIF(p_payload->>'qualify_operator', ''), f.qualify_operator),
      qualify_value = CASE
        WHEN p_payload ? 'qualify_value' THEN COALESCE(p_payload->'qualify_value', 'null'::jsonb)
        ELSE f.qualify_value
      END,
      qualify_outcome = COALESCE(NULLIF(p_payload->>'qualify_outcome', ''), f.qualify_outcome),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, f.is_active)
    WHERE f.id = v_id AND f.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_registration_fields (
    tenant_id, event_id, key, field_type, label_pl, label_en, help_pl, help_en,
    is_required, options, sort_order, is_qualifying,
    qualify_operator, qualify_value, qualify_outcome, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key,
    COALESCE(NULLIF(p_payload->>'field_type', ''), 'text'),
    v_label_pl, v_label_en,
    COALESCE(btrim(p_payload->>'help_pl'), ''),
    COALESCE(btrim(p_payload->>'help_en'), ''),
    COALESCE((NULLIF(p_payload->>'is_required', ''))::boolean, false),
    v_options,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_qualifying', ''))::boolean, false),
    COALESCE(NULLIF(p_payload->>'qualify_operator', ''), 'none'),
    COALESCE(p_payload->'qualify_value', 'null'::jsonb),
    COALESCE(NULLIF(p_payload->>'qualify_outcome', ''), 'approval'),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_field_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_field_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_field_upsert(jsonb) IS
  'Dodanie albo edycja pola formularza zapisu. Klucz jest niezmienny po zapisie (odpowiedzi siedza pod nim w answers).';

DROP FUNCTION IF EXISTS public.admin_event_registration_field_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_registration_field_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  DELETE FROM public.event_registration_fields f
  WHERE f.id = _id AND f.tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: field does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_field_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_field_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_field_delete(uuid) IS
  'Usuwa definicje pola formularza. Zlozone odpowiedzi ZOSTAJA w answers pod swoim kluczem - panel pokazuje je jako pole usuniete, bo skasowanie odpowiedzi razem z pytaniem bylo by utrata danych zgloszenia.';

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
    COALESCE(c.pending, 0)::integer,
    COALESCE(c.waitlist, 0)::integer,
    t.created_at, t.updated_at
  FROM public.event_ticket_types t
  LEFT JOIN public.event_groups g
    ON g.id = t.group_id AND g.tenant_id = t.tenant_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE r.status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE r.status = 'waitlist')::integer AS waitlist
    FROM public.event_registrations r
    WHERE r.tenant_id = t.tenant_id AND r.ticket_type_id = t.id
  ) c ON true
  WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_tickets_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_tickets_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_tickets_list(uuid) IS
  'Bilety wydarzenia z wolnymi miejscami, stanem sprzedazy i licznikami zgloszen oczekujacych i rezerwowych. Stan sprzedazy liczy serwer, nie klient.';

DROP FUNCTION IF EXISTS public.admin_event_ticket_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_ticket_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
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

  IF v_id IS NOT NULL THEN
    UPDATE public.event_ticket_types t SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), t.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), t.description_en),
      price_cents = COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, t.price_cents),
      currency = COALESCE(NULLIF(p_payload->>'currency', ''), t.currency),
      quota = CASE WHEN p_payload ? 'quota' THEN v_quota ELSE t.quota END,
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

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  INSERT INTO public.event_ticket_types (
    tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
    price_cents, currency, quota, sales_from, sales_to, min_tier_rank,
    requires_approval, group_id, is_active, sort_order
  ) VALUES (
    v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
    COALESCE(btrim(p_payload->>'description_pl'), ''),
    COALESCE(btrim(p_payload->>'description_en'), ''),
    COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, 0),
    COALESCE(NULLIF(p_payload->>'currency', ''), 'PLN'),
    (NULLIF(p_payload->>'quota', ''))::integer,
    (NULLIF(p_payload->>'sales_from', ''))::timestamptz,
    (NULLIF(p_payload->>'sales_to', ''))::timestamptz,
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'requires_approval', ''))::boolean, false),
    v_group_id,
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_upsert(jsonb) IS
  'Dodanie albo edycja biletu wydarzenia. Klucz niezmienny po zapisie. Pula nie da sie zejsc pod liczbe zajetych miejsc.';

DROP FUNCTION IF EXISTS public.admin_event_ticket_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_ticket_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_ticket_types t WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: ticket does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant AND r.ticket_type_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'ticket_in_use: % registration(s) use this ticket', v_used;
  END IF;

  DELETE FROM public.event_ticket_types t WHERE t.id = _id AND t.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_delete(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_ticket_delete(uuid) IS
  'Usuwa bilet wydarzenia. Odmawia, gdy jakikolwiek zapis go uzywa - wtedy poprawna operacja jest wylaczenie (is_active = false).';