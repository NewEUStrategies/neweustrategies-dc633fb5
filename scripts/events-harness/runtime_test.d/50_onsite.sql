-- ============================================================================
-- 50_onsite - OBSLUGA NA MIEJSCU: POSWIADCZENIE URZADZENIA, IDEMPOTENCJA
--             SKANU I IZOLACJA LEADOW SPONSORA
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260823180000_event_onsite.sql byla dotad odtwarzana przez harness
-- BEZ ANI JEDNEJ ASERCJI ZACHOWANIA: replay konczyl sie na "schemat sie
-- zbudowal". Tymczasem podmodul odprawy trzyma dwie rzeczy, ktorych zaden
-- przeglad tekstu nie potwierdzi:
--   (1) POSWIADCZENIE URZADZENIA jest jedyna granica plaszczyzny skanera.
--       Najemca, wydarzenie i sponsor sa WYNIKIEM odszukania po haszu tokenu,
--       a nie argumentem wywolania. Token uniewazniony, wygasly, zapauzowany
--       albo bez zakresu MUSI odbic sie od `_event_scanner_device_auth`;
--   (2) IZOLACJA LEADOW to dane osobowe. Sponsor widzi WYLACZNIE swoje leady,
--       a tozsamosc uczestnika oddaje mu sie tylko przy ZYWEJ zgodzie
--       (nadanie bez wycofania). Wycofanie zgody dziala WSTECZ na juz zebrany
--       lead - i to jest asercja, nie obietnica interfejsu.
-- Do tego dochodzi IDEMPOTENCJA: podwojne pikniecie i powtorna wysylka kolejki
-- offline nie moga wyprodukowac drugiego wiersza dziennika.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza plaszczyzny panelu (listy, statystyki, wydruki identyfikatorow)
--     poza tym, co dotyka poswiadczen - panel ma wlasna bramke `assert_editor_tenant`
--     testowana w 80_admin_only;
--   * nie sprawdza progu blokady automatycznej pod pelnym obciazeniem (20 pomylek
--     w 10 minut) - sprawdza, ze POJEDYNCZA pomylka podnosi licznik, bo dopiero
--     licznik jest nosnikiem progu;
--   * nie sprawdza warstwy widoku (`useScanner.ts`, `scannerOutbox.ts`) - to bramka
--     testow jednostkowych i E2E;
--   * nie sprawdza spotkan (60_) ani zapisow (20_).
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 50 na miejscu: poswiadczenie urzadzenia, idempotencja, leady =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: KOLUMNY ATRAPY KARTOTEKI FIRM
--
-- `event_lead_scans_list` czyta `crm_companies.name` przez LEFT JOIN, a atrapa
-- z harness.sql ma komplet potrzebnych tu pol. Dokladamy tylko to, czego
-- brakuje przy starszej atrapie - w transakcji, ktora sie wycofuje.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_companies
  ADD COLUMN IF NOT EXISTS website  text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS city     text,
  ADD COLUMN IF NOT EXISTS country  text;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
--
-- Jedno wydarzenie, jeden punkt odprawy z oknem idempotencji 60 sekund, dwoch
-- sponsorow (wlasciciel leada i JEGO SASIAD - bez sasiada nie ma czego NIE
-- widziec) i czterech uczestnikow: ze zgoda, bez zgody, z wycofana zgoda oraz
-- jeden do asercji o powtornym skanie.
--
-- Tokeny urzadzen sa STALE i czytelne. W bazie siedzi wylacznie hasz - dokladnie
-- tak, jak zapisuje je `admin_event_scanner_device_issue`.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('50a11111-0000-0000-0000-000000000001', 'onsite.admin@example.org'),
  ('50a11111-0000-0000-0000-000000000002', 'onsite.gosc@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('50a11111-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('50a11111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('50a11111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow)
VALUES
  ('50e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'onsite-a', 'Kongres na miejscu', 'Onsite congress',
   now() + interval '2 days', 'published', 'rsvp', 'instant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode,
   access_mode, dedupe_window_seconds)
VALUES
  ('50c00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', 'Brama glowna', 'Main gate',
   'event_entry', 'in_out', 'control', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('50f00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Sponsor Alfa'),
  ('50f00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Sponsor Beta')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('50500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50f00000-0000-0000-0000-0000000000a1', 'Alfa'),
  ('50500000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50f00000-0000-0000-0000-0000000000a2', 'Beta')
ON CONFLICT (id) DO NOTHING;

-- Uczestnicy. `consent_partner_sharing_at` = zgoda na przekazanie danych
-- partnerowi; `consent_withdrawn_at` = jej wycofanie (uniewaznia nadanie
-- niezaleznie od kolejnosci dat).
INSERT INTO public.event_people
  (id, tenant_id, first_name, last_name, email, phone, job_title, company_text,
   consent_partner_sharing_at, source)
VALUES
  ('50700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Zofia', 'Zgoda', 'zofia.zgoda@example.org', '+48111111111', 'CTO', 'Alfa Sp. z o.o.',
   now() - interval '1 day', 'organizer'),
  ('50700000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'Bartosz', 'Bezzgody', 'bartosz.bez@example.org', '+48222222222', 'CFO', 'Beta S.A.',
   NULL, 'organizer'),
  ('50700000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'Wanda', 'Wycofana', 'wanda.wyc@example.org', '+48333333333', 'CEO', 'Gamma',
   now() - interval '2 days', 'organizer'),
  ('50700000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   'Piotr', 'Powtorny', 'piotr.pow@example.org', NULL, NULL, NULL, NULL, 'organizer')
ON CONFLICT (id) DO NOTHING;

-- Zapisy z tokenem wejsciowym. Hasz liczony tak samo jak w `_event_new_qr_token`.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode,
   qr_token_hash, qr_issued_at)
VALUES
  ('50300000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50700000-0000-0000-0000-0000000000a1',
   'approved', 'rsvp', encode(extensions.digest('qr-zofia-000000000001', 'sha256'), 'hex'), now()),
  ('50300000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50700000-0000-0000-0000-0000000000a2',
   'approved', 'rsvp', encode(extensions.digest('qr-bartosz-00000000001', 'sha256'), 'hex'), now()),
  ('50300000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50700000-0000-0000-0000-0000000000a3',
   'approved', 'rsvp', encode(extensions.digest('qr-wanda-000000000001', 'sha256'), 'hex'), now()),
  ('50300000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50700000-0000-0000-0000-0000000000a4',
   'approved', 'rsvp', encode(extensions.digest('qr-piotr-000000000001', 'sha256'), 'hex'), now())
ON CONFLICT (id) DO NOTHING;

-- Poswiadczenia urzadzen: sprawne, uniewaznione, wygasle, zapauzowane oraz dwa
-- stoiskowe (kazde z INNYM sponsorem).
INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, checkpoint_id, sponsor_id, label,
   token_hash, token_prefix, scopes, is_active, expires_at, revoked_at)
VALUES
  ('50d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', '50c00000-0000-0000-0000-0000000000a1', NULL,
   'Brama - telefon 1',
   encode(extensions.digest('tok-checkin-sprawny-01', 'sha256'), 'hex'),
   left('tok-checkin-sprawny-01', 8), ARRAY['checkin']::text[], true,
   now() + interval '2 days', NULL),
  ('50d00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Brama - uniewazniony',
   encode(extensions.digest('tok-checkin-cofniety-1', 'sha256'), 'hex'),
   left('tok-checkin-cofniety-1', 8), ARRAY['checkin']::text[], false,
   now() + interval '2 days', now() - interval '1 hour'),
  ('50d00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Brama - wygasly',
   encode(extensions.digest('tok-checkin-wygasly-01', 'sha256'), 'hex'),
   left('tok-checkin-wygasly-01', 8), ARRAY['checkin']::text[], true,
   now() - interval '1 minute', NULL),
  ('50d00000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', NULL, NULL, 'Brama - zapauzowany',
   encode(extensions.digest('tok-checkin-pauza-001', 'sha256'), 'hex'),
   left('tok-checkin-pauza-001', 8), ARRAY['checkin']::text[], false,
   now() + interval '2 days', NULL),
  ('50d00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', NULL, '50500000-0000-0000-0000-0000000000a1',
   'Stoisko Alfa',
   encode(extensions.digest('tok-lead-alfa-0000001', 'sha256'), 'hex'),
   left('tok-lead-alfa-0000001', 8), ARRAY['lead']::text[], true,
   now() + interval '2 days', NULL),
  ('50d00000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111',
   '50e00000-0000-0000-0000-0000000000a1', NULL, '50500000-0000-0000-0000-0000000000a2',
   'Stoisko Beta',
   encode(extensions.digest('tok-lead-beta-0000001', 'sha256'), 'hex'),
   left('tok-lead-beta-0000001', 8), ARRAY['lead']::text[], true,
   now() + interval '2 days', NULL)
ON CONFLICT (id) DO NOTHING;

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_scanner_devices
    WHERE event_id = '50e00000-0000-0000-0000-0000000000a1') = 6,
  '50/scenografia: szesc poswiadczen urzadzen, kazde z tokenem TYLKO w postaci hasza');

-- Token jawny NIE MOZE nigdzie siedziec. Kolumna trzyma hasz szesnastkowy.
SELECT pg_temp.assert(
  (SELECT bool_and(token_hash ~ '^[0-9a-f]{64}$')
     FROM public.event_scanner_devices
    WHERE event_id = '50e00000-0000-0000-0000-0000000000a1'),
  '50/poswiadczenie: w bazie jest wylacznie hasz tokenu, nigdy tresc jawna');

-- ---------------------------------------------------------------------------
-- SEKCJA 2: BRAMKA POSWIADCZENIA
--
-- Kazdy stan uniewazniajacy poswiadczenie ma WLASNY komunikat, bo operator na
-- bramce musi wiedziec, czy oddac telefon do koordynatora (uniewazniony), czy
-- odczekac (zablokowany). Asercje sprawdzaja KLUCZ BLEDU, nie sam fakt odmowy.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'krotki', 'code', 'qr-zofia-000000000001'))
$q$, 'invalid_device_token',
  '50/bramka: token o zlym ksztalcie odrzucony ZANIM dotknie bazy');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-nieznany-000000001', 'code', 'qr-zofia-000000000001'))
$q$, 'invalid_device_token',
  '50/bramka: token nieznany odrzucony (najemca NIE jest argumentem wywolania)');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-cofniety-1', 'code', 'qr-zofia-000000000001'))
$q$, 'device_revoked',
  '50/bramka: poswiadczenie UNIEWAZNIONE nie skanuje');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-wygasly-01', 'code', 'qr-zofia-000000000001'))
$q$, 'device_expired',
  '50/bramka: poswiadczenie po terminie nie skanuje');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-pauza-001', 'code', 'qr-zofia-000000000001'))
$q$, 'device_inactive',
  '50/bramka: poswiadczenie zapauzowane nie skanuje');

-- ZAKRES. Telefon bramkowy nie zbiera leadow, a stoisko nie odprawia.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok-checkin-sprawny-01', 'code', 'qr-zofia-000000000001'))
$q$, 'device_scope_missing',
  '50/zakres: poswiadczenie bramkowe NIE MA prawa zapisac leada');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001', 'code', 'qr-zofia-000000000001'))
$q$, 'device_scope_missing',
  '50/zakres: poswiadczenie stoiskowe NIE MA prawa odprawic uczestnika');

-- URZADZENIE PRZYPIETE DO PUNKTU nie moze skanowac pod innym punktem.
DO $$
DECLARE v_other uuid;
BEGIN
  INSERT INTO public.event_checkpoints
    (tenant_id, event_id, name_pl, name_en, kind, direction_mode, access_mode)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '50e00000-0000-0000-0000-0000000000a1', 'Katering', 'Catering',
          'catering', 'in_only', 'track')
  RETURNING id INTO v_other;

  PERFORM pg_temp.assert_raises_like(format($q$
    SELECT public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok-checkin-sprawny-01',
      'code', 'qr-zofia-000000000001',
      'checkpoint_id', %L))
  $q$, v_other), 'device_checkpoint_mismatch',
    '50/bramka: urzadzenie przypiete do punktu nie skanuje pod innym punktem');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: IDEMPOTENCJA SKANU
--
-- Trzy niezalezne mechanizmy: klucz skanera (`client_scan_uid`), okno czasowe
-- punktu (`dedupe_range`) i - jako bramka wyscigu - ograniczenie EXCLUDE.
-- Pierwsze dwa sprawdzamy przez RPC, trzecie golym INSERT-em, bo RPC do niego
-- nie dopusci (i o to chodzi).
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-sprawny-01',
    'code', 'qr-piotr-000000000001',
    'client_scan_uid', 'scan-piotr-0001'));

  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean,
    '50/odprawa: pierwszy skan zapisu zatwierdzonego jest ZGODA');

  -- POWTORNA WYSYLKA KOLEJKI OFFLINE: ten sam klucz skanera.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-sprawny-01',
    'code', 'qr-piotr-000000000001',
    'client_scan_uid', 'scan-piotr-0001'));
  PERFORM pg_temp.assert(v->>'outcome' = 'replay',
    '50/idempotencja: ten sam client_scan_uid daje POWTORZENIE, nie nowy wiersz');

  -- PODWOJNE PIKNIECIE: inny klucz, to samo okno punktu.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-sprawny-01',
    'code', 'qr-piotr-000000000001',
    'client_scan_uid', 'scan-piotr-0002'));
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat',
    '50/idempotencja: drugi skan w oknie punktu podnosi licznik powtorzen');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_checkins
      WHERE event_id = '50e00000-0000-0000-0000-0000000000a1'
        AND person_id = '50700000-0000-0000-0000-0000000000a4') = 1,
    '50/idempotencja: trzy wyslania dalu DOKLADNIE JEDEN wiersz dziennika');

  PERFORM pg_temp.assert(
    (SELECT repeat_count FROM public.event_checkins
      WHERE person_id = '50700000-0000-0000-0000-0000000000a4') >= 1,
    '50/idempotencja: licznik powtorzen wiersza urosl zamiast zalozyc nowy wiersz');
END $$;

-- OGRANICZENIE EXCLUDE jako ostatnia bramka wyscigu: dwie ZGODY tej samej
-- osoby, w tym samym punkcie i kierunku, w nakladajacych sie oknach.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, registration_id,
     direction, result, source, scanned_at, dedupe_range, device_id)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '50e00000-0000-0000-0000-0000000000a1',
          '50c00000-0000-0000-0000-0000000000a1',
          '50700000-0000-0000-0000-0000000000a4',
          '50300000-0000-0000-0000-0000000000a4',
          'in', 'granted', 'qr_code', now(), 'empty'::tstzrange,
          '50d00000-0000-0000-0000-0000000000a1')
$q$, 'event_checkins_no_double_in',
  '50/ODMOWA: druga ZGODA w oknie idempotencji odbija sie od ograniczenia EXCLUDE');

-- KIERUNEK PRZECIWNY nie koliduje - ograniczenia sa czesciowe po kierunku.
DO $$
BEGIN
  INSERT INTO public.event_checkins
    (tenant_id, event_id, checkpoint_id, person_id, registration_id,
     direction, result, source, scanned_at, dedupe_range, device_id)
  VALUES ('11111111-1111-1111-1111-111111111111',
          '50e00000-0000-0000-0000-0000000000a1',
          '50c00000-0000-0000-0000-0000000000a1',
          '50700000-0000-0000-0000-0000000000a4',
          '50300000-0000-0000-0000-0000000000a4',
          'out', 'granted', 'qr_code', now(), 'empty'::tstzrange,
          '50d00000-0000-0000-0000-0000000000a1');

  PERFORM pg_temp.assert(true,
    '50/idempotencja: wyjscie w tym samym oknie co wejscie JEST dozwolone');
END $$;

-- KOD NIEZNANY nie zaklada wiersza, ale podnosi licznik pomylek urzadzenia -
-- to jedyny sygnal proby zgadywania tokenow.
DO $$
DECLARE v jsonb; v_before integer; v_after integer;
BEGIN
  SELECT failed_scan_count INTO v_before FROM public.event_scanner_devices
   WHERE id = '50d00000-0000-0000-0000-0000000000a1';

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok-checkin-sprawny-01', 'code', 'kod-ktorego-nie-ma'));
  PERFORM pg_temp.assert(v->>'outcome' = 'unknown_code' AND NOT (v->>'admit')::boolean,
    '50/odprawa: kod nieznany nie wpuszcza i nie zaklada wiersza dziennika');

  SELECT failed_scan_count INTO v_after FROM public.event_scanner_devices
   WHERE id = '50d00000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.assert(v_after = v_before + 1,
    '50/bezpieczenstwo: nieudane rozpoznanie podnosi licznik pomylek urzadzenia');
END $$;

-- URZADZENIE ZABLOKOWANE (okno kroczace przekroczone) nie skanuje.
DO $$
BEGIN
  UPDATE public.event_scanner_devices
     SET locked_until = now() + interval '10 minutes'
   WHERE id = '50d00000-0000-0000-0000-0000000000a1';

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok-checkin-sprawny-01', 'code', 'qr-zofia-000000000001'))
  $q$, 'device_locked',
    '50/bezpieczenstwo: urzadzenie zablokowane po serii pomylek nie skanuje');

  UPDATE public.event_scanner_devices SET locked_until = NULL
   WHERE id = '50d00000-0000-0000-0000-0000000000a1';
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4: LEADY SPONSORA - WLASCICIEL Z POSWIADCZENIA, DANE ZA ZGODA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  -- ZE ZGODA: sponsor dostaje tozsamosc.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001',
    'code', 'qr-zofia-000000000001',
    'interest_rating', 5,
    'note', 'Rozmowa o wdrozeniu'));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND (v->>'consent')::boolean,
    '50/leady: skan uczestnika ZE ZGODA jest zapisany i oznaczony jako zgodny');
  PERFORM pg_temp.assert(v->'person'->>'email' = 'zofia.zgoda@example.org',
    '50/leady: przy zywej zgodzie sponsor dostaje dane kontaktowe');

  -- BEZ ZGODY: skan policzony, tozsamosc NIE oddana.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001',
    'code', 'qr-bartosz-00000000001'));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND NOT (v->>'consent')::boolean,
    '50/leady: skan BEZ zgody jest policzony - sponsor ma prawo zmierzyc ruch');
  PERFORM pg_temp.assert(v->'person' = 'null'::jsonb,
    '50/PRYWATNOSC: bez zgody funkcja NIE ODDAJE tozsamosci uczestnika');

  -- WLASCICIEL LEADA POCHODZI Z POSWIADCZENIA. Podanie cudzego sponsora
  -- w payloadzie nie ma zadnego skutku - takiego pola nie ma w kontrakcie.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001',
    'code', 'qr-wanda-000000000001',
    'sponsor_id', '50500000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(
    (SELECT sponsor_id FROM public.event_lead_scans WHERE id = (v->>'lead_id')::uuid)
      = '50500000-0000-0000-0000-0000000000a1',
    '50/PRYWATNOSC: sponsor_id z payloadu jest ignorowany - wlasciciel to poswiadczenie');

  -- POWTORNY SKAN tej samej osoby podnosi licznik, nie tworzy drugiego leada.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001',
    'code', 'qr-zofia-000000000001'));
  PERFORM pg_temp.assert((v->>'scan_count')::integer = 2,
    '50/leady: powtorny skan podnosi licznik zamiast zakladac drugi lead');
  PERFORM pg_temp.assert(
    (SELECT note FROM public.event_lead_scans WHERE id = (v->>'lead_id')::uuid)
      = 'Rozmowa o wdrozeniu',
    '50/leady: pusta notatka powtornego skanu NIE wyciera notatki pierwszej rozmowy');
END $$;

-- WYCOFANIE ZGODY DZIALA WSTECZ: lead zostaje policzony, dane znikaja.
DO $$
DECLARE v jsonb; v_row jsonb;
BEGIN
  UPDATE public.event_people SET consent_withdrawn_at = now()
   WHERE id = '50700000-0000-0000-0000-0000000000a3';

  v := public.event_lead_scans_list(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001'));

  SELECT x INTO v_row FROM jsonb_array_elements(v->'rows') AS t(x)
   WHERE (x->>'lead_id')::uuid = (
     SELECT id FROM public.event_lead_scans
      WHERE sponsor_id = '50500000-0000-0000-0000-0000000000a1'
        AND person_id = '50700000-0000-0000-0000-0000000000a3');

  PERFORM pg_temp.assert(v_row IS NOT NULL,
    '50/PRYWATNOSC: lead po wycofaniu zgody NADAL jest wierszem na liscie');
  PERFORM pg_temp.assert(NOT (v_row->>'consent')::boolean AND v_row->>'email' IS NULL
                         AND v_row->>'first_name' IS NULL,
    '50/PRYWATNOSC: wycofanie zgody DZIALA WSTECZ - dane osobowe znikaja z listy');
  PERFORM pg_temp.assert((v->>'total_count')::integer = 3
                         AND (v->>'with_consent_count')::integer = 1,
    '50/leady: licznik rozdziela leady zgodne od policzonych bez zgody');
END $$;

-- IZOLACJA SPONSOROW. Sasiad ze stoiska obok nie widzi CUDZYCH leadow, ale
-- widzi SWOJ - bez kontrapunktu asercja nie odroznia izolacji od blokady.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_lead_scans_list(jsonb_build_object(
    'device_token', 'tok-lead-beta-0000001'));
  PERFORM pg_temp.assert((v->>'total_count')::integer = 0,
    '50/IZOLACJA: sponsor Beta nie widzi ANI JEDNEGO leada sponsora Alfa');

  PERFORM public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok-lead-beta-0000001',
    'code', 'qr-zofia-000000000001'));

  v := public.event_lead_scans_list(jsonb_build_object(
    'device_token', 'tok-lead-beta-0000001'));
  PERFORM pg_temp.assert((v->>'total_count')::integer = 1,
    '50/KONTRAPUNKT: sponsor Beta widzi WLASNY lead tej samej osoby');

  v := public.event_lead_scans_list(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001'));
  PERFORM pg_temp.assert((v->>'total_count')::integer = 3,
    '50/IZOLACJA: lista sponsora Alfa nie urosla o lead zebrany przez Bete');
END $$;

-- Lista leadow tez ma bramke poswiadczenia - w wersji tylko do odczytu.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scans_list(jsonb_build_object(
    'device_token', 'tok-checkin-sprawny-01'))
$q$, 'invalid_device_token',
  '50/IZOLACJA: poswiadczenie bez zakresu leadow nie czyta listy leadow');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scans_list(jsonb_build_object(
    'device_token', 'tok-lead-alfa-0000001XX-nieznany'))
$q$, 'invalid_device_token',
  '50/IZOLACJA: nieznany token nie czyta listy leadow');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: RLS TABELI LEADOW
--
-- Tabela leadow jest czytana bezposrednio przez panel. Uczestnik zalogowany
-- NIE JEST redakcja i nie ma tu czego szukac; anonim tym bardziej.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('50a11111-0000-0000-0000-000000000002',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_lead_scans) = 0,
  '50/RLS: zalogowany uczestnik NIE widzi ani jednego leada sponsora');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
-- Anonim nie ma nawet GRANT-u SELECT na tej tabeli: odmowa zapada o poziom
-- nizej niz polityka RLS, i to jest mocniejsza gwarancja niz pusty wynik.
SELECT pg_temp.assert_raises_like(
  $q$ SELECT count(*) FROM public.event_lead_scans $q$,
  'permission denied',
  '50/RLS: anonim nie ma nawet prawa odczytu tabeli leadow');
RESET ROLE;


SELECT pg_temp.act_as('50a11111-0000-0000-0000-000000000001',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_lead_scans) = 4,
  '50/KONTRAPUNKT RLS: administrator najemcy widzi komplet leadow wydarzenia');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);

-- ---------------------------------------------------------------------------
-- SEKCJA 6: STRUKTURA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.event_checkins'::regclass
      AND conname IN ('event_checkins_no_double_in', 'event_checkins_no_double_out')
      AND contype = 'x') = 2,
  '50/struktura: oba ograniczenia EXCLUDE dziennika odpraw istnieja w bazie');

-- Indeksy skalowane po najemcy maja `tenant_id` na PIERWSZEJ pozycji - inaczej
-- zapytanie panelu czyta caly indeks i skalowanie jest pozorne. JEDNYM
-- WYJATKIEM jest `event_scanner_devices_token_uniq`: odszukanie poswiadczenia
-- po haszu tokenu MUSI byc globalne, bo najemca jest dopiero WYNIKIEM tego
-- odszukania (gdyby byl argumentem, plaszczyzna urzadzenia mialaby naglowek
-- do podrobienia). Wyjatek jest tu WYMIENIONY Z NAZWY, zeby dolozenie drugiego
-- indeksu bez najemcy zapalilo sie na czerwono.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'public'
      AND c.relname IN ('event_checkpoints', 'event_scanner_devices',
                        'event_checkins', 'event_lead_scans')
      AND NOT i.indisprimary
      AND ic.relname <> 'event_scanner_devices_token_uniq'
      AND a.attname <> 'tenant_id') = 0,
  '50/struktura: kazdy indeks wtorny podmodulu (poza globalnym wyszukaniem tokenu) ma tenant_id na pierwszej pozycji');

SELECT pg_temp.assert(
  (SELECT i.indisunique AND a.attname = 'token_hash'
     FROM pg_index i
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE ic.relname = 'event_scanner_devices_token_uniq'),
  '50/struktura: hasz tokenu jest UNIKALNY globalnie - najemca jest wynikiem odszukania, nie argumentem');


ROLLBACK;

\echo '== 50 na miejscu: koniec =='
