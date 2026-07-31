-- pgTAP: harmonogram doręczeń - samozbrojenie, heartbeat i bramka zdrowia
-- (migracje 20260731110000 + 20260731130000).
--
-- Kontekst: dyspozytor push/digestów był kompletny, ale nikt go nie wołał -
-- job_runner_settings rodzi się z enabled=false + base_url='', więc pg_cron
-- tykał w próżnię, a rosnąca kolejka wyglądała jak brak powiadomień. Ten test
-- pilnuje mechanizmów, które to naprawiają:
--
--   1. job_runner_runs (log przebiegów) jest niedostępny dla klienta - RLS bez
--      polityk, zero grantów dla anon/authenticated (log infrastruktury).
--   2. Funkcje harmonogramu (record_job_run, arm_job_runner,
--      invoke_billing_cron, resolve_job_runner_base_url) są service-role only.
--   3. job_scheduler_health() jest wykonywalny przez authenticated, ale bez roli
--      staff kończy się 42501 (bramka roli), a staff dostaje payload z sekcjami.
--   4. record_job_run() normalizuje wejście (nieznane źródło -> external, puste
--      job -> all, ujemny czas -> 0) i stempluje heartbeat + licznik porażek.
--   5. arm_job_runner() uzbraja WYŁĄCZNIE dziewiczy wiersz i tylko adresem
--      https bez hosta lokalnego; decyzja operatora (stempel auto_armed_at) jest
--      nienaruszalna - ponowne wywołanie nic nie zmienia.
--   6. invoke_jobs_tick() jest fail-open bez pg_net (nie wywala crona) i po
--      POJEDNANIU (20260731130000) stempluje OBIE telemetrie: last_invoked_at
--      (heartbeat aplikacji) oraz last_tick_status/last_tick_error (powod
--      puknięcia albo jego braku: disabled / no_secret / no_base_url /
--      pg_net_unavailable). Dwie zmiany tego samego dnia przepisaly te funkcje
--      niezaleznie, a forward-only znaczy, ze bez pojednania ostatnia z nich
--      cicho kasuje wklad poprzedniej.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(31);

-- Stan wyjściowy JAWNIE dziewiczy (świeża baza taka jest, ale test nie może
-- zależeć od tego, czy pg_cron zdążył w tym środowisku uzbroić runner).
-- Wszystko poniżej dzieje się w transakcji zamkniętej ROLLBACK-iem.
UPDATE public.job_runner_settings
   SET enabled = false,
       base_url = '',
       auto_armed_at = NULL,
       last_invoked_at = NULL,
       last_app_run_at = NULL,
       last_app_ok_at = NULL,
       last_app_error = NULL,
       failure_streak = 0,
       last_tick_at = NULL,
       last_tick_status = NULL,
       last_tick_error = NULL,
       tick_count = 0
 WHERE id = 1;

-- -- 1. Log przebiegów jest infrastrukturą, nie danymi klienta ----------------
SELECT has_table('public', 'job_runner_runs', 'job_runner_runs istnieje');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.job_runner_runs'::regclass),
  'job_runner_runs ma wlaczone RLS'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_runner_runs'),
  0,
  'job_runner_runs nie ma polityk klienckich (tylko service role)'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.job_runner_runs', 'SELECT'),
  'anon nie czyta logu przebiegow'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.job_runner_runs', 'SELECT'),
  'authenticated nie czyta logu przebiegow'
);

SELECT ok(
  has_table_privilege('service_role', 'public.job_runner_runs', 'INSERT'),
  'service_role zapisuje log przebiegow'
);

-- -- 2. Funkcje harmonogramu poza zasiegiem klienta ---------------------------
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.record_job_run(text,text,boolean,integer,jsonb,text,uuid,uuid)', 'EXECUTE'),
  'authenticated nie moze podrobic wpisu w logu przebiegow'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.arm_job_runner(text)', 'EXECUTE'),
  'authenticated nie moze uzbroic runnera (przekierowanie ticku)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.arm_job_runner(text)', 'EXECUTE'),
  'anon nie moze uzbroic runnera'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.invoke_billing_cron()', 'EXECUTE'),
  'authenticated nie moze wystrzelic puknięcia rozliczeniowego'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.resolve_job_runner_base_url()', 'EXECUTE'),
  'authenticated nie czyta adresu runnera przez resolver'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.job_scheduler_health()', 'EXECUTE'),
  'authenticated ma EXECUTE na RPC zdrowia (bramka roli jest w ciele)'
);

-- -- 3. Normalizacja wejscia i heartbeat --------------------------------------
SELECT lives_ok(
  $$ SELECT public.record_job_run('nieznane-zrodlo', '   ', false, -10, NULL, 'boom') $$,
  'record_job_run przyjmuje smieciowe wejscie zamiast wywalac tick'
);

SELECT is(
  (SELECT source FROM public.job_runner_runs ORDER BY id DESC LIMIT 1),
  'external',
  'nieznane zrodlo spada do external (kontrakt wspolny z UI)'
);

SELECT row_eq(
  $$ SELECT job, duration_ms, ok FROM public.job_runner_runs ORDER BY id DESC LIMIT 1 $$,
  ROW('all'::text, 0::integer, false),
  'puste job -> all, ujemny czas -> 0, porazka zapisana jako porazka'
);

SELECT is(
  (SELECT failure_streak FROM public.job_runner_settings WHERE id = 1),
  1,
  'licznik kolejnych porazek rosnie na heartbeacie'
);

SELECT lives_ok(
  $$ SELECT public.record_job_run('github_actions', 'push', true, 120,
       '{"push":{"claimed":2,"sent":2}}'::jsonb) $$,
  'udany przebieg zapisuje sie z wynikiem'
);

SELECT row_eq(
  $$ SELECT failure_streak, last_app_error IS NULL, last_app_ok_at IS NOT NULL
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW(0::integer, true, true),
  'pierwszy udany przebieg zeruje licznik i czysci ostatni blad'
);

-- -- 4. Samozbrojenie: tylko dziewiczy wiersz, tylko https --------------------
-- Wiersz w swiezej bazie jest dziewiczy (enabled=false, base_url=''), wiec
-- najpierw odbijamy adresy, ktorych cron bazy nie moze wolac.
SELECT row_eq(
  $$ SELECT (public.arm_job_runner('http://neweuropeanstrategies.com') ->> 'reason'),
            (public.arm_job_runner('https://localhost:8080') ->> 'reason') $$,
  ROW('invalid_base_url'::text, 'invalid_base_url'::text),
  'arm_job_runner odrzuca http i host lokalny'
);

SELECT row_eq(
  $$ SELECT (public.arm_job_runner('https://nes.example/') -> 'armed')::text,
            (public.arm_job_runner('https://obcy.example') -> 'armed')::text $$,
  ROW('true'::text, 'false'::text),
  'dziewiczy wiersz uzbraja sie raz; drugie wywolanie jest no-opem'
);

SELECT row_eq(
  $$ SELECT enabled, base_url, auto_armed_at IS NOT NULL
       FROM public.job_runner_settings WHERE id = 1 $$,
  ROW(true, 'https://nes.example'::text, true),
  'uzbrojenie wlacza runner, obcina ukosnik i stempluje decyzje'
);

-- -- 5. Fail-open bez pg_net + telemetria crona (pojednanie 20260731130000) ---
-- Po pojednaniu dwoch rownoleglych telemetrii JEDNA funkcja stempluje oba
-- swiaty: last_invoked_at (moja) i last_tick_* (pocztowa). Bez tego ostatnia
-- migracja dnia cicho kasowalaby samozbrojenie albo diagnoze puknięcia.
--
-- Nieobecnosc pg_net WYMUSZAMY, zamiast liczyc na srodowisko: na Supabase
-- (supabase db start, CI) pg_net JEST zainstalowany, wiec asercja "pominiete z
-- powodu pg_net_unavailable" przechodzilaby tylko na golym Postgresie. DDL w
-- Postgresie jest transakcyjne, a ten plik konczy sie ROLLBACK-iem, wiec
-- rozszerzenie wraca na miejsce po tescie. CASCADE jest bezpieczne: puknięcie
-- wola net.http_post dynamicznie z ciala plpgsql, wiec nie ma twardej
-- zaleznosci, ktora CASCADE mialoby co usunac.
DROP EXTENSION IF EXISTS pg_net CASCADE;

SELECT lives_ok(
  $$ SELECT public.invoke_jobs_tick() $$,
  'invoke_jobs_tick nie wywala sie bez pg_net (cron przezywa)'
);

SELECT row_eq(
  $$ SELECT last_tick_status, last_tick_error FROM public.job_runner_settings WHERE id = 1 $$,
  ROW('skipped'::text, 'pg_net_unavailable'::text),
  'brak pg_net jest raportowany jako POWOD pominiecia, nie jako cisza'
);

-- Swiadomie wylaczony runner tez podaje przyczyne (inaczej panel mowi tylko
-- "brak ticku" i operator nie wie, ze sam go wylaczyl).
UPDATE public.job_runner_settings SET enabled = false WHERE id = 1;
SELECT lives_ok(
  $$ SELECT public.invoke_jobs_tick() $$,
  'wylaczony runner nie wywala crona'
);
SELECT row_eq(
  $$ SELECT enabled, last_tick_error FROM public.job_runner_settings WHERE id = 1 $$,
  ROW(false, 'disabled'::text),
  'wylaczenie po uzbrojeniu jest respektowane i raportowane jako powod'
);

-- Resolver ma jedno zachowanie pod dwoma nazwami (alias deleguje), a host
-- lokalny nie jest adresem publicznym.
SELECT is(
  public.resolve_job_runner_base_url(),
  public.job_runner_base_url(),
  'resolve_job_runner_base_url deleguje do job_runner_base_url (jedna logika)'
);

-- -- 6. Bramka roli na RPC zdrowia -------------------------------------------
-- Fixture NIE wyłącza triggera on_auth_user_created (dawne
-- `ALTER TABLE auth.users DISABLE TRIGGER USER`). To polecenie wymaga WŁASNOŚCI
-- auth.users, a ta tabela należy do supabase_auth_admin - `supabase test db`
-- biegnie jako postgres, który właścicielem nie jest, więc cały plik padał na
-- 42501 „must be owner of table users". Zamiast prosić o prawa, których nie
-- mamy, ŻYJEMY z triggerem: handle_new_user sam zakłada profil i rolę.
--
-- Dlatego NIE tworzymy własnego tenanta. Trigger wsadza profil do tenanta
-- DOMYŚLNEGO, a profiles.tenant_id jest pilnowany jako niezmienny (osobny
-- trigger, „profiles.tenant_id is immutable"), więc przestawienie profilu na
-- własnego tenanta jest niewykonalne. Tenant jest tu i tak nieistotny - liczy
-- się tylko to, że bramka roli czyta current_tenant_id(), czyli tenant_id z
-- profilu wołającego. Rolę dosypujemy więc DOKŁADNIE do tego tenanta, czytając
-- go z założonego profilu.
INSERT INTO auth.users (id, email) VALUES
  ('b7000000-0000-0000-0000-0000000000aa', 'staff-sched@sched.test'),
  ('b7000000-0000-0000-0000-0000000000bb', 'member-sched@sched.test');

-- Profil zakładamy SAMI, ale nieinwazyjnie (DO NOTHING), bo stan triggera jest
-- w tym zestawie nieprzewidywalny: 56 plików woła `DISABLE TRIGGER USER`, a
-- tylko jeden go z powrotem włącza, i to wycieka MIĘDZY plikami - po pełnym
-- przebiegu trigger zostaje wyłączony. Test nie może zależeć od kolejności:
--   * trigger włączony  -> profil już jest (tenant domyślny), nasz INSERT to no-op,
--   * trigger wyłączony -> zakładamy profil sami, w tym samym tenancie domyślnym.
-- Świadomie NIE ma tu DO UPDATE: profiles.tenant_id jest pilnowany jako
-- niezmienny, a jakikolwiek zapis tenanta wywalałby połowę przebiegów.
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b7000000-0000-0000-0000-0000000000aa', 'staff-sched@sched.test', 'Staff Sched',
   (SELECT id FROM public.tenants WHERE is_default LIMIT 1)),
  ('b7000000-0000-0000-0000-0000000000bb', 'member-sched@sched.test', 'Member Sched',
   (SELECT id FROM public.tenants WHERE is_default LIMIT 1))
ON CONFLICT (id) DO NOTHING;

-- Rola 'admin' w tenancie ODCZYTANYM z profilu - dzięki temu zgadza się z
-- current_tenant_id() niezależnie od tego, kto ten profil założył. Unikat to
-- (tenant_id, user_id, role), więc współistnieje z rolą nadaną przez trigger.
INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT p.id, 'admin', p.tenant_id
  FROM public.profiles p
 WHERE p.id = 'b7000000-0000-0000-0000-0000000000aa'
ON CONFLICT DO NOTHING;

-- „Członek" musi być bez sztabu NIEZALEŻNIE od tego, co nadał trigger (pierwszy
-- profil w tenancie domyślnym dostaje 'admin'), inaczej asercja o 'forbidden'
-- przechodziłaby albo padała zależnie od kolejności zasiewu.
DELETE FROM public.user_roles
 WHERE user_id = 'b7000000-0000-0000-0000-0000000000bb'
   AND role IN ('admin', 'editor', 'author');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

-- Rzutowanie kodu na char(5) jest konieczne: przy czterech literalach `unknown`
-- pgTAP ma dwa równie dobre przeciążenia (char(5) i integer) i resolver się poddaje.
SELECT throws_ok(
  $$ SELECT public.job_scheduler_health() $$,
  '42501'::char(5),
  'forbidden',
  'czlonek bez roli staff nie widzi stanu harmonogramu (log przebiegow to infrastruktura)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT ok(
  (SELECT public.job_scheduler_health() ?& ARRAY['runner', 'queue', 'recent_runs', 'cron_jobs']),
  'admin dostaje pelny payload zdrowia (runner + kolejka + log + rejestr crona)'
);

SELECT ok(
  (SELECT (public.job_scheduler_health() -> 'runner' ->> 'secret_set')::boolean
     AND NOT (public.job_scheduler_health() -> 'runner' ? 'secret')),
  'payload mowi, ze sekret jest ustawiony, ale go NIE zwraca'
);

-- -- 7. app_unreachable koreluje ze ŹRÓDŁEM pg_cron, nie z globalnym heartbeatem
-- Heartbeat `last_app_run_at` stempluje KAŻDE źródło, więc scheduler repo (co
-- 5 min) albo ręczny tick z panelu trzymałby go świeżym także wtedy, gdy cron
-- bazy puka pod zły adres albo z odrzuconym sekretem - i alert o awarii
-- ścieżki PODSTAWOWEJ nigdy by nie zapalił. Dane przygotowujemy jako postgres
-- (record_job_run jest service-role only), a zdrowie czytamy jako admin.
RESET ROLE;
UPDATE public.job_runner_settings
   SET enabled = true,
       last_invoked_at = now(),
       last_tick_at = now(),
       last_tick_status = 'dispatched',
       last_tick_error = NULL
 WHERE id = 1;
DELETE FROM public.job_runner_runs;
SELECT public.record_job_run('github_actions', 'all', true, 100);

SET LOCAL ROLE authenticated;
SELECT ok(
  (public.job_scheduler_health() -> 'app_unreachable')::boolean,
  'swiezy przebieg z GitHub Actions NIE maskuje martwej sciezki pg_cron'
);

RESET ROLE;
SELECT public.record_job_run('pg_cron', 'all', true, 100);

SET LOCAL ROLE authenticated;
SELECT ok(
  NOT (public.job_scheduler_health() -> 'app_unreachable')::boolean,
  'przebieg ze zrodla pg_cron gasi alert o nieosiagalnej aplikacji'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
