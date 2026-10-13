CREATE OR REPLACE FUNCTION public.admin_event_badge_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_template_id uuid := NULLIF(p_payload->>'template_id', '')::uuid;
  v_ids uuid[];
  v_row record;
  v_token text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT array_agg(value::uuid) INTO v_ids
  FROM jsonb_array_elements_text(COALESCE(p_payload->'person_ids', '[]'::jsonb)) AS value;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: person_ids is required';
  END IF;

  IF array_length(v_ids, 1) > 200 THEN
    RAISE EXCEPTION 'invalid_payload: at most 200 badges per batch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF v_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_badge_templates t
    WHERE t.tenant_id = v_tenant AND t.id = v_template_id AND t.event_id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: badge template does not belong to this event';
  END IF;

  FOR v_row IN
    SELECT
      p.id AS person_id,
      p.first_name,
      p.last_name,
      p.job_title,
      COALESCE(NULLIF(btrim(p.company_text), ''), co.name) AS company,
      r.id AS registration_id,
      r.status AS registration_status,
      (r.badge_token_hash IS NOT NULL) AS had_badge,
      tt.name_pl AS ticket_name_pl,
      tt.name_en AS ticket_name_en,
      COALESCE(g.name_pl, dg.name_pl) AS group_name_pl,
      COALESCE(g.name_en, dg.name_en) AS group_name_en,
      COALESCE(g.color, dg.color) AS group_color
    FROM public.event_people p
    LEFT JOIN public.crm_companies co
      ON co.tenant_id = p.tenant_id AND co.id = p.company_id
    LEFT JOIN public.event_registrations r
      ON r.tenant_id = p.tenant_id
     AND r.event_id = v_event_id
     AND r.person_id = p.id
     AND r.status NOT IN ('cancelled', 'rejected')
    LEFT JOIN public.event_ticket_types tt
      ON tt.tenant_id = r.tenant_id AND tt.id = r.ticket_type_id
    LEFT JOIN public.event_groups g
      ON g.tenant_id = r.tenant_id AND g.id = r.group_id
    LEFT JOIN public.event_groups dg
      ON dg.tenant_id = p.tenant_id AND dg.event_id = v_event_id AND dg.is_default
    WHERE p.tenant_id = v_tenant
      AND p.id = ANY(v_ids)
    ORDER BY p.last_name, p.first_name
  LOOP
    v_token := NULL;

    IF v_row.registration_id IS NOT NULL THEN
      v_token := public._event_new_qr_token();
      UPDATE public.event_registrations
         SET badge_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
             badge_issued_at = now()
       WHERE tenant_id = v_tenant AND id = v_row.registration_id;
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'person_id', v_row.person_id,
      'first_name', v_row.first_name,
      'last_name', v_row.last_name,
      'job_title', v_row.job_title,
      'company', v_row.company,
      'registration_id', v_row.registration_id,
      'registration_status', v_row.registration_status,
      'ticket_name_pl', v_row.ticket_name_pl,
      'ticket_name_en', v_row.ticket_name_en,
      'group_name_pl', v_row.group_name_pl,
      'group_name_en', v_row.group_name_en,
      'group_color', v_row.group_color,
      'qr_code', v_token,
      'credential', CASE WHEN v_token IS NULL THEN NULL ELSE 'badge' END,
      'badge_reissued', COALESCE(v_row.had_badge, false)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'template_id', v_template_id,
    'issued_at', now(),
    'badges', v_out
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_event_badge_batch(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_batch(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_event_badge_batch(jsonb) TO service_role;

COMMENT ON FUNCTION public.admin_event_badge_batch(jsonb) IS
  'Partia identyfikatorow do druku: dane karty plus JAWNY kod identyfikatora (qr_code), ktory wraca RAZ. Druk i przedruk rotuja wylacznie badge_token_hash - bilet z e-maila i portfela zostaje wazny, a poprzedni identyfikator tej osoby daje przy bramce code_superseded. Payload: {event_id, person_ids[<=200], template_id?}. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_registration_code_invalidate(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'registration_id', '')::uuid;
  v_credential text := lower(btrim(COALESCE(p_payload->>'credential', '')));
  v_reg public.event_registrations;
  v_old text;
  v_token text;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: registration_id is required';
  END IF;

  IF v_credential NOT IN ('ticket', 'badge') THEN
    RAISE EXCEPTION 'invalid_payload: credential must be ticket or badge';
  END IF;

  SELECT r.* INTO v_reg
  FROM public.event_registrations r
  WHERE r.tenant_id = v_tenant AND r.id = v_id
  FOR UPDATE;

  IF v_reg.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist in this tenant';
  END IF;

  IF v_credential = 'ticket' THEN
    v_old := v_reg.qr_token_hash;
    IF v_old IS NULL THEN
      RAISE EXCEPTION 'ticket_not_issued: this registration has no ticket code to invalidate';
    END IF;

    v_token := public._event_new_qr_token();
    UPDATE public.event_registrations
       SET qr_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
           qr_issued_at = now()
     WHERE tenant_id = v_tenant AND id = v_id;
  ELSE
    v_old := v_reg.badge_token_hash;
    IF v_old IS NULL THEN
      RAISE EXCEPTION 'badge_not_issued: this registration has no printed badge code to invalidate';
    END IF;

    UPDATE public.event_registrations
       SET badge_token_hash = NULL,
           badge_issued_at = NULL
     WHERE tenant_id = v_tenant AND id = v_id;
  END IF;

  UPDATE public.event_superseded_codes
     SET reason = 'invalidated'
   WHERE tenant_id = v_tenant AND code_hash = v_old;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_registration',
    v_id::text,
    'event.registration.code_invalidated.v1',
    jsonb_build_object(
      'event_id', v_reg.event_id,
      'registration_id', v_id,
      'credential', v_credential
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'registration_id', v_id,
    'credential', v_credential,
    'code', v_token,
    'invalidated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_registration_code_invalidate(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_registration_code_invalidate(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_registration_code_invalidate(jsonb) IS
  'Jawne uniewaznienie zgubionego kodu. Payload: {registration_id, credential: ticket|badge}. ticket: nowy kod biletu, wartosc jawna wraca RAZ (code); badge: kod identyfikatora zdjety (przedruk wyda nowy). Stary kod w event_superseded_codes z powodem invalidated, zdarzenie event.registration.code_invalidated.v1. Odmowy: ticket_not_issued, badge_not_issued. Bramka: assert_event_admin_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_checkpoints_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_checkpoints_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  name_pl text,
  name_en text,
  kind text,
  session_id uuid,
  session_title_pl text,
  session_title_en text,
  room_id uuid,
  room_name text,
  sponsor_id uuid,
  sponsor_name text,
  direction_mode text,
  access_mode text,
  reentry_policy text,
  capacity integer,
  dedupe_window_seconds integer,
  is_active boolean,
  sort_order integer,
  granted_count integer,
  denied_count integer,
  repeat_count integer,
  occupancy integer,
  device_count integer,
  last_checkin_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
BEGIN
  RETURN QUERY
  SELECT
    cp.id, cp.event_id, cp.name_pl, cp.name_en, cp.kind,
    cp.session_id, s.title_pl, s.title_en,
    cp.room_id, r.name,
    cp.sponsor_id, sp.snapshot_name,
    cp.direction_mode, cp.access_mode, cp.reentry_policy,
    cp.capacity, cp.dedupe_window_seconds,
    cp.is_active, cp.sort_order,
    COALESCE(agg.granted, 0)::integer,
    COALESCE(agg.denied, 0)::integer,
    COALESCE(agg.repeats, 0)::integer,
    public._event_checkpoint_occupancy(v_tenant, cp.id),
    COALESCE(dev.cnt, 0)::integer,
    agg.last_at,
    cp.created_at, cp.updated_at
  FROM public.event_checkpoints cp
  LEFT JOIN public.event_sessions s
    ON s.tenant_id = cp.tenant_id AND s.id = cp.session_id
  LEFT JOIN public.event_rooms r
    ON r.tenant_id = cp.tenant_id AND r.id = cp.room_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = cp.tenant_id AND sp.id = cp.sponsor_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE c.result = 'granted')::integer AS granted,
      count(*) FILTER (WHERE c.result <> 'granted')::integer AS denied,
      COALESCE(sum(c.repeat_count), 0)::integer AS repeats,
      max(c.occurred_at) AS last_at
    FROM public.event_checkins c
    WHERE c.tenant_id = cp.tenant_id AND c.checkpoint_id = cp.id
  ) agg ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_scanner_devices d
    WHERE d.tenant_id = cp.tenant_id
      AND d.checkpoint_id = cp.id
      AND d.revoked_at IS NULL
  ) dev ON true
  WHERE cp.tenant_id = v_tenant
    AND cp.event_id = p_event_id
  ORDER BY cp.sort_order, cp.name_pl;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoints_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoints_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoints_list(uuid) IS
  'Punkty odprawy wydarzenia z polityka ponownego wejscia (reentry_policy), licznikami zgod, odmow, powtorzen i aktualna obecnoscia. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_checkpoint_save(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_name_pl text := btrim(COALESCE(p_payload->>'name_pl', ''));
  v_name_en text := btrim(COALESCE(p_payload->>'name_en', ''));
  v_kind text := lower(btrim(COALESCE(p_payload->>'kind', 'event_entry')));
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_room_id uuid := NULLIF(p_payload->>'room_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_reentry text := NULLIF(lower(btrim(COALESCE(p_payload->>'reentry_policy', ''))), '');
  v_access text;
  v_existing public.event_checkpoints;
BEGIN
  IF v_id IS NOT NULL THEN
    SELECT cp.* INTO v_existing
    FROM public.event_checkpoints cp
    WHERE cp.id = v_id AND cp.tenant_id = v_tenant;

    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'not_found: checkpoint does not exist in this organisation';
    END IF;
    v_event_id := v_existing.event_id;
  END IF;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.tenant_id = v_tenant AND e.id = v_event_id
  ) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF v_name_pl = '' OR v_name_en = '' THEN
    RAISE EXCEPTION 'invalid_names: the name is required in both languages';
  END IF;

  IF v_kind NOT IN (
    'event_entry', 'session', 'room', 'zone', 'catering', 'cloakroom', 'company_booth'
  ) THEN
    RAISE EXCEPTION 'invalid_kind: unknown checkpoint kind %', v_kind;
  END IF;

  IF v_reentry IS NOT NULL AND v_reentry NOT IN ('allow', 'deny') THEN
    RAISE EXCEPTION 'invalid_payload: unknown reentry_policy %', v_reentry;
  END IF;

  IF v_kind <> 'session' THEN v_session_id := NULL; END IF;
  IF v_kind <> 'company_booth' THEN v_sponsor_id := NULL; END IF;

  v_access := COALESCE(NULLIF(p_payload->>'access_mode', ''), v_existing.access_mode, 'control');
  v_reentry := COALESCE(v_reentry, v_existing.reentry_policy, 'allow');
  IF v_access <> 'control' THEN
    v_reentry := 'allow';
  END IF;

  IF v_kind = 'session' AND v_session_id IS NULL THEN
    RAISE EXCEPTION 'session_required: a session checkpoint must point at a session';
  END IF;
  IF v_kind = 'company_booth' AND v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'sponsor_required: a booth checkpoint must point at a sponsor';
  END IF;

  IF v_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sessions s
    WHERE s.tenant_id = v_tenant AND s.event_id = v_event_id AND s.id = v_session_id
  ) THEN
    RAISE EXCEPTION 'session_not_in_event: the session belongs to another event';
  END IF;

  IF v_room_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.tenant_id = v_tenant AND r.event_id = v_event_id AND r.id = v_room_id
  ) THEN
    RAISE EXCEPTION 'room_not_in_event: the room belongs to another event';
  END IF;

  IF v_sponsor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_sponsors sp
    WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
  ) THEN
    RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.event_checkpoints (
      tenant_id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id,
      direction_mode, access_mode, reentry_policy, capacity, dedupe_window_seconds,
      is_active, sort_order, created_by
    ) VALUES (
      v_tenant, v_event_id, v_name_pl, v_name_en, v_kind, v_session_id, v_room_id, v_sponsor_id,
      COALESCE(NULLIF(p_payload->>'direction_mode', ''), 'in_only'),
      v_access,
      v_reentry,
      NULLIF(p_payload->>'capacity', '')::integer,
      COALESCE(NULLIF(p_payload->>'dedupe_window_seconds', '')::integer, 60),
      COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, true),
      COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, 100),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.event_checkpoints SET
      name_pl = v_name_pl,
      name_en = v_name_en,
      kind = v_kind,
      session_id = v_session_id,
      room_id = v_room_id,
      sponsor_id = v_sponsor_id,
      direction_mode = COALESCE(NULLIF(p_payload->>'direction_mode', ''), direction_mode),
      access_mode = v_access,
      reentry_policy = v_reentry,
      capacity = CASE
        WHEN p_payload ? 'capacity' THEN NULLIF(p_payload->>'capacity', '')::integer
        ELSE capacity
      END,
      dedupe_window_seconds = COALESCE(
        NULLIF(p_payload->>'dedupe_window_seconds', '')::integer, dedupe_window_seconds
      ),
      is_active = COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, is_active),
      sort_order = COALESCE(NULLIF(p_payload->>'sort_order', '')::integer, sort_order)
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_checkpoint_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_checkpoint_save(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_checkpoint_save(jsonb) IS
  'Dodanie albo edycja punktu odprawy. Payload jsonb (id, event_id, name_pl, name_en, kind, session_id, room_id, sponsor_id, direction_mode, access_mode, reentry_policy, capacity, dedupe_window_seconds, is_active, sort_order). Wiazania spoza rodzaju sa czyszczone, nie odrzucane; reentry_policy = deny tylko w trybie control (w track wraca do allow). Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_sponsor_delete(_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_sponsor public.event_sponsors;
  v_booths integer;
  v_dev record;
BEGIN
  SELECT s.* INTO v_sponsor
  FROM public.event_sponsors s
  WHERE s.id = _id AND s.tenant_id = v_tenant
  FOR UPDATE;

  IF v_sponsor.id IS NULL THEN
    RAISE EXCEPTION 'not_found: sponsor pin does not exist in this tenant';
  END IF;

  SELECT count(*)::integer INTO v_booths
  FROM public.event_checkpoints cp
  WHERE cp.tenant_id = v_tenant AND cp.sponsor_id = _id;

  IF v_booths > 0 THEN
    RAISE EXCEPTION 'sponsor_has_checkpoints: % booth checkpoint(s) point at this sponsor - change their kind or delete them first', v_booths;
  END IF;

  FOR v_dev IN
    UPDATE public.event_scanner_devices d
       SET revoked_at = now(),
           revoked_by = auth.uid(),
           is_active = false,
           offline_roster = false
     WHERE d.tenant_id = v_tenant
       AND d.sponsor_id = _id
       AND d.revoked_at IS NULL
    RETURNING d.id, d.event_id, d.label, d.token_prefix
  LOOP
    PERFORM public.emit_domain_event(
      v_tenant,
      'event_scanner_device',
      v_dev.id::text,
      'event_scanner_device.revoked.v1',
      jsonb_build_object(
        'event_id', v_dev.event_id,
        'device_id', v_dev.id,
        'label', v_dev.label,
        'token_prefix', v_dev.token_prefix,
        'reason', 'sponsor_deleted'
      ),
      auth.uid()
    );
  END LOOP;

  DELETE FROM public.event_sponsors
  WHERE id = _id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_sponsor_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_sponsor_delete(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_sponsor_delete(uuid) IS
  'Usuwa przypiecie firmy do wydarzenia razem z jego osobami kontaktowymi, materialami i leadami (kaskada). Najpierw uniewaznia poswiadczenia urzadzen sponsora (event_scanner_device.revoked.v1); stanowisko firmy blokuje usuniecie kodem sponsor_has_checkpoints. Firma w kartotece zostaje nietknieta. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_scopes text[];
  v_expires timestamptz := NULLIF(p_payload->>'expires_at', '')::timestamptz;
  v_limit timestamptz;
  v_offline boolean := lower(COALESCE(p_payload->>'offline_roster', '')) IN ('true', 't', '1');
  v_event public.events;
  v_token text;
  v_id uuid;
BEGIN
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_id is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.id = v_event_id;

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist in this organisation';
  END IF;

  IF char_length(v_label) < 2 THEN
    RAISE EXCEPTION 'invalid_label: the label must have at least 2 characters';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT lower(btrim(s))), ARRAY['checkin']::text[])
  INTO v_scopes
  FROM jsonb_array_elements_text(
    CASE
      WHEN jsonb_typeof(p_payload->'scopes') = 'array' THEN p_payload->'scopes'
      ELSE '["checkin"]'::jsonb
    END
  ) AS t(s)
  WHERE lower(btrim(s)) IN ('checkin', 'lead', 'badge_print');

  IF array_length(v_scopes, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_scopes: at least one known scope is required';
  END IF;

  IF v_checkpoint_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_checkpoints cp
    WHERE cp.tenant_id = v_tenant AND cp.event_id = v_event_id AND cp.id = v_checkpoint_id
  ) THEN
    RAISE EXCEPTION 'checkpoint_not_in_event: the checkpoint belongs to another event';
  END IF;

  IF 'lead' = ANY (v_scopes) THEN
    IF v_sponsor_id IS NULL THEN
      RAISE EXCEPTION 'sponsor_required: a lead-retrieval credential must name its sponsor';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.event_sponsors sp
      WHERE sp.tenant_id = v_tenant AND sp.event_id = v_event_id AND sp.id = v_sponsor_id
    ) THEN
      RAISE EXCEPTION 'sponsor_not_in_event: the sponsor belongs to another event';
    END IF;
  ELSE
    v_sponsor_id := NULL;
  END IF;

  v_offline := v_offline AND 'checkin' = ANY (v_scopes);

  v_limit := public._event_scanner_expiry_limit(v_tenant, v_event_id);

  IF v_limit IS NOT NULL AND v_limit <= now() THEN
    RAISE EXCEPTION 'expiry_too_late: the event ended more than 7 days ago - a scanner credential can no longer be issued';
  END IF;

  IF v_expires IS NULL THEN
    v_expires := COALESCE(v_event.ends_at, v_event.starts_at, now()) + interval '24 hours';
    IF v_expires <= now() THEN
      v_expires := now() + interval '48 hours';
    END IF;
    v_expires := LEAST(v_expires, COALESCE(v_limit, v_expires));
  ELSIF v_limit IS NOT NULL AND v_expires > v_limit THEN
    RAISE EXCEPTION 'expiry_too_late: the credential must expire at most 7 days after the event ends';
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'invalid_expiry: the credential must expire in the future';
  END IF;

  v_token := public._event_new_scanner_token();

  INSERT INTO public.event_scanner_devices (
    tenant_id, event_id, checkpoint_id, sponsor_id, label,
    token_hash, token_prefix, scopes, is_active, expires_at, created_by, offline_roster
  ) VALUES (
    v_tenant, v_event_id, v_checkpoint_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 8), v_scopes,
    true, v_expires, auth.uid(), v_offline
  )
  RETURNING id INTO v_id;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_scanner_device',
    v_id::text,
    'event_scanner_device.issued.v1',
    jsonb_build_object(
      'event_id', v_event_id,
      'device_id', v_id,
      'label', v_label,
      'token_prefix', left(v_token, 8),
      'scopes', to_jsonb(v_scopes),
      'expires_at', v_expires,
      'offline_roster', v_offline
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'device_id', v_id,
    'label', v_label,
    'token', v_token,
    'token_prefix', left(v_token, 8),
    'scopes', to_jsonb(v_scopes),
    'expires_at', v_expires,
    'expires_at_limit', v_limit,
    'checkpoint_id', v_checkpoint_id,
    'sponsor_id', v_sponsor_id,
    'offline_roster', v_offline
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_issue(jsonb) IS
  'Wydanie poswiadczenia urzadzenia skanujacego. Payload: {event_id, label, scopes[], checkpoint_id?, sponsor_id?, expires_at?, offline_roster?}. TOKEN JAWNY WRACA DOKLADNIE RAZ. Termin najpozniej 7 dni po koncu wydarzenia (expiry_too_late; domyslny przycinany, granica w expires_at_limit). Lista offline tylko z zakresem checkin. Bramka: assert_event_admin_tenant().';

CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_set_active(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_active boolean := COALESCE(NULLIF(p_payload->>'is_active', '')::boolean, true);
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  SELECT d.* INTO v_row
  FROM public.event_scanner_devices d
  WHERE d.id = v_id AND d.tenant_id = v_tenant;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  IF v_row.revoked_at IS NOT NULL AND v_active THEN
    RAISE EXCEPTION 'device_revoked: a revoked credential cannot be reactivated - issue a new one';
  END IF;

  UPDATE public.event_scanner_devices
  SET is_active = v_active,
      locked_until = CASE WHEN v_active THEN NULL ELSE locked_until END,
      fail_window_count = CASE WHEN v_active THEN 0 ELSE fail_window_count END,
      fail_window_started_at = CASE WHEN v_active THEN NULL ELSE fail_window_started_at END,
      queue_fail_window_count = CASE WHEN v_active THEN 0 ELSE queue_fail_window_count END,
      queue_fail_window_started_at = CASE
        WHEN v_active THEN NULL ELSE queue_fail_window_started_at
      END
  WHERE id = v_id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) IS
  'Pauza albo wznowienie poswiadczenia. Wznowienie ZDEJMUJE blokade automatyczna i czysci oba okna nieudanych prob - na zywo i z kolejki (licznik monotoniczny zostaje - to historia, nie stan). Uniewaznionego poswiadczenia nie da sie wznowic. Payload: {device_id, is_active}. Bramka: assert_event_admin_tenant().';