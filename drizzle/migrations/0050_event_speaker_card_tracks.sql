-- ----------------------------------------------------------------------------
-- 1) POLA KARTY NA NAKLADCE SCENICZNEJ
--
-- Adresy wymagaja https z tego samego powodu, co `event_people.photo_url`:
-- jada do `src`/`href` strony serwowanej po https, a mieszana zawartosc jest
-- blokowana. Przycisk przyjmuje tez sciezke wewnetrzna („/experts/...") -
-- link w obrebie serwisu nie potrzebuje domeny. Adres zaczynajacy sie od
-- `//` albo `/\` jest odrzucany: przegladarka czyta oba jak adres wzgledny
-- wobec protokolu, czyli link POZA serwis. Bialych i sterujacych znakow nie ma
-- nigdzie w adresie przycisku - parser adresu wycina tabulatory, wiec
-- `/<tab>/evil` stalby sie `//evil`.
-- Kolor to ten sam format, co `event_tracks.accent_color`.
-- ----------------------------------------------------------------------------
ALTER TABLE public.speaker_profiles
  ADD COLUMN IF NOT EXISTS card_photo_url text,
  ADD COLUMN IF NOT EXISTS card_cta_label_pl text,
  ADD COLUMN IF NOT EXISTS card_cta_label_en text,
  ADD COLUMN IF NOT EXISTS card_cta_url text,
  ADD COLUMN IF NOT EXISTS card_cta_color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.speaker_profiles'::regclass
       AND conname = 'speaker_profiles_card_photo_url_https'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_card_photo_url_https
      CHECK (
        card_photo_url IS NULL
        OR (card_photo_url ~ '^https://' AND char_length(card_photo_url) <= 2048)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.speaker_profiles'::regclass
       AND conname = 'speaker_profiles_card_cta_url_shape'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_card_cta_url_shape
      CHECK (
        card_cta_url IS NULL
        OR (
          (card_cta_url ~ '^https://' OR card_cta_url ~ '^/[^/\\]')
          AND card_cta_url !~ '[[:space:][:cntrl:]]'
          AND char_length(card_cta_url) <= 2048
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.speaker_profiles'::regclass
       AND conname = 'speaker_profiles_card_cta_label_len'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_card_cta_label_len
      CHECK (
        (card_cta_label_pl IS NULL OR char_length(btrim(card_cta_label_pl)) BETWEEN 1 AND 40)
        AND (card_cta_label_en IS NULL OR char_length(btrim(card_cta_label_en)) BETWEEN 1 AND 40)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.speaker_profiles'::regclass
       AND conname = 'speaker_profiles_card_cta_color_hex'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_card_cta_color_hex
      CHECK (card_cta_color IS NULL OR card_cta_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
END
$$;

COMMENT ON COLUMN public.speaker_profiles.card_photo_url IS
  'Kadr ROZWINIETEJ karty prelegenta (https). Pusty = karta rozwija sie na zdjeciu profilowym (konto) albo zdjeciu z kartoteki (osoba bez konta).';
COMMENT ON COLUMN public.speaker_profiles.card_cta_label_pl IS
  'Etykieta przycisku akcji karty prelegenta, PL (1-40 znakow). Pusta = etykieta domyslna interfejsu.';
COMMENT ON COLUMN public.speaker_profiles.card_cta_label_en IS
  'Etykieta przycisku akcji karty prelegenta, EN (1-40 znakow).';
COMMENT ON COLUMN public.speaker_profiles.card_cta_url IS
  'Adres przycisku akcji karty (https albo sciezka wewnetrzna). Pusty = przycisk otwiera profil prelegenta, o ile jest co pokazac.';
COMMENT ON COLUMN public.speaker_profiles.card_cta_color IS
  'Kolor tla przycisku akcji w rozwinietej karcie (#RRGGBB). Pusty = kolor marki wydarzenia.';

-- ----------------------------------------------------------------------------
-- 2) SCIEZKI PRELEGENTA - JEDEN RACHUNEK
--
-- Sciezka nalezy do prelegenta, jezeli prelegent stoi w obsadzie CHOCIAZ
-- JEDNEJ sesji tej sciezki. Sesja odwolana nie dopisuje sciezki (prelegent tam
-- nie wystapi). `p_published_only` rozdziela dwie plaszczyzny:
--   * strona publiczna widzi TYLKO to, co widzi w programie - sesje
--     opublikowane i niepubliczne-nie (`is_private = false`); sciezka ze szkicu
--     sesji nie moze wyprzedzic ogloszenia programu;
--   * panel widzi takze szkice - redaktor ma zobaczyc skutek przypisania,
--     zanim opublikuje sesje.
-- Sciezki NIE sa filtrowane po `event_tracks.is_public`, bo `event_agenda`
-- tego nie robi: karta prelegenta i program musza mowic o tych samych
-- sciezkach (ta sama nazwa przy sesji i przy osobie). Kolejnosc: klucz
-- techniczny, jak filtry sciezek programu (`agendaTrackOptions`) i sciezki
-- prelegenta w programie oraz w podgladzie studia - chipy stoja wszedzie
-- w tym samym porzadku.
--
-- LANGUAGE sql, SECURITY INVOKER: pomocnik nie ma wlasnej bramki - wolaja go
-- WYLACZNIE funkcje SECURITY DEFINER, ktore same rozstrzygaja najemce, a
-- klient nie ma do niego grantu (najemca jest tu PARAMETREM, wiec wywolanie
-- wprost byloby zapytaniem o obcego najemce).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._event_speaker_tracks(
  p_tenant uuid,
  p_event_id uuid,
  p_speaker_profile_id uuid,
  p_published_only boolean
)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'key', t.key,
        'name_pl', t.name_pl,
        'name_en', t.name_en,
        'accent_color', t.accent_color,
        'sessions_count', x.sessions_count
      ) ORDER BY t.key, t.id
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT s.track_id, count(DISTINCT s.id)::integer AS sessions_count
      FROM public.event_session_speakers ss
      JOIN public.event_sessions s
        ON s.tenant_id = ss.tenant_id AND s.event_id = ss.event_id AND s.id = ss.session_id
     WHERE p_speaker_profile_id IS NOT NULL
       AND ss.tenant_id = p_tenant
       AND ss.event_id = p_event_id
       AND ss.speaker_profile_id = p_speaker_profile_id
       AND s.track_id IS NOT NULL
       AND s.status <> 'cancelled'
       AND (NOT p_published_only OR (s.status = 'published' AND s.is_private = false))
     GROUP BY s.track_id
  ) x
  JOIN public.event_tracks t
    ON t.tenant_id = p_tenant AND t.event_id = p_event_id AND t.id = x.track_id;
$$;

REVOKE ALL ON FUNCTION public._event_speaker_tracks(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_speaker_tracks(uuid, uuid, uuid, boolean)
  TO service_role;

COMMENT ON FUNCTION public._event_speaker_tracks(uuid, uuid, uuid, boolean) IS
  'Pomocnik: sciezki prelegenta wyprowadzone z obsady sesji (event_session_speakers -> event_sessions.track_id), bez sesji odwolanych; p_published_only = tylko sesje opublikowane i nieprywatne. Wolany wylacznie przez event_speakers_public i admin_event_speakers_list.';

-- ----------------------------------------------------------------------------
-- 3) PROJEKCJA PUBLICZNA
--
-- Cialo jest przepisane 1:1 z 20260827154053 - dochodza WYLACZNIE kolumny
-- na koncu RETURNS TABLE. Pola karty stoja za ta sama bramka, co tekst
-- sceniczny (`sp` jest dolaczone z warunkiem `sp.is_public`): nakladka
-- niepubliczna nie oddaje ani biogramu, ani karty, ani sciezek - osoba zostaje
-- na liscie z nazwiskiem, zdjeciem, stanowiskiem i firma, jak dotad.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.event_speakers_public(jsonb);
CREATE FUNCTION public.event_speakers_public(p_payload jsonb)
RETURNS TABLE (
  speaker_profile_id uuid,
  user_id uuid,
  person_id uuid,
  slug text,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  headline_pl text,
  headline_en text,
  bio_pl text,
  bio_en text,
  topics_pl text[],
  topics_en text[],
  languages text[],
  talks_count integer,
  rating numeric,
  reviews_count integer,
  is_expert boolean,
  has_speaker_profile boolean,
  sort_order integer,
  card_photo_url text,
  card_cta_label_pl text,
  card_cta_label_en text,
  card_cta_url text,
  card_cta_color text,
  tracks jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant   uuid := public.public_tenant_id();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_slug     text := NULLIF(btrim(p_payload->>'slug'), '');
  v_limit    integer := LEAST(GREATEST(COALESCE((p_payload->>'limit')::integer, 100), 1), 200);
BEGIN
  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
    FROM public.events e
   WHERE e.tenant_id = v_tenant
     AND e.status = 'published'
     AND (
       (v_event_id IS NOT NULL AND e.id = v_event_id)
       OR (v_event_id IS NULL AND v_slug IS NOT NULL AND e.slug = v_slug)
     );

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      sp.id AS speaker_profile_id,
      sp.user_id,
      sp.person_id,
      en.sort_order
    FROM public.event_speaker_entries en
    JOIN public.speaker_profiles sp
      ON sp.id = en.speaker_profile_id AND sp.tenant_id = en.tenant_id
    WHERE en.tenant_id = v_tenant
      AND en.event_id = v_event_id
    UNION ALL
    SELECT
      sp.id AS speaker_profile_id,
      es.user_id,
      NULL::uuid AS person_id,
      es.sort_order
    FROM public.event_speakers es
    LEFT JOIN public.speaker_profiles sp
      ON sp.user_id = es.user_id AND sp.tenant_id = v_tenant
    WHERE es.event_id = v_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_speaker_entries en2
        JOIN public.speaker_profiles sp2
          ON sp2.id = en2.speaker_profile_id AND sp2.tenant_id = en2.tenant_id
        WHERE en2.tenant_id = v_tenant
          AND en2.event_id = v_event_id
          AND sp2.user_id = es.user_id
      )
  )
  SELECT
    b.speaker_profile_id,
    b.user_id,
    b.person_id,
    p.slug,
    COALESCE(
      p.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ) AS display_name,
    COALESCE(ap.avatar_url, p.avatar_url, pe.photo_url) AS avatar_url,
    COALESCE(ap.job_title, pe.job_title) AS job_title,
    COALESCE(ap.company, pe.company_text) AS company,
    sp.headline_pl,
    sp.headline_en,
    CASE WHEN sp.id IS NOT NULL THEN COALESCE(sp.bio_pl, pe.bio_pl) END AS bio_pl,
    CASE WHEN sp.id IS NOT NULL THEN COALESCE(sp.bio_en, pe.bio_en) END AS bio_en,
    COALESCE(sp.topics_pl, '{}') AS topics_pl,
    COALESCE(sp.topics_en, '{}') AS topics_en,
    COALESCE(sp.languages, '{}') AS languages,
    COALESCE(sp.talks_count, 0) AS talks_count,
    COALESCE(sp.rating, 0) AS rating,
    COALESCE(sp.reviews_count, 0) AS reviews_count,
    EXISTS (
      SELECT 1 FROM public.profile_badges pb
       WHERE pb.user_id = b.user_id
         AND pb.badge = 'expert'
         AND pb.tenant_id = v_tenant
    ) AS is_expert,
    (b.speaker_profile_id IS NOT NULL) AS has_speaker_profile,
    b.sort_order,
    sp.card_photo_url,
    sp.card_cta_label_pl,
    sp.card_cta_label_en,
    sp.card_cta_url,
    sp.card_cta_color,
    CASE
      WHEN sp.id IS NOT NULL
        THEN public._event_speaker_tracks(v_tenant, v_event_id, sp.id, true)
      ELSE '[]'::jsonb
    END AS tracks
  FROM base b
  LEFT JOIN public.profiles p
    ON p.id = b.user_id AND p.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.speaker_profiles sp
    ON sp.id = b.speaker_profile_id AND sp.tenant_id = v_tenant AND sp.is_public
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant AND ap.is_public
  WHERE p.id IS NOT NULL OR pe.id IS NOT NULL
  ORDER BY b.sort_order, lower(COALESCE(p.display_name, pe.last_name, ''))
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.event_speakers_public(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_speakers_public(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_speakers_public(jsonb) IS
  'Publiczna lista prelegentow OPUBLIKOWANEGO wydarzenia (payload: event_id albo slug, opcjonalnie limit). UNION event_speaker_entries + legacy event_speakers, LEFT JOIN profiles - osoba BEZ konta bierze nazwisko, zdjecie, stanowisko i firme z kartoteki event_people. BRAMKA NAKLADKI: biogram, pola karty (card_*) i sciezki (tracks) wychodza WYLACZNIE przy PUBLICZNEJ nakladce scenicznej (speaker_profiles.is_public); nazwisko, zdjecie, stanowisko i firma ida bez warunku. Sciezki wynikaja z obsady opublikowanych sesji. Plaszczyzna tresci: public_tenant_id(), zero has_role().';

-- ----------------------------------------------------------------------------
-- 4) LISTA PANELU
--
-- Przepisana z 20260827064804; dochodza kolumny na koncu. `tracks` liczy
-- takze szkice sesji (redaktor widzi skutek przypisania przed publikacja),
-- `sessions` to obsada wpisu - z niej podglad studia buduje prelegentow
-- w programie, zamiast rysowac sesje z pustym rzedem obsady.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_speakers_list(uuid);
CREATE FUNCTION public.admin_event_speakers_list(p_event_id uuid)
RETURNS TABLE (
  entry_id uuid,
  speaker_profile_id uuid,
  user_id uuid,
  person_id uuid,
  display_name text,
  avatar_url text,
  job_title text,
  company text,
  email text,
  is_public boolean,
  sort_order integer,
  is_legacy boolean,
  headline_pl text,
  headline_en text,
  card_photo_url text,
  card_cta_label_pl text,
  card_cta_label_en text,
  card_cta_url text,
  card_cta_color text,
  tracks jsonb,
  sessions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = p_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      en.id AS entry_id,
      en.speaker_profile_id,
      sp.user_id,
      sp.person_id,
      sp.is_public,
      en.sort_order,
      false AS is_legacy
    FROM public.event_speaker_entries en
    JOIN public.speaker_profiles sp
      ON sp.id = en.speaker_profile_id AND sp.tenant_id = en.tenant_id
    WHERE en.tenant_id = v_tenant
      AND en.event_id = p_event_id
    UNION ALL
    SELECT
      NULL::uuid AS entry_id,
      sp.id AS speaker_profile_id,
      es.user_id,
      NULL::uuid AS person_id,
      sp.is_public,
      es.sort_order,
      true AS is_legacy
    FROM public.event_speakers es
    LEFT JOIN public.speaker_profiles sp
      ON sp.user_id = es.user_id AND sp.tenant_id = v_tenant
    WHERE es.event_id = p_event_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_speaker_entries en2
        JOIN public.speaker_profiles sp2
          ON sp2.id = en2.speaker_profile_id AND sp2.tenant_id = en2.tenant_id
        WHERE en2.tenant_id = v_tenant
          AND en2.event_id = p_event_id
          AND sp2.user_id = es.user_id
      )
  )
  SELECT
    b.entry_id,
    b.speaker_profile_id,
    b.user_id,
    b.person_id,
    COALESCE(
      pr.display_name,
      NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '')
    ) AS display_name,
    COALESCE(pr.avatar_url, pe.photo_url) AS avatar_url,
    COALESCE(ap.job_title, pe.job_title) AS job_title,
    COALESCE(ap.company, pe.company_text) AS company,
    pe.email,
    COALESCE(b.is_public, true) AS is_public,
    b.sort_order,
    b.is_legacy,
    spf.headline_pl,
    spf.headline_en,
    spf.card_photo_url,
    spf.card_cta_label_pl,
    spf.card_cta_label_en,
    spf.card_cta_url,
    spf.card_cta_color,
    public._event_speaker_tracks(v_tenant, p_event_id, b.speaker_profile_id, false) AS tracks,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'session_id', ss.session_id,
          'role', ss.role,
          'sort_order', ss.sort_order
        ) ORDER BY s.starts_at, ss.sort_order
      )
        FROM public.event_session_speakers ss
        JOIN public.event_sessions s
          ON s.tenant_id = ss.tenant_id AND s.event_id = ss.event_id AND s.id = ss.session_id
       WHERE b.speaker_profile_id IS NOT NULL
         AND ss.tenant_id = v_tenant
         AND ss.event_id = p_event_id
         AND ss.speaker_profile_id = b.speaker_profile_id
         AND s.status <> 'cancelled'
    ), '[]'::jsonb) AS sessions
  FROM base b
  LEFT JOIN public.profiles pr
    ON pr.id = b.user_id AND pr.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = b.person_id AND pe.tenant_id = v_tenant
  LEFT JOIN public.author_profiles ap
    ON ap.user_id = b.user_id AND ap.tenant_id = v_tenant
  LEFT JOIN public.speaker_profiles spf
    ON spf.id = b.speaker_profile_id AND spf.tenant_id = v_tenant
  ORDER BY b.sort_order, lower(COALESCE(pr.display_name, pe.last_name, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speakers_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speakers_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speakers_list(uuid) IS
  'Prelegenci wydarzenia w panelu: rejestr event_speaker_entries + legacy event_speakers, osoba z kontem albo z kartoteki. Oddaje pola karty (card_*), naglowek sceniczny, sciezki wyprowadzone z obsady (tracks, lacznie ze szkicami sesji) i obsade wpisu (sessions). Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 5) ZAKLADANIE PRELEGENTA PRZYJMUJE POLA KARTY
--
-- Cialo przepisane z 20260827064804; dochodzi piec przypisan w UPDATE nakladki.
-- Pola karty sa PATCHOWANE PO OBECNOSCI KLUCZA (jak tematy): brak klucza =
-- „nie dotykaj", pusty napis = „wyczysc". Dodanie prelegenta z konta
-- (`{event_id, user_id}`) tych kluczy nie niesie, wiec karty nie rusza.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_speaker_upsert(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_uid        uuid := auth.uid();
  v_event_id   uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_user_id    uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_person_id  uuid := NULLIF(p_payload->>'person_id', '')::uuid;
  v_group_id   uuid := NULLIF(p_payload->>'group_id', '')::uuid;
  v_email      text := NULLIF(btrim(p_payload->>'email'), '');
  v_first      text := NULLIF(btrim(p_payload->>'first_name'), '');
  v_last       text := NULLIF(btrim(p_payload->>'last_name'), '');
  v_profile_id uuid;
  v_entry_id   uuid;
  v_sort       integer;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: event_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'event_speakers: event not found in tenant' USING ERRCODE = '42501';
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles pr
       WHERE pr.id = v_user_id AND pr.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'event_speakers: profile not found in tenant' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, user_id)
    VALUES (v_tenant, v_user_id)
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;
  ELSE
    IF v_person_id IS NULL THEN
      IF v_first IS NULL OR v_last IS NULL THEN
        RAISE EXCEPTION 'event_speakers: first_name and last_name are required'
          USING ERRCODE = '22023';
      END IF;

      IF v_email IS NOT NULL THEN
        SELECT pe.id INTO v_person_id
          FROM public.event_people pe
         WHERE pe.tenant_id = v_tenant
           AND pe.email_norm = lower(btrim(v_email));
      END IF;
    END IF;

    IF v_person_id IS NULL THEN
      INSERT INTO public.event_people (
        tenant_id, email, first_name, last_name, phone, job_title,
        company_text, social_profile_url, photo_url, bio_pl, bio_en,
        source, consent_data_processing_at, created_by
      ) VALUES (
        v_tenant, v_email, v_first, v_last,
        NULLIF(btrim(p_payload->>'phone'), ''),
        NULLIF(btrim(p_payload->>'job_title'), ''),
        NULLIF(btrim(p_payload->>'company_text'), ''),
        NULLIF(btrim(p_payload->>'social_profile_url'), ''),
        NULLIF(btrim(p_payload->>'photo_url'), ''),
        NULLIF(btrim(p_payload->>'bio_pl'), ''),
        NULLIF(btrim(p_payload->>'bio_en'), ''),
        'organizer', now(), v_uid
      )
      RETURNING id INTO v_person_id;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.event_people pe
         WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant
      ) THEN
        RAISE EXCEPTION 'event_speakers: person not found in tenant' USING ERRCODE = '42501';
      END IF;

      UPDATE public.event_people pe SET
        first_name         = COALESCE(v_first, pe.first_name),
        last_name          = COALESCE(v_last, pe.last_name),
        email              = COALESCE(v_email, pe.email),
        phone              = COALESCE(NULLIF(btrim(p_payload->>'phone'), ''), pe.phone),
        job_title          = COALESCE(NULLIF(btrim(p_payload->>'job_title'), ''), pe.job_title),
        company_text       = COALESCE(NULLIF(btrim(p_payload->>'company_text'), ''), pe.company_text),
        social_profile_url = COALESCE(NULLIF(btrim(p_payload->>'social_profile_url'), ''), pe.social_profile_url),
        photo_url          = COALESCE(NULLIF(btrim(p_payload->>'photo_url'), ''), pe.photo_url),
        bio_pl             = COALESCE(NULLIF(btrim(p_payload->>'bio_pl'), ''), pe.bio_pl),
        bio_en             = COALESCE(NULLIF(btrim(p_payload->>'bio_en'), ''), pe.bio_en),
        consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now())
      WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
    END IF;

    INSERT INTO public.speaker_profiles AS sp (tenant_id, person_id)
    VALUES (v_tenant, v_person_id)
    ON CONFLICT (tenant_id, person_id) WHERE person_id IS NOT NULL DO UPDATE
      SET updated_at = now()
    RETURNING sp.id INTO v_profile_id;

    IF v_group_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.event_groups g
         WHERE g.id = v_group_id AND g.tenant_id = v_tenant AND g.event_id = v_event_id
      ) THEN
        RAISE EXCEPTION 'event_speakers: group not found in event' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.event_group_members (tenant_id, event_id, group_id, person_id, added_by)
      VALUES (v_tenant, v_event_id, v_group_id, v_person_id, v_uid)
      ON CONFLICT (tenant_id, group_id, person_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE public.speaker_profiles sp SET
    headline_pl = COALESCE(NULLIF(btrim(p_payload->>'headline_pl'), ''), sp.headline_pl),
    headline_en = COALESCE(NULLIF(btrim(p_payload->>'headline_en'), ''), sp.headline_en),
    topics_pl   = CASE WHEN p_payload ? 'topics_pl'
                       THEN public._event_speaker_text_array(p_payload->'topics_pl')
                       ELSE sp.topics_pl END,
    topics_en   = CASE WHEN p_payload ? 'topics_en'
                       THEN public._event_speaker_text_array(p_payload->'topics_en')
                       ELSE sp.topics_en END,
    languages   = CASE WHEN p_payload ? 'languages'
                       THEN public._event_speaker_text_array(p_payload->'languages')
                       ELSE sp.languages END,
    is_public   = COALESCE((p_payload->>'is_public')::boolean, sp.is_public),
    card_photo_url    = CASE WHEN p_payload ? 'card_photo_url'
                             THEN NULLIF(btrim(p_payload->>'card_photo_url'), '')
                             ELSE sp.card_photo_url END,
    card_cta_label_pl = CASE WHEN p_payload ? 'card_cta_label_pl'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_pl'), '')
                             ELSE sp.card_cta_label_pl END,
    card_cta_label_en = CASE WHEN p_payload ? 'card_cta_label_en'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_en'), '')
                             ELSE sp.card_cta_label_en END,
    card_cta_url      = CASE WHEN p_payload ? 'card_cta_url'
                             THEN NULLIF(btrim(p_payload->>'card_cta_url'), '')
                             ELSE sp.card_cta_url END,
    card_cta_color    = CASE WHEN p_payload ? 'card_cta_color'
                             THEN lower(NULLIF(btrim(p_payload->>'card_cta_color'), ''))
                             ELSE sp.card_cta_color END
  WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant;

  SELECT COALESCE(MAX(en.sort_order) + 1, 0) INTO v_sort
    FROM public.event_speaker_entries en
   WHERE en.tenant_id = v_tenant AND en.event_id = v_event_id;

  INSERT INTO public.event_speaker_entries AS en (
    tenant_id, event_id, speaker_profile_id, sort_order
  ) VALUES (v_tenant, v_event_id, v_profile_id, v_sort)
  ON CONFLICT (tenant_id, event_id, speaker_profile_id) DO UPDATE
    SET updated_at = now()
  RETURNING en.id INTO v_entry_id;

  RETURN jsonb_build_object(
    'entry_id', v_entry_id,
    'speaker_profile_id', v_profile_id,
    'person_id', v_person_id,
    'user_id', v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_upsert(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_upsert(jsonb) IS
  'Zaklada prelegenta i podpina go do wydarzenia w JEDNYM zapisie. Tryb osoby (bez user_id): dopasowanie/zalozenie event_people po email_norm + nakladka speaker_profiles(person_id) + wpis event_speaker_entries. Tryb konta (user_id): nakladka speaker_profiles(user_id) + wpis. Pola karty (card_*) po obecnosci klucza. Zgody: wylacznie consent_data_processing_at, source=organizer. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 6) EDYCJA KARTY ISTNIEJACEGO PRELEGENTA
--
-- Po `speaker_profile_id`, wiec dziala tak samo dla konta i dla osoby bez
-- konta (dialog profilu scenicznego stoi na `user_id` i osoby bez konta nie
-- obsluguje). Dotyka WYLACZNIE pieciu kolumn karty - nie kartoteki, nie zgod,
-- nie rejestru wydarzenia. Klucz nieobecny = kolumna nietknieta, pusty napis
-- = wyczyszczenie; ksztalt wartosci rozstrzygaja CHECK-i tabeli, a ich nazwy
-- wracaja do panelu w tresci bledu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_speaker_card_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant     uuid := public.assert_event_admin_tenant();
  v_profile_id uuid := NULLIF(p_payload->>'speaker_profile_id', '')::uuid;
  v_updated_at timestamptz;
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'event_speakers: speaker_profile_id is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.speaker_profiles sp SET
    card_photo_url    = CASE WHEN p_payload ? 'card_photo_url'
                             THEN NULLIF(btrim(p_payload->>'card_photo_url'), '')
                             ELSE sp.card_photo_url END,
    card_cta_label_pl = CASE WHEN p_payload ? 'card_cta_label_pl'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_pl'), '')
                             ELSE sp.card_cta_label_pl END,
    card_cta_label_en = CASE WHEN p_payload ? 'card_cta_label_en'
                             THEN NULLIF(btrim(p_payload->>'card_cta_label_en'), '')
                             ELSE sp.card_cta_label_en END,
    card_cta_url      = CASE WHEN p_payload ? 'card_cta_url'
                             THEN NULLIF(btrim(p_payload->>'card_cta_url'), '')
                             ELSE sp.card_cta_url END,
    card_cta_color    = CASE WHEN p_payload ? 'card_cta_color'
                             THEN lower(NULLIF(btrim(p_payload->>'card_cta_color'), ''))
                             ELSE sp.card_cta_color END,
    updated_at        = now()
  WHERE sp.id = v_profile_id AND sp.tenant_id = v_tenant
  RETURNING sp.updated_at INTO v_updated_at;

  IF v_updated_at IS NULL THEN
    RAISE EXCEPTION 'event_speakers: speaker profile not found in tenant' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'speaker_profile_id', v_profile_id,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_speaker_card_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_speaker_card_save(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_speaker_card_save(jsonb) IS
  'Zapis pol karty prelegenta (card_photo_url, card_cta_label_pl/en, card_cta_url, card_cta_color) po speaker_profile_id - dla konta i osoby bez konta. PATCH po obecnosci klucza, pusty napis czysci. Nie dotyka kartoteki ani zgod. Bramka: assert_event_admin_tenant().';

-- ----------------------------------------------------------------------------
-- 7) OBSADA SESJI W PANELU NIE GUBI OSOBY BEZ KONTA
--
-- Cialo przepisane z 20260923120000; zmienia sie WYLACZNIE podzapytanie
-- obsady: LEFT JOIN `profiles` + LEFT JOIN `event_people` zamiast JOIN
-- `profiles`. Wiersz bez zadnego zrodla tozsamosci NIE jest tu odsiewany -
-- redaktor musi go zobaczyc, zeby moc go zdjac z sesji. Dochodza klucze
-- `person_id`, `job_title` i `is_public` (edytor obsady pokazuje, ze nakladka
-- niepubliczna nie wyjdzie w programie).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_event_session_detail(_id uuid)
 RETURNS TABLE(id uuid, event_id uuid, event_title_pl text, event_title_en text, event_timezone text, event_starts_at timestamp with time zone, event_ends_at timestamp with time zone, parent_session_id uuid, title_pl text, title_en text, description_pl text, description_en text, affiliation_pl text, affiliation_en text, starts_at timestamp with time zone, ends_at timestamp with time zone, format text, status text, capacity integer, requires_signup boolean, min_tier_rank integer, chatham_house boolean, is_private boolean, allow_overlap boolean, stream_url text, recording_url text, sort_order integer, published_at timestamp with time zone, cancelled_at timestamp with time zone, track_id uuid, room_id uuid, sponsor_id uuid, sponsor_name text, sponsor_logo_url text, sponsor_role text, registered_count integer, waitlist_count integer, seats_left integer, speakers jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.event_id, e.title_pl, e.title_en, e.timezone, e.starts_at, e.ends_at,
    s.parent_session_id, s.title_pl, s.title_en, s.description_pl, s.description_en,
    s.affiliation_pl, s.affiliation_en,
    s.starts_at, s.ends_at, s.format, s.status, s.capacity, s.requires_signup,
    s.min_tier_rank, s.chatham_house, s.is_private, s.allow_overlap,
    s.stream_url, s.recording_url, s.sort_order, s.published_at, s.cancelled_at,
    s.track_id, s.room_id,
    s.sponsor_id, spn.snapshot_name, spn.snapshot_logo_url, spn.role,
    COALESCE(g.registered, 0)::integer,
    COALESCE(g.waitlist, 0)::integer,
    CASE
      WHEN s.capacity IS NULL THEN NULL
      ELSE GREATEST(s.capacity - COALESCE(g.registered, 0), 0)
    END::integer,
    COALESCE(sp.items, '[]'::jsonb)
  FROM public.event_sessions s
  JOIN public.events e
    ON e.id = s.event_id AND e.tenant_id = s.tenant_id
  LEFT JOIN public.event_sponsors spn
    ON spn.tenant_id = s.tenant_id AND spn.event_id = s.event_id AND spn.id = s.sponsor_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE g0.status = 'registered')::integer AS registered,
      count(*) FILTER (WHERE g0.status = 'waitlist')::integer AS waitlist
    FROM public.event_session_signups g0
    WHERE g0.tenant_id = v_tenant AND g0.session_id = s.id
  ) g ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', es.id,
        'speaker_profile_id', es.speaker_profile_id,
        'user_id', pr.id,
        'person_id', pe.id,
        'display_name', COALESCE(pr.display_name, NULLIF(btrim(concat_ws(' ', pe.first_name, pe.last_name)), '')),
        'avatar_url', COALESCE(pr.avatar_url, pe.photo_url),
        'job_title', pe.job_title,
        'headline_pl', spf.headline_pl,
        'headline_en', spf.headline_en,
        'is_public', spf.is_public,
        'role', es.role,
        'sort_order', es.sort_order,
        'allow_overlap', es.allow_overlap
      ) ORDER BY es.sort_order, COALESCE(pr.display_name, pe.last_name, pe.first_name)
    ) AS items
    FROM public.event_session_speakers es
    JOIN public.speaker_profiles spf
      ON spf.id = es.speaker_profile_id AND spf.tenant_id = es.tenant_id
    LEFT JOIN public.profiles pr
      ON pr.id = spf.user_id AND pr.tenant_id = es.tenant_id
    LEFT JOIN public.event_people pe
      ON pe.id = spf.person_id AND pe.tenant_id = es.tenant_id
    WHERE es.tenant_id = v_tenant AND es.session_id = s.id
  ) sp ON true
  WHERE s.tenant_id = v_tenant AND s.id = _id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_session_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_session_detail(uuid) TO authenticated, service_role;
