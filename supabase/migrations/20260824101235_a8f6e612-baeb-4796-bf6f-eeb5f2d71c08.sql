CREATE TABLE IF NOT EXISTS public.event_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  person_id uuid NOT NULL,
  registration_id uuid,
  direction text NOT NULL DEFAULT 'in',
  result text NOT NULL DEFAULT 'granted',
  source text NOT NULL DEFAULT 'qr_code',
  scanned_at timestamptz NOT NULL DEFAULT now(),
  device_scanned_at timestamptz,
  occurred_at timestamptz GENERATED ALWAYS AS
    (COALESCE(device_scanned_at, scanned_at)) STORED,
  dedupe_range tstzrange NOT NULL,
  operator_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id uuid,
  client_scan_uid text,
  repeat_count integer NOT NULL DEFAULT 0,
  last_repeat_at timestamptz,
  note text,
  CONSTRAINT event_checkins_direction_values CHECK (direction IN ('in', 'out')),
  CONSTRAINT event_checkins_result_values CHECK (result IN (
    'granted',
    'denied_not_registered',
    'denied_registration_status',
    'denied_direction',
    'denied_capacity',
    'denied_checkpoint_inactive'
  )),
  CONSTRAINT event_checkins_source_values CHECK (source IN (
    'qr_code', 'manual_entry', 'name_search', 'self_service'
  )),
  CONSTRAINT event_checkins_actor_exactly_one
    CHECK (num_nonnulls(operator_user_id, device_id) = 1),
  CONSTRAINT event_checkins_client_uid_shape CHECK (
    client_scan_uid IS NULL
    OR client_scan_uid ~ '^[A-Za-z0-9_-]{8,64}$'
  ),
  CONSTRAINT event_checkins_repeat_nonneg CHECK (repeat_count >= 0),
  CONSTRAINT event_checkins_repeat_dated
    CHECK (repeat_count = 0 OR last_repeat_at IS NOT NULL),
  CONSTRAINT event_checkins_note_len CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT event_checkins_device_time_sane CHECK (
    device_scanned_at IS NULL
    OR (device_scanned_at <= scanned_at + interval '2 minutes'
        AND device_scanned_at >= scanned_at - interval '7 days')
  ),
  CONSTRAINT event_checkins_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_checkins_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkins_checkpoint_fk FOREIGN KEY (tenant_id, event_id, checkpoint_id)
    REFERENCES public.event_checkpoints (tenant_id, event_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkins_person_fk FOREIGN KEY (tenant_id, person_id)
    REFERENCES public.event_people (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_checkins_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id),
  CONSTRAINT event_checkins_device_fk FOREIGN KEY (tenant_id, device_id)
    REFERENCES public.event_scanner_devices (tenant_id, id)
);

COMMENT ON TABLE public.event_checkins IS
  'Dziennik odpraw wydarzenia: kto, gdzie, w ktorym kierunku, z jakim wynikiem i czym zeskanowany. Wiersze DOPISYWANE - jedyny UPDATE to licznik powtorzen. Zapis wylacznie przez _event_checkin_write (plaszczyzna urzadzenia i panelu).';
COMMENT ON COLUMN public.event_checkins.registration_id IS
  'Zapis, na podstawie ktorego zapadla decyzja. NULL = wejscie bez zapisu. Klucz obcy BEZ kaskady: zapis z odprawa jest dokumentem, wiec jego usuniecie jest odrzucane.';
COMMENT ON COLUMN public.event_checkins.result IS
  'granted | denied_not_registered | denied_registration_status | denied_direction | denied_capacity | denied_checkpoint_inactive. Odmowa MA wiersz - bez niego nie da sie odpowiedziec, dlaczego kogos nie wpuszczono.';
COMMENT ON COLUMN public.event_checkins.source IS
  'qr_code | manual_entry | name_search | self_service. Plaszczyzna urzadzenia moze zapisac wylacznie qr_code i self_service, plaszczyzna panelu wylacznie manual_entry i name_search - mapowanie jest wymuszone w RPC, nie w interfejsie.';
COMMENT ON COLUMN public.event_checkins.occurred_at IS
  'Chwila, w ktorej czlowiek stal przy bramce: czas urzadzenia, a gdy go nie ma - czas przyjecia przez serwer. Nosnik histogramu i okna idempotencji.';
COMMENT ON COLUMN public.event_checkins.dedupe_range IS
  'Okno idempotencji [occurred_at, occurred_at + okno punktu). Nosnik ograniczen EXCLUDE, ktore blokuja druga ZGODE dla tej samej osoby, punktu i kierunku w tym oknie.';
COMMENT ON COLUMN public.event_checkins.client_scan_uid IS
  'Klucz idempotencji nadany przez skaner (jeden fizyczny skan = jedna wartosc). Chroni przed powtornym wyslaniem kolejki offline, ktorego okno czasowe nie zlapie.';
COMMENT ON COLUMN public.event_checkins.repeat_count IS
  'Ile razy ten sam skan powtorzyl sie w oknie idempotencji. Podwojne pikniecie NIE tworzy wiersza - podnosi ten licznik, wiec zawieszony skaner nie utopi listy odpraw.';

CREATE UNIQUE INDEX IF NOT EXISTS event_checkins_client_uid_uniq
  ON public.event_checkins (tenant_id, event_id, client_scan_uid)
  WHERE client_scan_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_checkins_event_time_idx
  ON public.event_checkins (tenant_id, event_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_checkins_checkpoint_person_idx
  ON public.event_checkins (tenant_id, checkpoint_id, person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_checkins_checkpoint_result_idx
  ON public.event_checkins (tenant_id, checkpoint_id, result, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_checkins_person_idx
  ON public.event_checkins (tenant_id, event_id, person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS event_checkins_registration_idx
  ON public.event_checkins (tenant_id, registration_id) WHERE registration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_checkins_device_idx
  ON public.event_checkins (tenant_id, device_id, occurred_at DESC) WHERE device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_event_checkins_set_dedupe_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window integer;
  v_at timestamptz := COALESCE(NEW.device_scanned_at, NEW.scanned_at);
BEGIN
  SELECT cp.dedupe_window_seconds INTO v_window
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = NEW.tenant_id
    AND cp.event_id = NEW.event_id
    AND cp.id = NEW.checkpoint_id;

  NEW.dedupe_range := tstzrange(
    v_at,
    v_at + make_interval(secs => COALESCE(v_window, 60)),
    '[)'
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_event_checkins_set_dedupe_range() IS
  'Ustawia okno idempotencji wiersza odprawy z konfiguracji punktu. Trigger, a nie kolumna wyliczana, bo timestamptz + interval jest w Postgresie STABLE, nie IMMUTABLE.';

DROP TRIGGER IF EXISTS event_checkins_set_dedupe_range ON public.event_checkins;
CREATE TRIGGER event_checkins_set_dedupe_range
  BEFORE INSERT OR UPDATE OF scanned_at, device_scanned_at, checkpoint_id
  ON public.event_checkins
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_checkins_set_dedupe_range();

DO $$
DECLARE
  v_opclass text;
  v_direction text;
  v_conname text;
BEGIN
  SELECT quote_ident(n.nspname) || '.gist_uuid_ops'
    INTO v_opclass
  FROM pg_opclass oc
  JOIN pg_namespace n ON n.oid = oc.opcnamespace
  JOIN pg_am am ON am.oid = oc.opcmethod
  WHERE oc.opcname = 'gist_uuid_ops' AND am.amname = 'gist'
  LIMIT 1;

  IF v_opclass IS NULL THEN
    RAISE EXCEPTION 'btree_gist_missing: klasa gist_uuid_ops nie istnieje - idempotencji odprawy nie da sie wymusic w silniku';
  END IF;

  FOREACH v_direction IN ARRAY ARRAY['in', 'out'] LOOP
    v_conname := 'event_checkins_no_double_' || v_direction;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.event_checkins'::regclass
        AND conname = v_conname
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.event_checkins ADD CONSTRAINT %2$I '
      'EXCLUDE USING gist (tenant_id %1$s WITH =, checkpoint_id %1$s WITH =, '
      'person_id %1$s WITH =, dedupe_range WITH &&) '
      'WHERE (result = ''granted'' AND direction = %3$L)',
      v_opclass, v_conname, v_direction
    );
  END LOOP;
END
$$;

COMMENT ON CONSTRAINT event_checkins_no_double_in ON public.event_checkins IS
  'Jedna osoba nie moze miec dwoch ZGOD na wejscie w tym samym punkcie w oknie idempotencji. Bramka wyscigu dla _event_checkin_write - glownym mechanizmem jest odczyt wiersza w oknie i podniesienie licznika powtorzen.';
COMMENT ON CONSTRAINT event_checkins_no_double_out ON public.event_checkins IS
  'Jak event_checkins_no_double_in, dla kierunku wyjscia. Dwa ograniczenia czesciowe zamiast jednego z gist_text_ops - jedna zaleznosc od btree_gist mniej.';

GRANT SELECT ON public.event_checkins TO authenticated;
GRANT ALL ON public.event_checkins TO service_role;

ALTER TABLE public.event_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_checkins_staff_read" ON public.event_checkins;
CREATE POLICY "event_checkins_staff_read"
  ON public.event_checkins FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );