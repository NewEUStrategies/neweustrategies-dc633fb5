-- 1) Wydarzenia: linki dołączenia/nagrania tylko przez get_event_access.
REVOKE SELECT ON public.events FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, slug, title_pl, title_en, description_pl, description_en, kind,
  starts_at, ends_at, timezone, location, visibility, min_tier_rank, capacity,
  status, host_user_id, chatham_house, cover_url, created_by, created_at,
  updated_at, rsvp_opens_at, early_rsvp_rank, program_id, region_id,
  conversation_id, ticket_price_cents, ticket_currency
) ON public.events TO anon, authenticated;

-- Publiczny (anon) odczyt tylko wydarzeń niebramkowanych poziomem.
DROP POLICY IF EXISTS "events public read" ON public.events;
CREATE POLICY "events public read" ON public.events
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
    AND COALESCE(min_tier_rank, 0) = 0
  );

CREATE POLICY "events member read" ON public.events
  FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
  );

-- 2) Profile prelegentów: wewnętrzny identyfikator CRM poza zasięgiem klienta.
REVOKE SELECT ON public.speaker_profiles FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, user_id, headline_pl, headline_en, bio_pl, bio_en,
  topics_pl, topics_en, languages, talks_count, rating, reviews_count,
  is_public, created_at, updated_at
) ON public.speaker_profiles TO authenticated;

-- 3) Redakcja/admin: pełne dane wydarzeń przez funkcje sprawdzające rolę.
CREATE OR REPLACE FUNCTION public.admin_list_events(
  p_status text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS SETOF public.events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL
     OR NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'editor'::app_role))
  THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT e.*
  FROM public.events e
  WHERE e.tenant_id = v_tenant
    AND (p_status IS NULL OR p_status = 'all' OR e.status = p_status)
    AND (
      p_q IS NULL OR btrim(p_q) = ''
      OR e.title_pl ILIKE '%' || btrim(p_q) || '%'
      OR e.title_en ILIKE '%' || btrim(p_q) || '%'
      OR e.slug ILIKE '%' || btrim(p_q) || '%'
    )
  ORDER BY e.starts_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_events(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_events(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_events(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_event(p_id uuid)
RETURNS SETOF public.events
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL
     OR NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'editor'::app_role))
  THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT e.* FROM public.events e
  WHERE e.id = p_id AND e.tenant_id = v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_event(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_event(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_event(uuid) TO authenticated;