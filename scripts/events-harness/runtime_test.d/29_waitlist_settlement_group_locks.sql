-- ============================================================================
-- 29_waitlist_settlement_group_locks - KOLEJKA AWANSUJE TYLKO ROZLICZONYCH,
-- BRAMKA NIE WPUSZCZA NIEROZLICZONYCH, GOSCIE GRUPY POD BLOKADA PULI
-- (REG-07, REG-08; migracje 20261012150000 i 20261012150100)
--
-- CO SPRAWDZA
--   FAZA 1 (jedna transakcja, ROLLBACK):
--     1. KRYTERIUM REG-07 „unpaid w kolejce nie awansuje": decyzja 'cancel'
--        organizatora zwalnia miejsce, dostaje je PIERWSZY ROZLICZONY;
--        nieoplacony z czola kolejki zostaje na pozycji, bez kodu QR i bez
--        zdarzenia awansu.
--     2. Prowadzacy przyjety przez organizatora PRZED wplata dopisuje gosci:
--        goscie `pending`, bez kodu i bez miejsca; wplata prowadzacego
--        przyjmuje ich na miejsca (kaskada platnosci).
--     3. Bramka: awansowany przez system bez wplaty odeslany ze stanowiska,
--        przyjety decyzja organizatora przed wplata - wpuszczony.
--   FAZA 2 (zacommitowana, dwie sesje `dblink`, wzor 20_registration.sql):
--     A. Dwa dopisania gosci na OSTATNIE miejsca pojemnosci WYDARZENIA:
--        dokladnie jedno wygrywa, drugie dostaje `sold_out` (wartosc), sala
--        nie jest przepelniona, przegrany nie zostawia osob.
--     B. To samo na puli BILETU: przegrany dostaje `sold_out`, a nie
--        nieobsluzone naruszenie CHECK `event_ticket_types_sold_within_quota`.
--     C. Dopisanie goscia i zapis nowej osoby na ostatnie miejsce: dokladnie
--        jedno miejsce, sala bez przepelnienia.
--     D. KOLEJNOSC BLOKAD: wynik platnosci prowadzacego i dopisanie gosci do
--        TEGO SAMEGO prowadzacego rownoczesnie - bez zakleszczenia (40P01).
--        Stare cialo blokowalo prowadzacego PRZED wydarzeniem i zakleszczalo
--        sie z `payments_apply_event_ticket_outcome` (wydarzenie -> bilet ->
--        zgloszenie).
--     E. (przeglad R38, 20261012180300) Ten sam NOWY gosc u dwoch prowadzacych
--        naraz, droga serwerowa `event_register_group_guests_for_client`:
--        obie odpowiedzi identyczne `{ok:true, added:1}`, gosc zapisany raz,
--        a jego adres wraca wylacznie w dostawie serwera przegranego.
--   W kazdym wariancie sesja glowna trzyma wiersz wydarzenia, a asercja
--   dowodzi, ze OBIE sesje NAPRAWDE czekaja na blokadzie, zanim ja zwolni.
--
-- SPRZATANIE: faza 1 - ROLLBACK; faza 2 usuwa wlasnego najemce (kaskada),
-- konta, kubelki prob i rozszerzenie dblink, i sprawdza, ze nic nie zostalo.
-- ============================================================================

\echo '== 29 kolejka rozliczonych i blokady puli gosci =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('29292929-2929-4929-8929-292929292929', 'Tenant 29 (kolejka rozliczonych)', 't29-settle')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('29000000-0000-4000-8000-0000000000a1', 'admin.29@example.org'),
  ('29000000-0000-4000-8000-0000000000c1', 'lead.29@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('29000000-0000-4000-8000-0000000000a1', '29292929-2929-4929-8929-292929292929'),
  ('29000000-0000-4000-8000-0000000000c1', '29292929-2929-4929-8929-292929292929')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('29000000-0000-4000-8000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
                           registration_mode, registration_flow, capacity) VALUES
  ('29100000-0000-4000-8000-000000000001', '29292929-2929-4929-8929-292929292929', 't29-main',
   'Kolejka rozliczonych', 'Settled queue', now() + interval '30 days', 'published', 'form', 'instant', NULL);

-- T1: platny, pula 2 (kryterium). T2: platny z grupa, pula 5 (goscie).
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       quota, group_registration_enabled, group_max_size) VALUES
  ('29200000-0000-4000-8000-000000000001', '29292929-2929-4929-8929-292929292929',
   '29100000-0000-4000-8000-000000000001', 't29_queue', 'Kolejka', 'Queue', 10000, 'PLN', 2, false, 10),
  ('29200000-0000-4000-8000-000000000002', '29292929-2929-4929-8929-292929292929',
   '29100000-0000-4000-8000-000000000001', 't29_group', 'Grupa', 'Group', 10000, 'PLN', 5, true, 5);

INSERT INTO public.event_checkpoints (id, tenant_id, event_id, name_pl, name_en, kind, direction_mode,
                                      access_mode, dedupe_window_seconds) VALUES
  ('29c00000-0000-4000-8000-000000000001', '29292929-2929-4929-8929-292929292929',
   '29100000-0000-4000-8000-000000000001', 'Brama', 'Gate', 'event_entry', 'in_out', 'control', 60);

SELECT set_config('nes.public_tenant', '29292929-2929-4929-8929-292929292929', false);

CREATE TEMP TABLE t29_q (k text PRIMARY KEY, id uuid NOT NULL, person uuid NOT NULL);

CREATE FUNCTION pg_temp.t29_reg(_k text, _ticket uuid, _status text, _payment text,
                                _source text DEFAULT NULL, _position integer DEFAULT NULL,
                                _qr text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_person uuid := gen_random_uuid(); v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, '29292929-2929-4929-8929-292929292929', _k || '@t29.example.org', 'Osoba', initcap(_k));
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     waitlist_position, decided_at, decision_source, promoted_at, qr_token_hash, qr_issued_at)
  VALUES
    (v_id, '29292929-2929-4929-8929-292929292929', '29100000-0000-4000-8000-000000000001', v_person,
     _ticket, _status, 'form', _payment, _position,
     CASE WHEN _source IS NOT NULL THEN now() END, _source,
     CASE WHEN _source = 'system' AND _status = 'approved' THEN now() END,
     CASE WHEN _qr IS NOT NULL THEN encode(extensions.digest(_qr, 'sha256'), 'hex') END,
     CASE WHEN _qr IS NOT NULL THEN now() END);
  INSERT INTO t29_q VALUES (_k, v_id, v_person);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.t29(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM t29_q WHERE k = _k $$;
CREATE FUNCTION pg_temp.t29p(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT person FROM t29_q WHERE k = _k $$;
CREATE FUNCTION pg_temp.t29_row(_k text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r FROM public.event_registrations r WHERE r.id = pg_temp.t29(_k) $$;

CREATE FUNCTION pg_temp.t29_admin(_fn text, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('29000000-0000-4000-8000-0000000000a1', '29292929-2929-4929-8929-292929292929');
  EXECUTE format('SELECT public.%I($1)', _fn) INTO v USING _payload;
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

-- ---------------------------------------------------------------------------
-- 1) KRYTERIUM REG-07: NIEOPLACONY W KOLEJCE NIE AWANSUJE
-- ---------------------------------------------------------------------------
SELECT pg_temp.t29_reg('s1', '29200000-0000-4000-8000-000000000001', 'approved', 'not_required', 'system');
SELECT pg_temp.t29_reg('s2', '29200000-0000-4000-8000-000000000001', 'approved', 'not_required', 'system');
SELECT pg_temp.t29_reg('u1', '29200000-0000-4000-8000-000000000001', 'waitlist', 'unpaid', 'organizer', 1);
SELECT pg_temp.t29_reg('p1', '29200000-0000-4000-8000-000000000001', 'waitlist', 'paid', 'capacity', 2);

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t29_admin('admin_event_registration_decide',
    jsonb_build_object('registration_id', pg_temp.t29('s1'), 'action', 'cancel'));
  PERFORM pg_temp.assert(
    (v->>'promoted_from_waitlist')::integer = 1
    AND (v->'promoted'->0->>'registration_id')::uuid = pg_temp.t29('p1')
    AND (pg_temp.t29_row('p1')).status = 'approved' AND (pg_temp.t29_row('p1')).qr_token_hash IS NOT NULL,
    '29/KRYTERIUM REG-07: zwolnione miejsce dostaje pierwszy ROZLICZONY z kolejki');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'waitlist' AND r.waitlist_position = 1 AND r.promoted_at IS NULL AND r.qr_token_hash IS NULL
       FROM pg_temp.t29_row('u1') r)
    AND NOT EXISTS (SELECT 1 FROM public.domain_events d
                     WHERE d.aggregate_id = pg_temp.t29('u1')::text
                       AND d.event_type = 'event.registration.promoted.v1'),
    '29/KRYTERIUM REG-07: nieoplacony w kolejce nie awansuje (pozycja 1, bez kodu, bez zdarzenia awansu)');
  PERFORM pg_temp.assert(
    (SELECT sold_count FROM public.event_ticket_types WHERE id = '29200000-0000-4000-8000-000000000001') = 2,
    '29/kolejka: pula T1 nadal 2 z 2 - awans nie wyszedl ponad zwolnione miejsce');
END $$;

-- ---------------------------------------------------------------------------
-- 2) GOSCIE PROWADZACEGO PRZYJETEGO PRZED WPLATA CZEKAJA NA WPLATE
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb;
  v_lead uuid;
BEGIN
  PERFORM pg_temp.act_as('29000000-0000-4000-8000-0000000000c1', '29292929-2929-4929-8929-292929292929');
  v := public.event_register(jsonb_build_object(
    'event_slug', 't29-main', 'ticket_type_id', '29200000-0000-4000-8000-000000000002',
    'email', 'lead.29@example.org', 'first_name', 'Lena', 'last_name', 'Prowadzaca',
    'consent_data_processing', true));
  PERFORM pg_temp.act_as();
  v_lead := (v->>'registration_id')::uuid;
  INSERT INTO t29_q SELECT 'lead', v_lead, r.person_id FROM public.event_registrations r WHERE r.id = v_lead;
  PERFORM pg_temp.assert((pg_temp.t29_row('lead')).status = 'pending'
    AND (pg_temp.t29_row('lead')).payment_status = 'unpaid',
    '29/grupa: punkt wyjscia - platny prowadzacy czeka na wplate');

  v := pg_temp.t29_admin('admin_event_registration_decide',
    jsonb_build_object('registration_id', v_lead, 'action', 'approve'));
  PERFORM pg_temp.assert((pg_temp.t29_row('lead')).status = 'approved'
    AND (pg_temp.t29_row('lead')).decision_source = 'organizer'
    AND (pg_temp.t29_row('lead')).qr_token_hash IS NULL,
    '29/grupa: organizator przyjal prowadzacego PRZED wplata - bez kodu QR');

  PERFORM pg_temp.act_as('29000000-0000-4000-8000-0000000000c1', '29292929-2929-4929-8929-292929292929');
  v := public.event_register_group_guests(v_lead,
    '[{"first_name":"Gosc","last_name":"Jeden","email":"guest1.t29@example.org"},
      {"first_name":"Gosc","last_name":"Dwa","email":"guest2.t29@example.org"}]'::jsonb);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert((v->>'ok')::boolean AND (v->>'added')::integer = 2,
    '29/grupa: dopisano dwoch gosci ({ok:true, added})');
  PERFORM pg_temp.assert(
    (SELECT bool_and(r.status = 'pending' AND r.payment_status = 'unpaid' AND r.qr_token_hash IS NULL)
       FROM public.event_registrations r WHERE r.group_lead_registration_id = v_lead)
    AND (SELECT sold_count FROM public.event_ticket_types WHERE id = '29200000-0000-4000-8000-000000000002') = 1,
    '29/REG-07: goscie prowadzacego bez wplaty czekaja w pending - bez kodu i bez miejsca w puli');

  INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
  VALUES ('29600000-0000-4000-8000-000000000001', '29292929-2929-4929-8929-292929292929',
          '29000000-0000-4000-8000-0000000000c1', 'paid', 30000, 'PLN',
          jsonb_build_object('event_id', '29100000-0000-4000-8000-000000000001',
                             'ticket_type_id', '29200000-0000-4000-8000-000000000002',
                             'registration_id', v_lead));
  v := public.payments_apply_event_ticket_outcome('29600000-0000-4000-8000-000000000001', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE (r.id = v_lead OR r.group_lead_registration_id = v_lead)
            AND r.status = 'approved' AND r.payment_status = 'paid' AND r.qr_token_hash IS NOT NULL) = 3
    AND (SELECT sold_count FROM public.event_ticket_types WHERE id = '29200000-0000-4000-8000-000000000002') = 3,
    '29/grupa: wplata prowadzacego przyjmuje gosci na miejsca z kodami (pula 3)');
END $$;

-- ---------------------------------------------------------------------------
-- 3) BRAMKA: NIEROZLICZONY ODESLANY, FURTKA ORGANIZATORA WPUSZCZA
-- ---------------------------------------------------------------------------
SELECT pg_temp.t29_reg('legacy', NULL, 'approved', 'unpaid', 'system', NULL, 't29-legacy-qr');
SELECT pg_temp.t29_reg('override', NULL, 'pending', 'unpaid');

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.t29_admin('admin_event_registration_decide',
    jsonb_build_object('registration_id', pg_temp.t29('override'), 'action', 'approve'));

  v := pg_temp.t29_admin('admin_event_checkin_manual', jsonb_build_object(
    'event_id', '29100000-0000-4000-8000-000000000001', 'checkpoint_id', '29c00000-0000-4000-8000-000000000001',
    'person_id', pg_temp.t29p('legacy'), 'direction', 'in', 'source', 'name_search',
    'client_scan_uid', 't29-desk-legacy'));
  PERFORM pg_temp.assert(NOT (v->>'admit')::boolean AND v->>'result' = 'denied_registration_status'
    AND (pg_temp.t29_row('legacy')).attended_at IS NULL,
    '29/bramka REG-07: awansowany przez system bez wplaty odeslany, bez stempla obecnosci');

  v := pg_temp.t29_admin('admin_event_checkin_manual', jsonb_build_object(
    'event_id', '29100000-0000-4000-8000-000000000001', 'checkpoint_id', '29c00000-0000-4000-8000-000000000001',
    'person_id', pg_temp.t29p('override'), 'direction', 'in', 'source', 'name_search',
    'client_scan_uid', 't29-desk-override'));
  PERFORM pg_temp.assert((v->>'admit')::boolean AND v->>'result' = 'granted',
    '29/bramka: przyjety decyzja organizatora przed wplata wchodzi (swiadoma furtka)');
END $$;

ROLLBACK;
SELECT pg_temp.act_as();

-- ############################################################################
-- FAZA 2 - BLOKADY PULI POD WSPOLBIEZNOSCIA (zacommitowana, dwie sesje)
-- ############################################################################
\echo '== 29 blokady puli gosci: dwie sesje =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'Tenant 29 (wyscig gosci)', 't29-race');

INSERT INTO auth.users (id, email) VALUES
  ('c9000000-0000-4000-8000-000000000001', 'race1.t29@example.org'),
  ('c9000000-0000-4000-8000-000000000002', 'race2.t29@example.org'),
  ('c9000000-0000-4000-8000-000000000003', 'race3.t29@example.org'),
  ('c9000000-0000-4000-8000-000000000004', 'race4.t29@example.org');
INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9'::uuid FROM auth.users u WHERE u.id::text LIKE 'c9000000-%';

-- A: pojemnosc wydarzenia 4, bilet bez puli. B: bez pojemnosci, pula biletu 4.
-- C: pojemnosc 3. D: bilet platny bez puli (wynik platnosci kontra goscie).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
                           registration_mode, registration_flow, capacity) VALUES
  ('c9100000-0000-4000-8000-00000000000a', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 't29-race-a',
   'Wyscig A', 'Race A', now() + interval '10 days', 'published', 'form', 'instant', 4),
  ('c9100000-0000-4000-8000-00000000000b', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 't29-race-b',
   'Wyscig B', 'Race B', now() + interval '10 days', 'published', 'form', 'instant', NULL),
  ('c9100000-0000-4000-8000-00000000000c', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 't29-race-c',
   'Wyscig C', 'Race C', now() + interval '10 days', 'published', 'form', 'instant', 3),
  ('c9100000-0000-4000-8000-00000000000d', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 't29-race-d',
   'Wyscig D', 'Race D', now() + interval '10 days', 'published', 'form', 'instant', NULL);

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       quota, group_registration_enabled, group_max_size) VALUES
  ('c9200000-0000-4000-8000-00000000000a', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9100000-0000-4000-8000-00000000000a', 't29_race_a', 'Wyscig A', 'Race A', 0, 'PLN', NULL, true, 5),
  ('c9200000-0000-4000-8000-00000000000b', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9100000-0000-4000-8000-00000000000b', 't29_race_b', 'Wyscig B', 'Race B', 0, 'PLN', 4, true, 5),
  ('c9200000-0000-4000-8000-00000000000c', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9100000-0000-4000-8000-00000000000c', 't29_race_c', 'Wyscig C', 'Race C', 0, 'PLN', NULL, true, 5),
  ('c9200000-0000-4000-8000-00000000000d', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9100000-0000-4000-8000-00000000000d', 't29_race_d', 'Wyscig D', 'Race D', 10000, 'PLN', NULL, true, 5);

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('c9300000-0000-4000-8000-000000000001', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9000000-0000-4000-8000-000000000001', 'race1.t29@example.org', 'Race', 'Jeden'),
  ('c9300000-0000-4000-8000-000000000002', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9000000-0000-4000-8000-000000000002', 'race2.t29@example.org', 'Race', 'Dwa'),
  ('c9300000-0000-4000-8000-000000000003', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9000000-0000-4000-8000-000000000003', 'race3.t29@example.org', 'Race', 'Trzy'),
  ('c9300000-0000-4000-8000-000000000004', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9000000-0000-4000-8000-000000000004', 'race4.t29@example.org', 'Race', 'Cztery'),
  ('c9300000-0000-4000-8000-0000000000f1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   NULL, 'filler.t29@example.org', 'Zajete', 'Miejsce');

-- Prowadzacy: A i B - konta 1 i 2 (przyjeci, bezplatnie); C - konto 4 obok
-- zapisu zajmujacego drugie miejsce; D - konto 3, czeka na wplate.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   decided_at, decision_source, created_by) VALUES
  ('c9400000-0000-4000-8000-0000000000a1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000a',
   'c9300000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-00000000000a', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000001'),
  ('c9400000-0000-4000-8000-0000000000a2', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000a',
   'c9300000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-00000000000a', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000002'),
  ('c9400000-0000-4000-8000-0000000000b1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000b',
   'c9300000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-00000000000b', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000001'),
  ('c9400000-0000-4000-8000-0000000000b2', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000b',
   'c9300000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-00000000000b', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000002'),
  ('c9400000-0000-4000-8000-0000000000c1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000c',
   'c9300000-0000-4000-8000-000000000004', 'c9200000-0000-4000-8000-00000000000c', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000004'),
  ('c9400000-0000-4000-8000-0000000000c2', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000c',
   'c9300000-0000-4000-8000-0000000000f1', 'c9200000-0000-4000-8000-00000000000c', 'approved', 'form', 'not_required',
   now(), 'system', NULL),
  ('c9400000-0000-4000-8000-0000000000d1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000d',
   'c9300000-0000-4000-8000-000000000003', 'c9200000-0000-4000-8000-00000000000d', 'pending', 'form', 'unpaid',
   NULL, NULL, 'c9000000-0000-4000-8000-000000000003');

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
VALUES ('c9600000-0000-4000-8000-0000000000d1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
        'c9000000-0000-4000-8000-000000000003', 'paid', 10000, 'PLN',
        jsonb_build_object('event_id', 'c9100000-0000-4000-8000-00000000000d',
                           'ticket_type_id', 'c9200000-0000-4000-8000-00000000000d',
                           'registration_id', 'c9400000-0000-4000-8000-0000000000d1'));

CREATE TEMP TABLE r29_out (variant text, who text, res jsonb, err text, PRIMARY KEY (variant, who));
CREATE TEMP TABLE r29_pid (who text PRIMARY KEY, pid integer NOT NULL);

SELECT dblink_connect('r29a', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
SELECT dblink_connect('r29b', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'), current_database()));
SELECT x FROM dblink('r29a',
  $$SELECT set_config('nes.public_tenant','c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',false)$$) AS t(x text);
SELECT x FROM dblink('r29b',
  $$SELECT set_config('nes.public_tenant','c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',false)$$) AS t(x text);
INSERT INTO r29_pid SELECT 'r29a', x::integer FROM dblink('r29a', 'SELECT pg_backend_pid()') AS t(x text);
INSERT INTO r29_pid SELECT 'r29b', x::integer FROM dblink('r29b', 'SELECT pg_backend_pid()') AS t(x text);

SELECT pg_temp.assert(
  (SELECT count(DISTINCT pid) FROM r29_pid) = 2
  AND NOT EXISTS (SELECT 1 FROM r29_pid WHERE pid = pg_backend_pid()),
  '29/wyscig: dwie OSOBNE sesje serwera, rozne od sesji glownej');

-- Tozsamosc sesji: konto wolajace (auth.uid() harnessu czyta claim.sub).
CREATE FUNCTION pg_temp.r29_as(_conn text, _uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM dblink(_conn, format(
    'SELECT set_config(''request.jwt.claim.sub'', %L, false)', COALESCE(_uid::text, ''))) AS t(x text);
END $$;

-- Czeka, az WSZYSTKIE wskazane sesje stoja na blokadzie. pg_stat_clear_snapshot
-- jest warunkiem dzialania petli (migawka pg_stat_* trzyma sie transakcji -
-- patrz 20_registration.sql).
CREATE FUNCTION pg_temp.r29_wait(_who text[], _label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 300 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked
      FROM pg_stat_activity a JOIN r29_pid p ON p.pid = a.pid
     WHERE p.who = ANY (_who) AND a.wait_event_type = 'Lock';
    EXIT WHEN v_blocked >= cardinality(_who);
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  PERFORM pg_temp.assert(v_blocked = cardinality(_who), _label);
END $$;

-- Zbiera odpowiedz sesji: wynik albo komunikat bledu (fail = false - blad
-- zdalny nie przerywa skryptu, trafia do asercji).
CREATE FUNCTION pg_temp.r29_collect(_variant text, _conn text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_res text; v_err text;
BEGIN
  SELECT x INTO v_res FROM dblink_get_result(_conn, false) AS t(x text);
  v_err := NULLIF(dblink_error_message(_conn), 'OK');
  PERFORM 1 FROM dblink_get_result(_conn, false) AS t(x text);
  INSERT INTO r29_out VALUES (_variant, _conn, v_res::jsonb, v_err);
END $$;

-- ---------------------------------------------------------------------------
-- A) POJEMNOSC WYDARZENIA: dwa dopisania po dwoch gosci na dwa wolne miejsca
-- ---------------------------------------------------------------------------
SELECT pg_temp.r29_as('r29a', 'c9000000-0000-4000-8000-000000000001');
SELECT pg_temp.r29_as('r29b', 'c9000000-0000-4000-8000-000000000002');

BEGIN;
SELECT 1 FROM public.events WHERE id = 'c9100000-0000-4000-8000-00000000000a' FOR UPDATE;
SELECT dblink_send_query('r29a', $$SELECT public.event_register_group_guests('c9400000-0000-4000-8000-0000000000a1',
  '[{"first_name":"Gosc","last_name":"Ajeden","email":"a1g1.t29@example.org"},
    {"first_name":"Gosc","last_name":"Adwa","email":"a1g2.t29@example.org"}]'::jsonb)$$);
SELECT dblink_send_query('r29b', $$SELECT public.event_register_group_guests('c9400000-0000-4000-8000-0000000000a2',
  '[{"first_name":"Gosc","last_name":"Btrzy","email":"a2g1.t29@example.org"},
    {"first_name":"Gosc","last_name":"Bcztery","email":"a2g2.t29@example.org"}]'::jsonb)$$);
SELECT pg_temp.r29_wait(ARRAY['r29a', 'r29b'],
  '29/A DOWOD: OBA dopisania czekaja JEDNOCZESNIE na blokadzie wydarzenia');
COMMIT;
SELECT pg_temp.r29_collect('A', 'r29a');
SELECT pg_temp.r29_collect('A', 'r29b');

SELECT pg_temp.assert(
  (SELECT count(*) FROM r29_out WHERE variant = 'A' AND err IS NULL AND res IS NOT NULL) = 2,
  '29/A: obie sesje oddaly wartosc - zadna nie padla na wyjatku');
SELECT pg_temp.assert(
  (SELECT count(*) FROM r29_out WHERE variant = 'A' AND (res->>'ok')::boolean AND (res->>'added')::integer = 2) = 1
  AND (SELECT count(*) FROM r29_out WHERE variant = 'A' AND res = '{"ok": false, "error": "sold_out"}'::jsonb) = 1,
  '29/A REG-08: DOKLADNIE JEDNO dopisanie zajelo ostatnie miejsca, drugie dostalo sold_out');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE event_id = 'c9100000-0000-4000-8000-00000000000a' AND status IN ('approved', 'attended', 'no_show')) = 4,
  '29/A REG-08: sala ma 4 z 4 miejsc - events.capacity nie jest przekroczone');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_people
    WHERE tenant_id = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9' AND email_norm LIKE 'a_g_.t29@example.org') = 2,
  '29/A: przegrany nie zostawil osob w kartotece (cala proba wycofana)');

-- ---------------------------------------------------------------------------
-- B) PULA BILETU: przegrany dostaje sold_out, nie naruszenie CHECK
-- ---------------------------------------------------------------------------
BEGIN;
SELECT 1 FROM public.events WHERE id = 'c9100000-0000-4000-8000-00000000000b' FOR UPDATE;
SELECT dblink_send_query('r29a', $$SELECT public.event_register_group_guests('c9400000-0000-4000-8000-0000000000b1',
  '[{"first_name":"Gosc","last_name":"Bjeden","email":"b1g1.t29@example.org"},
    {"first_name":"Gosc","last_name":"Bdwa","email":"b1g2.t29@example.org"}]'::jsonb)$$);
SELECT dblink_send_query('r29b', $$SELECT public.event_register_group_guests('c9400000-0000-4000-8000-0000000000b2',
  '[{"first_name":"Gosc","last_name":"Btrzy","email":"b2g1.t29@example.org"},
    {"first_name":"Gosc","last_name":"Bcztery","email":"b2g2.t29@example.org"}]'::jsonb)$$);
SELECT pg_temp.r29_wait(ARRAY['r29a', 'r29b'],
  '29/B DOWOD: OBA dopisania czekaja JEDNOCZESNIE na blokadzie wydarzenia');
COMMIT;
SELECT pg_temp.r29_collect('B', 'r29a');
SELECT pg_temp.r29_collect('B', 'r29b');

SELECT pg_temp.assert(
  (SELECT count(*) FROM r29_out WHERE variant = 'B' AND (res->>'ok')::boolean AND (res->>'added')::integer = 2) = 1
  AND (SELECT count(*) FROM r29_out WHERE variant = 'B' AND res = '{"ok": false, "error": "sold_out"}'::jsonb) = 1
  AND NOT EXISTS (SELECT 1 FROM r29_out WHERE variant = 'B' AND err IS NOT NULL),
  '29/B REG-08: przegrany dostaje sold_out, a nie event_ticket_types_sold_within_quota');
SELECT pg_temp.assert(
  (SELECT sold_count = 4 AND quota = 4 FROM public.event_ticket_types
    WHERE id = 'c9200000-0000-4000-8000-00000000000b'),
  '29/B REG-08: pula biletu 4 z 4 - nie przekroczona');

-- ---------------------------------------------------------------------------
-- C) GOSC I NOWY ZAPIS NA OSTATNIE MIEJSCE
-- ---------------------------------------------------------------------------
SELECT pg_temp.r29_as('r29a', 'c9000000-0000-4000-8000-000000000004');
SELECT pg_temp.r29_as('r29b', NULL);

-- Zapis zglasza sie PIERWSZY. Stare cialo gosci liczylo miejsca BEZ blokady
-- i stawalo dopiero przy kluczu obcym wydarzenia - za zapisem, ktory wzial
-- ostatnie miejsce; potem wstawialo goscia ponad pojemnosc.
BEGIN;
SELECT 1 FROM public.events WHERE id = 'c9100000-0000-4000-8000-00000000000c' FOR UPDATE;
SELECT dblink_send_query('r29b', $$SELECT public.event_register(jsonb_build_object(
  'event_id','c9100000-0000-4000-8000-00000000000c', 'ticket_type_id','c9200000-0000-4000-8000-00000000000c',
  'email','walkin.t29@example.org', 'first_name','Nowy', 'last_name','Zapis',
  'consent_data_processing', true))$$);
SELECT pg_temp.r29_wait(ARRAY['r29b'], '29/C: nowy zapis czeka na blokadzie wydarzenia');
SELECT dblink_send_query('r29a', $$SELECT public.event_register_group_guests('c9400000-0000-4000-8000-0000000000c1',
  '[{"first_name":"Gosc","last_name":"Cjeden","email":"c1g1.t29@example.org"}]'::jsonb)$$);
SELECT pg_temp.r29_wait(ARRAY['r29a', 'r29b'],
  '29/C DOWOD: dopisanie goscia i nowy zapis czekaja JEDNOCZESNIE na blokadzie wydarzenia');
COMMIT;
SELECT pg_temp.r29_collect('C', 'r29a');
SELECT pg_temp.r29_collect('C', 'r29b');

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM r29_out WHERE variant = 'C' AND err IS NOT NULL)
  AND (
    ((SELECT (res->>'added')::integer FROM r29_out WHERE variant = 'C' AND who = 'r29a') = 1
      AND (SELECT res->>'status' FROM r29_out WHERE variant = 'C' AND who = 'r29b') = 'waitlist')
    OR ((SELECT res FROM r29_out WHERE variant = 'C' AND who = 'r29a') = '{"ok": false, "error": "sold_out"}'::jsonb
      AND (SELECT res->>'status' FROM r29_out WHERE variant = 'C' AND who = 'r29b') = 'approved')),
  '29/C REG-08: ostatnie miejsce dostaje DOKLADNIE jeden - gosc albo nowy zapis (drugi: kolejka / sold_out)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE event_id = 'c9100000-0000-4000-8000-00000000000c' AND status IN ('approved', 'attended', 'no_show')) = 3,
  '29/C REG-08: sala ma 3 z 3 miejsc - bez przepelnienia');

-- ---------------------------------------------------------------------------
-- D) KOLEJNOSC BLOKAD: wynik platnosci kontra goscie tego samego prowadzacego
-- ---------------------------------------------------------------------------
-- Platnosc zglasza sie PIERWSZA (dostanie wydarzenie pierwsza), goscie - po
-- niej. Stare cialo trzymalo juz wtedy blokade prowadzacego i czekalo na
-- wydarzenie, a platnosc z wydarzeniem w reku czekala na prowadzacego: 40P01.
SELECT pg_temp.r29_as('r29a', NULL);
SELECT pg_temp.r29_as('r29b', 'c9000000-0000-4000-8000-000000000003');

BEGIN;
SELECT 1 FROM public.events WHERE id = 'c9100000-0000-4000-8000-00000000000d' FOR UPDATE;
SELECT dblink_send_query('r29a',
  $$SELECT public.payments_apply_event_ticket_outcome('c9600000-0000-4000-8000-0000000000d1', 'paid')$$);
SELECT pg_temp.r29_wait(ARRAY['r29a'], '29/D: wynik platnosci czeka na blokadzie wydarzenia');
SELECT dblink_send_query('r29b', $$SELECT public.event_register_group_guests('c9400000-0000-4000-8000-0000000000d1',
  '[{"first_name":"Gosc","last_name":"Djeden","email":"d1g1.t29@example.org"}]'::jsonb)$$);
SELECT pg_temp.r29_wait(ARRAY['r29a', 'r29b'],
  '29/D DOWOD: platnosc i dopisanie gosci czekaja JEDNOCZESNIE');
COMMIT;
SELECT pg_temp.r29_collect('D', 'r29a');
SELECT pg_temp.r29_collect('D', 'r29b');

-- Zakleszczenie bywa tez WARTOSCIA: funkcja gosci lapie nieoczekiwany blad
-- (40P01 tez) jako `unknown`, wiec asercja patrzy na oba kanaly.
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM r29_out WHERE variant = 'D'
               AND (err IS NOT NULL OR res IS NULL OR res->>'error' = 'unknown')),
  '29/D REG-08: brak zakleszczenia - obie sesje skonczyly sie bez bledu i bez `unknown` (bez 40P01)');
SELECT pg_temp.assert(
  (SELECT (res->>'applied')::boolean FROM r29_out WHERE variant = 'D' AND who = 'r29a')
  AND (SELECT status = 'approved' AND payment_status = 'paid' FROM public.event_registrations
        WHERE id = 'c9400000-0000-4000-8000-0000000000d1')
  AND (
    ((SELECT res FROM r29_out WHERE variant = 'D' AND who = 'r29b') = '{"ok": false, "error": "already_settled"}'::jsonb
      AND NOT EXISTS (SELECT 1 FROM public.event_registrations
                       WHERE group_lead_registration_id = 'c9400000-0000-4000-8000-0000000000d1'))
    OR ((SELECT (res->>'added')::integer FROM r29_out WHERE variant = 'D' AND who = 'r29b') = 1
      AND (SELECT bool_and(status = 'approved' AND payment_status = 'paid') FROM public.event_registrations
            WHERE group_lead_registration_id = 'c9400000-0000-4000-8000-0000000000d1'))),
  '29/D: stan spojny - prowadzacy oplacony; goscie albo odrzuceni jako already_settled, albo oplaceni razem z nim');

-- ---------------------------------------------------------------------------
-- E) TEN SAM NOWY GOSC U DWOCH PROWADZACYCH NARAZ (przeglad R38, 20261012180300)
-- ---------------------------------------------------------------------------
-- Droga produkcyjna (`event_register_group_guests_for_client`, serwer):
-- przegrany wyscigu widzi goscia juz zapisanego przez zwyciezce i POMIJA go
-- bez sladu - obie odpowiedzi sa identyczne `{ok:true, added:1}`, a adres
-- goscia wraca wylacznie w dostawie serwera przegranego (wiadomosc „juz
-- zapisany"). Stare cialo odpowiadalo przegranemu `already_registered: <adres>`.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status,
                           registration_mode, registration_flow, capacity) VALUES
  ('c9100000-0000-4000-8000-00000000000e', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 't29-race-e',
   'Wyscig E', 'Race E', now() + interval '10 days', 'published', 'form', 'instant', NULL);
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
                                       quota, group_registration_enabled, group_max_size) VALUES
  ('c9200000-0000-4000-8000-00000000000e', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9',
   'c9100000-0000-4000-8000-00000000000e', 't29_race_e', 'Wyscig E', 'Race E', 0, 'PLN', NULL, true, 5);
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
   decided_at, decision_source, created_by) VALUES
  ('c9400000-0000-4000-8000-0000000000e1', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000e',
   'c9300000-0000-4000-8000-000000000001', 'c9200000-0000-4000-8000-00000000000e', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000001'),
  ('c9400000-0000-4000-8000-0000000000e2', 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9100000-0000-4000-8000-00000000000e',
   'c9300000-0000-4000-8000-000000000002', 'c9200000-0000-4000-8000-00000000000e', 'approved', 'form', 'not_required',
   now(), 'system', 'c9000000-0000-4000-8000-000000000002');

BEGIN;
SELECT 1 FROM public.events WHERE id = 'c9100000-0000-4000-8000-00000000000e' FOR UPDATE;
SELECT dblink_send_query('r29a', $$SELECT public.event_register_group_guests_for_client(
  'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9000000-0000-4000-8000-000000000001', 'ip:' || md5('t29-e-a'),
  'c9400000-0000-4000-8000-0000000000e1',
  '[{"first_name":"Wspolny","last_name":"Gosc","email":"e-shared.t29@example.org"}]'::jsonb)$$);
SELECT dblink_send_query('r29b', $$SELECT public.event_register_group_guests_for_client(
  'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9', 'c9000000-0000-4000-8000-000000000002', 'ip:' || md5('t29-e-b'),
  'c9400000-0000-4000-8000-0000000000e2',
  '[{"first_name":"Wspolny","last_name":"Gosc","email":"e-shared.t29@example.org"}]'::jsonb)$$);
SELECT pg_temp.r29_wait(ARRAY['r29a', 'r29b'],
  '29/E DOWOD: oba dopisania tego samego goscia czekaja JEDNOCZESNIE na blokadzie wydarzenia');
COMMIT;
SELECT pg_temp.r29_collect('E', 'r29a');
SELECT pg_temp.r29_collect('E', 'r29b');

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM r29_out WHERE variant = 'E' AND err IS NOT NULL)
  AND (SELECT count(*) FROM r29_out WHERE variant = 'E' AND res->'client' = '{"ok": true, "added": 1}'::jsonb) = 2,
  '29/E R38: obie odpowiedzi identyczne {ok:true, added:1} - przegrany nie dowiaduje sie, ze gosc juz ma zapis');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations r JOIN public.event_people p ON p.id = r.person_id
    WHERE r.event_id = 'c9100000-0000-4000-8000-00000000000e' AND p.email_norm = 'e-shared.t29@example.org') = 1
  AND (SELECT count(*) FROM public.event_people
        WHERE tenant_id = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9' AND email_norm = 'e-shared.t29@example.org') = 1,
  '29/E: gosc zapisany DOKLADNIE raz (jedna osoba, jedno zgloszenie)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM r29_out WHERE variant = 'E' AND res->'delivery' = '[]'::jsonb) = 1
  AND (SELECT count(*) FROM r29_out WHERE variant = 'E'
        AND jsonb_array_length(res->'delivery') = 1
        AND res->'delivery'->0->>'kind' = 'already_registered'
        AND res->'delivery'->0->'recipient'->>'email' = 'e-shared.t29@example.org') = 1,
  '29/E: adres pominietego goscia WYLACZNIE w dostawie serwera przegranego (wiadomosc „juz zapisany")');

-- ---------------------------------------------------------------------------
-- SPRZATANIE FAZY 2
-- ---------------------------------------------------------------------------
SELECT dblink_disconnect('r29a');
SELECT dblink_disconnect('r29b');
DROP TABLE r29_out;
DROP TABLE r29_pid;
DROP EXTENSION dblink;

DELETE FROM public.rate_limits
 WHERE scope = 'event_register.guests' AND subject_id LIKE 'user:c9000000-0000-4000-8000-00000000000_';
DELETE FROM public.rate_limits
 WHERE scope = 'event_register.ip' AND subject_id IN ('ip:' || md5('t29-e-a'), 'ip:' || md5('t29-e-b'));
DELETE FROM public.domain_events WHERE tenant_id = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9';
DELETE FROM public.tenants WHERE id = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9';
DELETE FROM public.profiles WHERE id::text LIKE 'c9000000-%';
DELETE FROM auth.users WHERE id::text LIKE 'c9000000-%';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations WHERE tenant_id = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9') = 0
  AND (SELECT count(*) FROM public.tenants WHERE id = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9') = 0
  AND (SELECT count(*) FROM auth.users WHERE id::text LIKE 'c9000000-%') = 0
  AND (SELECT count(*) FROM public.rate_limits WHERE subject_id LIKE 'user:c9000000-%') = 0
  AND (SELECT count(*) FROM public.rate_limits
        WHERE subject_id IN ('ip:' || md5('t29-e-a'), 'ip:' || md5('t29-e-b'))) = 0,
  '29/sprzatanie: faza wspolbieznosci nie zostawila po sobie ani jednego wiersza');
