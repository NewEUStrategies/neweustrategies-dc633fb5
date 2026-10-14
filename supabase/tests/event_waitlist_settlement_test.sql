-- pgTAP: kolejka awansuje tylko rozliczonych, kod QR tylko dla rozliczonych,
-- bramka nie wpuszcza nierozliczonych, bez awansu po koncu wydarzenia
-- (REG-07, REG-08 czesc kolejki, REG-13 przekazanie B4). Migracja
-- 20261012150000_event_waitlist_settlement.sql.
--
-- KRYTERIUM AUDYTU REG-07: „unpaid w kolejce nie awansuje". Zwolnione miejsce
-- (decyzja organizatora 'cancel') dostaje PIERWSZY ROZLICZONY z kolejki;
-- nieoplacony z czola kolejki zostaje na swojej pozycji, bez kodu QR i bez
-- zdarzenia awansu. Hurt organizatora i awans bezposredni - to samo, w
-- kolejnosci pozycji. Reczny awans nieoplaconego: miejsce bez kodu QR.
-- Bramka: przyjety nierozliczony -> denied_registration_status, poza
-- swiadoma furtka organizatora (decision_source organizer + unpaid).
-- Naprawa jednorazowa kasuje kody QR nierozliczonych przyjetych.
-- Po koncu wydarzenia ani kaskada gosci, ani awans bezposredni nikogo nie
-- awansuja.
BEGIN;
SELECT plan(36);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b60a0000-0000-0000-0000-0000000000aa', 'b6ws-a', 'B6 Waitlist A', 'b6ws-a.example');

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('b6000000-0000-0000-0000-0000000000a1', 'b6-admin@example.org', now());
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('b6000000-0000-0000-0000-0000000000a1', 'b6-admin@example.org', 'Admin B6', 'b60a0000-0000-0000-0000-0000000000aa');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('b6000000-0000-0000-0000-0000000000a1', 'admin', 'b60a0000-0000-0000-0000-0000000000aa');

-- E1 trwa za miesiac, E2 zakonczylo sie godzine temu.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status,
                           registration_mode, registration_flow) VALUES
  ('b6100000-0000-0000-0000-000000000001', 'b60a0000-0000-0000-0000-0000000000aa', 'b6ws-future',
   'B6 kolejka', 'B6 queue', now() + interval '30 days', NULL, 'published', 'form', 'instant'),
  ('b6100000-0000-0000-0000-000000000002', 'b60a0000-0000-0000-0000-0000000000aa', 'b6ws-ended',
   'B6 po wszystkim', 'B6 ended', now() - interval '2 days', now() - interval '1 hour', 'published', 'form', 'instant');

-- T1: platny, pula 2. T2: bezplatny z grupa, pula 2 (wydarzenie zakonczone).
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       quota, group_registration_enabled, group_max_size) VALUES
  ('b6200000-0000-0000-0000-000000000001', 'b60a0000-0000-0000-0000-0000000000aa',
   'b6100000-0000-0000-0000-000000000001', 'b6_paid', 'Platny', 'Paid', 10000, 'PLN', 2, false, 10),
  ('b6200000-0000-0000-0000-000000000002', 'b60a0000-0000-0000-0000-0000000000aa',
   'b6100000-0000-0000-0000-000000000002', 'b6_ended', 'Po koncu', 'Ended', 0, 'PLN', 2, true, 5);

INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode,
                                      access_mode, dedupe_window_seconds) VALUES
  ('b6c00000-0000-0000-0000-000000000001', 'b60a0000-0000-0000-0000-0000000000aa',
   'b6100000-0000-0000-0000-000000000001', 'Brama', 'Gate', 'event_entry', 'in_out', 'control', 60),
  ('b6c00000-0000-0000-0000-000000000002', 'b60a0000-0000-0000-0000-0000000000aa',
   'b6100000-0000-0000-0000-000000000001', 'Liczenie', 'Tracking', 'event_entry', 'in_out', 'track', 60);

CREATE TEMP TABLE b6_q (k text PRIMARY KEY, id uuid NOT NULL, person uuid NOT NULL);
GRANT SELECT ON b6_q TO authenticated;

-- Osoba + zgloszenie wprost do tabeli (kolumny jak po starym kodzie).
CREATE FUNCTION pg_temp.b6_reg(_k text, _event uuid, _ticket uuid, _status text, _payment text,
                               _source text DEFAULT NULL, _position integer DEFAULT NULL,
                               _qr text DEFAULT NULL, _lead uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_person uuid := gen_random_uuid(); v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, 'b60a0000-0000-0000-0000-0000000000aa', _k || '@b6.example.org', 'Osoba', initcap(_k));
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     waitlist_position, decided_at, decision_source, promoted_at, qr_token_hash, qr_issued_at,
     group_lead_registration_id, created_by)
  VALUES
    (v_id, 'b60a0000-0000-0000-0000-0000000000aa', _event, v_person, _ticket, _status, 'form', _payment,
     _position, CASE WHEN _source IS NOT NULL THEN now() END, _source,
     CASE WHEN _source = 'system' AND _status = 'approved' THEN now() END,
     CASE WHEN _qr IS NOT NULL THEN encode(extensions.digest(_qr, 'sha256'), 'hex') END,
     CASE WHEN _qr IS NOT NULL THEN now() END,
     _lead, 'b6000000-0000-0000-0000-0000000000a1');
  INSERT INTO b6_q VALUES (_k, v_id, v_person);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.b6(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM b6_q WHERE k = _k $$;
CREATE FUNCTION pg_temp.b6p(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT person FROM b6_q WHERE k = _k $$;
CREATE FUNCTION pg_temp.b6_row(_k text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r FROM public.event_registrations r WHERE r.id = pg_temp.b6(_k) $$;

-- ── 1-7. Uprawnienia i kolejnosc blokad ───────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public._event_waitlist_promote(uuid,uuid,uuid,integer,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_waitlist_promote(uuid,uuid,uuid,integer,uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_waitlist_promote(uuid,uuid,uuid,integer,uuid)', 'EXECUTE'),
  'ACL: _event_waitlist_promote (5 arg.) tylko service_role');
SELECT ok(NOT has_function_privilege('anon', 'public._event_waitlist_promote(uuid,uuid,uuid,integer)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_waitlist_promote(uuid,uuid,uuid,integer)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_waitlist_promote(uuid,uuid,uuid,integer)', 'EXECUTE'),
  'ACL: _event_waitlist_promote (4 arg.) tylko service_role');
-- SCALENIE Z MAIN (PR #504, runda 4): main 20261013110600 zastapil sygnature
-- 5-arg. (REG 20261012150000) 6-arg. z chwila skanu `_at` (DEFAULT NULL);
-- unia 20261013900720 trzyma JEDNO przeciazenie (6-arg.) z bramka REG-07.
-- Wywolania 5-arg. nizej trafiaja w nie przez DEFAULT.
SELECT ok(NOT has_function_privilege('anon', 'public._event_checkin_evaluate(uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_checkin_evaluate(uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_checkin_evaluate(uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE')
      AND to_regprocedure('public._event_checkin_evaluate(uuid,uuid,uuid,uuid,text)') IS NULL,
  'ACL: _event_checkin_evaluate tylko service_role, jedno przeciazenie (6 arg.)');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_event_waitlist_promote(jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.admin_event_waitlist_promote(jsonb)', 'EXECUTE'),
  'ACL: admin_event_waitlist_promote dla authenticated (bramka redaktora), nie dla anon');
SELECT ok(NOT has_function_privilege('anon', 'public._event_seats_left(uuid,uuid,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_seats_left(uuid,uuid,uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_seats_left(uuid,uuid,uuid)', 'EXECUTE'),
  'ACL: _event_seats_left (najemca z argumentu) bez EXECUTE dla klientow');
SELECT ok(NOT has_function_privilege('anon', 'public._event_unsettled_qr_repair()', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public._event_unsettled_qr_repair()', 'EXECUTE')
      AND has_function_privilege('service_role', 'public._event_unsettled_qr_repair()', 'EXECUTE'),
  'ACL: naprawa kodow QR tylko service_role');
SELECT ok(
  (SELECT strpos(p.prosrc, 'FROM public.events e') > 0
      AND strpos(p.prosrc, 'FROM public.events e') < strpos(p.prosrc, 'FROM public.event_ticket_types t')
      AND p.prosrc LIKE '%r.payment_status IN (''paid'', ''partially_refunded'', ''not_required'')%'
     FROM pg_proc p WHERE p.oid = 'public._event_waitlist_promote(uuid,uuid,uuid,integer,uuid)'::regprocedure),
  'REG-08/REG-07: awans blokuje wydarzenie PRZED biletem i wybiera tylko rozliczonych');

-- ── 8-14. KRYTERIUM: nieoplacony w kolejce nie awansuje ──────────────────────
-- Pula T1 pelna (S1, S2). Kolejka: U1 nieoplacony (1), P1 oplacony (2),
-- N1 bez platnosci (3), R1 zwrot czesciowy (4), U2 nieoplacony (5).
SELECT pg_temp.b6_reg('s1', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'approved', 'not_required', 'system');
SELECT pg_temp.b6_reg('s2', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'approved', 'not_required', 'system');
SELECT pg_temp.b6_reg('u1', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'waitlist', 'unpaid', 'organizer', 1);
SELECT pg_temp.b6_reg('p1', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'waitlist', 'paid', 'capacity', 2);
SELECT pg_temp.b6_reg('n1', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'waitlist', 'not_required', 'capacity', 3);
SELECT pg_temp.b6_reg('r1', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'waitlist', 'partially_refunded', 'capacity', 4);
SELECT pg_temp.b6_reg('u2', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'waitlist', 'unpaid', NULL, 5);

SELECT is((SELECT sold_count FROM public.event_ticket_types WHERE id = 'b6200000-0000-0000-0000-000000000001'),
  2, 'punkt wyjscia: pula T1 pelna');

CREATE TEMP TABLE b6_out (k text PRIMARY KEY, v jsonb);
GRANT ALL ON b6_out TO authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'cancel_s1', public.admin_event_registration_decide(jsonb_build_object(
  'registration_id', pg_temp.b6('s1'), 'action', 'cancel'));
RESET ROLE;

SELECT ok(
  (SELECT (v->>'promoted_from_waitlist')::int = 1
      AND (v->'promoted'->0->>'registration_id')::uuid = pg_temp.b6('p1')
     FROM b6_out WHERE k = 'cancel_s1'),
  'REG-07 KRYTERIUM: zwolnione miejsce dostaje PIERWSZY ROZLICZONY (P1), nie nieoplacony z czola kolejki');
SELECT ok(
  (SELECT r.status = 'waitlist' AND r.waitlist_position = 1 AND r.promoted_at IS NULL AND r.qr_token_hash IS NULL
     FROM pg_temp.b6_row('u1') r),
  'REG-07 KRYTERIUM: nieoplacony w kolejce nie awansuje - pozycja 1, bez awansu i bez kodu QR');
SELECT is(
  (SELECT count(*)::int FROM public.domain_events d
    WHERE d.aggregate_id = pg_temp.b6('u1')::text AND d.event_type = 'event.registration.promoted.v1'),
  0, 'REG-07: brak zdarzenia awansu dla nieoplaconego (zadnego maila „awansowales")');
SELECT ok(
  (SELECT r.status = 'approved' AND r.qr_token_hash IS NOT NULL AND r.promoted_at IS NOT NULL
      AND r.decision_source = 'system' AND r.waitlist_position IS NULL
     FROM pg_temp.b6_row('p1') r),
  'awansowany oplacony: przyjety z kodem QR i stemplem awansu');
SELECT is((SELECT sold_count FROM public.event_ticket_types WHERE id = 'b6200000-0000-0000-0000-000000000001'),
  2, 'pula T1 nadal 2 - awans nie wyszedl ponad zwolnione miejsce');

SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'cancel_s2', public.admin_event_registration_decide(jsonb_build_object(
  'registration_id', pg_temp.b6('s2'), 'action', 'cancel'));
RESET ROLE;
SELECT ok(
  (SELECT (v->'promoted'->0->>'registration_id')::uuid = pg_temp.b6('n1') FROM b6_out WHERE k = 'cancel_s2')
  AND (pg_temp.b6_row('n1')).status = 'approved' AND (pg_temp.b6_row('u1')).status = 'waitlist',
  'kolejnosc pozycji: drugie miejsce dostaje N1 (bez platnosci), U1 dalej czeka');

-- ── 15-19. Awans bezposredni i hurt organizatora ─────────────────────────────
UPDATE public.event_ticket_types SET quota = 4 WHERE id = 'b6200000-0000-0000-0000-000000000001';
SELECT ok(
  (SELECT (v->>'promoted')::int = 1 AND (v->'registrations'->0->>'registration_id')::uuid = pg_temp.b6('r1')
     FROM (SELECT public._event_waitlist_promote('b60a0000-0000-0000-0000-0000000000aa',
             'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 5, NULL) AS v) x),
  'awans bezposredni przy 2 wolnych: tylko R1 (zwrot czesciowy = rozliczony), nieoplaceni pominieci');
SELECT ok(
  (SELECT bool_and(r.status = 'waitlist' AND r.qr_token_hash IS NULL AND r.promoted_at IS NULL)
     FROM public.event_registrations r WHERE r.id IN (pg_temp.b6('u1'), pg_temp.b6('u2'))),
  'nieoplaceni U1 i U2 czekaja bez kodu, mimo wolnego miejsca');
SELECT is(
  (public._event_waitlist_promote('b60a0000-0000-0000-0000-0000000000aa',
     'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 5, NULL)->>'promoted')::int,
  0, 'tylko nieoplaceni w kolejce i wolne miejsce: awans (5 arg.) = 0');
SELECT is(
  (public._event_waitlist_promote('b60a0000-0000-0000-0000-0000000000aa',
     'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 5)->>'promoted')::int,
  0, 'wariant 4 arg. dziedziczy regule: awans = 0');

SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'bulk', public.admin_event_waitlist_promote(jsonb_build_object(
  'event_id', 'b6100000-0000-0000-0000-000000000001', 'count', 5));
RESET ROLE;
SELECT is((SELECT (v->>'promoted')::int FROM b6_out WHERE k = 'bulk'),
  0, 'hurt organizatora: odpowiedz mowi promoted = 0 (nieoplaceni nie awansuja)');

-- ── 20-22. Reczny awans organizatora ─────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'single_u2', public.admin_event_waitlist_promote(jsonb_build_object(
  'registration_id', pg_temp.b6('u2')));
RESET ROLE;
SELECT ok(
  (SELECT (o.v->>'promoted')::int = 1 AND o.v->>'qr_token' IS NULL
      AND r.status = 'approved' AND r.decision_source = 'organizer'
      AND r.decided_by = 'b6000000-0000-0000-0000-0000000000a1'
      AND r.qr_token_hash IS NULL AND r.qr_issued_at IS NULL
     FROM b6_out o, pg_temp.b6_row('u2') r WHERE o.k = 'single_u2'),
  'REG-07: reczny awans nieoplaconego - miejsce decyzja organizatora, BEZ kodu QR (ani w bazie, ani w odpowiedzi)');

UPDATE public.event_ticket_types SET quota = 5 WHERE id = 'b6200000-0000-0000-0000-000000000001';
SELECT pg_temp.b6_reg('p2', 'b6100000-0000-0000-0000-000000000001', 'b6200000-0000-0000-0000-000000000001', 'waitlist', 'paid', 'capacity', 6);
SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'single_p2', public.admin_event_waitlist_promote(jsonb_build_object(
  'registration_id', pg_temp.b6('p2')));
SELECT throws_like(
  format($$SELECT public.admin_event_waitlist_promote(jsonb_build_object('registration_id', %L))$$, pg_temp.b6('p2')),
  'invalid_transition%', 'ponowny reczny awans tego samego zgloszenia: invalid_transition');
RESET ROLE;
SELECT ok(
  (SELECT o.v->>'qr_token' IS NOT NULL
      AND r.qr_token_hash = encode(extensions.digest(o.v->>'qr_token', 'sha256'), 'hex')
     FROM b6_out o, pg_temp.b6_row('p2') r WHERE o.k = 'single_p2'),
  'reczny awans oplaconego: kod QR wydany (skrot w bazie = sha256 kodu z odpowiedzi)');

-- ── 23-30. Bramka wejscia ────────────────────────────────────────────────────
-- L: awansowany przez system bez wplaty (stary kod). O: przyjety przez
-- organizatora przed wplata (furtka). P: oplacony. X: zwrocony, a przyjety.
SELECT pg_temp.b6_reg('l', 'b6100000-0000-0000-0000-000000000001', NULL, 'approved', 'unpaid', 'system', NULL, 'b6-legacy-qr');
SELECT pg_temp.b6_reg('o', 'b6100000-0000-0000-0000-000000000001', NULL, 'pending', 'unpaid');
SELECT pg_temp.b6_reg('p', 'b6100000-0000-0000-0000-000000000001', NULL, 'approved', 'paid', 'system', NULL, 'b6-paid-qr');
SELECT pg_temp.b6_reg('x', 'b6100000-0000-0000-0000-000000000001', NULL, 'approved', 'refunded', 'organizer');
SELECT pg_temp.b6_reg('q1', 'b6100000-0000-0000-0000-000000000001', NULL, 'approved', 'unpaid', 'organizer', NULL, 'b6-manual-qr');

SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'approve_o', public.admin_event_registration_decide(jsonb_build_object(
  'registration_id', pg_temp.b6('o'), 'action', 'approve'));
RESET ROLE;

SELECT is(
  public._event_checkin_evaluate('b60a0000-0000-0000-0000-0000000000aa', 'b6100000-0000-0000-0000-000000000001',
    'b6c00000-0000-0000-0000-000000000001', pg_temp.b6p('l'), 'in')->>'result',
  'denied_registration_status', 'REG-07 bramka: awansowany przez system bez wplaty nie wchodzi');
SELECT is(
  public._event_checkin_evaluate('b60a0000-0000-0000-0000-0000000000aa', 'b6100000-0000-0000-0000-000000000001',
    'b6c00000-0000-0000-0000-000000000001', pg_temp.b6p('o'), 'in')->>'result',
  'granted', 'furtka organizatora: przyjety decyzja przed wplata (organizer + unpaid) wchodzi');
SELECT is(
  public._event_checkin_evaluate('b60a0000-0000-0000-0000-0000000000aa', 'b6100000-0000-0000-0000-000000000001',
    'b6c00000-0000-0000-0000-000000000001', pg_temp.b6p('p'), 'in')->>'result',
  'granted', 'oplacony przyjety wchodzi');
SELECT is(
  public._event_checkin_evaluate('b60a0000-0000-0000-0000-0000000000aa', 'b6100000-0000-0000-0000-000000000001',
    'b6c00000-0000-0000-0000-000000000001', pg_temp.b6p('x'), 'in')->>'result',
  'denied_registration_status', 'zwrocony (refunded) nie wchodzi, nawet z decyzja organizatora');

SELECT ok(
  (SELECT v->>'result' = 'denied_registration_status' AND NOT (v->>'admit')::boolean
      AND (pg_temp.b6_row('l')).attended_at IS NULL AND (pg_temp.b6_row('l')).status = 'approved'
     FROM (SELECT public._event_checkin_write('b60a0000-0000-0000-0000-0000000000aa',
             'b6100000-0000-0000-0000-000000000001', 'b6c00000-0000-0000-0000-000000000001',
             pg_temp.b6p('l'), 'in', 'qr_code', NULL, 'b6000000-0000-0000-0000-0000000000a1', 'b6-scan-l', NULL, NULL, NULL) AS v) x),
  'skan QR: nierozliczony odeslany, bez stempla obecnosci');

SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'desk_l', public.admin_event_checkin_manual(jsonb_build_object(
  'event_id', 'b6100000-0000-0000-0000-000000000001', 'checkpoint_id', 'b6c00000-0000-0000-0000-000000000001',
  'person_id', pg_temp.b6p('l'), 'direction', 'in', 'source', 'name_search', 'client_scan_uid', 'b6-desk-l'));
INSERT INTO b6_out SELECT 'desk_o', public.admin_event_checkin_manual(jsonb_build_object(
  'event_id', 'b6100000-0000-0000-0000-000000000001', 'checkpoint_id', 'b6c00000-0000-0000-0000-000000000001',
  'person_id', pg_temp.b6p('o'), 'direction', 'in', 'source', 'name_search', 'client_scan_uid', 'b6-desk-o'));
RESET ROLE;
SELECT ok(
  (SELECT v->>'result' = 'denied_registration_status' AND NOT (v->>'admit')::boolean FROM b6_out WHERE k = 'desk_l'),
  'stanowisko reczne: nierozliczony (system) odeslany');
SELECT ok(
  (SELECT (v->>'admit')::boolean AND v->>'result' = 'granted' FROM b6_out WHERE k = 'desk_o')
  AND (pg_temp.b6_row('o')).status = 'attended',
  'stanowisko reczne: furtka organizatora wpuszcza i stempluje obecnosc');
SELECT ok(
  (SELECT v->>'result' = 'denied_registration_status' AND (v->>'admit')::boolean
     FROM (SELECT public._event_checkin_write('b60a0000-0000-0000-0000-0000000000aa',
             'b6100000-0000-0000-0000-000000000001', 'b6c00000-0000-0000-0000-000000000002',
             pg_temp.b6p('l'), 'in', 'qr_code', NULL, 'b6000000-0000-0000-0000-0000000000a1', 'b6-track-l', NULL, NULL, NULL) AS v) x),
  'punkt liczacy (track) zachowuje swoja semantyke: wpuszcza i loguje odmowe');

-- ── 31-32. Naprawa jednorazowa kodow QR ──────────────────────────────────────
SELECT ok(
  (SELECT (v->>'cleared')::int >= 2 AND (v->>'legacy_system_promoted')::int >= 1
     FROM (SELECT public._event_unsettled_qr_repair() AS v) x)
  AND (pg_temp.b6_row('l')).qr_token_hash IS NULL AND (pg_temp.b6_row('l')).qr_issued_at IS NULL
  AND (pg_temp.b6_row('q1')).qr_token_hash IS NULL
  AND (pg_temp.b6_row('p')).qr_token_hash = encode(extensions.digest('b6-paid-qr', 'sha256'), 'hex')
  AND (pg_temp.b6_row('l')).status = 'approved',
  'naprawa: kod QR nierozliczonych przyjetych (system i organizator) skasowany, oplaconego nietkniety, status bez zmian');
SELECT is((public._event_unsettled_qr_repair()->>'cleared')::int, 0,
  'naprawa idempotentna: drugi przebieg nie znajduje wierszy');

-- ── 33-36. Po koncu wydarzenia - bez awansu (kaskada gosci, awans wprost) ─────
SELECT pg_temp.b6_reg('g', 'b6100000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002', 'approved', 'not_required', 'system');
SELECT pg_temp.b6_reg('g1', 'b6100000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002', 'approved', 'not_required', 'system', NULL, NULL, pg_temp.b6('g'));
SELECT pg_temp.b6_reg('w_end', 'b6100000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002', 'waitlist', 'not_required', 'capacity', 1);
SELECT pg_temp.b6_reg('w_end2', 'b6100000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002', 'waitlist', 'not_required', 'capacity', 2);
SELECT pg_temp.b6_reg('w_end3', 'b6100000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002', 'waitlist', 'not_required', 'capacity', 3);

SELECT set_config('request.jwt.claims', '{"sub":"b6000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO b6_out SELECT 'cancel_g', public.admin_event_registration_decide(jsonb_build_object(
  'registration_id', pg_temp.b6('g'), 'action', 'cancel'));
RESET ROLE;
SELECT ok(
  (pg_temp.b6_row('g1')).status = 'cancelled'
  AND (SELECT (v->>'promoted_from_waitlist')::int = 0 FROM b6_out WHERE k = 'cancel_g'),
  'po koncu: organizator zamyka grupe (korekta), kaskada zamyka goscia, decyzja nie awansuje');
SELECT ok(
  (SELECT r.status = 'waitlist' AND r.promoted_at IS NULL FROM pg_temp.b6_row('w_end') r),
  'REG-13: kaskada gosci po koncu wydarzenia nie awansuje nikogo za zwolnione miejsca gosci');
SELECT is(
  (public._event_waitlist_promote('b60a0000-0000-0000-0000-0000000000aa',
     'b6100000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002', 5, NULL)->>'promoted')::int,
  0, 'REG-13: awans bezposredni po koncu wydarzenia = 0');
-- Wiecej wolnych miejsc niz zwolnionych - awans wprost ma z czego brac.
UPDATE public.event_ticket_types SET quota = 4 WHERE id = 'b6200000-0000-0000-0000-000000000002';
SELECT ok(
  public._event_group_promote_freed('b60a0000-0000-0000-0000-0000000000aa',
    'b6100000-0000-0000-0000-000000000002',
    ARRAY['b6200000-0000-0000-0000-000000000002', 'b6200000-0000-0000-0000-000000000002']::uuid[], NULL) = 0
  AND (SELECT bool_and(r.status = 'waitlist') FROM public.event_registrations r
        WHERE r.id IN (pg_temp.b6('w_end'), pg_temp.b6('w_end2'), pg_temp.b6('w_end3'))),
  'REG-13: awans za miejsca gosci po koncu wydarzenia = 0, cala kolejka czeka');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
