-- Podstrony wydarzenia (`event_pages`) + udostepnienie nowych kolumn `events`
-- powierzchni publicznej.
--
-- DWA DLUGI Z JEDNEJ ITERACJI, ZAMYKANE RAZEM, bo sa jednym problemem: panel
-- zapisywal ustawienia, ktorych uczestnik nie widzial.
--
-- 1) GRANT KOLUMNOWY. `events` ma JAWNA liste kolumn czytelnych dla `anon`
--    i `authenticated` (migracja 20260803191905 odcina `join_url` i
--    `recording_url`). Kolumna dopisana ALTER-em NIE wchodzi do tej listy sama,
--    wiec adres strukturalny, hashtag, jezyki tresci, naglowek wideo i branding
--    wydarzenia byly dla strony publicznej NIEISTNIEJACE - `SELECT` na nie
--    konczyl sie odmowa uprawnien. GRANT jest przyrostowy per kolumna, wiec
--    dopisujemy brakujace, a NIE odtwarzamy calej listy: odtworzenie listy jest
--    dokladnie tym ruchem, ktorym gubi sie odciecie `join_url`.
--
-- 2) `event_pages`. Podzial „strony w menu / pozostale" liczyl sie tymczasowo
--    z `pages.menu_order`, czyli z kolumny, ktora sluzy menu CALEGO serwisu -
--    dwa menu na jednej kolumnie rozjezdzaja sie przy pierwszej zmianie
--    kolejnosci w jednym z nich. Osobna tabela mapowania daje pozycji menu
--    wydarzenia to, czego `pages` dac nie moze: ikone, kolor, wlasna etykiete
--    w dwoch jezykach, kolejnosc w TYM menu i widocznosc per grupa uczestnikow.
--
--    NIE JEST TO DRUGI SILNIK STRON. Trescia nadal jest wiersz `pages`
--    (builder, SEO, okruszki, harmonogram publikacji, rewizje); `event_pages`
--    jest WYLACZNIE mapowaniem strona -> menu wydarzenia
--    (`docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` §0.1, §4.7).

-- ---------------------------------------------------------------------------
-- 1. Nowe kolumny `events` dla powierzchni publicznej
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 2. Tabela mapowania
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- BEZ pojedynczego klucza obcego do `events(id)` - wiaze go dopiero zlozony
  -- `event_pages_event_fk` nizej. Pojedynczy pozwalal na wiersz, ktory ma
  -- `tenant_id` najemcy B i `event_id` wydarzenia najemcy A: polityka RLS stoi
  -- na `tenant_id`, wiec administrator B widzialby i edytowal pozycje menu
  -- wydarzenia A. Zlozony klucz czyni ten wiersz niemozliwym w bazie.
  event_id uuid NOT NULL,
  -- `pages` NIE MA `UNIQUE (tenant_id, id)`, wiec tutaj zostaje klucz
  -- pojedynczy - zlozonego nie da sie zalozyc bez zmiany tamtej tabeli, a to
  -- juz nie jest zakres tej migracji. Najemce strony pilnuje kazde zapytanie
  -- modulu (JOIN po `pg.tenant_id = ep.tenant_id`).
  page_id uuid NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  -- NULL = uzyj tytulu strony. Wlasna etykieta istnieje, bo w menu mieszcza sie
  -- dwa slowa, a tytul strony bywa zdaniem („Program kongresu dzien pierwszy").
  menu_label_pl text,
  menu_label_en text,
  icon text,
  color text,
  in_menu boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  -- Pusta tablica = widoczne dla wszystkich, takze dla gosci. Grupa jest
  -- pelnoprawnym celem widocznosci, nie wyjatkiem w kodzie (§7).
  visible_to_groups uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Unikalnosc W GRANICACH NAJEMCY, nie globalna. Ten sam powod, ktory stoi za
  -- zlozonym kluczem obcym: kazdy warunek tej tabeli ma sie rozstrzygac wewnatrz
  -- najemcy, bo tam rozstrzyga sie tez dostep.
  CONSTRAINT event_pages_unique UNIQUE (tenant_id, event_id, page_id),
  -- Tozsamosc w granicach najemcy - kotwica dla przyszlych tabel-wnukow,
  -- dokladnie jak `event_page_sections_tenant_id_key` (20260823170000).
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

-- Odczyt i zapis WYLACZNIE dla staffa w tenancie domowym. Powierzchnia
-- publiczna czyta przez definerowy `event_menu` - bez polityki dla `anon`,
-- bo pozycja menu niesie widocznosc per grupa i to RPC ma ja rozstrzygac,
-- a nie polityka, ktora nie zna zapisu wolajacego.
--
-- PREDYKAT: `admin` ALBO `is_super_admin` - NIGDY `editor`. To nie jest wybor
-- stylistyczny, tylko kontrakt modulu, pilnowany przez
-- `supabase/tests/event_admin_only_contract_test.sql`.
--
-- Dwie pomylki, ktore tu popelnilem, warte zapisania, bo obie wygladaly na
-- poprawne:
--
-- 1. `public.is_staff(auth.uid())` - `is_staff()` NIE PRZYJMUJE argumentu, czyta
--    `auth.uid()` sama (20260628230000). Migracja wywracala sie bledem 42883
--    i tabela nie powstawala wcale.
--    DLACZEGO NIE ZLAPALA TEGO WERYFIKACJA LOKALNA: nie dlatego, ze atrapy sa
--    za szerokie - obie (`scripts/pg-harness/harness.sql`,
--    `scripts/events-harness/harness.sql`) definiuja `is_staff` BEZ argumentu,
--    dokladnie jak baza, i ta pomylke by pokazaly. Powod byl proceduralny:
--    narzedzia istnialy i nie zostaly uruchomione, a ich miejsce zajela atrapa
--    pisana ad hoc pod te jedna migracje. Wniosek nie brzmi „pisz szersze
--    atrapy", tylko „uruchom te, ktore repozytorium ma".
--
-- 2. Poprawka przez przepisanie predykatu z `event_page_sections`
--    (20260823170000) - plik SPRZED zamkniecia plaszczyzny. Od 20260824090000
--    `assert_editor_tenant()` deleguje do `assert_event_admin_tenant()`
--    („admin albo super_admin, nigdy editor ani author"), a 20260825170000
--    dociagnelo do tego RLS. Wzorzec `admin OR editor` jest w tym repozytorium
--    domyslny i wraca z automatu, wiec przepisanie go tutaj cofalo cala te
--    naprawe - dla nowej tabeli, czyli bez sladu w diffie tamtych migracji.
--    Dokladnie ten mechanizm opisuje naglowek tamtego testu.
--
-- Wzorzec ponizej jest przepisany z 20260825192230 (tam 39 polityk modulu
-- stoi na tym samym predykacie). `has_role(uid,'admin')` to scisly odczyt
-- wiersza z `user_roles` i NIE obejmuje super admina - dlatego drugi czlon
-- jest obowiazkowy, inaczej super admin traci dostep do wlasnych danych.
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

-- GRANTY JAWNE, jak w kazdej siostrzanej tabeli modulu. Bez tego bloku tabela
-- stoi na domyslnych przywilejach Supabase, a te nie sa czescia tej migracji -
-- czyli uprawnienia na produkcji zaleza od czegos, czego nie ma w diffie.
-- `anon` nie dostaje NICZEGO: powierzchnia publiczna czyta wylacznie przez
-- definerowy `event_menu`.
REVOKE ALL ON public.event_pages FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_pages TO authenticated;
GRANT ALL ON public.event_pages TO service_role;

-- Kolumna `updated_at` bez triggera klamie przy kazdym zapisie przez PostgREST,
-- a polityka zapisu jest `FOR ALL`, wiec UPDATE wprost jest dozwolony.
DROP TRIGGER IF EXISTS trg_event_pages_touch ON public.event_pages;
CREATE TRIGGER trg_event_pages_touch
  BEFORE UPDATE ON public.event_pages
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Pomocnik: publiczna sciezka strony
-- ---------------------------------------------------------------------------
--
-- Strona publiczna zyje pod sciezka zlozona z lancucha slugow rodzicow
-- (`src/routes/$.tsx`), wiec menu musi znac CALA sciezke, nie sam slug.
-- Rekurencja w SQL zamiast petli w kliencie: menu ma kilka pozycji, ale
-- kazda z nich to inaczej osobne zapytanie o rodzica.

CREATE OR REPLACE FUNCTION public._event_page_path(_page_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- REKURENCJA NIE WYCHODZI Z NAJEMCY strony startowej. Funkcja jest
  -- SECURITY DEFINER, wiec bez tego warunku wspinaczka po `parent_id` moze
  -- wciagnac slug strony innego najemcy do publicznej sciezki - i to bez
  -- zadnego bledu, po cichu.
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

-- Czy CALY lancuch przodkow strony jest opublikowany.
--
-- `resolve_path` (20260531223436) idzie sciezka segment po segmencie i na KAZDYM
-- poziomie wymaga `status = 'published'`. Menu, ktore sprawdza status tylko
-- samej podstrony, wystawia wiec odnosnik dzialajacy pozornie: korzen wydarzenia
-- zaklada sie SAM jako szkic przy pierwszej podstronie, redaktor publikuje
-- dziecko - i uczestnik dostaje 404 na pozycji, ktora widzi w menu. Gorzej:
-- korzen nie stoi jako pozycja menu, wiec nie ma go gdzie zauwazyc.
--
-- Odnosnik, ktory nie prowadzi nigdzie, jest gorszy od braku odnosnika - dlatego
-- menu filtruje tym samym warunkiem, ktorym rozstrzyga publiczne rozwiazywanie
-- sciezki. Limit 10 poziomow ten sam co w `_event_page_path`.
CREATE OR REPLACE FUNCTION public._event_page_chain_published(_page_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Ten sam warunek najemcy co w `_event_page_path` i z tego samego powodu.
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

-- ---------------------------------------------------------------------------
-- 4. Lista podstron wydarzenia dla panelu
-- ---------------------------------------------------------------------------
--
-- LISTA POKAZUJE TAKZE STRONY NIEPRZYPIETE. Strona zalozona w `/admin/pages`
-- pod korzeniem wydarzenia istnieje, ale nie ma wiersza w `event_pages` -
-- i gdyby lista jej nie pokazywala, redaktor widzialby pusty ekran przy
-- istniejacych podstronach i zalozylby je drugi raz. `id IS NULL` znaczy
-- „jeszcze nieprzypieta", a nie „blad".

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
      -- Strony przypiete do wydarzenia (nawet jesli stoja poza poddrzewem -
      -- redaktor moze przypiac istniejaca strone serwisu).
      ep.id IS NOT NULL
      -- Strony z poddrzewa korzenia wydarzenia, jeszcze nieprzypiete.
      OR (v_root IS NOT NULL AND pg.parent_id = v_root)
    )
  ORDER BY COALESCE(ep.in_menu, false) DESC, COALESCE(ep.sort_order, 0), pg.title_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_pages_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_pages_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_pages_list(uuid) IS
  'Podstrony wydarzenia: przypiete (event_pages) oraz nieprzypiete strony z poddrzewa korzenia. id IS NULL = jeszcze nieprzypieta.';

-- ---------------------------------------------------------------------------
-- 5. Przypiecie i edycja pozycji menu
-- ---------------------------------------------------------------------------

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

  -- Grupa spoza tego wydarzenia w widocznosci pozycji menu znaczy „nikt" -
  -- i to jest cicha awaria, ktora widac dopiero, gdy uczestnik nie widzi
  -- strony. Odrzucamy przy zapisie.
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

-- ---------------------------------------------------------------------------
-- 6. Odpiecie pozycji menu
-- ---------------------------------------------------------------------------
--
-- ODPINAMY MAPOWANIE, NIE KASUJEMY TRESCI. Strona zostaje w `pages` ze swoja
-- historia, SEO i harmonogramem - usuwanie stron nalezy do `/admin/pages`.
-- Pomylkowe odpiecie kosztuje jedno klikniecie, pomylkowe usuniecie strony
-- kosztuje tresc.

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

-- ---------------------------------------------------------------------------
-- 7. Kolejnosc pozycji menu
-- ---------------------------------------------------------------------------
--
-- KOLEJNOSC USTAWIA SIE JEDNYM ZAPISEM, nie N zapisami po jednym wierszu:
-- przy przenoszeniu pozycji zmienia sie kilka `sort_order` naraz, a seria
-- osobnych zapisow zostawia menu w stanie posrednim, gdy ktorys z nich padnie.

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

-- ---------------------------------------------------------------------------
-- 7b. Pomocniki slugu strony
-- ---------------------------------------------------------------------------
--
-- SLUG LICZY BAZA, NIE KLIENT. Unikalnosc slugu strony jest w tenancie
-- (`pages_tenant_slug_uniq`), wiec sprawdzenie „czy wolny" w kliencie jest
-- wyscigiem: dwie osoby zakladajace w tej samej minucie „Agenda" dostana
-- ten sam slug i druga zobaczy naruszenie indeksu zamiast strony. Petla
-- doklejajaca numer stoi po stronie zapisu.
--
-- TRANSLITERACJA JEST TA SAMA, CO W `admin_event_create` - polskie znaki
-- schodza do ASCII, reszta do myslnikow. Dwie rozne transliteracje w jednym
-- repozytorium daja dwa rozne slugi dla tego samego tytulu.

CREATE OR REPLACE FUNCTION public._event_slugify(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
-- Przypiety search_path i zamkniety ACL jak w kazdym innym helperze `_event_*`
-- tego modulu. Ta jedna funkcja stala bez obu: domyslny ACL funkcji znaczy
-- EXECUTE dla PUBLIC, czyli takze dla `anon`.
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

-- ---------------------------------------------------------------------------
-- 8. Nowa podstrona wydarzenia jednym ruchem
-- ---------------------------------------------------------------------------
--
-- „Utworz strone" ma zrobic TRZY rzeczy naraz: zalozyc korzen wydarzenia,
-- jesli go jeszcze nie ma, zalozyc pod nim strone i przypiac ja do menu.
-- Rozbite na trzy kroki w interfejsie daloby stan, w ktorym strona istnieje,
-- ale nie nalezy do wydarzenia - czyli dokladnie ten stan, ktory ta migracja
-- ma zlikwidowac.

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

  -- Korzen wydarzenia zaklada sie SAM, przy pierwszej podstronie. Osobny
  -- przycisk „zaloz strone glowna wydarzenia" byl by pytaniem o decyzje,
  -- ktorej nie ma: strona glowna jest warunkiem istnienia podstron.
  -- WOLNY SLUG TRZEBA BRAC I ZUZYC W JEDNEJ PROBIE.
  -- `_event_unique_page_slug` sprawdza zajetosc SELECT-em, a INSERT idzie po nim
  -- - miedzy jednym a drugim mieszcza sie dwaj redaktorzy zakladajacy strone
  -- o tym samym tytule. Oba wywolania dostaja wtedy ten sam „wolny” slug i drugi
  -- INSERT konczy sie golym 23505 zamiast slugiem z numerem, czyli dokladnie
  -- tym, przed czym ten pomocnik mial chronic. Blokada na tabeli byla by tu
  -- lekarstwem gorszym od choroby (kazde zalozenie strony serializowaloby cale
  -- `pages` w tenancie), wiec zamiast niej: ponowna proba z przeliczonym slugiem.
  -- Piec prob wystarcza - kolejny numer jest wolny, chyba ze trafi go kolejny
  -- rownolegly zapis, a wtedy szosta proba tez nie pomoze i blad ma poleciec.
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

-- ---------------------------------------------------------------------------
-- 9. Publiczne menu wydarzenia
-- ---------------------------------------------------------------------------
--
-- WIDOCZNOSC ROZSTRZYGA BAZA, NIE KOMPONENT. Pozycja z pusta lista grup jest
-- dla wszystkich, w tym dla gosci; pozycja z grupami tylko dla uczestnika,
-- ktorego zapis nalezy do jednej z nich. Filtr w kliencie oznaczalby, ze pelna
-- lista pozycji (razem z nazwami stron dla partnerow) jedzie do kazdego gościa.

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
    -- Sam status podstrony NIE WYSTARCZA - patrz `_event_page_chain_published`.
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
