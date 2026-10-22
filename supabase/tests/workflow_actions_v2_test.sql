-- pgTAP: akcje v2 wspólnego `run_workflow_step` i pisarz list newslettera
-- (migracja 20261020130200, hub S4).
--
-- Sprawdza:
--   * każdą nową akcję: set_lifecycle_stage (z pierwszeństwem), set_crm_stage
--     (historia ze źródłem `workflow`), add_tag / remove_tag (limit
--     `CRM_TAG_MAX` = 64 znaki od I9b 20261020160800, Z-S5-02 - odrzucany,
--     nie przycinany), assign_owner (tylko personel, bez nadpisania
--     domyślnie), newsletter_list_add / _remove (meta + lustro tagu CRM,
--     nieznana lista i przekroczony limit 500 znaków odrzucone);
--   * create_crm_task: `assignee_id` / właściciel / domyślna osoba ścieżek
--     (P24), `source`, `origin_ref` idempotentny (powtórka = jedno zadanie),
--     za długi `origin_ref` odrzucony;
--   * create_crm_lead z `marketing: true` NIE włącza zgody (D9);
--   * D1: przepis `newsletter-confirmed-to-crm` zakłada lead Z PRZEPISU -
--     przy wyłączonych `trg_newsletter_to_lead` i `subscriber_sync_crm_lead`;
--   * zachowania sprzed v2: nieznana akcja = wyjątek, notify_staff działa;
--   * ACL: obie funkcje tylko dla service_role.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test workflow_actions_v2
BEGIN;
SELECT plan(29);

-- ── Fixture ──────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d4300000-0000-0000-0000-0000000000a0', 'hub-s4-wf-a', 'Hub S4 przepisy A'),
  ('d4300000-0000-0000-0000-0000000000b0', 'hub-s4-wf-b', 'Hub S4 przepisy B');

INSERT INTO auth.users (id, email) VALUES
  ('d4300000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-wf.test'),
  ('d4300000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-wf.test'),
  ('d4300000-0000-0000-0000-00000000a003', 'czytelnik-a@hub-s4-wf.test'),
  ('d4300000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-wf.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d4300000-0000-0000-0000-00000000a001', 'admin-a@hub-s4-wf.test', 'Admin A', 'd4300000-0000-0000-0000-0000000000a0'),
  ('d4300000-0000-0000-0000-00000000a002', 'editor-a@hub-s4-wf.test', 'Editor A', 'd4300000-0000-0000-0000-0000000000a0'),
  ('d4300000-0000-0000-0000-00000000a003', 'czytelnik-a@hub-s4-wf.test', 'Czytelnik A', 'd4300000-0000-0000-0000-0000000000a0'),
  ('d4300000-0000-0000-0000-00000000b001', 'admin-b@hub-s4-wf.test', 'Admin B', 'd4300000-0000-0000-0000-0000000000b0');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('d4300000-0000-0000-0000-00000000a001', 'admin', 'd4300000-0000-0000-0000-0000000000a0'),
  ('d4300000-0000-0000-0000-00000000a002', 'editor', 'd4300000-0000-0000-0000-0000000000a0'),
  ('d4300000-0000-0000-0000-00000000b001', 'admin', 'd4300000-0000-0000-0000-0000000000b0');

INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, owner_id) VALUES
  ('d4300000-0000-0000-0000-0000000001a1', 'd4300000-0000-0000-0000-0000000000a0', 'lead@hub-s4-wf.test', 'lead@hub-s4-wf.test', NULL),
  ('d4300000-0000-0000-0000-0000000001a2', 'd4300000-0000-0000-0000-0000000000a0', 'owned@hub-s4-wf.test', 'owned@hub-s4-wf.test', 'd4300000-0000-0000-0000-00000000a002');

INSERT INTO public.newsletter_settings (tenant_id, popup_mailing_lists)
VALUES ('d4300000-0000-0000-0000-0000000000a0', '[{"id":"geo","label_pl":"Geopolityka"},{"id":"energia","label_pl":"Energia"}]'::jsonb)
ON CONFLICT (tenant_id) DO UPDATE SET popup_mailing_lists = EXCLUDED.popup_mailing_lists;

INSERT INTO public.newsletter_subscribers (id, tenant_id, email, status, meta) VALUES
  ('d4300000-0000-0000-0000-0000000005a1', 'd4300000-0000-0000-0000-0000000000a0', 'lead@hub-s4-wf.test', 'subscribed',
   '{"mailing_list":"energia","company":"ACME"}'::jsonb);

-- Zdarzenie syntetyczne: agregat leada albo konto w ładunku.
CREATE FUNCTION pg_temp.ev(p_type text, p_agg_type text, p_agg_id text, p_payload jsonb, p_id uuid DEFAULT gen_random_uuid())
RETURNS public.domain_events LANGUAGE sql AS $$
  SELECT jsonb_populate_record(NULL::public.domain_events, jsonb_build_object(
    'id', p_id, 'tenant_id', 'd4300000-0000-0000-0000-0000000000a0',
    'aggregate_type', p_agg_type, 'aggregate_id', p_agg_id, 'event_type', p_type,
    'payload', p_payload, 'created_at', now()))
$$;
CREATE FUNCTION pg_temp.lead_ev() RETURNS public.domain_events LANGUAGE sql AS $$
  SELECT pg_temp.ev('crm_lead.updated.v1', 'crm_lead', 'd4300000-0000-0000-0000-0000000001a1', '{}'::jsonb)
$$;

-- ── 1. ACL ───────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.run_workflow_step(public.domain_events,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.run_workflow_step(public.domain_events,jsonb)', 'EXECUTE'),
  'acl: run_workflow_step wyłącznie dla service_role');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.newsletter_subscriber_list_set(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.newsletter_subscriber_list_set(uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.newsletter_subscriber_list_set(uuid,text,text)', 'EXECUTE'),
  'acl: newsletter_subscriber_list_set wyłącznie dla service_role');

-- ── 2. Cykl życia i etap CRM ────────────────────────────────────────────────
SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"set_lifecycle_stage","params":{"stage":"mql"}}');
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'd4300000-0000-0000-0000-0000000001a1'),
  'mql', 'set_lifecycle_stage: przepis ustawia etap cyklu życia');
SELECT is(
  (SELECT source FROM public.crm_lead_stage_history
    WHERE lead_id = 'd4300000-0000-0000-0000-0000000001a1' AND dimension = 'lifecycle'),
  'workflow', 'set_lifecycle_stage: historia ze źródłem workflow');
SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"set_lifecycle_stage","params":{"stage":"customer"}}');
SELECT is(
  (SELECT lifecycle_stage FROM public.crm_leads WHERE id = 'd4300000-0000-0000-0000-0000000001a1'),
  'mql', 'set_lifecycle_stage: przepis nie nada etapu klienta (krok udany, bez zmiany)');
SELECT throws_ok(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"set_lifecycle_stage","params":{"stage":"vip"}}') $$,
  '22023', 'lifecycle_stage_invalid', 'set_lifecycle_stage: etap spoza listy = wyjątek (przebieg failed)');

SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"set_crm_stage","params":{"stage":"qualified"}}');
SELECT is(
  (SELECT l.stage::text || '|' || h.source FROM public.crm_leads l
     JOIN public.crm_lead_stage_history h ON h.lead_id = l.id AND h.dimension = 'crm_stage'
    WHERE l.id = 'd4300000-0000-0000-0000-0000000001a1'),
  'qualified|workflow', 'set_crm_stage: etap sprzedaży + historia ze źródłem workflow');

-- ── 3. Tagi ──────────────────────────────────────────────────────────────────
SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"add_tag","params":{"tag":"webinar-2026"}}');
SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"add_tag","params":{"tag":"webinar-2026"}}');
SELECT is(
  (SELECT array_length(array_positions(tags, 'webinar-2026'), 1) FROM public.crm_leads
    WHERE id = 'd4300000-0000-0000-0000-0000000001a1'),
  1, 'add_tag: tag dodany raz (powtórka bez duplikatu)');
SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"remove_tag","params":{"tag":"webinar-2026"}}');
SELECT ok(
  (SELECT NOT ('webinar-2026' = ANY (tags)) FROM public.crm_leads WHERE id = 'd4300000-0000-0000-0000-0000000001a1'),
  'remove_tag: tag usunięty');
SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(),
       jsonb_build_object('action', 'add_tag', 'params', jsonb_build_object('tag', repeat('x', 65)))) $$,
  '%1-64 characters%', 'add_tag: tag dłuższy niż 64 znaki odrzucony (nie przycięty)');

-- ── 4. Właściciel ────────────────────────────────────────────────────────────
SELECT public.run_workflow_step(pg_temp.lead_ev(),
  '{"action":"assign_owner","params":{"owner_id":"d4300000-0000-0000-0000-00000000a001"}}');
SELECT is(
  (SELECT owner_id::text FROM public.crm_leads WHERE id = 'd4300000-0000-0000-0000-0000000001a1'),
  'd4300000-0000-0000-0000-00000000a001', 'assign_owner: pusty właściciel ustawiony');
SELECT public.run_workflow_step(
  pg_temp.ev('crm_lead.updated.v1', 'crm_lead', 'd4300000-0000-0000-0000-0000000001a2', '{}'),
  '{"action":"assign_owner","params":{"owner_id":"d4300000-0000-0000-0000-00000000a001"}}');
SELECT is(
  (SELECT owner_id::text FROM public.crm_leads WHERE id = 'd4300000-0000-0000-0000-0000000001a2'),
  'd4300000-0000-0000-0000-00000000a002', 'assign_owner: bez overwrite istniejący właściciel zostaje');
SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(),
       '{"action":"assign_owner","params":{"owner_id":"d4300000-0000-0000-0000-00000000b001"}}') $$,
  '%not CRM staff%', 'assign_owner: personel innego najemcy odrzucony');

-- ── 5. Listy newslettera ────────────────────────────────────────────────────
SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"newsletter_list_add","params":{"list_key":"geo"}}');
SELECT is(
  (SELECT meta FROM public.newsletter_subscribers WHERE id = 'd4300000-0000-0000-0000-0000000005a1'),
  '{"company":"ACME","mailing_lists":"energia,geo"}'::jsonb,
  'newsletter_list_add: lista dopisana, stary klucz mailing_list wchłonięty, reszta meta zostaje');
SELECT ok(
  (SELECT 'lista:geo' = ANY (tags) FROM public.crm_leads WHERE id = 'd4300000-0000-0000-0000-0000000001a1'),
  'newsletter_list_add: lustro tagu lista:geo w CRM');
SELECT public.run_workflow_step(
  pg_temp.ev('newsletter_subscriber.confirmed.v1', 'newsletter_subscriber', 'd4300000-0000-0000-0000-0000000005a1', '{}'),
  '{"action":"newsletter_list_remove","params":{"list_key":"geo"}}');
SELECT is(
  (SELECT (meta ->> 'mailing_lists') || '|' || ('lista:geo' = ANY (l.tags))::text
     FROM public.newsletter_subscribers s, public.crm_leads l
    WHERE s.id = 'd4300000-0000-0000-0000-0000000005a1' AND l.id = 'd4300000-0000-0000-0000-0000000001a1'),
  'energia|false', 'newsletter_list_remove: lista i tag CRM usunięte (subskrybent z agregatu)');
SELECT throws_ok(
  $$ SELECT public.newsletter_subscriber_list_set('d4300000-0000-0000-0000-0000000005a1', 'nieznana', 'add') $$,
  '22023', 'newsletter_list_unknown', 'listy: lista spoza katalogu najemcy odrzucona');
UPDATE public.newsletter_settings
   SET popup_mailing_lists = popup_mailing_lists || jsonb_build_array(jsonb_build_object('id', repeat('d', 495)))
 WHERE tenant_id = 'd4300000-0000-0000-0000-0000000000a0';
SELECT throws_ok(
  format($$ SELECT public.newsletter_subscriber_list_set('d4300000-0000-0000-0000-0000000005a1', %L, 'add') $$, repeat('d', 495)),
  '22001', 'newsletter_mailing_lists_too_long', 'listy: zapis > 500 znaków odrzucony (bez przycięcia)');

-- ── 6. Zadanie CRM: osoba, źródło, idempotencja ─────────────────────────────
INSERT INTO public.journey_settings (tenant_id, default_task_assignee_id)
VALUES ('d4300000-0000-0000-0000-0000000000a0', 'd4300000-0000-0000-0000-00000000a002');
SELECT public.run_workflow_step(
  pg_temp.ev('subscription.updated.v1', 'subscription', 'x1', '{"user_id":"d4300000-0000-0000-0000-00000000a003"}',
             'd4300000-0000-0000-0000-0000000009a1'),
  '{"action":"create_crm_task","params":{"title":"Retencja","origin_ref":"retention:test:{event_id}"}}');
SELECT public.run_workflow_step(
  pg_temp.ev('subscription.updated.v1', 'subscription', 'x1', '{"user_id":"d4300000-0000-0000-0000-00000000a003"}',
             'd4300000-0000-0000-0000-0000000009a1'),
  '{"action":"create_crm_task","params":{"title":"Retencja (inny tytuł)","origin_ref":"retention:test:{event_id}"}}');
SELECT is(
  (SELECT count(*)::int FROM public.crm_tasks WHERE origin_ref = 'retention:test:d4300000-0000-0000-0000-0000000009a1'),
  1, 'create_crm_task: ten sam origin_ref = jedno zadanie (powtórka kroku)');
SELECT is(
  (SELECT source || '|' || assignee_id::text FROM public.crm_tasks
    WHERE origin_ref = 'retention:test:d4300000-0000-0000-0000-0000000009a1'),
  'workflow|d4300000-0000-0000-0000-00000000a002',
  'create_crm_task: źródło workflow, osoba z journey_settings przy leadzie bez właściciela (P24)');
SELECT public.run_workflow_step(pg_temp.lead_ev(),
  '{"action":"create_crm_task","params":{"title":"Telefon","assignee_id":"d4300000-0000-0000-0000-00000000a001","due_hours":"4"}}');
SELECT ok(
  (SELECT assignee_id = 'd4300000-0000-0000-0000-00000000a001'
          AND origin_ref LIKE 'wf:%'
          AND due_at BETWEEN now() + interval '3 hours 59 minutes' AND now() + interval '4 hours 1 minute'
     FROM public.crm_tasks WHERE lead_id = 'd4300000-0000-0000-0000-0000000001a1' AND title = 'Telefon'),
  'create_crm_task: assignee_id z parametru, domyślny origin_ref wf:, termin w godzinach');
SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(),
       jsonb_build_object('action', 'create_crm_task',
         'params', jsonb_build_object('title', 'Za długi', 'origin_ref', repeat('r', 201)))) $$,
  '%origin_ref longer than 200%', 'create_crm_task: origin_ref > 200 znaków odrzucony, nie przycięty');
SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(),
       '{"action":"create_crm_task","params":{"title":"Obcy","assignee_id":"d4300000-0000-0000-0000-00000000b001"}}') $$,
  '%assignee is not CRM staff%', 'create_crm_task: osoba spoza personelu najemcy odrzucona');

-- ── 7. create_crm_lead: D9 i D1 ─────────────────────────────────────────────
-- Świeży adres (bez subskrybenta i bez leada): zgoda może pochodzić tylko
-- z parametru przepisu, a ten jest ignorowany.
SELECT public.run_workflow_step(
  pg_temp.ev('form_submission.created.v1', 'form_submission', 'f-d9',
             '{"email":"d9@hub-s4-wf.test","first_name":"Ewa"}'),
  '{"action":"create_crm_lead","params":{"newsletter":true,"marketing":true}}');
SELECT is(
  (SELECT first_name || '|' || marketing_consent::text FROM public.crm_leads
    WHERE tenant_id = 'd4300000-0000-0000-0000-0000000000a0' AND email_norm = 'd9@hub-s4-wf.test'),
  'Ewa|false', 'D9: create_crm_lead z marketing:true nie włącza zgody marketingowej');
SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.ev('post.published.v1', 'post', 'p1', '{}'),
       '{"action":"create_crm_lead","params":{}}') $$,
  '%no email resolvable%', 'D1: create_crm_lead bez adresu = wyjątek, nie cichy sukces');

-- D1 na prawdziwej szynie: obie ścieżki DB newsletter -> CRM wyłączone,
-- lead MUSI powstać z przepisu zainstalowanego dla najemcy.
ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER trg_newsletter_to_lead;
ALTER TABLE public.newsletter_subscribers DISABLE TRIGGER subscriber_sync_crm_lead;
INSERT INTO public.newsletter_subscribers (id, tenant_id, email, first_name, status) VALUES
  ('d4300000-0000-0000-0000-0000000005a2', 'd4300000-0000-0000-0000-0000000000a0', 'doi@hub-s4-wf.test', 'Dorota', 'pending');
UPDATE public.newsletter_subscribers SET confirmed_at = now(), status = 'subscribed'
 WHERE id = 'd4300000-0000-0000-0000-0000000005a2';
ALTER TABLE public.newsletter_subscribers ENABLE TRIGGER trg_newsletter_to_lead;
ALTER TABLE public.newsletter_subscribers ENABLE TRIGGER subscriber_sync_crm_lead;
SELECT is(
  (SELECT first_name || '|' || COALESCE(newsletter_status, '-') || '|' || marketing_consent::text
     FROM public.crm_leads
    WHERE tenant_id = 'd4300000-0000-0000-0000-0000000000a0' AND email_norm = 'doi@hub-s4-wf.test'),
  'Dorota|pending|false',
  'D1: przepis newsletter-confirmed-to-crm zakłada lead z przepisu (adres z wiersza subskrybenta)');
SELECT is(
  (SELECT r.status FROM public.workflow_runs r
     JOIN public.workflow_definitions d ON d.id = r.workflow_id
     JOIN public.domain_events e ON e.id = r.event_id
    WHERE d.template_key = 'newsletter-confirmed-to-crm'
      AND e.aggregate_id = 'd4300000-0000-0000-0000-0000000005a2'),
  'succeeded', 'D1: przebieg przepisu succeeded - i tym razem naprawdę coś zrobił');

-- ── 8. Zachowania sprzed v2 ─────────────────────────────────────────────────
SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(), '{"action":"send_sms","params":{}}') $$,
  '%unknown action send_sms%', 'katalog: nieznana akcja = wyjątek (kontrakt z WORKFLOW_ACTIONS)');
SELECT public.run_workflow_step(pg_temp.lead_ev(),
  '{"action":"notify_staff","params":{"title_pl":"Test S4","title_en":"S4 test","roles":["admin"]}}');
SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'd4300000-0000-0000-0000-00000000a001' AND title_pl = 'Test S4'),
  1, 'katalog: notify_staff bez zmian (rola z parametru)');

SELECT * FROM finish();
ROLLBACK;
