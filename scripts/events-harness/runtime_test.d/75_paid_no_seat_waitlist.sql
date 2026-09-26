-- ============================================================================
-- 75_paid_no_seat_waitlist - WPLATA BEZ MIEJSCA CZEKA W KOLEJCE OPLACONA
-- (20260926150000)
--
-- PO CO TEN PLIK ISTNIEJE
-- `payments_apply_event_ticket_outcome` przyjmowala zgloszenie `pending ->
-- approved` bez sprawdzenia miejsc. Pula biletu wyczerpana miedzy kasa
-- a webhookiem wywracala cale ksiegowanie (CHECK
-- `event_ticket_types_sold_within_quota`), a pelna sala wydarzenia
-- przepelniala sie po cichu. Od 20260926150000 o przyjeciu decyduje
-- `_event_registration_paid_admission` pod blokada wydarzenia i biletu:
-- miejsce -> przyjete, brak miejsca -> kolejka OPLACONA (`capacity`),
-- bilet/przeplyw z akceptacja -> czeka na decyzje organizatora (oplacone),
-- gosc bez przyjetego prowadzacego -> tylko rozliczenie.
--
-- CO SPRAWDZA - kazda galaz `_event_registration_paid_admission`, galezi
-- `paid` wyniku platnosci, straznika gosci w `_event_apply_outcome_to_group`
-- i nowych pol odpowiedzi (`registration_status`, `waitlist_position`,
-- `newly_settled`). Sekcja 9 (dwie sesje) dowodzi, ze webhook czeka na
-- blokadzie wiersza wydarzenia jak zapis publiczny.
--
-- CZEGO NIE SPRAWDZA: tresci maili, SMS-ow i dzwonkow (vitest:
-- registrationOutcomeNotify.server.test.ts), refundIfOversold (vitest:
-- oneTimeFulfilment.event.test.ts).
-- ============================================================================
\echo '== 75 wplata bez miejsca: kolejka oplacona =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'Tenant F5 (wplata bez miejsca)', 'tf5-oversell');

INSERT INTO auth.users (id, email)
SELECT ('f5000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'os' || i || '@example.org'
FROM generate_series(1, 40) i;

-- E1 pula biletu 1 (+ bilet bez puli), E2 pojemnosc 1 (bilet bez puli),
-- E3 bilet z akceptacja, E4 przeplyw approval, E5 grupa (pula 2),
-- E6 pojemnosc 1 bez cennika, E7 natychmiastowe z regulami, E8 approval z regula.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow, capacity) VALUES
  ('f5100000-0000-0000-0000-000000000001', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-quota', 'Pula', 'Quota', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('f5100000-0000-0000-0000-000000000002', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-cap', 'Sala', 'Room', now() + interval '30 days', 'published', 'form', 'instant', 1),
  ('f5100000-0000-0000-0000-000000000003', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-appr', 'Akceptacja', 'Approval', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('f5100000-0000-0000-0000-000000000004', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-flow', 'Przeplyw', 'Flow', now() + interval '30 days', 'published', 'form', 'approval', NULL),
  ('f5100000-0000-0000-0000-000000000005', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-group', 'Grupa', 'Group', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('f5100000-0000-0000-0000-000000000006', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-noticket', 'Bez cennika', 'No price list', now() + interval '30 days', 'published', 'form', 'instant', 1),
  ('f5100000-0000-0000-0000-000000000007', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-rules', 'Reguly', 'Rules', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('f5100000-0000-0000-0000-000000000008', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'os-rules-flow', 'Reguly approval', 'Rules approval', now() + interval '30 days', 'published', 'form', 'approval', NULL);

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
  quota, min_tier_rank, requires_approval, is_active, sort_order, group_registration_enabled, group_max_size) VALUES
  ('f5200000-0000-0000-0000-000000000001', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000001', 'q1', 'Pula', 'Quota', 10000, 'PLN', 1, 0, false, true, 10, false, 2),
  ('f5200000-0000-0000-0000-000000000002', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000002', 'c1', 'Sala', 'Room', 10000, 'PLN', NULL, 0, false, true, 10, false, 2),
  ('f5200000-0000-0000-0000-000000000003', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000003', 'ap', 'Akceptacja', 'Approval', 10000, 'PLN', 1, 0, true, true, 10, false, 2),
  ('f5200000-0000-0000-0000-000000000004', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000004', 'fl', 'Przeplyw', 'Flow', 10000, 'PLN', NULL, 0, false, true, 10, false, 2),
  ('f5200000-0000-0000-0000-000000000005', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000005', 'g2', 'Grupa', 'Group', 10000, 'PLN', 2, 0, false, true, 10, true, 5),
  ('f5200000-0000-0000-0000-000000000006', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000001', 'free', 'Bez puli', 'No quota', 10000, 'PLN', NULL, 0, false, true, 20, false, 2),
  ('f5200000-0000-0000-0000-000000000007', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000007', 'ru', 'Reguly', 'Rules', 10000, 'PLN', NULL, 0, false, true, 10, false, 2),
  ('f5200000-0000-0000-0000-000000000008', 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000008', 'rf', 'Reguly approval', 'Rules approval', 10000, 'PLN', NULL, 0, false, true, 10, false, 2);

-- Reguly kwalifikacji: E7 'sector' = gov -> akceptacja, 'sector' = spam -> odrzucenie
-- (regula dopisana PO zapisie), E8 'vip' = true -> automatyczne przyjecie.
INSERT INTO public.event_registration_fields (tenant_id, event_id, key, field_type, label_pl, label_en,
  is_qualifying, qualify_operator, qualify_value, qualify_outcome, sort_order) VALUES
  ('f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000007', 'sector', 'text', 'Sektor', 'Sector', true, 'equals', '"gov"', 'approval', 10),
  ('f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000007', 'spam', 'text', 'Spam', 'Spam', true, 'equals', '"tak"', 'reject', 20),
  ('f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000008', 'vip', 'checkbox', 'VIP', 'VIP', true, 'is_true', 'null', 'auto_approve', 10);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name)
SELECT ('f5300000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5',
       ('f5000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'os' || i || '@example.org', 'Os' || i, 'Test'
FROM generate_series(1, 40) i;

-- Zgloszenia: klucz, osoba, wydarzenie, bilet (0 = bez), status, platnosc,
-- prowadzacy, odpowiedzi.
CREATE TEMP TABLE os_reg (k text PRIMARY KEY, id uuid, person int, event int, ticket int,
  status text, pay text, lead text, answers jsonb);
INSERT INTO os_reg VALUES
  ('q_a',   'f5400000-0000-0000-0000-000000000001', 1, 1, 1, 'pending',  'unpaid',       NULL, '{}'),
  ('q_b',   'f5400000-0000-0000-0000-000000000002', 2, 1, 1, 'pending',  'unpaid',       NULL, '{}'),
  ('c_a',   'f5400000-0000-0000-0000-000000000003', 3, 2, 2, 'pending',  'unpaid',       NULL, '{}'),
  ('c_b',   'f5400000-0000-0000-0000-000000000004', 4, 2, 2, 'pending',  'unpaid',       NULL, '{}'),
  ('ap',    'f5400000-0000-0000-0000-000000000005', 5, 3, 3, 'pending',  'unpaid',       NULL, '{}'),
  ('fl',    'f5400000-0000-0000-0000-000000000006', 6, 4, 4, 'pending',  'unpaid',       NULL, '{}'),
  ('g_x',   'f5400000-0000-0000-0000-000000000007', 7, 5, 5, 'approved', 'not_required', NULL, '{}'),
  ('g_y',   'f5400000-0000-0000-0000-000000000008', 8, 5, 5, 'approved', 'not_required', NULL, '{}'),
  ('g_l',   'f5400000-0000-0000-0000-000000000009', 9, 5, 5, 'pending',  'unpaid',       NULL, '{}'),
  ('g_g1',  'f5400000-0000-0000-0000-000000000010', 10, 5, 5, 'pending', 'unpaid',       'g_l', '{}'),
  ('g_g2',  'f5400000-0000-0000-0000-000000000011', 11, 5, 5, 'pending', 'unpaid',       'g_l', '{}'),
  ('x_q',   'f5400000-0000-0000-0000-000000000012', 12, 1, 1, 'pending', 'unpaid',       NULL, '{}'),
  ('w_ap',  'f5400000-0000-0000-0000-000000000013', 13, 3, 3, 'waitlist','unpaid',       NULL, '{}'),
  ('w_q',   'f5400000-0000-0000-0000-000000000014', 14, 2, 2, 'waitlist','unpaid',       NULL, '{}'),
  ('ok_a',  'f5400000-0000-0000-0000-000000000015', 15, 1, 6, 'approved','unpaid',       NULL, '{}'),
  ('ns',    'f5400000-0000-0000-0000-000000000016', 16, 1, 6, 'no_show', 'unpaid',       NULL, '{}'),
  ('cx',    'f5400000-0000-0000-0000-000000000017', 17, 1, 6, 'cancelled','unpaid',      NULL, '{}'),
  ('nt_a',  'f5400000-0000-0000-0000-000000000018', 18, 6, 0, 'approved','not_required', NULL, '{}'),
  ('nt_b',  'f5400000-0000-0000-0000-000000000019', 19, 6, 0, 'pending', 'unpaid',       NULL, '{}'),
  ('r_gov', 'f5400000-0000-0000-0000-000000000020', 20, 7, 7, 'pending', 'unpaid',       NULL, '{"sector":"gov"}'),
  ('r_spam','f5400000-0000-0000-0000-000000000021', 21, 7, 7, 'pending', 'unpaid',       NULL, '{"spam":"tak"}'),
  ('r_none','f5400000-0000-0000-0000-000000000022', 22, 7, 7, 'draft',   'unpaid',       NULL, '{}'),
  ('rf_vip','f5400000-0000-0000-0000-000000000023', 23, 8, 8, 'pending', 'unpaid',       NULL, '{"vip":true}'),
  ('rf_dr', 'f5400000-0000-0000-0000-000000000024', 24, 8, 8, 'draft',   'unpaid',       NULL, '{}'),
  ('h_l',   'f5400000-0000-0000-0000-000000000025', 25, 5, 5, 'pending', 'unpaid',       NULL, '{}'),
  ('h_g',   'f5400000-0000-0000-0000-000000000026', 26, 5, 5, 'pending', 'unpaid',       'h_l', '{}'),
  ('m_l',   'f5400000-0000-0000-0000-000000000027', 27, 1, 6, 'approved','unpaid',       NULL, '{}'),
  ('m_g',   'f5400000-0000-0000-0000-000000000028', 28, 1, 6, 'pending', 'unpaid',       'm_l', '{}'),
  ('k_l',   'f5400000-0000-0000-0000-000000000029', 29, 6, 0, 'approved','not_required', NULL, '{}'),
  ('k_g',   'f5400000-0000-0000-0000-000000000030', 30, 6, 0, 'pending', 'unpaid',       'k_l', '{}');

INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
  registration_mode, payment_status, group_lead_registration_id, answers,
  decided_at, decided_by, decision_source, decision_note, cancelled_at, attended_at,
  waitlist_position, created_at)
SELECT o.id, 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5',
       ('f5100000-0000-0000-0000-00000000000' || o.event)::uuid,
       ('f5300000-0000-0000-0000-0000000000' || lpad(o.person::text, 2, '0'))::uuid,
       CASE WHEN o.ticket = 0 THEN NULL ELSE ('f5200000-0000-0000-0000-00000000000' || o.ticket)::uuid END,
       o.status, 'form', o.pay,
       (SELECT l.id FROM os_reg l WHERE l.k = o.lead),
       o.answers,
       CASE WHEN o.status IN ('approved','waitlist','no_show') THEN now() - interval '1 day' END,
       CASE WHEN o.status IN ('approved','waitlist','no_show') THEN 'f5000000-0000-0000-0000-000000000040'::uuid END,
       CASE WHEN o.status IN ('approved','waitlist','no_show') THEN 'organizer' END,
       NULL,
       CASE WHEN o.status = 'cancelled' THEN now() - interval '2 hours' END,
       NULL,
       CASE WHEN o.status = 'waitlist' THEN 7 END,
       now() - (100 - o.person) * interval '1 minute'
FROM os_reg o;

CREATE OR REPLACE FUNCTION pg_temp.osr(_k text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r.* FROM public.event_registrations r JOIN os_reg o ON o.id = r.id WHERE o.k = _k $$;

-- Zamowienie na zgloszenie. `_ticket` - bilet w metadanych, gdy inny niz
-- w zgloszeniu; `_no_ticket` - zamowienie bez `ticket_type_id`.
CREATE OR REPLACE FUNCTION pg_temp.os_order(_k text, _n int, _ticket uuid DEFAULT NULL,
  _no_ticket boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_reg public.event_registrations := pg_temp.osr(_k); v_id uuid;
BEGIN
  v_id := ('f5600000-0000-0000-0000-0000000000' || lpad(_n::text, 2, '0'))::uuid;
  INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
  SELECT v_id, v_reg.tenant_id, p.user_id, 'paid', 10000, 'PLN',
         jsonb_strip_nulls(jsonb_build_object('event_id', v_reg.event_id,
           'ticket_type_id', CASE WHEN _no_ticket THEN NULL ELSE COALESCE(_ticket, v_reg.ticket_type_id) END,
           'registration_id', v_reg.id))
  FROM public.event_people p WHERE p.id = v_reg.person_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 1) PULA BILETU WYCZERPANA - KOLEJKA OPLACONA, AWANS PO ZWOLNIENIU
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_o1 uuid := pg_temp.os_order('q_a', 1); v_o2 uuid := pg_temp.os_order('q_b', 2);
  v_pos integer;
BEGIN
  v := public.payments_apply_event_ticket_outcome(v_o1, 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved' AND (v->>'newly_settled')::boolean
    AND v->'waitlist_position' = 'null'::jsonb,
    '75/pula: pierwsza wplata zajmuje jedyne miejsce (approved, newly_settled, bez pozycji)');
  v := public.payments_apply_event_ticket_outcome(v_o2, 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean AND v->>'registration_status' = 'waitlist'
    AND (v->>'waitlist_position')::integer = 1 AND (v->>'newly_settled')::boolean,
    '75/pula: druga wplata NIE rzuca - zgloszenie w kolejce, oplacone (pozycja 1)');
  PERFORM pg_temp.assert((SELECT status = 'waitlist' AND payment_status = 'paid' AND decision_source = 'capacity'
      AND decided_by IS NULL AND decided_at IS NOT NULL AND qr_token_hash IS NULL AND qr_issued_at IS NULL
      AND payment_order_id = v_o2 AND paid_at IS NOT NULL
      FROM pg_temp.osr('q_b')), '75/pula: kolejka oplacona, capacity, bez autora, bez kodu QR');
  PERFORM pg_temp.assert((SELECT sold_count = 1 AND quota = 1 FROM public.event_ticket_types
      WHERE id = 'f5200000-0000-0000-0000-000000000001'), '75/pula: pula nie przekroczona');
  v_pos := (pg_temp.osr('q_b')).waitlist_position;
  v := public.payments_apply_event_ticket_outcome(v_o2, 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean AND NOT (v->>'newly_settled')::boolean
    AND (pg_temp.osr('q_b')).waitlist_position = v_pos,
    '75/pula: ponowione doreczenie - ta sama pozycja, newly_settled = false');
  -- Zwrot pierwszej wplaty zwalnia miejsce: awansuje OPLACONY z kolejki.
  v := public.payments_apply_event_ticket_outcome(v_o1, 'refunded');
  PERFORM pg_temp.assert(v->>'registration_status' = 'cancelled' AND NOT (v->>'newly_settled')::boolean
    AND v->'waitlist_position' = 'null'::jsonb,
    '75/pula: odpowiedz zwrotu niesie status cancelled i newly_settled = false');
  PERFORM pg_temp.assert((v->'waitlist'->>'promoted')::integer = 1
    AND (SELECT status = 'approved' AND payment_status = 'paid' AND qr_token_hash IS NOT NULL
                AND waitlist_position IS NULL AND promoted_at IS NOT NULL
         FROM pg_temp.osr('q_b'))
    AND (SELECT sold_count FROM public.event_ticket_types WHERE id = 'f5200000-0000-0000-0000-000000000001') = 1,
    '75/pula: zwolnione miejsce przyjmuje oplaconego z kolejki, z kodem - pula nadal 1/1');
END $$;

-- ---------------------------------------------------------------------------
-- 2) POJEMNOSC WYDARZENIA (bilet bez puli) I WYDARZENIE BEZ CENNIKA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('c_a', 3), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved', '75/sala: pierwsza wplata na ostatnie miejsce sali');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('c_b', 4), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'waitlist' AND (v->>'waitlist_position')::integer = 8
    AND (SELECT count(*) FROM public.event_registrations WHERE event_id = 'f5100000-0000-0000-0000-000000000002'
          AND status IN ('approved','attended','no_show')) = 1,
    '75/sala: pojemnosc 1 - druga oplacona w kolejce ZA oczekujacym (pozycja 8 > 7), sala nie przepelniona');
  -- Zgloszenie bez biletu, zamowienie bez `ticket_type_id`: liczy sie sama sala.
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('nt_b', 5, NULL, true), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'waitlist'
    AND (pg_temp.osr('nt_b')).ticket_type_id IS NULL,
    '75/sala: zapis bez cennika na pelnej sali - kolejka oplacona, bez biletu');
END $$;

-- ---------------------------------------------------------------------------
-- 3) WPLATA NIE JEST AKCEPTACJA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('ap', 6), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending'
    AND (SELECT payment_status = 'paid' AND qr_token_hash IS NULL AND decided_at IS NULL
                AND decision_source IS NULL AND decided_by IS NULL AND waitlist_position IS NULL
         FROM pg_temp.osr('ap')),
    '75/akceptacja: bilet requires_approval - oplacone czeka na decyzje, bez kodu i bez stempla');
  PERFORM pg_temp.assert((SELECT sold_count FROM public.event_ticket_types WHERE id = 'f5200000-0000-0000-0000-000000000003') = 0,
    '75/akceptacja: czekajace na decyzje nie zajmuje miejsca w puli');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('fl', 7), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending',
    '75/akceptacja: przeplyw approval bez reguly - oplacone czeka na decyzje');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('r_gov', 8), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending',
    '75/akceptacja: regula "approval" na wydarzeniu natychmiastowym - czeka na decyzje');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('r_spam', 9), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending',
    '75/akceptacja: regula "reject" dopisana po zapisie - decyduje organizator, a nie wplata');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('rf_vip', 10), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved'
    AND (pg_temp.osr('rf_vip')).qr_token_hash IS NOT NULL,
    '75/akceptacja: regula "auto_approve" na przeplywie approval - przyjete z kodem');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('rf_dr', 11), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending',
    '75/akceptacja: szkic na przeplywie approval - oczekuje (pending), nie zostaje szkicem');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('r_none', 12), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved',
    '75/akceptacja: szkic bez reguly na wydarzeniu natychmiastowym - przyjety');

  -- Decyzja organizatora konczy sprawe: przyjecie wydaje kod (wplata jest).
  UPDATE public.event_registrations r SET status = 'approved', decided_at = now(),
    decided_by = 'f5000000-0000-0000-0000-000000000040', decision_source = 'organizer',
    qr_token_hash = encode(digest('x', 'sha256'), 'hex'), qr_issued_at = now()
  WHERE r.id = (pg_temp.osr('ap')).id;
  PERFORM pg_temp.assert((SELECT sold_count FROM public.event_ticket_types WHERE id = 'f5200000-0000-0000-0000-000000000003') = 1,
    '75/akceptacja: przyjecie przez organizatora zajmuje miejsce');
END $$;

-- ---------------------------------------------------------------------------
-- 4) ZGLOSZENIE JUZ W KOLEJCE - AKCEPTACJA BYLA, LICZY SIE MIEJSCE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_before public.event_registrations := pg_temp.osr('w_q');
BEGIN
  -- Sala E2 pelna: w_q (kolejka organizatora, pozycja 7) zostaje na SWOJEJ
  -- pozycji ze swoim sladem decyzji - wplata nie przestempluje go na `capacity`.
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('w_q', 13), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'waitlist'
    AND (v->>'waitlist_position')::integer = 7 AND (v->>'newly_settled')::boolean
    AND (SELECT waitlist_position = v_before.waitlist_position AND decision_source = 'organizer'
                AND decided_by = v_before.decided_by AND decided_at = v_before.decided_at
                AND payment_status = 'paid' AND qr_token_hash IS NULL
         FROM pg_temp.osr('w_q')),
    '75/kolejka: bez miejsca zostaje na SWOJEJ pozycji (7), slad decyzji organizatora bez zmian');
  -- Bilet z akceptacja, zgloszenie w kolejce, wolne miejsce: kolejka to juz
  -- decyzja organizatora - wplata przyjmuje. (Pula 1 E3 zajeta przez `ap` -
  -- zwalniamy ja, anulujac `ap`.)
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
  WHERE id = (pg_temp.osr('ap')).id;
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('w_ap', 14), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved'
    AND (SELECT waitlist_position IS NULL AND qr_token_hash IS NOT NULL FROM pg_temp.osr('w_ap')),
    '75/kolejka: w kolejce z wolnym miejscem - przyjete z kodem, bez pozycji (akceptacja juz byla)');
END $$;

-- ---------------------------------------------------------------------------
-- 5) STATUSY, KTORYCH WPLATA NIE ZMIENIA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_ns public.event_registrations;
BEGIN
  -- Przyjete przed wplata (organizator) - bez kontroli miejsc, kod powstaje,
  -- slad decyzji organizatora zostaje. Zamowienie wskazuje PELNY bilet q1:
  -- przyjete zgloszenie NIE zmienia biletu (inaczej CHECK puli wywrocilby ksiegowanie).
  v := public.payments_apply_event_ticket_outcome(
    pg_temp.os_order('ok_a', 15, 'f5200000-0000-0000-0000-000000000001'), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved'
    AND (SELECT qr_token_hash IS NOT NULL AND decision_source = 'organizer'
                AND ticket_type_id = 'f5200000-0000-0000-0000-000000000006'
         FROM pg_temp.osr('ok_a')),
    '75/bez zmian: przyjete zostaje przyjete, z kodem, na SWOIM bilecie mimo innego w zamowieniu');
  -- Nieobecny: status i kod zostaja.
  UPDATE public.event_registrations SET qr_token_hash = encode(digest('ns', 'sha256'), 'hex'),
    qr_issued_at = now() WHERE id = (pg_temp.osr('ns')).id;
  v_ns := pg_temp.osr('ns');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('ns', 16), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'no_show'
    AND (pg_temp.osr('ns')).qr_token_hash = v_ns.qr_token_hash,
    '75/bez zmian: nieobecny zostaje nieobecny, kod bez zmian');
  -- Odwolane: bez kodu, data odwolania zostaje.
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('cx', 17), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'cancelled'
    AND (SELECT qr_token_hash IS NULL AND cancelled_at IS NOT NULL AND payment_status = 'paid'
         FROM pg_temp.osr('cx')),
    '75/bez zmian: odwolane zostaje odwolane, bez kodu - wplata do zwrotu');
END $$;

-- ---------------------------------------------------------------------------
-- 6) BILET Z ZAMOWIENIA INNY NIZ W ZGLOSZENIU (oczekujace)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(
    pg_temp.os_order('x_q', 18, 'f5200000-0000-0000-0000-000000000006'), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved'
    AND (pg_temp.osr('x_q')).ticket_type_id = 'f5200000-0000-0000-0000-000000000006',
    '75/bilet: miejsce liczone wg biletu z zamowienia (bez puli) - przyjete mimo pelnej puli q1');
END $$;

-- ---------------------------------------------------------------------------
-- 7) GRUPA: GOSCIE NIE WCHODZA PRZED PROWADZACYM
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; v_o uuid := pg_temp.os_order('g_l', 19);
BEGIN
  v := public.payments_apply_event_ticket_outcome(v_o, 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'waitlist', '75/grupa: prowadzacy bez miejsca w kolejce');
  PERFORM pg_temp.assert((SELECT count(*) FROM public.event_registrations
      WHERE group_lead_registration_id = (pg_temp.osr('g_l')).id AND status = 'pending'
        AND payment_status = 'paid' AND payment_order_id = v_o AND qr_token_hash IS NULL
        AND decision_source IS NULL) = 2,
    '75/grupa: goscie rozliczeni, ale czekaja (pending) - nie przed prowadzacym');
  PERFORM pg_temp.assert(jsonb_array_length(public._event_issue_ticket_codes((pg_temp.osr('g_l')).id)) = 0,
    '75/grupa: nikt z grupy w kolejce nie dostaje biletu');
  -- Zwolnienie dwoch miejsc i awans prowadzacego: kaskada przyjmuje gosci
  -- z kontrola miejsc (pula 2: prowadzacy + jeden gosc, drugi w kolejce).
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id IN ((pg_temp.osr('g_x')).id, (pg_temp.osr('g_y')).id);
  v := public._event_waitlist_promote('f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000005',
    'f5200000-0000-0000-0000-000000000005', 1);
  PERFORM pg_temp.assert((pg_temp.osr('g_l')).status = 'approved'
    AND (pg_temp.osr('g_l')).qr_token_hash IS NOT NULL, '75/grupa: awans prowadzacego z kodem');
  PERFORM pg_temp.assert((pg_temp.osr('g_g1')).status = 'approved' AND (pg_temp.osr('g_g1')).qr_token_hash IS NOT NULL
    AND (pg_temp.osr('g_g2')).status = 'waitlist' AND (pg_temp.osr('g_g2')).decision_source = 'capacity'
    AND (pg_temp.osr('g_g2')).payment_status = 'paid'
    AND (SELECT sold_count FROM public.event_ticket_types WHERE id = 'f5200000-0000-0000-0000-000000000005') = 2,
    '75/grupa: kaskada przyjmuje pierwszego goscia, drugi oplacony w kolejce, pula 2 nie przekroczona');
END $$;

-- ---------------------------------------------------------------------------
-- 8) GOSC OPLACANY OSOBNO: IDZIE ZA PROWADZACYM
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  -- Prowadzacy h_l czeka (pending, nieoplacony) - gosc tylko rozliczony.
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('h_g', 20), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending'
    AND (SELECT payment_status = 'paid' AND qr_token_hash IS NULL FROM pg_temp.osr('h_g')),
    '75/gosc: prowadzacy nieprzyjety - oplacony gosc czeka, bez kodu');
  -- Prowadzacy przestawiony do kolejki - ponowiona wplata goscia nadal nie
  -- wpuszcza go przed prowadzacym.
  PERFORM 1 FROM public.event_registrations WHERE id = (pg_temp.osr('h_l')).id FOR UPDATE;
  UPDATE public.event_registrations SET status = 'waitlist',
    waitlist_position = public._event_next_waitlist_position('f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5', 'f5100000-0000-0000-0000-000000000005'),
    decided_at = now(), decision_source = 'capacity'
  WHERE id = (pg_temp.osr('h_l')).id;
  -- Prowadzacy tylko w kolejce - gosc nadal czeka.
  v := public.payments_apply_event_ticket_outcome('f5600000-0000-0000-0000-000000000020', 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'pending' AND NOT (v->>'newly_settled')::boolean,
    '75/gosc: prowadzacy w kolejce - gosc nie wchodzi przed nim');
  -- Prowadzacy na miejscu: gosc oplacany osobno przechodzi kontrole miejsc.
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('m_g', 22), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'approved'
    AND (pg_temp.osr('m_g')).qr_token_hash IS NOT NULL,
    '75/gosc: prowadzacy przyjety, bilet bez puli - gosc przyjety z kodem');
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('k_g', 23, NULL, true), 'paid');
  PERFORM pg_temp.assert(v->>'registration_status' = 'waitlist'
    AND (SELECT decision_source = 'capacity' AND payment_status = 'paid' FROM pg_temp.osr('k_g')),
    '75/gosc: prowadzacy przyjety, sala pelna - gosc oplacony w kolejce');
END $$;

-- ---------------------------------------------------------------------------
-- 9) ZWROT OPLACONEGO PROWADZACEGO Z KOLEJKI
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(pg_temp.os_order('c_b', 21), 'refunded');
  PERFORM pg_temp.assert((v->>'reason') = 'refund_for_other_order',
    '75/zwrot: zwrot z innego zamowienia nie rusza zgloszenia w kolejce');
  v := public.payments_apply_event_ticket_outcome('f5600000-0000-0000-0000-000000000004', 'refunded');
  PERFORM pg_temp.assert(v->>'registration_status' = 'cancelled'
    AND (SELECT payment_status = 'refunded' AND waitlist_position IS NULL FROM pg_temp.osr('c_b'))
    AND (SELECT count(*) FROM public.event_registrations WHERE event_id = 'f5100000-0000-0000-0000-000000000002'
          AND status IN ('approved','attended','no_show')) = 1,
    '75/zwrot: zwrot oplaconego z kolejki anuluje go i nie przepelnia sali');
END $$;

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'f5f5f5f5-f5f5-f5f5-f5f5-f5f5f5f5f5f5'),
  '75: sprzatanie - plik nie zostawil ani jednego wiersza');

-- ############################################################################
-- 10) DWA WEBHOOKI O OSTATNIE MIEJSCE (dwie sesje, faza zacommitowana)
--
-- Bez blokady wydarzenia i biletu PRZED wierszem zgloszenia oba ksiegowania
-- czytalyby `seats_left = 1`, oba przyjmowalyby, a CHECK puli wywracal drugie
-- - dokladnie defekt z 25_payment_binding. Sesja glowna trzyma wiersz
-- wydarzenia, oba webhooki MUSZA na nim czekac (dowod z pg_stat_activity),
-- potem jeden dostaje miejsce, drugi kolejke - i zaden nie rzuca.
-- ############################################################################
\echo '== 75 wplata bez miejsca: dwa webhooki (dwie sesje) =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug)
VALUES ('f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'Tenant F6 (wyscig wplat)', 'tf6-pay-race');
INSERT INTO auth.users (id, email) VALUES
  ('f6000000-0000-0000-0000-000000000001', 'payrace1@example.org'),
  ('f6000000-0000-0000-0000-000000000002', 'payrace2@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
  registration_mode, registration_flow, capacity)
VALUES ('f6100000-0000-0000-0000-000000000001', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6',
        'pay-race', 'Wyscig wplat', 'Payment race', now() + interval '10 days', 'published', 'form', 'instant', NULL);
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, quota)
VALUES ('f6200000-0000-0000-0000-000000000001', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6',
        'f6100000-0000-0000-0000-000000000001', 'last', 'Ostatni', 'Last', 10000, 'PLN', 1);
INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('f6300000-0000-0000-0000-000000000001', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'f6000000-0000-0000-0000-000000000001', 'payrace1@example.org', 'Pay', 'One'),
  ('f6300000-0000-0000-0000-000000000002', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'f6000000-0000-0000-0000-000000000002', 'payrace2@example.org', 'Pay', 'Two');
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status,
  registration_mode, payment_status) VALUES
  ('f6400000-0000-0000-0000-000000000001', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'f6100000-0000-0000-0000-000000000001',
   'f6300000-0000-0000-0000-000000000001', 'f6200000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid'),
  ('f6400000-0000-0000-0000-000000000002', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'f6100000-0000-0000-0000-000000000001',
   'f6300000-0000-0000-0000-000000000002', 'f6200000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid');
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata) VALUES
  ('f6600000-0000-0000-0000-000000000001', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'f6000000-0000-0000-0000-000000000001', 'paid', 10000, 'PLN',
   jsonb_build_object('event_id','f6100000-0000-0000-0000-000000000001','ticket_type_id','f6200000-0000-0000-0000-000000000001','registration_id','f6400000-0000-0000-0000-000000000001')),
  ('f6600000-0000-0000-0000-000000000002', 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6', 'f6000000-0000-0000-0000-000000000002', 'paid', 10000, 'PLN',
   jsonb_build_object('event_id','f6100000-0000-0000-0000-000000000001','ticket_type_id','f6200000-0000-0000-0000-000000000001','registration_id','f6400000-0000-0000-0000-000000000002'));

CREATE TEMP TABLE pay_race_out (who text PRIMARY KEY, res jsonb);

SELECT dblink_connect('payrace1', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
SELECT dblink_connect('payrace2', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));

BEGIN;
SELECT 1 FROM public.events WHERE id = 'f6100000-0000-0000-0000-000000000001' FOR UPDATE;
SELECT dblink_send_query('payrace1',
  $$SELECT public.payments_apply_event_ticket_outcome('f6600000-0000-0000-0000-000000000001', 'paid')$$);
SELECT dblink_send_query('payrace2',
  $$SELECT public.payments_apply_event_ticket_outcome('f6600000-0000-0000-0000-000000000002', 'paid')$$);
DO $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 300 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked FROM pg_stat_activity
    WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
      AND query LIKE '%payments_apply_event_ticket_outcome%';
    EXIT WHEN v_blocked >= 2;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  PERFORM pg_temp.assert(v_blocked = 2,
    '75/wyscig/DOWOD: OBA ksiegowania czekaja na blokadzie wiersza wydarzenia');
END $$;
COMMIT;

INSERT INTO pay_race_out SELECT 'payrace1', x::jsonb FROM dblink_get_result('payrace1') AS t(x text);
SELECT * FROM dblink_get_result('payrace1') AS t(x text);
INSERT INTO pay_race_out SELECT 'payrace2', x::jsonb FROM dblink_get_result('payrace2') AS t(x text);
SELECT * FROM dblink_get_result('payrace2') AS t(x text);

SELECT pg_temp.assert((SELECT count(*) FROM pay_race_out WHERE (res->>'applied')::boolean) = 2,
  '75/wyscig: oba ksiegowania zaksiegowane - zadne nie padlo na CHECK puli');
SELECT pg_temp.assert(
  (SELECT count(*) FROM pay_race_out WHERE res->>'registration_status' = 'approved') = 1
  AND (SELECT count(*) FROM pay_race_out WHERE res->>'registration_status' = 'waitlist') = 1,
  '75/WYSCIG: dokladnie jedno miejsce, druga wplata w kolejce');
SELECT pg_temp.assert(
  (SELECT sold_count = 1 FROM public.event_ticket_types WHERE id = 'f6200000-0000-0000-0000-000000000001')
  AND (SELECT count(*) FROM public.event_registrations
        WHERE event_id = 'f6100000-0000-0000-0000-000000000001' AND status = 'waitlist'
          AND payment_status = 'paid' AND decision_source = 'capacity') = 1,
  '75/WYSCIG: stan bazy zgodny z odpowiedziami - pula 1/1, jeden oplacony w kolejce');

SELECT dblink_disconnect('payrace1');
SELECT dblink_disconnect('payrace2');
DROP TABLE pay_race_out;
DROP EXTENSION dblink;
DELETE FROM public.domain_events WHERE tenant_id = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';
DELETE FROM public.payment_orders WHERE tenant_id = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';
DELETE FROM public.tenants WHERE id = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';
DELETE FROM auth.users WHERE id IN ('f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000002');
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6')
  AND NOT EXISTS (SELECT 1 FROM public.payment_orders WHERE tenant_id = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6'),
  '75/wyscig: sprzatanie - faza dwoch sesji nie zostawila wierszy');

\echo '== 75 wplata bez miejsca: koniec =='
