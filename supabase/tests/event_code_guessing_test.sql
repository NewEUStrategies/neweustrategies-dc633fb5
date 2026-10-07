-- pgTAP: kody wydarzen i kupony - limit prob i jedna odpowiedz dla pudla
-- (migracje 20261001100000_event_code_guessing_lockdown, blizniak drizzle 0116,
-- i 20261001210000_event_code_scalar_verdicts, blizniak drizzle 0118: wynik
-- skalarny walidatorow i zakup pakietu bez wyjatku po pudle; dalej
-- 20261007120200_plan_coupon_server_only: kod na plan i rezerwacja uzycia tylko
-- z serwera, z jawnym najemca, kontem i kubelkiem pudel po adresie;
-- 20261007120600_event_codes_server_only: to samo dla kodow WYDARZEN -
-- walidacja kodu na bilet, wycena i zakup pakietu tylko z serwera).
--
-- DEFEKT (audyt wydania 12, 16.8 i 16.15 pkt 6): `validate_b2b_coupon` byl
-- wykonywalny dla PUBLIC i anon, `event_coupon_revealed_tickets` dla anon,
-- zadna droga nie miala limitu prob, a odmowy oddawaly coupon_id, nazwe
-- i rabat kodu - kod innego wydarzenia, wylaczony albo tylko planowy byl
-- odroznialny od pudla. Kody wpisuje administrator, wiec sa krotkie i da sie
-- je zgadywac.
--
-- AKCEPTACJA Z AUDYTU, sprawdzana tutaj na poziomie, na ktorym limit dziala
-- (kubelek pudel w bazie): trzydziesta pierwsza proba w oknie konczy sie
-- odmowa, a odpowiedz dla kodu z innego wydarzenia jest nieodroznialna od
-- pudla. Kubelek IP przed odslanianiem biletow siedzi w TS
-- (src/lib/events/codeProbeLimit.server.ts) i ma testy vitest.
--
-- AKCEPTACJA N-13-1 (audyt ed13): kod na plan zalogowany sprawdza WYLACZNIE
-- przez serwer (`validate_b2b_coupon_for_user`, tylko service_role), a baza
-- liczy pudla takze po adresie - farma kont za jednym adresem dostaje odmowe
-- po 120 pudlach, bez wzgledu na liczbe kont. To samo dla kodow wydarzen
-- (zadanie „Close IP-bucket bypass for event ticket codes"): walidacja kodu na
-- bilet, wycena i zakup pakietu licza pudla w TYM SAMYM kubelku adresu.
--
-- now() jest staly w transakcji, wiec cala proba siedzi w jednym oknie
-- kubelka - granica okna nie moze rozjechac licznika w trakcie testu.
--
-- ZASADA PRZYPIETA TUTAJ: funkcja, ktora zlicza pudlo, zwraca skalar (PostgREST
-- nie filtruje skalara, wiec nie wymusi wycofania transakcji zaleznie od
-- odpowiedzi) i po zapisaniu pudla nie rzuca wyjatku (zakup pakietu).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(78);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ec0a0000-0000-0000-0000-0000000000aa', 'ecg-tenant-a', 'ECG Tenant A', 'ecg-a.example'),
  ('ec0b0000-0000-0000-0000-0000000000bb', 'ecg-tenant-b', 'ECG Tenant B', 'ecg-b.example');

-- a1 - zgadujacy (kubelek), a2 - jednolite odpowiedzi, a3 - trafienia nie
-- zjadaja kubelka, a4 - wycena wejsciowki. Kazdy ma WLASNY kubelek.
INSERT INTO auth.users (id, email) VALUES
  ('ec000000-0000-0000-0000-0000000000a1', 'ecg-u1@example.org'),
  ('ec000000-0000-0000-0000-0000000000a2', 'ecg-u2@example.org'),
  ('ec000000-0000-0000-0000-0000000000a3', 'ecg-u3@example.org'),
  ('ec000000-0000-0000-0000-0000000000a4', 'ecg-u4@example.org'),
  ('ec000000-0000-0000-0000-0000000000a5', 'ecg-u5@example.org'),
  ('ec000000-0000-0000-0000-0000000000a6', 'ecg-u6@example.org'),
  ('ec000000-0000-0000-0000-0000000000f1', 'ecg-farm1@example.org'),
  ('ec000000-0000-0000-0000-0000000000f2', 'ecg-farm2@example.org'),
  ('ec000000-0000-0000-0000-0000000000f3', 'ecg-farm3@example.org'),
  ('ec000000-0000-0000-0000-0000000000f4', 'ecg-farm4@example.org'),
  ('ec000000-0000-0000-0000-0000000000f5', 'ecg-farm5@example.org'),
  ('ec000000-0000-0000-0000-0000000000f6', 'ecg-farm6@example.org'),
  ('ec000000-0000-0000-0000-0000000000b1', 'ecg-buyer@example.org'),
  ('ec000000-0000-0000-0000-0000000000c1', 'ecg-efarm1@example.org'),
  ('ec000000-0000-0000-0000-0000000000c2', 'ecg-efarm2@example.org'),
  ('ec000000-0000-0000-0000-0000000000c3', 'ecg-efarm3@example.org'),
  ('ec000000-0000-0000-0000-0000000000c4', 'ecg-efarm4@example.org'),
  ('ec000000-0000-0000-0000-0000000000c5', 'ecg-efarm5@example.org'),
  ('ec000000-0000-0000-0000-0000000000c6', 'ecg-efarm6@example.org');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ec000000-0000-0000-0000-0000000000a1', 'ecg-u1@example.org', 'ECG U1', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a2', 'ecg-u2@example.org', 'ECG U2', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a3', 'ecg-u3@example.org', 'ECG U3', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a4', 'ecg-u4@example.org', 'ECG U4', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a5', 'ecg-u5@example.org', 'ECG U5', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000a6', 'ecg-u6@example.org', 'ECG U6', 'ec0a0000-0000-0000-0000-0000000000aa'),
  -- konta farmy kodow wydarzen: wycena czyta najemce z PROFILU wolajacego
  ('ec000000-0000-0000-0000-0000000000c1', 'ecg-efarm1@example.org', 'ECG C1', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000c2', 'ecg-efarm2@example.org', 'ECG C2', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000c3', 'ecg-efarm3@example.org', 'ECG C3', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000c4', 'ecg-efarm4@example.org', 'ECG C4', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000c5', 'ecg-efarm5@example.org', 'ECG C5', 'ec0a0000-0000-0000-0000-0000000000aa'),
  ('ec000000-0000-0000-0000-0000000000c6', 'ecg-efarm6@example.org', 'ECG C6', 'ec0a0000-0000-0000-0000-0000000000aa');

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('ec100000-0000-0000-0000-0000000000e1', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ecg-event-1', 'ECG 1', 'ECG 1', '2030-06-10 08:00+00', 'published'),
  ('ec100000-0000-0000-0000-0000000000e2', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ecg-event-2', 'ECG 2', 'ECG 2', '2030-06-11 08:00+00', 'published'),
  ('ec100000-0000-0000-0000-0000000000eb', 'ec0b0000-0000-0000-0000-0000000000bb',
   'ecg-event-b', 'ECG B', 'ECG B', '2030-06-12 08:00+00', 'published');

-- f1 ukryty i f2 publiczny w wydarzeniu 1, fb ukryty w wydarzeniu najemcy B.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, is_hidden) VALUES
  ('ec200000-0000-0000-0000-0000000000f1', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ecg_vip', 'VIP', 'VIP', 50000, 'PLN', true),
  ('ec200000-0000-0000-0000-0000000000f2', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ecg_std', 'Standard', 'Standard', 20000, 'PLN', false),
  ('ec200000-0000-0000-0000-0000000000fb', 'ec0b0000-0000-0000-0000-0000000000bb',
   'ec100000-0000-0000-0000-0000000000eb', 'ecg_vip_b', 'VIP B', 'VIP B', 50000, 'PLN', true);

INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, discount_percent, active, valid_until,
   event_ids, ticket_type_ids, applies_discount, reveals_hidden) VALUES
  -- kod planu (bez wydarzen)
  ('ec300000-0000-0000-0000-000000000001', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-PLAN10', 'Plan 10', 'percent', 10, true, NULL, '{}', '{}', true, false),
  -- kod wydarzenia 1 i kod wydarzenia 2
  ('ec300000-0000-0000-0000-000000000002', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-E1', 'Event 1', 'percent', 20, true, NULL,
   ARRAY['ec100000-0000-0000-0000-0000000000e1']::uuid[], '{}', true, false),
  ('ec300000-0000-0000-0000-000000000003', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-E2', 'Event 2', 'percent', 20, true, NULL,
   ARRAY['ec100000-0000-0000-0000-0000000000e2']::uuid[], '{}', true, false),
  -- kod wylaczony i kod wygasly (oba planowe)
  ('ec300000-0000-0000-0000-000000000004', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-OFF', 'Off', 'percent', 30, false, NULL, '{}', '{}', true, false),
  ('ec300000-0000-0000-0000-000000000005', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-OLD', 'Old', 'percent', 30, true, now() - interval '1 day', '{}', '{}', true, false),
  -- kod wydarzenia 1 tylko na bilet Standard
  ('ec300000-0000-0000-0000-000000000006', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-STDONLY', 'Std only', 'percent', 15, true, NULL,
   ARRAY['ec100000-0000-0000-0000-0000000000e1']::uuid[],
   ARRAY['ec200000-0000-0000-0000-0000000000f2']::uuid[], true, false);

-- kod tylko planowy (niepuste plan_ids). Kod bez plan_ids i bez event_ids
-- (ECG-PLAN10) jest GLOBALNY i od dawna dziala tez na bilety - to nie pudlo.
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, discount_percent, plan_ids) VALUES
  ('ec300000-0000-0000-0000-000000000009', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-PLANONLY', 'Plan only', 'percent', 10,
   ARRAY['ec400000-0000-0000-0000-000000000001']::uuid[]);

-- kod innego wydarzenia, ktory do tego WYGASL: dawniej wycena odpowiadala na
-- niego `coupon_expired` (zakres wydarzenia sprawdzany po waznosci)
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, discount_percent, valid_until, event_ids) VALUES
  ('ec300000-0000-0000-0000-00000000000a', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-E2-OLD', 'Event 2 old', 'percent', 20, now() - interval '1 day',
   ARRAY['ec100000-0000-0000-0000-0000000000e2']::uuid[]);

-- pakiet publiczny w wydarzeniu 1 (miejsca to bilet Standard)
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience, seats, price_cents, currency) VALUES
  ('ec500000-0000-0000-0000-0000000000a1', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2',
   'ecg_pakiet', 'Pakiet ECG', 'ECG pack', 'public', 3, 60000, 'PLN');

-- kody odslaniajace (bez rabatu) w obu najemcach
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, active, event_ids, applies_discount, reveals_hidden) VALUES
  ('ec300000-0000-0000-0000-000000000007', 'ec0a0000-0000-0000-0000-0000000000aa',
   'ECG-VIP', 'VIP reveal', 'percent', true,
   ARRAY['ec100000-0000-0000-0000-0000000000e1']::uuid[], false, true),
  ('ec300000-0000-0000-0000-000000000008', 'ec0b0000-0000-0000-0000-0000000000bb',
   'ECG-VIP', 'VIP reveal B', 'percent', true,
   ARRAY['ec100000-0000-0000-0000-0000000000eb']::uuid[], false, true);

-- ── 1-14. Uprawnienia ───────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.validate_b2b_coupon(text,uuid,integer,text)', 'EXECUTE'),
  'anon NIE ma EXECUTE na validate_b2b_coupon (wczesniej GRANT anon i PUBLIC)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
               WHERE p.oid = 'public.validate_b2b_coupon(text,uuid,integer,text)'::regprocedure
                 AND a.grantee = 0),
  'PUBLIC NIE ma EXECUTE na validate_b2b_coupon');
SELECT ok(NOT has_function_privilege('authenticated', 'public.validate_b2b_coupon(text,uuid,integer,text)', 'EXECUTE'),
  'authenticated NIE ma EXECUTE na validate_b2b_coupon - zapytanie PostgREST wprost omijalo kubelek adresu (N-13-1)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.validate_b2b_coupon_for_user(uuid,uuid,text,text,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.validate_b2b_coupon_for_user(uuid,uuid,text,text,uuid,integer,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.validate_b2b_coupon_for_user(uuid,uuid,text,text,uuid,integer,text)', 'EXECUTE'),
  'validate_b2b_coupon_for_user wykonuje WYLACZNIE service_role (serwer zna adres i sesje)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.redeem_b2b_coupon(uuid,uuid,integer,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.redeem_b2b_coupon(uuid,uuid,integer,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.redeem_b2b_coupon_for_user(uuid,uuid,uuid,uuid,integer,integer,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.redeem_b2b_coupon_for_user(uuid,uuid,uuid,uuid,integer,integer,text)', 'EXECUTE'),
  'rezerwacja uzycia kodu tylko z serwera - zalogowany nie zuzyje puli kodu bez zamowienia');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.b2b_coupon_redemptions', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.b2b_coupon_redemptions', 'INSERT'),
  'b2b_coupon_redemptions: zapis wylacznie przez funkcje (bez INSERT dla klienta)');
SELECT ok(NOT has_function_privilege('anon', 'public.validate_event_ticket_coupon(text,uuid,uuid,integer,text)', 'EXECUTE'),
  'anon NIE ma EXECUTE na validate_event_ticket_coupon');
SELECT ok(NOT has_function_privilege('anon', 'public.event_coupon_revealed_tickets(uuid,uuid,text)', 'EXECUTE'),
  'anon NIE ma EXECUTE na odslanianiu biletow');
SELECT ok(NOT has_function_privilege('authenticated', 'public.event_coupon_revealed_tickets(uuid,uuid,text)', 'EXECUTE'),
  'authenticated NIE ma EXECUTE na odslanianiu biletow (limit IP stoi w funkcji serwerowej)');
SELECT ok(has_function_privilege('service_role', 'public.event_coupon_revealed_tickets(uuid,uuid,text)', 'EXECUTE'),
  'service_role ma EXECUTE na odslanianiu biletow');
SELECT ok(to_regprocedure('public.event_coupon_revealed_tickets(uuid,text)') IS NULL,
  'dwuargumentowe odslanianie (wyrocznia dla anon) nie istnieje');
SELECT ok(NOT has_function_privilege('anon', 'public.event_admission_quote(jsonb)', 'EXECUTE'),
  'anon NIE ma EXECUTE na event_admission_quote');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.validate_event_ticket_coupon(text,uuid,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_admission_quote(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_package_purchase(jsonb)', 'EXECUTE'),
  'authenticated NIE ma EXECUTE na walidacji kodu na bilet, wycenie i zakupie pakietu - PostgREST wprost omijal kubelek adresu');
SELECT ok(
  NOT has_function_privilege('anon', 'public.validate_event_ticket_coupon_for_user(uuid,uuid,text,text,uuid,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.validate_event_ticket_coupon_for_user(uuid,uuid,text,text,uuid,uuid,integer,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.validate_event_ticket_coupon_for_user(uuid,uuid,text,text,uuid,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_admission_quote_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_admission_quote_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_admission_quote_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)', 'EXECUTE'),
  'wersje *_for_user kodow wydarzen wykonuje WYLACZNIE service_role (serwer zna adres i sesje)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._set_request_identity(text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._set_request_identity(text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._require_server_identity(uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._validate_event_ticket_coupon(uuid,uuid,text,text,uuid,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_admission_quote(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_package_purchase(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_package_purchase(jsonb,text)', 'EXECUTE'),
  'rdzenie i ustawianie tozsamosci zadania sa niedostepne dla anon i authenticated');
SELECT ok(
  NOT has_function_privilege('anon', 'public._coupon_probe_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._coupon_probe_guard()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._coupon_probe_miss()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._coupon_probe_miss()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._coupon_probe_bucket(uuid)', 'EXECUTE'),
  'pomocnicze funkcje kubelka sa niedostepne dla anon i authenticated');
SELECT ok(NOT has_function_privilege('authenticated',
    'public.redeem_b2b_coupon_with_effects(uuid,uuid,integer,integer,text)', 'EXECUTE'),
  'authenticated NIE ma EXECUTE na wycofanej redeem_b2b_coupon_with_effects (warstwa bez platnosci)');
SELECT ok(NOT has_function_privilege('anon',
    'public.redeem_b2b_coupon_with_effects(uuid,uuid,integer,integer,text)', 'EXECUTE'),
  'anon NIE ma EXECUTE na redeem_b2b_coupon_with_effects');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
               WHERE p.oid IN ('public.validate_event_ticket_coupon(text,uuid,uuid,integer,text)'::regprocedure,
                               'public.event_coupon_revealed_tickets(uuid,uuid,text)'::regprocedure,
                               'public.event_admission_quote(jsonb)'::regprocedure,
                               'public._b2b_coupon_evaluate(public.b2b_coupons,integer,text)'::regprocedure,
                               'public._coupon_probe_guard()'::regprocedure,
                               'public._coupon_probe_miss()'::regprocedure,
                               'public._coupon_probe_guard(uuid,text)'::regprocedure,
                               'public._coupon_probe_miss(uuid,text)'::regprocedure,
                               'public._coupon_probe_ip_bucket(text)'::regprocedure,
                               'public._b2b_coupon_evaluate(public.b2b_coupons,integer,text,uuid)'::regprocedure,
                               'public._validate_b2b_coupon(uuid,uuid,text,text,uuid,integer,text)'::regprocedure,
                               'public.validate_b2b_coupon_for_user(uuid,uuid,text,text,uuid,integer,text)'::regprocedure,
                               'public._redeem_b2b_coupon(uuid,uuid,uuid,uuid,integer,integer,text)'::regprocedure,
                               'public.redeem_b2b_coupon_for_user(uuid,uuid,uuid,uuid,integer,integer,text)'::regprocedure,
                               'public.redeem_b2b_coupon(uuid,uuid,integer,integer,text)'::regprocedure,
                               'public._set_request_identity(text,text,text)'::regprocedure,
                               'public._require_server_identity(uuid,uuid,text)'::regprocedure,
                               'public._validate_event_ticket_coupon(uuid,uuid,text,text,uuid,uuid,integer,text)'::regprocedure,
                               'public.validate_event_ticket_coupon_for_user(uuid,uuid,text,text,uuid,uuid,integer,text)'::regprocedure,
                               'public._event_admission_quote(jsonb,text)'::regprocedure,
                               'public.event_admission_quote_for_user(uuid,uuid,text,jsonb)'::regprocedure,
                               'public._event_package_purchase(jsonb,text)'::regprocedure,
                               'public.event_package_purchase(jsonb)'::regprocedure,
                               'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)'::regprocedure)
                 AND a.grantee = 0),
  'PUBLIC nie ma EXECUTE na zadnej funkcji sondy ani rezerwacji kodu');
SELECT is(
  (SELECT string_agg(p.provolatile::text, '' ORDER BY p.proname)
     FROM pg_proc p
    WHERE p.oid IN ('public.validate_b2b_coupon(text,uuid,integer,text)'::regprocedure,
                    'public.validate_b2b_coupon_for_user(uuid,uuid,text,text,uuid,integer,text)'::regprocedure,
                    'public.validate_event_ticket_coupon(text,uuid,uuid,integer,text)'::regprocedure,
                    'public.validate_event_ticket_coupon_for_user(uuid,uuid,text,text,uuid,uuid,integer,text)'::regprocedure,
                    'public.event_admission_quote(jsonb)'::regprocedure,
                    'public.event_admission_quote_for_user(uuid,uuid,text,jsonb)'::regprocedure,
                    'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)'::regprocedure)),
  'vvvvvvv',
  'walidacja i wycena sa VOLATILE (PostgREST wykonuje STABLE tylko do odczytu, a pudlo jest zapisem)');
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
    WHERE p.oid IN ('public.validate_b2b_coupon(text,uuid,integer,text)'::regprocedure,
                    'public.validate_b2b_coupon_for_user(uuid,uuid,text,text,uuid,integer,text)'::regprocedure,
                    'public.validate_event_ticket_coupon(text,uuid,uuid,integer,text)'::regprocedure,
                    'public.event_admission_quote(jsonb)'::regprocedure,
                    'public.event_package_purchase(jsonb)'::regprocedure,
                    'public.validate_event_ticket_coupon_for_user(uuid,uuid,text,text,uuid,uuid,integer,text)'::regprocedure,
                    'public.event_admission_quote_for_user(uuid,uuid,text,jsonb)'::regprocedure,
                    'public.event_package_purchase_for_user(uuid,uuid,text,jsonb)'::regprocedure)
      AND NOT p.proretset
      AND p.prorettype = 'jsonb'::regtype),
  8,
  'funkcje zliczajace pudlo zwracaja skalar jsonb: PostgREST nie przefiltruje wyniku i nie wycofa zapisu pudla zaleznie od odpowiedzi');

-- ── 15-22. Jedna odpowiedz dla pudla (a2) ───────────────────────────────────
-- Kod na plan: serwer (service_role) z jawnym najemca, kontem i skrotem adresu.
-- Kazde konto ma tu WLASNY skrot adresu, zeby kubelek adresu (120) nie mieszal
-- sie z kubelkiem konta (30); wspolny adres sprawdza sekcja „farma kont".
SELECT set_config('request.headers', '{"x-tenant-host":"ecg-a.example"}', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

SELECT is(
  public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ECG-NIE-MA', NULL, 10000, 'PLN'),
  '{"ok":false,"error":"not_found","coupon_id":null,"discount_cents":0,"final_cents":10000,"label":null,"discount_kind":null,"discount_percent":null}'::jsonb,
  'pudlo na planie: not_found bez danych kodu');
SELECT is(
  public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ECG-E1', NULL, 10000, 'PLN'),
  public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ECG-NIE-MA', NULL, 10000, 'PLN'),
  'kod przypiety do wydarzenia na sciezce planu jest nieodroznialny od pudla (bylo event_not_eligible z id, nazwa i rabatem)');
SELECT is(
  public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ecg-off', NULL, 10000, 'PLN'),
  public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ECG-NIE-MA', NULL, 10000, 'PLN'),
  'kod wylaczony jest nieodroznialny od pudla (bylo inactive z id i nazwa)');
SELECT is(
  public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ECG-OLD', NULL, 10000, 'PLN'),
  '{"ok":false,"error":"expired","coupon_id":null,"discount_cents":0,"final_cents":10000,"label":null,"discount_kind":null,"discount_percent":null}'::jsonb,
  'kod wygasly mowi expired, ale bez id, nazwy, rodzaju i procentu');
SELECT ok(
  (SELECT (v->>'ok')::boolean AND (v->>'coupon_id')::uuid = 'ec300000-0000-0000-0000-000000000001'::uuid
          AND (v->>'discount_cents')::int = 1000
     FROM public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
       'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
       'ECG-PLAN10', NULL, 10000, 'PLN') v),
  'sukces nadal niesie coupon_id i rabat (kasa rezerwuje uzycie po coupon_id)');
SELECT is(
  public.validate_b2b_coupon_for_user('ec0b0000-0000-0000-0000-0000000000bb',
    'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    'ECG-PLAN10', NULL, 10000, 'PLN')->>'error',
  'not_found',
  'najemca z argumentu: kod najemcy A w najemcy B to pudlo (najemca nie przychodzi z naglowka)');
RESET ROLE;

-- Kod na bilet: tez tylko serwer z jawnym kontem i skrotem adresu (20261007120600).
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-E2',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN'),
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-NIE-MA',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN'),
  'kod INNEGO wydarzenia jest nieodroznialny od pudla (akceptacja audytu)');
SELECT is(
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-PLANONLY',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN'),
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-NIE-MA',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN'),
  'kod tylko planowy na bilecie jest nieodroznialny od pudla (bylo plan_not_eligible z id)');
SELECT is(
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-STDONLY',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f1', 50000, 'PLN'),
  '{"ok":false,"error":"ticket_not_eligible","coupon_id":null,"discount_cents":0,"final_cents":50000,"label":null,"discount_kind":null,"discount_percent":null}'::jsonb,
  'kod tego wydarzenia na inny bilet: ticket_not_eligible bez danych kodu');
SELECT is(
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-E2-OLD',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN'),
  public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a2', 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-NIE-MA',
     'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN'),
  'WYGASLY kod innego wydarzenia tez wyglada jak pudlo, a nie jak expired');
RESET ROLE;

-- ── 23-31. Kubelek pudel (a1, a3, service_role) ─────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int
     FROM generate_series(1, 30) g
    WHERE public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
            'ec000000-0000-0000-0000-0000000000a1', 'ip:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
            'ECG-ZGADUJE-' || g, NULL, 10000, 'PLN')->>'error' = 'not_found'),
  30,
  'trzydziesci pudel w oknie dostaje zwykla odpowiedz not_found');
SELECT throws_ok(
  $$SELECT * FROM public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000a1', 'ip:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      'ECG-ZGADUJE-31', NULL, 10000, 'PLN')$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'trzydziesta pierwsza proba w oknie konczy sie odmowa rate_limited (akceptacja audytu)');
SELECT throws_ok(
  $$SELECT * FROM public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000a1', 'ip:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      'ECG-PLAN10', NULL, 10000, 'PLN')$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'przy pelnym kubelku DOBRY kod tez dostaje odmowe - zablokowany nie ma wyroczni');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT * FROM public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a1', 'ip:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'ECG-E1',
      'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN')$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'kubelek jest wspolny dla planu i biletu - zmiana sciezki nie daje nowych prob');
SELECT throws_ok(
  $$SELECT public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a1', 'ip:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', jsonb_build_object(
      'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E1'))$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'kubelek obejmuje tez wycene wejsciowki i pakietu');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss'
      AND subject_id = 'user:ec000000-0000-0000-0000-0000000000a1'),
  30,
  'licznik stoi na 30 - odmowy po zapelnieniu nie dopisuja pudel');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int
     FROM generate_series(1, 35) g
    WHERE (public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
             'ec000000-0000-0000-0000-0000000000a3', 'ip:a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3',
             'ECG-PLAN10', NULL, 10000 + g, 'PLN')->>'ok')::boolean),
  35,
  'trafienia nie zjadaja kubelka: 35 poprawnych walidacji bez odmowy');
SELECT ok(
  (public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
     'ec000000-0000-0000-0000-0000000000a3', 'ip:a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3',
     'ECG-PLAN10', NULL, 10000, 'PLN')->>'ok')::boolean,
  'kubelek jest per uzytkownik: zablokowanie a1 nie dotyka a3');
SELECT is(
  (SELECT count(*)::int FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss.ip'
      AND subject_id = 'ip:a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3'),
  0,
  'trafienia nie zjadaja tez kubelka ADRESU');
RESET ROLE;

-- Sciezka serwisowa (auth.uid() NULL) ma wlasny limiter w TS - straznik
-- w bazie jej nie liczy.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int
     FROM generate_series(1, 35) g
    WHERE public.validate_b2b_coupon('ECG-SERWIS-' || g, NULL, 10000, 'PLN')->>'error' = 'not_found'),
  35,
  'service_role (bez auth.uid()) nie jest liczony w kubelku pudel uzytkownika');
RESET ROLE;

-- ── 32-33. Wycena wejsciowki (a4) ───────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a4', 'ip:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4', jsonb_build_object(
    'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E2')),
  public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a4', 'ip:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4', jsonb_build_object(
    'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-NIE-MA')),
  'wycena: kod innego wydarzenia daje te sama odpowiedz co pudlo (bylo coupon_other_event)');
SELECT is(
  public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a4', 'ip:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4', jsonb_build_object(
    'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E2'))->>'reason',
  'coupon_unknown',
  'wycena: ta odpowiedz to coupon_unknown');
SELECT is(
  public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a4', 'ip:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4', jsonb_build_object(
    'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E2-OLD')),
  public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a4', 'ip:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4', jsonb_build_object(
    'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-NIE-MA')),
  'wycena: WYGASLY kod innego wydarzenia to coupon_unknown, a nie coupon_expired');
RESET ROLE;

-- ── Kody spoza zakresu ZJADAJA kubelek jak pudlo (a5) ───────────────────────
-- Gdyby kod innego wydarzenia, tylko planowy, przypiety do wydarzen na planie
-- albo wylaczony nie liczyl sie jako pudlo, bylby darmowa proba - i dalby sie
-- odroznic od pudla momentem, w ktorym przychodzi odmowa limitu.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a5', 'ip:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5', code,
         'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN')
  FROM unnest(ARRAY['ECG-E2', 'ECG-PLANONLY', 'ECG-E2-OLD']) AS code;
SELECT public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a5', 'ip:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5', jsonb_build_object(
    'ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E2'));
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
         'ec000000-0000-0000-0000-0000000000a5', 'ip:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5',
         code, NULL, 10000, 'PLN')
  FROM unnest(ARRAY['ECG-E1', 'ECG-OFF']) AS code;
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss'
      AND subject_id = 'user:ec000000-0000-0000-0000-0000000000a5'),
  6,
  'szesc prob kodami spoza zakresu = szesc pudel w kubelku (jak szesc nieistniejacych kodow)');
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss.ip'
      AND subject_id = 'ip:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5'),
  6,
  'te same szesc pudel w kubelku ADRESU - kod na bilet i wycena licza po adresie jak kod na plan');

-- ── Zakup pakietu nie wycofuje pudla (a6) ───────────────────────────────────
-- Dawniej zakup rzucal `refused_coupon_unknown` PO zapisaniu pudla przez
-- wycene, wiec wyjatek wycofywal zapis i zakup byl nieograniczona wyrocznia.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.event_package_purchase_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a6', 'ip:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6', jsonb_build_object(
    'package_id', 'ec500000-0000-0000-0000-0000000000a1', 'coupon_code', 'ECG-PAKIET-1')),
  '{"ok": false, "reason": "coupon_unknown"}'::jsonb,
  'zakup z nieistniejacym kodem zwraca odmowe WARTOSCIA (transakcja zatwierdza pudlo)');
SELECT is(
  (SELECT count(*)::int
     FROM generate_series(2, 30) g
    WHERE public.event_package_purchase_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a6', 'ip:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6', jsonb_build_object(
            'package_id', 'ec500000-0000-0000-0000-0000000000a1',
            'coupon_code', 'ECG-PAKIET-' || g))->>'reason' = 'coupon_unknown'),
  29,
  'kolejne 29 zakupow z pudlem - kazdy to zwykla odmowa coupon_unknown');
SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a6', 'ip:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6', jsonb_build_object(
      'package_id', 'ec500000-0000-0000-0000-0000000000a1', 'coupon_code', 'ECG-PAKIET-31'))$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'trzydziesty pierwszy zakup z kodem w oknie konczy sie odmowa limitu');
SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ec0a0000-0000-0000-0000-0000000000aa', 'ec000000-0000-0000-0000-0000000000a6', 'ip:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6', jsonb_build_object(
      'package_id', 'ec500000-0000-0000-0000-0000000000a1', 'coupon_code', 'ECG-E1'))$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'przy pelnym kubelku zakup z ISTNIEJACYM kodem tez dostaje odmowe limitu');
RESET ROLE;
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss'
      AND subject_id = 'user:ec000000-0000-0000-0000-0000000000a6'),
  30,
  'pudla z zakupow zostaly w kubelku (30), a odmowy po zapelnieniu go nie podbijaja');
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss.ip'
      AND subject_id = 'ip:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6'),
  30,
  'zakup pakietu liczy pudla takze w kubelku adresu');
SELECT is(
  (SELECT count(*)::int FROM public.event_package_orders
    WHERE package_id = 'ec500000-0000-0000-0000-0000000000a1'),
  0,
  'odmowa wartoscia nie zaklada zamowienia');

-- ── Farma kont za jednym adresem (N-13-1) ───────────────────────────────────
-- Szesc kont, jeden skrot adresu. Kazde konto zostaje DALEKO pod swoim
-- limitem (24 z 30), a mimo to po 120 pudlach adresu nastepne konto dostaje
-- odmowe przy pierwszej probie. Przed 20261007120200 kubelek adresu zyl tylko
-- w TS przed podgladem, wiec PostgREST wprost i kasa planu go omijaly.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['ec000000-0000-0000-0000-0000000000f1', 'ec000000-0000-0000-0000-0000000000f2',
                       'ec000000-0000-0000-0000-0000000000f3', 'ec000000-0000-0000-0000-0000000000f4',
                       'ec000000-0000-0000-0000-0000000000f5']::uuid[]) AS u(id),
          generate_series(1, 24) g
    WHERE public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
            u.id, 'ip:fafafafafafafafafafafafafafafafa',
            'ECG-FARMA-' || u.id || '-' || g, NULL, 10000, 'PLN')->>'error' = 'not_found'),
  120,
  'piec kont za jednym adresem: 120 pudel (po 24 na konto) dostaje zwykla odpowiedz');
SELECT throws_ok(
  $$SELECT public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000f6', 'ip:fafafafafafafafafafafafafafafafa',
      'ECG-FARMA-NOWE', NULL, 10000, 'PLN')$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'SWIEZE szoste konto z tego adresu dostaje odmowe przy pierwszej probie (kubelek adresu pelny)');
SELECT ok(
  (public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
     'ec000000-0000-0000-0000-0000000000f6', 'ip:f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6',
     'ECG-PLAN10', NULL, 10000, 'PLN')->>'ok')::boolean,
  'to samo konto z innego adresu dziala - limit dotyczy adresu, nie konta');

-- ── Farma kont za jednym adresem: KODY WYDARZEN (20261007120600) ────────────
-- Do tej migracji walidacja kodu na bilet, wycena i zakup pakietu byly
-- wykonywalne dla `authenticated` z kubelkiem KONTA, a limit adresu zyl tylko
-- w TS - PostgREST wprost go omijal. Piec kont (po 24 pudla, pod limitem konta
-- 30) za jednym adresem: kazda z trzech sciezek liczy pudla w TYM SAMYM
-- kubelku adresu, a szoste, swieze konto dostaje odmowe przy pierwszej probie.
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['ec000000-0000-0000-0000-0000000000c1',
                       'ec000000-0000-0000-0000-0000000000c2',
                       'ec000000-0000-0000-0000-0000000000c3',
                       'ec000000-0000-0000-0000-0000000000c4',
                       'ec000000-0000-0000-0000-0000000000c5']::uuid[]) AS u(id),
          generate_series(1, 8) g
    WHERE public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
            u.id, 'ip:ecececececececececececececececec',
            'ECG-EFARMA-' || u.id || '-' || g, 'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN')->>'error' = 'not_found'),
  40,
  'kod na bilet: 40 pudel z pieciu kont za jednym adresem dostaje zwykla odpowiedz');
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['ec000000-0000-0000-0000-0000000000c1',
                       'ec000000-0000-0000-0000-0000000000c2',
                       'ec000000-0000-0000-0000-0000000000c3',
                       'ec000000-0000-0000-0000-0000000000c4',
                       'ec000000-0000-0000-0000-0000000000c5']::uuid[]) AS u(id),
          generate_series(1, 8) g
    WHERE public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa',
            u.id, 'ip:ecececececececececececececececec',
            jsonb_build_object('ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2',
                               'coupon_code', 'ECG-QFARMA-' || u.id || '-' || g))->>'reason' = 'coupon_unknown'),
  40,
  'wycena: kolejne 40 pudel z tych samych kont i adresu');
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['ec000000-0000-0000-0000-0000000000c1',
                       'ec000000-0000-0000-0000-0000000000c2',
                       'ec000000-0000-0000-0000-0000000000c3',
                       'ec000000-0000-0000-0000-0000000000c4',
                       'ec000000-0000-0000-0000-0000000000c5']::uuid[]) AS u(id),
          generate_series(1, 8) g
    WHERE public.event_package_purchase_for_user('ec0a0000-0000-0000-0000-0000000000aa',
            u.id, 'ip:ecececececececececececececececec',
            jsonb_build_object('package_id', 'ec500000-0000-0000-0000-0000000000a1',
                               'coupon_code', 'ECG-PFARMA-' || u.id || '-' || g))->>'reason' = 'coupon_unknown'),
  40,
  'zakup pakietu: kolejne 40 pudel - razem 120, po 24 na konto');
SELECT is(
  (SELECT count FROM public.rate_limits
    WHERE scope = 'coupon_probe_miss.ip'
      AND subject_id = 'ip:ecececececececececececececececec'),
  120,
  'kubelek adresu: 120 pudel z trzech sciezek kodow wydarzen');
SELECT throws_ok(
  $$SELECT public.validate_event_ticket_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000c6', 'ip:ecececececececececececececececec',
      'ECG-E1', 'ec100000-0000-0000-0000-0000000000e1', 'ec200000-0000-0000-0000-0000000000f2', 20000, 'PLN')$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'SWIEZE szoste konto z tego adresu: kod na bilet odmawia przy pierwszej probie (takze DOBRY kod)');
SELECT throws_ok(
  $$SELECT public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000c6', 'ip:ecececececececececececececececec',
      jsonb_build_object('ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E1'))$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'swieze konto z tego adresu: wycena z kodem tez odmawia');
SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000c6', 'ip:ecececececececececececececececec',
      jsonb_build_object('package_id', 'ec500000-0000-0000-0000-0000000000a1', 'coupon_code', 'ECG-E1'))$$,
  'P0001', 'rate_limited: too many code attempts, try again later',
  'swieze konto z tego adresu: zakup pakietu z kodem tez odmawia');
SELECT is(
  (public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa',
     'ec000000-0000-0000-0000-0000000000c6', 'ip:c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6',
     jsonb_build_object('ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E1'))->>'discount_cents')::int,
  4000,
  'to samo konto z innego adresu dostaje wycene z rabatem kodu - konto z argumentu jest wolajacym wyceny');
SELECT ok(
  auth.uid() IS NULL AND auth.role() = 'service_role',
  'po powrocie wersji serwerowej tozsamosc zadania wraca do roli serwisowej (request.jwt.claim* odtworzone)');
SELECT is(
  public.event_admission_quote_for_user('ec0b0000-0000-0000-0000-0000000000bb',
    'ec000000-0000-0000-0000-0000000000c6', 'ip:c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6',
    jsonb_build_object('ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2'))->>'reason',
  'not_found',
  'najemca hosta inny niz najemca profilu: wycena not_found (jak dotad dla pakietu spoza najemcy profilu)');
SELECT throws_ok(
  $$SELECT public.event_package_purchase_for_user('ec0b0000-0000-0000-0000-0000000000bb',
      'ec000000-0000-0000-0000-0000000000c6', 'ip:c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6c6',
      jsonb_build_object('package_id', 'ec500000-0000-0000-0000-0000000000a1'))$$,
  'P0001', 'refused_not_found: not_found',
  'najemca hosta inny niz najemca profilu: zakup pakietu odmawia jak wycena');
SELECT throws_ok(
  $$SELECT public.event_admission_quote_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000c6', '203.0.113.7',
      jsonb_build_object('ticket_type_id', 'ec200000-0000-0000-0000-0000000000f2', 'coupon_code', 'ECG-E1'))$$,
  'P0001', 'invalid_payload: probe subject must be a salted address hash',
  'wycena serwerowa: surowy adres zamiast solonego skrotu jest odrzucany');

-- Wejscie funkcji serwerowej: bez konta i bez skrotu adresu to blad wolajacego.
SELECT throws_ok(
  $$SELECT public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      NULL, 'ip:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2', 'ECG-PLAN10', NULL, 10000, 'PLN')$$,
  'P0001', 'invalid_payload: tenant and user are required',
  'bez konta funkcja serwerowa odmawia (kubelek konta nie moze zniknac po cichu)');
SELECT throws_ok(
  $$SELECT public.validate_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
      'ec000000-0000-0000-0000-0000000000a2', '203.0.113.7', 'ECG-PLAN10', NULL, 10000, 'PLN')$$,
  'P0001', 'invalid_payload: probe subject must be a salted address hash',
  'surowy adres zamiast solonego skrotu jest odrzucany (adresy nie trafiaja do rate_limits)');

-- Rezerwacja uzycia wiaze zamowienie: konto, najemca i zamowienie musza sie zgadzac.
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency)
VALUES ('ec600000-0000-0000-0000-0000000000b1', 'ec0a0000-0000-0000-0000-0000000000aa',
        'ec000000-0000-0000-0000-0000000000b1', 'subscription', 'pending', 10000, 'PLN');
SELECT ok(
  NOT public.redeem_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
        'ec000000-0000-0000-0000-0000000000a2', 'ec300000-0000-0000-0000-000000000001',
        'ec600000-0000-0000-0000-0000000000b1', 1000, 10000, 'PLN'),
  'rezerwacja na CUDZE zamowienie: odmowa');
SELECT ok(
  NOT public.redeem_b2b_coupon_for_user('ec0b0000-0000-0000-0000-0000000000bb',
        'ec000000-0000-0000-0000-0000000000b1', 'ec300000-0000-0000-0000-000000000001',
        'ec600000-0000-0000-0000-0000000000b1', 1000, 10000, 'PLN'),
  'rezerwacja w innym najemcy niz zamowienie: odmowa');
SELECT ok(
  public.redeem_b2b_coupon_for_user('ec0a0000-0000-0000-0000-0000000000aa',
        'ec000000-0000-0000-0000-0000000000b1', 'ec300000-0000-0000-0000-000000000001',
        'ec600000-0000-0000-0000-0000000000b1', 1000, 10000, 'PLN'),
  'rezerwacja na wlasne zamowienie w tym najemcy: zgoda');
SELECT is(
  (SELECT row(c.redemptions_count, r.user_id, r.order_id, r.applied_cents)::text
     FROM public.b2b_coupons c
     JOIN public.b2b_coupon_redemptions r ON r.coupon_id = c.id
    WHERE c.id = 'ec300000-0000-0000-0000-000000000001'),
  row(1, 'ec000000-0000-0000-0000-0000000000b1'::uuid,
      'ec600000-0000-0000-0000-0000000000b1'::uuid, 1000)::text,
  'jedno uzycie: licznik 1, wiersz realizacji z kontem i zamowieniem z argumentow');
RESET ROLE;

-- ── 34-37. Odslanianie z jawnym najemca (service_role) ──────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.event_coupon_revealed_tickets('ec0a0000-0000-0000-0000-0000000000aa',
    'ec100000-0000-0000-0000-0000000000e1', ' ecg-vip '),
  ARRAY['ec200000-0000-0000-0000-0000000000f1']::uuid[],
  'odslanianie: dobry kod (po normalizacji) oddaje ukryty bilet wydarzenia');
SELECT is(
  public.event_coupon_revealed_tickets('ec0b0000-0000-0000-0000-0000000000bb',
    'ec100000-0000-0000-0000-0000000000e1', 'ECG-VIP'),
  ARRAY[]::uuid[],
  'odslanianie: ten sam kod w innym najemcy nie siega do cudzego wydarzenia');
SELECT is(
  public.event_coupon_revealed_tickets('ec0a0000-0000-0000-0000-0000000000aa',
    'ec100000-0000-0000-0000-0000000000e2', 'ECG-VIP'),
  ARRAY[]::uuid[],
  'odslanianie: kod innego wydarzenia to pusta lista');
SELECT is(
  public.event_coupon_revealed_tickets(NULL, 'ec100000-0000-0000-0000-0000000000e1', 'ECG-VIP'),
  ARRAY[]::uuid[],
  'odslanianie: bez najemcy nie ma w czym szukac');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '', true);

SELECT * FROM finish();
ROLLBACK;
