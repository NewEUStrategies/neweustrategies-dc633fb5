-- ============================================================================
-- Analityka członków: lejek + retencja kohortowa + dzienna aktywność.
--
-- Growth analytics (newsletter/ad/popup) i RUM istniały, ale platforma nie
-- miała ŻADNEGO widoku retencji ani lejka członka - dane (profiles.created_at,
-- aktywność: user_read_history / comments / messages / bookmarks / follows /
-- post_views, subskrypcje płatne, newsletter) leżały nieużyte. Trzy RPC
-- SECURITY DEFINER (guard: admin tenanta wywołującego) zasilają dashboard
-- /admin/audience:
--
--   admin_member_funnel(p_days)          - liczby lejka (rejestracje, opt-in
--                                          discoverable, aktywni, czytający,
--                                          komentujący, piszący na czacie,
--                                          subskrybenci newslettera, płacący),
--   admin_member_retention(p_weeks)      - tygodniowe kohorty rejestracji x
--                                          aktywność w kolejnych tygodniach,
--   admin_member_activity_series(p_days) - dzienni aktywni + nowe rejestracje.
--
-- "Aktywność" = unia zdarzeń zalogowanych użytkowników (odczyty, komentarze,
-- wiadomości, zakładki, obserwacje, wyświetlenia postów z user_id).
-- Idempotentne.
-- ============================================================================

-- Wspólny guard: admin bieżącego tenanta; zwraca tenant_id wywołującego.
CREATE OR REPLACE FUNCTION public.assert_admin_tenant()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden: caller has no tenant';
  END IF;
  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_admin_tenant() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_admin_tenant() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Lejek członka
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_member_funnel(p_days integer DEFAULT 30)
RETURNS TABLE (
  members_total bigint,
  members_new bigint,
  discoverable_total bigint,
  discoverable_new bigint,
  active_members bigint,
  readers bigint,
  commenters bigint,
  chat_senders bigint,
  newsletter_subscribed bigint,
  paying_members bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_since timestamptz := now() - make_interval(days => LEAST(GREATEST(COALESCE(p_days, 30), 1), 365));
BEGIN
  RETURN QUERY
  WITH tenant_members AS (
    SELECT p.id, p.created_at, p.discoverable
      FROM public.profiles p
     WHERE p.tenant_id = v_tenant
  ),
  activity AS (
    SELECT h.user_id, h.read_at AS ts FROM public.user_read_history h
     WHERE h.read_at >= v_since
    UNION ALL
    SELECT c.user_id, c.created_at FROM public.comments c
     WHERE c.tenant_id = v_tenant AND c.created_at >= v_since
    UNION ALL
    SELECT m.sender_id, m.created_at FROM public.messages m
     WHERE m.tenant_id = v_tenant AND m.created_at >= v_since
    UNION ALL
    SELECT b.user_id, b.created_at FROM public.user_bookmarks b
     WHERE b.created_at >= v_since
    UNION ALL
    SELECT f.user_id, f.created_at FROM public.user_follows f
     WHERE f.created_at >= v_since
    UNION ALL
    SELECT v.user_id, v.viewed_at FROM public.post_views v
     WHERE v.user_id IS NOT NULL AND v.tenant_id = v_tenant AND v.viewed_at >= v_since
  ),
  member_activity AS (
    SELECT a.user_id, a.ts FROM activity a
     WHERE a.user_id IN (SELECT tm.id FROM tenant_members tm)
  )
  SELECT
    (SELECT count(*) FROM tenant_members),
    (SELECT count(*) FROM tenant_members tm WHERE tm.created_at >= v_since),
    (SELECT count(*) FROM tenant_members tm WHERE tm.discoverable),
    (SELECT count(*) FROM tenant_members tm WHERE tm.discoverable AND tm.created_at >= v_since),
    (SELECT count(DISTINCT ma.user_id) FROM member_activity ma),
    (SELECT count(DISTINCT h.user_id) FROM public.user_read_history h
      WHERE h.read_at >= v_since
        AND h.user_id IN (SELECT tm.id FROM tenant_members tm)),
    (SELECT count(DISTINCT c.user_id) FROM public.comments c
      WHERE c.tenant_id = v_tenant AND c.created_at >= v_since),
    (SELECT count(DISTINCT m.sender_id) FROM public.messages m
      WHERE m.tenant_id = v_tenant AND m.created_at >= v_since),
    (SELECT count(*) FROM public.newsletter_subscribers ns
      WHERE ns.tenant_id = v_tenant AND ns.status = 'subscribed'),
    (SELECT count(DISTINCT us.user_id) FROM public.user_subscriptions us
      WHERE us.tenant_id = v_tenant AND us.status = 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_member_funnel(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_funnel(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Retencja kohortowa (tygodnie rejestracji x aktywność w kolejnych tygodniach)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_member_retention(p_weeks integer DEFAULT 8)
RETURNS TABLE (
  cohort_start date,
  cohort_size bigint,
  week_offset integer,
  active_members bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_weeks integer := LEAST(GREATEST(COALESCE(p_weeks, 8), 2), 12);
  v_since timestamptz := date_trunc('week', now()) - make_interval(weeks => v_weeks - 1);
BEGIN
  RETURN QUERY
  WITH cohorts AS (
    SELECT p.id AS user_id, date_trunc('week', p.created_at)::date AS cohort
      FROM public.profiles p
     WHERE p.tenant_id = v_tenant AND p.created_at >= v_since
  ),
  activity AS (
    SELECT h.user_id, h.read_at AS ts FROM public.user_read_history h WHERE h.read_at >= v_since
    UNION ALL
    SELECT c.user_id, c.created_at FROM public.comments c
     WHERE c.tenant_id = v_tenant AND c.created_at >= v_since
    UNION ALL
    SELECT m.sender_id, m.created_at FROM public.messages m
     WHERE m.tenant_id = v_tenant AND m.created_at >= v_since
    UNION ALL
    SELECT b.user_id, b.created_at FROM public.user_bookmarks b WHERE b.created_at >= v_since
    UNION ALL
    SELECT f.user_id, f.created_at FROM public.user_follows f WHERE f.created_at >= v_since
    UNION ALL
    SELECT v.user_id, v.viewed_at FROM public.post_views v
     WHERE v.user_id IS NOT NULL AND v.tenant_id = v_tenant AND v.viewed_at >= v_since
  ),
  cohort_activity AS (
    SELECT co.cohort,
           a.user_id,
           floor(extract(epoch FROM (a.ts - co.cohort::timestamptz)) / 604800)::integer AS wk
      FROM activity a
      JOIN cohorts co ON co.user_id = a.user_id
     WHERE a.ts >= co.cohort::timestamptz
  )
  SELECT co.cohort AS cohort_start,
         count(DISTINCT co.user_id) AS cohort_size,
         wk.week_offset,
         COALESCE(act.active, 0) AS active_members
    FROM cohorts co
    CROSS JOIN LATERAL (
      SELECT generate_series(
        0,
        GREATEST(0, floor(extract(epoch FROM (now() - co.cohort::timestamptz)) / 604800)::integer)
      ) AS week_offset
    ) wk
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT ca.user_id) AS active
        FROM cohort_activity ca
       WHERE ca.cohort = co.cohort AND ca.wk = wk.week_offset
    ) act ON true
   GROUP BY co.cohort, wk.week_offset, act.active
   ORDER BY co.cohort DESC, wk.week_offset ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_member_retention(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_retention(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Seria dzienna: aktywni członkowie + nowe rejestracje
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_member_activity_series(p_days integer DEFAULT 30)
RETURNS TABLE (day date, active_members bigint, new_members bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.assert_admin_tenant();
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 7), 90);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series(v_since::date, now()::date, interval '1 day')::date AS d
  ),
  tenant_members AS (
    SELECT p.id, p.created_at FROM public.profiles p WHERE p.tenant_id = v_tenant
  ),
  activity AS (
    SELECT h.user_id, h.read_at AS ts FROM public.user_read_history h WHERE h.read_at >= v_since
    UNION ALL
    SELECT c.user_id, c.created_at FROM public.comments c
     WHERE c.tenant_id = v_tenant AND c.created_at >= v_since
    UNION ALL
    SELECT m.sender_id, m.created_at FROM public.messages m
     WHERE m.tenant_id = v_tenant AND m.created_at >= v_since
    UNION ALL
    SELECT b.user_id, b.created_at FROM public.user_bookmarks b WHERE b.created_at >= v_since
    UNION ALL
    SELECT f.user_id, f.created_at FROM public.user_follows f WHERE f.created_at >= v_since
    UNION ALL
    SELECT v.user_id, v.viewed_at FROM public.post_views v
     WHERE v.user_id IS NOT NULL AND v.tenant_id = v_tenant AND v.viewed_at >= v_since
  )
  SELECT d.d AS day,
         (SELECT count(DISTINCT a.user_id) FROM activity a
           WHERE a.ts::date = d.d
             AND a.user_id IN (SELECT tm.id FROM tenant_members tm)) AS active_members,
         (SELECT count(*) FROM tenant_members tm
           WHERE tm.created_at::date = d.d) AS new_members
    FROM days d
   ORDER BY d.d ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_member_activity_series(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_activity_series(integer)
  TO authenticated, service_role;
