-- pgTAP: zapisy CRM i newslettera wiazane z wolajacym
-- (migracja 20261007140500_crm_newsletter_writers_bound).
--
-- DEFEKTY: `crm_upsert_lead_from_profile(uuid)` byl wykonywalny dla kazdego
-- zalogowanego dla DOWOLNEGO profilu, `crm_backfill_all_leads()` admina
-- najemcy A pisal do CRM-u wszystkich najemcow, a `join_us_link_and_backfill`
-- przepinal subskrypcje powiazana juz z innym kontem.
--
-- CO PRZYPINA: ACL obu funkcji z argumentem (tylko service_role); odmowe
-- wywolania cudzego profilu; backfill wylacznie w najemcy wolajacego;
-- DZIALAJACE przyjecie zaproszenia (dotad INVOKER bez prawa do
-- `profiles.email` - kazde wywolanie padalo) z leadem; wiazanie subskrypcji
-- tylko bez wlasciciela.
BEGIN;
SELECT plan(12);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('c7a00000-0000-0000-0000-0000000000aa', 'crmw-a', 'CRM Writers A', 'crmw-a.example'),
  ('c7b00000-0000-0000-0000-0000000000bb', 'crmw-b', 'CRM Writers B', 'crmw-b.example');

-- a1 admin A, m1 czlonek A, i1 zaproszony do A, b1 konto w B, v1 ofiara w A.
INSERT INTO auth.users (id, email) VALUES
  ('c7000000-0000-0000-0000-0000000000a1', 'crmw-admin@example.org'),
  ('c7000000-0000-0000-0000-0000000000a2', 'crmw-member@example.org'),
  ('c7000000-0000-0000-0000-0000000000a3', 'crmw-invitee@example.org'),
  ('c7000000-0000-0000-0000-0000000000b1', 'crmw-other@example.org'),
  ('c7000000-0000-0000-0000-0000000000a4', 'crmw-victim@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c7000000-0000-0000-0000-0000000000a1', 'crmw-admin@example.org', 'CRMW Admin', 'c7a00000-0000-0000-0000-0000000000aa'),
  ('c7000000-0000-0000-0000-0000000000a2', 'crmw-member@example.org', 'CRMW Member', 'c7a00000-0000-0000-0000-0000000000aa'),
  ('c7000000-0000-0000-0000-0000000000a3', 'crmw-invitee@example.org', 'CRMW Invitee', 'c7a00000-0000-0000-0000-0000000000aa'),
  ('c7000000-0000-0000-0000-0000000000b1', 'crmw-other@example.org', 'CRMW Other', 'c7b00000-0000-0000-0000-0000000000bb'),
  ('c7000000-0000-0000-0000-0000000000a4', 'crmw-victim@example.org', 'CRMW Victim', 'c7a00000-0000-0000-0000-0000000000aa');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c7000000-0000-0000-0000-0000000000a1', 'admin', 'c7a00000-0000-0000-0000-0000000000aa');
INSERT INTO public.newsletter_subscribers (tenant_id, email, user_id) VALUES
  ('c7b00000-0000-0000-0000-0000000000bb', 'crmw-sub-b@example.org', NULL),
  ('c7a00000-0000-0000-0000-0000000000aa', 'crmw-victim@example.org', 'c7000000-0000-0000-0000-0000000000a4'),
  ('c7a00000-0000-0000-0000-0000000000aa', 'crmw-member@example.org', NULL);
INSERT INTO public.user_invitations (id, tenant_id, email, auth_user_id, status) VALUES
  ('c7900000-0000-0000-0000-000000000001', 'c7a00000-0000-0000-0000-0000000000aa',
   'crmw-invitee@example.org', 'c7000000-0000-0000-0000-0000000000a3', 'sent');

-- Wyzwalacze profili/subskrybentow zalozyly leady przy wstawianiu - zaczynamy
-- od pustego CRM-u obu najemcow, zeby asercje mowily o funkcjach, nie o seedzie.
DELETE FROM public.crm_leads
 WHERE tenant_id IN ('c7a00000-0000-0000-0000-0000000000aa', 'c7b00000-0000-0000-0000-0000000000bb');

-- ── 1-4. Uprawnienia ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.crm_upsert_lead_from_profile(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.crm_upsert_lead_from_profile(uuid)', 'EXECUTE'),
  'crm_upsert_lead_from_profile: bez EXECUTE dla klienta (bylo: authenticated, dowolny profil)');
SELECT ok(has_function_privilege('service_role', 'public.crm_upsert_lead_from_profile(uuid)', 'EXECUTE'),
  'crm_upsert_lead_from_profile: service_role');
SELECT ok(NOT has_function_privilege('authenticated', 'public.crm_upsert_lead_from_subscriber(uuid)', 'EXECUTE'),
  'crm_upsert_lead_from_subscriber: bez EXECUTE dla klienta');
SELECT ok(
  has_function_privilege('authenticated', 'public.accept_my_user_invitation()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_my_user_invitation()', 'EXECUTE'),
  'accept_my_user_invitation: authenticated tak, anon nie');

-- ── 5. Czlonek A nie wymusza leada z profilu w B ────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c7000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.crm_upsert_lead_from_profile('c7000000-0000-0000-0000-0000000000b1')$$,
  '42501', NULL,
  'czlonek A: wywolanie dla profilu z B odmowione (permission denied)');
RESET ROLE;

-- ── 6-7. Backfill admina A zostaje w A ─────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT * FROM public.crm_backfill_all_leads()$$, 'admin A uruchamia backfill');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.crm_leads WHERE tenant_id = 'c7b00000-0000-0000-0000-0000000000bb'),
  0, 'backfill admina A NIE pisze do CRM-u najemcy B (profil i subskrybent B bez leadow)');
SELECT is(
  (SELECT count(*)::int FROM public.crm_leads WHERE tenant_id = 'c7a00000-0000-0000-0000-0000000000aa'
     AND email_norm = 'crmw-member@example.org'),
  1, 'backfill dziala w najemcy wolajacego');

-- ── 9-10. Przyjecie zaproszenia dziala i zaklada lead ────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c7000000-0000-0000-0000-0000000000a3","role":"authenticated","email":"crmw-invitee@example.org"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT invitation_id FROM public.accept_my_user_invitation()),
  'c7900000-0000-0000-0000-000000000001'::uuid,
  'accept_my_user_invitation przyjmuje zaproszenie wolajacego');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.crm_leads WHERE tenant_id = 'c7a00000-0000-0000-0000-0000000000aa'
     AND email_norm = 'crmw-invitee@example.org'),
  1, 'lead zaproszonego powstal (wewnatrz funkcji, bez grantu CRM dla klienta)');

-- ── 11-12. Powiazanie subskrypcji tylko bez wlasciciela ───────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT public.join_us_link_and_backfill(
  'c7000000-0000-0000-0000-0000000000a2', 'c7a00000-0000-0000-0000-0000000000aa',
  'crmw-victim@example.org', '', '', '', '', '', '', '');
SELECT public.join_us_link_and_backfill(
  'c7000000-0000-0000-0000-0000000000a2', 'c7a00000-0000-0000-0000-0000000000aa',
  'CRMW-Member@example.org', '', '', '', '', '', '', '');
RESET ROLE;
SELECT is(
  (SELECT user_id FROM public.newsletter_subscribers
    WHERE tenant_id = 'c7a00000-0000-0000-0000-0000000000aa' AND email = 'crmw-victim@example.org'),
  'c7000000-0000-0000-0000-0000000000a4'::uuid,
  'subskrypcja powiazana z innym kontem zostaje jego (bylo: przepiecie na wolajacego)');
SELECT is(
  (SELECT user_id FROM public.newsletter_subscribers
    WHERE tenant_id = 'c7a00000-0000-0000-0000-0000000000aa' AND email = 'crmw-member@example.org'),
  'c7000000-0000-0000-0000-0000000000a2'::uuid,
  'subskrypcja bez wlasciciela zostaje powiazana (wielkosc liter adresu bez znaczenia)');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
