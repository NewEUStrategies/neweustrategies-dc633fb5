-- pgTAP: wspólne helpery SQL huba (I0, migracja 20261020090500).
--
-- CO PRZYPINA:
--   * `_log_emit_error` nigdy nie rzuca (także z NULL w każdym argumencie)
--     i zapisuje sqlstate/komunikat przekazane z handlera emitera; za długi
--     komunikat zostaje odrzucony znacznikiem `message_too_long` (bez
--     przycinania), a zniknięty najemca nie gubi śladu;
--   * odczyt `domain_event_emit_errors`: admin najemcy widzi tylko swoje,
--     editor - nic;
--   * `tier_rank_of` czyta warstwy najemcy Z SESJI (ten sam klucz, dwie
--     rangi w dwóch najemcach);
--   * `metering_defaults()` = wartości kontraktu = wiersz `metering_settings`
--     wstawiony z samym `tenant_id` (domyślne kolumn);
--   * `revenue_segment_of_tier` dla 14 kluczy `TIER_RANKS` + `decision_lab`,
--     nieznanego klucza i NULL (mapa po redefinicji I9b 20261020160000:
--     partnerzy i NGO -> b2b_institution);
--   * granty EXECUTE wg macierzy SPEC §4.4 i `search_path` z `pg_temp`;
--   * strażnik `hub_grants`: żadna funkcja serwisowa, wewnętrzna ani
--     wyzwalacz z rejestru bramki dostawy nie ma EXECUTE dla anon/authenticated.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_shared_helpers
BEGIN;
SELECT plan(27);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('ac000000-0000-0000-0000-0000000000a0', 'hub-help-a', 'Hub helpers A'),
  ('ac000000-0000-0000-0000-0000000000b0', 'hub-help-b', 'Hub helpers B');

INSERT INTO auth.users (id, email) VALUES
  ('ac000000-0000-0000-0000-00000000a001', 'admin-a@hub-help.test'),
  ('ac000000-0000-0000-0000-00000000a002', 'editor-a@hub-help.test'),
  ('ac000000-0000-0000-0000-00000000b001', 'admin-b@hub-help.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('ac000000-0000-0000-0000-00000000a001', 'admin-a@hub-help.test', 'Admin A', 'ac000000-0000-0000-0000-0000000000a0'),
  ('ac000000-0000-0000-0000-00000000a002', 'editor-a@hub-help.test', 'Editor A', 'ac000000-0000-0000-0000-0000000000a0'),
  ('ac000000-0000-0000-0000-00000000b001', 'admin-b@hub-help.test', 'Admin B', 'ac000000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('ac000000-0000-0000-0000-00000000a001', 'admin', 'ac000000-0000-0000-0000-0000000000a0'),
  ('ac000000-0000-0000-0000-00000000a002', 'editor', 'ac000000-0000-0000-0000-0000000000a0'),
  ('ac000000-0000-0000-0000-00000000b001', 'admin', 'ac000000-0000-0000-0000-0000000000b0');

-- ── 1. Granty i atrybuty ─────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public._log_emit_error(uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._log_emit_error(uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._tier_rank_of(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tier_rank_of(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.revenue_segment_of_tier(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.revenue_segment_of_tier(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.metering_defaults()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.metering_defaults()', 'EXECUTE'),
  'acl: helpery wewnętrzne bez EXECUTE dla anon i authenticated');
SELECT ok(
  NOT has_function_privilege('service_role', 'public._log_emit_error(uuid, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public._tier_rank_of(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.revenue_segment_of_tier(text)', 'EXECUTE'),
  'acl: _log_emit_error, _tier_rank_of, revenue_segment_of_tier bez EXECUTE także dla service_role');
SELECT ok(
  has_function_privilege('service_role', 'public.metering_defaults()', 'EXECUTE'),
  'acl: metering_defaults() dla service_role (test parytetu)');
SELECT ok(
  has_function_privilege('authenticated', 'public.tier_rank_of(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.tier_rank_of(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.tier_rank_of(text)', 'EXECUTE'),
  'acl: tier_rank_of dla authenticated i service_role, nie dla anon');

-- Strażnik `hub_grants` (SPEC §3.1 I7). Bramka dostawy czyta TEKST migracji,
-- a ta asercja - wynik w bazie, po pg_proc (każde przeciążenie). Domyślne ACL
-- platformy nadają authenticated EXECUTE JAWNIE, więc `REVOKE … FROM PUBLIC,
-- anon` zostawia helper z `p_tenant` otwarty dla każdego zalogowanego. Lista
-- = funkcje serwisowe, wewnętrzne i wyzwalacze z `HUB_FUNCTION_KINDS`
-- (src/lib/ci/hubDelivery.ts) bez redefinicji sprzed huba z `HUB_CIALO_Z`
-- (ich ACL zmienia dopiero wycinek, który je przepisuje); zgodność listy
-- z rejestrem przypina hubDelivery.gate.test.ts. Funkcje S1-S7 wchodzą do
-- sprawdzenia same, gdy powstaną - dlatego filtr po nazwie, nie regprocedure.
-- hub-grants:begin
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text || ' -> ' || r
       FROM pg_proc p
       CROSS JOIN unnest(ARRAY['anon', 'authenticated']) r
      WHERE p.pronamespace = 'public'::regnamespace
        AND has_function_privilege(r, p.oid, 'EXECUTE')
        AND p.proname = ANY (ARRAY[
          '_crm_source_type_rank', '_data_retention_admin_tenant', '_data_retention_anonymize_lead',
          '_data_retention_audit_is_financial', '_data_retention_audit_log', '_data_retention_bounded',
          '_data_retention_cancellation_surveys', '_data_retention_catalog', '_data_retention_consent_log',
          '_data_retention_crm', '_data_retention_crm_candidates', '_data_retention_customer_until',
          '_data_retention_effective', '_data_retention_email_engagement', '_data_retention_email_send_log',
          '_data_retention_emit', '_data_retention_fold_campaign_events', '_data_retention_funnel_cut',
          '_data_retention_journey_enrollments', '_data_retention_journey_sealed',
          '_data_retention_paywall_metering', '_data_retention_run_tenant', '_data_retention_seal_funnel',
          '_data_retention_seal_journeys', '_domain_events_erase_account', '_event_revenue_net',
          '_funnel_counts', '_funnel_erase_account', '_hub_account_bound_email_labels', '_hub_account_erase',
          '_hub_account_erase_mail_queue', '_hub_account_erase_modules', '_hub_account_erase_orphans',
          '_hub_erasure_payload', '_hub_erasure_surrogate', '_hub_erasure_text', '_journey_edge',
          '_journey_enroll', '_journey_eval_predicate', '_journey_exec_action', '_journey_rollup_days',
          '_journey_marketing_consent', '_journey_message_id', '_journey_next_time', '_journey_node',
          '_journey_num', '_journey_quiet_until', '_journey_send_verdict', '_journey_staff_tenant',
          '_journey_unsubscribe', '_journeys_erase_account', '_log_emit_error',
          '_membership_tier_for_user', '_pricing_v62_owner_decisions', '_revenue_facts_catalog',
          '_revenue_facts_checkout',
          '_revenue_facts_clubs', '_revenue_facts_coupons', '_revenue_facts_crm',
          '_revenue_facts_data_quality', '_revenue_facts_dunning', '_revenue_facts_events',
          '_revenue_facts_funnel', '_revenue_facts_journeys', '_revenue_facts_metering',
          '_revenue_facts_newsletter', '_revenue_facts_paywall', '_revenue_facts_retention',
          '_revenue_facts_sync', '_revenue_facts_workflows', '_revenue_ledger_redact_orphans',
          '_revenue_ledger_redact_subscription', '_revenue_movements', '_revenue_mrr_at',
          '_revenue_realized', '_revenue_segments_recompute', '_tier_rank_of',
          'billing_catalog_entry',
          'billing_months_per_interval', 'crm_set_lifecycle_stage', 'data_retention_run',
          'email_queue_send_recheck', 'journey_advance',
          'journey_can_send', 'journey_claim_due', 'journey_complete_email_step',
          'journey_contact_for_send', 'journey_eval_predicate', 'journey_fail_step',
          'journey_ingest_inbox', 'journey_purge', 'journey_record_message_event',
          'journey_resolve_lead', 'journey_rollup_daily', 'journey_tick_emit_stats',
          'journey_validate_graph', 'metering_defaults', 'newsletter_subscriber_list_set',
          'record_paywall_hit_visitor', 'revenue_segment_of_tier', 'run_retention_flow_scanner',
          'run_revenue_lifecycle_scanner', 'subscription_mrr_minor', 'tg_b2b_coupon_campaigns_emit',
          'tg_auth_users_hub_erasure', 'tg_auth_users_revenue_redact', 'tg_b2b_coupon_redemptions_emit',
          'tg_b2b_coupons_emit',
          'tg_billing_documents_renewed_emit', 'tg_checkout_settings_emit',
          'tg_club_applications_emit', 'tg_content_access_emit', 'tg_crm_leads_stage_history',
          'tg_event_registrations_attended_emit', 'tg_journey_route_event',
          'tg_member_organizations_team_seat_cap', 'tg_metering_settings_emit',
          'tg_newsletter_settings_emit', 'tg_organization_seats_team_seat_cap',
          'tg_payment_orders_checkout_emit', 'tg_profiles_account_registered_emit',
          'tg_retention_feedback_emit', 'tg_retention_reasons_emit', 'tg_retention_settings_emit',
          'tg_subscriptions_revenue_history', 'tg_subscriptions_revenue_redact',
          'tg_workflow_definitions_emit'
        ]::name[]) $$,
  'hub_grants: funkcje serwisowe, wewnętrzne i wyzwalacze huba bez EXECUTE dla anon i authenticated');
-- hub-grants:end
SELECT ok((
  SELECT bool_and(EXISTS (
           SELECT 1 FROM unnest(p.proconfig) c
            WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp%'))
    FROM pg_proc p
   WHERE p.oid IN ('public._log_emit_error(uuid, text, text, text, text)'::regprocedure,
                   'public._tier_rank_of(uuid, text)'::regprocedure,
                   'public.tier_rank_of(text)'::regprocedure,
                   'public.metering_defaults()'::regprocedure,
                   'public.revenue_segment_of_tier(text)'::regprocedure)),
  'search_path: każda z 5 funkcji ma przypiętą ścieżkę z pg_temp');
SELECT ok(
  (SELECT bool_and(p.prosecdef) FROM pg_proc p
    WHERE p.oid IN ('public._log_emit_error(uuid, text, text, text, text)'::regprocedure,
                    'public._tier_rank_of(uuid, text)'::regprocedure,
                    'public.tier_rank_of(text)'::regprocedure))
  AND (SELECT bool_and(p.provolatile = 'i') FROM pg_proc p
        WHERE p.oid IN ('public.metering_defaults()'::regprocedure,
                        'public.revenue_segment_of_tier(text)'::regprocedure)),
  'atrybuty: helpery z danymi SECURITY DEFINER, metering_defaults i segment IMMUTABLE');

-- ── 2. _log_emit_error ───────────────────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT public._log_emit_error('ac000000-0000-0000-0000-0000000000a0', 'tg_hub_probe_emit',
                                   'hub_probe.changed.v1', '23505', 'duplicate key value') $$,
  'log: pełne wywołanie nie rzuca');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE tenant_id = 'ac000000-0000-0000-0000-0000000000a0' AND source = 'tg_hub_probe_emit'
             AND event_type = 'hub_probe.changed.v1' AND sqlstate = '23505'
             AND error = 'duplicate key value'),
  'log: wiersz z najemcą, źródłem, typem, sqlstate i komunikatem');

SELECT lives_ok(
  $$ SELECT public._log_emit_error(NULL, NULL, NULL, NULL, NULL) $$,
  'log: NULL w każdym argumencie nie rzuca');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE tenant_id IS NULL AND source = 'unknown' AND event_type = 'unknown' AND error = 'unknown'),
  'log: NULL-e zapisane jako unknown - awaria nie znika bez śladu');

SELECT lives_ok(
  $$ SELECT public._log_emit_error('ac000000-0000-0000-0000-0000000000a0', 'tg_hub_probe_emit',
                                   'hub_probe.changed.v1') $$,
  'log: wywołanie trójargumentowe (kształt ze specyfikacji) nie rzuca');

SELECT public._log_emit_error('ac000000-0000-0000-0000-0000000000a0', 'tg_hub_long_emit',
                              'hub_probe.changed.v1', 'XX000', repeat('e', 2001));
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE source = 'tg_hub_long_emit' AND error = 'message_too_long' AND sqlstate = 'XX000'),
  'log: komunikat > 2000 znaków odrzucony znacznikiem message_too_long (bez przycinania, sqlstate zachowany)');

SELECT public._log_emit_error('ac000000-0000-0000-0000-0000000000ff', 'tg_hub_orphan_emit',
                              'hub_probe.changed.v1', '23503', 'gone');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE source = 'tg_hub_orphan_emit' AND tenant_id IS NULL AND error = 'gone'),
  'log: nieistniejący najemca - ślad bez powiązania zamiast zgubionego wiersza');

-- Kontrakt emiterów S1-S5: SQLSTATE/SQLERRM z handlera WOŁAJĄCEGO.
DO $$
BEGIN
  PERFORM 1 / 0;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error('ac000000-0000-0000-0000-0000000000b0', 'tg_hub_handler_emit',
                                 'hub_probe.changed.v1', SQLSTATE, SQLERRM);
END $$;
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_event_emit_errors
           WHERE source = 'tg_hub_handler_emit' AND sqlstate = '22012' AND error = 'division by zero'),
  'log: emiter przekazuje SQLSTATE i SQLERRM ze swojego handlera');

-- ── 3. Odczyt śladu awarii ───────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.domain_event_emit_errors
    WHERE tenant_id IS DISTINCT FROM 'ac000000-0000-0000-0000-0000000000a0'),
  0,
  'odczyt: admin A widzi wyłącznie awarie swojego najemcy');
SELECT ok(
  (SELECT count(*) FROM public.domain_event_emit_errors) >= 3,
  'odczyt: admin A widzi awarie swojego najemcy');

-- ── 4. tier_rank_of: najemca z sesji ─────────────────────────────────────────
RESET ROLE;
INSERT INTO public.membership_tiers (tenant_id, key, name_pl, name_en, rank) VALUES
  ('ac000000-0000-0000-0000-0000000000a0', 'hub_rank_probe', 'Próbka', 'Probe', 17),
  ('ac000000-0000-0000-0000-0000000000b0', 'hub_rank_probe', 'Próbka', 'Probe', 42);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
SELECT is(public.tier_rank_of('hub_rank_probe'), 17, 'tier_rank_of: użytkownik A dostaje rangę warstwy najemcy A');
SELECT is(public.tier_rank_of('hub_rank_missing'), NULL::int, 'tier_rank_of: nieznany klucz -> NULL');

SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-00000000b001","role":"authenticated"}', true);
SELECT is(public.tier_rank_of('hub_rank_probe'), 42, 'tier_rank_of: użytkownik B dostaje rangę warstwy najemcy B');

-- Editor A nie widzi cudzych awarii ani własnych (tylko admin najemcy).
SELECT set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-00000000a002","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.domain_event_emit_errors),
  0,
  'odczyt: editor nie czyta śladu awarii emiterów');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT public.tier_rank_of('member') $$,
  '42501', NULL, 'tier_rank_of: anon bez EXECUTE');
RESET ROLE;

-- ── 5. metering_defaults() = kontrakt = domyślne kolumn ──────────────────────
SELECT is(
  public.metering_defaults(),
  '{"enabled": true, "member_monthly_limit": 5, "anon_monthly_limit": 0, "meter_paid": true, "meter_members": true, "show_counter": true}'::jsonb,
  'metering_defaults: wartości kontraktu (METERING_DEFAULTS)');

DELETE FROM public.metering_settings WHERE tenant_id = 'ac000000-0000-0000-0000-0000000000a0';
INSERT INTO public.metering_settings (tenant_id) VALUES ('ac000000-0000-0000-0000-0000000000a0');
SELECT is(
  (SELECT to_jsonb(m) - 'tenant_id' - 'updated_at' - 'updated_by'
     FROM public.metering_settings m WHERE m.tenant_id = 'ac000000-0000-0000-0000-0000000000a0'),
  public.metering_defaults(),
  'metering_defaults: równe wierszowi metering_settings wstawionemu z samym tenant_id');

-- ── 6. revenue_segment_of_tier ───────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT k, public.revenue_segment_of_tier(k)
       FROM unnest(ARRAY['reader','supporter','member','student','educator','pro','ngo','vip','team',
                         'business','corporate','partner','partner_general','presidents_circle',
                         'decision_lab','hub_unknown_tier']) WITH ORDINALITY AS t(k, n)
      ORDER BY n $$,
  $$ VALUES ('reader', 'other'), ('supporter', 'other'), ('member', 'b2c_individual'),
            ('student', 'b2c_reduced'), ('educator', 'b2c_reduced'), ('pro', 'b2c_individual'),
            ('ngo', 'b2b_institution'), ('vip', 'other'), ('team', 'b2b_institution'),
            ('business', 'b2b_institution'), ('corporate', 'b2b_institution'),
            ('partner', 'b2b_institution'), ('partner_general', 'b2b_institution'),
            ('presidents_circle', 'b2b_institution'),
            ('decision_lab', 'other'), ('hub_unknown_tier', 'other') $$,
  'segment: 14 kluczy TIER_RANKS, decision_lab i nieznany klucz wg mapy z typu klienta (I9b, 20261020160000)');
SELECT is(public.revenue_segment_of_tier(NULL), 'other', 'segment: NULL -> other');
SELECT is_empty(
  $$ SELECT mt.key FROM public.membership_tiers mt
      WHERE mt.tenant_id = 'ac000000-0000-0000-0000-0000000000a0'
        AND mt.key <> 'hub_rank_probe'
        AND mt.key <> ALL (ARRAY['reader','supporter','member','student','educator','pro','ngo','vip','team',
                                 'business','corporate','partner','partner_general','presidents_circle',
                                 'decision_lab']) $$,
  'segment: seed warstw nowego najemcy nie ma kluczy spoza listy objętej testem');

SELECT * FROM finish();
ROLLBACK;
