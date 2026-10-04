-- pgTAP: flaga `signed_in` zamiast identyfikatora konta (20261003180000).
--
--   1. Kolumna `analytics_events.signed_in` jest boolean NOT NULL DEFAULT false,
--      a komentarze opisuja `signed_in` jako jedyna informacje o koncie
--      i `user_id` jako CELOWO niezapisywana.
--   2. Miary zalogowanych licza RÓZNE SESJE z flaga `signed_in`, a `user_id`
--      jest ignorowany: sesja s4 ma `user_id` ustawiony, ale `signed_in = false`.
--      Oczekiwane 2 (s1, s2) odroznia nowa definicje od obu mozliwych bledow:
--      stara definicja (COUNT DISTINCT user_id) dalaby 1, bo `user_id` ma
--      wylacznie s4, a liczenie `user_id` OBOK flagi (signed_in OR user_id
--      IS NOT NULL) dawaloby 3 - oba != 2.
--        * admin_dashboard_traffic: `members` w oknie biezacym i poprzednim,
--        * admin_dashboard_realtime: `activeMembers`,
--        * analytics_semantic_snapshot: `signed_in_sessions` (i brak starego
--          klucza `signed_in_users`),
--        * widok analytics_events_daily: `signed_in_sessions` zamiast
--          `unique_users`, reszta kolumn bez zmian.
--   3. Izolacja najemcow: dwie zalogowane sesje najemcy B nie wchodza do liczb A.
--   4. Utwardzenie przezylo przepisanie: search_path = public, pg_temp na trzech
--      funkcjach (snapshot mial w tekscie zrodlowym samo `public`),
--      security_invoker na widoku, ACL bez anon.
--   5. Bramka roli: nie-admin dostaje 42501, nie zera.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c5111111-1111-1111-1111-1111111111c5', 'tenant-sig-a', 'Tenant SIG A'),
  ('c5222222-2222-2222-2222-2222222222c5', 'tenant-sig-b', 'Tenant SIG B');

INSERT INTO auth.users (id, email) VALUES
  ('c5300000-0000-0000-0000-00000000000a', 'admin-sig-a@sig.test'),
  ('c5300000-0000-0000-0000-00000000000b', 'member-sig-a@sig.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c5300000-0000-0000-0000-00000000000a', 'admin-sig-a@sig.test', 'Admin SIG A',
   'c5111111-1111-1111-1111-1111111111c5'),
  ('c5300000-0000-0000-0000-00000000000b', 'member-sig-a@sig.test', 'Member SIG A',
   'c5111111-1111-1111-1111-1111111111c5');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c5300000-0000-0000-0000-00000000000a', 'admin',
   'c5111111-1111-1111-1111-1111111111c5');

-- ---------------------------------------------------------------------------
-- 1) Kolumna i komentarze
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
    WHERE a.attrelid = 'public.analytics_events'::regclass
      AND a.attname = 'signed_in' AND NOT a.attisdropped),
  'boolean',
  'analytics_events.signed_in jest typu boolean'
);

SELECT col_not_null(
  'public', 'analytics_events', 'signed_in',
  'analytics_events.signed_in jest NOT NULL - nie ma stanu "nie wiadomo"'
);

SELECT col_default_is(
  'public', 'analytics_events', 'signed_in', 'false',
  'analytics_events.signed_in ma DEFAULT false - stare wiersze to anonimy'
);

SELECT ok(
  col_description('public.analytics_events'::regclass,
    (SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = 'public.analytics_events'::regclass AND a.attname = 'signed_in')::int)
  LIKE '%WYLACZNIE przez ingest%',
  'komentarz signed_in mowi, ze flage ustawia wylacznie ingest'
);

SELECT ok(
  col_description('public.analytics_events'::regclass,
    (SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = 'public.analytics_events'::regclass AND a.attname = 'user_id')::int)
  LIKE 'CELOWO NIEZAPISYWANA%',
  'komentarz user_id opisuje kolumne jako celowo niezapisywana'
);

-- ---------------------------------------------------------------------------
-- Dane: najemca A w oknie biezacym (created_at = now() transakcji, wiec rowniez
-- w oknie "aktywni teraz"), najemca B w tym samym czasie, najemca A w oknie
-- poprzednim.
--   s1: zdarzenie anonimowe, potem dwa po zalogowaniu  -> sesja zalogowana
--   s2: dwa zdarzenia zalogowane                        -> sesja zalogowana
--   s3: same anonimowe                                  -> nie
--   s4: user_id USTAWIONY, signed_in = false            -> nie (dowod, ze
--       czytelnicy nie patrza juz na user_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.analytics_events
  (tenant_id, event_type, event_name, session_id, anon_id, signed_in, user_id) VALUES
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-s1', 'anon-1', false, NULL),
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-s1', 'anon-1', true,  NULL),
  ('c5111111-1111-1111-1111-1111111111c5', 'cta_click', 'signup_click', 'sig-s1', 'anon-1', true, NULL),
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-s2', 'anon-2', true,  NULL),
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-s2', 'anon-2', true,  NULL),
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-s3', 'anon-3', false, NULL),
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-s4', 'anon-4', false,
   'c5300000-0000-0000-0000-00000000000b'),
  -- Najemca B: dwie zalogowane sesje, ktore NIE moga wyciec do liczb A.
  ('c5222222-2222-2222-2222-2222222222c5', 'page_view', 'page_view', 'sig-b1', 'anon-b1', true, NULL),
  ('c5222222-2222-2222-2222-2222222222c5', 'page_view', 'page_view', 'sig-b2', 'anon-b2', true, NULL);

INSERT INTO public.analytics_events
  (tenant_id, event_type, event_name, session_id, anon_id, signed_in, created_at) VALUES
  ('c5111111-1111-1111-1111-1111111111c5', 'page_view', 'page_view', 'sig-p1', 'anon-p1', true,
   now() - interval '3 days');

-- ---------------------------------------------------------------------------
-- 2) Widok dzienny - jako wlasciciel, przed zmiana roli (RLS nie gra roli)
-- ---------------------------------------------------------------------------
SELECT has_column(
  'public', 'analytics_events_daily', 'signed_in_sessions',
  'widok analytics_events_daily ma kolumne signed_in_sessions'
);

SELECT hasnt_column(
  'public', 'analytics_events_daily', 'unique_users',
  'widok analytics_events_daily nie ma juz kolumny unique_users (obiecywala osoby)'
);

SELECT is(
  (SELECT d.signed_in_sessions FROM public.analytics_events_daily d
    WHERE d.tenant_id = 'c5111111-1111-1111-1111-1111111111c5'
      AND d.event_name = 'page_view' AND d.day = date_trunc('day', now())),
  2::bigint,
  'widok: signed_in_sessions = s1 + s2 (s4 z user_id nie jest liczona)'
);

SELECT is(
  (SELECT d.unique_sessions FROM public.analytics_events_daily d
    WHERE d.tenant_id = 'c5111111-1111-1111-1111-1111111111c5'
      AND d.event_name = 'page_view' AND d.day = date_trunc('day', now())),
  4::bigint,
  'widok: unique_sessions bez zmian po przepisaniu (s1..s4)'
);

-- ---------------------------------------------------------------------------
-- 3) Utwardzenie: search_path, security_invoker, ACL
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT 'search_path=public, pg_temp' = ANY (p.proconfig) FROM pg_proc p
    WHERE p.oid = 'public.admin_dashboard_traffic(timestamptz,timestamptz,timestamptz,timestamptz,text,integer,integer)'::regprocedure),
  'admin_dashboard_traffic: search_path = public, pg_temp'
);

SELECT ok(
  (SELECT 'search_path=public, pg_temp' = ANY (p.proconfig) FROM pg_proc p
    WHERE p.oid = 'public.admin_dashboard_realtime(integer,integer)'::regprocedure),
  'admin_dashboard_realtime: search_path = public, pg_temp'
);

SELECT ok(
  (SELECT 'search_path=public, pg_temp' = ANY (p.proconfig) FROM pg_proc p
    WHERE p.oid = 'public.analytics_semantic_snapshot(timestamptz,timestamptz)'::regprocedure),
  'analytics_semantic_snapshot: pg_temp nie zginal przy CREATE OR REPLACE'
);

SELECT ok(
  (SELECT array_to_string(c.reloptions, ',') ~ 'security_invoker=(on|true)'
     FROM pg_class c WHERE c.oid = 'public.analytics_events_daily'::regclass),
  'widok analytics_events_daily wrocil z security_invoker (dziedziczy RLS tabeli)'
);

SELECT ok(
  NOT has_function_privilege('anon',
        'public.admin_dashboard_traffic(timestamptz,timestamptz,timestamptz,timestamptz,text,integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated',
        'public.admin_dashboard_traffic(timestamptz,timestamptz,timestamptz,timestamptz,text,integer,integer)', 'EXECUTE'),
  'admin_dashboard_traffic: EXECUTE dla authenticated, nie dla anon'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_dashboard_realtime(integer,integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_dashboard_realtime(integer,integer)', 'EXECUTE'),
  'admin_dashboard_realtime: EXECUTE dla authenticated, nie dla anon'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.analytics_semantic_snapshot(timestamptz,timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.analytics_semantic_snapshot(timestamptz,timestamptz)', 'EXECUTE'),
  'analytics_semantic_snapshot: EXECUTE dla authenticated, nie dla anon'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.analytics_events_daily', 'SELECT')
  AND has_table_privilege('authenticated', 'public.analytics_events_daily', 'SELECT'),
  'analytics_events_daily: SELECT dla authenticated, nie dla anon (DROP skasowal ACL)'
);

-- ---------------------------------------------------------------------------
-- 4) Czytelnicy jako admin najemcy A
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c5300000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT is(
  ((public.admin_dashboard_traffic(
      now() - interval '1 day', now() + interval '1 minute',
      now() - interval '4 days', now() - interval '2 days')
    -> 'current' ->> 'members'))::int,
  2,
  'traffic: members = sesje zalogowane A (nie 1 ze starego user_id, nie 3 z user_id obok flagi, nie 4 z najemca B)'
);

SELECT is(
  ((public.admin_dashboard_traffic(
      now() - interval '1 day', now() + interval '1 minute',
      now() - interval '4 days', now() - interval '2 days')
    -> 'previous' ->> 'members'))::int,
  1,
  'traffic: members okna poprzedniego liczone ta sama definicja'
);

SELECT is(
  ((public.admin_dashboard_traffic(
      now() - interval '1 day', now() + interval '1 minute',
      now() - interval '4 days', now() - interval '2 days')
    -> 'current' ->> 'sessions'))::int,
  4,
  'traffic: sessions bez zmian po przepisaniu (s1..s4, bez najemcy B)'
);

SELECT is(
  ((public.admin_dashboard_realtime(5, 30) ->> 'activeMembers'))::int,
  2,
  'realtime: activeMembers = sesje zalogowane w oknie aktywnosci'
);

SELECT is(
  ((public.analytics_semantic_snapshot(now() - interval '1 day', now())
    -> 'first_party' ->> 'signed_in_sessions'))::int,
  2,
  'snapshot: signed_in_sessions = DISTINCT session_id z flaga signed_in'
);

SELECT ok(
  NOT ((public.analytics_semantic_snapshot(now() - interval '1 day', now())
        -> 'first_party') ? 'signed_in_users'),
  'snapshot: stary klucz signed_in_users zniknal (obiecywal osoby)'
);

-- ---------------------------------------------------------------------------
-- 5) Bramka roli
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"c5300000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.admin_dashboard_traffic(now() - interval '1 day', now(),
       now() - interval '2 days', now() - interval '1 day') $$,
  '42501',
  'Forbidden: admin or editor role required',
  'admin_dashboard_traffic odmawia nie-adminowi kodem 42501'
);

SELECT * FROM finish();
ROLLBACK;
