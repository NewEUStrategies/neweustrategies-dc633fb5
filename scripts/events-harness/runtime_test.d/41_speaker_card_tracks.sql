-- ============================================================================
-- 41_speaker_card_tracks - KARTA PRELEGENTA I SCIEZKI Z OBSADY SESJI
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260924120000 doklada dwie rzeczy, ktorych bramki tekstowe nie
-- sprawdza: pola karty prelegenta (zapisywane przy zakladaniu i w edycji
-- karty) oraz SCIEZKI prelegenta, ktore NIE sa wpisywane, tylko wynikaja
-- z obsady sesji. Obie sa kontraktem strony publicznej, wiec obie maja tu
-- oba boki: co wolno i czego nie wolno.
--
-- CZEGO TU DOWODZIMY
--   (a) pola karty przechodza przez `admin_event_speaker_upsert` przy
--       zakladaniu osoby bez konta i przez `admin_event_speaker_card_save`
--       przy edycji: klucz nieobecny zostawia kolumne, pusty napis ja czysci;
--   (b) CHECK-i odrzucaja http, adres protokol-wzgledny, zly kolor i za dluga
--       etykiete - a przepuszczaja sciezke wewnetrzna;
--   (c) sciezki na stronie publicznej = sciezki OPUBLIKOWANYCH, nieprywatnych
--       sesji; panel widzi takze szkice i sesje prywatne; sesja odwolana nie
--       daje sciezki nigdzie;
--   (d) zdjecie prelegenta z sesji AUTOMATYCZNIE zdejmuje mu sciezke;
--   (e) nakladka niepubliczna nie oddaje ani pol karty, ani sciezek;
--   (f) obsada w szczegole sesji panelu nie gubi osoby bez konta;
--   (g) redaktor i obcy profil dostaja NAZWANY blad, a pomocnik sciezek nie
--       jest wykonywalny dla klienta.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 41 karta prelegenta i sciezki z obsady =='

BEGIN;

-- ---------------------------------------------------------------------------
-- ATRAPY SPOZA MODULU (jak w 40_ i 97_): projekcje czytaja `author_profiles`,
-- `profile_badges` i legacy `event_speakers`, ktorych harness modulu nie ma.
-- ---------------------------------------------------------------------------
ALTER TABLE public.speaker_profiles
  ADD COLUMN IF NOT EXISTS topics_pl text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics_en text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS talks_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating numeric(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.author_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  avatar_url text,
  job_title text,
  company text,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_speakers (
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.profile_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge text NOT NULL CHECK (badge IN ('verified', 'expert', 'contributor', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, badge)
);

-- Atrapa musi byc prawdziwa: migracja dopisala piec kolumn karty na tabeli
-- harnessu, a literowka w nazwie dawalaby cichy brak.
SELECT pg_temp.assert(
  (SELECT count(*) = 5 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaker_profiles'
      AND column_name IN ('card_photo_url', 'card_cta_label_pl', 'card_cta_label_en',
                          'card_cta_url', 'card_cta_color')),
  '41 atrapa: speaker_profiles ma piec kolumn karty');

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA: administrator, redaktor, opublikowane wydarzenie, cztery
-- sciezki i cztery sesje - kazda w innym stanie, zeby kazda regula sciezek
-- miala wlasny dowod:
--   S1 / Energia      - opublikowana         -> strona i panel
--   S2 / Dyplomacja   - szkic                -> tylko panel
--   S3 / Obrona       - odwolana             -> nigdzie
--   S4 / Media        - opublikowana, prywatna -> tylko panel
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('41a00000-0000-0000-0000-0000000000a1', 'karta.admin@example.org'),
  ('41a00000-0000-0000-0000-0000000000a2', 'karta.redaktor@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('41a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('41a00000-0000-0000-0000-0000000000a2', 'editor')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('41a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Administrator 41', 'karta-admin'),
  ('41a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'Redaktor 41', 'karta-redaktor')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('41e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'karta-41', 'Kongres 41', 'Congress 41', now() + interval '30 days', 'published')
ON CONFLICT (id) DO NOTHING;

DO $do$
DECLARE
  v_admin  constant uuid := '41a00000-0000-0000-0000-0000000000a1';
  v_tenant constant uuid := '11111111-1111-1111-1111-111111111111';
  v_event  constant uuid := '41e00000-0000-0000-0000-0000000000e1';
  v_t1 uuid; v_t2 uuid; v_t3 uuid; v_t4 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_s4 uuid;
  v_res jsonb;
  v_p1 uuid;
  v_p2 uuid;
  v_row record;
  v_tracks jsonb;
BEGIN
  PERFORM pg_temp.act_as(v_admin, v_tenant);

  v_t1 := public.admin_event_track_save(jsonb_build_object(
    'event_id', v_event, 'key', 'energia', 'name_pl', 'Energia', 'name_en', 'Energy',
    'accent_color', '#C2410C', 'sort_order', 1));
  v_t2 := public.admin_event_track_save(jsonb_build_object(
    'event_id', v_event, 'key', 'dyplomacja', 'name_pl', 'Dyplomacja', 'name_en', 'Diplomacy',
    'sort_order', 2));
  v_t3 := public.admin_event_track_save(jsonb_build_object(
    'event_id', v_event, 'key', 'obrona', 'name_pl', 'Obrona', 'name_en', 'Defence',
    'sort_order', 3));
  v_t4 := public.admin_event_track_save(jsonb_build_object(
    'event_id', v_event, 'key', 'media', 'name_pl', 'Media', 'name_en', 'Media',
    'sort_order', 4));

  v_s1 := public.admin_event_session_save(jsonb_build_object(
    'event_id', v_event, 'title_pl', 'Sieci przesylowe', 'title_en', 'Grids',
    'starts_at', now() + interval '30 days', 'ends_at', now() + interval '30 days 1 hour',
    'status', 'published', 'track_id', v_t1));
  v_s2 := public.admin_event_session_save(jsonb_build_object(
    'event_id', v_event, 'title_pl', 'Szkic debaty', 'title_en', 'Draft debate',
    'starts_at', now() + interval '30 days 2 hours', 'ends_at', now() + interval '30 days 3 hours',
    'status', 'draft', 'track_id', v_t2));
  v_s3 := public.admin_event_session_save(jsonb_build_object(
    'event_id', v_event, 'title_pl', 'Odwolany panel', 'title_en', 'Cancelled panel',
    'starts_at', now() + interval '30 days 4 hours', 'ends_at', now() + interval '30 days 5 hours',
    'status', 'published', 'track_id', v_t3));
  v_s4 := public.admin_event_session_save(jsonb_build_object(
    'event_id', v_event, 'title_pl', 'Spotkanie zamkniete', 'title_en', 'Closed meeting',
    'starts_at', now() + interval '30 days 6 hours', 'ends_at', now() + interval '30 days 7 hours',
    'status', 'published', 'track_id', v_t4, 'is_private', true));

  -- ---------------------------------------------------------------------------
  -- (a) POLA KARTY PRZY ZAKLADANIU OSOBY BEZ KONTA
  -- ---------------------------------------------------------------------------
  v_res := public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id',          v_event,
    'first_name',        'Anna',
    'last_name',         'Karta',
    'job_title',         'Prezeska',
    'company_text',      'Instytut',
    'photo_url',         'https://cdn.example.org/anna.jpg',
    'card_photo_url',    '  https://cdn.example.org/anna-duza.jpg ',
    'card_cta_label_pl', ' Zobacz profil ',
    'card_cta_label_en', 'View profile',
    'card_cta_url',      'https://www.example.org/anna',
    'card_cta_color',    '#FF7000'
  ));
  v_p1 := (v_res->>'speaker_profile_id')::uuid;

  PERFORM pg_temp.assert(
    (SELECT sp.card_photo_url = 'https://cdn.example.org/anna-duza.jpg'
        AND sp.card_cta_label_pl = 'Zobacz profil'
        AND sp.card_cta_label_en = 'View profile'
        AND sp.card_cta_url = 'https://www.example.org/anna'
        AND sp.card_cta_color = '#ff7000'
       FROM public.speaker_profiles sp WHERE sp.id = v_p1),
    '41 upsert: pola karty zapisane przy zakladaniu (obciete, kolor malymi literami)');

  -- Ponowny upsert tej samej osoby BEZ kluczy karty nie rusza karty.
  PERFORM public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id', v_event, 'person_id', (v_res->>'person_id')));
  PERFORM pg_temp.assert(
    (SELECT sp.card_cta_url = 'https://www.example.org/anna'
       FROM public.speaker_profiles sp WHERE sp.id = v_p1),
    '41 upsert: payload bez kluczy karty NIE czysci karty');

  -- Druga osoba: nakladka NIEPUBLICZNA z wypelniona karta (dowod bramki (e)).
  v_res := public.admin_event_speaker_upsert(jsonb_build_object(
    'event_id',       v_event,
    'first_name',     'Jan',
    'last_name',      'Ukryty',
    'is_public',      false,
    'card_cta_url',   'https://www.example.org/jan',
    'card_cta_color', '#123456'
  ));
  v_p2 := (v_res->>'speaker_profile_id')::uuid;

  -- ---------------------------------------------------------------------------
  -- (a) EDYCJA KARTY: PATCH PO OBECNOSCI KLUCZA
  -- ---------------------------------------------------------------------------
  v_res := public.admin_event_speaker_card_save(jsonb_build_object(
    'speaker_profile_id', v_p1, 'card_cta_label_pl', 'Profil w LinkedIn'));
  PERFORM pg_temp.assert(
    (v_res->>'speaker_profile_id')::uuid = v_p1 AND (v_res->>'updated_at') IS NOT NULL,
    '41 karta: zapis oddaje identyfikator i znacznik czasu');
  PERFORM pg_temp.assert(
    (SELECT sp.card_cta_label_pl = 'Profil w LinkedIn'
        AND sp.card_cta_label_en = 'View profile'
        AND sp.card_photo_url = 'https://cdn.example.org/anna-duza.jpg'
        AND sp.card_cta_color = '#ff7000'
       FROM public.speaker_profiles sp WHERE sp.id = v_p1),
    '41 karta: zmienia sie TYLKO podany klucz');

  PERFORM public.admin_event_speaker_card_save(jsonb_build_object(
    'speaker_profile_id', v_p1, 'card_cta_url', '', 'card_cta_color', '   '));
  PERFORM pg_temp.assert(
    (SELECT sp.card_cta_url IS NULL AND sp.card_cta_color IS NULL
        AND sp.card_cta_label_pl = 'Profil w LinkedIn'
       FROM public.speaker_profiles sp WHERE sp.id = v_p1),
    '41 karta: pusty napis CZYSCI kolumne');

  -- ---------------------------------------------------------------------------
  -- (b) KSZTALT WARTOSCI
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_photo_url', 'http://cdn.example.org/a.jpg'))$q$, v_p1),
    'speaker_profiles_card_photo_url_https',
    '41 ksztalt: kadr karty po http jest odrzucany');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_url', '//evil.example.org/x'))$q$, v_p1),
    'speaker_profiles_card_cta_url_shape',
    '41 ksztalt: adres protokol-wzgledny przycisku jest odrzucany');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_url', 'javascript:alert(1)'))$q$, v_p1),
    'speaker_profiles_card_cta_url_shape',
    '41 ksztalt: adres javascript: przycisku jest odrzucany');
  -- `/\` przegladarka czyta jak `//` (poza serwis), a tabulator wycina parser
  -- adresu - `/<tab>/evil` stalby sie `//evil`. Wielkie „HTTPS" odrzuca CHECK
  -- z rozroznieniem liter; panel ma te sama regule (`safeCardHref`).
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_url', %L))$q$, v_p1, E'/\\evil.example.org'),
    'speaker_profiles_card_cta_url_shape',
    '41 ksztalt: sciezka z odwrotnym ukosnikiem na drugim miejscu jest odrzucana');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_url', %L))$q$, v_p1, E'/\t/evil.example.org'),
    'speaker_profiles_card_cta_url_shape',
    '41 ksztalt: znak sterujacy w adresie przycisku jest odrzucany');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_url', 'HTTPS://example.org'))$q$, v_p1),
    'speaker_profiles_card_cta_url_shape',
    '41 ksztalt: wielkie HTTPS jest odrzucane jak w panelu');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_color', 'orange'))$q$, v_p1),
    'speaker_profiles_card_cta_color_hex',
    '41 ksztalt: kolor spoza #RRGGBB jest odrzucany');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_label_en', %L))$q$, v_p1, repeat('x', 41)),
    'speaker_profiles_card_cta_label_len',
    '41 ksztalt: etykieta ponad 40 znakow jest odrzucana');

  PERFORM public.admin_event_speaker_card_save(jsonb_build_object(
    'speaker_profile_id', v_p1, 'card_cta_url', '/experts/anna-karta',
    'card_cta_color', '#FF7000'));
  PERFORM pg_temp.assert(
    (SELECT sp.card_cta_url = '/experts/anna-karta'
       FROM public.speaker_profiles sp WHERE sp.id = v_p1),
    '41 ksztalt: sciezka wewnetrzna przycisku jest przyjmowana');

  -- ---------------------------------------------------------------------------
  -- OBSADA: przypisanie przez RPC panelu (tak, jak zrobi to edytor obsady).
  -- ---------------------------------------------------------------------------
  PERFORM public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', v_s1, 'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', v_p1, 'role', 'moderator'),
      jsonb_build_object('speaker_profile_id', v_p2, 'role', 'panelist'))));
  PERFORM public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', v_s2, 'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', v_p1, 'role', 'speaker'))));
  PERFORM public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', v_s3, 'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', v_p1, 'role', 'speaker'))));
  PERFORM public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', v_s4, 'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', v_p1, 'role', 'panelist'))));
  -- Odwolanie PO przypisaniu - dokladnie ta kolejnosc zdarza sie w programie.
  UPDATE public.event_sessions SET status = 'cancelled', cancelled_at = now()
   WHERE id = v_s3;

  -- ---------------------------------------------------------------------------
  -- (f) SZCZEGOL SESJI W PANELU NIE GUBI OSOBY BEZ KONTA
  -- ---------------------------------------------------------------------------
  SELECT * INTO v_row FROM public.admin_event_session_detail(v_s1);
  PERFORM pg_temp.assert(jsonb_array_length(v_row.speakers) = 2,
    '41 panel: szczegol sesji oddaje OBIE osoby bez konta (dostano: '
      || jsonb_array_length(v_row.speakers) || ')');
  PERFORM pg_temp.assert(
    v_row.speakers->0->>'display_name' = 'Anna Karta'
      AND v_row.speakers->0->>'role' = 'moderator'
      AND (v_row.speakers->0->>'person_id') IS NOT NULL
      AND (v_row.speakers->0->>'user_id') IS NULL
      AND v_row.speakers->0->>'job_title' = 'Prezeska'
      AND v_row.speakers->1->>'is_public' = 'false',
    '41 panel: osoba bez konta ma nazwisko, role, person_id i flage widocznosci');

  -- ---------------------------------------------------------------------------
  -- (c) SCIEZKI W PANELU: szkic i sesja prywatna tak, odwolana nie
  -- ---------------------------------------------------------------------------
  SELECT * INTO v_row FROM public.admin_event_speakers_list(v_event) l
   WHERE l.speaker_profile_id = v_p1;
  SELECT jsonb_agg(x->>'key' ORDER BY x->>'key') INTO v_tracks
    FROM jsonb_array_elements(v_row.tracks) x;
  PERFORM pg_temp.assert(v_tracks = '["dyplomacja", "energia", "media"]'::jsonb,
    '41 panel: sciezki = energia + dyplomacja (szkic) + media (prywatna), bez obrony (dostano: '
      || COALESCE(v_tracks::text, 'NULL') || ')');
  -- Kolejnosc = klucz techniczny (jak filtry programu), a NIE `sort_order`:
  -- scenografia ma sort_order energia=1, dyplomacja=2, wiec obie kolejnosci
  -- sie tu roznia i asercja widzi, ktora wygrala.
  SELECT jsonb_agg(x.item->>'key' ORDER BY x.ord) INTO v_tracks
    FROM jsonb_array_elements(v_row.tracks) WITH ORDINALITY AS x(item, ord);
  PERFORM pg_temp.assert(v_tracks = '["dyplomacja", "energia", "media"]'::jsonb,
    '41 panel: sciezki w kolejnosci klucza, nie sort_order (dostano: '
      || COALESCE(v_tracks::text, 'NULL') || ')');
  PERFORM pg_temp.assert(jsonb_array_length(v_row.sessions) = 3,
    '41 panel: obsada wpisu bez sesji odwolanej (3 sesje)');
  PERFORM pg_temp.assert(
    v_row.card_cta_url = '/experts/anna-karta' AND v_row.card_cta_label_pl = 'Profil w LinkedIn',
    '41 panel: lista oddaje pola karty');

  -- ---------------------------------------------------------------------------
  -- (c)(e) STRONA PUBLICZNA - widok anonima
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.act_as();

  SELECT * INTO v_row FROM public.event_speakers_public(jsonb_build_object('slug', 'karta-41')) p
   WHERE p.speaker_profile_id = v_p1;
  PERFORM pg_temp.assert(
    jsonb_array_length(v_row.tracks) = 1
      AND v_row.tracks->0->>'key' = 'energia'
      AND v_row.tracks->0->>'name_pl' = 'Energia'
      AND v_row.tracks->0->>'accent_color' = '#C2410C'
      AND (v_row.tracks->0->>'sessions_count')::integer = 1,
    '41 front: sciezki = WYLACZNIE opublikowana, nieprywatna sesja (dostano: '
      || COALESCE(v_row.tracks::text, 'NULL') || ')');
  PERFORM pg_temp.assert(
    v_row.card_photo_url = 'https://cdn.example.org/anna-duza.jpg'
      AND v_row.card_cta_label_pl = 'Profil w LinkedIn'
      AND v_row.card_cta_url = '/experts/anna-karta'
      AND v_row.card_cta_color = '#ff7000',
    '41 front: publiczna nakladka oddaje pola karty');

  SELECT * INTO v_row FROM public.event_speakers_public(jsonb_build_object('slug', 'karta-41')) p
   WHERE p.speaker_profile_id = v_p2;
  PERFORM pg_temp.assert(v_row.display_name = 'Jan Ukryty',
    '41 front: osoba z niepubliczna nakladka ZOSTAJE na liscie');
  PERFORM pg_temp.assert(
    v_row.card_cta_url IS NULL AND v_row.card_cta_color IS NULL AND v_row.tracks = '[]'::jsonb,
    '41 front: niepubliczna nakladka NIE oddaje ani karty, ani sciezek');

  -- ---------------------------------------------------------------------------
  -- (d) ZDJECIE Z SESJI ZDEJMUJE SCIEZKE - bez zadnego drugiego zapisu
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.act_as(v_admin, v_tenant);
  PERFORM public.admin_event_session_speakers_set(jsonb_build_object(
    'session_id', v_s1, 'speakers', jsonb_build_array(
      jsonb_build_object('speaker_profile_id', v_p2, 'role', 'panelist'))));
  PERFORM pg_temp.act_as();
  SELECT * INTO v_row FROM public.event_speakers_public(jsonb_build_object('slug', 'karta-41')) p
   WHERE p.speaker_profile_id = v_p1;
  PERFORM pg_temp.assert(v_row.tracks = '[]'::jsonb,
    '41 front: zdjecie z jedynej opublikowanej sesji zdejmuje sciezke automatycznie');

  -- ---------------------------------------------------------------------------
  -- (g) BRAMKI
  -- ---------------------------------------------------------------------------
  PERFORM pg_temp.act_as('41a00000-0000-0000-0000-0000000000a2', v_tenant);
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', %L, 'card_cta_label_pl', 'Redaktor'))$q$, v_p1),
    'forbidden',
    '41 bramka: redaktor NIE edytuje karty (kontrakt modulu: admin albo super_admin)');

  PERFORM pg_temp.act_as(v_admin, v_tenant);
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_speaker_card_save(jsonb_build_object(
      'speaker_profile_id', '41ffffff-0000-0000-0000-000000000000'))$q$,
    'speaker profile not found in tenant',
    '41 bramka: profil spoza najemcy daje nazwany blad');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_speaker_card_save('{}'::jsonb)$q$,
    'speaker_profile_id is required',
    '41 bramka: brak speaker_profile_id daje nazwany blad');
END $do$;

-- Pomocnik sciezek przyjmuje najemce PARAMETREM, wiec klient nie moze go
-- wolac wprost - czytamy katalog, bo wlasciciel bazy omija granty.
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_speaker_tracks(uuid, uuid, uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._event_speaker_tracks(uuid, uuid, uuid, boolean)', 'EXECUTE'),
  '41 granty: _event_speaker_tracks nie jest wykonywalny dla anon ani authenticated');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_speaker_card_save(jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.admin_event_speaker_card_save(jsonb)', 'EXECUTE'),
  '41 granty: zapis karty tylko dla authenticated (bramka roli w ciele funkcji)');

SELECT pg_temp.assert(
  (SELECT count(*) = 0
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN unnest(p.proargnames) AS a(name) ON true
    WHERE n.nspname = 'public'
      AND p.proname = 'event_speakers_public'
      AND a.name ~* '(email|phone|telefon)'),
  '41 kontrakt: nowe kolumny projekcji nie oddaja kontaktu');

ROLLBACK;

\echo '== 41 karta prelegenta i sciezki: koniec =='
