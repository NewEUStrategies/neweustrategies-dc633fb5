CREATE OR REPLACE FUNCTION public._event_rejection_refund_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_payer uuid := COALESCE(NEW.group_lead_registration_id, NEW.id);
  v_shared boolean;
BEGIN
  IF NEW.status = 'rejected' AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND NEW.payment_order_id IS NOT NULL
     AND (OLD.status <> 'rejected' OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    v_shared := EXISTS (
      SELECT 1 FROM public.event_registrations x
       WHERE x.tenant_id = NEW.tenant_id
         AND x.payment_order_id = NEW.payment_order_id
         AND x.id <> NEW.id
         AND x.status NOT IN ('cancelled', 'rejected'));
    INSERT INTO public.event_registration_refund_jobs(
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
    SELECT NEW.tenant_id, NEW.event_id, o.id,
           CASE WHEN v_shared THEN NEW.id ELSE v_payer END,
           CASE WHEN v_shared THEN 'needs_review' ELSE 'pending' END,
           'organizer_rejected',
           CASE WHEN v_shared THEN 'shared_payment' END
      FROM public.payment_orders o
     WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
       AND o.metadata->>'event_id' = NEW.event_id::text
       AND o.metadata->>'registration_id' = v_payer::text
    ON CONFLICT (payment_order_id) DO UPDATE SET
      registration_id = EXCLUDED.registration_id,
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
    WHERE event_registration_refund_jobs.state IN ('needs_review', 'cancelled');
  END IF;

  IF NEW.status IN ('cancelled', 'rejected')
     AND NEW.payment_status IN ('paid', 'partially_refunded')
     AND (OLD.status NOT IN ('cancelled', 'rejected')
          OR OLD.payment_status NOT IN ('paid', 'partially_refunded')) THEN
    IF NEW.payment_order_id IS NOT NULL THEN
      v_shared := EXISTS (
        SELECT 1 FROM public.event_registrations x
         WHERE x.tenant_id = NEW.tenant_id
           AND x.payment_order_id = NEW.payment_order_id
           AND x.id <> NEW.id
           AND x.status NOT IN ('cancelled', 'rejected'));
      INSERT INTO public.event_registration_refund_jobs(
        tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason)
      SELECT NEW.tenant_id, NEW.event_id, o.id,
             CASE WHEN NOT v_shared AND o.metadata->>'registration_id' = v_payer::text
                  THEN v_payer ELSE NEW.id END,
             'needs_review',
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
    UPDATE public.event_registration_refund_jobs j
       SET state = 'completed', claim_token = NULL, updated_at = now()
     WHERE j.payment_order_id = NEW.payment_order_id AND j.tenant_id = NEW.tenant_id
       AND (j.registration_id = NEW.id
            OR EXISTS (
              SELECT 1 FROM public.payment_orders o
               WHERE o.id = NEW.payment_order_id AND o.tenant_id = NEW.tenant_id
                 AND (o.status::text = 'refunded'
                      OR (COALESCE(o.amount_cents, 0) > 0
                          AND COALESCE(o.refunded_amount_cents, 0) >= o.amount_cents))));
  END IF;
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
  'Kolejka zwrotow (trigger AFTER UPDATE OF status, payment_status): odrzucenie oplaconego -> pending na platniku zamowienia, a przy wspolnej wplacie z innym aktywnym zgloszeniem needs_review/shared_payment (R45); KAZDE inne przejscie oplaconego zgloszenia w zamkniete -> co najmniej needs_review (closed_without_refund_decision, bez zamowienia: manual_payment; zlecenie platnika, gdy nikt aktywny nie dzieli wplaty) - jawna decyzja w tej samej transakcji podnosi wpis; refunded konczy zlecenie z zamowieniem tylko przy zwroconym zamowieniu albo na zgloszeniu zlecenia (R45), bez zamowienia - po zgloszeniu.';

CREATE OR REPLACE FUNCTION public._event_refund_reapproval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('cancelled', 'rejected') AND NEW.status NOT IN ('cancelled', 'rejected') THEN
    PERFORM 1 FROM public.event_registration_refund_jobs j
    WHERE j.tenant_id = NEW.tenant_id
      AND (j.payment_order_id = NEW.payment_order_id
           OR (j.payment_order_id IS NULL AND j.registration_id = NEW.id))
    ORDER BY j.id
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
      AND j.registration_id = NEW.id
      AND (j.payment_order_id IS NULL OR j.payment_order_id = NEW.payment_order_id)
      AND j.state IN ('pending', 'failed', 'needs_review');

    UPDATE public.event_registration_refund_jobs j SET
      state = 'needs_review',
      review_reason = 'shared_payment',
      last_error = 'active_registrations_share_payment',
      claim_token = NULL,
      updated_at = now()
    WHERE j.tenant_id = NEW.tenant_id
      AND j.payment_order_id = NEW.payment_order_id
      AND j.registration_id IS DISTINCT FROM NEW.id
      AND j.state IN ('pending', 'failed', 'needs_review');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._event_refund_reapproval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_registrations_refund_reapproval ON public.event_registrations;
CREATE TRIGGER event_registrations_refund_reapproval BEFORE UPDATE OF status
ON public.event_registrations FOR EACH ROW EXECUTE FUNCTION public._event_refund_reapproval_guard();

COMMENT ON FUNCTION public._event_refund_reapproval_guard() IS
  'REG-03 (R45): straznik ponownego przyjecia (BEFORE UPDATE OF status, z cancelled/rejected do otwartego): zlecenie w drodze (processing/submitted) na wplacie -> invalid_transition; zlecenie TEGO zgloszenia (pending/failed/needs_review) -> cancelled; zlecenie INNEGO zgloszenia na tej samej wplacie -> needs_review/shared_payment.';

CREATE OR REPLACE FUNCTION public._event_registration_cancel_refund(
  _tenant uuid,
  _registration_id uuid,
  _origin text,
  _actor uuid,
  _assessment jsonb,
  _waive boolean DEFAULT false,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_state text := NULLIF(_assessment->>'job_state', '');
  v_reason text := NULLIF(_assessment->>'review_reason', '');
  v_order uuid := NULLIF(_assessment->>'payment_order_id', '')::uuid;
  v_note text := NULLIF(btrim(COALESCE(_note, '')), '');
  v_waive boolean := COALESCE(_waive, false);
  v_event_id uuid;
  v_title_pl text;
  v_title_en text;
  v_job_id uuid;
  v_job_state text;
  v_why_pl text;
  v_why_en text;
BEGIN
  IF _origin IS NULL OR _origin NOT IN ('participant_cancelled', 'organizer_cancelled') THEN
    RAISE EXCEPTION 'invalid_payload: refund origin must be participant_cancelled or organizer_cancelled';
  END IF;
  IF v_state IS NULL THEN
    RETURN _assessment || jsonb_build_object('job_id', NULL);
  END IF;
  IF v_waive THEN
    IF _origin <> 'organizer_cancelled' THEN
      RAISE EXCEPTION 'invalid_payload: only the organizer can waive a refund';
    END IF;
    v_state := 'cancelled';
    v_reason := 'organizer_waived';
  END IF;

  SELECT r.event_id, e.title_pl, COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
    INTO v_event_id, v_title_pl, v_title_en
    FROM public.event_registrations r
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
   WHERE r.id = _registration_id AND r.tenant_id = _tenant;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  IF v_order IS NOT NULL THEN
    INSERT INTO public.event_registration_refund_jobs AS j (
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason,
      refund_deadline_at, amount_cents, currency, requested_by, review_note, decided_by, decided_at)
    VALUES (
      _tenant, v_event_id, v_order, _registration_id, v_state, _origin, v_reason,
      NULLIF(_assessment->>'refund_deadline_at', '')::timestamptz,
      NULLIF(_assessment->>'amount_cents', '')::integer,
      NULLIF(_assessment->>'currency', ''),
      _actor, v_note,
      CASE WHEN v_state = 'cancelled' THEN _actor END,
      CASE WHEN v_state = 'cancelled' THEN now() END)
    ON CONFLICT (payment_order_id) DO UPDATE SET
      registration_id = EXCLUDED.registration_id,
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      refund_deadline_at = EXCLUDED.refund_deadline_at,
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      requested_by = EXCLUDED.requested_by,
      review_note = EXCLUDED.review_note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      attempts = 0,
      claim_token = NULL,
      last_error = NULL,
      next_attempt_at = now(),
      updated_at = now()
    WHERE j.state IN ('needs_review', 'cancelled')
       OR (v_waive AND j.state IN ('pending', 'failed'))
    RETURNING j.id, j.state INTO v_job_id, v_job_state;

    IF v_job_id IS NULL THEN
      SELECT j.id, j.state INTO v_job_id, v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.payment_order_id = v_order AND j.tenant_id = _tenant;
    END IF;
  ELSE
    INSERT INTO public.event_registration_refund_jobs AS j (
      tenant_id, event_id, payment_order_id, registration_id, state, origin, review_reason,
      refund_deadline_at, amount_cents, currency, requested_by, review_note, decided_by, decided_at)
    VALUES (
      _tenant, v_event_id, NULL, _registration_id,
      CASE WHEN v_state = 'cancelled' THEN 'cancelled' ELSE 'needs_review' END,
      _origin, COALESCE(v_reason, 'manual_payment'),
      NULLIF(_assessment->>'refund_deadline_at', '')::timestamptz,
      NULL, NULL, _actor, v_note,
      CASE WHEN v_state = 'cancelled' THEN _actor END,
      CASE WHEN v_state = 'cancelled' THEN now() END)
    ON CONFLICT (registration_id) WHERE payment_order_id IS NULL DO UPDATE SET
      state = EXCLUDED.state,
      origin = EXCLUDED.origin,
      review_reason = EXCLUDED.review_reason,
      refund_deadline_at = EXCLUDED.refund_deadline_at,
      requested_by = EXCLUDED.requested_by,
      review_note = EXCLUDED.review_note,
      decided_by = EXCLUDED.decided_by,
      decided_at = EXCLUDED.decided_at,
      last_error = NULL,
      updated_at = now()
    WHERE j.state IN ('needs_review', 'cancelled')
    RETURNING j.id, j.state INTO v_job_id, v_job_state;

    IF v_job_id IS NULL THEN
      SELECT j.id, j.state INTO v_job_id, v_job_state
        FROM public.event_registration_refund_jobs j
       WHERE j.registration_id = _registration_id
         AND j.payment_order_id IS NULL
         AND j.tenant_id = _tenant;
    END IF;
  END IF;

  PERFORM public.emit_domain_event(
    _tenant,
    'event_registration',
    _registration_id::text,
    'event.registration.refund_requested.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'job_id', v_job_id,
      'state', v_job_state,
      'origin', _origin,
      'review_reason', v_reason),
    _actor);

  IF _origin = 'participant_cancelled' THEN
    IF v_job_state = 'pending' THEN
      PERFORM public._event_refund_alert_organizers(
        _tenant, v_event_id,
        'Rezygnacja z opłaconego biletu: zwrot zlecony',
        'Paid ticket cancelled: refund queued',
        format('%s: uczestnik zrezygnował w terminie zwrotu, zwrot trafił do operatora płatności. Szczegóły w dzienniku zwrotów.', '„' || v_title_pl || '”'),
        format('"%s": a participant cancelled within the refund window and the refund went to the payment provider. Details in the refund journal.', v_title_en));
    ELSIF v_job_state = 'needs_review' THEN
      v_why_pl := CASE v_reason
        WHEN 'outside_refund_window' THEN 'po terminie zwrotu'
        WHEN 'refund_disabled' THEN 'wydarzenie nie ma samodzielnych zwrotów'
        WHEN 'shared_payment' THEN 'wpłata obejmuje inne aktywne zgłoszenia'
        WHEN 'manual_payment' THEN 'wpłata poza operatorem płatności'
        ELSE 'zamknięcie bez decyzji o zwrocie'
      END;
      v_why_en := CASE v_reason
        WHEN 'outside_refund_window' THEN 'after the refund deadline'
        WHEN 'refund_disabled' THEN 'the event has no self-service refunds'
        WHEN 'shared_payment' THEN 'the payment covers other active registrations'
        WHEN 'manual_payment' THEN 'paid outside the payment provider'
        ELSE 'closed without a refund decision'
      END;
      PERFORM public._event_refund_alert_organizers(
        _tenant, v_event_id,
        'Rezygnacja z opłaconego biletu: zwrot czeka na decyzję',
        'Paid ticket cancelled: refund needs a decision',
        format('%s: uczestnik zrezygnował (%s). Zdecyduj o zwrocie w dzienniku zwrotów.', '„' || v_title_pl || '”', v_why_pl),
        format('"%s": a participant cancelled (%s). Decide on the refund in the refund journal.', v_title_en, v_why_en));
    END IF;
  END IF;

  RETURN _assessment || jsonb_build_object('job_id', v_job_id, 'job_state', v_job_state,
                                           'review_reason', v_reason);
END $$;
REVOKE ALL ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public._event_registration_cancel_refund(uuid, uuid, text, uuid, jsonb, boolean, text) IS
  'REG-03: zapis zlecenia zwrotu po zamknieciu zgloszenia wedlug oceny _event_registration_refund_assess (pending albo needs_review; _waive = cancelled/organizer_waived, tylko organizator - zdejmuje takze zlecenie pending/failed, R45). Podnosi needs_review/cancelled z siatki bezpieczenstwa, nie rusza zlecenia w drodze ani zakonczonego. Emituje event.registration.refund_requested.v1; przy rezygnacji uczestnika dzwoni do organizatorow. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';