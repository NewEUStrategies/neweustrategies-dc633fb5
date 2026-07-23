-- ============================================================================
-- MONETYZACJA x CRM, domknięcie: retencja na szynie + mostek firm.
--
-- 1) Nowa akcja silnika workflowów `create_crm_task`: zdarzenie -> zadanie
--    follow-up przy leadzie CRM (lead rozstrzygany po e-mailu z payloadu albo
--    profilu użytkownika; dedup po otwartym zadaniu o tym samym tytule -
--    subscription.updated.v1 może odpalić kilka razy w oknie anulowania).
-- 2) Dwa flagowe przepisy retencyjne w katalogu workflow_templates:
--      * zaplanowane anulowanie (cancel_scheduled) -> zadanie CRM + notyfikacja
--        zespołu (okno ratowania klienta jeszcze trwa),
--      * subskrypcja anulowana (new_status=canceled) -> zadanie win-back.
--    Instalowane idempotentnie we wszystkich istniejących tenantach; nowe
--    tenanty dostają je triggerem tg_tenants_install_workflow_templates.
-- 3) Mostek dwóch pojęć "firmy": member_organizations (członkostwo B2B,
--    miejsca, warstwa) dostaje crm_company_id -> crm_companies (kartoteka
--    sprzedażowa). Trigger BEFORE upsertuje firmę CRM po nazwie (unikat
--    tenant_id+name_norm) i podpina link; backfill łączy istniejące
--    organizacje. Sprzedaż widzi członkostwo B2B na karcie firmy, a panel
--    organizacji linkuje do kartoteki CRM - bez duplikowania danych.
--
-- Wszystko idempotentne; awaria linkowania nigdy nie blokuje zapisu organizacji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) run_workflow_step + create_crm_task (pełna podmiana funkcji - CASE jest
--    zamkniętym katalogiem, lustro TS: src/lib/admin/workflows.ts).
-- ----------------------------------------------------------------------------
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
  v_email text;
  v_lead_id uuid;
  v_lead_owner uuid;
  v_task_title text;
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
  -- Wygodny skrót dla przepisów contentowych: kanoniczny adres posta.
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
             -- ARRAY(pusty SELECT) daje '{}', nie NULL - stąd CASE, nie COALESCE.
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
      -- Obserwujący autora wskazanego w payloadzie (target_type 'author').
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

    WHEN 'create_crm_task' THEN
      -- Zadanie follow-up przy leadzie. E-mail: wprost z payloadu (email_from)
      -- albo z profilu użytkownika (user_from / payload.user_id) - zdarzenia
      -- monetyzacji niosą user_id, nie e-mail.
      v_email := NULLIF(
        p_event.payload ->> COALESCE(NULLIF(v_params ->> 'email_from', ''), 'email'), ''
      );
      IF v_email IS NULL THEN
        v_user := NULLIF(COALESCE(
          public.workflow_param_text(p_event.payload, v_params, 'user_id', 'user_from'),
          p_event.payload ->> 'user_id'
        ), '')::uuid;
        IF v_user IS NOT NULL THEN
          SELECT COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(p.contact_email), ''))
            INTO v_email
            FROM public.profiles p
           WHERE p.id = v_user AND p.tenant_id = p_event.tenant_id;
        END IF;
      END IF;
      IF v_email IS NULL THEN
        RAISE EXCEPTION 'workflow create_crm_task: no email resolvable from payload/profile';
      END IF;

      -- Klient jest wart bycia leadem: upsert (merge po email_norm) + id.
      v_lead_id := public.crm_upsert_lead(
        p_event.tenant_id, v_email, NULL, NULL, NULL, NULL, false, false
      );
      IF v_lead_id IS NULL THEN
        SELECT l.id INTO v_lead_id
          FROM public.crm_leads l
         WHERE l.tenant_id = p_event.tenant_id AND l.email_norm = lower(btrim(v_email))
         LIMIT 1;
      END IF;
      IF v_lead_id IS NULL THEN
        RAISE EXCEPTION 'workflow create_crm_task: lead not found after upsert';
      END IF;
      SELECT l.owner_id INTO v_lead_owner FROM public.crm_leads l WHERE l.id = v_lead_id;

      v_task_title := COALESCE(
        NULLIF(replace(COALESCE(v_params ->> 'title', ''), '{aggregate_id}', p_event.aggregate_id), ''),
        'Follow-up'
      );
      -- Dedup: jedno OTWARTE zadanie o tym tytule per lead - zdarzenie może
      -- odpalić wielokrotnie (np. zmiana okresu przy zaplanowanym anulowaniu).
      IF NOT EXISTS (
        SELECT 1 FROM public.crm_tasks ct
         WHERE ct.lead_id = v_lead_id AND ct.status = 'open' AND ct.title = v_task_title
      ) THEN
        INSERT INTO public.crm_tasks (
          tenant_id, lead_id, title, note, due_at, assignee_id, created_by
        ) VALUES (
          p_event.tenant_id, v_lead_id, v_task_title,
          NULLIF(v_params ->> 'note', ''),
          now() + make_interval(
            days => GREATEST(0, COALESCE(NULLIF(v_params ->> 'due_days', '')::integer, 3))
          ),
          v_lead_owner, NULL
        );
      END IF;

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

-- ----------------------------------------------------------------------------
-- 2) Flagowe przepisy retencyjne w katalogu + instalacja w istniejących
--    tenantach (nowe tenanty obsługuje istniejący trigger na tenants).
-- ----------------------------------------------------------------------------
INSERT INTO public.workflow_templates (
  key, name_pl, name_en, description_pl, description_en,
  trigger_event_type, condition, steps
) VALUES
  (
    'subscription-cancel-scheduled-crm-task',
    'Retencja: zaplanowane anulowanie -> zadanie CRM',
    'Retention: cancellation scheduled -> CRM task',
    'Gdy subskrybent zaplanuje anulowanie (dostęp trwa do końca okresu), przy leadzie powstaje pilne zadanie retencyjne, a zespół dostaje notyfikację - okno ratowania klienta jeszcze trwa.',
    'When a subscriber schedules a cancellation (access runs until period end), an urgent retention task is created on the lead and the team is notified - the save-the-customer window is still open.',
    'subscription.updated.v1',
    '{"cancel_scheduled": true}'::jsonb,
    '[{"action":"create_crm_task","params":{"title":"Retencja: klient zaplanował anulowanie subskrypcji","note":"Dostęp trwa do końca opłaconego okresu - skontaktuj się zanim wygaśnie. Kontroferta czeka w module kuponów B2B (retencja).","due_days":"2","user_from":"user_id"}},{"action":"notify_staff","params":{"kind":"system","title_pl":"Subskrybent zaplanował anulowanie - zadanie retencyjne w CRM","title_en":"A subscriber scheduled a cancellation - retention task created in CRM","href":"/admin/crm","icon":"life-buoy","roles":["admin","editor"]}}]'::jsonb
  ),
  (
    'subscription-canceled-crm-task',
    'Retencja: subskrypcja anulowana -> zadanie win-back',
    'Retention: subscription cancelled -> win-back task',
    'Po ostatecznym anulowaniu subskrypcji przy leadzie powstaje zadanie win-back (ankieta odejścia, oferta powrotu).',
    'After a subscription is finally cancelled, a win-back task is created on the lead (exit survey, comeback offer).',
    'subscription.status_changed.v1',
    '{"new_status": "canceled"}'::jsonb,
    '[{"action":"create_crm_task","params":{"title":"Retencja: subskrypcja anulowana - win-back","note":"Zapytaj o powód odejścia i zaproponuj ofertę powrotu (kupon retencyjny).","due_days":"5","user_from":"user_id"}}]'::jsonb
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
WHERE wt.key IN ('subscription-cancel-scheduled-crm-task', 'subscription-canceled-crm-task')
ON CONFLICT (tenant_id, template_key) WHERE template_key IS NOT NULL
  DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3) Mostek member_organizations -> crm_companies.
-- ----------------------------------------------------------------------------
ALTER TABLE public.member_organizations
  ADD COLUMN IF NOT EXISTS crm_company_id uuid
    REFERENCES public.crm_companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.member_organizations.crm_company_id IS
  'Kartoteka sprzedażowa tej organizacji (crm_companies). Utrzymywany triggerem po nazwie; NULL po skasowaniu firmy - trigger podepnie ponownie przy kolejnym zapisie.';

CREATE INDEX IF NOT EXISTS idx_member_orgs_crm_company
  ON public.member_organizations (crm_company_id) WHERE crm_company_id IS NOT NULL;

-- Upsert firmy CRM po nazwie (unikat tenant_id+name_norm) i podpięcie linku.
-- BEFORE trigger: modyfikuje NEW. Link jest udogodnieniem - wyjątek nigdy nie
-- blokuje zapisu organizacji.
CREATE OR REPLACE FUNCTION public.tg_member_orgs_sync_crm_company()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.crm_company_id IS NULL AND btrim(COALESCE(NEW.name, '')) <> '' THEN
    INSERT INTO public.crm_companies (tenant_id, name, website, city, country)
    VALUES (NEW.tenant_id, btrim(NEW.name), NEW.website_url, NEW.city, NEW.country)
    ON CONFLICT (tenant_id, name_norm) DO UPDATE
      SET website = COALESCE(public.crm_companies.website, EXCLUDED.website),
          city = COALESCE(public.crm_companies.city, EXCLUDED.city),
          country = COALESCE(public.crm_companies.country, EXCLUDED.country),
          updated_at = now()
    RETURNING id INTO NEW.crm_company_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_orgs_sync_crm_company ON public.member_organizations;
CREATE TRIGGER trg_member_orgs_sync_crm_company
  BEFORE INSERT OR UPDATE ON public.member_organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_member_orgs_sync_crm_company();

-- Backfill istniejących organizacji: dosiej brakujące firmy, podepnij linki.
INSERT INTO public.crm_companies (tenant_id, name, website, city, country)
SELECT DISTINCT ON (mo.tenant_id, lower(btrim(mo.name)))
       mo.tenant_id, btrim(mo.name), mo.website_url, mo.city, mo.country
  FROM public.member_organizations mo
 WHERE mo.crm_company_id IS NULL
   AND btrim(COALESCE(mo.name, '')) <> ''
ON CONFLICT (tenant_id, name_norm) DO NOTHING;

UPDATE public.member_organizations mo
   SET crm_company_id = c.id
  FROM public.crm_companies c
 WHERE mo.crm_company_id IS NULL
   AND btrim(COALESCE(mo.name, '')) <> ''
   AND c.tenant_id = mo.tenant_id
   AND c.name_norm = lower(btrim(mo.name));
