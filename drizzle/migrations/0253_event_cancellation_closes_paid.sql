CREATE OR REPLACE FUNCTION public._event_cancelled_event_close_paid(
  _tenant uuid,
  _event_id uuid,
  _actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_title_pl text;
  v_title_en text;
  v_ended boolean;
  v_reg_id uuid;
  v_assess jsonb;
  v_refund jsonb;
  v_closed integer := 0;
  v_queued integer := 0;
  v_review integer := 0;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('closed', 0, 'refunds_queued', 0, 'refunds_review', 0);
  END IF;

  SELECT e.status, e.starts_at, e.ends_at, e.title_pl,
         COALESCE(NULLIF(btrim(e.title_en), ''), e.title_pl)
    INTO v_status, v_starts, v_ends, v_title_pl, v_title_en
    FROM public.events e
   WHERE e.id = _event_id AND e.tenant_id = _tenant
   FOR UPDATE;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RETURN jsonb_build_object('closed', 0, 'refunds_queued', 0, 'refunds_review', 0);
  END IF;
  v_ended := now() >= public._event_effective_end(v_starts, v_ends);

  PERFORM 1 FROM public.event_ticket_types t
   WHERE t.tenant_id = _tenant AND t.event_id = _event_id
   ORDER BY t.id
   FOR UPDATE;

  FOR v_reg_id IN
    SELECT r.id
      FROM public.event_registrations r
     WHERE r.tenant_id = _tenant
       AND r.event_id = _event_id
       AND r.status IN ('draft', 'pending', 'waitlist', 'approved')
       AND r.payment_status IN ('paid', 'partially_refunded')
     ORDER BY (r.group_lead_registration_id IS NOT NULL), r.created_at, r.id
  LOOP
    PERFORM 1 FROM public.event_registrations r
     WHERE r.id = v_reg_id AND r.tenant_id = _tenant
       AND r.status IN ('draft', 'pending', 'waitlist', 'approved')
       AND r.payment_status IN ('paid', 'partially_refunded')
     FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_assess := public._event_registration_refund_assess(_tenant, v_reg_id, 'organizer_cancelled', now());
    IF v_ended AND v_assess->>'job_state' = 'pending' THEN
      v_assess := v_assess || jsonb_build_object(
        'job_state', 'needs_review',
        'review_reason', 'closed_without_refund_decision');
    END IF;

    UPDATE public.event_registrations r
       SET status = 'cancelled',
           cancelled_at = now(),
           waitlist_position = NULL,
           decided_by = _actor,
           decided_at = now(),
           decision_source = CASE WHEN _actor IS NULL THEN 'system' ELSE 'organizer' END,
           qr_token_hash = NULL,
           qr_issued_at = NULL
     WHERE r.id = v_reg_id AND r.tenant_id = _tenant;

    PERFORM public.emit_domain_event(
      _tenant,
      'event_registration',
      v_reg_id::text,
      'event.registration.cancelled.v1',
      jsonb_build_object('event_id', _event_id, 'by', 'event_cancelled',
                         'refund_effect', v_assess->>'effect'),
      _actor
    );

    v_refund := public._event_registration_cancel_refund(
      _tenant, v_reg_id, 'organizer_cancelled', _actor, v_assess);

    v_closed := v_closed + 1;
    IF v_refund->>'job_state' = 'pending' THEN
      v_queued := v_queued + 1;
    ELSIF v_refund->>'job_state' = 'needs_review' THEN
      v_review := v_review + 1;
    END IF;
  END LOOP;

  IF v_closed > 0 THEN
    PERFORM public._event_refund_alert_organizers(
      _tenant, _event_id,
      'Odwołane wydarzenie: opłacone zgłoszenia zamknięte',
      'Event cancelled: paid registrations closed',
      format('%s: zamknięto opłaconych zgłoszeń: %s. Zwroty zlecone automatycznie: %s, czekające na decyzję w dzienniku zwrotów: %s.',
             '„' || v_title_pl || '”', v_closed, v_queued, v_review),
      format('"%s": paid registrations closed: %s. Refunds queued automatically: %s, waiting for a decision in the refund journal: %s.',
             v_title_en, v_closed, v_queued, v_review));
  END IF;

  RETURN jsonb_build_object('closed', v_closed, 'refunds_queued', v_queued, 'refunds_review', v_review);
END $$;

REVOKE ALL ON FUNCTION public._event_cancelled_event_close_paid(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_cancelled_event_close_paid(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_cancelled_event_close_paid(uuid, uuid, uuid) IS
  'REG-03 (R45): zamyka OTWARTE oplacone (paid/partially_refunded) zgloszenia ODWOLANEGO wydarzenia: blokady wydarzenie -> bilety -> zgloszenie, ocena organizer_cancelled (pelny zwrot), status cancelled bez QR, zlecenie przez _event_registration_cancel_refund; po efektywnym koncu wydarzenia zlecenie w przegladzie (closed_without_refund_decision). Prowadzacy przed goscmi, jeden zbiorczy dzwonek, bez awansu. Wydarzenie nieodwolane -> nic. Idempotentna. {closed, refunds_queued, refunds_review}. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public._tg_event_cancelled_closes_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public._event_cancelled_event_close_paid(NEW.tenant_id, NEW.id, auth.uid());
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public._tg_event_cancelled_closes_paid() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_zz_cancelled_closes_paid ON public.events;
CREATE TRIGGER events_zz_cancelled_closes_paid
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public._tg_event_cancelled_closes_paid();

COMMENT ON FUNCTION public._tg_event_cancelled_closes_paid() IS
  'REG-03 (R45): trigger AFTER UPDATE OF status na events - przejscie W cancelled (RPC admin_event_set_status, UPDATE panelu, rola serwisowa) zamyka oplacone zgloszenia ze zwrotem (_event_cancelled_event_close_paid). Bledu nie polyka.';

CREATE OR REPLACE FUNCTION public._tg_events_delete_keeps_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.event_registrations r
        WHERE r.tenant_id = OLD.tenant_id
          AND r.event_id = OLD.id
          AND r.payment_status IN ('paid', 'partially_refunded'))
     OR EXISTS (
       SELECT 1 FROM public.event_registration_refund_jobs j
        WHERE j.tenant_id = OLD.tenant_id
          AND j.event_id = OLD.id) THEN
    RAISE EXCEPTION 'event_has_payments: this event has paid registrations or refund history - cancel the event instead of deleting it';
  END IF;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public._tg_events_delete_keeps_payments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS events_00_delete_keeps_payments ON public.events;
CREATE TRIGGER events_00_delete_keeps_payments
  BEFORE DELETE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_events_delete_keeps_payments();

COMMENT ON FUNCTION public._tg_events_delete_keeps_payments() IS
  'REG-03 (R45): trigger BEFORE DELETE na events - wydarzenie z oplaconym zgloszeniem (paid/partially_refunded) albo z jakimkolwiek zleceniem zwrotu -> event_has_payments (odwolaj zamiast usuwac). Kaskada z usuniecia najemcy (pg_trigger_depth() > 1) przechodzi.';