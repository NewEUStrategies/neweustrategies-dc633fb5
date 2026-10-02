-- ============================================================================
-- 99 event_seat_state (20261002210000): JEDNA regula liczenia wolnych miejsc.
--
-- Strona wydarzenia i bramka sprzedazy biletu liczyly miejsca WYLACZNIE z puli
-- legacy (`get_event_rsvp_counts`), a naglowek strony - regula
-- `_event_page_seats_left` (mniejsza z puli zgloszen i puli legacy). Ten plik
-- dowodzi, ze nowe RPC liczy dokladnie ta regula, trzyma granice najemcy
-- i widocznosci oraz ze rola serwisowa (webhook platnosci) widzi wydarzenie
-- swojego najemcy bez hosta.
-- ============================================================================
\echo '== 99 stan miejsc: jedna regula =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('5ea70000-0000-4000-8000-0000000000a1', 'Tenant miejsc A', 'seat-state-a'),
  ('5ea70000-0000-4000-8000-0000000000b1', 'Tenant miejsc B', 'seat-state-b');

INSERT INTO auth.users (id, email)
SELECT ('5ea71000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'seat' || i || '@example.org'
FROM generate_series(1, 12) i;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow, capacity) VALUES
  -- Sala na 10: 3 RSVP + 6 zgloszen przyjetych. Pula legacy widzi 7 wolnych,
  -- regula bazy - 4. Dokladnie ten rozjazd strona pokazywala uczestnikowi.
  ('5ea72000-0000-4000-8000-000000000001', '5ea70000-0000-4000-8000-0000000000a1', 'seat-mixed', 'Sala', 'Room', now() + interval '30 days', 'published', 'form', 'instant', 10),
  ('5ea72000-0000-4000-8000-000000000002', '5ea70000-0000-4000-8000-0000000000a1', 'seat-unlimited', 'Bez limitu', 'Unlimited', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('5ea72000-0000-4000-8000-000000000003', '5ea70000-0000-4000-8000-0000000000a1', 'seat-draft', 'Szkic', 'Draft', now() + interval '30 days', 'draft', 'form', 'instant', 5),
  ('5ea72000-0000-4000-8000-000000000004', '5ea70000-0000-4000-8000-0000000000b1', 'seat-foreign', 'Obcy', 'Foreign', now() + interval '30 days', 'published', 'form', 'instant', 5),
  -- Sala na 4 zapelniona formularzem: pula legacy pusta, regula mowi „komplet".
  ('5ea72000-0000-4000-8000-000000000005', '5ea70000-0000-4000-8000-0000000000a1', 'seat-form-full', 'Komplet', 'Full', now() + interval '30 days', 'published', 'form', 'instant', 4);

INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
SELECT '5ea70000-0000-4000-8000-0000000000a1', '5ea72000-0000-4000-8000-000000000001',
       ('5ea71000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       CASE WHEN i <= 3 THEN 'going' ELSE 'waitlist' END,
       CASE WHEN i <= 3 THEN NULL ELSE now() END
FROM generate_series(1, 4) i;

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name)
SELECT ('5ea73000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '5ea70000-0000-4000-8000-0000000000a1',
       ('5ea71000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'seat' || i || '@example.org', 'Seat' || i, 'Test'
FROM generate_series(1, 12) i;

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status,
  registration_mode, payment_status, attended_at, cancelled_at)
SELECT ('5ea74000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '5ea70000-0000-4000-8000-0000000000a1', '5ea72000-0000-4000-8000-000000000001',
       ('5ea73000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       CASE WHEN i <= 4 THEN 'approved' WHEN i = 5 THEN 'attended' WHEN i = 6 THEN 'no_show'
            WHEN i <= 8 THEN 'waitlist' ELSE 'cancelled' END,
       'form', 'not_required',
       CASE WHEN i = 5 THEN now() END,
       CASE WHEN i = 9 THEN now() END
FROM generate_series(1, 9) i;

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status,
  registration_mode, payment_status)
SELECT ('5ea75000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '5ea70000-0000-4000-8000-0000000000a1', '5ea72000-0000-4000-8000-000000000005',
       ('5ea73000-0000-4000-8000-0000000000' || lpad((i + 8)::text, 2, '0'))::uuid,
       'approved', 'form', 'not_required'
FROM generate_series(1, 4) i;

-- Odwiedzajacy domeny najemcy A, bez konta.
SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '5ea70000-0000-4000-8000-0000000000a1', false);

DO $$
DECLARE
  v_row record;
BEGIN
  SELECT * INTO v_row FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert(v_row.capacity = 10, 'seat state: capacity from the event row');
  PERFORM pg_temp.assert(v_row.seats_left = 4,
    'seat state: seats_left is the SMALLER pool (10 - 6 registrations), not legacy 10 - 3');
  PERFORM pg_temp.assert(
    v_row.seats_left = public._event_page_seats_left('5ea70000-0000-4000-8000-0000000000a1', '5ea72000-0000-4000-8000-000000000001'),
    'seat state: the same rule as the page header (_event_page_seats_left)');
  PERFORM pg_temp.assert(v_row.going = 6, 'seat state: going = seats taken by the rule (approved + attended + no_show)');
  PERFORM pg_temp.assert(v_row.capacity - v_row.going = v_row.seats_left, 'seat state: capacity - going = seats_left');
  PERFORM pg_temp.assert(v_row.waitlist = 3, 'seat state: waitlist sums both queues (1 RSVP + 2 registrations)');

  SELECT * INTO v_row FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000005');
  PERFORM pg_temp.assert(v_row.seats_left = 0, 'seat state: hall filled by the form is full although legacy pool is empty');

  SELECT * INTO v_row FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000002');
  PERFORM pg_temp.assert(v_row.capacity IS NULL AND v_row.seats_left IS NULL, 'seat state: no capacity means no limit (NULL), not zero');
END $$;

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000003')) = 0,
  'seat state: draft event is invisible');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000004')) = 0,
  'seat state: foreign tenant event is invisible from tenant A host');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_state(NULL)) = 0,
  'seat state: NULL event id returns nothing');

-- Ta sama odpowiedz dla prawdziwej roli `anon` (SECURITY DEFINER + grant).
SET ROLE anon;
SELECT pg_temp.assert(
  (SELECT seats_left FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000001')) = 4,
  'seat state: anon role can read the rule through the grant');
RESET ROLE;

-- Odwiedzajacy domeny najemcy B nie widzi wydarzenia A.
SELECT set_config('nes.public_tenant', '5ea70000-0000-4000-8000-0000000000b1', false);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000001')) = 0,
  'seat state: tenant B host cannot read tenant A event');

-- Webhook platnosci (rola serwisowa) nie niesie hosta: najemca z wiersza wydarzenia.
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT pg_temp.assert(
  (SELECT seats_left FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000001')) = 4,
  'seat state: service role resolves tenant from the event row');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000003')) = 0,
  'seat state: service role still does not see a draft');
SELECT set_config('request.jwt.claim.role', '', false);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT pg_temp.assert(
  (SELECT seats_left FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000005')) = 0,
  'seat state: service role recognised from request.jwt.claims');
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', false);
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_seat_state('5ea72000-0000-4000-8000-000000000001')) = 0,
  'seat state: authenticated claim does not unlock the event-row tenant');
SELECT set_config('request.jwt.claims', '', false);

SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_seat_state(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_seat_state(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_seat_state(uuid)', 'EXECUTE'),
  'seat state: executable by anon, authenticated and service_role');

SELECT set_config('nes.public_tenant', '', false);
ROLLBACK;
