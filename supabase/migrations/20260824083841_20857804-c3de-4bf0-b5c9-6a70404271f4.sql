DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION btree_gist;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.speaker_profiles'::regclass
      AND conname = 'speaker_profiles_tenant_id_key'
  ) THEN
    ALTER TABLE public.speaker_profiles
      ADD CONSTRAINT speaker_profiles_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT speaker_profiles_tenant_id_key ON public.speaker_profiles IS
  'Tozsamosc profilu prelegenta w granicach najemcy. Cel klucza obcego zlozonego (tenant_id, speaker_profile_id) z event_session_speakers.';

CREATE TABLE IF NOT EXISTS public.event_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  key text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  accent_color text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_tracks_key_format CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  CONSTRAINT event_tracks_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 80),
  CONSTRAINT event_tracks_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  CONSTRAINT event_tracks_accent_hex CHECK (accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT event_tracks_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_tracks_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_tracks_event_key_unique UNIQUE (tenant_id, event_id, key),
  CONSTRAINT event_tracks_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_tracks IS
  'Sciezki tematyczne agendy jednego wydarzenia. `key` jest stabilnym identyfikatorem filtra agendy; zapis wylacznie przez admin_event_track_save.';

COMMENT ON COLUMN public.event_tracks.is_active IS
  'Wylaczona sciezka znika z selektu w formularzu sesji, ale NIE znika z sesji juz do niej przypisanych - inaczej agenda gubilaby etykiety.';

CREATE INDEX IF NOT EXISTS event_tracks_event_order_idx
  ON public.event_tracks (tenant_id, event_id, sort_order, key);

DROP TRIGGER IF EXISTS event_tracks_touch_updated_at ON public.event_tracks;

CREATE TRIGGER event_tracks_touch_updated_at
  BEFORE UPDATE ON public.event_tracks
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_tracks TO anon;

GRANT SELECT ON public.event_tracks TO authenticated;

GRANT ALL ON public.event_tracks TO service_role;

ALTER TABLE public.event_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_tracks_public_read" ON public.event_tracks;

CREATE POLICY "event_tracks_public_read"
  ON public.event_tracks FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_tracks.event_id
        AND e.tenant_id = event_tracks.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_tracks_staff_read" ON public.event_tracks;

CREATE POLICY "event_tracks_staff_read"
  ON public.event_tracks FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  name text NOT NULL,
  capacity integer,
  floor text,
  location_note text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_rooms_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT event_rooms_floor_len CHECK (floor IS NULL OR char_length(btrim(floor)) BETWEEN 1 AND 60),
  CONSTRAINT event_rooms_location_note_len
    CHECK (location_note IS NULL OR char_length(location_note) <= 300),
  CONSTRAINT event_rooms_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT event_rooms_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_rooms_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_rooms_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_rooms IS
  'Sale i przestrzenie jednego wydarzenia. Nazwa jest jednojezyczna (nazwa wlasna miejsca). Zapis wylacznie przez admin_event_room_save.';

COMMENT ON COLUMN public.event_rooms.capacity IS
  'Pojemnosc pomieszczenia. Sluzy walidacji limitu miejsc sesji (event_sessions.capacity), nie egzekwowaniu zapisow.';

COMMENT ON COLUMN public.event_rooms.location_note IS
  'Wskazowka dojscia ("wejscie od strony parku", "winda B"). Jednojezyczna z tego samego powodu co nazwa.';

CREATE UNIQUE INDEX IF NOT EXISTS event_rooms_event_name_unique
  ON public.event_rooms (tenant_id, event_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS event_rooms_event_order_idx
  ON public.event_rooms (tenant_id, event_id, sort_order, name);

DROP TRIGGER IF EXISTS event_rooms_touch_updated_at ON public.event_rooms;

CREATE TRIGGER event_rooms_touch_updated_at
  BEFORE UPDATE ON public.event_rooms
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_rooms TO anon;

GRANT SELECT ON public.event_rooms TO authenticated;

GRANT ALL ON public.event_rooms TO service_role;

ALTER TABLE public.event_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_rooms_public_read" ON public.event_rooms;

CREATE POLICY "event_rooms_public_read"
  ON public.event_rooms FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_rooms.event_id
        AND e.tenant_id = event_rooms.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_rooms_staff_read" ON public.event_rooms;

CREATE POLICY "event_rooms_staff_read"
  ON public.event_rooms FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  parent_session_id uuid,
  track_id uuid,
  room_id uuid,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  format text NOT NULL DEFAULT 'onsite',
  status text NOT NULL DEFAULT 'draft',
  capacity integer,
  requires_signup boolean NOT NULL DEFAULT false,
  min_tier_rank integer NOT NULL DEFAULT 0,
  chatham_house boolean NOT NULL DEFAULT false,
  is_private boolean NOT NULL DEFAULT false,
  allow_overlap boolean NOT NULL DEFAULT true,
  stream_url text,
  recording_url text,
  sort_order integer NOT NULL DEFAULT 100,
  published_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_sessions_title_pl_len CHECK (char_length(btrim(title_pl)) BETWEEN 2 AND 200),
  CONSTRAINT event_sessions_title_en_len CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 200),
  CONSTRAINT event_sessions_desc_pl_len CHECK (char_length(description_pl) <= 4000),
  CONSTRAINT event_sessions_desc_en_len CHECK (char_length(description_en) <= 4000),
  CONSTRAINT event_sessions_time_order CHECK (ends_at > starts_at),
  CONSTRAINT event_sessions_duration_sane CHECK (ends_at <= starts_at + interval '48 hours'),
  CONSTRAINT event_sessions_format_values CHECK (format IN ('onsite', 'online', 'hybrid')),
  CONSTRAINT event_sessions_status_values CHECK (status IN ('draft', 'published', 'cancelled')),
  CONSTRAINT event_sessions_capacity_nonneg CHECK (capacity IS NULL OR capacity >= 0),
  CONSTRAINT event_sessions_capacity_needs_signup CHECK (capacity IS NULL OR requires_signup),
  CONSTRAINT event_sessions_tier_rank_nonneg CHECK (min_tier_rank >= 0),
  CONSTRAINT event_sessions_stream_url_https
    CHECK (stream_url IS NULL OR stream_url ~ '^https://'),
  CONSTRAINT event_sessions_recording_url_https
    CHECK (recording_url IS NULL OR recording_url ~ '^https://'),
  CONSTRAINT event_sessions_parent_not_self CHECK (parent_session_id IS DISTINCT FROM id),
  CONSTRAINT event_sessions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_sessions_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_sessions_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sessions_parent_fk FOREIGN KEY (tenant_id, event_id, parent_session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_sessions_track_fk FOREIGN KEY (tenant_id, event_id, track_id)
    REFERENCES public.event_tracks (tenant_id, event_id, id),
  CONSTRAINT event_sessions_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_sessions IS
  'Sesja agendy wydarzenia. Zrodlo agendy adresowalnej (zapisy, kolizje, prelegenci) obok agendy jsonb w tresci widgetu event-schedule. Zapis wylacznie przez admin_event_session_save.';

COMMENT ON COLUMN public.event_sessions.time_range IS
  'Przedzial polotwarty [starts_at, ends_at) - nosnik ograniczenia EXCLUDE na kolizje sali i operatora && w raporcie kolizji prelegenta.';

COMMENT ON COLUMN public.event_sessions.format IS
  'GDZIE sie dzieje sesja: onsite / online / hybrid. Te same wartosci co events.format, zeby jedna mapa etykiet obslugiwala oba poziomy.';

COMMENT ON COLUMN public.event_sessions.capacity IS
  'Limit miejsc egzekwowany pod blokada wiersza w event_session_signup. Wymaga requires_signup = true (CHECK) - limit bez zapisow nie ma kto egzekwowac.';

COMMENT ON COLUMN public.event_sessions.requires_signup IS
  'Sesja przyjmuje zapisy i wymaga ich do udzialu. false = wejscie wolne dla kazdego, kto ma dostep do wydarzenia (zapis odrzucany bledem signup_disabled).';

COMMENT ON COLUMN public.event_sessions.min_tier_rank IS
  'Prog rangi warstwy czlonkowskiej. 0 = bez progu. Sprawdzany przez has_tier_rank() na plaszczyznie tresci.';

COMMENT ON COLUMN public.event_sessions.chatham_house IS
  'Zasada Chatham House: wolno cytowac tresc, nie wolno przypisywac jej osobom. Front musi to napisac przy sesji, a nie tylko przy wydarzeniu.';

COMMENT ON COLUMN public.event_sessions.is_private IS
  'Sesja widoczna WYLACZNIE dla zapisanych (i dla staffa w panelu). Publiczna agenda jej nie zwraca osobie bez zapisu.';

COMMENT ON COLUMN public.event_sessions.allow_overlap IS
  'true = uczestnik moze byc zapisany na te sesje i na inna w tym samym czasie. false na OBU sesjach blokuje podwojny zapis (wzorzec "Allow overlap").';

COMMENT ON COLUMN public.event_sessions.stream_url IS
  'Adres transmisji. ODCIETY od klienckiego SELECT grantem kolumnowym - droga: event_session_access (uczestnik) albo admin_event_session_detail (panel).';

COMMENT ON COLUMN public.event_sessions.recording_url IS
  'Adres nagrania. Jak stream_url odciety grantem kolumnowym; dostep po randze warstwy, BEZ wymogu zapisu (doktryna get_event_access z 20260713093000).';

COMMENT ON COLUMN public.event_sessions.parent_session_id IS
  'Blok nadrzedny dla podsesji. Gniezdzenie jednopoziomowe - podsesja nie moze byc rodzicem (trigger tg_event_sessions_validate).';

CREATE INDEX IF NOT EXISTS event_sessions_event_time_idx
  ON public.event_sessions (tenant_id, event_id, starts_at, sort_order);

CREATE INDEX IF NOT EXISTS event_sessions_event_status_idx
  ON public.event_sessions (tenant_id, event_id, status);

CREATE INDEX IF NOT EXISTS event_sessions_track_idx
  ON public.event_sessions (tenant_id, track_id) WHERE track_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_sessions_room_idx
  ON public.event_sessions (tenant_id, room_id) WHERE room_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_sessions_parent_idx
  ON public.event_sessions (tenant_id, parent_session_id) WHERE parent_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_sessions_time_range_idx
  ON public.event_sessions USING gist (time_range);

DO $$
DECLARE
  v_opclass text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_sessions'::regclass
      AND conname = 'event_sessions_room_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_opclass
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_opclass IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - kolizje sal nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_sessions ADD CONSTRAINT event_sessions_room_no_overlap '
    'EXCLUDE USING gist (tenant_id %1$s WITH =, room_id %1$s WITH =, time_range WITH &&) '
    'WHERE (room_id IS NOT NULL AND status <> ''cancelled'')',
    v_opclass
  );
END
$$;

COMMENT ON CONSTRAINT event_sessions_room_no_overlap ON public.event_sessions IS
  'Jedna sala nie moze miec dwoch nieodwolanych sesji w tym samym czasie. Obejmuje TAKZE sesje robocze - kolizja ma bolec przy wpisywaniu agendy, nie przy publikacji.';

DROP TRIGGER IF EXISTS event_sessions_touch_updated_at ON public.event_sessions;

CREATE TRIGGER event_sessions_touch_updated_at
  BEFORE UPDATE ON public.event_sessions
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

REVOKE ALL ON public.event_sessions FROM anon, authenticated;

GRANT SELECT (
  id, tenant_id, event_id, parent_session_id, track_id, room_id,
  title_pl, title_en, description_pl, description_en,
  starts_at, ends_at, time_range, format, status, capacity, requires_signup,
  min_tier_rank, chatham_house, is_private, allow_overlap, sort_order,
  published_at, cancelled_at, created_by, created_at, updated_at
) ON public.event_sessions TO anon, authenticated;

GRANT ALL ON public.event_sessions TO service_role;

ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sessions_public_read" ON public.event_sessions;

CREATE POLICY "event_sessions_public_read"
  ON public.event_sessions FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND status IN ('published', 'cancelled')
    AND is_private = false
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_sessions.event_id
        AND e.tenant_id = event_sessions.tenant_id
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_sessions_staff_read" ON public.event_sessions;

CREATE POLICY "event_sessions_staff_read"
  ON public.event_sessions FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_session_speakers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  speaker_profile_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'speaker',
  sort_order integer NOT NULL DEFAULT 100,
  allow_overlap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_session_speakers_role_values
    CHECK (role IN ('speaker', 'moderator', 'panelist', 'host')),
  CONSTRAINT event_session_speakers_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_session_speakers_unique UNIQUE (tenant_id, session_id, speaker_profile_id),
  CONSTRAINT event_session_speakers_session_fk
    FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_speakers_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_speakers_profile_fk FOREIGN KEY (tenant_id, speaker_profile_id)
    REFERENCES public.speaker_profiles (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_session_speakers IS
  'Obsada sesji: powiazanie sesji z profilem prelegenta (speaker_profiles) plus rola sceniczna i kolejnosc wystapienia. Zapis wsadowo przez admin_event_session_speakers_set.';

COMMENT ON COLUMN public.event_session_speakers.role IS
  'Rola w TEJ sesji: speaker / moderator / panelist / host. Ta sama osoba moze miec inna role w innej sesji.';

COMMENT ON COLUMN public.event_session_speakers.allow_overlap IS
  'true = swiadome dopuszczenie tej osoby w dwoch rownoleglych sesjach. Rola host ma to z definicji (patrz admin_event_session_speakers_set).';

CREATE INDEX IF NOT EXISTS event_session_speakers_session_idx
  ON public.event_session_speakers (tenant_id, session_id, sort_order);

CREATE INDEX IF NOT EXISTS event_session_speakers_profile_idx
  ON public.event_session_speakers (tenant_id, speaker_profile_id);

CREATE INDEX IF NOT EXISTS event_session_speakers_event_idx
  ON public.event_session_speakers (tenant_id, event_id);

DROP TRIGGER IF EXISTS event_session_speakers_touch_updated_at ON public.event_session_speakers;

CREATE TRIGGER event_session_speakers_touch_updated_at
  BEFORE UPDATE ON public.event_session_speakers
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_session_speakers TO anon;

GRANT SELECT ON public.event_session_speakers TO authenticated;

GRANT ALL ON public.event_session_speakers TO service_role;

ALTER TABLE public.event_session_speakers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_session_speakers_public_read" ON public.event_session_speakers;

CREATE POLICY "event_session_speakers_public_read"
  ON public.event_session_speakers FOR SELECT
  TO anon, authenticated
  USING (
    tenant_id = (SELECT public.public_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_sessions s
      JOIN public.events e
        ON e.id = s.event_id AND e.tenant_id = s.tenant_id
      WHERE s.id = event_session_speakers.session_id
        AND s.tenant_id = event_session_speakers.tenant_id
        AND s.status IN ('published', 'cancelled')
        AND s.is_private = false
        AND e.status = 'published'
    )
  );

DROP POLICY IF EXISTS "event_session_speakers_staff_read" ON public.event_session_speakers;

CREATE POLICY "event_session_speakers_staff_read"
  ON public.event_session_speakers FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_session_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'registered',
  registered_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_session_signups_status_values
    CHECK (status IN ('registered', 'waitlist', 'cancelled')),
  CONSTRAINT event_session_signups_cancelled_stamp
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT event_session_signups_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_session_signups_unique UNIQUE (tenant_id, session_id, user_id),
  CONSTRAINT event_session_signups_session_fk
    FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_session_signups_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_session_signups IS
  'Zapis uzytkownika na konkretna sesje. Podmiotem jest auth.users; rozszerzenie na uczestnika bez konta nalezy do modulu uczestnikow (patrz naglowek migracji). Zapis wylacznie przez event_session_signup.';

COMMENT ON COLUMN public.event_session_signups.status IS
  'registered (ma miejsce) / waitlist (lista rezerwowa, awansuje przy zwolnieniu miejsca) / cancelled (rezygnacja - wiersz zostaje jako fakt).';

COMMENT ON COLUMN public.event_session_signups.created_by IS
  'Kto utworzyl wiersz: uczestnik sam (rowne user_id) albo organizator zapisujacy za niego.';

CREATE INDEX IF NOT EXISTS event_session_signups_session_idx
  ON public.event_session_signups (tenant_id, session_id, status);

CREATE INDEX IF NOT EXISTS event_session_signups_waitlist_idx
  ON public.event_session_signups (tenant_id, session_id, registered_at)
  WHERE status = 'waitlist';

CREATE INDEX IF NOT EXISTS event_session_signups_user_idx
  ON public.event_session_signups (user_id, registered_at DESC);

CREATE INDEX IF NOT EXISTS event_session_signups_event_user_idx
  ON public.event_session_signups (tenant_id, event_id, user_id);

DROP TRIGGER IF EXISTS event_session_signups_touch_updated_at ON public.event_session_signups;

CREATE TRIGGER event_session_signups_touch_updated_at
  BEFORE UPDATE ON public.event_session_signups
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_session_signups TO authenticated;

GRANT ALL ON public.event_session_signups TO service_role;

ALTER TABLE public.event_session_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_session_signups_owner_read" ON public.event_session_signups;

CREATE POLICY "event_session_signups_owner_read"
  ON public.event_session_signups FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "event_session_signups_staff_read" ON public.event_session_signups;

CREATE POLICY "event_session_signups_staff_read"
  ON public.event_session_signups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE OR REPLACE FUNCTION public.tg_event_sessions_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_starts timestamptz;
  v_event_ends timestamptz;
  v_room_capacity integer;
  v_parent_parent uuid;
BEGIN
  SELECT e.starts_at, e.ends_at
    INTO v_event_starts, v_event_ends
  FROM public.events e
  WHERE e.id = NEW.event_id AND e.tenant_id = NEW.tenant_id;

  IF v_event_starts IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  IF NEW.starts_at < v_event_starts THEN
    RAISE EXCEPTION 'session_before_event: session starts before the event (%)', v_event_starts;
  END IF;

  IF v_event_ends IS NOT NULL AND NEW.ends_at > v_event_ends THEN
    RAISE EXCEPTION 'session_after_event: session ends after the event (%)', v_event_ends;
  END IF;

  IF NEW.room_id IS NOT NULL AND NEW.capacity IS NOT NULL THEN
    SELECT r.capacity INTO v_room_capacity
    FROM public.event_rooms r
    WHERE r.id = NEW.room_id AND r.tenant_id = NEW.tenant_id;

    IF v_room_capacity IS NOT NULL AND NEW.capacity > v_room_capacity THEN
      RAISE EXCEPTION 'capacity_over_room: seat limit % exceeds room capacity %',
        NEW.capacity, v_room_capacity;
    END IF;
  END IF;

  IF NEW.parent_session_id IS NOT NULL THEN
    SELECT s.parent_session_id INTO v_parent_parent
    FROM public.event_sessions s
    WHERE s.id = NEW.parent_session_id AND s.tenant_id = NEW.tenant_id;

    IF v_parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'parent_depth: a sub-session cannot be a parent session';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_event_sessions_validate() IS
  'Walidacja sesji dotykajaca innych wierszy: okno czasowe wydarzenia, limit miejsc wobec pojemnosci sali, jednopoziomowe gniezdzenie.';

DROP TRIGGER IF EXISTS event_sessions_validate ON public.event_sessions;

CREATE TRIGGER event_sessions_validate
  BEFORE INSERT OR UPDATE OF event_id, starts_at, ends_at, capacity, room_id, parent_session_id
  ON public.event_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_sessions_validate();

CREATE OR REPLACE FUNCTION public.admin_event_tracks_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  key text,
  name_pl text,
  name_en text,
  accent_color text,
  sort_order integer,
  is_active boolean,
  sessions_count integer,
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
    t.id, t.event_id, t.key, t.name_pl, t.name_en, t.accent_color,
    t.sort_order, t.is_active,
    COALESCE(u.cnt, 0)::integer,
    t.created_at, t.updated_at
  FROM public.event_tracks t
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.track_id = t.id
  ) u ON true
  WHERE t.tenant_id = v_tenant
    AND t.event_id = p_event_id
  ORDER BY t.sort_order, t.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_tracks_list(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_tracks_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_tracks_list(uuid) IS
  'Sciezki tematyczne wydarzenia dla panelu, z licznikiem sesji. Bramka: assert_editor_tenant().';