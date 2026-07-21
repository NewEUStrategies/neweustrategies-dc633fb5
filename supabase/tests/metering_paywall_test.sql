-- pgTAP: metering paywalla + site licence B2B (migracja 20260721120000).
--
-- Weryfikuje serwerowy silnik "N darmowych artykułów / miesiąc":
--   1. get_entity_content nadal odmawia body nieuprawnionemu (bramka bazowa);
--   2. consume_metered_view wydaje body i zużywa slot (granted+consumed);
--   3. ponowne czytanie TEGO SAMEGO artykułu nie zużywa kolejnego slotu;
--   4. po wyczerpaniu limitu kolejny artykuł nie dostaje body;
--   5. polityka 'exempt' (per wpis) wyklucza z meteringu mimo wolnego limitu;
--   6. anonim przy anon_monthly_limit=0 dostaje ścianę rejestracji
--      (requires_registration), a po podniesieniu limitu - body;
--   7. uprawniony (zakup) dostaje body BEZ zużycia licznika;
--   8. miejsce w organizacji (tier z features.premium_content) przechodzi
--      has_content_access - site licence dla B2B.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Tenant testowy musi być tenantem PUBLICZNYM (public_tenant_id() bez nagłówka
-- hosta spada na is_default), bo consume_metered_view rozwiązuje tenant tak
-- samo jak get_entity_content.
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'meter-tenant', 'Meter Tenant', true);

INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'reader@meter.test'),
  ('d0000000-0000-0000-0000-000000000002', 'buyer@meter.test'),
  ('d0000000-0000-0000-0000-000000000003', 'corp@meter.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'reader@meter.test', 'Reader',
   'd1111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000002', 'buyer@meter.test', 'Buyer',
   'd1111111-1111-1111-1111-111111111111'),
  ('d0000000-0000-0000-0000-000000000003', 'corp@meter.test', 'Corp Seat',
   'd1111111-1111-1111-1111-111111111111');

-- posts.parent_page_id jest NOT NULL → strona-rodzic.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('dd000000-0000-0000-0000-00000000000d', 'd1111111-1111-1111-1111-111111111111', 'meter-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, content_pl) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'paid-1',
   'd0000000-0000-0000-0000-000000000001', 'published',
   'd1111111-1111-1111-1111-111111111111', 'dd000000-0000-0000-0000-00000000000d',
   'Paid 1', '<p>Treść premium 1</p>'),
  ('d0000000-0000-0000-0000-0000000000a2', 'paid-2',
   'd0000000-0000-0000-0000-000000000001', 'published',
   'd1111111-1111-1111-1111-111111111111', 'dd000000-0000-0000-0000-00000000000d',
   'Paid 2', '<p>Treść premium 2</p>'),
  ('d0000000-0000-0000-0000-0000000000a3', 'paid-exempt',
   'd0000000-0000-0000-0000-000000000001', 'published',
   'd1111111-1111-1111-1111-111111111111', 'dd000000-0000-0000-0000-00000000000d',
   'Paid exempt', '<p>Twarda ściana</p>');

INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, metering_policy) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'post', 'd0000000-0000-0000-0000-0000000000a1', 'paid', '{}', 'inherit'),
  ('d1111111-1111-1111-1111-111111111111', 'post', 'd0000000-0000-0000-0000-0000000000a2', 'paid', '{}', 'inherit'),
  ('d1111111-1111-1111-1111-111111111111', 'post', 'd0000000-0000-0000-0000-0000000000a3', 'paid', '{}', 'exempt');

-- Metering: limit 1/mies. dla kont, 0 dla anonimów (ściana rejestracji).
INSERT INTO public.metering_settings
  (tenant_id, enabled, member_monthly_limit, anon_monthly_limit, meter_paid, meter_members, show_counter)
VALUES
  ('d1111111-1111-1111-1111-111111111111', true, 1, 0, true, true, true);

-- Uprawniony przez zakup jednorazowy (test 7).
INSERT INTO public.user_purchases (user_id, tenant_id, entity_type, entity_id, amount_cents, currency, status) VALUES
  ('d0000000-0000-0000-0000-000000000002', 'd1111111-1111-1111-1111-111111111111',
   'post', 'd0000000-0000-0000-0000-0000000000a1', 1900, 'PLN', 'active');

-- B2B: warstwy + organizacja corporate + odebrane miejsce (test 8).
SELECT public.seed_membership_tiers('d1111111-1111-1111-1111-111111111111');
INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit, status) VALUES
  ('d2222222-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111',
   'Test Corp', 'corporate', 5, 'active');
INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, user_id, role, claimed_at) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222',
   'corp@meter.test', 'd0000000-0000-0000-0000-000000000003', 'member', now());

-- ── Zalogowany czytelnik bez uprawnień ─────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 1) Bramka bazowa: body niedostępne wprost.
SELECT is(
  (SELECT count(*)::int FROM public.get_entity_content('post', 'd0000000-0000-0000-0000-0000000000a1')),
  0, 'get_entity_content odmawia body nieuprawnionemu');

-- 5) Polityka exempt: nie wydaje body mimo wolnego limitu (used=0).
SELECT is(
  (SELECT granted FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a3')),
  false, 'exempt: metering nie wydaje body');

-- 2) Pierwsze odblokowanie na licznik: granted + consumed + body.
SELECT results_eq(
  $$ SELECT granted, consumed, used, monthly_limit
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (true, true, 1, 1) $$,
  'pierwszy artykuł: granted, consumed, used=1/1');
SELECT isnt(
  (SELECT content_pl FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a1')),
  NULL, 'metered unlock zwraca body');

-- 3) Ponowne czytanie tego samego artykułu nie zużywa slotu.
SELECT results_eq(
  $$ SELECT granted, consumed, used
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (true, false, 1) $$,
  're-read: granted bez ponownej konsumpcji');

-- 4) Limit wyczerpany: drugi artykuł bez body, stan licznika kompletny.
SELECT results_eq(
  $$ SELECT granted, used, monthly_limit, remaining
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a2') $$,
  $$ VALUES (false, 1, 1, 0) $$,
  'limit wyczerpany: odmowa z pełnym stanem licznika');
SELECT is(
  (SELECT content_pl FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a2')),
  NULL, 'po wyczerpaniu limitu body nie wycieka');

-- ── Anonim ─────────────────────────────────────────────────────────────────
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- 6a) anon_monthly_limit=0 → ściana rejestracji, zero konsumpcji.
SELECT results_eq(
  $$ SELECT granted, requires_registration
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a2',
                                        'e0000000-0000-0000-0000-0000000000ee') $$,
  $$ VALUES (false, true) $$,
  'anonim bez limitu: requires_registration');

RESET ROLE;
UPDATE public.metering_settings SET anon_monthly_limit = 1
 WHERE tenant_id = 'd1111111-1111-1111-1111-111111111111';
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

-- 6b) Po podniesieniu limitu anonim z kluczem gościa dostaje body.
SELECT results_eq(
  $$ SELECT granted, consumed, used
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a2',
                                        'e0000000-0000-0000-0000-0000000000ee') $$,
  $$ VALUES (true, true, 1) $$,
  'anonim z limitem: granted i policzone');

-- 6c) Bez klucza gościa nie ma tożsamości → odmowa (nie liczymy w ciemno).
SELECT is(
  (SELECT granted FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a1')),
  false, 'anonim bez visitor_id: odmowa');

-- ── Uprawniony przez zakup (nie zużywa licznika) ───────────────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT granted, consumed
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (true, false) $$,
  'kupujący: body bez zużycia licznika');
SELECT isnt(
  (SELECT content_pl FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a1')),
  NULL, 'kupujący dostaje body');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.metered_views
    WHERE user_id = 'd0000000-0000-0000-0000-000000000002'),
  0, 'uprawniony nie zostawia wierszy w metered_views');

-- ── B2B site licence: miejsce w organizacji (tier corporate) ───────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT is(
  public.has_content_access('post', 'd0000000-0000-0000-0000-0000000000a2'),
  true, 'miejsce w organizacji (premium_content) przechodzi has_content_access');
SELECT is(
  (SELECT count(*)::int FROM public.get_entity_content('post', 'd0000000-0000-0000-0000-0000000000a2')),
  1, 'site licence: get_entity_content wydaje body');

-- Licznik nienaruszony przez uprawnionego z organizacji.
SELECT results_eq(
  $$ SELECT granted, consumed
       FROM public.consume_metered_view('post', 'd0000000-0000-0000-0000-0000000000a2') $$,
  $$ VALUES (true, false) $$,
  'site licence: metering przepuszcza bez konsumpcji');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.metered_views
    WHERE user_id = 'd0000000-0000-0000-0000-000000000003'),
  0, 'miejsce w organizacji nie zostawia wierszy w metered_views');

SELECT * FROM finish();
ROLLBACK;
