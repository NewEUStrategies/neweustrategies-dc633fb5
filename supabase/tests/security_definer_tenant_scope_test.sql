-- pgTAP: bramka izolacji tenantow dla SECURITY DEFINER (migracja 20260724091000).
--
-- Scenariusz ataku (dokladnie z opisu zadania): admin tenanta A wola RPC z
-- PODROBIONYM naglowkiem x-tenant-host wskazujacym domene tenanta B. Naglowek
-- jest kontrolowany przez klienta (tenant-host-fetch.ts + brak trusted-proxy),
-- wiec public_tenant_id() rozwiazuje sie do B - atak jest REALNY na warstwie
-- naglowka. Poprawka wymusza, by funkcje uprzywilejowane skalowaly dane po
-- current_tenant_id() (tenant DOMOWY z profiles = A), a nie po naglowku. Oczekujemy
-- wiec ZAWSZE danych tenanta A albo bledu autoryzacji - nigdy danych tenanta B.
--
-- Pokrycie:
--   (A) pelny swap public_tenant_id()->current_tenant_id():
--       monetization_dashboard, b2b_coupons_analytics, metering_impact_preview,
--       get_user_monthly_metering_count, bulk_generate_coupons_for_campaign;
--   (B) kandydat org_add_seat (galaz admina zwiazana z current_tenant_id());
--   (C) sciezka czlonkowska z obejsciem stafowym zwiazanym z tenantem wiersza:
--       get_poll_results (staff tenanta A na domenie B traktowany jak gosc, ale
--       na WLASNEJ domenie podglad stafowy nadal dziala).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

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
INSERT INTO public.payment_orders (tenant_id, user_id, kind, status, amount_cents) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd1d1d1d1-0000-0000-0000-000000000001',
   'one_time', 'paid', 1234),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'd1d1d1d1-0000-0000-0000-000000000001',
   'one_time', 'paid', 5000);

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

-- Ankiety otwarte po jednej na tenant (get_poll_results, podglad stafowy).
INSERT INTO public.polls (id, tenant_id, question_pl, question_en, options, status) VALUES
  ('e0a00000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Pytanie A', 'Question A', '["Tak","Nie"]'::jsonb, 'open'),
  ('e0b00000-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Pytanie B', 'Question B', '["Tak","Nie"]'::jsonb, 'open');

-- ── Admin A z PODROBIONYM naglowkiem = domena tenanta B ─────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d1d1d1d1-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"b.example"}', true);

-- 0) Atak jest realny na warstwie naglowka, ale tozsamosc trzyma tenant domowy.
SELECT is(public.public_tenant_id(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  'podrobiony x-tenant-host rozwiazuje sie do tenanta B (wektor ataku realny)');
SELECT is(public.current_tenant_id(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  'current_tenant_id() pozostaje tenantem domowym A (z sesji)');

-- 1) monetization_dashboard: przychod tenanta A (1234), NIGDY tenanta B (5000).
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

-- 7) get_poll_results (sciezka C): staff A na domenie B jest zwyklym gosciem -
-- nie ma podgladu wynikow ankiety tenanta B przed glosowaniem/zamknieciem.
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
SELECT set_config('request.headers', '{"x-tenant-host":"a.example"}', true);

-- 12) get_poll_results: podglad stafowy DZIALA na wlasnym tenancie (widoczny mimo braku glosu).
SELECT is(
  (public.get_poll_results('e0a00000-0000-0000-0000-00000000000a') ->> 'visible')::boolean,
  true, 'get_poll_results: podglad stafowy dziala na wlasnym tenancie A');

SELECT * FROM finish();
ROLLBACK;
