-- pgTAP: warstwa semantyczna analityki (20260725120000).
--
--   1. web_vitals_daily_p75 liczy p75 metoda NEAREST RANK, czyli zwraca wartosc
--      FAKTYCZNIE zmierzona - identycznie jak agregator w JS
--      (src/lib/observability/aggregate.ts). Wczesniej funkcja uzywala
--      percentile_cont, ktory INTERPOLUJE, wiec trend z bazy i p75 z pamieci
--      pokazywaly dwie rozne liczby dla tych samych probek.
--   2. analytics_semantic_snapshot odmawia nie-adminowi (guard assert_admin_tenant).
--   3. Migawka jest skopowana po tenancie WYWOLUJACEGO: wiersze innego najemcy
--      nigdy nie wchodza do liczb, mimo ze funkcja jest SECURITY DEFINER.
--   4. Migawka respektuje granice okna (zdarzenie sprzed okna nie jest liczone).
--   5. Odwrocone granice sa bledem, nie cichym zerem.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(8);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-1111111111c1', 'tenant-sem-a', 'Tenant SEM A'),
  ('c2222222-2222-2222-2222-2222222222c2', 'tenant-sem-b', 'Tenant SEM B');

INSERT INTO auth.users (id, email) VALUES
  ('c3000000-0000-0000-0000-00000000000a', 'admin-sem-a@sem.test'),
  ('c3000000-0000-0000-0000-00000000000b', 'member-sem-a@sem.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c3000000-0000-0000-0000-00000000000a', 'admin-sem-a@sem.test', 'Admin SEM A',
   'c1111111-1111-1111-1111-1111111111c1'),
  ('c3000000-0000-0000-0000-00000000000b', 'member-sem-a@sem.test', 'Member SEM A',
   'c1111111-1111-1111-1111-1111111111c1');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c3000000-0000-0000-0000-00000000000a', 'admin',
   'c1111111-1111-1111-1111-1111111111c1');

-- ---------------------------------------------------------------------------
-- 1) p75 = nearest rank (wartosc zmierzona), nie interpolacja
-- ---------------------------------------------------------------------------
-- Cztery probki 1000/2000/3000/4000: nearest rank przy 0,75 to element
-- ceil(0,75 * 4) = 3, czyli 3000. percentile_cont zwrocilby 3250 - wartosc,
-- ktorej nikt nie zmierzyl i ktora nie zgadza sie z agregatem w pamieci.
INSERT INTO public.web_vitals (tenant_id, metric, value, created_at) VALUES
  ('c1111111-1111-1111-1111-1111111111c1', 'LCP', 1000, now() - interval '2 hours'),
  ('c1111111-1111-1111-1111-1111111111c1', 'LCP', 2000, now() - interval '2 hours'),
  ('c1111111-1111-1111-1111-1111111111c1', 'LCP', 3000, now() - interval '2 hours'),
  ('c1111111-1111-1111-1111-1111111111c1', 'LCP', 4000, now() - interval '2 hours');

SELECT is(
  (SELECT p75 FROM public.web_vitals_daily_p75(
     now() - interval '1 day', 'c1111111-1111-1111-1111-1111111111c1')
    WHERE metric = 'LCP'),
  3000::double precision,
  'web_vitals_daily_p75 zwraca nearest rank (3000), nie interpolacje (3250)'
);

SELECT ok(
  (SELECT p75 FROM public.web_vitals_daily_p75(
     now() - interval '1 day', 'c1111111-1111-1111-1111-1111111111c1')
    WHERE metric = 'LCP')
  IN (SELECT value FROM public.web_vitals
       WHERE tenant_id = 'c1111111-1111-1111-1111-1111111111c1' AND metric = 'LCP'),
  'zwrocony p75 jest wartoscia, ktora ktos faktycznie zmierzyl'
);

-- ---------------------------------------------------------------------------
-- Dane obu najemcow w oknie + jedno zdarzenie SPRZED okna
-- ---------------------------------------------------------------------------
INSERT INTO public.analytics_events
  (tenant_id, event_type, event_name, session_id, anon_id, created_at) VALUES
  -- Tenant A: 2 odslony, 2 sesje, 2 przegladarki, w oknie.
  ('c1111111-1111-1111-1111-1111111111c1', 'page_view', 'page_view', 'sess-a1', 'anon-a1',
   now() - interval '2 hours'),
  ('c1111111-1111-1111-1111-1111111111c1', 'page_view', 'page_view', 'sess-a2', 'anon-a2',
   now() - interval '3 hours'),
  ('c1111111-1111-1111-1111-1111111111c1', 'cta_click', 'signup_click', 'sess-a1', 'anon-a1',
   now() - interval '2 hours'),
  -- Tenant A: poza oknem (nie moze byc policzone).
  ('c1111111-1111-1111-1111-1111111111c1', 'page_view', 'page_view', 'sess-a9', 'anon-a9',
   now() - interval '30 days'),
  -- Tenant B: nie moze wyciec do migawki tenanta A.
  ('c2222222-2222-2222-2222-2222222222c2', 'page_view', 'page_view', 'sess-b1', 'anon-b1',
   now() - interval '2 hours'),
  ('c2222222-2222-2222-2222-2222222222c2', 'page_view', 'page_view', 'sess-b2', 'anon-b2',
   now() - interval '2 hours');

-- ---------------------------------------------------------------------------
-- 2) Bramka roli
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

SELECT throws_like(
  $$ SELECT public.analytics_semantic_snapshot(now() - interval '1 day', now()) $$,
  '%admin role required%',
  'analytics_semantic_snapshot odmawia nie-adminowi'
);

-- ---------------------------------------------------------------------------
-- 3) Izolacja najemcow + 4) granice okna
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"c3000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT is(
  ((public.analytics_semantic_snapshot(now() - interval '1 day', now())
    -> 'first_party' ->> 'page_views'))::int,
  2,
  'migawka liczy tylko odslony wlasnego najemcy w oknie (nie 4, nie 5)'
);

SELECT is(
  ((public.analytics_semantic_snapshot(now() - interval '1 day', now())
    -> 'first_party' ->> 'sessions'))::int,
  2,
  'sesje to DISTINCT session_id wlasnego najemcy w oknie'
);

SELECT is(
  ((public.analytics_semantic_snapshot(now() - interval '1 day', now())
    -> 'first_party' ->> 'cta_clicks'))::int,
  1,
  'klikniecia CTA sa liczone osobno od odslon'
);

SELECT is(
  ((public.analytics_semantic_snapshot(now() - interval '1 day', now())
    -> 'web_vitals' ->> 'samples'))::int,
  4,
  'probki RUM sa skopowane po najemcy wywolujacego'
);

-- ---------------------------------------------------------------------------
-- 5) Odwrocone granice: blad, nie ciche zero
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT public.analytics_semantic_snapshot(now(), now() - interval '1 day') $$,
  '%since must not exceed until%',
  'odwrocone granice okna sa bledem, nie cichym zerem'
);

SELECT * FROM finish();
ROLLBACK;
