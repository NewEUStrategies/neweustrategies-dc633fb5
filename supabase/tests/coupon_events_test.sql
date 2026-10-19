-- pgTAP: zdarzenia kuponów i przejścia statusu kampanii kuponowej (S1,
-- migracja 20261020100200).
--
-- CO PRZYPINA:
--   * 3 typy zdarzeń: `coupon.changed.v1`, `coupon_campaign.changed.v1`,
--     `coupon.redeemed.v1` - realne wiersze `domain_events` (agregat, id,
--     payload, aktor); payload bez kodu kuponu i bez adresów e-mail;
--   * UPDATE samego `metadata` (przypisanie kodu odbiorcy) i samego
--     `redemptions_count` NIE emituje; zmiana biznesowa - tak;
--   * D-S1-07: wygenerowanie 50 kodów kampanii w JEDNEJ transakcji
--     (`bulk_generate_coupons_for_campaign` jako zalogowany admin - ścieżka
--     SECURITY DEFINER działa mimo odebranych grantów) = dokładnie 1
--     `coupon.changed.v1` z `campaign_id`;
--   * RPC `admin_coupon_campaign_set_status`: przejścia panelu (archiwizacja,
--     przywrócenie do `generated` / `draft` wg liczby kodów), niedozwolone
--     przejście 22023, `p_status='sent'` -> 42501 dla admina i editora,
--     autor 42501, stary token 40001, kampania cudzego najemcy P0002,
--     `service_role` przechodzi `generated -> sent`;
--   * D-S1-06: bezpośredni `UPDATE … SET status` / `newsletter_campaign_id`
--     z przeglądarki -> 42501, zwykłe kolumny dalej zapisywalne; test
--     kompletności: kolumny z UPDATE dla authenticated = kolumny tabeli
--     minus 6 wyłączonych.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test coupon_events
BEGIN;
SELECT plan(37);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c3000000-0000-0000-0000-0000000000a0', 'hub-s1-cp-a', 'Hub S1 kupony A'),
  ('c3000000-0000-0000-0000-0000000000b0', 'hub-s1-cp-b', 'Hub S1 kupony B');

INSERT INTO auth.users (id, email) VALUES
  ('c3000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-cp.test'),
  ('c3000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-cp.test'),
  ('c3000000-0000-0000-0000-00000000a003', 'author-a@hub-s1-cp.test'),
  ('c3000000-0000-0000-0000-00000000a009', 'kupujacy-a@hub-s1-cp.test'),
  ('c3000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-cp.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c3000000-0000-0000-0000-00000000a001', 'admin-a@hub-s1-cp.test', 'Admin A', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000a002', 'editor-a@hub-s1-cp.test', 'Editor A', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000a003', 'author-a@hub-s1-cp.test', 'Author A', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000a009', 'kupujacy-a@hub-s1-cp.test', 'Kupujący A', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000b001', 'admin-b@hub-s1-cp.test', 'Admin B', 'c3000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c3000000-0000-0000-0000-00000000a001', 'admin', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000a002', 'editor', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000a003', 'author', 'c3000000-0000-0000-0000-0000000000a0'),
  ('c3000000-0000-0000-0000-00000000b001', 'admin', 'c3000000-0000-0000-0000-0000000000b0');

CREATE TEMP TABLE ev_seen (id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ev_take(p_type text) RETURNS SETOF public.domain_events LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH fresh AS (
    SELECT e.* FROM public.domain_events e
     WHERE e.event_type = p_type
       AND e.tenant_id IN ('c3000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000b0')
       AND NOT EXISTS (SELECT 1 FROM ev_seen s WHERE s.id = e.id)
  ), mark AS (
    INSERT INTO ev_seen (id) SELECT f.id FROM fresh f
  )
  SELECT * FROM fresh;
END;
$$;
CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

SELECT pg_temp.as_user('c3000000-0000-0000-0000-00000000a001');

-- ── 1. Kupon ręczny ──────────────────────────────────────────────────────────
INSERT INTO public.b2b_coupons (id, tenant_id, code, discount_kind, discount_percent)
VALUES ('c3000000-0000-0000-0000-0000000001a1', 'c3000000-0000-0000-0000-0000000000a0', 'TAJNY-KOD-77', 'percent', 20);
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload, actor_id FROM pg_temp.ev_take('coupon.changed.v1') $$,
  $$ VALUES ('coupon', 'c3000000-0000-0000-0000-0000000001a1',
             '{"coupon_id":"c3000000-0000-0000-0000-0000000001a1","op":"insert","source":"manual"}'::jsonb,
             'c3000000-0000-0000-0000-00000000a001'::uuid) $$,
  'kupon ręczny: INSERT -> coupon.changed.v1 {coupon_id, op, source=manual}, aktor z sesji');

UPDATE public.b2b_coupons SET metadata = metadata || '{"assigned_subscriber_id":"x"}'
 WHERE id = 'c3000000-0000-0000-0000-0000000001a1';
SELECT is_empty($$ SELECT 1 FROM pg_temp.ev_take('coupon.changed.v1') $$,
  'kupon: zmiana samego metadata (przypisanie kodu) NIE emituje');
UPDATE public.b2b_coupons SET redemptions_count = redemptions_count + 1
 WHERE id = 'c3000000-0000-0000-0000-0000000001a1';
SELECT is_empty($$ SELECT 1 FROM pg_temp.ev_take('coupon.changed.v1') $$,
  'kupon: zmiana samego licznika realizacji NIE emituje (ma własne zdarzenie)');
UPDATE public.b2b_coupons SET active = false WHERE id = 'c3000000-0000-0000-0000-0000000001a1';
SELECT results_eq(
  $$ SELECT payload->>'op' FROM pg_temp.ev_take('coupon.changed.v1') $$,
  $$ VALUES ('update') $$,
  'kupon: zmiana biznesowa (dezaktywacja) emituje update');

INSERT INTO public.b2b_coupons (id, tenant_id, code, discount_kind, discount_percent, metadata)
VALUES ('c3000000-0000-0000-0000-0000000001a2', 'c3000000-0000-0000-0000-0000000000a0', 'RETENCJA-55', 'percent', 30,
        '{"source":"retention"}');
SELECT results_eq(
  $$ SELECT payload->>'source' FROM pg_temp.ev_take('coupon.changed.v1') $$,
  $$ VALUES ('retention') $$,
  'kupon: source z metadata.source (np. kupon retencyjny)');

-- ── 2. Kampania + generacja 50 kodów w jednej transakcji ────────────────────
INSERT INTO public.b2b_coupon_campaigns (id, tenant_id, name, code_count, discount_kind, discount_percent, newsletter_segment)
VALUES ('c3000000-0000-0000-0000-0000000002a1', 'c3000000-0000-0000-0000-0000000000a0', 'Jesień', 50, 'percent', 15, 'ekonomia');
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload FROM pg_temp.ev_take('coupon_campaign.changed.v1') $$,
  $$ VALUES ('coupon_campaign', 'c3000000-0000-0000-0000-0000000002a1',
             '{"campaign_id":"c3000000-0000-0000-0000-0000000002a1","status":"draft","op":"insert"}'::jsonb) $$,
  'kampania: INSERT -> coupon_campaign.changed.v1 {campaign_id, status, op}');

SET LOCAL ROLE authenticated;
SELECT is(
  public.bulk_generate_coupons_for_campaign('c3000000-0000-0000-0000-0000000002a1'),
  50,
  'generacja: admin generuje 50 kodów (SECURITY DEFINER mimo odebranego UPDATE status)');
RESET ROLE;
SELECT is(
  (SELECT status FROM public.b2b_coupon_campaigns WHERE id = 'c3000000-0000-0000-0000-0000000002a1'),
  'generated', 'generacja: kampania przeszła w generated');
SELECT results_eq(
  $$ SELECT count(*)::int, min(payload->>'campaign_id'), min(payload->>'op'), min(payload->>'source')
       FROM pg_temp.ev_take('coupon.changed.v1') $$,
  $$ VALUES (1, 'c3000000-0000-0000-0000-0000000002a1', 'insert', 'campaign') $$,
  'D-S1-07: 50 kodów kampanii w jednej transakcji = DOKŁADNIE 1 coupon.changed.v1 z campaign_id');
SELECT results_eq(
  $$ SELECT payload->>'status' FROM pg_temp.ev_take('coupon_campaign.changed.v1') $$,
  $$ VALUES ('generated') $$,
  'kampania: przejście w generated emituje raz');
SELECT is_empty(
  $$ SELECT e.id FROM public.domain_events e
      JOIN public.b2b_coupons c ON c.tenant_id = e.tenant_id
     WHERE e.event_type LIKE 'coupon%'
       AND e.tenant_id = 'c3000000-0000-0000-0000-0000000000a0'
       AND (position(c.code IN e.payload::text) > 0 OR position('@' IN e.payload::text) > 0
            OR e.payload ? 'code' OR e.payload ? 'email') $$,
  'payload: żadne zdarzenie kuponu nie niesie kodu ani adresu e-mail');

-- ── 3. Realizacja ────────────────────────────────────────────────────────────
INSERT INTO public.b2b_coupon_redemptions (id, tenant_id, coupon_id, user_id, applied_cents, original_cents, currency)
VALUES ('c3000000-0000-0000-0000-0000000003a1', 'c3000000-0000-0000-0000-0000000000a0',
        'c3000000-0000-0000-0000-0000000001a2', 'c3000000-0000-0000-0000-00000000a009', 3000, 10000, 'PLN');
SELECT results_eq(
  $$ SELECT aggregate_type, aggregate_id, payload, actor_id FROM pg_temp.ev_take('coupon.redeemed.v1') $$,
  $$ VALUES ('coupon', 'c3000000-0000-0000-0000-0000000001a2',
             '{"coupon_id":"c3000000-0000-0000-0000-0000000001a2","redemption_id":"c3000000-0000-0000-0000-0000000003a1","order_id":null}'::jsonb,
             'c3000000-0000-0000-0000-00000000a009'::uuid) $$,
  'realizacja: coupon.redeemed.v1, agregat = kupon, aktor = użytkownik realizacji');

-- ── 4. RPC przejść statusu ───────────────────────────────────────────────────
-- Cała transakcja testu ma jedno now(): bieżący token = updated_at wiersza,
-- „stary" token = dowolna inna wartość.
CREATE FUNCTION pg_temp.tok(p_id uuid) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT updated_at FROM public.b2b_coupon_campaigns WHERE id = p_id
$$;

SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_coupon_campaign_set_status(uuid, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_coupon_campaign_set_status(uuid, text, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.admin_coupon_campaign_set_status(uuid, text, timestamptz)', 'EXECUTE'),
  'acl: RPC statusu dla authenticated i service_role, nie dla anon');

SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'sent',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  '42501', 'status_sent_server_only', 'sent: admin nie ustawia sent (42501)');
SELECT pg_temp.as_user('c3000000-0000-0000-0000-00000000a002');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'sent',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  '42501', 'status_sent_server_only', 'sent: editor nie ustawia sent (42501)');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'archived',
       '2026-01-01 10:00:00+00') $$,
  '40001', 'stale_write', 'cas: stary token -> 40001 stale_write');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'archived', NULL) $$,
  '40001', 'stale_write', 'cas: brak tokenu -> 40001 (zapis bez wersji jest zapisem w ciemno)');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'wyslana',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  '22023', 'invalid_status', 'walidacja: nieznany status -> 22023');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'draft',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  '22023', 'invalid_transition:generated->draft', 'przejścia: generated -> draft niedozwolone');

SELECT is(
  public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'archived',
    pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) ->> 'status',
  'archived', 'przejścia: editor archiwizuje kampanię generated');
SELECT results_eq(
  $$ SELECT payload->>'status', actor_id FROM pg_temp.ev_take('coupon_campaign.changed.v1') $$,
  $$ VALUES ('archived', 'c3000000-0000-0000-0000-00000000a002'::uuid) $$,
  'przejścia: archiwizacja emituje zdarzenie z aktorem editora');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'draft',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  '22023', 'invalid_transition:archived->draft',
  'przejścia: archiwum z kodami nie wraca do draft');
SELECT is(
  public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'generated',
    pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) ->> 'status',
  'generated', 'przejścia: archiwum z kodami wraca do generated');

INSERT INTO public.b2b_coupon_campaigns (id, tenant_id, name, code_count, discount_kind, discount_percent, status)
VALUES ('c3000000-0000-0000-0000-0000000002a2', 'c3000000-0000-0000-0000-0000000000a0', 'Pusta', 5, 'percent', 10, 'archived');
SELECT is(
  public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a2', 'draft',
    pg_temp.tok('c3000000-0000-0000-0000-0000000002a2')) ->> 'status',
  'draft', 'przejścia: archiwum bez kodów wraca do draft');
SELECT is(
  public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a2', 'draft',
    pg_temp.tok('c3000000-0000-0000-0000-0000000002a2')) ->> 'status',
  'draft', 'przejścia: ten sam status = no-op bez błędu');

SELECT pg_temp.as_user('c3000000-0000-0000-0000-00000000a003');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'archived',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  '42501', 'forbidden', 'role: autor -> 42501');
SELECT pg_temp.as_user('c3000000-0000-0000-0000-00000000b001');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'archived',
       pg_temp.tok('c3000000-0000-0000-0000-0000000002a1')) $$,
  'P0002', 'campaign_not_found', 'izolacja: admin B nie widzi kampanii najemcy A (P0002)');
SELECT is(
  (SELECT status FROM public.b2b_coupon_campaigns WHERE id = 'c3000000-0000-0000-0000-0000000002a1'),
  'generated', 'izolacja: odrzucone wywołania nie zmieniły statusu');

-- ── 5. Granty kolumnowe (D-S1-06) ────────────────────────────────────────────
SELECT pg_temp.as_user('c3000000-0000-0000-0000-00000000a001');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.b2b_coupon_campaigns SET status = 'sent' WHERE id = 'c3000000-0000-0000-0000-0000000002a1' $$,
  '42501', NULL, 'granty: bezpośredni UPDATE status z przeglądarki -> 42501');
SELECT throws_ok(
  $$ UPDATE public.b2b_coupon_campaigns SET newsletter_campaign_id = NULL WHERE id = 'c3000000-0000-0000-0000-0000000002a1' $$,
  '42501', NULL, 'granty: bezpośredni UPDATE newsletter_campaign_id -> 42501');
SELECT lives_ok(
  $$ UPDATE public.b2b_coupon_campaigns SET description = 'Opis z panelu' WHERE id = 'c3000000-0000-0000-0000-0000000002a1' $$,
  'granty: zwykłe kolumny dalej zapisywalne z panelu (RLS admina)');
RESET ROLE;
SELECT is(
  (SELECT description FROM public.b2b_coupon_campaigns WHERE id = 'c3000000-0000-0000-0000-0000000002a1'),
  'Opis z panelu', 'granty: zapis opisu doszedł do wiersza');
SELECT set_eq(
  $$ SELECT a.attname::text FROM pg_attribute a
      WHERE a.attrelid = 'public.b2b_coupon_campaigns'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('authenticated', 'public.b2b_coupon_campaigns', a.attname, 'UPDATE') $$,
  $$ SELECT a.attname::text FROM pg_attribute a
      WHERE a.attrelid = 'public.b2b_coupon_campaigns'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname NOT IN ('status', 'newsletter_campaign_id', 'id', 'tenant_id', 'created_at', 'created_by') $$,
  'granty: kompletność - UPDATE dla authenticated = kolumny tabeli minus 6 wyłączonych (nowa kolumna = dopisać grant)');

-- ── 6. Serwer (service_role) ustawia sent ───────────────────────────────────
SET LOCAL ROLE service_role;
SELECT is(
  public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'sent',
    (SELECT updated_at FROM public.b2b_coupon_campaigns WHERE id = 'c3000000-0000-0000-0000-0000000002a1')) ->> 'status',
  'sent', 'serwer: service_role przechodzi generated -> sent');
SELECT lives_ok(
  $$ UPDATE public.b2b_coupon_campaigns SET status = 'sent' WHERE id = 'c3000000-0000-0000-0000-0000000002a2' $$,
  'serwer: service_role zachowuje bezpośredni UPDATE statusu (serwer wysyłki)');
SELECT throws_ok(
  $$ SELECT public.admin_coupon_campaign_set_status('c3000000-0000-0000-0000-0000000002a1', 'archived',
       (SELECT updated_at FROM public.b2b_coupon_campaigns WHERE id = 'c3000000-0000-0000-0000-0000000002a1')) $$,
  '22023', 'invalid_transition:sent->archived',
  'serwer: service_role ma wyłącznie przejście generated -> sent');
RESET ROLE;

SELECT is_empty(
  $$ SELECT 1 FROM public.domain_event_emit_errors
      WHERE source IN ('tg_b2b_coupons_emit', 'tg_b2b_coupon_campaigns_emit', 'tg_b2b_coupon_redemptions_emit')
        AND tenant_id IN ('c3000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000b0') $$,
  'zdrowa szyna: emitery kuponów bez śladów awarii');

SELECT * FROM finish();
ROLLBACK;
