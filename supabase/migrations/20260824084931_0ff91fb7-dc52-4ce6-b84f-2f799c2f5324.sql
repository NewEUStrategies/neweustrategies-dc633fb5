CREATE OR REPLACE FUNCTION public.admin_event_session_signup_set(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_editor_tenant();
  v_session_id uuid := NULLIF(p_payload->>'session_id', '')::uuid;
  v_user_id uuid := NULLIF(p_payload->>'user_id', '')::uuid;
  v_wanted text := COALESCE(NULLIF(p_payload->>'status', ''), 'registered');
  v_force boolean := COALESCE((NULLIF(p_payload->>'force', ''))::boolean, false);
  v_session public.event_sessions;
  v_prev text;
  v_registered integer;
  v_final text;
  v_promoted uuid;
BEGIN
  IF v_session_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: session_id and user_id are required';
  END IF;

  IF v_wanted NOT IN ('registered', 'waitlist', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be registered, waitlist or cancelled';
  END IF;

  SELECT * INTO v_session
  FROM public.event_sessions s
  WHERE s.id = v_session_id AND s.tenant_id = v_tenant
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'not_found: session does not exist in this tenant';
  END IF;

  IF NOT v_session.requires_signup THEN
    RAISE EXCEPTION 'signup_disabled: this session does not take signups';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = v_user_id AND p.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'person_not_found: this account has no profile in your organisation';
  END IF;

  SELECT g.status INTO v_prev
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.user_id = v_user_id;

  IF v_wanted = 'cancelled' THEN
    IF v_prev IS NULL OR v_prev = 'cancelled' THEN
      RETURN jsonb_build_object('status', 'cancelled', 'promoted', false);
    END IF;

    UPDATE public.event_session_signups
    SET status = 'cancelled', cancelled_at = now()
    WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_user_id;

    IF v_prev = 'registered' THEN
      SELECT g.user_id INTO v_promoted
      FROM public.event_session_signups g
      WHERE g.tenant_id = v_tenant
        AND g.session_id = v_session_id
        AND g.status = 'waitlist'
      ORDER BY g.registered_at, g.id
      LIMIT 1;

      IF v_promoted IS NOT NULL THEN
        UPDATE public.event_session_signups
        SET status = 'registered'
        WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_promoted;
      END IF;
    END IF;

    RETURN jsonb_build_object('status', 'cancelled', 'promoted', v_promoted IS NOT NULL);
  END IF;

  IF v_session.min_tier_rank > 0
     AND public.user_tier_rank(v_user_id, v_tenant) < v_session.min_tier_rank THEN
    RAISE EXCEPTION 'tier_required: this person does not hold the required membership tier';
  END IF;

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant
    AND g.session_id = v_session_id
    AND g.status = 'registered'
    AND g.user_id <> v_user_id;

  IF v_wanted = 'registered'
     AND v_session.capacity IS NOT NULL
     AND v_registered >= v_session.capacity
     AND NOT v_force THEN
    RAISE EXCEPTION 'session_full: % of % seats taken - use force to exceed the limit',
      v_registered, v_session.capacity;
  END IF;

  v_final := v_wanted;

  INSERT INTO public.event_session_signups (
    tenant_id, event_id, session_id, user_id, status, registered_at, created_by
  ) VALUES (
    v_tenant, v_session.event_id, v_session_id, v_user_id, v_final, now(), auth.uid()
  )
  ON CONFLICT (tenant_id, session_id, user_id) DO UPDATE
    SET status = EXCLUDED.status,
        registered_at = CASE
          WHEN event_session_signups.status = 'cancelled' THEN now()
          ELSE event_session_signups.registered_at
        END,
        cancelled_at = NULL,
        created_by = COALESCE(event_session_signups.created_by, EXCLUDED.created_by),
        updated_at = now();

  SELECT count(*)::integer INTO v_registered
  FROM public.event_session_signups g
  WHERE g.tenant_id = v_tenant AND g.session_id = v_session_id AND g.status = 'registered';

  RETURN jsonb_build_object(
    'status', v_final,
    'promoted', false,
    'registered', v_registered,
    'over_capacity', v_session.capacity IS NOT NULL AND v_registered > v_session.capacity,
    'seats_left', CASE
      WHEN v_session.capacity IS NULL THEN NULL
      ELSE GREATEST(v_session.capacity - v_registered, 0)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_event_session_signup_set(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_event_session_signup_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_event_session_signup_set(jsonb) IS
  'Zapis, awans albo wypisanie uczestnika przez organizatora: {"session_id":uuid,"user_id":uuid,"status":"registered|waitlist|cancelled","force":bool}. Prog warstwy obowiazuje; przekroczenie limitu wymaga force i widac je w raporcie kolizji. Bramka: assert_editor_tenant().';