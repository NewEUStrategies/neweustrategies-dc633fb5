-- events-harness: include
-- ============================================================================
-- ZASIEW STRON WYDARZENIA: WYDARZENIE TESTOWE DOSTAJE STRONY `noindex`
-- ============================================================================
--
-- PRZYCZYNA (2026-10 audyt SEO). W `sitemaps/pages.xml` wisialy
-- `/test-e2e-zakup` i `/test-e2e-zakup-2`: wydarzenia zakladane przez testy
-- e2e (zakup biletu) dostawaly od `_event_seed_default_pages` korzen i piec
-- stron modulowych OD RAZU jako `published` i indeksowalne.
--
-- ZMIANA MINIMALNA. Cialo jest PRZEPISANE BEZ ZMIAN z 20260827065451 (ostatnia
-- definicja) poza trzema miejscami: zmienna `v_noindex` liczona ze slugu
-- wydarzenia tym samym wzorcem co `TEST_CONTENT_SLUG_PATTERN`
-- (`src/lib/seo/testContent.ts`) oraz kolumna `seo_noindex` w obu INSERT-ach
-- stron. Status zostaje `published`, bo menu wydarzenia (`event_menu`) czyta
-- wylacznie strony opublikowane - zmiana statusu zepsulaby przeplyw zakupu,
-- ktory te testy sprawdzaja. Sygnatura, SECURITY DEFINER, search_path,
-- REVOKE/GRANT i komentarz funkcji jak w oryginale.
--
-- Strony juz zasiane dla wydarzen testowych odpublikowuje osobna migracja
-- 20261011090200 (`_pages_unpublish_test_content`).

CREATE OR REPLACE FUNCTION public._event_seed_default_pages(_tenant uuid, _event_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
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

  SELECT * INTO v_event
  FROM public.events e
  WHERE e.id = _event_id AND e.tenant_id = _tenant;

  -- Cicho zero, nie wyjatek: zasiew jest wolany LENIWIE z listy, a lista ma
  -- prawo dostac identyfikator wydarzenia, ktore w tym najemcy nie istnieje
  -- (skasowane w innej karcie). Wyjatek zamienilby to w pusty ekran z bledem.
  IF v_event.id IS NULL THEN
    RETURN 0;
  END IF;

  -- WYDARZENIE TESTOWE (slug `test`, `test-*`, `test_*`, `e2e`, `e2e-*`) dostaje
  -- strony `seo_noindex = true`. Status zostaje `published` - menu wydarzenia
  -- go wymaga (patrz wyzej) - ale strona testowa nie ma prawa trafic do mapy
  -- strony ani do indeksu (2026-10 audyt: `/test-e2e-zakup` w pages.xml).
  -- Wzorzec = `TEST_CONTENT_SLUG_PATTERN` (`src/lib/seo/testContent.ts`).
  v_noindex := COALESCE(v_event.slug ~* '^(test|e2e)($|[-_])', false);

  -- WYJSCIE NA SKROTY. Zasiew biegnie przy KAZDYM wejsciu na ekran „Strony
  -- i menu", wiec typowy przebieg musi byc jednym zapytaniem liczacym, a nie
  -- petla po pieciu modulach z zapytaniem na kazdy.
  IF (
    SELECT count(*) FROM public.event_pages ep
    WHERE ep.tenant_id = _tenant AND ep.event_id = _event_id AND ep.module IS NOT NULL
  ) >= (SELECT count(*) FROM public._event_default_pages()) THEN
    RETURN 0;
  END IF;

  v_root := v_event.root_page_id;

  IF v_root IS NULL THEN
    -- Petla prob jak w `admin_event_page_create` (20260826162459:59-73) i z tego
    -- samego powodu: `_event_unique_page_slug` sprawdza zajetosc SELECT-em,
    -- a INSERT idzie po nim - miedzy jednym a drugim mieszcza sie dwaj
    -- redaktorzy zakladajacy strone o tym samym tytule.
    FOR v_try IN 1..5 LOOP
      BEGIN
        INSERT INTO public.pages (
          tenant_id, slug, title_pl, title_en, status, editor, template_type, menu_order,
          seo_noindex
        ) VALUES (
          _tenant,
          public._event_unique_page_slug(_tenant, v_event.slug),
          v_event.title_pl, v_event.title_en, 'published', 'builder', 'default', 0,
          v_noindex
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
      WHERE ep.tenant_id = _tenant
        AND ep.event_id = _event_id
        AND ep.module = p.module
    )
    ORDER BY p.sort_order
  LOOP
    FOR v_try IN 1..5 LOOP
      BEGIN
        -- SLUG JEST PREFIKSOWANY SLUGIEM WYDARZENIA, bo `pages.slug` jest
        -- unikalny W CALYM NAJEMCY (`pages_tenant_slug_uniq`). Bez prefiksu
        -- drugie wydarzenie dostaloby „agenda-2", a to jest adres, ktorego
        -- nikt nie przewidzi, czytajac nazwe wydarzenia.
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
      -- Wyscig przegrany: rownolegly zasiew zdazyl z tym modulem. Strona
      -- zalozona chwile wczesniej nie ma juz do czego nalezec.
      DELETE FROM public.pages WHERE id = v_page_id;
    ELSE
      v_seeded := v_seeded + 1;
    END IF;
  END LOOP;

  -- KORZENIA NIE WYCOFUJEMY, nawet gdy petla nie zalozyla ani jednej strony -
  -- a taki przebieg istnieje: rownolegly zasiew moze wygrac wszystkie piec
  -- modulow. `events.root_page_id` juz na niego wskazuje, a strona glowna
  -- wydarzenia jest potrzebna sama z siebie, wiec jej skasowanie byloby
  -- naprawianiem stanu, ktory nie jest zly.
  RETURN v_seeded;
END;
$fn$;

REVOKE ALL ON FUNCTION public._event_seed_default_pages(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seed_default_pages(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_seed_default_pages(uuid, uuid) IS
  'Zaklada brakujace strony modulowe wydarzenia (piec z _event_default_pages) razem z korzeniem, od razu jako published; wydarzenie testowe (slug test*/e2e*) dostaje strony z seo_noindex = true. Idempotentna po event_pages_module_uniq. Pomocnik wewnetrzny.';

