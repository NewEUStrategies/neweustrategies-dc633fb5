DROP FUNCTION IF EXISTS public.admin_event_scanner_devices_list(uuid);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_devices_list(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  event_id uuid,
  label text,
  token_prefix text,
  scopes text[],
  checkpoint_id uuid,
  checkpoint_name_pl text,
  checkpoint_name_en text,
  sponsor_id uuid,
  sponsor_name text,
  state text,
  is_active boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  locked_until timestamptz,
  last_seen_at timestamptz,
  scan_count integer,
  failed_scan_count integer,
  last_failed_scan_at timestamptz,
  fail_window_count integer,
  checkins_count integer,
  lead_scans_count integer,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
BEGIN
  RETURN QUERY
  SELECT
    d.id, d.event_id, d.label, d.token_prefix, d.scopes,
    d.checkpoint_id, cp.name_pl, cp.name_en,
    d.sponsor_id, sp.snapshot_name,
    CASE
      WHEN d.revoked_at IS NOT NULL THEN 'revoked'
      WHEN d.locked_until IS NOT NULL AND d.locked_until > now() THEN 'locked'
      WHEN d.expires_at <= now() THEN 'expired'
      WHEN NOT d.is_active THEN 'paused'
      ELSE 'active'
    END,
    d.is_active, d.expires_at, d.revoked_at, d.locked_until, d.last_seen_at,
    d.scan_count, d.failed_scan_count, d.last_failed_scan_at, d.fail_window_count,
    COALESCE(ci.cnt, 0)::integer,
    COALESCE(ls.cnt, 0)::integer,
    d.created_at
  FROM public.event_scanner_devices d
  LEFT JOIN public.event_checkpoints cp
    ON cp.tenant_id = d.tenant_id AND cp.id = d.checkpoint_id
  LEFT JOIN public.event_sponsors sp
    ON sp.tenant_id = d.tenant_id AND sp.id = d.sponsor_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_checkins c
    WHERE c.tenant_id = d.tenant_id AND c.device_id = d.id
  ) ci ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.event_lead_scans l
    WHERE l.tenant_id = d.tenant_id AND l.device_id = d.id
  ) ls ON true
  WHERE d.tenant_id = v_tenant
    AND d.event_id = p_event_id
  ORDER BY d.revoked_at NULLS FIRST, d.label;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_devices_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_devices_list(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_devices_list(uuid) IS
  'Poswiadczenia urzadzen wydarzenia: stan liczony z czterech kolumn i daty, liczniki skanow i NIEUDANYCH rozpoznan, prefiks tokenu. HASZA NIE ODDAJE. Bramka: assert_editor_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_scanner_device_issue(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_issue(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_event_id uuid := NULLIF(p_payload->>'event_id', '')::uuid;
  v_label text := btrim(COALESCE(p_payload->>'label', ''));
  v_checkpoint_id uuid := NULLIF(p_payload->>'checkpoint_id', '')::uuid;
  v_sponsor_id uuid := NULLIF(p_payload->>'sponsor_id', '')::uuid;
  v_scopes text[];
  v_expires timestamptz := NULLIF(p_payload->>'expires_at', '')::timestamptz;
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

  IF v_expires IS NULL THEN
    v_expires := COALESCE(v_event.ends_at, v_event.starts_at, now()) + interval '24 hours';
    IF v_expires <= now() THEN
      v_expires := now() + interval '48 hours';
    END IF;
  END IF;

  IF v_expires <= now() THEN
    RAISE EXCEPTION 'invalid_expiry: the credential must expire in the future';
  END IF;

  v_token := public._event_new_scanner_token();

  INSERT INTO public.event_scanner_devices (
    tenant_id, event_id, checkpoint_id, sponsor_id, label,
    token_hash, token_prefix, scopes, is_active, expires_at, created_by
  ) VALUES (
    v_tenant, v_event_id, v_checkpoint_id, v_sponsor_id, v_label,
    encode(digest(v_token, 'sha256'), 'hex'), left(v_token, 8), v_scopes,
    true, v_expires, auth.uid()
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
      'expires_at', v_expires
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
    'checkpoint_id', v_checkpoint_id,
    'sponsor_id', v_sponsor_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_issue(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_issue(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_issue(jsonb) IS
  'Wydanie poswiadczenia urzadzenia skanujacego. Payload: {event_id, label, scopes[], checkpoint_id?, sponsor_id?, expires_at?}. TOKEN JAWNY WRACA DOKLADNIE RAZ - nie ma funkcji pokazujacej go ponownie i to jest cala wartosc rozwiazania. Bramka: assert_admin_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_scanner_device_revoke(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_revoke(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_id uuid := NULLIF(p_payload->>'device_id', '')::uuid;
  v_row public.event_scanner_devices;
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: device_id is required';
  END IF;

  UPDATE public.event_scanner_devices
  SET revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid()),
      is_active = false
  WHERE id = v_id AND tenant_id = v_tenant
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: scanner credential does not exist in this organisation';
  END IF;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_scanner_device',
    v_row.id::text,
    'event_scanner_device.revoked.v1',
    jsonb_build_object(
      'event_id', v_row.event_id,
      'device_id', v_row.id,
      'label', v_row.label,
      'token_prefix', v_row.token_prefix
    ),
    auth.uid()
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_revoke(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_revoke(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_revoke(jsonb) IS
  'Uniewaznienie poswiadczenia urzadzenia - nieodwracalne i natychmiastowe (brak jakiegokolwiek bufora po stronie bazy). Payload: {device_id}. Bramka: assert_admin_tenant().';

DROP FUNCTION IF EXISTS public.admin_event_scanner_device_set_active(jsonb);
CREATE OR REPLACE FUNCTION public.admin_event_scanner_device_set_active(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
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
      fail_window_started_at = CASE WHEN v_active THEN NULL ELSE fail_window_started_at END
  WHERE id = v_id AND tenant_id = v_tenant;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_scanner_device_set_active(jsonb) IS
  'Pauza albo wznowienie poswiadczenia. Wznowienie ZDEJMUJE blokade automatyczna i czysci okno nieudanych prob (licznik monotoniczny zostaje - to historia, nie stan). Uniewaznionego poswiadczenia nie da sie wznowic. Payload: {device_id, is_active}. Bramka: assert_admin_tenant().';