-- events-harness: include
-- ============================================================================
-- WYDARZENIA: UTWARDZENIE SKANERA - DRUK IDENTYFIKATORA NIE ZABIJA BILETOW,
-- BLOKADA PONOWNEGO WEJSCIA, KLUCZE OBCE SET NULL, OKNO KOLEJKI
-- (OPS-04, OPS-08, OPS-11, OPS-12) ORAZ ZGODA PARTNERSKA PER ZGLOSZENIE
-- W SKANIE LEADU (OPS-01, konsument fundamentu 20261012090000).
--
-- CZESC 1/5: SCHEMAT I FUNKCJE POMOCNICZE. Ciala funkcji plaszczyzny
-- urzadzenia i panelu sa w czesciach 20261012110100 .. 20261012110400 -
-- wdraza sie je PO KOLEI, po tej czesci.
--
-- OPS-04 - DRUK IDENTYFIKATORA UNIEWAZNIAL BILETY Z PORTFELI.
--   `admin_event_badge_batch` przy KAZDYM wydruku nadpisywal
--   `event_registrations.qr_token_hash` (baza trzyma sam skrot, wiec wydruk
--   potrzebowal nowej wartosci jawnej). Bilet z e-maila i przepustki Apple /
--   Google niosa STARY kod - po porannym druku 200 identyfikatorow ich
--   posiadacze dostawali przy bramce "nieznany kod", a 20 takich skanow
--   w 10 minut blokowalo urzadzenie na 30 minut w szczycie, bez decyzji dla
--   operatora.
--   ZMIANA:
--     * identyfikator dostaje WLASNE poswiadczenie:
--       `event_registrations.badge_token_hash` (+ `badge_issued_at`),
--       unikalne w granicach najemcy. Druk i przedruk rotuja WYLACZNIE je -
--       bilet z e-maila i portfela zostaje wazny;
--     * kazdy skrot, ktory przestal byc wazny (bilet albo identyfikator,
--       z DOWOLNEJ sciezki - trigger AFTER UPDATE na kolumnach skrotow, nie
--       edycja kazdej funkcji rotujacej), trafia do
--       `event_superseded_codes` z powodem: reissued (zastapiony nowym),
--       revoked (wyczyszczony, np. zwrot), invalidated (jawne uniewaznienie
--       zgubionego w panelu);
--     * skan zastapionego kodu daje osobny wynik `code_superseded` (odmowa,
--       imie i nazwisko oraz chwila zastapienia dla operatora) i NIE liczy
--       sie do okna blokady - podnosi tylko `superseded_scan_count`;
--       naprawde nieznany kod zachowuje sie jak dotad;
--     * wyczyszczenie biletu (zwrot, anulowanie przyjecia) zdejmuje tez
--       identyfikator - identyfikator nie wpuszcza dluzej niz bilet;
--     * lista offline niesie skrot identyfikatora (`bh`) i skroty zastapione
--       (`sh`), wiec urzadzenie bez sieci rozpoznaje oba.
--
-- OPS-08 - JEDEN KOD WPUSZCZAL WIELE OSOB.
--   `_event_checkin_evaluate` nie pytal, czy osoba juz jest w srodku; tabela
--   konfliktow dopuszczala "granted x2". ZMIANA: `event_checkpoints.
--   reentry_policy` (allow | deny, tylko w trybie control). Przy `deny`
--   wejscie osoby, ktorej ostatni skan ZGODY w tym punkcie byl wejsciem,
--   konczy sie wynikiem `denied_already_inside`. Kazda odpowiedz odprawy
--   niesie `reentry` (bool) i `reentry_previous_at`.
--
-- OPS-11 - ZLOZONE KLUCZE OBCE ON DELETE SET NULL BEZ LISTY KOLUMN.
--   `SET NULL` na kluczu (tenant_id, event_id, x) zeruje WSZYSTKIE kolumny
--   klucza, w tym `tenant_id NOT NULL` - usuniecie wiersza nadrzednego
--   konczylo sie bledem NOT NULL. Repozytorium naprawilo ten wzorzec
--   w 20260923120000 i 20260926090000; tu wszystkie pozostale w module
--   (audyt `pg_constraint` po replayu: 17 kluczy) dostaja forme PG15
--   `ON DELETE SET NULL (kolumna)`. Dwa wyjatki, swiadome: punkt kontrolny ->
--   sesja i punkt kontrolny -> sponsor przechodza na NO ACTION, bo CHECK-i
--   `event_checkpoints_session_required` i `_sponsor_required` czynia SET NULL
--   niewykonalnym (wskazanie jest wymagane dla rodzaju punktu) - deklaracja
--   klamala. Usuniecie sponsora jawnie odmawia przy stanowisku firmy
--   (`sponsor_has_checkpoints`), a jego urzadzenia najpierw uniewaznia.
--   Urzadzenie, ktore traci sponsora albo przypiety punkt, jest
--   uniewazniane triggerem - poswiadczenie nigdy nie poszerza sie po cichu
--   do wszystkich punktow, a CHECK `lead_needs_sponsor` dopuszcza brak
--   sponsora wylacznie na poswiadczeniu uniewaznionym (zakres zostaje jako
--   historia; "zdjecie zakresu lead" bylo niewykonalne dla poswiadczenia
--   z jednym zakresem przez CHECK `scopes_nonempty`).
--
-- OPS-12 - OKNO 72 H I FLAGA `queued` STEROWANE PRZEZ KLIENTA.
--   Po terminie poswiadczenia skan z kolejki przechodzil, jesli klient
--   zadeklarowal `queued` i czas sprzed terminu. ZMIANA:
--     * `event_scanner_devices.queue_secret` - losowy sekret urzadzenia,
--       NIGDY nie oddawany (brak grantu kolumnowego);
--     * bootstrap, lista offline i kazda udana odpowiedz zapisu odprawy /
--       leadu oddaja `queue_marker` = base64url(8 bajtow big-endian
--       issued_at w sekundach epoki || HMAC-SHA256(klucz = queue_secret,
--       tresc = device_id || ':' || issued_at)) oraz
--       `queue_marker_valid_until`;
--     * PO terminie skan z kolejki przechodzi tylko z markerem, ktory sie
--       weryfikuje, ma issued_at <= expires_at, a czas skanu miesci sie
--       w [issued_at - 15 min, LEAST(expires_at, issued_at + 24 h)] - i nadal
--       w oknie 72 h; inaczej `device_expired`. Przed terminem bez zmian;
--     * nieznane kody z kolejki maja WLASNY licznik okna: 100 w 60 minut
--       (czas serwera) blokuje urzadzenie na 30 minut. Na zywo bez zmian:
--       20 w 10 minut, blokada 30 minut;
--     * `admin_event_scanner_device_issue` odrzuca termin pozniejszy niz
--       koniec wydarzenia + 7 dni (`expiry_too_late:`), a termin domyslny
--       przycina do tej granicy. Istniejace poswiadczenia przycina ta
--       migracja.
--
-- OPS-01 (KONSUMENT) - `event_lead_scan_record` czyta zgode partnerska przez
--   `_event_partner_consent_at(tenant, event, person)` (zgoda NA TO
--   wydarzenie), nie stempel osoby z `event_people`.
--
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD,
-- CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- DOWOD: scripts/events-harness/runtime_test.d/54_scanner_ops_hardening.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) OPS-11: KLUCZE OBCE ZLOZONE - SET NULL TYLKO NA KOLUMNIE WSKAZANIA
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_scanner_devices DROP CONSTRAINT IF EXISTS event_scanner_devices_checkpoint_fk;
ALTER TABLE public.event_scanner_devices ADD CONSTRAINT event_scanner_devices_checkpoint_fk
  FOREIGN KEY (tenant_id, event_id, checkpoint_id)
  REFERENCES public.event_checkpoints (tenant_id, event_id, id)
  ON DELETE SET NULL (checkpoint_id);

ALTER TABLE public.event_scanner_devices DROP CONSTRAINT IF EXISTS event_scanner_devices_sponsor_fk;
ALTER TABLE public.event_scanner_devices ADD CONSTRAINT event_scanner_devices_sponsor_fk
  FOREIGN KEY (tenant_id, event_id, sponsor_id)
  REFERENCES public.event_sponsors (tenant_id, event_id, id)
  ON DELETE SET NULL (sponsor_id);

ALTER TABLE public.event_lead_scans DROP CONSTRAINT IF EXISTS event_lead_scans_checkpoint_fk;
ALTER TABLE public.event_lead_scans ADD CONSTRAINT event_lead_scans_checkpoint_fk
  FOREIGN KEY (tenant_id, event_id, checkpoint_id)
  REFERENCES public.event_checkpoints (tenant_id, event_id, id)
  ON DELETE SET NULL (checkpoint_id);

ALTER TABLE public.event_checkpoints DROP CONSTRAINT IF EXISTS event_checkpoints_room_fk;
ALTER TABLE public.event_checkpoints ADD CONSTRAINT event_checkpoints_room_fk
  FOREIGN KEY (tenant_id, event_id, room_id)
  REFERENCES public.event_rooms (tenant_id, event_id, id)
  ON DELETE SET NULL (room_id);

-- NO ACTION, nie SET NULL: punkt sesyjny bez sesji i stanowisko firmy bez
-- sponsora lamia CHECK-i *_required, wiec SET NULL nie mial jak zadzialac.
-- Kontrola NO ACTION jest odroczona do konca instrukcji - kaskada usuniecia
-- WYDARZENIA zabiera punkty razem z sesjami i sponsorami.
ALTER TABLE public.event_checkpoints DROP CONSTRAINT IF EXISTS event_checkpoints_session_fk;
ALTER TABLE public.event_checkpoints ADD CONSTRAINT event_checkpoints_session_fk
  FOREIGN KEY (tenant_id, event_id, session_id)
  REFERENCES public.event_sessions (tenant_id, event_id, id);

ALTER TABLE public.event_checkpoints DROP CONSTRAINT IF EXISTS event_checkpoints_sponsor_fk;
ALTER TABLE public.event_checkpoints ADD CONSTRAINT event_checkpoints_sponsor_fk
  FOREIGN KEY (tenant_id, event_id, sponsor_id)
  REFERENCES public.event_sponsors (tenant_id, event_id, id);

ALTER TABLE public.event_tracks DROP CONSTRAINT IF EXISTS event_tracks_default_room_fk;
ALTER TABLE public.event_tracks ADD CONSTRAINT event_tracks_default_room_fk
  FOREIGN KEY (tenant_id, event_id, default_room_id)
  REFERENCES public.event_rooms (tenant_id, event_id, id)
  ON DELETE SET NULL (default_room_id);

ALTER TABLE public.event_people DROP CONSTRAINT IF EXISTS event_people_company_tenant_fkey;
ALTER TABLE public.event_people ADD CONSTRAINT event_people_company_tenant_fkey
  FOREIGN KEY (tenant_id, company_id)
  REFERENCES public.crm_companies (tenant_id, id)
  ON DELETE SET NULL (company_id);

ALTER TABLE public.event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_group_fkey;
ALTER TABLE public.event_ticket_types ADD CONSTRAINT event_ticket_types_group_fkey
  FOREIGN KEY (tenant_id, event_id, group_id)
  REFERENCES public.event_groups (tenant_id, event_id, id)
  ON DELETE SET NULL (group_id);

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_group_fkey;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_group_fkey
  FOREIGN KEY (tenant_id, event_id, group_id)
  REFERENCES public.event_groups (tenant_id, event_id, id)
  ON DELETE SET NULL (group_id);

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_ticket_fkey;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_ticket_fkey
  FOREIGN KEY (tenant_id, event_id, ticket_type_id)
  REFERENCES public.event_ticket_types (tenant_id, event_id, id)
  ON DELETE SET NULL (ticket_type_id);

ALTER TABLE public.event_term_acceptances DROP CONSTRAINT IF EXISTS event_term_acceptances_registration_fkey;
ALTER TABLE public.event_term_acceptances ADD CONSTRAINT event_term_acceptances_registration_fkey
  FOREIGN KEY (tenant_id, registration_id)
  REFERENCES public.event_registrations (tenant_id, id)
  ON DELETE SET NULL (registration_id);

ALTER TABLE public.event_meetings DROP CONSTRAINT IF EXISTS event_meetings_sponsor_fk;
ALTER TABLE public.event_meetings ADD CONSTRAINT event_meetings_sponsor_fk
  FOREIGN KEY (tenant_id, event_id, sponsor_id)
  REFERENCES public.event_sponsors (tenant_id, event_id, id)
  ON DELETE SET NULL (sponsor_id);

ALTER TABLE public.event_audience_grants DROP CONSTRAINT IF EXISTS event_audience_grants_company_fkey;
ALTER TABLE public.event_audience_grants ADD CONSTRAINT event_audience_grants_company_fkey
  FOREIGN KEY (tenant_id, company_id)
  REFERENCES public.crm_companies (tenant_id, id)
  ON DELETE SET NULL (company_id);

ALTER TABLE public.event_package_orders DROP CONSTRAINT IF EXISTS event_package_orders_company_fkey;
ALTER TABLE public.event_package_orders ADD CONSTRAINT event_package_orders_company_fkey
  FOREIGN KEY (tenant_id, company_id)
  REFERENCES public.crm_companies (tenant_id, id)
  ON DELETE SET NULL (company_id);

ALTER TABLE public.event_package_orders DROP CONSTRAINT IF EXISTS event_package_orders_person_fkey;
ALTER TABLE public.event_package_orders ADD CONSTRAINT event_package_orders_person_fkey
  FOREIGN KEY (tenant_id, buyer_person_id)
  REFERENCES public.event_people (tenant_id, id)
  ON DELETE SET NULL (buyer_person_id);

ALTER TABLE public.event_package_seats DROP CONSTRAINT IF EXISTS event_package_seats_registration_fkey;
ALTER TABLE public.event_package_seats ADD CONSTRAINT event_package_seats_registration_fkey
  FOREIGN KEY (tenant_id, event_id, registration_id)
  REFERENCES public.event_registrations (tenant_id, event_id, id)
  ON DELETE SET NULL (registration_id);

-- Miejsce z pakietu traci przypisanie razem z zapisem (np. usuniecie osoby na
-- zadanie RODO). CHECK `event_package_seats_assigned_stamp` wiaze
-- registration_id ze stemplem przypisania, a lista kolumn SET NULL moze
-- obejmowac tylko kolumny klucza - stempel czysci wiec trigger. Miejsce
-- wraca do puli kupujacego (licznik przelicza `tg_event_package_seats_count`).
CREATE OR REPLACE FUNCTION public._tg_event_package_seats_unlinked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.assigned_at := NULL;
  NEW.assigned_by := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_package_seats_unlinked() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_package_seats_unlinked() IS
  'Miejsce z pakietu, ktore stracilo zapis (ON DELETE SET NULL (registration_id)), traci stempel przypisania - inaczej CHECK assigned_stamp odbijalby usuniecie zapisu.';

DROP TRIGGER IF EXISTS event_package_seats_unlinked ON public.event_package_seats;
CREATE TRIGGER event_package_seats_unlinked
  BEFORE UPDATE OF registration_id ON public.event_package_seats
  FOR EACH ROW
  WHEN (OLD.registration_id IS NOT NULL AND NEW.registration_id IS NULL)
  EXECUTE FUNCTION public._tg_event_package_seats_unlinked();

-- Poswiadczenie bez sponsora jest dopuszczalne WYLACZNIE po uniewaznieniu:
-- zakres `lead` zostaje jako historia ("to bylo urzadzenie stoiska"), a
-- uniewaznienia nie da sie cofnac (admin_event_scanner_device_set_active).
ALTER TABLE public.event_scanner_devices DROP CONSTRAINT IF EXISTS event_scanner_devices_lead_needs_sponsor;
ALTER TABLE public.event_scanner_devices ADD CONSTRAINT event_scanner_devices_lead_needs_sponsor
  CHECK (NOT ('lead' = ANY (scopes)) OR sponsor_id IS NOT NULL OR revoked_at IS NOT NULL);

-- Urzadzenie, ktore traci sponsora albo przypiety punkt (SET NULL z klucza
-- obcego), jest uniewazniane: leady nie maja juz wlasciciela, a poswiadczenie
-- przypiete do punktu nie moze po cichu zaczac obslugiwac WSZYSTKICH punktow.
CREATE OR REPLACE FUNCTION public._tg_event_scanner_devices_orphaned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.revoked_at IS NULL THEN
    NEW.revoked_at := now();
  END IF;
  NEW.is_active := false;
  NEW.offline_roster := false;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_scanner_devices_orphaned() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_scanner_devices_orphaned() IS
  'Poswiadczenie urzadzenia, ktore stracilo sponsora albo przypiety punkt (ON DELETE SET NULL), zostaje uniewaznione - nie poszerza sie po cichu na cale wydarzenie.';

DROP TRIGGER IF EXISTS event_scanner_devices_orphaned ON public.event_scanner_devices;
CREATE TRIGGER event_scanner_devices_orphaned
  BEFORE UPDATE OF sponsor_id, checkpoint_id ON public.event_scanner_devices
  FOR EACH ROW
  WHEN ((OLD.sponsor_id IS NOT NULL AND NEW.sponsor_id IS NULL)
     OR (OLD.checkpoint_id IS NOT NULL AND NEW.checkpoint_id IS NULL))
  EXECUTE FUNCTION public._tg_event_scanner_devices_orphaned();

-- ----------------------------------------------------------------------------
-- 2) OPS-08: POLITYKA PONOWNEGO WEJSCIA I NOWY WYNIK ODPRAWY
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_checkpoints
  ADD COLUMN IF NOT EXISTS reentry_policy text NOT NULL DEFAULT 'allow';

ALTER TABLE public.event_checkpoints DROP CONSTRAINT IF EXISTS event_checkpoints_reentry_policy_values;
ALTER TABLE public.event_checkpoints ADD CONSTRAINT event_checkpoints_reentry_policy_values
  CHECK (reentry_policy IN ('allow', 'deny'));

-- Ta sama decyzja co `event_checkpoints_capacity_needs_control`: tryb `track`
-- niczego nie blokuje, wiec odmowa ponownego wejscia bylaby regula udawana.
ALTER TABLE public.event_checkpoints DROP CONSTRAINT IF EXISTS event_checkpoints_reentry_needs_control;
ALTER TABLE public.event_checkpoints ADD CONSTRAINT event_checkpoints_reentry_needs_control
  CHECK (reentry_policy = 'allow' OR access_mode = 'control');

COMMENT ON COLUMN public.event_checkpoints.reentry_policy IS
  'allow | deny. Przy deny (tylko tryb control) wejscie osoby, ktorej ostatni skan zgody w TYM punkcie byl wejsciem, konczy sie wynikiem denied_already_inside. Powtorzone pikniecie w oknie idempotencji to nadal to samo wejscie (repeat).';

ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_result_values;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_result_values
  CHECK (result IN (
    'granted', 'denied_not_registered', 'denied_registration_status', 'denied_direction',
    'denied_capacity', 'denied_checkpoint_inactive', 'denied_already_inside'
  ));

ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_offline_outcome_values;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_offline_outcome_values
  CHECK (offline_outcome IN (
    'granted', 'denied_direction', 'denied_registration_status', 'unknown_code', 'repeat',
    'denied_already_inside'
  ));

ALTER TABLE public.event_checkins DROP CONSTRAINT IF EXISTS event_checkins_offline_server_result_values;
ALTER TABLE public.event_checkins ADD CONSTRAINT event_checkins_offline_server_result_values
  CHECK (offline_server_result IN (
    'granted', 'denied_not_registered', 'denied_registration_status', 'denied_direction',
    'denied_capacity', 'denied_checkpoint_inactive', 'denied_already_inside'
  ));

COMMENT ON COLUMN public.event_checkins.result IS
  'granted | denied_not_registered | denied_registration_status | denied_direction | denied_capacity | denied_checkpoint_inactive | denied_already_inside. Odmowa MA wiersz - bez niego nie da sie odpowiedziec, dlaczego kogos nie wpuszczono.';

-- ----------------------------------------------------------------------------
-- 3) OPS-04: WLASNE POSWIADCZENIE IDENTYFIKATORA I REJESTR ZASTAPIONYCH KODOW
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS badge_token_hash text,
  ADD COLUMN IF NOT EXISTS badge_issued_at timestamptz;

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_badge_token_shape;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_badge_token_shape
  CHECK (badge_token_hash IS NULL OR badge_token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE public.event_registrations DROP CONSTRAINT IF EXISTS event_registrations_badge_issued;
ALTER TABLE public.event_registrations ADD CONSTRAINT event_registrations_badge_issued
  CHECK (badge_token_hash IS NULL OR badge_issued_at IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_badge_token_uniq
  ON public.event_registrations (tenant_id, badge_token_hash)
  WHERE badge_token_hash IS NOT NULL;

COMMENT ON COLUMN public.event_registrations.badge_token_hash IS
  'SHA-256 kodu z WYDRUKOWANEGO identyfikatora. Osobne poswiadczenie: druk i przedruk rotuja tylko je, wiec bilet z e-maila i portfela (qr_token_hash) zostaje wazny. Czyszczone razem z biletem.';
COMMENT ON COLUMN public.event_registrations.badge_issued_at IS
  'Chwila wydania biezacego kodu identyfikatora.';

CREATE TABLE IF NOT EXISTS public.event_superseded_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  registration_id uuid NOT NULL,
  code_hash text NOT NULL,
  credential text NOT NULL,
  reason text NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_superseded_codes_credential_values CHECK (credential IN ('ticket', 'badge')),
  CONSTRAINT event_superseded_codes_reason_values CHECK (reason IN ('reissued', 'revoked', 'invalidated')),
  CONSTRAINT event_superseded_codes_hash_shape CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT event_superseded_codes_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT event_superseded_codes_code_key UNIQUE (tenant_id, code_hash),
  CONSTRAINT event_superseded_codes_event_fk FOREIGN KEY (tenant_id, event_id)
    REFERENCES public.events (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT event_superseded_codes_registration_fk
    FOREIGN KEY (tenant_id, event_id, registration_id)
    REFERENCES public.event_registrations (tenant_id, event_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS event_superseded_codes_registration_idx
  ON public.event_superseded_codes (tenant_id, registration_id, superseded_at DESC);

COMMENT ON TABLE public.event_superseded_codes IS
  'Skroty kodow wejsciowych, ktore przestaly byc wazne (bilet albo identyfikator). Skan takiego kodu to code_superseded - odmowa z imieniem osoby, poza oknem blokady urzadzenia - a nie nieznany kod. Zapis wylacznie triggerem na event_registrations.';
COMMENT ON COLUMN public.event_superseded_codes.reason IS
  'reissued (zastapiony nowym kodem), revoked (wyczyszczony, np. zwrot albo anulowanie), invalidated (jawne uniewaznienie zgubionego w panelu).';

GRANT SELECT ON public.event_superseded_codes TO authenticated;
GRANT ALL ON public.event_superseded_codes TO service_role;

ALTER TABLE public.event_superseded_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_superseded_codes_staff_read" ON public.event_superseded_codes;
CREATE POLICY "event_superseded_codes_staff_read"
  ON public.event_superseded_codes FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

-- Identyfikator nie wpuszcza dluzej niz bilet: wyczyszczenie kodu biletu
-- (zwrot, anulowanie przyjecia) zdejmuje tez kod identyfikatora. Nazwa `zz`
-- ustawia trigger za pozostalymi BEFORE UPDATE tej tabeli.
CREATE OR REPLACE FUNCTION public._tg_event_registrations_badge_follows_ticket()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.badge_token_hash := NULL;
  NEW.badge_issued_at := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_registrations_badge_follows_ticket() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_registrations_badge_follows_ticket() IS
  'Wyczyszczenie kodu biletu zdejmuje tez kod identyfikatora - identyfikator nie wpuszcza dluzej niz bilet.';

DROP TRIGGER IF EXISTS event_registrations_zz_badge_follows_ticket ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_badge_follows_ticket
  BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.qr_token_hash IS NOT NULL AND NEW.qr_token_hash IS NULL
        AND NEW.badge_token_hash IS NOT NULL)
  EXECUTE FUNCTION public._tg_event_registrations_badge_follows_ticket();

-- Kazda zmiana skrotu (z dowolnej sciezki: wydanie biletu, zwrot, druk,
-- uniewaznienie) zostawia stary skrot w rejestrze zastapionych kodow.
CREATE OR REPLACE FUNCTION public._tg_event_registrations_supersede_codes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.qr_token_hash IS NOT NULL
     AND OLD.qr_token_hash IS DISTINCT FROM NEW.qr_token_hash THEN
    INSERT INTO public.event_superseded_codes (
      tenant_id, event_id, registration_id, code_hash, credential, reason, superseded_at
    ) VALUES (
      NEW.tenant_id, NEW.event_id, NEW.id, OLD.qr_token_hash, 'ticket',
      CASE WHEN NEW.qr_token_hash IS NULL THEN 'revoked' ELSE 'reissued' END, now()
    )
    ON CONFLICT (tenant_id, code_hash) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        registration_id = EXCLUDED.registration_id,
        credential = EXCLUDED.credential,
        reason = EXCLUDED.reason,
        superseded_at = EXCLUDED.superseded_at;
  END IF;

  IF OLD.badge_token_hash IS NOT NULL
     AND OLD.badge_token_hash IS DISTINCT FROM NEW.badge_token_hash THEN
    INSERT INTO public.event_superseded_codes (
      tenant_id, event_id, registration_id, code_hash, credential, reason, superseded_at
    ) VALUES (
      NEW.tenant_id, NEW.event_id, NEW.id, OLD.badge_token_hash, 'badge',
      CASE WHEN NEW.badge_token_hash IS NULL THEN 'revoked' ELSE 'reissued' END, now()
    )
    ON CONFLICT (tenant_id, code_hash) DO UPDATE
    SET event_id = EXCLUDED.event_id,
        registration_id = EXCLUDED.registration_id,
        credential = EXCLUDED.credential,
        reason = EXCLUDED.reason,
        superseded_at = EXCLUDED.superseded_at;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._tg_event_registrations_supersede_codes() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._tg_event_registrations_supersede_codes() IS
  'Stary skrot biletu albo identyfikatora trafia do event_superseded_codes przy kazdej zmianie (reissued przy nowym kodzie, revoked przy wyczyszczeniu). Jedno miejsce zamiast edycji kazdej funkcji rotujacej kod.';

DROP TRIGGER IF EXISTS event_registrations_zz_supersede_codes ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_supersede_codes
  AFTER UPDATE ON public.event_registrations
  FOR EACH ROW
  WHEN (OLD.qr_token_hash IS DISTINCT FROM NEW.qr_token_hash
        OR OLD.badge_token_hash IS DISTINCT FROM NEW.badge_token_hash)
  EXECUTE FUNCTION public._tg_event_registrations_supersede_codes();

-- ----------------------------------------------------------------------------
-- 4) OPS-12 / OPS-04: SEKRET KOLEJKI I LICZNIKI URZADZENIA
-- ----------------------------------------------------------------------------
ALTER TABLE public.event_scanner_devices
  ADD COLUMN IF NOT EXISTS queue_secret text NOT NULL
    DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  ADD COLUMN IF NOT EXISTS queue_fail_window_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS queue_fail_window_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS superseded_scan_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.event_scanner_devices DROP CONSTRAINT IF EXISTS event_scanner_devices_queue_secret_shape;
ALTER TABLE public.event_scanner_devices ADD CONSTRAINT event_scanner_devices_queue_secret_shape
  CHECK (queue_secret ~ '^[0-9a-f]{64}$');

ALTER TABLE public.event_scanner_devices DROP CONSTRAINT IF EXISTS event_scanner_devices_queue_counters_nonneg;
ALTER TABLE public.event_scanner_devices ADD CONSTRAINT event_scanner_devices_queue_counters_nonneg
  CHECK (queue_fail_window_count >= 0 AND superseded_scan_count >= 0);

-- Liczniki tak jak `fail_window_count` - do odczytu w panelu. SEKRETU NIE:
-- grant kolumnowy go pomija, wiec authenticated nie przeczyta go nawet
-- przez polityke RLS.
GRANT SELECT (queue_fail_window_started_at, queue_fail_window_count, superseded_scan_count)
  ON public.event_scanner_devices TO authenticated;

COMMENT ON COLUMN public.event_scanner_devices.queue_secret IS
  'Losowy sekret HMAC znacznika kolejki (queue_marker). NIGDY nie opuszcza bazy - brak grantu kolumnowego, zadna funkcja go nie zwraca.';
COMMENT ON COLUMN public.event_scanner_devices.queue_fail_window_count IS
  'Nieznane kody ze skanow Z KOLEJKI w oknie 60 minut (czas serwera). Prog 100 blokuje urzadzenie na 30 minut. Osobny od fail_window_count (na zywo: 20 w 10 minut).';
COMMENT ON COLUMN public.event_scanner_devices.superseded_scan_count IS
  'Ile razy urzadzenie zeskanowalo kod zastapiony (code_superseded). Monotoniczny, poza oknem blokady.';

-- Termin poswiadczenia: najpozniej 7 dni po koncu wydarzenia (OPS-12).
-- Istniejace poswiadczenia ponad granice sa przycinane - takze te, ktore
-- przez to juz wygasly (wydarzenie skonczylo sie ponad tydzien temu).
UPDATE public.event_scanner_devices d
   SET expires_at = COALESCE(e.ends_at, e.starts_at + interval '1 day') + interval '7 days'
  FROM public.events e
 WHERE e.tenant_id = d.tenant_id
   AND e.id = d.event_id
   AND d.expires_at > COALESCE(e.ends_at, e.starts_at + interval '1 day') + interval '7 days';

-- ----------------------------------------------------------------------------
-- 5) FUNKCJE POMOCNICZE (wylacznie service_role)
-- ----------------------------------------------------------------------------

-- Kod z bramki -> zapis. Kolejnosc: wazny bilet, wazny identyfikator, kod
-- zastapiony. Najemca jest argumentem z POSWIADCZENIA urzadzenia.
CREATE OR REPLACE FUNCTION public._event_scanner_code_lookup(_tenant uuid, _code text)
RETURNS TABLE (
  registration_id uuid,
  event_id uuid,
  person_id uuid,
  credential text,
  superseded boolean,
  superseded_at timestamptz,
  superseded_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  WITH h AS (
    SELECT encode(digest(btrim(COALESCE(_code, '')), 'sha256'), 'hex') AS hash
  )
  SELECT x.registration_id, x.event_id, x.person_id, x.credential,
         x.superseded, x.superseded_at, x.superseded_reason
  FROM (
    SELECT r.id AS registration_id, r.event_id, r.person_id,
           'ticket'::text AS credential, false AS superseded,
           NULL::timestamptz AS superseded_at, NULL::text AS superseded_reason, 1 AS rank
    FROM public.event_registrations r
    CROSS JOIN h
    WHERE r.tenant_id = _tenant AND r.qr_token_hash = h.hash
    UNION ALL
    SELECT r.id, r.event_id, r.person_id, 'badge'::text, false, NULL::timestamptz, NULL::text, 2
    FROM public.event_registrations r
    CROSS JOIN h
    WHERE r.tenant_id = _tenant AND r.badge_token_hash = h.hash
    UNION ALL
    SELECT s.registration_id, s.event_id, r.person_id, s.credential, true, s.superseded_at, s.reason, 3
    FROM public.event_superseded_codes s
    JOIN public.event_registrations r
      ON r.tenant_id = s.tenant_id AND r.id = s.registration_id
    CROSS JOIN h
    WHERE s.tenant_id = _tenant AND s.code_hash = h.hash
  ) x
  ORDER BY x.rank
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._event_scanner_code_lookup(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_code_lookup(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_code_lookup(uuid, text) IS
  'Kod uczestnika -> zapis: wazny bilet (credential ticket), wazny identyfikator (badge) albo kod zastapiony (superseded = true, z chwila i powodem). Brak wiersza = kod naprawde nieznany.';

-- Odpowiedz `code_superseded`. Podnosi licznik zastapionych kodow - NIE okno
-- blokady. Imie i nazwisko tylko tam, gdzie wolajacy na to pozwala (bramka
-- w terminie poswiadczenia; plaszczyzna leadu nigdy - tam tozsamosc wymaga
-- zgody partnerskiej).
CREATE OR REPLACE FUNCTION public._event_scanner_superseded_reply(
  _tenant uuid,
  _device_id uuid,
  _person_id uuid,
  _credential text,
  _reason text,
  _superseded_at timestamptz,
  _with_person boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_person public.event_people;
BEGIN
  UPDATE public.event_scanner_devices
  SET superseded_scan_count = superseded_scan_count + 1
  WHERE tenant_id = _tenant AND id = _device_id;

  IF _with_person THEN
    SELECT p.* INTO v_person
    FROM public.event_people p
    WHERE p.tenant_id = _tenant AND p.id = _person_id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'code_superseded',
    'admit', false,
    'result', NULL,
    'device_locked', false,
    'superseded', jsonb_build_object(
      'credential', _credential,
      'reason', _reason,
      'superseded_at', _superseded_at
    ),
    'display_name', CASE
      WHEN v_person.id IS NULL THEN NULL
      ELSE NULLIF(btrim(concat_ws(' ', v_person.first_name, v_person.last_name)), '')
    END,
    'person', CASE
      WHEN v_person.id IS NULL THEN NULL
      ELSE jsonb_build_object('first_name', v_person.first_name, 'last_name', v_person.last_name)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_superseded_reply(uuid, uuid, uuid, text, text, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_superseded_reply(uuid, uuid, uuid, text, text, timestamptz, boolean)
  TO service_role;

COMMENT ON FUNCTION public._event_scanner_superseded_reply(uuid, uuid, uuid, text, text, timestamptz, boolean) IS
  'Odpowiedz code_superseded dla plaszczyzny urzadzenia: odmowa, poswiadczenie (ticket|badge), powod i chwila zastapienia, opcjonalnie imie i nazwisko. Podnosi superseded_scan_count, nie okno blokady.';

-- Znacznik kolejki: base64url( int8 big-endian issued_at [s] || HMAC-SHA256 ).
-- Tresc HMAC: device_id || ':' || issued_at (sekundy epoki, dziesietnie).
CREATE OR REPLACE FUNCTION public._event_scanner_queue_marker(
  _device_id uuid,
  _secret text,
  _issued_at timestamptz
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT translate(
    rtrim(
      encode(
        int8send(floor(extract(epoch FROM _issued_at))::bigint)
        || hmac(
          _device_id::text || ':' || floor(extract(epoch FROM _issued_at))::bigint::text,
          _secret,
          'sha256'
        ),
        'base64'
      ),
      '='
    ),
    E'+/\n',
    '-_'
  )
$$;

REVOKE ALL ON FUNCTION public._event_scanner_queue_marker(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_queue_marker(uuid, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public._event_scanner_queue_marker(uuid, text, timestamptz) IS
  'Znacznik kolejki urzadzenia: base64url(int8 issued_at || HMAC-SHA256(queue_secret, device_id:issued_at)). Klient przechowuje go jako nieprzezroczysty napis i dolacza do skanow z kolejki.';

-- Pola odpowiedzi ze swiezym znacznikiem: `queue_marker` i
-- `queue_marker_valid_until` (= LEAST(termin, issued_at + 24 h) - do tej
-- chwili skan z kolejki moze sie na ten znacznik powolac). Poswiadczenie po
-- terminie nie dostaje nowego znacznika: pusty obiekt.
CREATE OR REPLACE FUNCTION public._event_scanner_queue_marker_reply(
  _device_id uuid,
  _secret text,
  _expires_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN _expires_at IS NULL OR _expires_at <= now() THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'queue_marker', public._event_scanner_queue_marker(_device_id, _secret, now()),
      'queue_marker_valid_until', LEAST(
        _expires_at,
        to_timestamp(floor(extract(epoch FROM now()))) + interval '24 hours'
      )
    )
  END
$$;

REVOKE ALL ON FUNCTION public._event_scanner_queue_marker_reply(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_queue_marker_reply(uuid, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public._event_scanner_queue_marker_reply(uuid, text, timestamptz) IS
  'Pola odpowiedzi plaszczyzny urzadzenia ze swiezym znacznikiem kolejki: queue_marker i queue_marker_valid_until. Poswiadczenie po terminie dostaje pusty obiekt.';

-- Weryfikacja znacznika: issued_at albo NULL (zly ksztalt, zly podpis, obce
-- urzadzenie). Porownanie podpisu w SQL nie jest stalocasowe - przez siec
-- i planer zapytan nie da sie z tego zbudowac wyroczni czasowej.
CREATE OR REPLACE FUNCTION public._event_scanner_queue_marker_at(
  _device_id uuid,
  _secret text,
  _marker text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_clean text := btrim(COALESCE(_marker, ''));
  v_raw bytea;
  v_epoch bigint;
BEGIN
  IF _device_id IS NULL OR _secret IS NULL OR v_clean !~ '^[A-Za-z0-9_-]{54}$' THEN
    RETURN NULL;
  END IF;

  v_raw := decode(translate(v_clean, '-_', '+/') || '==', 'base64');
  IF length(v_raw) <> 40 THEN
    RETURN NULL;
  END IF;

  v_epoch := ('x' || encode(substring(v_raw FROM 1 FOR 8), 'hex'))::bit(64)::bigint;
  IF substring(v_raw FROM 9 FOR 32) IS DISTINCT FROM
     hmac(_device_id::text || ':' || v_epoch::text, _secret, 'sha256') THEN
    RETURN NULL;
  END IF;

  RETURN to_timestamp(v_epoch);
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._event_scanner_queue_marker_at(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_queue_marker_at(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public._event_scanner_queue_marker_at(uuid, text, text) IS
  'Weryfikuje znacznik kolejki urzadzenia i oddaje jego issued_at; NULL dla znacznika zlego ksztaltu, z obcym podpisem albo z innego urzadzenia.';

-- Granica terminu poswiadczenia: koniec wydarzenia (albo start + 1 dzien,
-- jak `_event_ticket_codes_pending`) + 7 dni.
CREATE OR REPLACE FUNCTION public._event_scanner_expiry_limit(_tenant uuid, _event_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(e.ends_at, e.starts_at + interval '1 day') + interval '7 days'
  FROM public.events e
  WHERE e.tenant_id = _tenant AND e.id = _event_id
$$;

REVOKE ALL ON FUNCTION public._event_scanner_expiry_limit(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_scanner_expiry_limit(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_scanner_expiry_limit(uuid, uuid) IS
  'Najpozniejszy dopuszczalny termin poswiadczenia urzadzenia: koniec wydarzenia (albo start + 1 dzien) + 7 dni.';

-- Osoba "jest w srodku" punktu w chwili _at: ostatni skan zgody przed _at byl
-- wejsciem ALBO (skan z kolejki zsynchronizowany po fakcie) pierwszy skan
-- zgody po _at jest wejsciem bez wyjscia pomiedzy - dwa wejscia jednego kodu.
-- Wejscie, ktorego okno idempotencji zachodzi na okno tego skanu, to TO SAMO
-- wejscie (podwojne pikniecie, takze z dwoch urzadzen) i jest pomijane.
-- Zwraca chwile tamtego wejscia albo NULL.
CREATE OR REPLACE FUNCTION public._event_checkin_inside_since(
  _tenant uuid,
  _checkpoint_id uuid,
  _person_id uuid,
  _at timestamptz,
  _window interval,
  _exclude_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH g AS (
    SELECT c.id, c.direction, c.occurred_at
    FROM public.event_checkins c
    WHERE c.tenant_id = _tenant
      AND c.checkpoint_id = _checkpoint_id
      AND c.person_id = _person_id
      AND c.result = 'granted'
      AND (_exclude_id IS NULL OR c.id <> _exclude_id)
      AND NOT (
        c.direction = 'in'
        AND c.dedupe_range && tstzrange(_at, _at + _window, '[)')
      )
  ),
  before_at AS (
    SELECT g.direction, g.occurred_at
    FROM g
    WHERE g.occurred_at <= _at
    ORDER BY g.occurred_at DESC, g.id DESC
    LIMIT 1
  ),
  after_at AS (
    SELECT g.direction, g.occurred_at
    FROM g
    WHERE g.occurred_at > _at
    ORDER BY g.occurred_at, g.id
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT b.occurred_at FROM before_at b WHERE b.direction = 'in'),
    (SELECT a.occurred_at FROM after_at a WHERE a.direction = 'in')
  )
$$;

REVOKE ALL ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid) IS
  'Czy osoba jest w srodku punktu w chwili _at (ostatni skan zgody przed _at = wejscie, albo dla skanu zsynchronizowanego po fakcie: pierwszy skan zgody po _at = wejscie). Wejscie w oknie idempotencji skanu to to samo wejscie. Zwraca chwile tamtego wejscia albo NULL.';
