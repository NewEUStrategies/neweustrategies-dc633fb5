DROP FUNCTION IF EXISTS public.admin_event_sponsor_tiers_list(uuid);
CREATE FUNCTION public.admin_event_sponsor_tiers_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  rank integer,
  accent_color text,
  logo_size text,
  max_companies integer,
  sort_order integer,
  is_active boolean,
  sponsors_count integer,
  published_sponsors_count integer,
  slots_left integer,
  benefits jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    t.id, t.event_id, t.key, t.name_pl, t.name_en,
    t.description_pl, t.description_en, t.rank, t.accent_color, t.logo_size,
    t.max_companies, t.sort_order, t.is_active,
    COALESCE(u.total, 0)::integer,
    COALESCE(u.published, 0)::integer,
    CASE
      WHEN t.max_companies IS NULL THEN NULL
      ELSE GREATEST(t.max_companies - COALESCE(u.total, 0), 0)
    END::integer,
    COALESCE(b.items, '[]'::jsonb),
    t.created_at, t.updated_at
  FROM public.event_sponsor_tiers t
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE s.is_published)::integer AS published
    FROM public.event_sponsors s
    WHERE s.tenant_id = v_tenant AND s.tier_id = t.id
  ) u ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', bn.id,
        'label_pl', bn.label_pl,
        'label_en', bn.label_en,
        'sort_order', bn.sort_order
      ) ORDER BY bn.sort_order, bn.label_pl
    ) AS items
    FROM public.event_sponsor_tier_benefits bn
    WHERE bn.tenant_id = v_tenant AND bn.tier_id = t.id
  ) b ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.rank DESC, t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tiers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tiers_list(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tiers_list(uuid) IS
  'Poziomy sponsorskie wydarzenia dla panelu: liczniki przypiec, wolne miejsca i swiadczenia w jednym wierszu. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_tier_save(jsonb);
CREATE FUNCTION public.admin_event_sponsor_tier_save(p_payload jsonb)
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
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_max integer;
  v_used integer;
BEGIN
  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: both names are required';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT t.event_id INTO v_event_id
    FROM public.event_sponsor_tiers t
    WHERE t.id = v_id AND t.tenant_id = v_tenant;
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this tenant';
    END IF;

    IF p_payload ? 'max_companies' THEN
      v_max := (NULLIF(p_payload->>'max_companies', ''))::integer;
      IF v_max IS NOT NULL THEN
        SELECT count(*)::integer INTO v_used
        FROM public.event_sponsors s
        WHERE s.tenant_id = v_tenant AND s.tier_id = v_id;
        IF v_used > v_max THEN
          RAISE EXCEPTION
            'tier_over_capacity: % company(ies) already pinned, limit % is lower',
            v_used, v_max;
        END IF;
      END IF;
    END IF;

    UPDATE public.event_sponsor_tiers SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), description_en),
      rank = COALESCE((NULLIF(p_payload->>'rank', ''))::integer, rank),
      accent_color = CASE
        WHEN p_payload ? 'accent_color'
          THEN NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), '')
        ELSE accent_color
      END,
      logo_size = COALESCE(NULLIF(p_payload->>'logo_size', ''), logo_size),
      max_companies = CASE
        WHEN p_payload ? 'max_companies'
          THEN (NULLIF(p_payload->>'max_companies', ''))::integer
        ELSE max_companies
      END,
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, sort_order),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, is_active)
    WHERE id = v_id AND tenant_id = v_tenant;
  ELSE
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'invalid_event: event_id is required';
    END IF;
    IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
      RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'not_found: event does not exist in this tenant';
    END IF;

    INSERT INTO public.event_sponsor_tiers (
      tenant_id, event_id, key, name_pl, name_en, description_pl, description_en,
      rank, accent_color, logo_size, max_companies, sort_order, is_active
    ) VALUES (
      v_tenant, v_event_id, v_key, v_name_pl, v_name_en,
      COALESCE(btrim(p_payload->>'description_pl'), ''),
      COALESCE(btrim(p_payload->>'description_en'), ''),
      COALESCE((NULLIF(p_payload->>'rank', ''))::integer, 0),
      NULLIF(btrim(COALESCE(p_payload->>'accent_color', '')), ''),
      COALESCE(NULLIF(p_payload->>'logo_size', ''), 'md'),
      (NULLIF(p_payload->>'max_companies', ''))::integer,
      COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100),
      COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true)
    )
    RETURNING id INTO v_id;
  END IF;

  IF COALESCE(jsonb_typeof(p_payload->'benefits') = 'array', false) THEN
    DELETE FROM public.event_sponsor_tier_benefits b
    WHERE b.tenant_id = v_tenant AND b.tier_id = v_id;

    INSERT INTO public.event_sponsor_tier_benefits (
      tenant_id, event_id, tier_id, label_pl, label_en, sort_order
    )
    SELECT
      v_tenant,
      v_event_id,
      v_id,
      btrim(x->>'label_pl'),
      btrim(x->>'label_en'),
      COALESCE((NULLIF(x->>'sort_order', ''))::integer, (ord * 10)::integer)
    FROM jsonb_array_elements(p_payload->'benefits') WITH ORDINALITY AS t(x, ord)
    WHERE btrim(COALESCE(x->>'label_pl', '')) <> ''
      AND btrim(COALESCE(x->>'label_en', '')) <> '';
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tier_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tier_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tier_save(jsonb) IS
  'Dodanie albo edycja poziomu sponsorskiego razem ze swiadczeniami (klucz "benefits" = pelna podmiana listy; brak klucza = lista nietknieta). Klucz poziomu jest niezmienny po zapisie. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_tier_delete(uuid);
CREATE FUNCTION public.admin_event_sponsor_tier_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_sponsor_tiers t
    WHERE t.id = _id AND t.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: sponsorship tier does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_sponsors s
  WHERE s.tenant_id = v_tenant AND s.tier_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'tier_in_use: % company(ies) still pinned to this tier', v_used;
  END IF;

  DELETE FROM public.event_sponsor_tiers WHERE id = _id AND tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tier_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tier_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tier_delete(uuid) IS
  'Usuwa poziom sponsorski, do ktorego nie jest przypieta zadna firma. Poziom w uzyciu jest odrzucany bledem tier_in_use z liczba firm. Swiadczenia ida kaskada.';

DROP FUNCTION IF EXISTS public.admin_event_sponsor_tiers_reorder(jsonb);
CREATE FUNCTION public.admin_event_sponsor_tiers_reorder(p_payload jsonb)
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
    RAISE EXCEPTION 'invalid_payload: items must be an array of {id, sort_order, rank}';
  END IF;

  UPDATE public.event_sponsor_tiers t
  SET sort_order = COALESCE(i.sort_order, t.sort_order),
      rank = COALESCE(i.rank, t.rank)
  FROM (
    SELECT
      (x->>'id')::uuid AS id,
      (NULLIF(x->>'sort_order', ''))::integer AS sort_order,
      (NULLIF(x->>'rank', ''))::integer AS rank
    FROM jsonb_array_elements(p_payload->'items') AS x
    WHERE NULLIF(x->>'id', '') IS NOT NULL
  ) i
  WHERE t.id = i.id
    AND t.tenant_id = v_tenant
    AND (
      t.sort_order IS DISTINCT FROM COALESCE(i.sort_order, t.sort_order)
      OR t.rank IS DISTINCT FROM COALESCE(i.rank, t.rank)
    );

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_tiers_reorder(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_tiers_reorder(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_tiers_reorder(jsonb) IS
  'Wsadowa zmiana kolejnosci i rangi poziomow: {"items":[{"id":uuid,"sort_order":int,"rank":int}]}. Pole nieobecne w pozycji zostaje bez zmian. Zwraca liczbe przestawionych wierszy.';

DROP FUNCTION IF EXISTS public._event_sponsor_web_url(text);
CREATE FUNCTION public._event_sponsor_web_url(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_raw IS NULL OR btrim(p_raw) = '' THEN NULL
    WHEN btrim(p_raw) ~ '^https?://' THEN left(btrim(p_raw), 500)
    ELSE left('https://' || btrim(p_raw), 500)
  END;
$$;

REVOKE ALL ON FUNCTION public._event_sponsor_web_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_sponsor_web_url(text) TO service_role;

COMMENT ON FUNCTION public._event_sponsor_web_url(text) IS
  'Domyka schemat adresu strony firmy z kartoteki (wolny tekst) do postaci nadajacej sie do atrybutu href. JEDNO zrodlo tej logiki dla zapisu migawki i dla liczenia rozjazdu.';