-- pgTAP: schemat huba „Przychód i lejek" (I0, migracje 20261020090000-090400).
--
-- CO PRZYPINA:
--   * każda z 22 nowych tabel ma włączone RLS;
--   * macierz grantów: anon nic; authenticated wyłącznie SELECT i tylko na
--     17 tabelach z polityką odczytu (5 finansowych, 11 operacyjnych,
--     `domain_event_emit_errors`), nigdy INSERT/UPDATE/DELETE; service_role
--     pełny dostęp; tabele serwisowe bez polityk;
--   * izolacja najemców na SELECT: KAŻDA z 16 tabel z odczytem ma wiersz
--     w obu najemcach (asercja kompletności fixture'u), a admin A i admin B
--     widzą w każdej wyłącznie własne - pusta tabela przepuściłaby politykę
--     bez warunku `tenant_id` po cichu;
--   * editor nie czyta tabel finansowych, czyta każdą operacyjną (tylko
--     swojego najemcy); autor nie czyta nic; `super_admin` bez wiersza
--     `admin` też nic (bramka UI huba = ta bramka SQL); zapis z przeglądarki
--     odrzucony;
--   * wartości domyślne kontraktu (silnik ścieżek wyłączony, cykl życia
--     `subscriber`, źródło zadania `manual`, okno porzucenia 24 h);
--   * CHECK-i limitów ODRZUCAJĄ wartości za długie (23514) - nic nie jest
--     przycinane - i przepuszczają wartości na granicy;
--   * nowy CHECK `reason_label`: wiersz `started` bez powodu przechodzi
--     i skaner domyka go do `abandoned` bez powodu; `saved`/`canceled` bez
--     powodu - nie, a `outcome` NULL z pustym powodem też nie (forma ze
--     specyfikacji przepuszczała NULL);
--   * indeksy unikalne będące arbitrami idempotencji pisarzy S2-S5.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_schema_rls
BEGIN;
SELECT plan(58);

-- Lista tabel I0 (bez domain_event_emit_errors - ta ma osobny test helperów,
-- ale wchodzi do macierzy grantów niżej).
CREATE TEMP TABLE hub_tables (name text PRIMARY KEY, access text NOT NULL) ON COMMIT DROP;
INSERT INTO hub_tables (name, access) VALUES
  ('subscription_state_history', 'finance'),
  ('mrr_movements', 'finance'),
  ('dunning_cycles', 'finance'),
  ('mrr_daily_snapshots', 'finance'),
  ('revenue_manual_inputs', 'finance'),
  ('paywall_hits', 'ops'),
  ('revenue_diagnostic_snoozes', 'ops'),
  ('crm_lead_stage_history', 'ops'),
  ('journey_definitions', 'ops'),
  ('journey_versions', 'ops'),
  ('journey_enrollments', 'ops'),
  ('journey_step_runs', 'ops'),
  ('journey_settings', 'ops'),
  ('journey_messages', 'ops'),
  ('journey_email_contents', 'ops'),
  ('journey_node_daily_stats', 'ops'),
  ('revenue_event_marks', 'service'),
  ('journey_event_inbox', 'service'),
  ('journey_engine_errors', 'service'),
  ('journey_message_events', 'service'),
  ('journey_event_routes', 'service'),
  ('domain_event_emit_errors', 'emit_log');
GRANT SELECT ON hub_tables TO authenticated;

-- ── 1. RLS ───────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM hub_tables h WHERE to_regclass('public.' || h.name) IS NOT NULL),
  22,
  'schemat: wszystkie 22 tabele I0 istnieją');
SELECT is_empty(
  $$ SELECT h.name FROM hub_tables h JOIN pg_class c ON c.oid = ('public.' || h.name)::regclass
      WHERE NOT c.relrowsecurity $$,
  'rls: włączone na każdej z 22 tabel');

-- ── 2. Macierz grantów i polityk ─────────────────────────────────────────────
SELECT is_empty(
  $$ SELECT h.name || ':' || p FROM hub_tables h,
            unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE has_table_privilege('anon', 'public.' || h.name, p) $$,
  'granty: anon nie ma żadnego prawa do tabel huba');
SELECT set_eq(
  $$ SELECT h.name FROM hub_tables h WHERE has_table_privilege('authenticated', 'public.' || h.name, 'SELECT') $$,
  $$ SELECT h.name FROM hub_tables h WHERE h.access IN ('finance', 'ops', 'emit_log') $$,
  'granty: authenticated ma SELECT wyłącznie na 17 tabelach z polityką odczytu');
SELECT is_empty(
  $$ SELECT h.name || ':' || p FROM hub_tables h, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
      WHERE has_table_privilege('authenticated', 'public.' || h.name, p) $$,
  'granty: authenticated nigdy nie pisze do tabel huba (zapis tylko RPC/trigger)');
SELECT is_empty(
  $$ SELECT h.name || ':' || p FROM hub_tables h, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
      WHERE NOT has_table_privilege('service_role', 'public.' || h.name, p) $$,
  'granty: service_role ma SELECT, INSERT, UPDATE i DELETE na każdej tabeli');
SELECT set_eq(
  $$ SELECT DISTINCT c.relname::text FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN hub_tables h ON h.name = c.relname $$,
  $$ SELECT h.name FROM hub_tables h WHERE h.access <> 'service' $$,
  'polityki: mają je dokładnie tabele z odczytem; 5 tabel serwisowych bez polityk');
SELECT is_empty(
  $$ SELECT c.relname || ':' || p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN hub_tables h ON h.name = c.relname
      WHERE p.polcmd <> 'r'
         OR p.polroles <> ARRAY['authenticated'::regrole]::oid[] $$,
  'polityki: wyłącznie SELECT dla authenticated (brak polityk zapisu)');

-- ── Fixture: dwóch najemców, admin/editor/autor/super_admin A, admin B ──────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('ab000000-0000-0000-0000-0000000000a0', 'hub-rls-a', 'Hub RLS A'),
  ('ab000000-0000-0000-0000-0000000000b0', 'hub-rls-b', 'Hub RLS B');

INSERT INTO auth.users (id, email) VALUES
  ('ab000000-0000-0000-0000-00000000a001', 'admin-a@hub-rls.test'),
  ('ab000000-0000-0000-0000-00000000a002', 'editor-a@hub-rls.test'),
  ('ab000000-0000-0000-0000-00000000a003', 'author-a@hub-rls.test'),
  ('ab000000-0000-0000-0000-00000000a004', 'super-a@hub-rls.test'),
  ('ab000000-0000-0000-0000-00000000b001', 'admin-b@hub-rls.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ab000000-0000-0000-0000-00000000a001', 'admin-a@hub-rls.test', 'Admin A', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000a002', 'editor-a@hub-rls.test', 'Editor A', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000a003', 'author-a@hub-rls.test', 'Author A', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000a004', 'super-a@hub-rls.test', 'Super A', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000b001', 'admin-b@hub-rls.test', 'Admin B', 'ab000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('ab000000-0000-0000-0000-00000000a001', 'admin', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000a002', 'editor', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000a003', 'author', 'ab000000-0000-0000-0000-0000000000a0'),
  -- Sam `super_admin` (po `change_user_role` to jedyny wiersz użytkownika).
  ('ab000000-0000-0000-0000-00000000a004', 'super_admin', 'ab000000-0000-0000-0000-0000000000a0'),
  ('ab000000-0000-0000-0000-00000000b001', 'admin', 'ab000000-0000-0000-0000-0000000000b0');

INSERT INTO public.crm_leads (id, tenant_id, email) VALUES
  ('ab000000-0000-0000-0000-0000000001a0', 'ab000000-0000-0000-0000-0000000000a0', 'lead-a@hub-rls.test'),
  ('ab000000-0000-0000-0000-0000000001b0', 'ab000000-0000-0000-0000-0000000000b0', 'lead-b@hub-rls.test');

INSERT INTO public.journey_definitions (id, tenant_id, key, name) VALUES
  ('ab000000-0000-0000-0000-0000000002a0', 'ab000000-0000-0000-0000-0000000000a0', 'welcome_a', 'Powitanie A'),
  ('ab000000-0000-0000-0000-0000000002b0', 'ab000000-0000-0000-0000-0000000000b0', 'welcome_b', 'Powitanie B');

-- ── 3. Wartości domyślne kontraktu ───────────────────────────────────────────
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'ab000000-0000-0000-0000-0000000001a0'),
  'subscriber',
  'domyślne: nowy lead ma lifecycle_stage = subscriber');

INSERT INTO public.crm_tasks (tenant_id, lead_id, title, due_at) VALUES
  ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000001a0', 'Zadanie A', now() + interval '1 day');
SELECT is(
  (SELECT source FROM public.crm_tasks WHERE lead_id = 'ab000000-0000-0000-0000-0000000001a0'),
  'manual',
  'domyślne: dzisiejsze zadanie CRM (bez źródła) ma source = manual');

INSERT INTO public.checkout_settings (tenant_id) VALUES ('ab000000-0000-0000-0000-0000000000a0')
  ON CONFLICT (tenant_id) DO NOTHING;
SELECT is(
  (SELECT abandon_after_minutes FROM public.checkout_settings WHERE tenant_id = 'ab000000-0000-0000-0000-0000000000a0'),
  1440,
  'domyślne: okno porzucenia kasy = 1440 min (dzisiejsze 24 h)');

INSERT INTO public.journey_settings (tenant_id) VALUES
  ('ab000000-0000-0000-0000-0000000000a0'), ('ab000000-0000-0000-0000-0000000000b0');
SELECT ok(
  (SELECT NOT enabled AND marketing_cap_per_7d = 3 AND machine_open_seconds = 2
     FROM public.journey_settings WHERE tenant_id = 'ab000000-0000-0000-0000-0000000000a0'),
  'domyślne: silnik ścieżek WYŁĄCZONY, limit 3/7 dni, próg maszynowy 2 s');

-- ── 4. CHECK-i odrzucają, nie przycinają ─────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.journey_definitions (tenant_id, key, name)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'too_long_name', repeat('n', 161)) $$,
  '23514', NULL, 'check: nazwa ścieżki 161 znaków odrzucona');
SELECT lives_ok(
  $$ INSERT INTO public.journey_definitions (tenant_id, key, name)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'max_name', repeat('n', 160)) $$,
  'check: nazwa ścieżki 160 znaków przyjęta (granica)');
SELECT throws_ok(
  $$ INSERT INTO public.revenue_manual_inputs (tenant_id, period_month, kind, currency, amount_minor, note)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', DATE '2026-10-01', 'mrr_plan', 'PLN', 100, repeat('x', 501)) $$,
  '23514', NULL, 'check: notatka danych wejściowych 501 znaków odrzucona');
SELECT throws_ok(
  $$ INSERT INTO public.revenue_manual_inputs (tenant_id, period_month, kind, currency, amount_minor)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', DATE '2026-10-15', 'mrr_plan', 'PLN', 100) $$,
  '23514', NULL, 'check: miesiąc danych wejściowych musi być pierwszym dniem miesiąca');
SELECT throws_ok(
  $$ INSERT INTO public.journey_email_contents (tenant_id, journey_id, node_id, subject_pl, doc)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000002a0', 'n1',
             repeat('s', 201), '{}'::jsonb) $$,
  '23514', NULL, 'check: temat maila PL 201 znaków odrzucony');
SELECT throws_ok(
  $$ INSERT INTO public.revenue_diagnostic_snoozes (tenant_id, check_id, scope_key, kind, until, created_by)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'paywall.no_plans', repeat('k', 201), 'days',
             now() + interval '7 days', 'ab000000-0000-0000-0000-00000000a001') $$,
  '23514', NULL, 'check: scope_key wyciszenia 201 znaków odrzucony');
SELECT throws_ok(
  $$ INSERT INTO public.revenue_diagnostic_snoozes (tenant_id, check_id, kind, scope_hash, reason, created_by)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'paywall.no_plans', 'intentional', 'abc', '  x ',
             'ab000000-0000-0000-0000-00000000a001') $$,
  '23514', NULL, 'check: powód wyciszenia krótszy niż 3 znaki (po btrim) odrzucony');
SELECT throws_ok(
  $$ INSERT INTO public.revenue_diagnostic_snoozes (tenant_id, check_id, kind, until, created_by)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'paywall.no_plans', 'days',
             now() + interval '181 days', 'ab000000-0000-0000-0000-00000000a001') $$,
  '23514', NULL, 'check: wyciszenie dłuższe niż 180 dni odrzucone');
SELECT throws_ok(
  $$ INSERT INTO public.crm_tasks (tenant_id, lead_id, title, due_at, origin_ref)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000001a0', 'T',
             now(), repeat('r', 201)) $$,
  '23514', NULL, 'check: origin_ref zadania 201 znaków odrzucony (nie przycięty)');
SELECT lives_ok(
  $$ INSERT INTO public.crm_tasks (tenant_id, lead_id, title, due_at, origin_ref, source)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000001a0', 'T',
             now(), repeat('r', 200), 'journey') $$,
  'check: origin_ref 200 znaków przyjęty (granica)');
SELECT throws_ok(
  $$ UPDATE public.checkout_settings SET abandon_after_minutes = 29
      WHERE tenant_id = 'ab000000-0000-0000-0000-0000000000a0' $$,
  '23514', NULL, 'check: okno porzucenia 29 min odrzucone (minimum 30)');
SELECT throws_ok(
  $$ INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'quota', repeat('q', 201)) $$,
  '23514', NULL, 'check: odnośnik znacznika skanera 201 znaków odrzucony');

-- ── 5. retention_feedback: powód dopiero na końcu przepływu ─────────────────
SELECT lives_ok(
  $$ INSERT INTO public.retention_feedback (tenant_id, user_id, outcome, reason_label)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-00000000a001', 'started', NULL) $$,
  'retencja: wiersz started bez powodu przyjęty');
SELECT throws_ok(
  $$ INSERT INTO public.retention_feedback (tenant_id, user_id, outcome, reason_label)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-00000000a001', 'saved', NULL) $$,
  '23514', NULL, 'retencja: zakończony przepływ (saved) bez powodu odrzucony');
SELECT throws_ok(
  $$ INSERT INTO public.retention_feedback (tenant_id, user_id, outcome, reason_label)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-00000000a001', 'canceled', '  ') $$,
  '23514', NULL, 'retencja: zakończony przepływ (canceled) z pustym powodem odrzucony');
-- Skaner S2 domyka porzucone przepływy JEDNYM UPDATE-em po zbiorze: gdyby
-- CHECK wymagał powodu przy `abandoned`, 23514 wycofałby całą instrukcję.
SELECT lives_ok(
  $$ UPDATE public.retention_feedback SET outcome = 'abandoned'
      WHERE tenant_id = 'ab000000-0000-0000-0000-0000000000a0' AND outcome = 'started' $$,
  'retencja: skaner domyka wiersz started do abandoned bez powodu');
SELECT is(
  (SELECT count(*)::int FROM public.retention_feedback
    WHERE tenant_id = 'ab000000-0000-0000-0000-0000000000a0' AND outcome = 'abandoned' AND reason_label IS NULL),
  1,
  'retencja: porzucony przepływ zapisany jako abandoned z reason_label NULL');
SELECT throws_ok(
  $$ INSERT INTO public.retention_feedback (tenant_id, user_id, reason_label)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-00000000a001', '   ') $$,
  '23514', NULL, 'retencja: outcome NULL (dzisiejszy kod) z pustym powodem odrzucony - gwarancja sprzed huba');
SELECT throws_ok(
  $$ INSERT INTO public.retention_feedback (tenant_id, user_id)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-00000000a001') $$,
  '23514', NULL, 'retencja: outcome NULL bez powodu odrzucony');
SELECT col_is_null('public', 'retention_feedback', 'reason_label',
  'retencja: reason_label NULL-owalne (wiersz started)');
SELECT is_empty(
  $$ SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.retention_feedback'::regclass AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%btrim(reason_label)%'
        AND conname <> 'retention_feedback_reason_label_required' $$,
  'retencja: stary nienazwany CHECK btrim(reason_label) zdjęty');

-- ── 6. Zachowanie kluczy i kolumn liczonych ──────────────────────────────────
INSERT INTO public.mrr_movements
  (tenant_id, subscription_id, user_id, environment, occurred_at, kind, reason,
   mrr_before_minor, mrr_after_minor, currency, segment)
VALUES
  ('ab000000-0000-0000-0000-0000000000a0', gen_random_uuid(), 'ab000000-0000-0000-0000-00000000a001',
   'live', now(), 'expansion', 'plan_change', 3900, 11900, 'PLN', 'b2c_individual'),
  ('ab000000-0000-0000-0000-0000000000b0', gen_random_uuid(), 'ab000000-0000-0000-0000-00000000b001',
   'live', now(), 'new', 'signup', 0, 3900, 'PLN', 'b2c_individual');
SELECT is(
  (SELECT delta_minor FROM public.mrr_movements WHERE tenant_id = 'ab000000-0000-0000-0000-0000000000a0'),
  8000,
  'mrr: delta_minor liczona przez bazę (after - before)');

INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum)
VALUES ('ab000000-0000-0000-0000-0000000003a0', 'ab000000-0000-0000-0000-0000000000a0',
        'ab000000-0000-0000-0000-0000000002a0', 1, 'account.registered.v1', '{}'::jsonb, 'x');
INSERT INTO public.journey_enrollments
  (id, tenant_id, journey_id, version_id, lead_id, trigger_snapshot, enrollment_key)
VALUES ('ab000000-0000-0000-0000-0000000006a0', 'ab000000-0000-0000-0000-0000000000a0',
        'ab000000-0000-0000-0000-0000000002a0', 'ab000000-0000-0000-0000-0000000003a0',
        'ab000000-0000-0000-0000-0000000001a0', '{}'::jsonb, 'k-1');
SELECT throws_ok(
  $$ INSERT INTO public.journey_enrollments
       (tenant_id, journey_id, version_id, lead_id, trigger_snapshot, enrollment_key)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000002a0',
             'ab000000-0000-0000-0000-0000000003a0', 'ab000000-0000-0000-0000-0000000001a0', '{}'::jsonb, 'k-2') $$,
  '23505', NULL, 'ścieżki: drugi aktywny zapis tego samego leada odrzucony');

INSERT INTO public.paywall_hits (tenant_id, day, user_id, entity_type, entity_id, reason) VALUES
  ('ab000000-0000-0000-0000-0000000000a0', CURRENT_DATE, 'ab000000-0000-0000-0000-00000000a001',
   'post', 'ab000000-0000-0000-0000-0000000004a0', 'paid'),
  ('ab000000-0000-0000-0000-0000000000b0', CURRENT_DATE, 'ab000000-0000-0000-0000-00000000b001',
   'post', 'ab000000-0000-0000-0000-0000000004b0', 'paid');
SELECT throws_ok(
  $$ INSERT INTO public.paywall_hits (tenant_id, day, user_id, entity_type, entity_id, reason)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', CURRENT_DATE, 'ab000000-0000-0000-0000-00000000a001',
             'post', 'ab000000-0000-0000-0000-0000000004a0', 'quota') $$,
  '23505', NULL, 'paywall: drugie uderzenie czytelnika w tę samą treść w tej samej dobie = konflikt (licznik, nie wiersz)');

-- ── 7. Indeksy - arbitry idempotencji ────────────────────────────────────────
SELECT ok(
  (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.crm_leads_tenant_user_uidx'::regclass
      AND i.indrelid = 'public.crm_leads'::regclass),
  'indeks: crm_leads_tenant_user_uidx unikalny na crm_leads');
SELECT ok(
  (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.crm_tasks_origin_uidx'::regclass
      AND i.indrelid = 'public.crm_tasks'::regclass),
  'indeks: crm_tasks_origin_uidx unikalny na crm_tasks');
SELECT ok(
  (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.dunning_cycles_open_uidx'::regclass
      AND i.indrelid = 'public.dunning_cycles'::regclass),
  'indeks: dunning_cycles_open_uidx unikalny na dunning_cycles');
SELECT ok(
  (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.journey_enrollments_active_uidx'::regclass
      AND i.indrelid = 'public.journey_enrollments'::regclass),
  'indeks: journey_enrollments_active_uidx unikalny na journey_enrollments');
SELECT ok(
  (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.paywall_hits_user_uidx'::regclass
      AND i.indrelid = 'public.paywall_hits'::regclass),
  'indeks: paywall_hits_user_uidx unikalny na paywall_hits');
SELECT ok(
  (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = 'public.paywall_hits_visitor_uidx'::regclass
      AND i.indrelid = 'public.paywall_hits'::regclass),
  'indeks: paywall_hits_visitor_uidx unikalny na paywall_hits');
SELECT has_column('public', 'email_send_log', 'provider_message_id', 'email_send_log: kolumna provider_message_id');
SELECT ok(
  (SELECT i.indpred IS NOT NULL FROM pg_index i
    WHERE i.indexrelid = 'public.email_send_log_provider_message_id_idx'::regclass),
  'email_send_log: indeks provider_message_id jest częściowy');

-- ── Fixture finansowy i operacyjny w obu najemcach ───────────────────────────
-- Jeden komplet na najemcę w KAŻDEJ z 16 tabel z odczytem. Pusta tabela
-- zrobiłaby z asercji izolacji tautologię: polityka bez warunku `tenant_id`
-- (albo `USING (true)`) przeszłaby zielono, bo nie byłoby czego wyciec.
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id, product_id, price_id, status, environment)
VALUES ('ab000000-0000-0000-0000-0000000005a0', 'ab000000-0000-0000-0000-0000000000a0',
        'ab000000-0000-0000-0000-00000000a001', 'sub_hubrlsa', 'cus_hubrlsa', 'prod_x', 'price_x', 'active', 'live'),
       ('ab000000-0000-0000-0000-0000000005b0', 'ab000000-0000-0000-0000-0000000000b0',
        'ab000000-0000-0000-0000-00000000b001', 'sub_hubrlsb', 'cus_hubrlsb', 'prod_x', 'price_x', 'active', 'live');
INSERT INTO public.subscription_state_history
  (tenant_id, subscription_id, user_id, environment, status_after, price_id_after, quantity_after,
   paused_after, cancel_at_period_end_after, payment_failure_count_after, dedupe_key)
VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000005a0',
        'ab000000-0000-0000-0000-00000000a001', 'live', 'active', 'price_x', 1, false, false, 0, 'evt_hub_rls_a'),
       ('ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000005b0',
        'ab000000-0000-0000-0000-00000000b001', 'live', 'active', 'price_x', 1, false, false, 0, 'evt_hub_rls_b');
INSERT INTO public.dunning_cycles
  (tenant_id, subscription_id, user_id, environment, started_at, mrr_at_risk_minor, currency)
VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000005a0',
        'ab000000-0000-0000-0000-00000000a001', 'live', now(), 3900, 'PLN'),
       ('ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000005b0',
        'ab000000-0000-0000-0000-00000000b001', 'live', now(), 3900, 'PLN');
INSERT INTO public.mrr_daily_snapshots
  (tenant_id, day, environment, currency, segment, mrr_minor, active_subscriptions, active_customers, trialing, basis_catalog_share)
VALUES ('ab000000-0000-0000-0000-0000000000a0', CURRENT_DATE, 'live', 'PLN', 'b2c_individual', 11900, 1, 1, 0, 0),
       ('ab000000-0000-0000-0000-0000000000b0', CURRENT_DATE, 'live', 'PLN', 'b2c_individual', 3900, 1, 1, 0, 0);
INSERT INTO public.revenue_manual_inputs (tenant_id, period_month, kind, currency, amount_minor)
VALUES ('ab000000-0000-0000-0000-0000000000a0', DATE '2026-10-01', 'mrr_plan', 'PLN', 100000),
       ('ab000000-0000-0000-0000-0000000000b0', DATE '2026-10-01', 'mrr_plan', 'PLN', 50000);
INSERT INTO public.revenue_diagnostic_snoozes (tenant_id, check_id, kind, until, created_by)
VALUES ('ab000000-0000-0000-0000-0000000000a0', 'paywall.no_plans', 'days', now() + interval '7 days',
        'ab000000-0000-0000-0000-00000000a001'),
       ('ab000000-0000-0000-0000-0000000000b0', 'paywall.no_plans', 'days', now() + interval '7 days',
        'ab000000-0000-0000-0000-00000000b001');
INSERT INTO public.crm_lead_stage_history (tenant_id, lead_id, dimension, to_value, source) VALUES
  ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000001a0', 'lifecycle', 'lead', 'manual'),
  ('ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000001b0', 'lifecycle', 'lead', 'manual');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum)
VALUES ('ab000000-0000-0000-0000-0000000003b0', 'ab000000-0000-0000-0000-0000000000b0',
        'ab000000-0000-0000-0000-0000000002b0', 1, 'account.registered.v1', '{}'::jsonb, 'x');
INSERT INTO public.journey_enrollments
  (id, tenant_id, journey_id, version_id, lead_id, trigger_snapshot, enrollment_key)
VALUES ('ab000000-0000-0000-0000-0000000006b0', 'ab000000-0000-0000-0000-0000000000b0',
        'ab000000-0000-0000-0000-0000000002b0', 'ab000000-0000-0000-0000-0000000003b0',
        'ab000000-0000-0000-0000-0000000001b0', '{}'::jsonb, 'k-b');
INSERT INTO public.journey_step_runs (tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status)
VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000006a0',
        'ab000000-0000-0000-0000-0000000002a0', 'ab000000-0000-0000-0000-0000000003a0', 'n1', 'send_email', 'succeeded'),
       ('ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000006b0',
        'ab000000-0000-0000-0000-0000000002b0', 'ab000000-0000-0000-0000-0000000003b0', 'n1', 'send_email', 'succeeded');
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id)
VALUES ('hub-rls-msg-a', 'ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000006a0',
        'ab000000-0000-0000-0000-0000000002a0', 'ab000000-0000-0000-0000-0000000003a0', 'n1',
        'ab000000-0000-0000-0000-0000000001a0'),
       ('hub-rls-msg-b', 'ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000006b0',
        'ab000000-0000-0000-0000-0000000002b0', 'ab000000-0000-0000-0000-0000000003b0', 'n1',
        'ab000000-0000-0000-0000-0000000001b0');
INSERT INTO public.journey_email_contents (tenant_id, journey_id, node_id, subject_pl, doc)
VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000002a0', 'n1', 'Temat A', '{}'::jsonb),
       ('ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000002b0', 'n1', 'Temat B', '{}'::jsonb);
INSERT INTO public.journey_node_daily_stats (tenant_id, journey_id, version_id, node_id, day)
VALUES ('ab000000-0000-0000-0000-0000000000a0', 'ab000000-0000-0000-0000-0000000002a0',
        'ab000000-0000-0000-0000-0000000003a0', 'n1', CURRENT_DATE),
       ('ab000000-0000-0000-0000-0000000000b0', 'ab000000-0000-0000-0000-0000000002b0',
        'ab000000-0000-0000-0000-0000000003b0', 'n1', CURRENT_DATE);

-- Liczności widoczne dla bieżącej roli (RLS tnie po roli i najemcy z sesji):
-- wiersze najemcy z argumentu i wiersze CUDZE, osobno - jedna liczba
-- sumaryczna nie odróżni „widzę swoje" od „widzę swoje i cudze".
CREATE TEMP TABLE hub_seen (name text PRIMARY KEY, n_own int NOT NULL, n_foreign int NOT NULL) ON COMMIT DROP;
GRANT ALL ON hub_seen TO authenticated;
CREATE FUNCTION pg_temp.hub_count_visible(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_own int;
  v_foreign int;
BEGIN
  DELETE FROM hub_seen;
  FOR r IN SELECT name FROM hub_tables WHERE access IN ('finance', 'ops') LOOP
    EXECUTE format(
      'SELECT count(*) FILTER (WHERE tenant_id = $1), count(*) FILTER (WHERE tenant_id <> $1) FROM public.%I',
      r.name) INTO v_own, v_foreign USING p_tenant;
    INSERT INTO hub_seen VALUES (r.name, v_own, v_foreign);
  END LOOP;
END $$;

-- Kompletność fixture'u (właściciel bazy omija RLS): bez niej asercje niżej
-- mogłyby zzielenieć na pustej tabeli.
SELECT pg_temp.hub_count_visible('ab000000-0000-0000-0000-0000000000a0');
SELECT is_empty(
  $$ SELECT name FROM hub_seen WHERE n_own = 0 OR n_foreign = 0 $$,
  'fixture: każda z 16 tabel z odczytem ma wiersze w OBU najemcach');

-- ── 8. Izolacja najemców: admin A ────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);

SELECT results_eq(
  $$ SELECT tenant_id FROM public.mrr_movements $$,
  $$ VALUES ('ab000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'izolacja: admin A widzi wyłącznie ruchy MRR najemcy A');
SELECT results_eq(
  $$ SELECT tenant_id FROM public.paywall_hits $$,
  $$ VALUES ('ab000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'izolacja: admin A widzi wyłącznie uderzenia w paywall najemcy A');
SELECT results_eq(
  $$ SELECT tenant_id FROM public.crm_lead_stage_history $$,
  $$ VALUES ('ab000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'izolacja: admin A widzi wyłącznie historię etapów najemcy A');
SELECT set_eq(
  $$ SELECT DISTINCT tenant_id FROM public.journey_definitions $$,
  $$ VALUES ('ab000000-0000-0000-0000-0000000000a0'::uuid) $$,
  'izolacja: admin A widzi wyłącznie ścieżki najemcy A');

SELECT pg_temp.hub_count_visible('ab000000-0000-0000-0000-0000000000a0');
SELECT is_empty(
  $$ SELECT name FROM hub_seen WHERE n_own = 0 OR n_foreign > 0 $$,
  'izolacja: admin A widzi wyłącznie wiersze najemcy A - w każdej z 16 tabel (5 finansowych, 11 operacyjnych)');

-- ── 9. Izolacja najemców: admin B ────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-00000000b001","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT DISTINCT tenant_id FROM public.journey_definitions $$,
  $$ VALUES ('ab000000-0000-0000-0000-0000000000b0'::uuid) $$,
  'izolacja: admin B widzi wyłącznie ścieżki najemcy B');
SELECT results_eq(
  $$ SELECT tenant_id FROM public.mrr_movements $$,
  $$ VALUES ('ab000000-0000-0000-0000-0000000000b0'::uuid) $$,
  'izolacja: admin B widzi wyłącznie ruchy MRR najemcy B');
SELECT pg_temp.hub_count_visible('ab000000-0000-0000-0000-0000000000b0');
SELECT is_empty(
  $$ SELECT name FROM hub_seen WHERE n_own = 0 OR n_foreign > 0 $$,
  'izolacja: admin B widzi wyłącznie wiersze najemcy B - w każdej z 16 tabel');

-- ── 10. Editor: operacyjne tak, finansowe nie ────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-00000000a002","role":"authenticated"}', true);
SELECT pg_temp.hub_count_visible('ab000000-0000-0000-0000-0000000000a0');
SELECT is_empty(
  $$ SELECT s.name FROM hub_seen s JOIN hub_tables h USING (name)
      WHERE h.access = 'finance' AND s.n_own + s.n_foreign > 0 $$,
  'editor: nie czyta żadnej z 5 tabel finansowych');
SELECT is_empty(
  $$ SELECT s.name FROM hub_seen s JOIN hub_tables h USING (name)
      WHERE h.access = 'ops' AND (s.n_own = 0 OR s.n_foreign > 0) $$,
  'editor: czyta tabele operacyjne swojego najemcy - każdą z 11, bez wierszy najemcy B');

-- ── 11. Autor: nic ───────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-00000000a003","role":"authenticated"}', true);
SELECT pg_temp.hub_count_visible('ab000000-0000-0000-0000-0000000000a0');
SELECT is(
  (SELECT sum(n_own + n_foreign)::int FROM hub_seen),
  0,
  'autor: nie czyta żadnej tabeli huba (finansowej ani operacyjnej)');

-- ── 11b. super_admin bez wiersza admin: nic ──────────────────────────────────
-- Polityki pytają o DOKŁADNĄ rolę (`has_role` admin, `is_admin_or_editor()`),
-- więc sam `super_admin` nie czyta huba. Bramka UI (`RevenueHubLayout`,
-- `JourneyEditorRoute`) sprawdza `roles.includes("admin")`, a nie `isAdmin`
-- z `useAuth` (ten liczy super_admin) - inaczej pokazałaby hub z zerami.
SELECT set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-00000000a004","role":"authenticated"}', true);
SELECT pg_temp.hub_count_visible('ab000000-0000-0000-0000-0000000000a0');
SELECT is(
  (SELECT sum(n_own + n_foreign)::int FROM hub_seen),
  0,
  'super_admin bez wiersza admin: nie czyta żadnej tabeli huba (UI = bramka SQL)');

-- ── 12. Zapis z przeglądarki odrzucony (także dla admina) ────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
SELECT throws_ok(
  $$ INSERT INTO public.journey_definitions (tenant_id, key, name)
     VALUES ('ab000000-0000-0000-0000-0000000000a0', 'from_browser', 'Z przeglądarki') $$,
  '42501', NULL, 'zapis: admin nie wstawia ścieżki wprost (tylko RPC)');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
