-- pgTAP: uprawnienia warstwy respektuja STATUS MIEJSCA i NAJEMCE TRESCI
-- (audyt billingowy SUB-07, migracja 20261013090200_tier_entitlement_seat_status_tenant.sql).
--
-- Kryterium zakonczenia audytu: miejsce 'suspended' i subskrypcja z DRUGIEGO
-- najemcy zwracaja brak dostepu. Dowodzimy obu na samej bramce tresci
-- (`has_content_access`, ktora wydaje body przez get_entity_content), oraz na
-- funkcjach, z ktorych ta bramka sklada werdykt:
--   1. miejsce 'suspended' (po koncu karencji) -> brak dostepu do tresci 'paid'
--      i brak flagi premium_content / rangi warstwy organizacji;
--   2. miejsce 'grace' przed terminem -> dostep (karencja dziala jak miejsce
--      aktywne); 'grace' po terminie -> brak dostepu;
--   3. miejsce 'active' -> dostep (kontrola pozytywna);
--   4. subskrypcja w najemcy A NIE otwiera tresci 'paid' najemcy B - ani przez
--      premium_content (min_tier_rank = 0), ani przez range (min_tier_rank > 0);
--   5. ta sama subskrypcja otwiera tresc 'paid' najemcy A (kontrola pozytywna);
--   6. user_has_tier_feature(u, f) - stara sygnatura - deleguje do najemcy
--      kontekstu, a nowa z jawnym najemca zwraca false dla obcego najemcy;
--   7. granty: obie sygnatury user_has_tier_feature i user_tier_rank tylko dla
--      service_role.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(23);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Najemca A jest PUBLICZNYM (public_tenant_id() bez naglowka hosta spada na
-- is_default), najemca B - drugim obszarem roboczym. Wyzwalacze tenants
-- zasiewaja warstwy (corporate z premium_content, pro z ranga 20).
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default) VALUES
  ('a7000000-0000-0000-0000-0000000000aa', 'seat-tenant-a', 'Seat Tenant A', true),
  ('a7000000-0000-0000-0000-0000000000bb', 'seat-tenant-b', 'Seat Tenant B', false);

INSERT INTO auth.users (id, email) VALUES
  ('a7000000-0000-0000-0000-000000000001', 'active@seat.test'),
  ('a7000000-0000-0000-0000-000000000002', 'grace@seat.test'),
  ('a7000000-0000-0000-0000-000000000003', 'lapsed-grace@seat.test'),
  ('a7000000-0000-0000-0000-000000000004', 'suspended@seat.test'),
  ('a7000000-0000-0000-0000-000000000005', 'subscriber@seat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a7000000-0000-0000-0000-000000000001', 'active@seat.test', 'Active', 'a7000000-0000-0000-0000-0000000000aa'),
  ('a7000000-0000-0000-0000-000000000002', 'grace@seat.test', 'Grace', 'a7000000-0000-0000-0000-0000000000aa'),
  ('a7000000-0000-0000-0000-000000000003', 'lapsed-grace@seat.test', 'Lapsed', 'a7000000-0000-0000-0000-0000000000aa'),
  ('a7000000-0000-0000-0000-000000000004', 'suspended@seat.test', 'Suspended', 'a7000000-0000-0000-0000-0000000000aa'),
  ('a7000000-0000-0000-0000-000000000005', 'subscriber@seat.test', 'Subscriber', 'a7000000-0000-0000-0000-0000000000aa');

-- posts.parent_page_id jest NOT NULL -> strona-rodzic w kazdym najemcy.
INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('a7000000-0000-0000-0000-00000000a0a0', 'a7000000-0000-0000-0000-0000000000aa', 'seat-home-a'),
  ('a7000000-0000-0000-0000-00000000b0b0', 'a7000000-0000-0000-0000-0000000000bb', 'seat-home-b');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl, content_pl) VALUES
  ('a7000000-0000-0000-0000-0000000000a1', 'paid-a', 'a7000000-0000-0000-0000-000000000001', 'published',
   'a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-00000000a0a0', 'Paid A', '<p>A</p>'),
  ('a7000000-0000-0000-0000-0000000000a2', 'paid-a-rank', 'a7000000-0000-0000-0000-000000000001', 'published',
   'a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-00000000a0a0', 'Paid A rank', '<p>A20</p>'),
  ('a7000000-0000-0000-0000-0000000000b1', 'paid-b', 'a7000000-0000-0000-0000-000000000001', 'published',
   'a7000000-0000-0000-0000-0000000000bb', 'a7000000-0000-0000-0000-00000000b0b0', 'Paid B', '<p>B</p>'),
  ('a7000000-0000-0000-0000-0000000000b2', 'paid-b-rank', 'a7000000-0000-0000-0000-000000000001', 'published',
   'a7000000-0000-0000-0000-0000000000bb', 'a7000000-0000-0000-0000-00000000b0b0', 'Paid B rank', '<p>B20</p>');

INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, min_tier_rank) VALUES
  ('a7000000-0000-0000-0000-0000000000aa', 'post', 'a7000000-0000-0000-0000-0000000000a1', 'paid', '{}', 0),
  ('a7000000-0000-0000-0000-0000000000aa', 'post', 'a7000000-0000-0000-0000-0000000000a2', 'paid', '{}', 20),
  ('a7000000-0000-0000-0000-0000000000bb', 'post', 'a7000000-0000-0000-0000-0000000000b1', 'paid', '{}', 0),
  ('a7000000-0000-0000-0000-0000000000bb', 'post', 'a7000000-0000-0000-0000-0000000000b2', 'paid', '{}', 20);

-- Organizacja corporate (premium_content, ranga 30) w A + cztery miejsca.
INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit, status) VALUES
  ('a7000000-0000-0000-0000-00000000c0c0', 'a7000000-0000-0000-0000-0000000000aa',
   'Seat Corp', 'corporate', 1, 'active');
INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, user_id, role, claimed_at, status, grace_until) VALUES
  ('a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-00000000c0c0', 'active@seat.test',
   'a7000000-0000-0000-0000-000000000001', 'owner', now(), 'active', NULL),
  ('a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-00000000c0c0', 'grace@seat.test',
   'a7000000-0000-0000-0000-000000000002', 'member', now(), 'grace', now() + interval '3 days'),
  ('a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-00000000c0c0', 'lapsed-grace@seat.test',
   'a7000000-0000-0000-0000-000000000003', 'member', now(), 'grace', now() - interval '1 hour'),
  ('a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-00000000c0c0', 'suspended@seat.test',
   'a7000000-0000-0000-0000-000000000004', 'member', now(), 'suspended', NULL);

-- Subskrypcja planu warstwy 'pro' (premium_content, ranga 20) w najemcy A.
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, tier_key) VALUES
  ('a7000000-0000-0000-0000-00000000d0d0', 'a7000000-0000-0000-0000-0000000000aa', 'Pro A', 'Pro A', 4900, 'pro');
INSERT INTO public.user_subscriptions (tenant_id, user_id, plan_id, status, current_period_end) VALUES
  ('a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-000000000005',
   'a7000000-0000-0000-0000-00000000d0d0', 'active', now() + interval '20 days');

-- Kontrola fikstur: warstwy, na ktorych stoja asercje, istnieja w OBU najemcach.
SELECT is(
  (SELECT count(*)::int FROM public.membership_tiers
    WHERE key IN ('corporate', 'pro') AND active AND (features ->> 'premium_content')::boolean IS TRUE
      AND tenant_id IN ('a7000000-0000-0000-0000-0000000000aa', 'a7000000-0000-0000-0000-0000000000bb')),
  4, 'fikstura: corporate i pro z premium_content w obu najemcach');

-- ── 1-3) Status miejsca: bramka tresci ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a1'), true,
  'miejsce active: dostep do tresci paid najemcy organizacji (kontrola pozytywna)');

SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a1'), true,
  'miejsce grace przed terminem: dostep jak miejsce aktywne');

SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a1'), false,
  'miejsce grace PO terminie grace_until: brak dostepu');

SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a1'), false,
  'miejsce suspended: brak dostepu do tresci paid (kryterium SUB-07)');
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a2'), false,
  'miejsce suspended: ranga organizacji nie otwiera tresci z progiem 20');
SELECT is(
  (SELECT count(*)::int FROM public.get_entity_content('post', 'a7000000-0000-0000-0000-0000000000a1')),
  0, 'miejsce suspended: get_entity_content nie wydaje body');

-- ── 1-2) Status miejsca: skladowe werdyktu (rola wlasciciela) ─────────────
RESET ROLE;
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000004', 'premium_content',
                                       'a7000000-0000-0000-0000-0000000000aa'),
  false, 'user_has_tier_feature: miejsce suspended nie daje premium_content');
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000002', 'premium_content',
                                       'a7000000-0000-0000-0000-0000000000aa'),
  true, 'user_has_tier_feature: miejsce grace przed terminem daje premium_content');
SELECT is(public.user_tier_rank('a7000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-0000000000aa'),
  (SELECT rank FROM public.membership_tiers
    WHERE tenant_id = 'a7000000-0000-0000-0000-0000000000aa' AND is_default AND active LIMIT 1),
  'user_tier_rank: miejsce suspended spada do warstwy domyslnej najemcy');
SELECT is(public.user_tier_rank('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000aa'),
  30, 'user_tier_rank: miejsce active daje range corporate (30)');
SELECT is(public.user_tier_rank('a7000000-0000-0000-0000-000000000003', 'a7000000-0000-0000-0000-0000000000aa'),
  (SELECT rank FROM public.membership_tiers
    WHERE tenant_id = 'a7000000-0000-0000-0000-0000000000aa' AND is_default AND active LIMIT 1),
  'user_tier_rank: karencja po terminie nie podtrzymuje rangi');

-- ── 4-5) Subskrypcja najemcy A wobec tresci najemcy B ─────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a1'), true,
  'subskrypcja A otwiera tresc paid najemcy A (kontrola pozytywna)');
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000a2'), true,
  'subskrypcja A (pro, ranga 20) otwiera tresc A z progiem 20');
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000b1'), false,
  'subskrypcja A NIE otwiera tresci paid najemcy B (premium_content; kryterium SUB-07)');
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000b2'), false,
  'subskrypcja A NIE otwiera tresci B z progiem rangi 20');

-- Miejsce organizacji A tez nie przenosi sie na B.
SELECT set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is(public.has_content_access('post', 'a7000000-0000-0000-0000-0000000000b1'), false,
  'miejsce active w organizacji A nie otwiera tresci paid najemcy B');

-- ── 6) Funkcje skladowe: jawny najemca vs stara sygnatura ─────────────────
RESET ROLE;
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000005', 'premium_content',
                                       'a7000000-0000-0000-0000-0000000000bb'),
  false, 'user_has_tier_feature z najemca B: subskrypcja A nie daje flagi');
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000005', 'premium_content',
                                       'a7000000-0000-0000-0000-0000000000aa'),
  true, 'user_has_tier_feature z najemca A: subskrypcja A daje flage');
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000005', 'premium_content', NULL),
  false, 'user_has_tier_feature bez najemcy: fail-closed');
-- Stara sygnatura: najemca kontekstu = publiczny A (brak naglowka hosta).
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000005', 'premium_content'),
  true, 'stara sygnatura deleguje do najemcy kontekstu (A)');
SELECT is(public.user_has_tier_feature('a7000000-0000-0000-0000-000000000004', 'premium_content'),
  false, 'stara sygnatura: miejsce suspended nie daje flagi');

-- ── 7) Granty ──────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.user_has_tier_feature(uuid, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.user_has_tier_feature(uuid, text, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.user_has_tier_feature(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.user_has_tier_feature(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.user_tier_rank(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.user_has_tier_feature(uuid, text, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.user_tier_rank(uuid, uuid)', 'EXECUTE'),
  'user_has_tier_feature (obie sygnatury) i user_tier_rank: tylko service_role');

SELECT * FROM finish();
ROLLBACK;
