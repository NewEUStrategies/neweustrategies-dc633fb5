-- pgTAP: RODO po usunięciu konta - pełny przegląd tabel huba i modułów, do
-- których hub pisze (I9b-A2, migracje 20261020160500-160700; polecenie
-- właściciela 2026-10-20 „zastosuj" dla Z-I9b-03/04/05).
--
-- CO PRZYPINA:
--   * konto czytelnika budowane PRAWDZIWYMI ścieżkami: profil (lead CRM
--     z `user_id`, `account.registered.v1`), `record_paywall_hit` (lejek
--     i `paywall.hit.v1`), `log_metering_event`, subskrypcja (księga S2),
--     `admin_membership_grant_set` (nadanie, audyt, outbox CRM), trasa szyny
--     do skrzynki ścieżek, `journey_ingest_inbox` (zapis na ścieżkę), router
--     integracji (dostawy);
--   * po usunięciu konta GENERYCZNY skan (`information_schema`: każda kolumna
--     uuid/text/jsonb/varchar/inet/tablicowa każdej tabeli z przeglądu,
--     wiersze najemcy testu) nie znajduje uid, e-maila ani identyfikatorów
--     operatora tej osoby (`sub_`, `cus_`, `evt_`, stary id subskrypcji)
--     poza JAWNĄ listą wyjątków z uzasadnieniem;
--   * liczniki lejka zamkniętego okresu (konta i uderzenia w paywall,
--     powody, konta aktywne) i Σ księgi MRR zamkniętych miesięcy bez zmian;
--   * jeden pseudonim konta (wersja 8) w lejku, dzienniku licznika, szynie
--     i audycie; nowy id zdarzenia wspólny dla kopii;
--   * zdarzenie nieprzetworzone pominięte: ingest po usunięciu nie zapisuje
--     na ścieżkę i nie zakłada leada; dostawa integracji `dead`; zapis
--     w toku `exited/account_deleted`; odcięcie leada (`crm_lead.updated`)
--     nie wraca do skrzynki;
--   * dane innej osoby nietknięte; konto personelu (autor konfiguracji,
--     aktor audytu); domknięcie wstecz i druga runda 0; ACL; wyzwalacz
--     AFTER DELETE na `auth.users`;
--   * I9c-X1 (20261020160900, Z-I9b-11): konta personelu - ADMIN i REDAKTOR -
--     z wierszem w KAŻDEJ kolumnie autora/recenzenta modułów spoza huba
--     (zgłoszenia do klubów, kwoty wpłat za wydarzenia, kreator, CMS,
--     zaproszenia, zgłoszenia, CRM, kontakt, rekrutacja, import, dziennik
--     ról, moderacja) i w danych własnych konta; po usunięciu skan KAŻDEJ
--     tabeli `public` z `tenant_id` nie znajduje uid ani e-maila poza
--     wyjątkami z podstawą prawną (kontakt CRM); przegląd kolumn wzorca
--     autora bez klucza obcego jest kompletny (nowa kolumna = czerwień,
--     dopóki nie trafi do redakcji albo na listę z uzasadnieniem).
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_account_erasure_sweep
BEGIN;
SELECT plan(40);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Najemca testu jest PUBLICZNYM (`public_tenant_id()` bez nagłówka hosta
-- spada na `is_default`) - jak w paywall_hits_test.
UPDATE public.tenants SET is_default = false WHERE is_default;
INSERT INTO public.tenants (id, slug, name, is_default)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'i9b-sweep', 'I9b Sweep', true);
SELECT public.seed_membership_tiers('19b50000-0000-4000-8000-0000000000a1');

-- U - czytelnik usuwany; K - czytelnik zostający; A - admin usuwany na końcu;
-- B - admin zostający (wykonuje nadanie); R - redaktor usuwany razem z A (I9c).
INSERT INTO auth.users (id, email) VALUES
  ('19b50000-0000-4000-8000-00000000d001', 'usuwana@i9b-sweep.test'),
  ('19b50000-0000-4000-8000-00000000d002', 'zostaje@i9b-sweep.test'),
  ('19b50000-0000-4000-8000-00000000d003', 'admin-usuwany@i9b-sweep.test'),
  ('19b50000-0000-4000-8000-00000000d004', 'admin-zostaje@i9b-sweep.test'),
  ('19b50000-0000-4000-8000-00000000d007', 'redaktor-usuwany@i9b-sweep.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19b50000-0000-4000-8000-00000000d001', 'usuwana@i9b-sweep.test', 'Usuwana Osoba', '19b50000-0000-4000-8000-0000000000a1'),
  ('19b50000-0000-4000-8000-00000000d002', 'zostaje@i9b-sweep.test', 'Zostaje', '19b50000-0000-4000-8000-0000000000a1'),
  ('19b50000-0000-4000-8000-00000000d003', 'admin-usuwany@i9b-sweep.test', 'Admin Usuwany', '19b50000-0000-4000-8000-0000000000a1'),
  ('19b50000-0000-4000-8000-00000000d004', 'admin-zostaje@i9b-sweep.test', 'Admin Zostaje', '19b50000-0000-4000-8000-0000000000a1'),
  ('19b50000-0000-4000-8000-00000000d007', 'redaktor-usuwany@i9b-sweep.test', 'Redaktor Usuwany', '19b50000-0000-4000-8000-0000000000a1');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19b50000-0000-4000-8000-00000000d003', 'admin', '19b50000-0000-4000-8000-0000000000a1'),
  ('19b50000-0000-4000-8000-00000000d004', 'admin', '19b50000-0000-4000-8000-0000000000a1'),
  ('19b50000-0000-4000-8000-00000000d007', 'editor', '19b50000-0000-4000-8000-0000000000a1');

-- Lead konta z wyzwalacza profilu (S4) - asekuracja, gdyby wyzwalacza nie było.
INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
SELECT p.tenant_id, p.email, p.email, p.id FROM public.profiles p
 WHERE p.tenant_id = '19b50000-0000-4000-8000-0000000000a1'
   AND NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE l.tenant_id = p.tenant_id AND l.email_norm = p.email);

-- Treść płatna.
INSERT INTO public.pages (id, tenant_id, slug)
VALUES ('19b50000-0000-4000-8000-0000000000e0', '19b50000-0000-4000-8000-0000000000a1', 'i9b-sweep-home');
INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('19b50000-0000-4000-8000-0000000000e1', 'i9b-sweep-paid', '19b50000-0000-4000-8000-00000000d004', 'published',
   '19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-0000000000e0', 'Płatny');
INSERT INTO public.content_access (tenant_id, entity_type, entity_id, mode, plan_ids, min_tier_rank)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'post', '19b50000-0000-4000-8000-0000000000e1', 'paid', '{}', 20);

-- Silnik ścieżek: ścieżka serwisowa na `paywall.hit.v1` i marketingowa na
-- `crm_lead.updated.v1`; autorem konfiguracji jest admin A.
INSERT INTO public.journey_settings (tenant_id, enabled, updated_by, default_task_assignee_id)
VALUES ('19b50000-0000-4000-8000-0000000000a1', true,
        '19b50000-0000-4000-8000-00000000d003', '19b50000-0000-4000-8000-00000000d003');
INSERT INTO public.journey_definitions (id, tenant_id, key, name, status, category, legal_basis, created_by, updated_by) VALUES
  ('19b50000-0000-4000-8000-0000000010a1', '19b50000-0000-4000-8000-0000000000a1', 'po-paywallu', 'Po paywallu',
   'active', 'service', 'Umowa o dostęp do treści', '19b50000-0000-4000-8000-00000000d003', '19b50000-0000-4000-8000-00000000d003'),
  ('19b50000-0000-4000-8000-0000000010a2', '19b50000-0000-4000-8000-0000000000a1', 'po-zmianie-leada', 'Po zmianie leada',
   'active', 'marketing', NULL, '19b50000-0000-4000-8000-00000000d003', NULL);
INSERT INTO public.journey_versions (id, tenant_id, journey_id, version, trigger_event_type, graph, graph_checksum,
                                     published_at, published_by) VALUES
  ('19b50000-0000-4000-8000-0000000011a1', '19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-0000000010a1', 1,
   'paywall.hit.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
   'x', now() - interval '1 hour', '19b50000-0000-4000-8000-00000000d003'),
  ('19b50000-0000-4000-8000-0000000011a2', '19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-0000000010a2', 1,
   'crm_lead.updated.v1',
   '{"nodes":[{"id":"t","type":"trigger","params":{}},{"id":"x","type":"exit","params":{}}],"edges":[{"from":"t","to":"x","branch":"next"}]}',
   'x', now() - interval '1 hour', '19b50000-0000-4000-8000-00000000d003');
UPDATE public.journey_definitions SET published_version_id = '19b50000-0000-4000-8000-0000000011a1'
 WHERE id = '19b50000-0000-4000-8000-0000000010a1';
UPDATE public.journey_definitions SET published_version_id = '19b50000-0000-4000-8000-0000000011a2'
 WHERE id = '19b50000-0000-4000-8000-0000000010a2';
INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role) VALUES
  ('19b50000-0000-4000-8000-0000000000a1', 'paywall.hit.v1', '19b50000-0000-4000-8000-0000000010a1',
   '19b50000-0000-4000-8000-0000000011a1', 'enroll'),
  ('19b50000-0000-4000-8000-0000000000a1', 'crm_lead.updated.v1', '19b50000-0000-4000-8000-0000000010a2',
   '19b50000-0000-4000-8000-0000000011a2', 'enroll');

-- Router integracji: każde zdarzenie najemcy -> dostawa (punkt założył admin A).
INSERT INTO public.integration_endpoints (tenant_id, name, url, event_types, created_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'Webhook testu', 'https://hook.i9b-sweep.test/in', '{}',
        '19b50000-0000-4000-8000-00000000d003');

-- Konfiguracja modułów, do których hub pisze, autorstwa admina A:
-- ustawienia newslettera (S1), automatyzacja (S4), notatka CRM.
INSERT INTO public.newsletter_settings (tenant_id, updated_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d003')
ON CONFLICT (tenant_id) DO UPDATE SET updated_by = EXCLUDED.updated_by;
INSERT INTO public.workflow_definitions (tenant_id, name, enabled, trigger_event_type, created_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'Wyłączona automatyzacja', false, 'paywall.hit.v1',
        '19b50000-0000-4000-8000-00000000d003');

-- Konfiguracja huba autorstwa admina A (dane wejściowe, wyciszenie diagnozy).
INSERT INTO public.revenue_manual_inputs (tenant_id, period_month, kind, currency, amount_minor, updated_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', date_trunc('month', now())::date, 'mrr_plan', 'PLN', 100000,
        '19b50000-0000-4000-8000-00000000d003');
INSERT INTO public.revenue_diagnostic_snoozes (tenant_id, check_id, kind, until, created_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'pricing.tier_without_offer', 'days', now() + interval '7 days',
        '19b50000-0000-4000-8000-00000000d003');

-- Subskrypcja U (księga S2: historia, ruch, zdarzenie statusu) i K.
INSERT INTO public.subscriptions (id, tenant_id, user_id, provider_subscription_id, provider_customer_id,
  product_id, price_id, status, environment, unit_amount_minor, currency, last_event_id) VALUES
  ('19b50000-0000-4000-8000-0000000005a1', '19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d001',
   'sub_i9b2_u1', 'cus_i9b2_u1', 'plan_plus', 'plus_monthly', 'active', 'live', 3900, 'PLN', 'evt_i9b2_u1_1'),
  ('19b50000-0000-4000-8000-0000000005b1', '19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d002',
   'sub_i9b2_k1', 'cus_i9b2_k1', 'plan_pro', 'pro_monthly', 'active', 'live', 11900, 'PLN', 'evt_i9b2_k1_1');
UPDATE public.subscriptions SET status = 'past_due', payment_failure_count = 1, last_event_id = 'evt_i9b2_u1_2'
 WHERE id = '19b50000-0000-4000-8000-0000000005a1';
UPDATE public.mrr_movements SET occurred_at = date_trunc('month', now()) - interval '20 days'
 WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1';

-- Osoba U: newsletter powiązany z kontem, etap leada z jej aktorem.
INSERT INTO public.newsletter_subscribers (tenant_id, email, user_id)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'usuwana@i9b-sweep.test', '19b50000-0000-4000-8000-00000000d001');
INSERT INTO public.crm_lead_stage_history (tenant_id, lead_id, dimension, from_value, to_value, source, actor_id)
SELECT l.tenant_id, l.id, 'lifecycle', 'subscriber', 'registered', 'system', l.user_id
  FROM public.crm_leads l WHERE l.user_id = '19b50000-0000-4000-8000-00000000d001';
INSERT INTO public.crm_lead_notes (tenant_id, lead_id, body, author_id)
SELECT l.tenant_id, l.id, 'Notatka personelu', '19b50000-0000-4000-8000-00000000d003'
  FROM public.crm_leads l WHERE l.user_id = '19b50000-0000-4000-8000-00000000d002';

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- Admin B nadaje U warstwę (nadanie, audyt `membership.manual_grant`, outbox CRM).
SELECT pg_temp.as_user('19b50000-0000-4000-8000-00000000d004');
SET LOCAL ROLE authenticated;
SELECT public.admin_membership_grant_set('19b50000-0000-4000-8000-00000000d001', 'pro', NULL, NULL);
RESET ROLE;

-- U i K uderzają w paywall (pierwsze uderzenie doby -> `paywall.hit.v1`),
-- U z identyfikatorem przeglądarki w dzienniku licznika.
SELECT pg_temp.as_user('19b50000-0000-4000-8000-00000000d001');
SET LOCAL ROLE authenticated;
SELECT public.record_paywall_hit('post', '19b50000-0000-4000-8000-0000000000e1', 'tier_rank', 'pro', 'default');
SELECT public.log_metering_event('post', '19b50000-0000-4000-8000-0000000000e1', 'denied', 'quota', NULL, 3, 3);
RESET ROLE;
-- Kształt wiersza `log_metering_consumption` (zużycie licznika): konto
-- i identyfikator przeglądarki naraz.
INSERT INTO public.metering_event_log (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome)
VALUES ('19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d001',
        '19b50000-0000-4000-8000-0000000000f1', 'post', '19b50000-0000-4000-8000-0000000000e1', 'consumed');
SELECT pg_temp.as_user('19b50000-0000-4000-8000-00000000d002');
SET LOCAL ROLE authenticated;
SELECT public.record_paywall_hit('post', '19b50000-0000-4000-8000-0000000000e1', 'paid', 'pro', 'default');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- Przetworzenie skrzynki: zapis U na ścieżkę serwisową (aktywny).
SELECT public.journey_ingest_inbox(1000);

-- Uderzenia z dziś stają się ZAMKNIĘTYM okresem (poprzedni miesiąc); drugie
-- uderzenie U dziś to nowe `paywall.hit.v1`, którego skrzynka NIE przetworzy
-- przed usunięciem konta.
UPDATE public.paywall_hits
   SET day = (date_trunc('month', now()) - interval '10 days')::date,
       first_at = date_trunc('month', now()) - interval '10 days',
       last_at = date_trunc('month', now()) - interval '10 days' + interval '1 hour'
 WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1';
SELECT pg_temp.as_user('19b50000-0000-4000-8000-00000000d001');
SET LOCAL ROLE authenticated;
SELECT public.record_paywall_hit('post', '19b50000-0000-4000-8000-0000000000e1', 'tier_rank', 'pro', 'default');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── Przegląd: tabele huba i modułów, do których hub pisze ───────────────────
-- (dziennik wdrożenia §21.9). Skan jest GENERYCZNY: kolumny bierze
-- z `information_schema`, więc nowa kolumna w tych tabelach wchodzi sama.
CREATE FUNCTION pg_temp.review_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY[
    -- Hub (I0-S5, I9).
    'subscription_state_history', 'mrr_movements', 'dunning_cycles', 'mrr_daily_snapshots',
    'revenue_event_marks', 'paywall_hits', 'revenue_manual_inputs', 'revenue_diagnostic_snoozes',
    'crm_lead_stage_history', 'journey_definitions', 'journey_versions', 'journey_event_routes',
    'journey_event_inbox', 'journey_enrollments', 'journey_step_runs', 'journey_settings',
    'journey_engine_errors', 'journey_messages', 'journey_message_events', 'journey_email_contents',
    'journey_node_daily_stats', 'domain_event_emit_errors',
    -- Moduły, do których hub pisze (emitery, CRM, newsletter, licznik, kasa,
    -- retencja, nadania, poczta ścieżek, integracje, audyt).
    'domain_events', 'integration_deliveries', 'workflow_runs', 'crm_leads', 'crm_tasks',
    'newsletter_subscribers', 'metering_event_log', 'metered_views', 'audit_log', 'membership_grants',
    'member_crm_sync_pending', 'retention_feedback', 'subscriptions', 'subscription_price_migrations',
    'b2b_coupon_redemptions', 'email_send_log', 'newsletter_settings', 'workflow_definitions',
    'crm_lead_notes', 'integration_endpoints', 'cross_references']
$$;

-- Wyjątki z podstawą (docs/RODO_REJESTR_CZYNNOSCI_HUB_2026-10.md):
--   crm_leads.email / email_norm - kontakt CRM jest osobną czynnością
--     przetwarzania (formularze, wydarzenia, newsletter); usunięcie konta
--     odcina go od konta (`user_id` NULL), a usunięcie kontaktu wykonuje admin
--     w /admin/crm (kaskada zapisów na ścieżki, wysyłek i śledzenia);
--   newsletter_subscribers.email - subskrypcja na podstawie zgody,
--     niezależna od konta (wypis linkiem lub w panelu);
--   crm_consent_log.email - rejestr zgód (dowód zgody, art. 7 ust. 1 RODO;
--     moduł CRM spoza przeglądu - wpis powstaje z zapisu na newsletter).
CREATE FUNCTION pg_temp.exceptions() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['crm_leads.email', 'crm_leads.email_norm', 'newsletter_subscribers.email', 'crm_consent_log.email']
$$;

-- Każda kolumna uuid/text/jsonb/varchar/inet/tablicowa każdej tabeli
-- z przeglądu (wiersze najemcy testu) przeszukana tekstowo pod kątem
-- każdego śladu. Wynik: „tabela.kolumna: ślad" albo NULL.
CREATE FUNCTION pg_temp.leaks(p_tenant uuid, p_needles text[], p_except text[], p_all boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r record;
  n text;
  v_hit boolean;
  v_out text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND (c.table_name = ANY (pg_temp.review_tables())
            -- Tryb kontrolny: KAŻDA tabela bazowa `public` z `tenant_id`.
            OR (p_all AND EXISTS (
                  SELECT 1 FROM information_schema.tables t
                   WHERE t.table_schema = 'public' AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE')
                AND EXISTS (
                  SELECT 1 FROM information_schema.columns k
                   WHERE k.table_schema = 'public' AND k.table_name = c.table_name AND k.column_name = 'tenant_id')))
       AND c.data_type IN ('uuid', 'text', 'jsonb', 'json', 'character varying', 'ARRAY', 'inet', 'USER-DEFINED')
       AND NOT (c.table_name || '.' || c.column_name = ANY (p_except))
     ORDER BY 1, 2
  LOOP
    FOREACH n IN ARRAY p_needles LOOP
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I x WHERE x.tenant_id = $1 AND strpos(lower(x.%I::text), lower($2)) > 0)',
        r.table_name, r.column_name)
        INTO v_hit USING p_tenant, n;
      IF v_hit THEN
        v_out := v_out || (r.table_name || '.' || r.column_name || ': ' || n);
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULLIF(array_to_string(v_out, ', '), '');
END;
$$;

CREATE FUNCTION pg_temp.u_needles() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['19b50000-0000-4000-8000-00000000d001', 'usuwana@i9b-sweep.test', 'sub_i9b2_u', 'cus_i9b2_u',
               'evt_i9b2_u', '19b50000-0000-4000-8000-0000000005a1']
$$;

CREATE FUNCTION pg_temp.funnel_closed() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
           'paywall_hit_accounts', f -> 'paywall_hit_accounts',
           'paywall_hit_visitors', f -> 'paywall_hit_visitors',
           'paywall_hits', f -> 'paywall_hits',
           'active_accounts', f -> 'active_accounts',
           'paywall_reasons', f -> 'paywall_reasons')
    FROM public._funnel_counts('19b50000-0000-4000-8000-0000000000a1',
                               date_trunc('month', now()) - interval '1 month',
                               date_trunc('month', now())) f
$$;

CREATE TEMP TABLE before_state ON COMMIT DROP AS
SELECT pg_temp.funnel_closed() AS funnel,
       (SELECT jsonb_object_agg(currency, s) FROM (
          SELECT currency, sum(delta_minor) AS s FROM public.mrr_movements
           WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND environment = 'live'
             AND occurred_at < date_trunc('month', now())
           GROUP BY currency) x) AS ledger,
       (SELECT count(*) FROM public.domain_events
         WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND event_type = 'paywall.hit.v1') AS hit_events,
       (SELECT count(*) FROM public.crm_leads WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1') AS leads,
       (SELECT array_agg(id) FROM public.domain_events
         WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
           AND payload ->> 'user_id' = '19b50000-0000-4000-8000-00000000d001') AS u_event_ids;

-- 1. Fikstura: ślady osoby są tam, gdzie przegląd je przewiduje.
SELECT ok(
  (SELECT bool_and(strpos(pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', pg_temp.u_needles(), '{}'), t) > 0)
     FROM unnest(ARRAY['paywall_hits.user_id', 'metering_event_log.user_id', 'domain_events.payload',
                       'domain_events.aggregate_id', 'journey_event_inbox.payload', 'journey_enrollments.user_id',
                       'journey_enrollments.trigger_snapshot', 'integration_deliveries.payload', 'crm_leads.user_id',
                       'newsletter_subscribers.user_id', 'crm_lead_stage_history.actor_id', 'audit_log.metadata',
                       'subscription_state_history.source_event_id', 'mrr_movements.user_id']) t),
  'fikstura: przed usunięciem uid/e-mail/identyfikatory operatora są w lejku, szynie, kopiach, ścieżkach, CRM, newsletterze, audycie i księdze');

SELECT is(
  (SELECT count(*)::int FROM public.journey_event_inbox
    WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND event_type = 'paywall.hit.v1' AND processed_at IS NULL),
  1, 'fikstura: drugie paywall.hit.v1 osoby czeka nieprzetworzone w skrzynce');

-- 2. Skan jest kompletny: każda tabela z przeglądu ma `tenant_id`.
SELECT is(
  (SELECT array_agg(t ORDER BY t) FROM unnest(pg_temp.review_tables()) t
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                       WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'tenant_id')),
  NULL, 'przegląd: każda tabela ma tenant_id - skan po najemcy niczego nie pomija');

-- ── Usunięcie konta U (wyzwalacze RODO włączone) ────────────────────────────
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_retain_accounting;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_revenue;
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_hub;
DELETE FROM auth.users WHERE id = '19b50000-0000-4000-8000-00000000d001';

-- 3. GENERYCZNIE: żadna kolumna tabel z przeglądu poza wyjątkami.
SELECT is(
  pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', pg_temp.u_needles(), pg_temp.exceptions()),
  NULL,
  'po usunięciu: uid, e-mail, sub_/cus_/evt_ i stary id subskrypcji nie występują w żadnej kolumnie uuid/text/jsonb tabel z przeglądu (poza wyjątkami)');

-- Kontrola szersza niż przegląd: każda tabela bazowa `public` z `tenant_id`.
SELECT is(
  pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', pg_temp.u_needles(), pg_temp.exceptions(), true),
  NULL,
  'cała baza (każda tabela public z tenant_id): ślady osoby wyłącznie w kolumnach z listy wyjątków');

-- 4. Wyjątki są prawdziwe i wąskie.
SELECT results_eq(
  $$ SELECT email, user_id FROM public.crm_leads
      WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND email_norm = 'usuwana@i9b-sweep.test' $$,
  $$ VALUES ('usuwana@i9b-sweep.test'::text, NULL::uuid) $$,
  'wyjątek: kontakt CRM zostaje (osobna czynność), odcięty od konta (user_id NULL)');

-- 5-6. Liczniki lejka i Σ księgi zamkniętych okresów.
SELECT ok(
  pg_temp.funnel_closed() = (SELECT funnel FROM before_state)
  AND (SELECT (funnel ->> 'paywall_hit_accounts')::int = 2 AND (funnel ->> 'active_accounts')::int = 2
         FROM before_state),
  'lejek zamkniętego okresu bez zmian (2 konta z uderzeniem, 2 aktywne): uderzenia, goście, powody, konta aktywne');
SELECT is(
  (SELECT jsonb_object_agg(currency, s) FROM (
     SELECT currency, sum(delta_minor) AS s FROM public.mrr_movements
      WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND environment = 'live'
        AND occurred_at < date_trunc('month', now())
      GROUP BY currency) x),
  (SELECT ledger FROM before_state),
  'Σ delta_minor zamkniętych miesięcy bez zmian');

-- 7. Jeden pseudonim konta (wersja 8) - lejek, licznik, szyna, audyt.
CREATE TEMP TABLE sur ON COMMIT DROP AS
SELECT DISTINCT ph.user_id AS s FROM public.paywall_hits ph
 WHERE ph.tenant_id = '19b50000-0000-4000-8000-0000000000a1'
   AND ph.user_id <> '19b50000-0000-4000-8000-00000000d002';
SELECT ok(
  (SELECT count(*) FROM sur) = 1
  AND (SELECT substr(s::text, 15, 1) FROM sur) = '8'
  AND (SELECT bool_and(l.user_id = (SELECT s FROM sur) AND l.visitor_id IS NULL) FROM public.metering_event_log l
        WHERE l.tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT count(*) FROM public.domain_events e
        WHERE e.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND e.event_type = 'paywall.hit.v1'
          AND e.payload ->> 'user_id' = (SELECT s::text FROM sur) AND e.aggregate_id = (SELECT s::text FROM sur)) = 2
  AND (SELECT count(*) FROM public.audit_log a
        WHERE a.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND a.action = 'membership.manual_grant'
          AND a.metadata ->> 'user_id' = (SELECT s::text FROM sur)) = 1,
  'jeden pseudonim v8 konta: paywall_hits, dziennik licznika (bez visitor_id), paywall.hit.v1 (user_id i agregat), audyt nadania');

-- 8. Zdarzenia zostają (typ, czas, treść, powód), mają NOWE identyfikatory.
SELECT ok(
  (SELECT count(*) FROM public.domain_events
    WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND event_type = 'paywall.hit.v1')
    = (SELECT hit_events FROM before_state)
  AND NOT EXISTS (SELECT 1 FROM public.domain_events e, before_state b WHERE e.id = ANY (b.u_event_ids))
  AND (SELECT bool_and(e.actor_id IS NULL AND e.correlation_id IS NULL AND e.payload ->> '_redacted' = 'account_deleted'
                       AND e.payload ->> 'entity_id' = '19b50000-0000-4000-8000-0000000000e1'
                       AND e.payload ->> 'reason' = 'tier_rank')
         FROM public.domain_events e
        WHERE e.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND e.event_type = 'paywall.hit.v1'
          AND e.payload ->> 'user_id' = (SELECT s::text FROM sur)),
  'szyna: zdarzenia osoby zostają (typ, treść, powód), nowy id, bez aktora i korelacji, znacznik _redacted');

SELECT ok(
  (SELECT bool_and(e.payload ?& ARRAY['subscription_id', 'price_id']) IS NOT TRUE
     FROM public.domain_events e
    WHERE e.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND e.event_type LIKE 'billing_subscription.%'
      AND e.payload ? '_redacted')
  AND EXISTS (SELECT 1 FROM public.domain_events e
               WHERE e.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND e.event_type LIKE 'billing_subscription.%'
                 AND e.payload ? '_redacted' AND e.payload ? 'new_status'),
  'szyna: zdarzenia subskrypcji osoby bez subscription_id i ceny, status zostaje');

-- 9. Kopie: skrzynka i dostawy z tym samym nowym id; nieprzetworzone pominięte.
SELECT ok(
  (SELECT bool_and(EXISTS (SELECT 1 FROM public.domain_events e WHERE e.id = i.event_id))
     FROM public.journey_event_inbox i
    WHERE i.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND i.payload ? '_redacted')
  AND (SELECT count(*) FROM public.journey_event_inbox i
        WHERE i.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND i.event_type = 'paywall.hit.v1'
          AND i.error = 'skipped:account_deleted' AND i.processed_at IS NOT NULL) = 1
  AND NOT EXISTS (SELECT 1 FROM public.journey_event_inbox i
                   WHERE i.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND i.processed_at IS NULL
                     AND i.event_type = 'paywall.hit.v1'),
  'skrzynka: kopie z tym samym nowym id zdarzenia; nieprzetworzone paywall.hit.v1 pominięte (skipped:account_deleted)');

SELECT ok(
  (SELECT bool_and(d.status = 'dead' AND d.last_error = 'skipped:account_deleted'
                   AND d.payload ->> 'aggregate_id' = (SELECT s::text FROM sur)
                   AND d.payload ->> 'id' = d.event_id::text
                   AND EXISTS (SELECT 1 FROM public.domain_events e WHERE e.id = d.event_id))
     FROM public.integration_deliveries d
    WHERE d.tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND d.event_type = 'paywall.hit.v1'
      AND d.payload -> 'payload' ->> 'user_id' = (SELECT s::text FROM sur)),
  'dostawy integracji osoby: dead (skipped:account_deleted), koperta z nowym id i pseudonimem');

-- 10. Odcięcie leada od konta (`crm_lead.updated.v1` z wyzwalacza leada) nie
--     wraca do skrzynki (trasa pomija zdarzenia z głębokości wyzwalaczy >= 3,
--     a redakcja i tak oznacza je jako pominięte) ani do integracji (`dead`).
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.journey_event_inbox i
               WHERE i.tenant_id = '19b50000-0000-4000-8000-0000000000a1'
                 AND (i.processed_at IS NULL
                      OR (i.event_type = 'crm_lead.updated.v1' AND i.error IS DISTINCT FROM 'skipped:account_deleted')))
  AND EXISTS (SELECT 1 FROM public.integration_deliveries d
                JOIN public.domain_events e ON e.id = d.event_id
                JOIN public.crm_leads l ON l.id::text = e.aggregate_id
               WHERE l.email_norm = 'usuwana@i9b-sweep.test' AND e.event_type = 'crm_lead.updated.v1')
  AND NOT EXISTS (SELECT 1 FROM public.integration_deliveries d
                    JOIN public.domain_events e ON e.id = d.event_id
                    JOIN public.crm_leads l ON l.id::text = e.aggregate_id
                   WHERE l.email_norm = 'usuwana@i9b-sweep.test' AND e.event_type = 'crm_lead.updated.v1'
                     AND d.status IN ('queued', 'failed')),
  'odcięcie konta od leada (crm_lead.updated.v1): nic nie czeka w skrzynce, dostawy leada dead');

-- 11. Konsument po usunięciu: ingest nie zapisuje na ścieżkę i nie zakłada leada.
CREATE TEMP TABLE enr_before ON COMMIT DROP AS
SELECT count(*) AS n FROM public.journey_enrollments WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1';
SELECT is(
  (public.journey_ingest_inbox(1000) ->> 'enrolled')::int, 0,
  'ingest po usunięciu: zero zapisów na ścieżki');
SELECT ok(
  (SELECT count(*) FROM public.journey_enrollments WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
    = (SELECT n FROM enr_before)
  AND (SELECT count(*) FROM public.crm_leads WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
    = (SELECT leads FROM before_state),
  'konsument nie odtwarza leada ani zapisu');

-- 12. Zapis konta w toku: wyjście `account_deleted`, bez konta i zdarzenia.
SELECT results_eq(
  $$ SELECT e.status, e.exit_reason, e.user_id, e.trigger_event_id, e.trigger_snapshot ? '_redacted',
            e.trigger_snapshot -> 'payload' ? 'user_id', e.trigger_snapshot ->> 'event_type'
       FROM public.journey_enrollments e
       JOIN public.crm_leads l ON l.id = e.lead_id
      WHERE e.journey_id = '19b50000-0000-4000-8000-0000000010a1' AND l.email_norm = 'usuwana@i9b-sweep.test' $$,
  $$ VALUES ('exited'::text, 'account_deleted'::text, NULL::uuid, NULL::uuid, true, false, 'paywall.hit.v1'::text) $$,
  'zapis w toku -> exited/account_deleted; bez user_id i trigger_event_id; migawka bez konta i bez pseudonimu');

-- 13. Kaskady i odcięcia modułów.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.membership_grants WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
                AND tier_key = 'pro' AND source = 'manual')
  AND NOT EXISTS (SELECT 1 FROM public.member_crm_sync_pending WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT user_id FROM public.newsletter_subscribers
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND email = 'usuwana@i9b-sweep.test') IS NULL
  AND (SELECT count(*) FROM public.crm_lead_stage_history h JOIN public.crm_leads l ON l.id = h.lead_id
        WHERE l.email_norm = 'usuwana@i9b-sweep.test' AND h.actor_id IS NULL AND h.to_value = 'registered') >= 1,
  'nadanie i outbox CRM znikają kaskadą; newsletter i historia etapu zostają bez konta');

-- 14. Dane innej osoby nietknięte.
SELECT ok(
  EXISTS (SELECT 1 FROM public.paywall_hits WHERE user_id = '19b50000-0000-4000-8000-00000000d002')
  AND EXISTS (SELECT 1 FROM public.domain_events WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
                AND event_type = 'paywall.hit.v1' AND payload ->> 'user_id' = '19b50000-0000-4000-8000-00000000d002'
                AND NOT payload ? '_redacted')
  AND (SELECT user_id FROM public.crm_leads WHERE email_norm = 'zostaje@i9b-sweep.test') = '19b50000-0000-4000-8000-00000000d002'
  AND (SELECT count(*) FROM public.subscription_state_history
        WHERE subscription_id = '19b50000-0000-4000-8000-0000000005b1' AND source_event_id = 'evt_i9b2_k1_1') = 1,
  'dane osoby zostającej nietknięte (lejek, szyna, CRM, księga)');

-- ── Konto personelu ──────────────────────────────────────────────────────────
-- I9c-X1: ślady personelu w modułach spoza huba - ta sama funkcja dla admina
-- A i redaktora R (wiersz w każdej kolumnie z przeglądu 20261020160900).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at)
VALUES ('19b50000-0000-4000-8000-0000000000c1', '19b50000-0000-4000-8000-0000000000a1', 'i9c-sweep-event',
        'Wydarzenie', 'Event', now() + interval '10 days');
INSERT INTO public.clubs (id, tenant_id, slug, name_pl, name_en)
VALUES ('19b50000-0000-4000-8000-0000000000c2', '19b50000-0000-4000-8000-0000000000a1', 'i9c-sweep-klub',
        'Klub I9c', 'Club I9c');
INSERT INTO public.builder_templates (id, tenant_id, name, data)
VALUES ('19b50000-0000-4000-8000-0000000000c3', '19b50000-0000-4000-8000-0000000000a1', 'Szablon', '{}');
INSERT INTO public.contact_messages (id, tenant_id, name, email, message, form_type)
VALUES ('19b50000-0000-4000-8000-0000000000c4', '19b50000-0000-4000-8000-0000000000a1', 'Kandydat',
        'kandydat@i9b-sweep.test', 'CV', 'career');
INSERT INTO public.career_applications (id, tenant_id, message_id)
VALUES ('19b50000-0000-4000-8000-0000000000c5', '19b50000-0000-4000-8000-0000000000a1',
        '19b50000-0000-4000-8000-0000000000c4');

CREATE FUNCTION pg_temp.staff_traces(p_staff uuid, p_tag text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  t constant uuid := '19b50000-0000-4000-8000-0000000000a1';
  k constant uuid := '19b50000-0000-4000-8000-00000000d002';
  b constant uuid := '19b50000-0000-4000-8000-00000000d004';
  p constant uuid := '19b50000-0000-4000-8000-0000000000e1';
  v_person uuid := gen_random_uuid();
BEGIN
  -- Z-I9b-11: decyzja o zgłoszeniu do klubu i zapisana kwota wpłaty.
  INSERT INTO public.club_applications (tenant_id, user_id, specialization_slug, first_name, email, club_id,
                                        status, reviewed_by, reviewed_at)
  VALUES (t, k, 'energy', 'Zostaje', 'zostaje@i9b-sweep.test', '19b50000-0000-4000-8000-0000000000c2',
          'accepted', p_staff, now());
  INSERT INTO public.event_people (id, tenant_id, first_name, last_name) VALUES (v_person, t, 'Uczestnik', p_tag);
  INSERT INTO public.event_registrations (tenant_id, event_id, person_id, registration_mode, paid_amount_cents,
                                          paid_amount_currency, paid_amount_recorded_at, paid_amount_recorded_by)
  VALUES (t, '19b50000-0000-4000-8000-0000000000c1', v_person, 'form', 5000, 'PLN', now(), p_staff);
  -- Kreator i CMS.
  INSERT INTO public.builder_experiments (tenant_id, name, created_by) VALUES (t, 'Eksperyment ' || p_tag, p_staff);
  INSERT INTO public.builder_global_widgets (tenant_id, name, data, created_by) VALUES (t, 'Widżet ' || p_tag, '{}', p_staff);
  INSERT INTO public.builder_popups (tenant_id, name, created_by) VALUES (t, 'Popup ' || p_tag, p_staff);
  INSERT INTO public.builder_revisions (tenant_id, entity_type, entity_id, name, data, created_by)
  VALUES (t, 'popup', gen_random_uuid(), 'Rewizja ' || p_tag, '{}', p_staff);
  INSERT INTO public.builder_template_revisions (tenant_id, template_id, data, name, created_by)
  VALUES (t, '19b50000-0000-4000-8000-0000000000c3', '{}', 'Rewizja ' || p_tag, p_staff);
  INSERT INTO public.content_revisions (tenant_id, entity_type, entity_id, snapshot, author_id) VALUES (t, 'post', p, '{}', p_staff);
  INSERT INTO public.pages (tenant_id, slug, author_id) VALUES (t, 'i9c-strona-' || p_tag, p_staff);
  INSERT INTO public.post_changelog (tenant_id, post_id, note_pl, created_by) VALUES (t, p, 'Zmiana ' || p_tag, p_staff);
  INSERT INTO public.post_preview_tokens (tenant_id, post_id, token, expires_at, created_by)
  VALUES (t, p, 'i9c-podglad-' || p_tag, now() + interval '1 day', p_staff);
  INSERT INTO public.post_sidebar_layouts (tenant_id, name, created_by) VALUES (t, 'Panel ' || p_tag, p_staff);
  INSERT INTO public.live_blog_entries (tenant_id, post_id, block_id, created_by) VALUES (t, p, 'blok-' || p_tag, p_staff);
  INSERT INTO public.media_folders (tenant_id, path, created_by) VALUES (t, '/i9c-' || p_tag || '/', p_staff);
  INSERT INTO public.redirects (tenant_id, source_path, target_path, created_by)
  VALUES (t, '/stary-' || p_tag, '/nowy-' || p_tag, p_staff);
  INSERT INTO public.legal_document_versions (tenant_id, doc_key, label, content, created_by)
  VALUES (t, 'terms', 'Wersja ' || p_tag, '{}', p_staff);
  INSERT INTO public.site_settings (tenant_id, key, value, updated_by) VALUES (t, 'i9c_' || p_tag, '{}', p_staff);
  INSERT INTO public.site_settings_revisions (tenant_id, key, value, changed_by) VALUES (t, 'i9c_' || p_tag, '{}', p_staff);
  INSERT INTO public.verification_domains (tenant_id, domain, created_by) VALUES (t, 'i9c-' || p_tag || '.example', p_staff);
  INSERT INTO public.event_home_ads (tenant_id, event_id, image_url, created_by)
  VALUES (t, '19b50000-0000-4000-8000-0000000000c1', 'https://cdn.example/' || p_tag || '.png', p_staff);
  -- Konta, zgłoszenia, CRM, kontakt, rekrutacja, zadania, czat.
  UPDATE public.profiles SET verified_at = now(), verified_by = p_staff WHERE id = k;
  INSERT INTO public.user_invitations (tenant_id, email, invited_by) VALUES (t, 'zaproszony-' || p_tag || '@i9b-sweep.test', p_staff);
  INSERT INTO public.user_invitations (tenant_id, email, invited_by, auth_user_id)
  VALUES (t, 'personel-' || p_tag || '@i9b-sweep.test', b, p_staff);
  INSERT INTO public.user_reports (tenant_id, reporter_id, reported_id, reason, status, resolved_by, resolved_at)
  VALUES (t, k, b, 'spam', 'resolved', p_staff, now());
  INSERT INTO public.contact_messages (tenant_id, name, email, message, assigned_to)
  VALUES (t, 'Pytanie', 'pyta@i9b-sweep.test', 'Treść', p_staff);
  INSERT INTO public.career_application_events (tenant_id, application_id, to_stage, actor_id)
  VALUES (t, '19b50000-0000-4000-8000-0000000000c5', 'screening', p_staff);
  INSERT INTO public.command_idempotency (tenant_id, idempotency_key, command, actor_id) VALUES (t, 'i9c-' || p_tag, 'test', p_staff);
  INSERT INTO public.job_runner_runs (source, ok, tenant_id, actor_id) VALUES ('admin', true, t, p_staff);
  INSERT INTO public.conversations (tenant_id, kind, created_by, last_message_sender) VALUES (t, 'group', b, p_staff);
  -- Webhook operatora z kontem (usunięcie poza aplikacją omijało redakcję).
  INSERT INTO public.payment_webhook_events (tenant_id, event_id, event_type, environment, user_id, payload)
  VALUES (t, 'evt_i9c_' || p_tag, 'customer.updated', 'live', p_staff,
          jsonb_build_object('userId', p_staff, 'email', 'personel-' || p_tag || '@i9b-sweep.test'));
  UPDATE public.crm_leads SET owner_id = p_staff WHERE tenant_id = t AND email_norm = 'zostaje@i9b-sweep.test';
  -- Rozliczalność: import, zmiana ról (aktor i cel), moderacja członka.
  INSERT INTO public.wp_import_jobs (tenant_id, actor_id, site) VALUES (t, p_staff, 'https://wp.example');
  INSERT INTO public.role_audit_log (tenant_id, actor_id, target_user_id, old_roles, new_roles) VALUES (t, p_staff, k, '{}', '{editor}');
  INSERT INTO public.role_audit_log (tenant_id, actor_id, target_user_id, old_roles, new_roles) VALUES (t, b, p_staff, '{}', '{editor}');
  INSERT INTO public.club_moderation_log (tenant_id, club_id, moderator_id, action, target_type, target_id)
  VALUES (t, '19b50000-0000-4000-8000-0000000000c2', b, 'ban', 'member', p_staff);
  -- Dane własne konta (obserwacja autora B wysyła B powiadomienie z uid).
  INSERT INTO public.user_bookmarks (tenant_id, user_id, entity_type, entity_id) VALUES (t, p_staff, 'post', p);
  INSERT INTO public.user_read_later (tenant_id, user_id, entity_type, entity_id) VALUES (t, p_staff, 'post', p);
  INSERT INTO public.user_notes (tenant_id, user_id, entity_type, entity_id) VALUES (t, p_staff, 'post', p);
  INSERT INTO public.user_todos (tenant_id, user_id, title) VALUES (t, p_staff, 'Zadanie ' || p_tag);
  INSERT INTO public.saved_searches (tenant_id, user_id, name) VALUES (t, p_staff, 'Wyszukiwanie ' || p_tag);
  INSERT INTO public.saved_views (tenant_id, user_id, entity, name) VALUES (t, p_staff, 'lead', 'Widok ' || p_tag);
  INSERT INTO public.notification_push_queue (tenant_id, user_id, payload) VALUES (t, p_staff, '{}');
  INSERT INTO public.user_follows (tenant_id, user_id, target_type, target_id) VALUES (t, p_staff, 'author', b);
  INSERT INTO public.user_follows (tenant_id, user_id, target_type, target_id) VALUES (t, k, 'author', p_staff);
  INSERT INTO public.user_read_history (tenant_id, user_id, post_id) VALUES (t, p_staff, p);
END $$;
SELECT pg_temp.staff_traces('19b50000-0000-4000-8000-00000000d003', 'a');
SELECT pg_temp.staff_traces('19b50000-0000-4000-8000-00000000d007', 'r');
-- Wiersze jednego na najemcę: po jednym autorze.
INSERT INTO public.post_layout_settings (tenant_id, updated_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d003');
INSERT INTO public.site_design_tokens (tenant_id, updated_by)
VALUES ('19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d007');

CREATE FUNCTION pg_temp.staff_needles() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['19b50000-0000-4000-8000-00000000d003', 'admin-usuwany@i9b-sweep.test',
               '19b50000-0000-4000-8000-00000000d007', 'redaktor-usuwany@i9b-sweep.test']
$$;

-- I9c-1. Fikstura: ślady obu kont personelu są w kolumnach z przeglądu I9c.
SELECT ok(
  (SELECT bool_and(strpos(pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', pg_temp.staff_needles(), '{}', true),
                          t) > 0)
     FROM unnest(ARRAY['club_applications.reviewed_by', 'event_registrations.paid_amount_recorded_by',
                       'builder_revisions.created_by', 'pages.author_id', 'profiles.verified_by',
                       'user_invitations.invited_by', 'user_invitations.auth_user_id', 'crm_leads.owner_id',
                       'role_audit_log.target_user_id', 'club_moderation_log.target_id', 'notifications.meta',
                       'user_read_history.user_id', 'user_follows.target_id', 'site_design_tokens.updated_by',
                       'post_layout_settings.updated_by', 'payment_webhook_events.user_id']) t),
  'I9c fikstura: uid admina i redaktora są w kolumnach autora modułów, w danych własnych i w powiadomieniach innych osób');

DELETE FROM auth.users WHERE id IN ('19b50000-0000-4000-8000-00000000d003', '19b50000-0000-4000-8000-00000000d007');

-- 15. Autor konfiguracji huba -> NULL, wiersze zostają.
SELECT ok(
  (SELECT count(*) FROM public.journey_definitions WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
     AND created_by IS NULL AND updated_by IS NULL) = 2
  AND (SELECT count(*) FROM public.journey_versions WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
         AND published_by IS NULL) = 2
  AND (SELECT updated_by IS NULL AND default_task_assignee_id IS NULL AND enabled FROM public.journey_settings
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT updated_by IS NULL AND amount_minor = 100000 FROM public.revenue_manual_inputs
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT created_by IS NULL AND until > now() FROM public.revenue_diagnostic_snoozes
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'),
  'konto personelu: autor ścieżek, wersji, ustawień, danych wejściowych i wyciszenia -> NULL, konfiguracja zostaje');

SELECT ok(
  (SELECT bool_and(updated_by IS NULL) FROM public.newsletter_settings
    WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT count(*) = 1 AND bool_and(created_by IS NULL) FROM public.workflow_definitions
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND name = 'Wyłączona automatyzacja')
  AND (SELECT count(*) = 1 AND bool_and(author_id IS NULL) FROM public.crm_lead_notes
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND body = 'Notatka personelu')
  AND (SELECT count(*) = 1 AND bool_and(created_by IS NULL AND enabled) FROM public.integration_endpoints
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'),
  'konto personelu: autor ustawień newslettera, automatyzacji, notatki CRM i punktu integracji -> NULL, wiersze zostają');

SELECT ok(
  (SELECT count(*) > 0 AND bool_and(created_by IS NULL) FROM public.cross_references
    WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'),
  'konto personelu: powiązania z notatki zostają bez autora');

SELECT is(
  pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', pg_temp.staff_needles(), pg_temp.exceptions(), true),
  NULL, 'konto personelu (admin i redaktor): uid i e-mail nie występują w żadnej tabeli public z tenant_id (poza wyjątkami)');

-- I9c-2. Z-I9b-11: decyzja i kwota zostają, autor znika.
SELECT ok(
  (SELECT count(*) = 2 AND bool_and(reviewed_by IS NULL AND status = 'accepted' AND reviewed_at IS NOT NULL)
     FROM public.club_applications WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT count(*) = 2 AND bool_and(paid_amount_recorded_by IS NULL AND paid_amount_cents = 5000
                                        AND paid_amount_currency = 'PLN' AND paid_amount_recorded_at IS NOT NULL)
         FROM public.event_registrations WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'),
  'Z-I9b-11: zgłoszenie do klubu (status, czas decyzji) i kwota wpłaty zostają, reviewed_by i paid_amount_recorded_by -> NULL');

-- I9c-3. Rozliczalność: jeden pseudonim v8 na konto; dane własne usunięte.
SELECT ok(
  (SELECT count(DISTINCT actor_id) = 2 AND bool_and(substr(actor_id::text, 15, 1) = '8')
     FROM public.wp_import_jobs WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT bool_and(substr(target_user_id::text, 15, 1) = '8') FROM public.role_audit_log
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
          AND actor_id = '19b50000-0000-4000-8000-00000000d004')
  AND (SELECT bool_and(substr(target_id::text, 15, 1) = '8') FROM public.club_moderation_log
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND target_type = 'member')
  -- Ten sam pseudonim konta w imporcie i w dzienniku ról (aktor).
  AND (SELECT count(*) = 2 FROM public.wp_import_jobs w JOIN public.role_audit_log r ON r.actor_id = w.actor_id
        WHERE w.tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT count(*) = 2 AND bool_and(substr(user_id::text, 15, 1) = '8') FROM public.user_read_history
        WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'),
  'pseudonim v8 (jeden na konto): zadanie importu, dziennik ról (aktor i cel), cel moderacji, historia czytania');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.user_bookmarks WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.user_read_later WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.user_notes WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.user_todos WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.saved_searches WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.saved_views WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.notification_push_queue WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND NOT EXISTS (SELECT 1 FROM public.user_follows WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'),
  'dane własne konta (zakładki, notatki, zadania, wyszukiwania, widoki, push, obserwacje w obie strony) usunięte');

SELECT ok(
  (SELECT count(*) = 2 FROM public.pages WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1'
      AND slug LIKE 'i9c-strona-%' AND author_id IS NULL)
  AND (SELECT count(*) = 4 AND bool_and(invited_by IS DISTINCT FROM '19b50000-0000-4000-8000-00000000d003'
                                        AND auth_user_id IS NULL)
         FROM public.user_invitations WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND (SELECT verified_at IS NOT NULL AND verified_by IS NULL FROM public.profiles
        WHERE id = '19b50000-0000-4000-8000-00000000d002')
  AND (SELECT owner_id IS NULL AND user_id = '19b50000-0000-4000-8000-00000000d002' FROM public.crm_leads
        WHERE email_norm = 'zostaje@i9b-sweep.test'),
  'treść, zaproszenia (także przez strażnika kolumn), weryfikacja i lead zostają; autor, konto zaproszone i opiekun -> NULL');

-- I9c-4. Przegląd jest kompletny: każda kolumna uuid wzorca autora/osoby
-- (`*_by`, `*user_id`, `actor_id`, `author_id`, `owner_id`, … ) tabel
-- bazowych `public` BEZ klucza obcego jest w redakcji albo na liście
-- z uzasadnieniem. Nowa kolumna bez klasyfikacji = czerwień.
SELECT is(
  (SELECT array_agg(c.table_name || '.' || c.column_name ORDER BY 1)
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.data_type = 'uuid'
      AND (c.column_name ~ '_by(_id)?$'
           OR c.column_name ~ '(^|_)(user|actor|author|reviewer|owner|assignee|moderator|editor|creator|approver|sender|recipient)(_id)?$'
           OR c.column_name = 'assigned_to')
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
         WHERE k.contype = 'f' AND k.conrelid = format('public.%I', c.table_name)::regclass AND a.attname = c.column_name)
      AND NOT (c.table_name || '.' || c.column_name = ANY (ARRAY[
        -- `_hub_account_erase` (A2) i `_hub_account_erase_modules` (I9c).
        'audit_log.actor_id', 'builder_experiments.created_by', 'builder_global_widgets.created_by',
        'builder_popups.created_by', 'builder_revisions.created_by', 'builder_template_revisions.created_by',
        'career_application_events.actor_id', 'club_applications.reviewed_by', 'command_idempotency.actor_id',
        'contact_messages.assigned_to', 'content_revisions.author_id', 'conversations.last_message_sender',
        'crm_lead_notes.author_id', 'crm_lead_stage_history.actor_id', 'crm_leads.owner_id', 'crm_leads.user_id',
        'cross_references.created_by', 'domain_events.actor_id', 'event_home_ads.created_by',
        'event_registrations.paid_amount_recorded_by', 'integration_endpoints.created_by', 'job_runner_runs.actor_id',
        'journey_definitions.created_by', 'journey_definitions.updated_by', 'journey_enrollments.user_id',
        'journey_event_inbox.actor_id', 'journey_settings.default_task_assignee_id', 'journey_settings.updated_by',
        'journey_versions.published_by', 'legal_document_versions.created_by', 'live_blog_entries.created_by',
        'media_folders.created_by', 'metering_event_log.user_id', 'newsletter_settings.updated_by',
        'newsletter_subscribers.user_id', 'notification_push_queue.user_id', 'pages.author_id', 'paywall_hits.user_id',
        'post_changelog.created_by', 'post_layout_settings.updated_by', 'post_preview_tokens.created_by',
        'post_sidebar_layouts.created_by', 'profiles.verified_by', 'redirects.created_by',
        'revenue_diagnostic_snoozes.created_by', 'revenue_manual_inputs.updated_by', 'role_audit_log.actor_id',
        'role_audit_log.target_user_id', 'saved_searches.user_id', 'saved_views.user_id', 'site_design_tokens.updated_by',
        'site_settings.updated_by', 'site_settings_revisions.changed_by', 'user_bookmarks.user_id', 'user_follows.user_id',
        'user_invitations.auth_user_id', 'user_invitations.invited_by', 'user_notes.user_id', 'user_read_history.user_id',
        'user_read_later.user_id', 'user_reports.resolved_by', 'user_todos.user_id', 'verification_domains.created_by',
        'workflow_definitions.created_by', 'wp_import_jobs.actor_id', 'payment_webhook_events.user_id',
        -- Księga MRR: redakcja 20261020160400 (`_revenue_ledger_redact_subscription`).
        'dunning_cycles.user_id', 'mrr_movements.user_id', 'subscription_state_history.user_id',
        -- Wyjątek księgowy z podstawą (rejestr czynności): dokument sprzedaży.
        'billing_documents.user_id',
        -- Zgłoszenie Z-I9c-01 (decyzja administratora danych, dziennik §21.20):
        -- zgłoszenie osoby do klubu z danymi zgłoszenia.
        'club_applications.user_id']))),
  NULL,
  'przegląd kompletny: każda kolumna uuid wzorca autora/osoby bez klucza obcego jest redagowana albo ma uzasadnienie');

-- 16. Audyt: wpis nadania zostaje, aktor (admin B) żyje - nietknięty.
SELECT results_eq(
  $$ SELECT actor_id, action FROM public.audit_log
      WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND action = 'membership.manual_grant' $$,
  $$ VALUES ('19b50000-0000-4000-8000-00000000d004'::uuid, 'membership.manual_grant'::text) $$,
  'audyt: wpis nadania zostaje, aktor żyjący nietknięty');

-- 17. Aktor audytu usunięty -> pseudonim v8, bez IP.
INSERT INTO auth.users (id, email) VALUES ('19b50000-0000-4000-8000-00000000d005', 'admin-audyt@i9b-sweep.test');
INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata, ip)
VALUES ('19b50000-0000-4000-8000-0000000000a1', '19b50000-0000-4000-8000-00000000d005', 'membership.manual_revoke',
        'membership_grant', gen_random_uuid(),
        '{"user_id":"19b50000-0000-4000-8000-00000000d002","note":"admin-audyt@i9b-sweep.test"}', '10.1.2.3');
DELETE FROM auth.users WHERE id = '19b50000-0000-4000-8000-00000000d005';
SELECT ok(
  (SELECT substr(actor_id::text, 15, 1) = '8' AND ip IS NULL
          AND metadata ->> 'user_id' = '19b50000-0000-4000-8000-00000000d002'
          AND metadata ->> 'note' = '[redacted]'
     FROM public.audit_log
    WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND action = 'membership.manual_revoke'),
  'audyt: usunięty aktor -> pseudonim v8, IP NULL, e-mail w metadanych [redacted], podmiot żyjący zostaje');

-- ── Domknięcie wstecz ────────────────────────────────────────────────────────
-- Konto usunięte „przed A2": wyzwalacz wyłączony, ślady wpisane po usunięciu.
INSERT INTO auth.users (id, email) VALUES ('19b50000-0000-4000-8000-00000000d006', 'dawne@i9b-sweep.test');
INSERT INTO public.crm_leads (tenant_id, email, email_norm, user_id)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'dawne@i9b-sweep.test', 'dawne@i9b-sweep.test',
        '19b50000-0000-4000-8000-00000000d006');
ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_deleted_redact_hub;
DELETE FROM auth.users WHERE id = '19b50000-0000-4000-8000-00000000d006';
ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_deleted_redact_hub;
INSERT INTO public.paywall_hits (tenant_id, day, user_id, entity_type, entity_id, reason)
VALUES ('19b50000-0000-4000-8000-0000000000a1', (now() AT TIME ZONE 'UTC')::date - 40,
        '19b50000-0000-4000-8000-00000000d006', 'post', '19b50000-0000-4000-8000-0000000000e1', 'paid');
INSERT INTO public.domain_events (tenant_id, aggregate_type, aggregate_id, event_type, payload, actor_id)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'paywall', '19b50000-0000-4000-8000-00000000d006', 'paywall.hit.v1',
        '{"user_id":"19b50000-0000-4000-8000-00000000d006","reason":"paid","customer":"cus_i9b2_old"}',
        '19b50000-0000-4000-8000-00000000d006');

-- I9c: autor strony i zgłoszenia do klubu usunięty „przed I9c".
INSERT INTO public.pages (tenant_id, slug, author_id)
VALUES ('19b50000-0000-4000-8000-0000000000a1', 'i9c-strona-dawna', '19b50000-0000-4000-8000-00000000d006');
UPDATE public.club_applications SET reviewed_by = '19b50000-0000-4000-8000-00000000d006'
 WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1';

SELECT ok(
  pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', ARRAY['19b50000-0000-4000-8000-00000000d006'], '{}') IS NOT NULL,
  'wstecz: ślady konta usuniętego przed A2 w lejku, szynie i CRM');
SELECT ok(public._hub_account_erase_orphans() > 0, 'wstecz: domknięcie redaguje osierocone ślady');
SELECT is(
  pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', ARRAY['19b50000-0000-4000-8000-00000000d006', 'cus_i9b2_old'],
                pg_temp.exceptions()),
  NULL, 'wstecz: uid i identyfikator operatora konta usuniętego przed A2 znikają z tabel z przeglądu');
SELECT ok(
  (SELECT substr(user_id::text, 15, 1) = '8' FROM public.paywall_hits
    WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' AND day = (now() AT TIME ZONE 'UTC')::date - 40),
  'wstecz: osierocone uderzenie dostaje pseudonim v8 (konto liczy się dalej raz)');
SELECT ok(
  (SELECT author_id IS NULL FROM public.pages WHERE slug = 'i9c-strona-dawna')
  AND NOT EXISTS (SELECT 1 FROM public.club_applications WHERE reviewed_by IS NOT NULL
                   AND tenant_id = '19b50000-0000-4000-8000-0000000000a1')
  AND pg_temp.leaks('19b50000-0000-4000-8000-0000000000a1', ARRAY['19b50000-0000-4000-8000-00000000d006'],
                    pg_temp.exceptions(), true) IS NULL,
  'wstecz (I9c): autor strony i recenzent zgłoszenia konta usuniętego wcześniej -> NULL; cała baza bez śladu');
SELECT is(public._hub_account_erase_orphans(), 0, 'wstecz: druga runda nic nie zmienia');

-- ── Wyzwalacz i ACL ─────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_deleted_redact_hub'
             AND t.tgfoid = 'public.tg_auth_users_hub_erasure()'::regprocedure
             -- AFTER (bit 2 = BEFORE wyłączony), ROW (bit 1), DELETE (bit 8).
             AND (t.tgtype & 2) = 0 AND (t.tgtype & 1) = 1 AND (t.tgtype & 8) = 8),
  'wyzwalacz: AFTER DELETE FOR EACH ROW na auth.users (po kaskadach kluczy obcych)');

SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
             'public._hub_erasure_surrogate()', 'public._funnel_erase_account(uuid, uuid)',
             'public._hub_erasure_payload(jsonb, uuid, uuid, text)', 'public._hub_erasure_text(text, uuid, text)',
             'public._domain_events_erase_account(uuid, uuid, text)', 'public._journeys_erase_account(uuid, text)',
             'public._hub_account_erase(uuid, uuid, text)', 'public._hub_account_erase_orphans()',
             'public.tg_auth_users_hub_erasure()', 'public._hub_account_erase_modules(uuid, uuid)',
             'public._hub_account_erase_mail_queue(uuid, text)', 'public._hub_account_bound_email_labels()']) f,
           unnest(ARRAY['anon', 'authenticated']) r
     WHERE has_function_privilege(r, f, 'EXECUTE'))
  AND NOT has_function_privilege('service_role', 'public._hub_account_erase(uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._hub_account_erase_orphans()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._hub_account_erase_modules(uuid, uuid)', 'EXECUTE'),
  'acl: redakcja, pseudonim i wyzwalacz bez EXECUTE dla anon i authenticated (wewnętrzne - także service_role)');

SELECT throws_ok(
  $$ UPDATE public.journey_enrollments SET exit_reason = 'nieznany'
      WHERE tenant_id = '19b50000-0000-4000-8000-0000000000a1' $$,
  '23514', NULL, 'CHECK exit_reason: spoza słownika odrzucone (account_deleted w słowniku)');

SELECT * FROM finish();
ROLLBACK;
