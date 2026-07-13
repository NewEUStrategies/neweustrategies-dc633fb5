-- ============================================================================
-- SPOŁECZNOŚĆ 4/10: wydarzenia (webinaria, briefingi, roundtable, AMA).
--
-- Rdzeń społeczności eksperckiej: cykliczne spotkania online z RSVP,
-- przypomnieniami i nagraniami dla członków. Zasady twarde w bazie:
--
--   * events.join_url i recording_url są ODCIĘTE od klienckiego SELECT na
--     poziomie grantów kolumnowych Postgresa (wzorzec kolumn treści postów).
--     Jedyna droga = RPC get_event_access z serwerową oceną uprawnień:
--     status published + (staff LUB [RSVP going + wymagana ranga warstwy]);
--     nagranie: ranga warstwy wystarcza (bez RSVP).
--   * RSVP przez RPC rsvp_event: limit miejsc egzekwowany pod blokadą wiersza
--     wydarzenia (bez wyścigu), unikalność (event, user), zmiana statusu
--     idempotentna. Liczniki publiczne przez get_event_rsvp_counts (definer),
--     bo wiersze event_rsvps są owner-only.
--   * Przypomnienia: run_event_reminders() (pg_cron co godzinę) - powiadomienie
--     'content' dla RSVP 'going' na <24 h przed startem, raz (reminded_at).
--   * Odwołanie wydarzenia powiadamia wszystkich zapisanych.
--   * Publikacja/odwołanie emitują zdarzenia domenowe (szyna z 20260711200000).
--
-- Wszystko idempotentne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL,
  title_en text NOT NULL,
  description_pl text,
  description_en text,
  kind text NOT NULL DEFAULT 'webinar'
    CHECK (kind IN ('webinar', 'briefing', 'roundtable', 'ama', 'in_person', 'hybrid')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  location text,
  join_url text,
  recording_url text,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members')),
  min_tier_rank integer NOT NULL DEFAULT 0 CHECK (min_tier_rank >= 0),
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  host_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  chatham_house boolean NOT NULL DEFAULT false,
  cover_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  CHECK (slug ~ '^[a-z0-9-]{3,120}$'),
  CHECK (btrim(title_pl) <> '' AND btrim(title_en) <> ''),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_upcoming
  ON public.events (tenant_id, starts_at) WHERE status = 'published';

DROP TRIGGER IF EXISTS events_set_updated_at ON public.events;
CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Granty KOLUMNOWE: bez join_url i recording_url dla klientów (droga: RPC).
GRANT SELECT (
  id, tenant_id, slug, title_pl, title_en, description_pl, description_en,
  kind, starts_at, ends_at, timezone, location, visibility, min_tier_rank,
  capacity, status, host_user_id, chatham_house, cover_url, created_by,
  created_at, updated_at
) ON public.events TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events public read" ON public.events;
CREATE POLICY "events public read" ON public.events
  FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
  );

DROP POLICY IF EXISTS "events staff read" ON public.events;
CREATE POLICY "events staff read" ON public.events
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

DROP POLICY IF EXISTS "events staff write" ON public.events;
CREATE POLICY "events staff write" ON public.events
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );

-- ----------------------------------------------------------------------------
-- RSVP (wiersze owner-only; liczniki przez RPC)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'interested', 'cancelled')),
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event
  ON public.event_rsvps (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user
  ON public.event_rsvps (user_id, created_at DESC);

DROP TRIGGER IF EXISTS event_rsvps_set_updated_at ON public.event_rsvps;
CREATE TRIGGER event_rsvps_set_updated_at
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.event_rsvps TO authenticated;
GRANT ALL ON public.event_rsvps TO service_role;
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvps owner read" ON public.event_rsvps;
CREATE POLICY "rsvps owner read" ON public.event_rsvps
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "rsvps staff read" ON public.event_rsvps;
CREATE POLICY "rsvps staff read" ON public.event_rsvps
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (
      public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)
    )
  );
-- Zapisy wyłącznie przez RPC rsvp_event (brak polityk INSERT/UPDATE).

-- ----------------------------------------------------------------------------
-- RPC: zapis/zmiana RSVP z limitem miejsc pod blokadą wiersza wydarzenia
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_going integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'events: authentication required';
  END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid rsvp status';
  END IF;

  -- Blokada wiersza wydarzenia: limit miejsc bez wyścigu.
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id
     AND tenant_id = public.public_tenant_id()
     AND status = 'published'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'events: not found';
  END IF;

  IF v_event.visibility = 'members' AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN
    RAISE EXCEPTION 'events: membership required';
  END IF;

  IF p_status = 'going' AND v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_going
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going' AND user_id <> v_user;
    IF v_going >= v_event.capacity THEN
      RAISE EXCEPTION 'events: full';
    END IF;
  END IF;

  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
  VALUES (v_event.tenant_id, p_event_id, v_user, p_status)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET status = EXCLUDED.status, updated_at = now();

  SELECT count(*) INTO v_going
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND status = 'going';

  RETURN jsonb_build_object('status', p_status, 'going', v_going);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

-- Publiczne liczniki RSVP dla listy/detalu (wiersze są owner-only).
CREATE OR REPLACE FUNCTION public.get_event_rsvp_counts(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, going integer, interested integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.event_id,
         count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'interested')::integer
    FROM public.event_rsvps r
    JOIN public.events e ON e.id = r.event_id
   WHERE r.event_id = ANY (p_event_ids)
     AND e.tenant_id = public.public_tenant_id()
     AND e.status = 'published'
   GROUP BY r.event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[])
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RPC: jedyna droga do join_url / recording_url
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (can_join boolean, join_url text, can_watch boolean, recording_url text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_rank integer := public.current_tier_rank();
  v_rsvp text;
BEGIN
  SELECT * INTO v_event
    FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found';
    RETURN;
  END IF;

  IF v_user IS NOT NULL THEN
    v_staff := public.has_role(v_user, 'admin'::app_role)
            OR public.has_role(v_user, 'editor'::app_role);
    SELECT status INTO v_rsvp
      FROM public.event_rsvps
     WHERE event_id = p_event_id AND user_id = v_user;
  END IF;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required';
    RETURN;
  END IF;

  IF NOT v_staff AND v_rank < v_event.min_tier_rank THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required';
    RETURN;
  END IF;

  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_event.recording_url IS NOT NULL,
    v_event.recording_url,
    CASE WHEN v_rsvp = 'going' OR v_staff THEN 'ok' ELSE 'rsvp_required' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid)
  TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Przypomnienia (<24 h przed startem, raz) + powiadomienie o odwołaniu
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_event_reminders()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT r.id AS rsvp_id, r.user_id, e.slug, e.title_pl, e.title_en, e.starts_at
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
     WHERE e.status = 'published'
       AND e.starts_at BETWEEN now() AND now() + interval '24 hours'
       AND r.status = 'going'
       AND r.reminded_at IS NULL
     LIMIT 500
  LOOP
    PERFORM public.enqueue_notification(
      v_row.user_id,
      'content',
      'Przypomnienie: ' || v_row.title_pl,
      'Reminder: ' || v_row.title_en,
      'Wydarzenie zaczyna się ' || to_char(v_row.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI') || '.',
      'The event starts at ' || to_char(v_row.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI') || ' (Warsaw time).',
      '/events/' || v_row.slug,
      'CalendarClock'
    );
    UPDATE public.event_rsvps SET reminded_at = now() WHERE id = v_row.rsvp_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_event_reminders() TO service_role;

CREATE OR REPLACE FUNCTION public.tg_events_status_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  IF OLD.status = 'published' AND NEW.status = 'cancelled' THEN
    FOR v_row IN
      SELECT user_id FROM public.event_rsvps
       WHERE event_id = NEW.id AND status IN ('going', 'interested')
    LOOP
      PERFORM public.enqueue_notification(
        v_row.user_id,
        'content',
        'Odwołano wydarzenie: ' || NEW.title_pl,
        'Event cancelled: ' || NEW.title_en,
        NULL, NULL,
        '/events/' || NEW.slug,
        'CalendarX'
      );
    END LOOP;
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'event', NEW.id::text, 'event.cancelled.v1',
      jsonb_build_object('slug', NEW.slug, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en)
    );
  ELSIF OLD.status <> 'published' AND NEW.status = 'published' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'event', NEW.id::text, 'event.published.v1',
      jsonb_build_object(
        'slug', NEW.slug, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en,
        'starts_at', NEW.starts_at, 'author_id', NEW.host_user_id
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'events: status notify failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_status_notify ON public.events;
CREATE TRIGGER events_status_notify
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_status_notify();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-reminders', '5 * * * *',
      'SELECT public.run_event_reminders()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - event reminders require manual runs';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;
