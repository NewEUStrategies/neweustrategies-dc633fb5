-- LISTA PAKIETOW -------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_packages_list(p_event_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_packages_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  ticket_type_id uuid,
  ticket_name_pl text,
  ticket_name_en text,
  key text,
  name_pl text,
  name_en text,
  description_pl text,
  description_en text,
  audience text,
  seats integer,
  price_cents integer,
  currency text,
  quota integer,
  sold_count integer,
  sales_from timestamptz,
  sales_to timestamptz,
  min_tier_rank integer,
  requires_verification boolean,
  is_active boolean,
  sort_order integer,
  orders_count integer,
  seats_assigned integer,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    p.id, p.event_id, p.ticket_type_id, t.name_pl, t.name_en,
    p.key, p.name_pl, p.name_en, p.description_pl, p.description_en,
    p.audience, p.seats, p.price_cents, p.currency, p.quota, p.sold_count,
    p.sales_from, p.sales_to, p.min_tier_rank, p.requires_verification,
    p.is_active, p.sort_order,
    (SELECT count(*)::integer FROM public.event_package_orders o
      WHERE o.tenant_id = v_tenant AND o.package_id = p.id AND o.status <> 'cancelled'),
    (SELECT COALESCE(sum(o.seats_assigned), 0)::integer FROM public.event_package_orders o
      WHERE o.tenant_id = v_tenant AND o.package_id = p.id AND o.status <> 'cancelled'),
    p.created_at, p.updated_at
  FROM public.event_ticket_packages p
  JOIN public.event_ticket_types t
    ON t.id = p.ticket_type_id AND t.tenant_id = v_tenant
  WHERE p.tenant_id = v_tenant AND p.event_id = p_event_id
  ORDER BY p.sort_order, p.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_packages_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_packages_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_packages_list(uuid) IS
  'Pakiety miejsc wydarzenia wraz z liczba zamowien i przypisanych miejsc.';

-- ZAPIS PAKIETU ---------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_package_upsert(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_package_upsert(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_key text := lower(btrim(COALESCE(p_payload->>'key', '')));
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_seats integer := (NULLIF(p_payload->>'seats', ''))::integer;
  v_sold integer;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT p.event_id, p.sold_count INTO v_event_id, v_sold
    FROM public.event_ticket_packages p
    WHERE p.id = v_id AND p.tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not_found: package does not exist in this tenant';
    END IF;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  IF v_ticket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_ticket_types t
    WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: ticket does not exist for this event';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.event_ticket_packages p SET
      ticket_type_id = COALESCE(v_ticket_id, p.ticket_type_id),
      name_pl = v_name_pl,
      name_en = v_name_en,
      description_pl = COALESCE(btrim(p_payload->>'description_pl'), p.description_pl),
      description_en = COALESCE(btrim(p_payload->>'description_en'), p.description_en),
      audience = COALESCE(NULLIF(p_payload->>'audience', ''), p.audience),
      seats = COALESCE(v_seats, p.seats),
      price_cents = COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, p.price_cents),
      currency = COALESCE(NULLIF(p_payload->>'currency', ''), p.currency),
      quota = CASE
        WHEN p_payload ? 'quota' THEN (NULLIF(p_payload->>'quota', ''))::integer
        ELSE p.quota
      END,
      sales_from = CASE
        WHEN p_payload ? 'sales_from' THEN (NULLIF(p_payload->>'sales_from', ''))::timestamptz
        ELSE p.sales_from
      END,
      sales_to = CASE
        WHEN p_payload ? 'sales_to' THEN (NULLIF(p_payload->>'sales_to', ''))::timestamptz
        ELSE p.sales_to
      END,
      min_tier_rank = COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, p.min_tier_rank),
      requires_verification = COALESCE(
        (NULLIF(p_payload->>'requires_verification', ''))::boolean, p.requires_verification),
      is_active = COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, p.is_active),
      sort_order = COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, p.sort_order)
    WHERE p.id = v_id AND p.tenant_id = v_tenant;

    RETURN v_id;
  END IF;

  IF v_key !~ '^[a-z][a-z0-9_]{1,48}$' THEN
    RAISE EXCEPTION 'invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$';
  END IF;

  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: ticket_type_id is required';
  END IF;

  INSERT INTO public.event_ticket_packages (
    tenant_id, event_id, ticket_type_id, key, name_pl, name_en,
    description_pl, description_en, audience, seats, price_cents, currency,
    quota, sales_from, sales_to, min_tier_rank, requires_verification,
    is_active, sort_order
  ) VALUES (
    v_tenant, v_event_id, v_ticket_id, v_key, v_name_pl, v_name_en,
    btrim(COALESCE(p_payload->>'description_pl', '')),
    btrim(COALESCE(p_payload->>'description_en', '')),
    COALESCE(NULLIF(p_payload->>'audience', ''), 'company'),
    COALESCE(v_seats, 2),
    COALESCE((NULLIF(p_payload->>'price_cents', ''))::integer, 0),
    COALESCE(NULLIF(p_payload->>'currency', ''), 'PLN'),
    (NULLIF(p_payload->>'quota', ''))::integer,
    (NULLIF(p_payload->>'sales_from', ''))::timestamptz,
    (NULLIF(p_payload->>'sales_to', ''))::timestamptz,
    COALESCE((NULLIF(p_payload->>'min_tier_rank', ''))::integer, 0),
    COALESCE((NULLIF(p_payload->>'requires_verification', ''))::boolean, false),
    COALESCE((NULLIF(p_payload->>'is_active', ''))::boolean, true),
    COALESCE((NULLIF(p_payload->>'sort_order', ''))::integer, 100)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_upsert(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_package_upsert(jsonb) IS
  'Dodanie albo edycja pakietu miejsc. Klucz i wydarzenie niezmienne po zapisie.';

DROP FUNCTION IF EXISTS public.admin_event_package_delete(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_package_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_used integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.event_ticket_packages p WHERE p.id = _id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: package does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.event_package_orders o
  WHERE o.tenant_id = v_tenant AND o.package_id = _id;

  IF v_used > 0 THEN
    RAISE EXCEPTION 'package_in_use: % order(s) use this package', v_used;
  END IF;

  DELETE FROM public.event_ticket_packages p WHERE p.id = _id AND p.tenant_id = v_tenant;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_delete(uuid) TO authenticated, service_role;

-- ZAMOWIENIA ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_package_orders_list(p_event_id uuid, p_package_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_package_orders_list(
  p_event_id uuid,
  p_package_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  package_id uuid,
  package_name_pl text,
  package_name_en text,
  buyer_email text,
  buyer_name text,
  seats_total integer,
  seats_assigned integer,
  seats_invited integer,
  status text,
  amount_cents integer,
  discount_cents integer,
  currency text,
  invoice_note text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    o.id, o.event_id, o.package_id, p.name_pl, p.name_en,
    o.buyer_email, o.buyer_name, o.seats_total, o.seats_assigned,
    (SELECT count(*)::integer FROM public.event_package_seats s
      WHERE s.package_order_id = o.id
        AND s.invite_email IS NOT NULL
        AND s.registration_id IS NULL
        AND s.revoked_at IS NULL),
    o.status, o.amount_cents, o.discount_cents, o.currency, o.invoice_note,
    o.paid_at, o.cancelled_at, o.created_at, o.updated_at
  FROM public.event_package_orders o
  JOIN public.event_ticket_packages p
    ON p.id = o.package_id AND p.tenant_id = v_tenant
  WHERE o.tenant_id = v_tenant
    AND o.event_id = p_event_id
    AND (p_package_id IS NULL OR o.package_id = p_package_id)
  ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_orders_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_orders_list(uuid, uuid)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_event_package_order_create(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_package_order_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_package public.event_ticket_packages;
  v_package_id uuid := NULLIF(p_payload->>'package_id', '')::uuid;
  v_email text := lower(btrim(COALESCE(p_payload->>'buyer_email', '')));
  v_name text := btrim(COALESCE(p_payload->>'buyer_name', ''));
  v_seats integer;
  v_order_id uuid;
BEGIN
  IF v_package_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: package_id is required';
  END IF;

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

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_email, buyer_name, seats_total,
    status, amount_cents, currency, invoice_note, created_by
  ) VALUES (
    v_tenant, v_package.event_id, v_package.id, v_email, v_name, v_seats,
    'pending',
    COALESCE((NULLIF(p_payload->>'amount_cents', ''))::integer, v_package.price_cents),
    v_package.currency,
    left(btrim(COALESCE(p_payload->>'invoice_note', '')), 500),
    v_uid
  )
  RETURNING id INTO v_order_id;

  -- Miejsca powstaja razem z zamowieniem: pusty wiersz jest jedynym miejscem,
  -- w ktore da sie pozniej wpisac uczestnika bez wyscigu o licznik.
  INSERT INTO public.event_package_seats (tenant_id, event_id, package_order_id)
  SELECT v_tenant, v_package.event_id, v_order_id
  FROM generate_series(1, v_seats);

  UPDATE public.event_ticket_packages p
  SET sold_count = p.sold_count + 1
  WHERE p.id = v_package.id AND p.tenant_id = v_tenant;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_order_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_order_create(jsonb)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_event_package_order_set_status(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_package_order_set_status(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_status text := lower(btrim(COALESCE(p_payload->>'status', '')));
  v_order public.event_package_orders;
BEGIN
  IF v_status NOT IN ('pending', 'paid', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'invalid_status: unknown order status';
  END IF;

  SELECT * INTO v_order
  FROM public.event_package_orders o
  WHERE o.id = v_id AND o.tenant_id = v_tenant
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'not_found: order does not exist in this tenant';
  END IF;

  UPDATE public.event_package_orders o SET
    status = v_status,
    paid_at = CASE WHEN v_status IN ('paid', 'refunded') THEN COALESCE(o.paid_at, now()) END,
    cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(o.cancelled_at, now()) END
  WHERE o.id = v_id AND o.tenant_id = v_tenant;

  -- Anulowane zamowienie nie moze trzymac zaproszen, ktore ktos jeszcze przyjmie.
  IF v_status = 'cancelled' THEN
    UPDATE public.event_package_seats s SET
      revoked_at = now(),
      invite_email = NULL,
      invite_token_hash = NULL
    WHERE s.package_order_id = v_id
      AND s.tenant_id = v_tenant
      AND s.registration_id IS NULL
      AND s.revoked_at IS NULL;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_order_set_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_order_set_status(jsonb)
  TO authenticated, service_role;

-- MIEJSCA I ZAPROSZENIA -------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_package_seats_list(p_order_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_package_seats_list(p_order_id uuid)
RETURNS TABLE (
  id uuid,
  package_order_id uuid,
  invite_email text,
  invite_name text,
  invite_sent_at timestamptz,
  invite_expires_at timestamptz,
  registration_id uuid,
  registration_status text,
  attendee_name text,
  assigned_at timestamptz,
  revoked_at timestamptz,
  state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.package_order_id, s.invite_email, s.invite_name,
    s.invite_sent_at, s.invite_expires_at, s.registration_id, r.status,
    btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')),
    s.assigned_at, s.revoked_at,
    CASE
      WHEN s.revoked_at IS NOT NULL THEN 'revoked'
      WHEN s.registration_id IS NOT NULL THEN 'assigned'
      WHEN s.invite_email IS NOT NULL THEN 'invited'
      ELSE 'free'
    END
  FROM public.event_package_seats s
  LEFT JOIN public.event_registrations r
    ON r.id = s.registration_id AND r.tenant_id = v_tenant
  LEFT JOIN public.event_people pe
    ON pe.id = r.person_id AND pe.tenant_id = v_tenant
  WHERE s.tenant_id = v_tenant AND s.package_order_id = p_order_id
  ORDER BY s.created_at, s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_seats_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_seats_list(uuid)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_event_package_seat_invite(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_package_seat_invite(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

  IF v_status = 'cancelled' THEN
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
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_seat_invite(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_seat_invite(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_package_seat_invite(jsonb) IS
  'Zaproszenie na miejsce z pakietu. Token jawny wraca raz, w bazie zostaje wylacznie skrot.';

DROP FUNCTION IF EXISTS public.admin_event_package_seat_revoke(_id uuid);
CREATE OR REPLACE FUNCTION public.admin_event_package_seat_revoke(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  UPDATE public.event_package_seats s SET
    invite_email = NULL,
    invite_token_hash = NULL,
    invite_sent_at = NULL,
    invite_expires_at = NULL
  WHERE s.id = _id
    AND s.tenant_id = v_tenant
    AND s.registration_id IS NULL
    AND s.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: no pending invitation on this seat';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_package_seat_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_package_seat_revoke(uuid)
  TO authenticated, service_role;

-- PRZYJECIE ZAPROSZENIA PRZEZ UCZESTNIKA --------------------------------------
DROP FUNCTION IF EXISTS public.event_package_invite_accept(p_payload jsonb);
CREATE OR REPLACE FUNCTION public.event_package_invite_accept(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_cancelled: the order behind this seat is cancelled';
  END IF;

  SELECT * INTO v_package
  FROM public.event_ticket_packages p
  WHERE p.id = v_order.package_id AND p.tenant_id = v_tenant;

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

  v_qr := public._event_new_qr_token();
  v_manage := public._event_new_qr_token();

  -- Miejsce jest juz oplacone przez firme, wiec zgloszenie wchodzi zatwierdzone;
  -- pula biletu nie jest tu dotykana, bo zajely ja miejsca pakietu.
  INSERT INTO public.event_registrations (
    tenant_id, event_id, person_id, ticket_type_id, group_id, status,
    registration_mode, answers, source, decided_at, decision_source,
    qr_token_hash, qr_issued_at, manage_token_hash, created_by
  ) VALUES (
    v_tenant, v_seat.event_id, v_person_id, v_package.ticket_type_id, v_group_id,
    'approved', 'form', v_answers, 'package_invitation', now(), 'system',
    encode(digest(v_qr, 'sha256'), 'hex'), now(),
    encode(digest(v_manage, 'sha256'), 'hex'), v_uid
  )
  RETURNING id INTO v_reg_id;

  UPDATE public.event_package_seats s SET
    registration_id = v_reg_id,
    assigned_at = now(),
    invite_token_hash = NULL
  WHERE s.id = v_seat.id AND s.tenant_id = v_tenant;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_reg_id::text,
    'event.registration.created.v1',
    jsonb_build_object(
      'event_id', v_seat.event_id,
      'person_id', v_person_id,
      'status', 'approved',
      'ticket_type_id', v_package.ticket_type_id,
      'source', 'package_invitation'
    ),
    v_uid
  );

  RETURN jsonb_build_object(
    'registration_id', v_reg_id,
    'event_id', v_seat.event_id,
    'status', 'approved',
    'qr_token', v_qr,
    'manage_token', v_manage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_package_invite_accept(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_package_invite_accept(jsonb)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.event_package_invite_accept(jsonb) IS
  'Przyjecie zaproszenia na miejsce z pakietu: tworzy zatwierdzone zgloszenie uczestnika. Token porownywany po skrocie, jednorazowy, z limitem prob.';
