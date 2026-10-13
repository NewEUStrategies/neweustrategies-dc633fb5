-- ============================================================================
-- 24b_refund_jobs_escalation - ZLECENIE ZWROTU, KTORE NIE DOCHODZI DO SKUTKU,
-- TRAFIA DO CZLOWIEKA (INV-19c, 20261012120000)
--
-- PO CO TEN PLIK ISTNIEJE
-- Do 20261012120000 dziesiata porazka zostawiala zlecenie w `failed` na
-- zawsze (claim bral tylko `attempts < 10`), a `submitted` nie mial obslugi
-- `refund.failed` - zwrot za odrzucone zgloszenie nie dochodzil do skutku, a
-- organizator widzial to wylacznie wtedy, gdy sam otworzyl dziennik.
-- Kryterium audytu: DZIESIATA PORAZKA DAJE `needs_review` I POWIADOMIENIE.
--
-- CO SPRAWDZA
--   1. Dziesiata porazka (settle) -> `needs_review` / `attempts_exhausted`,
--      `last_error` zachowany, alarm dla administratora najemcy - i ZADNEGO
--      dla redaktora tego najemcy ani administratora obcego najemcy; dziewiata
--      porazka jeszcze nie alarmuje; claim nie podejmuje zlecenia ponownie.
--   2. Zastane `failed` z budzetem wyczerpanym przed migracja i porzucona
--      dzierzawa ostatniej proby -> sweep do `needs_review` + alarm; drugi
--      przebieg NIE alarmuje drugi raz (takze po wyjsciu z okna deduplikacji).
--   3. `refund.failed` dla `submitted` -> `needs_review` / `provider_refund_failed`
--      + alarm; duplikat zdarzenia, obce srodowisko i nieznany zwrot - nic.
--   4. Zwrot cofniety PO `charge.refunded` (`completed` -> `refund.failed`)
--      zostaje w `needs_review` mimo zamowienia `refunded`.
--   5. `submitted` bez potwierdzenia > 7 dni -> `refund_unconfirmed` + alarm;
--      6 dni - jeszcze nie; przywrocenie zgloszenia nadal zablokowane (zwrot
--      moze dojsc); pozniejszy `refund.failed` doprecyzowuje powod bez
--      drugiego alarmu.
--   6. Wspolna platnosc grupy -> `needs_review` z alarmem, bez zlecenia zwrotu.
--   7. Ponowne odrzucenie po przywroceniu startuje z czystym budzetem.
--   8. CHECK powodu, odmowa nieznanego powodu, uprawnienia, dziennik panelu.
--
-- CZEGO NIE SPRAWDZA
--   * mapowania zdarzen Stripe w TS - to vitest
--     (src/lib/billing/__tests__/refundFailure.server.test.ts);
--   * samego producenta alarmu (`_tenant_admins_alert`) - jego testy ma
--     27_invoices_compliance.sql; tu liczymy tylko skutek w `notifications`.
--
-- SPRZATANIE: caly plik w BEGIN ... ROLLBACK. `now()` jest stale w transakcji,
-- wiec uplyw czasu symulujemy, cofajac `next_attempt_at`/`claimed_at`.
-- ============================================================================

\echo '== 24b eskalacja zlecen zwrotu =='

BEGIN;

INSERT INTO public.tenants (id, name, slug) VALUES
  ('c19c0000-0000-4000-8000-0000000000a1', 'Tenant INV-19c', 't-inv19c'),
  ('c19c0000-0000-4000-8000-0000000000a2', 'Tenant INV-19c obcy', 't-inv19c-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('c19c0000-0000-4000-8000-000000000001', 'admin.inv19c@example.org'),
  ('c19c0000-0000-4000-8000-000000000002', 'editor.inv19c@example.org'),
  ('c19c0000-0000-4000-8000-000000000003', 'admin.other.inv19c@example.org')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id) VALUES
  ('c19c0000-0000-4000-8000-000000000001', 'c19c0000-0000-4000-8000-0000000000a1'),
  ('c19c0000-0000-4000-8000-000000000002', 'c19c0000-0000-4000-8000-0000000000a1'),
  ('c19c0000-0000-4000-8000-000000000003', 'c19c0000-0000-4000-8000-0000000000a2')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c19c0000-0000-4000-8000-000000000001', 'admin',  'c19c0000-0000-4000-8000-0000000000a1'),
  ('c19c0000-0000-4000-8000-000000000002', 'editor', 'c19c0000-0000-4000-8000-0000000000a1'),
  ('c19c0000-0000-4000-8000-000000000003', 'admin',  'c19c0000-0000-4000-8000-0000000000a2')
ON CONFLICT DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode)
VALUES ('c19c0000-0000-4000-8000-0000000000e1', 'c19c0000-0000-4000-8000-0000000000a1',
  'inv19c-refunds', 'Kongres zwrotów', 'Refund congress', now() + interval '30 days', 'published', 'form');
INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
  group_registration_enabled, group_max_size)
VALUES ('c19c0000-0000-4000-8000-0000000000f1', 'c19c0000-0000-4000-8000-0000000000a1',
  'c19c0000-0000-4000-8000-0000000000e1', 'inv19c', 'Wstęp', 'Admission', 10000, 'PLN', true, 5);

-- Zgloszenie oplacone + zamowienie z wiazaniem `registration_id`. `_lead`
-- dopina je jako goscia platnosci prowadzacego (wspolne zamowienie).
CREATE FUNCTION pg_temp.inv19c_registration(_status text, _lead uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_person uuid := gen_random_uuid(); v_id uuid := gen_random_uuid(); v_order uuid;
BEGIN
  INSERT INTO public.event_people (id, tenant_id, email, first_name, last_name)
  VALUES (v_person, 'c19c0000-0000-4000-8000-0000000000a1', v_person::text || '@inv19c.example.org', 'Test', 'Refund');
  INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, ticket_type_id,
    status, registration_mode, payment_status, group_lead_registration_id)
  VALUES (v_id, 'c19c0000-0000-4000-8000-0000000000a1', 'c19c0000-0000-4000-8000-0000000000e1', v_person,
    'c19c0000-0000-4000-8000-0000000000f1', _status, 'form', 'paid', _lead);
  IF _lead IS NULL THEN
    v_order := gen_random_uuid();
    INSERT INTO public.payment_orders (id, tenant_id, status, amount_cents, currency, provider, environment,
      provider_payment_intent_id, metadata)
    VALUES (v_order, 'c19c0000-0000-4000-8000-0000000000a1', 'paid', 10000, 'PLN', 'stripe', 'sandbox',
      'pi_inv19c_' || replace(v_id::text, '-', ''),
      jsonb_build_object('event_id', 'c19c0000-0000-4000-8000-0000000000e1', 'registration_id', v_id));
  ELSE
    SELECT payment_order_id INTO v_order FROM public.event_registrations WHERE id = _lead;
  END IF;
  UPDATE public.event_registrations SET payment_order_id = v_order WHERE id = v_id;
  RETURN v_id;
END $$;

-- Odrzucenie przez organizatora: PRAWDZIWY trigger kolejki zleca zwrot.
CREATE FUNCTION pg_temp.inv19c_reject(_registration uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_job uuid;
BEGIN
  UPDATE public.event_registrations SET status = 'rejected' WHERE id = _registration;
  SELECT j.id INTO v_job FROM public.event_registration_refund_jobs j
    JOIN public.event_registrations r ON r.payment_order_id = j.payment_order_id
   WHERE r.id = _registration;
  RETURN v_job;
END $$;

CREATE FUNCTION pg_temp.inv19c_job() RETURNS uuid
LANGUAGE sql AS $$ SELECT pg_temp.inv19c_reject(pg_temp.inv19c_registration('pending')) $$;

-- Claim prawdziwym workerem; zwraca dzierzawe wskazanego zlecenia (albo NULL).
CREATE FUNCTION pg_temp.inv19c_claim(_job uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  UPDATE public.event_registration_refund_jobs SET next_attempt_at = now() - interval '1 minute'
   WHERE id = _job AND state IN ('pending', 'failed');
  SELECT e INTO v FROM jsonb_array_elements(public._event_registration_refunds_claim(100)) e
   WHERE e->>'id' = _job::text;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.inv19c_alerts(_user uuid, _job uuid) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications n
   WHERE n.user_id = _user AND n.kind = 'billing'
     AND n.href = '/admin/events/c19c0000-0000-4000-8000-0000000000e1/registration/list?refund_job=' || _job::text
$$;

-- Alarm sprzed 10 minut: deduplikacja `enqueue_notification` (5 minut po href)
-- przestaje maskowac drugi alarm, wiec "brak drugiego alarmu" mierzy straznik
-- eskalacji, a nie okno deduplikacji.
CREATE FUNCTION pg_temp.inv19c_age_alerts() RETURNS void
LANGUAGE sql AS $$ UPDATE public.notifications SET created_at = now() - interval '10 minutes' $$;

-- Jakikolwiek alarm o zleceniu zwrotu u danego uzytkownika (dowolne zlecenie,
-- dowolne wydarzenie) - miara "NIE dostal", ktora nie zalezy od jednego href.
CREATE FUNCTION pg_temp.inv19c_any_alert(_user uuid) RETURNS boolean
LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.notifications n
                  WHERE n.user_id = _user AND n.href LIKE '%refund_job=%')
$$;

CREATE FUNCTION pg_temp.inv19c_only_admin(_job uuid, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.assert(pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', _job) = 1,
    _label || ': administrator najemcy dostal dokladnie jeden alarm');
  PERFORM pg_temp.assert(NOT pg_temp.inv19c_any_alert('c19c0000-0000-4000-8000-000000000002'),
    _label || ': redaktor tego najemcy NIE dostal alarmu');
  PERFORM pg_temp.assert(NOT pg_temp.inv19c_any_alert('c19c0000-0000-4000-8000-000000000003'),
    _label || ': administrator obcego najemcy NIE dostal alarmu');
END $$;

CREATE TEMP TABLE inv19c_jobs (k text PRIMARY KEY, id uuid);

-- ---------------------------------------------------------------------------
-- 1. Kryterium audytu: dziesiata porazka -> needs_review + powiadomienie.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_job uuid := pg_temp.inv19c_job(); v_lease jsonb; i integer;
BEGIN
  INSERT INTO inv19c_jobs VALUES ('exhausted', v_job);
  PERFORM pg_temp.assert(public._event_refund_attempt_budget() = 10, 'budzet: dziesiec prob (lustro REFUND_ATTEMPT_BUDGET)');
  FOR i IN 1..10 LOOP
    v_lease := pg_temp.inv19c_claim(v_job);
    PERFORM pg_temp.assert(v_lease IS NOT NULL AND (SELECT attempts = i FROM public.event_registration_refund_jobs WHERE id = v_job),
      format('budzet: proba %s podjeta przez claim', i));
    PERFORM pg_temp.assert(public._event_registration_refunds_settle(v_job, (v_lease->>'claim_token')::uuid, NULL, 'provider_unavailable'),
      format('budzet: porazka %s zapisana', i));
    IF i = 9 THEN
      PERFORM pg_temp.assert((SELECT state = 'failed' AND review_reason IS NULL AND escalated_at IS NULL
                                FROM public.event_registration_refund_jobs WHERE id = v_job)
        AND NOT pg_temp.inv19c_any_alert('c19c0000-0000-4000-8000-000000000001'),
        'budzet: dziewiata porazka - jeszcze ponawiamy, bez alarmu');
    END IF;
  END LOOP;
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'attempts_exhausted'
                            AND last_error = 'provider_unavailable' AND escalated_at IS NOT NULL AND claim_token IS NULL
                            FROM public.event_registration_refund_jobs WHERE id = v_job),
    'budzet: DZIESIATA porazka daje needs_review / attempts_exhausted z zachowanym last_error');
  PERFORM pg_temp.inv19c_only_admin(v_job, 'budzet');
  PERFORM pg_temp.assert((SELECT title_pl = 'Zwrot wymaga decyzji' AND body_pl LIKE '%Kongres zwrotów%' AND body_pl LIKE '%10 próbach%'
                                 AND body_en LIKE '%Refund congress%' AND body_pl NOT LIKE '%Test Refund%'
                            FROM public.notifications WHERE user_id = 'c19c0000-0000-4000-8000-000000000001'
                             AND href LIKE '%refund_job=' || v_job::text),
    'budzet: alarm nazywa wydarzenie i liczbe prob, bez danych osobowych uczestnika');
  PERFORM pg_temp.assert(pg_temp.inv19c_claim(v_job) IS NULL
      AND (SELECT state = 'needs_review' FROM public.event_registration_refund_jobs WHERE id = v_job),
    'budzet: wyczerpane zlecenie nie wraca do claim');
END $$;

-- ---------------------------------------------------------------------------
-- 2. Zastane zlecenia: `failed` z budzetem wyczerpanym przed migracja (claim
--    nigdy ich nie bral) i porzucona dzierzawa ostatniej proby.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_stuck uuid := pg_temp.inv19c_job(); v_lease uuid := pg_temp.inv19c_job(); v_stamp timestamptz;
BEGIN
  INSERT INTO inv19c_jobs VALUES ('stuck', v_stuck), ('lease', v_lease);
  UPDATE public.event_registration_refund_jobs SET state = 'failed', attempts = 10, last_error = 'card_declined',
         next_attempt_at = now() - interval '1 day' WHERE id = v_stuck;
  UPDATE public.event_registration_refund_jobs SET state = 'processing', attempts = 10, claim_token = gen_random_uuid(),
         claimed_at = now() - interval '20 minutes' WHERE id = v_lease;
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM pg_temp.assert(public._event_registration_refunds_claim(100) = '[]'::jsonb,
    'sweep: wyczerpanych zlecen nie podejmuje zaden claim');
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'attempts_exhausted' AND last_error = 'card_declined'
                            FROM public.event_registration_refund_jobs WHERE id = v_stuck),
    'sweep: zastane failed (attempts >= budzet) -> needs_review, blad operatora zachowany');
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'attempts_exhausted' AND claim_token IS NULL
                            FROM public.event_registration_refund_jobs WHERE id = v_lease),
    'sweep: porzucona dzierzawa ostatniej proby -> needs_review zamiast jedenastej proby');
  PERFORM pg_temp.assert(pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_stuck) = 1
      AND pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_lease) = 1,
    'sweep: kazde zlecenie dostaje wlasny alarm (href z id zlecenia)');
  PERFORM pg_temp.assert(NOT pg_temp.inv19c_any_alert('c19c0000-0000-4000-8000-000000000002')
      AND NOT pg_temp.inv19c_any_alert('c19c0000-0000-4000-8000-000000000003'),
    'sweep: alarmy tylko do administratora tego najemcy');

  SELECT escalated_at INTO v_stamp FROM public.event_registration_refund_jobs WHERE id = v_stuck;
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM public._event_registration_refunds_claim(100);
  PERFORM pg_temp.assert(pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_stuck) = 1
      AND (SELECT escalated_at = v_stamp FROM public.event_registration_refund_jobs WHERE id = v_stuck),
    'sweep: drugi przebieg NIE alarmuje drugi raz (takze po oknie deduplikacji)');
  PERFORM pg_temp.assert(NOT public._event_refund_job_escalate(v_stuck, 'attempts_exhausted'),
    'sweep: helper nie eskaluje zlecenia, ktore juz czeka na czlowieka');
END $$;

-- ---------------------------------------------------------------------------
-- 3. `refund.failed` dla zlecenia przyjetego przez operatora.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_job uuid := pg_temp.inv19c_job(); v_lease jsonb;
BEGIN
  INSERT INTO inv19c_jobs VALUES ('provider', v_job);
  v_lease := pg_temp.inv19c_claim(v_job);
  PERFORM public._event_registration_refunds_settle(v_job, (v_lease->>'claim_token')::uuid, 're_inv19c_failed', NULL);
  PERFORM pg_temp.assert((SELECT state = 'submitted' FROM public.event_registration_refund_jobs WHERE id = v_job),
    'refund.failed: zlecenie przyjete przez operatora (submitted)');
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM pg_temp.assert(NOT public._event_registration_refund_failed('re_inv19c_failed', 'live', 'expired_or_canceled_card'),
    'refund.failed: zdarzenie z obcego srodowiska nie dotyka zlecenia');
  PERFORM pg_temp.assert(NOT public._event_registration_refund_failed('re_inv19c_unknown', 'sandbox', 'declined')
      AND NOT public._event_registration_refund_failed(NULL, 'sandbox', 'declined')
      AND NOT public._event_registration_refund_failed('re_inv19c_failed', 'staging', 'declined'),
    'refund.failed: nieznany zwrot, pusty identyfikator i nieznane srodowisko - nic');
  PERFORM pg_temp.assert((SELECT state = 'submitted' FROM public.event_registration_refund_jobs WHERE id = v_job),
    'refund.failed: odrzucone dopasowania nie zmienily stanu');
  PERFORM pg_temp.assert(public._event_registration_refund_failed('re_inv19c_failed', 'sandbox', 'expired_or_canceled_card<script>'),
    'refund.failed: dopasowanie po zwrocie i srodowisku eskaluje');
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'provider_refund_failed'
                            AND last_error = 'expired_or_canceled_cardscript'
                            FROM public.event_registration_refund_jobs WHERE id = v_job),
    'refund.failed: needs_review / provider_refund_failed, kod operatora przyciety do bezpiecznego alfabetu');
  PERFORM pg_temp.inv19c_only_admin(v_job, 'refund.failed');
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM pg_temp.assert(NOT public._event_registration_refund_failed('re_inv19c_failed', 'sandbox', 'expired_or_canceled_card')
      AND pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_job) = 1,
    'refund.failed: duplikat (refund.updated po refund.failed) nie alarmuje drugi raz');
END $$;

-- ---------------------------------------------------------------------------
-- 4. Zwrot cofniety PO `charge.refunded`: zamowienie juz `refunded`, zlecenie
--    `completed` - porazka ma zostac widoczna, a sweep jej nie schowa.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_job uuid := pg_temp.inv19c_job(); v_lease jsonb;
BEGIN
  v_lease := pg_temp.inv19c_claim(v_job);
  PERFORM public._event_registration_refunds_settle(v_job, (v_lease->>'claim_token')::uuid, 're_inv19c_late', NULL);
  UPDATE public.payment_orders o SET status = 'refunded' FROM public.event_registration_refund_jobs j
   WHERE j.id = v_job AND o.id = j.payment_order_id;
  PERFORM public._event_registration_refunds_claim(100);
  PERFORM pg_temp.assert((SELECT state = 'completed' FROM public.event_registration_refund_jobs WHERE id = v_job),
    'cofniety zwrot: charge.refunded zamknal zlecenie (completed)');
  PERFORM pg_temp.assert(public._event_registration_refund_failed('re_inv19c_late', 'sandbox', 'charge_for_pending_refund_disputed'),
    'cofniety zwrot: refund.failed po completed eskaluje');
  PERFORM public._event_registration_refunds_claim(100);
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'provider_refund_failed'
                            FROM public.event_registration_refund_jobs WHERE id = v_job),
    'cofniety zwrot: sweep NIE przywraca completed na podstawie nieaktualnego statusu zamowienia');
END $$;

-- ---------------------------------------------------------------------------
-- 5. `submitted` bez potwierdzenia operatora.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_slow uuid := pg_temp.inv19c_job(); v_fresh uuid; v_lease jsonb;
BEGIN
  v_lease := pg_temp.inv19c_claim(v_slow);
  PERFORM public._event_registration_refunds_settle(v_slow, (v_lease->>'claim_token')::uuid, 're_inv19c_slow', NULL);
  v_fresh := pg_temp.inv19c_job();
  v_lease := pg_temp.inv19c_claim(v_fresh);
  PERFORM public._event_registration_refunds_settle(v_fresh, (v_lease->>'claim_token')::uuid, 're_inv19c_fresh', NULL);
  UPDATE public.event_registration_refund_jobs SET claimed_at = now() - interval '8 days' WHERE id = v_slow;
  UPDATE public.event_registration_refund_jobs SET claimed_at = now() - interval '6 days' WHERE id = v_fresh;
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM public._event_registration_refunds_claim(100);
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'refund_unconfirmed'
                            FROM public.event_registration_refund_jobs WHERE id = v_slow)
      AND pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_slow) = 1,
    'bez potwierdzenia: submitted > 7 dni -> needs_review / refund_unconfirmed + alarm');
  PERFORM pg_temp.assert((SELECT body_pl LIKE '%ponad 7 dni%' FROM public.notifications
                           WHERE user_id = 'c19c0000-0000-4000-8000-000000000001'
                             AND href LIKE '%refund_job=' || v_slow::text),
    'bez potwierdzenia: tresc alarmu podaje okno z tej samej stalej co sweep');
  PERFORM pg_temp.assert((SELECT state = 'submitted' FROM public.event_registration_refund_jobs WHERE id = v_fresh)
      AND pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_fresh) = 0,
    'bez potwierdzenia: 6 dni to jeszcze kolejka operatora - bez alarmu');
  -- Zwrot moze jeszcze dojsc u operatora: eskalacja nie zdejmuje blokady
  -- przywrocenia, ktora `submitted` mial (uczestnik z biletem i z pieniedzmi).
  PERFORM pg_temp.assert_raises_like(format(
    'UPDATE public.event_registrations SET status = %L WHERE id = %L', 'approved',
    (SELECT registration_id FROM public.event_registration_refund_jobs WHERE id = v_slow)),
    'invalid_transition', 'bez potwierdzenia: przywrocenie zgloszenia nadal zablokowane');
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM pg_temp.assert(NOT public._event_registration_refund_failed('re_inv19c_slow', 'sandbox', 'lost_or_stolen_card'),
    'bez potwierdzenia: pozniejszy refund.failed nie wysyla drugiego alarmu');
  PERFORM pg_temp.assert((SELECT review_reason = 'provider_refund_failed' AND last_error = 'lost_or_stolen_card'
                            FROM public.event_registration_refund_jobs WHERE id = v_slow)
      AND pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_slow) = 1,
    'bez potwierdzenia: ...ale doprecyzowuje powod w dzienniku');
END $$;

-- ---------------------------------------------------------------------------
-- 6. Wspolna platnosc grupy: decyzja organizatora, teraz z alarmem.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_lead uuid := pg_temp.inv19c_registration('approved'); v_guest uuid; v_job uuid;
BEGIN
  v_guest := pg_temp.inv19c_registration('approved', v_lead);
  v_job := pg_temp.inv19c_reject(v_guest);
  PERFORM pg_temp.inv19c_age_alerts();
  PERFORM pg_temp.assert(pg_temp.inv19c_claim(v_job) IS NULL,
    'wspolna platnosc: zwrot calego zamowienia grupy NIE jest zlecany');
  PERFORM pg_temp.assert((SELECT state = 'needs_review' AND review_reason = 'active_registrations_share_payment'
                            AND last_error IS NULL FROM public.event_registration_refund_jobs WHERE id = v_job)
      AND pg_temp.inv19c_alerts('c19c0000-0000-4000-8000-000000000001', v_job) = 1,
    'wspolna platnosc: needs_review z powodem we wlasnej kolumnie + alarm');
END $$;

-- ---------------------------------------------------------------------------
-- 7. Ponowne odrzucenie po przywroceniu zgloszenia: czysty budzet i powod.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_job uuid := (SELECT id FROM inv19c_jobs WHERE k = 'exhausted'); v_reg uuid;
BEGIN
  SELECT registration_id INTO v_reg FROM public.event_registration_refund_jobs WHERE id = v_job;
  UPDATE public.event_registrations SET status = 'approved' WHERE id = v_reg;
  PERFORM pg_temp.assert((SELECT state = 'cancelled' FROM public.event_registration_refund_jobs WHERE id = v_job),
    'ponowienie: przywrocenie wycofuje zlecenie czekajace na decyzje');
  UPDATE public.event_registrations SET status = 'rejected' WHERE id = v_reg;
  PERFORM pg_temp.assert((SELECT state = 'pending' AND attempts = 0 AND review_reason IS NULL AND escalated_at IS NULL
                                 AND last_error IS NULL AND provider_refund_id IS NULL
                            FROM public.event_registration_refund_jobs WHERE id = v_job),
    'ponowienie: nowe odrzucenie startuje z czystym budzetem i bez starego powodu');
  PERFORM pg_temp.assert(pg_temp.inv19c_claim(v_job) IS NOT NULL,
    'ponowienie: zlecenie wraca do claim (dotad attempts = 10 blokowalo je na zawsze)');
END $$;

-- ---------------------------------------------------------------------------
-- 8. Kontrakt: CHECK powodu, nieznany powod, uprawnienia, dziennik panelu.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(format(
  'UPDATE public.event_registration_refund_jobs SET state = %L, review_reason = NULL WHERE id = %L',
  'needs_review', (SELECT id FROM inv19c_jobs WHERE k = 'exhausted')),
  'event_refund_jobs_review_reason_check', 'kontrakt: needs_review bez powodu odrzucone przez CHECK');
SELECT pg_temp.assert_raises_like(format(
  'SELECT public._event_refund_job_escalate(%L, %L)', (SELECT id FROM inv19c_jobs WHERE k = 'exhausted'), 'whatever'),
  'invalid_review_reason', 'kontrakt: helper odmawia nieznanego powodu');

SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public._event_registration_refund_failed(text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_registration_refund_failed(text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_registration_refund_failed(text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_refund_job_escalate(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_refund_job_escalate(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_refund_attempt_budget()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_refund_unconfirmed_days()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_registration_refunds_settle(uuid,uuid,text,text)', 'EXECUTE'),
  'kontrakt: eskalacja i webhook wylacznie dla service_role');

SELECT pg_temp.act_as('c19c0000-0000-4000-8000-000000000001', 'c19c0000-0000-4000-8000-0000000000a1');
DO $$
DECLARE v_rows jsonb := public.admin_event_refund_jobs('c19c0000-0000-4000-8000-0000000000e1'); v_row jsonb;
BEGIN
  SELECT r INTO v_row FROM jsonb_array_elements(v_rows) r
   WHERE r->>'id' = (SELECT id FROM inv19c_jobs WHERE k = 'stuck')::text;
  PERFORM pg_temp.assert(v_row->>'review_reason' = 'attempts_exhausted' AND v_row->>'escalated_at' IS NOT NULL
      AND v_row->>'last_error' = 'card_declined' AND NOT (v_row ? 'claim_token') AND NOT (v_row ? 'provider_refund_id'),
    'dziennik: panel widzi powod, chwile alarmu i blad operatora - bez dzierzawy workera');
END $$;
SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;
