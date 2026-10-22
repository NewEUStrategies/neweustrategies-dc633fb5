-- pgTAP: Zespół „3-20 miejsc" - górny limit 20 miejsc organizacji na progu
-- `team` w bazie (I9b, migracja 20261020160300; decyzja właściciela
-- 2026-10-20).
--
-- CO PRZYPINA:
--   * limit organizacji: zakładanie z 21 miejscami, podniesienie ponad 20
--      i przejście Enterprise (25) -> Zespół - odrzucone `23514`
--      `orgs: team seats max`; 20 - przechodzi; Enterprise bez progu 20;
--   * organizacja Zespołu ponad limitem sprzed reguły (25): zostaje, inne
--      zmiany przechodzą, obniżenie przechodzi, ponowne podniesienie - nie;
--   * miejsca: 21. aktywne miejsce w Zespole odrzucone - wprost i przez
--      `org_add_seat` admina (także gdy limit organizacji sprzed reguły jest
--      wyższy); miejsce zawieszone i zmiana statusu (karencja) przechodzą -
--      to nie jest dodawanie; inne progi bez limitu 20;
--   * ACL: funkcje wyzwalaczy bez EXECUTE dla ról API.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_team_seat_cap
BEGIN;
SELECT plan(16);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name)
VALUES ('19b30000-0000-4000-8000-0000000000a1', 'i9b-seats', 'I9b Seats');
INSERT INTO auth.users (id, email)
VALUES ('19b30000-0000-4000-8000-00000000a001', 'admin@i9b-seats.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id)
VALUES ('19b30000-0000-4000-8000-00000000a001', 'admin@i9b-seats.test', 'Admin',
        '19b30000-0000-4000-8000-0000000000a1');
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('19b30000-0000-4000-8000-00000000a001', 'admin'::public.app_role,
        '19b30000-0000-4000-8000-0000000000a1');

-- ── A. Limit organizacji ────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit)
     VALUES ('19b30000-0000-4000-8000-0000000000f1', '19b30000-0000-4000-8000-0000000000a1',
             'Zespół 21', 'team', 21) $$,
  '23514', 'orgs: team seats max', 'zakładanie Zespołu z 21 miejscami odrzucone (nie przycięte)');
SELECT lives_ok(
  $$ INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit)
     VALUES ('19b30000-0000-4000-8000-0000000000f1', '19b30000-0000-4000-8000-0000000000a1',
             'Zespół 20', 'team', 20) $$,
  'zakładanie Zespołu z 20 miejscami przechodzi');
SELECT throws_ok(
  $$ UPDATE public.member_organizations SET seats_limit = 21
      WHERE id = '19b30000-0000-4000-8000-0000000000f1' $$,
  '23514', 'orgs: team seats max', 'podniesienie Zespołu ponad 20 odrzucone');

INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit)
VALUES ('19b30000-0000-4000-8000-0000000000f2', '19b30000-0000-4000-8000-0000000000a1',
        'Enterprise 25', 'corporate', 25);
SELECT throws_ok(
  $$ UPDATE public.member_organizations SET tier_key = 'team'
      WHERE id = '19b30000-0000-4000-8000-0000000000f2' $$,
  '23514', 'orgs: team seats max', 'przejście Enterprise (25 miejsc) -> Zespół odrzucone');
SELECT lives_ok(
  $$ UPDATE public.member_organizations SET seats_limit = 40
      WHERE id = '19b30000-0000-4000-8000-0000000000f2' $$,
  'Enterprise: limit 40 bez progu Zespołu');

-- Organizacja Zespołu ponad limitem sprzed reguły (wyzwalacz wyłączony na czas
-- odtworzenia stanu sprzed migracji).
ALTER TABLE public.member_organizations DISABLE TRIGGER trg_member_organizations_team_seat_cap;
INSERT INTO public.member_organizations (id, tenant_id, name, tier_key, seats_limit)
VALUES ('19b30000-0000-4000-8000-0000000000f3', '19b30000-0000-4000-8000-0000000000a1',
        'Zespół sprzed reguły', 'team', 25);
ALTER TABLE public.member_organizations ENABLE TRIGGER trg_member_organizations_team_seat_cap;
SELECT lives_ok(
  $$ UPDATE public.member_organizations
        SET name = 'Zespół sprzed reguły (nowa nazwa)', tier_key = 'team', seats_limit = 25
      WHERE id = '19b30000-0000-4000-8000-0000000000f3' $$,
  'ponad limitem: zapis bez podnoszenia (pełny wiersz z panelu) przechodzi - limit 25 zostaje');
SELECT lives_ok(
  $$ UPDATE public.member_organizations SET seats_limit = 22
      WHERE id = '19b30000-0000-4000-8000-0000000000f3' $$,
  'ponad limitem: obniżenie 25 -> 22 przechodzi');
SELECT throws_ok(
  $$ UPDATE public.member_organizations SET seats_limit = 23
      WHERE id = '19b30000-0000-4000-8000-0000000000f3' $$,
  '23514', 'orgs: team seats max', 'ponad limitem: ponowne podniesienie 22 -> 23 odrzucone');

-- ── B. Miejsca ──────────────────────────────────────────────────────────────
INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, role, status)
SELECT '19b30000-0000-4000-8000-0000000000a1', '19b30000-0000-4000-8000-0000000000f1',
       'osoba' || n || '@i9b-seats.test', 'member', 'active'
  FROM generate_series(1, 20) n;
SELECT is(
  (SELECT count(*)::int FROM public.organization_seats
    WHERE org_id = '19b30000-0000-4000-8000-0000000000f1' AND status = 'active'),
  20, 'Zespół: 20 aktywnych miejsc przechodzi');
SELECT throws_ok(
  $$ INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, role, status)
     VALUES ('19b30000-0000-4000-8000-0000000000a1', '19b30000-0000-4000-8000-0000000000f1',
             'dwudziesta-pierwsza@i9b-seats.test', 'member', 'active') $$,
  '23514', 'orgs: team seats max', 'Zespół: 21. aktywne miejsce odrzucone');
SELECT lives_ok(
  $$ INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, role, status)
     VALUES ('19b30000-0000-4000-8000-0000000000a1', '19b30000-0000-4000-8000-0000000000f1',
             'zawieszona@i9b-seats.test', 'member', 'suspended') $$,
  'Zespół: miejsce zawieszone nie jest dodawaniem aktywnego');

-- Organizacja z limitem 22 sprzed reguły: 20 aktywnych, 21. przez RPC admina.
INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, role, status)
SELECT '19b30000-0000-4000-8000-0000000000a1', '19b30000-0000-4000-8000-0000000000f3',
       'legacy' || n || '@i9b-seats.test', 'member', 'active'
  FROM generate_series(1, 20) n;
INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, role, status)
VALUES ('19b30000-0000-4000-8000-0000000000a1', '19b30000-0000-4000-8000-0000000000f3',
        'legacy-zawieszona@i9b-seats.test', 'member', 'suspended');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"19b30000-0000-4000-8000-00000000a001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.org_add_seat('19b30000-0000-4000-8000-0000000000f3', 'nowa@i9b-seats.test', 'member') $$,
  '23514', 'orgs: team seats max',
  'org_add_seat: limit organizacji 22 sprzed reguły, ale 21. aktywne miejsce Zespołu odrzucone');
RESET ROLE;

SELECT lives_ok(
  $$ UPDATE public.organization_seats SET status = 'active', suspended_at = NULL, suspended_reason = NULL
      WHERE org_id = '19b30000-0000-4000-8000-0000000000f3'
        AND invited_email = 'legacy-zawieszona@i9b-seats.test' $$,
  'zmiana statusu (przeliczenie karencji) nie jest dodawaniem - przechodzi bez usuwania miejsc');
SELECT is(
  (SELECT count(*)::int FROM public.organization_seats
    WHERE org_id = '19b30000-0000-4000-8000-0000000000f3' AND status = 'active'),
  21, 'ponad limitem: miejsca zostają (bez usuwania), blokowane jest tylko dodawanie');

-- Inny próg: Enterprise z 40 miejscami przyjmuje 25 aktywnych.
INSERT INTO public.organization_seats (tenant_id, org_id, invited_email, role, status)
SELECT '19b30000-0000-4000-8000-0000000000a1', '19b30000-0000-4000-8000-0000000000f2',
       'ent' || n || '@i9b-seats.test', 'member', 'active'
  FROM generate_series(1, 25) n;
SELECT is(
  (SELECT count(*)::int FROM public.organization_seats
    WHERE org_id = '19b30000-0000-4000-8000-0000000000f2' AND status = 'active'),
  25, 'Enterprise: 25 aktywnych miejsc - reguła Zespołu go nie dotyczy');

-- ── C. ACL ──────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.tg_member_organizations_team_seat_cap()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_member_organizations_team_seat_cap()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tg_organization_seats_team_seat_cap()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.tg_organization_seats_team_seat_cap()', 'EXECUTE')
  AND (SELECT bool_and(p.prosecdef AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c
                                                WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp%'))
         FROM pg_proc p
        WHERE p.oid IN ('public.tg_member_organizations_team_seat_cap()'::regprocedure,
                        'public.tg_organization_seats_team_seat_cap()'::regprocedure)),
  'acl: wyzwalacze bez EXECUTE dla ról API, SECURITY DEFINER z search_path i pg_temp');

SELECT * FROM finish();
ROLLBACK;
