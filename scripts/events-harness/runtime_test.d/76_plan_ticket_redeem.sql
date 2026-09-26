-- ============================================================================
-- 76_plan_ticket_redeem - BILET Z PULI DLA POJEDYNCZEGO ZGLOSZENIA ETAPU 4
-- (20260926150000, sekcja 9 i delty 8c/8e: znacznik `redeemed_at`)
--
-- PO CO TEN PLIK ISTNIEJE
-- Pojedyncze zgloszenie etapu 4 czlonka z pula konczylo sie w kasie odmowa
-- `ticket_included_in_plan` ("odbierz z puli") - a sciezki odbioru dla
-- zgloszen z formularza nie bylo (`claim_included_event_ticket` zna tylko
-- `rsvp_event`). `event_registration_redeem_plan_ticket` rozlicza takie
-- zgloszenie bez Stripe. Plik sprawdza KAZDA galaz funkcji.
--
-- ATRAPY PULI jak w 29_: `my_ticket_allowance` z kolejki stanow i zrodla
-- warstwy - w transakcji pliku; `plan_ticket_claims` jest atrapa w harness.sql.
-- ============================================================================

\echo '== 76 bilet z puli dla pojedynczego zgloszenia =='

BEGIN;

CREATE TABLE public.membership_grants (
  user_id uuid, tenant_id uuid, tier_key text,
  revoked_at timestamptz, starts_at timestamptz, expires_at timestamptz
);
CREATE TABLE public.access_plans (id uuid PRIMARY KEY, tier_key text);
CREATE TABLE public.user_subscriptions (user_id uuid, tenant_id uuid, plan_id uuid, status text);
ALTER TABLE public.membership_tiers ADD COLUMN IF NOT EXISTS key text;

CREATE TEMP TABLE p75_pool (state jsonb NOT NULL);
CREATE FUNCTION public.my_ticket_allowance() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT COALESCE((SELECT state FROM pg_temp.p75_pool LIMIT 1), '{"remaining": 0}'::jsonb)
$$;
CREATE FUNCTION pg_temp.p75_pool(_remaining integer) RETURNS void
LANGUAGE sql AS $$
  DELETE FROM pg_temp.p75_pool;
  INSERT INTO pg_temp.p75_pool VALUES (jsonb_build_object(
    'remaining', _remaining, 'period_start', '2026-01-01', 'period_end', '2099-01-01'));
$$;


CREATE TEMP TABLE p75_q (k text PRIMARY KEY, u uuid);
CREATE FUNCTION pg_temp.p75(_key text) RETURNS uuid
LANGUAGE sql AS $$ SELECT u FROM p75_q WHERE k = _key $$;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'Tenant E5 (odbior z puli)', 'te5-redeem')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email) VALUES
  ('e5000000-0000-0000-0000-000000000001', 'czlonek.e5@example.org'),
  ('e5000000-0000-0000-0000-000000000002', 'obcy.e5@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('e5000000-0000-0000-0000-000000000001', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5'),
  ('e5000000-0000-0000-0000-000000000002', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5')
ON CONFLICT (id) DO NOTHING;
SELECT set_config('nes.public_tenant', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', false);

INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name, user_id) VALUES
  ('e5300000-0000-0000-0000-000000000001', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
   'czlonek.e5@example.org', 'Czlonek', 'Puli', 'e5000000-0000-0000-0000-000000000001'),
  ('e5300000-0000-0000-0000-000000000002', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
   'gosc.e5@example.org', 'Gosc', 'Czlonka', NULL),
  ('e5300000-0000-0000-0000-000000000003', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
   'obcy.e5@example.org', 'Obcy', 'Uczestnik', 'e5000000-0000-0000-0000-000000000002');

-- Przypadek = wydarzenie + bilet (cena, pula, okno) + zgloszenie czlonka.
CREATE FUNCTION pg_temp.p75_case(_key text, _status text DEFAULT 'pending',
                                 _payment text DEFAULT 'unpaid', _price integer DEFAULT 10000,
                                 _quota integer DEFAULT NULL,
                                 _person uuid DEFAULT 'e5300000-0000-0000-0000-000000000001')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_event uuid := gen_random_uuid(); v_ticket uuid := gen_random_uuid();
        v_reg uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events
    (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode, registration_flow)
  VALUES
    (v_event, 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'e5-' || replace(_key, '_', '-'),
     'Wydarzenie ' || _key, 'Event ' || _key, now() + interval '30 days', 'published', 'form', 'instant');
  INSERT INTO public.event_ticket_types
    (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency, quota,
     group_registration_enabled)
  VALUES
    (v_ticket, 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', v_event, 'k_' || _key, 'Bilet', 'Ticket',
     _price, 'EUR', _quota, true);
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by, cancelled_at, attended_at, paid_at, decided_at, decision_source)
  VALUES
    (v_reg, 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', v_event, _person, v_ticket, _status, 'form',
     _payment, 'e5000000-0000-0000-0000-000000000001',
     CASE WHEN _status = 'cancelled' THEN now() END,
     CASE WHEN _status = 'attended' THEN now() END,
     CASE WHEN _payment = 'paid' THEN now() END,
     CASE WHEN _status IN ('cancelled', 'approved') THEN now() END,
     CASE WHEN _status = 'cancelled' THEN 'system'
          WHEN _status = 'approved' THEN 'organizer' END);
  INSERT INTO p75_q VALUES (_key || ':event', v_event), (_key || ':ticket', v_ticket), (_key, v_reg);
  RETURN v_reg;
END $$;

CREATE FUNCTION pg_temp.p75_redeem(_key text,
                                   _uid uuid DEFAULT 'e5000000-0000-0000-0000-000000000001')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.act_as(_uid, 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5');
  v := public.event_registration_redeem_plan_ticket(pg_temp.p75(_key));
  PERFORM pg_temp.act_as();
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.p75_untouched(_key text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT r.payment_status = 'unpaid' AND r.qr_token_hash IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims c
                     WHERE c.event_id = r.event_id AND c.released_at IS NULL)
  FROM public.event_registrations r WHERE r.id = pg_temp.p75(_key)
$$;

-- --- przypadki odmow ---------------------------------------------------------
SELECT pg_temp.p75_case('foreign', _person => 'e5300000-0000-0000-0000-000000000003');
SELECT pg_temp.p75_case('cancelled', 'cancelled');
SELECT pg_temp.p75_case('attended', 'attended');
SELECT pg_temp.p75_case('settled', 'approved', 'paid');
SELECT pg_temp.p75_case('group');
INSERT INTO public.event_registrations
  (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by, group_lead_registration_id)
VALUES ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', pg_temp.p75('group:event'),
        'e5300000-0000-0000-0000-000000000002', pg_temp.p75('group:ticket'), 'pending', 'form',
        'unpaid', 'e5000000-0000-0000-0000-000000000001', pg_temp.p75('group'));
SELECT pg_temp.p75_case('guestclosed');
INSERT INTO public.event_registrations
  (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by, group_lead_registration_id, cancelled_at, decided_at, decision_source)
VALUES ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', pg_temp.p75('guestclosed:event'),
        'e5300000-0000-0000-0000-000000000002', pg_temp.p75('guestclosed:ticket'), 'cancelled',
        'form', 'unpaid', 'e5000000-0000-0000-0000-000000000001', pg_temp.p75('guestclosed'),
        now(), now(), 'system');
SELECT pg_temp.p75_case('unpublished');
UPDATE public.events SET status = 'draft' WHERE id = pg_temp.p75('unpublished:event');
SELECT pg_temp.p75_case('evcancelled');
UPDATE public.events SET cancelled_at = now() WHERE id = pg_temp.p75('evcancelled:event');
SELECT pg_temp.p75_case('inactive');
UPDATE public.event_ticket_types SET is_active = false WHERE id = pg_temp.p75('inactive:ticket');
SELECT pg_temp.p75_case('finished');
UPDATE public.events SET starts_at = now() - interval '1 hour' WHERE id = pg_temp.p75('finished:event');
SELECT pg_temp.p75_case('notopen');
UPDATE public.event_ticket_types SET sales_from = now() + interval '1 day'
WHERE id = pg_temp.p75('notopen:ticket');
SELECT pg_temp.p75_case('closedsales');
UPDATE public.event_ticket_types SET sales_from = now() - interval '2 days', sales_to = now() - interval '1 day'
WHERE id = pg_temp.p75('closedsales:ticket');
SELECT pg_temp.p75_case('full', _quota => 1);
INSERT INTO public.event_registrations
  (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, created_by, decided_at, decision_source)
VALUES ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', pg_temp.p75('full:event'),
        'e5300000-0000-0000-0000-000000000003', pg_temp.p75('full:ticket'), 'approved', 'form',
        'paid', 'e5000000-0000-0000-0000-000000000002', now(), 'organizer');
SELECT pg_temp.p75_case('free', _price => 0);
SELECT pg_temp.p75_case('noticket');
UPDATE public.event_registrations SET ticket_type_id = NULL WHERE id = pg_temp.p75('noticket');
SELECT pg_temp.p75_case('empty');

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.p75_pool(1);
  PERFORM pg_temp.act_as();
  v := public.event_registration_redeem_plan_ticket(pg_temp.p75('empty'));
  PERFORM pg_temp.assert(v = '{"ok": false, "reason": "account_required"}'::jsonb,
    '76/odmowa: anonim - account_required');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('foreign') = '{"ok": false, "reason": "not_found"}'::jsonb
    AND pg_temp.p75_redeem('empty', 'e5000000-0000-0000-0000-000000000002')
        = '{"ok": false, "reason": "not_found"}'::jsonb,
    '76/odmowa: zgloszenie innej osoby (i cudze dla czlonka) - not_found, bez sondy istnienia');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('cancelled') = '{"ok": false, "reason": "registration_closed"}'::jsonb
    AND pg_temp.p75_redeem('attended') = '{"ok": false, "reason": "registration_closed"}'::jsonb,
    '76/odmowa: zapis anulowany albo po wejsciu - registration_closed');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('settled') = '{"ok": false, "reason": "already_settled"}'::jsonb,
    '76/odmowa: zapis juz oplacony - already_settled');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('group') = '{"ok": false, "reason": "group_order"}'::jsonb,
    '76/odmowa: prowadzacy z nieoplaconym gosciem - group_order (kasa oplaca grupe)');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('unpublished') = '{"ok": false, "reason": "ticket_not_available"}'::jsonb
    AND pg_temp.p75_redeem('evcancelled') = '{"ok": false, "reason": "ticket_not_available"}'::jsonb
    AND pg_temp.p75_redeem('inactive') = '{"ok": false, "reason": "ticket_not_available"}'::jsonb
    AND pg_temp.p75_redeem('noticket') = '{"ok": false, "reason": "ticket_not_available"}'::jsonb,
    '76/odmowa: wydarzenie niepublikowane, odwolane, bilet wycofany albo zapis bez biletu - ticket_not_available');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('finished') = '{"ok": false, "reason": "event_finished"}'::jsonb,
    '76/odmowa: wydarzenie juz trwa - event_finished');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('notopen') = '{"ok": false, "reason": "sales_not_open"}'::jsonb
    AND pg_temp.p75_redeem('closedsales') = '{"ok": false, "reason": "sales_closed"}'::jsonb,
    '76/odmowa: okno sprzedazy - sales_not_open / sales_closed');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('full') = '{"ok": false, "reason": "sold_out"}'::jsonb,
    '76/odmowa: brak wolnego miejsca - sold_out');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('free') = '{"ok": false, "reason": "not_eligible"}'::jsonb,
    '76/odmowa: bilet za zero - pula nie ma czego pokrywac (not_eligible z claim_plan_seat)');
  PERFORM pg_temp.p75_pool(0);
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('empty') = '{"ok": false, "reason": "pool_empty"}'::jsonb,
    '76/odmowa: pusta pula - pool_empty');
  PERFORM pg_temp.assert(
    pg_temp.p75_untouched('group') AND pg_temp.p75_untouched('full')
    AND pg_temp.p75_untouched('empty') AND pg_temp.p75_untouched('closedsales'),
    '76/odmowa: zadna odmowa nie zdjela biletu z puli ani nie rozliczyla zgloszenia');
END $$;

-- --- akceptacja organizatora i wiersz goscia (ta sama regula co wplata) ----
SELECT pg_temp.p75_case('approvalflow');
UPDATE public.events SET registration_flow = 'approval' WHERE id = pg_temp.p75('approvalflow:event');
SELECT pg_temp.p75_case('needsapproval');
UPDATE public.event_ticket_types SET requires_approval = true
WHERE id = pg_temp.p75('needsapproval:ticket');
SELECT pg_temp.p75_case('orgapproved', 'approved');
UPDATE public.events SET registration_flow = 'approval' WHERE id = pg_temp.p75('orgapproved:event');
SELECT pg_temp.p75_case('guestrow');
UPDATE public.event_registrations
   SET group_lead_registration_id = pg_temp.p75('group')
 WHERE id = pg_temp.p75('guestrow');

DO $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.p75_pool(3);
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('approvalflow') = '{"ok": false, "reason": "approval_required"}'::jsonb
    AND pg_temp.p75_untouched('approvalflow'),
    '76/akceptacja: przeplyw approval - approval_required, pula nietknieta');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('needsapproval') = '{"ok": false, "reason": "approval_required"}'::jsonb
    AND pg_temp.p75_untouched('needsapproval'),
    '76/akceptacja: bilet requires_approval - approval_required, pula nietknieta');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = pg_temp.p75('approvalflow')) = 'pending',
    '76/akceptacja: odmowa niczego nie zapisuje - zgloszenie dalej pending');
  v := pg_temp.p75_redeem('orgapproved');
  PERFORM pg_temp.assert(v->>'ok' = 'true' AND v->>'status' = 'approved',
    '76/akceptacja: po przyjeciu przez organizatora (approved/unpaid) odbior przechodzi');
  PERFORM pg_temp.assert(
    (SELECT payment_status = 'paid' AND decision_source = 'organizer'
       FROM public.event_registrations WHERE id = pg_temp.p75('orgapproved')),
    '76/akceptacja: rozliczone, slad decyzji organizatora zostaje');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('guestrow') = '{"ok": false, "reason": "not_eligible"}'::jsonb,
    '76/odmowa: wiersz goscia - pula pokrywa tylko wlasne miejsce czlonka (not_eligible)');
END $$;

-- --- przyjecie ---------------------------------------------------------------
SELECT pg_temp.p75_case('ok', 'pending', _quota => 2);
SELECT pg_temp.p75_case('okwait', 'waitlist');
UPDATE public.event_registrations SET waitlist_position = 1 WHERE id = pg_temp.p75('okwait');
SELECT pg_temp.p75_case('okapproved', 'approved', _quota => 1);
SELECT pg_temp.p75_case('reused');
SELECT pg_temp.p75_case('repoint');

DO $$
DECLARE v jsonb; r public.event_registrations; c public.plan_ticket_claims;
BEGIN
  PERFORM pg_temp.p75_pool(1);
  v := pg_temp.p75_redeem('ok');
  PERFORM pg_temp.assert(v = jsonb_build_object('ok', true, 'registration_id', pg_temp.p75('ok'),
      'event_id', pg_temp.p75('ok:event'), 'status', 'approved', 'payment_status', 'paid',
      'reused', false),
    '76/przyjecie: odpowiedz niesie zgloszenie, wydarzenie, status i nowy bilet z puli');
  SELECT * INTO r FROM public.event_registrations WHERE id = pg_temp.p75('ok');
  PERFORM pg_temp.assert(
    r.status = 'approved' AND r.payment_status = 'paid' AND r.paid_at IS NOT NULL
    AND r.payment_order_id IS NULL AND r.qr_token_hash ~ '^[0-9a-f]{64}$'
    AND r.qr_issued_at IS NOT NULL AND r.decision_source = 'system' AND r.decided_at IS NOT NULL,
    '76/przyjecie: pending -> approved, paid bez zamowienia, zastepczy kod QR, decyzja systemu');
  SELECT * INTO c FROM public.plan_ticket_claims WHERE event_id = pg_temp.p75('ok:event');
  PERFORM pg_temp.assert(c.released_at IS NULL AND c.face_value_cents = 10000 AND c.currency = 'EUR'
    AND c.registration_id = pg_temp.p75('ok') AND c.redeemed_at IS NOT NULL,
    '76/przyjecie: bilet zdjety z puli z wartoscia z cennika, przypiety do zgloszenia - trigger cyklu (8c) go NIE oddal');
  PERFORM pg_temp.assert(
    (SELECT sold_count FROM public.event_ticket_types WHERE id = pg_temp.p75('ok:ticket')) = 1,
    '76/przyjecie: miejsce zajete w puli biletu (przelicznik sold_count)');
  PERFORM pg_temp.assert(EXISTS (
      SELECT 1 FROM public.domain_events d
      WHERE d.aggregate_id = pg_temp.p75('ok')::text
        AND d.event_type = 'event.registration.payment.v1'
        AND d.payload->>'settled_by' = 'plan_ticket' AND d.payload->>'outcome' = 'paid'
        AND d.payload->'order_id' = 'null'::jsonb
        AND (d.payload->>'plan_ticket_reused')::boolean = false),
    '76/przyjecie: zdarzenie platnosci z settled_by = plan_ticket, bez zamowienia');
  PERFORM pg_temp.assert(
    (SELECT r2.id FROM public.event_registrations r2
      WHERE r2.id = ANY (public._event_ticket_codes_pending(500))
        AND r2.id = pg_temp.p75('ok')) IS NOT NULL,
    '76/przyjecie: zgloszenie trafia do kolejki biletow (cron wysle, gdy serwer nie zdazy)');
  PERFORM pg_temp.assert(
    pg_temp.p75_redeem('ok') = '{"ok": false, "reason": "already_settled"}'::jsonb,
    '76/przyjecie: ponowienie po sukcesie - already_settled, bez drugiego rozliczenia');

  -- Kolejka rezerwowa organizatora: rozliczenie przyjmuje, jak wplata Stripe.
  PERFORM pg_temp.p75_pool(1);
  v := pg_temp.p75_redeem('okwait');
  SELECT * INTO r FROM public.event_registrations WHERE id = pg_temp.p75('okwait');
  PERFORM pg_temp.assert((v->>'ok')::boolean AND r.status = 'approved'
    AND r.waitlist_position IS NULL,
    '76/przyjecie: waitlist -> approved, pozycja w kolejce wyczyszczona');

  -- Przyjety przez organizatora (miejsce trzyma, pula biletu PELNA): bez
  -- sprawdzenia miejsca, decyzja organizatora zostaje.
  PERFORM pg_temp.p75_pool(1);
  v := pg_temp.p75_redeem('okapproved');
  SELECT * INTO r FROM public.event_registrations WHERE id = pg_temp.p75('okapproved');
  PERFORM pg_temp.assert((v->>'ok')::boolean AND r.status = 'approved'
    AND r.decision_source = 'organizer' AND r.qr_token_hash IS NOT NULL
    AND r.payment_status = 'paid',
    '76/przyjecie: approved (pelna pula biletu) - rozliczone bez kontroli miejsca, decyzja organizatora zostaje');

  -- Bilet juz zajety dla wydarzenia (ponowny zapis po odwolaniu) - pula pusta,
  -- ten sam bilet.
  INSERT INTO public.plan_ticket_claims
    (tenant_id, user_id, event_id, tier_key, period_start, period_end, face_value_cents, currency)
  VALUES ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'e5000000-0000-0000-0000-000000000001',
          pg_temp.p75('reused:event'), 'member', '2026-01-01', '2099-01-01', 10000, 'EUR');
  PERFORM pg_temp.p75_pool(0);
  v := pg_temp.p75_redeem('reused');
  PERFORM pg_temp.assert((v->>'ok')::boolean AND (v->>'reused')::boolean
    AND (SELECT count(*) FROM public.plan_ticket_claims
          WHERE event_id = pg_temp.p75('reused:event')) = 1,
    '76/przyjecie: bilet juz zajety dla wydarzenia - reused, bez drugiego wiersza puli');
  PERFORM pg_temp.assert(
    (SELECT registration_id IS NULL AND redeemed_at IS NULL FROM public.plan_ticket_claims
      WHERE event_id = pg_temp.p75('reused:event')),
    '76/przyjecie: bilet sciezki RSVP (bez zgloszenia) zostaje jej - bez znacznika odbioru');

  -- Bilet trzymany przez ODWOLANE wczesniejsze zgloszenie tej osoby
  -- przechodzi na biezace (8e) - jego cykl go potem odda.
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by, cancelled_at, decided_at, decision_source)
  VALUES ('e5400000-0000-0000-0000-000000000001', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
          pg_temp.p75('repoint:event'), 'e5300000-0000-0000-0000-000000000001',
          pg_temp.p75('repoint:ticket'), 'cancelled', 'form', 'paid',
          'e5000000-0000-0000-0000-000000000001', now(), now(), 'system');
  INSERT INTO public.plan_ticket_claims
    (tenant_id, user_id, event_id, tier_key, period_start, period_end, face_value_cents,
     currency, registration_id)
  VALUES ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'e5000000-0000-0000-0000-000000000001',
          pg_temp.p75('repoint:event'), 'member', '2026-01-01', '2099-01-01', 10000, 'EUR',
          'e5400000-0000-0000-0000-000000000001');
  v := pg_temp.p75_redeem('repoint');
  PERFORM pg_temp.assert((v->>'reused')::boolean AND (SELECT registration_id = pg_temp.p75('repoint')
      FROM public.plan_ticket_claims WHERE event_id = pg_temp.p75('repoint:event')),
    '76/przyjecie: bilet odwolanego zgloszenia przechodzi na odebrane');
  PERFORM pg_temp.assert(
    (SELECT redeemed_at IS NOT NULL FROM public.plan_ticket_claims
      WHERE event_id = pg_temp.p75('repoint:event')),
    '76/przyjecie: przepiety bilet dostaje znacznik odbioru');

  -- Anulowany gosc nie blokuje odbioru.
  PERFORM pg_temp.p75_pool(1);
  PERFORM pg_temp.assert((pg_temp.p75_redeem('guestclosed')->>'ok')::boolean,
    '76/przyjecie: gosc anulowany nie jest grupa do oplacenia');
END $$;

-- CYKL ZGLOSZENIA (pozycja 3): odwolanie odebranego zgloszenia oddaje bilet.
DO $$
BEGIN
  UPDATE public.event_registrations
     SET status = 'cancelled', cancelled_at = now(), qr_token_hash = NULL, qr_issued_at = NULL
   WHERE id = pg_temp.p75('ok');
  PERFORM pg_temp.assert(
    (SELECT released_at IS NOT NULL FROM public.plan_ticket_claims
      WHERE event_id = pg_temp.p75('ok:event')),
    '76/cykl: odwolanie zgloszenia odebranego z planu oddaje bilet do puli');
  -- Ponowne przyjecie (organizator) - zgloszenie nadal `paid`, bez zamowienia.
  UPDATE public.event_registrations
     SET status = 'approved', cancelled_at = NULL
   WHERE id = pg_temp.p75('ok');
  PERFORM pg_temp.assert(
    (SELECT released_at IS NULL FROM public.plan_ticket_claims
      WHERE event_id = pg_temp.p75('ok:event')),
    '76/cykl: ponowne przyjecie odebranego zgloszenia przywraca bilet (znacznik odbioru)');
END $$;

-- Przepiecie (8e): bilet ze znacznikiem trzymany przez ZAMKNIETE zgloszenie
-- (dane sprzed cyklu) przechodzi na nowe zgloszenie w kasie bez znacznika.
DO $$
BEGIN
  PERFORM pg_temp.p75_case('stale', 'cancelled');
  INSERT INTO public.plan_ticket_claims
    (tenant_id, user_id, event_id, tier_key, period_start, period_end, face_value_cents,
     currency, registration_id, redeemed_at)
  VALUES ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5', 'e5000000-0000-0000-0000-000000000001',
          pg_temp.p75('stale:event'), 'member', '2026-01-01', '2099-01-01', 10000, 'EUR',
          pg_temp.p75('stale'), now());
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by)
  VALUES ('e5400000-0000-0000-0000-000000000003', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
          pg_temp.p75('stale:event'), 'e5300000-0000-0000-0000-000000000001',
          pg_temp.p75('stale:ticket'), 'pending', 'form', 'unpaid',
          'e5000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.act_as('e5000000-0000-0000-0000-000000000001', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5');
  PERFORM public.event_registration_claim_plan_seat('e5400000-0000-0000-0000-000000000003', false);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(
    (SELECT redeemed_at IS NULL AND registration_id = 'e5400000-0000-0000-0000-000000000003'
       FROM public.plan_ticket_claims WHERE event_id = pg_temp.p75('stale:event')),
    '76/cykl: przepiecie biletu w kasie kasuje znacznik odbioru');
END $$;

-- Kasa grupowa na zwolnionym bilecie odebranym wczesniej: ponowne zajecie
-- kasuje znacznik (bilet przestaje byc rozliczeniem zgloszenia).
DO $$
BEGIN
  UPDATE public.plan_ticket_claims SET released_at = now()
   WHERE event_id = pg_temp.p75('repoint:event');
  UPDATE public.event_registrations
     SET status = 'cancelled', cancelled_at = now(), qr_token_hash = NULL, qr_issued_at = NULL
   WHERE id = pg_temp.p75('repoint');
  PERFORM pg_temp.act_as('e5000000-0000-0000-0000-000000000001', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5');
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, created_by)
  VALUES ('e5400000-0000-0000-0000-000000000002', 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
          pg_temp.p75('repoint:event'), 'e5300000-0000-0000-0000-000000000001',
          pg_temp.p75('repoint:ticket'), 'pending', 'form', 'unpaid',
          'e5000000-0000-0000-0000-000000000001');
  PERFORM pg_temp.p75_pool(1);
  PERFORM public.event_registration_claim_plan_seat('e5400000-0000-0000-0000-000000000002', false);
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert(
    (SELECT released_at IS NULL AND redeemed_at IS NULL
            AND registration_id = 'e5400000-0000-0000-0000-000000000002'
       FROM public.plan_ticket_claims WHERE event_id = pg_temp.p75('repoint:event')),
    '76/cykl: ponowne zajecie w kasie kasuje znacznik odbioru');
END $$;

SELECT pg_temp.assert(
  has_function_privilege('authenticated', 'public.event_registration_redeem_plan_ticket(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_registration_redeem_plan_ticket(uuid)', 'EXECUTE'),
  '76/uprawnienia: sesja czlonka tak, anonim nie');

ROLLBACK;

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5')
  AND NOT EXISTS (SELECT 1 FROM public.plan_ticket_claims)
  AND to_regprocedure('public.my_ticket_allowance()') IS NULL,
  '76/sprzatanie: plik nie zostawil wierszy ani atrap puli');

\echo '== 76 bilet z puli dla pojedynczego zgloszenia: koniec =='
