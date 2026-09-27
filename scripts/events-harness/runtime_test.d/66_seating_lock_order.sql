-- ============================================================================
-- 66_seating_lock_order - PLAN SALI: KOLEJNOSC BLOKAD PRZYDZIALU
-- (migracja 20260927001200)
--
-- PO CO TEN PLIK ISTNIEJE
-- Przydzial miejsca bral blokade PLANU, zwalnial przydzialy, a dopiero INSERT
-- (trigger `_tg_event_seat_assignment_validate`) bral FOR SHARE na zgloszeniu:
-- plan -> przydzialy -> zgloszenie. Zwrot i decyzja panelu ida odwrotnie:
-- wydarzenie -> bilet -> zgloszenie, a trigger zwalniajacy miejsca
-- (`_tg_event_registration_release_seats`) rusza potem przydzialy. Przeniesienie
-- miejsca w chwili zwrotu konczylo sie zakleszczeniem (40P01) - ofiara byla ta
-- sesja, ktora czekala dluzej (zwrot albo sam przydzial; na starych cialach
-- w tym pliku: przydzial). Przydzial zbiorczy [gosc, prowadzacy] zakleszczal sie
-- tak samo z anulowaniem prowadzacego (kaskada blokuje gosci FOR UPDATE po nim).
--
-- CO SPRAWDZA (dwie sesje, `dblink`). Sesja glowna trzyma wiersz zgloszenia
-- FOR UPDATE (tak stoi sciezka statusu po blokadzie wydarzenia i biletu),
-- druga sesja wysyla przydzial i MUSI zawisnac na blokadzie (dowod
-- z `pg_stat_activity`). Potem sesja glowna zmienia status z
-- `lock_timeout = 3s` - musi przejsc bez zakleszczenia - i zatwierdza.
-- Przydzial widzi stan PO zmianie: odmowa `registration_not_seatable`
-- (pojedynczy) albo odrzut obu pozycji (zbiorczy), zadnego aktywnego
-- przydzialu dla anulowanych zgloszen.
--
-- CZEGO NIE SPRAWDZA: regul przydzialu jako takich (65_seating.sql).
--
-- DLACZEGO FAZA JEST ZACOMMITOWANA. Druga sesja nie widzi cudzej otwartej
-- transakcji, wiec scenografia musi byc zatwierdzona. Plik sprzata po sobie
-- jawnie: najemce (kaskada zabiera wydarzenie, plan, osoby i zgloszenia),
-- jego zdarzenia domenowe i konto administratora.
-- ============================================================================
\echo '== 66 plan sali: kolejnosc blokad przydzialu (dwie sesje) =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug)
VALUES ('66000000-0000-0000-0000-0000000000a0', 'Tenant 66 (kolejnosc blokad)', 't66-lock');
INSERT INTO auth.users (id, email)
VALUES ('66a00000-0000-0000-0000-0000000000a1', 'plan66.admin@example.org');
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('66a00000-0000-0000-0000-0000000000a1', 'admin', '66000000-0000-0000-0000-0000000000a0');
INSERT INTO public.profiles (id, tenant_id, display_name, slug)
VALUES ('66a00000-0000-0000-0000-0000000000a1', '66000000-0000-0000-0000-0000000000a0', 'Admin 66', 'plan66-admin');
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status)
VALUES ('66e00000-0000-0000-0000-0000000000e1', '66000000-0000-0000-0000-0000000000a0',
        'plan-66', 'Gala 66', 'Gala 66 EN', now() + interval '20 days', 'published');
INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, source) VALUES
  ('66f00000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-0000000000a0', 'ola66@example.org', 'Ola', 'Przenoszona', 'self_registration'),
  ('66f00000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-0000000000a0', 'lech66@example.org', 'Lech', 'Prowadzacy', 'self_registration'),
  ('66f00000-0000-0000-0000-000000000003', '66000000-0000-0000-0000-0000000000a0', 'gosc66@example.org', 'Gosc', 'Grupy', 'self_registration');
-- r1 pojedyncze; r2 prowadzacy grupy, r3 jego gosc.
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode, group_lead_registration_id) VALUES
  ('66900000-0000-0000-0000-000000000001', '66000000-0000-0000-0000-0000000000a0', '66e00000-0000-0000-0000-0000000000e1',
   '66f00000-0000-0000-0000-000000000001', 'approved', 'rsvp', NULL),
  ('66900000-0000-0000-0000-000000000002', '66000000-0000-0000-0000-0000000000a0', '66e00000-0000-0000-0000-0000000000e1',
   '66f00000-0000-0000-0000-000000000002', 'approved', 'rsvp', NULL),
  ('66900000-0000-0000-0000-000000000003', '66000000-0000-0000-0000-0000000000a0', '66e00000-0000-0000-0000-0000000000e1',
   '66f00000-0000-0000-0000-000000000003', 'approved', 'rsvp', '66900000-0000-0000-0000-000000000002');

CREATE TEMP TABLE t66 (k text PRIMARY KEY, v text NOT NULL);
CREATE OR REPLACE FUNCTION pg_temp.v66(_k text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT v::uuid FROM t66 WHERE k = _k $$;

-- Plan z jednym rzedem 4 miejsc; r1 siedzi na A1 (przeniesienie zwolni ten przydzial).
SELECT pg_temp.act_as('66a00000-0000-0000-0000-0000000000a1', '66000000-0000-0000-0000-0000000000a0');
INSERT INTO t66 SELECT 'map', public.admin_event_seat_map_save(jsonb_build_object(
  'event_id', '66e00000-0000-0000-0000-0000000000e1', 'name', 'Sala 66'))::text;
INSERT INTO t66 SELECT 'section', public.admin_event_seat_section_save(jsonb_build_object(
  'map_id', pg_temp.v66('map'), 'label', 'A', 'kind', 'rows', 'rows_count', 1, 'seats_per_row', 4,
  'row_label_scheme', 'alpha', 'seat_numbering', 'ltr'))->>'section_id';
INSERT INTO t66 SELECT 'A' || s.seat_number, s.id::text
  FROM public.event_seats s WHERE s.section_id = pg_temp.v66('section');
SELECT public.admin_event_seat_assign(jsonb_build_object('map_id', pg_temp.v66('map'),
  'seat_id', pg_temp.v66('A1'), 'registration_id', '66900000-0000-0000-0000-000000000001'));
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(
  (SELECT count(*) FROM t66 WHERE k LIKE 'A_') = 4
  AND EXISTS (SELECT 1 FROM public.event_seat_assignments a
               WHERE a.registration_id = '66900000-0000-0000-0000-000000000001'
                 AND a.seat_id = pg_temp.v66('A1') AND a.released_at IS NULL),
  '66/scenografia: plan 1 x 4 zatwierdzony, r1 siedzi na A1');

-- Druga sesja: administrator najemcy 66. Wynik RPC (albo tekst bledu) wraca
-- jako napis - odmowa ma byc ASERCJA, a nie przerwaniem pliku.
SELECT dblink_connect('seat66', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
SELECT x FROM dblink('seat66', $$
  SELECT set_config('request.jwt.claim.sub', '66a00000-0000-0000-0000-0000000000a1', false)
      || set_config('nes.tenant', '66000000-0000-0000-0000-0000000000a0', false)$$) AS t(x text);
SELECT dblink_exec('seat66', $sql$
  CREATE FUNCTION pg_temp.try66(p_fn text, p_payload jsonb) RETURNS text
  LANGUAGE plpgsql AS $f$
  DECLARE v_out jsonb;
  BEGIN
    EXECUTE format('SELECT public.%I($1)', p_fn) INTO v_out USING p_payload;
    RETURN v_out::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'ERROR ' || SQLSTATE || ' ' || SQLERRM;
  END $f$
$sql$);
SELECT pg_temp.assert(
  (SELECT x::integer FROM dblink('seat66', 'SELECT pg_backend_pid()') AS t(x text)) <> pg_backend_pid(),
  '66: druga sesja to osobny proces serwera');

-- Czeka, az druga sesja zawisnie na blokadzie (pg_stat_clear_snapshot - patrz 20_registration.sql).
CREATE OR REPLACE FUNCTION pg_temp.wait66() RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 300 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked FROM pg_stat_activity
     WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock' AND query LIKE '%pg_temp.try66%';
    EXIT WHEN v_blocked >= 1;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  RETURN v_blocked = 1;
END $$;

CREATE TEMP TABLE out66 (who text PRIMARY KEY, res text);

-- ---------------------------------------------------------------------------
-- 1) PRZENIESIENIE r1 (A1 -> A2) W CHWILI ANULOWANIA r1
-- ---------------------------------------------------------------------------
BEGIN;
SELECT 1 FROM public.event_registrations WHERE id = '66900000-0000-0000-0000-000000000001' FOR UPDATE;
SELECT dblink_send_query('seat66', format('SELECT pg_temp.try66(%L, %L::jsonb)', 'admin_event_seat_assign',
  jsonb_build_object('map_id', pg_temp.v66('map'), 'seat_id', pg_temp.v66('A2'),
                     'registration_id', '66900000-0000-0000-0000-000000000001')));
SELECT pg_temp.assert(pg_temp.wait66(),
  '66/przeniesienie/DOWOD: przydzial czeka na blokadzie zgloszenia trzymanej przez sciezke statusu');
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = '66900000-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'ASERCJA NIESPELNIONA: 66/przeniesienie: anulowanie padlo (%): %', SQLSTATE, SQLERRM;
END $$;
COMMIT;

INSERT INTO out66 SELECT 'move', x FROM dblink_get_result('seat66') AS t(x text);
SELECT * FROM dblink_get_result('seat66') AS t(x text);

SELECT pg_temp.assert(
  (SELECT status FROM public.event_registrations WHERE id = '66900000-0000-0000-0000-000000000001') = 'cancelled',
  '66/przeniesienie: anulowanie przeszlo bez zakleszczenia (lock_timeout 3s)');
SELECT pg_temp.assert(
  (SELECT res FROM out66 WHERE who = 'move') LIKE 'ERROR P0001 registration_not_seatable:%',
  '66/przeniesienie: przydzial widzi stan PO anulowaniu - registration_not_seatable');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_seat_assignments a
               WHERE a.registration_id = '66900000-0000-0000-0000-000000000001' AND a.released_at IS NULL)
  AND (SELECT a.release_reason FROM public.event_seat_assignments a
        WHERE a.registration_id = '66900000-0000-0000-0000-000000000001' AND a.seat_id = pg_temp.v66('A1'))
      = 'registration_status',
  '66/przeniesienie: anulowane zgloszenie nie ma aktywnego miejsca (zwolnione przez status)');

-- ---------------------------------------------------------------------------
-- 2) PRZYDZIAL ZBIORCZY [gosc, prowadzacy] W CHWILI ANULOWANIA PROWADZACEGO
-- ---------------------------------------------------------------------------
BEGIN;
SELECT 1 FROM public.event_registrations WHERE id = '66900000-0000-0000-0000-000000000002' FOR UPDATE;
SELECT dblink_send_query('seat66', format('SELECT pg_temp.try66(%L, %L::jsonb)', 'admin_event_seat_assign_batch',
  jsonb_build_object('map_id', pg_temp.v66('map'), 'items', jsonb_build_array(
    jsonb_build_object('seat_id', pg_temp.v66('A3'), 'registration_id', '66900000-0000-0000-0000-000000000003'),
    jsonb_build_object('seat_id', pg_temp.v66('A4'), 'registration_id', '66900000-0000-0000-0000-000000000002')))));
SELECT pg_temp.assert(pg_temp.wait66(),
  '66/zbiorczy/DOWOD: przydzial zbiorczy czeka na blokadzie prowadzacego');
SET LOCAL lock_timeout = '3s';
DO $$
BEGIN
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = '66900000-0000-0000-0000-000000000002';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'ASERCJA NIESPELNIONA: 66/zbiorczy: anulowanie prowadzacego padlo (%): %', SQLSTATE, SQLERRM;
END $$;
COMMIT;

INSERT INTO out66 SELECT 'batch', x FROM dblink_get_result('seat66') AS t(x text);
SELECT * FROM dblink_get_result('seat66') AS t(x text);

SELECT pg_temp.assert(
  (SELECT array_agg(status ORDER BY id) FROM public.event_registrations
    WHERE id IN ('66900000-0000-0000-0000-000000000002', '66900000-0000-0000-0000-000000000003'))
  = ARRAY['cancelled', 'cancelled'],
  '66/zbiorczy: anulowanie prowadzacego (z kaskada na goscia) przeszlo bez zakleszczenia');
SELECT pg_temp.assert(
  (SELECT res FROM out66 WHERE who = 'batch') NOT LIKE 'ERROR%'
  AND ((SELECT res FROM out66 WHERE who = 'batch')::jsonb->>'applied')::integer = 0
  AND (SELECT array_agg(e->>'code' ORDER BY ord)
         FROM jsonb_array_elements((SELECT res FROM out66 WHERE who = 'batch')::jsonb->'rejected')
              WITH ORDINALITY AS r(e, ord))
      = ARRAY['registration_not_seatable', 'registration_not_seatable'],
  '66/zbiorczy: obie pozycje odrzucone z registration_not_seatable (stan PO anulowaniu)');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_seat_assignments a
               WHERE a.map_id = pg_temp.v66('map') AND a.released_at IS NULL),
  '66/zbiorczy: w planie nie zostal zaden aktywny przydzial');

-- ---------------------------------------------------------------------------
-- SPRZATANIE
-- ---------------------------------------------------------------------------
SELECT dblink_disconnect('seat66');
DROP TABLE out66;
DROP TABLE t66;
DROP EXTENSION dblink;
DELETE FROM public.domain_events WHERE tenant_id = '66000000-0000-0000-0000-0000000000a0';
DELETE FROM public.tenants WHERE id = '66000000-0000-0000-0000-0000000000a0';
DELETE FROM auth.users WHERE id = '66a00000-0000-0000-0000-0000000000a1';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '66000000-0000-0000-0000-0000000000a0')
  AND NOT EXISTS (SELECT 1 FROM public.event_seat_maps WHERE tenant_id = '66000000-0000-0000-0000-0000000000a0')
  AND NOT EXISTS (SELECT 1 FROM public.event_registrations WHERE tenant_id = '66000000-0000-0000-0000-0000000000a0')
  AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '66a00000-0000-0000-0000-0000000000a1'),
  '66: sprzatanie - faza dwoch sesji nie zostawila wierszy');

\echo '== 66 plan sali: kolejnosc blokad - koniec =='
