-- pgTAP: wyciszenia diagnoz huba (S7, migracja 20261020150100).
--
-- CO PRZYPINA:
--   * ACL: trzy RPC panelu - authenticated i service_role, nigdy anon;
--   * wyciszanie WYŁĄCZNIE dla administratora: redaktor i autor 42501 (także
--     zdjęcie wyciszenia), redaktor CZYTA listę aktywnych wyciszeń;
--   * walidacja = CHECK-i tabeli, odrzucenie z kodem (22023), nigdy
--     przycięcie: termin `days` w przyszłości i <= 180 dni, `intentional`
--     wymaga odcisku zakresu i powodu, powód 3..500 znaków po `btrim`
--     (501 znaków odrzucone - w bazie nic nie zostaje), wzorzec `check_id`;
--   * krytyczne `sync.emit_errors` i `data_quality.ledger_drift` niewyciszalne;
--   * ponowne wyciszenie tego samego zakresu nadpisuje wiersz (ON CONFLICT),
--     `created_by` = wołający;
--   * zdarzenie `revenue_diagnostic.snoozed.v1` przy wyciszeniu i zdjęciu,
--     payload wyłącznie `check_id, scope_key, kind, until, op`, aktor z sesji;
--   * odczyt: tylko aktywne (wygasłe `days` znikają), dwóch najemców.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_diagnostic_snoozes
BEGIN;
SELECT plan(26);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e7151000-0000-0000-0000-0000000000a0', 'hub-s7-snooze-a', 'Hub S7 wyciszenia A'),
  ('e7151000-0000-0000-0000-0000000000b0', 'hub-s7-snooze-b', 'Hub S7 wyciszenia B');
INSERT INTO auth.users (id, email) VALUES
  ('e7151000-0000-0000-0000-00000000a001', 'admin-a@hub-s7-snooze.test'),
  ('e7151000-0000-0000-0000-00000000a002', 'editor-a@hub-s7-snooze.test'),
  ('e7151000-0000-0000-0000-00000000a003', 'author-a@hub-s7-snooze.test'),
  ('e7151000-0000-0000-0000-00000000b001', 'admin-b@hub-s7-snooze.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e7151000-0000-0000-0000-00000000a001', 'admin-a@hub-s7-snooze.test', 'Admin A', 'e7151000-0000-0000-0000-0000000000a0'),
  ('e7151000-0000-0000-0000-00000000a002', 'editor-a@hub-s7-snooze.test', 'Editor A', 'e7151000-0000-0000-0000-0000000000a0'),
  ('e7151000-0000-0000-0000-00000000a003', 'author-a@hub-s7-snooze.test', 'Author A', 'e7151000-0000-0000-0000-0000000000a0'),
  ('e7151000-0000-0000-0000-00000000b001', 'admin-b@hub-s7-snooze.test', 'Admin B', 'e7151000-0000-0000-0000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e7151000-0000-0000-0000-00000000a001', 'admin', 'e7151000-0000-0000-0000-0000000000a0'),
  ('e7151000-0000-0000-0000-00000000a002', 'editor', 'e7151000-0000-0000-0000-0000000000a0'),
  ('e7151000-0000-0000-0000-00000000a003', 'author', 'e7151000-0000-0000-0000-0000000000a0'),
  ('e7151000-0000-0000-0000-00000000b001', 'admin', 'e7151000-0000-0000-0000-0000000000b0');
-- Wyciszenie wygasłe (zapis sprzed 30 dni, termin wczoraj) - odczyt go nie pokazuje.
INSERT INTO public.revenue_diagnostic_snoozes (tenant_id, check_id, scope_key, kind, until, created_by, created_at)
VALUES ('e7151000-0000-0000-0000-0000000000a0', 'coupons.expiring_unused', '*', 'days',
        now() - interval '1 day', 'e7151000-0000-0000-0000-00000000a001', now() - interval '30 days');

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON res TO authenticated;

-- ── 1. Granty ────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                   AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                   AND p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig))
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('admin_revenue_diagnostic_snooze', 'admin_revenue_diagnostic_unsnooze',
                        'admin_revenue_diagnostic_snoozes')),
  'acl: 3 RPC wyciszeń - authenticated i service_role, nigdy anon; SECURITY DEFINER + search_path');

-- ── 2. Tylko administrator wycisza ───────────────────────────────────────────
SELECT pg_temp.as_user('e7151000-0000-0000-0000-00000000a002');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.annual_discount_out_of_range', '*', 'days', now() + interval '7 days', NULL, NULL) $$,
  '42501', 'forbidden', 'rola: redaktor nie wycisza');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_unsnooze('catalog.annual_discount_out_of_range', '*') $$,
  '42501', 'forbidden', 'rola: redaktor nie zdejmuje wyciszenia');
INSERT INTO res SELECT 'editor_list_empty', public.admin_revenue_diagnostic_snoozes();
SELECT pg_temp.as_user('e7151000-0000-0000-0000-00000000a003');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snoozes() $$,
  '42501', 'forbidden', 'rola: autor nie czyta wyciszeń');

-- ── 3. Walidacja (22023, bez przycinania) ────────────────────────────────────
SELECT pg_temp.as_user('e7151000-0000-0000-0000-00000000a001');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.plan_without_tier', '*', 'days', now() + interval '181 days', NULL, NULL) $$,
  '22023', 'until_too_far', 'days: termin > 180 dni odrzucony');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.plan_without_tier', '*', 'days', now() - interval '1 hour', NULL, NULL) $$,
  '22023', 'until_invalid', 'days: termin w przeszłości odrzucony');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.plan_without_tier', '*', 'days', NULL, NULL, NULL) $$,
  '22023', 'until_invalid', 'days: brak terminu odrzucony');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.not_for_sale_still_visible', 'tier:team', 'intentional', NULL, 'Warstwa na zapytanie', NULL) $$,
  '22023', 'scope_hash_required', 'intentional: wymaga odcisku zakresu');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.not_for_sale_still_visible', 'tier:team', 'intentional', NULL, NULL, 'h:abc') $$,
  '22023', 'reason_required', 'intentional: wymaga powodu');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.not_for_sale_still_visible', 'tier:team', 'intentional', NULL, repeat('x', 501), 'h:abc') $$,
  '22023', 'reason_invalid', 'powód: 501 znaków odrzucony (nie przycięty)');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.not_for_sale_still_visible', 'tier:team', 'intentional', NULL, '  a  ', 'h:abc') $$,
  '22023', 'reason_invalid', 'powód: krótszy niż 3 znaki po btrim odrzucony');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('Catalog-Plan', '*', 'days', now() + interval '1 day', NULL, NULL) $$,
  '22023', 'check_id_invalid', 'check_id spoza wzorca obszar.nazwa odrzucony');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.plan_without_tier', repeat('k', 201), 'days', now() + interval '1 day', NULL, NULL) $$,
  '22023', 'scope_key_invalid', 'scope_key > 200 znaków odrzucony');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('catalog.plan_without_tier', '*', 'forever', now() + interval '1 day', NULL, NULL) $$,
  '22023', 'kind_invalid', 'kind spoza days|intentional odrzucony');

-- ── 4. Niewyciszalne ─────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('sync.emit_errors', '*', 'days', now() + interval '7 days', NULL, NULL) $$,
  '22023', 'not_snoozable', 'krytyczne sync.emit_errors niewyciszalne');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_diagnostic_snooze('data_quality.ledger_drift', '*', 'intentional', NULL, 'Wiemy o tym', 'h:1') $$,
  '22023', 'not_snoozable', 'krytyczne data_quality.ledger_drift niewyciszalne (także intentional)');

-- ── 5. Zapis, nadpisanie, odczyt ─────────────────────────────────────────────
INSERT INTO res SELECT 'days', public.admin_revenue_diagnostic_snooze(
  'catalog.annual_discount_out_of_range', '*', 'days', now() + interval '180 days', NULL, NULL);
INSERT INTO res SELECT 'intent', public.admin_revenue_diagnostic_snooze(
  'catalog.not_for_sale_still_visible', 'tier:team', 'intentional', NULL, 'Warstwa sprzedawana na zapytanie', 'h:team-1');
INSERT INTO res SELECT 'again', public.admin_revenue_diagnostic_snooze(
  'catalog.not_for_sale_still_visible', 'tier:team', 'intentional', NULL, 'Nowy powód wyciszenia', 'h:team-2');
INSERT INTO res SELECT 'list_admin', public.admin_revenue_diagnostic_snoozes();
SELECT pg_temp.as_user('e7151000-0000-0000-0000-00000000a002');
INSERT INTO res SELECT 'list_editor', public.admin_revenue_diagnostic_snoozes();
SELECT pg_temp.as_user('e7151000-0000-0000-0000-00000000b001');
INSERT INTO res SELECT 'list_b', public.admin_revenue_diagnostic_snoozes();
SELECT pg_temp.as_user('e7151000-0000-0000-0000-00000000a001');
INSERT INTO res SELECT 'unsnooze', public.admin_revenue_diagnostic_unsnooze('catalog.annual_discount_out_of_range', '*');
INSERT INTO res SELECT 'unsnooze_again', public.admin_revenue_diagnostic_unsnooze('catalog.annual_discount_out_of_range', '*');
INSERT INTO res SELECT 'list_after', public.admin_revenue_diagnostic_snoozes();
RESET ROLE;

SELECT ok(
  (SELECT r ->> 'kind' = 'days' AND (r ->> 'until')::timestamptz <= now() + interval '180 days' FROM res WHERE name = 'days'),
  'days: termin dokładnie 180 dni przyjęty');
SELECT is(
  (SELECT count(*)::int FROM public.revenue_diagnostic_snoozes
    WHERE tenant_id = 'e7151000-0000-0000-0000-0000000000a0' AND check_id = 'catalog.not_for_sale_still_visible'),
  1,
  'ponowne wyciszenie tego samego zakresu nadpisuje wiersz (ON CONFLICT)');
SELECT results_eq(
  $$ SELECT reason, scope_hash, created_by FROM public.revenue_diagnostic_snoozes
      WHERE tenant_id = 'e7151000-0000-0000-0000-0000000000a0' AND check_id = 'catalog.not_for_sale_still_visible' $$,
  $$ VALUES ('Nowy powód wyciszenia'::text, 'h:team-2'::text, 'e7151000-0000-0000-0000-00000000a001'::uuid) $$,
  'nadpisanie: nowy powód i odcisk, created_by = wołający admin');
SELECT is_empty(
  $$ SELECT 1 FROM public.revenue_diagnostic_snoozes WHERE reason LIKE 'xxx%' $$,
  'powód za długi nie zostawił w bazie przyciętego wiersza');
SELECT set_eq(
  $$ SELECT s ->> 'checkId' FROM res, jsonb_array_elements(r -> 'snoozes') s WHERE name = 'list_admin' $$,
  ARRAY['catalog.annual_discount_out_of_range', 'catalog.not_for_sale_still_visible'],
  'odczyt: aktywne wyciszenia (wygasłe days pominięte)');
SELECT ok(
  (SELECT r = (SELECT r FROM res WHERE name = 'list_admin') FROM res WHERE name = 'list_editor')
  AND (SELECT jsonb_array_length(r -> 'snoozes') = 0 FROM res WHERE name = 'list_b'),
  'odczyt: redaktor widzi te same wyciszenia, admin B nie widzi wyciszeń A');
SELECT ok(
  (SELECT (r ->> 'removed')::boolean FROM res WHERE name = 'unsnooze')
  AND NOT (SELECT (r ->> 'removed')::boolean FROM res WHERE name = 'unsnooze_again')
  AND (SELECT NOT bool_or(s ->> 'checkId' = 'catalog.annual_discount_out_of_range')
         FROM res, jsonb_array_elements(r -> 'snoozes') s WHERE name = 'list_after'),
  'unsnooze: zdejmuje wyciszenie; drugie wywołanie = removed false, bez błędu');

-- ── 6. Zdarzenie ─────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT payload ->> 'check_id', payload ->> 'op', aggregate_type, actor_id FROM public.domain_events
      WHERE event_type = 'revenue_diagnostic.snoozed.v1' AND tenant_id = 'e7151000-0000-0000-0000-0000000000a0'
      ORDER BY created_at, payload ->> 'check_id', payload ->> 'op' $$,
  $$ VALUES ('catalog.annual_discount_out_of_range'::text, 'snooze'::text, 'revenue_diagnostic'::text, 'e7151000-0000-0000-0000-00000000a001'::uuid),
            ('catalog.annual_discount_out_of_range'::text, 'unsnooze'::text, 'revenue_diagnostic'::text, 'e7151000-0000-0000-0000-00000000a001'::uuid),
            ('catalog.not_for_sale_still_visible'::text, 'snooze'::text, 'revenue_diagnostic'::text, 'e7151000-0000-0000-0000-00000000a001'::uuid),
            ('catalog.not_for_sale_still_visible'::text, 'snooze'::text, 'revenue_diagnostic'::text, 'e7151000-0000-0000-0000-00000000a001'::uuid) $$,
  'zdarzenie: revenue_diagnostic.snoozed.v1 przy każdym wyciszeniu i zdjęciu, aktor z sesji');
SELECT is_empty(
  $$ SELECT k FROM public.domain_events e, jsonb_object_keys(e.payload) k
      WHERE e.event_type = 'revenue_diagnostic.snoozed.v1' AND e.tenant_id = 'e7151000-0000-0000-0000-0000000000a0'
        AND k NOT IN ('check_id', 'scope_key', 'kind', 'until', 'op') $$,
  'zdarzenie: payload wyłącznie check_id, scope_key, kind, until, op (bez powodu)');
SELECT is((SELECT jsonb_array_length(r -> 'snoozes') FROM res WHERE name = 'editor_list_empty'), 0,
  'odczyt redaktora przed zapisem: pusta lista (wygasłe pominięte)');

SELECT * FROM finish();
ROLLBACK;
