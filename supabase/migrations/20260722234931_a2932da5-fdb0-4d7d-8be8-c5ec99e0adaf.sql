
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id UUID NOT NULL DEFAULT public.public_tenant_id(),
  event_type TEXT NOT NULL,           -- 'page_view' | 'cta_click' | 'search' | 'interaction' | 'view'
  event_name TEXT NOT NULL,           -- np. 'pricing_signup_click', 'pricing_interval_change'
  path TEXT,
  referrer TEXT,
  entity_type TEXT,                   -- 'post' | 'page' | 'author' | 'expert' | 'tier' | 'plan' | 'banner' | 'search_query' | ...
  entity_id TEXT,
  session_id TEXT,                    -- anon session (24h)
  anon_id TEXT,                       -- long-term anonymous visitor id
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ua TEXT,
  lang TEXT
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON public.analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_tenant_created_idx ON public.analytics_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_created_idx ON public.analytics_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_entity_idx ON public.analytics_events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON public.analytics_events (session_id, created_at DESC);

GRANT SELECT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.analytics_events_id_seq TO service_role;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analytics_events_admin_read ON public.analytics_events;
CREATE POLICY analytics_events_admin_read ON public.analytics_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'editor')
  );

-- Widok agregujący dla panelu admin (SECURITY INVOKER - dziedziczy RLS z tabeli).
CREATE OR REPLACE VIEW public.analytics_events_daily
WITH (security_invoker = on)
AS
SELECT
  tenant_id,
  event_name,
  event_type,
  date_trunc('day', created_at) AS day,
  COUNT(*)::bigint AS hits,
  COUNT(DISTINCT session_id)::bigint AS unique_sessions,
  COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)::bigint AS unique_users
FROM public.analytics_events
GROUP BY tenant_id, event_name, event_type, date_trunc('day', created_at);

GRANT SELECT ON public.analytics_events_daily TO authenticated;
