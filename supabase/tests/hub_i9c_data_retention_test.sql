-- pgTAP: retencja danych (I9c-X2, Z-I9b-10; migracje 20261020161000-161400,
-- decyzja administratora danych 2026-10-20).
--
-- CO PRZYPINA:
--   * tabele: RLS, brak uprawnień anon/authenticated; CHECK zakresów okresu
--     (wartość spoza zakresu ODRZUCONA), kategoria ustawowa bez okresu
--     i zawsze włączona; ACL funkcji (panel - authenticated, zadanie -
--     wyłącznie service_role, wewnętrzne - nikt z ról API);
--   * RPC panelu: admin z sesji (redaktor 42501), najemca z SESJI (zapis
--     admina A nie dotyka najemcy B), zakres okresu (22023), kategoria
--     ustawowa nie do zmiany (22023), CAS (40001), audit_log i zdarzenie,
--     karencja (przesunięcie spoza zakresu 22023), lista „do anonimizacji"
--     i przedłużenie (powód 3-500), „uruchom teraz" tylko z potwierdzeniem;
--   * PODGLĄD vs WYKONANIE: najemca w karencji - przebieg liczy, nie zmienia;
--     najemca po karencji - każda kategoria usuwa/anonimizuje TYLKO to, co
--     starsze niż okres; minimum ustawowe (klient CRM, wpis audytu operacji
--     finansowej) nie jest skracane; powtórka = 0 (idempotencja).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9c_data_retention_test
BEGIN;
SELECT plan(52);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- A: najemca po karencji (założony 30 dni temu, bez wierszy ustawień ->
-- termin = założenie + 14 dni, czyli wykonanie). B: najemca w karencji.
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', 'i9c-retencja-a', 'I9c Retencja A', now() - interval '30 days'),
  ('19c20000-0000-4000-8000-0000000000b0', 'i9c-retencja-b', 'I9c Retencja B', now());
INSERT INTO auth.users (id, email) VALUES
  ('19c20000-0000-4000-8000-00000000a001', 'admin-a@i9c-retencja.test'),
  ('19c20000-0000-4000-8000-00000000a002', 'editor-a@i9c-retencja.test'),
  ('19c20000-0000-4000-8000-00000000b001', 'admin-b@i9c-retencja.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19c20000-0000-4000-8000-00000000a001', 'admin-a@i9c-retencja.test', 'Admin A', '19c20000-0000-4000-8000-0000000000a0'),
  ('19c20000-0000-4000-8000-00000000a002', 'editor-a@i9c-retencja.test', 'Editor A', '19c20000-0000-4000-8000-0000000000a0'),
  ('19c20000-0000-4000-8000-00000000b001', 'admin-b@i9c-retencja.test', 'Admin B', '19c20000-0000-4000-8000-0000000000b0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19c20000-0000-4000-8000-00000000a001', 'admin', '19c20000-0000-4000-8000-0000000000a0'),
  ('19c20000-0000-4000-8000-00000000a002', 'editor', '19c20000-0000-4000-8000-0000000000a0'),
  ('19c20000-0000-4000-8000-00000000b001', 'admin', '19c20000-0000-4000-8000-0000000000b0');

CREATE FUNCTION pg_temp.ts(p interval) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT now() - p $$;
CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(text) TO authenticated;

-- Lejek i licznik: stare (14 mies.) i świeże wiersze (A i B).
INSERT INTO public.paywall_hits (tenant_id, day, user_id, entity_type, entity_id, reason, first_at, last_at)
SELECT t, (pg_temp.ts(age) AT TIME ZONE 'UTC')::date, gen_random_uuid(), 'post', gen_random_uuid(), 'paid',
       pg_temp.ts(age), pg_temp.ts(age)
  FROM (VALUES ('19c20000-0000-4000-8000-0000000000a0'::uuid), ('19c20000-0000-4000-8000-0000000000b0'::uuid)) x(t)
 CROSS JOIN (VALUES (interval '14 months'), (interval '10 days')) y(age);
INSERT INTO public.metering_event_log (tenant_id, occurred_at, outcome)
SELECT t, pg_temp.ts(age), 'denied'
  FROM (VALUES ('19c20000-0000-4000-8000-0000000000a0'::uuid), ('19c20000-0000-4000-8000-0000000000b0'::uuid)) x(t)
 CROSS JOIN (VALUES (interval '14 months'), (interval '5 days')) y(age);

-- Dziennik wysyłek, zdarzenia doręczeń, odbiorcy kampanii.
INSERT INTO public.email_send_log (message_id, template_name, recipient_email, status, tenant_id, created_at,
                                   provider_message_id)
VALUES ('i9c-old', 'journey', 'stary@i9c-retencja.test', 'sent', '19c20000-0000-4000-8000-0000000000a0',
        pg_temp.ts('14 months'), 'prov-old'),
       ('i9c-new', 'journey', 'nowy@i9c-retencja.test', 'sent', '19c20000-0000-4000-8000-0000000000a0',
        pg_temp.ts('1 month'), 'prov-new');
INSERT INTO public.email_delivery_events (tenant_id, provider_event_id, event_type, kind, email, provider_message_id,
                                          occurred_at, payload)
VALUES ('19c20000-0000-4000-8000-0000000000a0', 'i9c-ev-old', 'email.delivered', 'delivered',
        'stary@i9c-retencja.test', 'prov-old', pg_temp.ts('14 months'), '{"to":"stary@i9c-retencja.test"}');
INSERT INTO public.newsletter_campaigns (id, tenant_id, name) VALUES
  ('19c20000-0000-4000-8000-0000000020a1', '19c20000-0000-4000-8000-0000000000a0', 'Kampania stara');
INSERT INTO public.newsletter_campaign_recipients (tenant_id, campaign_id, email, status, created_at) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-0000000020a1', 'odbiorca@i9c-retencja.test', 'sent',
   pg_temp.ts('14 months'));

-- CRM: L1 bez aktywności (anonimizacja), L2 aktywny, L3 przedłużony, L4
-- z subskrypcją, L5 klient z transakcją sprzed 3 lat (termin ustawowy nie
-- minął), L6 klient sprzed 8 lat (anonimizacja), L7 termin za ~10 dni.
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, first_name, last_name, phone, created_at,
                              last_activity_at)
SELECT ('19c20000-0000-4000-8000-0000000030' || lpad(n::text, 2, '0'))::uuid,
       '19c20000-0000-4000-8000-0000000000a0',
       'lead' || n || '@i9c-retencja.test', 'lead' || n || '@i9c-retencja.test', 'Imię' || n, 'Nazwisko' || n,
       '+48 600 000 00' || n, pg_temp.ts('30 months'),
       CASE n WHEN 2 THEN pg_temp.ts('1 month') WHEN 7 THEN pg_temp.ts('24 months') + interval '10 days'
              ELSE pg_temp.ts('30 months') END
  FROM generate_series(1, 7) n;
INSERT INTO public.crm_lead_notes (tenant_id, lead_id, body, created_at) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-000000003001', 'Rozmowa z Imię1', pg_temp.ts('30 months'));
INSERT INTO public.data_retention_crm_extensions (tenant_id, lead_id, extended_until, reason) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-000000003003', now() + interval '6 months',
   'Negocjacje umowy');
INSERT INTO public.newsletter_subscribers (tenant_id, email, status) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', 'lead4@i9c-retencja.test', 'subscribed');
-- Opłacone zamówienie może założyć tylko service_role (strażnik statusu) -
-- fikstura podaje rolę w roszczeniach, jak webhook dostawcy płatności.
SET LOCAL request.jwt.claim.role = 'service_role';
INSERT INTO public.payment_orders (tenant_id, kind, status, amount_cents, currency, provider, environment,
                                   receipt_email, paid_at, created_at)
VALUES ('19c20000-0000-4000-8000-0000000000a0', 'one_time', 'paid', 1000, 'PLN', 'stripe', 'live',
        'lead5@i9c-retencja.test', pg_temp.ts('3 years'), pg_temp.ts('3 years')),
       ('19c20000-0000-4000-8000-0000000000a0', 'one_time', 'paid', 1000, 'PLN', 'stripe', 'live',
        'lead6@i9c-retencja.test', pg_temp.ts('8 years'), pg_temp.ts('8 years'));
SET LOCAL request.jwt.claim.role = '';

-- Rejestr zgód: łańcuch L1 („tak"), łańcuch wycofany 7 lat temu (do
-- usunięcia), wycofany 2 lata temu (zostaje), sierota bez podmiotu.
INSERT INTO public.crm_consent_log (tenant_id, email, source_type, consent_key, consent_text, given, created_at) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', 'lead1@i9c-retencja.test', 'contact_form', 'marketing', 'Zgoda', true, pg_temp.ts('30 months')),
  ('19c20000-0000-4000-8000-0000000000a0', 'stary-wypis@i9c-retencja.test', 'contact_form', 'marketing', 'Zgoda', true, pg_temp.ts('8 years')),
  ('19c20000-0000-4000-8000-0000000000a0', 'stary-wypis@i9c-retencja.test', 'contact_form', 'marketing', 'Wypis', false, pg_temp.ts('7 years')),
  ('19c20000-0000-4000-8000-0000000000a0', 'swiezy-wypis@i9c-retencja.test', 'contact_form', 'marketing', 'Wypis', false, pg_temp.ts('2 years')),
  ('19c20000-0000-4000-8000-0000000000a0', 'sierota@i9c-retencja.test', 'contact_form', 'marketing', 'Zgoda', true, pg_temp.ts('1 year'));

-- Dziennik audytu: zwykły stary, finansowy stary (zostaje - dowód księgowy),
-- finansowy sprzed 8 lat, wpis 13-miesięczny z IP i przeglądarką, świeży.
INSERT INTO public.audit_log (id, tenant_id, actor_id, action, entity_type, metadata, ip, created_at) VALUES
  ('19c20000-0000-4000-8000-0000000040a1', '19c20000-0000-4000-8000-0000000000a0', NULL, 'post.update', 'post', '{}', NULL, pg_temp.ts('30 months')),
  ('19c20000-0000-4000-8000-0000000040a2', '19c20000-0000-4000-8000-0000000000a0', NULL, 'membership.manual_grant', 'membership_grant', '{}', NULL, pg_temp.ts('30 months')),
  ('19c20000-0000-4000-8000-0000000040a3', '19c20000-0000-4000-8000-0000000000a0', NULL, 'membership.manual_grant', 'membership_grant', '{}', NULL, pg_temp.ts('8 years')),
  ('19c20000-0000-4000-8000-0000000040a4', '19c20000-0000-4000-8000-0000000000a0', NULL, 'page.update', 'page', '{"user_agent":"Mozilla","page":"x"}', '203.0.113.7', pg_temp.ts('13 months')),
  ('19c20000-0000-4000-8000-0000000040a5', '19c20000-0000-4000-8000-0000000000a0', NULL, 'page.update', 'page', '{}', '203.0.113.8', pg_temp.ts('1 month'));

-- Ankiety rezygnacji: stara (anonimizacja) i świeża.
INSERT INTO public.retention_feedback (tenant_id, user_id, reason_label, comment, coupon_code, outcome, created_at) VALUES
  ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-00000000a001', 'Za drogo', 'Jan z Gdańska', 'KOD1', 'canceled', pg_temp.ts('30 months')),
  ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-00000000a001', 'Za drogo', 'Świeży komentarz', NULL, 'canceled', pg_temp.ts('1 month'));

-- Ścieżka: zapis zakończony 14 mies. temu (krok, wiadomość, otwarcie) i świeży.
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category) VALUES
  ('19c20000-0000-4000-8000-0000000050a1', '19c20000-0000-4000-8000-0000000000a0', 'i9c-ret', 'Retencja', 'active', 'marketing');
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum, published_at)
VALUES ('19c20000-0000-4000-8000-0000000050b1', '19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-0000000050a1', 1,
        'account.registered.v1',
        '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
        'x', pg_temp.ts('15 months'));
INSERT INTO public.journey_enrollments (id, tenant_id, journey_id, version_id, lead_id, status, trigger_snapshot,
                                        enrollment_key, entered_at, finished_at, exit_reason)
VALUES ('19c20000-0000-4000-8000-0000000050c1', '19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-0000000050a1',
        '19c20000-0000-4000-8000-0000000050b1', '19c20000-0000-4000-8000-000000003002', 'completed', '{}', 'old',
        pg_temp.ts('14 months'), pg_temp.ts('14 months') + interval '1 hour', 'completed'),
       ('19c20000-0000-4000-8000-0000000050c2', '19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-0000000050a1',
        '19c20000-0000-4000-8000-0000000050b1', '19c20000-0000-4000-8000-000000003002', 'completed', '{}', 'new',
        pg_temp.ts('20 days'), pg_temp.ts('20 days') + interval '1 hour', 'completed');
INSERT INTO public.journey_step_runs (tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status, started_at)
VALUES ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-0000000050c1', '19c20000-0000-4000-8000-0000000050a1',
        '19c20000-0000-4000-8000-0000000050b1', 'm', 'send_email', 'succeeded', pg_temp.ts('14 months'));
INSERT INTO public.journey_messages (message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, queued_at)
VALUES ('i9c-old', '19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-0000000050c1',
        '19c20000-0000-4000-8000-0000000050a1', '19c20000-0000-4000-8000-0000000050b1', 'm',
        '19c20000-0000-4000-8000-000000003002', pg_temp.ts('14 months'));
INSERT INTO public.journey_message_events (tenant_id, message_id, kind, occurred_at, day)
VALUES ('19c20000-0000-4000-8000-0000000000a0', 'i9c-old', 'open', pg_temp.ts('14 months') + interval '1 hour',
        ((pg_temp.ts('14 months') + interval '1 hour') AT TIME ZONE 'UTC')::date);

-- ── 1. Schemat, CHECK i ACL ──────────────────────────────────────────────────
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c
            WHERE c.oid = ANY (ARRAY['public.data_retention_settings'::regclass, 'public.data_retention_runs'::regclass,
              'public.data_retention_state'::regclass, 'public.data_retention_crm_extensions'::regclass,
              'public.funnel_paywall_daily'::regclass, 'public.metering_events_daily'::regclass,
              'public.newsletter_campaign_engagement_archive'::regclass])),
  'tabele retencji: RLS włączony');
SELECT ok(NOT has_table_privilege('authenticated', 'public.data_retention_settings', 'SELECT')
          AND NOT has_table_privilege('anon', 'public.data_retention_runs', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.funnel_paywall_daily', 'SELECT'),
  'tabele retencji: bez uprawnień anon/authenticated (tylko RPC)');
SELECT throws_ok($$ INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enforce_after)
                    VALUES ('19c20000-0000-4000-8000-0000000000a0', 'paywall_metering', 26, now()) $$, '23514', NULL,
  'CHECK: okres spoza zakresu odrzucony (nie przycięty)');
SELECT throws_ok($$ INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enforce_after)
                    VALUES ('19c20000-0000-4000-8000-0000000000a0', 'email_send_log', 5, now()) $$, '23514', NULL,
  'CHECK: dziennik wysyłek - minimum 6 miesięcy');
SELECT throws_ok($$ INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
                    VALUES ('19c20000-0000-4000-8000-0000000000a0', 'consent_log', NULL, false, now()) $$, '23514', NULL,
  'CHECK: kategorii ustawowej nie da się wyłączyć');
SELECT throws_ok($$ INSERT INTO public.data_retention_crm_extensions (tenant_id, lead_id, extended_until, reason)
                    VALUES ('19c20000-0000-4000-8000-0000000000a0', '19c20000-0000-4000-8000-000000003001', now(), 'ok') $$,
  '23514', NULL, 'CHECK: powód przedłużenia krótszy niż 3 znaki odrzucony');
SELECT ok(has_function_privilege('authenticated', 'public.admin_data_retention_save(text, integer, boolean, timestamptz)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.admin_data_retention_get()', 'EXECUTE'),
  'ACL: RPC panelu dla authenticated, nie dla anon');
SELECT ok(has_function_privilege('service_role', 'public.data_retention_run(integer)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.data_retention_run(integer)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public._data_retention_run_tenant(uuid, text, integer)', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public._data_retention_anonymize_lead(uuid, uuid)', 'EXECUTE'),
  'ACL: zadanie tylko service_role, funkcje wewnętrzne bez EXECUTE dla ról API');

-- ── 2. RPC panelu: rola i najemca z sesji ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('19c20000-0000-4000-8000-00000000a002');
SELECT throws_ok($$ SELECT public.admin_data_retention_get() $$, '42501', NULL, 'panel: redaktor odrzucony (42501)');
SELECT pg_temp.as_user('19c20000-0000-4000-8000-00000000a001');
INSERT INTO r SELECT 'get', public.admin_data_retention_get();
SELECT is((SELECT jsonb_array_length(v -> 'categories') FROM r WHERE k = 'get'), 13,
  'panel: trzynaście kategorii katalogu (I9c + cztery kategorie I9d-Y1)');
SELECT is((SELECT (x ->> 'period_months')::int FROM r, jsonb_array_elements(v -> 'categories') x
            WHERE k = 'get' AND x ->> 'key' = 'crm_inactive_contacts'), 24,
  'panel: brak wiersza = okres domyślny (kontakty CRM 24 mies.)');
SELECT is((SELECT (v -> 'grace' ->> 'enforced')::boolean FROM r WHERE k = 'get'), true,
  'panel: najemca założony 30 dni temu - karencja (14 dni) minęła');
SELECT throws_ok($$ SELECT public.admin_data_retention_save('audit_log', 61, true, NULL) $$, '22023', 'period_out_of_range',
  'zapis: okres spoza zakresu odrzucony (22023)');
SELECT throws_ok($$ SELECT public.admin_data_retention_save('crm_customers', 12, true, NULL) $$, '22023', 'category_read_only',
  'zapis: minimum ustawowe nie do zmiany (22023)');
INSERT INTO r SELECT 'save', public.admin_data_retention_save('cancellation_surveys', 12, true, NULL);
SELECT is((SELECT (x ->> 'period_months')::int FROM r, jsonb_array_elements(v -> 'categories') x
            WHERE k = 'save' AND x ->> 'key' = 'cancellation_surveys'), 12, 'zapis: nowy okres w odpowiedzi');
SELECT throws_ok($$ SELECT public.admin_data_retention_save('cancellation_surveys', 13, true, NULL) $$, '40001', 'conflict',
  'zapis: wiersz istnieje, token NULL - konflikt (CAS)');
SELECT throws_ok($$ SELECT public.admin_data_retention_save('cancellation_surveys', 13, true, '2000-01-01'::timestamptz) $$,
  '40001', 'conflict', 'zapis: nieaktualny token - konflikt (40001)');
SELECT lives_ok($$ SELECT public.admin_data_retention_save('cancellation_surveys', 24, true,
  (SELECT (x ->> 'updated_at')::timestamptz FROM r, jsonb_array_elements(v -> 'categories') x
    WHERE k = 'save' AND x ->> 'key' = 'cancellation_surveys')) $$, 'zapis: aktualny token przechodzi (powrót do 24)');
SELECT throws_ok($$ SELECT public.admin_data_retention_enforcement('postpone', (now() AT TIME ZONE 'Europe/Warsaw')::date + 91) $$,
  '22023', 'postpone_out_of_range', 'karencja: przesunięcie dalej niż 90 dni odrzucone');
SELECT throws_ok($$ SELECT public.admin_data_retention_run_now(false) $$, '22023', 'confirmation_required',
  'uruchom teraz: bez potwierdzenia odrzucone');
INSERT INTO r SELECT 'due', public.admin_data_retention_crm_due(50);
SELECT is((SELECT array_agg(x ->> 'email' ORDER BY x ->> 'email') FROM r, jsonb_array_elements(v -> 'items') x WHERE k = 'due'),
  ARRAY['lead1@i9c-retencja.test', 'lead6@i9c-retencja.test', 'lead7@i9c-retencja.test'],
  'lista do anonimizacji: zaległe i za 10 dni; bez aktywnych, przedłużonych, subskrybentów i klienta przed terminem');
SELECT throws_ok($$ SELECT public.admin_data_retention_crm_extend('19c20000-0000-4000-8000-000000003007', '  ab ') $$,
  '22023', 'reason_length', 'przedłużenie: powód krótszy niż 3 znaki (po obcięciu) odrzucony');
SELECT throws_ok($$ SELECT public.admin_data_retention_crm_extend('19c20000-0000-4000-8000-000000003007', repeat('x', 501)) $$,
  '22023', 'reason_length', 'przedłużenie: powód dłuższy niż 500 znaków odrzucony, nie skrócony');
SELECT lives_ok($$ SELECT public.admin_data_retention_crm_extend('19c20000-0000-4000-8000-000000003007', 'Rozmowy o współpracy') $$,
  'przedłużenie: poprawny powód');
-- Admin B nie widzi kontaktu najemcy A (najemca z sesji).
SELECT pg_temp.as_user('19c20000-0000-4000-8000-00000000b001');
SELECT throws_ok($$ SELECT public.admin_data_retention_crm_extend('19c20000-0000-4000-8000-000000003001', 'Cudzy kontakt') $$,
  'P0002', 'lead_not_found', 'przedłużenie: kontakt innego najemcy - nie znaleziono (najemca z sesji)');
INSERT INTO r SELECT 'get_b', public.admin_data_retention_get();
SELECT is((SELECT (v -> 'grace' ->> 'any_preview')::boolean FROM r WHERE k = 'get_b'), true,
  'najemca B (świeży): tryb podglądu przez 14 dni');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.audit_log
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0'
              AND action IN ('data_retention.settings_changed', 'data_retention.crm_extended')), 3,
  'audit_log: dwa zapisy kategorii i przedłużenie');
SELECT is((SELECT count(*)::int FROM public.domain_events
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND event_type = 'data_retention.changed.v1'), 3,
  'szyna: data_retention.changed.v1 po każdym zapisie');
SELECT is((SELECT period_months::int FROM public.data_retention_settings
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000b0' AND category = 'cancellation_surveys'), NULL,
  'izolacja: zapis admina A nie tworzy ustawień najemcy B');

-- ── 3. Podgląd (B w karencji) ────────────────────────────────────────────────
INSERT INTO r SELECT 'run_b', public._data_retention_run_tenant('19c20000-0000-4000-8000-0000000000b0', 'schedule', 1000);
SELECT is((SELECT v -> 'paywall_metering' ->> 'mode' FROM r WHERE k = 'run_b'), 'preview', 'B: tryb podglądu w karencji');
SELECT is((SELECT (v -> 'paywall_metering' ->> 'affected')::int FROM r WHERE k = 'run_b'), 2,
  'B: podgląd liczy stare wiersze lejka i licznika');
SELECT is((SELECT count(*)::int FROM public.paywall_hits WHERE tenant_id = '19c20000-0000-4000-8000-0000000000b0'), 2,
  'B: podgląd niczego nie usuwa');

-- ── 4. Wykonanie (A po karencji) ─────────────────────────────────────────────
INSERT INTO r SELECT 'run_a', public._data_retention_run_tenant('19c20000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT is((SELECT v -> 'paywall_metering' ->> 'mode' FROM r WHERE k = 'run_a'), 'execute', 'A: tryb wykonania');
SELECT is((SELECT count(*)::int FROM public.paywall_hits WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0'), 1,
  'lejek: stary wiersz usunięty, świeży zostaje');
SELECT is((SELECT count(*)::int FROM public.metering_event_log WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0'), 1,
  'licznik: stare zdarzenie usunięte, świeże zostaje');
SELECT ok((SELECT recipient_email = '[redacted]' AND message_id IS NULL AND provider_message_id IS NULL
             FROM public.email_send_log WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND template_name = 'journey'
              AND created_at < now() - interval '13 months')
          AND (SELECT recipient_email = 'nowy@i9c-retencja.test' FROM public.email_send_log WHERE message_id = 'i9c-new'),
  'dziennik wysyłek: stary wiersz bez adresu i identyfikatorów (szablon i status zostają), świeży nietknięty');
SELECT ok((SELECT email IS NULL AND payload = '{}'::jsonb AND kind = 'delivered' FROM public.email_delivery_events
            WHERE provider_event_id = 'i9c-ev-old')
          AND (SELECT email LIKE '[redacted]:%' AND status = 'sent' FROM public.newsletter_campaign_recipients
                WHERE campaign_id = '19c20000-0000-4000-8000-0000000020a1'),
  'zdarzenia doręczeń i odbiorcy kampanii: adres usunięty, rodzaj i status zostają');
SELECT ok((SELECT anonymized_at IS NOT NULL AND first_name IS NULL AND last_name IS NULL AND phone IS NULL
                  AND email LIKE 'anon-%@anonymized.invalid' AND email = email_norm
             FROM public.crm_leads WHERE id = '19c20000-0000-4000-8000-000000003001'),
  'CRM: kontakt bez aktywności zanonimizowany (adres zastępczy .invalid, bez imienia i telefonu)');
SELECT is((SELECT count(*)::int FROM public.crm_lead_notes WHERE lead_id = '19c20000-0000-4000-8000-000000003001'), 0,
  'CRM: notatki zanonimizowanego kontaktu usunięte');
SELECT is((SELECT array_agg(email ORDER BY email) FROM public.crm_leads
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND anonymized_at IS NULL AND email LIKE 'lead%'),
  ARRAY['lead2@i9c-retencja.test', 'lead3@i9c-retencja.test', 'lead4@i9c-retencja.test', 'lead5@i9c-retencja.test',
        'lead7@i9c-retencja.test'],
  'CRM: aktywny, przedłużony, subskrybent, klient przed terminem ustawowym i kontakt z terminem za 10 dni zostają');
SELECT ok((SELECT count(*) = 1 FROM public.crm_leads
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND anonymized_at IS NOT NULL
              AND id = '19c20000-0000-4000-8000-000000003006'),
  'CRM: klient z transakcją sprzed 8 lat (po terminie dowodów i przedawnienia) zanonimizowany');
SELECT ok((SELECT given = false FROM public.crm_consent_log
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND lower(email) = 'lead1@i9c-retencja.test'
            ORDER BY created_at DESC LIMIT 1),
  'rejestr zgód: anonimizacja kontaktu zamyka łańcuch wpisem wygaśnięcia (od niego biegnie 6 lat)');
SELECT is((SELECT count(*)::int FROM public.crm_consent_log WHERE lower(email) = 'stary-wypis@i9c-retencja.test'), 0,
  'rejestr zgód: łańcuch wycofany 7 lat temu usunięty');
SELECT is((SELECT count(*)::int FROM public.crm_consent_log WHERE lower(email) = 'swiezy-wypis@i9c-retencja.test'), 1,
  'rejestr zgód: łańcuch wycofany 2 lata temu zostaje');
SELECT ok((SELECT given = false FROM public.crm_consent_log WHERE lower(email) = 'sierota@i9c-retencja.test'
            ORDER BY created_at DESC LIMIT 1),
  'rejestr zgód: łańcuch bez podmiotu dostaje wpis wygaśnięcia');
SELECT is((SELECT array_agg(id::text ORDER BY id) FROM public.audit_log
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND id::text LIKE '19c20000-0000-4000-8000-0000000040a%'),
  ARRAY['19c20000-0000-4000-8000-0000000040a2', '19c20000-0000-4000-8000-0000000040a4', '19c20000-0000-4000-8000-0000000040a5'],
  'audyt: stary wpis usunięty, finansowy w terminie dowodów zostaje, finansowy sprzed 8 lat usunięty');
SELECT ok((SELECT ip IS NULL AND NOT (metadata ? 'user_agent') AND metadata ->> 'page' = 'x'
             FROM public.audit_log WHERE id = '19c20000-0000-4000-8000-0000000040a4')
          AND (SELECT ip IS NOT NULL FROM public.audit_log WHERE id = '19c20000-0000-4000-8000-0000000040a5'),
  'audyt: IP i przeglądarka usunięte po 12 miesiącach (treść wpisu zostaje), świeży wpis nietknięty');
SELECT ok((SELECT user_id IS NULL AND comment IS NULL AND coupon_code IS NULL AND reason_label = 'Za drogo'
             FROM public.retention_feedback WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0'
              AND created_at < now() - interval '24 months')
          AND (SELECT user_id IS NOT NULL AND comment IS NOT NULL FROM public.retention_feedback
                WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND created_at > now() - interval '2 months'),
  'ankiety: stara bez konta, komentarza i kuponu (powód zostaje), świeża nietknięta');
SELECT is((SELECT array_agg(enrollment_key) FROM public.journey_enrollments
            WHERE journey_id = '19c20000-0000-4000-8000-0000000050a1'), ARRAY['new'],
  'ścieżki: zapis zakończony 14 mies. temu usunięty (z krokami i zdarzeniami), świeży zostaje');
SELECT ok((SELECT emails_sent = 1 AND unique_opens = 1 FROM public.journey_node_daily_stats
            WHERE journey_id = '19c20000-0000-4000-8000-0000000050a1' AND node_id = 'm'),
  'ścieżki: statystyki dnia zapieczętowane PRZED usunięciem (wysłany i otwarty)');
SELECT ok((SELECT count(*) = 13 FROM public.data_retention_runs
            WHERE tenant_id = '19c20000-0000-4000-8000-0000000000a0' AND run_trigger = 'schedule' AND error_code IS NULL),
  'dziennik przebiegów: wiersz na kategorię, bez błędów');

-- ── 5. Idempotencja ──────────────────────────────────────────────────────────
INSERT INTO r SELECT 'run_a2', public._data_retention_run_tenant('19c20000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT is((SELECT sum((x.value ->> 'affected')::int + COALESCE((x.value ->> 'marked')::int, 0))::int
             FROM r, jsonb_each(v) x WHERE k = 'run_a2'), 0,
  'powtórka: żadna kategoria (także znaczniki wygaśnięcia zgód) nie znajduje nic do zrobienia');

SELECT * FROM finish();
ROLLBACK;
