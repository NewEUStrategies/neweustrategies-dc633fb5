CREATE TABLE IF NOT EXISTS public.newsletter_popup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('impression', 'open', 'submit', 'success', 'error')),
  session_id text,
  layout text,
  lang text NOT NULL DEFAULT 'pl' CHECK (lang IN ('pl', 'en')),
  source text,
  variant text,
  error_code text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newsletter_popup_events_tenant_created_idx
  ON public.newsletter_popup_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS newsletter_popup_events_tenant_event_idx
  ON public.newsletter_popup_events (tenant_id, event, created_at DESC);

GRANT SELECT ON public.newsletter_popup_events TO authenticated;
GRANT ALL ON public.newsletter_popup_events TO service_role;

ALTER TABLE public.newsletter_popup_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "newsletter_popup_events_staff_select" ON public.newsletter_popup_events;
CREATE POLICY "newsletter_popup_events_staff_select"
ON public.newsletter_popup_events
FOR SELECT
TO authenticated
USING (
  tenant_id = (SELECT public.current_tenant_id())
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'editor'::app_role)
  )
);

CREATE OR REPLACE FUNCTION public.newsletter_popup_event_stats(_days integer DEFAULT 30)
RETURNS TABLE (day date, event text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day, e.event, count(*)::bigint
  FROM public.newsletter_popup_events e
  WHERE e.tenant_id = public.current_tenant_id()
    AND e.created_at >= now() - make_interval(days => greatest(1, least(_days, 365)))
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
      OR has_role(auth.uid(), 'editor'::app_role)
    )
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2 ASC
$$;

REVOKE ALL ON FUNCTION public.newsletter_popup_event_stats(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.newsletter_popup_event_stats(integer) TO authenticated;