-- pgTAP: "Udostepnij pelny artykul" - bramka rejestracji + budzet klikniec
-- (migracja 20260806170000_share_full_article_click_budget.sql).
--
-- Weryfikuje mechanike serwerowa, na ktorej stoi cale UI:
--   1. eligibility='registered': zwykle konto (bez subskrypcji) generuje link,
--      a anonim nie;
--   2. link jest IDEMPOTENTNY per (wpis, nadawca) - powtorne wywolanie zwraca
--      ten sam kod i nie konsumuje limitu;
--   3. tresc publiczna nie da sie udostepnic (gift_post_not_gated), tresc na
--      haslo tez nie;
--   4. budzet 2 klikniec: dwoch roznych odbiorcow dostaje body, trzeci
--      dostaje reason='exhausted' BEZ body;
--   5. powrot tego samego odbiorcy nie pali kolejnego slotu (dedup po
--      rejestrze post_gift_redemptions);
--   6. nadawca i czytelnik z wlasnym uprawnieniem nie zuzywaja budzetu;
--   7. cofniety i wygasly link maja WLASNE powody (revoked / expired);
--   8. budzet jest ZAMROZONY na linku - zmiana ustawien tenanta nie rusza
--      linkow juz udostepnionych;
--   9. eligibility='subscribers' przywraca bramke subskrypcyjna;
--  10. rejestr odbiorcow jest niedostepny dla anonima i zwyklego konta (RLS);
--  11. sam KOD linku tez nie jest do wyczytania z bazy przez odbiorce - wiersz
--      post_gift_links widzi wylacznie nadawca i redakcja, odbiorca dostaje kod
--      w adresie URL (dlatego setup przenosi go z wyniku RPC nadawcy).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(26);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Tenant testowy musi byc tenantem PUBLICZNYM: RPC udostepniania rozwiazuja
-- tenant przez public_tenant_id() (bez naglowka hosta = is_default).
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'share-tenant', 'Share Tenant', true);

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'sharer@share.test'),
  ('c0000000-0000-0000-0000-000000000002', 'reader1@share.test'),
  ('c0000000-0000-0000-0000-000000000003', 'reader2@share.test'),
  ('c0000000-0000-0000-0000-000000000004', 'reader3@share.test'),
  ('c0000000-0000-0000-0000-000000000005', 'buyer@share.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'sharer@share.test', 'Sharer',
   'c1111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000002', 'reader1@share.test', 'Reader 1',
   'c1111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000003', 'reader2@share.test', 'Reader 2',
   'c1111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000004', 'reader3@share.test', 'Reader 3',
   'c1111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-000000000005', 'buyer@share.test', 'Buyer',
   'c1111111-1111-1111-1111-111111111111');

-- posts.parent_page_id jest NOT NULL → strona-rodzic.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('cc000000-0000-0000-0000-00000000000c', 'c1111111-1111-1111-1111-111111111111', 'share-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, content_pl) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'paywalled',
   'c0000000-0000-0000-0000-000000000001', 'published',
   'c1111111-1111-1111-1111-111111111111', 'cc000000-0000-0000-0000-00000000000c',
   'Za paywallem', '<p>Tresc premium</p>'),
  ('c0000000-0000-0000-0000-0000000000a2', 'public-post',
   'c0000000-0000-0000-0000-000000000001', 'published',
   'c1111111-1111-1111-1111-111111111111', 'cc000000-0000-0000-0000-00000000000c',
   'Publiczny', '<p>Tresc otwarta</p>'),
  ('c0000000-0000-0000-0000-0000000000a3', 'password-post',
   'c0000000-0000-0000-0000-000000000001', 'published',
   'c1111111-1111-1111-1111-111111111111', 'cc000000-0000-0000-0000-00000000000c',
   'Na haslo', '<p>Sekret autora</p>'),
  ('c0000000-0000-0000-0000-0000000000a4', 'paywalled-2',
   'c0000000-0000-0000-0000-000000000001', 'published',
   'c1111111-1111-1111-1111-111111111111', 'cc000000-0000-0000-0000-00000000000c',
   'Za paywallem 2', '<p>Tresc premium 2</p>');

INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'post', 'c0000000-0000-0000-0000-0000000000a1', 'paid', '{}'),
  ('c1111111-1111-1111-1111-111111111111', 'post', 'c0000000-0000-0000-0000-0000000000a3', 'password', '{}'),
  ('c1111111-1111-1111-1111-111111111111', 'post', 'c0000000-0000-0000-0000-0000000000a4', 'members', '{}');

-- Bramka rejestracyjna + budzet 2 klikniec (latwy do wyczerpania w tescie).
INSERT INTO public.gift_article_settings
  (tenant_id, enabled, monthly_limit, link_ttl_days, max_redemptions_per_link, eligibility)
VALUES
  ('c1111111-1111-1111-1111-111111111111', true, 10, 30, 2, 'registered');

-- Czytelnik z wlasnym uprawnieniem (zakup jednorazowy) - test 6.
INSERT INTO public.user_purchases (user_id, tenant_id, entity_type, entity_id, amount_cents, currency, status) VALUES
  ('c0000000-0000-0000-0000-000000000005', 'c1111111-1111-1111-1111-111111111111',
   'post', 'c0000000-0000-0000-0000-0000000000a1', 1900, 'PLN', 'active');

-- ── 1) Bramka: anonim vs zarejestrowany bez subskrypcji ────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(public.can_share_full_article(), false,
  'anonim nie moze udostepnic pelnego artykulu');
SELECT results_eq(
  $$ SELECT requires_auth, can_gift FROM public.gift_article_state('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (true, false) $$,
  'stan dla anonima: requires_auth bez uprawnienia');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(public.can_gift_articles(), false,
  'kontrola: nadawca NIE ma platnej subskrypcji');
SELECT is(public.can_share_full_article(), true,
  'eligibility=registered: zwykle konto moze udostepnic');

-- ── 2) Idempotencja linku ──────────────────────────────────────────────────
SELECT is(
  (SELECT code FROM public.create_gift_link('c0000000-0000-0000-0000-0000000000a1')),
  (SELECT code FROM public.create_gift_link('c0000000-0000-0000-0000-0000000000a1')),
  'create_gift_link jest idempotentne per (wpis, nadawca)');
SELECT is(
  (SELECT count(*)::int FROM public.post_gift_links
    WHERE post_id = 'c0000000-0000-0000-0000-0000000000a1' AND revoked_at IS NULL),
  1, 'powtorne wywolanie nie mnozy zywych linkow');
SELECT results_eq(
  $$ SELECT used, max_redemptions, redemption_count
       FROM public.create_gift_link('c0000000-0000-0000-0000-0000000000a1') $$,
  $$ VALUES (1, 2, 0) $$,
  'limit miesieczny liczy ARTYKULY (1), budzet zamrozony na 2 klikniecia');

-- Kod linku odbiorca dostaje OD NADAWCY (adres URL), nie z bazy: polityka
-- "gift links owner read" pokazuje wiersz post_gift_links wylacznie tworcy i
-- redakcji, wiec rola odbiorcy nie moze go odczytac (inaczej kazde konto
-- wyliczyloby kody i minelo paywall). Setup przenosi kod tak jak produkt:
-- z wyniku RPC nadawcy do wywolan odbiorcow.
SELECT set_config(
  'test.gift_code',
  (SELECT code FROM public.create_gift_link('c0000000-0000-0000-0000-0000000000a1')),
  true);

-- ── 3) Tresc publiczna i na haslo ──────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.create_gift_link('c0000000-0000-0000-0000-0000000000a2') $$,
  'P0001',
  'gift_post_not_gated',
  'wpisu bez paywalla nie da sie udostepnic linkiem');
SELECT throws_ok(
  $$ SELECT public.create_gift_link('c0000000-0000-0000-0000-0000000000a3') $$,
  'P0001',
  'gift_post_not_gated',
  'wpis na haslo pozostaje wykluczony');

-- ── 6a) Nadawca oglada wlasny link: bez konsumpcji budzetu ─────────────────
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         (SELECT code FROM public.post_gift_links
           WHERE post_id = 'c0000000-0000-0000-0000-0000000000a1' AND revoked_at IS NULL)) $$,
  $$ VALUES (true, 'owner'::text, 0) $$,
  'nadawca: body bez zuzycia slotu');

-- ── 4) Budzet klikniec: dwoch odbiorcow, trzeci odbija sie ─────────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.post_gift_links
    WHERE post_id = 'c0000000-0000-0000-0000-0000000000a1'),
  0, 'odbiorca nie widzi wiersza linku - kodu nie da sie wyczytac z bazy (RLS)');

SELECT results_eq(
  $$ SELECT valid, reason, redemption_count, redemptions_remaining
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'ok'::text, 1, 1) $$,
  'pierwszy odbiorca: body + slot 1/2');

-- 5) Powrot tego samego odbiorcy: bez kolejnego slotu.
SELECT results_eq(
  $$ SELECT valid, reason, redemption_count
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'ok'::text, 1) $$,
  'powrot tego samego odbiorcy nie pali kolejnego klikniecia');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT valid, reason, redemptions_remaining
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'ok'::text, 0) $$,
  'drugi odbiorca: budzet dochodzi do zera');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT valid, reason
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         current_setting('test.gift_code')) $$,
  $$ VALUES (false, 'exhausted'::text) $$,
  'trzeci odbiorca odbija sie od wyczerpanego budzetu');
SELECT is(
  (SELECT content_pl
     FROM public.redeem_gift_link(
       'c0000000-0000-0000-0000-0000000000a1',
       current_setting('test.gift_code'))),
  NULL, 'po wyczerpaniu budzetu body nie wycieka');

-- ── 6b) Czytelnik z wlasnym uprawnieniem nie potrzebuje slotu ──────────────
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT valid, reason
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         current_setting('test.gift_code')) $$,
  $$ VALUES (true, 'entitled'::text) $$,
  'czytelnik z zakupem czyta bez zuzycia budzetu (mimo exhausted)');

-- ── 10) Rejestr odbiorcow jest zamkniety dla zwyklych rol ──────────────────
SELECT is(
  (SELECT count(*)::int FROM public.post_gift_redemptions),
  0, 'zwykle konto nie widzi rejestru odbiorcow (RLS)');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.post_gift_redemptions
    WHERE link_id = (SELECT id FROM public.post_gift_links
                      WHERE post_id = 'c0000000-0000-0000-0000-0000000000a1'
                        AND revoked_at IS NULL)),
  2, 'rejestr zawiera dokladnie dwa zuzyte sloty (bez nadawcy i uprawnionego)');
SELECT is(
  (SELECT hits FROM public.post_gift_redemptions r
    WHERE r.recipient_id = 'c0000000-0000-0000-0000-000000000002'),
  2, 'powrot odbiorcy podbija hits zamiast zuzywac slot');

-- ── 8) Budzet zamrozony: zmiana ustawien nie rusza istniejacego linku ──────
UPDATE public.gift_article_settings
   SET max_redemptions_per_link = 50
 WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT max_redemptions FROM public.post_gift_links
    WHERE post_id = 'c0000000-0000-0000-0000-0000000000a1' AND revoked_at IS NULL),
  2, 'podniesienie ustawienia nie zmienia budzetu juz wydanego linku');

-- ── 7) Cofniecie i wygasniecie maja wlasne powody ──────────────────────────
UPDATE public.post_gift_links SET revoked_at = now()
 WHERE post_id = 'c0000000-0000-0000-0000-0000000000a1';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT valid, reason
       FROM public.redeem_gift_link(
         'c0000000-0000-0000-0000-0000000000a1',
         current_setting('test.gift_code')) $$,
  $$ VALUES (false, 'revoked'::text) $$,
  'cofniety link zwraca reason=revoked');

RESET ROLE;
INSERT INTO public.post_gift_links (tenant_id, post_id, created_by, code, expires_at, max_redemptions)
VALUES ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000a4',
        'c0000000-0000-0000-0000-000000000001', 'expired_code_0123456789', now() - interval '1 day', 5);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT valid, reason
       FROM public.redeem_gift_link('c0000000-0000-0000-0000-0000000000a4', 'expired_code_0123456789') $$,
  $$ VALUES (false, 'expired'::text) $$,
  'wygasly link zwraca reason=expired');
SELECT results_eq(
  $$ SELECT valid, reason
       FROM public.redeem_gift_link('c0000000-0000-0000-0000-0000000000a4', 'kod_ktorego_nie_ma_123') $$,
  $$ VALUES (false, 'invalid'::text) $$,
  'nieznany kod zwraca reason=invalid');

-- ── 9) Przelaczenie na bramke subskrypcyjna ────────────────────────────────
RESET ROLE;
UPDATE public.gift_article_settings
   SET eligibility = 'subscribers'
 WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(public.can_share_full_article(), false,
  'eligibility=subscribers: konto bez subskrypcji traci uprawnienie');
SELECT throws_ok(
  $$ SELECT public.create_gift_link('c0000000-0000-0000-0000-0000000000a4') $$,
  'P0001',
  'gift_subscription_required',
  'przy bramce subskrypcyjnej create podnosi gift_subscription_required');

SELECT * FROM finish();
ROLLBACK;
