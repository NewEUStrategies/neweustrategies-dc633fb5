CREATE OR REPLACE FUNCTION public._event_package_purchase(p_payload jsonb, p_ip_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_note text := btrim(COALESCE(p_payload->>'invoice_note', ''));
  v_quote jsonb;
  v_pkg public.event_ticket_packages;
  v_type public.event_ticket_types;
  v_order_id uuid;
  v_coupon_id uuid;
  v_total integer;
  v_discount integer;
  v_per_user integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: package_id is required';
  END IF;
  IF p_payload ? 'company_id' THEN
    RAISE EXCEPTION 'forbidden_field: company_id is assigned by the organizer';
  END IF;

  v_quote := public._event_admission_quote(jsonb_build_object(
    'package_id', v_package_id,
    'coupon_code', COALESCE(p_payload->>'coupon_code', '')
  ), p_ip_subject);

  IF NOT (v_quote->>'ok')::boolean THEN
    IF v_quote->>'reason' = 'coupon_unknown' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    RAISE EXCEPTION 'refused_%: %', v_quote->>'reason', v_quote->>'reason';
  END IF;

  v_total := (v_quote->>'total_cents')::integer;
  v_discount := (v_quote->>'discount_cents')::integer;
  v_coupon_id := NULLIF(v_quote->>'coupon_id', '')::uuid;

  PERFORM 1
  FROM public.events e
  JOIN public.event_ticket_packages p
    ON p.event_id = e.id AND p.tenant_id = e.tenant_id
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE OF e;

  SELECT t.* INTO v_type
  FROM public.event_ticket_types t
  JOIN public.event_ticket_packages p
    ON p.ticket_type_id = t.id AND p.tenant_id = t.tenant_id
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE OF t;

  SELECT * INTO v_pkg
  FROM public.event_ticket_packages
  WHERE id = v_package_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_pkg.id IS NULL OR v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;

  IF v_pkg.quota IS NOT NULL AND v_pkg.sold_count >= v_pkg.quota THEN
    RAISE EXCEPTION 'sold_out: no packages left';
  END IF;
  IF v_type.quota IS NOT NULL AND v_type.sold_count + v_pkg.seats > v_type.quota THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for a whole package';
  END IF;

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_user_id, company_id,
    buyer_email, buyer_name, seats_total, status,
    amount_cents, discount_cents, currency, coupon_id, invoice_note, created_by
  ) VALUES (
    v_tenant, v_pkg.event_id, v_package_id, v_uid, NULL,
    CASE WHEN v_email <> '' THEN v_email
         ELSE lower(btrim((SELECT u.email FROM auth.users u WHERE u.id = v_uid))) END,
    v_name, v_pkg.seats, 'pending',
    v_total, v_discount, v_pkg.currency, v_coupon_id, v_note, v_uid
  )
  RETURNING id INTO v_order_id;

  IF v_coupon_id IS NOT NULL THEN
    SELECT c.max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons c
    WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant
    FOR UPDATE;

    IF v_per_user IS NOT NULL AND (
         SELECT count(*)
         FROM public.b2b_coupon_redemptions r
         WHERE r.coupon_id = v_coupon_id AND r.user_id = v_uid
           AND r.tenant_id = v_tenant
       ) >= v_per_user THEN
      RAISE EXCEPTION 'refused_coupon_used_by_you: code already used by this buyer in a concurrent order';
    END IF;

    UPDATE public.b2b_coupons c
    SET redemptions_count = c.redemptions_count + 1, updated_at = now()
    WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant AND c.active
      AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions)
      AND (c.valid_from IS NULL OR now() >= c.valid_from)
      AND (c.valid_until IS NULL OR now() < c.valid_until);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refused_coupon_exhausted: last use taken by a concurrent order';
    END IF;

    INSERT INTO public.b2b_coupon_redemptions (
      tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
      package_order_id
    ) VALUES (
      v_tenant, v_coupon_id, NULL, v_uid, v_discount, v_total + v_discount, v_pkg.currency,
      v_order_id
    );
  END IF;

  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_pkg.event_id, v_order_id FROM generate_series(1, v_pkg.seats);

  UPDATE public.event_ticket_packages
  SET sold_count = sold_count + 1 WHERE id = v_package_id AND tenant_id = v_tenant;
  UPDATE public.event_ticket_types
  SET sold_count = sold_count + v_pkg.seats WHERE id = v_type.id AND tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'seats', v_pkg.seats,
    'currency', v_pkg.currency,
    'total_cents', v_total,
    'discount_cents', v_discount,
    'status', 'pending'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_purchase(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payments_apply_event_ticket_outcome(
  p_order_id uuid,
  p_outcome text,
  p_refunded_cents integer DEFAULT NULL
)
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
  v_event_status text;
  v_next_status text;
  v_admitted boolean;
  v_queued boolean;
  v_position integer;
  v_newly_settled boolean := false;
  v_final public.event_registrations;
  v_close jsonb;
  v_alerted boolean := false;
BEGIN
  IF p_outcome NOT IN ('paid','unpaid','refunded','partial_refund') THEN
    RAISE EXCEPTION 'invalid_outcome';
  END IF;

  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;

  v_event_id := NULLIF(v_order.metadata->>'event_id','')::uuid;
  v_ticket_type_id := NULLIF(v_order.metadata->>'ticket_type_id','')::uuid;
  v_registration_hint := CASE
    WHEN COALESCE(v_order.metadata->>'registration_id','') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'registration_id')::uuid
    ELSE NULL
  END;

  IF v_event_id IS NOT NULL AND v_order.user_id IS NOT NULL AND v_order.tenant_id IS NOT NULL THEN
    IF v_registration_hint IS NOT NULL THEN
      SELECT r.id, r.ticket_type_id INTO v_reg_id, v_seat_ticket
      FROM public.event_registrations r
      WHERE r.id = v_registration_hint
        AND r.tenant_id = v_order.tenant_id
        AND r.event_id = v_event_id;
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

    SELECT e.status INTO v_event_status
    FROM public.events e
    WHERE e.id = v_event_id AND e.tenant_id = v_order.tenant_id
    FOR UPDATE;
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.tenant_id = v_order.tenant_id
      AND t.id IN (v_ticket_type_id, v_seat_ticket)
    ORDER BY t.id
    FOR UPDATE;
  END IF;

  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id FOR UPDATE;

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

  IF v_event_id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'not_a_ticket_order',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  IF v_registration_hint IS NOT NULL AND v_reg_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_mismatch',
                              'registration_id', v_registration_hint,
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  IF v_reg_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'registration_not_found',
                              'outcome', v_effective, 'refunded_cents', v_refunded);
  END IF;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  WHERE r.id = v_reg_id AND r.tenant_id = v_order.tenant_id
  FOR UPDATE;

  IF v_effective = 'paid' THEN
    IF v_reg.payment_status = 'paid'
       AND v_reg.payment_order_id IS NOT NULL
       AND v_reg.payment_order_id <> v_order.id THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'already_settled_by_another_order',
                                'registration_id', v_reg.id,
                                'payment_order_id', v_reg.payment_order_id,
                                'outcome', v_effective, 'refunded_cents', v_refunded);
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

    IF v_event_status = 'cancelled' THEN
      v_close := public._event_cancelled_event_close_paid(v_order.tenant_id, v_event_id, NULL);
      v_alerted := COALESCE((v_close->>'closed')::integer, 0) > 0;
    END IF;

    IF NOT v_alerted AND v_newly_settled AND v_reg.status IN ('cancelled', 'rejected')
       AND EXISTS (
         SELECT 1 FROM public.event_registration_refund_jobs j
          WHERE j.tenant_id = v_order.tenant_id
            AND j.payment_order_id = v_order.id
            AND j.state = 'needs_review') THEN
      SELECT * INTO v_event FROM public.events e WHERE e.id = v_event_id;
      v_alerted := public._event_refund_alert_organizers(
        v_order.tenant_id, v_event_id,
        'Wpłata za zamknięte zgłoszenie - do zwrotu',
        'Payment for a closed registration - refund due',
        format('%s: wpłata dotarła do zgłoszenia odwołanego albo odrzuconego. Zlecenie czeka w dzienniku zwrotów zgłoszeń - zdecyduj tam o zwrocie.',
               '„' || v_event.title_pl || '”'),
        format('"%s": a payment reached a cancelled or rejected registration. The request waits in the registration refund journal - decide on the refund there.',
               COALESCE(NULLIF(btrim(v_event.title_en), ''), v_event.title_pl))) > 0;
    END IF;

  ELSIF v_effective = 'unpaid' THEN
    UPDATE public.event_registrations r
    SET payment_order_id = v_order.id,
        payment_status = 'unpaid',
        updated_at = now()
    WHERE r.id = v_reg.id AND r.payment_status <> 'paid';
    PERFORM public._event_plan_seat_settle(v_reg.id, v_order.id);

  ELSIF v_effective IN ('partial_refund', 'refunded')
        AND v_reg.payment_order_id IS NOT NULL
        AND v_reg.payment_order_id <> v_order.id THEN
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
    'outcome', v_effective,
    'refunded_cents', v_refunded,
    'amount_cents', v_order.amount_cents,
    'currency', v_order.currency,
    'tenant_id', v_order.tenant_id,
    'event_id', v_event_id,
    'event_title_pl', v_event.title_pl,
    'event_title_en', v_event.title_en,
    'event_slug', v_event.slug,
    'organizer_alerted', v_alerted,
    'contact', jsonb_build_object(
      'person_id', v_reg.person_id,
      'user_id', v_order.user_id,
      'email', v_person.email,
      'phone', v_person.phone,
      'first_name', v_person.first_name,
      'last_name', v_person.last_name
    ),
    'waitlist', v_promoted
  );
END;
$function$;

COMMENT ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) IS
  'Przenosi wynik platnosci na zgloszenie. Dopasowanie po metadata.registration_id, gdy jest obecne. Blokady dla KAZDEGO wyniku: wydarzenie -> bilety -> zamowienie -> zgloszenie (R45). Wplata przyjmuje z kontrola miejsc (_event_registration_paid_admission): miejsce -> approved z kodem QR, brak miejsca -> kolejka OPLACONA (capacity), bilet albo przeplyw z akceptacja -> pending (oplacone), gosc bez przyjetego prowadzacego -> tylko rozliczenie; na odwolanym wydarzeniu zgloszenie zamyka sie ze zwrotem (_event_cancelled_event_close_paid), na zamknietym zgloszeniu - dzwonek o zleceniu w przegladzie (organizer_alerted w odpowiedzi). Wynik unpaid oddaje bilet z puli planu (_event_plan_seat_settle). Odpowiedz niesie registration_status, waitlist_position, newly_settled i organizer_alerted. Druga wplata na to samo zgloszenie i zwrot z cudzego zamowienia sa jawnie odrzucane. Pelny zwrot czysci kod QR i zwalnia zapisy na sesje, zakladki planu oraz starsza rezerwacje RSVP posiadacza (D0-2).';

REVOKE ALL ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_apply_event_ticket_outcome(uuid, text, integer) TO service_role;