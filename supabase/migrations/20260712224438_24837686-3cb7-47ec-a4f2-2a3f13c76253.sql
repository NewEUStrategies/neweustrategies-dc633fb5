-- ============================================================================
-- SPOŁECZNOŚĆ 1/10: warstwy członkostwa (tiers).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.membership_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text,
  description_en text,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  CHECK (key ~ '^[a-z0-9_-]{2,32}$'),
  CHECK (rank >= 0),
  CHECK (btrim(name_pl) <> '' AND btrim(name_en) <> ''),
  CHECK (jsonb_typeof(benefits) = 'array'),
  CHECK (jsonb_typeof(features) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_membership_tiers_default
  ON public.membership_tiers (tenant_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_membership_tiers_tenant_rank
  ON public.membership_tiers (tenant_id, rank DESC) WHERE active;

DROP TRIGGER IF EXISTS membership_tiers_set_updated_at ON public.membership_tiers;
CREATE TRIGGER membership_tiers_set_updated_at
  BEFORE UPDATE ON public.membership_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.membership_tiers TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.membership_tiers TO authenticated;
GRANT ALL ON public.membership_tiers TO service_role;
ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tiers public read" ON public.membership_tiers;
CREATE POLICY "tiers public read" ON public.membership_tiers
  FOR SELECT TO anon, authenticated
  USING (active AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "tiers staff read" ON public.membership_tiers;
CREATE POLICY "tiers staff read" ON public.membership_tiers
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "tiers admin write" ON public.membership_tiers;
CREATE POLICY "tiers admin write" ON public.membership_tiers
  FOR ALL TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  )
  WITH CHECK (
    tenant_id = (SELECT public.current_tenant_id())
    AND public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

ALTER TABLE public.access_plans ADD COLUMN IF NOT EXISTS tier_key text;

CREATE OR REPLACE FUNCTION public.current_membership_tier()
RETURNS TABLE (key text, rank integer, name_pl text, name_en text, features jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(public.public_tenant_id(), public.current_tenant_id()) AS tid
  ),
  sub_tier AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN t ON ap.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = auth.uid()
       AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
     ORDER BY mt.rank DESC
     LIMIT 1
  ),
  def AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_tiers mt
      JOIN t ON mt.tenant_id = t.tid
     WHERE mt.is_default AND mt.active
     LIMIT 1
  )
  SELECT * FROM sub_tier
  UNION ALL
  SELECT * FROM def WHERE NOT EXISTS (SELECT 1 FROM sub_tier)
  UNION ALL
  SELECT 'reader', 0, 'Czytelnik', 'Reader', '{}'::jsonb
   WHERE NOT EXISTS (SELECT 1 FROM sub_tier)
     AND NOT EXISTS (SELECT 1 FROM def);
$$;

REVOKE EXECUTE ON FUNCTION public.current_membership_tier() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_membership_tier()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_tier_rank()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT rank FROM public.current_membership_tier() LIMIT 1), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.current_tier_rank() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tier_rank() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_tier_rank(_min integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_tier_rank() >= COALESCE(_min, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.has_tier_rank(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_tier_rank(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order
    FROM (VALUES
      ('reader', 0, 'Czytelnik', 'Reader',
       'Bezpłatne konto: lektura, zakładki, obserwowanie i dyskusja.',
       'Free account: reading, bookmarks, follows and discussion.',
       '[{"pl":"Dostęp do treści otwartych","en":"Access to open content"},{"pl":"Zakładki i obserwowanie tematów","en":"Bookmarks and topic follows"},{"pl":"Udział w dyskusjach","en":"Join the discussion"}]'::jsonb,
       '{}'::jsonb, true, 0),
      ('member', 10, 'Członek', 'Member',
       'Pełny dostęp do analiz oraz wydarzeń i briefingów dla członków.',
       'Full access to analyses plus member events and briefings.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},{"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},{"pl":"Nagrania z wydarzeń","en":"Event recordings"},{"pl":"Cotygodniowy digest e-mail","en":"Weekly e-mail digest"}]'::jsonb,
       '{"events_members": true, "recordings": true}'::jsonb, false, 10),
      ('pro', 20, 'Pro', 'Pro',
       'Dla profesjonalistów public affairs: pełny pakiet plus priorytet pytań do ekspertów.',
       'For public-affairs professionals: everything plus priority expert Q&A.',
       '[{"pl":"Wszystko z planu Członek","en":"Everything in Member"},{"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},{"pl":"Zamknięte briefingi Pro","en":"Closed-door Pro briefings"},{"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true}'::jsonb, false, 20)
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features, is_default, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_membership_tiers(v_t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.tg_tenants_seed_membership_tiers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN PERFORM public.seed_membership_tiers(NEW.id); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS tenants_seed_membership_tiers ON public.tenants;
CREATE TRIGGER tenants_seed_membership_tiers
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenants_seed_membership_tiers();

UPDATE public.access_plans SET tier_key = 'member' WHERE tier_key IS NULL;

-- ============================================================================
-- SPOŁECZNOŚĆ 3/10: kanały powiadomień - web push + digest e-mail
-- ============================================================================

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_digest text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS digest_last_sent_at timestamptz;

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_email_digest_check;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_email_digest_check
  CHECK (email_digest IN ('off', 'daily', 'weekly'));

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  failed_at timestamptz,
  UNIQUE (endpoint),
  CHECK (endpoint ~ '^https://'),
  CHECK (length(endpoint) <= 1024),
  CHECK (length(p256dh) BETWEEN 16 AND 256),
  CHECK (length(auth) BETWEEN 8 AND 64)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id) WHERE failed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push subs owner all" ON public.push_subscriptions;
CREATE POLICY "push subs owner all" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.notification_push_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_push_queue_due
  ON public.notification_push_queue (next_attempt_at) WHERE status = 'pending';

GRANT ALL ON public.notification_push_queue TO service_role;
ALTER TABLE public.notification_push_queue ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.tg_notifications_enqueue_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = NEW.user_id AND np.push_enabled)
     AND EXISTS (SELECT 1 FROM public.push_subscriptions ps WHERE ps.user_id = NEW.user_id AND ps.failed_at IS NULL)
  THEN
    INSERT INTO public.notification_push_queue (tenant_id, notification_id, user_id, payload)
    VALUES (NEW.tenant_id, NEW.id, NEW.user_id, jsonb_build_object(
      'kind', NEW.kind, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en,
      'body_pl', NEW.body_pl, 'body_en', NEW.body_en, 'href', NEW.href));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push enqueue failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_enqueue_push ON public.notifications;
CREATE TRIGGER notifications_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_enqueue_push();

CREATE OR REPLACE FUNCTION public.claim_push_jobs(p_limit integer DEFAULT 50)
RETURNS SETOF public.notification_push_queue
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.notification_push_queue q
     SET attempts = q.attempts + 1,
         next_attempt_at = now() + (interval '1 minute' * power(2, LEAST(q.attempts, 6)))
   WHERE q.id IN (
     SELECT id FROM public.notification_push_queue
      WHERE status = 'pending' AND next_attempt_at <= now()
      ORDER BY id LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING q.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_push_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.report_push_job(p_id bigint, p_ok boolean, p_dead boolean DEFAULT false)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.notification_push_queue
     SET status = CASE WHEN p_ok THEN 'sent' WHEN p_dead OR attempts >= 8 THEN 'dead' ELSE 'pending' END,
         sent_at = CASE WHEN p_ok THEN now() ELSE sent_at END
   WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.report_push_job(bigint, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_push_job(bigint, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_push_subscription_failed(p_endpoint text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.push_subscriptions SET failed_at = now()
   WHERE endpoint = p_endpoint AND failed_at IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_push_subscription_failed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_push_subscription_failed(text) TO service_role;

CREATE OR REPLACE FUNCTION public.prune_push_queue(p_keep interval DEFAULT interval '14 days')
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.notification_push_queue
   WHERE status IN ('sent', 'dead') AND created_at < now() - p_keep;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_push_queue(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_push_queue(interval) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_digests(p_frequency text, p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, email text, display_name text, items jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_window interval;
BEGIN
  IF p_frequency NOT IN ('daily', 'weekly') THEN
    RAISE EXCEPTION 'digest: unknown frequency %', p_frequency;
  END IF;
  v_window := CASE p_frequency WHEN 'daily' THEN interval '20 hours' ELSE interval '6 days' END;

  RETURN QUERY
  WITH cand AS (
    SELECT np.user_id AS uid,
           COALESCE(np.digest_last_sent_at, now() - interval '14 days') AS since
      FROM public.notification_preferences np
     WHERE np.email_digest = p_frequency
       AND (np.digest_last_sent_at IS NULL OR np.digest_last_sent_at < now() - v_window)
       AND EXISTS (SELECT 1 FROM public.notifications n
                    WHERE n.user_id = np.user_id AND n.read_at IS NULL
                      AND n.created_at > COALESCE(np.digest_last_sent_at, now() - interval '14 days'))
     ORDER BY np.digest_last_sent_at ASC NULLS FIRST
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
       FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.notification_preferences np SET digest_last_sent_at = now()
      FROM cand WHERE np.user_id = cand.uid RETURNING np.user_id AS uid
  )
  SELECT p.id, p.email, COALESCE(p.display_name, split_part(p.email, '@', 1)),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'kind', q.kind, 'title_pl', q.title_pl, 'title_en', q.title_en,
                   'body_pl', q.body_pl, 'body_en', q.body_en, 'href', q.href,
                   'created_at', q.created_at) ORDER BY q.created_at DESC), '[]'::jsonb)
             FROM (SELECT n.kind, n.title_pl, n.title_en, n.body_pl, n.body_en, n.href, n.created_at
                     FROM public.notifications n JOIN cand c ON c.uid = n.user_id
                    WHERE n.user_id = p.id AND n.read_at IS NULL AND n.created_at > c.since
                    ORDER BY n.created_at DESC LIMIT 20) q)
    FROM upd JOIN public.profiles p ON p.id = upd.uid
   WHERE p.email IS NOT NULL AND p.email <> '';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_due_digests(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_digests(text, integer) TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('prune-push-queue', '30 3 * * *', 'SELECT public.prune_push_queue()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- SPOŁECZNOŚĆ 4/10: wydarzenia (events + RSVP)
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
  USING (status = 'published' AND tenant_id = (SELECT public.public_tenant_id()));

DROP POLICY IF EXISTS "events staff read" ON public.events;
CREATE POLICY "events staff read" ON public.events
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

DROP POLICY IF EXISTS "events staff write" ON public.events;
CREATE POLICY "events staff write" ON public.events
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

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

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON public.event_rsvps (event_id, status);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user ON public.event_rsvps (user_id, created_at DESC);

DROP TRIGGER IF EXISTS event_rsvps_set_updated_at ON public.event_rsvps;
CREATE TRIGGER event_rsvps_set_updated_at
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.event_rsvps TO authenticated;
GRANT ALL ON public.event_rsvps TO service_role;
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvps owner read" ON public.event_rsvps;
CREATE POLICY "rsvps owner read" ON public.event_rsvps
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "rsvps staff read" ON public.event_rsvps;
CREATE POLICY "rsvps staff read" ON public.event_rsvps
  FOR SELECT TO authenticated
  USING (tenant_id = (SELECT public.current_tenant_id())
    AND (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'editor'::app_role)));

CREATE OR REPLACE FUNCTION public.rsvp_event(p_event_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_going integer;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'events: authentication required'; END IF;
  IF p_status NOT IN ('going', 'interested', 'cancelled') THEN
    RAISE EXCEPTION 'events: invalid rsvp status';
  END IF;
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id()
     AND status = 'published' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'events: not found'; END IF;
  IF v_event.visibility = 'members' AND NOT public.has_tier_rank(GREATEST(v_event.min_tier_rank, 1)) THEN
    RAISE EXCEPTION 'events: membership required';
  END IF;
  IF p_status = 'going' AND v_event.capacity IS NOT NULL THEN
    SELECT count(*) INTO v_going FROM public.event_rsvps
     WHERE event_id = p_event_id AND status = 'going' AND user_id <> v_user;
    IF v_going >= v_event.capacity THEN RAISE EXCEPTION 'events: full'; END IF;
  END IF;
  INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
  VALUES (v_event.tenant_id, p_event_id, v_user, p_status)
  ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();
  SELECT count(*) INTO v_going FROM public.event_rsvps
   WHERE event_id = p_event_id AND status = 'going';
  RETURN jsonb_build_object('status', p_status, 'going', v_going);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rsvp_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rsvp_event(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_rsvp_counts(p_event_ids uuid[])
RETURNS TABLE (event_id uuid, going integer, interested integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.event_id,
         count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'interested')::integer
    FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
   WHERE r.event_id = ANY (p_event_ids)
     AND e.tenant_id = public.public_tenant_id() AND e.status = 'published'
   GROUP BY r.event_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_rsvp_counts(uuid[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_access(p_event_id uuid)
RETURNS TABLE (can_join boolean, join_url text, can_watch boolean, recording_url text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_staff boolean := false;
  v_rank integer := public.current_tier_rank();
  v_rsvp text;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND tenant_id = public.public_tenant_id();
  IF NOT FOUND OR v_event.status <> 'published' THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'not_found'; RETURN;
  END IF;
  IF v_user IS NOT NULL THEN
    v_staff := public.has_role(v_user, 'admin'::app_role) OR public.has_role(v_user, 'editor'::app_role);
    SELECT status INTO v_rsvp FROM public.event_rsvps WHERE event_id = p_event_id AND user_id = v_user;
  END IF;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'auth_required'; RETURN;
  END IF;
  IF NOT v_staff AND v_rank < v_event.min_tier_rank THEN
    RETURN QUERY SELECT false, NULL::text, false, NULL::text, 'tier_required'; RETURN;
  END IF;
  RETURN QUERY SELECT
    (v_staff OR v_rsvp = 'going') AND v_event.join_url IS NOT NULL,
    CASE WHEN (v_staff OR v_rsvp = 'going') THEN v_event.join_url END,
    v_event.recording_url IS NOT NULL, v_event.recording_url,
    CASE WHEN v_rsvp = 'going' OR v_staff THEN 'ok' ELSE 'rsvp_required' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_event_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_access(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_event_reminders()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row record; v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT r.id AS rsvp_id, r.user_id, e.slug, e.title_pl, e.title_en, e.starts_at
      FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
     WHERE e.status = 'published'
       AND e.starts_at BETWEEN now() AND now() + interval '24 hours'
       AND r.status = 'going' AND r.reminded_at IS NULL
     LIMIT 500
  LOOP
    PERFORM public.enqueue_notification(
      v_row.user_id, 'content',
      'Przypomnienie: ' || v_row.title_pl, 'Reminder: ' || v_row.title_en,
      'Wydarzenie zaczyna się ' || to_char(v_row.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI') || '.',
      'The event starts at ' || to_char(v_row.starts_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI') || ' (Warsaw time).',
      '/events/' || v_row.slug, 'CalendarClock');
    UPDATE public.event_rsvps SET reminded_at = now() WHERE id = v_row.rsvp_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_event_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_event_reminders() TO service_role;

CREATE OR REPLACE FUNCTION public.tg_events_status_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row record;
BEGIN
  IF OLD.status = 'published' AND NEW.status = 'cancelled' THEN
    FOR v_row IN SELECT user_id FROM public.event_rsvps
                  WHERE event_id = NEW.id AND status IN ('going', 'interested') LOOP
      PERFORM public.enqueue_notification(v_row.user_id, 'content',
        'Odwołano wydarzenie: ' || NEW.title_pl, 'Event cancelled: ' || NEW.title_en,
        NULL, NULL, '/events/' || NEW.slug, 'CalendarX');
    END LOOP;
    PERFORM public.emit_domain_event(NEW.tenant_id, 'event', NEW.id::text, 'event.cancelled.v1',
      jsonb_build_object('slug', NEW.slug, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en));
  ELSIF OLD.status <> 'published' AND NEW.status = 'published' THEN
    PERFORM public.emit_domain_event(NEW.tenant_id, 'event', NEW.id::text, 'event.published.v1',
      jsonb_build_object('slug', NEW.slug, 'title_pl', NEW.title_pl, 'title_en', NEW.title_en,
        'starts_at', NEW.starts_at, 'author_id', NEW.host_user_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'events: status notify failed: %', SQLERRM; RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_status_notify ON public.events;
CREATE TRIGGER events_status_notify
  AFTER UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.tg_events_status_notify();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('event-reminders', '5 * * * *', 'SELECT public.run_event_reminders()');
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END $$;

-- ============================================================================
-- SPOŁECZNOŚĆ 9/10: edycja komentarzy + destub (security/edited_at/bio)
-- ============================================================================

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
GRANT UPDATE(edited_at) ON public.comments TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text,
  p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message' THEN np.enabled_message
             WHEN 'comment' THEN np.enabled_comment
             WHEN 'follow' THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content' THEN np.enabled_content
             WHEN 'system' THEN np.enabled_system
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id()); END IF;
  IF v_tenant IS NULL THEN SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1; END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '') AND n.created_at > now() - interval '5 minutes') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon)
  VALUES (p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''), NULLIF(btrim(p_body_pl), ''), NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''), NULLIF(btrim(p_icon), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.comments_guard_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comments: identity columns are immutable';
  END IF;
  IF public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'editor'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.status = 'deleted' OR OLD.created_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'comments: edit window expired';
    END IF;
    NEW.edited_at := now();
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'deleted' THEN
    RAISE EXCEPTION 'comments: only soft delete is allowed';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.comments REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'comments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.comments';
  END IF;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'comments: could not add to supabase_realtime (%): continuing', SQLERRM;
END $$;

UPDATE public.profiles
   SET bio_pl = COALESCE(NULLIF(btrim(bio_pl), ''), NULLIF(btrim(bio), '')),
       bio_en = COALESCE(NULLIF(btrim(bio_en), ''), NULLIF(btrim(bio), ''))
 WHERE NULLIF(btrim(bio), '') IS NOT NULL
   AND (NULLIF(btrim(bio_pl), '') IS NULL OR NULLIF(btrim(bio_en), '') IS NULL);

CREATE OR REPLACE FUNCTION public.profiles_mirror_bio()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  NEW.bio := COALESCE(NULLIF(btrim(NEW.bio_pl), ''), NULLIF(btrim(NEW.bio_en), ''), NEW.bio);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_mirror_bio_trg ON public.profiles;
CREATE TRIGGER profiles_mirror_bio_trg
  BEFORE INSERT OR UPDATE OF bio_pl, bio_en ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_mirror_bio();