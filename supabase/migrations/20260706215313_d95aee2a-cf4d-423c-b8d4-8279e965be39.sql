-- Extend crm_upsert_from_form with optional _custom jsonb payload (append-only)
-- so custom form fields defined per-widget (hybrid model) land in CRM aliases.

CREATE OR REPLACE FUNCTION public.crm_upsert_from_form(
  _tenant uuid,
  _email text,
  _first_name text,
  _last_name text,
  _phone text,
  _company text,
  _position text,
  _linkedin text,
  _country text,
  _source text,
  _custom jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email_norm text := lower(btrim(coalesce(_email, '')));
  v_phone_norm text := regexp_replace(coalesce(_phone,''), '[^0-9+]', '', 'g');
  v_company_id uuid;
  v_lead_id uuid;
  v_existing public.crm_leads%ROWTYPE;
  v_key text;
  v_val text;
  v_aliases jsonb;
BEGIN
  IF v_email_norm = '' THEN RETURN NULL; END IF;
  IF v_phone_norm = '' THEN v_phone_norm := NULL; END IF;

  IF _company IS NOT NULL AND btrim(_company) <> '' THEN
    INSERT INTO public.crm_companies (tenant_id, name)
    VALUES (_tenant, btrim(_company))
    ON CONFLICT (tenant_id, name_norm) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_company_id;
  END IF;

  SELECT * INTO v_existing FROM public.crm_leads
   WHERE tenant_id = _tenant AND email_norm = v_email_norm LIMIT 1;

  IF v_existing.id IS NULL AND _first_name IS NOT NULL AND _last_name IS NOT NULL
     AND btrim(_first_name) <> '' AND btrim(_last_name) <> '' THEN
    SELECT * INTO v_existing FROM public.crm_leads
     WHERE tenant_id = _tenant
       AND lower(btrim(coalesce(first_name,''))) = lower(btrim(_first_name))
       AND lower(btrim(coalesce(last_name,'')))  = lower(btrim(_last_name))
       AND (v_company_id IS NULL OR company_id IS NULL OR company_id = v_company_id)
     LIMIT 1;
  END IF;

  IF v_existing.id IS NOT NULL THEN
    UPDATE public.crm_leads SET
      first_name    = COALESCE(NULLIF(first_name,''), _first_name),
      last_name     = COALESCE(NULLIF(last_name,''),  _last_name),
      phone         = COALESCE(NULLIF(phone,''),      _phone),
      phone_norm    = COALESCE(phone_norm,            v_phone_norm),
      company       = COALESCE(NULLIF(company,''),    _company),
      position      = COALESCE(NULLIF(position,''),   _position),
      linkedin_url  = COALESCE(NULLIF(linkedin_url,''), _linkedin),
      country       = COALESCE(NULLIF(country,''),    _country),
      company_id    = COALESCE(company_id,            v_company_id),
      aliases = public.jsonb_append_distinct(
                  public.jsonb_append_distinct(
                    public.jsonb_append_distinct(
                      public.jsonb_append_distinct(
                        public.jsonb_append_distinct(
                          public.jsonb_append_distinct(
                            public.jsonb_append_distinct(aliases, 'emails',
                              CASE WHEN v_email_norm <> lower(btrim(coalesce(v_existing.email,''))) THEN v_email_norm END),
                            'phones', CASE WHEN _phone IS NOT NULL AND v_existing.phone IS DISTINCT FROM _phone THEN _phone END),
                          'companies', CASE WHEN _company IS NOT NULL AND v_existing.company IS DISTINCT FROM _company THEN _company END),
                        'positions', CASE WHEN _position IS NOT NULL AND v_existing.position IS DISTINCT FROM _position THEN _position END),
                      'linkedins', CASE WHEN _linkedin IS NOT NULL AND v_existing.linkedin_url IS DISTINCT FROM _linkedin THEN _linkedin END),
                    'countries', CASE WHEN _country IS NOT NULL AND v_existing.country IS DISTINCT FROM _country THEN _country END),
                  'sources', _source),
      source_count = source_count + 1,
      last_activity_at = now(),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING id, aliases INTO v_lead_id, v_aliases;
  ELSE
    INSERT INTO public.crm_leads (
      tenant_id, email_norm, email, first_name, last_name,
      phone, phone_norm, company, company_id, position, linkedin_url, country,
      stage, tags, aliases, newsletter_status, marketing_consent, source_count, last_activity_at
    ) VALUES (
      _tenant, v_email_norm, _email, NULLIF(btrim(coalesce(_first_name,'')),''), NULLIF(btrim(coalesce(_last_name,'')),''),
      _phone, v_phone_norm, _company, v_company_id, _position, _linkedin, _country,
      'new', ARRAY[]::text[],
      CASE WHEN _source IS NOT NULL THEN jsonb_build_object('sources', jsonb_build_array(_source)) ELSE '{}'::jsonb END,
      'pending', false, 1, now()
    ) RETURNING id, aliases INTO v_lead_id, v_aliases;
  END IF;

  -- Append custom field values (append-only history under aliases.custom.<field>)
  IF _custom IS NOT NULL AND jsonb_typeof(_custom) = 'object' THEN
    FOR v_key, v_val IN
      SELECT key, value::text FROM jsonb_each_text(_custom)
    LOOP
      IF v_val IS NULL OR btrim(v_val) = '' THEN CONTINUE; END IF;
      -- Ensure aliases.custom is an object
      IF v_aliases IS NULL OR NOT (v_aliases ? 'custom') OR jsonb_typeof(v_aliases->'custom') <> 'object' THEN
        v_aliases := jsonb_set(COALESCE(v_aliases, '{}'::jsonb), '{custom}', '{}'::jsonb, true);
      END IF;
      -- Append distinct into aliases.custom.<key> array
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          COALESCE(v_aliases#>ARRAY['custom', v_key], '[]'::jsonb)
        ) x WHERE x = v_val
      ) THEN
        v_aliases := jsonb_set(
          v_aliases,
          ARRAY['custom', v_key],
          COALESCE(v_aliases#>ARRAY['custom', v_key], '[]'::jsonb) || to_jsonb(v_val),
          true
        );
      END IF;
    END LOOP;

    UPDATE public.crm_leads SET aliases = v_aliases, updated_at = now()
     WHERE id = v_lead_id;
  END IF;

  RETURN v_lead_id;
END $function$;