DROP FUNCTION IF EXISTS public.admin_event_sponsor_material_save(jsonb);
CREATE FUNCTION public.admin_event_sponsor_material_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_event_id uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_url text := btrim(COALESCE(p_payload->>'url', ''));
BEGIN
  IF v_id IS NOT NULL THEN
    IF v_title_pl = '' OR v_title_en = '' THEN
      RAISE EXCEPTION 'invalid_titles: both titles are required';
    END IF;

    UPDATE public.event_sponsor_materials SET
      title_pl = v_title_pl,
      title_en = v_title_en,
      kind = COALESCE(NULLIF(p_payload->>'kind', ''), kind),
      url = COALESCE(NULLIF(btrim(COALESCE(p_payload->>'url', '')), ''), url),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_published = COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, is_published)
    WHERE id = v_id AND tenant_id = v_tenant;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: material does not exist in this tenant';
    END IF;

    RETURN v_id;
  END IF;

  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: sponsor_id is required';
  END IF;
  IF v_title_pl = '' OR v_title_en = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;
  IF v_url = '' THEN
    RAISE EXCEPTION 'invalid_url: url is required';
  END IF;

  SELECT s.event_id INTO v_event_id
  FROM public.event_sponsors s
  WHERE s.id = v_sponsor_id AND s.tenant_id = v_tenant;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  INSERT INTO public.event_sponsor_materials (
    tenant_id, event_id, sponsor_id, title_pl, title_en, kind, url,
    sort_order, is_published, created_by
  ) VALUES (
    v_tenant, v_event_id, v_sponsor_id, v_title_pl, v_title_en,
    COALESCE(NULLIF(p_payload->>'kind', ''), 'document'),
    v_url,
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
    COALESCE((NULLIF(p_payload->>'is_published', ''))::boolean, false),
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_material_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_material_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_material_save(jsonb) IS
  'Dodanie albo edycja materialu sponsora. Przy dodaniu wydarzenie jest brane Z PRZYPIECIA, nie z payloadu - klient nie ma czym rozjechac tej pary. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_material_delete(uuid);
CREATE FUNCTION public.admin_event_sponsor_material_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  DELETE FROM public.event_sponsor_materials
  WHERE id = _id AND tenant_id = v_tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: material does not exist in this tenant';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_material_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_material_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_material_delete(uuid) IS
  'Usuwa jedna pozycje materialow sponsora. Plik w magazynie nie jest ruszany - jego cykl zycia nalezy do magazynu, nie do tej tabeli.';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_materials_reorder(jsonb);
CREATE FUNCTION public.admin_event_sponsor_materials_reorder(p_payload jsonb)
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

  UPDATE public.event_sponsor_materials m
  SET sort_order = i.sort_order
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (x->>'sort_order')::integer AS sort_order
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
      AND NULLIF(x->>'sort_order', '') IS NOT NULL
  ) i
  WHERE m.id = i.id
    AND m.tenant_id = v_tenant
    AND m.sort_order IS DISTINCT FROM i.sort_order;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_materials_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_materials_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_materials_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci materialow sponsora: {"items":[{"id":uuid,"sort_order":int}]}. Zwraca liczbe przestawionych wierszy.';

DROP FUNCTION IF EXISTS public.event_sponsors_public(text);
CREATE FUNCTION public.event_sponsors_public(p_slug text)
RETURNS TABLE (
  tier_id uuid,
  tier_key text,
  tier_name_pl text,
  tier_name_en text,
  tier_description_pl text,
  tier_description_en text,
  tier_rank integer,
  tier_accent_color text,
  tier_logo_size text,
  benefits jsonb,
  sponsors jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH grouped AS (
    SELECT
      s.tier_id AS gid,
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.snapshot_name,
          'logo', COALESCE(s.snapshot_logo_url, ''),
          'url', COALESCE(s.snapshot_website, ''),
          'description_pl', s.snapshot_description_pl,
          'description_en', s.snapshot_description_en,
          'country', s.snapshot_country,
          'role', s.role,
          'booth_label', s.booth_label,
          'sort_order', s.sort_order
        ) ORDER BY s.sort_order, s.snapshot_name
      ) AS items
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant
      AND s.event_id = v_event_id
      AND s.is_published
    GROUP BY s.tier_id
  )
  SELECT
    g.gid,
    t.key,
    t.name_pl,
    t.name_en,
    t.description_pl,
    t.description_en,
    t.rank,
    t.accent_color,
    COALESCE(t.logo_size, 'md'),
    COALESCE(b.items, '[]'::jsonb),
    g.items
  FROM grouped g
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = g.gid AND t.tenant_id = v_tenant
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'label_pl', bn.label_pl,
        'label_en', bn.label_en
      ) ORDER BY bn.sort_order, bn.label_pl
    ) AS items
    FROM public.event_sponsor_tier_benefits bn
    WHERE bn.tenant_id = v_tenant AND bn.tier_id = g.gid
  ) b ON true
  ORDER BY t.rank DESC NULLS LAST, t.sort_order NULLS LAST, t.key NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsors_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sponsors_public(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sponsors_public(text) IS
  'Publiczna lista sponsorow opublikowanego wydarzenia po slugu, pogrupowana po poziomie (grupa bez poziomu na koncu), tylko opublikowane przypiecia, w najemcy z naglowka hosta. Oddaje MIGAWKE, nigdy biezacej kartoteki. Plaszczyzna tresci - zero has_role().';

DROP FUNCTION IF EXISTS public.event_sponsor_materials_public(text);
CREATE FUNCTION public.event_sponsor_materials_public(p_slug text)
RETURNS TABLE (
  id uuid,
  sponsor_id uuid,
  sponsor_name text,
  sponsor_logo_url text,
  tier_id uuid,
  tier_name_pl text,
  tier_name_en text,
  tier_rank integer,
  title_pl text,
  title_en text,
  kind text,
  url text,
  sort_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.id, m.sponsor_id, s.snapshot_name, s.snapshot_logo_url,
    s.tier_id, t.name_pl, t.name_en, t.rank,
    m.title_pl, m.title_en, m.kind, m.url, m.sort_order
  FROM public.event_sponsor_materials m
  JOIN public.event_sponsors s
    ON s.id = m.sponsor_id AND s.tenant_id = m.tenant_id
  LEFT JOIN public.event_sponsor_tiers t
    ON t.id = s.tier_id AND t.tenant_id = s.tenant_id
  WHERE m.tenant_id = v_tenant
    AND m.event_id = v_event_id
    AND m.is_published
    AND s.is_published
  ORDER BY t.rank DESC NULLS LAST, s.sort_order, m.sort_order, m.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.event_sponsor_materials_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_sponsor_materials_public(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_sponsor_materials_public(text) IS
  'Publiczne materialy sponsorow opublikowanego wydarzenia po slugu. Widoczne dopiero gdy material I przypiecie sa opublikowane. Plaszczyzna tresci - zero has_role().';