CREATE OR REPLACE FUNCTION public._event_waitlist_promote(
  _tenant uuid,
  _event_id uuid,
  _ticket_type_id uuid,
  _limit integer,
  _skip_group uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 1), 1), 500);
  v_row record;
  v_left integer;
  v_token text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_status text;
  v_promoted jsonb := '[]'::jsonb;
BEGIN
  IF _tenant IS NULL OR _event_id IS NULL THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  SELECT e.starts_at, e.ends_at, e.status INTO v_starts, v_ends, v_status
    FROM public.events e
   WHERE e.id = _event_id AND e.tenant_id = _tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  IF now() >= public._event_effective_end(v_starts, v_ends) THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('promoted', 0, 'registrations', '[]'::jsonb);
  END IF;

  IF _ticket_type_id IS NOT NULL THEN
    PERFORM 1 FROM public.event_ticket_types t
    WHERE t.id = _ticket_type_id AND t.tenant_id = _tenant AND t.event_id = _event_id
    FOR UPDATE;
  END IF;

  FOR v_row IN
    SELECT r.id, r.person_id, r.ticket_type_id, p.email, p.first_name, p.last_name, p.user_id
    FROM public.event_registrations r
    JOIN public.event_people p
      ON p.id = r.person_id AND p.tenant_id = r.tenant_id
    WHERE r.tenant_id = _tenant
      AND r.event_id = _event_id
      AND r.status = 'waitlist'
      AND r.payment_status IN ('paid', 'partially_refunded', 'not_required')
      AND (_ticket_type_id IS NULL OR r.ticket_type_id = _ticket_type_id)
      AND (_skip_group IS NULL
           OR (r.id <> _skip_group
               AND r.group_lead_registration_id IS DISTINCT FROM _skip_group))
    ORDER BY r.waitlist_position NULLS LAST, r.created_at, r.id
    LIMIT v_limit
  LOOP
    v_left := public._event_seats_left(_tenant, _event_id, v_row.ticket_type_id);
    EXIT WHEN v_left IS NOT NULL AND v_left <= 0;

    v_token := public._event_new_qr_token();

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        promoted_at = now(),
        waitlist_notified_at = NULL,
        decided_at = now(),
        decided_by = NULL,
        decision_source = 'system',
        qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        qr_issued_at = now()
    WHERE r.id = v_row.id AND r.tenant_id = _tenant AND r.status = 'waitlist'
      AND r.payment_status IN ('paid', 'partially_refunded', 'not_required');

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_promoted := v_promoted || jsonb_build_object(
      'registration_id', v_row.id,
      'person_id', v_row.person_id,
      'email', v_row.email,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'user_id', v_row.user_id,
      'ticket_type_id', v_row.ticket_type_id
    );

    PERFORM public.emit_domain_event(
      _tenant,
      'event_registration',
      v_row.id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', _event_id, 'person_id', v_row.person_id),
      auth.uid()
    );
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', jsonb_array_length(v_promoted),
    'registrations', v_promoted
  );
END;
$$;

REVOKE ALL ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid)
  TO service_role;

COMMENT ON FUNCTION public._event_waitlist_promote(uuid, uuid, uuid, integer, uuid) IS
  'Promuje osoby z listy rezerwowej na zwolnione miejsca: blokada wydarzenie -> bilet (REG-08), po efektywnym koncu wydarzenia i na wydarzeniu odwolanym zero awansow (REG-13, R45), kandydat tylko rozliczony - paid | partially_refunded | not_required (REG-07; nieoplacony czeka na swojej pozycji), liczenie miejsc przed kazdym awansem, z pominieciem zgloszenia _skip_group i jego gosci (NULL = bez pominiecia). Awans kasuje waitlist_notified_at. Zwraca promowane wiersze - wysylka nalezy do warstwy znajacej jezyk odbiorcy.';

CREATE OR REPLACE FUNCTION public.admin_event_waitlist_promote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_uid uuid := auth.uid();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_ticket_id uuid := NULLIF(p_payload->>'ticket_type_id', '')::uuid;
  v_count integer := LEAST(GREATEST(COALESCE((NULLIF(p_payload->>'count', ''))::integer, 1), 1), 500);
  v_reg public.event_registrations;
  v_seats_left integer;
  v_token text;
  v_event_status text;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  IF v_reg_id IS NOT NULL THEN
    SELECT * INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant;

    IF v_reg.id IS NULL THEN
      RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
    END IF;
    IF v_reg.status <> 'waitlist' THEN
      RAISE EXCEPTION 'invalid_transition: % is not on the waiting list', v_reg.status;
    END IF;

    SELECT e.status, e.starts_at, e.ends_at INTO v_event_status, v_starts, v_ends
    FROM public.events e
    WHERE e.id = v_reg.event_id AND e.tenant_id = v_tenant
    FOR UPDATE;

    IF v_event_status = 'cancelled' THEN
      RAISE EXCEPTION 'event_cancelled: the event has been cancelled';
    END IF;
    IF now() >= public._event_effective_end(v_starts, v_ends) THEN
      RAISE EXCEPTION 'event_ended: the event has already ended';
    END IF;

    IF v_reg.ticket_type_id IS NOT NULL THEN
      PERFORM 1 FROM public.event_ticket_types t
      WHERE t.id = v_reg.ticket_type_id AND t.tenant_id = v_tenant
      FOR UPDATE;
    END IF;

    SELECT * INTO v_reg
    FROM public.event_registrations r
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant
    FOR UPDATE;
    IF v_reg.status IS DISTINCT FROM 'waitlist' THEN
      RAISE EXCEPTION 'invalid_transition: registration is no longer on the waiting list';
    END IF;

    v_seats_left := public._event_seats_left(v_tenant, v_reg.event_id, v_reg.ticket_type_id);
    IF v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN
      RAISE EXCEPTION 'no_seats_left: no free seat for this ticket';
    END IF;

    IF v_reg.payment_status IN ('paid', 'partially_refunded', 'not_required') THEN
      v_token := public._event_new_qr_token();
    END IF;

    UPDATE public.event_registrations r
    SET status = 'approved',
        waitlist_position = NULL,
        waitlist_notified_at = NULL,
        promoted_at = now(),
        decided_by = v_uid,
        decided_at = now(),
        decision_source = 'organizer',
        qr_token_hash = CASE
          WHEN v_token IS NOT NULL THEN encode(digest(v_token, 'sha256'), 'hex')
        END,
        qr_issued_at = CASE WHEN v_token IS NOT NULL THEN now() END
    WHERE r.id = v_reg_id AND r.tenant_id = v_tenant AND r.status = 'waitlist';

    PERFORM public.emit_domain_event(
      v_tenant,
      'event_registration',
      v_reg_id::text,
      'event.registration.promoted.v1',
      jsonb_build_object('event_id', v_reg.event_id, 'person_id', v_reg.person_id, 'manual', true),
      v_uid
    );

    RETURN jsonb_build_object(
      'promoted', 1,
      'registrations', jsonb_build_array(jsonb_build_object(
        'registration_id', v_reg_id,
        'person_id', v_reg.person_id
      )),
      'qr_token', v_token
    );
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: event_id or registration_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  RETURN public._event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_waitlist_promote(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_waitlist_promote(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_waitlist_promote(jsonb) IS
  'Reczna promocja z listy rezerwowej: wskazany zapis poza kolejnoscia (ze sladem decyzji organizatora, stan sprawdzany pod blokadami wydarzenie -> bilet -> zgloszenie; kod QR tylko dla rozliczonego - REG-07; na wydarzeniu odwolanym event_cancelled, po efektywnym koncu event_ended - R45) albo N pierwszych ROZLICZONYCH z kolejki przez _event_waitlist_promote (po koncu i na odwolanym zero). Odpowiedz: promoted = faktyczna liczba awansow. Najemca z assert_editor_tenant().';

CREATE OR REPLACE FUNCTION public._event_ticket_codes_pending(p_limit integer DEFAULT 50)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(array_agg(q.id ORDER BY q.created_at), ARRAY[]::uuid[])
  FROM (
    SELECT reg.id, reg.created_at
    FROM public.event_registrations reg
    JOIN public.events e ON e.id = reg.event_id AND e.tenant_id = reg.tenant_id
    WHERE reg.ticket_code_sent_at IS NULL
      AND reg.status IN ('approved', 'attended')
      AND reg.payment_status IN ('paid', 'partially_refunded', 'not_required')
      AND (reg.registration_mode = 'form' OR reg.source = 'self_registration')
      AND (reg.ticket_code_claimed_at IS NULL
           OR reg.ticket_code_claimed_at < now() - interval '15 minutes')
      AND COALESCE(e.ends_at, e.starts_at + interval '1 day') > now()
      AND e.status IS DISTINCT FROM 'cancelled'
    ORDER BY reg.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500)
  ) q;
$$;
REVOKE ALL ON FUNCTION public._event_ticket_codes_pending(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_ticket_codes_pending(integer) TO service_role;

COMMENT ON FUNCTION public._event_ticket_codes_pending(integer) IS
  'Kolejka crona biletow: przyjete i rozliczone zgloszenia bez wyslanego biletu (dzierzawa 15 min), tylko wydarzenia nieodwolane (R45) i przed koncem. Tylko service_role.';

CREATE OR REPLACE FUNCTION public._event_registration_paid_admission(
  p_reg public.event_registrations,
  p_ticket_type_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_left integer;
  v_needs boolean;
  v_event_status text;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  IF p_reg.status NOT IN ('draft', 'pending', 'waitlist') THEN
    RETURN p_reg.status;
  END IF;

  SELECT e.status, e.starts_at, e.ends_at INTO v_event_status, v_starts, v_ends
    FROM public.events e
   WHERE e.id = p_reg.event_id AND e.tenant_id = p_reg.tenant_id;
  IF v_event_status = 'cancelled' OR now() >= public._event_effective_end(v_starts, v_ends) THEN
    RETURN p_reg.status;
  END IF;

  IF p_reg.group_lead_registration_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_registrations l
      WHERE l.id = p_reg.group_lead_registration_id
        AND l.tenant_id = p_reg.tenant_id
        AND l.status IN ('approved', 'attended', 'no_show')
    ) THEN
      RETURN p_reg.status;
    END IF;
  ELSIF p_reg.status <> 'waitlist' THEN
    SELECT COALESCE(t.requires_approval, false)
        OR CASE public._event_registration_verdict(p_reg.tenant_id, p_reg.event_id, p_reg.answers)
             WHEN 'auto_approve' THEN false
             WHEN 'none' THEN e.registration_flow = 'approval'
             ELSE true
           END
      INTO v_needs
    FROM public.events e
    LEFT JOIN public.event_ticket_types t
      ON t.id = p_ticket_type_id AND t.tenant_id = e.tenant_id AND t.event_id = e.id
    WHERE e.id = p_reg.event_id AND e.tenant_id = p_reg.tenant_id;

    IF COALESCE(v_needs, false) THEN
      RETURN 'pending';
    END IF;
  END IF;

  v_left := public._event_seats_left(p_reg.tenant_id, p_reg.event_id, p_ticket_type_id);
  RETURN CASE WHEN v_left IS NULL OR v_left > 0 THEN 'approved' ELSE 'waitlist' END;
END $$;
REVOKE ALL ON FUNCTION public._event_registration_paid_admission(public.event_registrations, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._event_registration_paid_admission(public.event_registrations, uuid) IS
  'Status oplaconego zgloszenia po wplacie: przyjete/obecne/nieobecne/odwolane/odrzucone bez zmian; wydarzenie odwolane albo po efektywnym koncu bez zmian (R45); gosc bez prowadzacego na miejscu bez zmian; zgloszenie wymagajace akceptacji (bilet requires_approval, przeplyw approval bez reguly auto_approve, regula approval albo reject) -> pending; poza tym miejsce (_event_seats_left) -> approved, brak -> waitlist. Zgloszenie juz w kolejce pomija akceptacje. Wolajacy trzyma blokade wydarzenia i biletu.';