-- Szablony podstron wydarzenia: `admin_event_page_create` przyjmuje gotowy
-- dokument buildera.
--
-- DLACZEGO PRZEZ RPC, A NIE UPDATE Z KLIENTA. Zalozenie strony to jedna
-- transakcja (korzen + strona + wiersz menu). Doklejenie tresci osobnym
-- UPDATE-em z przegladarki zostawialoby okno, w ktorym strona istnieje pusta,
-- a przy bledzie sieci - na stale.
--
-- DOKUMENT JEST WALIDOWANY TUTAJ, nie tylko w kliencie: `builder_data` czyta
-- publiczny renderer, wiec kształt musi bronic sam RPC.
CREATE OR REPLACE FUNCTION public.admin_event_page_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_builder jsonb := p_payload->'builder_data';
  v_event public.events;
  v_root uuid;
  v_slug_base text;
  v_slug text;
  v_page_id uuid;
  v_next integer;
  v_entry uuid;
  v_try integer;
BEGIN
  IF v_title_pl = '' OR v_title_en = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  -- BRAK KLUCZA I `null` ZNACZA „bez szablonu" - pusta strona robocza.
  IF v_builder IS NOT NULL AND jsonb_typeof(v_builder) = 'null' THEN
    v_builder := NULL;
  END IF;

  IF v_builder IS NOT NULL THEN
    IF jsonb_typeof(v_builder) <> 'object'
       OR COALESCE((v_builder->>'version')::int, 0) <> 1
       OR jsonb_typeof(v_builder->'sections') <> 'array' THEN
      RAISE EXCEPTION 'invalid_builder_data: expected {version:1, sections:[]}';
    END IF;
  END IF;

  SELECT * INTO v_event FROM public.events e
  WHERE e.id = v_event_id AND e.tenant_id = v_tenant;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  v_root := v_event.root_page_id;

  IF v_root IS NULL THEN
    FOR v_try IN 1..5 LOOP
      BEGIN
        INSERT INTO public.pages (
          tenant_id, slug, title_pl, title_en, status, editor, template_type, menu_order
        ) VALUES (
          v_tenant,
          public._event_unique_page_slug(v_tenant, v_event.slug),
          v_event.title_pl, v_event.title_en, 'draft', 'builder', 'default', 0
        )
        RETURNING id INTO v_root;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;

    UPDATE public.events e SET root_page_id = v_root, updated_at = now()
    WHERE e.id = v_event_id AND e.tenant_id = v_tenant;
  END IF;

  v_slug_base := public._event_slugify(v_title_pl);
  IF char_length(v_slug_base) < 3 THEN v_slug_base := 'strona'; END IF;

  FOR v_try IN 1..5 LOOP
    BEGIN
      v_slug := public._event_unique_page_slug(v_tenant, v_slug_base);
      INSERT INTO public.pages (
        tenant_id, parent_id, slug, title_pl, title_en, status, editor, template_type,
        menu_order, builder_data
      ) VALUES (
        v_tenant, v_root, v_slug, v_title_pl, v_title_en, 'draft', 'builder', 'default',
        0, v_builder
      )
      RETURNING id INTO v_page_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try = 5 THEN RAISE; END IF;
    END;
  END LOOP;

  SELECT COALESCE(max(ep.sort_order), 0) + 10 INTO v_next
  FROM public.event_pages ep
  WHERE ep.tenant_id = v_tenant AND ep.event_id = v_event_id;

  INSERT INTO public.event_pages (
    tenant_id, event_id, page_id, icon, in_menu, sort_order
  ) VALUES (
    v_tenant, v_event_id, v_page_id,
    NULLIF(btrim(COALESCE(p_payload->>'icon', '')), ''),
    COALESCE((NULLIF(p_payload->>'in_menu', ''))::boolean, true),
    v_next
  )
  RETURNING id INTO v_entry;

  RETURN v_entry;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_page_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_page_create(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_page_create(jsonb) IS
  'Zaklada podstrone wydarzenia: korzen (gdy brak), strone w pages z opcjonalnym dokumentem buildera z szablonu i wiersz event_pages - jedna transakcja.';