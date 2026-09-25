-- pgTAP: `public.member_slug_is_non_author(text)` nie jest wyrocznia
-- istnienia profili (migracja 20260925100000_member_slug_non_author_visibility,
-- blizniak drizzle 0053).
--
-- FINDING: 0047 (20260924100000) zdefiniowalo te funkcje jako SECURITY DEFINER
-- z EXECUTE dla anon i cialem `EXISTS (SELECT 1 FROM profiles WHERE slug = $1
-- AND NOT is_platform_author(id))` - bez tenanta i bez bramki widocznosci.
-- Niezalogowany zgadywal slugi i dostawal `true` dla KAZDEGO czlonka bez roli
-- autora w DOWOLNYM tenancie, takze dla profili, ktorych `profiles_public` mu
-- nie pokazuje (goly czlonek, opt-in `discoverable` - katalog WEWNETRZNY).
-- Trasa /author/<slug> zamieniala to na roznice 301 (/people) wobec 404.
--
-- Stan docelowy (`true` = 301 z /author na /people):
--   * GOSC - wylacznie profil, ktory widzi w `profiles_public` (to samo
--     zrodlo, z ktorego czyta `get_expert_hub`; warstwa publiczna jest
--     przypieta do tenanta zadania) i bez roli autora;
--   * ZALOGOWANY - wylacznie gdy CEL przekierowania rozwiaze profil:
--     `get_member_profile(slug)` oddaje wiersz z `is_author = false`.
--     Widok pokazuje zalogowanemu wiecej (publiczna obecnosc, tenant
--     zweryfikowanej domeny, personelowi - kazdego czlonka), a 301 na taki
--     profil konczyl sie na /people pustym „Nie znaleziono profilu".
-- Wszystko inne - `false`, czyli trasa zostaje przy hubie, ktory dla
-- niewidocznego profilu i tak konczy sie 404.
--
-- OBIE WARSTWY SA ZYWE. Server fn `isNonAuthorMemberSlug`
-- (src/lib/profile/memberSlug.functions.ts) przekazuje do RPC bearer sesji
-- czytelnika, gdy jest (nawigacja SPA zalogowanego), a bez niego (gosc, SSR)
-- wola jako anon. Stad bloki anon i zalogowanego nizej: anon z parytetem
-- wobec `get_expert_hub`, zalogowany z parytetem w OBIE strony wobec
-- `get_member_profile` (takze na zweryfikowanej domenie obcego tenanta
-- i dla personelu) i bez wyjscia poza hub.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(44);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Tenant DOMOWY = ten, ktory public_tenant_id() zwraca bez naglowka hosta.
CREATE TEMP TABLE msna_ctx AS SELECT public.public_tenant_id() AS home_tenant;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('dd333333-3333-3333-3333-333333333333', 'tenant-msna-z', 'Tenant MSNA Z',
   'msna-z.example');

INSERT INTO auth.users (id, email) VALUES
  ('d5000000-0000-0000-0000-0000000000a1', 'member@msna.test'),
  ('d5000000-0000-0000-0000-0000000000a2', 'author@msna.test'),
  ('d5000000-0000-0000-0000-0000000000a3', 'editor@msna.test'),
  ('d5000000-0000-0000-0000-0000000000a4', 'invited@msna.test'),
  ('d5000000-0000-0000-0000-0000000000a5', 'hidden@msna.test'),
  ('d5000000-0000-0000-0000-0000000000a6', 'disc@msna.test'),
  ('d5000000-0000-0000-0000-0000000000a7', 'viewer@msna.test'),
  ('d5000000-0000-0000-0000-0000000000b1', 'zmember@msna.test');

-- Tenant domowy.
--   a1  czlonek bez roli autora, publicznie obecny (odznaka expert) -> true
--   a2  rola `author` w user_roles                                  -> false
--   a3  rola `editor` w user_roles                                  -> false
--   a4  zaakceptowane zaproszenie z rola `author` (bez user_roles),
--       publicznie obecny przez odznake                             -> false
--   a5  goly czlonek, discoverable = false                          -> false
--   a6  opt-in `discoverable` bez publicznej obecnosci: dla anon
--       niewidoczny, dla zalogowanego z tego tenanta widoczny
--   a7  zalogowany wolajacy (goly czlonek)
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, discoverable)
SELECT v.id, v.email, v.name, v.slug, (SELECT home_tenant FROM msna_ctx), v.disc
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000a1'::uuid, 'member@msna.test',  'MSNA Member',  'msna-member',  false),
    ('d5000000-0000-0000-0000-0000000000a2'::uuid, 'author@msna.test',  'MSNA Author',  'msna-author',  false),
    ('d5000000-0000-0000-0000-0000000000a3'::uuid, 'editor@msna.test',  'MSNA Editor',  'msna-editor',  false),
    ('d5000000-0000-0000-0000-0000000000a4'::uuid, 'invited@msna.test', 'MSNA Invited', 'msna-invited', false),
    ('d5000000-0000-0000-0000-0000000000a5'::uuid, 'hidden@msna.test',  'MSNA Hidden',  'msna-hidden',  false),
    ('d5000000-0000-0000-0000-0000000000a6'::uuid, 'disc@msna.test',    'MSNA Disc',    'msna-disc',    true),
    ('d5000000-0000-0000-0000-0000000000a7'::uuid, 'viewer@msna.test',  'MSNA Viewer',  'msna-viewer',  false)
  ) AS v(id, email, name, slug, disc);

-- Tenant Z: czlonek bez roli autora, publicznie obecny W SWOIM tenancie.
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, discoverable) VALUES
  ('d5000000-0000-0000-0000-0000000000b1', 'zmember@msna.test', 'MSNA Z Member',
   'msna-z-member', 'dd333333-3333-3333-3333-333333333333', true);

INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT v.id, v.role, (SELECT home_tenant FROM msna_ctx)
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000a2'::uuid, 'author'::public.app_role),
    ('d5000000-0000-0000-0000-0000000000a3'::uuid, 'editor'::public.app_role)
  ) AS v(id, role);

INSERT INTO public.user_invitations (tenant_id, email, role, status, auth_user_id, accepted_at)
SELECT (SELECT home_tenant FROM msna_ctx), 'invited@msna.test', 'author'::public.app_role,
       'accepted'::public.invitation_status, 'd5000000-0000-0000-0000-0000000000a4', now();

INSERT INTO public.profile_badges (tenant_id, user_id, badge)
SELECT (SELECT home_tenant FROM msna_ctx), v.id, 'expert'
  FROM (VALUES
    ('d5000000-0000-0000-0000-0000000000a1'::uuid),
    ('d5000000-0000-0000-0000-0000000000a4'::uuid)
  ) AS v(id);

INSERT INTO public.profile_badges (tenant_id, user_id, badge) VALUES
  ('dd333333-3333-3333-3333-333333333333', 'd5000000-0000-0000-0000-0000000000b1', 'expert');

-- ── (1-10) Kontrakt funkcji: sygnatura, DEFINER, search_path, ACL ───────────
-- Rzutowanie na regprocedure samo w sobie przybija argument `text`.
SELECT is(
  (SELECT prorettype::regtype::text FROM pg_proc
    WHERE oid = 'public.member_slug_is_non_author(text)'::regprocedure),
  'boolean',
  'member_slug_is_non_author(text) -> boolean (sygnatura bez zmian, typy klienta wazne)'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc
    WHERE oid = 'public.member_slug_is_non_author(text)'::regprocedure),
  'member_slug_is_non_author jest SECURITY DEFINER (is_platform_author jest odebrane anonowi)'
);

SELECT is(
  (SELECT proconfig FROM pg_proc
    WHERE oid = 'public.member_slug_is_non_author(text)'::regprocedure),
  ARRAY['search_path=public, pg_temp'],
  'member_slug_is_non_author ma przypiety search_path = public, pg_temp'
);

SELECT is(
  (SELECT provolatile::text FROM pg_proc
    WHERE oid = 'public.member_slug_is_non_author(text)'::regprocedure),
  's',
  'member_slug_is_non_author jest STABLE'
);

SELECT ok(
  has_function_privilege('anon', 'public.member_slug_is_non_author(text)', 'EXECUTE'),
  'anon ma EXECUTE (gosc i SSR: server fn bez bearera sesji)'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.member_slug_is_non_author(text)', 'EXECUTE'),
  'authenticated ma EXECUTE'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.member_slug_is_non_author(text)'::regprocedure
       AND a.grantee = 0
  ),
  'PUBLIC nie ma EXECUTE (granty wylacznie jawne)'
);

-- `is_platform_author` nie zna tenanta, a wolaja go wylacznie funkcje
-- SECURITY DEFINER (biegna jako wlasciciel) - zalogowany nie moze nim
-- sprawdzac rol w cudzych tenantach.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.is_platform_author(uuid)', 'EXECUTE'),
  'authenticated NIE ma EXECUTE na is_platform_author (sonda rol po UUID w dowolnym tenancie)'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.is_platform_author(uuid)', 'EXECUTE'),
  'anon NIE ma EXECUTE na is_platform_author'
);

SELECT ok(
  has_function_privilege('service_role', 'public.is_platform_author(uuid)', 'EXECUTE'),
  'service_role zachowuje EXECUTE na is_platform_author'
);

-- ── (11-21) Niezalogowany na domenie tenanta domowego ───────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(public.member_slug_is_non_author('msna-member'), true,
  'anon: publicznie widoczny czlonek bez roli autora w tenancie zadania -> true (301 na /people)');

SELECT is(public.member_slug_is_non_author('msna-author'), false,
  'anon: rola author w user_roles -> false (hub autora zostaje)');

SELECT is(public.member_slug_is_non_author('msna-editor'), false,
  'anon: rola editor w user_roles -> false');

SELECT is(public.member_slug_is_non_author('msna-invited'), false,
  'anon: zaakceptowane zaproszenie z rola author -> false');

SELECT is(public.member_slug_is_non_author('msna-hidden'), false,
  'anon: goly czlonek niewidoczny w profiles_public -> false (sedno findingu)');

SELECT is(public.member_slug_is_non_author('msna-disc'), false,
  'anon: samo discoverable to katalog WEWNETRZNY - dla anon false, jak w profiles_public');

SELECT is(public.member_slug_is_non_author('msna-z-member'), false,
  'anon: czlonek OBCEGO tenanta -> false (werdykt nie wychodzi poza tenant zadania)');

SELECT is(public.member_slug_is_non_author('msna-no-such-slug'), false,
  'anon: nieznany slug -> false');

SELECT is(public.member_slug_is_non_author(NULL), false,
  'anon: NULL -> false');

SELECT is(public.member_slug_is_non_author('d5000000-0000-0000-0000-0000000000a1'), false,
  'anon: UUID nie jest slugiem - 301 prowadzi na /people/<slug>, a get_member_profile szuka po slugu');

-- Parytet z hubem: `true` nigdy nie pada tam, gdzie get_expert_hub nie ma
-- profilu - inaczej roznica 301/404 znow zdradzalaby ukrytego czlonka.
-- `->>`, nie `->`: hub oddaje `{"profile": null}`, a `-> 'profile'` to wtedy
-- jsonowy `null`, ktory w SQL NIE jest NULL-em (asercja przeszlaby zawsze).
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE public.member_slug_is_non_author(s.slug)
      AND (public.get_expert_hub(s.slug) ->> 'profile') IS NULL),
  0,
  'anon: werdykt true WYLACZNIE dla profilu, ktory get_expert_hub oddaje temu samemu wolajacemu'
);

-- ── (22-24) Niezalogowany na domenie tenanta Z (naglowek hosta) ─────────────
-- Tenant idzie za zadaniem dokladnie tak, jak w odczycie huba
-- (public_tenant_id() z `x-tenant-host`).
SELECT set_config('request.headers', '{"x-tenant-host":"msna-z.example"}', true);

SELECT is(public.member_slug_is_non_author('msna-z-member'), true,
  'anon na domenie Z: publicznie widoczny czlonek Z bez roli autora -> true');

SELECT is(public.member_slug_is_non_author('msna-member'), false,
  'anon na domenie Z: czlonek tenanta domowego -> false');

SELECT is(
  (public.get_expert_hub('msna-z-member') ->> 'profile') IS NOT NULL,
  true,
  'anon na domenie Z: hub widzi tego samego czlonka Z (to samo rozwiazanie tenanta)'
);

SELECT set_config('request.headers', '', true);
RESET ROLE;

-- ── (25-34) Zalogowany czlonek tenanta domowego ─────────────────────────────
-- To realna sciezka aplikacji: server fn przekazuje bearer sesji do PostgREST.
-- Werdykt `true` prowadzi na /people/<slug>, wiec musi zgadzac sie z tym, co
-- ten czytelnik tam zobaczy (`get_member_profile`) - w obie strony - i nie
-- moze wyjsc poza to, co i tak widzi w hubie.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5000000-0000-0000-0000-0000000000a7', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-0000000000a7","role":"authenticated"}', true);

SELECT is(public.member_slug_is_non_author('msna-disc'), true,
  'zalogowany z tego tenanta: czlonek z opt-inem discoverable -> true (/people go otworzy)');

SELECT is(public.member_slug_is_non_author('msna-hidden'), false,
  'zalogowany: goly czlonek bez discoverable i bez kontaktu -> false');

SELECT is(public.member_slug_is_non_author('msna-author'), false,
  'zalogowany: autor -> false');

SELECT is(public.member_slug_is_non_author('msna-z-member'), false,
  'zalogowany: czlonek obcego tenanta -> false');

SELECT is(public.member_slug_is_non_author('msna-member'), false,
  'zalogowany: publicznie obecny czlonek BEZ discoverable -> false (hub go pokazuje, /people nie - bez 301 w slepy zaulek)');

SELECT is(public.member_slug_is_non_author('msna-viewer'), true,
  'zalogowany: wlasny profil bez roli autora -> true (/people pokazuje go zawsze)');

-- Sama DEKLARACJA hosta nie przenosi zalogowanego do obcego tenanta
-- (public_tenant_id() wraca do tenanta domowego) - jak w profiles_public.
SELECT set_config('request.headers', '{"x-tenant-host":"msna-z.example"}', true);

SELECT is(public.member_slug_is_non_author('msna-z-member'), false,
  'zalogowany z deklarowanym hostem Z: czlonek Z -> false (deklaracja nie zmienia tenanta)');

SELECT set_config('request.headers', '', true);

-- `msna-disc` i `msna-viewer` sa tu `true` - asercje nizej nie sa puste.
SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE public.member_slug_is_non_author(s.slug)
      AND (public.get_expert_hub(s.slug) ->> 'profile') IS NULL),
  0,
  'zalogowany: werdykt true WYLACZNIE dla profilu, ktory get_expert_hub oddaje temu samemu wolajacemu'
);

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE public.member_slug_is_non_author(s.slug)
      AND public.get_member_profile(s.slug) IS NULL),
  0,
  'zalogowany: werdykt true WYLACZNIE tam, gdzie cel 301 (get_member_profile) rozwiaze profil'
);

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE (public.get_member_profile(s.slug) ->> 'is_author') = 'false'
      AND NOT public.member_slug_is_non_author(s.slug)),
  0,
  'zalogowany: kazdy profil nie-autora, ktory /people rozwiaze, dostaje werdykt true (parytet odwrotny)'
);

RESET ROLE;

-- ── (35-40) Zalogowany na ZWERYFIKOWANEJ domenie obcego tenanta ─────────────
-- Poswiadczenie krawedzi (`x-tenant-assert`, HMAC) - ten sam format co
-- src/lib/http/tenantAssertion.ts i profiles_public_anon_gate_test.sql.
-- Zweryfikowany host PRZENOSI public_tenant_id() na tenant Z takze dla
-- zalogowanego, a `profiles_public` dalej pokazuje mu tez tenant domowy
-- (galaz czlonkowska po current_tenant_id()). Werdykt z tenantu zadania
-- gubil wiec czlonka tenanta domowego, ktorego /people otwiera, a czlonka Z
-- przerzucal na /people, ktore szuka w tenancie domowym.
SELECT public.set_tenant_host_assertion_key(
  'msnatest', 'msna-assertion-secret-0123456789abcdef'
);

CREATE TEMP TABLE msna_verified AS
SELECT json_build_object(
         'x-tenant-host', 'msna-z.example',
         'x-tenant-assert',
         'v1.msnatest.'
           || public.b64url_encode(convert_to('msna-z.example', 'utf8')) || '.'
           || v.exp::text || '.'
           || public.b64url_encode(
                extensions.hmac(
                  'v1:msnatest:msna-z.example:' || v.exp::text,
                  'msna-assertion-secret-0123456789abcdef', 'sha256')
              )
       )::text AS headers
  FROM (SELECT extract(epoch FROM now())::bigint + 3600 AS exp) v;

GRANT SELECT ON msna_verified TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5000000-0000-0000-0000-0000000000a7', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-0000000000a7","role":"authenticated"}', true);
SELECT set_config('request.headers', (SELECT headers FROM msna_verified), true);

SELECT is(public.public_tenant_id(), 'dd333333-3333-3333-3333-333333333333'::uuid,
  'zweryfikowana domena Z: public_tenant_id() to tenant Z takze dla zalogowanego (sanity fixture)');

SELECT is((public.get_expert_hub('msna-disc') ->> 'profile') IS NOT NULL, true,
  'zweryfikowana domena Z: hub dalej widzi czlonka discoverable z tenanta domowego');

SELECT is(public.member_slug_is_non_author('msna-disc'), true,
  'zweryfikowana domena Z: czlonek discoverable tenanta domowego -> true (/people go otworzy)');

SELECT is(public.member_slug_is_non_author('msna-z-member'), false,
  'zweryfikowana domena Z: czlonek Z (hub go widzi, /people w tenancie domowym nie) -> false');

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE public.member_slug_is_non_author(s.slug)
      AND public.get_member_profile(s.slug) IS NULL),
  0,
  'zweryfikowana domena Z: werdykt true WYLACZNIE tam, gdzie get_member_profile rozwiaze profil'
);

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE (public.get_member_profile(s.slug) ->> 'is_author') = 'false'
      AND NOT public.member_slug_is_non_author(s.slug)),
  0,
  'zweryfikowana domena Z: parytet odwrotny z get_member_profile'
);

SELECT set_config('request.headers', '', true);
RESET ROLE;

-- ── (41-44) Personel tenanta (rola editor) ──────────────────────────────────
-- `profiles_public` pokazuje personelowi KAZDEGO czlonka tenanta, ale
-- `get_member_profile` nie ma galezi personelu - 301 prowadzilby na pusta
-- karte /people. Personel zostaje wiec przy hubie.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd5000000-0000-0000-0000-0000000000a3', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT is(
  public.caller_is_tenant_staff()
    AND (public.get_expert_hub('msna-hidden') ->> 'profile') IS NOT NULL,
  true,
  'personel: hub pokazuje golego czlonka tenanta (sanity fixture)'
);

SELECT is(public.member_slug_is_non_author('msna-hidden'), false,
  'personel: goly czlonek widoczny tylko przez galaz personelu -> false (/people go nie rozwiaze)');

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE public.member_slug_is_non_author(s.slug)
      AND public.get_member_profile(s.slug) IS NULL),
  0,
  'personel: werdykt true WYLACZNIE tam, gdzie get_member_profile rozwiaze profil'
);

SELECT is(
  (SELECT count(*)::int
     FROM unnest(ARRAY['msna-member', 'msna-author', 'msna-editor', 'msna-invited',
                       'msna-hidden', 'msna-disc', 'msna-viewer', 'msna-z-member']) AS s(slug)
    WHERE (public.get_member_profile(s.slug) ->> 'is_author') = 'false'
      AND NOT public.member_slug_is_non_author(s.slug)),
  0,
  'personel: parytet odwrotny z get_member_profile'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
