-- 1. Preferencje komunikacji i powód anulowania na zgłoszeniu
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS notify_email boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_sms boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 2. Moje zgłoszenia (panel uczestnika)
CREATE OR REPLACE FUNCTION public.event_my_registrations(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'limit','')::integer, 20), 1), 50);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required: sign in to see your registrations';
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      r.id AS registration_id,
      r.status,
      r.payment_status,
      r.created_at,
      r.cancelled_at,
      r.paid_at,
      r.waitlist_position,
      r.promoted_at,
      r.notify_email,
      r.notify_sms,
      COALESCE(NULLIF(btrim(r.cancel_reason), ''), NULLIF(btrim(r.decision_note), '')) AS cancel_reason,
      r.decision_source,
      e.slug AS event_slug,
      e.title_pl AS event_title_pl,
      e.title_en AS event_title_en,
      e.starts_at AS event_starts_at,
      e.timezone AS event_timezone,
      o.id AS order_id,
      o.status AS order_status,
      o.amount_cents,
      o.refunded_amount_cents,
      o.currency,
      o.provider_session_id,
      o.provider_payment_intent_id,
      o.environment,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', w.id,
                 'event_type', w.event_type,
                 'status', w.status,
                 'occurred_at', w.occurred_at,
                 'processed_at', w.processed_at,
                 'retry_count', w.retry_count
               ) ORDER BY w.occurred_at DESC)
        FROM (
          SELECT w2.*
          FROM public.payment_webhook_events w2
          WHERE w2.tenant_id = r.tenant_id
            AND (
              (o.provider_customer_id IS NOT NULL AND w2.customer_id = o.provider_customer_id)
              OR w2.user_id = v_uid
            )
          ORDER BY w2.occurred_at DESC
          LIMIT 20
        ) w
      ), '[]'::jsonb) AS webhooks
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    JOIN public.events e ON e.id = r.event_id AND e.tenant_id = r.tenant_id
    LEFT JOIN public.payment_orders o ON o.id = r.payment_order_id
    WHERE r.tenant_id = v_tenant
      AND pe.user_id = v_uid
    ORDER BY r.created_at DESC
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('registrations', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.event_my_registrations(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_my_registrations(jsonb) TO authenticated, service_role;

-- 3. Zmiana preferencji komunikacji przez uczestnika
CREATE OR REPLACE FUNCTION public.event_registration_set_channels(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_reg_id uuid := NULLIF(p_payload->>'registration_id','')::uuid;
  v_token text := NULLIF(btrim(COALESCE(p_payload->>'manage_token','')), '');
  v_hash text;
  v_email boolean;
  v_sms boolean;
  v_row public.event_registrations;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_tenant: unknown host';
  END IF;
  IF p_payload ? 'notify_email' THEN v_email := (p_payload->>'notify_email')::boolean; END IF;
  IF p_payload ? 'notify_sms' THEN v_sms := (p_payload->>'notify_sms')::boolean; END IF;
  IF v_email IS NULL AND v_sms IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: nothing to change';
  END IF;

  IF v_token IS NOT NULL THEN
    v_hash := encode(digest(v_token, 'sha256'), 'hex');
    SELECT r.* INTO v_row
    FROM public.event_registrations r
    WHERE r.tenant_id = v_tenant AND r.manage_token_hash = v_hash;
  ELSIF v_reg_id IS NOT NULL AND v_uid IS NOT NULL THEN
    SELECT r.* INTO v_row
    FROM public.event_registrations r
    JOIN public.event_people pe ON pe.id = r.person_id AND pe.tenant_id = r.tenant_id
    WHERE r.tenant_id = v_tenant AND r.id = v_reg_id AND pe.user_id = v_uid;
  ELSE
    RAISE EXCEPTION 'auth_required: registration_id with session or manage_token is required';
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'not_found: registration does not exist';
  END IF;

  UPDATE public.event_registrations r
     SET notify_email = COALESCE(v_email, r.notify_email),
         notify_sms = COALESCE(v_sms, r.notify_sms),
         updated_at = now()
   WHERE r.id = v_row.id
   RETURNING r.* INTO v_row;

  RETURN jsonb_build_object(
    'registration_id', v_row.id,
    'notify_email', v_row.notify_email,
    'notify_sms', v_row.notify_sms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_registration_set_channels(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_registration_set_channels(jsonb) TO anon, authenticated, service_role;

-- 4. Zdrowie zdarzeń płatniczych (panel admina)
CREATE OR REPLACE FUNCTION public.admin_payment_webhook_health(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_env text := COALESCE(NULLIF(p_payload->>'environment',''), 'live');
  v_hours integer := LEAST(GREATEST(COALESCE(NULLIF(p_payload->>'since_hours','')::integer, 168), 1), 8760);
  v_since timestamptz;
  v_total integer := 0;
  v_failed integer := 0;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_pending integer := 0;
  v_retries integer := 0;
  v_avg numeric;
  v_p95 numeric;
  v_lag numeric;
  v_types jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF v_env NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'invalid_payload: environment must be sandbox or live';
  END IF;
  v_since := now() - make_interval(hours => v_hours);

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE w.status = 'failed')::int,
    count(*) FILTER (WHERE w.status = 'processed')::int,
    count(*) FILTER (WHERE w.status = 'skipped')::int,
    count(*) FILTER (WHERE w.status NOT IN ('failed','processed','skipped'))::int,
    COALESCE(sum(GREATEST(COALESCE(w.retry_count,0),0)),0)::int,
    round(avg(w.duration_ms)::numeric, 1),
    round((percentile_disc(0.95) WITHIN GROUP (ORDER BY w.duration_ms))::numeric, 1),
    round(avg(EXTRACT(EPOCH FROM (COALESCE(w.processed_at, w.created_at) - w.occurred_at)))::numeric, 2)
  INTO v_total, v_failed, v_processed, v_skipped, v_pending, v_retries, v_avg, v_p95, v_lag
  FROM public.payment_webhook_events w
  WHERE w.environment = v_env AND w.occurred_at >= v_since;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.total DESC), '[]'::jsonb)
    INTO v_types
  FROM (
    SELECT w.event_type,
           count(*)::int AS total,
           count(*) FILTER (WHERE w.status = 'failed')::int AS failed,
           round(avg(w.duration_ms)::numeric, 1) AS avg_duration_ms
    FROM public.payment_webhook_events w
    WHERE w.environment = v_env AND w.occurred_at >= v_since
    GROUP BY w.event_type
    ORDER BY count(*) DESC
    LIMIT 25
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(f)::jsonb ORDER BY f.occurred_at DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT w.id, w.event_type, w.status, w.error, w.occurred_at, w.retry_count
    FROM public.payment_webhook_events w
    WHERE w.environment = v_env AND w.occurred_at >= v_since AND w.status = 'failed'
    ORDER BY w.occurred_at DESC
    LIMIT 20
  ) f;

  RETURN jsonb_build_object(
    'environment', v_env,
    'since', v_since,
    'total', v_total,
    'processed', v_processed,
    'skipped', v_skipped,
    'failed', v_failed,
    'pending', v_pending,
    'retries', v_retries,
    'failure_rate', CASE WHEN v_total > 0 THEN round(v_failed::numeric / v_total, 4) ELSE 0 END,
    'avg_duration_ms', v_avg,
    'p95_duration_ms', v_p95,
    'avg_lag_seconds', v_lag,
    'by_type', v_types,
    'recent_failures', v_recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_payment_webhook_health(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payment_webhook_health(jsonb) TO authenticated, service_role;

-- 5. „W jakim panelu występuje" - sesje prelegentów danego wydarzenia
CREATE OR REPLACE FUNCTION public.event_attendee_sessions(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_slug text := NULLIF(btrim(COALESCE(p_payload->>'event_slug','')), '');
  v_event public.events;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_tenant IS NULL OR v_slug IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: event_slug is required';
  END IF;

  SELECT e.* INTO v_event
  FROM public.events e
  WHERE e.tenant_id = v_tenant AND e.slug = v_slug AND e.status = 'published';

  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'not_found: event does not exist';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      sp.user_id,
      pe.id AS person_id,
      jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'title_pl', s.title_pl,
        'title_en', s.title_en,
        'starts_at', s.starts_at,
        'ends_at', s.ends_at,
        'role', ess.role,
        'track_id', s.track_id
      ) ORDER BY s.starts_at NULLS LAST) AS sessions
    FROM public.event_session_speakers ess
    JOIN public.event_sessions s
      ON s.id = ess.session_id AND s.tenant_id = ess.tenant_id
     AND s.status = 'published' AND s.is_private = false AND s.cancelled_at IS NULL
    JOIN public.speaker_profiles sp
      ON sp.id = ess.speaker_profile_id AND sp.tenant_id = ess.tenant_id
    LEFT JOIN public.event_people pe
      ON pe.id = sp.person_id AND pe.tenant_id = sp.tenant_id
    WHERE ess.tenant_id = v_tenant
      AND ess.event_id = v_event.id
      AND (sp.user_id IS NOT NULL OR sp.person_id IS NOT NULL)
    GROUP BY sp.user_id, pe.id
  ) x;

  RETURN jsonb_build_object('speakers', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.event_attendee_sessions(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_attendee_sessions(jsonb) TO anon, authenticated, service_role;