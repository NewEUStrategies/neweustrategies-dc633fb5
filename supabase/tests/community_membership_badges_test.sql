-- pgTAP: warstwy członkostwa (membership_tiers) + odznaki (profile_badges).
--
--   1. Nowy tenant dostaje automatycznie 3 warstwy (trigger seedujący).
--   2. Publiczny odczyt warstw jest ograniczony do PUBLICZNEGO tenanta
--      (cross-tenant niewidoczny) i tylko do aktywnych.
--   3. Zapis warstw: wyłącznie admin, wyłącznie we własnym tenancie
--      (UPDATE spoza roli/tenanta modyfikuje 0 wierszy pod RLS).
--   4. Rozstrzyganie warstwy: aktywna subskrypcja -> plan -> tier (rank,
--      features); brak subskrypcji -> tier domyślny (reader, rank 0).
--      has_tier_rank / has_tier_feature egzekwują benefity w bazie.
--   5. Odznaki: public read tylko w publicznym tenancie, insert/delete tylko
--      admin; trigger stempluje granted_by i powiadamia odbiorcę.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(20);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Tenanty testowe (INSERT odpala trigger seedujący warstwy).
INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'tenant-tiers-a', 'Tiers A'),
  ('c2222222-2222-2222-2222-222222222222', 'tenant-tiers-b', 'Tiers B');

INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin-a@tiers.test'),
  ('c1000000-0000-0000-0000-0000000000bb', 'user-a@tiers.test'),
  ('c1000000-0000-0000-0000-0000000000cc', 'pro-nes@tiers.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin-a@tiers.test', 'Admin A',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000bb', 'user-a@tiers.test', 'User A',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000cc', 'pro-nes@tiers.test', 'Pro Nes',
   (SELECT public.public_tenant_id()));

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin',
   'c1111111-1111-1111-1111-111111111111');

-- Subskrypcja Pro w PUBLICZNYM tenancie (rozstrzyganie warstwy liczy się
-- względem public_tenant_id(), nie tenanta profilu).
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key)
VALUES ('c3333333-3333-3333-3333-333333333333', (SELECT public.public_tenant_id()),
        'Pro (test)', 'Pro (test)', 9900, 'eur', 'month', 'pro');

INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end)
VALUES ('c1000000-0000-0000-0000-0000000000cc',
        'c3333333-3333-3333-3333-333333333333',
        (SELECT public.public_tenant_id()), 'active', now() + interval '30 days');

-- -- 1. Seed warstw dla nowego tenanta ------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.membership_tiers
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111'),
  3,
  'nowy tenant dostaje automatycznie reader/member/pro (trigger seedujacy)'
);

SELECT is(
  (SELECT count(*)::int FROM public.membership_tiers
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111' AND is_default),
  1,
  'dokladnie jedna warstwa domyslna per tenant'
);

-- -- 2. Publiczny odczyt: tylko publiczny tenant, tylko aktywne -----------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.membership_tiers
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111'),
  0,
  'anon nie widzi warstw obcego tenanta (public read = tylko publiczny tenant)'
);

SELECT is(
  (SELECT count(*)::int FROM public.membership_tiers
    WHERE tenant_id = (SELECT public.public_tenant_id()) AND active),
  3,
  'anon widzi aktywne warstwy publicznego tenanta'
);

-- -- 3. Zapis: tylko admin we wlasnym tenancie ----------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.membership_tiers SET name_pl = 'Zhakowana'
      WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111' AND key = 'pro' $$,
  'UPDATE zwyklego uzytkownika przechodzi skladniowo (RLS filtruje wiersze)'
);

RESET ROLE;
SELECT isnt(
  (SELECT name_pl FROM public.membership_tiers
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111' AND key = 'pro'),
  'Zhakowana',
  'zwykly uzytkownik nie zmodyfikowal warstwy (RLS: 0 wierszy)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ UPDATE public.membership_tiers SET sort_order = 7
      WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111' AND key = 'pro' $$,
  'admin aktualizuje warstwe wlasnego tenanta'
);

SELECT lives_ok(
  $$ UPDATE public.membership_tiers SET name_pl = 'Przejete'
      WHERE tenant_id = 'c2222222-2222-2222-2222-222222222222' AND key = 'pro' $$,
  'UPDATE admina na obcym tenancie przechodzi skladniowo (RLS filtruje wiersze)'
);

RESET ROLE;
SELECT is(
  (SELECT sort_order FROM public.membership_tiers
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111' AND key = 'pro'),
  7,
  'zmiana admina we wlasnym tenancie zapisana'
);
SELECT isnt(
  (SELECT name_pl FROM public.membership_tiers
    WHERE tenant_id = 'c2222222-2222-2222-2222-222222222222' AND key = 'pro'),
  'Przejete',
  'admin NIE zmodyfikowal warstwy obcego tenanta'
);

-- -- 4. Rozstrzyganie warstwy + egzekwowanie flag --------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

SELECT is(public.current_tier_rank(), 20,
  'aktywna subskrypcja pro -> rank 20');
SELECT ok(public.has_tier_rank(10),
  'has_tier_rank(10) przechodzi dla warstwy pro');
SELECT ok(public.has_tier_feature('pro_briefings'),
  'flaga pro_briefings odczytana z features warstwy pro');
SELECT ok(public.has_tier_feature('qa_priority'),
  'flaga qa_priority odczytana z features warstwy pro');

SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(public.current_tier_rank(), 0,
  'brak subskrypcji -> warstwa domyslna (reader, rank 0)');
SELECT ok(NOT public.has_tier_feature('qa_priority'),
  'reader nie ma flagi qa_priority');

-- -- 5. Odznaki -------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.profile_badges (tenant_id, user_id, badge)
     VALUES ('c1111111-1111-1111-1111-111111111111',
             'c1000000-0000-0000-0000-0000000000bb', 'expert') $$,
  'admin nadaje odznake we wlasnym tenancie'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"c1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT throws_ok(
  $$ INSERT INTO public.profile_badges (tenant_id, user_id, badge)
     VALUES ('c1111111-1111-1111-1111-111111111111',
             'c1000000-0000-0000-0000-0000000000bb', 'verified') $$,
  '42501',
  NULL,
  'zwykly uzytkownik nie nadaje odznak (admin only)'
);

RESET ROLE;

SELECT is(
  (SELECT granted_by FROM public.profile_badges
    WHERE user_id = 'c1000000-0000-0000-0000-0000000000bb' AND badge = 'expert'),
  'c1000000-0000-0000-0000-0000000000aa'::uuid,
  'trigger stempluje granted_by nadajacym adminem'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'c1000000-0000-0000-0000-0000000000bb'
      AND title_pl LIKE 'Otrzymujesz odznak%'),
  1,
  'odbiorca odznaki dostaje powiadomienie'
);

SELECT * FROM finish();
ROLLBACK;
