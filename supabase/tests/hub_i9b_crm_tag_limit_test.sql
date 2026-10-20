-- pgTAP: jeden limit długości tagu kontaktu CRM - 64 znaki (`CRM_TAG_MAX`)
-- w pisarzu tagów (`run_workflow_step`) i w walidatorze grafu ścieżki
-- (`journey_validate_graph`) (I9b, część B, migracja 20261020160800;
-- decyzja właściciela 2026-10-20, Z-S5-02).
--
-- CO PRZYPINA:
--   * pisarz tagów: tag 64 znaki zapisany, 65 - wyjątek (nigdy przycięcie,
--     tagi leada bez zmian), odstępy na brzegach nie liczą się do limitu
--     (`btrim`), remove_tag z tą samą granicą;
--   * walidator grafu: add_tag/remove_tag 64 znaki bez błędu `tag_length`,
--     65 - błąd `tag_length` przy właściwym węźle;
--   * ACL bez zmian po redefinicji: pisarz tylko dla service_role,
--     walidator bez ról API; SECURITY DEFINER z search_path i pg_temp.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9b_crm_tag_limit
BEGIN;
SELECT plan(12);

INSERT INTO public.tenants (id, slug, name)
VALUES ('19b70000-0000-4000-8000-0000000000a1', 'i9b-tags', 'I9b Tagi');
INSERT INTO public.crm_leads (id, tenant_id, email, email_norm, tags)
VALUES ('19b70000-0000-4000-8000-0000000001a1', '19b70000-0000-4000-8000-0000000000a1',
        'lead@i9b-tags.test', 'lead@i9b-tags.test', ARRAY['stary']);

-- Zdarzenie syntetyczne na agregacie leada (jak workflow_actions_v2_test).
CREATE FUNCTION pg_temp.lead_ev() RETURNS public.domain_events LANGUAGE sql AS $$
  SELECT jsonb_populate_record(NULL::public.domain_events, jsonb_build_object(
    'id', gen_random_uuid(), 'tenant_id', '19b70000-0000-4000-8000-0000000000a1',
    'aggregate_type', 'crm_lead', 'aggregate_id', '19b70000-0000-4000-8000-0000000001a1',
    'event_type', 'crm_lead.updated.v1', 'payload', '{}'::jsonb, 'created_at', now()))
$$;
CREATE FUNCTION pg_temp.tag_step(p_action text, p_tag text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('action', p_action, 'params', jsonb_build_object('tag', p_tag))
$$;
CREATE FUNCTION pg_temp.lead_tags() RETURNS text[] LANGUAGE sql AS $$
  SELECT tags FROM public.crm_leads WHERE id = '19b70000-0000-4000-8000-0000000001a1'
$$;
-- Graf: wyzwalacz -> akcja tagu -> wyjście; zwraca kody błędów walidatora.
CREATE FUNCTION pg_temp.graph_codes(p_type text, p_tag text) RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(
    SELECT e ->> 'code' FROM jsonb_array_elements(
      public.journey_validate_graph(jsonb_build_object(
        'nodes', jsonb_build_array(
          jsonb_build_object('id', 't', 'type', 'trigger', 'params', '{}'::jsonb),
          jsonb_build_object('id', 'tag', 'type', p_type, 'params', jsonb_build_object('tag', p_tag)),
          jsonb_build_object('id', 'x', 'type', 'exit', 'params', '{}'::jsonb)),
        'edges', jsonb_build_array(
          jsonb_build_object('from', 't', 'to', 'tag', 'branch', 'next'),
          jsonb_build_object('from', 'tag', 'to', 'x', 'branch', 'next')))) -> 'errors') e
    ORDER BY 1)
$$;

-- ── A. Pisarz tagów (run_workflow_step) ─────────────────────────────────────
SELECT public.run_workflow_step(pg_temp.lead_ev(), pg_temp.tag_step('add_tag', repeat('a', 64)));
SELECT ok(repeat('a', 64) = ANY (pg_temp.lead_tags()), 'add_tag: tag 64 znaki zapisany');

SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(), pg_temp.tag_step('add_tag', repeat('b', 65))) $$,
  '%tag must have 1-64 characters%', 'add_tag: tag 65 znaków odrzucony');
SELECT is(
  (SELECT count(*)::int FROM unnest(pg_temp.lead_tags()) t WHERE t LIKE 'b%'),
  0, 'add_tag: odrzucony tag nie trafił do leada (ani przycięty do 64)');

SELECT public.run_workflow_step(pg_temp.lead_ev(),
  pg_temp.tag_step('add_tag', '  ' || repeat('c', 64) || '  '));
SELECT ok(repeat('c', 64) = ANY (pg_temp.lead_tags()),
  'add_tag: odstępy na brzegach nie liczą się do limitu (btrim, jak zod .trim())');

SELECT throws_like(
  $$ SELECT public.run_workflow_step(pg_temp.lead_ev(), pg_temp.tag_step('remove_tag', repeat('a', 65))) $$,
  '%tag must have 1-64 characters%', 'remove_tag: tag 65 znaków odrzucony');
SELECT public.run_workflow_step(pg_temp.lead_ev(), pg_temp.tag_step('remove_tag', repeat('a', 64)));
SELECT is(pg_temp.lead_tags(), ARRAY['stary', repeat('c', 64)],
  'remove_tag: tag 64 znaki usunięty, reszta tagów bez zmian');

-- ── B. Walidator grafu ścieżki (journey_validate_graph) ────────────────────
SELECT is(pg_temp.graph_codes('add_tag', repeat('d', 64)), ARRAY[]::text[],
  'walidator: add_tag 64 znaki - graf poprawny');
SELECT is(pg_temp.graph_codes('add_tag', repeat('d', 65)), ARRAY['tag_length'],
  'walidator: add_tag 65 znaków - błąd tag_length');
SELECT is(pg_temp.graph_codes('remove_tag', repeat('d', 65)), ARRAY['tag_length'],
  'walidator: remove_tag 65 znaków - błąd tag_length');
SELECT is(pg_temp.graph_codes('add_tag', '   '), ARRAY['tag_length'],
  'walidator: pusty tag (same odstępy) - błąd tag_length');

-- ── C. ACL po redefinicji ──────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.run_workflow_step(public.domain_events,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.run_workflow_step(public.domain_events,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.run_workflow_step(public.domain_events,jsonb)', 'EXECUTE')
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.run_workflow_step(public.domain_events,jsonb)'::regprocedure),
  'acl: run_workflow_step wyłącznie dla service_role, SECURITY DEFINER');
SELECT ok(
  NOT has_function_privilege('anon', 'public.journey_validate_graph(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.journey_validate_graph(jsonb,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.journey_validate_graph(jsonb,text)', 'EXECUTE')
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']
         FROM pg_proc WHERE oid = 'public.journey_validate_graph(jsonb,text)'::regprocedure),
  'acl: journey_validate_graph bez ról API, SECURITY DEFINER z search_path i pg_temp');

SELECT * FROM finish();
ROLLBACK;
