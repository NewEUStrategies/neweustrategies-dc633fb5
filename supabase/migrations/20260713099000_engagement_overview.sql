-- ============================================================================
-- SPOŁECZNOŚĆ 10/10: przegląd zaangażowania członków (panel /admin/engagement).
--
-- Jedno RPC (staff-gated, SECURITY DEFINER) agregujące zdrowie społeczności
-- zamiast odsłon: liczebność i przyrost, aktywność 7/30 dni (unia realnych
-- działań: wiadomości, komentarze, RSVP, głosy, pytania Q&A, obserwacje),
-- lejek czytelnik -> członek (warstwy z 1/10), opt-in kanałów (push/digest),
-- puls modułów społeczności (wydarzenia, Q&A, ankiety, zgłoszenia, tracker).
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_engagement_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_active_7 integer;
  v_active_30 integer;
  v_result jsonb;
BEGIN
  IF v_user IS NULL OR v_tenant IS NULL
     OR NOT (public.has_role(v_user, 'admin'::app_role)
             OR public.has_role(v_user, 'editor'::app_role)) THEN
    RAISE EXCEPTION 'engagement: staff only';
  END IF;

  WITH activity AS (
    SELECT m.sender_id AS user_id, m.created_at
      FROM public.messages m WHERE m.tenant_id = v_tenant
       AND m.created_at > now() - interval '30 days'
    UNION ALL
    SELECT c.user_id, c.created_at
      FROM public.comments c WHERE c.tenant_id = v_tenant
       AND c.created_at > now() - interval '30 days'
    UNION ALL
    SELECT r.user_id, r.updated_at
      FROM public.event_rsvps r WHERE r.tenant_id = v_tenant
       AND r.updated_at > now() - interval '30 days'
    UNION ALL
    SELECT pv.user_id, pv.updated_at
      FROM public.poll_votes pv WHERE pv.tenant_id = v_tenant
       AND pv.updated_at > now() - interval '30 days'
    UNION ALL
    SELECT q.user_id, q.created_at
      FROM public.qa_questions q WHERE q.tenant_id = v_tenant
       AND q.created_at > now() - interval '30 days'
    UNION ALL
    SELECT f.user_id, f.created_at
      FROM public.eu_policy_follows f WHERE f.tenant_id = v_tenant
       AND f.created_at > now() - interval '30 days'
  )
  SELECT count(DISTINCT user_id) FILTER (WHERE created_at > now() - interval '7 days'),
         count(DISTINCT user_id)
    INTO v_active_7, v_active_30
    FROM activity;

  SELECT jsonb_build_object(
    'members_total', (
      SELECT count(*) FROM public.profiles p WHERE p.tenant_id = v_tenant
    ),
    'members_new_30d', (
      SELECT count(*) FROM public.profiles p
       WHERE p.tenant_id = v_tenant AND p.created_at > now() - interval '30 days'
    ),
    'active_7d', COALESCE(v_active_7, 0),
    'active_30d', COALESCE(v_active_30, 0),
    'subscriptions_active', (
      SELECT count(*)
        FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
       WHERE ap.tenant_id = v_tenant
         AND us.status = 'active'
         AND (us.current_period_end IS NULL OR us.current_period_end > now())
    ),
    'tier_distribution', (
      SELECT COALESCE(jsonb_object_agg(t.key, t.cnt), '{}'::jsonb)
        FROM (
          SELECT COALESCE(ap.tier_key, 'member') AS key, count(DISTINCT us.user_id) AS cnt
            FROM public.user_subscriptions us
            JOIN public.access_plans ap ON ap.id = us.plan_id
           WHERE ap.tenant_id = v_tenant
             AND us.status = 'active'
             AND (us.current_period_end IS NULL OR us.current_period_end > now())
           GROUP BY COALESCE(ap.tier_key, 'member')
        ) t
    ),
    'push_optin', (
      SELECT count(DISTINCT ps.user_id)
        FROM public.push_subscriptions ps
        JOIN public.profiles p ON p.id = ps.user_id
       WHERE p.tenant_id = v_tenant AND ps.failed_at IS NULL
    ),
    'digest_optin', (
      SELECT count(*)
        FROM public.notification_preferences np
        JOIN public.profiles p ON p.id = np.user_id
       WHERE p.tenant_id = v_tenant AND np.email_digest <> 'off'
    ),
    'events_upcoming', (
      SELECT count(*) FROM public.events e
       WHERE e.tenant_id = v_tenant AND e.status = 'published'
         AND e.starts_at > now()
    ),
    'rsvps_upcoming', (
      SELECT count(*)
        FROM public.event_rsvps r
        JOIN public.events e ON e.id = r.event_id
       WHERE e.tenant_id = v_tenant AND e.status = 'published'
         AND e.starts_at > now() AND r.status = 'going'
    ),
    'qa_open_questions', (
      SELECT count(*) FROM public.qa_questions q
       WHERE q.tenant_id = v_tenant AND q.status = 'pending'
    ),
    'poll_votes_30d', (
      SELECT count(*) FROM public.poll_votes pv
       WHERE pv.tenant_id = v_tenant
         AND pv.updated_at > now() - interval '30 days'
    ),
    'submissions_pending', (
      SELECT count(*) FROM public.contributor_submissions cs
       WHERE cs.tenant_id = v_tenant AND cs.status IN ('submitted', 'in_review')
    ),
    'tracker_follows', (
      SELECT count(*) FROM public.eu_policy_follows f
       WHERE f.tenant_id = v_tenant
    ),
    'top_upcoming_events', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'slug', e.slug,
               'title_pl', e.title_pl,
               'title_en', e.title_en,
               'starts_at', e.starts_at,
               'going', COALESCE(g.going, 0)
             ) ORDER BY e.starts_at ASC), '[]'::jsonb)
        FROM (
          SELECT * FROM public.events e
           WHERE e.tenant_id = v_tenant AND e.status = 'published'
             AND e.starts_at > now()
           ORDER BY e.starts_at ASC
           LIMIT 5
        ) e
        LEFT JOIN LATERAL (
          SELECT count(*)::integer AS going
            FROM public.event_rsvps r
           WHERE r.event_id = e.id AND r.status = 'going'
        ) g ON true
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_engagement_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_engagement_overview() TO authenticated, service_role;
