-- pgTAP: analityka silnika rekomendacji nie przekracza granicy najemcy.
--
-- FINDING (audyt modulu 17, K5): `related_posts_signals/2` (20260716212125)
-- przyjmowala `_tenant` jako PARAMETR od klienta, a autoryzowala wylacznie role
-- (`has_role(auth.uid(),'admin')`). `has_role` jest zakresowany najemca DOMOWYM,
-- wiec admin najemcy A przechodzil bramke we WLASNYM obszarze i podmieniajac
-- jeden uuid w `supabase.rpc()` odczytywal analityke tresci najemcy B (tytuly
-- wpisow, odslony, unikalnych czytelnikow, pary klikniec). Funkcja jest
-- SECURITY DEFINER, wiec RLS tego nie zatrzymywalo.
--
-- Weryfikuje migracje 20260812090500_related_posts_signals_tenant_scope.sql:
--   1. parametru `_tenant` NIE MA, a stare przeciazenie `(uuid, integer)`
--      zostalo zdropowane - wolanie z atakiem nie ma juz czego trafic;
--   2. najemca pochodzi z `assert_admin_tenant()`, wiec ten sam RPC zwraca
--      DWA ROZNE obszary robocze zaleznie od wolajacego, i nigdy sumy obu;
--   3. bramka jest fail-closed dla wolajacego bez roli admina.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa najemcy, po dwa opublikowane wpisy ────────────────────────────
INSERT INTO public.tenants (id, slug, name) VALUES
  ('a5111111-1111-1111-1111-1111111111a5', 'signals-a', 'Signals Tenant A'),
  ('b5222222-2222-2222-2222-2222222222b5', 'signals-b', 'Signals Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a5000000-0000-0000-0000-0000000000d1', 'admin-a@signals.test'),
  ('a5000000-0000-0000-0000-0000000000d2', 'member-a@signals.test'),
  ('b5000000-0000-0000-0000-0000000000d3', 'admin-b@signals.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a5000000-0000-0000-0000-0000000000d1', 'admin-a@signals.test', 'Admin A',
   'a5111111-1111-1111-1111-1111111111a5'),
  ('a5000000-0000-0000-0000-0000000000d2', 'member-a@signals.test', 'Member A',
   'a5111111-1111-1111-1111-1111111111a5'),
  ('b5000000-0000-0000-0000-0000000000d3', 'admin-b@signals.test', 'Admin B',
   'b5222222-2222-2222-2222-2222222222b5');

-- Rola admina przypieta do WLASNEGO najemcy (has_role zakresowany profilem).
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a5000000-0000-0000-0000-0000000000d1', 'admin'::public.app_role,
   'a5111111-1111-1111-1111-1111111111a5'),
  ('b5000000-0000-0000-0000-0000000000d3', 'admin'::public.app_role,
   'b5222222-2222-2222-2222-2222222222b5');

-- posts.parent_page_id jest NOT NULL → strona-rodzic per najemca.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('a5aaaaaa-0000-0000-0000-00000000000a', 'a5111111-1111-1111-1111-1111111111a5', 'signals-a-home'),
  ('b5bbbbbb-0000-0000-0000-00000000000b', 'b5222222-2222-2222-2222-2222222222b5', 'signals-b-home');

-- Tytuly sa rozlaczne miedzy najemcami, zeby przeciek dal sie odroznic od
-- pustej zwrotki: kazdy tytul jednoznacznie wskazuje zrodlowego najemce.
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('a5000000-0000-0000-0000-0000000000e1', 'signals-a-src',
   'a5000000-0000-0000-0000-0000000000d1', 'published',
   'a5111111-1111-1111-1111-1111111111a5', 'a5aaaaaa-0000-0000-0000-00000000000a', 'Sygnal A'),
  ('a5000000-0000-0000-0000-0000000000e2', 'signals-a-tgt',
   'a5000000-0000-0000-0000-0000000000d1', 'published',
   'a5111111-1111-1111-1111-1111111111a5', 'a5aaaaaa-0000-0000-0000-00000000000a', 'Sygnal A cel'),
  ('b5000000-0000-0000-0000-0000000000f1', 'signals-b-src',
   'b5000000-0000-0000-0000-0000000000d3', 'published',
   'b5222222-2222-2222-2222-2222222222b5', 'b5bbbbbb-0000-0000-0000-00000000000b', 'Sygnal B'),
  ('b5000000-0000-0000-0000-0000000000f2', 'signals-b-tgt',
   'b5000000-0000-0000-0000-0000000000d3', 'published',
   'b5222222-2222-2222-2222-2222222222b5', 'b5bbbbbb-0000-0000-0000-00000000000b', 'Sygnal B cel');

-- Odslony: 2 w A (dwa rozne viewer_hash), 3 w B. Kazda liczba jest inna, wiec
-- wyciek zmienia wynik, a nie tylko go "rozmywa".
INSERT INTO public.post_views (post_id, tenant_id, viewer_hash, viewed_at) VALUES
  ('a5000000-0000-0000-0000-0000000000e1', 'a5111111-1111-1111-1111-1111111111a5', 'hash-a-1', now()),
  ('a5000000-0000-0000-0000-0000000000e1', 'a5111111-1111-1111-1111-1111111111a5', 'hash-a-2', now()),
  ('b5000000-0000-0000-0000-0000000000f1', 'b5222222-2222-2222-2222-2222222222b5', 'hash-b-1', now()),
  ('b5000000-0000-0000-0000-0000000000f1', 'b5222222-2222-2222-2222-2222222222b5', 'hash-b-2', now()),
  ('b5000000-0000-0000-0000-0000000000f1', 'b5222222-2222-2222-2222-2222222222b5', 'hash-b-3', now());

INSERT INTO public.related_post_clicks
  (tenant_id, source_post_id, target_post_id, viewer_hash, clicked_at) VALUES
  ('a5111111-1111-1111-1111-1111111111a5', 'a5000000-0000-0000-0000-0000000000e1',
   'a5000000-0000-0000-0000-0000000000e2', 'hash-a-1', now()),
  ('b5222222-2222-2222-2222-2222222222b5', 'b5000000-0000-0000-0000-0000000000f1',
   'b5000000-0000-0000-0000-0000000000f2', 'hash-b-1', now()),
  ('b5222222-2222-2222-2222-2222222222b5', 'b5000000-0000-0000-0000-0000000000f1',
   'b5000000-0000-0000-0000-0000000000f2', 'hash-b-2', now());

INSERT INTO public.user_read_history (user_id, tenant_id, post_id, read_at) VALUES
  ('a5000000-0000-0000-0000-0000000000d1', 'a5111111-1111-1111-1111-1111111111a5',
   'a5000000-0000-0000-0000-0000000000e1', now()),
  ('b5000000-0000-0000-0000-0000000000d3', 'b5222222-2222-2222-2222-2222222222b5',
   'b5000000-0000-0000-0000-0000000000f1', now()),
  ('b5000000-0000-0000-0000-0000000000d3', 'b5222222-2222-2222-2222-2222222222b5',
   'b5000000-0000-0000-0000-0000000000f2', now());

-- ── 1. Sygnatura: najemcy nie da sie podac z zewnatrz ───────────────────────
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'related_posts_signals'),
  1,
  'related_posts_signals ma dokladnie jedno przeciazenie (stare (uuid, integer) zdropowane)'
);

SELECT is(
  (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'related_posts_signals'),
  '_since_days integer DEFAULT 28',
  'sygnatura przyjmuje tylko okno czasowe - parametru najemcy nie ma'
);

SELECT throws_ok(
  $$SELECT public.related_posts_signals(
      'b5222222-2222-2222-2222-2222222222b5'::uuid, 28)$$,
  '42883',
  NULL,
  'wolanie z podanym najemca (wektor ataku) nie ma juz czego trafic - 42883'
);

-- ── 2. Granty: powierzchnia adminowa nie jest publiczna ────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.related_posts_signals(integer)', 'EXECUTE'),
  'anon NIE ma EXECUTE na related_posts_signals'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.related_posts_signals(integer)', 'EXECUTE'),
  'authenticated ZACHOWUJE EXECUTE (panel admina nadal dziala)'
);

-- ── 3. Fail-closed: sesja czlonka bez roli admina ──────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.related_posts_signals(28)$$,
  'P0001',
  NULL,
  'czlonek bez roli admina dostaje wyjatek z assert_admin_tenant (fail-closed)'
);

-- ── 4. Admin najemcy A widzi WYLACZNIE obszar A ────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

SELECT is(
  (public.related_posts_signals(28)->'summary'->>'total_posts')::int,
  2,
  'total_posts liczy tylko wpisy najemcy A (nie 4 z obu najemcow)'
);
SELECT is(
  (public.related_posts_signals(28)->'summary'->>'total_views')::int,
  2,
  'total_views liczy tylko odslony najemcy A (nie 5 z obu najemcow)'
);
SELECT is(
  (public.related_posts_signals(28)->'summary'->>'total_clicks')::int,
  1,
  'total_clicks liczy tylko kliki najemcy A (nie 3 z obu najemcow)'
);
SELECT is(
  (public.related_posts_signals(28)->'summary'->>'total_reads')::int,
  1,
  'total_reads liczy tylko historie czytania najemcy A (nie 3 z obu najemcow)'
);
SELECT is(
  jsonb_array_length(public.related_posts_signals(28)->'popularity'),
  1,
  'popularity zwraca jeden wpis - ten jedyny ogladany w najemcy A'
);
SELECT is(
  public.related_posts_signals(28)->'popularity'->0->>'title',
  'Sygnal A',
  'tytul wpisu najemcy B nie wycieka do rankingu popularnosci admina A'
);

-- ── 5. Ten sam RPC, inny wolajacy = inny obszar (nie suma obu) ─────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"b5000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);

SELECT is(
  (public.related_posts_signals(28)->'summary'->>'total_views')::int,
  3,
  'admin najemcy B widzi swoje 3 odslony (zakres idzie za wolajacym, nie jest globalny)'
);
SELECT is(
  public.related_posts_signals(28)->'popularity'->0->>'title',
  'Sygnal B',
  'ranking admina B pokazuje wpis B - i tylko jego'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
