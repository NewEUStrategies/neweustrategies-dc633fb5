CREATE OR REPLACE FUNCTION public.monetization_dashboard(
  _from timestamptz DEFAULT (now() - interval '30 days'),
  _to timestamptz DEFAULT now(),
  _plan_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE v_tenant uuid := public.current_tenant_id(); v_out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH mv AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE user_id IS NOT NULL)::int AS members,
           count(*) FILTER (WHERE user_id IS NULL)::int AS anonymous
    FROM public.metered_views
    WHERE tenant_id = v_tenant AND created_at >= _from AND created_at <= _to
  ), ev AS (
    SELECT
      count(*) FILTER (WHERE outcome='consumed')::int AS consumed,
      count(*) FILTER (WHERE outcome='denied')::int AS denied,
      count(*) FILTER (WHERE outcome='requires_registration')::int AS reg_wall
    FROM public.metering_event_log
    WHERE tenant_id = v_tenant AND occurred_at >= _from AND occurred_at <= _to
  ), orders AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='paid')::int AS paid,
           coalesce(sum(amount_cents) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents
    FROM public.payment_orders
    WHERE tenant_id = v_tenant
      AND created_at >= _from AND created_at <= _to
      AND (_plan_id IS NULL OR plan_id = _plan_id)
  ), coupons AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE active)::int AS active,
           coalesce(sum(redemptions_count),0)::int AS redemptions
    FROM public.b2b_coupons
    WHERE tenant_id = v_tenant
      AND (_organization_id IS NULL OR organization_id = _organization_id)
  ), redemptions AS (
    SELECT count(*)::int AS in_range,
           coalesce(sum(applied_cents),0)::bigint AS discount_cents
    FROM public.b2b_coupon_redemptions r
    WHERE r.tenant_id = v_tenant
      AND r.created_at >= _from AND r.created_at <= _to
      AND (_organization_id IS NULL
           OR EXISTS (SELECT 1 FROM public.b2b_coupons c
                       WHERE c.id = r.coupon_id AND c.organization_id = _organization_id))
  ), cs AS (
    SELECT to_jsonb(cs.*) AS settings
    FROM public.checkout_settings cs
    WHERE cs.tenant_id = v_tenant
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'metered_views', (SELECT to_jsonb(mv) FROM mv),
    'metering_events', (SELECT to_jsonb(ev) FROM ev),
    'orders', (SELECT to_jsonb(orders) FROM orders),
    'coupons', (SELECT to_jsonb(coupons) FROM coupons),
    'redemptions', (SELECT to_jsonb(redemptions) FROM redemptions),
    'checkout_settings', COALESCE((SELECT settings FROM cs), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.b2b_coupons_analytics(_from TIMESTAMPTZ, _to TIMESTAMPTZ)
RETURNS TABLE(
  coupon_id UUID, code TEXT, name TEXT,
  redemptions BIGINT, revenue_cents BIGINT, discount_cents_total BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.code, c.name,
    COUNT(r.id)::BIGINT,
    COALESCE(SUM(r.applied_cents),0)::BIGINT,
    COALESCE(SUM(r.original_cents - r.applied_cents),0)::BIGINT
  FROM public.b2b_coupons c
  LEFT JOIN public.b2b_coupon_redemptions r
    ON r.coupon_id = c.id
   AND r.tenant_id = c.tenant_id
   AND r.created_at BETWEEN _from AND _to
  WHERE c.tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role))
  GROUP BY c.id, c.code, c.name
  ORDER BY COUNT(r.id) DESC
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.metering_impact_preview(_proposed_member_limit integer)
RETURNS TABLE (
  total_members bigint,
  members_blocked bigint,
  members_warning bigint,
  members_safe bigint,
  total_anon bigint,
  anon_blocked bigint,
  avg_used numeric,
  max_used integer,
  total_views bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_month date := date_trunc('month', now())::date;
  v_limit integer := GREATEST(0, LEAST(1000, COALESCE(_proposed_member_limit, 0)));
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'editor')
    OR public.has_role(auth.uid(), 'tenant_admin')
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH members AS (
    SELECT user_id, COUNT(*)::int AS used
      FROM public.metered_views
     WHERE tenant_id = v_tenant
       AND period_month = v_month
       AND user_id IS NOT NULL
     GROUP BY user_id
  ),
  anon AS (
    SELECT visitor_id, COUNT(*)::int AS used
      FROM public.metered_views
     WHERE tenant_id = v_tenant
       AND period_month = v_month
       AND user_id IS NULL
       AND visitor_id IS NOT NULL
     GROUP BY visitor_id
  )
  SELECT
    (SELECT COUNT(*) FROM members),
    (SELECT COUNT(*) FROM members WHERE v_limit > 0 AND used >= v_limit),
    (SELECT COUNT(*) FROM members WHERE v_limit > 0 AND used > 0 AND used < v_limit),
    (SELECT COUNT(*) FROM members WHERE v_limit = 0 OR used = 0),
    (SELECT COUNT(*) FROM anon),
    (SELECT COUNT(*) FROM anon WHERE v_limit > 0 AND used >= v_limit),
    COALESCE((SELECT ROUND(AVG(used)::numeric, 2) FROM members), 0)::numeric,
    COALESCE((SELECT MAX(used) FROM members), 0)::int,
    (SELECT COUNT(*) FROM public.metered_views
      WHERE tenant_id = v_tenant AND period_month = v_month);
END $$;

CREATE OR REPLACE FUNCTION public.authorize_resource_download(p_resource uuid)
RETURNS TABLE (file_path text, file_name text, mime_type text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_res public.member_resources%ROWTYPE;
  v_staff boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'resources: authentication required';
  END IF;
  SELECT * INTO v_res FROM public.member_resources
   WHERE id = p_resource
     AND tenant_id = COALESCE(public.public_tenant_id(), public.current_tenant_id());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resources: not found';
  END IF;
  v_staff := (public.has_role(v_user, 'admin'::app_role)
             OR public.has_role(v_user, 'editor'::app_role))
             AND v_res.tenant_id = public.current_tenant_id();
  IF NOT v_res.published AND NOT v_staff THEN
    RAISE EXCEPTION 'resources: not found';
  END IF;
  IF NOT v_staff AND NOT public.has_tier_rank(v_res.min_tier_rank) THEN
    RAISE EXCEPTION 'resources: tier required';
  END IF;

  INSERT INTO public.resource_downloads (tenant_id, resource_id, user_id)
  VALUES (v_res.tenant_id, v_res.id, v_user);

  RETURN QUERY SELECT v_res.file_path, v_res.file_name, v_res.mime_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (
  can_join boolean,
  join_url text,
  can_watch boolean,
  recording_url text,
  reason text,
  watch_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_allowed boolean;
  v_can_watch boolean;
  v_rsvp text;
BEGIN
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found', 'not_found';
    RETURN;
  END IF;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'auth_required' END;
    RETURN;
  END IF;

  v_staff := (public.has_role(v_user, 'admin'::app_role)
          OR public.has_role(v_user, 'editor'::app_role))
          AND v_event.tenant_id = public.current_tenant_id();
  SELECT er.status INTO v_rsvp
    FROM public.event_rsvps er
   WHERE er.event_id = p_event_id AND er.user_id = v_user;

  IF v_staff THEN
    v_allowed := true;
  ELSIF v_event.visibility = 'members' AND v_event.kind = 'briefing' THEN
    v_allowed := public.has_tier_feature('pro_briefings');
  ELSIF v_event.visibility = 'members' THEN
    v_allowed := public.has_tier_rank(GREATEST(COALESCE(v_event.min_tier_rank, 0), 1));
  ELSE
    v_allowed := public.has_tier_rank(COALESCE(v_event.min_tier_rank, 0));
  END IF;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required',
      CASE WHEN v_event.recording_url IS NULL THEN 'none' ELSE 'tier_required' END;
    RETURN;
  END IF;

  v_can_watch := v_event.recording_url IS NOT NULL
             AND (v_staff OR public.has_tier_feature('recordings'));

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_can_watch,
    CASE WHEN v_can_watch THEN v_event.recording_url END,
    CASE
      WHEN v_rsvp = 'going' OR v_staff THEN 'ok'
      WHEN v_rsvp = 'waitlist' THEN 'waitlisted'
      ELSE 'rsvp_required'
    END,
    CASE
      WHEN v_event.recording_url IS NULL THEN 'none'
      WHEN v_can_watch THEN 'ok'
      ELSE 'tier_required'
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_poll_results(p_poll_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_poll public.polls%ROWTYPE;
  v_my integer;
  v_staff boolean := false;
  v_counts jsonb;
  v_total integer;
BEGIN
  SELECT * INTO v_poll
    FROM public.polls
   WHERE id = p_poll_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_poll.status = 'draft' THEN
    RAISE EXCEPTION 'polls: not found';
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT option_idx INTO v_my
      FROM public.poll_votes WHERE poll_id = p_poll_id AND user_id = v_user;
    v_staff := (public.has_role(v_user, 'admin'::app_role)
            OR public.has_role(v_user, 'editor'::app_role))
            AND v_poll.tenant_id = public.current_tenant_id();
  END IF;

  IF v_my IS NULL AND v_poll.status <> 'closed' AND NOT v_staff THEN
    RETURN jsonb_build_object('visible', false, 'my_vote', NULL);
  END IF;

  SELECT COALESCE(jsonb_object_agg(idx::text, cnt), '{}'::jsonb),
         COALESCE(sum(cnt), 0)::integer
    INTO v_counts, v_total
    FROM (
      SELECT option_idx AS idx, count(*)::integer AS cnt
        FROM public.poll_votes
       WHERE poll_id = p_poll_id
       GROUP BY option_idx
    ) c;

  RETURN jsonb_build_object(
    'visible', true,
    'my_vote', v_my,
    'total', v_total,
    'counts', v_counts
  );
END;
$$;
