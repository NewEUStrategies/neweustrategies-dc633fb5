-- Publication blockers are enforced by the real RPC, not only by the UI.
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('99000000-0000-4000-8000-000000000001', 'publication@example.test');
INSERT INTO public.profiles (id, tenant_id, display_name)
VALUES ('99000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'Publication admin');
INSERT INTO public.user_roles (user_id, role) VALUES ('99000000-0000-4000-8000-000000000001', 'admin');
SELECT pg_temp.act_as('99000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at,
  timezone, format, city, street_address, cover_url, status)
VALUES ('99000000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
  'publication-test', 'Publikacja', 'Publication', now() + interval '30 days', now() + interval '31 days',
  'Europe/Warsaw', 'onsite', 'Warszawa', 'Testowa 1', 'https://example.test/cover.jpg', 'draft');

DO $$
DECLARE
  v_id uuid := '99000000-0000-4000-8000-000000000002';
  v_case record;
  v_before jsonb;
BEGIN
  PERFORM pg_temp.assert(public.admin_event_publish_readiness(v_id) = ARRAY[]::text[], 'publication: complete event is ready');
  FOR v_case IN SELECT * FROM (VALUES
    ('timezone', 'timezone', 'Invalid/Zone'),
    ('venue', 'street_address', ''), ('venue', 'city', ''), ('cover', 'cover_url', '')
  ) AS cases(blocker, column_name, bad_value)
  LOOP
    SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE id = v_id;
    EXECUTE format('UPDATE public.events SET %I = %L WHERE id = %L', v_case.column_name, v_case.bad_value, v_id);
    PERFORM pg_temp.assert(v_case.blocker = ANY(public.admin_event_publish_readiness(v_id)), 'publication: report includes ' || v_case.blocker);
    PERFORM pg_temp.assert_raises_like(format('SELECT public.admin_event_set_status(%L, ''published'')', v_id),
      'publish_blocked: ' || v_case.blocker, 'publication: direct RPC rejects ' || v_case.blocker);
    PERFORM pg_temp.assert((SELECT status = 'draft' AND published_at IS NULL FROM public.events WHERE id = v_id), 'publication: refusal leaves status and timestamp intact');
    EXECUTE format('UPDATE public.events SET %I = %L WHERE id = %L', v_case.column_name, v_before->>v_case.column_name, v_id);
  END LOOP;
END $$;

INSERT INTO public.event_sessions (id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status, format)
VALUES ('99000000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
  '99000000-0000-4000-8000-000000000002', 'Po wydarzeniu', 'After the event', now() + interval '30 days 2 hours', now() + interval '30 days 3 hours', 'draft', 'onsite');
UPDATE public.events SET ends_at = now() + interval '30 days 1 hour' WHERE id = '99000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_set_status(''99000000-0000-4000-8000-000000000002'', ''published'')',
  'publish_blocked: conflicts', 'publication: agenda conflict rejects direct RPC');
UPDATE public.event_sessions SET status = 'cancelled' WHERE id = '99000000-0000-4000-8000-000000000003';
SELECT pg_temp.assert(public.admin_event_set_status('99000000-0000-4000-8000-000000000002', 'published') = 'published', 'publication: warnings do not block');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM public.event_pages WHERE event_id = '99000000-0000-4000-8000-000000000002'), 'publication: canonical replay seeds module pages');
SELECT pg_temp.assert(public.admin_event_set_status('99000000-0000-4000-8000-000000000002', 'draft') = 'draft', 'publication: draft transition stays available');

-- Verify the final v2 function on a clean replay, including tenant type validation.
SELECT public.admin_event_general_save_v2((SELECT to_jsonb(e) FROM public.events e WHERE e.id = '99000000-0000-4000-8000-000000000002') || jsonb_build_object(
  'id', '99000000-0000-4000-8000-000000000002', 'subtitle_pl', 'Podtytuł', 'subtitle_en', 'Subtitle',
  'event_type_id', (SELECT id FROM public.event_types WHERE tenant_id = '11111111-1111-1111-1111-111111111111' AND is_active LIMIT 1)));
SELECT pg_temp.assert((SELECT subtitle_pl = 'Podtytuł' AND subtitle_en = 'Subtitle' FROM public.events WHERE id = '99000000-0000-4000-8000-000000000002'), 'general v2: subtitles survive clean replay');
SELECT pg_temp.assert_raises_like(
  'SELECT public.admin_event_general_save_v2((SELECT to_jsonb(e) FROM public.events e WHERE e.id = ''99000000-0000-4000-8000-000000000002'') || ''{"id":"99000000-0000-4000-8000-000000000002","event_type_id":"99000000-0000-4000-8000-000000000099"}''::jsonb)',
  'invalid_event_type', 'general v2: unknown type is rejected');
INSERT INTO public.tenants(id, name, slug) VALUES ('22222222-2222-2222-2222-222222222222', 'Foreign publication', 'foreign-publication') ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id, email) VALUES ('99000000-0000-4000-8000-000000000010', 'foreign-publication@example.test');
INSERT INTO public.profiles (id, tenant_id, display_name) VALUES ('99000000-0000-4000-8000-000000000010', '22222222-2222-2222-2222-222222222222', 'Foreign admin');
INSERT INTO public.user_roles (user_id, role) VALUES ('99000000-0000-4000-8000-000000000010', 'admin');
SELECT pg_temp.act_as('99000000-0000-4000-8000-000000000010', '22222222-2222-2222-2222-222222222222');
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_publish_readiness(''99000000-0000-4000-8000-000000000002'')', 'not_found', 'publication: foreign tenant cannot read readiness');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_publish_readiness(''99000000-0000-4000-8000-000000000002'')', 'forbidden', 'publication: anonymous caller is rejected');
ROLLBACK;
