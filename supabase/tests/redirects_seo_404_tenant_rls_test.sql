-- pgTAP: granica najemcy menedżera przekierowań i monitora 404
-- (migracja 20260703090300_redirects_tenant_scope).
--
-- Klasa błędu: `public.redirects` była tabelą GLOBALNĄ (unikalność na samym
-- `source_path`), zarządzaną przez adminów/redaktorów DOWOLNEGO najemcy - czyli
-- redakcja jednej organizacji mogła założyć albo nadpisać regułę, która
-- przechwytuje ruch innej (middleware dopasowywał reguły kluczem serwisowym,
-- ślepo na najemcę). Razem z absolutnymi celami https:// był to prymityw
-- przejęcia ruchu między najemcami. `seo_404_hits` miało ten sam kształt.
--
-- Ten plik pilnuje po stronie bazy:
--   1. KSZTAŁTU polityk: wszystkie cztery ścieżki `redirects` i obie ścieżki
--      `seo_404_hits` wiążą wiersz z current_tenant_id(); monitor 404 nie ma
--      ŻADNEJ polityki zapisu dla klienta (asercje 1-7),
--   2. ZACHOWANIA RLS `redirects`: admin/redaktor najemcy A czyta, wstawia,
--      zmienia i kasuje WYŁĄCZNIE wiersze A; WITH CHECK odrzuca obcy
--      `tenant_id` przy INSERT i UPDATE; admin najemcy B nie widzi i nie rusza
--      wierszy A; zalogowany nie-redaktor nie czyta i nie wstawia nic (8-25),
--   3. ZACHOWANIA RLS `seo_404_hits`: redakcja czyta i kasuje tylko swoje,
--      nie wstawia nic; nie-redaktor nie czyta nic (26-31),
--   4. anon nie czyta żadnej z dwóch tabel (32-33),
--   5. UPRAWNIEŃ RPC: `record_seo_404` i `record_redirect_hit` są SECURITY
--      DEFINER, odebrane PUBLIC i nadane service_role (34-37), a anon
--      i authenticated NIE mają EXECUTE (38-41, migracja 20261002140000),
--   6. ATOMOWOŚCI zapisu, na której od 2026-10-02 stoi aplikacja
--      (`src/lib/seo/redirects.server.ts` woła oba RPC zamiast read-then-write):
--      dwa `record_seo_404` na tę samą ścieżkę dają hits = 2, brak referera nie
--      kasuje ostatniego znanego, ten sam adres u innego najemcy to osobny
--      wpis, ścieżka jest cięta do 500 znaków; `record_redirect_hit` podbija
--      wyłącznie wskazaną regułę (42-52).
--
-- PLIK NIEURUCHOMIONY przy powstaniu (środowisko bez Dockera/psql/Supabase
-- CLI): zbudowany wyłącznie na konwencjach sąsiednich plików
-- (email_log_tenant_scope_test.sql, user_bookmarks_tenant_isolation_test.sql,
-- related_posts_config_provisioning_test.sql). Pierwszy przebieg joba pgtap
-- jest jego pierwszą weryfikacją.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(52);

-- ── (1-4) KSZTAŁT: cztery polityki redirects wiążą najemcę ──────────────────
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'redirects'
      AND policyname = 'Staff reads redirects') ~ 'current_tenant_id',
  'polityka SELECT redirects wiaze wiersz z current_tenant_id()'
);

SELECT ok(
  (SELECT with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'redirects'
      AND policyname = 'Staff inserts redirects') ~ 'current_tenant_id',
  'polityka INSERT redirects wiaze wiersz z current_tenant_id() w WITH CHECK'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'redirects'
      AND policyname = 'Staff updates redirects') ~ 'current_tenant_id'
  AND (SELECT with_check FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'redirects'
          AND policyname = 'Staff updates redirects') ~ 'current_tenant_id',
  'polityka UPDATE redirects wiaze najemce w USING I WITH CHECK'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'redirects'
      AND policyname = 'Staff deletes redirects') ~ 'current_tenant_id',
  'polityka DELETE redirects wiaze wiersz z current_tenant_id()'
);

-- ── (5-7) KSZTAŁT: seo_404_hits - odczyt i kasowanie, bez zapisu klienta ────
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seo_404_hits'
      AND policyname = 'Staff reads 404 hits') ~ 'current_tenant_id',
  'polityka SELECT seo_404_hits wiaze wiersz z current_tenant_id()'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seo_404_hits'
      AND policyname = 'Staff deletes 404 hits') ~ 'current_tenant_id',
  'polityka DELETE seo_404_hits wiaze wiersz z current_tenant_id()'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'seo_404_hits'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')),
  0,
  'seo_404_hits nie ma polityki zapisu - wpisy powstaja wylacznie przez record_seo_404'
);

-- ── Seed: dwaj najemcy; w A admin, redaktor i autor (nie-redakcja), w B admin ─
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e1a11111-1111-4111-8111-111111111111', 'redir-a', 'Redirect Tenant A', 'a.redir.example'),
  ('e2b22222-2222-4222-8222-222222222222', 'redir-b', 'Redirect Tenant B', 'b.redir.example');

INSERT INTO auth.users (id, email) VALUES
  ('e3000000-0000-4000-8000-0000000000a1', 'admin-a@redir.test'),
  ('e3000000-0000-4000-8000-0000000000a2', 'editor-a@redir.test'),
  ('e3000000-0000-4000-8000-0000000000a3', 'author-a@redir.test'),
  ('e3000000-0000-4000-8000-0000000000b1', 'admin-b@redir.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e3000000-0000-4000-8000-0000000000a1', 'admin-a@redir.test', 'Admin A',
   'e1a11111-1111-4111-8111-111111111111'),
  ('e3000000-0000-4000-8000-0000000000a2', 'editor-a@redir.test', 'Editor A',
   'e1a11111-1111-4111-8111-111111111111'),
  ('e3000000-0000-4000-8000-0000000000a3', 'author-a@redir.test', 'Author A',
   'e1a11111-1111-4111-8111-111111111111'),
  ('e3000000-0000-4000-8000-0000000000b1', 'admin-b@redir.test', 'Admin B',
   'e2b22222-2222-4222-8222-222222222222');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e3000000-0000-4000-8000-0000000000a1', 'admin'::public.app_role,
   'e1a11111-1111-4111-8111-111111111111'),
  ('e3000000-0000-4000-8000-0000000000a2', 'editor'::public.app_role,
   'e1a11111-1111-4111-8111-111111111111'),
  ('e3000000-0000-4000-8000-0000000000a3', 'author'::public.app_role,
   'e1a11111-1111-4111-8111-111111111111'),
  ('e3000000-0000-4000-8000-0000000000b1', 'admin'::public.app_role,
   'e2b22222-2222-4222-8222-222222222222');

INSERT INTO public.redirects (id, tenant_id, source_path, target_path, status_code) VALUES
  ('e4000000-0000-4000-8000-0000000000a1', 'e1a11111-1111-4111-8111-111111111111',
   '/a-stary', '/a-nowy', 301),
  ('e4000000-0000-4000-8000-0000000000a2', 'e1a11111-1111-4111-8111-111111111111',
   '/a-do-skasowania', '/a-nowy', 301),
  ('e4000000-0000-4000-8000-0000000000b1', 'e2b22222-2222-4222-8222-222222222222',
   '/b-stary', '/b-nowy', 301);

INSERT INTO public.seo_404_hits (tenant_id, path, hits) VALUES
  ('e1a11111-1111-4111-8111-111111111111', '/a-404', 3),
  ('e2b22222-2222-4222-8222-222222222222', '/b-404', 5);

-- ── (8-17) ADMIN NAJEMCY A: pełny CRUD na swoich, zero na cudzych ───────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000a1'),
  1,
  'legit: admin A czyta regule WLASNEGO najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE tenant_id = 'e2b22222-2222-4222-8222-222222222222'),
  0,
  'izolacja: admin A nie widzi ANI JEDNEJ reguly najemcy B'
);

SELECT lives_ok(
  $$INSERT INTO public.redirects (source_path, target_path, status_code)
      VALUES ('/a-wstawiony', '/a-cel', 301)$$,
  'legit: INSERT bez tenant_id przechodzi (DEFAULT current_tenant_id())'
);

SELECT is(
  (SELECT tenant_id FROM public.redirects WHERE source_path = '/a-wstawiony'),
  'e1a11111-1111-4111-8111-111111111111'::uuid,
  'wstawiona regula trafia do najemcy domowego A, nie do publicznego'
);

-- Obcy najemca jest ISTNIEJĄCY (B), żeby test mierzył politykę RLS, a nie
-- klucz obcy - inaczej nie wiadomo, co odrzuciło zapis.
SELECT throws_ok(
  $$INSERT INTO public.redirects (tenant_id, source_path, target_path, status_code)
      VALUES ('e2b22222-2222-4222-8222-222222222222', '/przejecie', '/a-cel', 301)$$,
  '42501',
  NULL,
  'izolacja: INSERT z tenant_id=B jest odrzucony przez WITH CHECK (przejecie ruchu B)'
);

SELECT throws_ok(
  $$UPDATE public.redirects
       SET tenant_id = 'e2b22222-2222-4222-8222-222222222222'
     WHERE id = 'e4000000-0000-4000-8000-0000000000a1'$$,
  '42501',
  NULL,
  'izolacja: przepiecie WLASNEJ reguly do najemcy B jest odrzucone przez WITH CHECK'
);

SELECT lives_ok(
  $$UPDATE public.redirects SET target_path = '/a-zmieniony'
     WHERE id = 'e4000000-0000-4000-8000-0000000000a1'$$,
  'legit: admin A zmienia cel wlasnej reguly'
);

-- UPDATE i DELETE cudzego wiersza nie rzucają - USING po prostu go nie
-- dopasowuje. Dowodem jest stan wiersza czytany PO zdjęciu roli (asercje 24-25).
UPDATE public.redirects SET target_path = '/przejete'
 WHERE id = 'e4000000-0000-4000-8000-0000000000b1';
DELETE FROM public.redirects WHERE id = 'e4000000-0000-4000-8000-0000000000b1';

SELECT lives_ok(
  $$DELETE FROM public.redirects WHERE id = 'e4000000-0000-4000-8000-0000000000a2'$$,
  'legit: admin A kasuje wlasna regule'
);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000a2'),
  0,
  'skasowana regula A znika z widoku admina A'
);

SELECT is(
  (SELECT target_path FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000a1'),
  '/a-zmieniony',
  'zmiana celu wlasnej reguly jest widoczna dla admina A'
);

-- ── (18-19) REDAKTOR NAJEMCY A: ta sama redakcyjna granica ──────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000a1'),
  1,
  'legit: redaktor A czyta regule najemcy A (polityka admin OR editor)'
);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE tenant_id = 'e2b22222-2222-4222-8222-222222222222'),
  0,
  'izolacja: redaktor A nie widzi regul najemcy B'
);

-- ── (20-21) ADMIN NAJEMCY B: lustro - nie widzi A, widzi swoje ──────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE tenant_id = 'e1a11111-1111-4111-8111-111111111111'),
  0,
  'izolacja: admin B nie widzi ANI JEDNEJ reguly najemcy A'
);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000b1'),
  1,
  'legit: admin B widzi swoja regule (przezyla UPDATE/DELETE z sesji A)'
);

-- ── (22-23) ZALOGOWANY NIE-REDAKTOR (autor A): nic nie czyta, nic nie wstawia ─
SELECT set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.redirects),
  0,
  'autor najemcy A nie czyta zadnej reguly - przekierowania to narzedzie redakcji'
);

SELECT throws_ok(
  $$INSERT INTO public.redirects (source_path, target_path, status_code)
      VALUES ('/autor-probuje', '/cel', 301)$$,
  '42501',
  NULL,
  'autor najemcy A nie zaklada reguly (WITH CHECK wymaga admin/editor)'
);

-- ── (24-25) Stan cudzego wiersza po próbach z sesji A - czytany bez RLS ─────
RESET ROLE;

SELECT is(
  (SELECT target_path FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000b1'),
  '/b-nowy',
  'UPDATE z sesji admina A nie zmienil reguly najemcy B'
);

SELECT is(
  (SELECT count(*)::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000b1'),
  1,
  'DELETE z sesji admina A nie skasowal reguly najemcy B'
);

-- ── (26-31) seo_404_hits: redakcja czyta i kasuje WYŁĄCZNIE swoje ───────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT hits::int FROM public.seo_404_hits WHERE path = '/a-404'),
  3,
  'legit: admin A czyta wpis 404 wlasnego najemcy'
);

SELECT is(
  (SELECT count(*)::int FROM public.seo_404_hits
    WHERE tenant_id = 'e2b22222-2222-4222-8222-222222222222'),
  0,
  'izolacja: admin A nie widzi wpisow 404 najemcy B (adresy i referery obcej witryny)'
);

SELECT throws_ok(
  $$INSERT INTO public.seo_404_hits (tenant_id, path)
      VALUES ('e1a11111-1111-4111-8111-111111111111', '/podrobione-404')$$,
  '42501',
  NULL,
  'admin A nie wstawia wpisu 404 bezposrednio - brak grantu i polityki INSERT'
);

DELETE FROM public.seo_404_hits WHERE path = '/b-404';
DELETE FROM public.seo_404_hits WHERE path = '/a-404';

SELECT is(
  (SELECT count(*)::int FROM public.seo_404_hits WHERE path = '/a-404'),
  0,
  'legit: admin A kasuje (odrzuca) wlasny wpis 404'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e3000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.seo_404_hits),
  0,
  'autor najemcy A nie czyta monitora 404'
);

RESET ROLE;

SELECT is(
  (SELECT hits::int FROM public.seo_404_hits
    WHERE tenant_id = 'e2b22222-2222-4222-8222-222222222222' AND path = '/b-404'),
  5,
  'DELETE z sesji admina A nie skasowal wpisu 404 najemcy B'
);

-- ── (32-33) ANON nie czyta nic ──────────────────────────────────────────────
-- Grant SELECT dla anon na tych tabelach zależy od domyślnych uprawnień
-- platformy, a nie od migracji repo - więc wynik odczytu łapiemy w bloku DO:
-- odmowa grantu (42501) i zero wierszy z RLS to OBA poprawne zakończenia,
-- a jedynym błędnym jest choć jeden widoczny wiersz.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', NULL, true);

DO $$
BEGIN
  PERFORM set_config('test.anon_redirects', (SELECT count(*) FROM public.redirects)::text, true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('test.anon_redirects', 'brak grantu', true);
END $$;

DO $$
BEGIN
  PERFORM set_config('test.anon_404', (SELECT count(*) FROM public.seo_404_hits)::text, true);
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('test.anon_404', 'brak grantu', true);
END $$;

RESET ROLE;

SELECT ok(
  current_setting('test.anon_redirects') IN ('0', 'brak grantu'),
  'anon nie czyta zadnej reguly przekierowania'
);

SELECT ok(
  current_setting('test.anon_404') IN ('0', 'brak grantu'),
  'anon nie czyta monitora 404'
);

-- ── (34-37) RPC: SECURITY DEFINER, odebrane PUBLIC, nadane service_role ─────
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p
    WHERE p.oid = 'public.record_seo_404(uuid, text, text)'::regprocedure)
  AND (SELECT p.prosecdef FROM pg_proc p
        WHERE p.oid = 'public.record_redirect_hit(uuid)'::regprocedure),
  'record_seo_404 i record_redirect_hit sa SECURITY DEFINER (pisza z pominieciem RLS)'
);

SELECT ok(
  NOT has_function_privilege('public', 'public.record_seo_404(uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.record_redirect_hit(uuid)', 'EXECUTE'),
  'PUBLIC nie ma EXECUTE na zadnym z dwoch RPC licznikow'
);

SELECT ok(
  has_function_privilege('service_role', 'public.record_seo_404(uuid, text, text)', 'EXECUTE'),
  'service_role wykonuje record_seo_404 (monitor 404 middleware)'
);

SELECT ok(
  has_function_privilege('service_role', 'public.record_redirect_hit(uuid)', 'EXECUTE'),
  'service_role wykonuje record_redirect_hit (licznik trafien middleware)'
);

-- ── (38-41) anon/authenticated BEZ EXECUTE ──────────────────────────────────
-- Migracje zakładające obie funkcje robiły wyłącznie `REVOKE ALL ... FROM
-- PUBLIC`, a domyślne uprawnienia platformy Supabase nadają EXECUTE na nowe
-- funkcje w `public` JAWNIE rolom anon/authenticated - takiego grantu REVOKE
-- FROM PUBLIC nie zdejmuje. Skutek luki: anon przez /rest/v1/rpc/record_seo_404
-- dopisywał dowolne ścieżki do monitora 404 DOWOLNEGO najemcy (SECURITY
-- DEFINER pomija RLS), a przez record_redirect_hit podbijał liczniki reguł.
-- Zamyka ją migracja 20261002140000_redirect_hit_seo_404_rpc_execute_service_role_only
-- (`REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`); do niej te asercje
-- stały w bloku todo_start - teraz są twarde.
SELECT ok(
  NOT has_function_privilege('anon', 'public.record_seo_404(uuid, text, text)', 'EXECUTE'),
  'anon NIE wykonuje record_seo_404'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_seo_404(uuid, text, text)', 'EXECUTE'),
  'authenticated NIE wykonuje record_seo_404'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.record_redirect_hit(uuid)', 'EXECUTE'),
  'anon NIE wykonuje record_redirect_hit'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_redirect_hit(uuid)', 'EXECUTE'),
  'authenticated NIE wykonuje record_redirect_hit'
);

-- ── (42-47) ATOMOWOŚĆ record_seo_404 (jako service_role, jak middleware) ────
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$SELECT public.record_seo_404('e1a11111-1111-4111-8111-111111111111'::uuid,
                                 '/nowe-404', 'https://ref.example/1')$$,
  'service_role: pierwsze trafienie zaklada wpis'
);

SELECT lives_ok(
  $$SELECT public.record_seo_404('e1a11111-1111-4111-8111-111111111111'::uuid,
                                 '/nowe-404', NULL)$$,
  'service_role: drugie trafienie na te sama sciezke (bez referera)'
);

SELECT lives_ok(
  $$SELECT public.record_seo_404('e2b22222-2222-4222-8222-222222222222'::uuid, '/nowe-404')$$,
  'service_role: ta sama sciezka u najemcy B'
);

SELECT lives_ok(
  $$SELECT public.record_seo_404('e1a11111-1111-4111-8111-111111111111'::uuid,
                                 repeat('x', 600))$$,
  'service_role: sciezka dluzsza niz 500 znakow nie wywraca zapisu'
);

RESET ROLE;

SELECT is(
  (SELECT (hits::int, last_referrer)::text FROM public.seo_404_hits
    WHERE tenant_id = 'e1a11111-1111-4111-8111-111111111111' AND path = '/nowe-404'),
  '(2,https://ref.example/1)',
  'dwa wywolania = hits 2 w JEDNYM wierszu; brak referera NIE kasuje ostatniego znanego'
);

SELECT is(
  (SELECT string_agg(hits::text || '@' || char_length(path)::text, ',' ORDER BY tenant_id)
     FROM public.seo_404_hits
    WHERE (tenant_id = 'e2b22222-2222-4222-8222-222222222222' AND path = '/nowe-404')
       OR (tenant_id = 'e1a11111-1111-4111-8111-111111111111' AND path = repeat('x', 500))),
  '1@500,1@9',
  'ten sam adres u B to osobny wpis (hits 1), a sciezka A jest cieta do 500 znakow'
);

-- ── (48-52) record_redirect_hit podbija WYŁĄCZNIE wskazaną regułę ───────────
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$SELECT public.record_redirect_hit('e4000000-0000-4000-8000-0000000000a1'::uuid)$$,
  'service_role: pierwsze trafienie reguly A'
);

SELECT lives_ok(
  $$SELECT public.record_redirect_hit('e4000000-0000-4000-8000-0000000000a1'::uuid)$$,
  'service_role: drugie trafienie reguly A'
);

SELECT lives_ok(
  $$SELECT public.record_redirect_hit('e4ffffff-ffff-4fff-8fff-ffffffffffff'::uuid)$$,
  'service_role: nieistniejace id to no-op, nie blad (regula skasowana miedzy odczytem a trafieniem)'
);

RESET ROLE;

SELECT is(
  (SELECT hit_count::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000a1'
      AND last_hit_at IS NOT NULL),
  2,
  'dwa wywolania = hit_count 2 i ustawione last_hit_at na regule A'
);

SELECT is(
  (SELECT hit_count::int FROM public.redirects
    WHERE id = 'e4000000-0000-4000-8000-0000000000b1'),
  0,
  'licznik reguly najemcy B nietkniety - UPDATE idzie po samym id'
);

SELECT * FROM finish();
ROLLBACK;
