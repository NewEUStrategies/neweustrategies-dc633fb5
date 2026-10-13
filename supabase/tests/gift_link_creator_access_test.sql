-- pgTAP: link podarunkowy wymaga dostepu DARCZYNCY do darowanej tresci
-- (audyt billingowy SUB-06, migracja 20261012110100_gift_link_creator_access.sql).
--
-- Kryterium zakonczenia audytu: darmowe konto nie tworzy linku do platnej
-- tresci i nie odczytuje jej jako wlasciciel. Dodatkowo:
--   1. darmowe konto: gift_article_state nie obiecuje linku (can_gift=false,
--      requires_subscription=true), create_gift_link -> gift_access_required,
--      zaden wiersz post_gift_links nie powstaje;
--   2. darmowe konto MOZE darowac tresc 'members' (sam ja czyta z definicji) -
--      domyslne eligibility='registered' zostaje bezpieczne;
--   3. link sprzed poprawki (darmowe konto, platna tresc): galaz wlasciciela
--      odmawia (owner_no_access) bez body i bez zuzycia slotu;
--   4. konto platace tworzy link, czyta jako wlasciciel bez slotu, a odbiorcy
--      (konto i gosc) czytaja w granicach budzetu; trzeci odbija sie
--      (exhausted);
--   5. utrata dostepu (koniec subskrypcji): wlasciciel dostaje owner_no_access
--      bez body, nie moze utworzyc nowego linku, popover nie obiecuje linku -
--      a odbiorca, ktory juz zuzyl slot, czyta dalej (prezent wydany uczciwie).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Najemca PUBLICZNY: RPC udostepniania rozwiazuja najemce przez
-- public_tenant_id() (bez naglowka hosta = is_default).
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('a6000000-0000-0000-0000-0000000000aa', 'gift-access-tenant', 'Gift Access Tenant', true);

INSERT INTO auth.users (id, email) VALUES
  ('a6000000-0000-0000-0000-000000000001', 'free@gift-access.test'),
  ('a6000000-0000-0000-0000-000000000002', 'payer@gift-access.test'),
  ('a6000000-0000-0000-0000-000000000003', 'recipient1@gift-access.test'),
  ('a6000000-0000-0000-0000-000000000004', 'recipient3@gift-access.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a6000000-0000-0000-0000-000000000001', 'free@gift-access.test', 'Free', 'a6000000-0000-0000-0000-0000000000aa'),
  ('a6000000-0000-0000-0000-000000000002', 'payer@gift-access.test', 'Payer', 'a6000000-0000-0000-0000-0000000000aa'),
  ('a6000000-0000-0000-0000-000000000003', 'recipient1@gift-access.test', 'Recipient 1', 'a6000000-0000-0000-0000-0000000000aa'),
  ('a6000000-0000-0000-0000-000000000004', 'recipient3@gift-access.test', 'Recipient 3', 'a6000000-0000-0000-0000-0000000000aa');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('a6000000-0000-0000-0000-00000000a0a0', 'a6000000-0000-0000-0000-0000000000aa', 'gift-access-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, content_pl) VALUES
  ('a6000000-0000-0000-0000-0000000000a1', 'gift-paid', 'a6000000-0000-0000-0000-000000000002', 'published',
   'a6000000-0000-0000-0000-0000000000aa', 'a6000000-0000-0000-0000-00000000a0a0', 'Platny', '<p>Tresc platna</p>'),
  ('a6000000-0000-0000-0000-0000000000a2', 'gift-members', 'a6000000-0000-0000-0000-000000000002', 'published',
   'a6000000-0000-0000-0000-0000000000aa', 'a6000000-0000-0000-0000-00000000a0a0', 'Czlonkowski', '<p>Tresc dla kont</p>');

INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids) VALUES
  ('a6000000-0000-0000-0000-0000000000aa', 'post', 'a6000000-0000-0000-0000-0000000000a1', 'paid', '{}'),
  ('a6000000-0000-0000-0000-0000000000aa', 'post', 'a6000000-0000-0000-0000-0000000000a2', 'members', '{}');

-- Bramka rejestracyjna (domyslna) i budzet 2 klikniec.
INSERT INTO public.gift_article_settings
  (tenant_id, enabled, monthly_limit, link_ttl_days, max_redemptions_per_link, eligibility)
VALUES
  ('a6000000-0000-0000-0000-0000000000aa', true, 10, 30, 2, 'registered')
ON CONFLICT (tenant_id) DO UPDATE
  SET enabled = true, monthly_limit = 10, link_ttl_days = 30,
      max_redemptions_per_link = 2, eligibility = 'registered';

-- Platacy: subskrypcja planu warstwy 'pro' (premium_content) w tym najemcy.
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, tier_key) VALUES
  ('a6000000-0000-0000-0000-00000000d0d0', 'a6000000-0000-0000-0000-0000000000aa', 'Pro', 'Pro', 4900, 'pro');
INSERT INTO public.user_subscriptions (id, tenant_id, user_id, plan_id, status, current_period_end) VALUES
  ('a6000000-0000-0000-0000-00000000e0e0', 'a6000000-0000-0000-0000-0000000000aa',
   'a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-00000000d0d0',
   'active', now() + interval '20 days');

-- Link "sprzed poprawki": darmowe konto do platnej tresci (stara regula
-- tworzenia go wydawala). Kod jest znany, bo wstawiamy go jawnie.
INSERT INTO public.post_gift_links (tenant_id, post_id, created_by, code, expires_at, max_redemptions)
VALUES ('a6000000-0000-0000-0000-0000000000aa', 'a6000000-0000-0000-0000-0000000000a1',
        'a6000000-0000-0000-0000-000000000001', 'legacy_free_code_0123456', now() + interval '10 days', 2);

-- ── 1) Darmowe konto a platna tresc ────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(public.has_content_access('post', 'a6000000-0000-0000-0000-0000000000a1'), false,
  'kontrola: darmowe konto nie ma dostepu do tresci platnej');
SELECT results_eq(
  $$ SELECT can_gift, requires_auth, requires_subscription
       FROM public.gift_article_state('a6000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (false, false, true) $$,
  'darmowe konto: popover nie obiecuje linku do tresci platnej (requires_subscription)');
SELECT throws_ok(
  $$ SELECT public.create_gift_link('a6000000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'gift_access_required',
  'darmowe konto nie tworzy linku do tresci platnej (kryterium SUB-06)');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.post_gift_links
    WHERE created_by = 'a6000000-0000-0000-0000-000000000001' AND code <> 'legacy_free_code_0123456'),
  0, 'odmowa nie zostawia zadnego wiersza linku');

-- ── 2) Darmowe konto a tresc 'members' ─────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT can_gift FROM public.gift_article_state('a6000000-0000-0000-0000-0000000000a2') $$,
  $$ VALUES (true) $$,
  'darmowe konto: tresc members (sam ja czyta) wolno darowac');
SELECT isnt(
  (SELECT code FROM public.create_gift_link('a6000000-0000-0000-0000-0000000000a2')),
  NULL, 'darmowe konto tworzy link do tresci members (eligibility=registered bezpieczne)');

-- ── 3) Link sprzed poprawki: galaz wlasciciela bez dostepu ─────────────────
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', 'legacy_free_code_0123456') $$,
  $$ VALUES (false, 'owner_no_access'::text, 0) $$,
  'darmowe konto nie czyta tresci platnej jako wlasciciel (kryterium SUB-06)');
SELECT is(
  (SELECT content_pl
     FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', 'legacy_free_code_0123456')),
  NULL, 'owner_no_access: body nie wycieka');
RESET ROLE;
SELECT is(
  (SELECT redemption_count FROM public.post_gift_links WHERE code = 'legacy_free_code_0123456'),
  0, 'owner_no_access nie zuzywa slotu wlasnego linku (brak "spadku" do sciezki odbiorcy)');

-- ── 4) Konto platace: tworzy, czyta jako wlasciciel, odbiorcy w budzecie ───
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT can_gift, requires_subscription
       FROM public.gift_article_state('a6000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (true, false) $$,
  'konto platace: popover gotowy');
SELECT set_config(
  'test.gift_code',
  (SELECT code FROM public.create_gift_link('a6000000-0000-0000-0000-0000000000a1')),
  true);
SELECT isnt(current_setting('test.gift_code', true), '', 'konto platace tworzy link do tresci platnej');
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'owner'::text, 0) $$,
  'wlasciciel z dostepem czyta bez zuzycia slotu');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count, redemptions_remaining
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'ok'::text, 1, 1) $$,
  'odbiorca (konto bez uprawnien): body i slot 1/2');
SELECT isnt(
  (SELECT content_pl
     FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code'))),
  NULL, 'odbiorca dostaje body');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count, redemptions_remaining
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code'),
                                    'a6000000-0000-0000-0000-0000000000f1') $$,
  $$ VALUES (true, 'ok'::text, 2, 0) $$,
  'odbiorca-gosc: body i ostatni slot 2/2');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT valid, reason
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code')) $$,
  $$ VALUES (false, 'exhausted'::text) $$,
  'trzeci odbiorca odbija sie od wyczerpanego budzetu');

-- ── 5) Utrata dostepu przez darczynce ──────────────────────────────────────
RESET ROLE;
UPDATE public.user_subscriptions
   SET status = 'canceled', canceled_at = now(), current_period_end = now() - interval '1 minute'
 WHERE id = 'a6000000-0000-0000-0000-00000000e0e0';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a6000000-0000-0000-0000-0000000000a1'), false,
  'kontrola: po koncu subskrypcji darczynca nie ma dostepu');
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code')) $$,
  $$ VALUES (false, 'owner_no_access'::text, 2) $$,
  'utrata dostepu: galaz wlasciciela odmawia');
SELECT is(
  (SELECT content_pl
     FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code'))),
  NULL, 'utrata dostepu: wlasciciel nie dostaje body');
SELECT throws_ok(
  $$ SELECT public.create_gift_link('a6000000-0000-0000-0000-0000000000a1') $$,
  'P0001',
  'gift_access_required',
  'utrata dostepu: nowego linku do tresci platnej nie ma');
SELECT results_eq(
  $$ SELECT can_gift, requires_subscription
       FROM public.gift_article_state('a6000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (false, true) $$,
  'utrata dostepu: popover nie obiecuje linku');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a6000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count
       FROM public.redeem_gift_link('a6000000-0000-0000-0000-0000000000a1', current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'ok'::text, 2) $$,
  'odbiorca ze zuzytym slotem czyta dalej mimo utraty dostepu darczyncy');

RESET ROLE;
SELECT is(
  (SELECT redemption_count FROM public.post_gift_links
    WHERE code = current_setting('test.gift_code')),
  2, 'odmowy wlasciciela nie ruszyly budzetu linku');
SELECT is(
  (SELECT count(*)::int FROM public.post_gift_redemptions r
     JOIN public.post_gift_links l ON l.id = r.link_id
    WHERE l.code = current_setting('test.gift_code')),
  2, 'rejestr odbiorcow: dokladnie dwa sloty (bez wlasciciela)');

SELECT * FROM finish();
ROLLBACK;
