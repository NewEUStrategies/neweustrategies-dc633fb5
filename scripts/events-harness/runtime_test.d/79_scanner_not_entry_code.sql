-- ============================================================================
-- 79_scanner_not_entry_code - NUMER POTWIERDZENIA I ADRES NIE BLOKUJA
-- URZADZENIA PRZY BRAMCE (przeglad R67, REG-12; migracja 20261012182100)
--
-- PO CO TEN PLIK ISTNIEJE
-- Karta na stronie wydarzenia rysowala kiedys QR z numerem potwierdzenia
-- (`https://…/events/<slug>?ticket=NES-XXXX-XXXX`). To NIE jest kod biletu -
-- bilet to losowe 32 znaki z maila „Twoj bilet". Bramka klienta
-- (`assertScannableCode`) odrzuca takie napisy przed siecia, ale stara,
-- zbuforowana aplikacja skanera albo dowolny inny klient anonimowego RPC
-- wysylal je do bazy, a kazdy taki skan podnosil licznik nieudanych
-- rozpoznan - 20 w 10 minut blokowalo telefon przy bramce na 30 minut,
-- w trakcie wejscia. Ten plik przeprowadza PRAWDZIWY kod z wysylki biletu
-- (`_event_issue_ticket_codes`, jak w mailu) i stare karty przez cztery RPC
-- skanu na replayu modulu.
--
-- CO SPRAWDZA
--   1. kod biletu z maila -> rozpoznanie i odprawa `granted`;
--   2. numer potwierdzenia (wielkie i male litery), adres karty z `?ticket=`
--      i link samoobslugi -> `not_entry_code` w odprawie, rozpoznaniu, skanie
--      leada i wydruku identyfikatora; licznik urzadzenia bez zmian, brak
--      wiersza w dzienniku, skan z kolejki offline bez licznika
--      monotonicznego;
--   3. KRYTERIUM: 20 (i wiecej) skanow starych kart nigdy nie blokuje
--      urzadzenia - po serii prawdziwy kod nadal wpuszcza;
--   4. kontrapunkt: nieznany kod nadal liczy sie do blokady (zgadywanie kodow
--      nie omija licznika), a 20 nieznanych kodow blokuje jak dotad.
--
-- CZEGO NIE SPRAWDZA: ACL (pgTAP event_sms_scanner_r67_test), klienta skanera
-- (vitest scannerDevicePlane / useScannerOffline).
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================
\echo '== 79 skaner: numer potwierdzenia i adres poza licznikiem blokady (REG-12) =='

BEGIN;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow) VALUES
  ('79e00000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'skan79',
   'Skaner 79', 'Scanner 79', now() + interval '1 day', 'published', 'rsvp', 'instant');

INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode,
  access_mode, dedupe_window_seconds) VALUES
  ('79c00000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '79e00000-0000-4000-8000-000000000001', 'Brama 79', 'Gate 79', 'event_entry', 'in_out', 'control', 60);

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('79f00000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sponsor 79');
INSERT INTO public.event_sponsors (id, tenant_id, event_id, company_id, snapshot_name) VALUES
  ('79500000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '79e00000-0000-4000-8000-000000000001', '79f00000-0000-4000-8000-000000000001', 'Sponsor 79');

-- Telefon bramkowy (odprawa + wydruk), stoisko sponsora i drugi telefon
-- bramkowy do kontrapunktu (blokada po nieznanych kodach).
INSERT INTO public.event_scanner_devices (id, tenant_id, event_id, checkpoint_id, sponsor_id, label,
  token_hash, token_prefix, scopes, is_active, expires_at, revoked_at) VALUES
  ('79d00000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '79e00000-0000-4000-8000-000000000001', '79c00000-0000-4000-8000-000000000001', NULL, 'Brama 79',
   encode(extensions.digest('tok-skan79-brama-001', 'sha256'), 'hex'), 'tok-skan',
   ARRAY['checkin', 'badge_print']::text[], true, now() + interval '2 days', NULL),
  ('79d00000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   '79e00000-0000-4000-8000-000000000001', NULL, '79500000-0000-4000-8000-000000000001', 'Stoisko 79',
   encode(extensions.digest('tok-skan79-stoisko-1', 'sha256'), 'hex'), 'tok-skan',
   ARRAY['lead']::text[], true, now() + interval '2 days', NULL),
  ('79d00000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
   '79e00000-0000-4000-8000-000000000001', '79c00000-0000-4000-8000-000000000001', NULL, 'Brama 79 zapas',
   encode(extensions.digest('tok-skan79-zapas-001', 'sha256'), 'hex'), 'tok-skan',
   ARRAY['checkin']::text[], true, now() + interval '2 days', NULL);

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('79700000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'uczestnik.skan79@example.org', 'Ula', 'Uczestnik');
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode,
  payment_status) VALUES
  ('79300000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '79e00000-0000-4000-8000-000000000001', '79700000-0000-4000-8000-000000000001', 'approved', 'rsvp',
   'not_required');

-- Kod z wysylki biletu: dokladnie to, co trafia do maila „Twoj bilet".
CREATE TEMP TABLE s79 (k text PRIMARY KEY, v text NOT NULL) ON COMMIT DROP;
GRANT SELECT ON s79 TO anon;
DO $$
DECLARE
  v jsonb := public._event_issue_ticket_codes('79300000-0000-4000-8000-000000000001');
BEGIN
  IF jsonb_array_length(v) <> 1 THEN
    RAISE EXCEPTION 'harness 79: wysylka biletu nie wydala kodu: %', v;
  END IF;
  PERFORM public._event_ticket_code_confirm(
    (v->0->>'registration_id')::uuid, (v->0->>'claimed_at')::timestamptz, true);
  INSERT INTO s79 VALUES ('qr', v->0->>'qr_token');
END $$;
-- Numer potwierdzenia z karty (format ticketCodeFrom: NES-XXXX-XXXX, bez I i O).
INSERT INTO s79 VALUES
  ('karta', 'NES-4F7K-2M9Q'),
  ('karta_male', 'nes-4f7k-2m9q'),
  ('karta_qr', 'https://neweuropeanstrategies.com/events/skan79?ticket=NES-4F7K-2M9Q'),
  ('link_samoobslugi', 'https://neweuropeanstrategies.com/events/skan79/manage#token=' || repeat('A', 32));

CREATE FUNCTION pg_temp.s79(_k text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT v FROM s79 WHERE k = _k $$;
CREATE FUNCTION pg_temp.s79_device(_id text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('failed', failed_scan_count, 'window', fail_window_count,
                            'locked', locked_until IS NOT NULL AND locked_until > now())
    FROM public.event_scanner_devices WHERE id = ('79d00000-0000-4000-8000-00000000000' || _id)::uuid
$$;

SELECT pg_temp.assert((SELECT v ~ '^[A-Za-z0-9_-]{32}$' FROM s79 WHERE k = 'qr'),
  '79/scenografia: kod biletu z wysylki ma ksztalt _event_new_qr_token (32 znaki base64url)');
SELECT pg_temp.assert(NOT public._event_scan_is_not_entry_code(pg_temp.s79('qr')),
  '79/regula: kod biletu z maila NIE jest numerem potwierdzenia ani adresem');

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;

-- ---------------------------------------------------------------------------
-- 1. Kod biletu z maila wpuszcza
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT v->>'outcome' = 'granted' AND (v->>'admit')::boolean
     FROM (SELECT public.event_checkin_resolve(jsonb_build_object(
             'device_token', 'tok-skan79-brama-001', 'code', pg_temp.s79('qr'))) AS v) x),
  '79/bilet: rozpoznanie kodu z maila -> granted');

-- ---------------------------------------------------------------------------
-- 2. Stare karty: not_entry_code we wszystkich czterech RPC, bez licznika
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('karta'), 'client_scan_uid', 'skan79-karta-1')) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: odprawa - numer potwierdzenia -> not_entry_code');
SELECT pg_temp.assert(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('karta_male'))) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: odprawa - numer potwierdzenia malymi literami -> not_entry_code');
SELECT pg_temp.assert(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('karta_qr'))) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: odprawa - dawny QR karty (adres z ?ticket=) -> not_entry_code');
SELECT pg_temp.assert(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('link_samoobslugi'))) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: odprawa - link samoobslugi (adres) -> not_entry_code');
SELECT pg_temp.assert(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('karta'), 'queued', true, 'device_scanned_at', now() - interval '2 minutes',
    'offline_outcome', 'unknown_code', 'offline_admitted', false)) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: odprawa z kolejki offline (decyzja unknown_code) -> not_entry_code');
SELECT pg_temp.assert(
  public.event_checkin_resolve(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('karta_qr'))) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: rozpoznanie - dawny QR karty -> not_entry_code');
SELECT pg_temp.assert(
  public.event_lead_scan_record(jsonb_build_object('device_token', 'tok-skan79-stoisko-1',
    'code', pg_temp.s79('karta'))) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: skan leada - numer potwierdzenia -> not_entry_code');
SELECT pg_temp.assert(
  public.event_badge_print_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', pg_temp.s79('karta_qr'))) ->> 'outcome' = 'not_entry_code',
  '79/REG-12: wydruk identyfikatora - dawny QR karty -> not_entry_code');
RESET ROLE;

SELECT pg_temp.assert(pg_temp.s79_device('1') = '{"failed": 0, "window": 0, "locked": false}'::jsonb,
  '79/REG-12: telefon bramkowy - licznik nieudanych rozpoznan nietkniety (takze skan z kolejki)');
SELECT pg_temp.assert(pg_temp.s79_device('2') = '{"failed": 0, "window": 0, "locked": false}'::jsonb,
  '79/REG-12: stoisko - licznik nietkniety');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_checkins WHERE event_id = '79e00000-0000-4000-8000-000000000001') = 0,
  '79/REG-12: zadna stara karta nie zostawila wiersza w dzienniku odpraw');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_lead_scans WHERE event_id = '79e00000-0000-4000-8000-000000000001') = 0
  AND (SELECT count(*) FROM public.event_badge_prints WHERE event_id = '79e00000-0000-4000-8000-000000000001') = 0,
  '79/REG-12: ani lead, ani wydruk identyfikatora z numeru potwierdzenia');

-- ---------------------------------------------------------------------------
-- 3. KRYTERIUM: seria starych kart nigdy nie blokuje urzadzenia
-- ---------------------------------------------------------------------------
SET ROLE anon;
DO $$
DECLARE
  i integer;
  v jsonb;
BEGIN
  FOR i IN 1..30 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok-skan79-brama-001',
      'code', CASE i % 3
                WHEN 0 THEN pg_temp.s79('karta')
                WHEN 1 THEN pg_temp.s79('karta_qr')
                ELSE 'NES-' || translate(lpad(i::text, 4, '0'), '01', 'AB') || '-2M9Q'
              END,
      'client_scan_uid', 'skan79-seria-' || i));
    IF v->>'outcome' IS DISTINCT FROM 'not_entry_code' OR (v->>'device_locked')::boolean THEN
      RAISE EXCEPTION 'harness 79: skan % starej karty -> %', i, v;
    END IF;
  END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.assert(pg_temp.s79_device('1') = '{"failed": 0, "window": 0, "locked": false}'::jsonb,
  '79/REG-12 KRYTERIUM: 30 skanow starych kart (prog blokady 20 w 10 minut) - urzadzenie nie zablokowane, licznik 0');

SET ROLE anon;
SELECT pg_temp.assert(
  (SELECT v->>'outcome' = 'granted' AND (v->>'admit')::boolean
     FROM (SELECT public.event_checkin_record(jsonb_build_object(
             'device_token', 'tok-skan79-brama-001', 'code', pg_temp.s79('qr'),
             'client_scan_uid', 'skan79-bilet-1')) AS v) x),
  '79/REG-12: po serii starych kart kod biletu z maila nadal wpuszcza (telefon dziala)');

-- ---------------------------------------------------------------------------
-- 4. Kontrapunkt: nieznany kod nadal liczy sie do blokady
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-brama-001',
    'code', 'kod-ktorego-nie-ma-79')) ->> 'outcome' = 'unknown_code',
  '79/kontrapunkt: nieznany kod -> unknown_code');
RESET ROLE;
SELECT pg_temp.assert(pg_temp.s79_device('1') = '{"failed": 1, "window": 1, "locked": false}'::jsonb,
  '79/kontrapunkt: nieznany kod podnosi licznik (zgadywanie kodow nie omija blokady)');

SET ROLE anon;
DO $$
DECLARE
  i integer;
  v jsonb;
BEGIN
  FOR i IN 1..20 LOOP
    v := public.event_checkin_record(jsonb_build_object(
      'device_token', 'tok-skan79-zapas-001', 'code', 'zgadywany-kod-79-' || i));
  END LOOP;
  IF NOT (v->>'device_locked')::boolean THEN
    RAISE EXCEPTION 'harness 79: 20 nieznanych kodow nie zablokowalo urzadzenia: %', v;
  END IF;
END $$;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_checkin_record(jsonb_build_object('device_token', 'tok-skan79-zapas-001',
       'code', 'NES-4F7K-2M9Q'))$q$,
  'device_locked',
  '79/kontrapunkt: 20 nieznanych kodow blokuje jak dotad (zablokowanego nie odblokuje tez stara karta)');
RESET ROLE;

ROLLBACK;
