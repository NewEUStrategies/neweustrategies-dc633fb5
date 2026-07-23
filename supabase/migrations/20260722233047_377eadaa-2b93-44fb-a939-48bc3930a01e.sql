
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
  v_tenant uuid := public.public_tenant_id();
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

REVOKE EXECUTE ON FUNCTION public.metering_impact_preview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metering_impact_preview(integer) TO authenticated, service_role;
