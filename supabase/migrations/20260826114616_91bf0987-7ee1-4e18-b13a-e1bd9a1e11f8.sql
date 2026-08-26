GRANT SELECT (
  format,
  guest_mode,
  street_address,
  city,
  region,
  postal_code,
  country,
  video_header_platform,
  video_header_id,
  social_hashtag,
  support_email,
  languages,
  branding,
  home_design,
  pages_display_mode,
  root_page_id,
  published_at
) ON public.events TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.event_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  menu_label_pl text,
  menu_label_en text,
  icon text,
  color text,
  in_menu boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  visible_to_groups uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_pages_unique UNIQUE (tenant_id, event_id, page_id),
  CONSTRAINT event_pages_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_pages_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_pages_color_check
    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT event_pages_icon_check
    CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{1,48}$')
);

CREATE INDEX IF NOT EXISTS event_pages_event_idx
  ON public.event_pages (tenant_id, event_id, sort_order);
CREATE INDEX IF NOT EXISTS event_pages_page_idx
  ON public.event_pages (tenant_id, page_id);

COMMENT ON TABLE public.event_pages IS
  'Mapowanie strona (public.pages) -> menu wydarzenia: etykieta, ikona, kolor, kolejnosc, widocznosc per grupa. Trescia strony nadal jest wiersz pages.';

ALTER TABLE public.event_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_pages staff read" ON public.event_pages;
CREATE POLICY "event_pages staff read" ON public.event_pages
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "event_pages staff write" ON public.event_pages;
CREATE POLICY "event_pages staff write" ON public.event_pages
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

REVOKE ALL ON public.event_pages FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_pages TO authenticated;
GRANT ALL ON public.event_pages TO service_role;

DROP TRIGGER IF EXISTS trg_event_pages_touch ON public.event_pages;
CREATE TRIGGER trg_event_pages_touch
  BEFORE UPDATE ON public.event_pages
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public._event_page_path(_page_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain AS (
    SELECT p.id, p.parent_id, p.tenant_id, p.slug::text AS acc, 1 AS depth
    FROM public.pages p
    WHERE p.id = _page_id
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.tenant_id,
           parent.slug || '/' || chain.acc, chain.depth + 1
    FROM public.pages parent
    JOIN chain ON parent.id = chain.parent_id
    WHERE chain.depth < 10
      AND parent.tenant_id = chain.tenant_id
  )
  SELECT acc FROM chain ORDER BY depth DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._event_page_path(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_page_path(uuid) TO service_role;

COMMENT ON FUNCTION public._event_page_path(uuid) IS
  'Publiczna sciezka strony zlozona z lancucha slugow rodzicow (maks. 10 poziomow). Pomocnik wewnetrzny.';

CREATE OR REPLACE FUNCTION public._event_page_chain_published(_page_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH RECURSIVE chain AS (
    SELECT p.id, p.parent_id, p.tenant_id, p.status::text AS status,
           p.deleted_at, 1 AS depth
    FROM public.pages p
    WHERE p.id = _page_id
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.tenant_id, parent.status::text,
           parent.deleted_at, chain.depth + 1
    FROM public.pages parent
    JOIN chain ON parent.id = chain.parent_id
    WHERE chain.depth < 10
      AND parent.tenant_id = chain.tenant_id
  )
  SELECT NOT EXISTS (
    SELECT 1 FROM chain WHERE chain.status <> 'published' OR chain.deleted_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public._event_page_chain_published(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_page_chain_published(uuid) TO service_role;

COMMENT ON FUNCTION public._event_page_chain_published(uuid) IS
  'Czy strona i WSZYSCY jej przodkowie sa opublikowani i nieusunieci - ten sam warunek, ktory stawia resolve_path. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public.admin_event_pages_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_pages_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  page_id uuid,
  page_slug text,
  page_path text,
  page_status text,
  title_pl text,
  title_en text,
  menu_label_pl text,
  menu_label_en text,
  icon text,
  color text,
  in_menu boolean,
  sort_order integer,
  visible_to_groups uuid[],
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_root uuid;
BEGIN
  SELECT e.root_page_id INTO v_root
  FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;

  RETURN QUERY
  SELECT
    ep.id,
    pg.id,
    pg.slug,
    public._event_page_path(pg.id),
    pg.status::text,
    pg.title_pl,
    pg.title_en,
    ep.menu_label_pl,
    ep.menu_label_en,
    ep.icon,
    ep.color,
    COALESCE(ep.in_menu, false),
    COALESCE(ep.sort_order, 0),
    COALESCE(ep.visible_to_groups, '{}'::uuid[]),
    pg.updated_at
  FROM public.pages pg
  LEFT JOIN public.event_pages ep
    ON ep.page_id = pg.id AND ep.event_id = p_event_id AND ep.tenant_id = v_tenant
  WHERE pg.tenant_id = v_tenant
    AND pg.deleted_at IS NULL
    AND (
      ep.id IS NOT NULL
      OR (v_root IS NOT NULL AND pg.parent_id = v_root)
    )
  ORDER BY COALESCE(ep.in_menu, false) DESC, COALESCE(ep.sort_order, 0), pg.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_pages_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_pages_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_pages_list(uuid) IS
  'Podstrony wydarzenia: przypiete (event_pages) oraz nieprzypiete strony z poddrzewa korzenia. id IS NULL = jeszcze nieprzypieta.';

DROP FUNCTION IF EXISTS public.admin_event_page_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_page_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_page_id uuid := NULLIF(p_payload->>'page_id', '')::uuid;
  v_icon text := NULLIF(btrim(COALESCE(p_payload->>'icon', '')), '');
  v_color text := NULLIF(upper(btrim(COALESCE(p_payload->>'color', ''))), '');
  v_groups uuid[];
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT ep.event_id, ep.page_id INTO v_event_id, v_page_id
    FROM public.event_pages ep
    WHERE ep.id = v_id AND ep.tenant_id = v_tenant;
    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'not_found: menu entry does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL OR v_page_id IS NULL THEN
    RAISE EXCEPTION 'invalid_page: event and page are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pages pg
    WHERE pg.id = v_page_id AND pg.tenant_id = v_tenant AND pg.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_found: page does not exist in this tenant';
  END IF;

  IF v_icon IS NOT NULL AND v_icon !~ '^[a-z0-9-]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_icon: icon must be a kebab-case name';
  END IF;

  IF v_color IS NOT NULL AND v_color !~ '^#[0-9A-F]{6}$' THEN
    RAISE EXCEPTION 'invalid_color: color must be a #RRGGBB value';
  END IF;

  v_groups := COALESCE((
    SELECT array_agg(value::uuid)
    FROM jsonb_array_elements_text(COALESCE(p_payload->'visible_to_groups', '[]'::jsonb)) AS value
  ), '{}'::uuid[]);

  IF EXISTS (
    SELECT 1 FROM unnest(v_groups) AS gid
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_groups g
      WHERE g.id = gid AND g.tenant_id = v_tenant AND g.event_id = v_event_id
    )
  ) THEN
    RAISE EXCEPTION 'invalid_group: one of the groups does not belong to this event';
  END IF;

  INSERT INTO public.event_pages (
    id, tenant_id, event_id, page_id,
    menu_label_pl, menu_label_en, icon, color,
    in_menu, sort_order, visible_to_groups, updated_at
  ) VALUES (
    COALESCE(v_id, gen_random_uuid()), v_tenant, v_event_id, v_page_id,
    NULLIF(btrim(COALESCE(p_payload->>'menu_label_pl', '')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'menu_label_en', '')), ''),
    v_icon, v_color,
    COALESCE((NULLIF(p_payload->>'in_menu', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 0),
    v_groups, now()
  )
  ON CONFLICT (tenant_id, event_id, page_id) DO UPDATE SET
    menu_label_pl = EXCLUDED.menu_label_pl,
    menu_label_en = EXCLUDED.menu_label_en,
    icon = EXCLUDED.icon,
    color = EXCLUDED.color,
    in_menu = EXCLUDED.in_menu,
    sort_order = EXCLUDED.sort_order,
    visible_to_groups = EXCLUDED.visible_to_groups,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_page_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_page_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_page_upsert(jsonb) IS
  'Przypina strone do menu wydarzenia albo zmienia jej etykiete, ikone, kolor, kolejnosc i widocznosc per grupa. Grupa spoza wydarzenia jest odrzucana.';

DROP FUNCTION IF EXISTS public.admin_event_page_detach(p_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_page_detach(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_deleted integer;
BEGIN
  DELETE FROM public.event_pages ep
  WHERE ep.id = p_id AND ep.tenant_id = v_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_page_detach(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_page_detach(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_page_detach(uuid) IS
  'Odpina strone od menu wydarzenia. NIE usuwa wiersza pages - tresc zostaje.';

DROP FUNCTION IF EXISTS public.admin_event_pages_reorder(p_event_id uuid, p_ids uuid[]);
CREATE OR REPLACE FUNCTION public.admin_event_pages_reorder(p_event_id uuid, p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_count integer;
BEGIN
  UPDATE public.event_pages ep
  SET sort_order = ordered.position * 10, updated_at = now()
  FROM (
    SELECT id, row_number() OVER () AS position
    FROM unnest(p_ids) AS id
  ) AS ordered
  WHERE ep.id = ordered.id
    AND ep.tenant_id = v_tenant
    AND ep.event_id = p_event_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_pages_reorder(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_pages_reorder(uuid, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_pages_reorder(uuid, uuid[]) IS
  'Ustawia kolejnosc pozycji menu wydarzenia jednym zapisem, w kolejnosci przekazanej tablicy.';

CREATE OR REPLACE FUNCTION public._event_slugify(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT left(
    btrim(
      regexp_replace(
        lower(translate(
          COALESCE(_text, ''),
          'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
          'acelnoszzACELNOSZZ'
        )),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    ),
    110
  );
$$;

REVOKE ALL ON FUNCTION public._event_slugify(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_slugify(text) TO service_role;

COMMENT ON FUNCTION public._event_slugify(text) IS
  'Tytul -> slug: transliteracja polskich znakow do ASCII, reszta na myslniki, maks. 110 znakow. Pomocnik wewnetrzny.';

CREATE OR REPLACE FUNCTION public._event_unique_page_slug(_tenant uuid, _base text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base text := public._event_slugify(_base);
  v_slug text;
  v_suffix integer := 1;
BEGIN
  IF char_length(v_base) < 3 THEN v_base := 'strona'; END IF;
  v_slug := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.pages pg
    WHERE pg.tenant_id = _tenant AND pg.slug = v_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_base, 105) || '-' || v_suffix::text;
  END LOOP;
  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public._event_unique_page_slug(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_unique_page_slug(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_unique_page_slug(uuid, text) IS
  'Wolny slug strony w tenancie: baza z transliteracji plus numer przy kolizji. Pomocnik wewnetrzny.';

DROP FUNCTION IF EXISTS public.admin_event_page_create(p_payload jsonb);
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
        tenant_id, parent_id, slug, title_pl, title_en, status, editor, template_type, menu_order
      ) VALUES (
        v_tenant, v_root, v_slug, v_title_pl, v_title_en, 'draft', 'builder', 'default', 0
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
  'Zaklada podstrone wydarzenia: korzen (gdy brak), strone w pages i wiersz event_pages - jedna transakcja, zeby nie powstala strona bez wydarzenia.';

DROP FUNCTION IF EXISTS public.event_menu(p_slug text);
CREATE OR REPLACE FUNCTION public.event_menu(p_slug text)
RETURNS TABLE (
  id uuid,
  page_id uuid,
  label_pl text,
  label_en text,
  icon text,
  color text,
  path text,
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
  v_registration uuid;
  v_groups uuid[] := '{}'::uuid[];
BEGIN
  SELECT e.id INTO v_event_id
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.slug = p_slug
    AND e.status = 'published';

  IF v_event_id IS NULL THEN RETURN; END IF;

  v_registration := public._event_meeting_caller_registration(v_tenant, v_event_id);
  IF v_registration IS NOT NULL THEN
    v_groups := ARRAY(
      SELECT g FROM public._event_meeting_groups(v_tenant, v_event_id, v_registration) AS g
    );
  END IF;

  RETURN QUERY
  SELECT
    ep.id,
    pg.id,
    COALESCE(NULLIF(btrim(ep.menu_label_pl), ''), pg.title_pl),
    COALESCE(NULLIF(btrim(ep.menu_label_en), ''), pg.title_en),
    ep.icon,
    ep.color,
    public._event_page_path(pg.id),
    ep.sort_order
  FROM public.event_pages ep
  JOIN public.pages pg
    ON pg.id = ep.page_id AND pg.tenant_id = ep.tenant_id
  WHERE ep.tenant_id = v_tenant
    AND ep.event_id = v_event_id
    AND ep.in_menu
    AND pg.deleted_at IS NULL
    AND pg.status = 'published'
    AND public._event_page_chain_published(pg.id)
    AND (
      cardinality(ep.visible_to_groups) = 0
      OR ep.visible_to_groups && v_groups
    )
  ORDER BY ep.sort_order, pg.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.event_menu(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_menu(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_menu(text) IS
  'Menu podstron opublikowanego wydarzenia widziane przez wolajacego. Pozycja bez grup jest publiczna; z grupami - tylko dla uczestnika z pasujacego zapisu.';