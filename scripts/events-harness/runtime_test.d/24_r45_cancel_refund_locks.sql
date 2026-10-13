-- ============================================================================
-- 24_r45_cancel_refund_locks - PRZEGLAD R45: ODWOLANIE WYDARZENIA ZE ZWROTAMI,
-- USUWANIE Z PIENIEDZMI, KOLEJNOSC BLOKAD ZAPISUJACYCH MIEJSCA
-- (REG-03, REG-08; migracje 20261012181000..20261012181500)
--
-- PO CO TEN PLIK ISTNIEJE
-- pgTAP (supabase/tests/event_refund_r45_test.sql) przypina reguly na pelnym
-- schemacie w jednej transakcji. Tu: te same reguly na REPLAYU modulu oraz to,
-- czego jedna transakcja nie pokaze - zakleszczenia dwoch sesji.
--
-- CO SPRAWDZA
--   FAZA 1 (jedna transakcja, ROLLBACK):
--     1. Odwolanie wydarzenia (RPC organizatora) zamyka oplacone zgloszenie,
--        zleca pelny zwrot organizer_cancelled i dzwoni RAZ; bezplatne bez zmian.
--     2. Usuniecie wydarzenia z pieniedzmi -> event_has_payments.
--   FAZA 2 (zacommitowana, dwie sesje `dblink`, wzor 29_ i 75_):
--     A. Zakup pakietu i awans z kolejki na tym samym bilecie rownoczesnie -
--        bez 40P01. Stare `_event_package_purchase` blokowalo bilet przed
--        wydarzeniem (klucz obcy zamowienia = KEY SHARE na wydarzeniu), awans
--        - wydarzenie przed biletem (przeglad R45 p5).
--     B. Rezygnacja uczestnika i webhook zwrotu TEGO SAMEGO zgloszenia
--        rownoczesnie - bez 40P01, obie sesje koncza sie wynikiem, zgloszenie
--        cancelled + refunded, zlecenie zakonczone. Stary wynik platnosci
--        blokowal zamowienie i zgloszenie przed biletem i wydarzeniem
--        (przeglad R45 p7).
--   W kazdym wariancie sesja glowna trzyma wiersz, na ktorym obie sesje
--   MUSZA czekac, a asercja dowodzi, ze naprawde czekaja, zanim go zwolni.
--
-- SPRZATANIE: faza 1 - ROLLBACK; faza 2 usuwa wlasnego najemce (kaskada),
-- konta i rozszerzenie dblink i sprawdza, ze nic nie zostalo.
-- ============================================================================
\echo '== 24 R45 odwolanie wydarzenia, usuwanie z pieniedzmi, kolejnosc blokad =='

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('45240000-0000-4000-8000-0000000000a1', 'r45-admin@example.test'),
  ('45240000-0000-4000-8000-0000000000c1', 'r45-owner@example.test');
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('45240000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('45240000-0000-4000-8000-0000000000c1', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.user_roles (user_id, role) VALUES ('45240000-0000-4000-8000-0000000000a1', 'admin');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode) VALUES
  ('45241000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'r45-cancel',
   'Odwolane R45', 'Cancelled R45', now() + interval '10 days', 'published', 'form');
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency) VALUES
  ('45242000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '45241000-0000-4000-8000-000000000001', 'r45_cancel', 'Wstep', 'Admission', 10000, 'PLN');
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('45243000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '45240000-0000-4000-8000-0000000000c1', 'r45-owner@example.test', 'Ola', 'Oplacona'),
  ('45243000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   NULL, 'r45-free@example.test', 'Bartek', 'Bezplatny');
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, provider,
                                   environment, provider_payment_intent_id, paid_at, metadata)
VALUES ('45245000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
        '45240000-0000-4000-8000-0000000000c1', 'paid', 10000, 'PLN', 'stripe', 'sandbox', 'pi_r45_h1', now(),
        jsonb_build_object('event_id', '45241000-0000-4000-8000-000000000001',
                           'registration_id', '45244000-0000-4000-8000-000000000001',
                           'ticket_type_id', '45242000-0000-4000-8000-000000000001'));
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
                                        registration_mode, payment_status, payment_order_id, paid_at) VALUES
  ('45244000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   '45241000-0000-4000-8000-000000000001', '45243000-0000-4000-8000-000000000001',
   '45242000-0000-4000-8000-000000000001', 'approved', 'form', 'paid',
   '45245000-0000-4000-8000-000000000001', now()),
  ('45244000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   '45241000-0000-4000-8000-000000000001', '45243000-0000-4000-8000-000000000002',
   NULL, 'approved', 'form', 'not_required', NULL, NULL);

-- ── 1. Odwolanie wydarzenia przez organizatora ───────────────────────────────
SELECT pg_temp.act_as('45240000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.admin_event_set_status('45241000-0000-4000-8000-000000000001', 'cancelled') = 'cancelled',
  '24-R45/1: organizator odwoluje wydarzenie z oplaconym zgloszeniem');
SELECT pg_temp.assert(
  (SELECT r.status = 'cancelled' AND r.payment_status = 'paid' AND r.qr_token_hash IS NULL
     FROM public.event_registrations r WHERE r.id = '45244000-0000-4000-8000-000000000001')
  AND (SELECT j.state = 'pending' AND j.origin = 'organizer_cancelled' AND j.amount_cents = 10000
         FROM public.event_registration_refund_jobs j
        WHERE j.payment_order_id = '45245000-0000-4000-8000-000000000001'),
  '24-R45/1 KRYTERIUM: odwolanie zamyka oplacone zgloszenie i zleca pelny zwrot organizer_cancelled');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.notifications n
    WHERE n.user_id = '45240000-0000-4000-8000-0000000000a1'
      AND n.href = '/admin/events/45241000-0000-4000-8000-000000000001/registration/list') = 1
  AND (SELECT r.status = 'approved' FROM public.event_registrations r
        WHERE r.id = '45244000-0000-4000-8000-000000000002'),
  '24-R45/1: jeden zbiorczy dzwonek, bezplatne zgloszenie bez zmian');

-- ── 2. Usuniecie wydarzenia z pieniedzmi ─────────────────────────────────────
SELECT pg_temp.assert_raises_like(
  $$DELETE FROM public.events WHERE id = '45241000-0000-4000-8000-000000000001'$$,
  'event_has_payments', '24-R45/2: wydarzenie z oplaconym zgloszeniem i zleceniem zwrotu nie znika');

SELECT pg_temp.act_as(NULL, NULL);
ROLLBACK;

-- ############################################################################
-- FAZA 2: DWIE SESJE (zacommitowane fikstury, wlasny najemca)
-- ############################################################################
\echo '== 24 R45 kolejnosc blokad: dwie sesje =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug)
VALUES ('45454545-4545-4545-8545-454545454545', 'Tenant 45 (blokady R45)', 't45-locks');
INSERT INTO auth.users (id, email) VALUES
  ('45000000-0000-4000-8000-0000000000b1', 'buyer.45@example.org'),
  ('45000000-0000-4000-8000-0000000000c1', 'owner.45@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('45000000-0000-4000-8000-0000000000b1', '45454545-4545-4545-8545-454545454545'),
  ('45000000-0000-4000-8000-0000000000c1', '45454545-4545-4545-8545-454545454545')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode) VALUES
  ('45100000-0000-4000-8000-0000000000a1', '45454545-4545-4545-8545-454545454545', 't45-package',
   'Pakiety R45', 'Packages R45', now() + interval '20 days', 'published', 'form'),
  ('45100000-0000-4000-8000-0000000000b1', '45454545-4545-4545-8545-454545454545', 't45-refund',
   'Zwrot R45', 'Refund R45', now() + interval '20 days', 'published', 'form');
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, quota) VALUES
  ('45200000-0000-4000-8000-0000000000a1', '45454545-4545-4545-8545-454545454545',
   '45100000-0000-4000-8000-0000000000a1', 't45_pkg', 'Wstep', 'Admission', 10000, 'PLN', 100),
  ('45200000-0000-4000-8000-0000000000b1', '45454545-4545-4545-8545-454545454545',
   '45100000-0000-4000-8000-0000000000b1', 't45_ref', 'Wstep', 'Admission', 10000, 'PLN', 100);
INSERT INTO public.event_ticket_packages (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en,
                                          seats, price_cents, currency) VALUES
  ('45300000-0000-4000-8000-0000000000a1', '45454545-4545-4545-8545-454545454545',
   '45100000-0000-4000-8000-0000000000a1', '45200000-0000-4000-8000-0000000000a1', 't45_pack',
   'Pakiet', 'Package', 2, 20000, 'PLN');
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('45400000-0000-4000-8000-0000000000c1', '45454545-4545-4545-8545-454545454545',
   '45000000-0000-4000-8000-0000000000c1', 'owner.45@example.org', 'Dora', 'Zwrot');
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, provider,
                                   environment, provider_payment_intent_id, paid_at, metadata)
VALUES ('45500000-0000-4000-8000-0000000000b1', '45454545-4545-4545-8545-454545454545',
        '45000000-0000-4000-8000-0000000000c1', 'paid', 10000, 'PLN', 'stripe', 'sandbox', 'pi_t45_ref', now(),
        jsonb_build_object('event_id', '45100000-0000-4000-8000-0000000000b1',
                           'registration_id', '45600000-0000-4000-8000-0000000000b1',
                           'ticket_type_id', '45200000-0000-4000-8000-0000000000b1'));
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
                                        registration_mode, payment_status, payment_order_id, paid_at)
VALUES ('45600000-0000-4000-8000-0000000000b1', '45454545-4545-4545-8545-454545454545',
        '45100000-0000-4000-8000-0000000000b1', '45400000-0000-4000-8000-0000000000c1',
        '45200000-0000-4000-8000-0000000000b1', 'approved', 'form', 'paid',
        '45500000-0000-4000-8000-0000000000b1', now());

CREATE TEMP TABLE r45_out (variant text, who text, res text, err text, PRIMARY KEY (variant, who));
CREATE TEMP TABLE r45_pid (who text PRIMARY KEY, pid integer NOT NULL);

SELECT dblink_connect('r45a', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
SELECT dblink_connect('r45b', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
INSERT INTO r45_pid SELECT 'r45a', x::integer FROM dblink('r45a', 'SELECT pg_backend_pid()') AS t(x text);
INSERT INTO r45_pid SELECT 'r45b', x::integer FROM dblink('r45b', 'SELECT pg_backend_pid()') AS t(x text);

SELECT pg_temp.assert(
  (SELECT count(DISTINCT pid) FROM r45_pid) = 2
  AND NOT EXISTS (SELECT 1 FROM r45_pid WHERE pid = pg_backend_pid()),
  '24-R45/wyscig: dwie OSOBNE sesje serwera, rozne od sesji glownej');

-- Czeka, az wskazana sesja stoi na blokadzie (pg_stat_clear_snapshot - patrz
-- 20_registration.sql).
CREATE FUNCTION pg_temp.r45_wait(_who text, _label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 300 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked
      FROM pg_stat_activity a JOIN r45_pid p ON p.pid = a.pid
     WHERE p.who = _who AND a.wait_event_type = 'Lock';
    EXIT WHEN v_blocked >= 1;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  PERFORM pg_temp.assert(v_blocked = 1, _label);
END $$;

-- Wynik albo komunikat bledu sesji (fail = false: blad zdalny trafia do asercji).
CREATE FUNCTION pg_temp.r45_collect(_variant text, _conn text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_res text; v_err text;
BEGIN
  SELECT x INTO v_res FROM dblink_get_result(_conn, false) AS t(x text);
  v_err := NULLIF(dblink_error_message(_conn), 'OK');
  PERFORM 1 FROM dblink_get_result(_conn, false) AS t(x text);
  IF v_err IS NOT NULL THEN
    -- Diagnostyka: przy zakleszczeniu widac tu `deadlock detected`.
    RAISE NOTICE '24-R45/% %: %', _variant, _conn, left(v_err, 160);
  END IF;
  INSERT INTO r45_out VALUES (_variant, _conn, v_res, v_err);
END $$;

-- ---------------------------------------------------------------------------
-- A) ZAKUP PAKIETU vs AWANS Z KOLEJKI (ten sam bilet)
-- Sesja glowna trzyma wiersz pakietu: zakup (r45a) zatrzymuje sie MIEDZY
-- blokada biletu/wydarzenia a pakietem, awans (r45b) bierze wydarzenie ->
-- bilet. Stara kolejnosc zakupu (bilet, potem wydarzenie kluczem obcym)
-- konczyla sie 40P01.
-- ---------------------------------------------------------------------------
-- Najemca kupujacego: atrapa `_caller_tenant()` czyta `nes.tenant`.
SELECT x FROM dblink('r45a', $$SELECT set_config('nes.tenant', '45454545-4545-4545-8545-454545454545', false)$$) AS t(x text);

BEGIN;
SELECT 1 FROM public.event_ticket_packages WHERE id = '45300000-0000-4000-8000-0000000000a1' FOR UPDATE;
SELECT dblink_send_query('r45a', $$SELECT public.event_package_purchase_for_user(
  '45454545-4545-4545-8545-454545454545', '45000000-0000-4000-8000-0000000000b1',
  'ip:0123456789abcdef0123456789abcdef',
  '{"package_id":"45300000-0000-4000-8000-0000000000a1","buyer_name":"Buyer Co"}'::jsonb)$$);
SELECT pg_temp.r45_wait('r45a', '24-R45/A DOWOD: zakup pakietu czeka na wierszu pakietu');
SELECT dblink_send_query('r45b', $$SELECT public._event_waitlist_promote(
  '45454545-4545-4545-8545-454545454545', '45100000-0000-4000-8000-0000000000a1',
  '45200000-0000-4000-8000-0000000000a1', 1, NULL)$$);
SELECT pg_temp.r45_wait('r45b', '24-R45/A DOWOD: awans z kolejki czeka na blokadzie');
COMMIT;
SELECT pg_temp.r45_collect('A', 'r45a');
SELECT pg_temp.r45_collect('A', 'r45b');

SELECT pg_temp.assert(
  (SELECT count(*) FROM r45_out WHERE variant = 'A' AND err IS NULL AND res IS NOT NULL) = 2,
  '24-R45/A REG-08: zakup pakietu i awans koncza sie wynikiem - bez zakleszczenia (40P01)');
SELECT pg_temp.assert(
  (SELECT res::jsonb ? 'order_id' FROM r45_out WHERE variant = 'A' AND who = 'r45a')
  AND (SELECT sold_count = 2 FROM public.event_ticket_types WHERE id = '45200000-0000-4000-8000-0000000000a1'),
  '24-R45/A: zakup zapisal zamowienie i dwa miejsca w puli biletu');

-- ---------------------------------------------------------------------------
-- B) REZYGNACJA vs WEBHOOK ZWROTU (to samo zgloszenie)
-- Sesja glowna trzyma bilet: rezygnacja (r45b) czeka z wydarzeniem w reku,
-- webhook (r45a) musi czekac na wydarzeniu, nie trzymajac zamowienia ani
-- zgloszenia. Stary webhook blokowal zamowienie i zgloszenie, a czekal na
-- bilet (trigger sold_count) - 40P01.
-- ---------------------------------------------------------------------------
SELECT x FROM dblink('r45b', $$SELECT set_config('nes.public_tenant', '45454545-4545-4545-8545-454545454545', false)$$) AS t(x text);
SELECT x FROM dblink('r45b', $$SELECT set_config('request.jwt.claim.sub', '45000000-0000-4000-8000-0000000000c1', false)$$) AS t(x text);

BEGIN;
SELECT 1 FROM public.event_ticket_types WHERE id = '45200000-0000-4000-8000-0000000000b1' FOR UPDATE;
SELECT dblink_send_query('r45b', $$SELECT public.event_registration_cancel(
  '{"registration_id":"45600000-0000-4000-8000-0000000000b1","acknowledged_effect":"full_refund"}'::jsonb)$$);
SELECT pg_temp.r45_wait('r45b', '24-R45/B DOWOD: rezygnacja czeka na bilecie (wydarzenie w reku)');
SELECT dblink_send_query('r45a', $$SELECT public.payments_apply_event_ticket_outcome(
  '45500000-0000-4000-8000-0000000000b1', 'refunded')$$);
SELECT pg_temp.r45_wait('r45a', '24-R45/B DOWOD: webhook zwrotu czeka na blokadzie');
COMMIT;
SELECT pg_temp.r45_collect('B', 'r45a');
SELECT pg_temp.r45_collect('B', 'r45b');

SELECT pg_temp.assert(
  (SELECT count(*) FROM r45_out WHERE variant = 'B' AND err IS NULL AND res IS NOT NULL) = 2,
  '24-R45/B REG-08: rezygnacja i webhook zwrotu koncza sie wynikiem - bez zakleszczenia (40P01)');
SELECT pg_temp.assert(
  (SELECT r.status = 'cancelled' AND r.payment_status = 'refunded'
     FROM public.event_registrations r WHERE r.id = '45600000-0000-4000-8000-0000000000b1')
  AND (SELECT j.state = 'completed' FROM public.event_registration_refund_jobs j
        WHERE j.payment_order_id = '45500000-0000-4000-8000-0000000000b1'),
  '24-R45/B: zgloszenie anulowane i zwrocone, zlecenie zwrotu zakonczone');

SELECT dblink_disconnect('r45a');
SELECT dblink_disconnect('r45b');
DROP TABLE r45_out;
DROP TABLE r45_pid;
DROP EXTENSION dblink;

-- Sprzatanie: zlecenia (klucz obcy NO ACTION do wydarzenia), zamowienia,
-- pakiety, potem najemca kaskada (straznik usuwania przepuszcza kaskade).
DELETE FROM public.event_registration_refund_jobs WHERE tenant_id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.domain_events WHERE tenant_id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.notifications WHERE user_id IN ('45000000-0000-4000-8000-0000000000b1', '45000000-0000-4000-8000-0000000000c1');
DELETE FROM public.event_package_seats WHERE tenant_id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.event_package_orders WHERE tenant_id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.event_registrations WHERE tenant_id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.payment_orders WHERE tenant_id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.tenants WHERE id = '45454545-4545-4545-8545-454545454545';
DELETE FROM public.profiles WHERE id IN ('45000000-0000-4000-8000-0000000000b1', '45000000-0000-4000-8000-0000000000c1');
DELETE FROM auth.users WHERE id IN ('45000000-0000-4000-8000-0000000000b1', '45000000-0000-4000-8000-0000000000c1');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = '45454545-4545-4545-8545-454545454545')
  AND NOT EXISTS (SELECT 1 FROM public.events WHERE tenant_id = '45454545-4545-4545-8545-454545454545'),
  '24-R45: sprzatanie - plik nie zostawil ani jednego wiersza');
