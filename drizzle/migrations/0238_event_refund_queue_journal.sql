-- events-harness: include
-- ============================================================================
-- ZAPISY NA WYDARZENIA - REG-03 (CZ. 1B): KOLEJKA ZWROTOW, SIATKA
-- BEZPIECZENSTWA, DZIERZAWA, ROZLICZENIE I DZIENNIK ORGANIZATORA.
--
-- Druga polowa 20261012170000 (podzial pod limit 45 KiB, ta sama zmiana;
-- naglowek DEFEKT/ZMIANA tamtego pliku dotyczy obu).
--
-- DEFEKT
--   1. `_event_rejection_refund_queue` (20260929113000:75-100) wstawia
--      zlecenie tylko dla odrzucenia; kazde inne zamkniecie oplaconego
--      zgloszenia (kaskada grupy, wplata z webhooka na odwolanym, reczny UPDATE)
--      nie zostawia sladu.
--   2. Straznik ponownego przyjecia (:102-123) i dzierzawa (:125-159) znaja
--      tylko zlecenia z zamowieniem; po 10 nieudanych probach zlecenie milknie
--      (`settle` :161-172 niczego nie zglasza).
--   3. `admin_event_refund_jobs` (:176-195) nie mowi, kto zamknal zgloszenie
--      ani dlaczego zwrot czeka; organizator nie ma jak zdecydowac.
--
-- ZMIANA
--   D. Siatka bezpieczenstwa: KAZDE przejscie oplaconego zgloszenia
--      w zamkniete zostawia co najmniej `needs_review`; zwrot oznaczony
--      recznie konczy tez zlecenie bez zamowienia; straznik ponownego
--      przyjecia i dzierzawa znaja zlecenia reczne i pochodzenie; ostateczna
--      porazka zwrotu dzwoni do organizatorow.
--   E. `admin_event_refund_jobs` oddaje pochodzenie, powod, kwote, termin
--      i notatke decyzji; nowe `admin_event_refund_job_decide`
--      (zwroc / oznacz zwrocone / nie zwracaj z notatka).
--
-- CZEGO TO NIE ZAMYKA. Zwrot czesci wspolnej wplaty grupy nadal robi sie
-- w panelu operatora (dziennik tylko zamyka zlecenie z notatka).
--
-- KOLEJNOSC WDROZENIA: po 20261012170000 (helpery dzwonka i oceny), przed
-- 20261012170100; NAJPIERW KOD (parser dziennika, powod zwrotu workera).
-- IDEMPOTENTNA: CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE TRIGGER,
-- bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_registration_cancel_refund_test.sql,
-- scripts/events-harness/runtime_test.d/24_cancel_refund_visibility.sql.
-- ============================================================================

-- D1) KOLEJKA ZWROTOW: ODRZUCENIE, SIATKA BEZPIECZENSTWA, ROZLICZENIE --------------
-- Cialo z 20260929113000:75-100. Zmiany (ZMIANA 20261012, REG-03):
--   (2) siatka bezpieczenstwa - KAZDE przejscie oplaconego zgloszenia
--       w zamkniete zostawia co najmniej `needs_review`: kaskada, wplata
--       z webhooka na odwolanym zgloszeniu, reczny UPDATE serwisu. Jawna
--       decyzja (C3) w tej samej transakcji podnosi wpis do swojej;
--   (3) zwrot oznaczony recznie (`refunded`) konczy takze zlecenie bez
--       zamowienia.
CREATE OR REPLACE FUNCTION public._event_rejection_refund_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- (1) Odrzucenie przez organizatora: zwrot automatyczny (bez zmian).
  IF NEW.status = 'rejected' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND NEW.payment_order_id IS NOT NULL
     AND (OLD.status <> 'rejected' OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    INSERT INTO public.event_registration_refund_jobs(tenant_id, event_id, payment_order_id, registration_id)
    SELECT NEW.tenant_id, NEW.event_id, o.id, NEW.id FROM public.payment_orders o
    WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
      AND o.metadata->>'event_id' = NEW.event_id::text
      AND o.metadata->>'registration_id' = COALESCE(NEW.group_lead_registration_id, NEW.id)::text
    ON CONFLICT (payment_order_id) DO UPDATE SET state = 'pending', last_error = NULL,
      next_attempt_at = now(), updated_at = now()
    WHERE event_registration_refund_jobs.state IN ('needs_review', 'cancelled');
  END IF;

  -- ZMIANA 20261012 (REG-03): (2) siatka bezpieczenstwa.
  IF NEW.status IN ('cancelled', 'rejected')
     AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND (OLD.status NOT IN ('cancelled', 'rejected')
          OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    IF NEW.payment_order_id IS NOT NULL THEN
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      SELECT NEW.tenant_id, NEW.event_id, o.id, NEW.id, 'needs_review',
             CASE WHEN NEW.status = 'rejected' THEN 'organizer_rejected' ELSE 'system' END,
             'closed_without_refund_decision'
        FROM public.payment_orders o
       WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
         AND o.status::text = 'paid'
         AND COALESCE(o.amount_cents, 0) - COALESCE(o.refunded_amount_cents, 0) > 0
      ON CONFLICT (payment_order_id) DO NOTHING;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.plan_ticket_claims c
       WHERE c.registration_id = NEW.id
          OR (NEW.group_lead_registration_id IS NOT NULL
              AND c.registration_id = NEW.group_lead_registration_id)
    ) THEN
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      VALUES (NEW.tenant_id, NEW.event_id, NULL, NEW.id, 'needs_review',
              CASE WHEN NEW.status = 'rejected' THEN 'organizer_rejected' ELSE 'system' END,
              'manual_payment')
      ON CONFLICT (registration_id) WHERE payment_order_id IS NULL DO NOTHING;
    END IF;
  END IF;

  IF NEW.payment_status = 'refunded' AND NEW.payment_order_id IS NOT NULL THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id = NEW.payment_order_id AND tenant_id = NEW.tenant_id;
  END IF;
  -- ZMIANA 20261012 (REG-03): (3) zlecenie bez zamowienia konczy reczne
  -- oznaczenie zwrotu na zgloszeniu.
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    UPDATE public.event_registration_refund_jobs SET state = 'completed', claim_token = NULL, updated_at = now()
    WHERE payment_order_id IS NULL AND registration_id = NEW.id AND tenant_id = NEW.tenant_id
      AND state <> 'completed';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_rejection_refund_queue() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_zz_refund_queue ON public.event_registrations;
CREATE TRIGGER event_registrations_zz_refund_queue AFTER UPDATE OF status, payment_status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_rejection_refund_queue();

COMMENT ON FUNCTION public._event_rejection_refund_queue() IS
  'Kolejka zwrotow (trigger AFTER UPDATE OF status, payment_status): odrzucenie oplaconego -> pending; KAZDE inne przejscie oplaconego zgloszenia w zamkniete -> co najmniej needs_review (closed_without_refund_decision, bez zamowienia: manual_payment) - jawna decyzja w tej samej transakcji podnosi wpis; payment_status refunded konczy zlecenie (po zamowieniu albo, bez zamowienia, po zgloszeniu).';

-- D2) PONOWNE PRZYJECIE: zlecenia reczne tez (cialo z 20260929113000:102-123).
CREATE OR REPLACE FUNCTION public._event_refund_reapproval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    -- ZMIANA 20261012 (REG-03): zlecenie bez zamowienia dopasowujemy po zgloszeniu.
    PERFORM 1 FROM public.event_registration_refund_jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND (j.payment_order_id = NEW.payment_order_id
           OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
    FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.event_registration_refund_jobs j
      WHERE j.tenant_id = NEW.tenant_id
        AND (j.payment_order_id = NEW.payment_order_id
             OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
        AND j.state IN ('processing', 'submitted')) THEN
      RAISE EXCEPTION 'invalid_transition: refund already in progress; create a new registration';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET state = 'cancelled', updated_at = now()
    WHERE j.tenant_id = NEW.tenant_id
      AND (j.payment_order_id = NEW.payment_order_id
           OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
      AND j.state IN ('pending', 'failed', 'needs_review');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_reapproval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_refund_reapproval ON public.event_registrations;
CREATE TRIGGER event_registrations_refund_reapproval BEFORE UPDATE OF status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_refund_reapproval_guard();

-- D3) DZIERZAWA (cialo z 20260929113000:125-159). ZMIANA 20261012 (REG-03):
-- jawny powod `shared_payment` i pochodzenie zlecenia w odpowiedzi (worker
-- dobiera powod zwrotu u operatora).
CREATE OR REPLACE FUNCTION public._event_registration_refunds_claim(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_jobs jsonb;
BEGIN
  UPDATE public.event_registration_refund_jobs j SET state = 'completed', claim_token = NULL, updated_at = now()
  FROM public.payment_orders o WHERE o.id = j.payment_order_id AND o.tenant_id = j.tenant_id
    AND o.status = 'refunded' AND j.state <> 'completed';
  -- Cases needing a partial allocation stay visible in the admin journal.
  UPDATE public.event_registration_refund_jobs j SET state = 'needs_review',
    review_reason = 'shared_payment',
    last_error = 'active_registrations_share_payment', updated_at = now()
  WHERE j.state IN ('pending', 'failed') AND EXISTS (
    SELECT 1 FROM public.event_registrations r WHERE r.payment_order_id = j.payment_order_id
      AND r.tenant_id = j.tenant_id AND r.status NOT IN ('cancelled', 'rejected'));
  WITH picked AS (
    SELECT j.id FROM public.event_registration_refund_jobs j
    WHERE j.payment_order_id IS NOT NULL
      AND ((j.state IN ('pending', 'failed') AND j.next_attempt_at <= now() AND j.attempts < 10)
       OR (j.state = 'processing' AND j.claimed_at < now() - interval '15 minutes'))
    ORDER BY j.created_at, j.id LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.event_registration_refund_jobs j SET state = 'processing',
      claim_token = gen_random_uuid(), claimed_at = clock_timestamp(), attempts = attempts + 1, updated_at = now()
    FROM picked p WHERE j.id = p.id RETURNING j.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', j.id, 'claim_token', j.claim_token, 'order_id', o.id, 'tenant_id', j.tenant_id,
    'environment', o.environment, 'provider', o.provider,
    'transaction_id', COALESCE(o.provider_payment_intent_id, o.provider_intent_id, o.provider_session_id),
    'order_status', o.status, 'origin', j.origin)), '[]'::jsonb) INTO v_jobs
  FROM claimed j JOIN public.payment_orders o ON o.id = j.payment_order_id AND o.tenant_id = j.tenant_id;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_claim(integer) TO service_role;

-- D4) ROZLICZENIE PROBY (cialo z 20260929113000:161-174). ZMIANA 20261012
-- (REG-03): ostatnia nieudana proba (dzierzawa pomija attempts >= 10) nie
-- milknie - zdarzenie na szynie i dzwonek do organizatorow.
CREATE OR REPLACE FUNCTION public._event_registration_refunds_settle(
  p_job_id uuid, p_claim_token uuid, p_refund_id text, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text;
  v_attempts integer;
  v_tenant uuid;
  v_event_id uuid;
  v_registration_id uuid;
  v_title_pl text;
  v_title_en text;
BEGIN
  UPDATE public.event_registration_refund_jobs SET
    state = CASE WHEN p_error IS NULL AND p_refund_id IS NOT NULL THEN 'submitted' ELSE 'failed' END,
    provider_refund_id = p_refund_id, last_error = left(p_error, 500), claim_token = NULL,
    next_attempt_at = now() + make_interval(mins => LEAST(1440, (power(2, LEAST(attempts, 10)))::integer)), updated_at = now()
  WHERE id = p_job_id AND claim_token = p_claim_token AND state = 'processing'
  RETURNING state, attempts, tenant_id, event_id, registration_id
    INTO v_state, v_attempts, v_tenant, v_event_id, v_registration_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_state = 'failed' AND v_attempts >= 10 THEN
    PERFORM public.emit_domain_event(
      v_tenant, 'event_registration', v_registration_id::text,
      'event.registration.refund_failed.v1',
      jsonb_build_object('event_id', v_event_id, 'job_id', p_job_id),
      NULL);
    SELECT e.title_pl, COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
      INTO v_title_pl, v_title_en
      FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant;
    PERFORM public._event_refund_alert_organizers(
      v_tenant, v_event_id,
      'Automatyczny zwrot nie powiódł się',
      'Automatic refund failed',
      format('%s: operator płatności odrzucił zwrot %s razy. Zdecyduj o zwrocie w dzienniku zwrotów.', '„' || v_title_pl || '”', v_attempts),
      format('"%s": the payment provider rejected the refund %s times. Decide on the refund in the refund journal.', v_title_en, v_attempts));
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_refunds_settle(uuid, uuid, text, text) TO service_role;

-- E1) DZIENNIK ZWROTOW W PANELU (cialo z 20260929113000:176-195). ZMIANA
-- 20261012 (REG-03): pochodzenie, powod przegladu, kwota, termin, notatka
-- decyzji i zgloszenie; `payment_order_id` moze byc NULL (wplata reczna).
CREATE OR REPLACE FUNCTION public.admin_event_refund_jobs(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_tenant uuid := public.assert_event_admin_tenant(); v_jobs jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(to_jsonb(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs FROM (
    SELECT j.id, j.registration_id, j.payment_order_id, j.state, j.attempts, j.created_at,
      j.next_attempt_at, j.last_error, j.origin, j.review_reason, j.amount_cents, j.currency,
      j.refund_deadline_at, j.review_note, j.decided_at,
      concat_ws(' ', p.first_name, p.last_name) AS person_name
    FROM public.event_registration_refund_jobs j
    JOIN public.event_registrations r ON r.id = j.registration_id AND r.tenant_id = j.tenant_id
    JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE j.tenant_id = v_tenant AND j.event_id = p_event_id
    ORDER BY j.created_at DESC, j.id DESC LIMIT 100
  ) j;
  RETURN v_jobs;
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_jobs(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_refund_jobs(uuid) IS
  'Dziennik zwrotow wydarzenia (ostatnie 100): stan, proby, pochodzenie, powod przegladu, kwota, termin, notatka decyzji, osoba. Bez dzierzawy workera (claim_token). Bramka: assert_event_admin_tenant().';

-- E2) DECYZJA ORGANIZATORA O ZLECENIU ----------------------------------------------
--   refund        - zlecenie w przegladzie (albo po ostatecznej porazce) wraca
--                   do kolejki operatora: tylko zamowienie Stripe `paid`,
--                   ktorego nie dzieli zadne aktywne zgloszenie;
--   mark_refunded - pieniadze oddane poza operatorem (wplata reczna albo inny
--                   operator): zgloszenie dostaje `refunded`, trigger konczy
--                   zlecenie;
--   dismiss       - bez zwrotu, z wymagana notatka (>= 3 znaki).
-- Zlecenie blokowane FOR UPDATE w najemcy wolajacego; najemca nigdy z ladunku.
CREATE OR REPLACE FUNCTION public.admin_event_refund_job_decide(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_action text := lower(btrim(COALESCE(p_payload->>'action', '')));
  v_note text := NULLIF(btrim(COALESCE(p_payload->>'note', '')), '');
  v_job public.event_registration_refund_jobs;
  v_order_status text;
  v_order_provider text;
  v_state text;
BEGIN
  v_job_id := CASE
    WHEN COALESCE(p_payload->>'job_id', '') ~ '^[0-9a-fA-F-]{36}$' THEN (p_payload->>'job_id')::uuid
  END;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: job_id is required';
  END IF;
  IF v_action NOT IN ('refund', 'mark_refunded', 'dismiss') THEN
    RAISE EXCEPTION 'invalid_action: unknown refund decision %', v_action;
  END IF;
  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long: at most 2000 characters';
  END IF;

  SELECT j.* INTO v_job
    FROM public.event_registration_refund_jobs j
   WHERE j.id = v_job_id AND j.tenant_id = v_tenant
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'not_found: refund job does not exist in this tenant';
  END IF;
  IF v_job.state NOT IN ('needs_review', 'failed') THEN
    RAISE EXCEPTION 'invalid_transition: refund job % cannot be %', v_job.state, v_action;
  END IF;

  IF v_job.payment_order_id IS NOT NULL THEN
    SELECT o.status::text, o.provider INTO v_order_status, v_order_provider
      FROM public.payment_orders o
     WHERE o.id = v_job.payment_order_id AND o.tenant_id = v_tenant;
  END IF;

  IF v_action = 'refund' THEN
    IF v_job.payment_order_id IS NULL OR v_order_provider IS DISTINCT FROM 'stripe' THEN
      RAISE EXCEPTION 'refund_manual_payment: this payment was taken outside the payment provider';
    END IF;
    IF v_order_status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'invalid_transition: payment % cannot be refunded', COALESCE(v_order_status, 'missing');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant
         AND r.payment_order_id = v_job.payment_order_id
         AND r.status NOT IN ('cancelled', 'rejected')
    ) THEN
      RAISE EXCEPTION 'refund_shared_payment: other active registrations share this payment';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      state = 'pending', review_reason = NULL, attempts = 0, claim_token = NULL,
      last_error = NULL, next_attempt_at = now(), requested_by = v_uid,
      review_note = COALESCE(v_note, j.review_note), decided_by = v_uid, decided_at = now(),
      updated_at = now()
    WHERE j.id = v_job.id;
    v_state := 'pending';

  ELSIF v_action = 'mark_refunded' THEN
    IF v_job.payment_order_id IS NOT NULL AND v_order_provider = 'stripe' THEN
      RAISE EXCEPTION 'invalid_transition: a provider payment is refunded through the provider';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      review_note = COALESCE(v_note, j.review_note), decided_by = v_uid, decided_at = now(),
      updated_at = now()
    WHERE j.id = v_job.id;
    -- Zgloszenie oznaczone jako zwrocone - trigger kolejki konczy zlecenie
    -- (po zamowieniu albo, bez zamowienia, po zgloszeniu).
    UPDATE public.event_registrations r SET
      payment_status = 'refunded',
      paid_at = NULL,
      updated_at = now()
    WHERE r.id = v_job.registration_id AND r.tenant_id = v_tenant
      AND r.payment_status IN ('paid', 'partially_refunded');
    -- Zgloszenie juz bez wplaty (np. oznaczone recznie wczesniej): konczymy
    -- zlecenie wprost.
    UPDATE public.event_registration_refund_jobs j SET state = 'completed', updated_at = now()
    WHERE j.id = v_job.id AND j.state <> 'completed';
    v_state := 'completed';

  ELSE
    IF v_note IS NULL OR char_length(v_note) < 3 THEN
      RAISE EXCEPTION 'reason_required: a note is required when no refund is made';
    END IF;
    UPDATE public.event_registration_refund_jobs j SET
      state = 'cancelled', review_reason = 'organizer_waived', claim_token = NULL,
      review_note = v_note, decided_by = v_uid, decided_at = now(), updated_at = now()
    WHERE j.id = v_job.id;
    v_state := 'cancelled';
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_job.registration_id::text,
    'event.registration.refund_requested.v1',
    jsonb_build_object('event_id', v_job.event_id, 'job_id', v_job.id, 'state', v_state,
                       'origin', v_job.origin, 'decision', v_action),
    v_uid);

  RETURN jsonb_build_object('job_id', v_job.id, 'state', v_state, 'action', v_action);
END $$;
REVOKE ALL ON FUNCTION public.admin_event_refund_job_decide(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_refund_job_decide(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_refund_job_decide(jsonb) IS
  'REG-03: decyzja organizatora o zleceniu zwrotu w przegladzie (needs_review albo failed): refund (zamowienie Stripe paid bez innych aktywnych zgloszen -> pending), mark_refunded (wplata poza operatorem -> zgloszenie refunded, zlecenie completed), dismiss (bez zwrotu, notatka >= 3 znaki). Najemca z assert_event_admin_tenant(), nigdy z ladunku.';