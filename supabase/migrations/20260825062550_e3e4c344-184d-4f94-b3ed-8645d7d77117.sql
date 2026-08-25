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

CREATE TABLE IF NOT EXISTS public.event_meeting_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  label text NOT NULL,
  zone text,
  capacity integer NOT NULL DEFAULT 1,
  room_id uuid,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_tables_label_len
    CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT event_meeting_tables_zone_len
    CHECK (zone IS NULL OR char_length(btrim(zone)) BETWEEN 1 AND 120),
  CONSTRAINT event_meeting_tables_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT event_meeting_tables_capacity_range CHECK (capacity BETWEEN 1 AND 50),
  CONSTRAINT event_meeting_tables_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_tables_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_meeting_tables_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_tables_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_meeting_tables IS
  'Stoliki i miejsca spotkan jednego wydarzenia. Etykieta jest jednojezyczna (nazwa wlasna miejsca). Zapis wylacznie przez admin_event_meeting_table_save.';
COMMENT ON COLUMN public.event_meeting_tables.capacity IS
  'Ile spotkan idzie przy tym miejscu ROWNOLEGLE (nie: ile krzesel). Wyznacza zakres numeru miejsca event_meetings.table_seat: 1..capacity.';
COMMENT ON COLUMN public.event_meeting_tables.zone IS
  'Strefa albo lokalizacja ("Hala 2, poziom 3"). Jednojezyczna z tego samego powodu co etykieta: to nazwa wlasna miejsca, nie tekst redakcyjny.';
COMMENT ON COLUMN public.event_meeting_tables.room_id IS
  'Opcjonalne dowiazanie do sali agendy (event_rooms). Klucz potrojny (tenant_id, event_id, room_id) - sala musi nalezec do TEGO wydarzenia.';
COMMENT ON COLUMN public.event_meeting_tables.is_active IS
  'Wylaczony stolik znika z przydzialu nowych spotkan, ale NIE zabiera stolika spotkaniom juz potwierdzonym. Dlatego wylaczenie jest osobna operacja od usuniecia.';

CREATE UNIQUE INDEX IF NOT EXISTS event_meeting_tables_event_label_uniq
  ON public.event_meeting_tables (tenant_id, event_id, lower(btrim(label)));

CREATE INDEX IF NOT EXISTS event_meeting_tables_event_order_idx
  ON public.event_meeting_tables (tenant_id, event_id, sort_order, label);
CREATE INDEX IF NOT EXISTS event_meeting_tables_room_idx
  ON public.event_meeting_tables (tenant_id, event_id, room_id)
  WHERE room_id IS NOT NULL;

DROP TRIGGER IF EXISTS event_meeting_tables_touch_updated_at ON public.event_meeting_tables;
CREATE TRIGGER event_meeting_tables_touch_updated_at
  BEFORE UPDATE ON public.event_meeting_tables
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_meeting_tables TO authenticated;
GRANT ALL ON public.event_meeting_tables TO service_role;

ALTER TABLE public.event_meeting_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_tables_staff_read" ON public.event_meeting_tables;
CREATE POLICY "event_meeting_tables_staff_read"
  ON public.event_meeting_tables FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_meeting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  slot_minutes integer NOT NULL DEFAULT 20,
  break_minutes integer NOT NULL DEFAULT 5,
  day_start_time time NOT NULL DEFAULT '09:00',
  day_end_time time NOT NULL DEFAULT '17:00',
  meeting_days date[] NOT NULL DEFAULT '{}'::date[],
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  invites_open_at timestamptz,
  invites_close_at timestamptz,
  max_invites_per_person integer,
  max_meetings_per_day integer,
  invite_expires_after_hours integer NOT NULL DEFAULT 72,
  visibility text NOT NULL DEFAULT 'everyone',
  intro_pl text NOT NULL DEFAULT '',
  intro_en text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_settings_slot_range CHECK (slot_minutes BETWEEN 5 AND 240),
  CONSTRAINT event_meeting_settings_break_range CHECK (break_minutes BETWEEN 0 AND 120),
  CONSTRAINT event_meeting_settings_day_order CHECK (day_end_time > day_start_time),
  CONSTRAINT event_meeting_settings_day_fits_slot
    CHECK ((day_end_time - day_start_time) >= make_interval(mins => slot_minutes)),
  CONSTRAINT event_meeting_settings_days_bounded CHECK (cardinality(meeting_days) <= 30),
  CONSTRAINT event_meeting_settings_days_not_null
    CHECK (array_position(meeting_days, NULL::date) IS NULL),
  CONSTRAINT event_meeting_settings_timezone_len
    CHECK (char_length(btrim(timezone)) BETWEEN 2 AND 64),
  CONSTRAINT event_meeting_settings_invites_window
    CHECK (invites_open_at IS NULL OR invites_close_at IS NULL OR invites_close_at > invites_open_at),
  CONSTRAINT event_meeting_settings_max_invites_positive
    CHECK (max_invites_per_person IS NULL OR max_invites_per_person > 0),
  CONSTRAINT event_meeting_settings_max_daily_positive
    CHECK (max_meetings_per_day IS NULL OR max_meetings_per_day > 0),
  CONSTRAINT event_meeting_settings_expiry_range
    CHECK (invite_expires_after_hours BETWEEN 1 AND 720),
  CONSTRAINT event_meeting_settings_visibility_values CHECK (visibility IN (
    'everyone', 'groups', 'sponsors_to_attendees', 'disabled'
  )),
  CONSTRAINT event_meeting_settings_intro_pl_len CHECK (char_length(intro_pl) <= 1000),
  CONSTRAINT event_meeting_settings_intro_en_len CHECK (char_length(intro_en) <= 1000),
  CONSTRAINT event_meeting_settings_enabled_needs_days
    CHECK (NOT is_enabled OR cardinality(meeting_days) > 0),
  CONSTRAINT event_meeting_settings_event_unique UNIQUE (tenant_id, event_id),
  CONSTRAINT event_meeting_settings_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_settings_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_settings IS
  'Konfiguracja gieldy spotkan JEDNEGO wydarzenia: siatka slotow, okno otwarcia na zaproszenia, limity i regula widocznosci. Brak wiersza = gielda nieskonfigurowana. Zapis wylacznie przez admin_event_meeting_settings_save.';
COMMENT ON COLUMN public.event_meeting_settings.is_enabled IS
  'Gielda dziala. Rozne od visibility = disabled: tam gielda jest skonfigurowana i zamknieta regula, tu jest wylaczona jako funkcja wydarzenia.';
COMMENT ON COLUMN public.event_meeting_settings.break_minutes IS
  'Przerwa MIEDZY slotami, osobno od dlugosci slotu. Krok siatki to slot_minutes + break_minutes; uczestnik widzi na karcie dlugosc slotu, nie krok.';
COMMENT ON COLUMN public.event_meeting_settings.meeting_days IS
  'Konkretne dni gieldy, nie zakres: kongres trzydniowy z jednym dniem bez gieldy jest normalny, a zakres tego nie wyrazi.';
COMMENT ON COLUMN public.event_meeting_settings.timezone IS
  'Strefa, w ktorej liczy sie day_start_time i day_end_time. Osobna od events.timezone, bo gielda moze dzialac w strefie MIEJSCA, a wydarzenie sprzedawac bilety w strefie rejestracji.';
COMMENT ON COLUMN public.event_meeting_settings.invites_open_at IS
  'Od kiedy gielda przyjmuje zaproszenia. NULL = od razu. Rozne od meeting_days, ktore mowia, KIEDY spotkania sie odbywaja.';
COMMENT ON COLUMN public.event_meeting_settings.max_invites_per_person IS
  'Ile AKTYWNYCH zaproszen (wyslane nierozstrzygniete + przyjete) moze miec jeden uczestnik. NULL = bez limitu. Egzekwowane w event_meeting_invite.';
COMMENT ON COLUMN public.event_meeting_settings.max_meetings_per_day IS
  'Ile ZAJETYCH spotkan moze miec uczestnik w jednym dniu gieldy. NULL = bez limitu. Egzekwowane w event_meeting_invite i przy akceptacji.';
COMMENT ON COLUMN public.event_meeting_settings.invite_expires_after_hours IS
  'Ile godzin zyje zaproszenie. Wartosc jest KOPIOWANA do event_meetings.expires_at przy tworzeniu - zmiana reguly nie uniewaznia zaproszen juz wyslanych.';
COMMENT ON COLUMN public.event_meeting_settings.visibility IS
  'Kto moze zaprosic kogo: everyone / groups (event_meeting_rule_groups) / sponsors_to_attendees (grupa z can_lead_retrieval) / disabled.';

CREATE INDEX IF NOT EXISTS event_meeting_settings_enabled_idx
  ON public.event_meeting_settings (tenant_id, is_enabled)
  WHERE is_enabled;

DROP TRIGGER IF EXISTS event_meeting_settings_touch_updated_at ON public.event_meeting_settings;
CREATE TRIGGER event_meeting_settings_touch_updated_at
  BEFORE UPDATE ON public.event_meeting_settings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_meeting_settings TO authenticated;
GRANT ALL ON public.event_meeting_settings TO service_role;

ALTER TABLE public.event_meeting_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_settings_staff_read" ON public.event_meeting_settings;
CREATE POLICY "event_meeting_settings_staff_read"
  ON public.event_meeting_settings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_meeting_rule_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  group_id uuid NOT NULL,
  side text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_rule_groups_side_values CHECK (side IN ('requester', 'invitee')),
  CONSTRAINT event_meeting_rule_groups_unique UNIQUE (tenant_id, event_id, group_id, side),
  CONSTRAINT event_meeting_rule_groups_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_rule_groups_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_rule_groups_group_fk
    FOREIGN KEY (tenant_id, event_id, group_id)
    REFERENCES public.event_groups (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_rule_groups IS
  'Grupy uczestnikow po stronie zapraszajacej i zaproszonej dla reguly widocznosci `groups`. Klucz potrojny do event_groups - grupa musi nalezec do TEGO wydarzenia. Zapis wsadowo przez admin_event_meeting_settings_save.';
COMMENT ON COLUMN public.event_meeting_rule_groups.side IS
  'requester = grupa, ktora WOLNO zapraszac; invitee = grupa, ktora WOLNO zaprosic. Ta sama grupa moze wystapic po obu stronach.';

CREATE INDEX IF NOT EXISTS event_meeting_rule_groups_event_side_idx
  ON public.event_meeting_rule_groups (tenant_id, event_id, side, group_id);

GRANT SELECT ON public.event_meeting_rule_groups TO authenticated;
GRANT ALL ON public.event_meeting_rule_groups TO service_role;

ALTER TABLE public.event_meeting_rule_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_rule_groups_staff_read" ON public.event_meeting_rule_groups;
CREATE POLICY "event_meeting_rule_groups_staff_read"
  ON public.event_meeting_rule_groups FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

CREATE TABLE IF NOT EXISTS public.event_meeting_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  is_open boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_availability_time_order CHECK (ends_at > starts_at),
  CONSTRAINT event_meeting_availability_duration_range
    CHECK (ends_at - starts_at BETWEEN interval '15 minutes' AND interval '16 hours'),
  CONSTRAINT event_meeting_availability_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),
  CONSTRAINT event_meeting_availability_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_availability_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_availability_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_availability IS
  'Okna dostepnosci uczestnika na gieldzie spotkan. Podmiotem jest ZAPIS na wydarzenie, nie osoba - uzasadnienie w komentarzu nad tabela. Przedzialy jednego uczestnika sa rozlaczne z mocy ograniczenia EXCLUDE.';
COMMENT ON COLUMN public.event_meeting_availability.time_range IS
  'Przedzial polotwarty [starts_at, ends_at) - nosnik ograniczenia EXCLUDE i operatora zawierania @> przy sprawdzaniu, czy slot miesci sie w oknie.';
COMMENT ON COLUMN public.event_meeting_availability.is_open IS
  'Czy okno przyjmuje zaproszenia. Okno zamkniete nadal blokuje nakladanie sie okien: dwa sprzeczne oswiadczenia o tym samym czasie sa bledem niezaleznie od tej flagi.';

CREATE INDEX IF NOT EXISTS event_meeting_availability_registration_idx
  ON public.event_meeting_availability (tenant_id, registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meeting_availability_event_idx
  ON public.event_meeting_availability (tenant_id, event_id, starts_at);

DROP TRIGGER IF EXISTS event_meeting_availability_touch_updated_at
  ON public.event_meeting_availability;
CREATE TRIGGER event_meeting_availability_touch_updated_at
  BEFORE UPDATE ON public.event_meeting_availability
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_meeting_availability TO authenticated;
GRANT ALL ON public.event_meeting_availability TO service_role;

ALTER TABLE public.event_meeting_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_availability_staff_read"
  ON public.event_meeting_availability;
CREATE POLICY "event_meeting_availability_staff_read"
  ON public.event_meeting_availability FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_meeting_availability_self_read"
  ON public.event_meeting_availability;
CREATE POLICY "event_meeting_availability_self_read"
  ON public.event_meeting_availability FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      WHERE r.id = event_meeting_availability.registration_id
        AND r.tenant_id = event_meeting_availability.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DO $$
DECLARE
  v_uuid_ops text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_meeting_availability'::regclass
      AND conname = 'event_meeting_availability_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_uuid_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_uuid_ops IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - rozlacznosci okien nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_meeting_availability '
    'ADD CONSTRAINT event_meeting_availability_no_overlap '
    'EXCLUDE USING gist (tenant_id %1$s WITH =, registration_id %1$s WITH =, time_range WITH &&)',
    v_uuid_ops
  );
END
$$;

COMMENT ON CONSTRAINT event_meeting_availability_no_overlap
  ON public.event_meeting_availability IS
  'Okna dostepnosci jednego uczestnika sa rozlaczne. Bezwarunkowo - takze okno zamkniete nie moze nachodzic na otwarte, bo to dwa sprzeczne oswiadczenia o tym samym czasie.';

CREATE TABLE IF NOT EXISTS public.event_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  requester_registration_id uuid NOT NULL,
  invitee_registration_id uuid NOT NULL,
  pair_low uuid GENERATED ALWAYS AS
    (LEAST(requester_registration_id, invitee_registration_id)) STORED,
  pair_high uuid GENERATED ALWAYS AS
    (GREATEST(requester_registration_id, invitee_registration_id)) STORED,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  table_id uuid,
  table_seat integer,
  status text NOT NULL DEFAULT 'invited',
  topic text,
  sponsor_id uuid,
  invitation_message text,
  decline_reason text,
  expires_at timestamptz NOT NULL,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responded_at timestamptz,
  responded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_side text,
  cancel_reason text,
  attendance_marked_at timestamptz,
  attendance_marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rescheduled_from_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meetings_no_self
    CHECK (requester_registration_id <> invitee_registration_id),
  CONSTRAINT event_meetings_time_order CHECK (ends_at > starts_at),
  CONSTRAINT event_meetings_duration_range
    CHECK (ends_at - starts_at BETWEEN interval '5 minutes' AND interval '4 hours'),
  CONSTRAINT event_meetings_status_values CHECK (status IN (
    'invited', 'accepted', 'declined', 'cancelled', 'rescheduled', 'held', 'no_show'
  )),
  CONSTRAINT event_meetings_seat_paired CHECK ((table_id IS NULL) = (table_seat IS NULL)),
  CONSTRAINT event_meetings_seat_positive CHECK (table_seat IS NULL OR table_seat >= 1),
  CONSTRAINT event_meetings_topic_len
    CHECK (topic IS NULL OR char_length(btrim(topic)) BETWEEN 2 AND 200),
  CONSTRAINT event_meetings_message_len
    CHECK (invitation_message IS NULL OR char_length(invitation_message) <= 1000),
  CONSTRAINT event_meetings_decline_reason_len
    CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 1000),
  CONSTRAINT event_meetings_cancel_reason_len
    CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 1000),
  CONSTRAINT event_meetings_declined_has_reason CHECK (
    status <> 'declined'
    OR char_length(btrim(COALESCE(decline_reason, ''))) >= 3
  ),
  CONSTRAINT event_meetings_responded_dated CHECK (
    status NOT IN ('accepted', 'declined', 'rescheduled') OR responded_at IS NOT NULL
  ),
  CONSTRAINT event_meetings_responder_dated
    CHECK (responded_by IS NULL OR responded_at IS NOT NULL),
  CONSTRAINT event_meetings_cancelled_dated
    CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT event_meetings_cancelled_sided
    CHECK (cancelled_at IS NULL OR cancelled_side IS NOT NULL),
  CONSTRAINT event_meetings_cancelled_side_values CHECK (
    cancelled_side IS NULL OR cancelled_side IN ('requester', 'invitee', 'organiser')
  ),
  CONSTRAINT event_meetings_attendance_dated CHECK (
    status NOT IN ('held', 'no_show') OR attendance_marked_at IS NOT NULL
  ),
  CONSTRAINT event_meetings_expiry_before_start CHECK (expires_at <= starts_at),
  CONSTRAINT event_meetings_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meetings_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_meetings_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meetings_requester_fk
    FOREIGN KEY (tenant_id, event_id, requester_registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meetings_invitee_fk
    FOREIGN KEY (tenant_id, event_id, invitee_registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meetings_table_fk
    FOREIGN KEY (tenant_id, event_id, table_id)
    REFERENCES public.event_meeting_tables (tenant_id, event_id, id),
  CONSTRAINT event_meetings_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_meetings_rescheduled_from_fk
    FOREIGN KEY (tenant_id, event_id, rescheduled_from_id)
    REFERENCES public.event_meetings (tenant_id, event_id, id)
);

COMMENT ON TABLE public.event_meetings IS
  'Spotkanie biznesowe 1-1 na gieldzie wydarzenia: dwie strony (zapisy na TO wydarzenie), przedzial czasu, stolik z numerem miejsca, siedem stanow, powod odmowy i slad decyzji. Zapis wylacznie przez RPC modulu.';
COMMENT ON COLUMN public.event_meetings.pair_low IS
  'Mniejszy identyfikator pary (GENERATED). Razem z pair_high nosnik indeksu event_meetings_pair_slot_uniq: (A zaprasza B) i (B zaprasza A) to ta sama para.';
COMMENT ON COLUMN public.event_meetings.time_range IS
  'Przedzial polotwarty [starts_at, ends_at) - nosnik ograniczenia EXCLUDE na kolizje miejsca przy stoliku i operatora && w raportach obciazenia.';
COMMENT ON COLUMN public.event_meetings.table_seat IS
  'Numer miejsca przy stoliku, 1..event_meeting_tables.capacity. Przydzielany PRZY AKCEPTACJI. Istnieje, bo EXCLUDE umie powiedziec "najwyzej jedno na klucz", a nie "najwyzej N".';
COMMENT ON COLUMN public.event_meetings.status IS
  'invited (zaproszenie wyslane) / accepted / declined / cancelled / rescheduled (przelozone na nowy wiersz) / held (odbylo sie) / no_show (nieobecnosc). Stan "wygasle" jest LICZONY: status = invited AND expires_at < now().';
COMMENT ON COLUMN public.event_meetings.expires_at IS
  'Termin waznosci zaproszenia, ZAPISANY przy tworzeniu z invite_expires_after_hours. Zmiana reguly nie uniewaznia zaproszen juz wyslanych. Nigdy po starcie spotkania (CHECK expiry_before_start).';
COMMENT ON COLUMN public.event_meetings.rescheduled_from_id IS
  'Spotkanie, ktorego to spotkanie jest przelozeniem. Przelozenie zamyka stary wiersz i tworzy nowy, bo zmiana godziny bez zgody drugiej strony nie jest przelozeniem.';
COMMENT ON COLUMN public.event_meetings.sponsor_id IS
  'Opcjonalne dowiazanie do przypiecia sponsora - "spotkanie dotyczy oferty tego partnera". Klucz potrojny: sponsor musi byc sponsorem TEGO wydarzenia.';
COMMENT ON COLUMN public.event_meetings.cancelled_side IS
  'Kto odwolal: requester / invitee / organiser. Bez tego nie da sie odroznic rezygnacji uczestnika od decyzji organizatora, a to dwie rozne rozmowy z klientem.';

CREATE INDEX IF NOT EXISTS event_meetings_event_status_idx
  ON public.event_meetings (tenant_id, event_id, status, starts_at);
CREATE INDEX IF NOT EXISTS event_meetings_requester_idx
  ON public.event_meetings (tenant_id, requester_registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meetings_invitee_idx
  ON public.event_meetings (tenant_id, invitee_registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meetings_table_idx
  ON public.event_meetings (tenant_id, table_id, starts_at)
  WHERE table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_meetings_sponsor_idx
  ON public.event_meetings (tenant_id, event_id, sponsor_id)
  WHERE sponsor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_meetings_time_range_idx
  ON public.event_meetings USING gist (time_range);
CREATE INDEX IF NOT EXISTS event_meetings_expiring_idx
  ON public.event_meetings (tenant_id, event_id, expires_at)
  WHERE status = 'invited';

CREATE UNIQUE INDEX IF NOT EXISTS event_meetings_pair_slot_uniq
  ON public.event_meetings (tenant_id, event_id, pair_low, pair_high, starts_at)
  WHERE status IN ('invited', 'accepted');

DROP TRIGGER IF EXISTS event_meetings_touch_updated_at ON public.event_meetings;
CREATE TRIGGER event_meetings_touch_updated_at
  BEFORE UPDATE ON public.event_meetings
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

GRANT SELECT ON public.event_meetings TO authenticated;
GRANT ALL ON public.event_meetings TO service_role;

ALTER TABLE public.event_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meetings_staff_read" ON public.event_meetings;
CREATE POLICY "event_meetings_staff_read"
  ON public.event_meetings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_meetings_party_read" ON public.event_meetings;
CREATE POLICY "event_meetings_party_read"
  ON public.event_meetings FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = event_meetings.tenant_id
        AND r.id IN (
          event_meetings.requester_registration_id,
          event_meetings.invitee_registration_id
        )
        AND p.user_id = (SELECT auth.uid())
    )
  );

DO $$
DECLARE
  v_uuid_ops text;
  v_int4_ops text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_meetings'::regclass
      AND conname = 'event_meetings_table_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_uuid_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  SELECT quote_ident(n.nspname) || '.gist_int4_ops'
    INTO v_int4_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_int4_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_uuid_ops IS NULL OR v_int4_ops IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasy gist_uuid_ops/gist_int4_ops nie istnieja - wylacznosci stolika nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_meetings ADD CONSTRAINT event_meetings_table_no_overlap '
    'EXCLUDE USING gist ('
    'tenant_id %1$s WITH =, table_id %1$s WITH =, table_seat %2$s WITH =, time_range WITH &&'
    ') WHERE (table_id IS NOT NULL AND status IN (''accepted'', ''held'', ''no_show''))',
    v_uuid_ops, v_int4_ops
  );
END
$$;

COMMENT ON CONSTRAINT event_meetings_table_no_overlap ON public.event_meetings IS
  'Jedno miejsce przy stoliku nie obsluguje dwoch zajetych spotkan w tym samym czasie. Obejmuje held i no_show, bo termin BYL zajety - inaczej oznaczenie nieobecnosci otwieralo by luke w przeszlosci.';

CREATE TABLE IF NOT EXISTS public.event_meeting_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  side text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_meeting_attendees_side_values CHECK (side IN ('requester', 'invitee')),
  CONSTRAINT event_meeting_attendees_time_order CHECK (ends_at > starts_at),
  CONSTRAINT event_meeting_attendees_status_values CHECK (status IN (
    'invited', 'accepted', 'declined', 'cancelled', 'rescheduled', 'held', 'no_show'
  )),
  CONSTRAINT event_meeting_attendees_meeting_side_unique
    UNIQUE (tenant_id, meeting_id, side),
  CONSTRAINT event_meeting_attendees_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_meeting_attendees_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_attendees_meeting_fk
    FOREIGN KEY (tenant_id, event_id, meeting_id)
    REFERENCES public.event_meetings (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_meeting_attendees_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.event_meeting_attendees IS
  'Projekcja spotkania na uczestnikow: JEDEN uczestnik na wiersz. Nosnik ograniczenia EXCLUDE "jeden czlowiek nie ma dwoch zajetych spotkan w tym samym czasie", ktorego na event_meetings nie da sie wyrazic. Utrzymywana triggerem, bez wlasnej sciezki zapisu.';
COMMENT ON COLUMN public.event_meeting_attendees.status IS
  'Kopia stanu spotkania. Zdublowana z koniecznosci: warunek czesciowy ograniczenia EXCLUDE musi czytac kolumne TEJ tabeli.';
COMMENT ON COLUMN public.event_meeting_attendees.time_range IS
  'Kopia przedzialu spotkania jako zakres polotwarty. Klucz ograniczenia EXCLUDE i indeks pytania "co ten czlowiek ma w tym czasie".';

CREATE INDEX IF NOT EXISTS event_meeting_attendees_registration_idx
  ON public.event_meeting_attendees (tenant_id, registration_id, starts_at);
CREATE INDEX IF NOT EXISTS event_meeting_attendees_event_status_idx
  ON public.event_meeting_attendees (tenant_id, event_id, status, starts_at);
CREATE INDEX IF NOT EXISTS event_meeting_attendees_meeting_idx
  ON public.event_meeting_attendees (tenant_id, meeting_id);

GRANT SELECT ON public.event_meeting_attendees TO authenticated;
GRANT ALL ON public.event_meeting_attendees TO service_role;

ALTER TABLE public.event_meeting_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_meeting_attendees_staff_read" ON public.event_meeting_attendees;
CREATE POLICY "event_meeting_attendees_staff_read"
  ON public.event_meeting_attendees FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "event_meeting_attendees_self_read" ON public.event_meeting_attendees;
CREATE POLICY "event_meeting_attendees_self_read"
  ON public.event_meeting_attendees FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND EXISTS (
      SELECT 1
      FROM public.event_registrations r
      JOIN public.event_people p
        ON p.id = r.person_id AND p.tenant_id = r.tenant_id
      WHERE r.id = event_meeting_attendees.registration_id
        AND r.tenant_id = event_meeting_attendees.tenant_id
        AND p.user_id = (SELECT auth.uid())
    )
  );

DO $$
DECLARE
  v_uuid_ops text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_meeting_attendees'::regclass
      AND conname = 'event_meeting_attendees_no_overlap'
  ) THEN
    RETURN;
  END IF;

  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_uuid_ops
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_uuid_ops IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - wylacznosci terminu uczestnika nie da sie wymusic';
  END IF;

  EXECUTE format(
    'ALTER TABLE public.event_meeting_attendees '
    'ADD CONSTRAINT event_meeting_attendees_no_overlap '
    'EXCLUDE USING gist (tenant_id %1$s WITH =, registration_id %1$s WITH =, time_range WITH &&) '
    'WHERE (status IN (''accepted'', ''held'', ''no_show''))',
    v_uuid_ops
  );
END
$$;

COMMENT ON CONSTRAINT event_meeting_attendees_no_overlap ON public.event_meeting_attendees IS
  'Jeden uczestnik nie ma dwoch ZAJETYCH spotkan w tym samym czasie - niezaleznie od tego, w ktorej roli wystepuje. Zaproszenia niepotwierdzone (invited) sie nie licza: konkurencyjne zaproszenia na ten sam termin sa normalne, wygrywa pierwsza akceptacja.';