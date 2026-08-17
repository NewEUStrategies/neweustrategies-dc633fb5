-- pgTAP: bramka warstwy w polityce "events member read" (20260817220000).
--
-- Finding: polityka SELECT dla authenticated pytala WYLACZNIE o
-- status = 'published' i tenanta (20260803191905), wiec kazde bezplatne
-- konto czytalo pelny wiersz wydarzenia members / z progiem rangi -
-- location, capacity, ticket_price_cents itd. - z pominieciem bramki,
-- ktora rsvp_event i get_event_access egzekwuja od zawsze. Anon dostal
-- wlasciwa bramke w 20260803191905 + 20260812103500; authenticated dopiero
-- w 20260817220000 i ten plik ja przybija:
--
--   1. Strukturalnie (pg_policies): polityka pyta o visibility ORAZ warstwe
--      (current_tier_rank + flaga pro_briefings), nie tylko o status/tenant.
--   2. reader (rank 0) widzi WYLACZNIE wydarzenia niebramkowane - identycznie
--      jak anon; members (takze z ranga domyslna 0), members-briefing,
--      public z progiem rangi, szkic i obcy tenant sa niewidoczne.
--   3. member (rank 10) widzi members i public z progiem 10, ale NIE
--      members-briefing - o briefingu decyduje FLAGA pro_briefings,
--      nie sama ranga (parytet z rsvp_event/get_event_access).
--   4. pro (flaga pro_briefings) widzi takze members-briefing.
--   5. Redakcja bez subskrypcji czyta caly tenant ze szkicem wlacznie
--      (osobna polityka "events staff read" - bramka warstwy jej nie rusza).
--   6. get_event_access dla niekwalifikujacego sie konta nadal zwraca
--      'tier_required' (RPC jest SECURITY DEFINER - kontrakt bez zmian).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(7);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('e6111111-1111-1111-1111-111111111111', 'tenant-events-gate-x', 'Events Gate X');

INSERT INTO auth.users (id, email) VALUES
  ('e6000000-0000-0000-0000-0000000000aa', 'reader-evg@evg.test'),
  ('e6000000-0000-0000-0000-0000000000bb', 'member-evg@evg.test'),
  ('e6000000-0000-0000-0000-0000000000cc', 'pro-evg@evg.test'),
  ('e6000000-0000-0000-0000-0000000000dd', 'editor-evg@evg.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.id IN ('e6000000-0000-0000-0000-0000000000aa',
                'e6000000-0000-0000-0000-0000000000bb',
                'e6000000-0000-0000-0000-0000000000cc',
                'e6000000-0000-0000-0000-0000000000dd');

-- Plany member/pro w publicznym tenancie + aktywne subskrypcje.
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key) VALUES
  ('e6222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'Member (gate test)', 'Member (gate test)', 4900, 'eur', 'month', 'member'),
  ('e6222222-2222-2222-2222-222222222202', (SELECT public.public_tenant_id()),
   'Pro (gate test)', 'Pro (gate test)', 9900, 'eur', 'month', 'pro');

INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end) VALUES
  ('e6000000-0000-0000-0000-0000000000bb', 'e6222222-2222-2222-2222-222222222201',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days'),
  ('e6000000-0000-0000-0000-0000000000cc', 'e6222222-2222-2222-2222-222222222202',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days');

-- Redakcja BEZ subskrypcji: rank 0, wiec kazdy przeciek przez bramke warstwy
-- do polityki stafowej bylby widoczny wlasnie tu.
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e6000000-0000-0000-0000-0000000000dd', 'editor', (SELECT public.public_tenant_id()));

-- Wydarzenia: kazdy wymiar bramki ma swoj wiersz. Wrazliwe pola (location,
-- ticket_price_cents) sa wypelnione - to dokladnie one wyciekaly.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at, visibility, min_tier_rank, status, location, ticket_price_cents) VALUES
  ('e6333333-3333-3333-3333-333333333301', (SELECT public.public_tenant_id()),
   'eg-open', 'Otwarte', 'Open', 'webinar', now() + interval '7 days',
   'public', 0, 'published', NULL, NULL),
  ('e6333333-3333-3333-3333-333333333302', (SELECT public.public_tenant_id()),
   'eg-public-tier', 'Publiczne z progiem', 'Public tier-gated', 'webinar', now() + interval '7 days',
   'public', 10, 'published', 'Bruksela, adres dla czlonkow', 25000),
  ('e6333333-3333-3333-3333-333333333303', (SELECT public.public_tenant_id()),
   'eg-members', 'Dla czlonkow', 'Members', 'webinar', now() + interval '7 days',
   'members', 10, 'published', 'Warszawa, adres dla czlonkow', 15000),
  ('e6333333-3333-3333-3333-333333333304', (SELECT public.public_tenant_id()),
   'eg-members-default', 'Dla czlonkow (ranga domyslna)', 'Members (default rank)',
   'webinar', now() + interval '7 days',
   'members', 0, 'published', NULL, NULL),
  ('e6333333-3333-3333-3333-333333333305', (SELECT public.public_tenant_id()),
   'eg-briefing', 'Briefing Pro', 'Pro briefing', 'briefing', now() + interval '7 days',
   'members', 10, 'published', NULL, NULL),
  ('e6333333-3333-3333-3333-333333333306', (SELECT public.public_tenant_id()),
   'eg-draft', 'Szkic', 'Draft', 'webinar', now() + interval '7 days',
   'public', 0, 'draft', NULL, NULL),
  ('e6333333-3333-3333-3333-333333333307', 'e6111111-1111-1111-1111-111111111111',
   'eg-foreign', 'Obcy', 'Foreign', 'webinar', now() + interval '7 days',
   'public', 0, 'published', NULL, NULL);

-- -- 1. Strukturalnie: polityka pyta o visibility i warstwe -----------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'events'
       AND policyname = 'events member read'
       AND cmd = 'SELECT'
       AND 'authenticated' = ANY (roles)
       AND qual ILIKE '%visibility%'
       AND qual ILIKE '%current_tier_rank%'
       AND qual ILIKE '%pro_briefings%'
  ),
  'polityka "events member read" bramkuje po visibility ORAZ warstwie (current_tier_rank + flaga pro_briefings), nie tylko po status/tenant'
);

-- -- 2. anon: bez zmian po migracji ------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT array_agg(e.slug ORDER BY e.slug) FROM public.events e
    WHERE e.slug IN ('eg-open', 'eg-public-tier', 'eg-members', 'eg-members-default',
                     'eg-briefing', 'eg-draft', 'eg-foreign')),
  ARRAY['eg-open'],
  'anon nadal widzi WYLACZNIE opublikowane, niebramkowane wydarzenie publicznego tenanta'
);

-- -- 3. reader (rank 0): identyczny zbior jak anon ---------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e6000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- Zbior, nie licznik: jedna asercja rozstrzyga naraz wszystkie wykluczenia
-- (members takze przy randze 0, briefing, public z progiem, szkic, obcy tenant).
SELECT is(
  (SELECT array_agg(e.slug ORDER BY e.slug) FROM public.events e
    WHERE e.slug IN ('eg-open', 'eg-public-tier', 'eg-members', 'eg-members-default',
                     'eg-briefing', 'eg-draft', 'eg-foreign')),
  ARRAY['eg-open'],
  'reader (rank 0) widzi WYLACZNIE wydarzenia niebramkowane - location/ticket_price_cents wydarzen members i tier-gated nie schodza do klienta'
);

-- Kontrakt RPC bez zmian: kto zna id, dostaje uczciwe tier_required, nie 404.
SELECT is(
  (SELECT a.reason FROM public.get_event_access('e6333333-3333-3333-3333-333333333303') a),
  'tier_required',
  'get_event_access dla readera na wydarzeniu members nadal zwraca tier_required (SECURITY DEFINER poza RLS)'
);

-- -- 4. member (rank 10): members i prog 10 tak, briefing nie ----------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"e6000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(e.slug ORDER BY e.slug) FROM public.events e
    WHERE e.slug IN ('eg-open', 'eg-public-tier', 'eg-members', 'eg-members-default',
                     'eg-briefing', 'eg-draft', 'eg-foreign')),
  ARRAY['eg-members', 'eg-members-default', 'eg-open', 'eg-public-tier'],
  'member (rank 10) widzi members i public z progiem 10, ale NIE members-briefing (decyduje FLAGA pro_briefings, nie ranga)'
);

-- -- 5. pro (flaga pro_briefings): takze briefing ----------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"e6000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(e.slug ORDER BY e.slug) FROM public.events e
    WHERE e.slug IN ('eg-open', 'eg-public-tier', 'eg-members', 'eg-members-default',
                     'eg-briefing', 'eg-draft', 'eg-foreign')),
  ARRAY['eg-briefing', 'eg-members', 'eg-members-default', 'eg-open', 'eg-public-tier'],
  'pro (flaga pro_briefings) widzi wszystkie opublikowane wydarzenia publicznego tenanta z members-briefingiem wlacznie'
);

-- -- 6. Redakcja: osobna polityka stafowa nietknieta -------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"e6000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(e.slug ORDER BY e.slug) FROM public.events e
    WHERE e.slug IN ('eg-open', 'eg-public-tier', 'eg-members', 'eg-members-default',
                     'eg-briefing', 'eg-draft', 'eg-foreign')),
  ARRAY['eg-briefing', 'eg-draft', 'eg-members', 'eg-members-default', 'eg-open', 'eg-public-tier'],
  'editor bez subskrypcji (rank 0) czyta caly wlasny tenant ze szkicem wlacznie ("events staff read"), bez obcego tenanta'
);

SELECT * FROM finish();
ROLLBACK;
