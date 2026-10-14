CREATE TABLE IF NOT EXISTS public.event_wallet_pass_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  object_id text NOT NULL,
  reason text NOT NULL,
  valid_until timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  error text,
  CONSTRAINT event_wallet_pass_tombstones_object_unique UNIQUE (tenant_id, object_id),
  CONSTRAINT event_wallet_pass_tombstones_object_id_len
    CHECK (char_length(object_id) BETWEEN 1 AND 200),
  CONSTRAINT event_wallet_pass_tombstones_reason_values
    CHECK (reason IN ('event_deleted', 'registration_deleted')),
  CONSTRAINT event_wallet_pass_tombstones_attempts_range CHECK (attempts >= 0),
  CONSTRAINT event_wallet_pass_tombstones_error_len
    CHECK (error IS NULL OR char_length(error) BETWEEN 1 AND 300)
);

COMMENT ON TABLE public.event_wallet_pass_tombstones IS
  'Obiekty Google Wallet usunietych wydarzen i zgloszen, ktore trzeba jeszcze ustawic jako INACTIVE. Bez kluczy obcych (wiersz przezywa kaskade wydarzenia, zgloszenia i najemcy). Pisza triggery BEFORE DELETE, drenuje zadanie serwera (service_role) przez _event_wallet_pass_revocations_claim/_settle; wiersz znika po dezaktywacji albo po valid_until.';
COMMENT ON COLUMN public.event_wallet_pass_tombstones.tenant_id IS
  'Najemca usunietego wiersza (zakres i odczyt dla operacji). Celowo bez klucza obcego: usuniecie najemcy kaskaduje do wydarzen, a obiekty i tak trzeba wylaczyc.';
COMMENT ON COLUMN public.event_wallet_pass_tombstones.reason IS
  'event_deleted (usuniete wydarzenie) albo registration_deleted (usuniete zgloszenie, takze kaskada z osoby).';
COMMENT ON COLUMN public.event_wallet_pass_tombstones.valid_until IS
  'Koniec wydarzenia + 1 dzien (validTimeInterval obiektu). Po tej chwili Google wygasil obiekt sam - zajecie usuwa wiersz bez wywolania sieci.';
COMMENT ON COLUMN public.event_wallet_pass_tombstones.claimed_at IS
  'Dzierzawa zadania i chwila ostatniej proby (odstep ponowien jak w event_wallet_passes).';
COMMENT ON COLUMN public.event_wallet_pass_tombstones.attempts IS
  'Liczba zajec. Po 8 nieudanych probach wiersz czeka z bledem na valid_until albo na _event_wallet_pass_revocations_requeue().';

CREATE INDEX IF NOT EXISTS event_wallet_pass_tombstones_queue_idx
  ON public.event_wallet_pass_tombstones (requested_at, id);

REVOKE ALL ON public.event_wallet_pass_tombstones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_wallet_pass_tombstones TO service_role;
ALTER TABLE public.event_wallet_pass_tombstones ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._tg_events_wallet_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_until timestamptz := COALESCE(OLD.ends_at, OLD.starts_at) + interval '1 day';
BEGIN
  IF v_until > now() THEN
    INSERT INTO public.event_wallet_pass_tombstones (tenant_id, object_id, reason, valid_until)
    SELECT w.tenant_id, w.object_id, 'event_deleted', v_until
      FROM public.event_wallet_passes w
     WHERE w.tenant_id = OLD.tenant_id
       AND w.event_id = OLD.id
       AND w.platform = 'google'
       AND w.revoked_at IS NULL
    ON CONFLICT (tenant_id, object_id) DO NOTHING;
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_events_wallet_tombstone() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_events_wallet_tombstone() IS
  'BEFORE DELETE na events: obiekty Google Wallet usuwanego wydarzenia, ktore nie sa jeszcze nieaktywne, ida do event_wallet_pass_tombstones (event_deleted), zanim kaskada skasuje dziennik. Wydarzenie zakonczone ponad dobe temu pomija.';

DROP TRIGGER IF EXISTS events_zz_wallet_tombstone ON public.events;
CREATE TRIGGER events_zz_wallet_tombstone
  BEFORE DELETE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_events_wallet_tombstone();

CREATE OR REPLACE FUNCTION public._tg_event_registrations_wallet_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO public.event_wallet_pass_tombstones (tenant_id, object_id, reason, valid_until)
  SELECT w.tenant_id, w.object_id, 'registration_deleted',
         COALESCE(e.ends_at, e.starts_at) + interval '1 day'
    FROM public.event_wallet_passes w
    JOIN public.events e ON e.id = w.event_id AND e.tenant_id = w.tenant_id
   WHERE w.tenant_id = OLD.tenant_id
     AND w.registration_id = OLD.id
     AND w.platform = 'google'
     AND w.revoked_at IS NULL
     AND COALESCE(e.ends_at, e.starts_at) + interval '1 day' > now()
  ON CONFLICT (tenant_id, object_id) DO NOTHING;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_registrations_wallet_tombstone()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_registrations_wallet_tombstone() IS
  'BEFORE DELETE na event_registrations: obiekty Google Wallet usuwanego zgloszenia (wprost albo kaskada z osoby), ktore nie sa jeszcze nieaktywne, ida do event_wallet_pass_tombstones (registration_deleted). Wydarzenie zakonczone ponad dobe temu pomija.';

DROP TRIGGER IF EXISTS event_registrations_zz_wallet_tombstone ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_wallet_tombstone
  BEFORE DELETE ON public.event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_event_registrations_wallet_tombstone();

CREATE OR REPLACE FUNCTION public._event_wallet_pass_queue_legacy_google_objects()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH legacy AS (
    SELECT w.tenant_id,
           w.event_id,
           w.registration_id,
           left(w.object_id, char_length(w.object_id) - 13) AS object_id,
           min(w.first_issued_at) AS issued_at
      FROM public.event_wallet_passes w
      JOIN public.events e ON e.id = w.event_id AND e.tenant_id = w.tenant_id
     WHERE w.platform = 'google'
       AND w.issue_count > 1
       AND w.object_id ~ ('^.+\.reg_' || w.registration_id::text || '\.[0-9a-f]{12}$')
       AND COALESCE(e.ends_at, e.starts_at) + interval '1 day' > now()
     GROUP BY w.tenant_id, w.event_id, w.registration_id,
              left(w.object_id, char_length(w.object_id) - 13)
  ), queued AS (
    INSERT INTO public.event_wallet_passes
      (tenant_id, event_id, registration_id, platform, object_id,
       first_issued_at, last_issued_at, revoke_requested_at, revoke_reason)
    SELECT l.tenant_id, l.event_id, l.registration_id, 'google', l.object_id,
           l.issued_at, l.issued_at, now(), 'replaced'
      FROM legacy l
    ON CONFLICT (tenant_id, platform, object_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM queued;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public._event_wallet_pass_queue_legacy_google_objects()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_wallet_pass_queue_legacy_google_objects() TO service_role;

COMMENT ON FUNCTION public._event_wallet_pass_queue_legacy_google_objects() IS
  'Naprawa F8 (idempotentna): obiekt Google sprzed OPS-14 (<wystawca>.reg_<zgloszenie>), ktorego wiersz nadpisala stara funkcja dziennika w oknie "kod przed migracja", wraca do dziennika zgloszony do dezaktywacji jako replaced. Kandydaci: obiekt z kodem wydany wiecej niz raz, wydarzenie jeszcze wazne, brak wiersza starego obiektu. Zwraca liczbe wstawionych wierszy. Wylacznie service_role.';

DO $$
BEGIN
  PERFORM public._event_wallet_pass_queue_legacy_google_objects();
END $$;