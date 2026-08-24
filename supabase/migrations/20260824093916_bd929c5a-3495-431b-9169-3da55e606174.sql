DROP FUNCTION IF EXISTS public.admin_event_sponsor_save(jsonb);
CREATE FUNCTION public.admin_event_sponsor_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_company_id uuid := NULLIF(p_payload->>'company_id', '')::uuid;
  v_tier_id uuid;
  v_old_tier_id uuid;
  v_role text;
  v_published boolean;
  v_was_published boolean;
  v_manual boolean := (
    p_payload ? 'snapshot_name'
    OR p_payload ? 'snapshot_logo_url'
    OR p_payload ? 'snapshot_website'
    OR p_payload ? 'snapshot_country'
  );
  v_company public.crm_companies;
  v_max integer;
  v_used integer;
BEGIN
  IF v_id IS NULL THEN
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_event: event_id is required';
    END IF;
    IF v_company_id IS NULL THEN
      RAISE EXCEPTION 'invalid_company: company_id is required';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;

    SELECT * INTO v_company
    FROM public.crm_companies c
    WHERE c.id = v_company_id AND c.tenant_id = v_tenant;

    IF v_company.id IS NULL THEN
      RAISE EXCEPTION 'not_found: company does not exist in this tenant';
    END IF;

    v_tier_id := NULLIF(p_payload->>'tier_id', '')::uuid;
    v_role := COALESCE(NULLIF(p_payload->>'role', ''), 'sponsor');
    v_published := COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, false);

    IF v_published AND v_role = 'sponsor' AND v_tier_id IS NULL THEN
      RAISE EXCEPTION 'sponsor_tier_required: a published sponsor must have a tier';
    END IF;

    IF v_tier_id IS NOT NULL THEN
      SELECT t.max_companies INTO v_max
      FROM public.event_sponsor_tiers t
      WHERE t.id = v_tier_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this event';
      END IF;

      IF v_max IS NOT NULL THEN
        SELECT count(*)::integer INTO v_used
        FROM public.event_sponsors s
        WHERE s.tenant_id = v_tenant AND s.tier_id = v_tier_id;

        IF v_used >= v_max THEN
          RAISE EXCEPTION 'tier_full: tier allows % company(ies), % already pinned',
            v_max, v_used;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.event_sponsors (
      tenant_id, event_id, company_id, tier_id, role, booth_label,
      sort_order, is_published,
      snapshot_name, snapshot_logo_url,
      snapshot_description_pl, snapshot_description_en,
      snapshot_website, snapshot_country,
      snapshot_source, snapshot_taken_at, internal_note, created_by
    ) VALUES (
      v_tenant, v_event_id, v_company_id, v_tier_id, v_role,
      NULLIF(btrim(COALESCE(p_payload->>'booth_label', '')), ''),
      COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
      v_published,
      COALESCE(NULLIF(btrim(COALESCE(p_payload->>'snapshot_name', '')), ''), v_company.name),
      COALESCE(
        NULLIF(btrim(COALESCE(p_payload->>'snapshot_logo_url', '')), ''),
        NULLIF(btrim(COALESCE(v_company.logo_url, '')), '')
      ),
      COALESCE(btrim(p_payload->>'snapshot_description_pl'), ''),
      COALESCE(btrim(p_payload->>'snapshot_description_en'), ''),
      COALESCE(
        public._event_sponsor_web_url(p_payload->>'snapshot_website'),
        public._event_sponsor_web_url(v_company.website)
      ),
      COALESCE(
        NULLIF(btrim(COALESCE(p_payload->>'snapshot_country', '')), ''),
        NULLIF(btrim(COALESCE(v_company.country, '')), '')
      ),
      CASE WHEN v_manual THEN 'manual' ELSE 'crm' END,
      now(),
      NULLIF(btrim(COALESCE(p_payload->>'internal_note', '')), ''),
      auth.uid()
    )
    RETURNING id INTO v_id;

    IF v_published THEN
      PERFORM public.emit_domain_event(
        v_tenant,
        'event_sponsor',
        v_id::text,
        'event_sponsor.published.v1',
        jsonb_build_object(
          'event_id', v_event_id, 'sponsor_id', v_id, 'company_id', v_company_id
        ),
        auth.uid()
      );
    END IF;

    RETURN v_id;
  END IF;

  SELECT s.event_id, s.tier_id, s.role, s.is_published, s.company_id
    INTO v_event_id, v_old_tier_id, v_role, v_was_published, v_company_id
  FROM public.event_sponsors s
  WHERE s.id = v_id AND s.tenant_id = v_tenant;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  v_tier_id := CASE
    WHEN p_payload ? 'tier_id' THEN NULLIF(p_payload->>'tier_id', '')::uuid
    ELSE v_old_tier_id
  END;
  v_role := COALESCE(NULLIF(p_payload->>'role', ''), v_role);
  v_published := COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, v_was_published);

  IF v_published AND v_role = 'sponsor' AND v_tier_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_tier_required: a published sponsor must have a tier';
  END IF;

  IF v_tier_id IS NOT NULL AND v_tier_id IS DISTINCT FROM v_old_tier_id THEN
    SELECT t.max_companies INTO v_max
    FROM public.event_sponsor_tiers t
    WHERE t.id = v_tier_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this event';
    END IF;

    IF v_max IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used
      FROM public.event_sponsors s
      WHERE s.tenant_id = v_tenant AND s.tier_id = v_tier_id AND s.id <> v_id;

      IF v_used >= v_max THEN
        RAISE EXCEPTION 'tier_full: tier allows % company(ies), % already pinned',
          v_max, v_used;
      END IF;
    END IF;
  END IF;

  UPDATE public.event_sponsors SET
    tier_id = v_tier_id,
    role = v_role,
    is_published = v_published,
    booth_label = CASE
      WHEN p_payload ? 'booth_label'
        THEN NULLIF(btrim(COALESCE(p_payload->>'booth_label', '')), '')
      ELSE booth_label
    END,
    sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
    snapshot_name = COALESCE(
      NULLIF(btrim(COALESCE(p_payload->>'snapshot_name', '')), ''), snapshot_name
    ),
    snapshot_logo_url = CASE
      WHEN p_payload ? 'snapshot_logo_url'
        THEN NULLIF(btrim(COALESCE(p_payload->>'snapshot_logo_url', '')), '')
      ELSE snapshot_logo_url
    END,
    snapshot_description_pl = COALESCE(
      btrim(p_payload->>'snapshot_description_pl'), snapshot_description_pl
    ),
    snapshot_description_en = COALESCE(
      btrim(p_payload->>'snapshot_description_en'), snapshot_description_en
    ),
    snapshot_website = CASE
      WHEN p_payload ? 'snapshot_website'
        THEN public._event_sponsor_web_url(p_payload->>'snapshot_website')
      ELSE snapshot_website
    END,
    snapshot_country = CASE
      WHEN p_payload ? 'snapshot_country'
        THEN NULLIF(btrim(COALESCE(p_payload->>'snapshot_country', '')), '')
      ELSE snapshot_country
    END,
    snapshot_source = CASE WHEN v_manual THEN 'manual' ELSE snapshot_source END,
    snapshot_taken_at = CASE WHEN v_manual THEN now() ELSE snapshot_taken_at END,
    internal_note = CASE
      WHEN p_payload ? 'internal_note'
        THEN NULLIF(btrim(COALESCE(p_payload->>'internal_note', '')), '')
      ELSE internal_note
    END
  WHERE id = v_id AND tenant_id = v_tenant;

  IF v_published IS DISTINCT FROM v_was_published THEN
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_sponsor',
      v_id::text,
      CASE WHEN v_published
        THEN 'event_sponsor.published.v1'
        ELSE 'event_sponsor.unpublished.v1'
      END,
      jsonb_build_object(
        'event_id', v_event_id, 'sponsor_id', v_id, 'company_id', v_company_id
      ),
      auth.uid()
    );
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_save(jsonb) IS
  'Dodanie albo edycja przypiecia firmy do wydarzenia. Przy dodaniu migawka powstaje z kartoteki; recznie podane pole kartoteczne przestawia snapshot_source na manual. Firma jest niezmienna po zapisie. Limit poziomu egzekwowany blokada wiersza. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_delete(uuid);
CREATE FUNCTION public.admin_event_sponsor_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  DELETE FROM public.event_sponsors
  WHERE id = _id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_delete(uuid) IS
  'Usuwa przypiecie firmy do wydarzenia razem z jego osobami kontaktowymi i materialami (kaskada). Firma w kartotece zostaje nietknieta.';

DROP FUNCTION IF EXISTS public.admin_event_sponsors_reorder(jsonb);
CREATE FUNCTION public.admin_event_sponsors_reorder(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_moved integer;
BEGIN
  IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order}';
  END IF;

  UPDATE public.event_sponsors s
  SET sort_order = i.sort_order
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (x->>'sort_order')::integer AS sort_order
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
      AND NULLIF(x->>'sort_order', '') IS NOT NULL
  ) i
  WHERE s.id = i.id
    AND s.tenant_id = v_tenant
    AND s.sort_order IS DISTINCT FROM i.sort_order;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsors_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsors_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsors_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci przypiec: {"items":[{"id":uuid,"sort_order":int}]}. Zwraca liczbe przestawionych wierszy. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsors_set_published(jsonb);
CREATE FUNCTION public.admin_event_sponsors_set_published(p_payload jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_publish boolean := COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, true);
  v_blocked integer;
  v_changed integer := 0;
  v_rec record;
BEGIN
  IF jsonb_typeof(p_payload->'ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_payload: ids must be an array of uuid';
  END IF;

  IF v_publish THEN
    SELECT count(*)::integer INTO v_blocked
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.role = 'sponsor'
      AND s.tier_id IS NULL
      AND s.id IN (
        SELECT x::uuid
        FROM jsonb_array_elements_text(p_payload->'ids') AS x
        WHERE NULLIF(btrim(x), '') IS NOT NULL
      );

    IF v_blocked > 0 THEN
      RAISE EXCEPTION 'sponsor_tier_required: % sponsor(s) in the selection have no tier',
        v_blocked;
    END IF;
  END IF;

  FOR v_rec IN
    UPDATE public.event_sponsors s
    SET is_published = v_publish
    WHERE s.tenant_id = v_tenant
      AND s.is_published IS DISTINCT FROM v_publish
      AND s.id IN (
        SELECT x::uuid
        FROM jsonb_array_elements_text(p_payload->'ids') AS x
        WHERE NULLIF(btrim(x), '') IS NOT NULL
      )
    RETURNING s.id, s.event_id, s.company_id
  LOOP
    v_changed := v_changed + 1;
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_sponsor',
      v_rec.id::text,
      CASE WHEN v_publish
        THEN 'event_sponsor.published.v1'
        ELSE 'event_sponsor.unpublished.v1'
      END,
      jsonb_build_object(
        'event_id', v_rec.event_id, 'sponsor_id', v_rec.id, 'company_id', v_rec.company_id
      ),
      auth.uid()
    );
  END LOOP;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsors_set_published(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsors_set_published(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsors_set_published(jsonb) IS
  'Wsadowa publikacja albo wycofanie przypiec: {"ids":[uuid],"is_published":bool}. Sponsor bez poziomu blokuje calosc bledem sponsor_tier_required. Zwraca liczbe zmienionych wierszy.';