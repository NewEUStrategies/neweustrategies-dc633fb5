-- pgTAP: wzmianki prasowe podążają za profilem przy przeniesieniu konta
-- (migracja 20260914180000).
--
-- Klasa błędu. `media_mentions.tenant_id` to migawka profilu z chwili zapisu
-- (DEFAULT COALESCE(current_tenant_id(), public_tenant_id()), bez pinu i bez
-- przepięcia). Obie polityki właściciela wiążą najemcę w USING, więc po
-- przeniesieniu konta wpisy znikają autorowi z oczu, a UPDATE i DELETE zwracają
-- 0 wierszy BEZ BŁĘDU.
--
-- Druga strona jest poważniejsza: "media_mentions public read" filtruje po
-- `is_public AND tenant_id = public_tenant_id()`, czyli po najemcy PRZEGLĄDANEJ
-- witryny. Wzmianka zostaje więc OPUBLIKOWANA na stronie starego najemcy, a
-- autor traci nad nią kontrolę: nie widzi jej, nie zmieni jej i nie skasuje.
-- Ten plik przybija, że przeniesienie konta zabiera wzmiankę ze sobą.
--
-- Bliźniacze pliki tej samej klasy: push_and_digest_test.sql (sekcja 6),
-- author_profiles_owner_tenant_scope_test.sql (18-19),
-- profile_cv_tenant_follows_profile_test.sql.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(5);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('cd111111-1111-1111-1111-111111111111', 'mm-a', 'MM Tenant A', 'a.mm.example'),
  ('cd222222-2222-2222-2222-222222222222', 'mm-b', 'MM Tenant B', 'b.mm.example');

INSERT INTO auth.users (id, email) VALUES
  ('cd000000-0000-0000-0000-0000000000a1', 'mm-owner@mm.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('cd000000-0000-0000-0000-0000000000a1', 'mm-owner@mm.test', 'MM Owner',
   'cd111111-1111-1111-1111-111111111111');

INSERT INTO public.media_mentions (user_id, tenant_id, outlet, title, published_on, is_public)
VALUES ('cd000000-0000-0000-0000-0000000000a1', 'cd111111-1111-1111-1111-111111111111',
        'Rzeczpospolita', 'Komentarz o polityce UE', '2026-03-01', true);

-- ── (1) Ksztalt: polityki wlasciciela NADAL wiaza najemce ───────────────────
-- Naprawa dryfu nie moze byc pretekstem do rozluznienia izolacji.
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'media_mentions'
      AND policyname IN ('media_mentions owner read', 'media_mentions owner manage')
      AND qual ~ 'current_tenant_id'),
  2,
  'obie polityki wlasciciela nadal wiaza najemce w USING'
);

-- ── (2) Kontrola dodatnia: przed przeniesieniem autor widzi swoj wpis ───────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"cd000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.media_mentions), 1,
  'przed przeniesieniem autor widzi swoja wzmianke'
);

-- ── (3-5) Po przeniesieniu konta wzmianka idzie za autorem ─────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

UPDATE public.profiles
   SET tenant_id = 'cd222222-2222-2222-2222-222222222222'
 WHERE id = 'cd000000-0000-0000-0000-0000000000a1';

SELECT is(
  (SELECT tenant_id FROM public.media_mentions
    WHERE user_id = 'cd000000-0000-0000-0000-0000000000a1'),
  'cd222222-2222-2222-2222-222222222222'::uuid,
  'przeniesienie konta przepina wzmianke prasowa na nowego najemce'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"cd000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.media_mentions), 1,
  'po przeniesieniu autor NADAL widzi swoja wzmianke'
);

-- Sedno drugiej strony defektu: autor musi odzyskac mozliwosc ZDJECIA wpisu,
-- ktory wisi publicznie pod jego nazwiskiem. Przed naprawa DELETE zwracal
-- 0 wierszy bez bledu, a wzmianka zostawala na witrynie starego najemcy.
DELETE FROM public.media_mentions
 WHERE user_id = 'cd000000-0000-0000-0000-0000000000a1';

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.media_mentions
    WHERE user_id = 'cd000000-0000-0000-0000-0000000000a1'),
  0,
  'po przeniesieniu autor NADAL moze skasowac swoja wzmianke (odzyskuje kontrole)'
);

SELECT * FROM finish();
ROLLBACK;
