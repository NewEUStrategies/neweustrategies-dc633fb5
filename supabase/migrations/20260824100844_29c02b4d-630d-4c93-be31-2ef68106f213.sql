CREATE TABLE IF NOT EXISTS public.event_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  kind text NOT NULL DEFAULT 'event_entry',
  session_id uuid,
  room_id uuid,
  sponsor_id uuid,
  direction_mode text NOT NULL DEFAULT 'in_only',
  access_mode text NOT NULL DEFAULT 'control',
  capacity integer,
  dedupe_window_seconds integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checkpoints_name_pl_len CHECK (char_length(btrim(name_pl)) BETWEEN 2 AND 120),
  CONSTRAINT event_checkpoints_name_en_len CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 120),
  CONSTRAINT event_checkpoints_kind_values CHECK (kind IN (
    'event_entry', 'session', 'room', 'zone', 'catering', 'cloakroom', 'company_booth'
  )),
  CONSTRAINT event_checkpoints_direction_mode_values
    CHECK (direction_mode IN ('in_only', 'out_only', 'in_out')),
  CONSTRAINT event_checkpoints_access_mode_values
    CHECK (access_mode IN ('track', 'control')),
  CONSTRAINT event_checkpoints_capacity_positive CHECK (capacity IS NULL OR capacity > 0),
  CONSTRAINT event_checkpoints_capacity_needs_control
    CHECK (capacity IS NULL OR access_mode = 'control'),
  CONSTRAINT event_checkpoints_dedupe_window_range
    CHECK (dedupe_window_seconds BETWEEN 5 AND 86400),
  CONSTRAINT event_checkpoints_session_scoped
    CHECK (session_id IS NULL OR kind = 'session'),
  CONSTRAINT event_checkpoints_session_required
    CHECK (kind <> 'session' OR session_id IS NOT NULL),
  CONSTRAINT event_checkpoints_sponsor_scoped
    CHECK (sponsor_id IS NULL OR kind = 'company_booth'),
  CONSTRAINT event_checkpoints_sponsor_required
    CHECK (kind <> 'company_booth' OR sponsor_id IS NOT NULL),
  CONSTRAINT event_checkpoints_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_checkpoints_tenant_event_id_key UNIQUE (tenant_id, event_id, id),
  CONSTRAINT event_checkpoints_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkpoints_session_fk FOREIGN KEY (tenant_id, event_id, session_id)
    REFERENCES public.event_sessions (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_checkpoints_room_fk FOREIGN KEY (tenant_id, event_id, room_id)
    REFERENCES public.event_rooms (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_checkpoints_sponsor_fk FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_checkpoints IS
  'Punkt odprawy wydarzenia: miejsce, w ktorym czytany jest kod uczestnika. Siedem rodzajow, bo siedem razy inna semantyka licznika. Zapis wylacznie przez admin_event_checkpoint_save.';
COMMENT ON COLUMN public.event_checkpoints.kind IS
  'Rodzaj punktu: event_entry | session | room | zone | catering | cloakroom | company_booth. Wiazanie z sesja jest wymagane dla session, wiazanie ze sponsorem dla company_booth (CHECK-i _scoped/_required).';
COMMENT ON COLUMN public.event_checkpoints.direction_mode IS
  'Kierunki obslugiwane przez punkt: in_only | out_only | in_out. Kierunek jest wlasciwoscia PUNKTU, nie skanu - operator przy bramce nie ma czego wybierac, a mozliwosc wyboru pod presja kolejki gwarantuje pomylke.';
COMMENT ON COLUMN public.event_checkpoints.access_mode IS
  'track = licz i nie blokuj (punkt statystyczny); control = egzekwuj (odmowa znaczy "nie wpuszczaj"). Limit miejsc dziala tylko w trybie control.';
COMMENT ON COLUMN public.event_checkpoints.capacity IS
  'Limit rownoczesnej obecnosci w punkcie. Egzekwowany pod blokada wiersza punktu w _event_checkin_write - liczony z dziennika (kierunek ostatniego skanu osoby), nie z kolumny-licznika, ktora by dryfowala.';
COMMENT ON COLUMN public.event_checkpoints.dedupe_window_seconds IS
  'Okno idempotencji punktu w sekundach. Utrwala sie w event_checkins.dedupe_range, wiec zmiana okna nie przepisuje historii.';
COMMENT ON COLUMN public.event_checkpoints.is_active IS
  'Wylaczenie ODWRACALNE: punkt znika ze skanera, ale jego dziennik zostaje. Dlatego wylaczenie jest osobna operacja od usuniecia, a nie jego lagodniejsza wersja.';

CREATE UNIQUE INDEX IF NOT EXISTS event_checkpoints_event_name_unique
  ON public.event_checkpoints (tenant_id, event_id, lower(btrim(name_pl)));
CREATE INDEX IF NOT EXISTS event_checkpoints_event_order_idx
  ON public.event_checkpoints (tenant_id, event_id, sort_order, name_pl);
CREATE INDEX IF NOT EXISTS event_checkpoints_session_idx
  ON public.event_checkpoints (tenant_id, session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_checkpoints_sponsor_idx
  ON public.event_checkpoints (tenant_id, sponsor_id) WHERE sponsor_id IS NOT NULL;

GRANT SELECT ON public.event_checkpoints TO authenticated;
GRANT ALL ON public.event_checkpoints TO service_role;

ALTER TABLE public.event_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_checkpoints_staff_read" ON public.event_checkpoints;
CREATE POLICY "event_checkpoints_staff_read"
  ON public.event_checkpoints FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_checkpoints_touch_updated_at ON public.event_checkpoints;
CREATE TRIGGER event_checkpoints_touch_updated_at
  BEFORE UPDATE ON public.event_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.event_scanner_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  checkpoint_id uuid,
  sponsor_id uuid,
  label text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['checkin']::text[],
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  scan_count integer NOT NULL DEFAULT 0,
  failed_scan_count integer NOT NULL DEFAULT 0,
  last_failed_scan_at timestamptz,
  fail_window_started_at timestamptz,
  fail_window_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_scanner_devices_label_len
    CHECK (char_length(btrim(label)) BETWEEN 2 AND 120),
  CONSTRAINT event_scanner_devices_token_shape CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_scanner_devices_prefix_shape CHECK (token_prefix ~ '^[A-Za-z0-9_-]{8}$'),
  CONSTRAINT event_scanner_devices_scopes_nonempty
    CHECK (array_length(scopes, 1) IS NOT NULL AND array_length(scopes, 1) BETWEEN 1 AND 3),
  CONSTRAINT event_scanner_devices_scopes_values
    CHECK (scopes <@ ARRAY['checkin', 'lead', 'badge_print']::text[]),
  CONSTRAINT event_scanner_devices_lead_needs_sponsor
    CHECK (NOT ('lead' = ANY (scopes)) OR sponsor_id IS NOT NULL),
  CONSTRAINT event_scanner_devices_counters_nonneg
    CHECK (scan_count >= 0 AND failed_scan_count >= 0 AND fail_window_count >= 0),
  CONSTRAINT event_scanner_devices_revoked_inactive
    CHECK (revoked_at IS NULL OR is_active = false),
  CONSTRAINT event_scanner_devices_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_scanner_devices_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_scanner_devices_checkpoint_fk
    FOREIGN KEY (tenant_id, event_id, checkpoint_id)
    REFERENCES public.event_checkpoints (tenant_id, event_id, id) ON DELETE SET NULL,
  CONSTRAINT event_scanner_devices_sponsor_fk
    FOREIGN KEY (tenant_id, event_id, sponsor_id)
    REFERENCES public.event_sponsors (tenant_id, event_id, id) ON DELETE SET NULL
);

COMMENT ON TABLE public.event_scanner_devices IS
  'Poswiadczenie URZADZENIA skanujacego (nie osoby). Trzyma SHA-256 tokenu, zakresy uprawnien, terminy i liczniki bezpieczenstwa. Token jawny wraca z admin_event_scanner_device_issue dokladnie raz. Model zagrozen w naglowku migracji.';
COMMENT ON COLUMN public.event_scanner_devices.token_hash IS
  'SHA-256 tokenu urzadzenia. Odciety GRANTEM KOLUMNOWYM od roli authenticated (wzorzec events.join_url) - redaktor czytajacy tabele go nie widzi.';
COMMENT ON COLUMN public.event_scanner_devices.token_prefix IS
  'Pierwsze osiem znakow wartosci jawnej. Sluzy IDENTYFIKACJI wiersza po wydrukowanej kartce, zeby uniewaznienie bylo punktowe, a nie zbiorowe. Koszt: 144 bity entropii zamiast 192.';
COMMENT ON COLUMN public.event_scanner_devices.scopes IS
  'Zamkniety slownik zakresow: checkin | lead | badge_print. Tablica jest bezpieczna, bo elementy sa stalymi, a nie wskazaniami wierszy obcego najemcy.';
COMMENT ON COLUMN public.event_scanner_devices.is_active IS
  'Pauza ODWRACALNA. Uniewaznienie (revoked_at) jest nieodwracalne, blokada (locked_until) automatyczna - trzy rozne stany, bo trzy rozne decyzje.';
COMMENT ON COLUMN public.event_scanner_devices.expires_at IS
  'Termin waznosci, OBOWIAZKOWY. Poswiadczenie bez terminu zyje w pamieci telefonu wolontariusza bez konca; wygasniecie jest jedyna mitygacja dzialajaca bez czyjejkolwiek pamieci.';
COMMENT ON COLUMN public.event_scanner_devices.failed_scan_count IS
  'Monotoniczny licznik nieudanych rozpoznan tokenu uczestnika. Czytany w panelu - jedyny sygnal proby zgadywania tokenow ukradzionym poswiadczeniem.';
COMMENT ON COLUMN public.event_scanner_devices.fail_window_count IS
  'Nieudane proby w oknie kroczacym (10 minut). Po przekroczeniu progu 20 urzadzenie jest blokowane na 30 minut i emitowane jest zdarzenie event_scanner_device.locked.v1.';
COMMENT ON COLUMN public.event_scanner_devices.locked_until IS
  'Blokada automatyczna po serii nieudanych rozpoznan. Zdejmuje ja WYLACZNIE administrator (admin_event_scanner_device_set_active z is_active = true).';

CREATE UNIQUE INDEX IF NOT EXISTS event_scanner_devices_token_uniq
  ON public.event_scanner_devices (token_hash);
CREATE INDEX IF NOT EXISTS event_scanner_devices_event_idx
  ON public.event_scanner_devices (tenant_id, event_id, label);
CREATE INDEX IF NOT EXISTS event_scanner_devices_checkpoint_idx
  ON public.event_scanner_devices (tenant_id, checkpoint_id) WHERE checkpoint_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_scanner_devices_sponsor_idx
  ON public.event_scanner_devices (tenant_id, sponsor_id) WHERE sponsor_id IS NOT NULL;

REVOKE ALL ON public.event_scanner_devices FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, event_id, checkpoint_id, sponsor_id, label, token_prefix,
  scopes, is_active, expires_at, revoked_at, revoked_by, last_seen_at,
  scan_count, failed_scan_count, last_failed_scan_at,
  fail_window_started_at, fail_window_count, locked_until,
  created_by, created_at, updated_at
) ON public.event_scanner_devices TO authenticated;
GRANT ALL ON public.event_scanner_devices TO service_role;

ALTER TABLE public.event_scanner_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_scanner_devices_staff_read" ON public.event_scanner_devices;
CREATE POLICY "event_scanner_devices_staff_read"
  ON public.event_scanner_devices FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP TRIGGER IF EXISTS event_scanner_devices_touch_updated_at ON public.event_scanner_devices;
CREATE TRIGGER event_scanner_devices_touch_updated_at
  BEFORE UPDATE ON public.event_scanner_devices
  FOR EACH ROW EXECUTE FUNCTION public._tg_touch_updated_at();