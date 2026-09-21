CREATE OR REPLACE FUNCTION public.record_profile_view(p_profile UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant UUID; v_mode TEXT; v_snapshot JSONB;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() = p_profile THEN RETURN; END IF;
  SELECT profile_view_mode INTO v_mode FROM public.profiles WHERE id = auth.uid();
  IF v_mode = 'private' THEN RETURN; END IF;
  v_tenant := public._caller_tenant();
  IF v_mode = 'public' THEN
    SELECT jsonb_build_object(
      'display_name', display_name, 'job_title', job_title,
      'company', current_company, 'avatar_url', avatar_url
    ) INTO v_snapshot FROM public.profiles WHERE id = auth.uid();
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profile_view_events
     WHERE profile_id = p_profile AND viewer_id = auth.uid()
       AND viewed_at > now() - INTERVAL '1 hour'
  ) THEN RETURN; END IF;
  INSERT INTO public.profile_view_events
    (tenant_id, profile_id, viewer_id, viewer_mode, viewer_snapshot)
  VALUES (v_tenant, p_profile, auth.uid(), v_mode, v_snapshot);
END; $$;

CREATE OR REPLACE FUNCTION public.my_profile_viewers(p_limit INT DEFAULT 20)
RETURNS TABLE (
  viewed_at TIMESTAMPTZ, viewer_mode TEXT,
  viewer_id UUID, display_name TEXT, avatar_url TEXT, job_title TEXT, company TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT e.viewed_at, e.viewer_mode,
           CASE WHEN e.viewer_mode = 'public' THEN e.viewer_id END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'display_name') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'avatar_url') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'job_title') END,
           CASE WHEN e.viewer_mode = 'public' THEN (e.viewer_snapshot->>'company') END
      FROM public.profile_view_events e
     WHERE e.profile_id = auth.uid()
       AND e.viewer_mode <> 'private'
     ORDER BY e.viewed_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 100);
END; $$;

CREATE OR REPLACE FUNCTION public.profile_view_stats()
RETURNS TABLE (last_7 INT, last_30 INT, last_90 INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '7 days')::int,
         COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '30 days')::int,
         COUNT(*) FILTER (WHERE viewed_at > now() - INTERVAL '90 days')::int
    FROM public.profile_view_events
   WHERE profile_id = auth.uid()
     AND viewer_mode <> 'private';
$$;

COMMENT ON COLUMN public.profile_view_events.viewer_mode IS
  'Tryb widza w chwili odsłony. Wiersze ''private'' NIE POWSTAJĄ od 20260913170000 (record_profile_view wychodzi przed INSERT); istniejące są odsiewane przy odczycie przez my_profile_viewers i profile_view_stats.';