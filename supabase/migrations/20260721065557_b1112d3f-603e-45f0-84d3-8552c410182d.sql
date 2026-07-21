-- ============================================================================
-- PR #55 part 1: CRM lead scoring - page_view signal
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_post_views_user_viewed
  ON public.post_views (user_id, viewed_at)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_scoring_default_weights()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'email_open',           jsonb_build_object('points', 2,  'cap', 16),
    'email_click',          jsonb_build_object('points', 6,  'cap', 30),
    'page_view',            jsonb_build_object('points', 1,  'cap', 10),
    'contact_form',         jsonb_build_object('points', 25, 'cap', 50),
    'event_rsvp',           jsonb_build_object('points', 15, 'cap', 30),
    'resource_download',    jsonb_build_object('points', 12, 'cap', 36),
    'comment',              jsonb_build_object('points', 4,  'cap', 12),
    'purchase',             jsonb_build_object('points', 40, 'cap', 80),
    'donation',             jsonb_build_object('points', 25, 'cap', 50),
    'newsletter_confirmed', jsonb_build_object('points', 10, 'cap', 10),
    'marketing_consent',    jsonb_build_object('points', 5,  'cap', 5),
    'has_company',          jsonb_build_object('points', 4,  'cap', 4),
    'has_position',         jsonb_build_object('points', 4,  'cap', 4),
    'has_phone',            jsonb_build_object('points', 3,  'cap', 3),
    'has_linkedin',         jsonb_build_object('points', 3,  'cap', 3)
  );
$fn$;
REVOKE ALL ON FUNCTION public.crm_scoring_default_weights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_scoring_default_weights() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_crm_lead_score(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  l public.crm_leads%ROWTYPE;
  s public.crm_scoring_settings%ROWTYPE;
  w jsonb;
  v_half numeric := 30;
  v_horizon interval := interval '365 days';
  v_hot integer := 80;
  v_warm integer := 45;
  v_cool integer := 20;
  v_user uuid;
  v_count numeric;
  v_decayed numeric;
  v_pts numeric;
  v_total numeric := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_score integer;
  v_band text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO s FROM public.crm_scoring_settings WHERE tenant_id = l.tenant_id;
  IF FOUND THEN
    IF NOT s.enabled THEN RETURN; END IF;
    v_half := s.half_life_days;
    v_horizon := make_interval(days => s.horizon_days);
    v_hot := s.hot_threshold; v_warm := s.warm_threshold; v_cool := s.cool_threshold;
    w := public.crm_scoring_default_weights() || COALESCE(s.weights, '{}'::jsonb);
  ELSE
    w := public.crm_scoring_default_weights();
  END IF;
  SELECT p.id INTO v_user FROM public.profiles p
   WHERE p.tenant_id = l.tenant_id AND lower(p.email) = l.email_norm LIMIT 1;

  SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - e.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed FROM public.newsletter_campaign_events e
    JOIN public.newsletter_subscribers ns ON ns.id = e.subscriber_id
   WHERE e.tenant_id = l.tenant_id AND e.kind = 'open' AND lower(ns.email) = l.email_norm
     AND e.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'email_open'->>'points')::numeric, (w->'email_open'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','email_open','count',v_count,'points',round(v_pts,1));
  END IF;

  SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - e.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed FROM public.newsletter_campaign_events e
    JOIN public.newsletter_subscribers ns ON ns.id = e.subscriber_id
   WHERE e.tenant_id = l.tenant_id AND e.kind = 'click' AND lower(ns.email) = l.email_norm
     AND e.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'email_click'->>'points')::numeric, (w->'email_click'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','email_click','count',v_count,'points',round(v_pts,1));
  END IF;

  SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - m.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed FROM public.contact_messages m
   WHERE m.tenant_id = l.tenant_id AND lower(m.email) = l.email_norm
     AND m.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'contact_form'->>'points')::numeric, (w->'contact_form'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','contact_form','count',v_count,'points',round(v_pts,1));
  END IF;

  IF v_user IS NOT NULL THEN
    SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - pv.viewed_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed FROM public.post_views pv
     WHERE pv.tenant_id = l.tenant_id AND pv.user_id = v_user AND pv.viewed_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'page_view'->>'points')::numeric, (w->'page_view'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object('key','page_view','count',v_count,'points',round(v_pts,1));
    END IF;

    SELECT count(*), COALESCE(sum((CASE WHEN r.status = 'going' THEN 1.0 ELSE 0.5 END) * power(0.5, GREATEST(extract(epoch FROM (now() - r.created_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed FROM public.event_rsvps r
     WHERE r.tenant_id = l.tenant_id AND r.user_id = v_user AND r.status IN ('going','interested')
       AND r.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'event_rsvp'->>'points')::numeric, (w->'event_rsvp'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object('key','event_rsvp','count',v_count,'points',round(v_pts,1));
    END IF;

    SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - d.created_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed FROM public.resource_downloads d
     WHERE d.tenant_id = l.tenant_id AND d.user_id = v_user AND d.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'resource_download'->>'points')::numeric, (w->'resource_download'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object('key','resource_download','count',v_count,'points',round(v_pts,1));
    END IF;

    SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - c.created_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed FROM public.comments c
     WHERE c.tenant_id = l.tenant_id AND c.user_id = v_user AND c.status IN ('approved','pending')
       AND c.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'comment'->>'points')::numeric, (w->'comment'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object('key','comment','count',v_count,'points',round(v_pts,1));
    END IF;

    SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - p.purchased_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed FROM public.user_purchases p
     WHERE p.tenant_id = l.tenant_id AND p.user_id = v_user AND p.status = 'active'
       AND p.purchased_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'purchase'->>'points')::numeric, (w->'purchase'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object('key','purchase','count',v_count,'points',round(v_pts,1));
    END IF;
  END IF;

  SELECT count(*), COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - d.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed FROM public.donations d
   WHERE d.tenant_id = l.tenant_id AND d.status = 'paid'
     AND (lower(COALESCE(d.donor_email, '')) = l.email_norm OR (v_user IS NOT NULL AND d.user_id = v_user))
     AND d.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'donation'->>'points')::numeric, (w->'donation'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','donation','count',v_count,'points',round(v_pts,1));
  END IF;

  IF EXISTS (SELECT 1 FROM public.newsletter_subscribers ns
     WHERE ns.tenant_id = l.tenant_id AND lower(ns.email) = l.email_norm
       AND ns.status = 'subscribed' AND ns.confirmed_at IS NOT NULL) THEN
    v_pts := (w->'newsletter_confirmed'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','newsletter_confirmed','count',1,'points',round(v_pts,1));
  END IF;

  IF l.marketing_consent THEN
    v_pts := (w->'marketing_consent'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','marketing_consent','count',1,'points',round(v_pts,1));
  END IF;
  IF COALESCE(l.company, '') <> '' THEN
    v_pts := (w->'has_company'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','has_company','count',1,'points',round(v_pts,1));
  END IF;
  IF COALESCE(l.position, '') <> '' THEN
    v_pts := (w->'has_position'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','has_position','count',1,'points',round(v_pts,1));
  END IF;
  IF COALESCE(l.phone, '') <> '' THEN
    v_pts := (w->'has_phone'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','has_phone','count',1,'points',round(v_pts,1));
  END IF;
  IF COALESCE(l.linkedin_url, '') <> '' THEN
    v_pts := (w->'has_linkedin'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object('key','has_linkedin','count',1,'points',round(v_pts,1));
  END IF;

  v_score := GREATEST(0, round(v_total))::integer;
  v_band := CASE WHEN v_score >= v_hot THEN 'hot' WHEN v_score >= v_warm THEN 'warm'
                 WHEN v_score >= v_cool THEN 'cool' ELSE 'cold' END;
  UPDATE public.crm_leads
     SET score = v_score, score_band = v_band, score_breakdown = v_breakdown, score_updated_at = now()
   WHERE id = l.id
     AND (score IS DISTINCT FROM v_score OR score_band IS DISTINCT FROM v_band OR score_breakdown IS DISTINCT FROM v_breakdown);
END;
$fn$;
REVOKE ALL ON FUNCTION public.compute_crm_lead_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_crm_lead_score(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_crm_lead_score(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_score_on_post_view()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $fn$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.post_views pv
     WHERE pv.user_id = NEW.user_id AND pv.tenant_id = NEW.tenant_id
       AND pv.viewed_at >= now() - interval '1 hour' AND pv.id <> NEW.id LIMIT 1) THEN
    RETURN NEW;
  END IF;
  PERFORM public.crm_score_touch_user(NEW.tenant_id, NEW.user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_score_on_post_view ON public.post_views;
CREATE TRIGGER trg_score_on_post_view AFTER INSERT ON public.post_views
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_post_view();

-- ============================================================================
-- PR #55 part 2: CRM tasks / follow-ups + reminders + CSV import
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  note text,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  reminded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead ON public.crm_tasks (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_open_due ON public.crm_tasks (tenant_id, due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_crm_tasks_reminder_scan ON public.crm_tasks (due_at) WHERE status = 'open' AND reminded_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_tasks_staff_select ON public.crm_tasks;
CREATE POLICY crm_tasks_staff_select ON public.crm_tasks FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());
DROP POLICY IF EXISTS crm_tasks_staff_insert ON public.crm_tasks;
CREATE POLICY crm_tasks_staff_insert ON public.crm_tasks FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff() AND created_by = auth.uid());
DROP POLICY IF EXISTS crm_tasks_staff_update ON public.crm_tasks;
CREATE POLICY crm_tasks_staff_update ON public.crm_tasks FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());
DROP POLICY IF EXISTS crm_tasks_delete ON public.crm_tasks;
CREATE POLICY crm_tasks_delete ON public.crm_tasks FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.is_super_admin() OR created_by = auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_crm_tasks_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'done' AND OLD.status <> 'done' THEN NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN NEW.completed_at := NULL; END IF;
  IF NEW.status = 'open' AND NEW.due_at > now()
     AND (NEW.due_at IS DISTINCT FROM OLD.due_at OR OLD.status <> 'open') THEN
    NEW.reminded_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_crm_tasks_normalize ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_normalize BEFORE INSERT OR UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_tasks_normalize();

CREATE OR REPLACE FUNCTION public.tg_crm_tasks_sync_lead_follow_up()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_lead uuid := COALESCE(NEW.lead_id, OLD.lead_id); v_next timestamptz;
BEGIN
  SELECT MIN(due_at) INTO v_next FROM public.crm_tasks WHERE lead_id = v_lead AND status = 'open';
  UPDATE public.crm_leads SET follow_up_at = v_next
   WHERE id = v_lead AND follow_up_at IS DISTINCT FROM v_next;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN RETURN COALESCE(NEW, OLD);
END;
$fn$;
DROP TRIGGER IF EXISTS trg_crm_tasks_sync_lead_follow_up ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_sync_lead_follow_up
  AFTER INSERT OR UPDATE OF status, due_at OR DELETE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_tasks_sync_lead_follow_up();

CREATE OR REPLACE FUNCTION public.tg_crm_tasks_emit_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(NEW.tenant_id, 'crm_task', NEW.id::text, 'crm_task.created.v1',
      jsonb_build_object('lead_id', NEW.lead_id, 'title', NEW.title, 'due_at', NEW.due_at, 'assignee_id', NEW.assignee_id));
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status <> 'done' THEN
    PERFORM public.emit_domain_event(NEW.tenant_id, 'crm_task', NEW.id::text, 'crm_task.completed.v1',
      jsonb_build_object('lead_id', NEW.lead_id, 'title', NEW.title));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_crm_tasks_emit_events ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_emit_events AFTER INSERT OR UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_tasks_emit_events();

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_crm_task boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content','security','message','tracker','connection','saved_search','crm_task')) NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
             WHEN 'tracker' THEN np.enabled_tracker
             WHEN 'connection' THEN np.enabled_connection
             WHEN 'saved_search' THEN np.enabled_saved_search
             WHEN 'crm_task' THEN np.enabled_crm_task
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id()); END IF;
  IF v_tenant IS NULL THEN SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1; END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href,'') = COALESCE(p_href,'') AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon)
  VALUES (p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl),''), NULLIF(btrim(p_title_en),''), p_kind),
    NULLIF(btrim(p_title_en),''), NULLIF(btrim(p_body_pl),''), NULLIF(btrim(p_body_en),''),
    NULLIF(btrim(p_href),''), NULLIF(btrim(p_icon),''))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_crm_task_reminders()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_row record; v_recipient uuid; v_lead_label text; v_due text; v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT t.id, t.tenant_id, t.lead_id, t.title, t.due_at, t.assignee_id, t.created_by,
           l.email AS lead_email, l.first_name, l.last_name, l.owner_id
      FROM public.crm_tasks t JOIN public.crm_leads l ON l.id = t.lead_id
     WHERE t.status = 'open' AND t.reminded_at IS NULL AND t.due_at <= now()
     ORDER BY t.due_at LIMIT 200 FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_lead_label := COALESCE(NULLIF(btrim(concat_ws(' ', v_row.first_name, v_row.last_name)),''), v_row.lead_email);
    v_due := to_char(v_row.due_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI');
    v_recipient := COALESCE(v_row.assignee_id, v_row.owner_id, v_row.created_by);
    IF v_recipient IS NOT NULL THEN
      PERFORM public.enqueue_notification(v_recipient, 'crm_task',
        'Follow-up: ' || v_lead_label, 'Follow-up: ' || v_lead_label,
        'Zadanie "' || v_row.title || '" - termin ' || v_due || ' (czas warszawski).',
        'Task "' || v_row.title || '" - due ' || v_due || ' (Warsaw time).',
        '/admin/crm?lead=' || v_row.lead_id || '&task=' || v_row.id, 'AlarmClock');
    END IF;
    PERFORM public.emit_domain_event(v_row.tenant_id, 'crm_task', v_row.id::text, 'crm_task.due.v1',
      jsonb_build_object('lead_id', v_row.lead_id, 'title', v_row.title, 'due_at', v_row.due_at,
        'assignee_id', v_row.assignee_id, 'email', v_row.lead_email));
    UPDATE public.crm_tasks SET reminded_at = now() WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.run_crm_task_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_crm_task_reminders() TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed - crm-task-reminders not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule('crm-task-reminders', '*/10 * * * *', 'SELECT public.run_crm_task_reminders()');
END $$;

CREATE OR REPLACE FUNCTION public.crm_import_leads(p_rows jsonb, p_source text DEFAULT 'import')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_tenant uuid; r jsonb; v_email text; v_norm text; v_existing uuid; v_id uuid; v_tags text[];
  v_imported integer := 0; v_merged integer := 0; v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb; v_source text := COALESCE(NULLIF(btrim(p_source),''),'import');
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'P0002'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'rows_must_be_array' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'too_many_rows_max_500' USING ERRCODE = '22023'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_email := btrim(COALESCE(r->>'email',''));
    IF v_email = '' OR position('@' IN v_email) <= 1 THEN
      v_skipped := v_skipped + 1;
      IF jsonb_array_length(v_errors) < 50 THEN
        v_errors := v_errors || jsonb_build_object('email', left(v_email,120), 'reason','invalid_email');
      END IF;
      CONTINUE;
    END IF;
    v_norm := lower(v_email);
    SELECT id INTO v_existing FROM public.crm_leads WHERE tenant_id = v_tenant AND email_norm = v_norm LIMIT 1;
    BEGIN
      v_id := public.crm_upsert_from_form(v_tenant, v_email,
        NULLIF(btrim(COALESCE(r->>'first_name','')),''),
        NULLIF(btrim(COALESCE(r->>'last_name','')),''),
        NULLIF(btrim(COALESCE(r->>'phone','')),''),
        NULLIF(btrim(COALESCE(r->>'company','')),''),
        NULLIF(btrim(COALESCE(r->>'position','')),''),
        NULLIF(btrim(COALESCE(r->>'linkedin_url','')),''),
        NULLIF(btrim(COALESCE(r->>'country','')),''),
        v_source, '{}'::jsonb);
      IF v_id IS NOT NULL AND r ? 'tags' AND jsonb_typeof(r->'tags') = 'array' THEN
        SELECT array_agg(DISTINCT t) INTO v_tags FROM (
          SELECT btrim(x.value) AS t FROM jsonb_array_elements_text(r->'tags') x WHERE btrim(x.value) <> ''
        ) s;
        IF v_tags IS NOT NULL THEN
          UPDATE public.crm_leads cl SET tags = (SELECT array_agg(DISTINCT u ORDER BY u) FROM unnest(cl.tags || v_tags) u) WHERE cl.id = v_id;
        END IF;
      END IF;
      IF v_id IS NULL THEN v_skipped := v_skipped + 1;
      ELSIF v_existing IS NULL THEN v_imported := v_imported + 1;
      ELSE v_merged := v_merged + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      IF jsonb_array_length(v_errors) < 50 THEN
        v_errors := v_errors || jsonb_build_object('email', left(v_email,120), 'reason', left(SQLERRM,200));
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('imported', v_imported, 'merged', v_merged, 'skipped', v_skipped, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.crm_import_leads(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import_leads(jsonb, text) TO authenticated, service_role;