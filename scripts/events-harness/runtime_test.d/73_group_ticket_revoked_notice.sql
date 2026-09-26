\echo '== PROTO item1 zawiadomienie o odwolanym bilecie =='

BEGIN;

CREATE TEMP TABLE trv_q (k text PRIMARY KEY, u uuid);

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
  ('cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'Tenant CB (odwolany bilet)', 'tcb-trv')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('cb000000-0000-0000-0000-0000000000a1', 'admin.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000001', 'lead.a.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000002', 'lead.b.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000003', 'lead.c.trv@example.org'),
  ('cb000000-0000-0000-0000-000000000004', 'lead.d.trv@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb'::uuid
FROM auth.users u WHERE u.id::text LIKE 'cb000000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('cb000000-0000-0000-0000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('cb100000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'trv-main', 'Kongres odwolanych', 'Revocation congress',
   now() + interval '30 days', 'published', 'form', 'instant', NULL);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_free', 'Bezplatny', 'Free',
   0, 'PLN', NULL, 0, true, true, 10, true, 8),
  ('cb200000-0000-0000-0000-000000000002', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_paid', 'Platny', 'Paid',
   10000, 'PLN', NULL, 0, false, true, 20, true, 8);

SELECT set_config('nes.public_tenant', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', false);

CREATE FUNCTION pg_temp.trv_group(_key text, _uid uuid, _ticket uuid, _guests integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_lead uuid; v_guests jsonb := '[]'::jsonb; i integer;
BEGIN
  PERFORM pg_temp.act_as(_uid, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb');
  v := public.event_register(jsonb_build_object(
    'event_slug', 'trv-main', 'ticket_type_id', _ticket,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = _uid),
    'first_name', 'Lider', 'last_name', initcap(_key),
    'consent_data_processing', true));
  v_lead := (v->>'registration_id')::uuid;
  INSERT INTO trv_q VALUES (_key, v_lead);
  FOR i IN 1.._guests LOOP
    v_guests := v_guests || jsonb_build_array(jsonb_build_object(
      'first_name', 'Gosc', 'last_name', initcap(_key) || i,
      'email', 'guest.' || _key || i || '@trv.example.org'));
  END LOOP;
  PERFORM public.event_register_group_guests(v_lead, v_guests);
  INSERT INTO trv_q
  SELECT _key || '_g' || substr(p.email_norm, length('guest.' || _key) + 1, 1), r.id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.group_lead_registration_id = v_lead;
  PERFORM pg_temp.act_as();
  RETURN v_lead;
END $$;

CREATE FUNCTION pg_temp.trv(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM trv_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.trv_decide(_id uuid, _action text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('cb000000-0000-0000-0000-0000000000a1', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb');
  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', _id, 'action', _action, 'note', _note));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.trv_row(_key text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r FROM public.event_registrations r WHERE r.id = pg_temp.trv(_key) $$;

-- 1) ODRZUCENIE: kto dostal bilet, dostanie zawiadomienie
SELECT pg_temp.trv_group('a', 'cb000000-0000-0000-0000-000000000001',
  'cb200000-0000-0000-0000-000000000001', 5);

DO $$
DECLARE v jsonb; e jsonb; v_claims jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('a'), 'approve');
  -- wydanie calej grupy, potem rozne wyniki wysylki
  v_claims := public._event_issue_ticket_codes(pg_temp.trv('a'));
  FOR e IN SELECT * FROM jsonb_array_elements(v_claims) LOOP
    IF (e->>'registration_id')::uuid = pg_temp.trv('a_g2') THEN
      NULL; -- w drodze: zajecie bez potwierdzenia
    ELSIF (e->>'registration_id')::uuid = pg_temp.trv('a_g3') THEN
      PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true, true);
    ELSIF (e->>'registration_id')::uuid = pg_temp.trv('a_g4') THEN
      PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, false);
    ELSE
      PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
    END IF;
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('a_g5'), 'attended');

  PERFORM pg_temp.assert(public._event_guest_ticket_reached(pg_temp.trv_row('a_g1')), 'helper: wyslany');
  PERFORM pg_temp.assert(public._event_guest_ticket_reached(pg_temp.trv_row('a_g2')), 'helper: w drodze');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(pg_temp.trv_row('a_g3')), 'helper: niedoreczony');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(pg_temp.trv_row('a_g4')), 'helper: nieudana wysylka (zwolnione)');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(pg_temp.trv_row('a_g5')), 'helper: attended');
  PERFORM pg_temp.assert(NOT public._event_guest_ticket_reached(NULL::public.event_registrations), 'helper: NULL');

  v := pg_temp.trv_decide(pg_temp.trv('a'), 'reject', 'Grupa odwolana');
  PERFORM pg_temp.assert(
    (SELECT ticket_revoked_at = now() FROM public.event_registrations WHERE id = pg_temp.trv('a_g1'))
    AND (SELECT ticket_revoked_at = now() FROM public.event_registrations WHERE id = pg_temp.trv('a_g2'))
    AND (SELECT ticket_revoked_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a_g3'))
    AND (SELECT ticket_revoked_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a_g4'))
    AND (SELECT ticket_revoked_at IS NULL AND status = 'attended' FROM public.event_registrations WHERE id = pg_temp.trv('a_g5'))
    AND (SELECT ticket_revoked_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a')),
    'kaskada: znacznik tylko u gosci, do ktorych bilet dotarl albo byl w drodze');
  PERFORM pg_temp.assert(
    (SELECT ticket_code_sent_at IS NULL AND ticket_code_claimed_at IS NULL FROM public.event_registrations WHERE id = pg_temp.trv('a_g1')),
    'kaskada: znacznik biletu skasowany po staremu (SET widzi OLD)');
END $$;

-- 2) ZAJECIE I ROZLICZENIE
DO $$
DECLARE v jsonb; v2 jsonb; k integer; g1 uuid := pg_temp.trv('a_g1'); g2 uuid := pg_temp.trv('a_g2');
BEGIN
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 2, 'claim: dwa zawiadomienia (dostano ' || jsonb_array_length(v->'notices') || ')');
  PERFORM pg_temp.assert(
    (SELECT bool_and(n->>'email' LIKE 'guest.a%@trv.example.org' AND n->>'lead_last_name' = 'A'
                     AND n->>'event_slug' = 'trv-main' AND n->>'lang' = 'pl'
                     AND n->>'ticket_name_pl' = 'Bezplatny' AND (n->>'revoked_at')::timestamptz = now())
       FROM jsonb_array_elements(v->'notices') n),
    'claim: ladunek z adresem, prowadzacym, wydarzeniem, jezykiem i tozsamoscia zawiadomienia');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations WHERE ticket_revoked_notice_claimed_at = (v->>'claimed_at')::timestamptz) = 2,
    'claim: oba wiersze zajete ta sama chwila');
  v2 := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v2->'notices') = 0, 'claim: zywa dzierzawa - drugie zajecie puste');

  k := public._event_ticket_revoked_notices_settle(now() - interval '1 hour', ARRAY[g1], ARRAY[g2]);
  PERFORM pg_temp.assert(k = 0, 'settle: obce zajecie nic nie rozlicza');
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, ARRAY[g1], ARRAY[g2]);
  PERFORM pg_temp.assert(k = 2, 'settle: dwa wiersze rozliczone');
  PERFORM pg_temp.assert(
    (SELECT ticket_revoked_at IS NULL AND ticket_revoked_notice_claimed_at IS NULL FROM public.event_registrations WHERE id = g1)
    AND (SELECT ticket_revoked_at IS NOT NULL AND ticket_revoked_notice_claimed_at IS NULL FROM public.event_registrations WHERE id = g2),
    'settle: wyslany zamkniety, ponowienie wraca do kolejki');
  v := public._event_ticket_revoked_notices_claim(NULL);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 1 AND (v->'notices'->0->>'registration_id')::uuid = g2,
    'claim: ponowienie zajete znowu (p_limit NULL = domyslny)');
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = now() - interval '16 minutes' WHERE id = g2;
  v := public._event_ticket_revoked_notices_claim(0);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 1, 'claim: wygasla dzierzawa zajeta ponownie, p_limit 0 -> 1');
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, NULL, NULL);
  PERFORM pg_temp.assert(k = 0, 'settle: NULL tablice - nic');
  k := public._event_ticket_revoked_notices_settle((v->>'claimed_at')::timestamptz, ARRAY[g2], NULL);
  PERFORM pg_temp.assert(k = 1, 'settle: done bez retry');
END $$;

-- 3) PRZYWROCENIE: odrzucenie -> zatwierdzenie -> (bez nowego biletu) -> odrzucenie
SELECT pg_temp.trv_group('b', 'cb000000-0000-0000-0000-000000000002',
  'cb200000-0000-0000-0000-000000000001', 2);
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('b'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'reject', 'Pomylka');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).ticket_revoked_at IS NOT NULL, 'przywrocenie: znacznik po odrzuceniu');
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'approve');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).status = 'approved' AND (pg_temp.trv_row('b_g1')).ticket_revoked_at IS NOT NULL,
    'przywrocenie: przyjety gosc zachowuje znacznik');
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 0 AND (pg_temp.trv_row('b_g1')).ticket_revoked_notice_claimed_at IS NULL,
    'przywrocenie: przyjety nie dostaje zawiadomienia i nie jest zajmowany');
  -- sentinel: drugie odrzucenie bez nowego biletu zachowuje stary znacznik
  UPDATE public.event_registrations SET ticket_revoked_at = '2000-01-01' WHERE id = pg_temp.trv('b_g1');
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'reject', 'Jednak odrzucone');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).ticket_revoked_at = '2000-01-01',
    'przywrocenie: bez nowego biletu - stare zawiadomienie zostaje (ELSE)');
  -- nowy bilet dotarl -> nowe zawiadomienie przy kolejnym odrzuceniu
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('b'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = now() WHERE id = pg_temp.trv('b_g1');
  v := pg_temp.trv_decide(pg_temp.trv('b'), 'reject', 'Trzecia decyzja');
  PERFORM pg_temp.assert((pg_temp.trv_row('b_g1')).ticket_revoked_at = now()
    AND (pg_temp.trv_row('b_g1')).ticket_revoked_notice_claimed_at IS NULL,
    'przywrocenie: nowy bilet dotarl - nowe zawiadomienie, dzierzawa zdjeta');
END $$;

-- 4) SAMODZIELNE WYCOFANIE + ZWROT ORGANIZATORA + STRIPE
SELECT pg_temp.trv_group('c', 'cb000000-0000-0000-0000-000000000003',
  'cb200000-0000-0000-0000-000000000002', 2);
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('c'), 'paid');
  PERFORM pg_temp.assert((pg_temp.trv_row('c_g1')).status = 'approved' AND (pg_temp.trv_row('c_g1')).payment_status = 'paid', 'zwrot: punkt wyjscia');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('c'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('c'), 'refund');
  PERFORM pg_temp.assert((pg_temp.trv_row('c_g1')).status = 'cancelled' AND (pg_temp.trv_row('c_g1')).payment_status = 'refunded'
    AND (pg_temp.trv_row('c_g1')).ticket_revoked_at = now() AND (pg_temp.trv_row('c_g2')).ticket_revoked_at = now(),
    'zwrot organizatora: oplaceni goscie anulowani galezia zwrotu ze znacznikiem');
END $$;

SELECT pg_temp.trv_group('d', 'cb000000-0000-0000-0000-000000000004',
  'cb200000-0000-0000-0000-000000000001', 1);
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('d'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('d'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  PERFORM pg_temp.act_as('cb000000-0000-0000-0000-000000000004', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb');
  v := public.event_registration_cancel(jsonb_build_object('registration_id', pg_temp.trv('d')));
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert((pg_temp.trv_row('d_g1')).status = 'cancelled' AND (pg_temp.trv_row('d_g1')).ticket_revoked_at = now(),
    'wycofanie prowadzacego: gosc ze znacznikiem');
END $$;

-- 5) ZAMKNIECIE BEZ MAILA
DO $$
DECLARE v jsonb;
BEGIN
  UPDATE public.event_registrations SET notify_email = false WHERE id = pg_temp.trv('d_g1');
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = NULL WHERE ticket_revoked_notice_claimed_at IS NOT NULL;
  v := public._event_ticket_revoked_notices_claim(50);
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'notices') n WHERE (n->>'registration_id')::uuid = pg_temp.trv('d_g1'))
    AND (pg_temp.trv_row('d_g1')).ticket_revoked_at IS NULL,
    'bez maila: wylaczone maile zamykaja zawiadomienie bez wysylki');
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 4, 'bez maila: reszta (b_g1, b_g2, c_g1, c_g2) zajeta: ' || jsonb_array_length(v->'notices'));
END $$;

-- 6) STRIPE: wplata i zwrot zamowienia prowadzacego
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000005', 'lead.e.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000005', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('e', 'cb000000-0000-0000-0000-000000000005', 'cb200000-0000-0000-0000-000000000002', 2);
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'cb600000-0000-0000-0000-000000000001', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
  'cb000000-0000-0000-0000-000000000005', 'paid', 30000, 'PLN',
  jsonb_build_object('event_id', 'cb100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'cb200000-0000-0000-0000-000000000002',
                     'registration_id', pg_temp.trv('e'));
DO $$
DECLARE v jsonb; e jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'paid', NULL);
  PERFORM pg_temp.assert((pg_temp.trv_row('e_g1')).status = 'approved', 'stripe: goscie przyjeci po wplacie');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('e'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := public.payments_apply_event_ticket_outcome('cb600000-0000-0000-0000-000000000001', 'refunded', 30000);
  PERFORM pg_temp.assert(v->>'outcome' = 'refunded'
    AND (pg_temp.trv_row('e_g1')).ticket_revoked_at = now() AND (pg_temp.trv_row('e_g2')).ticket_revoked_at = now()
    AND (pg_temp.trv_row('e')).ticket_revoked_at IS NULL,
    'stripe: zwrot zamowienia - znacznik u gosci, nie u prowadzacego');
END $$;

-- 7) WYDARZENIE MINELO, PRZYJETY PO ZAKONCZENIU, LIMIT 200, UPRAWNIENIA
DO $$
DECLARE v jsonb;
BEGIN
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = NULL WHERE ticket_revoked_notice_claimed_at IS NOT NULL;
  UPDATE public.event_registrations SET status = 'approved', cancelled_at = NULL, decided_at = now() WHERE id = pg_temp.trv('e_g2');
  UPDATE public.events SET starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE id = 'cb100000-0000-0000-0000-000000000001';
  v := public._event_ticket_revoked_notices_claim(50);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 0
    AND NOT EXISTS (SELECT 1 FROM public.event_registrations WHERE tenant_id = 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb' AND ticket_revoked_at IS NOT NULL),
    'minelo: wszystkie zawiadomienia (takze przyjetego) zamkniete bez maila');
  UPDATE public.events SET starts_at = now() + interval '30 days', ends_at = NULL WHERE id = 'cb100000-0000-0000-0000-000000000001';
END $$;

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
SELECT ('cb700000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'bulk' || i || '@trv.example.org', 'B', 'Bulk'
FROM generate_series(1, 205) i;
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, cancelled_at, ticket_revoked_at)
SELECT ('cb800000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001',
  ('cb700000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'cb200000-0000-0000-0000-000000000001', 'cancelled', 'form', 'not_required', now(), now() - (i || ' seconds')::interval
FROM generate_series(1, 205) i;
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_ticket_revoked_notices_claim(1000);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 200, 'limit: gorna granica 200');
  PERFORM pg_temp.assert((v->'notices'->0->>'registration_id')::uuid = 'cb800000-0000-0000-0000-000000000205', 'kolejnosc: najstarsze najpierw');
  PERFORM pg_temp.assert(NOT has_function_privilege('authenticated', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public._event_ticket_revoked_notices_settle(timestamptz, uuid[], uuid[])', 'EXECUTE')
    AND has_function_privilege('service_role', 'public._event_ticket_revoked_notices_claim(integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._event_guest_ticket_reached(public.event_registrations)', 'EXECUTE'),
    'uprawnienia: tylko service_role');
END $$;


-- 8) JEZYK, PRZYWROCENIE DO KOLEJKI, ZWROT CZESCIOWY, KONIEC BEZ ends_at, PUSTA KOLEJKA, DOMYSLNY LIMIT
DELETE FROM public.event_registrations WHERE id::text LIKE 'cb800000-%';
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('cb200000-0000-0000-0000-000000000003', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb',
   'cb100000-0000-0000-0000-000000000001', 'trv_quota', 'Pula trzy', 'Quota three',
   0, 'PLN', 3, 0, true, true, 30, true, 8);
INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000006', 'lead.f.trv@example.org') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES ('cb000000-0000-0000-0000-000000000006', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb') ON CONFLICT (id) DO NOTHING;
SELECT pg_temp.trv_group('f', 'cb000000-0000-0000-0000-000000000006', 'cb200000-0000-0000-0000-000000000003', 2);
DO $$
DECLARE v jsonb; e jsonb; v_other uuid := gen_random_uuid(); v_person uuid := gen_random_uuid(); v_wait uuid; v_back uuid;
BEGIN
  v := pg_temp.trv_decide(pg_temp.trv('f'), 'approve');
  FOR e IN SELECT * FROM jsonb_array_elements(public._event_issue_ticket_codes(pg_temp.trv('f'))) LOOP
    PERFORM public._event_ticket_code_confirm((e->>'registration_id')::uuid, (e->>'claimed_at')::timestamptz, true);
  END LOOP;
  v := pg_temp.trv_decide(pg_temp.trv('f'), 'reject', 'Pomylka organizatora');
  -- miejsce zajmuje ktos z zewnatrz: gosc f_g2 wroci do kolejki
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'outsider@trv.example.org', 'Out', 'Sider');
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, decided_at, decision_source)
  VALUES (v_other, 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', 'cb100000-0000-0000-0000-000000000001', v_person, 'cb200000-0000-0000-0000-000000000003', 'approved', 'form', 'not_required', now(), 'system');
  v := pg_temp.trv_decide(pg_temp.trv('f'), 'approve');
  SELECT r.id INTO v_wait FROM public.event_registrations r
   WHERE r.group_lead_registration_id = pg_temp.trv('f') AND r.status = 'waitlist';
  SELECT r.id INTO v_back FROM public.event_registrations r
   WHERE r.group_lead_registration_id = pg_temp.trv('f') AND r.status = 'approved';
  PERFORM pg_temp.assert(v_wait IS NOT NULL AND v_back IS NOT NULL
    AND (SELECT ticket_revoked_at IS NOT NULL FROM public.event_registrations WHERE id = v_wait)
    AND (SELECT ticket_revoked_at IS NOT NULL FROM public.event_registrations WHERE id = v_back),
    'kolejka: jeden gosc przyjety, drugi w kolejce (brak miejsca) - obaj zachowuja znacznik');
  INSERT INTO auth.users (id, email) VALUES ('cb000000-0000-0000-0000-000000000007', 'guest.en.trv@example.org');
  INSERT INTO public.profiles (id, tenant_id, prefs) VALUES ('cb000000-0000-0000-0000-000000000007', 'cbcbcbcb-cbcb-cbcb-cbcb-cbcbcbcbcbcb', jsonb_build_object('language', 'EN'));
  UPDATE public.event_people SET user_id = 'cb000000-0000-0000-0000-000000000007' WHERE id = (SELECT person_id FROM public.event_registrations WHERE id = v_wait);
  v := public._event_ticket_revoked_notices_claim(NULL);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 1 AND (v->'notices'->0->>'registration_id')::uuid = v_wait
    AND v->'notices'->0->>'lang' = 'en' AND v->'notices'->0->>'ticket_name_en' = 'Quota three',
    'kolejka: zawiadomienie wychodzi tylko do goscia w kolejce (bilet nie dziala), jezyk z profilu');
  INSERT INTO trv_q VALUES ('f_wait', v_wait);
END $$;
DO $$
DECLARE v jsonb;
BEGIN
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_typeof(v->'notices') = 'array' AND jsonb_array_length(v->'notices') = 0 AND v ? 'claimed_at',
    'pusta kolejka: ksztalt {claimed_at, notices: []}');
  UPDATE public.event_registrations SET ticket_revoked_notice_claimed_at = NULL WHERE id = pg_temp.trv('f_wait');
  UPDATE public.events SET starts_at = now() - interval '25 hours', ends_at = NULL WHERE id = 'cb100000-0000-0000-0000-000000000001';
  v := public._event_ticket_revoked_notices_claim(20);
  PERFORM pg_temp.assert(jsonb_array_length(v->'notices') = 0 AND (pg_temp.trv_row('f_wait')).ticket_revoked_at IS NULL,
    'koniec bez ends_at: starts_at + 1 dzien minal - zamkniete bez maila');
  UPDATE public.events SET starts_at = now() + interval '30 days' WHERE id = 'cb100000-0000-0000-0000-000000000001';
END $$;
ROLLBACK;
