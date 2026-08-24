CREATE OR REPLACE FUNCTION public.assert_editor_tenant()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden: authentication required';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.has_role(v_uid, 'editor'::app_role)
    OR public.is_super_admin(v_uid)
  ) THEN
    RAISE EXCEPTION 'forbidden: editor role required';
  END IF;

  SELECT p.tenant_id INTO v_tenant FROM public.profiles p WHERE p.id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant';
  END IF;

  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_editor_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_editor_tenant() TO authenticated, service_role;

COMMENT ON FUNCTION public.assert_editor_tenant() IS
  'Bramka staffa redakcyjnego modulu Wydarzen: admin, editor albo super_admin. Odrzuca role author. Zwraca tenanta domowego wolajacego.';

CREATE OR REPLACE FUNCTION public.admin_event_create(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_type public.event_types;
  v_type_id uuid := NULLIF(p_payload->>'event_type_id', '')::uuid;
  v_title_pl text := btrim(COALESCE(p_payload->>'title_pl', ''));
  v_title_en text := btrim(COALESCE(p_payload->>'title_en', ''));
  v_starts_at timestamptz := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  v_external_url text := NULLIF(btrim(COALESCE(p_payload->>'external_registration_url', '')), '');
  v_slug_base text;
  v_slug text;
  v_suffix integer := 1;
  v_kind text;
  v_ends_at timestamptz;
  v_id uuid;
BEGIN
  IF v_title_pl = '' OR v_title_en = '' THEN
    RAISE EXCEPTION 'invalid_titles: both titles are required';
  END IF;

  IF v_starts_at IS NULL THEN
    RAISE EXCEPTION 'invalid_starts_at: start date is required';
  END IF;

  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'invalid_type: event type is required';
  END IF;

  SELECT * INTO v_type
  FROM public.event_types et
  WHERE et.id = v_type_id AND et.tenant_id = v_tenant;

  IF v_type.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event type does not exist in this tenant';
  END IF;

  IF NOT v_type.is_active THEN
    RAISE EXCEPTION 'event_type_inactive: type is disabled in this organisation';
  END IF;

  IF v_type.default_registration_mode = 'external' THEN
    IF v_external_url IS NULL THEN
      RAISE EXCEPTION 'external_url_required: type registers externally and needs a url';
    END IF;
    IF v_external_url !~* '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'external_url_invalid: url must start with https';
    END IF;
    IF char_length(v_external_url) > 2048 THEN
      RAISE EXCEPTION 'external_url_invalid: url is too long';
    END IF;
  ELSE
    v_external_url := NULL;
  END IF;

  v_slug_base := lower(translate(
    v_title_pl,
    'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
    'acelnoszzACELNOSZZ'
  ));
  v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(v_slug_base, '-');
  v_slug_base := left(v_slug_base, 110);

  IF char_length(v_slug_base) < 3 THEN
    v_slug_base := v_type.key;
  END IF;

  v_slug := v_slug_base;
  WHILE EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.slug = v_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_slug := left(v_slug_base, 110) || '-' || v_suffix::text;
  END LOOP;

  v_kind := CASE
    WHEN v_type.key IN ('webinar', 'briefing', 'roundtable', 'ama', 'in_person', 'hybrid')
      THEN v_type.key
    WHEN v_type.default_format = 'online' THEN 'webinar'
    WHEN v_type.default_format = 'hybrid' THEN 'hybrid'
    ELSE 'in_person'
  END;

  v_ends_at := CASE
    WHEN v_type.default_duration_minutes IS NULL THEN NULL
    ELSE v_starts_at + make_interval(mins => v_type.default_duration_minutes)
  END;

  INSERT INTO public.events (
    tenant_id, slug, title_pl, title_en, starts_at, ends_at,
    status, kind, event_type_id, format,
    registration_mode, registration_flow, guest_mode, external_registration_url,
    capacity, min_tier_rank, chatham_house,
    visibility, created_by
  ) VALUES (
    v_tenant, v_slug, v_title_pl, v_title_en, v_starts_at, v_ends_at,
    'draft', v_kind, v_type.id, v_type.default_format,
    v_type.default_registration_mode, v_type.default_registration_flow,
    v_type.default_guest_mode, v_external_url,
    v_type.default_capacity, v_type.default_min_tier_rank, v_type.default_chatham_house,
    CASE WHEN v_type.default_min_tier_rank > 0 THEN 'members' ELSE 'public' END,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_create(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_create(jsonb) IS
  'Tworzy wydarzenie z domyslnych ustawien rodzaju. Wejscie: event_type_id, title_pl, title_en, starts_at oraz external_registration_url - wymagany wtedy i tylko wtedy, gdy rodzaj zapisuje uczestnikow w obcym systemie.';

CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_prev text;
  v_going integer;
  v_waitlist integer;
  v_position integer;
  v_min_rank integer;
  v_result_status text := p_status;
  v_paid boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid status';
  END IF;
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND tenant_id = public.public_tenant_id()
     AND status = 'published'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'events: not found';
  END IF;

  IF p_status = 'going' THEN
    IF v_event.registration_mode = 'none' THEN
      RAISE EXCEPTION 'events: registration disabled';
    ELSIF v_event.registration_mode = 'external' THEN
      RAISE EXCEPTION 'events: registration external';
    ELSIF v_event.registration_mode = 'form' THEN
      RAISE EXCEPTION 'events: registration form required';
    ELSIF v_event.registration_flow = 'approval' THEN
      RAISE EXCEPTION 'events: registration approval required';
    END IF;
  END IF;

  IF v_event.visibility = 'members' THEN
    IF v_event.kind = 'briefing' THEN
      IF NOT public.has_tier_feature('pro_briefings') THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    ELSE
      v_min_rank := GREATEST(COALESCE(v_event.min_tier_rank, 0), 1);
      IF NOT public.has_tier_rank(v_min_rank) THEN
        RAISE EXCEPTION 'events: membership required';
      END IF;
    END IF;
  ELSIF NOT public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0)) THEN
    RAISE EXCEPTION 'events: membership required';
  END IF;
  IF v_event.chatham_house AND NOT public.has_tier_feature('chatham_house_events') THEN
    RAISE EXCEPTION 'events: chatham house membership required';
  END IF;
  IF p_status <> 'cancelled'
     AND v_event.rsvp_opens_at IS NOT NULL
     AND now() < v_event.rsvp_opens_at THEN
    IF v_event.early_rsvp_rank IS NULL
       OR NOT public.has_tier_rank(v_event.early_rsvp_rank) THEN
      RAISE EXCEPTION 'events: rsvp not open';
    END IF;
  END IF;
  SELECT er.status INTO v_prev
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;
  IF p_status = 'going'
     AND COALESCE(v_event.ticket_price_cents, 0) > 0
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.payment_orders po
       WHERE po.user_id = v_user
         AND po.status = 'paid'
         AND po.metadata ->> 'event_id' = p_event_id::text
    ) INTO v_paid;
    IF NOT v_paid AND NOT public.claim_included_event_ticket(p_event_id) THEN
      RAISE EXCEPTION 'events: ticket required';
    END IF;
  END IF;
  IF p_status = 'going'
     AND v_event.capacity IS NOT NULL
     AND COALESCE(v_prev, '') <> 'going' THEN
    SELECT count(*) INTO v_going
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going';
    IF v_going >= v_event.capacity THEN
      v_result_status := 'waitlist';
    END IF;
  END IF;
  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status, waitlisted_at)
  VALUES (
    v_event.tenant_id, p_event_id, v_user, v_result_status,
    CASE WHEN v_result_status = 'waitlist' THEN clock_timestamp() END
  )
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    waitlisted_at = CASE
      WHEN EXCLUDED.status = 'waitlist'
        THEN COALESCE(event_rsvps.waitlisted_at, clock_timestamp())
      ELSE NULL
    END,
    updated_at = now();
  IF v_prev = 'going' AND v_result_status <> 'going' THEN
    PERFORM public.promote_event_waitlist(p_event_id);
  END IF;
  IF p_status <> 'going' THEN
    PERFORM public.release_included_event_ticket(p_event_id, v_user);
  END IF;
  SELECT count(*) FILTER (WHERE er.status = 'going'),
         count(*) FILTER (WHERE er.status = 'waitlist')
    INTO v_going, v_waitlist
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id;
  IF v_result_status = 'waitlist' THEN
    SELECT count(*) INTO v_position
      FROM public.event_rsvps er
     WHERE er.event_id = p_event_id
       AND er.status = 'waitlist'
       AND er.waitlisted_at <= (
         SELECT mine.waitlisted_at
           FROM public.event_rsvps mine
          WHERE mine.event_id = p_event_id AND mine.user_id = v_user
       );
  END IF;
  RETURN jsonb_build_object(
    'status', v_result_status,
    'going', v_going,
    'waitlist', v_waitlist,
    'waitlist_position', v_position
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.rsvp_event(uuid, text) IS
  'Zapis uczestnika na wydarzenie. Respektuje tryb zapisow (rsvp / form / external / none) i przeplyw (instant / approval). Statusy interested i cancelled sa otwarte niezaleznie od trybu.';