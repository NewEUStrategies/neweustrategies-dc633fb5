-- Run after the event harness on its disposable database. Fixtures roll back.
-- Reports timings, no hardware-dependent pass threshold.
\timing on
BEGIN;
INSERT INTO auth.users(id, email) VALUES ('99200000-0000-4000-8000-000000000001', 'performance@example.test');
INSERT INTO public.profiles(id, tenant_id) VALUES ('99200000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.user_roles(user_id, role) VALUES ('99200000-0000-4000-8000-000000000001', 'admin');
SELECT pg_temp.act_as('99200000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.events(id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
VALUES ('99200000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'integration-performance', 'Pomiar', 'Measurement', now() + interval '30 days', 'draft', 'form');
INSERT INTO public.event_people(id, tenant_id, email, first_name, last_name)
SELECT md5('event-performance-person-' || n)::uuid, '11111111-1111-1111-1111-111111111111', 'performance-' || n || '@example.test', 'Test', lpad(n::text, 6, '0')
FROM generate_series(1, 50000) n;
INSERT INTO public.event_registrations(id, tenant_id, event_id, person_id, registration_mode, status, payment_status)
SELECT md5('event-performance-registration-' || n)::uuid, '11111111-1111-1111-1111-111111111111', '99200000-0000-4000-8000-000000000002', md5('event-performance-person-' || n)::uuid, 'form', 'pending', 'not_required'
FROM generate_series(1, 50000) n;
ANALYZE public.event_people;
ANALYZE public.event_registrations;
\echo 'PERFORMANCE: 50000 registrations, first page / last page / search / CSV batch'
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.admin_event_registrations_list('99200000-0000-4000-8000-000000000002', p_limit => 50, p_offset => 0);
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.admin_event_registrations_list('99200000-0000-4000-8000-000000000002', p_limit => 50, p_offset => 49950);
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.admin_event_registrations_list('99200000-0000-4000-8000-000000000002', p_limit => 50, p_q => '049999');
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.admin_event_registrations_list('99200000-0000-4000-8000-000000000002', p_limit => 200);
ROLLBACK;
