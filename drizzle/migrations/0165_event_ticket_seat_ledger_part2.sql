CREATE OR REPLACE FUNCTION public.admin_event_package_order_create(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_package public.event_ticket_packages;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_seats integer;
  v_order_id uuid;
  v_left integer;
  v_pay_by timestamptz := NULLIF(p_payload->>'pay_by', '')::timestamptz;
BEGIN
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: package_id is required';
  END IF;
  PERFORM 1 FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.id = (SELECT p.event_id FROM public.event_ticket_packages p
                WHERE p.id = v_package_id AND p.tenant_id = v_tenant)
  FOR UPDATE;
  PERFORM 1 FROM public.event_ticket_types t
  WHERE t.tenant_id = v_tenant
    AND t.id = (SELECT p.ticket_type_id FROM public.event_ticket_packages p
                WHERE p.id = v_package_id AND p.tenant_id = v_tenant)
  FOR UPDATE;
  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_package_id AND p.tenant_id = v_tenant
  FOR UPDATE;
  IF v_package.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid buyer e-mail is required';
  END IF;
  IF v_package.quota IS NOT NULL AND v_package.sold_count >= v_package.quota THEN
    RAISE EXCEPTION 'package_sold_out: no packages of this kind are left';
  END IF;
  v_seats := COALESCE((NULLIF(p_payload->>'seats_total', ''))::integer, v_package.seats);
  IF v_seats < 1 OR v_seats > 1000 THEN
    RAISE EXCEPTION 'invalid_request: seats_total must be between 1 and 1000';
  END IF;
  v_left := public._event_seats_left(v_tenant, v_package.event_id, v_package.ticket_type_id);
  IF v_left IS NOT NULL AND v_left < v_seats THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for this order';
  END IF;
  IF v_pay_by IS NOT NULL AND v_pay_by <= now() THEN
    RAISE EXCEPTION 'invalid_request: pay_by must be in the future';
  END IF;
  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_email, buyer_name, seats_total,
    status, amount_cents, currency, invoice_note, created_by, pay_by
  ) VALUES (
    v_tenant, v_package.event_id, v_package.id, v_email, v_name, v_seats,
    'pending',
    COALESCE((NULLIF(p_payload->>'amount_cents', ''))::integer, v_package.price_cents),
    v_package.currency,
    left(btrim(COALESCE(p_payload->>'invoice_note', '')), 500),
    v_uid,
    v_pay_by
  )
  RETURNING id INTO v_order_id;
  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_package.event_id, v_order_id
  FROM generate_series(1, v_seats);
  RETURN v_order_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_token text := btrim(COALESCE(p_payload->>'token', ''));
  v_first text := btrim(COALESCE(p_payload->>'first_name', ''));
  v_last text := btrim(COALESCE(p_payload->>'last_name', ''));
  v_job text := NULLIF(btrim(COALESCE(p_payload->>'job_title', '')), '');
  v_company text := NULLIF(btrim(COALESCE(p_payload->>'company_text', '')), '');
  v_answers jsonb := COALESCE(p_payload->'answers', '{}'::jsonb);
  v_data_ok boolean := lower(COALESCE(p_payload->>'consent_data_processing', '')) IN ('true', 't', '1');
  v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash', '')), '');
  v_seat public.event_package_seats;
  v_order public.event_package_orders;
  v_package public.event_ticket_packages;
  v_person_id uuid;
  v_group_id uuid;
  v_reg_id uuid;
  v_qr text;
  v_manage text;
  v_rate record;
  v_admit boolean;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'not_found: invitation does not exist';
  END IF;
  IF v_token = '' THEN
    RAISE EXCEPTION 'invalid_token: the invitation link is incomplete';
  END IF;
  IF v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'invalid_name: first name and last name are required';
  END IF;
  IF NOT v_data_ok THEN
    RAISE EXCEPTION 'consent_required: consent to data processing is required';
  END IF;
  IF jsonb_typeof(v_answers) <> 'object' THEN
    RAISE EXCEPTION 'invalid_answers: answers must be a JSON object';
  END IF;
  SELECT * INTO v_rate
  FROM public.rate_limit_hit(
    'event_package_invite_accept',
    v_tenant::text || ':' || COALESCE(v_ip_hash, left(v_token, 12)),
    10,
    10
  );
  IF NOT v_rate.allowed THEN
    RAISE EXCEPTION 'rate_limited: too many attempts, try again later';
  END IF;
  SELECT * INTO v_seat
  FROM public.event_package_seats s
  WHERE s.tenant_id = v_tenant
    AND s.invite_token_hash = encode(digest(v_token, 'sha256'), 'hex')
  FOR UPDATE;
  IF v_seat.id IS NULL OR v_seat.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_token: the invitation is not valid';
  END IF;
  IF v_seat.registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'seat_taken: this invitation has already been used';
  END IF;
  IF v_seat.invite_expires_at IS NOT NULL AND now() > v_seat.invite_expires_at THEN
    RAISE EXCEPTION 'invitation_expired: the invitation has expired';
  END IF;
  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_seat.package_order_id AND o.tenant_id = v_tenant;
  IF v_order.status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;
  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_order.package_id AND p.tenant_id = v_tenant;
  v_admit := v_order.status = 'paid' OR COALESCE(v_package.admit_before_payment, false);
  SELECT pe.id INTO v_person_id
  FROM public.event_people pe
  WHERE pe.tenant_id = v_tenant AND pe.email_norm = v_seat.invite_email;
  IF v_person_id IS NULL THEN
    INSERT INTO public.event_people (
      tenant_id, user_id, email, first_name, last_name, job_title, company_text,
      source, consent_data_processing_at, created_by
    ) VALUES (
      v_tenant, v_uid, v_seat.invite_email, v_first, v_last, v_job, v_company,
      'package_invitation', now(), v_uid
    )
    RETURNING id INTO v_person_id;
  ELSE
    UPDATE public.event_people pe SET
      first_name = v_first,
      last_name = v_last,
      job_title = COALESCE(v_job, pe.job_title),
      company_text = COALESCE(v_company, pe.company_text),
      consent_data_processing_at = COALESCE(pe.consent_data_processing_at, now()),
      consent_withdrawn_at = NULL
    WHERE pe.id = v_person_id AND pe.tenant_id = v_tenant;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant
      AND r.event_id = v_seat.event_id
      AND r.person_id = v_person_id
      AND r.status NOT IN ('cancelled', 'rejected')
  ) THEN
    RAISE EXCEPTION 'already_registered: this person already has an active registration';
  END IF;
  SELECT t.group_id INTO v_group_id
  FROM public.event_ticket_types t
  WHERE t.id = v_package.ticket_type_id AND t.tenant_id = v_tenant;
  IF v_group_id IS NULL THEN
    SELECT g.id INTO v_group_id
    FROM public.event_groups g
    WHERE g.tenant_id = v_tenant AND g.event_id = v_seat.event_id AND g.is_default;
  END IF;
  v_manage := public._event_new_qr_token();
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, manage_token_hash, created_by
  ) VALUES (
    v_tenant, v_seat.event_id, v_person_id, v_package.ticket_type_id, v_group_id,
    'pending', 'form', v_answers, 'package_invitation',
    encode(digest(v_manage, 'sha256'), 'hex'), v_uid
  )
  RETURNING id INTO v_reg_id;
  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now()
  WHERE s.id = v_seat.id AND s.tenant_id = v_tenant;
  IF v_admit THEN
    v_qr := public._event_new_qr_token();
    UPDATE public.event_registrations r SET
      status = 'approved',
      decided_at = now(),
      decision_source = 'system',
      qr_token_hash = encode(digest(v_qr, 'sha256'), 'hex'),
      qr_issued_at = now(),
      updated_at = now()
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;
  END IF;
  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_seat.event_id,
      'person_id', v_person_id,
      'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );
  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'event_id', v_seat.event_id,
    'status', CASE WHEN v_admit THEN 'approved' ELSE 'pending' END,
    'awaiting_payment', NOT v_admit,
    'qr_token', v_qr,
    'manage_token', v_manage
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.event_package_seat_invite(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_order_id uuid := NULLIF(p_payload->>'package_order_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'email', '')));
  v_name text := btrim(COALESCE(p_payload->>'name', ''));
  v_days integer := COALESCE((NULLIF(p_payload->>'expires_in_days', ''))::integer, 30);
  v_order public.event_package_orders;
  v_seat_id uuid;
  v_token text;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid address is required';
  END IF;
  SELECT * INTO v_order
  FROM public.event_package_orders
  WHERE id = v_order_id AND tenant_id = v_tenant
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'not_found: package order does not exist in this tenant';
  END IF;
  IF v_order.buyer_user_id IS DISTINCT FROM v_uid
     AND NOT (
       public.has_role(v_uid, 'admin'::app_role)
       OR public.is_super_admin(v_uid)
     ) THEN
    RAISE EXCEPTION 'forbidden: only the buyer or the organiser may hand out seats';
  END IF;
  IF v_order.status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: seats of a cancelled order cannot be handed out';
  END IF;
  SELECT id INTO v_seat_id
  FROM public.event_package_seats
  WHERE package_order_id = v_order_id
    AND tenant_id = v_tenant
    AND registration_id IS NULL
    AND invite_email IS NULL
    AND revoked_at IS NULL
  ORDER BY created_at, id
  LIMIT 1;
  IF v_seat_id IS NULL THEN
    RAISE EXCEPTION 'no_free_seat: every seat of this package is taken or invited';
  END IF;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  UPDATE public.event_package_seats SET
    invite_email = v_email,
    invite_name = v_name,
    invite_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
    invite_sent_at = now(),
    invite_expires_at = now() + make_interval(days => GREATEST(v_days, 1))
  WHERE id = v_seat_id;
  RETURN jsonb_build_object(
    'seat_id', v_seat_id,
    'email', v_email,
    'token', v_token,
    'expires_at', now() + make_interval(days => GREATEST(v_days, 1))
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.admin_event_package_seat_invite(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'invite_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'invite_name', ''));
  v_days integer := COALESCE((NULLIF(p_payload->>'valid_days', ''))::integer, 30);
  v_seat public.event_package_seats;
  v_status text;
  v_token text;
BEGIN
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email: a valid invitee e-mail is required';
  END IF;
  IF v_days < 1 OR v_days > 365 THEN
    RAISE EXCEPTION 'invalid_request: valid_days must be between 1 and 365';
  END IF;
  SELECT * INTO v_seat
  FROM public.event_package_seats s
  WHERE s.id = v_id AND s.tenant_id = v_tenant
  FOR UPDATE;
  IF v_seat.id IS NULL THEN
    RAISE EXCEPTION 'not_found: seat does not exist in this tenant';
  END IF;
  IF v_seat.registration_id IS NOT NULL THEN
    RAISE EXCEPTION 'seat_taken: this seat is already assigned to a participant';
  END IF;
  IF v_seat.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'seat_revoked: this seat has been withdrawn';
  END IF;
  SELECT o.status INTO v_status
  FROM public.event_package_orders o
  WHERE o.id = v_seat.package_order_id AND o.tenant_id = v_tenant;
  IF v_status IN ('cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;
  v_token := public._event_new_qr_token();
  UPDATE public.event_package_seats s SET
    invite_email = v_email,
    invite_name = left(v_name, 200),
    invite_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
    invite_sent_at = now(),
    invite_expires_at = now() + make_interval(days => v_days)
  WHERE s.id = v_id AND s.tenant_id = v_tenant;
  RETURN jsonb_build_object('seat_id', v_id, 'invite_token', v_token);
END;
$function$;
CREATE OR REPLACE FUNCTION public._event_package_order_set_status_core(
  p_tenant uuid,
  p_payload jsonb,
  p_expire_only boolean DEFAULT false
)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := p_tenant;
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := lower(btrim(COALESCE(p_payload->>'status', '')));
  v_order public.event_package_orders;
  v_latch timestamptz;
  v_coupon_id uuid;
  v_per_user integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: tenant required';
  END IF;
  IF p_expire_only THEN
    v_status := 'cancelled';
  END IF;
  IF v_status NOT IN ('pending', 'paid', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'invalid_status: unknown order status';
  END IF;
  PERFORM 1 FROM public.b2b_coupons c
  WHERE c.id = (SELECT o.coupon_id FROM public.event_package_orders o
                WHERE o.id = v_id AND o.tenant_id = v_tenant)
    AND c.tenant_id = v_tenant
  FOR UPDATE OF c;
  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_id AND o.tenant_id = v_tenant
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    IF p_expire_only THEN
      RETURN false;
    END IF;
    RAISE EXCEPTION 'not_found: order does not exist in this tenant';
  END IF;
  IF p_expire_only AND (
       v_order.status <> 'pending'
       OR v_order.pay_by IS NULL
       OR v_order.pay_by > now()
       OR EXISTS (
         SELECT 1 FROM public.event_package_seats s
         JOIN public.event_registrations r
           ON r.id = s.registration_id AND r.tenant_id = s.tenant_id
         WHERE s.package_order_id = v_order.id AND s.tenant_id = v_tenant
           AND r.status IN ('approved', 'attended', 'no_show')
       )
       OR EXISTS (
         SELECT 1 FROM public.event_invoice_sources d
         JOIN public.event_invoices i ON i.id = d.invoice_id AND i.tenant_id = d.tenant_id
         WHERE d.package_order_id = v_order.id AND d.tenant_id = v_tenant
           AND d.released_at IS NULL AND i.status = 'issued'
       )) THEN
    RETURN false;
  END IF;
  v_latch := v_order.coupon_released_at;
  IF v_status = 'cancelled' AND v_order.status <> 'cancelled' THEN
    DELETE FROM public.b2b_coupon_redemptions r
    WHERE r.package_order_id = v_id AND r.tenant_id = v_tenant
      AND EXISTS (SELECT 1 FROM public.b2b_coupons c
                  WHERE c.id = r.coupon_id AND c.tenant_id = v_tenant)
    RETURNING r.coupon_id INTO v_coupon_id;
    IF FOUND THEN
      UPDATE public.b2b_coupons c
      SET redemptions_count = GREATEST(0, c.redemptions_count - 1), updated_at = now()
      WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant;
      v_latch := now();
    END IF;
  ELSIF v_status <> 'cancelled' AND v_order.status = 'cancelled'
        AND v_order.coupon_released_at IS NOT NULL THEN
    IF v_order.coupon_id IS NOT NULL THEN
      SELECT c.id, c.max_redemptions_per_user INTO v_coupon_id, v_per_user
      FROM public.b2b_coupons c
      WHERE c.id = v_order.coupon_id AND c.tenant_id = v_tenant
      FOR UPDATE;
    END IF;
    IF v_coupon_id IS NOT NULL THEN
      IF v_per_user IS NOT NULL AND (
           SELECT count(*)
           FROM public.b2b_coupon_redemptions r
           WHERE r.coupon_id = v_coupon_id AND r.user_id = v_order.buyer_user_id
             AND r.tenant_id = v_tenant
         ) >= v_per_user THEN
        RAISE EXCEPTION 'coupon_restore_used_by_buyer: the buyer already used this code in another order';
      END IF;
      UPDATE public.b2b_coupons c
      SET redemptions_count = c.redemptions_count + 1, updated_at = now()
      WHERE c.id = v_coupon_id AND c.tenant_id = v_tenant
        AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'coupon_restore_exhausted: the code has no use left to give back to this order';
      END IF;
      INSERT INTO public.b2b_coupon_redemptions (
        tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency,
        package_order_id
      ) VALUES (
        v_tenant, v_coupon_id, NULL, v_order.buyer_user_id, v_order.discount_cents,
        v_order.amount_cents + v_order.discount_cents, v_order.currency,
        v_id
      );
    END IF;
    v_latch := NULL;
  END IF;
  UPDATE public.event_package_orders o SET
    status = v_status,
    paid_at = CASE WHEN v_status IN ('paid', 'refunded') THEN COALESCE(o.paid_at, now()) END,
    cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(o.cancelled_at, now()) END,
    coupon_released_at = v_latch
  WHERE o.id = v_id AND o.tenant_id = v_tenant;
  IF v_status = 'paid' AND v_order.status <> 'paid' THEN
    UPDATE public.event_registrations r SET
      status = 'approved',
      decided_at = now(),
      decision_source = 'system',
      updated_at = now()
    FROM public.event_package_seats s
    WHERE s.package_order_id = v_id AND s.tenant_id = v_tenant
      AND s.revoked_at IS NULL
      AND r.id = s.registration_id AND r.tenant_id = s.tenant_id
      AND r.status = 'pending'
      AND r.source = 'package_invitation';
  END IF;
  IF v_status IN ('cancelled', 'refunded') THEN
    UPDATE public.event_package_seats s SET
      revoked_at = now(),
      invite_email = NULL,
      invite_token_hash = NULL
    WHERE s.package_order_id = v_id
      AND s.tenant_id = v_tenant
      AND s.registration_id IS NULL
      AND s.revoked_at IS NULL;
    UPDATE public.event_registrations r SET
      status = 'cancelled',
      cancelled_at = COALESCE(r.cancelled_at, now()),
      decided_at = COALESCE(r.decided_at, now()),
      decision_source = COALESCE(r.decision_source, 'system'),
      updated_at = now()
    FROM public.event_package_seats s
    WHERE s.package_order_id = v_id AND s.tenant_id = v_tenant
      AND r.id = s.registration_id AND r.tenant_id = s.tenant_id
      AND r.status IN ('draft', 'pending', 'waitlist')
      AND r.source = 'package_invitation';
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_order_set_status_core(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_order_set_status_core(uuid, jsonb, boolean)
  TO service_role;
CREATE OR REPLACE FUNCTION public.admin_event_package_order_set_status(p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public._event_package_order_set_status_core(
    public.assert_event_admin_tenant(), p_payload, false);
END;
$function$;
CREATE OR REPLACE FUNCTION public._event_package_orders_expire(p_limit integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_n integer := 0;
BEGIN
  FOR v_row IN
    SELECT o.id, o.tenant_id
    FROM public.event_package_orders o
    WHERE o.status = 'pending' AND o.pay_by IS NOT NULL AND o.pay_by <= now()
    ORDER BY o.pay_by, o.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)
  LOOP
    IF public._event_package_order_set_status_core(
         v_row.tenant_id, jsonb_build_object('id', v_row.id), true) THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_orders_expire(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_orders_expire(integer) TO service_role;
COMMENT ON FUNCTION public._event_package_orders_expire(integer) IS
  'Co godzine (pg_cron event-package-orders-expire) i z community-cron (event-ticket-codes): anuluje zamowienia pakietow pending po pay_by, bez delegata na miejscu - miejsca wracaja do puli, kod rabatowy oddaje uzycie (TIX-07). Zwraca liczbe anulowanych.';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-package-orders-expire', '23 * * * *',
      'SELECT public._event_package_orders_expire(200)');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - expired package orders cancelled by community-cron (event-ticket-codes)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION public._event_rsvp_claim_paid_seat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders;
  v_event_id uuid;
  v_status text;
  v_left integer;
BEGIN
  SELECT * INTO v_order FROM public.payment_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL OR v_order.user_id IS NULL OR v_order.tenant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found');
  END IF;
  v_event_id := CASE
    WHEN COALESCE(v_order.metadata->>'event_id', '') ~ '^[0-9a-fA-F-]{36}$'
      THEN (v_order.metadata->>'event_id')::uuid
  END;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_ticket_order');
  END IF;
  PERFORM 1 FROM public.events e
  WHERE e.id = v_event_id AND e.tenant_id = v_order.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_not_found');
  END IF;
  SELECT r.status INTO v_status
  FROM public.event_rsvps r
  WHERE r.event_id = v_event_id AND r.user_id = v_order.user_id;
  IF v_status = 'going' THEN
    RETURN jsonb_build_object('ok', true, 'seated', true, 'already', true, 'event_id', v_event_id);
  END IF;
  v_left := public._event_page_seats_left(v_order.tenant_id, v_event_id);
  IF v_left IS NOT NULL AND v_left <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_full', 'event_id', v_event_id);
  END IF;
  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, updated_at)
  VALUES (v_order.tenant_id, v_event_id, v_order.user_id, 'going', now())
  ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going', updated_at = now();
  RETURN jsonb_build_object('ok', true, 'seated', true, 'already', false, 'event_id', v_event_id);
END;
$function$;
REVOKE ALL ON FUNCTION public._event_rsvp_claim_paid_seat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_rsvp_claim_paid_seat(uuid) TO service_role;
COMMENT ON FUNCTION public._event_rsvp_claim_paid_seat(uuid) IS
  'Webhook (oneTimeFulfilment): wplata bez zgloszenia formularza zajmuje miejsce RSVP pod blokada wiersza wydarzenia - regula _event_page_seats_left. event_full = zwrot. Idempotentne dla RSVP going (TIX-08).';
CREATE OR REPLACE FUNCTION public._event_admission_quote(p_payload jsonb, p_ip_subject text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  v_ticket_type_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_code text := upper(btrim(COALESCE(p_payload->>'coupon_code', '')));
  v_kind text;
  v_audience text;
  v_requires_verification boolean;
  v_min_tier_rank integer;
  v_price integer;
  v_currency text;
  v_quota integer;
  v_sold integer;
  v_sales_from timestamptz;
  v_sales_to timestamptz;
  v_seats integer := 1;
  v_max_per_person integer;
  v_event_id uuid;
  v_is_active boolean;
  v_owned integer := 0;
  v_coupon public.b2b_coupons;
  v_discount integer := 0;
  v_used_by_user integer := 0;
  v_scope_type uuid;
  v_code_cents integer;
  v_per_seat integer;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sign_in_required');
  END IF;
  IF (v_ticket_type_id IS NULL) = (v_package_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_payload: give exactly one of ticket_type_id or package_id';
  END IF;
  IF v_ticket_type_id IS NOT NULL THEN
    v_kind := 'ticket';
    v_scope_type := v_ticket_type_id;
    SELECT t.event_id, t.audience, t.requires_verification, t.min_tier_rank,
           t.price_cents, t.currency, t.quota, t.sold_count, t.sales_from, t.sales_to,
           t.is_active, t.max_per_person
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_max_per_person
    FROM public.event_ticket_types t
    WHERE t.id = v_ticket_type_id AND t.tenant_id = v_tenant;
  ELSE
    v_kind := 'package';
    SELECT p.event_id, p.audience, p.requires_verification, p.min_tier_rank,
           p.price_cents, p.currency, p.quota, p.sold_count, p.sales_from, p.sales_to,
           p.is_active, p.seats, p.ticket_type_id
      INTO v_event_id, v_audience, v_requires_verification, v_min_tier_rank,
           v_price, v_currency, v_quota, v_sold, v_sales_from, v_sales_to,
           v_is_active, v_seats, v_scope_type
    FROM public.event_ticket_packages p
    WHERE p.id = v_package_id AND p.tenant_id = v_tenant;
  END IF;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT v_is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive');
  END IF;
  IF v_sales_from IS NOT NULL AND now() < v_sales_from THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_not_open',
                              'sales_from', v_sales_from);
  END IF;
  IF v_sales_to IS NOT NULL AND now() >= v_sales_to THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sales_closed');
  END IF;
  IF v_quota IS NOT NULL AND v_sold >= v_quota THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
  END IF;
  IF v_min_tier_rank > 0 AND NOT public.has_tier_rank(v_min_tier_rank) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tier_required',
                              'min_tier_rank', v_min_tier_rank);
  END IF;
  IF v_audience NOT IN ('public', 'member') AND v_requires_verification
     AND NOT public.event_audience_qualifies(v_audience) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'audience_not_verified',
                              'audience', v_audience);
  END IF;
  IF v_kind = 'ticket' AND v_max_per_person IS NOT NULL THEN
    SELECT count(*)::integer INTO v_owned
    FROM public.event_registrations r
    JOIN public.event_people pe
      ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant
      AND r.ticket_type_id = v_ticket_type_id
      AND pe.user_id = v_uid
      AND r.status NOT IN ('cancelled', 'rejected');
    IF v_owned >= v_max_per_person THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'per_person_limit',
                                'max_per_person', v_max_per_person, 'owned', v_owned);
    END IF;
  END IF;
  IF v_code <> '' THEN
    PERFORM public._coupon_probe_guard(v_uid, p_ip_subject);
    SELECT * INTO v_coupon FROM public.b2b_coupons c
    WHERE c.tenant_id = v_tenant AND upper(c.code) = v_code;
    IF v_coupon.id IS NULL OR NOT v_coupon.active
       OR (array_length(v_coupon.event_ids, 1) IS NOT NULL
           AND NOT (v_event_id = ANY (v_coupon.event_ids))) THEN
      PERFORM public._coupon_probe_miss(v_uid, p_ip_subject);
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_unknown');
    END IF;
    IF NOT public._b2b_coupon_window_open(v_coupon.valid_from, NULL) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_not_yet_valid');
    END IF;
    IF NOT public._b2b_coupon_window_open(NULL, v_coupon.valid_until) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_expired');
    END IF;
    IF v_coupon.max_redemptions IS NOT NULL
       AND v_coupon.redemptions_count >= v_coupon.max_redemptions THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_exhausted');
    END IF;
    IF v_coupon.max_redemptions_per_user IS NOT NULL THEN
      SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
      WHERE r.coupon_id = v_coupon.id AND r.user_id = v_uid
        AND r.tenant_id = v_tenant;
      IF v_used_by_user >= v_coupon.max_redemptions_per_user THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'coupon_used_by_you');
      END IF;
    END IF;
    IF array_length(v_coupon.ticket_type_ids, 1) IS NOT NULL
       AND NOT (v_scope_type = ANY (v_coupon.ticket_type_ids))
       AND NOT (v_kind = 'package' AND v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_ticket_type');
    END IF;
    IF v_kind = 'package' AND array_length(v_coupon.package_ids, 1) IS NOT NULL
       AND NOT (v_package_id = ANY (v_coupon.package_ids)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_package');
    END IF;
    IF NOT v_coupon.applies_discount THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_no_discount');
    END IF;
    IF v_coupon.currency IS NOT NULL AND v_coupon.currency <> v_currency THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'coupon_other_currency');
    END IF;
    IF v_coupon.discount_kind = 'percent' THEN
      v_discount := ((v_price::bigint * COALESCE(v_coupon.discount_percent, 0)) / 100)::integer;
    ELSE
      v_code_cents := COALESCE(v_coupon.discount_cents, 0);
      IF v_code_cents::bigint * v_seats >= v_price THEN
        v_discount := v_price;
        v_per_seat := v_price / v_seats;
      ELSE
        v_discount := v_code_cents * v_seats;
        v_per_seat := v_code_cents;
      END IF;
    END IF;
    v_discount := GREATEST(LEAST(v_discount, v_price), 0);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'event_id', v_event_id,
    'audience', v_audience,
    'seats', v_seats,
    'currency', v_currency,
    'price_cents', v_price,
    'discount_cents', v_discount,
    'total_cents', v_price - v_discount,
    'coupon_id', v_coupon.id,
    'coupon_code', NULLIF(v_code, ''),
    'discount_kind', v_coupon.discount_kind,
    'discount_per_seat_cents', v_per_seat,
    'seats_left', CASE WHEN v_quota IS NULL THEN NULL ELSE v_quota - v_sold END
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public._b2b_coupon_evaluate(c b2b_coupons, _amount_cents integer, _currency text, p_uid uuid)
 RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_disc integer := 0;
  v_used integer := 0;
BEGIN
  IF NOT c.active THEN
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF NOT public._b2b_coupon_window_open(c.valid_from, NULL) THEN
    RETURN QUERY SELECT false,'not_yet_valid'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF NOT public._b2b_coupon_window_open(NULL, c.valid_until) THEN
    RETURN QUERY SELECT false,'expired'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redemptions_count >= c.max_redemptions THEN
    RETURN QUERY SELECT false,'limit_reached'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.max_redemptions_per_user IS NOT NULL AND p_uid IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = p_uid;
    IF v_used >= c.max_redemptions_per_user THEN
      RETURN QUERY SELECT false,'per_user_limit_reached'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
    END IF;
  END IF;
  IF NOT c.applies_discount THEN
    RETURN QUERY SELECT false,'no_discount'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF c.discount_kind = 'percent' THEN
    v_disc := (_amount_cents * COALESCE(c.discount_percent,0)) / 100;
  ELSE
    IF c.currency IS NOT NULL AND upper(c.currency) <> upper(_currency) THEN
      RETURN QUERY SELECT false,'currency_mismatch'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
    END IF;
    v_disc := LEAST(COALESCE(c.discount_cents,0),_amount_cents);
  END IF;
  RETURN QUERY SELECT true,NULL::text,c.id,v_disc,GREATEST(_amount_cents-v_disc,0),c.name,c.discount_kind,c.discount_percent;
END $function$;
CREATE OR REPLACE FUNCTION public._redeem_b2b_coupon(p_tenant uuid, p_uid uuid, _coupon_id uuid, _order_id uuid, _applied_cents integer, _original_cents integer, _currency text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_per_user integer;
  v_used_by_user integer := 0;
BEGIN
  IF p_tenant IS NULL OR p_uid IS NULL OR _order_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
  ) THEN
    RETURN false;
  END IF;
  SELECT max_redemptions_per_user INTO v_per_user
    FROM public.b2b_coupons
   WHERE id = _coupon_id AND tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_per_user IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used_by_user
      FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = _coupon_id AND r.user_id = p_uid;
    IF v_used_by_user >= v_per_user THEN RETURN false; END IF;
  END IF;
  UPDATE public.b2b_coupons
     SET redemptions_count = redemptions_count + 1, updated_at = now()
   WHERE id = _coupon_id AND tenant_id = p_tenant AND active
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)
     AND public._b2b_coupon_window_open(valid_from, valid_until);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.b2b_coupon_redemptions
    (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
  VALUES
    (p_tenant, _coupon_id, _order_id, p_uid, _applied_cents, _original_cents, _currency);
  RETURN true;
END $function$;
CREATE OR REPLACE FUNCTION public.event_coupon_revealed_tickets(p_tenant uuid, p_event_id uuid, p_code text)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(p_code,'')));
  v_ids uuid[];
BEGIN
  IF p_tenant IS NULL OR p_event_id IS NULL OR v_norm = '' OR length(v_norm) > 64 THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = p_tenant AND upper(code) = v_norm
     AND active AND reveals_hidden AND p_event_id = ANY(event_ids)
     AND public._b2b_coupon_window_open(valid_from, valid_until)
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions);
  IF NOT FOUND THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  SELECT coalesce(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.event_ticket_types t
   WHERE t.tenant_id = p_tenant AND t.event_id = p_event_id AND t.is_hidden
     AND (array_length(c.ticket_type_ids,1) IS NULL OR t.id = ANY(c.ticket_type_ids));
  RETURN v_ids;
END $function$;