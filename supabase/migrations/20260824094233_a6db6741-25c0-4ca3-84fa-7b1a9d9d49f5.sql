DROP FUNCTION IF EXISTS public.admin_event_sponsor_snapshot_refresh(jsonb);
CREATE FUNCTION public.admin_event_sponsor_snapshot_refresh(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_has_ids boolean := COALESCE(jsonb_typeof(p_payload->'ids') = 'array', false);
  v_include_manual boolean :=
    COALESCE((NULLIF(p_payload->>'include_manual', ''))::boolean, false);
  v_changed integer := 0;
  v_rec record;
BEGIN
  IF NOT v_has_ids AND v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: pass ids (array) or event_id';
  END IF;

  FOR v_rec IN
    UPDATE public.event_sponsors s
    SET snapshot_name = btrim(c.name),
        snapshot_logo_url = NULLIF(btrim(COALESCE(c.logo_url, '')), ''),
        snapshot_website = public._event_sponsor_web_url(c.website),
        snapshot_country = NULLIF(btrim(COALESCE(c.country, '')), ''),
        snapshot_source = 'crm',
        snapshot_taken_at = now()
    FROM public.crm_companies c
    WHERE c.id = s.company_id
      AND c.tenant_id = s.tenant_id
      AND s.tenant_id = v_tenant
      AND btrim(c.name) <> ''
      AND (v_include_manual OR s.snapshot_source = 'crm')
      AND (
        (v_has_ids AND s.id IN (
          SELECT x::uuid
          FROM jsonb_array_elements_text(p_payload->'ids') AS x
          WHERE NULLIF(btrim(x), '') IS NOT NULL
        ))
        OR (NOT v_has_ids AND s.event_id = v_event_id)
      )
      AND (
        btrim(s.snapshot_name) IS DISTINCT FROM btrim(c.name)
        OR btrim(COALESCE(s.snapshot_logo_url, ''))
           IS DISTINCT FROM btrim(COALESCE(c.logo_url, ''))
        OR COALESCE(s.snapshot_website, '')
           IS DISTINCT FROM COALESCE(public._event_sponsor_web_url(c.website), '')
        OR btrim(COALESCE(s.snapshot_country, ''))
           IS DISTINCT FROM btrim(COALESCE(c.country, ''))
      )
    RETURNING s.id, s.event_id, s.company_id
  LOOP
    v_changed := v_changed + 1;
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_sponsor',
      v_rec.id::text,
      'event_sponsor.snapshot_refreshed.v1',
      jsonb_build_object(
        'event_id', v_rec.event_id, 'sponsor_id', v_rec.id, 'company_id', v_rec.company_id
      ),
      auth.uid()
    );
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_snapshot_refresh(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_snapshot_refresh(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_snapshot_refresh(jsonb) IS
  'Jawne odswiezenie migawki prezentacji z kartoteki: {"ids":[uuid]} albo {"event_id":uuid}, opcjonalnie {"include_manual":true}. Dotyka nazwy, logotypu, adresu strony i kraju; opisu NIGDY. Zwraca liczbe faktycznie zmienionych przypiec.';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_companies_search(uuid, text, integer);
CREATE FUNCTION public.admin_event_sponsor_companies_search(
  p_event_id uuid,
  p_q text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  name text,
  domain text,
  website text,
  city text,
  country text,
  logo_url text,
  is_pinned boolean,
  pinned_sponsor_id uuid,
  events_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_q text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.name, c.domain, public._event_sponsor_web_url(c.website),
    c.city, c.country, c.logo_url,
    (pin.id IS NOT NULL),
    pin.id,
    COALESCE(u.cnt, 0)::integer
  FROM public.crm_companies c
  LEFT JOIN LATERAL (
    SELECT s.id
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = p_event_id
      AND s.company_id = c.id
    LIMIT 1
  ) pin ON true
  LEFT JOIN LATERAL (
    SELECT count(DISTINCT s2.event_id)::integer AS cnt
    FROM public.event_sponsors s2
    WHERE s2.tenant_id = v_tenant AND s2.company_id = c.id
  ) u ON true
  WHERE c.tenant_id = v_tenant
    AND (
      v_q IS NULL
      OR c.name ILIKE '%' || v_q || '%'
      OR c.domain ILIKE '%' || v_q || '%'
      OR c.city ILIKE '%' || v_q || '%'
    )
  ORDER BY
    (pin.id IS NOT NULL),
    CASE WHEN v_q IS NULL THEN NULL ELSE position(lower(v_q) IN c.name_norm) END
      NULLS LAST,
    c.name_norm
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_companies_search(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_companies_search(uuid, text, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_companies_search(uuid, text, integer) IS
  'Wyszukiwarka firm z kartoteki do przypiecia: minimum kolumn, flaga is_pinned dla tego wydarzenia i licznik wydarzen firmy. Skalowana po tenancie domowym. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_contacts_set(jsonb);
CREATE FUNCTION public.admin_event_sponsor_contacts_set(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_event_id uuid;
  v_keep uuid[] := ARRAY[]::uuid[];
  v_count integer := 0;
  v_ord integer := 0;
  v_item jsonb;
  v_lead uuid;
  v_role text;
  v_sort integer;
BEGIN
  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: sponsor_id is required';
  END IF;

  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array';
  END IF;

  SELECT s.event_id INTO v_event_id
  FROM public.event_sponsors s
  WHERE s.id = v_sponsor_id AND s.tenant_id = v_tenant;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  FOR v_item IN SELECT x FROM jsonb_array_elements(p_payload->'items') AS x
  LOOP
    v_ord := v_ord + 1;
    v_lead := NULLIF(v_item->>'lead_id', '')::uuid;
    v_role := COALESCE(NULLIF(v_item->>'role', ''), 'primary');
    v_sort := COALESCE((NULLIF(v_item->>'sort_order', ''))::integer, v_ord * 10);

    IF v_lead IS NULL THEN
      RAISE EXCEPTION 'invalid_payload: lead_id is required for every entry';
    END IF;

    IF v_role NOT IN ('primary', 'marketing', 'billing', 'onsite') THEN
      RAISE EXCEPTION 'invalid_role: role must be primary, marketing, billing or onsite';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = v_lead AND l.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'contact_not_found: person does not exist in this tenant';
    END IF;

    INSERT INTO public.event_sponsor_contacts (
      tenant_id, event_id, sponsor_id, lead_id, role, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_sponsor_id, v_lead, v_role, v_sort, auth.uid()
    )
    ON CONFLICT (tenant_id, sponsor_id, lead_id) DO UPDATE
      SET role = EXCLUDED.role,
          sort_order = EXCLUDED.sort_order,
          updated_at = now();

    v_keep := v_keep || v_lead;
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.event_sponsor_contacts k
  WHERE k.tenant_id = v_tenant
    AND k.sponsor_id = v_sponsor_id
    AND NOT (k.lead_id = ANY (v_keep));

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_contacts_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_contacts_set(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_contacts_set(jsonb) IS
  'Wsadowe ustawienie osob kontaktowych przypiecia: {"sponsor_id":uuid,"items":[{"lead_id":uuid,"role":text,"sort_order":int}]}. Osoby nieobecne w items sa odpinane. Osoba spoza kartoteki najemcy zatrzymuje calosc. Zwraca liczbe kontaktow po operacji.';