-- Podatek per bilet (wliczony/doliczany; stawke ustala Stripe) oraz
-- rejestracja grupowa: kupujacy podaje dane kazdej osoby, placi raz,
-- kazdy dostaje wlasne zgloszenie i kod QR po oplaceniu.

ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'inclusive',
  ADD COLUMN IF NOT EXISTS group_max_size integer NOT NULL DEFAULT 10;
ALTER TABLE public.event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_tax_mode_values;
ALTER TABLE public.event_ticket_types ADD CONSTRAINT event_ticket_types_tax_mode_values
  CHECK (tax_mode IN ('inclusive','exclusive'));
ALTER TABLE public.event_ticket_types DROP CONSTRAINT IF EXISTS event_ticket_types_group_max_size_range;
ALTER TABLE public.event_ticket_types ADD CONSTRAINT event_ticket_types_group_max_size_range
  CHECK (group_max_size BETWEEN 2 AND 50);

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS group_lead_registration_id uuid
    REFERENCES public.event_registrations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS event_registrations_group_lead_idx
  ON public.event_registrations (group_lead_registration_id)
  WHERE group_lead_registration_id IS NOT NULL;

-- Admin: odczyt i zapis ustawien podatku / grupy.
CREATE OR REPLACE FUNCTION public.admin_event_ticket_tax_group(p_event_id uuid)
RETURNS TABLE(id uuid, tax_mode text, group_max_size integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY SELECT t.id, t.tax_mode, t.group_max_size
  FROM public.event_ticket_types t WHERE t.tenant_id = v_tenant AND t.event_id = p_event_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_event_ticket_set_tax_group(
  p_ticket_id uuid, p_tax_mode text, p_group_max_size integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_tenant uuid := public.assert_editor_tenant();
BEGIN
  IF p_tax_mode NOT IN ('inclusive','exclusive') THEN
    RAISE EXCEPTION 'invalid_tax_mode';
  END IF;
  UPDATE public.event_ticket_types t SET
    tax_mode = p_tax_mode,
    group_max_size = LEAST(GREATEST(COALESCE(p_group_max_size, 10), 2), 50),
    updated_at = now()
  WHERE t.id = p_ticket_id AND t.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: ticket does not exist in this tenant'; END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.admin_event_ticket_tax_group(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_event_ticket_set_tax_group(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_tax_group(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_ticket_set_tax_group(uuid, text, integer) TO authenticated;

-- Publiczne: tryb podatku i limit grupy biletu (bez danych wrazliwych).
CREATE OR REPLACE FUNCTION public.event_ticket_public_options(p_ticket_type_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
  SELECT jsonb_build_object(
    'tax_mode', t.tax_mode,
    'group_registration_enabled', t.group_registration_enabled,
    'group_max_size', t.group_max_size)
  FROM public.event_ticket_types t
  WHERE t.id = p_ticket_type_id AND t.tenant_id = public.public_tenant_id() AND t.is_active;
$$;
REVOKE ALL ON FUNCTION public.event_ticket_public_options(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_ticket_public_options(uuid) TO anon, authenticated, service_role;

-- Dopisanie gosci do zgloszenia prowadzacego. Wolajacy MUSI byc
-- wlascicielem zgloszenia, bilet musi miec wlaczona rejestracje grupowa.
CREATE OR REPLACE FUNCTION public.event_register_group_guests(p_lead_registration_id uuid, p_guests jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
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
  v_token text;
  v_reg uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'account_required'; END IF;
  IF jsonb_typeof(p_guests) <> 'array' THEN RAISE EXCEPTION 'invalid_guests'; END IF;
  v_count := jsonb_array_length(p_guests);
  IF v_count = 0 THEN RETURN jsonb_build_object('added', 0, 'registration_ids', '[]'::jsonb); END IF;

  SELECT r.* INTO v_lead FROM public.event_registrations r
  LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_lead_registration_id AND r.tenant_id = v_tenant
    AND r.group_lead_registration_id IS NULL
    AND (r.created_by = v_uid OR p.user_id = v_uid)
  FOR UPDATE OF r;
  IF v_lead.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_lead.status IN ('cancelled','rejected') THEN RAISE EXCEPTION 'registration_closed'; END IF;
  IF v_lead.payment_status NOT IN ('unpaid','not_required') THEN RAISE EXCEPTION 'already_settled'; END IF;

  SELECT * INTO v_ticket FROM public.event_ticket_types t
  WHERE t.id = v_lead.ticket_type_id AND t.tenant_id = v_tenant;
  IF v_ticket.id IS NULL OR NOT v_ticket.group_registration_enabled THEN
    RAISE EXCEPTION 'group_not_enabled';
  END IF;

  SELECT count(*)::integer INTO v_existing FROM public.event_registrations r
  WHERE r.group_lead_registration_id = v_lead.id AND r.status NOT IN ('cancelled','rejected');
  IF 1 + v_existing + v_count > v_ticket.group_max_size THEN
    RAISE EXCEPTION 'group_too_large';
  END IF;

  v_seats := public._event_seats_left(v_tenant, v_lead.event_id, v_ticket.id);
  IF v_seats IS NOT NULL AND v_seats < v_count THEN RAISE EXCEPTION 'sold_out'; END IF;

  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    v_email := lower(btrim(COALESCE(v_guest->>'email','')));
    v_first := btrim(COALESCE(v_guest->>'first_name',''));
    v_last := btrim(COALESCE(v_guest->>'last_name',''));
    IF v_first = '' OR v_last = '' OR char_length(v_first) > 80 OR char_length(v_last) > 80 THEN
      RAISE EXCEPTION 'invalid_name';
    END IF;
    IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' OR char_length(v_email) > 320 THEN
      RAISE EXCEPTION 'invalid_email';
    END IF;

    SELECT p.id INTO v_person FROM public.event_people p
    WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;
    IF v_person IS NULL THEN
      INSERT INTO public.event_people (tenant_id, email, first_name, last_name, source, created_by)
      VALUES (v_tenant, v_email, v_first, v_last, 'self_registration', v_uid)
      RETURNING id INTO v_person;
    END IF;

    IF EXISTS (SELECT 1 FROM public.event_registrations r
      WHERE r.tenant_id = v_tenant AND r.event_id = v_lead.event_id
        AND r.person_id = v_person AND r.status NOT IN ('cancelled','rejected')) THEN
      RAISE EXCEPTION 'already_registered: %', v_email;
    END IF;

    v_token := CASE WHEN v_lead.status = 'approved' AND v_lead.payment_status = 'not_required'
                    THEN public._event_new_qr_token() END;

    INSERT INTO public.event_registrations (
      tenant_id, event_id, person_id, ticket_type_id, group_id, status, registration_mode,
      answers, source, decided_at, decision_source, qr_token_hash, qr_issued_at,
      payment_status, created_by, group_lead_registration_id
    ) VALUES (
      v_tenant, v_lead.event_id, v_person, v_ticket.id, v_lead.group_id,
      CASE WHEN v_lead.status = 'waitlist' THEN 'pending' ELSE v_lead.status END,
      v_lead.registration_mode, '{}'::jsonb, 'self_registration',
      v_lead.decided_at, v_lead.decision_source,
      CASE WHEN v_token IS NOT NULL THEN encode(digest(v_token,'sha256'),'hex') END,
      CASE WHEN v_token IS NOT NULL THEN now() END,
      v_lead.payment_status, v_uid, v_lead.id
    ) RETURNING id INTO v_reg;
    v_ids := v_ids || v_reg;

    PERFORM public.emit_domain_event(v_tenant, 'event_registration', v_reg::text,
      'event.registration.created.v1',
      jsonb_build_object('event_id', v_lead.event_id, 'person_id', v_person,
        'ticket_type_id', v_ticket.id, 'source', 'group_registration',
        'group_lead_registration_id', v_lead.id), v_uid);
  END LOOP;

  RETURN jsonb_build_object('added', v_count, 'registration_ids', to_jsonb(v_ids));
END $$;
REVOKE ALL ON FUNCTION public.event_register_group_guests(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_register_group_guests(uuid, jsonb) TO authenticated, service_role;

-- Liczba miejsc oplacanych jednym zamowieniem (prowadzacy + goscie).
CREATE OR REPLACE FUNCTION public.event_registration_group_seats(p_registration_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_ok boolean;
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RETURN 1; END IF;
  SELECT true INTO v_ok FROM public.event_registrations r
  LEFT JOIN public.event_people p ON p.id = r.person_id AND p.tenant_id = r.tenant_id
  WHERE r.id = p_registration_id AND r.tenant_id = v_tenant
    AND (r.created_by = v_uid OR p.user_id = v_uid);
  IF v_ok IS NULL THEN RETURN 1; END IF;
  SELECT count(*)::integer INTO v_n FROM public.event_registrations r
  WHERE r.group_lead_registration_id = p_registration_id
    AND r.tenant_id = v_tenant
    AND r.status NOT IN ('cancelled','rejected')
    AND r.payment_status = 'unpaid';
  RETURN 1 + COALESCE(v_n, 0);
END $$;
REVOKE ALL ON FUNCTION public.event_registration_group_seats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_registration_group_seats(uuid) TO authenticated, service_role;

-- Ksiegowanie wplaty przenosi wynik na cala grupe prowadzacego.
CREATE OR REPLACE FUNCTION public._event_apply_outcome_to_group(p_lead_id uuid, p_order_id uuid, p_outcome text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
DECLARE
  g public.event_registrations;
  v_token text;
  v_n integer := 0;
BEGIN
  FOR g IN SELECT * FROM public.event_registrations r
    WHERE r.group_lead_registration_id = p_lead_id FOR UPDATE LOOP
    IF p_outcome = 'paid' THEN
      IF g.status IN ('cancelled','rejected') THEN CONTINUE; END IF;
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations r SET
        payment_order_id = p_order_id, payment_status = 'paid',
        paid_at = COALESCE(r.paid_at, now()),
        status = CASE WHEN r.status IN ('draft','pending','waitlist') THEN 'approved' ELSE r.status END,
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        qr_token_hash = COALESCE(r.qr_token_hash, encode(digest(v_token,'sha256'),'hex')),
        qr_issued_at = COALESCE(r.qr_issued_at, now()),
        updated_at = now()
      WHERE r.id = g.id;
    ELSIF p_outcome = 'refunded' THEN
      UPDATE public.event_registrations r SET
        payment_order_id = p_order_id, payment_status = 'refunded', paid_at = NULL,
        status = 'cancelled', cancelled_at = COALESCE(r.cancelled_at, now()),
        waitlist_position = NULL,
        decided_at = COALESCE(r.decided_at, now()),
        decision_source = COALESCE(r.decision_source, 'system'),
        updated_at = now()
      WHERE r.id = g.id;
    ELSIF p_outcome = 'partial_refund' THEN
      UPDATE public.event_registrations r SET payment_order_id = p_order_id,
        payment_status = 'partially_refunded', updated_at = now() WHERE r.id = g.id;
    ELSE
      UPDATE public.event_registrations r SET payment_order_id = p_order_id,
        payment_status = 'unpaid', updated_at = now()
      WHERE r.id = g.id AND r.payment_status <> 'paid';
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public._event_apply_outcome_to_group(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._tg_event_group_follow_lead()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','extensions','pg_temp'
AS $$
BEGIN
  IF NEW.group_lead_registration_id IS NULL
     AND NEW.payment_order_id IS NOT NULL
     AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public._event_apply_outcome_to_group(
      NEW.id, NEW.payment_order_id,
      CASE NEW.payment_status
        WHEN 'paid' THEN 'paid'
        WHEN 'refunded' THEN 'refunded'
        WHEN 'partially_refunded' THEN 'partial_refund'
        ELSE 'unpaid' END);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._tg_event_group_follow_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS event_registrations_group_follow_lead ON public.event_registrations;
CREATE TRIGGER event_registrations_group_follow_lead
  AFTER UPDATE OF payment_status ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public._tg_event_group_follow_lead();
