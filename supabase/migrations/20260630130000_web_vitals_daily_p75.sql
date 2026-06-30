-- Per-day p75 trend for Core Web Vitals, computed in the database over the FULL
-- look-back window.
--
-- The admin dashboard previously derived its per-day trend in memory from only
-- the newest capped sample set (SAMPLE_CAP rows ordered created_at DESC), so on
-- a busy site the trend silently truncated to the most recent days within the
-- window. This function aggregates EVERY row in the window, so the trend is
-- accurate regardless of volume; percentile_cont(0.75) mirrors the in-memory
-- p75 used everywhere else (see src/lib/observability/aggregate.ts).
--
-- Read access is service-role only, matching the web_vitals table itself (RLS
-- enabled, no policies). The server function (src/lib/observability/
-- vitals.functions.ts) calls this via the service-role client AFTER an explicit
-- admin-role check, so RUM analytics stay admin-only. The day key uses UTC to
-- match the in-memory dayKey() (toISOString slice).

CREATE OR REPLACE FUNCTION public.web_vitals_daily_p75(p_since timestamptz)
RETURNS TABLE (day date, metric text, p75 double precision, samples bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day,
    metric,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
    count(*)::bigint AS samples
  FROM public.web_vitals
  WHERE created_at >= p_since
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- Functions default to EXECUTE for PUBLIC; lock this down to the service role
-- only (the only role that can read web_vitals).
REVOKE ALL ON FUNCTION public.web_vitals_daily_p75(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.web_vitals_daily_p75(timestamptz) TO service_role;
