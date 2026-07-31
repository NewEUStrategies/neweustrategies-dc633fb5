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

-- ============================================================================
-- SCALONE Z: 20260721120000_monetization_metering_checkout_b2b.sql
--
-- Supabase CLI bierze `version` z prefiksu nazwy pliku, więc DWA pliki o tym
-- samym znaczniku czasu wywalają `duplicate key value violates unique
-- constraint "schema_migrations_pkey"` i przerywają CAŁY `supabase db start` -
-- to dlatego job pgtap w CI nie dobiegał nawet do pierwszego testu. Treść
-- poniżej jest przeniesiona BEZ ZMIAN, w tej samej kolejności, w jakiej CLI
-- stosował pliki (leksykograficznie), więc semantyka migracji się nie zmienia,
-- a każda wersja występuje dokładnie raz (produkcja nie widzi nowych wersji i
-- niczego nie stosuje ponownie).
-- ============================================================================

-- =============================================================================
-- Monetyzacja (3 filary):
--
--   1) METERING PAYWALLA - "N darmowych artykułów / miesiąc". Dotychczasowa
--      bramka była binarna (uprawniony/nie); metering dodaje standardowy lejek
--      konwersji prasy cyfrowej: anonim -> rejestracja (limit dla konta
--      bezpłatnego) -> subskrypcja. Egzekwowanie WYŁĄCZNIE serwerowe, tą samą
--      ścieżką co get_entity_content (SECURITY DEFINER; treść nigdy nie trafia
--      do nieuprawnionego klienta inaczej niż przez świadome, policzone
--      "odblokowanie na licznik").
--
--   2) USTAWIENIA CHECKOUTU - kody promocyjne (kupony Stripe), Stripe Tax,
--      zbieranie NIP/VAT (tax_id_collection) i faktury dla płatności
--      jednorazowych. Sam checkout czyta te flagi serwerowo
--      (lib/billing/checkout.functions.ts) - klient niczego nie wymusi.
--
--   3) SAMOOBSŁUGA B2B - zaproszenia mailowe do miejsc w organizacji
--      (invited_by / last_invited_at + ponowienie zaproszenia) oraz realny
--      produkt enterprise: warstwy członkostwa z flagą `premium_content`
--      odblokowują artykuły płatne (site licence dla miejsc organizacji).
--
-- Wszystko tenant-scoped + RLS; funkcje SECURITY DEFINER z jawnym search_path.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1a) Ustawienia meteringu (singleton per tenant).
--     Konfiguracja jest jawna (bez sekretów) - paywall po stronie publicznej
--     potrzebuje jej do copy CTA ("zarejestruj się, aby czytać N artykułów"),
--     więc SELECT dostają anon+authenticated; zapis tylko staff.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metering_settings (
  tenant_id uuid PRIMARY KEY DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  -- Limit dla ZALOGOWANEGO konta bezpłatnego (rdzeń lejka "z rejestracją").
  member_monthly_limit integer NOT NULL DEFAULT 3
    CHECK (member_monthly_limit BETWEEN 0 AND 1000),
  -- Limit dla anonima (0 = twarda ściana rejestracji; >0 = flexible sampling).
  anon_monthly_limit integer NOT NULL DEFAULT 0
    CHECK (anon_monthly_limit BETWEEN 0 AND 1000),
  -- Które tryby bramki biorą udział w meteringu przy polityce 'inherit'.
  meter_paid boolean NOT NULL DEFAULT true,
  meter_members boolean NOT NULL DEFAULT true,
  -- Widoczność licznika "pozostało X z N" nad artykułem.
  show_counter boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.metering_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metering settings public read" ON public.metering_settings;
CREATE POLICY "metering settings public read"
  ON public.metering_settings FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "metering settings staff write" ON public.metering_settings;
CREATE POLICY "metering settings staff write"
  ON public.metering_settings FOR ALL
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

GRANT SELECT ON public.metering_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metering_settings TO authenticated;
GRANT ALL ON public.metering_settings TO service_role;

DROP TRIGGER IF EXISTS trg_metering_settings_updated ON public.metering_settings;
CREATE TRIGGER trg_metering_settings_updated
  BEFORE UPDATE ON public.metering_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 1b) Polityka meteringu per wpis/strona - na regule dostępu (content_access),
--     czyli DOKŁADNIE tym samym wierszu, który edytują: pane w edytorze wpisu,
--     pane w edytorze strony i panel admina. Jedno źródło = pełna synchronizacja.
--       inherit - wg globalnych przełączników trybów,
--       metered - zawsze uczestniczy (dopóki metering włączony),
--       exempt  - nigdy (twarda ściana, np. raporty premium).
-- -----------------------------------------------------------------------------
ALTER TABLE public.content_access
  ADD COLUMN IF NOT EXISTS metering_policy text NOT NULL DEFAULT 'inherit'
    CHECK (metering_policy IN ('inherit', 'metered', 'exempt'));

-- content_access ma kolumnowe granty (20260711102330) - nowa kolumna wymaga
-- jawnego SELECT, inaczej edytory staff jej nie odczytają.
GRANT SELECT (metering_policy) ON public.content_access TO anon, authenticated;

-- Publiczny widok reguły dostępu: dokładamy metering_policy (na końcu listy -
-- CREATE OR REPLACE VIEW dopuszcza wyłącznie dopisanie kolumn na końcu).
CREATE OR REPLACE VIEW public.content_access_public
WITH (security_invoker = off) AS
SELECT
  id,
  tenant_id,
  entity_type,
  entity_id,
  mode,
  plan_ids,
  one_time_price_cents,
  one_time_currency,
  teaser_pl,
  teaser_en,
  created_at,
  updated_at,
  metering_policy
FROM public.content_access
WHERE tenant_id = public_tenant_id();

GRANT SELECT ON public.content_access_public TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1c) Zużycie licznika. Wiersz = "ta tożsamość odblokowała ten byt w tym
--     miesiącu". Ponowne czytanie tego samego artykułu NIE zużywa limitu
--     (unikalność per byt/miesiąc). Brak dostępu klienckiego - wyłącznie
--     funkcje SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metered_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  visitor_id uuid,
  entity_type public.access_entity_type NOT NULL,
  entity_id uuid NOT NULL,
  period_month date NOT NULL DEFAULT (date_trunc('month', now()))::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL)
);

-- Idempotencja odblokowań (osobno dla kont i anonimów).
CREATE UNIQUE INDEX IF NOT EXISTS metered_views_user_entity_uniq
  ON public.metered_views (tenant_id, user_id, entity_type, entity_id, period_month)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS metered_views_visitor_entity_uniq
  ON public.metered_views (tenant_id, visitor_id, entity_type, entity_id, period_month)
  WHERE user_id IS NULL;
-- Zliczanie zużycia w miesiącu.
CREATE INDEX IF NOT EXISTS metered_views_user_period_idx
  ON public.metered_views (tenant_id, user_id, period_month)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS metered_views_visitor_period_idx
  ON public.metered_views (tenant_id, visitor_id, period_month)
  WHERE user_id IS NULL;

ALTER TABLE public.metered_views ENABLE ROW LEVEL SECURITY;
-- Brak polityk = brak dostępu klienckiego; definer i service_role wystarczą.
REVOKE ALL ON public.metered_views FROM anon, authenticated;
GRANT ALL ON public.metered_views TO service_role;

-- -----------------------------------------------------------------------------
-- 1d) Stan licznika (bez konsumowania) - dla banera i wariantów paywalla.
--     Anonim identyfikuje się kluczem gościa (uuid z localStorage); miękki
--     licznik z natury jest resetowalny po stronie klienta - twardą walutą
--     lejka jest limit KONTA (wymaga rejestracji), i ten egzekwujemy po
--     auth.uid(), nie po czymkolwiek podanym przez klienta.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.metering_state(_visitor_id uuid DEFAULT NULL)
RETURNS TABLE (
  enabled boolean,
  monthly_limit integer,
  used integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_settings public.metering_settings%ROWTYPE;
  v_limit integer := 0;
  v_used integer := 0;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_settings.enabled THEN
    RETURN QUERY SELECT false, 0, 0, 0, false, false;
    RETURN;
  END IF;

  IF v_uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
    SELECT count(*)::integer INTO v_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id = v_uid AND mv.period_month = v_period;
  ELSIF _visitor_id IS NOT NULL THEN
    v_limit := v_settings.anon_monthly_limit;
    SELECT count(*)::integer INTO v_used
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id IS NULL
       AND mv.visitor_id = _visitor_id AND mv.period_month = v_period;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
  END IF;

  RETURN QUERY SELECT
    true,
    v_limit,
    v_used,
    GREATEST(v_limit - v_used, 0),
    (v_uid IS NULL AND v_settings.anon_monthly_limit <= 0),
    v_settings.show_counter;
END $$;

REVOKE ALL ON FUNCTION public.metering_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.metering_state(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 1e) Konsumpcja licznika + wydanie treści. Jedyna poza get_entity_content
--     droga, którą zabramkowana treść może opuścić bazę - i tak samo jak tam:
--     ponownie egzekwuje tenant + published + not-deleted. Zwraca zawsze jeden
--     wiersz ze stanem licznika; body tylko przy granted=true.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_metered_view(
  _entity_type public.access_entity_type,
  _entity_id uuid,
  _visitor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  granted boolean,
  consumed boolean,
  used integer,
  monthly_limit integer,
  remaining integer,
  requires_registration boolean,
  show_counter boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_settings public.metering_settings%ROWTYPE;
  v_mode public.access_mode;
  v_policy text;
  v_rule_tenant uuid;
  v_limit integer := 0;
  v_used integer := 0;
  v_already boolean := false;
  v_insert_count integer := 0;
  v_requires_registration boolean := false;
  v_show_counter boolean := false;
  v_content_pl text;
  v_content_en text;
  v_builder jsonb;
  v_blocks jsonb;
  v_body_found boolean := false;
BEGIN
  -- Media nie mają body do wydania tą drogą.
  IF _entity_type = 'media' THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT ca.mode, ca.metering_policy, ca.tenant_id
    INTO v_mode, v_policy, v_rule_tenant
    FROM public.content_access ca
   WHERE ca.entity_type = _entity_type AND ca.entity_id = _entity_id;

  -- Brak reguły / treść publiczna / tryb hasłowy / inna instancja tenant -
  -- metering nie ma tu nic do roboty (public idzie zwykłą ścieżką, hasło ma
  -- własny, osobny odblokowywacz).
  IF NOT FOUND OR v_mode = 'public' OR v_mode = 'password' OR v_rule_tenant IS DISTINCT FROM v_tenant THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_settings FROM public.metering_settings ms WHERE ms.tenant_id = v_tenant;
  IF NOT FOUND OR NOT v_settings.enabled OR v_policy = 'exempt' THEN
    RETURN QUERY SELECT false, false, 0, 0, 0, false, false,
      NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  v_show_counter := v_settings.show_counter;

  -- Osłona przed wyścigiem: uprawniony wołający (subskrypcja/zakup/organizacja)
  -- dostaje body bez zużywania licznika. Zawsze dokładnie jeden wiersz.
  IF public.has_content_access(_entity_type, _entity_id) THEN
    SELECT b.content_pl, b.content_en, b.builder_data, b.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.get_entity_content(_entity_type, _entity_id) b;
    v_body_found := FOUND;
    RETURN QUERY SELECT v_body_found, false, 0, 0, 0, false, v_show_counter,
      v_content_pl, v_content_en, v_builder, v_blocks;
    RETURN;
  END IF;

  -- Polityka 'inherit' respektuje globalne przełączniki trybów; 'metered'
  -- wymusza udział niezależnie od nich.
  IF v_policy = 'inherit' THEN
    IF v_mode = 'paid' AND NOT v_settings.meter_paid THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    IF v_mode = 'members' AND NOT v_settings.meter_members THEN
      RETURN QUERY SELECT false, false, 0, 0, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  -- Tożsamość i limit: konto (auth.uid) albo klucz gościa.
  IF v_uid IS NOT NULL THEN
    v_limit := v_settings.member_monthly_limit;
  ELSE
    v_limit := v_settings.anon_monthly_limit;
    v_requires_registration := v_settings.anon_monthly_limit <= 0;
    IF _visitor_id IS NULL OR v_requires_registration THEN
      RETURN QUERY SELECT false, false, 0, v_limit, GREATEST(v_limit, 0), true, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  -- Zużycie w bieżącym miesiącu + czy TEN byt już odblokowano (ponowne
  -- czytanie nie kosztuje).
  IF v_uid IS NOT NULL THEN
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id = v_uid
       AND mv.period_month = (date_trunc('month', now()))::date;
  ELSE
    SELECT count(*)::integer,
           bool_or(mv.entity_type = _entity_type AND mv.entity_id = _entity_id)
      INTO v_used, v_already
      FROM public.metered_views mv
     WHERE mv.tenant_id = v_tenant AND mv.user_id IS NULL AND mv.visitor_id = _visitor_id
       AND mv.period_month = (date_trunc('month', now()))::date;
  END IF;
  v_already := COALESCE(v_already, false);

  IF NOT v_already THEN
    IF v_used >= v_limit THEN
      -- Limit wyczerpany: stan licznika bez body (paywall pokaże wariant
      -- "wykorzystano X z N").
      RETURN QUERY SELECT false, false, v_used, v_limit, 0, false, v_show_counter,
        NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    -- ON CONFLICT DO NOTHING: równoległe żądanie tego samego bytu nie dubluje
    -- wiersza ani nie wysadza transakcji.
    INSERT INTO public.metered_views (tenant_id, user_id, visitor_id, entity_type, entity_id)
    VALUES (v_tenant, v_uid, CASE WHEN v_uid IS NULL THEN _visitor_id ELSE NULL END,
            _entity_type, _entity_id)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_insert_count = ROW_COUNT;
    IF v_insert_count > 0 THEN
      v_used := v_used + 1;
    END IF;
  END IF;

  -- Wydanie body - identyczne ograniczenia jak get_entity_content.
  IF _entity_type = 'post' THEN
    SELECT p.content_pl, p.content_en, p.builder_data, p.blocks_data
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.posts p
     WHERE p.id = _entity_id AND p.tenant_id = v_tenant
       AND p.status = 'published' AND p.deleted_at IS NULL;
    v_body_found := FOUND;
  ELSE
    SELECT pg.content_pl, pg.content_en, pg.builder_data, NULL::jsonb
      INTO v_content_pl, v_content_en, v_builder, v_blocks
      FROM public.pages pg
     WHERE pg.id = _entity_id AND pg.tenant_id = v_tenant
       AND pg.status = 'published' AND pg.deleted_at IS NULL;
    v_body_found := FOUND;
  END IF;

  IF NOT v_body_found THEN
    RETURN QUERY SELECT false, false, v_used, v_limit, GREATEST(v_limit - v_used, 0), false,
      v_show_counter, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    (NOT v_already AND v_insert_count > 0),
    v_used,
    v_limit,
    GREATEST(v_limit - v_used, 0),
    false,
    v_show_counter,
    v_content_pl, v_content_en, v_builder, v_blocks;
END $$;

REVOKE ALL ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid, uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.consume_metered_view(public.access_entity_type, uuid, uuid) IS
  'Metered paywall: wydaje body zabramkowanego wpisu/strony w zamian za slot '
  'miesięcznego limitu (metering_settings). Idempotentne per byt/miesiąc; '
  'uprawnieni (has_content_access) dostają body bez zużycia. Zwraca zawsze stan '
  'licznika (used/limit/remaining) dla banera i wariantów paywalla.';

-- -----------------------------------------------------------------------------
-- 2) Ustawienia checkoutu (kupony / Stripe Tax / NIP / faktury) - singleton
--    per tenant, czytany serwerowo przy tworzeniu sesji Stripe.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.checkout_settings (
  tenant_id uuid PRIMARY KEY DEFAULT public.public_tenant_id()
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- Pole "kod promocyjny" w Stripe Checkout (kupony definiuje się w Stripe).
  allow_promotion_codes boolean NOT NULL DEFAULT true,
  -- Stripe Tax: automatyczne naliczanie VAT wg lokalizacji kupującego.
  automatic_tax boolean NOT NULL DEFAULT false,
  -- Zbieranie NIP/VAT ID w Checkout (trafia na fakturę Stripe).
  tax_id_collection boolean NOT NULL DEFAULT true,
  billing_address_collection text NOT NULL DEFAULT 'auto'
    CHECK (billing_address_collection IN ('auto', 'required')),
  -- Faktura Stripe także dla płatności jednorazowych (subskrypcje mają zawsze).
  invoice_creation boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.checkout_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checkout settings public read" ON public.checkout_settings;
CREATE POLICY "checkout settings public read"
  ON public.checkout_settings FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

DROP POLICY IF EXISTS "checkout settings staff write" ON public.checkout_settings;
CREATE POLICY "checkout settings staff write"
  ON public.checkout_settings FOR ALL
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  );

GRANT SELECT ON public.checkout_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkout_settings TO authenticated;
GRANT ALL ON public.checkout_settings TO service_role;

DROP TRIGGER IF EXISTS trg_checkout_settings_updated ON public.checkout_settings;
CREATE TRIGGER trg_checkout_settings_updated
  BEFORE UPDATE ON public.checkout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3a) B2B: metadane zaproszeń na miejscach organizacji. Dotąd dodanie miejsca
--     nie zostawiało śladu "kto i kiedy zaprosił" i nie dawało punktu zaczepu
--     dla ponowienia maila.
-- -----------------------------------------------------------------------------
ALTER TABLE public.organization_seats
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_invited_at timestamptz;

-- org_add_seat: identyczna logika i zabezpieczenia co 20260714130000 (auth,
-- role, format e-maila, limit pod blokadą wiersza, auto-claim istniejącego
-- konta) + stempel zaproszenia (invited_by / last_invited_at).
CREATE OR REPLACE FUNCTION public.org_add_seat(p_org uuid, p_email text, p_role text DEFAULT 'member')
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user uuid;
  v_used integer;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;
  IF p_role NOT IN ('owner', 'member') THEN RAISE EXCEPTION 'orgs: invalid role'; END IF;
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'orgs: invalid email';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;

  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.is_org_owner(p_org)) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  -- Tylko admin redakcji może mintować miejsce 'owner' (owner nie rozmnaża owners).
  IF p_role = 'owner' AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  IF v_org.status <> 'active' THEN RAISE EXCEPTION 'orgs: organization inactive'; END IF;

  SELECT count(*) INTO v_used FROM public.organization_seats WHERE org_id = p_org;
  IF v_used >= v_org.seats_limit THEN RAISE EXCEPTION 'orgs: seats limit reached'; END IF;

  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;

  INSERT INTO public.organization_seats
    (tenant_id, org_id, invited_email, user_id, role, claimed_at, invited_by, last_invited_at)
  VALUES
    (v_org.tenant_id, p_org, v_email, v_user, p_role,
     CASE WHEN v_user IS NULL THEN NULL ELSE now() END,
     v_uid, now())
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'orgs: seat exists';
END $$;

REVOKE EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_add_seat(uuid, text, text) TO authenticated, service_role;

-- Ponowienie zaproszenia: właściciel/admin stempluje last_invited_at na
-- NIEODEBRANYM miejscu; zwraca e-mail i nazwę organizacji dla warstwy
-- mailowej. Miejsce już odebrane nie ma czego ponawiać.
CREATE OR REPLACE FUNCTION public.org_touch_seat_invite(p_seat uuid)
RETURNS TABLE (seat_id uuid, invited_email text, org_name text, last_invited_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_seat public.organization_seats%ROWTYPE;
  v_org public.member_organizations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;

  SELECT * INTO v_seat FROM public.organization_seats WHERE id = p_seat FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;

  IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.is_org_owner(v_seat.org_id)) THEN
    RAISE EXCEPTION 'orgs: not allowed';
  END IF;
  IF v_seat.claimed_at IS NOT NULL OR v_seat.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'orgs: seat already claimed';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = v_seat.org_id;
  IF NOT FOUND OR v_org.status <> 'active' THEN
    RAISE EXCEPTION 'orgs: organization inactive';
  END IF;

  UPDATE public.organization_seats os
     SET last_invited_at = now()
   WHERE os.id = p_seat;

  RETURN QUERY
    SELECT v_seat.id, v_seat.invited_email, v_org.name, now()::timestamptz;
END $$;

REVOKE EXECUTE ON FUNCTION public.org_touch_seat_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_touch_seat_invite(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3b) Site licence: warstwa członkostwa z flagą features.premium_content
--     odblokowuje artykuły płatne. To domyka produkt enterprise - miejsce w
--     organizacji (tier corporate/partner) czyta treści premium bez osobnych
--     subskrypcji per user; działa też dla członkostw indywidualnych (copy
--     warstwy 'member' od zawsze obiecuje "Wszystkie analizy premium").
--     Ten sam has_content_access zasila get_entity_content ORAZ metering
--     (uprawnieni nie zużywają licznika).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_tenant uuid;
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids, tenant_id INTO v_mode, v_plans, v_tenant
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF v_mode = 'members' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_uid AND p.tenant_id = v_tenant
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  -- Site licence: aktywna warstwa (subskrypcja / nadanie / miejsce w
  -- organizacji) z features.premium_content = true otwiera treści płatne.
  IF public.user_has_tier_feature(v_uid, 'premium_content') THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

-- Flaga premium_content dla istniejących warstw z obietnicą "wszystkie analizy
-- premium" (member/pro/corporate/partner); nie nadpisuje ręcznych zmian admina
-- (dokłada klucz tylko tam, gdzie go nie ma).
UPDATE public.membership_tiers
   SET features = features || jsonb_build_object('premium_content', true)
 WHERE key IN ('member', 'pro', 'corporate', 'partner')
   AND NOT (features ? 'premium_content');

-- Seed dla NOWYCH tenantów: identyczny z 20260714130000, plus premium_content
-- w features warstw member/pro/corporate/partner (spójnie z powyższym UPDATE,
-- żeby świeży tenant nie dostawał warstw bez flagi site licence).
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
      ('reader', 0,
       'Konto bezpłatne', 'Free account',
       'Zapisywanie i personalizacja: zakładki, obserwowanie tematów i udział w dyskusjach.',
       'Saving and personalisation: bookmarks, topic follows and joining the discussion.',
       '[{"pl":"Zapisywanie materiałów i lista do przeczytania","en":"Saved items and a reading list"},
         {"pl":"Personalizacja: zainteresowania i obserwowane tematy","en":"Personalisation: interests and followed topics"},
         {"pl":"Udział w dyskusjach i ankietach","en":"Join discussions and polls"}]'::jsonb,
       '{}'::jsonb, true, 0),
      ('supporter', 5,
       'Wspierający', 'Supporter',
       'Darowizna wspiera niezależność instytutu; wspierający otrzymują dedykowane aktualizacje.',
       'A donation supports the institute''s independence; supporters receive dedicated updates.',
       '[{"pl":"Wszystko z konta bezpłatnego","en":"Everything in the free account"},
         {"pl":"Aktualizacje i podsumowania dla wspierających","en":"Supporter updates and briefings"},
         {"pl":"Status wspierającego przez 12 miesięcy od darowizny","en":"Supporter status for 12 months after a donation"}]'::jsonb,
       '{"supporter_updates": true}'::jsonb, false, 5),
      ('member', 10,
       'Członek indywidualny', 'Individual member',
       'Zamknięte treści i wydarzenia: pełny dostęp do analiz, briefingów i biblioteki materiałów.',
       'Closed content and events: full access to analyses, briefings and the members'' library.',
       '[{"pl":"Wszystkie analizy premium","en":"All premium analyses"},
         {"pl":"Wydarzenia i briefingi dla członków","en":"Member events and briefings"},
         {"pl":"Pierwszeństwo rejestracji na wydarzenia","en":"Priority event registration"},
         {"pl":"Biblioteka materiałów do pobrania","en":"Downloadable members'' library"},
         {"pl":"Nagrania z wydarzeń","en":"Event recordings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 10),
      ('pro', 20,
       'Członek ekspercki', 'Expert member',
       'Dla ekspertów i profesjonalistów public affairs: wszystko z członkostwa indywidualnego plus grupy robocze.',
       'For experts and public-affairs professionals: everything in individual membership plus working groups.',
       '[{"pl":"Wszystko z członkostwa indywidualnego","en":"Everything in individual membership"},
         {"pl":"Udział w grupach roboczych","en":"Participation in working groups"},
         {"pl":"Priorytet pytań w sesjach Q&A","en":"Priority in expert Q&A"},
         {"pl":"Zamknięte briefingi eksperckie","en":"Closed-door expert briefings"},
         {"pl":"Tracker legislacyjny z alertami","en":"Legislative tracker with alerts"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "premium_content": true}'::jsonb,
       false, 20),
      ('corporate', 30,
       'Członek korporacyjny', 'Corporate member',
       'Dla instytucji i firm: wiele kont dla zespołu oraz briefingi i wydarzenia dla członków.',
       'For institutions and companies: multiple team seats plus member briefings and events.',
       '[{"pl":"Wiele kont dla zespołu (miejsca w organizacji)","en":"Multiple team accounts (organisation seats)"},
         {"pl":"Wszystko z członkostwa eksperckiego","en":"Everything in expert membership"},
         {"pl":"Briefingi i wydarzenia dla członków","en":"Member briefings and events"},
         {"pl":"Wspólna biblioteka materiałów","en":"Shared members'' library"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "premium_content": true}'::jsonb,
       false, 30),
      ('partner', 40,
       'Partner strategiczny', 'Strategic partner',
       'Relacja instytucjonalna: partnerstwo programowe, dedykowane briefingi i wspólne projekty.',
       'An institutional relationship: programme partnership, dedicated briefings and joint projects.',
       '[{"pl":"Wszystko z członkostwa korporacyjnego","en":"Everything in corporate membership"},
         {"pl":"Relacja instytucjonalna i wspólne projekty","en":"Institutional relationship and joint projects"},
         {"pl":"Dedykowane briefingi dla partnera","en":"Dedicated partner briefings"}]'::jsonb,
       '{"events_members": true, "recordings": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "member_library": true, "corporate_seats": true, "strategic_partner": true, "premium_content": true}'::jsonb,
       false, 40)
    ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features, is_default, sort_order)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;
