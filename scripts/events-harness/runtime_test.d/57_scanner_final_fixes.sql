-- ============================================================================
-- 57_scanner_final_fixes - SKANER: POPRAWKI PO KONCOWYM PRZEGLADZIE (F4, F5, B2)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261013112000 .. 20261013112200 zamykaja trzy potwierdzone
-- ustalenia koncowego przegladu. Kazde ma tu swoj dowod - asercja oznaczona
-- GOTOWE byla czerwona przed migracja (sprawdzone na 0061c24):
--   F4  wyjatek R4 ("kod wazny w chwili skanu") wymaga POTWIERDZONEGO czasu
--       skanu: podrobiony stary czas bez znacznika kolejki (oba plaszczyzny),
--       znacznik podrobiony, cudzy albo spoza okna, czas sprzed wydania kodu,
--       sprzed wydania poswiadczenia, sprzed startu wydarzenia - 1 dzien albo
--       starszy niz 7 dni -> code_superseded bez wiersza, bez obecnosci i bez
--       danych osoby; prawdziwy skan bez sieci ze znacznikiem sprzed
--       zastapienia -> przyjety (kontrapunkt). Lead z kolejki starszy niz
--       7 dni -> device_time_out_of_range;
--   F5  wejscie -> wyjscie (kolejka, dociera pozniej) -> ponowne wejscie
--       w oknie powtorzen -> wejscie -100 s: w OBU kolejnosciach
--       synchronizacji denied_already_inside z ta sama chwila poprzedniego
--       wejscia; obecnosc i podglad licza osobe w srodku; lustro dla
--       wyjscia (wyjscie zlane w "repeat" przed spoznionym wejsciem nie
--       daje falszywej odmowy); panel: brak falszywego double_entry i ten sam
--       double_entry w obu kolejnosciach;
--   B2  usuniecie klubu dyskusji, na ktorego grupe wskazuje wydarzenie,
--       przechodzi (dotad 23514); grupa bez klubu nadal odrzucana.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * klienta skanera (stempel znacznika w chwili kolejkowania) - tor X1/B1;
--   * wierszy sprzed migracji (bez issued_at / last_repeat_device_at) - pusta
--     baza replayu.
--
-- CZAS. now() jest w transakcji stale. Wydarzenie skanow dostaje strefe
-- o stalym przesunieciu, w ktorej TERAZ jest okolo poludnia - skany z ostatnich
-- minut leza zawsze w tym samym dniu czasu wydarzenia (jak w 56).
--
-- SPRZATANIE. Caly plik pracuje w JEDNEJ transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 57 poprawki skanera po koncowym przegladzie: F4, F5, B2 =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 0: SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('57a00000-0000-0000-0000-0000000000a1', 'x2.admin@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('57a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('57a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 57', 'x2-admin-57')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE x2_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
INSERT INTO x2_ctx VALUES ('tz', (
  SELECT CASE WHEN s.o >= 0 THEN 'Etc/GMT-' || s.o ELSE 'Etc/GMT+' || (-s.o) END
  FROM (SELECT 12 - extract(hour FROM now() AT TIME ZONE 'UTC')::integer AS o) s));

-- E1: kongres trwa od wczoraj; E2: targi trwaja od 20 dni (granica 7 dni).
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
   registration_mode, registration_flow, timezone)
VALUES
  ('57e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'x2-57-kongres', 'Kongres 57', 'Congress 57', now() - interval '1 day', now() + interval '1 day',
   'published', 'rsvp', 'instant', (SELECT v FROM x2_ctx WHERE k = 'tz')),
  ('57e00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'x2-57-targi', 'Targi 57', 'Fair 57', now() - interval '20 days', now() + interval '1 day',
   'published', 'rsvp', 'instant', (SELECT v FROM x2_ctx WHERE k = 'tz'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('57f00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Wystawca 57')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('57500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', '57f00000-0000-0000-0000-0000000000a1', 'Wystawca 57'),
  ('57500000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a2', '57f00000-0000-0000-0000-0000000000a1', 'Wystawca 57 targi')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_checkpoints
  (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode, access_mode,
   reentry_policy, dedupe_window_seconds)
VALUES
  ('57c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', 'Brama F5', 'Gate F5',
   'event_entry', 'in_out', 'control', 'deny', 60),
  ('57c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', 'Wejscie ogolne', 'General entry',
   'event_entry', 'in_only', 'control', 'allow', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email, phone, source) VALUES
  ('57700000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lena', 'Wyciek', 'f4-lena@example.org', '+48111000001', 'organizer'),
  ('57700000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Gustaw', 'Zgubiony', 'f4-gustaw@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Wiktoria', 'Offline', 'f4-wiktoria@example.org', '+48111000003', 'organizer'),
  ('57700000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Ida', 'Swiezykod', 'f4-ida@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Hubert', 'Noweurzadzenie', 'f4-hubert@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Ewa', 'Przedstartem', 'f4-ewa@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Sylwia', 'Tydzien', 'f4-sylwia@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Adam', 'Pokolei', 'f5-adam@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'Bogna', 'Spozniona', 'f5-bogna@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'Cezary', 'Lustro', 'f5-cezary@example.org', NULL, 'organizer'),
  ('57700000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Dorota', 'Lustrzana', 'f5-dorota@example.org', NULL, 'organizer')
ON CONFLICT (id) DO NOTHING;

-- Bilety: kod 'qr57-osoba-NN-000001', wydany o podanej chwili. Zgoda
-- partnerska NA E1 tam, gdzie lead ma oddac tozsamosc.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, qr_token_hash, qr_issued_at,
   consent_partner_sharing_at)
SELECT ('57300000-0000-0000-0000-0000000000' || x.n)::uuid, '11111111-1111-1111-1111-111111111111',
       x.ev::uuid, ('57700000-0000-0000-0000-0000000000' || x.n)::uuid,
       'approved', 'rsvp', encode(extensions.digest('qr57-osoba-' || x.n || '-000001', 'sha256'), 'hex'),
       now() - x.issued, x.consent
FROM (VALUES
  ('01', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  now() - interval '3 days'),
  ('02', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  NULL::timestamptz),
  ('03', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  now() - interval '3 days'),
  ('04', '57e00000-0000-0000-0000-0000000000a1', interval '2 hours', NULL::timestamptz),
  ('05', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  NULL::timestamptz),
  ('06', '57e00000-0000-0000-0000-0000000000a1', interval '10 days', NULL::timestamptz),
  ('07', '57e00000-0000-0000-0000-0000000000a2', interval '20 days', NULL::timestamptz),
  ('0a', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  NULL::timestamptz),
  ('0b', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  NULL::timestamptz),
  ('0c', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  NULL::timestamptz),
  ('0d', '57e00000-0000-0000-0000-0000000000a1', interval '3 days',  NULL::timestamptz)
) AS x(n, ev, issued, consent)
ON CONFLICT (id) DO NOTHING;

-- Poswiadczenia wydane w przeszlosci (created_at jawnie - granica F4).
INSERT INTO public.event_scanner_devices
  (id, tenant_id, event_id, sponsor_id, label, token_hash, token_prefix,
   scopes, is_active, expires_at, offline_roster, created_at)
VALUES
  ('57d00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', '57500000-0000-0000-0000-0000000000a1', 'Stoisko 57',
   encode(extensions.digest('tok57-stoisko-000001', 'sha256'), 'hex'), 'tok57-s1',
   ARRAY['lead']::text[], true, now() + interval '2 days', false, now() - interval '2 days'),
  ('57d00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', NULL, 'Bramka A',
   encode(extensions.digest('tok57-bramka-a-00001', 'sha256'), 'hex'), 'tok57-ba',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false, now() - interval '2 days'),
  ('57d00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', NULL, 'Bramka B',
   encode(extensions.digest('tok57-bramka-b-00001', 'sha256'), 'hex'), 'tok57-bb',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false, now() - interval '2 days'),
  ('57d00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', NULL, 'Wyjscie bez sieci',
   encode(extensions.digest('tok57-wyjscie-000001', 'sha256'), 'hex'), 'tok57-wy',
   ARRAY['checkin']::text[], true, now() + interval '2 days', false, now() - interval '2 days'),
  ('57d00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', '57500000-0000-0000-0000-0000000000a1', 'Stoisko - nowe poswiadczenie',
   encode(extensions.digest('tok57-stoisko-swieze', 'sha256'), 'hex'), 'tok57-sn',
   ARRAY['lead']::text[], true, now() + interval '2 days', false, now() - interval '6 hours'),
  ('57d00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a2', '57500000-0000-0000-0000-0000000000a2', 'Stoisko targi',
   encode(extensions.digest('tok57-stoisko-targi1', 'sha256'), 'hex'), 'tok57-st',
   ARRAY['lead']::text[], true, now() + interval '2 days', false, now() - interval '20 days'),
  ('57d00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '57e00000-0000-0000-0000-0000000000a1', '57500000-0000-0000-0000-0000000000a1', 'Stoisko - dawne poswiadczenie',
   encode(extensions.digest('tok57-stoisko-dawne1', 'sha256'), 'hex'), 'tok57-sd',
   ARRAY['lead']::text[], true, now() + interval '2 days', false, now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

-- Znacznik kolejki urzadzenia wydany o chwili _at (to samo, co oddaje baza
-- w odpowiedzi; klient stempluje nim pozycje w chwili kolejkowania).
CREATE OR REPLACE FUNCTION pg_temp.x2_marker(_device uuid, _at timestamptz) RETURNS text
LANGUAGE sql AS $$
  SELECT public._event_scanner_queue_marker(d.id, d.queue_secret, _at)
  FROM public.event_scanner_devices d WHERE d.id = _device
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 1 (F4): ZASTAPIENIE KODOW TERAZ; REJESTR PAMIETA CHWILE WYDANIA
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Przedruk biletow (np. organizator wyslal nowe) - stare kody zastapione TERAZ.
  UPDATE public.event_registrations r
     SET qr_token_hash = encode(extensions.digest(
           'qr57-osoba-' || right(r.id::text, 2) || '-000002', 'sha256'), 'hex'),
         qr_issued_at = now()
   WHERE r.id IN ('57300000-0000-0000-0000-000000000001', '57300000-0000-0000-0000-000000000003',
                  '57300000-0000-0000-0000-000000000004', '57300000-0000-0000-0000-000000000005',
                  '57300000-0000-0000-0000-000000000006', '57300000-0000-0000-0000-000000000007');

  -- Gustaw zgubil bilet - jawne uniewaznienie w panelu.
  PERFORM pg_temp.act_as('57a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_registration_code_invalidate(jsonb_build_object(
    'registration_id', '57300000-0000-0000-0000-000000000002', 'credential', 'ticket'));
  PERFORM pg_temp.act_as(NULL, NULL);

  PERFORM pg_temp.assert(
    (SELECT issued_at = now() - interval '3 days' AND reason = 'reissued' AND superseded_at = now()
       FROM public.event_superseded_codes
      WHERE code_hash = encode(extensions.digest('qr57-osoba-01-000001', 'sha256'), 'hex'))
    AND (SELECT issued_at = now() - interval '3 days' AND reason = 'invalidated'
           FROM public.event_superseded_codes
          WHERE code_hash = encode(extensions.digest('qr57-osoba-02-000001', 'sha256'), 'hex'))
    AND (SELECT issued_at = now() - interval '2 hours'
           FROM public.event_superseded_codes
          WHERE code_hash = encode(extensions.digest('qr57-osoba-04-000001', 'sha256'), 'hex')),
    '57/F4: rejestr kodow zastapionych pamieta chwile wydania STAREGO kodu (issued_at), takze przy jawnym uniewaznieniu');

  PERFORM pg_temp.assert(
    (SELECT superseded AND issued_at = now() - interval '3 days' AND superseded_reason = 'reissued'
       FROM public._event_scanner_code_lookup('11111111-1111-1111-1111-111111111111', 'qr57-osoba-01-000001'))
    AND (SELECT NOT superseded AND issued_at = now()
           FROM public._event_scanner_code_lookup('11111111-1111-1111-1111-111111111111', 'qr57-osoba-01-000002')),
    '57/F4: wyszukiwanie kodu oddaje chwile wydania kodu (zastapionego i waznego)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2 (F4): STOISKO - PODROBIONY CZAS NIE WSKRZESZA KODU
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  -- Scenariusz z ustalenia: zywe urzadzenie stoiska, queued:true, czas z 2020.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', '2020-01-01T00:00:00Z', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND v->'person' = 'null'::jsonb
      AND NOT (v ? 'lead_id'),
    '57/F4 GOTOWE: stoisko - podrobiony czas z 2020 bez znacznika -> code_superseded, bez leada i bez danych osoby');

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', now() - interval '6 days', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND v->'person' = 'null'::jsonb,
    '57/F4 GOTOWE: stoisko - podrobiony czas sprzed 6 dni bez znacznika -> code_superseded');

  -- Ponizej czas skanu miesci sie w KAZDEJ pozostalej granicy (po wydaniu
  -- kodu, poswiadczenia i po starcie wydarzenia) - rozstrzyga sam znacznik.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND v->'person' = 'null'::jsonb,
    '57/F4 GOTOWE: stoisko - wiarygodny czas tuz przed zastapieniem, ale BEZ znacznika -> code_superseded');

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true,
    'queue_marker', repeat('A', 54)));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - znacznik PODROBIONY (zly podpis) nie potwierdza czasu');

  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000002', now() - interval '20 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - wazny znacznik INNEGO urzadzenia nie potwierdza czasu');

  -- Swiezy znacznik (z odpowiedzi PO zastapieniu) nie zaswiadcza czasu sprzed niego.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000001', now())));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - czas skanu wczesniej niz wydanie znacznika - 15 min -> code_superseded');

  -- Znacznik starszy niz 24 h nie zaswiadcza czasu (horyzont znacznika).
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-01-000001',
    'device_scanned_at', now() - interval '1 hour', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000001', now() - interval '30 hours')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - czas skanu pozniej niz wydanie znacznika + 24 h -> code_superseded');

  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_lead_scans
                 WHERE person_id = '57700000-0000-0000-0000-000000000001')
    AND (SELECT superseded_scan_count = 7 FROM public.event_scanner_devices
          WHERE id = '57d00000-0000-0000-0000-000000000001'),
    '57/F4 GOTOWE: zaden podrobiony skan nie zapisal leada; kazdy policzony jako kod zastapiony');

  -- KONTRAPUNKT: prawdziwy skan bez sieci 30 minut temu, znacznik z ostatniej
  -- odpowiedzi przed utrata sieci (40 minut temu), kod przedrukowany TERAZ.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-03-000001',
    'device_scanned_at', now() - interval '30 minutes', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000001', now() - interval '40 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved' AND (v->>'consent')::boolean
      AND v->'person'->>'email' = 'f4-wiktoria@example.org'
      AND EXISTS (SELECT 1 FROM public.event_lead_scans
                   WHERE person_id = '57700000-0000-0000-0000-000000000003'
                     AND sponsor_id = '57500000-0000-0000-0000-0000000000a1'),
    '57/F4 GOTOWE: prawdziwy lead z kolejki ze znacznikiem sprzed zastapienia kodu - zapisany (R4 dziala dalej)');

  -- Granica: wydanie KODU. Bilet Idy wydano 2 h temu.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-04-000001',
    'device_scanned_at', now() - interval '3 hours', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000001', now() - interval '3 hours 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - czas skanu sprzed WYDANIA kodu -> code_superseded (mimo waznego znacznika)');
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-000001', 'code', 'qr57-osoba-04-000001',
    'device_scanned_at', now() - interval '1 hour', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000001', now() - interval '65 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved',
    '57/F4: stoisko - ten sam kod zeskanowany po wydaniu i przed zastapieniem -> lead (kontrapunkt)');

  -- Granica: wydanie POSWIADCZENIA. Urzadzenie wydano 6 h temu.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-swieze', 'code', 'qr57-osoba-05-000001',
    'device_scanned_at', now() - interval '8 hours', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000005', now() - interval '8 hours 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - czas skanu sprzed wydania POSWIADCZENIA urzadzenia -> code_superseded');
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-swieze', 'code', 'qr57-osoba-05-000001',
    'device_scanned_at', now() - interval '5 hours', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000005', now() - interval '5 hours 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved',
    '57/F4: stoisko - skan po wydaniu poswiadczenia -> lead (kontrapunkt)');

  -- Granica: START WYDARZENIA - 1 dzien. Kongres trwa od wczoraj.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-dawne1', 'code', 'qr57-osoba-06-000001',
    'device_scanned_at', now() - interval '3 days', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000007', now() - interval '3 days 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: stoisko - czas skanu wiecej niz dzien przed STARTEM wydarzenia -> code_superseded');
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-dawne1', 'code', 'qr57-osoba-06-000001',
    'device_scanned_at', now() - interval '30 hours', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000007', now() - interval '30 hours 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved',
    '57/F4: stoisko - skan w dniu przed startem (recepcja otwarta wczesniej) -> lead (kontrapunkt)');

  -- Granica: 7 DNI. Targi trwaja od 20 dni, wszystko inne sie zgadza.
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-targi1', 'code', 'qr57-osoba-07-000001',
    'device_scanned_at', now() - interval '8 days', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000006', now() - interval '8 days 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded'
      AND NOT EXISTS (SELECT 1 FROM public.event_lead_scans
                       WHERE person_id = '57700000-0000-0000-0000-000000000007'),
    '57/F4: stoisko - kod zastapiony, czas skanu starszy niz 7 dni -> code_superseded (granica 7 dni w wyjatku R4)');
END $$;

-- Lead z kolejki starszy niz 7 dni - wazny kod, wazny znacznik: odmowa jak przy odprawie.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-targi1', 'code', 'qr57-osoba-07-000002',
    'device_scanned_at', now() - interval '8 days', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000006', now() - interval '8 days 5 minutes')))
$q$, 'device_time_out_of_range',
  '57/F4 GOTOWE: lead z kolejki z czasem starszym niz 7 dni -> device_time_out_of_range (granica jak w odprawie)');

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);
  v := public.event_lead_scan_record(jsonb_build_object(
    'device_token', 'tok57-stoisko-targi1', 'code', 'qr57-osoba-07-000002',
    'device_scanned_at', now() - interval '6 days', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000006', now() - interval '6 days 5 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'saved',
    '57/F4: lead z kolejki sprzed 6 dni (wazny kod) - zapisany (kontrapunkt granicy 7 dni)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3 (F4): BRAMKA - PODROBIONY CZAS NIE WPUSZCZA I NIE STEMPLUJE OBECNOSCI
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-02-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan57-f4-gustaw-01',
    'device_scanned_at', now() - interval '6 days', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded' AND NOT (v->>'admit')::boolean
      AND v->'superseded'->>'reason' = 'invalidated'
      AND NOT EXISTS (SELECT 1 FROM public.event_checkins
                       WHERE person_id = '57700000-0000-0000-0000-000000000002')
      AND (SELECT status = 'approved' AND attended_at IS NULL FROM public.event_registrations
            WHERE id = '57300000-0000-0000-0000-000000000002'),
    '57/F4 GOTOWE: bramka - uniewazniony bilet z podrobionym czasem sprzed 6 dni bez znacznika -> code_superseded, bez wiersza i bez obecnosci');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-02-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan57-f4-gustaw-02',
    'device_scanned_at', '2020-01-01T00:00:00Z', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: bramka - podrobiony czas z 2020 bez znacznika -> code_superseded');

  -- Czas wiarygodny wobec kazdej innej granicy - rozstrzyga sam znacznik.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-02-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan57-f4-gustaw-03',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded'
      AND NOT EXISTS (SELECT 1 FROM public.event_checkins
                       WHERE person_id = '57700000-0000-0000-0000-000000000002'),
    '57/F4 GOTOWE: bramka - czas tuz przed uniewaznieniem, ale BEZ znacznika -> code_superseded, bez wiersza');

  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-02-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan57-f4-gustaw-04',
    'device_scanned_at', now() - interval '2 hours', 'queued', true,
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000002', now())));
  PERFORM pg_temp.assert(v->>'outcome' = 'code_superseded',
    '57/F4: bramka - swiezy znacznik nie zaswiadcza czasu sprzed 2 h (okno znacznika)');

  -- Ladunek udajacy wpuszczenie offline: konflikt do przegladu, nigdy zgoda.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-02-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan57-f4-gustaw-05',
    'device_scanned_at', now() - interval '10 minutes', 'queued', true,
    'offline_admitted', true, 'offline_outcome', 'granted'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_code_superseded'
      AND NOT (v->>'admit')::boolean AND NOT (v->>'server_admit')::boolean
      AND (SELECT result = 'denied_code_superseded' AND offline_admitted
             FROM public.event_checkins WHERE id = (v->>'checkin_id')::uuid)
      AND (SELECT status = 'approved' AND attended_at IS NULL FROM public.event_registrations
            WHERE id = '57300000-0000-0000-0000-000000000002'),
    '57/F4 GOTOWE: bramka - "wpuszczony offline" z niepotwierdzonym czasem -> wiersz denied_code_superseded (konflikt), bez obecnosci');

  -- KONTRAPUNKT: prawdziwe wpuszczenie offline 30 minut temu, kod przedrukowany TERAZ.
  v := public.event_checkin_record(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-03-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c2',
    'client_scan_uid', 'scan57-f4-wiktoria-01',
    'device_scanned_at', now() - interval '30 minutes', 'queued', true,
    'offline_admitted', true, 'offline_outcome', 'granted',
    'queue_marker', pg_temp.x2_marker('57d00000-0000-0000-0000-000000000002', now() - interval '40 minutes')));
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND (SELECT attended_at = now() - interval '30 minutes' FROM public.event_registrations
            WHERE id = '57300000-0000-0000-0000-000000000003'),
    '57/F4 GOTOWE: bramka - prawdziwy skan bez sieci ze znacznikiem sprzed zastapienia -> zgoda i obecnosc z chwili skanu');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4 (F5): WEJSCIE PO SPOZNIONYM WYJSCIU - OBIE KOLEJNOSCI
--
-- Punkt c1: in_out, control, deny, okno 60 s. Adam: skany dochodza w kolejnosci
-- zdarzen. Bogna: wyjscie z urzadzenia bez sieci dociera PO ponownym wejsciu.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.x2_scan(
  _token text, _code text, _dir text, _uid text, _ago integer, _queued boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_checkin_record(
    jsonb_build_object(
      'device_token', _token, 'code', _code,
      'checkpoint_id', '57c00000-0000-0000-0000-0000000000c1', 'direction', _dir,
      'client_scan_uid', _uid, 'device_scanned_at', now() - make_interval(secs => _ago))
    || CASE WHEN _queued
         THEN jsonb_build_object('queued', true, 'offline_admitted', true, 'offline_outcome', 'granted')
         ELSE '{}'::jsonb
       END)
$$;

DO $$
DECLARE v jsonb; v_r1 uuid;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  -- Adam, kolejnosc zdarzen.
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0a-000001', 'in', 'scan57-f5-a1', 200);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '57/F5: Adam - wejscie -200 s');
  v := pg_temp.x2_scan('tok57-wyjscie-000001', 'qr57-osoba-0a-000001', 'out', 'scan57-f5-a2', 190, true);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '57/F5: Adam - wyjscie -190 s (kolejka, dociera od razu)');
  v := pg_temp.x2_scan('tok57-bramka-b-00001', 'qr57-osoba-0a-000001', 'in', 'scan57-f5-a3', 175);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'repeat_count')::integer = 0,
    '57/F5: Adam - ponowne wejscie -175 s to NOWY wiersz (wyjscie pomiedzy)');

  -- Bogna, wyjscie spoznione.
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0b-000001', 'in', 'scan57-f5-b1', 200);
  v_r1 := (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '57/F5: Bogna - wejscie -200 s');
  v := pg_temp.x2_scan('tok57-bramka-b-00001', 'qr57-osoba-0b-000001', 'in', 'scan57-f5-b3', 175);
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND (v->>'checkin_id')::uuid = v_r1
      AND (SELECT repeat_count = 1 AND last_repeat_device_at = now() - interval '175 seconds'
             FROM public.event_checkins WHERE id = v_r1),
    '57/F5: Bogna - ponowne wejscie -175 s, gdy wyjscia jeszcze nie ma, to repeat - wiersz pamieta czas URZADZENIA powtorzenia');
  v := pg_temp.x2_scan('tok57-wyjscie-000001', 'qr57-osoba-0b-000001', 'out', 'scan57-f5-b2', 190, true);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '57/F5: Bogna - wyjscie -190 s dociera PO ponownym wejsciu');

  -- Stan po synchronizacji: obie osoby w srodku, niezaleznie od kolejnosci.
  PERFORM pg_temp.assert(
    public._event_checkpoint_occupancy('11111111-1111-1111-1111-111111111111',
      '57c00000-0000-0000-0000-0000000000c1') = 2,
    '57/F5 GOTOWE: obecnosc w punkcie liczy Bogne w srodku (ostatnie zdarzenie to powtorzone wejscie), tak jak Adama');
  v := public.event_checkin_resolve(jsonb_build_object(
    'device_token', 'tok57-bramka-a-00001', 'code', 'qr57-osoba-0b-000001',
    'checkpoint_id', '57c00000-0000-0000-0000-0000000000c1', 'direction', 'in'));
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside'
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '175 seconds',
    '57/F5: podglad dla Bogny po spoznionym wyjsciu - juz w srodku od -175 s');

  -- GOTOWE, GDY: wejscie -100 s odmowione w OBU kolejnosciach, z ta sama chwila.
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0a-000001', 'in', 'scan57-f5-a4', 100);
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside' AND NOT (v->>'admit')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '175 seconds',
    '57/F5: Adam (kolejnosc zdarzen) - wejscie -100 s -> denied_already_inside, poprzednie wejscie -175 s');
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0b-000001', 'in', 'scan57-f5-b4', 100);
  PERFORM pg_temp.assert(v->>'outcome' = 'denied_already_inside' AND NOT (v->>'admit')::boolean
      AND (v->>'reentry_previous_at')::timestamptz = now() - interval '175 seconds',
    '57/F5 GOTOWE: Bogna (wyjscie spoznione) - wejscie -100 s -> denied_already_inside, poprzednie wejscie -175 s (jak w kolejnosci zdarzen)');

  PERFORM pg_temp.assert(
    public._event_checkpoint_occupancy('11111111-1111-1111-1111-111111111111',
      '57c00000-0000-0000-0000-0000000000c1') = 2
    AND (SELECT count(*) FROM public.event_checkins
          WHERE person_id IN ('57700000-0000-0000-0000-00000000000a', '57700000-0000-0000-0000-00000000000b')
            AND result = 'denied_already_inside') = 2,
    '57/F5: jeden kod nie wpuszcza dwoch osob w zadnej kolejnosci - po jednej odmowie, obecnosc 2');

  PERFORM pg_temp.act_as('57a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.admin_event_checkins_list('57e00000-0000-0000-0000-0000000000a1',
              '57c00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l
                 WHERE l.person_id IN ('57700000-0000-0000-0000-00000000000a',
                                       '57700000-0000-0000-0000-00000000000b')),
    '57/F5: panel - zadna kolejnosc nie daje konfliktu (drugie wejscie odmowione w obu)');
END $$;

-- Lustro: wyjscie zlane w "repeat" przed spoznionym wejsciem. Cezary: kolejnosc
-- zdarzen; Dorota: wejscie -190 s z bramki bez sieci dociera PO wyjsciu -175 s.
DO $$
DECLARE v jsonb; v_out uuid;
BEGIN
  PERFORM pg_temp.act_as(NULL, NULL);

  PERFORM pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0c-000001', 'in', 'scan57-f5-c1', 300);
  PERFORM pg_temp.x2_scan('tok57-bramka-b-00001', 'qr57-osoba-0c-000001', 'out', 'scan57-f5-c2', 200);
  PERFORM pg_temp.x2_scan('tok57-wyjscie-000001', 'qr57-osoba-0c-000001', 'in', 'scan57-f5-c3', 190, true);
  v := pg_temp.x2_scan('tok57-bramka-b-00001', 'qr57-osoba-0c-000001', 'out', 'scan57-f5-c4', 175);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '57/F5 lustro: Cezary - drugie wyjscie -175 s to nowy wiersz');
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0c-000001', 'in', 'scan57-f5-c5', 100);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean,
    '57/F5 lustro: Cezary (kolejnosc zdarzen) - wejscie -100 s wpuszcza (wyszedl o -175 s)');

  PERFORM pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0d-000001', 'in', 'scan57-f5-d1', 300);
  v := pg_temp.x2_scan('tok57-bramka-b-00001', 'qr57-osoba-0d-000001', 'out', 'scan57-f5-d2', 200);
  v_out := (v->>'checkin_id')::uuid;
  v := pg_temp.x2_scan('tok57-bramka-b-00001', 'qr57-osoba-0d-000001', 'out', 'scan57-f5-d4', 175);
  PERFORM pg_temp.assert(v->>'outcome' = 'repeat' AND (v->>'checkin_id')::uuid = v_out
      AND (SELECT last_repeat_device_at = now() - interval '175 seconds'
             FROM public.event_checkins WHERE id = v_out),
    '57/F5 lustro: Dorota - drugie wyjscie -175 s, gdy wejscia -190 s jeszcze nie ma, to repeat z czasem urzadzenia');
  v := pg_temp.x2_scan('tok57-wyjscie-000001', 'qr57-osoba-0d-000001', 'in', 'scan57-f5-d3', 190, true);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted', '57/F5 lustro: Dorota - spoznione wejscie -190 s');
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0d-000001', 'in', 'scan57-f5-d5', 100);
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND (v->>'admit')::boolean
      AND NOT (v->>'reentry')::boolean,
    '57/F5 GOTOWE lustro: Dorota (wejscie spoznione) - wejscie -100 s wpuszcza jak u Cezarego (bez falszywej odmowy)');

  PERFORM pg_temp.act_as('57a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.admin_event_checkins_list('57e00000-0000-0000-0000-0000000000a1',
              '57c00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l
                 WHERE l.person_id IN ('57700000-0000-0000-0000-00000000000c',
                                       '57700000-0000-0000-0000-00000000000d')),
    '57/F5 GOTOWE lustro: panel - brak falszywego double_entry u Doroty (wyjscie -175 s widoczne jako zdarzenie)');
END $$;

-- Panel: drugie wejscie, ktore PRZESZLO (punkt chwilowo na allow), jest
-- double_entry w obu kolejnosciach - oba wiersze pary.
DO $$
DECLARE v jsonb; v_a uuid; v_b uuid;
BEGIN
  UPDATE public.event_checkpoints SET reentry_policy = 'allow'
   WHERE id = '57c00000-0000-0000-0000-0000000000c1';
  PERFORM pg_temp.act_as(NULL, NULL);
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0a-000001', 'in', 'scan57-f5-a5', 50);
  v_a := (v->>'checkin_id')::uuid;
  v := pg_temp.x2_scan('tok57-bramka-a-00001', 'qr57-osoba-0b-000001', 'in', 'scan57-f5-b5', 50);
  v_b := (v->>'checkin_id')::uuid;
  PERFORM pg_temp.assert(v->>'outcome' = 'granted' AND v_a IS NOT NULL AND v_a <> v_b,
    '57/F5: scenografia - przy allow drugie wejscie -50 s przechodzi u obu osob');
  UPDATE public.event_checkpoints SET reentry_policy = 'deny'
   WHERE id = '57c00000-0000-0000-0000-0000000000c1';

  PERFORM pg_temp.act_as('57a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT count(*) FILTER (WHERE l.person_id = '57700000-0000-0000-0000-00000000000a'
                               AND l.conflict_kind = 'double_entry') = 2
        AND count(*) FILTER (WHERE l.person_id = '57700000-0000-0000-0000-00000000000b'
                               AND l.conflict_kind = 'double_entry') = 2
        AND bool_or(l.id = v_a) AND bool_or(l.id = v_b)
       FROM public.admin_event_checkins_list('57e00000-0000-0000-0000-0000000000a1',
              '57c00000-0000-0000-0000-0000000000c1', NULL, NULL, NULL, NULL, NULL, NULL, 200, 0, true) l),
    '57/F5 GOTOWE: panel - double_entry na obu wierszach pary w OBU kolejnosciach (u Bogny para jest wiersz z powtorzonym wejsciem -175 s)');
END $$;

SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_checkins SET last_repeat_device_at = occurred_at - interval '1 second'
   WHERE person_id = '57700000-0000-0000-0000-00000000000b' AND repeat_count > 0
$q$, 'event_checkins_repeat_device_after_scan',
  '57/F5/ODMOWA: CHECK - czas powtorzenia tylko pozniejszy niz wiersz i tylko przy repeat_count > 0');

-- ---------------------------------------------------------------------------
-- SEKCJA 5 (B2): USUNIECIE KLUBU DYSKUSJI PRZY PRZYPIETEJ GRUPIE
-- ---------------------------------------------------------------------------
INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en, visibility, status,
                          attribution_mode, who_can_post)
VALUES
  ('57100000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'klub-57-a', 'Klub 57 A', 'Club 57 A', 'public', 'active', 'attributed', 'members'),
  ('57100000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'klub-57-b', 'Klub 57 B', 'Club 57 B', 'public', 'active', 'attributed', 'members'),
  ('57100000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'klub-57-c', 'Klub 57 C', 'Club 57 C', 'public', 'active', 'attributed', 'members');

INSERT INTO public.club_groups (id, tenant_id, club_id, slug, name_pl, name_en, status, attribution_mode)
VALUES
  ('57200000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '57100000-0000-0000-0000-000000000001', 'grupa-57-a', 'Grupa 57 A', 'Group 57 A', 'active', NULL),
  ('57200000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '57100000-0000-0000-0000-000000000002', 'grupa-57-b', 'Grupa 57 B', 'Group 57 B', 'active', NULL),
  ('57200000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '57100000-0000-0000-0000-000000000002', 'grupa-57-b2', 'Grupa 57 B2', 'Group 57 B2', 'active', NULL);

-- D1: para spojna (klub A, jego grupa); D2: para niespojna (klub C, grupa
-- klubu B - CHECK jej nie zabrania); D3: klub B i jego grupa; D4: klub B i grupa B2.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
   registration_mode, registration_flow, timezone, discussion_club_id, discussion_group_id)
VALUES
  ('57e00000-0000-0000-0000-0000000000d1', '11111111-1111-1111-1111-111111111111',
   'x2-57-dyskusja-1', 'Dyskusja 1', 'Discussion 1', now() + interval '5 days', NULL,
   'draft', 'rsvp', 'instant', 'Europe/Warsaw',
   '57100000-0000-0000-0000-000000000001', '57200000-0000-0000-0000-000000000001'),
  ('57e00000-0000-0000-0000-0000000000d2', '11111111-1111-1111-1111-111111111111',
   'x2-57-dyskusja-2', 'Dyskusja 2', 'Discussion 2', now() + interval '5 days', NULL,
   'draft', 'rsvp', 'instant', 'Europe/Warsaw',
   '57100000-0000-0000-0000-000000000003', '57200000-0000-0000-0000-000000000002'),
  ('57e00000-0000-0000-0000-0000000000d3', '11111111-1111-1111-1111-111111111111',
   'x2-57-dyskusja-3', 'Dyskusja 3', 'Discussion 3', now() + interval '5 days', NULL,
   'draft', 'rsvp', 'instant', 'Europe/Warsaw',
   '57100000-0000-0000-0000-000000000002', '57200000-0000-0000-0000-000000000002'),
  ('57e00000-0000-0000-0000-0000000000d4', '11111111-1111-1111-1111-111111111111',
   'x2-57-dyskusja-4', 'Dyskusja 4', 'Discussion 4', now() + interval '5 days', NULL,
   'draft', 'rsvp', 'instant', 'Europe/Warsaw',
   '57100000-0000-0000-0000-000000000002', '57200000-0000-0000-0000-000000000003');

DO $$
BEGIN
  -- GOTOWE, GDY: usuniecie klubu przechodzi (dotad 23514 na
  -- events_discussion_group_needs_club), a wydarzenie traci tylko dyskusje.
  DELETE FROM public.clubs WHERE id = '57100000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = '57100000-0000-0000-0000-000000000001')
    AND (SELECT discussion_club_id IS NULL AND discussion_group_id IS NULL
           FROM public.events WHERE id = '57e00000-0000-0000-0000-0000000000d1'),
    '57/B2 GOTOWE: usuniecie klubu z przypieta (jego) grupa przechodzi; wydarzenie zostaje bez dyskusji');

  DELETE FROM public.clubs WHERE id = '57100000-0000-0000-0000-000000000003';
  PERFORM pg_temp.assert(
    (SELECT discussion_club_id IS NULL AND discussion_group_id IS NULL
       FROM public.events WHERE id = '57e00000-0000-0000-0000-0000000000d2')
    AND EXISTS (SELECT 1 FROM public.club_groups WHERE id = '57200000-0000-0000-0000-000000000002'),
    '57/B2 GOTOWE: usuniecie klubu przy parze niespojnej (grupa innego klubu) przechodzi; obca grupa zostaje');

  -- Kontrapunkt: usuniecie samej grupy zostawia klub (stan posredni redakcji).
  DELETE FROM public.club_groups WHERE id = '57200000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert(
    (SELECT discussion_club_id = '57100000-0000-0000-0000-000000000002' AND discussion_group_id IS NULL
       FROM public.events WHERE id = '57e00000-0000-0000-0000-0000000000d3'),
    '57/B2: usuniecie samej grupy zeruje tylko grupe - klub zostaje');

  -- Redakcja czyszczaca klub czysci tez grupe.
  UPDATE public.events SET discussion_club_id = NULL
   WHERE id = '57e00000-0000-0000-0000-0000000000d4';
  PERFORM pg_temp.assert(
    (SELECT discussion_club_id IS NULL AND discussion_group_id IS NULL
       FROM public.events WHERE id = '57e00000-0000-0000-0000-0000000000d4'),
    '57/B2: wyczyszczenie klubu w redakcji zeruje tez grupe (zamiast 23514)');
END $$;

SELECT pg_temp.assert_raises_like($q$
  UPDATE public.events SET discussion_group_id = '57200000-0000-0000-0000-000000000003'
   WHERE id = '57e00000-0000-0000-0000-0000000000d4'
$q$, 'events_discussion_group_needs_club',
  '57/B2/ODMOWA: przypiecie grupy BEZ klubu nadal odrzucone (trigger naprawia tylko znikajacy klub)');

SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.events
    (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode,
     registration_flow, timezone, discussion_group_id)
  VALUES ('57e00000-0000-0000-0000-0000000000d5', '11111111-1111-1111-1111-111111111111',
          'x2-57-dyskusja-5', 'Dyskusja 5', 'Discussion 5', now() + interval '5 days', 'draft',
          'rsvp', 'instant', 'Europe/Warsaw', '57200000-0000-0000-0000-000000000003')
$q$, 'events_discussion_group_needs_club',
  '57/B2/ODMOWA: nowe wydarzenie z grupa bez klubu nadal odrzucone');

-- ---------------------------------------------------------------------------
-- SEKCJA 6: ACL
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_scanner_scan_time_corroborated(uuid, uuid, timestamptz, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_scanner_scan_time_corroborated(uuid, uuid, timestamptz, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_scanner_scan_time_corroborated(uuid, uuid, timestamptz, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_scanner_code_lookup(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_scanner_code_lookup(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_scanner_code_lookup(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_checkpoint_occupancy(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_checkin_inside_since(uuid, uuid, uuid, timestamptz, interval, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_checkin_write(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, timestamptz, text, text, boolean, text)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_checkin_record(jsonb)', 'EXECUTE')
  AND has_function_privilege('anon', 'public.event_lead_scan_record(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_checkins_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_checkins_list(uuid, uuid, text, text, text, text, timestamptz, timestamptz, integer, integer, boolean)', 'EXECUTE'),
  '57/ACL: pomocnicze tylko service_role (lookup odtworzony po DROP), plaszczyzna urzadzenia dla anon, panel dla authenticated');

\echo '== 57 poprawki skanera po koncowym przegladzie: koniec =='

ROLLBACK;
