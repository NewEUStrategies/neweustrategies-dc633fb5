-- pgTAP: agregaty lejka i inwentarza dostępu (S3, migracja 20261020120400).
--
-- CO PRZYPINA:
--   * dwóch najemców - zamówienia, konta i reguły najemcy B nie wpływają na
--     wynik najemcy A (najemca WYŁĄCZNIE z sesji);
--   * CCR + CAR = 100 % na TEJ SAMEJ populacji (kohorta zamówień z okna;
--     sandbox, mock i bilety wydarzeń poza populacją);
--   * liczniki lejka na fixture: konta, aktywne, PHR, PSCR, R2P, pierwsze
--     płatności, źródła rejestracji, powody uderzeń;
--   * editor dostaje `NULL` w kwotach (`paid_amount`), admin - kwoty per
--     waluta; autor = 42501; złe okno, segment i tor = 22023;
--   * segment zawęża liczniki zakupów (plan warstwy `member` = b2c_individual);
--   * tor `sales` z historii etapów cyklu życia, zadania BEZ anulowanych (D11);
--   * kształt jsonb (`-- rpc-shape: admin_revenue_funnel`) - komplet kluczy;
--   * inwentarz = liczności `content_access` per typ × tryb × `min_tier_rank`
--     × polityka; P14 policzone (`tier_without_offer`, `paid_without_offer`),
--     plany spoza sprzedaży, P19 (`metered_tier_gated`);
--   * granty: anon bez EXECUTE, `_funnel_counts` bez EXECUTE dla ról API.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test revenue_funnel_access
BEGIN;
SELECT plan(27);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c3400000-0000-0000-0000-0000000000a0', 'hub-s3-fun-a', 'Hub S3 lejek A'),
  ('c3400000-0000-0000-0000-0000000000b0', 'hub-s3-fun-b', 'Hub S3 lejek B');
SELECT public.seed_membership_tiers('c3400000-0000-0000-0000-0000000000a0');
UPDATE public.membership_tiers SET pricing_visible = true
 WHERE tenant_id = 'c3400000-0000-0000-0000-0000000000a0' AND key = 'supporter';
-- Seed zakłada też plany katalogu - inwentarz ma liczyć ofertę z TEGO
-- fixture'u (trzy plany niżej), więc plany seeda znikają.
DELETE FROM public.access_plans WHERE tenant_id = 'c3400000-0000-0000-0000-0000000000a0';

-- Staff (konta sprzed okna) i czytelnicy.
INSERT INTO auth.users (id, email, raw_user_meta_data, last_sign_in_at) VALUES
  ('c3400000-0000-0000-0000-00000000a0a1', 'admin@hub-s3-fun.test', NULL, NULL),
  ('c3400000-0000-0000-0000-00000000a0e1', 'editor@hub-s3-fun.test', NULL, NULL),
  ('c3400000-0000-0000-0000-00000000a0c1', 'author@hub-s3-fun.test', NULL, NULL),
  ('c3400000-0000-0000-0000-00000000a001', 'r1@hub-s3-fun.test', '{"signup_source":"paywall"}', now()),
  ('c3400000-0000-0000-0000-00000000a002', 'r2@hub-s3-fun.test', '{"signup_source":"popup"}', NULL),
  ('c3400000-0000-0000-0000-00000000a003', 'r3@hub-s3-fun.test', '{"signup_source":"popup"}', NULL),
  ('c3400000-0000-0000-0000-00000000a004', 'r4@hub-s3-fun.test', NULL, now()),
  ('c3400000-0000-0000-0000-00000000b001', 'rb@hub-s3-fun.test', '{"signup_source":"popup"}', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id, created_at) VALUES
  ('c3400000-0000-0000-0000-00000000a0a1', 'admin@hub-s3-fun.test', 'Admin', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '200 days'),
  ('c3400000-0000-0000-0000-00000000a0e1', 'editor@hub-s3-fun.test', 'Editor', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '200 days'),
  ('c3400000-0000-0000-0000-00000000a0c1', 'author@hub-s3-fun.test', 'Author', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '200 days'),
  ('c3400000-0000-0000-0000-00000000a001', 'r1@hub-s3-fun.test', 'R1', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '2 days'),
  ('c3400000-0000-0000-0000-00000000a002', 'r2@hub-s3-fun.test', 'R2', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '2 days'),
  ('c3400000-0000-0000-0000-00000000a003', 'r3@hub-s3-fun.test', 'R3', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '2 days'),
  ('c3400000-0000-0000-0000-00000000a004', 'r4@hub-s3-fun.test', 'R4', 'c3400000-0000-0000-0000-0000000000a0', now() - interval '100 days'),
  ('c3400000-0000-0000-0000-00000000b001', 'rb@hub-s3-fun.test', 'RB', 'c3400000-0000-0000-0000-0000000000b0', now() - interval '2 days');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c3400000-0000-0000-0000-00000000a0a1', 'admin', 'c3400000-0000-0000-0000-0000000000a0'),
  ('c3400000-0000-0000-0000-00000000a0e1', 'editor', 'c3400000-0000-0000-0000-0000000000a0'),
  ('c3400000-0000-0000-0000-00000000a0c1', 'author', 'c3400000-0000-0000-0000-0000000000a0');

INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, active, tier_key, for_sale) VALUES
  ('c3400000-0000-0000-0000-0000000000c1', 'c3400000-0000-0000-0000-0000000000a0', 'Członek', 'Member', 4900, 'PLN', 'month', true, 'member', true),
  ('c3400000-0000-0000-0000-0000000000c2', 'c3400000-0000-0000-0000-0000000000a0', 'Wspierający', 'Supporter', 1500, 'PLN', 'month', true, 'supporter', true),
  ('c3400000-0000-0000-0000-0000000000c3', 'c3400000-0000-0000-0000-0000000000a0', 'Stary', 'Old', 9900, 'PLN', 'month', false, 'member', true);

-- Uderzenia w paywall (R1 i R4) + gość; najemca B osobno.
INSERT INTO public.paywall_hits (tenant_id, day, user_id, visitor_hash, entity_type, entity_id, reason, hits, first_at, last_at) VALUES
  ('c3400000-0000-0000-0000-0000000000a0', (now() AT TIME ZONE 'UTC')::date - 1, 'c3400000-0000-0000-0000-00000000a001', NULL,
   'post', 'c3400000-0000-0000-0000-0000000000e1', 'paid', 3, now() - interval '1 day', now() - interval '1 day'),
  ('c3400000-0000-0000-0000-0000000000a0', (now() AT TIME ZONE 'UTC')::date, 'c3400000-0000-0000-0000-00000000a004', NULL,
   'post', 'c3400000-0000-0000-0000-0000000000e4', 'tier_rank', 1, now() - interval '1 hour', now() - interval '1 hour'),
  ('c3400000-0000-0000-0000-0000000000a0', (now() AT TIME ZONE 'UTC')::date, NULL, repeat('cd', 16),
   'post', 'c3400000-0000-0000-0000-0000000000e1', 'registration', 2, now() - interval '1 hour', now() - interval '1 hour'),
  ('c3400000-0000-0000-0000-0000000000b0', (now() AT TIME ZONE 'UTC')::date, 'c3400000-0000-0000-0000-00000000b001', NULL,
   'post', 'c3400000-0000-0000-0000-0000000000f1', 'paid', 5, now() - interval '1 hour', now() - interval '1 hour');

-- Kohorta kasy: R1 zapłacił PO uderzeniu, R2 nieudana, R3 wygasła sesja,
-- R4 w toku; poza populacją: sandbox, mock, bilet wydarzenia; najemca B.
SET LOCAL ROLE service_role;
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, plan_id,
                                   provider, environment, paid_at, metadata, created_at) VALUES
  ('c3400000-0000-0000-0000-0000000000f1', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a001',
   'subscription', 'paid', 4900, 'PLN', 'c3400000-0000-0000-0000-0000000000c1', 'stripe', 'live', now() - interval '12 hours',
   '{}', now() - interval '13 hours'),
  ('c3400000-0000-0000-0000-0000000000f2', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a002',
   'one_time', 'failed', 1900, 'PLN', NULL, 'stripe', 'live', NULL, '{}', now() - interval '10 hours'),
  ('c3400000-0000-0000-0000-0000000000f3', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a003',
   'one_time', 'canceled', 1900, 'PLN', NULL, 'stripe', 'live', NULL, '{"cancel_reason":"session_expired"}', now() - interval '9 hours'),
  ('c3400000-0000-0000-0000-0000000000f4', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a004',
   'subscription', 'pending', 1500, 'PLN', 'c3400000-0000-0000-0000-0000000000c2', 'stripe', 'live', NULL, '{}', now() - interval '1 hour'),
  ('c3400000-0000-0000-0000-0000000000f5', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a002',
   'one_time', 'paid', 1900, 'PLN', NULL, 'stripe', 'sandbox', now(), '{}', now() - interval '1 hour'),
  ('c3400000-0000-0000-0000-0000000000f6', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a002',
   'one_time', 'paid', 1900, 'PLN', NULL, 'mock', 'live', now(), '{}', now() - interval '1 hour'),
  ('c3400000-0000-0000-0000-0000000000f7', 'c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-00000000a003',
   'one_time', 'paid', 9000, 'PLN', NULL, 'stripe', 'live', now(), '{"event_id":"c3400000-0000-0000-0000-0000000000ee"}', now() - interval '1 hour'),
  ('c3400000-0000-0000-0000-0000000000f8', 'c3400000-0000-0000-0000-0000000000b0', 'c3400000-0000-0000-0000-00000000b001',
   'one_time', 'paid', 2500, 'EUR', NULL, 'stripe', 'live', now(), '{}', now() - interval '1 hour');
RESET ROLE;

-- Tor sprzedaży: dwa leady, historia cyklu życia i zadania (w tym anulowane).
INSERT INTO public.crm_leads (id, tenant_id, email_norm, email) VALUES
  ('c3400000-0000-0000-0000-0000000000a5', 'c3400000-0000-0000-0000-0000000000a0', 'l1@hub-s3-fun.test', 'l1@hub-s3-fun.test'),
  ('c3400000-0000-0000-0000-0000000000a6', 'c3400000-0000-0000-0000-0000000000a0', 'l2@hub-s3-fun.test', 'l2@hub-s3-fun.test');
INSERT INTO public.crm_lead_stage_history (tenant_id, lead_id, dimension, from_value, to_value, source, changed_at) VALUES
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a5', 'lifecycle', 'subscriber', 'lead', 'manual', now() - interval '3 days'),
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a5', 'lifecycle', 'lead', 'mql', 'manual', now() - interval '2 days'),
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a6', 'lifecycle', 'opportunity', 'customer', 'billing', now() - interval '1 day'),
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a6', 'crm_stage', 'new', 'won', 'manual', now() - interval '1 day');
INSERT INTO public.crm_tasks (tenant_id, lead_id, title, due_at, status, completed_at) VALUES
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a5', 'Oddzwoń', now() + interval '1 day', 'open', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a5', 'Zaległe', now() - interval '1 day', 'open', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a6', 'Anulowane', now() - interval '1 day', 'cancelled', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'c3400000-0000-0000-0000-0000000000a6', 'Zrobione', now() - interval '1 day', 'done', now() - interval '1 day');

-- Reguły dostępu najemcy A (inwentarz) + jedna najemcy B.
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, min_tier_rank, metering_policy, one_time_price_cents) VALUES
  ('c3400000-0000-0000-0000-0000000000a0', 'post', 'c3400000-0000-0000-0000-0000000000e1', 'paid', '{}', 0, 'inherit', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'post', 'c3400000-0000-0000-0000-0000000000e2', 'paid', '{}', 0, 'inherit', 1900),
  ('c3400000-0000-0000-0000-0000000000a0', 'page', 'c3400000-0000-0000-0000-0000000000e3', 'paid', '{c3400000-0000-0000-0000-0000000000c2}', 0, 'exempt', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'post', 'c3400000-0000-0000-0000-0000000000e4', 'members', '{}', 20, 'inherit', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'post', 'c3400000-0000-0000-0000-0000000000e5', 'paid', '{c3400000-0000-0000-0000-0000000000c3}', 0, 'inherit', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'post', 'c3400000-0000-0000-0000-0000000000e6', 'password', '{}', 0, 'inherit', NULL),
  ('c3400000-0000-0000-0000-0000000000a0', 'post', 'c3400000-0000-0000-0000-0000000000e7', 'public', '{}', 0, 'inherit', NULL),
  ('c3400000-0000-0000-0000-0000000000b0', 'post', 'c3400000-0000-0000-0000-0000000000f1', 'paid', '{}', 0, 'inherit', NULL);

-- Wyniki odczytu staffu zapisujemy do tabel tymczasowych (czytelne asercje).
CREATE TEMP TABLE fun_admin (j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE fun_editor (j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE fun_segment (j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE inv_editor (j jsonb) ON COMMIT DROP;
CREATE TEMP TABLE inv_no_premium (j jsonb) ON COMMIT DROP;
GRANT INSERT, SELECT ON fun_admin, fun_editor, fun_segment, inv_editor, inv_no_premium TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3400000-0000-0000-0000-00000000a0a1","role":"authenticated"}', true);
INSERT INTO fun_admin SELECT public.admin_revenue_funnel(now() - interval '30 days', now() + interval '1 day', 'all', 'all');
INSERT INTO fun_segment SELECT public.admin_revenue_funnel(now() - interval '30 days', now() + interval '1 day', 'b2c_individual', 'self_serve');

SELECT set_config('request.jwt.claims',
  '{"sub":"c3400000-0000-0000-0000-00000000a0e1","role":"authenticated"}', true);
INSERT INTO fun_editor SELECT public.admin_revenue_funnel(now() - interval '30 days', now() + interval '1 day', 'all', 'all');
INSERT INTO inv_editor SELECT public.admin_revenue_access_inventory();

-- 1-4. Odmowy i walidacja.
SELECT throws_ok(
  $$ SELECT public.admin_revenue_funnel(now() + interval '1 day', now(), 'all', 'all') $$,
  '22023', NULL, 'okno odwrócone -> 22023');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_funnel(now() - interval '500 days', now(), 'all', 'all') $$,
  '22023', NULL, 'okno dłuższe niż 400 dni -> 22023');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_funnel(now() - interval '30 days', now(), 'vip', 'all') $$,
  '22023', NULL, 'segment spoza dziedziny -> 22023');

SELECT set_config('request.jwt.claims',
  '{"sub":"c3400000-0000-0000-0000-00000000a0c1","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.admin_revenue_funnel(now() - interval '30 days', now(), 'all', 'all') $$,
  '42501', NULL, 'autor nie czyta lejka (42501)');
SELECT throws_ok(
  $$ SELECT public.admin_revenue_access_inventory() $$,
  '42501', NULL, 'autor nie czyta inwentarza (42501)');
RESET ROLE;

-- 6. Kształt jsonb (rpc-shape): komplet kluczy toru `all`.
SELECT set_eq(
  $$ SELECT jsonb_object_keys(j) FROM fun_admin $$,
  ARRAY['since', 'until', 'segment', 'track', 'amounts_visible',
        'accounts', 'active_accounts', 'paywall_hit_accounts', 'paywall_hit_visitors', 'paywall_hits',
        'paywall_converted_accounts', 'checkout_started', 'checkout_paid', 'checkout_abandoned',
        'checkout_expired', 'first_payments', 'registered_paid', 'signup_form_views',
        'signup_form_submits', 'visitors_first_party', 'registered_to_paid_rate',
        'paywall_conversion_rate', 'paywall_hit_rate', 'checkout_conversion_rate',
        'checkout_abandonment_rate', 'coupon_redemption_rate', 'paid_amount', 'signup_sources',
        'paywall_reasons', 'paywall_data_since', 'sales'],
  'kształt admin_revenue_funnel (rpc-shape) - komplet kluczy toru all');

-- 7. Kohorta kasy: 4 zamówienia live (sandbox, mock, bilet i najemca B poza).
SELECT results_eq(
  $$ SELECT (j ->> 'checkout_started')::int, (j ->> 'checkout_paid')::int, (j ->> 'checkout_abandoned')::int,
            (j ->> 'checkout_expired')::int FROM fun_admin $$,
  $$ VALUES (4, 1, 3, 1) $$,
  'kasa: started 4, paid 1, abandoned 3 (= started - paid), wygasłe 1');

-- 8. CCR + CAR = 100 % na tej samej populacji.
SELECT results_eq(
  $$ SELECT (j ->> 'checkout_conversion_rate')::numeric, (j ->> 'checkout_abandonment_rate')::numeric,
            (j ->> 'checkout_conversion_rate')::numeric + (j ->> 'checkout_abandonment_rate')::numeric
       FROM fun_admin $$,
  $$ VALUES (0.25::numeric, 0.75::numeric, 1::numeric) $$,
  'CCR 25 % + CAR 75 % = 100 % (ta sama kohorta)');

-- 9-11. Konta, aktywność, paywall.
SELECT results_eq(
  $$ SELECT (j ->> 'accounts')::int, (j ->> 'active_accounts')::int, (j ->> 'paywall_hit_accounts')::int,
            (j ->> 'paywall_hit_visitors')::int, (j ->> 'paywall_hits')::int FROM fun_admin $$,
  $$ VALUES (3, 4, 2, 1, 6) $$,
  'konta z okna 3, aktywne 4 (3 nowe + R4 zalogowany), uderzenia: 2 konta, 1 gość, 6 trafień');
SELECT results_eq(
  $$ SELECT (j ->> 'paywall_converted_accounts')::int, (j ->> 'paywall_conversion_rate')::numeric,
            (j ->> 'paywall_hit_rate')::numeric FROM fun_admin $$,
  $$ VALUES (1, 0.5::numeric, 0.5::numeric) $$,
  'PSCR = 1/2 (R1 zapłacił po uderzeniu), PHR = 2/4 aktywnych');
SELECT results_eq(
  $$ SELECT (j ->> 'registered_paid')::int, (j ->> 'registered_to_paid_rate')::numeric,
            (j ->> 'first_payments')::int FROM fun_admin $$,
  $$ VALUES (1, 0.333333::numeric, 1) $$,
  'R2P = 1/3 kont z okna; jedna pierwsza płatność');

-- 12. Źródła rejestracji i powody uderzeń.
SELECT results_eq(
  $$ SELECT j -> 'signup_sources', j -> 'paywall_reasons' FROM fun_admin $$,
  $$ VALUES ('[{"source":"popup","accounts":2},{"source":"paywall","accounts":1}]'::jsonb,
             '[{"reason":"paid","accounts":1,"visitors":0,"hits":3},{"reason":"registration","accounts":0,"visitors":1,"hits":2},{"reason":"tier_rank","accounts":1,"visitors":0,"hits":1}]'::jsonb) $$,
  'źródła rejestracji z białej listy i powody uderzeń z okna');

-- 13-14. Kwoty: admin per waluta, editor NULL (nie zero).
SELECT results_eq(
  $$ SELECT j -> 'paid_amount', (j ->> 'amounts_visible')::boolean FROM fun_admin $$,
  $$ VALUES ('[{"currency":"PLN","amount_minor":4900}]'::jsonb, true) $$,
  'admin: kwoty opłaconej kohorty per waluta');
SELECT results_eq(
  $$ SELECT j -> 'paid_amount' = 'null'::jsonb, (j ->> 'amounts_visible')::boolean,
            (j ->> 'checkout_started')::int FROM fun_editor $$,
  $$ VALUES (true, false, 4) $$,
  'editor: paid_amount = NULL, liczniki te same co u admina');

-- 15. Segment: plan warstwy member (b2c_individual) zawęża liczniki zakupów.
SELECT results_eq(
  $$ SELECT (j ->> 'checkout_started')::int, (j ->> 'checkout_paid')::int, (j ->> 'accounts')::int,
            j -> 'sales' = 'null'::jsonb FROM fun_segment $$,
  $$ VALUES (1, 1, 3, true) $$,
  'segment b2c_individual: 1 zamówienie member, mianownik kont cały, tor self_serve bez sprzedaży');

-- 16. Tor sprzedaży: etapy z historii cyklu życia, zadania bez anulowanych (D11).
SELECT results_eq(
  $$ SELECT j -> 'sales' FROM fun_admin $$,
  $$ VALUES ('{"stages":[{"stage":"lead","leads":1},{"stage":"mql","leads":1},{"stage":"sql","leads":0},{"stage":"opportunity","leads":0},{"stage":"customer","leads":1}],"open_tasks":2,"overdue_tasks":1,"done_tasks":1}'::jsonb) $$,
  'tor sales: etapy z historii lifecycle, zadania otwarte/zaległe/zrobione bez anulowanych');

-- 17. Izolacja: najemca B (zamówienie EUR, uderzenie 5) nie przeciekł.
SELECT is_empty(
  $$ SELECT 1 FROM fun_admin
      WHERE j::text LIKE '%EUR%' OR (j ->> 'paywall_hits')::int <> 6 $$,
  'najemca B nie wpływa na lejek najemcy A');

-- 18-22. Inwentarz dostępu (editor - bez kwot, pełny).
SELECT results_eq(
  $$ SELECT (j ->> 'total')::int, j -> 'by_mode' FROM inv_editor $$,
  $$ VALUES (7, '{"public":1,"members":1,"paid":4,"password":1}'::jsonb) $$,
  'inwentarz: 7 reguł najemcy A, sumy per tryb');
SELECT results_eq(
  $$ SELECT j -> 'rows' FROM inv_editor $$,
  $$ VALUES ('[
       {"entity_type":"page","mode":"paid","min_tier_rank":0,"metering_policy":"exempt","count":1},
       {"entity_type":"post","mode":"members","min_tier_rank":20,"metering_policy":"inherit","count":1},
       {"entity_type":"post","mode":"paid","min_tier_rank":0,"metering_policy":"inherit","count":3},
       {"entity_type":"post","mode":"password","min_tier_rank":0,"metering_policy":"inherit","count":1},
       {"entity_type":"post","mode":"public","min_tier_rank":0,"metering_policy":"inherit","count":1}
     ]'::jsonb) $$,
  'inwentarz = liczności content_access per typ × tryb × min_tier_rank × polityka');
SELECT results_eq(
  $$ SELECT j -> 'dead_ends' FROM inv_editor $$,
  $$ VALUES ('{"tier_without_offer":1,"paid_without_offer":0,"dangling_plans":1,"metered_tier_gated":1}'::jsonb) $$,
  'P14: próg Pro bez planu w sprzedaży = 1; treść płatna kupowalna planem z premium_content; plan spoza sprzedaży 1; P19 1');

-- Plan Członka wycofany ze sprzedaży: treść płatna bez progu traci ofertę.
UPDATE public.access_plans SET for_sale = false WHERE id = 'c3400000-0000-0000-0000-0000000000c1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"c3400000-0000-0000-0000-00000000a0e1","role":"authenticated"}', true);
INSERT INTO inv_no_premium SELECT public.admin_revenue_access_inventory();
RESET ROLE;
SELECT results_eq(
  $$ SELECT j -> 'dead_ends' FROM inv_no_premium $$,
  $$ VALUES ('{"tier_without_offer":1,"paid_without_offer":2,"dangling_plans":1,"metered_tier_gated":1}'::jsonb) $$,
  'P14 bez planu premium w sprzedaży: dwie treści płatne bez żadnej oferty (bez ceny, plan wycofany)');
SELECT results_eq(
  $$ SELECT t ->> 'key', (t ->> 'offerable')::boolean
       FROM inv_editor, jsonb_array_elements(j -> 'tiers') t
      WHERE t ->> 'key' IN ('supporter', 'member', 'pro', 'vip') ORDER BY t ->> 'key' $$,
  $$ VALUES ('member', true), ('pro', false), ('supporter', true), ('vip', false) $$,
  'warstwy: do kupienia tylko z planem w sprzedaży i cta_mode auto');
SELECT results_eq(
  $$ SELECT j -> 'hits_30d' FROM inv_editor $$,
  $$ VALUES ('[{"reason":"paid","accounts":1,"visitors":0,"hits":3},{"reason":"registration","accounts":0,"visitors":1,"hits":2},{"reason":"tier_rank","accounts":1,"visitors":0,"hits":1}]'::jsonb) $$,
  'powody uderzeń z 30 dni (tylko najemca A)');

-- 23-26. Granty i atrybuty.
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_revenue_funnel(timestamptz, timestamptz, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_revenue_access_inventory()', 'EXECUTE'),
  'anon bez EXECUTE na RPC lejka i inwentarza');
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_revenue_funnel(timestamptz, timestamptz, text, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_revenue_access_inventory()', 'EXECUTE'),
  'authenticated z jawnym EXECUTE (bramka roli w ciele funkcji)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._funnel_counts(uuid, timestamptz, timestamptz, text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._funnel_counts(uuid, timestamptz, timestamptz, text)', 'EXECUTE'),
  '_funnel_counts bez EXECUTE dla ról API');
SELECT ok(
  (SELECT bool_and(p.prosecdef AND 'search_path=public, pg_temp' = ANY (p.proconfig))
     FROM pg_proc p
    WHERE p.oid IN ('public._funnel_counts(uuid, timestamptz, timestamptz, text)'::regprocedure,
                    'public.admin_revenue_funnel(timestamptz, timestamptz, text, text)'::regprocedure,
                    'public.admin_revenue_access_inventory()'::regprocedure)),
  'trzy funkcje: SECURITY DEFINER z search_path public, pg_temp');

SELECT * FROM finish();
ROLLBACK;
