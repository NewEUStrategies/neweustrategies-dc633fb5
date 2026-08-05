-- pgTAP: szczeble zaufania hosta (audyt 05.08 §4.1, migracja 20260805090000).
--
-- Weryfikuje dokładnie to, co audyt nazwał „pół naprawy opisane jak pełna":
-- że warstwa BAZY przestała ufać nagłówkowi `x-tenant-host` na słowo.
--
--   1. deklaracja spoza katalogu domen nie wychodzi z request_public_host();
--   2. deklaracja zarejestrowanej domeny działa dla ANONIMOWEGO czytelnika
--      (plan treści publicznej - to jest zamierzone i musi zostać);
--   3. ZALOGOWANY wołający NIE PRZENOSI SIĘ deklaracją do obcego tenanta -
--      public_tenant_id() zwraca jego tenanta DOMOWEGO (sedno naprawy);
--   4. poświadczenie krawędzi (HMAC) przenosi zalogowanego do tenanta B -
--      legalny ruch cross-tenantowy nie został zabity;
--   5. podpis podrobiony / z podmienionym hostem / wygasły / obcym kid nie
--      działa - poświadczenie nie jest dekoracją;
--   6. RLS anon dalej podąża za hostem (regresja planu treści);
--   7. rejestr kluczy jest niedostępny dla ról klienckich.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(18);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa tenanty z własnymi domenami ──────────────────────────────────
UPDATE public.tenants SET domain = 'nes.example', aliases = '{}' WHERE slug = 'nes';

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b2222222-2222-2222-2222-222222222222', 'assert-tenant-b', 'Tenant B', 'b.example');

-- Użytkownik z tenanta DOMYŚLNEGO ('nes') - to on będzie próbował pivotować.
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000aaaa', 'assert-user-a@nes.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
VALUES ('a0000000-0000-0000-0000-00000000aaaa', 'assert-user-a@nes.test', 'User A',
        (SELECT id FROM public.tenants WHERE slug = 'nes'))
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

-- Użytkownik z tenanta B - tylko on rozróżnia „tenant domowy" od „domyślny".
INSERT INTO auth.users (id, email) VALUES
  ('b0000000-0000-0000-0000-00000000bbbb', 'assert-user-b@b.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
VALUES ('b0000000-0000-0000-0000-00000000bbbb', 'assert-user-b@b.test', 'User B',
        'b2222222-2222-2222-2222-222222222222')
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('bbbbbbbb-1111-0000-0000-00000000000b',
   'b2222222-2222-2222-2222-222222222222', 'assert-b-home');
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('00000000-1111-0000-0000-0000000000b1', 'assert-b-post',
   'a0000000-0000-0000-0000-00000000aaaa', 'published',
   'b2222222-2222-2222-2222-222222222222',
   'bbbbbbbb-1111-0000-0000-00000000000b', 'Post B');

-- Klucz poświadczeń: ten sam sekret, który krawędź trzyma w
-- TENANT_HOST_ASSERTION_KEY. Rejestrujemy przez oficjalne API migracji.
SELECT public.set_tenant_host_assertion_key(
  'test1', 'pgtap-assertion-secret-0123456789abcdef'
);

-- Pomocniczo: składanie poświadczenia po stronie „krawędzi" (ten sam format,
-- ten sam podpisywany tekst co src/lib/http/tenantAssertion.ts).
CREATE FUNCTION pg_temp.mint(p_host text, p_exp bigint, p_kid text DEFAULT 'test1')
RETURNS text LANGUAGE sql SET search_path = public, extensions AS $$
  SELECT 'v1.' || p_kid || '.'
      || public.b64url_encode(convert_to(p_host, 'utf8')) || '.'
      || p_exp::text || '.'
      || public.b64url_encode(
           hmac(
             'v1:' || p_kid || ':' || p_host || ':' || p_exp::text,
             'pgtap-assertion-secret-0123456789abcdef',
             'sha256'
           )
         )
$$;

CREATE FUNCTION pg_temp.soon() RETURNS bigint LANGUAGE sql AS $$
  SELECT (extract(epoch FROM now())::bigint + 3600)
$$;

-- ── 1. Deklaracja spoza katalogu domen jest szumem ─────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"attacker.example"}', true);
SELECT is(
  public.request_asserted_host(), 'attacker.example',
  'request_asserted_host() zwraca surową deklarację (wejście diagnostyczne)'
);
SELECT is(
  public.request_public_host(), NULL::text,
  'request_public_host() ODRZUCA deklarację hosta spoza katalogu tenantow'
);
SELECT is(
  public.request_public_host_trust(), 'asserted',
  'szczebel zaufania dla samej deklaracji to "asserted"'
);

-- ── 2. Anonimowy czytelnik: deklaracja zarejestrowanej domeny DZIAŁA ───────
SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);
SELECT is(
  public.request_public_host(), 'b.example',
  'zarejestrowana domena przechodzi jako deklaracja (plan tresci publicznej)'
);
SELECT is(
  public.public_tenant_id(), 'b2222222-2222-2222-2222-222222222222'::uuid,
  'anon na deklarowanej domenie B czyta tenanta B (zachowanie zamierzone)'
);

-- ── 3. SEDNO NAPRAWY: zalogowany nie pivotuje deklaracją ───────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);

SELECT is(
  public.current_tenant_id(),
  (SELECT id FROM public.tenants WHERE slug = 'nes'),
  'tenant domowy wolajacego pochodzi z profilu, nie z naglowka'
);
SELECT is(
  public.public_tenant_id(),
  (SELECT id FROM public.tenants WHERE slug = 'nes'),
  'ZALOGOWANY z deklaracja domeny obcego tenanta zostaje w tenancie DOMOWYM'
);

-- Deklaracja WŁASNEJ domeny zalogowanego oczywiście działa.
SELECT set_config('request.headers', '{"x-tenant-host":"nes.example"}', true);
SELECT is(
  public.public_tenant_id(),
  (SELECT id FROM public.tenants WHERE slug = 'nes'),
  'deklaracja wlasnej domeny zalogowanego przechodzi bez zmian'
);

-- Brak nagłówka: zalogowany działa w SWOIM tenancie, nie w domyślnym. Dotąd
-- członek tenanta B spadał tu na tenanta DOMYŚLNEGO, czyli na OBCY.
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000bbbb","role":"authenticated"}', true);
SELECT set_config('request.headers', '', true);
SELECT is(
  public.public_tenant_id(), 'b2222222-2222-2222-2222-222222222222'::uuid,
  'zalogowany czlonek B BEZ wskazowki hosta dziala w tenancie DOMOWYM (B), nie w domyslnym'
);

-- Powrót do użytkownika z tenanta domyślnego dla kolejnych asercji.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);

-- ── 4. Poświadczenie krawędzi przywraca legalny ruch cross-tenantowy ───────
SELECT set_config('request.headers',
  json_build_object('x-tenant-host', 'b.example',
                    'x-tenant-assert', pg_temp.mint('b.example', pg_temp.soon()))::text,
  true);
SELECT is(
  public.request_verified_host(), 'b.example',
  'poswiadczenie krawedzi weryfikuje sie i zwraca host'
);
SELECT is(
  public.request_public_host_trust(), 'verified',
  'szczebel zaufania z poprawnym podpisem to "verified"'
);
SELECT is(
  public.public_tenant_id(), 'b2222222-2222-2222-2222-222222222222'::uuid,
  'ZALOGOWANY z POSWIADCZONYM hostem B czyta tenanta B (ruch platformy zyje)'
);

-- ── 5. Poświadczenie musi być prawdziwe ────────────────────────────────────
-- (a) podpis podrobiony
SELECT set_config('request.headers',
  '{"x-tenant-assert":"v1.test1.Yi5leGFtcGxl.99999999999.ZmFrZXNpZ25hdHVyZQ"}', true);
SELECT is(
  public.request_verified_host(), NULL::text,
  'podrobiony podpis nie przechodzi'
);

-- (b) host podmieniony po podpisaniu (podpis obejmuje host)
SELECT set_config('request.headers',
  json_build_object('x-tenant-assert',
    replace(pg_temp.mint('b.example', pg_temp.soon()),
            public.b64url_encode(convert_to('b.example', 'utf8')),
            public.b64url_encode(convert_to('nes.example', 'utf8'))))::text,
  true);
SELECT is(
  public.request_verified_host(), NULL::text,
  'podmiana hosta w poswiadczeniu uniewaznia podpis'
);

-- (c) wygasłe
SELECT set_config('request.headers',
  json_build_object('x-tenant-assert',
    pg_temp.mint('b.example', extract(epoch FROM now())::bigint - 10))::text,
  true);
SELECT is(
  public.request_verified_host(), NULL::text,
  'wygasle poswiadczenie nie przechodzi'
);

-- (d) nieznany kid
SELECT set_config('request.headers',
  json_build_object('x-tenant-assert',
    pg_temp.mint('b.example', pg_temp.soon(), 'nosuchkid'))::text,
  true);
SELECT is(
  public.request_verified_host(), NULL::text,
  'poswiadczenie podpisane nieznanym kluczem nie przechodzi'
);

SELECT set_config('request.jwt.claims', '', true);

-- ── 6. RLS anon dalej podąża za hostem (regresja planu treści) ─────────────
SET LOCAL ROLE anon;
SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.posts WHERE slug = 'assert-b-post'),
  1,
  'anon na domenie B dalej czyta opublikowany post B'
);

-- ── 7. Rejestr kluczy jest zamknięty dla rol klienckich ────────────────────
SELECT throws_ok(
  'SELECT count(*) FROM public.tenant_host_assertion_keys',
  '42501',
  NULL,
  'anon nie ma dostepu do rejestru kluczy poswiadczen'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
