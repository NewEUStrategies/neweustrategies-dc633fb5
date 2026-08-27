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
  consent_url_pl text,
  consent_url_en text,
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
    f.help_pl, f.help_en, f.consent_url_pl, f.consent_url_en,
    f.is_required, f.options, f.sort_order,
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
  'Pola formularza zapisu wydarzenia z licznikiem odpowiedzi i odnosnikiem dokumentu zgody. Bramka: assert_editor_tenant().';

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
  v_url_pl text := btrim(COALESCE(p_payload->>'consent_url_pl', ''));
  v_url_en text := btrim(COALESCE(p_payload->>'consent_url_en', ''));
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

  IF (v_url_pl <> '' AND (v_url_pl !~ '^https://' OR char_length(v_url_pl) > 500))
     OR (v_url_en <> '' AND (v_url_en !~ '^https://' OR char_length(v_url_en) > 500)) THEN
    RAISE EXCEPTION 'invalid_consent_url: the consent document address must start with https:// and be at most 500 characters';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_registration_fields f SET
      field_type = COALESCE(NULLIF(p_payload->>'field_type', ''), f.field_type),
      label_pl = v_label_pl,
      label_en = v_label_en,
      help_pl = COALESCE(btrim(p_payload->>'help_pl'), f.help_pl),
      help_en = COALESCE(btrim(p_payload->>'help_en'), f.help_en),
      consent_url_pl = CASE WHEN p_payload ? 'consent_url_pl' THEN v_url_pl ELSE f.consent_url_pl END,
      consent_url_en = CASE WHEN p_payload ? 'consent_url_en' THEN v_url_en ELSE f.consent_url_en END,
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
    consent_url_pl, consent_url_en,
    is_required, options, sort_order, is_qualifying,
    qualify_operator, qualify_value, qualify_outcome, is_active
  ) VALUES (
    v_tenant, v_event_id, v_key,
    COALESCE(NULLIF(p_payload->>'field_type', ''), 'text'),
    v_label_pl, v_label_en,
    COALESCE(btrim(p_payload->>'help_pl'), ''),
    COALESCE(btrim(p_payload->>'help_en'), ''),
    v_url_pl, v_url_en,
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
  'Dodanie albo edycja pola formularza zapisu wraz z odnosnikiem dokumentu zgody. Klucz jest niezmienny po zapisie.';