-- pgTAP: jedna ścieżka ręcznego nadania/odebrania członkostwa (S1, migracja
-- 20261020100400).
--
-- CO PRZYPINA:
--   * ACL: `admin_membership_grant_set` / `_revoke` dla authenticated
--     i service_role (nie anon); `admin_grant_membership` bez EXECUTE dla
--     authenticated (wywołanie z przeglądarki -> 42501);
--   * role: editor -> 42501 (nadanie i odebranie);
--   * najemca z sesji: użytkownik spoza najemcy -> P0002 `user_not_in_tenant`,
--     nadanie innego najemcy -> P0002 `grant_not_found`;
--   * warstwa nieaktywna -> 22023 `tier_inactive`, data w przeszłości ->
--     22023 `expires_in_past`;
--   * JEDNA TRANSAKCJA: błąd PO wygaszeniu (notatka łamiąca CHECK) cofa
--     wszystko - stare nadanie ręczne zostaje aktywne, brak nowego nadania
--     i wpisu audytu;
--   * wygaszanie WYŁĄCZNIE `source='manual'` tego użytkownika - nadania
--     z darowizny i programu ekspertów nietknięte;
--   * `audit_log` (`membership.manual_grant` z `revoked_grant_ids`,
--     `membership.manual_revoke` z powodem i źródłem);
--   * outbox CRM `member_crm_sync_pending` przez istniejący wyzwalacz
--     (`manual_grant` z warstwą, `manual_revoke` bez warstwy).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test membership_grants_single_path
BEGIN;
SELECT plan(31);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c5000000-0000-0000-0000-0000000000a0', 'hub-s1-mg-a', 'Hub S1 nadania A'),
  ('c5000000-0000-0000-0000-0000000000b0', 'hub-s1-mg-b', 'Hub S1 nadania B');

INSERT INTO auth.users (id, email) VALUES
  ('c5000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-mg.test'),
  ('c5000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-mg.test'),
  ('c5000000-0000-0000-0000-00000000a010', 'czlonek-a@hub-s1-mg.test'),
  ('c5000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-mg.test'),
  ('c5000000-0000-0000-0000-00000000b010', 'czlonek-b@hub-s1-mg.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c5000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-mg.test', 'Admin A', 'c5000000-0000-0000-0000-0000000000a0'),
  ('c5000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-mg.test', 'Editor A', 'c5000000-0000-0000-0000-0000000000a0'),
  ('c5000000-0000-0000-0000-00000000a010', 'czlonek-a@hub-s1-mg.test', 'Członek A', 'c5000000-0000-0000-0000-0000000000a0'),
  ('c5000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-mg.test', 'Admin B', 'c5000000-0000-0000-0000-0000000000b0'),
  ('c5000000-0000-0000-0000-00000000b010', 'czlonek-b@hub-s1-mg.test', 'Członek B', 'c5000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c5000000-0000-0000-0000-00000000a001', 'admin', 'c5000000-0000-0000-0000-0000000000a0'),
  ('c5000000-0000-0000-0000-00000000a002', 'editor', 'c5000000-0000-0000-0000-0000000000a0'),
  ('c5000000-0000-0000-0000-00000000b001', 'admin', 'c5000000-0000-0000-0000-0000000000b0');

INSERT INTO public.membership_tiers (tenant_id, key, rank, name_pl, name_en, active) VALUES
  ('c5000000-0000-0000-0000-0000000000a0', 'hub_s1_zloto', 50, 'Złoto', 'Gold', true),
  ('c5000000-0000-0000-0000-0000000000a0', 'hub_s1_srebro', 40, 'Srebro', 'Silver', true),
  ('c5000000-0000-0000-0000-0000000000a0', 'hub_s1_stare', 30, 'Stare', 'Old', false),
  ('c5000000-0000-0000-0000-0000000000b0', 'hub_s1_zloto', 50, 'Złoto', 'Gold', true);

-- Członek A ma trzy aktywne nadania: ręczne, z darowizny i z programu ekspertów.
INSERT INTO public.membership_grants (id, tenant_id, user_id, tier_key, source, granted_by) VALUES
  ('c5000000-0000-0000-0000-0000000007a1', 'c5000000-0000-0000-0000-0000000000a0', 'c5000000-0000-0000-0000-00000000a010', 'hub_s1_srebro', 'manual', 'c5000000-0000-0000-0000-00000000a001'),
  ('c5000000-0000-0000-0000-0000000007a2', 'c5000000-0000-0000-0000-0000000000a0', 'c5000000-0000-0000-0000-00000000a010', 'hub_s1_srebro', 'donation', NULL),
  ('c5000000-0000-0000-0000-0000000007a3', 'c5000000-0000-0000-0000-0000000000a0', 'c5000000-0000-0000-0000-00000000a010', 'hub_s1_zloto', 'expert', NULL),
  ('c5000000-0000-0000-0000-0000000007b1', 'c5000000-0000-0000-0000-0000000000b0', 'c5000000-0000-0000-0000-00000000b010', 'hub_s1_zloto', 'manual', 'c5000000-0000-0000-0000-00000000b001');
DELETE FROM public.member_crm_sync_pending
 WHERE tenant_id IN ('c5000000-0000-0000-0000-0000000000a0', 'c5000000-0000-0000-0000-0000000000b0');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE ids (name text PRIMARY KEY, id uuid) ON COMMIT DROP;

-- ── 1. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_membership_grant_set(uuid, text, timestamptz, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_membership_grant_revoke(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.admin_membership_grant_set(uuid, text, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_membership_grant_set(uuid, text, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_membership_grant_revoke(uuid, text)', 'EXECUTE'),
  'acl: nowe RPC dla authenticated i service_role, nie dla anon');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.admin_grant_membership(text, text, integer, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_grant_membership(text, text, integer, text)', 'EXECUTE'),
  'acl: admin_grant_membership bez EXECUTE dla authenticated i anon (forward-only, bez DROP)');

SELECT pg_temp.as_user('c5000000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_grant_membership('czlonek-a@hub-s1-mg.test', 'hub_s1_zloto', NULL, NULL) $$,
  '42501', NULL, 'acl: stara ścieżka z przeglądarki -> 42501 także dla admina');
RESET ROLE;

-- ── 2. Role i najemca ────────────────────────────────────────────────────────
SELECT pg_temp.as_user('c5000000-0000-0000-0000-00000000a002');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000a010', 'hub_s1_zloto', NULL, NULL) $$,
  '42501', 'forbidden', 'role: editor nie nadaje członkostwa (42501)');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_revoke('c5000000-0000-0000-0000-0000000007a1', NULL) $$,
  '42501', 'forbidden', 'role: editor nie odbiera członkostwa (42501)');

SELECT pg_temp.as_user('c5000000-0000-0000-0000-00000000a001');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000b010', 'hub_s1_zloto', NULL, NULL) $$,
  'P0002', 'user_not_in_tenant', 'najemca: użytkownik innego najemcy -> P0002 (konto nie jest szukane globalnie)');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000a010', 'hub_s1_stare', NULL, NULL) $$,
  '22023', 'tier_inactive', 'walidacja: warstwa nieaktywna -> 22023 tier_inactive');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000a010', 'nie_ma_takiej', NULL, NULL) $$,
  '22023', 'tier_inactive', 'walidacja: nieistniejąca warstwa -> 22023 tier_inactive');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000a010', 'hub_s1_zloto', now() - interval '1 day', NULL) $$,
  '22023', 'expires_in_past', 'walidacja: wygaśnięcie w przeszłości -> 22023');

-- ── 3. Jedna transakcja: błąd po wygaszeniu cofa wszystko ───────────────────
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000a010', 'hub_s1_zloto', NULL, repeat('x', 301)) $$,
  '23514', NULL, 'transakcja: notatka łamiąca CHECK pada przy INSERT - już PO wygaszeniu starego nadania');
SELECT is(
  (SELECT revoked_at FROM public.membership_grants WHERE id = 'c5000000-0000-0000-0000-0000000007a1'),
  NULL, 'transakcja: stare nadanie ręczne nadal aktywne (wygaszenie cofnięte razem z błędem)');
SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE tenant_id = 'c5000000-0000-0000-0000-0000000000a0' AND user_id = 'c5000000-0000-0000-0000-00000000a010'),
  3, 'transakcja: odrzucone wywołania nie dodały żadnego nadania');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log
    WHERE tenant_id = 'c5000000-0000-0000-0000-0000000000a0' AND action LIKE 'membership.manual_%'),
  0, 'transakcja: brak wpisu audytu po błędach');

-- ── 4. Nadanie ───────────────────────────────────────────────────────────────
INSERT INTO ids (name, id)
SELECT 'grant', public.admin_membership_grant_set(
  'c5000000-0000-0000-0000-00000000a010', 'hub_s1_zloto', '2027-12-31 23:00:00+00', '  Partner konferencji  ');
SELECT results_eq(
  $$ SELECT tier_key, source, granted_by, expires_at, note, revoked_at IS NULL
       FROM public.membership_grants WHERE id = (SELECT id FROM ids WHERE name = 'grant') $$,
  $$ VALUES ('hub_s1_zloto', 'manual', 'c5000000-0000-0000-0000-00000000a001'::uuid,
             '2027-12-31 23:00:00+00'::timestamptz, 'Partner konferencji', true) $$,
  'nadanie: nowe nadanie manual z autorem z sesji, datą wygaśnięcia i przyciętą z białych znaków notatką');
SELECT isnt(
  (SELECT revoked_at FROM public.membership_grants WHERE id = 'c5000000-0000-0000-0000-0000000007a1'),
  NULL, 'nadanie: poprzednie nadanie RĘCZNE wygaszone');
SELECT results_eq(
  $$ SELECT source, revoked_at IS NULL FROM public.membership_grants
      WHERE id IN ('c5000000-0000-0000-0000-0000000007a2', 'c5000000-0000-0000-0000-0000000007a3')
      ORDER BY source $$,
  $$ VALUES ('donation', true), ('expert', true) $$,
  'nadanie: nadania z darowizny i programu ekspertów nietknięte');
SELECT is(
  (SELECT revoked_at FROM public.membership_grants WHERE id = 'c5000000-0000-0000-0000-0000000007b1'),
  NULL, 'izolacja: nadanie ręczne najemcy B nietknięte');
SELECT results_eq(
  $$ SELECT actor_id, entity_type, metadata->>'tier_key', metadata->>'user_id', metadata->'revoked_grant_ids'
       FROM public.audit_log
      WHERE action = 'membership.manual_grant' AND entity_id = (SELECT id FROM ids WHERE name = 'grant') $$,
  $$ VALUES ('c5000000-0000-0000-0000-00000000a001'::uuid, 'membership_grant', 'hub_s1_zloto',
             'c5000000-0000-0000-0000-00000000a010', '["c5000000-0000-0000-0000-0000000007a1"]'::jsonb) $$,
  'audit: membership.manual_grant z warstwą, użytkownikiem i listą wygaszonych nadań');
SELECT results_eq(
  $$ SELECT tier_key, reason, actor_id FROM public.member_crm_sync_pending
      WHERE tenant_id = 'c5000000-0000-0000-0000-0000000000a0' AND user_id = 'c5000000-0000-0000-0000-00000000a010' $$,
  $$ VALUES ('hub_s1_zloto', 'manual_grant', 'c5000000-0000-0000-0000-00000000a001'::uuid) $$,
  'crm: outbox member_crm_sync_pending = nowa warstwa (istniejący wyzwalacz, ta sama transakcja)');

INSERT INTO ids (name, id)
SELECT 'grant2', public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000a010', 'hub_s1_srebro', NULL, NULL);
SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE user_id = 'c5000000-0000-0000-0000-00000000a010' AND source = 'manual' AND revoked_at IS NULL),
  1, 'nadanie: po zmianie warstwy dokładnie jedno aktywne nadanie ręczne');

-- ── 5. Odebranie ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_revoke((SELECT id FROM ids WHERE name = 'grant2'), repeat('p', 501)) $$,
  '22023', 'reason_too_long', 'odebranie: powód > 500 znaków odrzucony, nie przycięty');
SELECT is(
  public.admin_membership_grant_revoke((SELECT id FROM ids WHERE name = 'grant2'), 'Koniec partnerstwa'),
  (SELECT id FROM ids WHERE name = 'grant2'),
  'odebranie: zwraca id nadania');
SELECT isnt(
  (SELECT revoked_at FROM public.membership_grants WHERE id = (SELECT id FROM ids WHERE name = 'grant2')),
  NULL, 'odebranie: revoked_at ustawione');
SELECT results_eq(
  $$ SELECT metadata->>'reason', metadata->>'source', metadata->>'tier_key'
       FROM public.audit_log
      WHERE action = 'membership.manual_revoke' AND entity_id = (SELECT id FROM ids WHERE name = 'grant2') $$,
  $$ VALUES ('Koniec partnerstwa', 'manual', 'hub_s1_srebro') $$,
  'audit: membership.manual_revoke z powodem, źródłem i warstwą');
SELECT results_eq(
  $$ SELECT tier_key, reason FROM public.member_crm_sync_pending
      WHERE tenant_id = 'c5000000-0000-0000-0000-0000000000a0' AND user_id = 'c5000000-0000-0000-0000-00000000a010' $$,
  $$ VALUES (NULL::text, 'manual_revoke') $$,
  'crm: outbox po odebraniu = manual_revoke bez warstwy');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_revoke((SELECT id FROM ids WHERE name = 'grant2'), NULL) $$,
  'P0002', 'grant_not_found', 'odebranie: już odwołane -> P0002');
SELECT throws_ok(
  $$ SELECT public.admin_membership_grant_revoke('c5000000-0000-0000-0000-0000000007b1', NULL) $$,
  'P0002', 'grant_not_found', 'izolacja: admin A nie odbiera nadania najemcy B (P0002)');
SELECT is(
  public.admin_membership_grant_revoke('c5000000-0000-0000-0000-0000000007a2', NULL),
  'c5000000-0000-0000-0000-0000000007a2'::uuid,
  'odebranie: admin może jawnie odebrać także nadanie z innego źródła (wskazane po id)');
SELECT is(
  (SELECT metadata->>'source' FROM public.audit_log
    WHERE action = 'membership.manual_revoke' AND entity_id = 'c5000000-0000-0000-0000-0000000007a2'),
  'donation', 'audit: odebranie nadania z darowizny zapisuje jego źródło');

-- Wywołanie z rolą authenticated (grant) - admin B nadaje we własnym najemcy.
SELECT pg_temp.as_user('c5000000-0000-0000-0000-00000000b001');
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$ SELECT public.admin_membership_grant_set('c5000000-0000-0000-0000-00000000b010', 'hub_s1_zloto', NULL, NULL) $$,
  'role: admin B nadaje członkostwo w swoim najemcy przez rolę authenticated');
RESET ROLE;
SELECT isnt(
  (SELECT revoked_at FROM public.membership_grants WHERE id = 'c5000000-0000-0000-0000-0000000007b1'),
  NULL, 'izolacja: nadanie B wygasza wyłącznie ręczne nadanie użytkownika B');

SELECT * FROM finish();
ROLLBACK;
