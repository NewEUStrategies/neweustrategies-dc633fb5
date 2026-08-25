ALTER TYPE public.ad_page_type ADD VALUE IF NOT EXISTS 'event';

CREATE TABLE IF NOT EXISTS public.event_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  section_key text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  heading_pl text,
  heading_en text,
  visibility text NOT NULL DEFAULT 'public',
  min_tier_rank integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_page_sections_key_values CHECK (section_key IN (
    'description', 'registration', 'agenda', 'speakers',
    'sponsors', 'materials', 'map', 'contact'
  )),
  CONSTRAINT event_page_sections_visibility_values CHECK (visibility IN (
    'public', 'authenticated', 'registered', 'tier'
  )),
  CONSTRAINT event_page_sections_tier_rank_consistent CHECK (
    (visibility = 'tier' AND min_tier_rank > 0)
    OR (visibility <> 'tier' AND min_tier_rank = 0)
  ),
  CONSTRAINT event_page_sections_heading_pl_len
    CHECK (heading_pl IS NULL OR char_length(btrim(heading_pl)) BETWEEN 1 AND 120),
  CONSTRAINT event_page_sections_heading_en_len
    CHECK (heading_en IS NULL OR char_length(btrim(heading_en)) BETWEEN 1 AND 120),
  CONSTRAINT event_page_sections_sort_order_range
    CHECK (sort_order BETWEEN 0 AND 10000),
  CONSTRAINT event_page_sections_event_key_unique UNIQUE (tenant_id, event_id, section_key),
  CONSTRAINT event_page_sections_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_page_sections_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_page_sections IS
  'NADPISANIA ukladu strony wydarzenia. Kanoniczna lista osmiu sekcji zyje w _event_default_sections(); wiersz tutaj zmienia widocznosc, kolejnosc, naglowek albo prog dostepu JEDNEJ sekcji. Brak wiersza = wartosc domyslna, wiec wydarzenie bez konfiguracji renderuje sie poprawnie, a "przywroc domyslne" to DELETE.';
COMMENT ON COLUMN public.event_page_sections.section_key IS
  'Klucz sekcji ze zamknietego slownika osmiu wartosci. Ten sam klucz jest kotwica w adresie (#agenda) i kluczem etykiety w slowniku i18n (eventFront.sections.<key>.heading).';
COMMENT ON COLUMN public.event_page_sections.is_visible IS
  'false = sekcja NIE WRACA z event_sections() w ogole. To jest ukrycie na zyczenie redakcji, w odroznieniu od zamkniecia bramka (is_locked), ktore sekcje zwraca razem z powodem.';
COMMENT ON COLUMN public.event_page_sections.heading_pl IS
  'Naglowek nadpisany przez redakcje. NULL = etykieta ze slownika i18n (eventFront.sections.<key>.heading) - jedno zrodlo tlumaczenia, nie kopia w bazie.';
COMMENT ON COLUMN public.event_page_sections.heading_en IS
  'Jak heading_pl, w wersji angielskiej. Nadpisanie jest per jezyk, bo redakcja czasem zmienia tylko jedna wersje.';
COMMENT ON COLUMN public.event_page_sections.visibility IS
  'Dla kogo sekcja jest OTWARTA: public (kazdy) | authenticated (zalogowany) | registered (z zapisem na to wydarzenie) | tier (od rangi min_tier_rank). Bramka jest liczona w event_sections(); dodatkowo obowiazuje events.guest_mode.';
COMMENT ON COLUMN public.event_page_sections.min_tier_rank IS
  'Prog rangi warstwy czlonkowskiej dla visibility = tier. CHECK wymusza wartosc > 0 wlasnie dla tej widocznosci i 0 dla pozostalych.';

CREATE INDEX IF NOT EXISTS event_page_sections_event_order_idx
  ON public.event_page_sections (tenant_id, event_id, sort_order, section_key);

DROP TRIGGER IF EXISTS event_page_sections_touch_updated_at ON public.event_page_sections;
CREATE TRIGGER event_page_sections_touch_updated_at
  BEFORE UPDATE ON public.event_page_sections
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_page_sections TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_page_sections TO authenticated;
GRANT ALL ON public.event_page_sections TO service_role;

ALTER TABLE public.event_page_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_page_sections_public_read" ON public.event_page_sections;
CREATE POLICY "event_page_sections_public_read"
  ON public.event_page_sections FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_page_sections.event_id
        AND e.tenant_id = event_page_sections.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_page_sections_staff_read" ON public.event_page_sections;
CREATE POLICY "event_page_sections_staff_read"
  ON public.event_page_sections FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_page_sections_staff_write" ON public.event_page_sections;
CREATE POLICY "event_page_sections_staff_write"
  ON public.event_page_sections FOR ALL
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_bookmarks_user_event_unique UNIQUE (tenant_id, event_id, user_id),
  CONSTRAINT event_bookmarks_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_bookmarks IS
  'Zapamietanie wydarzenia przez uzytkownika: kto, ktore wydarzenie, kiedy. Widzi je WYLACZNIE wlasciciel i tylko w najemcy, w ktorym powstalo. Zapis wylacznie przez event_bookmark_toggle() - tabela nie ma polityki INSERT ani DELETE dla roli klienckiej.';
COMMENT ON COLUMN public.event_bookmarks.tenant_id IS
  'Najemca, w ktorym zapamietanie powstalo (naglowek hosta w chwili zapisu). Ta sama osoba na dwoch domenach ma dwa niezalezne zbiory zapamietan - obszar roboczy jednej firmy nie pokazuje wyborow zrobionych w drugiej.';

CREATE INDEX IF NOT EXISTS event_bookmarks_user_idx
  ON public.event_bookmarks (tenant_id, user_id, created_at DESC);

GRANT SELECT ON public.event_bookmarks TO authenticated;
GRANT ALL ON public.event_bookmarks TO service_role;

ALTER TABLE public.event_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_bookmarks_owner_read" ON public.event_bookmarks;
CREATE POLICY "event_bookmarks_owner_read"
  ON public.event_bookmarks FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP FUNCTION IF EXISTS public._event_default_sections();
CREATE FUNCTION public._event_default_sections()
RETURNS TABLE (
  section_key text,
  is_visible boolean,
  sort_order integer,
  visibility text,
  min_tier_rank integer
)
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM (VALUES
    ('description',  true,  10, 'public',     0),
    ('registration', true,  20, 'public',     0),
    ('agenda',       true,  30, 'public',     0),
    ('speakers',     true,  40, 'public',     0),
    ('sponsors',     true,  50, 'public',     0),
    ('materials',    false, 60, 'registered', 0),
    ('map',          true,  70, 'public',     0),
    ('contact',      true,  80, 'registered', 0)
  ) AS d(section_key, is_visible, sort_order, visibility, min_tier_rank);
$$;

REVOKE ALL ON FUNCTION public._event_default_sections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._event_default_sections() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public._event_default_sections() IS
  'Kanoniczna lista osmiu sekcji strony wydarzenia z wartosciami startowymi. Zrodlo prawdy dla wydarzen BEZ wierszy w event_page_sections - dodanie dziewiatej sekcji tutaj obejmuje wszystkie wydarzenia naraz, bez backfillu.';