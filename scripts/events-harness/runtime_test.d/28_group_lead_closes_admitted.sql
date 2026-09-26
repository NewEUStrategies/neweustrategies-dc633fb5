-- ============================================================================
-- 28_group_lead_closes_admitted - ODWOLANA GRUPA NIE WPUSZCZA, STRIPE LICZY
-- MIEJSCA (20260926120000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Do 20260926120000 odrzucenie albo anulowanie prowadzacego zamykalo tylko
-- gosci, ktorzy jeszcze czekali - gosc JUZ przyjety zostawal `approved`
-- z zywym kodem QR i wchodzil na sale odwolanej grupy. Wynik `paid` z Stripe
-- przyjmowal zas czekajacych gosci BEZ kontroli miejsc: pula biletu wywracala
-- cale ksiegowanie CHECK-iem, a sama pojemnosc wydarzenia przepelniala sie
-- po cichu. 27_group_follow_lead pilnuje kaskady z 20260926100000; ten plik -
-- kazdej galezi funkcji z 20260926120000.
--
-- CO SPRAWDZA
--   1. Odrzucenie prowadzacego zamyka przyjetych gosci: stempel decyzji, skrot
--      kodu QR znika (stary kod nie pasuje do zadnego zapisu), znacznik
--      wysylki biletu skasowany; kolejka awansuje o tyle miejsc, ile zwolnili
--      goscie - tylko w ich bilecie, nie ponad pule.
--   2. Samodzielne wycofanie prowadzacego (bez nowego stempla decyzji) zamyka
--      przyjetego goscia bez autora; `attended` i `no_show` zostaja nietkniete;
--      ponowne zatwierdzenie przywraca goscia z NOWYM kodem i wraca do crona.
--   3. Stripe przy ciasnej puli biletu: ksiegowanie przechodzi, gosc na wolne
--      miejsce przyjety, nadmiarowi w kolejce OPLACENI (kolejnosc pozycji),
--      gosc wycofany przed wplata pominiety; zwolnione miejsce awansuje
--      oplaconego goscia z kolejki.
--   4. Stripe przy samej pojemnosci wydarzenia: gosc juz w kolejce zostaje na
--      SWOJEJ pozycji, gosc juz przyjety dostaje tylko rozliczenie (kod bez
--      zmian), przyjety bez kodu dostaje kod, nadmiarowy staje za kolejka.
--   5. `_event_group_promote_freed` wprost: NULL i pusta tablica, grupowanie
--      po bilecie, limit puli, zapis bez cennika (awans po wydarzeniu).
--   6. Uprawnienia: funkcja awansu bez EXECUTE dla anon/authenticated.
--
-- JEDNA TRANSAKCJA = JEDNO `now()` (patrz 27_group_follow_lead).
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 28 odwolana grupa nie wpuszcza, Stripe liczy miejsca =='

BEGIN;

CREATE TEMP TABLE gla_q (k text PRIMARY KEY, u uuid);

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
  ('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', 'Tenant C9 (odwolana grupa)', 'tc9-gla')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('c9000000-0000-0000-0000-0000000000a1', 'admin.gla@example.org'),
  ('c9000000-0000-0000-0000-000000000001', 'lead.a.gla@example.org'),
  ('c9000000-0000-0000-0000-000000000002', 'lead.b.gla@example.org'),
  ('c9000000-0000-0000-0000-000000000003', 'lead.s.gla@example.org'),
  ('c9000000-0000-0000-0000-000000000004', 'lead.e.gla@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id)
SELECT u.id, 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9'::uuid
FROM auth.users u WHERE u.id::text LIKE 'c9000000-%'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('c9000000-0000-0000-0000-0000000000a1', 'admin')
ON CONFLICT DO NOTHING;

-- EA: formularz, bez pojemnosci. EB: pojemnosc 5, bilet platny bez puli.
-- EC: pojemnosc 1, zapisy bez cennika.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  ('c9100000-0000-0000-0000-000000000001', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'gla-main', 'Kongres grup', 'Group congress',
   now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('c9100000-0000-0000-0000-000000000002', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'gla-cap', 'Warsztat na piec osob', 'Five-seat workshop',
   now() + interval '30 days', 'published', 'form', 'instant', 5),
  ('c9100000-0000-0000-0000-000000000003', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'gla-plain', 'Spotkanie bez cennika', 'Meeting without tickets',
   now() + interval '30 days', 'published', 'form', 'instant', 1);

-- TA1 bezplatny z akceptacja, pula 3. TA2 platny, pula 5. TA3 bezplatny
-- z akceptacja, bez puli. TA4 bezplatny, pula 1. TA5 bezplatny, bez puli
-- (tylko kolejka - dowod, ze awans nie przechodzi na cudzy bilet). TB1 platny
-- bez puli na EB.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size)
VALUES
  ('c9200000-0000-0000-0000-000000000001', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'c9100000-0000-0000-0000-000000000001', 'gla_quota_three', 'Pula trzy', 'Quota three',
   0, 'PLN', 3, 0, true, true, 10, true, 5),
  ('c9200000-0000-0000-0000-000000000002', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'c9100000-0000-0000-0000-000000000001', 'gla_paid_five', 'Platny, pula piec', 'Paid, quota five',
   10000, 'PLN', 5, 0, false, true, 20, true, 5),
  ('c9200000-0000-0000-0000-000000000003', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'c9100000-0000-0000-0000-000000000001', 'gla_free', 'Bez limitu', 'Unlimited',
   0, 'PLN', NULL, 0, true, true, 30, true, 5),
  ('c9200000-0000-0000-0000-000000000004', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'c9100000-0000-0000-0000-000000000001', 'gla_quota_one', 'Pula jeden', 'Quota one',
   0, 'PLN', 1, 0, false, true, 40, true, 5),
  ('c9200000-0000-0000-0000-000000000005', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'c9100000-0000-0000-0000-000000000001', 'gla_side', 'Boczny', 'Side',
   0, 'PLN', NULL, 0, false, true, 50, true, 5),
  ('c9200000-0000-0000-0000-000000000006', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
   'c9100000-0000-0000-0000-000000000002', 'gla_cap_paid', 'Warsztat', 'Workshop',
   10000, 'PLN', NULL, 0, false, true, 10, true, 5);

SELECT set_config('nes.public_tenant', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', false);

-- Zapis bez grupy wprost do tabeli - osoba i wiersz, klucz w gla_q.
CREATE FUNCTION pg_temp.gla_solo(_key text, _event uuid, _ticket uuid, _status text,
                                 _payment text DEFAULT 'not_required') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_person uuid := gen_random_uuid(); v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', _key || '@solo.example.org', 'Sam', initcap(_key));
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     waitlist_position, decided_at, decision_source, qr_token_hash, qr_issued_at)
  VALUES
    (v_id, 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', _event, v_person, _ticket, _status, 'form', _payment,
     CASE WHEN _status = 'waitlist'
          THEN public._event_next_waitlist_position('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', _event) END,
     CASE WHEN _status = 'approved' THEN now() END,
     CASE WHEN _status = 'approved' THEN 'system' END,
     CASE WHEN _status = 'approved' THEN encode(extensions.digest(_key, 'sha256'), 'hex') END,
     CASE WHEN _status = 'approved' THEN now() END);
  INSERT INTO gla_q VALUES (_key, v_id);
  RETURN v_id;
END $$;

-- Prowadzacy przez PRAWDZIWE `event_register` + dopisanie gosci.
CREATE FUNCTION pg_temp.gla_group(_key text, _uid uuid, _ticket uuid, _slug text,
                                  _guests integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
  v_lead uuid;
  v_guests jsonb := '[]'::jsonb;
  i integer;
BEGIN
  PERFORM pg_temp.act_as(_uid, 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9');
  v := public.event_register(jsonb_build_object(
    'event_slug', _slug, 'ticket_type_id', _ticket,
    'email', (SELECT u.email FROM auth.users u WHERE u.id = _uid),
    'first_name', 'Lider', 'last_name', initcap(_key),
    'consent_data_processing', true));
  v_lead := (v->>'registration_id')::uuid;
  INSERT INTO gla_q VALUES (_key, v_lead);
  FOR i IN 1.._guests LOOP
    v_guests := v_guests || jsonb_build_array(jsonb_build_object(
      'first_name', 'Gosc', 'last_name', initcap(_key) || i,
      'email', 'guest.' || _key || i || '@gla.example.org'));
  END LOOP;
  PERFORM public.event_register_group_guests(v_lead, v_guests);
  INSERT INTO gla_q
  SELECT _key || '_g' || substr(p.email_norm, length('guest.' || _key) + 1, 1), r.id
  FROM public.event_registrations r
  JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.group_lead_registration_id = v_lead;
  PERFORM pg_temp.act_as();
  RETURN v_lead;
END $$;

CREATE FUNCTION pg_temp.gla(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM gla_q WHERE k = _key $$;

CREATE FUNCTION pg_temp.gla_decide(_id uuid, _action text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('c9000000-0000-0000-0000-0000000000a1',
                         'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9');
  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', _id, 'action', _action, 'note', _note));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.gla_status(_key text) RETURNS text
LANGUAGE sql AS $$
  SELECT r.status FROM public.event_registrations r WHERE r.id = pg_temp.gla(_key)
$$;

CREATE FUNCTION pg_temp.gla_issue_all(_id uuid) RETURNS integer
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

-- ---------------------------------------------------------------------------
-- 1) ODRZUCENIE PROWADZACEGO ZAMYKA PRZYJETYCH GOSCI I AWANSUJE KOLEJKE
-- ---------------------------------------------------------------------------
-- Grupa A (prowadzacy + 2 gosci) wypelnia pule 3 biletu TA1. W kolejce TA1
-- czekaja W1..W4, w kolejce TA5 - X1. Odrzucenie zwalnia 3 miejsca: dwa
-- gosci (awans w kaskadzie) i jedno prowadzacego (awans w decyzji).
SELECT pg_temp.gla_group('a', 'c9000000-0000-0000-0000-000000000001',
  'c9200000-0000-0000-0000-000000000001', 'gla-main', 2);

DO $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.gla_decide(pg_temp.gla('a'), 'approve');
  PERFORM pg_temp.assert(v->>'status' = 'approved'
    AND pg_temp.gla_status('a_g1') = 'approved' AND pg_temp.gla_status('a_g2') = 'approved'
    AND (SELECT sold_count FROM public.event_ticket_types
          WHERE id = 'c9200000-0000-0000-0000-000000000001') = 3,
    '28/odrzucenie: punkt wyjscia - grupa przyjeta, pula TA1 pelna');
  PERFORM pg_temp.assert(pg_temp.gla_issue_all(pg_temp.gla('a')) = 3,
    '28/odrzucenie: punkt wyjscia - trzy bilety wyslane');
END $$;

SELECT pg_temp.gla_solo('w1', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000001', 'waitlist');
SELECT pg_temp.gla_solo('w2', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000001', 'waitlist');
SELECT pg_temp.gla_solo('w3', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000001', 'waitlist');
SELECT pg_temp.gla_solo('w4', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000001', 'waitlist');
SELECT pg_temp.gla_solo('x1', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000005', 'waitlist');

DO $$
DECLARE
  v jsonb;
  v_hash1 text;
  v_hash2 text;
BEGIN
  SELECT qr_token_hash INTO v_hash1 FROM public.event_registrations WHERE id = pg_temp.gla('a_g1');
  SELECT qr_token_hash INTO v_hash2 FROM public.event_registrations WHERE id = pg_temp.gla('a_g2');

  v := pg_temp.gla_decide(pg_temp.gla('a'), 'reject', 'Grupa odwolana przez organizatora');
  PERFORM pg_temp.assert(v->>'status' = 'rejected',
    '28/odrzucenie: decyzja o prowadzacym przechodzi');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gla('a')
        AND r.status = 'rejected'
        AND r.decision_note = 'Grupa odwolana przez organizatora'
        AND r.decision_source = 'organizer'
        AND r.decided_by = 'c9000000-0000-0000-0000-0000000000a1'
        AND r.qr_token_hash IS NULL AND r.qr_issued_at IS NULL
        AND r.ticket_code_sent_at IS NULL AND r.ticket_code_claimed_at IS NULL) = 2,
    '28/odrzucenie: przyjeci goscie odrzuceni ze stemplem prowadzacego, bez kodu i bez znacznika biletu');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_registrations r
                 WHERE r.qr_token_hash IN (v_hash1, v_hash2)),
    '28/odrzucenie: kod z maila goscia nie pasuje juz do zadnego zapisu - bramka go nie wpusci');
  PERFORM pg_temp.assert(
    (SELECT bool_and(public._event_guest_closed_with_lead(r,
              (SELECT l FROM public.event_registrations l WHERE l.id = pg_temp.gla('a'))))
       FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gla('a')),
    '28/odrzucenie: predykat stempla rozpoznaje obu gosci - wroca przy ponownym przyjeciu');

  PERFORM pg_temp.assert((v->>'promoted_from_waitlist')::integer = 1,
    '28/awans: decyzja promuje jedna osobe - za miejsce prowadzacego');
  PERFORM pg_temp.assert(
    pg_temp.gla_status('w1') = 'approved' AND pg_temp.gla_status('w2') = 'approved'
    AND pg_temp.gla_status('w3') = 'approved' AND pg_temp.gla_status('w4') = 'waitlist',
    '28/awans: kaskada promuje dwie osoby za gosci, decyzja trzecia - czwarta czeka dalej');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (pg_temp.gla('w1'), pg_temp.gla('w2'))
        AND r.promoted_at IS NOT NULL AND r.waitlist_notified_at IS NULL
        AND r.qr_token_hash IS NOT NULL AND r.decision_source = 'system') = 2,
    '28/awans: awansowani przez kaskade czekaja w panelu na powiadomienie, z kodem');
  PERFORM pg_temp.assert(pg_temp.gla_status('x1') = 'waitlist',
    '28/awans: kolejka INNEGO biletu nie dostaje miejsc zwolnionych w TA1');
  PERFORM pg_temp.assert(
    (SELECT sold_count = 3 AND sold_count <= quota FROM public.event_ticket_types
      WHERE id = 'c9200000-0000-0000-0000-000000000001'),
    '28/awans: pula TA1 znow pelna - bez przekroczenia');
END $$;

-- ---------------------------------------------------------------------------
-- 2) SAMODZIELNE WYCOFANIE PROWADZACEGO; ATTENDED I NO_SHOW ZOSTAJA
-- ---------------------------------------------------------------------------
SELECT pg_temp.gla_group('b', 'c9000000-0000-0000-0000-000000000002',
  'c9200000-0000-0000-0000-000000000003', 'gla-main', 3);

DO $$
DECLARE
  v jsonb;
  v_lead uuid := pg_temp.gla('b');
  v_old text;
BEGIN
  v := pg_temp.gla_decide(v_lead, 'approve');
  PERFORM pg_temp.assert(pg_temp.gla_issue_all(v_lead) = 4,
    '28/wycofanie: punkt wyjscia - grupa czworga przyjeta, bilety wyslane');
  v := pg_temp.gla_decide(pg_temp.gla('b_g1'), 'attended');
  v := pg_temp.gla_decide(pg_temp.gla('b_g2'), 'no_show');
  SELECT qr_token_hash INTO v_old FROM public.event_registrations WHERE id = pg_temp.gla('b_g3');

  PERFORM pg_temp.act_as('c9000000-0000-0000-0000-000000000002', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9');
  v := public.event_registration_cancel(jsonb_build_object('registration_id', v_lead));
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(v->>'status' = 'cancelled',
    '28/wycofanie: prowadzacy wycofuje sie sam');
  PERFORM pg_temp.assert(
    (SELECT r.status = 'cancelled' AND r.cancelled_at = l.cancelled_at
            AND r.decided_by IS NULL AND r.decision_source = 'system'
            AND r.qr_token_hash IS NULL AND r.ticket_code_sent_at IS NULL
       FROM public.event_registrations r, public.event_registrations l
      WHERE r.id = pg_temp.gla('b_g3') AND l.id = v_lead),
    '28/wycofanie: przyjety gosc anulowany z data prowadzacego, bez autora, bez kodu');
  PERFORM pg_temp.assert(
    (SELECT status = 'attended' AND qr_token_hash IS NOT NULL AND ticket_code_sent_at IS NOT NULL
       FROM public.event_registrations WHERE id = pg_temp.gla('b_g1'))
    AND (SELECT status = 'no_show' AND qr_token_hash IS NOT NULL
           FROM public.event_registrations WHERE id = pg_temp.gla('b_g2')),
    '28/wycofanie: obecnosc i nieobecnosc gosci zostaja - to fakt z sali');

  v := pg_temp.gla_decide(v_lead, 'approve');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND qr_token_hash IS NOT NULL AND qr_token_hash <> v_old
            AND cancelled_at IS NULL AND ticket_code_sent_at IS NULL
       FROM public.event_registrations WHERE id = pg_temp.gla('b_g3')),
    '28/wycofanie: ponowne zatwierdzenie przywraca goscia z NOWYM kodem i bez znacznika wysylki');
  PERFORM pg_temp.assert(pg_temp.gla('b_g3') = ANY(public._event_ticket_codes_pending(500)),
    '28/wycofanie: przywrocony gosc czeka w cronie na nowy bilet');
  PERFORM pg_temp.assert(pg_temp.gla_status('b_g1') = 'attended',
    '28/wycofanie: przywrocenie nie rusza obecnego goscia');
END $$;

-- ---------------------------------------------------------------------------
-- 3) STRIPE PRZY CIASNEJ PULI BILETU
-- ---------------------------------------------------------------------------
-- Pula TA2 = 5. Grupa S (prowadzacy i czterech gosci) miesci sie w niej przy
-- zapisie - dopisanie gosci sprawdza miejsca dla calej grupy - ale nieoplacony
-- zapis nie trzyma miejsca, wiec MIEDZY kasa a webhookiem trzy zapisy bez grupy
-- zajmuja trzy miejsca. S4 wycofal sie przed wplata. Po wplacie prowadzacy
-- i jeden gosc zajmuja reszte puli, dwaj pozostali czekaja w kolejce OPLACENI.
-- Przed 20260926120000 to ksiegowanie rzucalo CHECK-iem puli.
--
-- KTORY GOSC WCHODZI. Goscie dopisani jedna instrukcja maja ten sam
-- `created_at` (jedno `now()`), wiec o kolejnosci przyjecia - tak samo jak
-- w wydaniu biletow - rozstrzyga `id`. Asercje wybieraja gosci po tej
-- kolejnosci, a nie po numerze adresu.
SELECT pg_temp.gla_group('s', 'c9000000-0000-0000-0000-000000000003',
  'c9200000-0000-0000-0000-000000000002', 'gla-main', 4);
SELECT pg_temp.gla_solo('solo_s1', 'c9100000-0000-0000-0000-000000000001',
  'c9200000-0000-0000-0000-000000000002', 'approved', 'paid');
SELECT pg_temp.gla_solo('solo_s2', 'c9100000-0000-0000-0000-000000000001',
  'c9200000-0000-0000-0000-000000000002', 'approved', 'paid');
SELECT pg_temp.gla_solo('solo_s3', 'c9100000-0000-0000-0000-000000000001',
  'c9200000-0000-0000-0000-000000000002', 'approved', 'paid');

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'c9600000-0000-0000-0000-000000000001', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
  'c9000000-0000-0000-0000-000000000003', 'paid', 40000, 'PLN',
  jsonb_build_object('event_id', 'c9100000-0000-0000-0000-000000000001',
                     'ticket_type_id', 'c9200000-0000-0000-0000-000000000002',
                     'registration_id', pg_temp.gla('s'));

DO $$
DECLARE
  v jsonb;
  v_raised text := NULL;
  v_order uuid[];
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.group_lead_registration_id = pg_temp.gla('s')
        AND r.status = 'pending' AND r.payment_status = 'unpaid') = 4,
    '28/stripe-pula: punkt wyjscia - czterech gosci czeka na wplate');
  v := pg_temp.gla_decide(pg_temp.gla('s_g4'), 'cancel');
  UPDATE public.event_registrations SET cancelled_at = now() - interval '1 hour'
  WHERE id = pg_temp.gla('s_g4');

  BEGIN
    v := public.payments_apply_event_ticket_outcome('c9600000-0000-0000-0000-000000000001', 'paid');
  EXCEPTION WHEN OTHERS THEN
    v_raised := SQLERRM;
  END;
  PERFORM pg_temp.assert(v_raised IS NULL AND (v->>'applied')::boolean,
    '28/stripe-pula: wplata zaksiegowana mimo gosci ponad pule (bez CHECK-u puli)' ||
    COALESCE(' - blad: ' || v_raised, ''));
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'paid'
       FROM public.event_registrations WHERE id = pg_temp.gla('s')),
    '28/stripe-pula: prowadzacy przyjety i oplacony');
  SELECT array_agg(r.id ORDER BY r.created_at, r.id) INTO v_order
  FROM public.event_registrations r
  WHERE r.group_lead_registration_id = pg_temp.gla('s') AND r.id <> pg_temp.gla('s_g4');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'paid' AND qr_token_hash IS NOT NULL
            AND payment_order_id = 'c9600000-0000-0000-0000-000000000001'
       FROM public.event_registrations WHERE id = v_order[1]),
    '28/stripe-pula: pierwszy gosc wchodzi na ostatnie miejsce, z kodem i zamowieniem');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.id IN (v_order[2], v_order[3])
        AND r.status = 'waitlist' AND r.payment_status = 'paid'
        AND r.decision_source = 'capacity' AND r.waitlist_position > 0
        AND r.qr_token_hash IS NULL
        AND r.payment_order_id = 'c9600000-0000-0000-0000-000000000001') = 2
    AND (SELECT waitlist_position FROM public.event_registrations WHERE id = v_order[2])
      < (SELECT waitlist_position FROM public.event_registrations WHERE id = v_order[3]),
    '28/stripe-pula: nadmiarowi goscie w kolejce OPLACENI, w kolejnosci przyjmowania');
  PERFORM pg_temp.assert(
    (SELECT status = 'cancelled' AND payment_status = 'unpaid' AND payment_order_id IS NULL
       FROM public.event_registrations WHERE id = pg_temp.gla('s_g4')),
    '28/stripe-pula: gosc wycofany przed wplata pominiety - nieoplacony, bez zamowienia');
  PERFORM pg_temp.assert(
    (SELECT sold_count = 5 AND sold_count <= quota FROM public.event_ticket_types
      WHERE id = 'c9200000-0000-0000-0000-000000000002'),
    '28/stripe-pula: sprzedane = pula (5), bez przekroczenia');

  -- Zwolnione miejsce awansuje OPLACONEGO goscia z kolejki.
  v := pg_temp.gla_decide(pg_temp.gla('solo_s1'), 'cancel');
  PERFORM pg_temp.assert((v->>'promoted_from_waitlist')::integer = 1
    AND (SELECT status = 'approved' AND payment_status = 'paid' AND qr_token_hash IS NOT NULL
           FROM public.event_registrations WHERE id = v_order[2])
    AND (SELECT status FROM public.event_registrations WHERE id = v_order[3]) = 'waitlist',
    '28/stripe-pula: zwolnione miejsce awansuje pierwszego oplaconego goscia z kolejki');
END $$;

-- ---------------------------------------------------------------------------
-- 4) STRIPE PRZY SAMEJ POJEMNOSCI WYDARZENIA
-- ---------------------------------------------------------------------------
-- EB ma 5 miejsc, bilet bez puli; grupa E (prowadzacy i czterech gosci)
-- miesci sie przy zapisie. Przed wplata: dwa zapisy bez grupy (2), gosc E2
-- przyjety osobno z kodem (3), gosc E4 przyjety bez kodu (4); gosc E1 czeka
-- juz w kolejce. Wplata przyjmuje prowadzacego (5). E1 zostaje na SWOJEJ
-- pozycji, E3 staje za nim; przed 20260926120000 obaj wchodzili ponad
-- pojemnosc po cichu.
SELECT pg_temp.gla_group('e', 'c9000000-0000-0000-0000-000000000004',
  'c9200000-0000-0000-0000-000000000006', 'gla-cap', 4);
SELECT pg_temp.gla_solo('solo_e1', 'c9100000-0000-0000-0000-000000000002',
  'c9200000-0000-0000-0000-000000000006', 'approved', 'paid');
SELECT pg_temp.gla_solo('solo_e2', 'c9100000-0000-0000-0000-000000000002',
  'c9200000-0000-0000-0000-000000000006', 'approved', 'paid');

INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata)
SELECT 'c9600000-0000-0000-0000-000000000002', 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
  'c9000000-0000-0000-0000-000000000004', 'paid', 50000, 'PLN',
  jsonb_build_object('event_id', 'c9100000-0000-0000-0000-000000000002',
                     'ticket_type_id', 'c9200000-0000-0000-0000-000000000006',
                     'registration_id', pg_temp.gla('e'));

DO $$
DECLARE
  v jsonb;
  v_pos integer;
  v_hash text := encode(extensions.digest('gla-e2-kod', 'sha256'), 'hex');
BEGIN
  UPDATE public.event_registrations SET status = 'waitlist',
    waitlist_position = public._event_next_waitlist_position(
      'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9', 'c9100000-0000-0000-0000-000000000002')
  WHERE id = pg_temp.gla('e_g1');
  UPDATE public.event_registrations SET status = 'approved', decided_at = now(),
    decision_source = 'organizer', qr_token_hash = v_hash, qr_issued_at = now()
  WHERE id = pg_temp.gla('e_g2');
  UPDATE public.event_registrations SET status = 'approved', decided_at = now(),
    decision_source = 'organizer', qr_token_hash = NULL, qr_issued_at = NULL
  WHERE id = pg_temp.gla('e_g4');
  SELECT waitlist_position INTO v_pos FROM public.event_registrations WHERE id = pg_temp.gla('e_g1');

  v := public.payments_apply_event_ticket_outcome('c9600000-0000-0000-0000-000000000002', 'paid');
  PERFORM pg_temp.assert((v->>'applied')::boolean
    AND pg_temp.gla_status('e') = 'approved',
    '28/stripe-pojemnosc: wplata zaksiegowana, prowadzacy zajmuje ostatnie miejsce');
  PERFORM pg_temp.assert(
    (SELECT status = 'waitlist' AND waitlist_position = v_pos AND payment_status = 'paid'
            AND payment_order_id = 'c9600000-0000-0000-0000-000000000002'
       FROM public.event_registrations WHERE id = pg_temp.gla('e_g1')),
    '28/stripe-pojemnosc: gosc juz w kolejce oplacony, zostaje na SWOJEJ pozycji');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'paid' AND qr_token_hash = v_hash
            AND decision_source = 'organizer'
            AND payment_order_id = 'c9600000-0000-0000-0000-000000000002'
       FROM public.event_registrations WHERE id = pg_temp.gla('e_g2')),
    '28/stripe-pojemnosc: gosc juz przyjety tylko rozliczony - kod i slad decyzji bez zmian');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND payment_status = 'paid'
            AND qr_token_hash IS NOT NULL AND qr_issued_at IS NOT NULL
       FROM public.event_registrations WHERE id = pg_temp.gla('e_g4')),
    '28/stripe-pojemnosc: gosc przyjety bez kodu dostaje kod razem z rozliczeniem');
  PERFORM pg_temp.assert(
    (SELECT status = 'waitlist' AND payment_status = 'paid' AND decision_source = 'capacity'
            AND waitlist_position > v_pos
       FROM public.event_registrations WHERE id = pg_temp.gla('e_g3')),
    '28/stripe-pojemnosc: nadmiarowy gosc staje w kolejce ZA goscmi, ktorzy juz czekali');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_registrations r
      WHERE r.event_id = 'c9100000-0000-0000-0000-000000000002'
        AND r.status IN ('approved', 'attended', 'no_show')) = 5,
    '28/stripe-pojemnosc: przyjetych tylu, ile miejsc (5) - wydarzenie nie przepelnione');
END $$;

-- ---------------------------------------------------------------------------
-- 5) `_event_group_promote_freed` WPROST
-- ---------------------------------------------------------------------------
SELECT pg_temp.gla_solo('q1', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000004', 'waitlist');
SELECT pg_temp.gla_solo('q2', 'c9100000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-000000000004', 'waitlist');
SELECT pg_temp.gla_solo('n0', 'c9100000-0000-0000-0000-000000000003', NULL, 'approved');
SELECT pg_temp.gla_solo('n1', 'c9100000-0000-0000-0000-000000000003', NULL, 'waitlist');

DO $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp.assert(
    public._event_group_promote_freed('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
      'c9100000-0000-0000-0000-000000000001', NULL) = 0
    AND public._event_group_promote_freed('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
      'c9100000-0000-0000-0000-000000000001', '{}'::uuid[]) = 0
    AND pg_temp.gla_status('q1') = 'waitlist' AND pg_temp.gla_status('x1') = 'waitlist',
    '28/awans-wprost: NULL i pusta tablica - nikt nie awansuje');

  -- Dwa miejsca TA4 (pula 1) i jedno TA5 (bez puli): awans grupuje po bilecie
  -- i nie wychodzi ponad pule.
  n := public._event_group_promote_freed('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9100000-0000-0000-0000-000000000001',
    ARRAY['c9200000-0000-0000-0000-000000000004', 'c9200000-0000-0000-0000-000000000005',
          'c9200000-0000-0000-0000-000000000004']::uuid[]);
  PERFORM pg_temp.assert(n = 2
    AND pg_temp.gla_status('q1') = 'approved' AND pg_temp.gla_status('q2') = 'waitlist'
    AND pg_temp.gla_status('x1') = 'approved',
    '28/awans-wprost: jedno miejsce TA4 (pula), jedno TA5 - razem 2, drugi z TA4 czeka');

  -- Zapis bez cennika: bilet NULL awansuje po calym wydarzeniu, z kontrola
  -- pojemnosci (EC ma 1 miejsce, zajete).
  n := public._event_group_promote_freed('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9100000-0000-0000-0000-000000000003', ARRAY[NULL]::uuid[]);
  PERFORM pg_temp.assert(n = 0 AND pg_temp.gla_status('n1') = 'waitlist',
    '28/awans-wprost: bez cennika i bez wolnego miejsca - nikt nie awansuje');
  UPDATE public.events SET capacity = 2 WHERE id = 'c9100000-0000-0000-0000-000000000003';
  n := public._event_group_promote_freed('c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9',
    'c9100000-0000-0000-0000-000000000003', ARRAY[NULL]::uuid[]);
  PERFORM pg_temp.assert(n = 1 AND pg_temp.gla_status('n1') = 'approved',
    '28/awans-wprost: bez cennika z wolnym miejscem wydarzenia - awans po wydarzeniu');
END $$;

-- ---------------------------------------------------------------------------
-- 6) UPRAWNIENIA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_group_promote_freed(uuid, uuid, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_group_promote_freed(uuid, uuid, uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_group_follow_lead_status()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_apply_outcome_to_group(uuid, uuid, text)', 'EXECUTE'),
  '28/uprawnienia: awans za gosci, kaskada i wynik platnosci bez EXECUTE dla klienta');

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'c9c9c9c9-c9c9-c9c9-c9c9-c9c9c9c9c9c9'),
  '28/sprzatanie: plik nie zostawil ani jednego wiersza');

\echo '== 28 odwolana grupa: koniec =='
