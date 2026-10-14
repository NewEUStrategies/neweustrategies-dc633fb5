-- ============================================================================
-- 21_register_oracle_followups - POPRAWKI PO PRZEGLADZIE R38 (20261012180000..180400)
--
-- PO CO TEN PLIK ISTNIEJE
-- pgTAP (event_register_oracle_followups_test.sql,
-- event_group_guests_hardening_test.sql) przypina poprawki na pelnym
-- schemacie; ten plik sprawdza te same tezy na REPLAYU modulu i - czego pgTAP
-- nie umie - PRAWDZIWY wyscig dwoch sesji przy pierwszym zapisie nowego adresu.
--
-- CO SPRAWDZA
--   FAZA 1 (jedna transakcja, ROLLBACK):
--     1. Znaki sterujace: znany i swiezy adres - ta sama odmowa kodem pola,
--        zanim baza spojrzy na adres (wczesniej znany pekal na CHECK
--        `submitted_profile` i dostawal `unknown`).
--     2. Goscie grupy: cala lista walidowana przed odczytem czlonkostwa,
--        gosc z zapisem pominiety bez sladu (`added` = poprawni goscie),
--        duplikat w liscie -> `duplicate_guest`.
--     3. Oferta ceny idzie za biletem - zmiana biletu ja kasuje.
--     4. Jezyk potwierdzenia = jezyk formularza.
--   FAZA 2 (zacommitowana, dwie sesje `dblink`, wzor 20_registration.sql
--   i 29_waitlist_settlement_group_locks.sql):
--     5. Pierwszy zapis nowego adresu na DWA wydarzenia naraz: sesja A
--        wstawia osobe i trzyma transakcje, sesja B czeka na jej wiersz
--        (ON CONFLICT). Po zatwierdzeniu A sesja B dostaje osobe A i zapisuje
--        sie na swoje wydarzenie - dwa zgloszenia, jedna osoba, dostawa
--        „utworzono" w obu. Stare cialo konczylo B na 23505 -> `already_registered`
--        bez zgloszenia i bez maila.
--
-- SPRZATANIE: faza 1 - ROLLBACK; faza 2 usuwa wlasnego najemce (kaskada),
-- kubelki prob, zdarzenia domenowe i rozszerzenie dblink, i sprawdza, ze nic
-- nie zostalo.
-- ============================================================================
\echo '== 21 poprawki R38: znaki sterujace, goscie, oferta, jezyk =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'Tenant C3 (poprawki R38)', 'tc3-r38');

INSERT INTO auth.users (id, email) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'lider.r38@example.org');
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('c3000000-0000-4000-8000-000000000001', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow) VALUES
  ('c3100000-0000-4000-8000-000000000001', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', 'r38-glowne',
   'Glowne', 'Main', now() + interval '30 days', 'published', 'rsvp', 'instant');

-- 01 bezplatny grupowy, 02 platny 50 zl, 03 VIP 900 zl.
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
  group_registration_enabled, group_max_size) VALUES
  ('c3200000-0000-4000-8000-000000000001', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'c3100000-0000-4000-8000-000000000001', 'r38_wolny', 'Wolny', 'Free', 0, 'PLN', true, 10),
  ('c3200000-0000-4000-8000-000000000002', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'c3100000-0000-4000-8000-000000000001', 'r38_tani', 'Tani', 'Cheap', 5000, 'PLN', false, 10),
  ('c3200000-0000-4000-8000-000000000003', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'c3100000-0000-4000-8000-000000000001', 'r38_vip', 'VIP', 'VIP', 90000, 'PLN', false, 10);

-- Osoba ZNANA kartotece (bez zapisu) i osoba ZAPISANA na wydarzenie.
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name) VALUES
  ('c3500000-0000-4000-8000-000000000001', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'znana.r38@example.org', 'Znana', 'Osoba'),
  ('c3500000-0000-4000-8000-000000000002', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'zapisana.r38@example.org', 'Zapisana', 'Osoba');
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
  registration_mode, source, payment_status) VALUES
  ('c3400000-0000-4000-8000-000000000002', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'c3100000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-000000000002',
   'c3200000-0000-4000-8000-000000000001', 'pending', 'rsvp', 'self_registration', 'not_required');

CREATE TEMP TABLE r38h (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;

-- Wywolanie jak eventRegistration.server.ts (najemca, konto, solony skrot adresu).
CREATE FUNCTION pg_temp.r38(p_uid uuid, p_seed text, p_payload jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_register_for_client(
    'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', p_uid, 'ip:' || md5(p_seed), 'harness/21r38', p_payload)
$$;
CREATE FUNCTION pg_temp.r38p(p_email text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_slug', 'r38-glowne', 'first_name', 'Probe', 'last_name', 'Er',
           'email', p_email, 'consent_data_processing', true,
           'ticket_type_id', 'c3200000-0000-4000-8000-000000000001') || p_extra
$$;

SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', false);

-- 1) ZNAKI STERUJACE -----------------------------------------------------------
INSERT INTO r38h VALUES
  ('ctl_fresh', pg_temp.r38(NULL, 'ctl-fresh', pg_temp.r38p('swieza.r38@example.org',
     jsonb_build_object('company_text', repeat(chr(1), 200), 'social_profile_url', 'https://' || repeat(chr(1), 492))))),
  ('ctl_known', pg_temp.r38(NULL, 'ctl-known', pg_temp.r38p('znana.r38@example.org',
     jsonb_build_object('company_text', repeat(chr(1), 200), 'social_profile_url', 'https://' || repeat(chr(1), 492)))));
SELECT pg_temp.assert(
  (SELECT v FROM r38h WHERE k = 'ctl_known') = (SELECT v FROM r38h WHERE k = 'ctl_fresh')
  AND (SELECT v->'client' FROM r38h WHERE k = 'ctl_known') = '{"ok": false, "error": "invalid_company"}'::jsonb,
  '21r38/REG-04: znaki sterujace - znany i swiezy adres dostaja te sama odmowe kodem pola (nie `unknown`)');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_people WHERE email_norm = 'swieza.r38@example.org')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations WHERE person_id = 'c3500000-0000-4000-8000-000000000001'),
  '21r38/REG-04: odmowa przed wyszukaniem osoby - nic nie zapisane');

-- 2) GOSCIE GRUPY (wrapper zgodnosci, jak 26-29) ----------------------------------
INSERT INTO r38h VALUES
  ('lead', pg_temp.r38('c3000000-0000-4000-8000-000000000001', 'lead', pg_temp.r38p('lider.r38@example.org')));
SELECT pg_temp.assert(
  (SELECT v->'client'->>'outcome' = 'registered' FROM r38h WHERE k = 'lead'),
  '21r38/goscie: punkt wyjscia - zweryfikowany prowadzacy na bilecie grupowym');

DO $$
DECLARE
  v_lead uuid := (SELECT (v->'client'->>'registration_id')::uuid FROM r38h WHERE k = 'lead');
  v_member jsonb;
  v_fresh jsonb;
  v_skip jsonb;
  v_dup jsonb;
BEGIN
  PERFORM pg_temp.act_as('c3000000-0000-4000-8000-000000000001', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3');
  v_member := public.event_register_group_guests(v_lead,
    '[{"first_name":"Sonda","last_name":"Jeden","email":"zapisana.r38@example.org"},
      {"first_name":"","last_name":"","email":"x@example.org"}]'::jsonb);
  v_fresh := public.event_register_group_guests(v_lead,
    '[{"first_name":"Sonda","last_name":"Dwa","email":"nikt.r38@example.org"},
      {"first_name":"","last_name":"","email":"x@example.org"}]'::jsonb);
  v_skip := public.event_register_group_guests(v_lead,
    '[{"first_name":"Ktos","last_name":"Inny","email":"zapisana.r38@example.org"},
      {"first_name":"Nowy","last_name":"Gosc","email":"nowy.r38@example.org"}]'::jsonb);
  v_dup := public.event_register_group_guests(v_lead,
    '[{"first_name":"Dwa","last_name":"Razy","email":"dwa.r38@example.org"},
      {"first_name":"Dwa","last_name":"Razy","email":"DWA.r38@example.org"}]'::jsonb);
  PERFORM pg_temp.act_as(NULL, NULL);

  PERFORM pg_temp.assert(v_member = v_fresh AND v_member = '{"ok": false, "error": "invalid_name"}'::jsonb,
    '21r38/REG-04 goscie: [zapisany, zly wiersz] i [swiezy, zly wiersz] - ta sama odmowa, bez adresu');
  PERFORM pg_temp.assert(v_skip = '{"ok": true, "added": 2}'::jsonb
    AND (SELECT count(*) FROM public.event_registrations
          WHERE person_id = 'c3500000-0000-4000-8000-000000000002') = 1
    AND EXISTS (SELECT 1 FROM public.event_registrations r JOIN public.event_people p ON p.id = r.person_id
                 WHERE p.email_norm = 'nowy.r38@example.org' AND r.group_lead_registration_id = v_lead),
    '21r38/REG-04 goscie: zapisany pominiety bez sladu (added = poprawni goscie), swiezy dopisany');
  PERFORM pg_temp.assert(v_dup = '{"ok": false, "error": "duplicate_guest"}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.event_people WHERE email_norm = 'dwa.r38@example.org'),
    '21r38/goscie: duplikat w liscie - duplicate_guest przed jakimkolwiek zapisem');
END $$;

-- 3) OFERTA IDZIE ZA BILETEM -------------------------------------------------------
-- Zgloszenie nieoplacone na bilet 50 zl z oferta (jak zapis sprzed chwili),
-- potem organizator przenosi je na VIP (ten sam zapis kolumny co
-- admin_event_registration_upsert).
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
  registration_mode, source, payment_status, quoted_price_cents, quoted_currency, quote_valid_until) VALUES
  ('c3400000-0000-4000-8000-000000000003', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
   'c3100000-0000-4000-8000-000000000001', 'c3500000-0000-4000-8000-000000000001',
   'c3200000-0000-4000-8000-000000000002', 'pending', 'rsvp', 'self_registration', 'unpaid',
   5000, 'PLN', now() + interval '72 hours');

DO $$
DECLARE
  v_id constant uuid := 'c3400000-0000-4000-8000-000000000003';
  v_unit jsonb;
BEGIN
  UPDATE public.event_registrations SET answers = '{"r38":"x"}'::jsonb WHERE id = v_id;
  PERFORM pg_temp.assert(
    (SELECT quoted_price_cents = 5000 FROM public.event_registrations WHERE id = v_id),
    '21r38/oferta: zapis bez zmiany biletu nie dotyka oferty');
  UPDATE public.event_registrations SET ticket_type_id = 'c3200000-0000-4000-8000-000000000003' WHERE id = v_id;
  SELECT public._event_registration_unit_price(r, t) INTO v_unit
    FROM public.event_registrations r JOIN public.event_ticket_types t ON t.id = r.ticket_type_id
   WHERE r.id = v_id;
  PERFORM pg_temp.assert(
    (SELECT quoted_price_cents IS NULL AND quoted_currency IS NULL AND quote_valid_until IS NULL
       FROM public.event_registrations WHERE id = v_id)
    AND (v_unit->>'amount_cents')::integer = 90000 AND v_unit->>'source' = 'current',
    '21r38/REG-16: organizator przenosi na VIP - oferta 50 zl skasowana, cena VIP biezaca (90000)');
END $$;

-- 4) JEZYK POTWIERDZENIA -----------------------------------------------------------
INSERT INTO r38h VALUES
  ('lang_en', pg_temp.r38(NULL, 'lang-en', pg_temp.r38p('angielski.r38@example.org', '{"lang":"en"}')));
SELECT pg_temp.assert(
  public.event_registration_notify_payload_for_tenant('c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
    jsonb_build_object('manage_token', (SELECT v->'delivery'->>'manage_token' FROM r38h WHERE k = 'lang_en')))->>'lang'
  = 'en',
  '21r38/jezyk: formularz po angielsku - potwierdzenie z linkiem samoobslugi po angielsku');

ROLLBACK;
SELECT pg_temp.act_as();

-- ############################################################################
-- FAZA 2 - PIERWSZY ZAPIS NOWEGO ADRESU NA DWA WYDARZENIA NARAZ
-- ############################################################################
\echo '== 21 poprawki R38: wyscig pierwszych zapisow nowego adresu (dwie sesje) =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3', 'Tenant C3D (wyscig osoby)', 'tc3d-race');
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow) VALUES
  ('c3d10000-0000-4000-8000-000000000001', 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3', 'r38-wyscig-1',
   'Wyscig 1', 'Race 1', now() + interval '30 days', 'published', 'rsvp', 'instant'),
  ('c3d10000-0000-4000-8000-000000000002', 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3', 'r38-wyscig-2',
   'Wyscig 2', 'Race 2', now() + interval '30 days', 'published', 'rsvp', 'instant');

CREATE TEMP TABLE r38race (who text PRIMARY KEY, res jsonb, err text);
CREATE TEMP TABLE r38pid (who text PRIMARY KEY, pid integer NOT NULL);

SELECT dblink_connect('r38a', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
SELECT dblink_connect('r38b', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
INSERT INTO r38pid SELECT 'r38a', x::integer FROM dblink('r38a', 'SELECT pg_backend_pid()') AS t(x text);
INSERT INTO r38pid SELECT 'r38b', x::integer FROM dblink('r38b', 'SELECT pg_backend_pid()') AS t(x text);

SELECT pg_temp.assert(
  (SELECT count(DISTINCT pid) FROM r38pid) = 2 AND NOT EXISTS (SELECT 1 FROM r38pid WHERE pid = pg_backend_pid()),
  '21r38/wyscig: dwie OSOBNE sesje serwera, rozne od sesji glownej');

-- Sesja A: zapis nowego adresu na wydarzenie 1 w OTWARTEJ transakcji - osoba
-- jest wstawiona, ale niezatwierdzona.
SELECT dblink_exec('r38a', 'BEGIN');
INSERT INTO r38race (who, res)
SELECT 'r38a', x::jsonb FROM dblink('r38a', $$SELECT public.event_register_for_client(
  'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3', NULL, 'ip:' || md5('r38-race-a'), 'harness/21r38',
  '{"event_slug":"r38-wyscig-1","first_name":"Nowa","last_name":"Osoba","email":"wyscig.r38@example.org","consent_data_processing":true}'::jsonb)::text$$)
  AS t(x text);

-- Sesja B: ten sam adres na wydarzenie 2 - czeka na wiersz osoby z sesji A.
SELECT dblink_send_query('r38b', $$SELECT public.event_register_for_client(
  'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3', NULL, 'ip:' || md5('r38-race-b'), 'harness/21r38',
  '{"event_slug":"r38-wyscig-2","first_name":"Nowa","last_name":"Osoba","email":"wyscig.r38@example.org","consent_data_processing":true}'::jsonb)::text$$);

DO $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 300 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked
      FROM pg_stat_activity a JOIN r38pid p ON p.pid = a.pid
     WHERE p.who = 'r38b' AND a.wait_event_type = 'Lock';
    EXIT WHEN v_blocked >= 1;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  PERFORM pg_temp.assert(v_blocked = 1,
    '21r38/wyscig DOWOD: sesja B czeka na niezatwierdzony wiersz osoby z sesji A');
END $$;

SELECT dblink_exec('r38a', 'COMMIT');

DO $$
DECLARE v_res text; v_err text;
BEGIN
  SELECT x INTO v_res FROM dblink_get_result('r38b', false) AS t(x text);
  v_err := NULLIF(dblink_error_message('r38b'), 'OK');
  PERFORM 1 FROM dblink_get_result('r38b', false) AS t(x text);
  INSERT INTO r38race VALUES ('r38b', v_res::jsonb, v_err);
END $$;

SELECT pg_temp.assert(
  (SELECT res->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb
      AND res->'delivery'->>'kind' = 'created' FROM r38race WHERE who = 'r38a')
  AND (SELECT err IS NULL AND res->'client' = '{"ok": true, "outcome": "check_email"}'::jsonb
      AND res->'delivery'->>'kind' = 'created' AND res->'delivery'->>'registration_id' IS NOT NULL
         FROM r38race WHERE who = 'r38b'),
  '21r38/wyscig: obie sesje - odpowiedz neutralna i dostawa „utworzono" (drugi zapis nie zginal)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_people
    WHERE tenant_id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3' AND email_norm = 'wyscig.r38@example.org') = 1
  AND (SELECT count(DISTINCT r.event_id) FROM public.event_registrations r
        JOIN public.event_people p ON p.id = r.person_id
       WHERE r.tenant_id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3' AND p.email_norm = 'wyscig.r38@example.org') = 2,
  '21r38/wyscig: jedna osoba, dwa zgloszenia - po jednym na kazde wydarzenie');

-- SPRZATANIE FAZY 2 --------------------------------------------------------------
SELECT dblink_disconnect('r38a');
SELECT dblink_disconnect('r38b');
DROP TABLE r38race;
DROP TABLE r38pid;
DROP EXTENSION dblink;

DELETE FROM public.rate_limits
 WHERE scope = 'event_register.ip' AND subject_id IN ('ip:' || md5('r38-race-a'), 'ip:' || md5('r38-race-b'));
DELETE FROM public.domain_events WHERE tenant_id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3';
DELETE FROM public.tenants WHERE id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations WHERE tenant_id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3') = 0
  AND (SELECT count(*) FROM public.event_people WHERE tenant_id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3') = 0
  AND (SELECT count(*) FROM public.tenants WHERE id = 'c3d3c3d3-c3d3-4c3d-8c3d-c3d3c3d3c3d3') = 0
  AND (SELECT count(*) FROM public.rate_limits
        WHERE subject_id IN ('ip:' || md5('r38-race-a'), 'ip:' || md5('r38-race-b'))) = 0,
  '21r38/sprzatanie: faza wspolbieznosci nie zostawila po sobie ani jednego wiersza');
