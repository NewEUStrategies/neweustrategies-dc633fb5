CREATE OR REPLACE FUNCTION public.event_register_group_guests(p_lead_registration_id uuid, p_guests jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c_codes CONSTANT text[] := ARRAY[
    'invalid_guests', 'not_found', 'event_ended', 'registration_closed',
    'already_settled', 'group_not_enabled', 'group_too_large', 'sold_out',
    'invalid_name', 'invalid_email', 'already_registered'
  ]::text[];
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_out jsonb;
  v_head text;
  v_tail text;
  v_event_id uuid;
  v_ticket_id uuid;
  v_event public.events;
  v_lead public.event_registrations;
  v_ticket public.event_ticket_types;
  v_guest jsonb;
  v_email text;
  v_first text;
  v_last text;
  v_person uuid;
  v_count integer;
  v_existing integer;
  v_seats integer;
  v_guest_status text;
  v_inherit boolean;
  v_token text;
  v_reg uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_required');
  END IF;

  SELECT h.allowed INTO v_allowed
    FROM public.rate_limit_hit('event_register.guests', 'user:' || v_uid::text, 12, 10) h;
  IF NOT COALESCE(v_allowed, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited');
  END IF;

  BEGIN
    IF jsonb_typeof(p_guests) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_guests';
    END IF;
    v_count := jsonb_array_length(p_guests);
    IF v_count = 0 THEN
      RETURN jsonb_build_object('ok', true, 'added', 0, 'registration_ids', '[]'::jsonb);
    END IF;

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

    FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
      v_email := lower(btrim(COALESCE(v_guest->>'email', '')));
      v_first := btrim(COALESCE(v_guest->>'first_name', ''));
      v_last := btrim(COALESCE(v_guest->>'last_name', ''));
      IF v_first = '' OR v_last = '' OR char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
        RAISE EXCEPTION 'invalid_name';
      END IF;
      IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' OR char_length(v_email) > 320 THEN
        RAISE EXCEPTION 'invalid_email';
      END IF;

      SELECT p.id INTO v_person
        FROM public.event_people p
       WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
      IF v_person IS NULL THEN
        INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source, created_by)
        VALUES (v_tenant, v_email, v_first, v_last, 'invitation', v_uid)
        RETURNING id INTO v_person;
      END IF;

      IF EXISTS (SELECT 1 FROM public.event_registrations r
        WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id
          AND r.person_id = v_person AND r.status NOT IN ('cancelled', 'rejected')) THEN
        RAISE EXCEPTION 'already_registered: %', v_email;
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
      v_ids := v_ids || v_reg;

      PERFORM public.emit_domain_event(v_tenant, 'event_registration', v_reg::text,
        'event.registration.created.v1',
        jsonb_build_object('event_id', v_event_id, 'person_id', v_person,
          'ticket_type_id', v_ticket.id, 'source', 'group_registration',
          'group_lead_registration_id', v_lead.id), v_uid);
    END LOOP;

    v_out := jsonb_build_object('ok', true, 'added', v_count, 'registration_ids', to_jsonb(v_ids));
  EXCEPTION
    WHEN raise_exception THEN
      v_head := btrim(split_part(SQLERRM, ':', 1));
      v_tail := CASE WHEN strpos(SQLERRM, ':') > 0
                     THEN btrim(substr(SQLERRM, strpos(SQLERRM, ':') + 1)) ELSE '' END;
      IF NOT (v_head = ANY (c_codes)) THEN
        RAISE WARNING 'event_register_group_guests: unmapped refusal %', left(v_head, 64);
        v_head := 'unknown';
      END IF;
      v_out := jsonb_build_object('ok', false, 'error', v_head);
      IF v_head = 'already_registered' AND v_tail <> '' THEN
        v_out := v_out || jsonb_build_object('detail', v_tail);
      END IF;
    WHEN OTHERS THEN
      RAISE WARNING 'event_register_group_guests: unexpected % (%)', SQLSTATE, SQLERRM;
      v_head := 'unknown';
      v_out := jsonb_build_object('ok', false, 'error', v_head);
  END;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.event_register_group_guests(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_register_group_guests(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.event_register_group_guests(uuid, jsonb) IS
  'Dopisanie gosci do WLASNEGO zgloszenia prowadzacego (najemca z hosta, konto z auth.uid(); wlasnosc: created_by albo osoba z kontem). Kubelek konta event_register.guests 12/10 min liczony przed praca; odmowy jako wartosc {ok:false, error, detail?} (detail tylko already_registered = adres goscia). Blokady wydarzenie -> bilet -> zgloszenie (REG-08), event_ended po COALESCE(ends_at, starts_at) (REG-13), gosc pending przy prowadzacym w kolejce albo bez wplaty, approved z kodem QR tylko przy prowadzacym na miejscu z biletem bezplatnym (REG-07), oferta ceny prowadzacego kopiowana (REG-16), nowa osoba source invitation bez zgod, istniejaca osoba nietknieta (REG-14/REG-02). Sukces: {ok:true, added, registration_ids}.';