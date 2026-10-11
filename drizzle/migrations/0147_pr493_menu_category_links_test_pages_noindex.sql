-- PR #493: replay of 20261011090000, 20261011090100, 20261011090200 (bodies identical to repo files).
CREATE OR REPLACE FUNCTION public._menu_items_prune_dead(_item_ids uuid[])
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_dead uuid[] := COALESCE(_item_ids, '{}'::uuid[]);
  v_round integer := 0;
  v_rows integer;
  v_total integer := 0;
BEGIN
  IF cardinality(v_dead) = 0 THEN
    RETURN 0;
  END IF;
  LOOP
    v_round := v_round + 1;
    DELETE FROM public.menu_items mi
     WHERE mi.id = ANY (v_dead)
       AND NOT EXISTS (SELECT 1 FROM public.menu_items c WHERE c.parent_id = mi.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
    EXIT WHEN v_rows = 0 OR v_round >= 10;
  END LOOP;
  UPDATE public.menu_items mi
     SET item_type = 'custom'::public.menu_item_type, ref_id = NULL, href = ''
   WHERE mi.id = ANY (v_dead)
     AND (mi.item_type <> 'custom'::public.menu_item_type OR mi.ref_id IS NOT NULL OR mi.href <> '');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_total + v_rows;
END;
$$;
COMMENT ON FUNCTION public._menu_items_prune_dead(uuid[]) IS
  'Usuwa martwe pozycje menu: liść kasuje (rundami, więc martwy rodzic martwych dzieci też znika), a pozycję z żywymi dziećmi zamienia w nagłówek bez linku (custom, pusty href, bez ref_id). Wołający odpowiada za zakres najemcy listy identyfikatorów. Pomocnik wewnętrzny.';
REVOKE ALL ON FUNCTION public._menu_items_prune_dead(uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._categories_sync_menu_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_dead uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      UPDATE public.menu_items mi
         SET href = CASE WHEN mi.href LIKE '/en/%' THEN '/en/category/' ELSE '/category/' END || NEW.slug
        FROM public.menus m
       WHERE m.id = mi.menu_id
         AND m.tenant_id = NEW.tenant_id
         AND (
           (mi.item_type = 'category'::public.menu_item_type AND mi.ref_id = NEW.id)
           OR (
             mi.ref_id IS NULL
             AND mi.item_type IN ('category'::public.menu_item_type, 'custom'::public.menu_item_type)
             AND mi.href IN ('/category/' || OLD.slug, '/en/category/' || OLD.slug)
           )
         );
    END IF;
    RETURN NULL;
  END IF;
  SELECT COALESCE(array_agg(mi.id), '{}'::uuid[]) INTO v_dead
    FROM public.menu_items mi
    JOIN public.menus m ON m.id = mi.menu_id
   WHERE m.tenant_id = OLD.tenant_id
     AND (
       (mi.item_type = 'category'::public.menu_item_type AND mi.ref_id = OLD.id)
       OR (
         mi.ref_id IS NULL
         AND mi.item_type IN ('category'::public.menu_item_type, 'custom'::public.menu_item_type)
         AND mi.href IN ('/category/' || OLD.slug, '/en/category/' || OLD.slug)
       )
     );
  PERFORM public._menu_items_prune_dead(v_dead);
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION public._categories_sync_menu_items() IS
  'Wyzwalacz categories: zmiana slugu przepisuje href pozycji menu wskazujących kategorię (po ref_id albo dokładnym starym adresie), skasowanie kategorii usuwa je regułą _menu_items_prune_dead. Zakres: menu tego samego najemcy.';
REVOKE ALL ON FUNCTION public._categories_sync_menu_items() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS categories_sync_menu_items ON public.categories;
CREATE TRIGGER categories_sync_menu_items
  AFTER UPDATE OF slug OR DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public._categories_sync_menu_items();

CREATE OR REPLACE FUNCTION public._menu_items_repair_category_links()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_pattern constant text := '^(?:/en)?/category/([^/?#]+)/?(?:[?#].*)?$';
  v_rows integer;
  v_total integer := 0;
  v_dead uuid[];
BEGIN
  UPDATE public.menu_items mi
     SET href = '/category/' || c.slug
    FROM public.menus m, public.categories c
   WHERE m.id = mi.menu_id
     AND mi.item_type = 'category'::public.menu_item_type
     AND c.id = mi.ref_id
     AND c.tenant_id = m.tenant_id
     AND mi.href IS DISTINCT FROM '/category/' || c.slug;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  UPDATE public.menu_items mi
     SET ref_id = c.id
    FROM public.menus m, public.categories c
   WHERE m.id = mi.menu_id
     AND mi.item_type = 'category'::public.menu_item_type
     AND c.tenant_id = m.tenant_id
     AND c.slug = (regexp_match(mi.href, v_pattern))[1]
     AND NOT EXISTS (
       SELECT 1 FROM public.categories live
        WHERE live.id = mi.ref_id AND live.tenant_id = m.tenant_id
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_total := v_total + v_rows;

  SELECT COALESCE(array_agg(mi.id), '{}'::uuid[]) INTO v_dead
    FROM public.menu_items mi
    JOIN public.menus m ON m.id = mi.menu_id
   WHERE (
           (mi.item_type = 'category'::public.menu_item_type
             AND (mi.ref_id IS NOT NULL OR mi.href ~ v_pattern))
           OR (mi.item_type = 'custom'::public.menu_item_type AND mi.href ~ v_pattern)
         )
     AND NOT (
           mi.item_type = 'category'::public.menu_item_type
           AND EXISTS (
             SELECT 1 FROM public.categories live
              WHERE live.id = mi.ref_id AND live.tenant_id = m.tenant_id
           )
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.categories byslug
            WHERE byslug.tenant_id = m.tenant_id
              AND byslug.slug = (regexp_match(mi.href, v_pattern))[1]
         );
  RETURN v_total + public._menu_items_prune_dead(v_dead);
END;
$$;
COMMENT ON FUNCTION public._menu_items_repair_category_links() IS
  'Naprawa linków menu do kategorii (wszyscy najemcy, idempotentna): żywy ref_id dostaje bieżący adres, martwy ref_id z żywym adresem zostaje dowiązany, martwe linki /category/<slug> idą przez _menu_items_prune_dead. Zwraca liczbę zmienionych pozycji. Pomocnik wewnętrzny (migracja 20261011090000).';
REVOKE ALL ON FUNCTION public._menu_items_repair_category_links() FROM PUBLIC, anon, authenticated;
SELECT public._menu_items_repair_category_links();

CREATE OR REPLACE FUNCTION public._event_seed_default_pages(_tenant uuid, _event_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events;
  v_root uuid;
  v_page_id uuid;
  v_entry_id uuid;
  v_slug text;
  v_try integer;
  v_seeded integer := 0;
  v_noindex boolean;
  d record;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT * INTO v_event FROM public.events e WHERE e.id = _event_id AND e.tenant_id = _tenant;
  IF v_event.id IS NULL THEN
    RETURN 0;
  END IF;
  v_noindex := COALESCE(v_event.slug ~* '^(test|e2e)($|[-_])', false);
  IF (
    SELECT count(*) FROM public.event_pages ep
    WHERE ep.tenant_id = _tenant AND ep.event_id = _event_id AND ep.module IS NOT NULL
  ) >= (SELECT count(*) FROM public._event_default_pages()) THEN
    RETURN 0;
  END IF;
  v_root := v_event.root_page_id;
  IF v_root IS NULL THEN
    FOR v_try IN 1..5 LOOP
      BEGIN
        INSERT INTO public.pages (
          tenant_id, slug, title_pl, title_en, status, editor, template_type, menu_order, seo_noindex
        ) VALUES (
          _tenant, public._event_unique_page_slug(_tenant, v_event.slug),
          v_event.title_pl, v_event.title_en, 'published', 'builder', 'default', 0, v_noindex
        )
        RETURNING id INTO v_root;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;
    UPDATE public.events e SET root_page_id = v_root, updated_at = now()
    WHERE e.id = _event_id AND e.tenant_id = _tenant;
  END IF;
  FOR d IN
    SELECT * FROM public._event_default_pages() p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.event_pages ep
      WHERE ep.tenant_id = _tenant AND ep.event_id = _event_id AND ep.module = p.module
    )
    ORDER BY p.sort_order
  LOOP
    FOR v_try IN 1..5 LOOP
      BEGIN
        v_slug := public._event_unique_page_slug(
          _tenant, v_event.slug || '-' || public._event_slugify(d.title_pl)
        );
        INSERT INTO public.pages (
          tenant_id, parent_id, slug, title_pl, title_en,
          status, editor, template_type, menu_order, builder_data, seo_noindex
        ) VALUES (
          _tenant, v_root, v_slug, d.title_pl, d.title_en,
          'published', 'builder', 'default', d.sort_order,
          public._event_module_page_document(d.title_pl, d.title_en, d.intro_pl, d.intro_en),
          v_noindex
        )
        RETURNING id INTO v_page_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_try = 5 THEN RAISE; END IF;
      END;
    END LOOP;
    INSERT INTO public.event_pages (
      tenant_id, event_id, page_id, module, icon, color, in_menu, sort_order
    ) VALUES (
      _tenant, _event_id, v_page_id, d.module, d.icon, d.color, true, d.sort_order
    )
    ON CONFLICT (tenant_id, event_id, module) WHERE module IS NOT NULL DO NOTHING
    RETURNING id INTO v_entry_id;
    IF v_entry_id IS NULL THEN
      DELETE FROM public.pages WHERE id = v_page_id;
    ELSE
      v_seeded := v_seeded + 1;
    END IF;
  END LOOP;
  RETURN v_seeded;
END;
$fn$;
REVOKE ALL ON FUNCTION public._event_seed_default_pages(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seed_default_pages(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public._event_seed_default_pages(uuid, uuid) IS
  'Zaklada brakujace strony modulowe wydarzenia (piec z _event_default_pages) razem z korzeniem, od razu jako published; wydarzenie testowe (slug test*/e2e*) dostaje strony z seo_noindex = true. Idempotentna po event_pages_module_uniq. Pomocnik wewnetrzny.';

CREATE OR REPLACE FUNCTION public._pages_unpublish_test_content()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH RECURSIVE test_tree AS (
    SELECT p.id, p.tenant_id, 0 AS depth
      FROM public.pages p
     WHERE p.slug ~* '^(test|e2e)($|[-_])'
    UNION
    SELECT c.id, c.tenant_id, t.depth + 1
      FROM public.pages c
      JOIN test_tree t ON c.parent_id = t.id AND c.tenant_id = t.tenant_id
     WHERE t.depth < 50
  )
  UPDATE public.pages p
     SET status = CASE
                    WHEN p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
                      THEN 'draft'::public.post_status
                    ELSE p.status
                  END,
         publish_at = CASE WHEN p.status = 'scheduled'::public.post_status THEN NULL ELSE p.publish_at END,
         seo_noindex = true
   WHERE p.id IN (SELECT t.id FROM test_tree t)
     AND p.deleted_at IS NULL
     AND (
       p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
       OR p.seo_noindex IS DISTINCT FROM true
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
COMMENT ON FUNCTION public._pages_unpublish_test_content() IS
  'Odpublikowuje strony testowe (slug strony albo przodka pasuje do ^(test|e2e)($|[-_])) we wszystkich najemcach: published/scheduled -> draft, seo_noindex = true. Idempotentna. Zwraca liczbe zmienionych stron. Pomocnik wewnetrzny (migracja 20261011090200).';
REVOKE ALL ON FUNCTION public._pages_unpublish_test_content() FROM PUBLIC, anon, authenticated;
SELECT public._pages_unpublish_test_content();