-- pgTAP: metering - tozsamosc goscia wylacznie od serwera, adresowy limit
-- i serializacja licznika (audyt billingowy SUB-17, migracja
-- 20261012110200_metering_signed_visitor_ip_limit.sql).
--
-- Kryterium zakonczenia audytu: rownolegle zadania nie przekraczaja limitu,
-- a niepodpisany identyfikator jest odrzucony. Dowodzimy:
--   1. klient (anon/authenticated) nie ma ZADNEJ drogi, ktora przyjmuje klucz
--      goscia: stara 3-argumentowa consume_metered_view i metering_state(uuid)
--      nie istnieja, wersje goscia sa tylko dla service_role, a te woluje
--      wylacznie funkcja serwerowa po weryfikacji podpisu HMAC cookie (TS:
--      src/lib/access/__tests__/visitorToken.test.ts);
--   2. limit KONTA dla N kolejnych roznych artykulow: dokladnie `limit`
--      odblokowan, kolejne bez body - i zliczenie odbywa sie POD blokada
--      pg_advisory_xact_lock(hashtextextended('<najemca>:u:<konto>', 0))
--      (pg_locks w tej samej transakcji; prawdziwej wspolbieznosci pgTAP nie
--      odtworzy, ale blokada transakcyjna per podmiot jest dokladnie tym, co
--      serializuje rownolegle wolania);
--   3. gosc: limit per gosc, ponowne czytanie nie kosztuje, blokada podmiotu
--      i blokada adresu;
--   4. adresowy sufit (5 x anon_monthly_limit roznych bytow na skrot adresu):
--      nowy uuid goscia z tego samego adresu nie dostaje kolejnych darmowych
--      artykulow, ten sam artykul z tego adresu - tak, inny adres - tak;
--      odmowa trafia do metering_event_log;
--   5. surowy adres nie wchodzi do bazy (RPC i CHECK tabeli);
--   6. uprawniony (zakup) - bez konsumpcji, bez wierszy licznika;
--   7. retencja: skrot adresu z poprzednich okresow jest zerowany;
--   8. odmowa ADRESOWEGO sufitu ma wlasny powod (requires_registration = true
--      przy used < monthly_limit - klient pokazuje droge przez konto, nie goly
--      paywall), a `remaining` goscia przy wydaniu body = min(wlasny limit,
--      sufit adresu) - zasiany licznik "zostalo N" nie obiecuje artykulu,
--      ktorego adres nie wpusci (przeglad adwersaryjny, poz. 29);
--   9. STRUKTURA: obie blokady doradcze stoja PRZED pierwszym zliczeniem
--      metered_views. Asercje pg_locks z punktu 2/3 przechodza GDZIEKOLWIEK
--      w ciele stoi blokada (trzymana do COMMIT, wspolbiezna w jednym
--      procesie), wiec przesuniecie jej za count(*) - powrot wyscigu SUB-17 -
--      zostawialo je zielone. Prawdziwa wspolbieznosc (dwie sesje dblink):
--      supabase/tests/metering_concurrency_test.sql (przeglad, poz. 30).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(45);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('a5000000-0000-0000-0000-0000000000aa', 'meter-identity-tenant', 'Meter Identity Tenant', true);

INSERT INTO auth.users (id, email) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'reader@meter-identity.test'),
  ('a5000000-0000-0000-0000-000000000002', 'buyer@meter-identity.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'reader@meter-identity.test', 'Reader', 'a5000000-0000-0000-0000-0000000000aa'),
  ('a5000000-0000-0000-0000-000000000002', 'buyer@meter-identity.test', 'Buyer', 'a5000000-0000-0000-0000-0000000000aa');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('a5000000-0000-0000-0000-00000000a0a0', 'a5000000-0000-0000-0000-0000000000aa', 'meter-identity-home');

-- Dwanascie platnych wpisow a5000000-...-0000000001p1 .. p12 (rozne byty
-- licznika; 9-12 dla sekcji 8 - sufit adresu przy limicie goscia 2).
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, content_pl)
SELECT ('a5000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       'meter-identity-' || g, 'a5000000-0000-0000-0000-000000000001', 'published',
       'a5000000-0000-0000-0000-0000000000aa', 'a5000000-0000-0000-0000-00000000a0a0',
       'Paid ' || g, '<p>Tresc ' || g || '</p>'
  FROM generate_series(1, 12) AS g;
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, metering_policy)
SELECT 'a5000000-0000-0000-0000-0000000000aa', 'post',
       ('a5000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid, 'paid', '{}', 'inherit'
  FROM generate_series(1, 12) AS g;

-- Konto: 2 artykuly/mies.; gosc: 1 artykul/mies. -> sufit adresu 5 bytow.
INSERT INTO public.metering_settings
  (tenant_id, enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter)
VALUES
  ('a5000000-0000-0000-0000-0000000000aa', true, 2, 1, true, true, true)
ON CONFLICT (tenant_id) DO UPDATE
  SET enabled = true, member_monthly_limit = 2, anon_monthly_limit = 1,
      meter_paid = true, meter_members = true, show_counter = true;

INSERT INTO public.user_purchases (user_id, tenant_id, entity_type, entity_id, amount_cents, currency, status) VALUES
  ('a5000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-0000000000aa',
   'post', 'a5000000-0000-0000-0000-000000000101', 1900, 'PLN', 'active');

-- Skrot adresu w ksztalcie requestRateSubject ('ip:' + 32 hex).
SELECT set_config('test.ip_a', 'ip:' || substr(md5('adres-a'), 1, 32), true);
SELECT set_config('test.ip_b', 'ip:' || substr(md5('adres-b'), 1, 32), true);
SELECT set_config('test.ip_c', 'ip:' || substr(md5('adres-c'), 1, 32), true);

-- Czy BIEZACA transakcja trzyma blokade doradcza o danym kluczu bigint.
CREATE FUNCTION pg_temp.holds_advisory(p_key bigint) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_locks l
     WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
       AND l.objsubid = 1
       AND ((l.classid::bigint << 32) | l.objid::bigint) = p_key
  );
$$;

-- ── 1) Klient nie ma drogi z kluczem goscia ───────────────────────────────
SELECT is(to_regprocedure('public.consume_metered_view(public.access_entity_type, uuid, uuid)'), NULL,
  'stara consume_metered_view z kluczem goscia od klienta nie istnieje');
SELECT is(to_regprocedure('public.metering_state(uuid)'), NULL,
  'stara metering_state z kluczem goscia od klienta nie istnieje');
SELECT ok(
  NOT has_function_privilege('anon', 'public.consume_metered_view(public.access_entity_type, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.metering_state()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.log_metering_event(text, uuid, text, text, uuid, integer, integer)', 'EXECUTE'),
  'anon: bez EXECUTE na sciezkach konta i telemetrii');
SELECT ok(
  NOT has_function_privilege('anon', 'public.consume_metered_view_visitor(uuid, public.access_entity_type, uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.consume_metered_view_visitor(uuid, public.access_entity_type, uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.metering_state_visitor(uuid, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.metering_state_visitor(uuid, text, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.consume_metered_view_visitor(uuid, public.access_entity_type, uuid, uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.metering_state_visitor(uuid, text, uuid)', 'EXECUTE'),
  'sciezki goscia: wylacznie service_role (niepodpisany klucz od klienta nie ma wejscia)');
SELECT ok(
  NOT has_function_privilege('anon', 'public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)', 'EXECUTE'),
  'rdzen licznika: bez EXECUTE dla kogokolwiek poza wlascicielem');

-- Anon wolajacy wprost: odmowa uprawnien, nie werdykt licznika.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $$ SELECT * FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000101') $$,
  '42501', NULL,
  'anon nie wola consume_metered_view (brak EXECUTE)');
RESET ROLE;

-- ── 2) Konto: N kolejnych roznych artykulow pod blokada ───────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT granted, consumed, used FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000101') $$,
  $$ VALUES (true, true, 1) $$, 'konto: artykul 1/2');
SELECT results_eq(
  $$ SELECT granted, consumed, used FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000102') $$,
  $$ VALUES (true, true, 2) $$, 'konto: artykul 2/2');
SELECT results_eq(
  $$ SELECT granted, used, remaining, content_pl FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000103') $$,
  $$ VALUES (false, 2, 0, NULL::text) $$, 'konto: trzeci rozny artykul bez body (limit nieprzekroczony)');
SELECT results_eq(
  $$ SELECT granted FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000104') $$,
  $$ VALUES (false) $$, 'konto: czwarty rozny artykul bez body');
SELECT results_eq(
  $$ SELECT enabled, monthly_limit, used, remaining FROM public.metering_state() $$,
  $$ VALUES (true, 2, 2, 0) $$, 'metering_state() konta: 2/2, zostalo 0');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.metered_views
    WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa'
      AND user_id = 'a5000000-0000-0000-0000-000000000001'),
  2, 'konto: w metered_views dokladnie limit wierszy');
SELECT ok(
  pg_temp.holds_advisory(hashtextextended(
    'a5000000-0000-0000-0000-0000000000aa:u:a5000000-0000-0000-0000-000000000001', 0)),
  'konto: zliczenie i wstawienie pod pg_advisory_xact_lock per <najemca>:u:<konto>');

-- ── 3) Gosc (service_role, tozsamosc od serwera) ──────────────────────────
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000101', 'a5000000-0000-0000-0000-0000000000f1',
         current_setting('test.ip_a')) $$,
  $$ VALUES (true, true, 1, 1) $$, 'gosc 1: pierwszy artykul policzony');
SELECT results_eq(
  $$ SELECT granted, consumed, used
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000101', 'a5000000-0000-0000-0000-0000000000f1',
         current_setting('test.ip_a')) $$,
  $$ VALUES (true, false, 1) $$, 'gosc 1: ponowne czytanie nie kosztuje');
SELECT results_eq(
  $$ SELECT granted, used, remaining
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000102', 'a5000000-0000-0000-0000-0000000000f1',
         current_setting('test.ip_a')) $$,
  $$ VALUES (false, 1, 0) $$, 'gosc 1: drugi artykul ponad limit goscia - bez body');
RESET ROLE;
SELECT ok(
  pg_temp.holds_advisory(hashtextextended(
    'a5000000-0000-0000-0000-0000000000aa:v:a5000000-0000-0000-0000-0000000000f1', 0))
  AND pg_temp.holds_advisory(hashtextextended(
    'a5000000-0000-0000-0000-0000000000aa:' || current_setting('test.ip_a'), 0)),
  'gosc: blokada podmiotu <najemca>:v:<gosc> i blokada adresu <najemca>:<skrot>');
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$ SELECT granted, requires_registration
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000103', NULL, current_setting('test.ip_a')) $$,
  $$ VALUES (false, true) $$, 'bez tozsamosci od serwera: sciana rejestracji, nic nie liczone');

-- ── 4) Adresowy sufit: nowy uuid z tego samego adresu ─────────────────────
-- Goscie f2..f5 z adresu A czytaja kolejne ROZNE artykuly 2..5 -> adres A ma
-- 5 roznych bytow (sufit 5 x 1). Gosc f6 z adresu A po artykul 6 - odmowa.
SELECT is(
  (SELECT count(*)::int FROM generate_series(2, 5) AS g,
     LATERAL public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
       ('a5000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       ('a5000000-0000-0000-0000-0000000000f' || g)::uuid,
       current_setting('test.ip_a')) AS r
    WHERE r.granted AND r.consumed),
  4, 'nowi goscie z adresu A: 4 kolejne artykuly do sufitu adresu (5)');
SELECT results_eq(
  $$ SELECT granted, consumed, content_pl
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000106', 'a5000000-0000-0000-0000-0000000000f6',
         current_setting('test.ip_a')) $$,
  $$ VALUES (false, false, NULL::text) $$,
  'swiezy uuid goscia z adresu A ponad sufit adresu: bez body (rotacja klucza nie pomaga)');
SELECT results_eq(
  $$ SELECT granted, consumed
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000101', 'a5000000-0000-0000-0000-0000000000f7',
         current_setting('test.ip_a')) $$,
  $$ VALUES (true, true) $$,
  'ten sam artykul czytany juz z adresu A: nowy gosc go dostaje (licznik adresu po bytach)');
SELECT results_eq(
  $$ SELECT granted, consumed
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000106', 'a5000000-0000-0000-0000-0000000000f8',
         current_setting('test.ip_b')) $$,
  $$ VALUES (true, true) $$,
  'inny adres (B): wlasny sufit, artykul 6 dostepny');
SELECT results_eq(
  $$ SELECT monthly_limit, used, remaining
       FROM public.metering_state_visitor('a5000000-0000-0000-0000-0000000000aa',
         current_setting('test.ip_a'), 'a5000000-0000-0000-0000-0000000000f9') $$,
  $$ VALUES (1, 0, 0) $$,
  'metering_state_visitor: nowy gosc z adresu A widzi 0 pozostalych (sufit adresu)');
SELECT results_eq(
  $$ SELECT monthly_limit, used, remaining
       FROM public.metering_state_visitor('a5000000-0000-0000-0000-0000000000aa',
         current_setting('test.ip_b'), 'a5000000-0000-0000-0000-0000000000f9') $$,
  $$ VALUES (1, 0, 1) $$,
  'metering_state_visitor: ten sam gosc z adresu B ma swoj 1 artykul');

-- ── 5) Surowy adres nie wchodzi do bazy ────────────────────────────────────
SELECT throws_ok(
  $$ SELECT * FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
       'a5000000-0000-0000-0000-000000000107', 'a5000000-0000-0000-0000-0000000000fa', '203.0.113.7') $$,
  'P0001', 'metering_ip_subject_invalid',
  'RPC odrzuca surowy adres zamiast skrotu');

RESET ROLE;
SELECT throws_ok(
  $$ INSERT INTO public.metered_views (tenant_id, visitor_id, entity_type, entity_id, ip_subject)
     VALUES ('a5000000-0000-0000-0000-0000000000aa', 'a5000000-0000-0000-0000-0000000000fb', 'post',
             'a5000000-0000-0000-0000-000000000108', '203.0.113.7') $$,
  '23514', NULL,
  'CHECK tabeli: surowy adres w metered_views.ip_subject niemozliwy');
SELECT is(
  (SELECT count(*)::int FROM public.metering_event_log
    WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa'
      AND visitor_id = 'a5000000-0000-0000-0000-0000000000f6'
      AND outcome = 'denied' AND reason = 'ip_limit_reached'),
  1, 'odmowa sufitu adresu zalogowana serwerowo (metering_event_log)');
SELECT is(
  (SELECT count(*)::int FROM public.metering_event_log
    WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa'
      AND visitor_id = 'a5000000-0000-0000-0000-0000000000f1'
      AND outcome = 'denied' AND reason = 'monthly_limit_reached'),
  1, 'odmowa limitu goscia zalogowana serwerowo');
SELECT is(
  (SELECT count(*)::int FROM public.metered_views
    WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa' AND user_id IS NULL
      AND ip_subject IS NULL),
  0, 'kazdy wiersz goscia niesie skrot adresu');

-- ── 6) Uprawniony (zakup): bez konsumpcji i bez wierszy licznika ──────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT granted, consumed, monthly_limit FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000101') $$,
  $$ VALUES (true, false, 0) $$, 'kupujacy: body bez zuzycia licznika');
SELECT isnt(
  (SELECT content_pl FROM public.consume_metered_view('post', 'a5000000-0000-0000-0000-000000000101')),
  NULL, 'kupujacy dostaje body');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.metered_views WHERE user_id = 'a5000000-0000-0000-0000-000000000002'),
  0, 'kupujacy nie zostawia wierszy w metered_views');

-- ── 7) Retencja skrotu adresu ──────────────────────────────────────────────
INSERT INTO public.metered_views (tenant_id, visitor_id, entity_type, entity_id, period_month, ip_subject)
VALUES ('a5000000-0000-0000-0000-0000000000aa', 'a5000000-0000-0000-0000-0000000000fc', 'post',
        'a5000000-0000-0000-0000-000000000108',
        ((date_trunc('month', now()) - interval '1 month')::date), current_setting('test.ip_a'));
SELECT cmp_ok(public.metered_views_scrub_ip(1000), '>=', 1, 'scrub: zeruje skrot z poprzedniego okresu');
SELECT is(
  (SELECT ip_subject FROM public.metered_views WHERE visitor_id = 'a5000000-0000-0000-0000-0000000000fc'),
  NULL, 'scrub: wiersz poprzedniego okresu bez skrotu adresu');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.metered_views
     WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa' AND user_id IS NULL
       AND period_month = (date_trunc('month', now()))::date AND ip_subject IS NULL),
  'scrub: biezacy okres nietkniety (limit adresowy nadal liczy)');

-- ── 8) Sufit adresu: wlasny powod odmowy i "zostalo N" = min(gosc, adres) ──
-- Limit goscia 2 -> sufit adresu 10 bytow. Adres C (NAT biura): dziewiec
-- roznych artykulow przeczytali juz inni goscie.
UPDATE public.metering_settings SET anon_monthly_limit = 2
 WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa';
INSERT INTO public.metered_views (tenant_id, visitor_id, entity_type, entity_id, ip_subject)
SELECT 'a5000000-0000-0000-0000-0000000000aa',
       ('a5000000-0000-0000-0000-0000000c00' || lpad(g::text, 2, '0'))::uuid, 'post',
       ('a5000000-0000-0000-0000-0000000001' || lpad(g::text, 2, '0'))::uuid,
       current_setting('test.ip_c')
  FROM generate_series(1, 9) AS g;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- Nowy gosc czyta 10. rozny artykul adresu: wlasny limit zostawia mu 1,
-- adres - 0. Licznik musi powiedziec 0 (nastepny rozny artykul odbije sufit).
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit, remaining
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000110', 'a5000000-0000-0000-0000-0000000000d1',
         current_setting('test.ip_c')) $$,
  $$ VALUES (true, true, 1, 2, 0) $$,
  'wydanie body: remaining goscia = min(wlasny limit 1, sufit adresu 0)');
SELECT results_eq(
  $$ SELECT granted, consumed, remaining
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000110', 'a5000000-0000-0000-0000-0000000000d1',
         current_setting('test.ip_c')) $$,
  $$ VALUES (true, false, 0) $$,
  'ponowne czytanie: remaining tez liczy sufit adresu (zasiew licznika spojny)');
SELECT results_eq(
  $$ SELECT remaining
       FROM public.metering_state_visitor('a5000000-0000-0000-0000-0000000000aa',
         current_setting('test.ip_c'), 'a5000000-0000-0000-0000-0000000000d1') $$,
  $$ VALUES (0) $$,
  'stan bez konsumpcji mowi to samo co werdykt konsumpcji (0)');
-- Kolejny NOWY gosc z adresu C: wlasny limit nietkniety (0 z 2), odbija go
-- sufit adresu - osobny powod odmowy, nie "wyczerpany limit".
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit, remaining, requires_registration, content_pl
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000111', 'a5000000-0000-0000-0000-0000000000d2',
         current_setting('test.ip_c')) $$,
  $$ VALUES (false, false, 0, 2, 0, true, NULL::text) $$,
  'odmowa sufitu adresu: used 0 < limit 2, requires_registration = true (droga przez konto)');
-- Ten sam gosc z innego adresu (B) czyta normalnie - dowod, ze odmowa byla
-- adresowa, a nie jego wlasnym limitem.
SELECT results_eq(
  $$ SELECT granted, consumed, used, requires_registration
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000111', 'a5000000-0000-0000-0000-0000000000d2',
         current_setting('test.ip_b')) $$,
  $$ VALUES (true, true, 1, false) $$,
  'ten sam gosc spoza adresu C dostaje artykul (odmowa byla adresowa)');
-- Wlasny limit wyczerpany (2 z 2) to dalej osobny przypadek: bez flagi
-- rejestracji, klient pokazuje "wykorzystano X z N".
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit, requires_registration
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000112', 'a5000000-0000-0000-0000-0000000000d2',
         current_setting('test.ip_b')) $$,
  $$ VALUES (true, true, 2, 2, false) $$,
  'gosc z adresu B: drugi artykul w wlasnym limicie');
SELECT results_eq(
  $$ SELECT granted, used, monthly_limit, requires_registration
       FROM public.consume_metered_view_visitor('a5000000-0000-0000-0000-0000000000aa', 'post',
         'a5000000-0000-0000-0000-000000000109', 'a5000000-0000-0000-0000-0000000000d2',
         current_setting('test.ip_b')) $$,
  $$ VALUES (false, 2, 2, false) $$,
  'wyczerpany WLASNY limit: bez flagi rejestracji (wariant "exhausted")');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.metering_event_log
    WHERE tenant_id = 'a5000000-0000-0000-0000-0000000000aa'
      AND visitor_id = 'a5000000-0000-0000-0000-0000000000d2'
      AND outcome = 'denied' AND reason = 'ip_limit_reached'),
  1, 'odmowa sufitu adresu nowego goscia zalogowana z wlasnym powodem');

-- ── 9) Struktura: blokady PRZED pierwszym zliczeniem ──────────────────────
SELECT ok(
  strpos(pg_get_functiondef('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure),
         'PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || '':'' || v_subject, 0))') > 0
  AND strpos(pg_get_functiondef('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure),
             'PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || '':'' || v_subject, 0))')
    < strpos(pg_get_functiondef('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure),
             'FROM public.metered_views mv'),
  'blokada podmiotu stoi przed pierwszym zliczeniem metered_views');
SELECT ok(
  strpos(pg_get_functiondef('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure),
         'PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || '':'' || _ip_subject, 0))') > 0
  AND strpos(pg_get_functiondef('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure),
             'PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || '':'' || _ip_subject, 0))')
    < strpos(pg_get_functiondef('public._metered_view_consume(uuid, uuid, uuid, text, public.access_entity_type, uuid)'::regprocedure),
             'FROM public.metered_views mv'),
  'blokada adresu stoi przed pierwszym zliczeniem metered_views');

SELECT * FROM finish();
ROLLBACK;
