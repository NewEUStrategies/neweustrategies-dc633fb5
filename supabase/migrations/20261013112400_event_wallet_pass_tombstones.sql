-- events-harness: include
-- ============================================================================
-- WYDARZENIA: PRZEPUSTKA GOOGLE WALLET TRACI WAZNOSC TAKZE PO USUNIECIU
-- WYDARZENIA ALBO ZGLOSZENIA; OBIEKT SPRZED OPS-14 NIE GINIE Z DZIENNIKA
-- (przeglad koncowy OPS-14: F9 i F8).
--
-- CZESC 1/2: SCHEMAT (nagrobki), TRIGGERY USUNIECIA, ODTWORZENIE OBIEKTOW
-- SPRZED MIGRACJI. Zajecie i rozliczenie kolejki (takze nagrobkow) jest
-- w czesci 20261013112500 - wdraza sie ja PO tej czesci.
--
-- PROBLEM 1 (F9). `event_wallet_passes` ma klucze obce ON DELETE CASCADE do
-- `events` i `event_registrations` (20260926160000). Usuniecie wydarzenia
-- (panel: lista wydarzen, `supabase.from('events').delete()` pod polityka
-- "events staff write") albo zgloszenia (kaskada z `event_people`, np.
-- usuniecie osoby) kasowalo wiersze dziennika RAZEM z identyfikatorami
-- obiektow Google. Kolejka dezaktywacji (20261013111700) laczy wiersz ze
-- zgloszeniem i wydarzeniem, wiec po kaskadzie nie miala juz czego zajac:
-- przepustka w Google Wallet zostawala ACTIVE do konca wydarzenia + 1 dzien
-- dla wydarzenia, ktorego nie ma. Rejestr audytu (R319) opisywal te luke
-- przed OPS-14; OPS-14 objal tylko sciezki UPDATE.
--
-- PROBLEM 2 (F8). Kod moze wyjsc przed migracja 20261013111600. W tym oknie
-- trasa (wersja 0061c24) nadawala juz obiekt z kodem
-- `<wystawca>.reg_<zgloszenie>.<12 hex>`, a stara, czteroargumentowa funkcja
-- dziennika robila `ON CONFLICT (tenant_id, registration_id, platform) DO
-- UPDATE SET object_id = EXCLUDED.object_id` - jedyny wiersz obiektu sprzed
-- OPS-14 (`<wystawca>.reg_<zgloszenie>`) wskazywal odtad na nowy obiekt.
-- Po migracji backfill i triggery znaly tylko obiekt z kodem; anulowanie,
-- zwrot albo odwolanie dezaktywowalo tylko jego, a stary obiekt w telefonie
-- uczestnika zostawal ACTIVE (dokladnie objaw OPS-14). Trasa od tej zmiany nie
-- nadpisuje juz wiersza (src/lib/events/wallet/walletRoutes.server.ts: przed
-- migracja wydaje obiekt w starym ksztalcie), ale wiersze nadpisane wczesniej
-- trzeba odtworzyc.
--
-- ZMIANA:
--   * `event_wallet_pass_tombstones` - kolejka nagrobkow obiektow Google BEZ
--     kluczy obcych do wydarzenia, zgloszenia ani najemcy. Wiersz niesie
--     najemce (zakres, odczyt dla operacji), identyfikator obiektu, powod
--     (`event_deleted` / `registration_deleted`), granice waznosci obiektu
--     (`valid_until` = koniec wydarzenia + 1 dzien - po niej Google wygasil
--     obiekt sam) oraz dzierzawe i licznik prob jak dziennik. Zadanie
--     dezaktywacji drenuje ja po identyfikatorze obiektu (20261013112500);
--     wiersz znika po skutecznej dezaktywacji albo po `valid_until`, wiec
--     tabela nie przechowuje niczego dluzej, niz trzeba.
--     DLACZEGO BEZ KLUCZA OBCEGO DO `tenants`: usuniecie najemcy kaskaduje
--     do `events`, a trigger tej migracji wstawia wtedy nagrobek z najemca,
--     ktorego wiersza juz nie ma - klucz obcy przewrocilby CALE usuniecie
--     najemcy. Obiekty usunietego najemcy i tak trzeba wylaczyc (wystawca
--     Google jest wspolny dla aplikacji).
--   * trigger BEFORE DELETE na `events` (`events_zz_wallet_tombstone`) -
--     przed kaskada przepisuje do nagrobkow obiekty Google wydarzenia, ktore
--     nie sa jeszcze nieaktywne (`revoked_at IS NULL`); wydarzenie zakonczone
--     ponad dobe temu pomija (obiekty wygasly). BEFORE, bo kaskady klucza
--     obcego biegna jako triggery AFTER - po nich wierszy dziennika juz nie ma.
--     Nazwa `zz_` stawia go za ewentualnymi innymi triggerami BEFORE: jesli
--     ktorys z nich odwola usuniecie (RETURN NULL), ten sie nie wykona;
--   * trigger BEFORE DELETE na `event_registrations`
--     (`event_registrations_zz_wallet_tombstone`) - to samo dla usuniecia
--     zgloszenia wprost albo kaskada z `event_people`. W kaskadzie z
--     usuwanego wydarzenia nie znajduje juz wydarzenia (nagrobki zapisal
--     trigger wydarzenia), a `ON CONFLICT DO NOTHING` i tak nie dubluje;
--   * `_event_wallet_pass_queue_legacy_google_objects()` - dla kazdego
--     zgloszenia z obiektem Google w ksztalcie z kodem, wydanym WIECEJ niz
--     raz (`issue_count > 1` - wiersz nadpisany przez stara funkcje mial co
--     najmniej dwa wydania), na wydarzeniu jeszcze waznym, bez wiersza
--     obiektu w starym ksztalcie: wstawia wiersz `<wystawca>.reg_<zgloszenie>`
--     od razu zgloszony do dezaktywacji jako `replaced` - tak, jak oznaczylby
--     go dziennik, gdyby migracja weszla przed kodem. Identyfikator jest
--     deterministyczny (prefiks identyfikatora z kodem, ten sam co
--     `legacyGoogleObjectId` w TS). Obiekt, ktorego w Google nigdy nie bylo,
--     da 404 - zadanie traktuje to jako dezaktywacje, wiec slepy PATCH jest
--     bezpieczny. Obiektow Z KODEM zgubionych przez zmiane kodu w tym samym
--     oknie odtworzyc sie nie da (baza nie zna kodu) - to zamyka dopiero
--     zmiana trasy. Funkcja jest wywolana raz ponizej i zostaje jako
--     naprawa do ponownego uruchomienia (idempotentna).
--
-- BEZPIECZENSTWO: tabela nagrobkow z RLS i bez polityk klienckich, bez
-- grantow dla anon/authenticated (pisza tylko triggery SECURITY DEFINER,
-- czyta i zmienia zadanie serwera - service_role). Triggery SECURITY DEFINER
-- z search_path, bez grantow klienckich; najemca zawsze z usuwanego wiersza.
-- Funkcja odtworzenia: wylacznie service_role (operacje), bez parametrow.
--
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, wiezy w definicji tabeli,
-- DROP TRIGGER IF EXISTS + CREATE, CREATE OR REPLACE FUNCTION, odtworzenie
-- przez ON CONFLICT DO NOTHING (drugi przebieg nie wstawia niczego).
--
-- DOWOD: scripts/events-harness/runtime_test.d/55_wallet_revocation_robustness.sql
-- (sekcje: nagrobki, odtworzenie obiektow sprzed migracji); trasa:
-- src/lib/events/wallet/__tests__/walletRoutes.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) NAGROBKI OBIEKTOW GOOGLE
-- ----------------------------------------------------------------------------
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
-- Polityk klienckich celowo brak: klient nie czyta ani nie pisze nagrobkow.

-- ----------------------------------------------------------------------------
-- 2) TRIGGER WYDARZENIA: USUNIECIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_events_wallet_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_until timestamptz := COALESCE(OLD.ends_at, OLD.starts_at) + interval '1 day';
BEGIN
  -- Wydarzenie zakonczone ponad dobe temu: obiekty wygasly same.
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

  -- BEFORE DELETE: zwrot OLD przepuszcza usuniecie (NULL by je odwolal).
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

-- ----------------------------------------------------------------------------
-- 3) TRIGGER ZGLOSZENIA: USUNIECIE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tg_event_registrations_wallet_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- W kaskadzie z usuwanego wydarzenia JOIN nie znajduje wydarzenia - jego
  -- obiekty zapisal juz `_tg_events_wallet_tombstone`.
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

-- ----------------------------------------------------------------------------
-- 4) OBIEKTY SPRZED OPS-14 NADPISANE W OKNIE "KOD PRZED MIGRACJA"
-- ----------------------------------------------------------------------------
-- Identyfikator z kodem: `<wystawca>.reg_<zgloszenie>.<12 hex>` (TS:
-- `googleObjectId`, sufiks `walletObjectSuffix`). Stary: ten sam prefiks bez
-- ostatnich 13 znakow (`.` + 12 hex) - TS: `legacyGoogleObjectId`.
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
