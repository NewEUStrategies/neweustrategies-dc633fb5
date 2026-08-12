-- pgTAP: bramka izolacji tenantow dla SECURITY DEFINER (migracja 20260724091000).
--
-- Scenariusz: admin tenanta A wola RPC, a rozstrzygniety tenant PRZEGLADANY
-- wskazuje tenanta B. Poprawka wymusza, by funkcje uprzywilejowane skalowaly
-- dane po current_tenant_id() (tenant DOMOWY z profiles = A), a nie po tencie
-- z naglowka. Oczekujemy wiec ZAWSZE danych tenanta A albo bledu autoryzacji -
-- nigdy danych tenanta B.
--
-- DWA SZCZEBLE ZAUFANIA HOSTA (20260805090000 - po tej migracji sam naglowek
-- `x-tenant-host` nie jest juz dowodem niczego):
--
--   ASSERTED - goly `x-tenant-host`. Od 20260805090000 deklaracja wskazujaca
--     tenanta INNEGO niz domowy jest dla ZALOGOWANEGO wolajacego ODRZUCANA,
--     wiec public_tenant_id() zwraca tenanta A. Ten szczebel sprawdzamy jako
--     pierwszy: naglowek nadal jest w pelni kontrolowany przez klienta
--     (tenant-host-fetch.ts + brak trusted-proxy), ale nie przenosi juz sesji
--     do obcego obszaru roboczego.
--   VERIFIED - `x-tenant-assert` podpisany sekretem krawedzi. Tu tenant
--     przegladany REALNIE staje sie B (legalny ruch cross-tenantowy: czlonek
--     tenanta A czyta publiczna tresc tenanta B). Dopiero ten szczebel
--     rozdziela `public_tenant_id()` od `current_tenant_id()`, wiec WLASNIE na
--     nim testujemy funkcje uprzywilejowane - inaczej asercje przechodzilyby
--     trywialnie, bo oba rozstrzygniecia daja tego samego tenanta.
--
-- Pokrycie:
--   (A) pelny swap public_tenant_id()->current_tenant_id():
--       monetization_dashboard, b2b_coupons_analytics, metering_impact_preview,
--       get_user_monthly_metering_count, bulk_generate_coupons_for_campaign;
--   (B) kandydat org_add_seat (galaz admina zwiazana z current_tenant_id());
--   (C) sciezka czlonkowska z obejsciem stafowym zwiazanym z tenantem wiersza:
--       get_poll_results (staff tenanta A na poswiadczonej domenie B traktowany
--       jak gosc, ale na WLASNEJ domenie podglad stafowy nadal dziala).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed: dwa tenanty z wlasnymi domenami ───────────────────────────────────
INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'scope-a', 'Scope Tenant A', 'a.example'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'scope-b', 'Scope Tenant B', 'b.example');

SELECT public.seed_membership_tiers('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT public.seed_membership_tiers('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Admin z TENANTEM DOMOWYM A (rola admin przypieta do tenanta A).
INSERT INTO auth.users (id, email) VALUES
  ('d1d1d1d1-0000-0000-0000-000000000001', 'admin-a@scope.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d1d1d1d1-0000-0000-0000-000000000001', 'admin-a@scope.test', 'Admin A',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d1d1d1d1-0000-0000-0000-000000000001', 'admin'::public.app_role,
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Przychod: zamowienie oplacone w A (1234) i w B (5000). Wyciek = zobaczenie 5000.
-- Status 'paid' moze wstawic tylko service_role. UWAGA: guard_status
-- (20260724143429) jest SECURITY DEFINER - current_user wewnatrz to wlasciciel
-- funkcji, nie rola z SET ROLE; oba triggery (guard_status + secure_insert
-- z 20260730175806) honoruja za to GUC request.jwt.claim.role.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001',
   'one_time', 'paid', 1234),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'one_time', 'paid', 5000);
SELECT set_config('request.jwt.claim.role', '', true);

-- Kupony B2B: po jednym na tenant (analityka nie moze pokazac kuponu B adminowi A).
INSERT INTO public.b2b_coupons (tenant_id, code, discount_kind, discount_percent) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AAA10', 'percent', 10),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BBB10', 'percent', 10);

-- Metering: 2 odslony w A, 5 w B (ten sam user). metering_settings: limit A=3, B=7.
INSERT INTO public.metered_views (tenant_id, user_id, entity_type, entity_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '11111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '44444444-4444-4444-4444-444444444444'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '55555555-5555-5555-5555-555555555555'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '66666666-6666-6666-6666-666666666666'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'post', '77777777-7777-7777-7777-777777777777');
INSERT INTO public.metering_settings (tenant_id, enabled, member_monthly_limit) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, 3),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true, 7);

-- Kampanie kuponow (draft) po jednej na tenant (bulk generate).
INSERT INTO public.b2b_coupon_campaigns
  (id, tenant_id, name, code_count, code_length, discount_kind, discount_percent) VALUES
  ('ca000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Camp A', 2, 6, 'percent', 10),
  ('cb000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Camp B', 2, 6, 'percent', 10);

-- Organizacje czlonkowskie po jednej na tenant (org_add_seat).
INSERT INTO public.member_organizations (id, tenant_id, name, status) VALUES
  ('0a000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Org A', 'active'),
  ('0b000000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Org B', 'active');

-- Niezajete miejsce w organizacji tenanta B (org_touch_seat_invite).
INSERT INTO public.organization_seats (id, tenant_id, org_id, invited_email, role) VALUES
  ('b5ea7000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '0b000000-0000-0000-0000-00000000000b', 'invitee-b@scope.test', 'member');

-- Ankiety otwarte po jednej na tenant (get_poll_results, podglad stafowy).
INSERT INTO public.polls (id, tenant_id, question_pl, question_en, options, status) VALUES
  ('e0a00000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Pytanie A', 'Question A', '["Tak","Nie"]'::jsonb, 'open'),
  ('e0b00000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Pytanie B', 'Question B', '["Tak","Nie"]'::jsonb, 'open');

-- ── Poswiadczenie krawedzi: sekret + koder (jak w tenant_host_assertion_test) ─
-- Rejestrujemy przez oficjalne API migracji, zeby test szedl ta sama sciezka co
-- krawedz (env TENANT_HOST_ASSERTION_KEY).
SELECT public.set_tenant_host_assertion_key(
  'sdts1', 'pgtap-sdts-assertion-secret-0123456789'
);

CREATE FUNCTION pg_temp.mint(p_host text, p_exp bigint, p_kid text DEFAULT 'sdts1')
RETURNS text LANGUAGE sql SET search_path = public, extensions AS $$
  SELECT 'v1.' || p_kid || '.'
      || public.b64url_encode(convert_to(p_host, 'utf8')) || '.'
      || p_exp::text || '.'
      || public.b64url_encode(
           hmac(
             'v1:' || p_kid || ':' || p_host || ':' || p_exp::text,
             'pgtap-sdts-assertion-secret-0123456789',
             'sha256'
           )
         )
$$;

-- Naglowki obu szczebli sklejamy JESZCZE JAKO WLASCICIEL - podpisywanie jest
-- rola krawedzi, nie wolajacego, a dalej caly test chodzi jako `authenticated`.
SELECT set_config('app.sdts_asserted_b', '{"x-tenant-host":"b.example"}', true);
SELECT set_config('app.sdts_asserted_a', '{"x-tenant-host":"a.example"}', true);
SELECT set_config('app.sdts_verified_b',
  json_build_object(
    'x-tenant-host', 'b.example',
    'x-tenant-assert', pg_temp.mint('b.example', extract(epoch FROM now())::bigint + 3600)
  )::text, true);

-- ── Admin A z PODROBIONYM (nieposwiadczonym) naglowkiem = domena tenanta B ───
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d1d1d1d1-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.headers', current_setting('app.sdts_asserted_b'), true);

-- 0) Naglowek jest nadal w pelni kontrolowany przez klienta i nadal wskazuje
-- domene tenanta B - wektor ataku na warstwie naglowka istnieje...
SELECT is(
  public.tenant_id_for_public_host(public.request_asserted_host()),
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'podrobiony x-tenant-host nadal wskazuje domene tenanta B (wektor realny)');
-- ...ale sama deklaracja nie przenosi ZALOGOWANEGO do obcego tenanta.
SELECT is(public.public_tenant_id(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'nieposwiadczona deklaracja NIE pivotuje zalogowanego na tenanta B');
SELECT is(public.current_tenant_id(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'current_tenant_id() pozostaje tenantem domowym A (z sesji)');

-- ── Szczebel VERIFIED: tenant PRZEGLADANY to realnie B ──────────────────────
-- Od tego miejsca public_tenant_id() <> current_tenant_id(), wiec kazda funkcja
-- ponizej jest sprawdzana na ROZJECHANYCH rozstrzygnieciach - funkcja skalujaca
-- dane naglowkiem zwrocilaby tu dane tenanta B.
SELECT set_config('request.headers', current_setting('app.sdts_verified_b'), true);

SELECT is(public.public_tenant_id(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'poswiadczony host B rozstrzyga tenanta przegladanego na B (dyskryminator zywy)');

-- 1) monetization_dashboard: przychod tenanta A (1234), NIGDY tenanta B (5000).
--    Naglowek jest tu POSWIADCZONY, a mimo to nie ma wplywu na zakres danych.
SELECT is(
  (public.monetization_dashboard() -> 'orders' ->> 'revenue_cents')::bigint,
  1234::bigint,
  'monetization_dashboard zwraca przychod tenanta domowego A mimo naglowka B');

-- 2-3) b2b_coupons_analytics: wylacznie kupony tenanta A.
SELECT is(
  (SELECT count(*)::int FROM public.b2b_coupons_analytics(now() - interval '1 day', now() + interval '1 day')),
  1, 'b2b_coupons_analytics widzi tylko kupony tenanta A (1), nie tenanta B');
SELECT is(
  (SELECT code FROM public.b2b_coupons_analytics(now() - interval '1 day', now() + interval '1 day') LIMIT 1),
  'AAA10', 'b2b_coupons_analytics: zwrocony kupon nalezy do tenanta A');

-- 4) metering_impact_preview: liczy odslony tenanta A (2), nie B (5) ani sumy (7).
SELECT is(
  (SELECT total_views FROM public.metering_impact_preview(5)),
  2::bigint, 'metering_impact_preview liczy odslony tenanta domowego A');

-- 5-6) get_user_monthly_metering_count: licznik i limit tenanta A.
SELECT is(
  (SELECT used FROM public.get_user_monthly_metering_count('d1d1d1d1-0000-0000-0000-000000000001')),
  2, 'get_user_monthly_metering_count.used = odslony tenanta A (2)');
SELECT is(
  (SELECT monthly_limit FROM public.get_user_monthly_metering_count('d1d1d1d1-0000-0000-0000-000000000001')),
  3, 'get_user_monthly_metering_count.monthly_limit = limit tenanta A (3), nie B (7)');

-- 7) get_poll_results (sciezka C): ankieta tenanta B jest widoczna dla funkcji
-- (host poswiadczony, wiec plaszczyzna tresci to B), ale staff A jest tu
-- zwyklym gosciem - podgladu wynikow przed glosowaniem/zamknieciem nie ma.
SELECT is(
  (public.get_poll_results('e0b00000-0000-0000-0000-00000000000b') ->> 'visible')::boolean,
  false, 'get_poll_results: obejscie stafowe NIE dziala na cudzym tenancie (B)');

-- 8) org_add_seat: admin A nie moze dodac miejsca w organizacji tenanta B.
SELECT throws_ok(
  $$ SELECT public.org_add_seat('0b000000-0000-0000-0000-00000000000b', 'x@scope.test', 'member') $$,
  'orgs: not allowed',
  'org_add_seat odrzuca admina A na organizacji tenanta B');

-- 9) org_add_seat: admin A MOZE dodac miejsce we wlasnej organizacji (naglowek bez znaczenia).
SELECT isnt(
  (SELECT public.org_add_seat('0a000000-0000-0000-0000-00000000000a', 'new-a@scope.test', 'member')),
  NULL, 'org_add_seat dziala dla wlasnej organizacji A mimo naglowka B');

-- 9b) org_touch_seat_invite: admin A nie moze ponowic zaproszenia na miejscu tenanta B
-- (blokuje odczyt invited_email/nazwy organizacji tenanta B).
SELECT throws_ok(
  $$ SELECT public.org_touch_seat_invite('b5ea7000-0000-0000-0000-00000000000b') $$,
  'orgs: not allowed',
  'org_touch_seat_invite odrzuca admina A na miejscu tenanta B');

-- 10) bulk_generate_coupons_for_campaign: kampania tenanta B -> wrong_tenant.
SELECT throws_ok(
  $$ SELECT public.bulk_generate_coupons_for_campaign('cb000000-0000-0000-0000-00000000000b') $$,
  'wrong_tenant',
  'bulk_generate: kampania tenanta B odrzucona (guard po current_tenant_id)');

-- 11) bulk_generate_coupons_for_campaign: kampania tenanta A generuje kody (naglowek bez znaczenia).
SELECT is(
  public.bulk_generate_coupons_for_campaign('ca000000-0000-0000-0000-00000000000a'),
  2, 'bulk_generate: kampania wlasnego tenanta A generuje 2 kody mimo naglowka B');

-- ── Kontrola pozytywna: admin A na WLASNEJ domenie A ────────────────────────
SELECT set_config('request.headers', current_setting('app.sdts_asserted_a'), true);

-- 12) get_poll_results: podglad stafowy DZIALA na wlasnym tenancie (widoczny mimo braku glosu).
SELECT is(
  (public.get_poll_results('e0a00000-0000-0000-0000-00000000000a') ->> 'visible')::boolean,
  true, 'get_poll_results: podglad stafowy dziala na wlasnym tenancie A');

SELECT * FROM finish();
ROLLBACK;
