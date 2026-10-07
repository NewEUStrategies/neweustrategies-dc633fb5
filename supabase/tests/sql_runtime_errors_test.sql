-- pgTAP: funkcje, ktore padaly przy KAZDYM wykonaniu, i bramka plpgsql_check
-- (migracje 20261007140600_event_functions_runtime_errors
-- 20261007140700_runtime_errors_seats_workflow_passwords
-- i 20261007140710_club_application_crm_sync_overload).
--
-- DLACZEGO TEN PLIK WYKONUJE FUNKCJE, A NIE CZYTA ACL. PL/pgSQL nie sprawdza
-- ciala przy CREATE, a kontrakt TS <-> SQL patrzy na sygnatury i granty - wiec
-- funkcja z odwolaniem do kolumny po zmianie nazwy przechodzila CI na zielono
-- i padala u uzytkownika (synchronizacja miejsc Team, haslo tresci, CRM
-- zgloszen do klubu, panel uprawnien widowni). Ten plik WYWOLUJE naprawione
-- sciezki; bramka katalogowa (`plpgsql_check` na kazdej funkcji PL/pgSQL)
-- stoi osobno w plpgsql_check_gate_test.sql.
BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5e0a0000-0000-0000-0000-0000000000aa', 'sqlrt-a', 'SQL Runtime A', 'sqlrt-a.example'),
  ('5e0b0000-0000-0000-0000-0000000000bb', 'sqlrt-b', 'SQL Runtime B', 'sqlrt-b.example');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('5e000000-0000-0000-0000-0000000000a1', 'sqlrt-editor@example.org', now()),
  ('5e000000-0000-0000-0000-0000000000b1', 'sqlrt-editor-b@example.org', now()),
  ('5e000000-0000-0000-0000-0000000000a2', 'sqlrt-student@uni.example', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('5e000000-0000-0000-0000-0000000000a1', 'sqlrt-editor@example.org', 'SQLRT Editor', '5e0a0000-0000-0000-0000-0000000000aa'),
  ('5e000000-0000-0000-0000-0000000000b1', 'sqlrt-editor-b@example.org', 'SQLRT Editor B', '5e0b0000-0000-0000-0000-0000000000bb'),
  ('5e000000-0000-0000-0000-0000000000a2', 'sqlrt-student@uni.example', 'SQLRT Student', '5e0a0000-0000-0000-0000-0000000000aa');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('5e000000-0000-0000-0000-0000000000a1', 'editor', '5e0a0000-0000-0000-0000-0000000000aa'),
  ('5e000000-0000-0000-0000-0000000000a1', 'admin', '5e0a0000-0000-0000-0000-0000000000aa'),
  ('5e000000-0000-0000-0000-0000000000b1', 'editor', '5e0b0000-0000-0000-0000-0000000000bb');

-- Opublikowana strona najemcy A chroniona haslem (haslo ustawia redaktor A).
INSERT INTO public.pages (id, tenant_id, slug, status, content_pl) VALUES
  ('5e300000-0000-0000-0000-000000000001', '5e0a0000-0000-0000-0000-0000000000aa',
   'sqlrt-chroniona', 'published', 'Tresc chroniona');
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode) VALUES
  ('5e0a0000-0000-0000-0000-0000000000aa', 'page', '5e300000-0000-0000-0000-000000000001', 'password');

-- ── 1-2. Synchronizacja miejsc Team ─────────────────────────────────────────
INSERT INTO public.member_organizations (id, tenant_id, name, provider_subscription_id) VALUES
  ('5e400000-0000-0000-0000-000000000001', '5e0a0000-0000-0000-0000-0000000000aa', 'SQLRT Team', 'sub_sqlrt_team');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  (public.org_apply_subscription_seats('sub_sqlrt_team', 7) ->> 'linked')::boolean,
  true,
  'org_apply_subscription_seats znajduje organizacje po provider_subscription_id (bylo: 42703 paddle_subscription_id)');
RESET ROLE;
SELECT is(
  (SELECT seats_limit FROM public.member_organizations WHERE id = '5e400000-0000-0000-0000-000000000001'),
  7, 'limit miejsc idzie za liczba miejsc subskrypcji');

-- ── 3-4. CRM zgloszenia do klubu ────────────────────────────────────────────
INSERT INTO public.club_applications (id, tenant_id, user_id, specialization_slug, first_name, email) VALUES
  ('5e500000-0000-0000-0000-000000000001', '5e0a0000-0000-0000-0000-0000000000aa',
   '5e000000-0000-0000-0000-0000000000a2', 'sqlrt-spec', 'Ola', 'sqlrt-student@uni.example');
SELECT ok(
  public.club_application_crm_sync('5e500000-0000-0000-0000-000000000001') IS NOT NULL,
  'club_application_crm_sync zaklada lead (bylo: 42725 crm_upsert_from_form is not unique)');
SELECT is(
  (SELECT crm_sync_status FROM public.club_applications WHERE id = '5e500000-0000-0000-0000-000000000001'),
  'ok', 'zgloszenie ma status synchronizacji ok');

-- ── 5-9. Haslo tresci: ustawienie, weryfikacja, granica najemcy ─────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"5e000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.admin_set_content_password('page', '5e300000-0000-0000-0000-000000000001', 'Tajne-2026', NULL, NULL)$$,
  'admin_set_content_password ustawia haslo (bylo: 42883 public.gen_salt)');
RESET ROLE;
SELECT is(
  (SELECT ok FROM public._verify_content_password('5e0a0000-0000-0000-0000-0000000000aa',
     'page', '5e300000-0000-0000-0000-000000000001', 'Tajne-2026', NULL)),
  true, 'dobre haslo przechodzi weryfikacje (bylo: 42883 public.crypt)');
SELECT is(
  (SELECT ok FROM public._verify_content_password('5e0a0000-0000-0000-0000-0000000000aa',
     'page', '5e300000-0000-0000-0000-000000000001', 'zle-haslo', NULL)),
  false, 'zle haslo odrzucone');

SELECT set_config('request.jwt.claims',
  '{"sub":"5e000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.admin_set_content_password('page', '5e300000-0000-0000-0000-000000000001', 'Przejete-B', NULL, NULL);
SELECT public.admin_clear_content_password('page', '5e300000-0000-0000-0000-000000000001');
RESET ROLE;
SELECT is(
  (SELECT ok FROM public._verify_content_password('5e0a0000-0000-0000-0000-0000000000aa',
     'page', '5e300000-0000-0000-0000-000000000001', 'Tajne-2026', NULL)),
  true, 'redaktor najemcy B nie nadpisal ani nie wyczyscil hasla tresci najemcy A');
SELECT is(
  (SELECT ok FROM public._verify_content_password('5e0a0000-0000-0000-0000-0000000000aa',
     'page', '5e300000-0000-0000-0000-000000000001', 'Przejete-B', NULL)),
  false, 'haslo z najemcy B nie otwiera tresci najemcy A');

-- ── 10-12. Panel uprawnien widowni i „Moje pakiety" ─────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"5e000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT * FROM public.admin_event_audience_grants_list('{}'::jsonb)$$,
  'admin_event_audience_grants_list wykonuje sie (bylo: 42703 e.title)');
SELECT lives_ok($$SELECT * FROM public.admin_event_audience_grant_history('{}'::jsonb)$$,
  'admin_event_audience_grant_history wykonuje sie (bylo: 42703 pr.full_name)');
SELECT lives_ok($$SELECT * FROM public.event_my_package_orders()$$,
  'event_my_package_orders wykonuje sie (bylo: 42703 e.title)');
RESET ROLE;

-- ── 13-14. Widownia akademicka ──────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"5e000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(public.event_audience_qualifies('academic'), false,
  'academic bez domeny na liscie: false (bylo: 42804 AND jsonb)');
RESET ROLE;
INSERT INTO public.verification_domains (tenant_id, domain, active, academic) VALUES
  ('5e0a0000-0000-0000-0000-0000000000aa', 'uni.example', true, true);
SET LOCAL ROLE authenticated;
SELECT is(public.event_audience_qualifies('academic'), true,
  'academic z domena akademicka najemcy: true');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
