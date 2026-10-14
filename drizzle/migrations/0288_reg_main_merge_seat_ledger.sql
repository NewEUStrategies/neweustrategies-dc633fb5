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
  v_left integer;
  v_open integer;
  v_starts timestamptz;
  v_pay_by timestamptz;
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

  SELECT e.starts_at INTO v_starts
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND e.id = (SELECT p.event_id FROM public.event_ticket_packages p
                WHERE p.id = v_package_id AND p.tenant_id = v_tenant)
  FOR UPDATE;

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
  SELECT count(*)::integer INTO v_open
  FROM public.event_package_orders o
  WHERE o.tenant_id = v_tenant AND o.event_id = v_pkg.event_id
    AND o.buyer_user_id = v_uid AND o.status = 'pending';
  IF v_pkg.max_open_orders_per_buyer IS NOT NULL AND v_open >= v_pkg.max_open_orders_per_buyer THEN
    RAISE EXCEPTION 'too_many_open_orders: pay or cancel an open order before buying another package';
  END IF;

  v_left := public._event_seats_left(v_tenant, v_pkg.event_id, v_type.id);
  IF v_left IS NOT NULL AND v_left < v_pkg.seats THEN
    RAISE EXCEPTION 'seats_exhausted: not enough seats left for a whole package';
  END IF;

  v_pay_by := now() + make_interval(days => v_pkg.payment_terms_days);
  IF v_starts IS NOT NULL AND v_starts > now() THEN
    v_pay_by := LEAST(v_pay_by, v_starts);
  END IF;

  INSERT INTO public.event_package_orders (
    tenant_id, event_id, package_id, buyer_user_id, company_id,
    buyer_email, buyer_name, seats_total, status,
    amount_cents, discount_cents, currency, coupon_id, invoice_note, created_by, pay_by
  ) VALUES (
    v_tenant, v_pkg.event_id, v_package_id, v_uid, NULL,
    CASE WHEN v_email <> '' THEN v_email
         ELSE lower(btrim((SELECT u.email FROM auth.users u WHERE u.id = v_uid))) END,
    v_name, v_pkg.seats, 'pending',
    v_total, v_discount, v_pkg.currency, v_coupon_id, v_note, v_uid, v_pay_by
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
      AND public._b2b_coupon_window_open(c.valid_from, c.valid_until);
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

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'seats', v_pkg.seats,
    'currency', v_pkg.currency,
    'total_cents', v_total,
    'discount_cents', v_discount,
    'status', 'pending',
    'pay_by', v_pay_by
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._event_package_purchase(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_package_purchase(jsonb, text) TO service_role;

COMMENT ON FUNCTION public._event_package_purchase(jsonb, text) IS
  'Zakup samoobslugowy pakietu (wycena _event_admission_quote, pudlo kodu wartoscia). Blokady wydarzenie -> bilet -> pakiet (R45/REG-08), kontrola puli biletu i sali przez _event_seats_left (TIX-04), limit otwartych zamowien kupujacego i termin platnosci pay_by (TIX-07), okno kodu _b2b_coupon_window_open (TIX-13b), zuzycie kodu w tej samej transakcji. Pula biletu przelicza sie triggerem miejsc pakietu - bez recznego + seats. Wewnetrzna: wolaja ja wejscia z kontrola tozsamosci.';

CREATE OR REPLACE FUNCTION public._event_reveal_coupon_covers(
  p_tenant uuid, p_event_id uuid, p_ticket_id uuid, p_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_tenant IS NOT NULL
     AND p_event_id IS NOT NULL
     AND p_ticket_id IS NOT NULL
     AND length(upper(btrim(COALESCE(p_code, '')))) BETWEEN 1 AND 64
     AND EXISTS (
       SELECT 1
         FROM public.event_ticket_types t
        WHERE t.tenant_id = p_tenant
          AND t.event_id = p_event_id
          AND t.id = p_ticket_id
     )
     AND EXISTS (
       SELECT 1
         FROM public.b2b_coupons c
        WHERE c.tenant_id = p_tenant
          AND upper(c.code) = upper(btrim(p_code))
          AND c.active
          AND c.reveals_hidden
          AND p_event_id = ANY (c.event_ids)
          AND public._b2b_coupon_window_open(c.valid_from, c.valid_until)
          AND (c.max_redemptions IS NULL OR c.redemptions_count < c.max_redemptions)
          AND (array_length(c.ticket_type_ids, 1) IS NULL OR p_ticket_id = ANY (c.ticket_type_ids))
     );
$$;
REVOKE ALL ON FUNCTION public._event_reveal_coupon_covers(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_reveal_coupon_covers(uuid, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_reveal_coupon_covers(uuid, uuid, uuid, text) IS
  'REG-05: czy kod reveals_hidden (aktywny, w oknie _b2b_coupon_window_open - TIX-13b, ponizej limitu, z tym wydarzeniem i biletem albo bez listy biletow) odslania bilet tego wydarzenia w tym najemcy. Jedna regula dla zapisu (_event_register), odslaniania (event_registration_revealed_tickets) i event_coupon_revealed_tickets. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public.event_coupon_revealed_tickets(p_tenant uuid, p_event_id uuid, p_code text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_norm text := upper(btrim(COALESCE(p_code, '')));
  v_ids uuid[];
BEGIN
  IF p_tenant IS NULL OR p_event_id IS NULL OR v_norm = '' OR length(v_norm) > 64 THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.event_ticket_types t
   WHERE t.tenant_id = p_tenant AND t.event_id = p_event_id AND t.is_hidden
     AND public._event_reveal_coupon_covers(p_tenant, p_event_id, t.id, v_norm);
  RETURN v_ids;
END $$;
REVOKE ALL ON FUNCTION public.event_coupon_revealed_tickets(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_coupon_revealed_tickets(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.event_coupon_revealed_tickets(uuid, uuid, text) IS
  'Ukryte bilety odslaniane kodem w danym wydarzeniu (identyfikatory). Wylacznie service_role z jawnym najemca: limit prob (IP + uzytkownik) stoi przed baza, w funkcji serwerowej eventCodeReveal. Predykat _event_reveal_coupon_covers (ten sam co przy zapisie). Kazda odmowa to pusta lista. Formularz woluje pelne wiersze z event_registration_revealed_tickets.';

CREATE OR REPLACE FUNCTION public._event_register_group_guests(
  p_tenant uuid,
  p_uid uuid,
  p_lead_registration_id uuid,
  p_guests jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c_codes CONSTANT text[] := ARRAY[
    'invalid_guests', 'duplicate_guest', 'not_found', 'event_ended', 'registration_closed',
    'already_settled', 'group_not_enabled', 'group_too_large', 'sold_out',
    'invalid_name', 'invalid_email',
    'checkout_in_progress'
  ]::text[];
  v_tenant uuid := p_tenant;
  v_uid uuid := p_uid;
  v_client jsonb;
  v_notices jsonb := '[]'::jsonb;
  v_head text;
  v_event_id uuid;
  v_ticket_id uuid;
  v_event public.events;
  v_lead public.event_registrations;
  v_ticket public.event_ticket_types;
  v_event_json jsonb;
  v_guest jsonb;
  v_email text;
  v_first text;
  v_last text;
  v_emails text[] := ARRAY[]::text[];
  v_firsts text[] := ARRAY[]::text[];
  v_lasts text[] := ARRAY[]::text[];
  v_lead_email text;
  v_person uuid;
  v_taken_id uuid;
  v_taken_status text;
  v_count integer;
  v_existing integer;
  v_seats integer;
  v_guest_status text;
  v_inherit boolean;
  v_token text;
  v_reg uuid;
  v_notice jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'account_required'),
      'delivery', '[]'::jsonb);
  END IF;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'not_found'),
      'delivery', '[]'::jsonb);
  END IF;

  BEGIN
    IF jsonb_typeof(p_guests) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_guests';
    END IF;
    v_count := jsonb_array_length(p_guests);
    IF v_count = 0 THEN
      RETURN jsonb_build_object(
        'client', jsonb_build_object('ok', true, 'added', 0),
        'delivery', '[]'::jsonb);
    END IF;
    IF v_count > 49 THEN
      RAISE EXCEPTION 'group_too_large';
    END IF;

    FOR v_guest IN SELECT g.value FROM jsonb_array_elements(p_guests) AS g(value) LOOP
      IF jsonb_typeof(v_guest) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid_guests';
      END IF;
      v_email := lower(btrim(COALESCE(v_guest->>'email', '')));
      v_first := btrim(COALESCE(v_guest->>'first_name', ''));
      v_last := btrim(COALESCE(v_guest->>'last_name', ''));
      IF v_first = '' OR v_last = '' OR char_length(v_first) > 80 OR char_length(v_last) > 80
         OR public._event_text_has_control(v_first) OR public._event_text_has_control(v_last) THEN
        RAISE EXCEPTION 'invalid_name';
      END IF;
      IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' OR char_length(v_email) > 320
         OR public._event_text_has_control(v_email) THEN
        RAISE EXCEPTION 'invalid_email';
      END IF;
      IF v_email = ANY (v_emails) THEN
        RAISE EXCEPTION 'duplicate_guest';
      END IF;
      v_emails := v_emails || v_email;
      v_firsts := v_firsts || v_first;
      v_lasts := v_lasts || v_last;
    END LOOP;

    SELECT r.event_id, r.ticket_type_id INTO v_event_id, v_ticket_id
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.id = p_lead_registration_id AND r.tenant_id = v_tenant
       AND r.group_lead_registration_id IS NULL
       AND (r.created_by = v_uid OR p.user_id = v_uid);
    IF v_event_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

    SELECT e.* INTO v_event
      FROM public.events e
     WHERE e.id = v_event_id AND e.tenant_id = v_tenant
     FOR UPDATE;
    IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;

    IF COALESCE(v_event.ends_at, v_event.starts_at) < now() THEN
      RAISE EXCEPTION 'event_ended';
    END IF;

    IF v_ticket_id IS NOT NULL THEN
      PERFORM 1 FROM public.event_ticket_types t
       WHERE t.id = v_ticket_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
       FOR UPDATE;
    END IF;

    SELECT r.* INTO v_lead
      FROM public.event_registrations r
      LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
     WHERE r.id = p_lead_registration_id AND r.tenant_id = v_tenant
       AND r.event_id = v_event_id
       AND r.group_lead_registration_id IS NULL
       AND (r.created_by = v_uid OR p.user_id = v_uid)
     FOR UPDATE OF r;
    IF v_lead.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    IF v_lead.status IN ('cancelled', 'rejected') THEN RAISE EXCEPTION 'registration_closed'; END IF;
    IF v_lead.payment_status NOT IN ('unpaid', 'not_required') THEN RAISE EXCEPTION 'already_settled'; END IF;
    IF v_lead.payment_status = 'unpaid'
       AND public._event_registration_checkout_open(v_tenant, v_lead.id) THEN
      RAISE EXCEPTION 'checkout_in_progress';
    END IF;

    SELECT p.email_norm INTO v_lead_email
      FROM public.event_people p
     WHERE p.id = v_lead.person_id AND p.tenant_id = v_tenant;
    IF v_lead_email IS NOT NULL AND v_lead_email = ANY (v_emails) THEN
      RAISE EXCEPTION 'duplicate_guest';
    END IF;

    SELECT t.* INTO v_ticket
      FROM public.event_ticket_types t
     WHERE t.id = v_lead.ticket_type_id AND t.tenant_id = v_tenant AND t.event_id = v_event_id
     FOR UPDATE;
    IF v_ticket.id IS NULL OR NOT v_ticket.group_registration_enabled THEN
      RAISE EXCEPTION 'group_not_enabled';
    END IF;

    SELECT count(*)::integer INTO v_existing
      FROM public.event_registrations r
     WHERE r.tenant_id = v_tenant
       AND r.group_lead_registration_id = v_lead.id
       AND r.status NOT IN ('cancelled', 'rejected');
    IF 1 + v_existing + v_count > v_ticket.group_max_size THEN
      RAISE EXCEPTION 'group_too_large';
    END IF;

    v_seats := public._event_seats_left(v_tenant, v_event_id, v_ticket.id);
    IF v_seats IS NOT NULL AND v_seats < v_count THEN RAISE EXCEPTION 'sold_out'; END IF;

    v_guest_status := CASE
      WHEN v_lead.status IN ('approved', 'attended', 'no_show')
           AND v_lead.payment_status = 'not_required' THEN 'approved'
      WHEN v_lead.status IN ('draft', 'pending') THEN v_lead.status
      ELSE 'pending'
    END;
    v_inherit := v_guest_status = v_lead.status
      OR (v_guest_status = 'approved' AND v_lead.status IN ('attended', 'no_show'));

    v_event_json := jsonb_build_object(
      'id', v_event.id, 'slug', v_event.slug, 'title_pl', v_event.title_pl,
      'title_en', v_event.title_en, 'starts_at', v_event.starts_at);

    FOR i IN 1 .. v_count LOOP
      v_email := v_emails[i];

      SELECT p.id INTO v_person
        FROM public.event_people p
       WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
      IF v_person IS NULL THEN
        INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source, created_by)
        VALUES (v_tenant, v_email, v_firsts[i], v_lasts[i], 'invitation', v_uid)
        ON CONFLICT (tenant_id, email_norm) WHERE email_norm IS NOT NULL DO NOTHING
        RETURNING id INTO v_person;
        IF v_person IS NULL THEN
          SELECT p.id INTO v_person
            FROM public.event_people p
           WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
        END IF;
      END IF;

      v_taken_id := NULL;
      v_taken_status := NULL;
      SELECT r.id, r.status INTO v_taken_id, v_taken_status
        FROM public.event_registrations r
       WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id
         AND r.person_id = v_person AND r.status NOT IN ('cancelled', 'rejected')
       LIMIT 1;
      IF v_taken_id IS NOT NULL THEN
        SELECT jsonb_build_object(
                 'kind', 'already_registered',
                 'registration_id', v_taken_id,
                 'status', v_taken_status,
                 'recipient', jsonb_build_object(
                   'email', p.email,
                   'first_name', p.first_name,
                   'lang', public._event_registration_lang(v_tenant, v_taken_id)),
                 'event', v_event_json,
                 'consent_confirmation', NULL)
          INTO v_notice
          FROM public.event_people p
         WHERE p.id = v_person AND p.tenant_id = v_tenant;
        IF v_notice IS NOT NULL THEN
          v_notices := v_notices || jsonb_build_array(v_notice);
        END IF;
        CONTINUE;
      END IF;

      v_token := CASE
        WHEN v_guest_status = 'approved' AND v_lead.payment_status = 'not_required'
          THEN public._event_new_qr_token()
      END;

      INSERT INTO public.event_registrations (
        tenant_id, event_id, person_id, ticket_type_id, group_id, status, registration_mode,
        answers, source, decided_at, decision_source, qr_token_hash, qr_issued_at,
        payment_status, created_by, group_lead_registration_id,
        quoted_price_cents, quoted_currency, quote_valid_until
      ) VALUES (
        v_tenant, v_event_id, v_person, v_ticket.id, v_lead.group_id,
        v_guest_status,
        v_lead.registration_mode, '{}'::jsonb, 'self_registration',
        CASE WHEN v_inherit THEN v_lead.decided_at END,
        CASE WHEN v_inherit THEN v_lead.decision_source END,
        CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex') END,
        CASE WHEN v_token IS NOT NULL THEN now() END,
        v_lead.payment_status, v_uid, v_lead.id,
        v_lead.quoted_price_cents, v_lead.quoted_currency, v_lead.quote_valid_until
      ) RETURNING id INTO v_reg;

      PERFORM public.emit_domain_event(v_tenant, 'event_registration', v_reg::text,
        'event.registration.created.v1',
        jsonb_build_object('event_id', v_event_id, 'person_id', v_person,
          'ticket_type_id', v_ticket.id, 'source', 'group_registration',
          'group_lead_registration_id', v_lead.id), v_uid);
    END LOOP;

    v_client := jsonb_build_object('ok', true, 'added', v_count);
  EXCEPTION
    WHEN raise_exception THEN
      v_head := btrim(split_part(SQLERRM, ':', 1));
      IF NOT (v_head = ANY (c_codes)) THEN
        RAISE WARNING '_event_register_group_guests: unmapped refusal %', left(v_head, 64);
        v_head := 'unknown';
      END IF;
      v_client := jsonb_build_object('ok', false, 'error', v_head);
      v_notices := '[]'::jsonb;
    WHEN OTHERS THEN
      RAISE WARNING '_event_register_group_guests: unexpected % (%)', SQLSTATE, SQLERRM;
      v_head := 'unknown';
      v_client := jsonb_build_object('ok', false, 'error', v_head);
      v_notices := '[]'::jsonb;
  END;

  RETURN jsonb_build_object('client', v_client, 'delivery', v_notices);
END;
$$;
REVOKE ALL ON FUNCTION public._event_register_group_guests(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_register_group_guests(uuid, uuid, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public._event_register_group_guests(uuid, uuid, uuid, jsonb) IS
  'Rdzen dopisania gosci do WLASNEGO zgloszenia prowadzacego (najemca i konto z argumentow; wlasnosc: created_by albo osoba z kontem). R38: cala lista walidowana PRZED odczytem czlonkostwa (ksztalt, <= 49 gosci, imiona, adresy, znaki sterujace, duplikat w liscie albo adres prowadzacego -> duplicate_guest); gosc z aktywnym zapisem pomijany bez sladu w client (added = liczba poprawnych gosci), wiadomosc do niego w delivery. Blokady wydarzenie -> bilet -> zgloszenie (REG-08), event_ended (REG-13), otwarta kasa prowadzacego -> checkout_in_progress (TIX-03), status gosci (REG-07), oferta ceny prowadzacego (REG-16), nowa osoba invitation bez zgod ON CONFLICT, istniejaca nietknieta (REG-14/REG-02). Wynik {client, delivery}; kubelki licza wejscia. Tylko service_role.';

CREATE OR REPLACE FUNCTION public.event_register_group_guests_for_client(
  _tenant_id uuid,
  _user_id uuid,
  _ip_subject text,
  p_lead_registration_id uuid,
  p_guests jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_role text := current_setting('request.jwt.claim.role', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_ip_ok boolean;
  v_user_ok boolean;
  v_out jsonb;
BEGIN
  IF _user_id IS NULL THEN
    PERFORM public._require_server_probe(_tenant_id, _ip_subject);
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'account_required'),
      'delivery', '[]'::jsonb);
  END IF;
  PERFORM public._require_server_identity(_tenant_id, _user_id, _ip_subject);

  SELECT h.allowed INTO v_ip_ok
    FROM public.rate_limit_hit('event_register.ip', _ip_subject, 120, 10) h;
  SELECT h.allowed INTO v_user_ok
    FROM public.rate_limit_hit('event_register.guests', 'user:' || _user_id::text, 12, 10) h;
  IF NOT COALESCE(v_ip_ok, false) OR NOT COALESCE(v_user_ok, false) THEN
    RETURN jsonb_build_object(
      'client', jsonb_build_object('ok', false, 'error', 'rate_limited'),
      'delivery', '[]'::jsonb);
  END IF;

  PERFORM public._set_request_identity(
    _user_id::text, 'authenticated',
    jsonb_build_object('sub', _user_id, 'role', 'authenticated')::text);
  v_out := public._event_register_group_guests(_tenant_id, _user_id, p_lead_registration_id, p_guests);
  PERFORM public._set_request_identity(v_prev_sub, v_prev_role, v_prev_claims);
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.event_register_group_guests_for_client(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register_group_guests_for_client(uuid, uuid, text, uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register_group_guests_for_client(uuid, uuid, text, uuid, jsonb) IS
  'Dopisanie gosci z funkcji serwerowej (registerEventGroupGuests) - TYLKO service_role. Najemca z zaufanego hosta, konto ze zweryfikowanej sesji (NULL = account_required), solony skrot adresu ip:<32 hex> - argumentami. Kubelki event_register.ip (120 / 10 min, wspolny z zapisem) i event_register.guests (12 / 10 min na konto) przed praca. Zwraca {client, delivery}: client {ok:true, added} | {ok:false, error} (bez detail); delivery = wiadomosci event_registration_already_registered dla pominietych gosci - tylko dla serwera.';

CREATE OR REPLACE FUNCTION public.event_register_group_guests(p_lead_registration_id uuid, p_guests jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_required');
  END IF;

  SELECT h.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_register.guests', 'user:' || v_uid::text, 12, 10) h;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  RETURN public._event_register_group_guests(
    public.public_tenant_id(), v_uid, p_lead_registration_id, p_guests)->'client';
END;
$$;
REVOKE ALL ON FUNCTION public.event_register_group_guests(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_register_group_guests(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.event_register_group_guests(uuid, jsonb) IS
  'Wrapper zgodnosci dopisania gosci - TYLKO service_role (od 20261012180300; dotad authenticated). Najemca z hosta, konto z JWT, kubelek konta event_register.guests (12 / 10 min), rdzen _event_register_group_guests; zwraca sam client ({ok:true, added} | {ok:false, error}), bez wiadomosci do pominietych gosci. Przegladarka dopisuje przez registerEventGroupGuests -> event_register_group_guests_for_client.';

REVOKE ALL ON FUNCTION public._event_seats_left(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_seats_left(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public._event_seats_left(uuid, uuid, uuid) IS
  'Wolne miejsca wydarzenia (i biletu, gdy podany). NULL = bez limitu. Liczy, nie rezerwuje: sala = pojemnosc minus zgloszenia na miejscu (approved/attended/no_show) i miejsca pakietow trzymane w puli (_event_package_seats_held, TIX-04); bilet = quota minus sold_count z ksiegi miejsc (zgloszenia + miejsca pakietow). Wolajacy, ktory potem zajmuje miejsce, trzyma FOR UPDATE na wierszu WYDARZENIA (zawsze), a na wierszu biletu - gdy bilet podany (kolejnosc wydarzenie -> bilet -> zgloszenie, REG-08). Tylko service_role i funkcje SECURITY DEFINER.';