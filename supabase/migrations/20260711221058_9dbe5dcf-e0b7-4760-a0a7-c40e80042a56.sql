CREATE TABLE IF NOT EXISTS public.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  template_key text,
  enabled boolean NOT NULL DEFAULT true,
  trigger_event_type text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(name) <> ''),
  CHECK (jsonb_typeof(steps) = 'array'),
  CHECK (jsonb_typeof(condition) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger
  ON public.workflow_definitions (tenant_id, trigger_event_type) WHERE enabled;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_definitions_template
  ON public.workflow_definitions (tenant_id, template_key) WHERE template_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
  event_id uuid,
  event_type text NOT NULL,
  correlation_id uuid,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error text,
  steps_completed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
  ON public.workflow_runs (workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_correlation
  ON public.workflow_runs (correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workflow_templates (
  key text PRIMARY KEY,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text NOT NULL,
  description_en text NOT NULL,
  trigger_event_type text NOT NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_definitions TO authenticated;
GRANT SELECT ON public.workflow_runs TO authenticated;
GRANT SELECT ON public.workflow_templates TO authenticated;
GRANT ALL ON public.workflow_definitions TO service_role;
GRANT ALL ON public.workflow_runs TO service_role;
GRANT ALL ON public.workflow_templates TO service_role;

ALTER TABLE public.workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_definitions_staff_all ON public.workflow_definitions;
CREATE POLICY workflow_definitions_staff_all
  ON public.workflow_definitions FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS workflow_runs_staff_select ON public.workflow_runs;
CREATE POLICY workflow_runs_staff_select
  ON public.workflow_runs FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS workflow_templates_staff_select ON public.workflow_templates;
CREATE POLICY workflow_templates_staff_select
  ON public.workflow_templates FOR SELECT TO authenticated
  USING (public.is_staff());

CREATE OR REPLACE FUNCTION public.workflow_param_text(
  p_payload jsonb, p_params jsonb, p_fixed_key text, p_from_key text
)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(p_params ->> p_fixed_key, ''),
    NULLIF(p_payload ->> (p_params ->> p_from_key), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.run_workflow_step(
  p_event public.domain_events, p_step jsonb
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text := p_step ->> 'action';
  v_params jsonb := COALESCE(p_step -> 'params', '{}'::jsonb);
  v_user uuid;
  v_href text;
  v_title_pl text;
  v_title_en text;
  v_kind text;
  v_target_id text;
  v_author text;
  v_follower record;
BEGIN
  v_kind := COALESCE(NULLIF(v_params ->> 'kind', ''), 'system');
  v_title_pl := replace(
    COALESCE(v_params ->> 'title_pl', ''), '{aggregate_id}', p_event.aggregate_id
  );
  v_title_en := replace(
    COALESCE(v_params ->> 'title_en', ''), '{aggregate_id}', p_event.aggregate_id
  );
  v_href := NULLIF(replace(
    COALESCE(v_params ->> 'href', ''), '{aggregate_id}', p_event.aggregate_id
  ), '');
  IF v_params ->> 'href' = '{post_href}' AND p_event.aggregate_type = 'post' THEN
    v_href := public.post_canonical_href(p_event.aggregate_id::uuid);
  END IF;

  CASE v_action
    WHEN 'notify_user' THEN
      v_user := NULLIF(
        public.workflow_param_text(p_event.payload, v_params, 'user_id', 'user_from'), ''
      )::uuid;
      IF v_user IS NOT NULL THEN
        PERFORM public.enqueue_notification(
          v_user, v_kind, v_title_pl, v_title_en, NULL, NULL, v_href,
          NULLIF(v_params ->> 'icon', '')
        );
      END IF;

    WHEN 'notify_staff' THEN
      FOR v_follower IN
        SELECT DISTINCT ur.user_id
          FROM public.user_roles ur
          JOIN public.profiles p ON p.id = ur.user_id
         WHERE p.tenant_id = p_event.tenant_id
           AND ur.role::text = ANY (
             CASE WHEN v_params ? 'roles'
               THEN ARRAY(SELECT jsonb_array_elements_text(v_params -> 'roles'))
               ELSE ARRAY['admin', 'editor']
             END
           )
      LOOP
        PERFORM public.enqueue_notification(
          v_follower.user_id, v_kind, v_title_pl, v_title_en, NULL, NULL, v_href,
          NULLIF(v_params ->> 'icon', '')
        );
      END LOOP;

    WHEN 'notify_followers' THEN
      v_author := p_event.payload ->> COALESCE(NULLIF(v_params ->> 'author_from', ''), 'author_id');
      IF v_author IS NOT NULL THEN
        FOR v_follower IN
          SELECT uf.user_id
            FROM public.user_follows uf
           WHERE uf.tenant_id = p_event.tenant_id
             AND uf.target_type = 'author'
             AND uf.target_id = v_author
             AND uf.user_id::text <> v_author
        LOOP
          PERFORM public.enqueue_notification(
            v_follower.user_id, COALESCE(NULLIF(v_params ->> 'kind', ''), 'content'),
            v_title_pl, v_title_en, NULL, NULL, v_href,
            NULLIF(v_params ->> 'icon', '')
          );
        END LOOP;
      END IF;

    WHEN 'create_crm_lead' THEN
      PERFORM public.crm_upsert_lead(
        p_event.tenant_id,
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'email_from', ''), 'email'),
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'first_name_from', ''), 'first_name'),
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'last_name_from', ''), 'last_name'),
        NULL, NULL,
        COALESCE((v_params ->> 'newsletter')::boolean, false),
        COALESCE((v_params ->> 'marketing')::boolean, false)
      );

    WHEN 'add_cross_reference' THEN
      v_target_id := public.workflow_param_text(
        p_event.payload, v_params, 'target_id', 'target_id_from'
      );
      IF v_target_id IS NOT NULL THEN
        PERFORM public.add_cross_reference(
          p_event.tenant_id, p_event.aggregate_type, p_event.aggregate_id,
          COALESCE(NULLIF(v_params ->> 'target_type', ''), 'post'),
          v_target_id,
          COALESCE(NULLIF(v_params ->> 'relation', ''), 'related'),
          p_event.actor_id
        );
      END IF;

    ELSE
      RAISE EXCEPTION 'workflow: unknown action %', v_action;
  END CASE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_workflow_step(public.domain_events, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_workflow_step(public.domain_events, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_run_workflows_for_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_def record;
  v_step jsonb;
  v_done integer;
BEGIN
  IF pg_trigger_depth() > 8 THEN
    RETURN NEW;
  END IF;

  FOR v_def IN
    SELECT * FROM public.workflow_definitions d
     WHERE d.tenant_id = NEW.tenant_id
       AND d.enabled
       AND d.trigger_event_type = NEW.event_type
     ORDER BY d.created_at ASC
  LOOP
    IF NOT (NEW.payload @> v_def.condition) THEN
      CONTINUE;
    END IF;
    v_done := 0;
    BEGIN
      FOR v_step IN SELECT * FROM jsonb_array_elements(v_def.steps) LOOP
        PERFORM public.run_workflow_step(NEW, v_step);
        v_done := v_done + 1;
      END LOOP;
      INSERT INTO public.workflow_runs (
        tenant_id, workflow_id, event_id, event_type, correlation_id,
        status, steps_completed
      ) VALUES (
        NEW.tenant_id, v_def.id, NEW.id, NEW.event_type, NEW.correlation_id,
        'succeeded', v_done
      );
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.workflow_runs (
        tenant_id, workflow_id, event_id, event_type, correlation_id,
        status, error, steps_completed
      ) VALUES (
        NEW.tenant_id, v_def.id, NEW.id, NEW.event_type, NEW.correlation_id,
        'failed', left(SQLERRM, 500), v_done
      );
    END;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_run_workflows_for_event ON public.domain_events;
CREATE TRIGGER trg_run_workflows_for_event
  AFTER INSERT ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_run_workflows_for_event();

CREATE OR REPLACE FUNCTION public.install_workflow_template(p_key text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_template public.workflow_templates%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL OR NOT public.is_staff() THEN
    RAISE EXCEPTION 'workflows: staff only';
  END IF;
  SELECT * INTO v_template FROM public.workflow_templates WHERE key = p_key;
  IF v_template.key IS NULL THEN
    RAISE EXCEPTION 'workflows: unknown template %', p_key;
  END IF;

  INSERT INTO public.workflow_definitions (
    tenant_id, name, template_key, trigger_event_type, condition, steps, created_by
  ) VALUES (
    v_tenant, v_template.name_pl, v_template.key, v_template.trigger_event_type,
    v_template.condition, v_template.steps, auth.uid()
  )
  ON CONFLICT (tenant_id, template_key) WHERE template_key IS NOT NULL
    DO UPDATE SET enabled = true, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.install_workflow_template(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.install_workflow_template(text) TO authenticated, service_role;

INSERT INTO public.workflow_templates (
  key, name_pl, name_en, description_pl, description_en,
  trigger_event_type, condition, steps
) VALUES
  (
    'newsletter-confirmed-to-crm',
    'Newsletter: potwierdzony zapis -> lead CRM',
    'Newsletter: confirmed signup -> CRM lead',
    'Po potwierdzeniu zapisu (double opt-in) subskrybent trafia jako lead do CRM.',
    'After double opt-in confirmation the subscriber lands in the CRM as a lead.',
    'newsletter_subscriber.confirmed.v1',
    '{}'::jsonb,
    '[{"action":"create_crm_lead","params":{"newsletter":true}}]'::jsonb
  ),
  (
    'post-published-notify-followers',
    'Content: publikacja posta -> powiadom obserwujących autora',
    'Content: post published -> notify the author''s followers',
    'Obserwujący autora dostają notyfikację z linkiem do nowego artykułu.',
    'Followers of the author get a notification linking to the new article.',
    'post.published.v1',
    '{}'::jsonb,
    '[{"action":"notify_followers","params":{"kind":"content","title_pl":"Nowy artykuł autora, którego obserwujesz","title_en":"New article from an author you follow","href":"{post_href}","icon":"newspaper"}}]'::jsonb
  ),
  (
    'crm-lead-won-notify-staff',
    'CRM: lead wygrany -> powiadom zespół',
    'CRM: lead won -> notify the team',
    'Przejście leada na etap "won" wysyła notyfikację adminom i edytorom.',
    'A lead moving to the "won" stage notifies admins and editors.',
    'crm_lead.stage_changed.v1',
    '{"new_stage":"won"}'::jsonb,
    '[{"action":"notify_staff","params":{"kind":"system","title_pl":"Lead wygrany w CRM","title_en":"CRM lead won","href":"/admin/crm?lead={aggregate_id}","icon":"trophy","roles":["admin","editor"]}}]'::jsonb
  ),
  (
    'comment-pending-notify-staff',
    'Komentarze: nowy do moderacji -> powiadom zespół',
    'Comments: new pending comment -> notify the team',
    'Nowy komentarz czekający na moderację wysyła notyfikację adminom i edytorom.',
    'A new comment awaiting moderation notifies admins and editors.',
    'comment.created.v1',
    '{"status":"pending"}'::jsonb,
    '[{"action":"notify_staff","params":{"kind":"comment","title_pl":"Nowy komentarz czeka na moderację","title_en":"A new comment awaits moderation","href":"/admin/comments","icon":"message-square"}}]'::jsonb
  )
ON CONFLICT (key) DO UPDATE
  SET name_pl = EXCLUDED.name_pl,
      name_en = EXCLUDED.name_en,
      description_pl = EXCLUDED.description_pl,
      description_en = EXCLUDED.description_en,
      trigger_event_type = EXCLUDED.trigger_event_type,
      condition = EXCLUDED.condition,
      steps = EXCLUDED.steps;

INSERT INTO public.workflow_definitions (
  tenant_id, name, template_key, trigger_event_type, condition, steps
)
SELECT t.id, wt.name_pl, wt.key, wt.trigger_event_type, wt.condition, wt.steps
FROM public.tenants t
CROSS JOIN public.workflow_templates wt
ON CONFLICT (tenant_id, template_key) WHERE template_key IS NOT NULL
  DO NOTHING;

CREATE OR REPLACE FUNCTION public.tg_tenants_install_workflow_templates()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workflow_definitions (
    tenant_id, name, template_key, trigger_event_type, condition, steps
  )
  SELECT NEW.id, wt.name_pl, wt.key, wt.trigger_event_type, wt.condition, wt.steps
  FROM public.workflow_templates wt
  ON CONFLICT (tenant_id, template_key) WHERE template_key IS NOT NULL
    DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_install_workflow_templates ON public.tenants;
CREATE TRIGGER trg_tenants_install_workflow_templates
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_tenants_install_workflow_templates();