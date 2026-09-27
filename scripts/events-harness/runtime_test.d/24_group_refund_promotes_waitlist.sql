-- ============================================================================
-- 24_group_refund_promotes_waitlist - ZWROT ZA GRUPE AWANSUJE KOLEJKE TAKZE
-- ZA MIEJSCA GOSCI (20260926180000)
--
-- CO SPRAWDZA
--   1. Pelny zwrot Stripe (prowadzacy anulowany): za kazdego OPLACONEGO
--      i PRZYJETEGO goscia awansuje jedna osoba z kolejki jego biletu, PO
--      petli i Z POMINIECIEM wlasnej grupy - nieoplacony gosc tej grupy
--      stojacy na czele kolejki nie dostaje awansu (zamyka go kaskada);
--      za miejsce prowadzacego awansuje funkcja wyniku (mail z webhooka);
--      pula nie jest przekroczona; awansowani czekaja w panelu
--      i (rozliczeni) w cronie; ponowiony zwrot nikogo nie dopycha.
--   2. Zwrot czesciowy nie awansuje nikogo; zwrot czesciowy, ktory narastajaco
--      pokrywa cale obciazenie, awansuje tak samo jak pelny.
--   3. `admin_event_registration_decide` 'refund': gosc obecny liczy sie jako
--      zwolnione miejsce, gosc oplacony w kolejce i gosc wycofany przed
--      zwrotem - nie; gosc z czola kolejki nie jest awansowany (zwrot
--      zamknal go przed awansem); zwroceni goscie nie wroca z prowadzacym.
--   4. Reczny UPDATE `payment_status` bez zmiany statusu prowadzacego:
--      awans za gosci, gosc grupy w kolejce zostaje na swojej pozycji.
--   5. Zwrot bez zwolnionych miejsc gosci: awansuje tylko miejsce prowadzacego.
--   6. `_event_waitlist_promote(..., _skip_group)` wprost: NULL-e, pominiecie
--      prowadzacego i jego gosci, gosc przyjety w trakcie petli przez kaskade
--      pominiety (NOT FOUND), awans kasuje `waitlist_notified_at`.
--   7. `_event_group_promote_freed(..., p_skip_group)` wprost: NULL, pusta
--      tablica, zapis bez cennika (awans po wydarzeniu) z pominieciem grupy.
--   8. Uprawnienia nowych sygnatur.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 24 zwrot za grupe awansuje kolejke =='

BEGIN;

CREATE TEMP TABLE grf_q (k text PRIMARY KEY, u uuid);

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'rate_limit_hit') THEN
    CREATE FUNCTION public.rate_limit_hit(
      _scope text, _subject text, _max integer, _window_minutes integer DEFAULT 1
    ) RETURNS TABLE(allowed boolean, hits integer, bucket_start timestamptz)
    LANGUAGE sql AS $rl$ SELECT true, 1, now() $rl$;
  END IF;
END
$do$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'Tenant CB (zwrot grupy)', 'tcb-grf')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('cb000000-0000-0000-0000-0000000000a1', 'admin.grf@example.org'),
  ('cb000000-0000-0000-0000-000000000001', 'lead.a.grf@example.org'),
  ('cb000000-0000-0000-0000-000000000002', 'lead.b.grf@example.org'),
  ('cb000000-0000-0000-0000-000000000003', 'lead.c.grf@example.org'),
  ('cb000000-0000-0000-0000-000000000004', 'lead.d.grf@example.org'),
  ('cb000000-0000-0000-0000-000000000005', 'lead.e.grf@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb'::uuid
FROM auth.users u WHERE u.id::text LIKE 'cb000000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('cb000000-0000-0000-0000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

-- E1: formularz, bez pojemnosci. E2: pojemnosc 2, zapisy bez cennika.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('cb100000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'grf-main', 'Kongres zwrotow', 'Refund congress',
   now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('cb100000-0000-0000-0000-000000000002', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'grf-plain', 'Spotkanie bez cennika', 'Meeting without tickets',
   now() + interval '30 days', 'published', 'form', 'instant', 2);

-- T1..T5 platne z pula (po jednym na sekcje), T6 bezplatny bez puli (kolejka
-- obok - dowod, ze awans nie przechodzi na cudzy bilet), T7 bezplatny, pula 2.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_t1', 'T1', 'T1', 10000, 'PLN', 4, 0, false, true, 10, true, 5),
  ('cb200000-0000-0000-0000-000000000002', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_t2', 'T2', 'T2', 10000, 'PLN', 3, 0, false, true, 20, true, 5),
  ('cb200000-0000-0000-0000-000000000003', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_t3', 'T3', 'T3', 10000, 'PLN', 5, 0, false, true, 30, true, 5),
  ('cb200000-0000-0000-0000-000000000004', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_t4', 'T4', 'T4', 10000, 'PLN', 3, 0, false, true, 40, true, 5),
  ('cb200000-0000-0000-0000-000000000005', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_t5', 'T5', 'T5', 10000, 'PLN', 2, 0, false, true, 50, true, 5),
  ('cb200000-0000-0000-0000-000000000006', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_side', 'Boczny', 'Side', 0, 'PLN', NULL, 0, false, true, 60, true, 5),
  ('cb200000-0000-0000-0000-000000000007', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'grf_t7', 'T7', 'T7', 0, 'PLN', 2, 0, false, true, 70, true, 5);

SELECT set_config('nes.public_tenant', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', false);

-- Zapis wprost do tabeli; `_lead` dopina go jako goscia wskazanego prowadzacego.
CREATE FUNCTION pg_temp.grf_solo(_key text, _event uuid, _ticket uuid, _status text,
                                 _payment text DEFAULT 'not_required',
                                 _lead uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_person uuid := gen_random_uuid(); v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', _key || '@solo.grf.example.org', 'Sam', initcap(_key));
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     waitlist_position, decided_at, decision_source, qr_token_hash, qr_issued_at,
     group_lead_registration_id)
  VALUES
    (v_id, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', _event, v_person, _ticket, _status, 'form', _payment,
     CASE WHEN _status = 'waitlist'
          THEN public._event_next_waitlist_position('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', _event) END,
     CASE WHEN _status = 'approved' THEN now() END,
     CASE WHEN _status = 'approved' THEN 'system' END,
     CASE WHEN _status = 'approved' THEN encode(extensions.digest(_key, 'sha256'), 'hex') END,
     CASE WHEN _status = 'approved' THEN now() END,
     _lead);
  INSERT INTO grf_q VALUES (_key, v_id);
  RETURN v_id;
END $$;

-- Prowadzacy przez PRAWDZIWE `event_register` + dopisanie gosci.
CREATE FUNCTION pg_temp.grf_group(_key text, _uid uuid, _ticket uuid, _guests integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
  v_lead uuid;
  v_guests jsonb := '[]'::jsonb;
  i integer;
BEGIN
  PERFORM pg_temp.act_as(_uid, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb');
  v := public.event_register(jsonb_build_object(
    'event_slug', 'grf-main', 'ticket_type_id', _ticket,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = _uid),
    'first_name', 'Lider', 'last_name', initcap(_key),
    'consent_data_processing', true));
  v_lead := (v->>'registration_id')::uuid;
  INSERT INTO grf_q VALUES (_key, v_lead);
  FOR i IN 1.._guests LOOP
    v_guests := v_guests || jsonb_build_array(jsonb_build_object(
      'first_name', 'Gosc', 'last_name', initcap(_key) || i,
      'email', 'guest.' || _key || i || '@grf.example.org'));
  END LOOP;
  PERFORM public.event_register_group_guests(v_lead, v_guests);
  INSERT INTO grf_q
  SELECT _key || '_g' || substr(p.email_norm, length('guest.' || _key) + 1, 1), r.id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.group_lead_registration_id = v_lead;
  PERFORM pg_temp.act_as();
  RETURN v_lead;
END $$;

CREATE FUNCTION pg_temp.grf(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM grf_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.grf_row(_key text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r FROM public.event_registrations r WHERE r.id = pg_temp.grf(_key) $$;

CREATE FUNCTION pg_temp.grf_decide(_id uuid, _action text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('cb000000-0000-0000-0000-0000000000a1',
                         'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb');
  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', _id, 'action', _action, 'note', _note));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.grf_order(_id uuid, _uid uuid, _amount integer, _ticket uuid, _lead uuid)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
  VALUES (_id, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', _uid, 'paid', _amount, 'PLN',
          jsonb_build_object('event_id', 'cb100000-0000-0000-0000-000000000001',
                             'ticket_type_id', _ticket, 'registration_id', _lead));
$$;

CREATE FUNCTION pg_temp.grf_sold(_ticket uuid) RETURNS integer
LANGUAGE sql AS $$ SELECT sold_count FROM public.event_ticket_types WHERE id = _ticket $$;

-- Awansowany przez BAZE (nie przez decyzje): przyjety, z kodem, czeka na
-- powiadomienie w panelu (lustro `isAwaitingWaitlistNotice`).
CREATE FUNCTION pg_temp.grf_promoted(_key text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT r.status = 'approved' AND r.promoted_at IS NOT NULL AND r.waitlist_notified_at IS NULL
         AND r.qr_token_hash IS NOT NULL AND r.waitlist_position IS NULL
         AND r.decision_source = 'system'
  FROM public.event_registrations r WHERE r.id = pg_temp.grf(_key)
$$;

CREATE FUNCTION pg_temp.grf_issue_all(_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := public._event_issue_ticket_codes(_id);
  FOR e IN SELECT * FROM jsonb_array_elements(v) LOOP
    PERFORM public._event_ticket_code_confirm(
      (e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  RETURN jsonb_array_length(v);
END $$;

-- Kolejka INNEGO biletu - nie moze dostac zadnego miejsca w calym pliku.
SELECT pg_temp.grf_solo('x1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000006', 'waitlist');

-- ---------------------------------------------------------------------------
-- 1) PELNY ZWROT STRIPE: AWANS ZA GOSCI, PO PETLI, BEZ WLASNEJ GRUPY
-- ---------------------------------------------------------------------------
-- T1 (pula 4): prowadzacy A i trzech gosci oplaconych jednym zamowieniem.
-- Potem gosc A3 wraca do kolejki NIEOPLACONY na jej czolo,
-- a jego miejsce zajmuje zapis FILL1 - pula dalej pelna. W kolejce T1:
-- A3, W1 (oplacony), W2 (nieoplacony), W3 (oplacony), W4, W5.
-- Zwrot zwalnia 3 miejsca: A1 i A2 (awans w galezi zwrotu, z pominieciem
-- A3 z czola kolejki) i prowadzacego (awans w funkcji wyniku).
SELECT pg_temp.grf_group('a', 'cb000000-0000-0000-0000-000000000001',
  'cb200000-0000-0000-0000-000000000001', 3);
SELECT pg_temp.grf_order('cb600000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001',
  40000, 'cb200000-0000-0000-0000-000000000001', pg_temp.grf('a'));

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE (r.id = pg_temp.grf('a') OR r.group_lead_registration_id = pg_temp.grf('a'))
            AND r.status = 'approved' AND r.payment_status = 'paid') = 4
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000001') = 4,
    '24/zwrot: punkt wyjscia - grupa czworga oplacona i przyjeta, pula T1 pelna');
  PERFORM pg_temp.assert(pg_temp.grf_issue_all(pg_temp.grf('a')) = 4,
    '24/zwrot: punkt wyjscia - cztery bilety wyslane');
  UPDATE public.event_registrations SET status = 'waitlist', payment_status = 'unpaid',
    paid_at = NULL, waitlist_position = public._event_next_waitlist_position('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001'),
    decision_source = 'capacity',
    qr_token_hash = NULL, qr_issued_at = NULL
  WHERE id = pg_temp.grf('a_g3');
END $$;

SELECT pg_temp.grf_solo('fill1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'approved', 'paid');
SELECT pg_temp.grf_solo('w1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('w2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'waitlist', 'unpaid');
SELECT pg_temp.grf_solo('w3', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('w4', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('w5', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000001', 'waitlist', 'paid');

DO $$
DECLARE
  v jsonb;
  v_lead public.event_registrations;
BEGIN
  PERFORM pg_temp.assert(pg_temp.grf_sold('cb200000-0000-0000-0000-000000000001') = 4
    AND (SELECT waitlist_position FROM public.event_registrations WHERE id = pg_temp.grf('a_g3'))
      < (SELECT waitlist_position FROM public.event_registrations WHERE id = pg_temp.grf('w1')),
    '24/zwrot: punkt wyjscia - pula pelna, nieoplacony gosc A3 na czele kolejki');

  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'refunded');
  v_lead := pg_temp.grf_row('a');
  PERFORM pg_temp.assert((v->>'applied')::boolean AND v->>'outcome' = 'refunded'
    AND v_lead.status = 'cancelled' AND v_lead.payment_status = 'refunded',
    '24/zwrot: wynik zaksiegowany, prowadzacy anulowany i zwrocony');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (pg_temp.grf('a_g1'), pg_temp.grf('a_g2'))
        AND r.status = 'cancelled' AND r.payment_status = 'refunded' AND r.paid_at IS NULL
        AND r.cancelled_at = v_lead.cancelled_at
        AND r.payment_order_id = 'cb600000-0000-0000-0000-000000000001'
        AND r.qr_token_hash IS NULL AND r.qr_issued_at IS NULL
        AND r.ticket_code_sent_at IS NULL) = 2,
    '24/zwrot: oplaceni goscie anulowani i zwroceni ze stemplem prowadzacego, bez kodu QR i bez znacznika biletu');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'cancelled' AND r.payment_status = 'unpaid' AND r.promoted_at IS NULL
            AND r.waitlist_position IS NULL AND r.cancelled_at = v_lead.cancelled_at
       FROM public.event_registrations r WHERE r.id = pg_temp.grf('a_g3'))
    AND NOT EXISTS (SELECT 1 FROM public.domain_events d
                     WHERE d.aggregate_id = pg_temp.grf('a_g3')::text
                       AND d.event_type = 'event.registration.promoted.v1'),
    '24/zwrot: nieoplacony gosc grupy z czola kolejki NIE awansowal - zamknela go kaskada, bez zdarzenia awansu');
  PERFORM pg_temp.assert(pg_temp.grf_promoted('w1') AND pg_temp.grf_promoted('w2'),
    '24/zwrot: dwa miejsca gosci awansuja dwie pierwsze osoby spoza grupy - czekaja w panelu na powiadomienie');
  PERFORM pg_temp.assert((v->'waitlist'->>'promoted')::integer = 1
    AND v->'waitlist'->'registrations'->0->>'registration_id' = pg_temp.grf('w3')::text
    AND pg_temp.grf_promoted('w3'),
    '24/zwrot: miejsce prowadzacego awansuje funkcja wyniku - trzecia osoba, w wyniku dla maila z webhooka');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (pg_temp.grf('w4'), pg_temp.grf('w5'), pg_temp.grf('x1'))
        AND r.status = 'waitlist') = 3,
    '24/zwrot: czwarta i piata osoba czekaja dalej, kolejka innego biletu nietknieta');
  PERFORM pg_temp.assert(pg_temp.grf_sold('cb200000-0000-0000-0000-000000000001') = 4,
    '24/zwrot: pula T1 znow pelna (4) - awans nie wyszedl ponad wolne miejsca');
  PERFORM pg_temp.assert(
    pg_temp.grf('w1') = ANY(public._event_ticket_codes_pending(500))
    AND pg_temp.grf('w3') = ANY(public._event_ticket_codes_pending(500))
    AND NOT (pg_temp.grf('w2') = ANY(public._event_ticket_codes_pending(500))),
    '24/zwrot: rozliczeni awansowani czekaja w cronie na bilet, nieoplacony - nie');

  -- Ponowione doreczenie tego samego zwrotu: goscie juz zamknieci, pula pelna.
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'refunded');
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND (v->'waitlist'->>'promoted')::integer = 0
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.grf('w4')) = 'waitlist'
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000001') = 4,
    '24/zwrot: ponowiony webhook nie awansuje nikogo wiecej');
END $$;

-- ---------------------------------------------------------------------------
-- 2) ZWROT CZESCIOWY I ZWROT CZESCIOWY DOBIJAJACY DO PELNEGO
-- ---------------------------------------------------------------------------
SELECT pg_temp.grf_group('b', 'cb000000-0000-0000-0000-000000000002',
  'cb200000-0000-0000-0000-000000000002', 2);
SELECT pg_temp.grf_order('cb600000-0000-0000-0000-000000000002', 'cb000000-0000-0000-0000-000000000002',
  30000, 'cb200000-0000-0000-0000-000000000002', pg_temp.grf('b'));

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000002', 'paid');
  PERFORM pg_temp.assert(pg_temp.grf_sold('cb200000-0000-0000-0000-000000000002') = 3,
    '24/czesciowy: punkt wyjscia - grupa troje oplacona, pula T2 pelna');
END $$;

SELECT pg_temp.grf_solo('q1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('q2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('q3', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('q4', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000002', 'waitlist', 'paid');

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000002', 'partial_refund', 10000);
  PERFORM pg_temp.assert(v->>'outcome' = 'partial_refund'
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.grf('b')
            AND r.status = 'approved' AND r.payment_status = 'partially_refunded') = 2
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.id IN (pg_temp.grf('q1'), pg_temp.grf('q2'), pg_temp.grf('q3'), pg_temp.grf('q4'))
            AND r.status = 'waitlist') = 4
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000002') = 3,
    '24/czesciowy: zwrot czesciowy to korekta ceny - goscie zostaja, nikt nie awansuje');

  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000002', 'partial_refund', 30000);
  PERFORM pg_temp.assert(v->>'outcome' = 'refunded'
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.group_lead_registration_id = pg_temp.grf('b')
            AND r.status = 'cancelled' AND r.payment_status = 'refunded') = 2,
    '24/czesciowy: narastajacy zwrot pokrywa obciazenie - goscie zwroceni czesciowo anulowani');
  PERFORM pg_temp.assert(pg_temp.grf_promoted('q1') AND pg_temp.grf_promoted('q2')
    AND v->'waitlist'->'registrations'->0->>'registration_id' = pg_temp.grf('q3')::text
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.grf('q4')) = 'waitlist'
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000002') = 3,
    '24/czesciowy: dwa miejsca gosci i miejsce prowadzacego awansuja trzy osoby, czwarta czeka, pula pelna');
END $$;

-- ---------------------------------------------------------------------------
-- 3) DECYZJA ORGANIZATORA 'refund': KTO ZAJMOWAL MIEJSCE
-- ---------------------------------------------------------------------------
-- T3 (pula 5): prowadzacy C i czterech gosci, reczna wplata organizatora.
-- Potem C1 obecny na sali (liczy sie), C2 czeka OPLACONY w kolejce na jej
-- czole (nie liczy sie), C4 wycofal sie po wplacie (nie liczy sie), C3
-- przyjety (liczy sie). Miejsca C2 i C4 zajmuja S2 i S3 - pula pelna.
SELECT pg_temp.grf_group('c', 'cb000000-0000-0000-0000-000000000003',
  'cb200000-0000-0000-0000-000000000003', 4);

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.grf_decide(pg_temp.grf('c'), 'paid');
  PERFORM pg_temp.assert(pg_temp.grf_sold('cb200000-0000-0000-0000-000000000003') = 5,
    '24/decyzja: punkt wyjscia - reczna wplata przyjela grupe piecioosobowa, pula T3 pelna');
  v := pg_temp.grf_decide(pg_temp.grf('c_g1'), 'attended');
  UPDATE public.event_registrations SET status = 'waitlist',
    waitlist_position = public._event_next_waitlist_position('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001'),
    decision_source = 'capacity', qr_token_hash = NULL, qr_issued_at = NULL
  WHERE id = pg_temp.grf('c_g2');
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now() - interval '1 hour',
    qr_token_hash = NULL, qr_issued_at = NULL
  WHERE id = pg_temp.grf('c_g4');
END $$;

SELECT pg_temp.grf_solo('s2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'approved', 'paid');
SELECT pg_temp.grf_solo('s3', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'approved', 'paid');
SELECT pg_temp.grf_solo('z1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('z2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('z3', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('z4', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000003', 'waitlist', 'paid');

DO $$
DECLARE
  v jsonb;
  v_lead public.event_registrations;
BEGIN
  PERFORM pg_temp.assert(pg_temp.grf_sold('cb200000-0000-0000-0000-000000000003') = 5,
    '24/decyzja: punkt wyjscia - obecny, przyjety i dwa zapisy spoza grupy trzymaja pule');

  v := pg_temp.grf_decide(pg_temp.grf('c'), 'refund', 'Zwrot za grupe');
  v_lead := pg_temp.grf_row('c');
  PERFORM pg_temp.assert(v->>'status' = 'cancelled' AND v_lead.payment_status = 'refunded'
    AND (v->>'promoted_from_waitlist')::integer = 1
    AND v->'promoted'->0->>'registration_id' = pg_temp.grf('z3')::text,
    '24/decyzja: zwrot organizatora anuluje prowadzacego, a decyzja awansuje jedna osobe za jego miejsce');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.grf('c')
        AND r.status = 'cancelled' AND r.payment_status = 'refunded' AND r.qr_token_hash IS NULL) = 4,
    '24/decyzja: wszyscy oplaceni goscie anulowani i zwroceni, bez kodu QR');
  PERFORM pg_temp.assert(pg_temp.grf_promoted('z1') AND pg_temp.grf_promoted('z2'),
    '24/decyzja: goscie obecny i przyjety zwolnili dwa miejsca - dwie osoby awansowaly w galezi zwrotu');
  PERFORM pg_temp.assert(
    (SELECT promoted_at IS NULL FROM public.event_registrations WHERE id = pg_temp.grf('c_g2'))
    AND (SELECT cancelled_at < now() FROM public.event_registrations WHERE id = pg_temp.grf('c_g4')),
    '24/decyzja: oplacony gosc z czola kolejki zwrocony przed awansem (bez awansu), wycofany zachowuje swoja date');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = pg_temp.grf('z4')) = 'waitlist'
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000003') = 5,
    '24/decyzja: gosc w kolejce i wycofany nie zwolnili miejsca - czwarta osoba czeka, pula pelna');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_registrations r
                 WHERE r.group_lead_registration_id = pg_temp.grf('c')
                   AND public._event_guest_closed_with_lead(r, v_lead)),
    '24/decyzja: zwroceni goscie nie wroca przy ponownym przyjeciu prowadzacego');
END $$;

-- ---------------------------------------------------------------------------
-- 4) RECZNY UPDATE `payment_status` BEZ ZMIANY STATUSU PROWADZACEGO
-- ---------------------------------------------------------------------------
-- T4 (pula 3): prowadzacy D i dwaj goscie, reczna wplata. D2 wraca do
-- kolejki nieoplacony na jej czolo, jego miejsce zajmuje R0.
SELECT pg_temp.grf_group('d', 'cb000000-0000-0000-0000-000000000004',
  'cb200000-0000-0000-0000-000000000004', 2);

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.grf_decide(pg_temp.grf('d'), 'paid');
  UPDATE public.event_registrations SET status = 'waitlist', payment_status = 'unpaid', paid_at = NULL,
    waitlist_position = public._event_next_waitlist_position('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001'),
    decision_source = 'capacity', qr_token_hash = NULL, qr_issued_at = NULL
  WHERE id = pg_temp.grf('d_g2');
END $$;

SELECT pg_temp.grf_solo('r0', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000004', 'approved', 'paid');
SELECT pg_temp.grf_solo('y1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000004', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('y2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000004', 'waitlist', 'paid');

DO $$
BEGIN
  PERFORM pg_temp.assert(pg_temp.grf_sold('cb200000-0000-0000-0000-000000000004') = 3,
    '24/reczny: punkt wyjscia - pula T4 pelna, nieoplacony gosc D2 na czele kolejki');

  UPDATE public.event_registrations SET payment_status = 'refunded', paid_at = NULL
  WHERE id = pg_temp.grf('d');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'refunded'
       FROM public.event_registrations WHERE id = pg_temp.grf('d'))
    AND (SELECT status = 'cancelled' AND payment_status = 'refunded'
           FROM public.event_registrations WHERE id = pg_temp.grf('d_g1')),
    '24/reczny: status prowadzacego bez zmian (kaskada nie biegnie), oplacony gosc anulowany zwrotem');
  PERFORM pg_temp.assert(pg_temp.grf_promoted('y1')
    AND (SELECT status = 'waitlist' AND promoted_at IS NULL
           FROM public.event_registrations WHERE id = pg_temp.grf('d_g2'))
    AND (SELECT waitlist_position FROM public.event_registrations WHERE id = pg_temp.grf('d_g2'))
      < (SELECT waitlist_position FROM public.event_registrations WHERE id = pg_temp.grf('y2'))
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.grf('y2')) = 'waitlist'
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000004') = 3,
    '24/reczny: miejsce goscia awansuje pierwsza osobe spoza grupy, gosc grupy zostaje na swojej pozycji');
END $$;

-- ---------------------------------------------------------------------------
-- 5) ZWROT BEZ ZWOLNIONYCH MIEJSC GOSCI
-- ---------------------------------------------------------------------------
-- T5 (pula 2): prowadzacy E i gosc E1; E1 wycofal sie po wplacie, jego
-- miejsce zajmuje F0.
SELECT pg_temp.grf_group('e', 'cb000000-0000-0000-0000-000000000005',
  'cb200000-0000-0000-0000-000000000005', 1);
SELECT pg_temp.grf_order('cb600000-0000-0000-0000-000000000005', 'cb000000-0000-0000-0000-000000000005',
  20000, 'cb200000-0000-0000-0000-000000000005', pg_temp.grf('e'));

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000005', 'paid');
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now() - interval '1 hour',
    qr_token_hash = NULL, qr_issued_at = NULL
  WHERE id = pg_temp.grf('e_g1');
END $$;

SELECT pg_temp.grf_solo('f0', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000005', 'approved', 'paid');
SELECT pg_temp.grf_solo('v1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000005', 'waitlist', 'paid');
SELECT pg_temp.grf_solo('v2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000005', 'waitlist', 'paid');

DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000005', 'refunded');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND payment_status = 'refunded' AND cancelled_at < now()
       FROM public.event_registrations WHERE id = pg_temp.grf('e_g1')),
    '24/bez-miejsc: wycofany gosc zwrocony, zachowuje swoja date anulowania');
  PERFORM pg_temp.assert((v->'waitlist'->>'promoted')::integer = 1
    AND v->'waitlist'->'registrations'->0->>'registration_id' = pg_temp.grf('v1')::text
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.grf('v2')) = 'waitlist'
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000005') = 2,
    '24/bez-miejsc: awansuje tylko miejsce prowadzacego - druga osoba czeka, pula pelna');
END $$;

-- ---------------------------------------------------------------------------
-- 6) `_event_waitlist_promote(..., _skip_group)` WPROST
-- ---------------------------------------------------------------------------
-- T7 (pula 2, pusta): w kolejce L7 (zapis bez grupy), jego gosc G7, potem O1
-- i O2 (O2 powiadomiony juz kiedys o awansie).
SELECT pg_temp.grf_solo('l7', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 'waitlist');
SELECT pg_temp.grf_solo('g7', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 'waitlist',
  'not_required', pg_temp.grf('l7'));
SELECT pg_temp.grf_solo('o1', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 'waitlist');
SELECT pg_temp.grf_solo('o2', 'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 'waitlist');
UPDATE public.event_registrations SET waitlist_notified_at = now() - interval '1 day',
  promoted_at = now() - interval '1 day'
WHERE id = pg_temp.grf('o2');

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.assert(
    (public._event_waitlist_promote(NULL, 'cb100000-0000-0000-0000-000000000001', NULL, 1, NULL)->>'promoted')::integer = 0
    AND (public._event_waitlist_promote('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', NULL, NULL, 1, NULL)->>'promoted')::integer = 0,
    '24/awans: bez najemcy albo bez wydarzenia - nikt nie awansuje');

  v := public._event_waitlist_promote('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
    'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 1, pg_temp.grf('l7'));
  PERFORM pg_temp.assert((v->>'promoted')::integer = 1
    AND v->'registrations'->0->>'registration_id' = pg_temp.grf('o1')::text
    AND pg_temp.grf_promoted('o1')
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.id IN (pg_temp.grf('l7'), pg_temp.grf('g7')) AND r.status = 'waitlist') = 2,
    '24/awans: pominiecie grupy omija prowadzacego i jego goscia - awansuje pierwszy spoza grupy');

  -- Bez pominiecia, limit 2, pula 4 (zajete 1): awans L7 odpala kaskade,
  -- ktora przyjmuje G7; petla trafia G7 juz przyjetego przy wolnym miejscu
  -- (NOT FOUND) i go pomija, zamiast awansowac drugi raz. O2 poza limitem.
  UPDATE public.event_ticket_types SET quota = 4 WHERE id = 'cb200000-0000-0000-0000-000000000007';
  v := public._event_waitlist_promote('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
    'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 2);
  PERFORM pg_temp.assert((v->>'promoted')::integer = 1
    AND v->'registrations'->0->>'registration_id' = pg_temp.grf('l7')::text
    AND (SELECT status = 'approved' AND promoted_at IS NOT NULL
           FROM public.event_registrations WHERE id = pg_temp.grf('g7'))
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.grf('o2')) = 'waitlist'
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000007') = 3,
    '24/awans: gosc przyjety przez kaskade w trakcie petli nie jest awansowany drugi raz');

  v := public._event_waitlist_promote('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
    'cb100000-0000-0000-0000-000000000001', 'cb200000-0000-0000-0000-000000000007', 5, NULL);
  PERFORM pg_temp.assert((v->>'promoted')::integer = 1 AND pg_temp.grf_promoted('o2')
    AND (SELECT promoted_at > now() - interval '1 minute'
           FROM public.event_registrations WHERE id = pg_temp.grf('o2'))
    AND pg_temp.grf_sold('cb200000-0000-0000-0000-000000000007') = 4,
    '24/awans: ponowny awans kasuje dawne powiadomienie - wiersz wraca do plakietki panelu');
END $$;

-- ---------------------------------------------------------------------------
-- 7) `_event_group_promote_freed(..., p_skip_group)` WPROST
-- ---------------------------------------------------------------------------
-- E2 (pojemnosc 2, bez cennika, pusta): w kolejce NL (zapis bez grupy), jego
-- gosc NG, potem NO.
SELECT pg_temp.grf_solo('nl', 'cb100000-0000-0000-0000-000000000002', NULL, 'waitlist');
SELECT pg_temp.grf_solo('ng', 'cb100000-0000-0000-0000-000000000002', NULL, 'waitlist',
  'not_required', pg_temp.grf('nl'));
SELECT pg_temp.grf_solo('no', 'cb100000-0000-0000-0000-000000000002', NULL, 'waitlist');

DO $$
BEGIN
  PERFORM pg_temp.assert(
    public._event_group_promote_freed('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
      'cb100000-0000-0000-0000-000000000002', NULL, pg_temp.grf('nl')) = 0
    AND public._event_group_promote_freed('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
      'cb100000-0000-0000-0000-000000000002', '{}'::uuid[], pg_temp.grf('nl')) = 0
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.event_id = 'cb100000-0000-0000-0000-000000000002' AND r.status = 'waitlist') = 3,
    '24/awans-grupy: NULL i pusta tablica - nikt nie awansuje');
  PERFORM pg_temp.assert(
    public._event_group_promote_freed('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
      'cb100000-0000-0000-0000-000000000002', ARRAY[NULL]::uuid[], pg_temp.grf('nl')) = 1
    AND pg_temp.grf_promoted('no')
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.id IN (pg_temp.grf('nl'), pg_temp.grf('ng')) AND r.status = 'waitlist') = 2,
    '24/awans-grupy: zapis bez cennika awansuje po wydarzeniu z pominieciem grupy');
END $$;

-- ---------------------------------------------------------------------------
-- 8) UPRAWNIENIA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_waitlist_promote(uuid, uuid, uuid, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_waitlist_promote(uuid, uuid, uuid, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_group_promote_freed(uuid, uuid, uuid[], uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_group_promote_freed(uuid, uuid, uuid[], uuid)', 'EXECUTE'),
  '24/uprawnienia: awans z pominieciem grupy bez EXECUTE dla klienta, service_role jak dotad');

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb'),
  '24/sprzatanie: plik nie zostawil ani jednego wiersza');

\echo '== 24 zwrot za grupe: koniec =='
