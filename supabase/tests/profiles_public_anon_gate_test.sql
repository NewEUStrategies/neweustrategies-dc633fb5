-- pgTAP: bramka widocznosci widoku `public.profiles_public` (migracja
-- 20260806160000_profiles_public_anon_gate).
--
-- FINDING: widok byl definerowy (security_invoker=off) z GRANT SELECT dla
-- `anon` i zawezal WYLACZNIE po `tenant_id = public_tenant_id()`. Kazdy profil
-- tenanta - takze zwykly czlonek bez zgody na katalog - wychodzil anonimowi
-- w 22-kolumnowej projekcji (imie, nazwisko, avatar, okladka, dwa bio,
-- stanowisko, firma, specjalizacja, szesc linkow social). Interfejs obiecywal
-- w PL i EN cos przeciwnego ("osoby niezalogowane (...) nie maja do niego
-- dostepu"), a jedyna mitygacja bylo `noindex` na /author/$slug - czyli prosba
-- do crawlera, nie kontrola dostepu.
--
-- Ten plik przybija stan docelowy - DWIE ADDYTYWNE warstwy:
--
--   PUBLICZNA (takze anon): tenant przegladanej witryny ORAZ realna publiczna
--   obecnosc osoby (rola redakcyjna / odznaka expert / publiczny profil
--   autorski / opublikowana tresc). Goly czlonek - i czlonek z samym
--   `discoverable` (opt-in WEWNETRZNY) - wypada.
--
--   CZLONKOWSKA (tylko zalogowany): WYLACZNIE tenant DOMOWY wolajacego
--   (current_tenant_id() - z profilu, nie z naglowka x-tenant-host), a w nim
--   wlasny wiersz, opt-in discoverable, staff tenanta i zaakceptowany kontakt.
--
-- Osobno bramkowana jest druga, cichsza dziura tego samego widoku: tenant bral
-- sie wylacznie z klienckiego naglowka, wiec zalogowany user tenanta A czytal
-- katalog osobowy tenanta B po podmianie hosta. Warstwa PUBLICZNA idzie za
-- public_tenant_id(), a ta funkcja zna od 20260805090000 dwa szczeble zaufania
-- do hosta - i oba trzeba tu sprawdzic osobno:
--
--   ASSERTED (goly `x-tenant-host`, deklaracja klienta) + ZALOGOWANY: wskazanie
--   obcego tenanta jest ODRZUCANE, obowiazuje tenant DOMOWY. Zalogowany user
--   tenanta A na domenie B nie dostaje ani katalogu B, ani warstwy PUBLICZNEJ B.
--
--   VERIFIED (`x-tenant-assert`, poswiadczenie krawedzi podpisane HMAC):
--   plan publiczny przenosi sie do B - i wtedy widac WYLACZNIE to, co B
--   publikuje publicznie, nigdy jego katalogu czlonkowskiego.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(26);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa tenanty z jawnymi domenami ────────────────────────────────────
-- Tenant DOMOWY = ten, ktory public_tenant_id() zwraca BEZ naglowka (domyslny
-- albo legacy 'nes'); nadajemy mu domene, zeby dalo sie go wskazac hostem.
CREATE TEMP TABLE ppg_ctx AS SELECT public.public_tenant_id() AS home_tenant;

UPDATE public.tenants
   SET domain = 'ppg-home.example'
 WHERE id = (SELECT home_tenant FROM ppg_ctx);

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('cc222222-2222-2222-2222-222222222222', 'tenant-ppg-z', 'Tenant PPG Z',
   'ppg-z.example');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000b1', 'bare@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b2', 'disc@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b3', 'writer@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b4', 'badge@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b5', 'apub@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b6', 'staff@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b7', 'viewer@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000b8', 'contact@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000c1', 'zdisc@ppg.test'),
  ('c0000000-0000-0000-0000-0000000000c2', 'zwriter@ppg.test');

-- Tenant domowy: osiem sylwetek pokrywajacych obie warstwy.
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, discoverable)
SELECT v.id, v.email, v.name, v.slug, (SELECT home_tenant FROM ppg_ctx), v.disc
  FROM (VALUES
    ('c0000000-0000-0000-0000-0000000000b1'::uuid, 'bare@ppg.test',    'Bare Member',   'ppg-bare',    false),
    ('c0000000-0000-0000-0000-0000000000b2'::uuid, 'disc@ppg.test',    'Disc Member',   'ppg-disc',    true),
    ('c0000000-0000-0000-0000-0000000000b3'::uuid, 'writer@ppg.test',  'Writer Person', 'ppg-writer',  false),
    ('c0000000-0000-0000-0000-0000000000b4'::uuid, 'badge@ppg.test',   'Badged Expert', 'ppg-badge',   false),
    ('c0000000-0000-0000-0000-0000000000b5'::uuid, 'apub@ppg.test',    'Public Author', 'ppg-apub',    false),
    ('c0000000-0000-0000-0000-0000000000b6'::uuid, 'staff@ppg.test',   'Staff Person',  'ppg-staff',   false),
    ('c0000000-0000-0000-0000-0000000000b7'::uuid, 'viewer@ppg.test',  'Viewer Person', 'ppg-viewer',  false),
    ('c0000000-0000-0000-0000-0000000000b8'::uuid, 'contact@ppg.test', 'Contact One',   'ppg-contact', false)
  ) AS v(id, email, name, slug, disc);

-- Tenant Z: jeden czlonek z opt-inem WEWNETRZNYM i jeden realnie publiczny.
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, discoverable) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', 'zdisc@ppg.test', 'Z Disc Member', 'ppg-zdisc',
   'cc222222-2222-2222-2222-222222222222', true),
  ('c0000000-0000-0000-0000-0000000000c2', 'zwriter@ppg.test', 'Z Writer', 'ppg-zwriter',
   'cc222222-2222-2222-2222-222222222222', false);

-- Sygnaly publicznej obecnosci.
INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT 'c0000000-0000-0000-0000-0000000000b6', 'admin'::public.app_role,
       (SELECT home_tenant FROM ppg_ctx);

INSERT INTO public.profile_badges (tenant_id, user_id, badge)
SELECT (SELECT home_tenant FROM ppg_ctx),
       'c0000000-0000-0000-0000-0000000000b4', 'expert';

INSERT INTO public.author_profiles (user_id, tenant_id, job_title, is_public)
SELECT 'c0000000-0000-0000-0000-0000000000b5', (SELECT home_tenant FROM ppg_ctx),
       'Analyst', true;

INSERT INTO public.pages (id, tenant_id, slug)
SELECT 'cc000000-0000-0000-0000-0000000000f1', (SELECT home_tenant FROM ppg_ctx), 'ppg-home-page';
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('cc000000-0000-0000-0000-0000000000f2', 'cc222222-2222-2222-2222-222222222222', 'ppg-z-page');

INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl, author_id)
SELECT 'cc000000-0000-0000-0000-0000000000a1', 'ppg-post-home', 'published',
       (SELECT home_tenant FROM ppg_ctx), 'cc000000-0000-0000-0000-0000000000f1',
       'Post Home', 'c0000000-0000-0000-0000-0000000000b3';
INSERT INTO public.posts (id, slug, status, tenant_id, parent_page_id, title_pl, author_id) VALUES
  ('cc000000-0000-0000-0000-0000000000a2', 'ppg-post-z', 'published',
   'cc222222-2222-2222-2222-222222222222', 'cc000000-0000-0000-0000-0000000000f2',
   'Post Z', 'c0000000-0000-0000-0000-0000000000c2');

-- Zaakceptowany kontakt viewer <-> contact (galaz czlonkowska). Guard
-- `tg_user_connections_guard` dopuszcza wylacznie INSERT w stanie 'pending',
-- akceptacja to osobne, legalne przejscie pending->accepted.
INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id)
SELECT (SELECT home_tenant FROM ppg_ctx),
       'c0000000-0000-0000-0000-0000000000b7',
       'c0000000-0000-0000-0000-0000000000b8';

UPDATE public.user_connections
   SET status = 'accepted'
 WHERE requester_id = 'c0000000-0000-0000-0000-0000000000b7'
   AND addressee_id = 'c0000000-0000-0000-0000-0000000000b8';

-- Poswiadczenie krawedzi dla domeny tenanta Z: ten sam format i ten sam
-- podpisywany tekst, co src/lib/http/tenantAssertion.ts i pg_temp.mint()
-- w tenant_host_assertion_test.sql. Klucz wchodzi oficjalnym API migracji
-- 20260805090000; naglowek skladamy TU, jako superuser, bo rola `authenticated`
-- nie ma dostepu do rejestru kluczy.
SELECT public.set_tenant_host_assertion_key(
  'ppgtest', 'ppg-assertion-secret-0123456789abcdef'
);

CREATE TEMP TABLE ppg_verified AS
SELECT json_build_object(
         'x-tenant-host', 'ppg-z.example',
         'x-tenant-assert',
         'v1.ppgtest.'
           || public.b64url_encode(convert_to('ppg-z.example', 'utf8')) || '.'
           || v.exp::text || '.'
           || public.b64url_encode(
                extensions.hmac(
                  'v1:ppgtest:ppg-z.example:' || v.exp::text,
                  'ppg-assertion-secret-0123456789abcdef', 'sha256')
              )
       )::text AS headers
  FROM (SELECT extract(epoch FROM now())::bigint + 3600 AS exp) v;

GRANT SELECT ON ppg_verified TO authenticated;

-- ── (1-4) ACL helperow bramki ───────────────────────────────────────────────
-- Widok czyta takze anon, a przywileje EXECUTE w ciele widoku sa sprawdzane
-- wzgledem WOLAJACEGO - brak grantu = 42501 zamiast pustego zbioru.
SELECT ok(
  has_function_privilege('anon', 'public.profile_has_public_presence(uuid, uuid)', 'EXECUTE'),
  'anon moze wywolac profile_has_public_presence() (galaz publiczna widoku)'
);
SELECT ok(
  has_function_privilege('anon', 'public.caller_is_tenant_staff()', 'EXECUTE'),
  'anon moze wywolac caller_is_tenant_staff() (opakowanie ACL nad is_staff)'
);
SELECT ok(
  has_function_privilege('anon', 'public.caller_is_connected_to(uuid)', 'EXECUTE'),
  'anon moze wywolac caller_is_connected_to() (galaz czlonkowska widoku)'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_my_public_exposure()', 'EXECUTE'),
  'anon NIE ma EXECUTE na get_my_public_exposure() (RPC wlasnego wiersza)'
);

-- ── (5-11) Warstwa PUBLICZNA: co widzi niezalogowany ────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b1'),
  0,
  'anon NIE czyta golego profilu czlonka (sedno findingu)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b2'),
  0,
  'anon NIE czyta profilu z samym discoverable (opt-in jest WEWNETRZNY)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b3'),
  1,
  'anon czyta autora opublikowanego wpisu (byline musi dzialac)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b4'),
  1,
  'anon czyta profil z odznaka expert (katalog /experts)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b5'),
  1,
  'anon czyta profil z publicznym profilem autorskim (is_public = true)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b6'),
  1,
  'anon czyta konto redakcyjne (parytet z polityka "Profiles anon public authors")'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id IN (
      'c0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b2',
      'c0000000-0000-0000-0000-0000000000b3', 'c0000000-0000-0000-0000-0000000000b4',
      'c0000000-0000-0000-0000-0000000000b5', 'c0000000-0000-0000-0000-0000000000b6',
      'c0000000-0000-0000-0000-0000000000b7', 'c0000000-0000-0000-0000-0000000000b8'
    )),
  4,
  'anon widzi DOKLADNIE cztery publicznie obecne osoby z osmiu (enumeracja zamknieta)'
);

RESET ROLE;

-- ── (12-15) Warstwa CZLONKOWSKA: zalogowany bez roli stafowej ───────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b7', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b7","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b1'),
  0,
  'zalogowany nie-staff NIE czyta golego, niediscoverable czlonka tenanta'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b2'),
  1,
  'zalogowany czyta czlonka z opt-inem discoverable (katalog wewnetrzny)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b7'),
  1,
  'zalogowany zawsze czyta WLASNY wiersz'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b8'),
  1,
  'zalogowany czyta zaakceptowany kontakt mimo braku discoverable'
);

-- ── (16) Staff tenanta domowego widzi caly katalog ──────────────────────────
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b6', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b6","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b1'),
  1,
  'staff tenanta domowego czyta golego czlonka (pickery i panele admina)'
);

-- ── (17-18) Sama DEKLARACJA hosta nie otwiera zalogowanemu niczego z B ──────
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b7', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b7","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"ppg-z.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000c1'),
  0,
  'user tenanta A na deklarowanej domenie B NIE czyta discoverable czlonka B (izolacja obszarow)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000c2'),
  0,
  'gola deklaracja hosta nie otwiera zalogowanemu nawet warstwy PUBLICZNEJ tenanta B'
);

-- ── (19-21) POSWIADCZONY host B: tylko warstwa publiczna B ──────────────────
SELECT set_config('request.headers', (SELECT headers FROM ppg_verified), true);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000c2'),
  1,
  'na POSWIADCZONEJ domenie B widac to, co B publikuje publicznie (autor wpisu)'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000c1'),
  0,
  'poswiadczenie hosta przenosi WYLACZNIE plan publiczny - katalog czlonkowski B zostaje zamkniety'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles_public
    WHERE id = 'c0000000-0000-0000-0000-0000000000b2'),
  1,
  'warstwa czlonkowska idzie za tenantem DOMOWYM, nie za wskazowka hosta'
);

SELECT set_config('request.headers', '', true);
RESET ROLE;

-- ── (22-26) get_my_public_exposure: uczciwy stan dla panelu prywatnosci ─────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b7', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b7","role":"authenticated"}', true);

SELECT is(
  (SELECT is_public FROM public.get_my_public_exposure()),
  false,
  'goly czlonek: get_my_public_exposure().is_public = false'
);
SELECT is(
  (SELECT discoverable FROM public.get_my_public_exposure()),
  false,
  'goly czlonek: get_my_public_exposure().discoverable = false'
);

SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b3', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
SELECT is(
  (SELECT by_published_content FROM public.get_my_public_exposure()),
  true,
  'autor wpisu: powodem ekspozycji jest opublikowana tresc'
);

SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b4', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
SELECT is(
  (SELECT by_expert_badge FROM public.get_my_public_exposure()),
  true,
  'ekspert: powodem ekspozycji jest odznaka expert'
);

SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-0000000000b6', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-0000000000b6","role":"authenticated"}', true);
SELECT is(
  (SELECT by_editorial_role FROM public.get_my_public_exposure()),
  true,
  'konto redakcyjne: powodem ekspozycji jest rola'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
