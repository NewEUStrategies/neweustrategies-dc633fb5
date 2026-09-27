-- ============================================================================
-- 74_plan_seat_release - BILET Z PULI WRACA, GDY ZGLOSZENIE GO NIE POTRZEBUJE
-- (20260926180000)
--
-- PO CO TEN PLIK ISTNIEJE
-- `event_registration_claim_plan_seat` (20260926140000) zajmowal bilet z puli
-- planu dla miejsca prowadzacego i nic go nie oddawalo. Od 20260926180000
-- bilet trzyma zgloszenie (`plan_ticket_claims.registration_id`), a oddaje
-- go jego cykl: trigger statusu/platnosci, wynik `unpaid`, przeglad
-- porzuconych kas. Plik sprawdza KAZDA galaz kazdej zmienionej funkcji.
--
-- ATRAPY PULI jak w 29_: `my_ticket_allowance` z kolejki stanow, zrodla
-- warstwy (nadania, subskrypcje) - w transakcji pliku. `plan_ticket_claims`
-- jest atrapa w harness.sql (migracja dopisuje do niej kolumne).
--
-- CZEGO NIE SPRAWDZA: `SKIP LOCKED` przegladu (harness ma jedno polaczenie),
-- harmonogramu pg_cron (atrapa go nie ma - blok migracji konczy sie NOTICE).
-- ============================================================================

\echo '== 74 bilet z puli wraca do puli =='

BEGIN;

-- --- atrapy puli (jak w 29_) ------------------------------------------------
CREATE TABLE public.membership_grants (
  user_id uuid, tenant_id uuid, tier_key text,
  revoked_at timestamptz, starts_at timestamptz, expires_at timestamptz
);
CREATE TABLE public.access_plans (id uuid PRIMARY KEY, tier_key text);
CREATE TABLE public.user_subscriptions (user_id uuid, tenant_id uuid, plan_id uuid, status text);
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS key text;
CREATE FUNCTION public.my_ticket_allowance() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT '{"remaining": 1, "period_start": "2026-01-01", "period_end": "2099-01-01"}'::jsonb
$$;

CREATE TEMP TABLE p73_q (k text PRIMARY KEY, u uuid);
CREATE FUNCTION pg_temp.p73(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM p73_q WHERE k = _key $$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'Tenant E7 (zwrot puli)', 'te7-pool')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('e7000000-0000-0000-0000-000000000001', 'czlonek.e7@example.org'),
  ('e7000000-0000-0000-0000-000000000002', 'obcy.e7@example.org'),
  ('e7000000-0000-0000-0000-000000000003', 'admin.e7@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('e7000000-0000-0000-0000-000000000001', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7'),
  ('e7000000-0000-0000-0000-000000000002', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7'),
  ('e7000000-0000-0000-0000-000000000003', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e7000000-0000-0000-0000-000000000003', 'admin');
SELECT set_config('nes.public_tenant', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', false);

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, user_id) VALUES
  ('e7300000-0000-0000-0000-000000000001', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7',
   'czlonek.e7@example.org', 'Czlonek', 'Puli', 'e7000000-0000-0000-0000-000000000001'),
  ('e7300000-0000-0000-0000-000000000002', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7',
   'gosc.e7@example.org', 'Gosc', 'Czlonka', NULL);

-- Przypadek = wydarzenie + bilet w cenniku + zgloszenie czlonka (prowadzacy).
-- `_claim` - bilet z puli przypiety do zgloszenia, zajety `_age` temu.
CREATE FUNCTION pg_temp.p73_case(_key text, _status text DEFAULT 'pending',
                                 _payment text DEFAULT 'unpaid',
                                 _claim boolean DEFAULT true,
                                 _age interval DEFAULT interval '2 hours')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_event uuid := gen_random_uuid(); v_ticket uuid := gen_random_uuid();
        v_reg uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events
    (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode, registration_flow)
  VALUES
    (v_event, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7-' || replace(_key, '_', '-'),
     'Wydarzenie ' || _key, 'Event ' || _key, now() + interval '30 days', 'published', 'form', 'instant');
  INSERT INTO public.event_ticket_types
    (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, group_registration_enabled)
  VALUES
    (v_ticket, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', v_event, 'k_' || _key, 'Bilet', 'Ticket',
     10000, 'EUR', true);
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by, cancelled_at, paid_at, decided_at, decision_source)
  VALUES
    (v_reg, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', v_event,
     'e7300000-0000-0000-0000-000000000001', v_ticket, _status, 'form', _payment,
     'e7000000-0000-0000-0000-000000000001',
     CASE WHEN _status = 'cancelled' THEN now() END,
     CASE WHEN _payment IN ('paid', 'partially_refunded') THEN now() END,
     CASE WHEN _status IN ('cancelled', 'approved', 'rejected') THEN now() END,
     CASE WHEN _status IN ('cancelled', 'approved', 'rejected') THEN 'system' END);
  INSERT INTO p73_q VALUES (_key || ':event', v_event), (_key || ':ticket', v_ticket), (_key, v_reg);
  IF _claim THEN
    INSERT INTO public.plan_ticket_claims
      (tenant_id, user_id, event_id, tier_key, period_start, period_end,
       face_value_cents, currency, claimed_at, registration_id)
    VALUES
      ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001', v_event,
       'member', DATE '2026-01-01', DATE '2099-01-01', 10000, 'EUR', now() - _age, v_reg);
  END IF;
  RETURN v_reg;
END $$;

-- Zamowienie kasy: `_key` rejestracji, status, wiek, benefit, wlasciciel.
CREATE FUNCTION pg_temp.p73_order(_order text, _key text, _status text DEFAULT 'processing',
                                  _age interval DEFAULT interval '5 minutes',
                                  _benefit text DEFAULT 'included',
                                  _user uuid DEFAULT 'e7000000-0000-0000-0000-000000000001',
                                  _reg uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, metadata, created_at)
  VALUES (v_id, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', _user, _status, 20000, 'EUR',
          jsonb_strip_nulls(jsonb_build_object(
            'event_id', pg_temp.p73(_key || ':event'),
            'ticket_type_id', pg_temp.p73(_key || ':ticket'),
            'registration_id', COALESCE(_reg, pg_temp.p73(_key)),
            'quantity', 2,
            'plan_benefit', _benefit)),
          now() - _age);
  INSERT INTO p73_q VALUES (_order, v_id);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.p73_reg(_key text) RETURNS public.event_registrations
LANGUAGE sql AS $$ SELECT r FROM public.event_registrations r WHERE r.id = pg_temp.p73(_key) $$;

CREATE FUNCTION pg_temp.p73_held(_key text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT released_at IS NULL FROM public.plan_ticket_claims
   WHERE event_id = pg_temp.p73(_key || ':event')
$$;

CREATE FUNCTION pg_temp.p73_needed(_key text, _patch jsonb DEFAULT '{}'::jsonb,
                                   _user uuid DEFAULT 'e7000000-0000-0000-0000-000000000001',
                                   _except uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql AS $$
  SELECT public._event_plan_seat_needed(
    jsonb_populate_record(pg_temp.p73_reg(_key), _patch), _user, _except)
$$;

-- ---------------------------------------------------------------------------
-- 1) REGULA: CZY ZGLOSZENIE POTRZEBUJE BILETU
-- ---------------------------------------------------------------------------
SELECT pg_temp.p73_case('need', 'pending', 'unpaid', false);
SELECT pg_temp.p73_case('need_other', 'pending', 'unpaid', false);
DO $$
BEGIN
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"status":"approved","payment_status":"paid"}') IS TRUE,
    '74/regula: oplacone i otwarte - potrzebuje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"status":"approved","payment_status":"partially_refunded"}') IS TRUE,
    '74/regula: zwrot czesciowy to korekta ceny - nadal potrzebuje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"status":"cancelled","payment_status":"paid"}') IS FALSE,
    '74/regula: odwolane (nawet oplacone) - nie potrzebuje, bilet idzie za udzialem');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"status":"rejected","payment_status":"paid"}') IS FALSE,
    '74/regula: odrzucone - nie potrzebuje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"status":"approved","payment_status":"refunded"}') IS FALSE,
    '74/regula: zwrocone - nie potrzebuje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need') IS FALSE,
    '74/regula: nieoplacone bez kasy - nie potrzebuje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"payment_status":"not_required"}') IS FALSE,
    '74/regula: bez platnosci i bez kasy - nie potrzebuje');
END $$;

SELECT pg_temp.p73_order('o_pending', 'need', 'pending');
DO $$
BEGIN
  PERFORM pg_temp.assert(pg_temp.p73_needed('need') IS TRUE,
    '74/regula: zamowienie pending z benefitem included - kasa zyje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', _except => pg_temp.p73('o_pending')) IS FALSE,
    '74/regula: jedyna zywa kasa to zamowienie, ktore wlasnie przepadlo - nie potrzebuje');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', '{"status":"cancelled"}') IS FALSE,
    '74/regula: odwolane przy zywej kasie - odwolanie wygrywa');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need', _user => 'e7000000-0000-0000-0000-000000000002') IS FALSE,
    '74/regula: kasa innego konta nie trzyma biletu');
  PERFORM pg_temp.assert(pg_temp.p73_needed('need_other') IS FALSE,
    '74/regula: kasa innego zgloszenia nie trzyma biletu');
END $$;
UPDATE public.payment_orders SET status = 'processing' WHERE id = pg_temp.p73('o_pending');
DO $$ BEGIN
  PERFORM pg_temp.assert(pg_temp.p73_needed('need') IS TRUE,
    '74/regula: zamowienie processing (nakladka otwarta) - kasa zyje');
END $$;
UPDATE public.payment_orders SET status = 'failed' WHERE id = pg_temp.p73('o_pending');
DO $$ BEGIN
  PERFORM pg_temp.assert(pg_temp.p73_needed('need') IS FALSE,
    '74/regula: zamowienie failed - kasa nie zyje');
END $$;
UPDATE public.payment_orders SET status = 'processing', created_at = now() - interval '26 hours'
WHERE id = pg_temp.p73('o_pending');
DO $$ BEGIN
  PERFORM pg_temp.assert(pg_temp.p73_needed('need') IS FALSE,
    '74/regula: processing starsze niz 25 h - sesja Stripe wygasla');
END $$;
UPDATE public.payment_orders SET created_at = now(), metadata = metadata - 'plan_benefit'
WHERE id = pg_temp.p73('o_pending');
DO $$ BEGIN
  PERFORM pg_temp.assert(pg_temp.p73_needed('need') IS FALSE,
    '74/regula: kasa bez benefitu included (prowadzacy placil) nie trzyma biletu');
END $$;

-- ---------------------------------------------------------------------------
-- 2) UZGODNIENIE BILETU ZE ZGLOSZENIEM
-- ---------------------------------------------------------------------------
SELECT pg_temp.p73_case('s_free', 'pending', 'unpaid', false);
SELECT pg_temp.p73_case('s_lapsed');
SELECT pg_temp.p73_case('s_live');
SELECT pg_temp.p73_order('o_live', 's_live');
SELECT pg_temp.p73_case('s_back', 'approved', 'paid');
SELECT pg_temp.p73_order('o_back', 's_back', 'paid');
UPDATE public.event_registrations SET payment_order_id = pg_temp.p73('o_back') WHERE id = pg_temp.p73('s_back');
SELECT pg_temp.p73_case('s_nobenefit', 'approved', 'paid');
SELECT pg_temp.p73_order('o_nobenefit', 's_nobenefit', 'paid', _benefit => NULL);
UPDATE public.event_registrations SET payment_order_id = pg_temp.p73('o_nobenefit') WHERE id = pg_temp.p73('s_nobenefit');
SELECT pg_temp.p73_case('s_unpaidorder', 'approved', 'paid');
SELECT pg_temp.p73_order('o_unpaidorder', 's_unpaidorder', 'processing');
UPDATE public.event_registrations SET payment_order_id = pg_temp.p73('o_unpaidorder') WHERE id = pg_temp.p73('s_unpaidorder');
SELECT pg_temp.p73_case('s_foreignorder', 'approved', 'paid');
SELECT pg_temp.p73_order('o_foreignorder', 's_foreignorder', 'paid',
                         _user => 'e7000000-0000-0000-0000-000000000002');
UPDATE public.event_registrations SET payment_order_id = pg_temp.p73('o_foreignorder') WHERE id = pg_temp.p73('s_foreignorder');
SELECT pg_temp.p73_case('s_manual', 'approved', 'paid');
UPDATE public.plan_ticket_claims SET released_at = now()
WHERE registration_id IN (pg_temp.p73('s_back'), pg_temp.p73('s_nobenefit'),
                          pg_temp.p73('s_unpaidorder'), pg_temp.p73('s_foreignorder'),
                          pg_temp.p73('s_manual'));

DO $$
BEGIN
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_free')) = 'none',
    '74/uzgodnienie: zgloszenie bez biletu z puli - none');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(gen_random_uuid()) = 'none',
    '74/uzgodnienie: nieznane zgloszenie - none');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_lapsed')) = 'released'
    AND pg_temp.p73_held('s_lapsed') IS FALSE,
    '74/uzgodnienie: nieoplacone bez kasy - bilet wraca do puli');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_lapsed')) = 'none',
    '74/uzgodnienie: ponownie - bilet juz w puli, nic do zrobienia');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_live')) = 'kept'
    AND pg_temp.p73_held('s_live'),
    '74/uzgodnienie: kasa zyje - bilet zostaje');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_live'), pg_temp.p73('o_live')) = 'released',
    '74/uzgodnienie: przepadla jedyna kasa (p_lapsed_order) - bilet wraca');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_back')) = 'reheld'
    AND pg_temp.p73_held('s_back'),
    '74/uzgodnienie: oplacone zamowieniem z miejscem z puli - bilet wraca do zgloszenia');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_back')) = 'kept',
    '74/uzgodnienie: przywrocony bilet - kept');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_nobenefit')) = 'kept'
    AND pg_temp.p73_held('s_nobenefit') IS FALSE,
    '74/uzgodnienie: zamowienie bez benefitu included nie przywraca biletu');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_unpaidorder')) = 'kept'
    AND pg_temp.p73_held('s_unpaidorder') IS FALSE,
    '74/uzgodnienie: zamowienie nieoplacone nie przywraca biletu');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_foreignorder')) = 'kept'
    AND pg_temp.p73_held('s_foreignorder') IS FALSE,
    '74/uzgodnienie: zamowienie innego konta nie przywraca biletu');
  PERFORM pg_temp.assert(public._event_plan_seat_settle(pg_temp.p73('s_manual')) = 'kept'
    AND pg_temp.p73_held('s_manual') IS FALSE,
    '74/uzgodnienie: wplata reczna bez zamowienia nie przywraca biletu');
END $$;

-- ---------------------------------------------------------------------------
-- 3) TRIGGER: STATUS I PLATNOSC PROWADZACEGO
-- ---------------------------------------------------------------------------
SELECT pg_temp.p73_case('t_cancel');
SELECT pg_temp.p73_order('o_t_cancel', 't_cancel');
SELECT pg_temp.p73_case('t_reject');
SELECT pg_temp.p73_order('o_t_reject', 't_reject');
SELECT pg_temp.p73_case('t_paid', 'approved', 'paid');
SELECT pg_temp.p73_order('o_t_paid', 't_paid', 'paid');
UPDATE public.event_registrations SET payment_order_id = pg_temp.p73('o_t_paid') WHERE id = pg_temp.p73('t_paid');
SELECT pg_temp.p73_case('t_note');
SELECT pg_temp.p73_case('t_guestlead', 'approved', 'paid', false);
DO $$
DECLARE v_guest uuid := gen_random_uuid();
BEGIN
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now(),
         decided_at = now(), decision_source = 'system'
   WHERE id = pg_temp.p73('t_cancel');
  PERFORM pg_temp.assert(pg_temp.p73_held('t_cancel') IS FALSE,
    '74/trigger: odwolanie nieoplaconego przy zywej kasie - bilet wraca od razu');

  UPDATE public.event_registrations SET status = 'rejected', decided_at = now(),
         decision_source = 'organizer', decision_note = 'Brak miejsc'
   WHERE id = pg_temp.p73('t_reject');
  PERFORM pg_temp.assert(pg_temp.p73_held('t_reject') IS FALSE,
    '74/trigger: odrzucenie przez organizatora - bilet wraca');

  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = pg_temp.p73('t_paid');
  PERFORM pg_temp.assert(pg_temp.p73_held('t_paid') IS FALSE,
    '74/trigger: odwolanie OPLACONEGO bez zwrotu - bilet idzie za udzialem');
  UPDATE public.event_registrations SET status = 'approved', cancelled_at = NULL
   WHERE id = pg_temp.p73('t_paid');
  PERFORM pg_temp.assert(pg_temp.p73_held('t_paid'),
    '74/trigger: ponowne przyjecie oplaconego z puli - bilet wraca bez sprawdzania puli');

  UPDATE public.event_registrations SET decision_note = 'notatka'
   WHERE id = pg_temp.p73('t_note');
  PERFORM pg_temp.assert(pg_temp.p73_held('t_note'),
    '74/trigger: zmiana bez statusu i platnosci - trigger milczy (porzucona kase zwalnia przeglad)');
  UPDATE public.event_registrations SET status = 'pending'
   WHERE id = pg_temp.p73('t_note');
  PERFORM pg_temp.assert(pg_temp.p73_held('t_note'),
    '74/trigger: UPDATE statusu bez zmiany wartosci - trigger milczy');

  -- Gosc z przypietym biletem (nie powstaje z kasy - sprawdzamy WHEN triggera).
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by, group_lead_registration_id)
  VALUES
    (v_guest, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', pg_temp.p73('t_guestlead:event'),
     'e7300000-0000-0000-0000-000000000002', pg_temp.p73('t_guestlead:ticket'), 'pending', 'form',
     'unpaid', 'e7000000-0000-0000-0000-000000000001', pg_temp.p73('t_guestlead'));
  INSERT INTO public.plan_ticket_claims
    (tenant_id, user_id, event_id, tier_key, period_start, period_end, registration_id)
  VALUES ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001',
          pg_temp.p73('t_guestlead:event'), 'member', DATE '2026-01-01', DATE '2099-01-01', v_guest);
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now() WHERE id = v_guest;
  PERFORM pg_temp.assert(pg_temp.p73_held('t_guestlead'),
    '74/trigger: wiersz goscia nie uruchamia uzgodnienia (WHEN: tylko prowadzacy)');
END $$;

-- ---------------------------------------------------------------------------
-- 4) WYNIK PLATNOSCI: unpaid, refunded, paid po odwolaniu
-- ---------------------------------------------------------------------------
SELECT pg_temp.p73_case('u_one');
SELECT pg_temp.p73_order('o_u_one', 'u_one');
SELECT pg_temp.p73_case('u_two');
SELECT pg_temp.p73_order('o_u_two_a', 'u_two');
SELECT pg_temp.p73_order('o_u_two_b', 'u_two');
SELECT pg_temp.p73_case('u_refund', 'pending', 'unpaid');
SELECT pg_temp.p73_order('o_u_refund', 'u_refund', 'paid');
SELECT pg_temp.p73_case('u_late', 'pending', 'unpaid');
SELECT pg_temp.p73_order('o_u_late', 'u_late', 'processing');
DO $$
DECLARE v jsonb;
BEGIN
  v := public.payments_apply_event_ticket_outcome(pg_temp.p73('o_u_one'), 'unpaid');
  PERFORM pg_temp.assert((v->>'applied')::boolean AND pg_temp.p73_held('u_one') IS FALSE,
    '74/unpaid: przepadla jedyna kasa - bilet wraca, choc zamowienie nadal processing');
  v := public.payments_apply_event_ticket_outcome(pg_temp.p73('o_u_two_a'), 'unpaid');
  PERFORM pg_temp.assert((v->>'applied')::boolean AND pg_temp.p73_held('u_two'),
    '74/unpaid: druga kasa tego zgloszenia zyje - bilet zostaje');

  v := public.payments_apply_event_ticket_outcome(pg_temp.p73('o_u_refund'), 'paid');
  PERFORM pg_temp.assert(pg_temp.p73_held('u_refund'),
    '74/zwrot: po wplacie bilet trzyma oplacone zgloszenie');
  v := public.payments_apply_event_ticket_outcome(pg_temp.p73('o_u_refund'), 'refunded');
  PERFORM pg_temp.assert((v->>'outcome') = 'refunded' AND pg_temp.p73_held('u_refund') IS FALSE,
    '74/zwrot: pelny zwrot - bilet wraca do puli');

  -- Odwolanie w trakcie kasy, potem wplata z otwartej sesji, potem ponowne
  -- przyjecie przez organizatora.
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = pg_temp.p73('u_late');
  PERFORM pg_temp.assert(pg_temp.p73_held('u_late') IS FALSE,
    '74/pozno: odwolanie przy otwartej nakladce - bilet wraca');
  UPDATE public.payment_orders SET status = 'paid' WHERE id = pg_temp.p73('o_u_late');
  v := public.payments_apply_event_ticket_outcome(pg_temp.p73('o_u_late'), 'paid');
  PERFORM pg_temp.assert(pg_temp.p73_held('u_late') IS FALSE
    AND (SELECT status FROM public.event_registrations WHERE id = pg_temp.p73('u_late')) = 'cancelled',
    '74/pozno: wplata na odwolane zgloszenie - zapis dalej odwolany, bilet w puli');
  UPDATE public.event_registrations SET status = 'approved', cancelled_at = NULL
   WHERE id = pg_temp.p73('u_late');
  PERFORM pg_temp.assert(pg_temp.p73_held('u_late'),
    '74/pozno: ponowne przyjecie - zamowienie zuzylo bilet, wraca do zgloszenia');
END $$;

-- ---------------------------------------------------------------------------
-- 5) PRZEGLAD PORZUCONYCH KAS
-- ---------------------------------------------------------------------------
UPDATE public.plan_ticket_claims SET released_at = now();
SELECT pg_temp.p73_case('w_old');
SELECT pg_temp.p73_case('w_grace', _age => interval '10 minutes');
SELECT pg_temp.p73_case('w_live');
SELECT pg_temp.p73_order('o_w_live', 'w_live');
SELECT pg_temp.p73_case('w_paid', 'approved', 'paid');
SELECT pg_temp.p73_case('w_expired', _age => interval '30 hours');
SELECT pg_temp.p73_order('o_w_expired', 'w_expired', 'processing', interval '26 hours');
SELECT pg_temp.p73_case('w_closedpaid', 'cancelled', 'paid');
SELECT pg_temp.p73_case('w_rsvp', 'pending', 'unpaid', false);
INSERT INTO public.plan_ticket_claims
  (tenant_id, user_id, event_id, tier_key, period_start, period_end, claimed_at)
VALUES ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001',
        pg_temp.p73('w_rsvp:event'), 'member', DATE '2026-01-01', DATE '2099-01-01',
        now() - interval '3 hours');
DO $$
DECLARE v integer;
BEGIN
  v := public._event_plan_seat_release_lapsed(1);
  PERFORM pg_temp.assert(v = 1 AND pg_temp.p73_held('w_expired') IS FALSE AND pg_temp.p73_held('w_old'),
    '74/przeglad: limit 1 - najpierw najstarszy (kasa wygasla po 24 h)');
  v := public._event_plan_seat_release_lapsed(0);
  PERFORM pg_temp.assert(v = 1,
    '74/przeglad: limit 0 liczy sie jak 1');
  v := public._event_plan_seat_release_lapsed(NULL);
  PERFORM pg_temp.assert(v = 1 AND pg_temp.p73_held('w_closedpaid') IS FALSE
    AND pg_temp.p73_held('w_old') IS FALSE,
    '74/przeglad: limit NULL - domyslny; odwolane oplacone i porzucone wracaja');
  PERFORM pg_temp.assert(pg_temp.p73_held('w_grace') AND pg_temp.p73_held('w_live')
    AND pg_temp.p73_held('w_paid') AND pg_temp.p73_held('w_rsvp'),
    '74/przeglad: karencja godziny, zywa kasa, oplacone i bilet RSVP zostaja');
  v := public._event_plan_seat_release_lapsed();
  PERFORM pg_temp.assert(v = 0, '74/przeglad: nic do zwolnienia - 0');
END $$;

-- ---------------------------------------------------------------------------
-- 6) KASA ZAPISUJE ZGLOSZENIE W BILECIE
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.p73_claim(_key text, _dry boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as('e7000000-0000-0000-0000-000000000001', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7');
  v := public.event_registration_claim_plan_seat(pg_temp.p73(_key), _dry);
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;
CREATE FUNCTION pg_temp.p73_holder(_key text) RETURNS uuid
LANGUAGE sql AS $$
  SELECT registration_id FROM public.plan_ticket_claims WHERE event_id = pg_temp.p73(_key || ':event')
$$;

SELECT pg_temp.p73_case('c_new', 'pending', 'unpaid', false);
SELECT pg_temp.p73_case('c_move', 'cancelled', 'unpaid');
SELECT pg_temp.p73_case('c_rsvp', 'pending', 'unpaid', false);
INSERT INTO public.plan_ticket_claims
  (tenant_id, user_id, event_id, tier_key, period_start, period_end)
VALUES ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001',
        pg_temp.p73('c_rsvp:event'), 'member', DATE '2026-01-01', DATE '2099-01-01');
DO $$
DECLARE v jsonb; v_second uuid := gen_random_uuid();
BEGIN
  v := pg_temp.p73_claim('c_new');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false}'::jsonb
    AND pg_temp.p73_holder('c_new') = pg_temp.p73('c_new'),
    '74/kasa: nowy bilet zapisuje zgloszenie');
  v := pg_temp.p73_claim('c_new');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": true}'::jsonb
    AND pg_temp.p73_holder('c_new') = pg_temp.p73('c_new'),
    '74/kasa: ponowna kasa tego samego zgloszenia - bez zmian');

  -- Odwolane zgloszenie trzyma aktywny bilet (np. sprzed tej migracji), osoba
  -- zapisuje sie ponownie.
  UPDATE public.plan_ticket_claims SET released_at = NULL WHERE registration_id = pg_temp.p73('c_move');
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status, created_by)
  VALUES (v_second, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', pg_temp.p73('c_move:event'),
          'e7300000-0000-0000-0000-000000000001', pg_temp.p73('c_move:ticket'), 'pending', 'form',
          'unpaid', 'e7000000-0000-0000-0000-000000000001');
  INSERT INTO p73_q VALUES ('c_move2', v_second);
  v := pg_temp.p73_claim('c_move2', true);
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": true}'::jsonb
    AND pg_temp.p73_holder('c_move') = pg_temp.p73('c_move'),
    '74/kasa: podglad niczego nie przepina');
  v := pg_temp.p73_claim('c_move2');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": true}'::jsonb
    AND pg_temp.p73_holder('c_move') = v_second,
    '74/kasa: bilet zamknietego zgloszenia przechodzi na biezace');

  v := pg_temp.p73_claim('c_rsvp');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": true}'::jsonb
    AND pg_temp.p73_holder('c_rsvp') IS NULL,
    '74/kasa: bilet sciezki RSVP zostaje bez zgloszenia (cykl zgloszenia go nie zwolni)');

  UPDATE public.plan_ticket_claims SET released_at = now(), registration_id = NULL
   WHERE event_id = pg_temp.p73('c_new:event');
  v := pg_temp.p73_claim('c_new');
  PERFORM pg_temp.assert(v = '{"claimed": true, "reused": false}'::jsonb
    AND pg_temp.p73_holder('c_new') = pg_temp.p73('c_new') AND pg_temp.p73_held('c_new'),
    '74/kasa: zwolniony wiersz zajety ponownie zapisuje zgloszenie');
END $$;

-- ---------------------------------------------------------------------------
-- 7) RECZNY ZWROT DO PULI
-- ---------------------------------------------------------------------------
SELECT pg_temp.p73_case('r_linked', 'approved', 'paid');
SELECT pg_temp.p73_order('o_r_linked', 'r_linked', 'paid');
UPDATE public.event_registrations SET payment_order_id = pg_temp.p73('o_r_linked') WHERE id = pg_temp.p73('r_linked');
SELECT pg_temp.p73_case('r_svc', 'approved', 'paid');
SELECT pg_temp.p73_case('r_free', 'pending', 'unpaid', false);
INSERT INTO public.plan_ticket_claims
  (tenant_id, user_id, event_id, tier_key, period_start, period_end)
VALUES ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001',
        pg_temp.p73('r_free:event'), 'member', DATE '2026-01-01', DATE '2099-01-01');
DO $$
DECLARE v boolean;
BEGIN
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(public.release_included_event_ticket(pg_temp.p73('r_free:event')) IS FALSE,
    '74/reczny: anonim bez wskazania osoby - false');

  PERFORM pg_temp.act_as('e7000000-0000-0000-0000-000000000001', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7');
  v := public.release_included_event_ticket(pg_temp.p73('r_free:event'));
  PERFORM pg_temp.assert(v AND pg_temp.p73_held('r_free') IS FALSE,
    '74/reczny: czlonek zwraca bilet sciezki RSVP');
  v := public.release_included_event_ticket(pg_temp.p73('r_linked:event'));
  PERFORM pg_temp.assert(v IS FALSE AND pg_temp.p73_held('r_linked'),
    '74/reczny: czlonek NIE zwraca biletu, ktory trzyma oplacone zgloszenie');

  PERFORM pg_temp.act_as('e7000000-0000-0000-0000-000000000002', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7');
  PERFORM pg_temp.assert_raises_like(
    format('SELECT public.release_included_event_ticket(%L::uuid, %L::uuid)',
           pg_temp.p73('r_linked:event'), 'e7000000-0000-0000-0000-000000000001'),
    'tickets: forbidden', '74/reczny: cudzy bilet bez roli administratora - odmowa');

  PERFORM pg_temp.act_as('e7000000-0000-0000-0000-000000000003', 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7');
  v := public.release_included_event_ticket(pg_temp.p73('r_linked:event'), 'e7000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(v AND pg_temp.p73_held('r_linked') IS FALSE AND pg_temp.p73_holder('r_linked') IS NULL,
    '74/reczny: administrator zwraca bilet zgloszenia i odpina go');
  PERFORM pg_temp.act_as();
  UPDATE public.event_registrations SET status = 'attended', attended_at = now()
   WHERE id = pg_temp.p73('r_linked');
  PERFORM pg_temp.assert(pg_temp.p73_held('r_linked') IS FALSE,
    '74/reczny: odpiety bilet nie wraca przy kolejnej zmianie zgloszenia');

  v := public.release_included_event_ticket(pg_temp.p73('r_svc:event'), 'e7000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert(v AND pg_temp.p73_held('r_svc') IS FALSE AND pg_temp.p73_holder('r_svc') IS NULL,
    '74/reczny: rola serwisowa (bez auth.uid) zwraca i odpina');
END $$;

-- ---------------------------------------------------------------------------
-- 8) DOPIECIE BILETOW SPRZED MIGRACJI
-- ---------------------------------------------------------------------------
UPDATE public.plan_ticket_claims SET released_at = now();
SELECT pg_temp.p73_case('b_link', 'approved', 'paid', false);
SELECT pg_temp.p73_order('o_b_link_old', 'b_link', 'paid', interval '3 days');
SELECT pg_temp.p73_case('b_nobenefit', 'pending', 'unpaid', false);
SELECT pg_temp.p73_order('o_b_nobenefit', 'b_nobenefit', 'paid', _benefit => NULL);
SELECT pg_temp.p73_case('b_badid', 'pending', 'unpaid', false);
SELECT pg_temp.p73_case('b_lapsed', 'pending', 'unpaid', false);
SELECT pg_temp.p73_order('o_b_lapsed', 'b_lapsed', 'processing', interval '2 days');
DO $$
DECLARE v jsonb; v_newer uuid := gen_random_uuid(); k text;
BEGIN
  -- b_link: dwa zgloszenia tej osoby, najnowsze zamowienie wygrywa.
  UPDATE public.event_registrations SET status = 'cancelled', cancelled_at = now()
   WHERE id = pg_temp.p73('b_link');
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode, payment_status,
     created_by, paid_at, decided_at, decision_source)
  VALUES (v_newer, 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', pg_temp.p73('b_link:event'),
          'e7300000-0000-0000-0000-000000000001', pg_temp.p73('b_link:ticket'), 'approved', 'form',
          'paid', 'e7000000-0000-0000-0000-000000000001', now(), now(), 'system');
  PERFORM pg_temp.p73_order('o_b_link_new', 'b_link', 'paid', interval '1 day', _reg => v_newer);
  INSERT INTO public.payment_orders (tenant_id, user_id, status, metadata)
  VALUES ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001', 'paid',
          jsonb_build_object('event_id', pg_temp.p73('b_badid:event'), 'registration_id', 'zle',
                             'plan_benefit', 'included'));
  FOREACH k IN ARRAY ARRAY['b_link', 'b_nobenefit', 'b_badid', 'b_lapsed'] LOOP
    INSERT INTO public.plan_ticket_claims
      (tenant_id, user_id, event_id, tier_key, period_start, period_end, claimed_at)
    VALUES ('e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7', 'e7000000-0000-0000-0000-000000000001',
            pg_temp.p73(k || ':event'), 'member', DATE '2026-01-01', DATE '2099-01-01',
            now() - interval '3 days');
  END LOOP;

  v := public._event_plan_seat_link_backfill();
  PERFORM pg_temp.assert(v = '{"linked": 2, "released": 1}'::jsonb,
    '74/dopiecie: dwa bilety z dowodem w zamowieniu, jeden porzucony od razu wraca');
  PERFORM pg_temp.assert(pg_temp.p73_holder('b_link') = v_newer AND pg_temp.p73_held('b_link'),
    '74/dopiecie: dwa zamowienia - wygrywa najnowsze zgloszenie, oplacone trzyma bilet');
  PERFORM pg_temp.assert(pg_temp.p73_holder('b_lapsed') = pg_temp.p73('b_lapsed')
    AND pg_temp.p73_held('b_lapsed') IS FALSE,
    '74/dopiecie: porzucona kasa sprzed migracji - bilet przypiety i zwolniony');
  PERFORM pg_temp.assert(pg_temp.p73_holder('b_nobenefit') IS NULL AND pg_temp.p73_holder('b_badid') IS NULL,
    '74/dopiecie: bez benefitu included albo z uszkodzonym registration_id - bez przypiecia');
  PERFORM pg_temp.assert(public._event_plan_seat_link_backfill() = '{"linked": 0, "released": 0}'::jsonb,
    '74/dopiecie: ponowne uruchomienie niczego nie zmienia');
  PERFORM pg_temp.assert(pg_temp.p73_holder('r_linked') IS NULL,
    '74/dopiecie: bilet odpiety przez administratora (zwolniony) nie wraca do zgloszenia');
END $$;

-- ---------------------------------------------------------------------------
-- 9) SCHEMAT I UPRAWNIENIA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT pg_get_triggerdef(t.oid) LIKE '%AFTER UPDATE OF status, payment_status%'
          AND pg_get_triggerdef(t.oid) LIKE '%group_lead_registration_id IS NULL%'
     FROM pg_trigger t
    WHERE t.tgrelid = 'public.event_registrations'::regclass
      AND t.tgname = 'event_registrations_plan_seat_follow'),
  '74/schemat: trigger prowadzacego na status i payment_status');
SELECT pg_temp.assert(
  (SELECT confdeltype = 'n' FROM pg_constraint
    WHERE conrelid = 'public.plan_ticket_claims'::regclass
      AND conname = 'plan_ticket_claims_registration_id_fkey'),
  '74/schemat: registration_id - klucz obcy ON DELETE SET NULL (slad audytowy zostaje)');
SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public._event_plan_seat_settle(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_plan_seat_needed(public.event_registrations, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_plan_seat_release_lapsed(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_plan_seat_link_backfill()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._tg_event_plan_seat_follow()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_plan_seat_release_lapsed(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_plan_seat_link_backfill()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.release_included_event_ticket(uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.release_included_event_ticket(uuid, uuid)', 'EXECUTE'),
  '74/uprawnienia: funkcje wewnetrzne tylko dla wlasciciela (przeglad i dopiecie - service_role), zwrot reczny dla zalogowanych');

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'e7e7e7e7-e7e7-e7e7-e7e7-e7e7e7e7e7e7')
  AND NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims)
  AND to_regprocedure('public.my_ticket_allowance()') IS NULL,
  '74/sprzatanie: plik nie zostawil wierszy ani atrap puli');

\echo '== 74 bilet z puli: koniec =='
