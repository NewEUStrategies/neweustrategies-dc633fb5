-- events-harness: include
-- One publication policy for the readiness panel and every status transition.
CREATE OR REPLACE FUNCTION public.admin_event_publish_readiness(p_event_id uuid)
RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_event public.events;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO v_event FROM public.events
  WHERE id = p_event_id AND tenant_id = v_tenant;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found: event does not exist in this tenant'; END IF;
  IF btrim(COALESCE(v_event.title_pl, '')) = '' OR btrim(COALESCE(v_event.title_en, '')) = '' THEN
    v_blockers := array_append(v_blockers, 'title');
  END IF;
  IF v_event.starts_at IS NULL OR (v_event.ends_at IS NOT NULL AND v_event.ends_at <= v_event.starts_at) THEN
    v_blockers := array_append(v_blockers, 'schedule');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_event.timezone) THEN
    v_blockers := array_append(v_blockers, 'timezone');
  END IF;
  IF COALESCE(v_event.format, 'onsite') <> 'online'
     AND (btrim(COALESCE(v_event.city, '')) = '' OR btrim(COALESCE(v_event.street_address, '')) = '') THEN
    v_blockers := array_append(v_blockers, 'venue');
  END IF;
  IF btrim(COALESCE(v_event.cover_url, '')) = '' THEN
    v_blockers := array_append(v_blockers, 'cover');
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_event_agenda_conflicts(p_event_id)) THEN
    v_blockers := array_append(v_blockers, 'conflicts');
  END IF;
  RETURN v_blockers;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_publish_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_publish_readiness(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_event_set_status(p_event_id uuid, p_status text)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.assert_event_admin_tenant();
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_event public.events;
  v_blockers text[];
BEGIN
  IF v_status NOT IN ('draft', 'published', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: status must be draft, published or cancelled';
  END IF;
  SELECT * INTO v_event FROM public.events e
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant FOR UPDATE;
  IF v_event.id IS NULL THEN RAISE EXCEPTION 'not_found: event does not exist in this tenant'; END IF;
  IF v_status = 'published' THEN
    v_blockers := public.admin_event_publish_readiness(p_event_id);
    IF cardinality(v_blockers) > 0 THEN
      RAISE EXCEPTION 'publish_blocked: %', array_to_string(v_blockers, ',');
    END IF;
  END IF;
  UPDATE public.events e SET
    status = v_status,
    published_at = CASE WHEN v_status = 'published' THEN COALESCE(e.published_at, now()) ELSE e.published_at END,
    cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(e.cancelled_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE e.id = p_event_id AND e.tenant_id = v_tenant;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_event_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_set_status(uuid, text) TO authenticated, service_role;

-- Serialize agenda writes against the event lock acquired before publication.
-- The VOLATILE readiness RPC reads a fresh snapshot after any lock wait.
CREATE OR REPLACE FUNCTION public._event_lock_publication_parent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
BEGIN
  PERFORM e.id FROM public.events e
  WHERE e.id IN (
    SELECT (r->>'event_id')::uuid FROM unnest(ARRAY[v_old, v_new]) r
    WHERE r ? 'event_id'
    UNION
    SELECT s.event_id FROM public.event_sessions s
    JOIN unnest(ARRAY[v_old, v_new]) r ON s.id = (r->>'session_id')::uuid
    WHERE s.tenant_id = (r->>'tenant_id')::uuid
  )
  ORDER BY e.id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._event_lock_publication_parent() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS event_sessions_publication_lock ON public.event_sessions;
CREATE TRIGGER event_sessions_publication_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.event_sessions FOR EACH ROW EXECUTE FUNCTION public._event_lock_publication_parent();
DROP TRIGGER IF EXISTS event_speakers_publication_lock ON public.event_session_speakers;
CREATE TRIGGER event_speakers_publication_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.event_session_speakers FOR EACH ROW EXECUTE FUNCTION public._event_lock_publication_parent();
DROP TRIGGER IF EXISTS event_signups_publication_lock ON public.event_session_signups;
CREATE TRIGGER event_signups_publication_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.event_session_signups FOR EACH ROW EXECUTE FUNCTION public._event_lock_publication_parent();
