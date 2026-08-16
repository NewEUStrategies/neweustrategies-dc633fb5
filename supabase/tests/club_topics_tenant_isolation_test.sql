-- pgTAP: izolacja najemców w odczycie katalogu obszarów tematycznych klubów
-- (migracja 20260816090000). Bramka anti-regresyjna dla findingu
-- "club_topics_public_read USING (true)":
--
--   * polityka `club_topics_public_read` stała na USING (true) - anon i
--     authenticated czytali etykiety obszarów WSZYSTKICH najemców, wbrew
--     wzorcowi z bliźniaczego `club_specializations` (20260811110015);
--   * ta sama klasa wycieku w SECURITY DEFINER RPC `club_topics_active()`:
--     COALESCE(_caller_tenant(), ct.tenant_id) dla anon degeneruje się do
--     tautologii `ct.tenant_id = ct.tenant_id`, więc RPC zwracał katalogi
--     wszystkich najemców naraz - SECURITY DEFINER omija RLS, bez poprawki
--     ciała funkcji poprawka polityki byłaby martwą literą.
--
-- Plik przybija: wiązanie tenant_id = COALESCE(_caller_tenant(),
-- public_tenant_id()) w polityce (pg_policies) ORAZ w ciele RPC; anon widzi
-- wyłącznie katalog najemcy z nagłówka x-tenant-host (symetria obu domen,
-- bez nagłówka - żadnego z najemców testowych); zalogowany widzi wyłącznie
-- katalog SWOJEGO tenanta, a podmiana nagłówka na cudzą domenę niczego nie
-- otwiera - ani przez tabelę, ani przez RPC.

BEGIN;
SELECT plan(13);

-- ── (1) Strukturalnie: polityka i ciało RPC wiążą najemcę ───────────────────
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'club_topics'
      AND policyname = 'club_topics_public_read') ~ '_caller_tenant'
  AND (SELECT qual FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'club_topics'
          AND policyname = 'club_topics_public_read') ~ 'public_tenant_id',
  'club_topics_public_read wiąże wiersz z COALESCE(_caller_tenant(), public_tenant_id()) zamiast USING (true)'
);

SELECT ok(
  pg_get_functiondef('public.club_topics_active()'::regprocedure) ~ 'public_tenant_id',
  'club_topics_active() filtruje po tenancie w CIELE (SECURITY DEFINER omija RLS, tautologia = wyciek)'
);

-- ── Seed: dwaj najemcy z domenami, członek w A, katalogi po obu stronach ────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('ca111111-1111-1111-1111-111111111111', 'topics-a', 'Topics A', 'topics-a.example'),
  ('cb222222-2222-2222-2222-222222222222', 'topics-b', 'Topics B', 'topics-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'member@topics-a.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'member@topics-a.test', 'Member A',
   'ca111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('ca000000-0000-0000-0000-000000000001', 'user',
   'ca111111-1111-1111-1111-111111111111');

INSERT INTO public.club_topics (tenant_id, key, label_pl, label_en, sort_order) VALUES
  ('ca111111-1111-1111-1111-111111111111', 'cta_geopolitics', 'Geopolityka A', 'Geopolitics A', 10),
  ('ca111111-1111-1111-1111-111111111111', 'cta_transport',   'Transport A',   'Transport A',   20),
  ('cb222222-2222-2222-2222-222222222222', 'ctb_only',        'Sekret B',      'Secret B',      10);

-- ── (2) Anon na domenie najemcy A ───────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"topics-a.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id = 'ca111111-1111-1111-1111-111111111111'),
  2,
  'anon na domenie A czyta katalog najemcy A (publiczny plan host-aware)'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id = 'cb222222-2222-2222-2222-222222222222'),
  0,
  'anon na domenie A NIE czyta katalogu najemcy B (koniec USING (true))'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics_active()),
  2,
  'club_topics_active() dla anon zwraca wyłącznie katalog najemcy z nagłówka'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics_active() WHERE key = 'ctb_only'),
  0,
  'club_topics_active() dla anon nie przemyca kluczy obcego najemcy'
);

-- ── (3) Anon na domenie najemcy B (symetria) ────────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"topics-b.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id = 'cb222222-2222-2222-2222-222222222222'),
  1,
  'anon na domenie B czyta katalog najemcy B'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id = 'ca111111-1111-1111-1111-111111111111'),
  0,
  'anon na domenie B NIE czyta katalogu najemcy A'
);

-- ── (4) Anon bez nagłówka: fallback na tenant domyślny, nie na "wszystko" ───
SELECT set_config('request.headers', '{}', true);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id IN ('ca111111-1111-1111-1111-111111111111',
                         'cb222222-2222-2222-2222-222222222222')),
  0,
  'anon bez x-tenant-host nie widzi żadnego z najemców testowych'
);

-- ── (5) Zalogowany członek A z nagłówkiem podmienionym na domenę B ──────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"topics-b.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id = 'ca111111-1111-1111-1111-111111111111'),
  2,
  'zalogowany czyta katalog SWOJEGO tenanta (_caller_tenant() ma pierwszeństwo przed nagłówkiem)'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics
     WHERE tenant_id = 'cb222222-2222-2222-2222-222222222222'),
  0,
  'podmiana x-tenant-host na cudzą domenę NIE otwiera zalogowanemu cudzego katalogu'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics_active()),
  2,
  'club_topics_active() dla zalogowanego zwraca katalog jego tenanta'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_topics_active() WHERE key = 'ctb_only'),
  0,
  'club_topics_active() dla zalogowanego nie przemyca kluczy obcego najemcy'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
