CREATE OR REPLACE FUNCTION public._event_ticket_floor_cents(p_tenant uuid, p_ticket_type_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT LEAST(
    t.price_cents,
    COALESCE(t.early_bird_price_cents, t.price_cents),
    COALESCE((
      SELECT min((e.value->>'price_cents')::integer)
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(t.price_schedule) = 'array' THEN t.price_schedule ELSE '[]'::jsonb END
      ) AS e
      WHERE jsonb_typeof(e.value) = 'object'
        AND COALESCE(e.value->>'price_cents', '') ~ '^[0-9]{1,9}$'
    ), t.price_cents)
  )
  FROM public.event_ticket_types t
  WHERE t.id = p_ticket_type_id AND t.tenant_id = p_tenant;
$$;
REVOKE ALL ON FUNCTION public._event_ticket_floor_cents(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_floor_cents(uuid, uuid) TO service_role;
CREATE OR REPLACE FUNCTION public._event_ticket_order_mismatch(
  p_order public.payment_orders,
  p_reg public.event_registrations,
  p_check_amount boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_meta jsonb := COALESCE(p_order.metadata, '{}'::jsonb);
  v_order_ticket uuid;
  v_ticket uuid;
  v_ticket_event uuid;
  v_ticket_currency text;
  v_floor bigint;
  v_qty integer;
  v_paid bigint;
  v_required bigint;
BEGIN
  IF p_order.user_id IS NULL OR p_reg.id IS NULL THEN
    RETURN 'registration_not_owned';
  END IF;
  IF p_reg.created_by IS DISTINCT FROM p_order.user_id AND NOT EXISTS (
    SELECT 1 FROM public.event_people pe
    WHERE pe.id = p_reg.person_id AND pe.tenant_id = p_reg.tenant_id
      AND pe.user_id = p_order.user_id
  ) THEN
    RETURN 'registration_not_owned';
  END IF;
  v_order_ticket := CASE
    WHEN COALESCE(v_meta->>'ticket_type_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_meta->>'ticket_type_id')::uuid
  END;
  IF v_order_ticket IS NOT NULL AND p_reg.ticket_type_id IS NOT NULL
     AND v_order_ticket <> p_reg.ticket_type_id THEN
    RETURN 'ticket_mismatch';
  END IF;
  IF NOT p_check_amount THEN
    RETURN NULL;
  END IF;
  v_ticket := COALESCE(v_order_ticket, p_reg.ticket_type_id);
  IF v_ticket IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT t.event_id, t.currency INTO v_ticket_event, v_ticket_currency
  FROM public.event_ticket_types t
  WHERE t.id = v_ticket AND t.tenant_id = p_reg.tenant_id;
  IF v_ticket_event IS NULL OR v_ticket_event <> p_reg.event_id THEN
    RETURN 'ticket_mismatch';
  END IF;
  IF upper(COALESCE(p_order.currency, '')) <> upper(COALESCE(v_ticket_currency, 'PLN')) THEN
    RETURN 'currency_mismatch';
  END IF;
  v_floor := COALESCE(public._event_ticket_floor_cents(p_reg.tenant_id, v_ticket), 0);
  v_qty := CASE
    WHEN COALESCE(v_meta->>'quantity', '') ~ '^[0-9]{1,4}$'
      THEN GREATEST((v_meta->>'quantity')::integer, 1)
    ELSE 1
  END;
  v_paid := COALESCE(p_order.amount_cents, 0)::bigint
          + CASE WHEN COALESCE(v_meta->>'coupon_discount_cents', '') ~ '^[0-9]{1,9}$'
                 THEN (v_meta->>'coupon_discount_cents')::bigint ELSE 0 END;
  v_required := v_floor * (v_qty - CASE WHEN v_meta ? 'plan_benefit' THEN 1 ELSE 0 END);
  IF v_paid < v_required THEN
    RETURN 'amount_mismatch';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_order_mismatch(public.payment_orders, public.event_registrations, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_order_mismatch(public.payment_orders, public.event_registrations, boolean)
  TO service_role;
COMMENT ON FUNCTION public._event_ticket_order_mismatch(public.payment_orders, public.event_registrations, boolean) IS
  'Czy zamowienie moze rozliczyc zgloszenie: wlasciciel (osoba albo zakladajacy), bilet, waluta i kwota co najmniej najnizsza cena biletu x miejsca (TIX-01). NULL = tak, inaczej powod odmowy.';
CREATE OR REPLACE FUNCTION public._event_ticket_payment_refused(
  p_order public.payment_orders,
  p_event_id uuid,
  p_registration_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg uuid;
BEGIN
  UPDATE public.payment_orders o SET
    metadata = COALESCE(o.metadata, '{}'::jsonb) || jsonb_build_object(
      'needs_manual_review', true,
      'ticket_refusal', jsonb_build_object(
        'reason', p_reason,
        'registration_id', p_registration_id,
        'at', now()
      )
    ),
    updated_at = now()
  WHERE o.id = p_order.id AND o.tenant_id = p_order.tenant_id
    AND NOT (COALESCE(o.metadata, '{}'::jsonb) ? 'ticket_refusal');
  IF p_registration_id IS NOT NULL AND p_event_id IS NOT NULL THEN
    SELECT r.id INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = p_registration_id AND r.tenant_id = p_order.tenant_id AND r.event_id = p_event_id;
  END IF;
  IF v_reg IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.event_registration_refund_jobs (tenant_id, event_id, payment_order_id, registration_id)
  VALUES (p_order.tenant_id, p_event_id, p_order.id, v_reg)
  ON CONFLICT (payment_order_id) DO NOTHING;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._event_ticket_payment_refused(public.payment_orders, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_payment_refused(public.payment_orders, uuid, uuid, text)
  TO service_role;
CREATE OR REPLACE FUNCTION public._event_ticket_refusal_payload(
  p_order public.payment_orders,
  p_event_id uuid,
  p_registration_id uuid,
  p_reason text,
  p_refund_queued boolean,
  p_outcome text,
  p_refunded integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'applied', false,
    'refused', true,
    'reason', p_reason,
    'refund_queued', COALESCE(p_refund_queued, false),
    'registration_id', p_registration_id,
    'order_id', p_order.id,
    'outcome', p_outcome,
    'refunded_cents', p_refunded,
    'amount_cents', p_order.amount_cents,
    'currency', p_order.currency,
    'tenant_id', p_order.tenant_id,
    'event_id', p_event_id,
    'event_title_pl', e.title_pl,
    'event_title_en', e.title_en,
    'event_slug', e.slug,
    'contact', jsonb_build_object('user_id', p_order.user_id)
  )
  FROM (SELECT 1) AS one
  LEFT JOIN public.events e ON e.id = p_event_id AND e.tenant_id = p_order.tenant_id;
$$;
REVOKE ALL ON FUNCTION public._event_ticket_refusal_payload(public.payment_orders, uuid, uuid, text, boolean, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_refusal_payload(public.payment_orders, uuid, uuid, text, boolean, text, integer)
  TO service_role;
CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(p_order_id uuid, p_outcome text, p_refunded_cents integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders;
  v_event_id uuid;
  v_ticket_type_id uuid;
  v_registration_hint uuid;
  v_person_id uuid;
  v_reg public.event_registrations;
  v_reg_id uuid;
  v_seat_ticket uuid;
  v_token text;
  v_promoted jsonb := jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  v_effective text;
  v_refunded integer;
  v_person public.event_people;
  v_event public.events;
  v_next_status text;
  v_admitted boolean;
  v_queued boolean;
  v_position integer;
  v_newly_settled boolean := false;
  v_final public.event_registrations;
  v_mismatch text;
  v_refund_queued boolean;
BEGIN
  IF p_outcome NOT IN ('paid','unpaid','refunded','partial_refund') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;
  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;
  v_effective := p_outcome;
  v_refunded := COALESCE(v_order.refunded_amount_cents, 0);
  IF p_outcome IN ('refunded','partial_refund') THEN
    IF p_refunded_cents IS NOT NULL AND p_refunded_cents > v_refunded THEN
      v_refunded := p_refunded_cents;
    ELSIF p_outcome = 'refunded' AND p_refunded_cents IS NULL THEN
      v_refunded := GREATEST(v_refunded, COALESCE(v_order.amount_cents, 0));
    END IF;
    UPDATE public.payment_orders o
    SET refunded_amount_cents = v_refunded,
        updated_at = now()
    WHERE o.id = v_order.id;
    IF COALESCE(v_order.amount_cents, 0) > 0 AND v_refunded >= v_order.amount_cents THEN
      v_effective := 'refunded';
    ELSIF p_outcome = 'partial_refund' THEN
      v_effective := 'partial_refund';
    END IF;
  END IF;
  v_event_id := CASE
    WHEN COALESCE(v_order.metadata->>'event_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'event_id')::uuid
  END;
  v_ticket_type_id := CASE
    WHEN COALESCE(v_order.metadata->>'ticket_type_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'ticket_type_id')::uuid
  END;
  v_registration_hint := CASE
    WHEN COALESCE(v_order.metadata->>'registration_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'registration_id')::uuid
    ELSE NULL
  END;
  IF v_event_id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_a_ticket_order',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;
  IF v_registration_hint IS NOT NULL THEN
    SELECT r.id, r.ticket_type_id INTO v_reg_id, v_seat_ticket
    FROM public.event_registrations r
    WHERE r.id = v_registration_hint
      AND r.tenant_id = v_order.tenant_id
      AND r.event_id = v_event_id;
    IF v_reg_id IS NULL THEN
      IF v_effective = 'paid' THEN
        v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, NULL, 'registration_mismatch');
        RETURN public._event_ticket_refusal_payload(v_order, v_event_id, v_registration_hint,
          'registration_mismatch', v_refund_queued, v_effective, v_refunded);
      END IF;
      RETURN jsonb_build_object('applied', false, 'reason', 'registration_mismatch',
                                'registration_id', v_registration_hint,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;
  ELSE
    SELECT p.id INTO v_person_id
    FROM public.event_people p
    WHERE p.tenant_id = v_order.tenant_id AND p.user_id = v_order.user_id
    LIMIT 1;
    SELECT r.id, r.ticket_type_id INTO v_reg_id, v_seat_ticket
    FROM public.event_registrations r
    WHERE r.tenant_id = v_order.tenant_id
      AND r.event_id = v_event_id
      AND (
        r.payment_order_id = v_order.id
        OR (v_person_id IS NOT NULL AND r.person_id = v_person_id)
      )
    ORDER BY (r.payment_order_id = v_order.id) DESC, r.created_at DESC
    LIMIT 1;
  END IF;
  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;
  IF v_effective = 'paid' THEN
    PERFORM 1 FROM public.events e
    WHERE e.id = v_event_id AND e.tenant_id = v_order.tenant_id
    FOR UPDATE;
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = COALESCE(v_ticket_type_id, v_seat_ticket) AND t.tenant_id = v_order.tenant_id
    FOR UPDATE;
  END IF;
  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_reg_id AND r.tenant_id = v_order.tenant_id
  FOR UPDATE;
  IF v_effective IN ('paid', 'unpaid')
     AND v_reg.payment_order_id IS DISTINCT FROM v_order.id THEN
    v_mismatch := public._event_ticket_order_mismatch(v_order, v_reg, v_effective = 'paid');
    IF v_mismatch IS NOT NULL THEN
      IF v_registration_hint IS NULL THEN
        RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                                  'skipped_registration_id', v_reg.id,
                                  'skipped_reason', v_mismatch,
                                  'outcome', v_effective, 'refunded_cents', v_refunded);
      END IF;
      IF v_effective = 'paid' THEN
        v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, v_reg.id, v_mismatch);
        RETURN public._event_ticket_refusal_payload(v_order, v_event_id, v_reg.id,
          v_mismatch, v_refund_queued, v_effective, v_refunded);
      END IF;
      RETURN jsonb_build_object('applied', false, 'reason', v_mismatch,
                                'registration_id', v_reg.id,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
    END IF;
  END IF;
  IF v_effective = 'paid' THEN
    IF v_reg.payment_status = 'paid'
       AND v_reg.payment_order_id IS NOT NULL
       AND v_reg.payment_order_id <> v_order.id THEN
      v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, v_reg.id,
        'already_settled_by_another_order');
      RETURN public._event_ticket_refusal_payload(v_order, v_event_id, v_reg.id,
          'already_settled_by_another_order', v_refund_queued, v_effective, v_refunded)
        || jsonb_build_object('payment_order_id', v_reg.payment_order_id);
    END IF;
    v_seat_ticket := COALESCE(v_ticket_type_id, v_reg.ticket_type_id);
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = v_seat_ticket AND t.tenant_id = v_order.tenant_id
    FOR UPDATE;
    v_newly_settled := v_reg.payment_status <> 'paid';
    v_next_status := public._event_registration_paid_admission(v_reg, v_seat_ticket);
    v_admitted := v_next_status IN ('approved', 'attended');
    v_queued := v_next_status = 'waitlist' AND v_reg.status <> 'waitlist';
    v_position := CASE
      WHEN v_next_status <> 'waitlist' THEN NULL
      WHEN v_reg.status = 'waitlist' THEN v_reg.waitlist_position
      ELSE public._event_next_waitlist_position(v_order.tenant_id, v_event_id)
    END;
    v_token := CASE WHEN v_admitted THEN public._event_new_qr_token() END;
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        ticket_type_id = CASE
          WHEN r.status IN ('approved', 'attended', 'no_show') THEN r.ticket_type_id
          ELSE v_seat_ticket
        END,
        status = v_next_status,
        waitlist_position = v_position,
        cancelled_at = CASE
          WHEN r.status IN ('draft','pending','waitlist') THEN NULL
          ELSE r.cancelled_at
        END,
        decided_by = CASE WHEN v_queued THEN NULL ELSE r.decided_by END,
        decided_at = CASE
          WHEN v_queued THEN now()
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN r.decided_at
          ELSE COALESCE(r.decided_at, now())
        END,
        decision_source = CASE
          WHEN v_queued THEN 'capacity'
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN r.decision_source
          ELSE COALESCE(r.decision_source, 'system')
        END,
        qr_token_hash = CASE
          WHEN v_admitted THEN COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex'))
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN NULL
          ELSE r.qr_token_hash
        END,
        qr_issued_at = CASE
          WHEN v_admitted THEN COALESCE(r.qr_issued_at, now())
          WHEN v_next_status IN ('draft', 'pending', 'waitlist') THEN NULL
          ELSE r.qr_issued_at
        END,
        updated_at = now()
    WHERE r.id = v_reg.id;
    IF v_next_status IN ('cancelled', 'rejected') AND v_newly_settled THEN
      v_refund_queued := public._event_ticket_payment_refused(v_order, v_event_id, v_reg.id,
        'registration_closed');
    END IF;
  ELSIF v_effective = 'unpaid' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'unpaid',
        updated_at = now()
    WHERE r.id = v_reg.id AND r.payment_status <> 'paid';
    PERFORM public._event_plan_seat_settle(v_reg.id, v_order.id);
  ELSIF v_effective IN ('partial_refund', 'refunded')
        AND v_reg.payment_order_id IS DISTINCT FROM v_order.id THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'refund_for_other_order',
                              'registration_id', v_reg.id,
                              'payment_order_id', v_reg.payment_order_id,
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  ELSIF v_effective = 'partial_refund' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'partially_refunded',
        updated_at = now()
    WHERE r.id = v_reg.id;
  ELSE
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'refunded',
        paid_at = NULL,
        status = 'cancelled',
        cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = NULL,
        qr_issued_at = NULL,
        updated_at = now()
    WHERE r.id = v_reg.id;
    v_promoted := public._event_waitlist_promote(
      v_order.tenant_id, v_event_id, COALESCE(v_ticket_type_id, v_reg.ticket_type_id), 1);
    PERFORM public._event_participant_release(
      v_order.tenant_id, v_event_id,
      (SELECT p.user_id FROM public.event_people p WHERE p.id = v_reg.person_id),
      'refunded');
  END IF;
  SELECT r.* INTO v_final FROM public.event_registrations r
  WHERE r.id = v_reg.id AND r.tenant_id = v_order.tenant_id;
  SELECT * INTO v_person FROM public.event_people p WHERE p.id = v_reg.person_id;
  SELECT * INTO v_event FROM public.events e WHERE e.id = v_event_id;
  PERFORM public.emit_domain_event(
    v_order.tenant_id,
    'event_registration',
    v_reg.id::text,
    'event.registration.payment.v1',
    jsonb_build_object('event_id', v_event_id, 'order_id', v_order.id,
                       'outcome', v_effective, 'refunded_cents', v_refunded),
    NULL
  );
  RETURN jsonb_build_object(
    'applied', true,
    'registration_id', v_reg.id,
    'registration_status', v_final.status,
    'waitlist_position', v_final.waitlist_position,
    'newly_settled', v_newly_settled,
    'refund_queued', COALESCE(v_refund_queued, false),
    'outcome', v_effective,
    'refunded_cents', v_refunded,
    'amount_cents', v_order.amount_cents,
    'currency', v_order.currency,
    'tenant_id', v_order.tenant_id,
    'event_id', v_event_id,
    'event_title_pl', v_event.title_pl,
    'event_title_en', v_event.title_en,
    'event_slug', v_event.slug,
    'contact', jsonb_build_object(
      'person_id', v_reg.person_id,
      'user_id', v_order.user_id,
      'email', v_person.email,
      'phone', v_person.phone,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name
    ),
    'waitlist', v_promoted
  ) || CASE WHEN COALESCE(v_refund_queued, false)
         THEN jsonb_build_object('refused', true, 'reason', 'registration_closed')
         ELSE '{}'::jsonb END;
END;
$function$;