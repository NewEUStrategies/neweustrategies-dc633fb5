-- Real RPC / trigger integration. All fixtures roll back, no external refunds.
BEGIN;
INSERT INTO auth.users(id, email) VALUES
 ('99100000-0000-4000-8000-000000000001', 'lifecycle-admin@example.test'),
 ('99100000-0000-4000-8000-000000000002', 'lifecycle-attendee@example.test');
INSERT INTO public.profiles(id, tenant_id) VALUES
 ('99100000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111'),
 ('99100000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.user_roles(user_id, role) VALUES ('99100000-0000-4000-8000-000000000001', 'admin');
SELECT pg_temp.act_as('99100000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.events(id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
VALUES ('99100000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111',
 'lifecycle-test', 'Cykl udziału', 'Participation lifecycle', now() + interval '30 days', 'published', 'form');
INSERT INTO public.event_ticket_types(id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, group_registration_enabled, group_max_size)
VALUES ('99100000-0000-4000-8000-000000000004', '11111111-1111-1111-1111-111111111111',
 '99100000-0000-4000-8000-000000000003', 'lifecycle', 'Wstęp', 'Admission', 10000, 'PLN', true, 5);

CREATE FUNCTION pg_temp.lifecycle_registration(p_status text, p_user uuid DEFAULT NULL, p_lead uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_person uuid := gen_random_uuid(); v_id uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.event_people(id, tenant_id, user_id, email, first_name, last_name)
 VALUES (v_person, '11111111-1111-1111-1111-111111111111', p_user, v_person::text || '@example.test', 'Test', 'Lifecycle');
 INSERT INTO public.event_registrations(id, tenant_id, event_id, person_id, ticket_type_id,
   status, registration_mode, payment_status, waitlist_position, group_lead_registration_id)
 VALUES(v_id, '11111111-1111-1111-1111-111111111111', '99100000-0000-4000-8000-000000000003', v_person,
   '99100000-0000-4000-8000-000000000004', p_status, 'form', 'paid',
   CASE WHEN p_status = 'waitlist' THEN 1 END, p_lead);
 RETURN v_id;
END $$;
CREATE FUNCTION pg_temp.lifecycle_order(p_registration uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.payment_orders(id, tenant_id, user_id, status, amount_cents, currency, provider, environment, provider_payment_intent_id, metadata)
 VALUES(v_id, '11111111-1111-1111-1111-111111111111', '99100000-0000-4000-8000-000000000002',
 'paid', 10000, 'PLN', 'stripe', 'sandbox', 'pi_lifecycle_test',
 jsonb_build_object('event_id', '99100000-0000-4000-8000-000000000003',
   'registration_id', p_registration, 'ticket_type_id', '99100000-0000-4000-8000-000000000004'));
 UPDATE public.event_registrations SET payment_order_id = v_id WHERE id = p_registration;
 RETURN v_id;
END $$;

DO $$
DECLARE v_id uuid; v_order uuid; v_job jsonb; v_result jsonb;
BEGIN
 v_id := pg_temp.lifecycle_registration('pending');
 v_order := pg_temp.lifecycle_order(v_id);
 PERFORM public.admin_event_registration_decide(jsonb_build_object('registration_id', v_id, 'action', 'reject', 'note', 'Sandbox lifecycle test'));
 PERFORM pg_temp.assert((SELECT state = 'pending' FROM public.event_registration_refund_jobs WHERE payment_order_id = v_order), 'lifecycle: rejection atomically queues refund');
 v_job := public._event_registration_refunds_claim(1)->0;
 PERFORM pg_temp.assert(v_job->>'order_id' = v_order::text AND v_job->>'environment' = 'sandbox', 'lifecycle: claim uses bound order environment');
 PERFORM pg_temp.assert(public._event_registration_refunds_claim(1) = '[]'::jsonb, 'lifecycle: live lease cannot be claimed twice');
 PERFORM pg_temp.assert_raises_like(format('SELECT public.admin_event_registration_decide(%L::jsonb)', jsonb_build_object('registration_id', v_id, 'action', 'approve')), 'invalid_transition', 'lifecycle: in-flight refund blocks readmission');
 PERFORM pg_temp.assert(NOT public._event_registration_refunds_settle((v_job->>'id')::uuid, gen_random_uuid(), 're_wrong', NULL), 'lifecycle: stale/foreign lease cannot acknowledge');
 PERFORM pg_temp.assert(public._event_registration_refunds_settle((v_job->>'id')::uuid, (v_job->>'claim_token')::uuid, NULL, 'provider_unavailable'), 'lifecycle: failure is persisted');
 PERFORM pg_temp.assert(public._event_registration_refunds_claim(1) = '[]'::jsonb, 'lifecycle: retry observes backoff');
 UPDATE public.event_registration_refund_jobs SET next_attempt_at = now() - interval '1 minute' WHERE payment_order_id = v_order;
 v_job := public._event_registration_refunds_claim(1)->0;
 PERFORM pg_temp.assert(public._event_registration_refunds_settle((v_job->>'id')::uuid, (v_job->>'claim_token')::uuid, 're_lifecycle', NULL), 'lifecycle: provider submission acknowledged');
 v_result := public.payments_apply_event_ticket_outcome(v_order, 'refunded');
 PERFORM pg_temp.assert((v_result->>'applied')::boolean AND (SELECT state = 'completed' FROM public.event_registration_refund_jobs WHERE payment_order_id = v_order), 'lifecycle: webhook completes refund outbox');
 PERFORM pg_temp.assert((SELECT payment_status = 'refunded' AND status = 'cancelled' FROM public.event_registrations WHERE id = v_id), 'lifecycle: completed refund closes admission');
 PERFORM public.payments_apply_event_ticket_outcome(v_order, 'refunded');
 PERFORM pg_temp.assert((SELECT count(*) = 1 FROM public.event_registration_refund_jobs WHERE payment_order_id = v_order), 'lifecycle: repeated outcome does not duplicate refund');
 PERFORM pg_temp.assert(NOT (public.admin_event_refund_jobs('99100000-0000-4000-8000-000000000003')->0 ? 'claim_token'), 'lifecycle: journal does not expose worker lease');
END $$;

DO $$
DECLARE v_lead uuid; v_guest uuid; v_order uuid; v_notice jsonb; v_stamp timestamptz;
BEGIN
 v_lead := pg_temp.lifecycle_registration('approved');
 v_order := pg_temp.lifecycle_order(v_lead);
 v_guest := pg_temp.lifecycle_registration('approved', NULL, v_lead);
 UPDATE public.event_registrations SET payment_order_id = v_order, ticket_code_sent_at = now() WHERE id = v_guest;
 PERFORM public.admin_event_registration_decide(jsonb_build_object('registration_id', v_guest, 'action', 'reject', 'note', 'Sandbox lifecycle test'));
 SELECT ticket_revoked_at INTO v_stamp FROM public.event_registrations WHERE id = v_guest;
 PERFORM pg_temp.assert(v_stamp IS NOT NULL, 'lifecycle: closing one delivered guest queues notice');
 v_notice := public._event_ticket_revoked_notices_claim(100);
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM jsonb_array_elements(v_notice->'notices') n WHERE n->>'registration_id' = v_guest::text), 'lifecycle: individual closure reaches existing notification worker');
 PERFORM public._event_registration_refunds_claim(100);
 PERFORM pg_temp.assert((SELECT state = 'needs_review' FROM public.event_registration_refund_jobs WHERE payment_order_id = v_order), 'lifecycle: active group prevents refund of whole shared payment');
 PERFORM public.admin_event_registration_decide(jsonb_build_object('registration_id', v_guest, 'action', 'approve'));
 PERFORM pg_temp.assert((SELECT state = 'cancelled' FROM public.event_registration_refund_jobs WHERE payment_order_id = v_order), 'lifecycle: readmission withdraws unsubmitted refund');
END $$;

DO $$
DECLARE v_id uuid; v_result jsonb;
BEGIN
 v_id := pg_temp.lifecycle_registration('waitlist', '99100000-0000-4000-8000-000000000002');
 v_result := public._event_waitlist_promote('11111111-1111-1111-1111-111111111111',
   '99100000-0000-4000-8000-000000000003', '99100000-0000-4000-8000-000000000004', 1);
 PERFORM pg_temp.assert((SELECT status = 'approved' AND qr_token_hash IS NOT NULL FROM public.event_registrations WHERE id = v_id), 'lifecycle: paid waitlist promotion grants ticket');
 PERFORM pg_temp.assert(EXISTS(SELECT 1 FROM public.event_rsvps WHERE event_id = '99100000-0000-4000-8000-000000000003' AND user_id = '99100000-0000-4000-8000-000000000002' AND status = 'going'), 'lifecycle: paid promotion restores online access RSVP');
END $$;
SELECT pg_temp.assert(NOT has_function_privilege('authenticated', 'public._event_registration_refunds_claim(integer)', 'EXECUTE')
 AND NOT has_function_privilege('anon', 'public._event_registration_refunds_settle(uuid,uuid,text,text)', 'EXECUTE')
 AND has_function_privilege('service_role', 'public._event_registration_refunds_claim(integer)', 'EXECUTE'), 'lifecycle: only worker can issue refunds');
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like('SELECT public.admin_event_refund_jobs(''99100000-0000-4000-8000-000000000003'')', 'forbidden', 'lifecycle: anonymous journal access denied');
ROLLBACK;
