-- ============================================================================
-- CRM: zadania/follow-upy z przypomnieniami + import CSV z dedupem.
--
-- 1. crm_tasks - zadania per lead (termin, przypisanie, status open/done/
--    cancelled). Denormalizacja: crm_leads.follow_up_at = MIN(due_at) otwartych
--    zadań leada (trigger), więc istniejąca kolumna, eksport CSV i sortowanie
--    skrzynki dostają realne dane bez zmian kontraktu.
-- 2. Przypomnienia przez ISTNIEJĄCY silnik notyfikacji: skaner z watermarkiem
--    (wzorzec run_event_reminders) -> enqueue_notification(kind 'crm_task')
--    + zdarzenie crm_task.due.v1 na szynie (outbox/Slack/HubSpot dostają je
--    przez integration_deliveries bez dodatkowego kodu).
-- 3. crm_import_leads - wsadowy import leadów (<=500 wierszy per wywołanie,
--    klient stronicuje) na bazie crm_upsert_from_form: dedup po e-mailu
--    (merge zamiast duplikatu), unia tagów, raport imported/merged/skipped.
--
-- Lustra TS w tym samym commicie: domainEvents.ts + eventInvalidationMap.ts
-- (katalog zdarzeń), useNotifications.ts + preferences.ts (kind 'crm_task'),
-- types.ts (crm_tasks + RPC). pgTAP: supabase/tests/crm_tasks_followups_test.sql.
-- ============================================================================

-- ── 1. Tabela zadań ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (btrim(title) <> ''),
  note text,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  reminded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.crm_tasks IS
  'Follow-upy/zadania per lead CRM. reminded_at = watermark skanera przypomnień (raz per termin).';
COMMENT ON COLUMN public.crm_tasks.reminded_at IS
  'Watermark przypomnienia; przesunięcie due_at w przyszłość zeruje go (przypomnimy ponownie).';

CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead
  ON public.crm_tasks (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_tenant_open_due
  ON public.crm_tasks (tenant_id, due_at)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_crm_tasks_reminder_scan
  ON public.crm_tasks (due_at)
  WHERE status = 'open' AND reminded_at IS NULL;

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_tasks_staff_select ON public.crm_tasks;
CREATE POLICY crm_tasks_staff_select
  ON public.crm_tasks FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS crm_tasks_staff_insert ON public.crm_tasks;
CREATE POLICY crm_tasks_staff_insert
  ON public.crm_tasks FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_staff()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS crm_tasks_staff_update ON public.crm_tasks;
CREATE POLICY crm_tasks_staff_update
  ON public.crm_tasks FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS crm_tasks_delete ON public.crm_tasks;
CREATE POLICY crm_tasks_delete
  ON public.crm_tasks FOR DELETE TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.is_super_admin()
      OR created_by = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_tasks TO authenticated;
GRANT ALL ON public.crm_tasks TO service_role;

-- ── 2. Normalizacja wiersza (completed_at, reset watermarku, updated_at) ─────

CREATE OR REPLACE FUNCTION public.tg_crm_tasks_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'done' AND OLD.status <> 'done' THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  -- Przesunięcie terminu w przyszłość (lub ponowne otwarcie z przyszłym
  -- terminem) = zadanie ma dostać świeże przypomnienie.
  IF NEW.status = 'open'
     AND NEW.due_at > now()
     AND (NEW.due_at IS DISTINCT FROM OLD.due_at OR OLD.status <> 'open') THEN
    NEW.reminded_at := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_tasks_normalize ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_normalize
  BEFORE INSERT OR UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_tasks_normalize();

-- ── 3. Denormalizacja follow_up_at na leadzie ────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_crm_tasks_sync_lead_follow_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_lead uuid := COALESCE(NEW.lead_id, OLD.lead_id);
  v_next timestamptz;
BEGIN
  SELECT MIN(due_at) INTO v_next
    FROM public.crm_tasks
   WHERE lead_id = v_lead AND status = 'open';
  -- Kolumnowo zawężony UPDATE: follow_up_at nie jest w liście kolumn
  -- trg_score_on_lead_change, więc nie odpala scoringu; emituje za to
  -- crm_lead.updated.v1, który odświeża skrzynkę na żywo.
  UPDATE public.crm_leads
     SET follow_up_at = v_next
   WHERE id = v_lead
     AND follow_up_at IS DISTINCT FROM v_next;
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_tasks_sync_lead_follow_up ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_sync_lead_follow_up
  AFTER INSERT OR UPDATE OF status, due_at OR DELETE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_tasks_sync_lead_follow_up();

-- ── 4. Zdarzenia domenowe zadań (szyna -> panel live + outbox integracji) ────

CREATE OR REPLACE FUNCTION public.tg_crm_tasks_emit_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'crm_task', NEW.id::text, 'crm_task.created.v1',
      jsonb_build_object(
        'lead_id', NEW.lead_id, 'title', NEW.title,
        'due_at', NEW.due_at, 'assignee_id', NEW.assignee_id
      )
    );
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'done' AND OLD.status <> 'done' THEN
    PERFORM public.emit_domain_event(
      NEW.tenant_id, 'crm_task', NEW.id::text, 'crm_task.completed.v1',
      jsonb_build_object('lead_id', NEW.lead_id, 'title', NEW.title)
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_crm_tasks_emit_events ON public.crm_tasks;
CREATE TRIGGER trg_crm_tasks_emit_events
  AFTER INSERT OR UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_tasks_emit_events();

-- ── 5. Kind notyfikacji 'crm_task' (per-kind preferencja jak saved_search) ───

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_crm_task boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search',
                  'crm_task'))
  NOT VALID;

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
             WHEN 'message'      THEN np.enabled_message
             WHEN 'comment'      THEN np.enabled_comment
             WHEN 'follow'       THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content'      THEN np.enabled_content
             WHEN 'system'       THEN np.enabled_system
             WHEN 'tracker'      THEN np.enabled_tracker
             WHEN 'connection'   THEN np.enabled_connection
             WHEN 'saved_search' THEN np.enabled_saved_search
             WHEN 'crm_task'     THEN np.enabled_crm_task
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

-- ── 6. Skaner przypomnień (watermark, wzorzec run_event_reminders) ───────────

CREATE OR REPLACE FUNCTION public.run_crm_task_reminders()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row record;
  v_recipient uuid;
  v_lead_label text;
  v_due text;
  v_count integer := 0;
BEGIN
  -- FOR UPDATE ... SKIP LOCKED: skaner odpalają równolegle pg_cron, jobs-tick
  -- i community-cron - zablokowany wiersz przejmuje dokładnie jeden przebieg
  -- (ta sama doktryna co claim_integration_deliveries).
  FOR v_row IN
    SELECT t.id, t.tenant_id, t.lead_id, t.title, t.due_at,
           t.assignee_id, t.created_by,
           l.email AS lead_email, l.first_name, l.last_name, l.owner_id
      FROM public.crm_tasks t
      JOIN public.crm_leads l ON l.id = t.lead_id
     WHERE t.status = 'open'
       AND t.reminded_at IS NULL
       AND t.due_at <= now()
     ORDER BY t.due_at
     LIMIT 200
       FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_lead_label := COALESCE(
      NULLIF(btrim(concat_ws(' ', v_row.first_name, v_row.last_name)), ''),
      v_row.lead_email
    );
    v_due := to_char(v_row.due_at AT TIME ZONE 'Europe/Warsaw', 'DD.MM HH24:MI');
    v_recipient := COALESCE(v_row.assignee_id, v_row.owner_id, v_row.created_by);

    IF v_recipient IS NOT NULL THEN
      PERFORM public.enqueue_notification(
        v_recipient,
        'crm_task',
        'Follow-up: ' || v_lead_label,
        'Follow-up: ' || v_lead_label,
        'Zadanie "' || v_row.title || '" - termin ' || v_due || ' (czas warszawski).',
        'Task "' || v_row.title || '" - due ' || v_due || ' (Warsaw time).',
        '/admin/crm?lead=' || v_row.lead_id || '&task=' || v_row.id,
        'AlarmClock'
      );
    END IF;

    -- Zdarzenie na szynie: skrzynka odświeża się na żywo, a outbox integracji
    -- (webhook/Slack/HubSpot) może powiadomić kanał zespołu. emit_domain_event
    -- połyka własne błędy (kontrakt szyny), więc nie potrzebuje osłony.
    PERFORM public.emit_domain_event(
      v_row.tenant_id, 'crm_task', v_row.id::text, 'crm_task.due.v1',
      jsonb_build_object(
        'lead_id', v_row.lead_id, 'title', v_row.title,
        'due_at', v_row.due_at, 'assignee_id', v_row.assignee_id,
        'email', v_row.lead_email
      )
    );

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
  PERFORM cron.schedule(
    'crm-task-reminders',
    '*/10 * * * *',
    'SELECT public.run_crm_task_reminders()'
  );
END $$;

-- ── 7. Import CSV z dedupem (wsadowo, na bazie crm_upsert_from_form) ─────────

CREATE OR REPLACE FUNCTION public.crm_import_leads(
  p_rows jsonb,
  p_source text DEFAULT 'import'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
  r jsonb;
  v_email text;
  v_norm text;
  v_existing uuid;
  v_id uuid;
  v_tags text[];
  v_imported integer := 0;
  v_merged integer := 0;
  v_skipped integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'import');
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'P0002';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows_must_be_array' USING ERRCODE = '22023';
  END IF;
  -- Porcja <=500: pojedyncze wywołanie mieści się w timeoutach (scoring +
  -- emitery odpalają się per wiersz); klient stronicuje większe pliki.
  IF jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'too_many_rows_max_500' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_email := btrim(COALESCE(r->>'email', ''));
    IF v_email = '' OR position('@' IN v_email) <= 1 THEN
      v_skipped := v_skipped + 1;
      IF jsonb_array_length(v_errors) < 50 THEN
        v_errors := v_errors || jsonb_build_object(
          'email', left(v_email, 120), 'reason', 'invalid_email');
      END IF;
      CONTINUE;
    END IF;
    v_norm := lower(v_email);

    SELECT id INTO v_existing
      FROM public.crm_leads
     WHERE tenant_id = v_tenant AND email_norm = v_norm
     LIMIT 1;

    BEGIN
      v_id := public.crm_upsert_from_form(
        v_tenant,
        v_email,
        NULLIF(btrim(COALESCE(r->>'first_name', '')), ''),
        NULLIF(btrim(COALESCE(r->>'last_name', '')), ''),
        NULLIF(btrim(COALESCE(r->>'phone', '')), ''),
        NULLIF(btrim(COALESCE(r->>'company', '')), ''),
        NULLIF(btrim(COALESCE(r->>'position', '')), ''),
        NULLIF(btrim(COALESCE(r->>'linkedin_url', '')), ''),
        NULLIF(btrim(COALESCE(r->>'country', '')), ''),
        v_source,
        '{}'::jsonb
      );

      IF v_id IS NOT NULL AND r ? 'tags' AND jsonb_typeof(r->'tags') = 'array' THEN
        SELECT array_agg(DISTINCT t)
          INTO v_tags
          FROM (
            SELECT btrim(x.value) AS t
              FROM jsonb_array_elements_text(r->'tags') x
             WHERE btrim(x.value) <> ''
          ) s;
        IF v_tags IS NOT NULL THEN
          UPDATE public.crm_leads cl
             SET tags = (SELECT array_agg(DISTINCT u ORDER BY u) FROM unnest(cl.tags || v_tags) u)
           WHERE cl.id = v_id;
        END IF;
      END IF;

      IF v_id IS NULL THEN
        v_skipped := v_skipped + 1;
      ELSIF v_existing IS NULL THEN
        v_imported := v_imported + 1;
      ELSE
        v_merged := v_merged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      IF jsonb_array_length(v_errors) < 50 THEN
        v_errors := v_errors || jsonb_build_object(
          'email', left(v_email, 120), 'reason', left(SQLERRM, 200));
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'merged', v_merged,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.crm_import_leads(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_import_leads(jsonb, text) TO authenticated, service_role;
