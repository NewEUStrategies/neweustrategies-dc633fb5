-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9b, część B): JEDEN LIMIT DŁUGOŚCI TAGU CRM - 64
-- ZNAKI W PISARZU TAGÓW I W WALIDACJI GRAFU ŚCIEŻKI (Z-S5-02).
-- Decyzja właściciela 2026-10-20 (zgoda delegowana): jeden wspólny limit
-- klient/serwer; bez CHECK długości tagu w bazie wygrywa kontrakt I0
-- (`JOURNEY_LIMITS.tagMax` = 64).
--
-- DEFEKT
--   Ten sam tag miał trzy limity: kontrakt I0 ścieżek 64 znaki
--   (`JOURNEY_LIMITS.tagMax`), pisarz tagów CRM `run_workflow_step` 40
--   (20261020130200) i walidator grafu ścieżki 40 (20261020140200, lustro
--   pisarza), a panel CRM i przepisy w TS - 40. Licznik znaków w UI nie
--   mógł znać limitu, który egzekwuje baza, bo baza egzekwowała inny niż
--   kontrakt, a tag dłuższy niż 40 wpisany gdziekolwiek indziej (import,
--   zapis tabeli) nie dawał się zdjąć przepisem ani krokiem ścieżki.
--   `crm_leads.tags text[]` NIE ma CHECK długości elementu (sprawdzone na
--   wszystkich migracjach), więc żaden zapisany tag nie staje się błędny.
--
-- ZMIANA
--   A. `run_workflow_step` (CIALO-Z 20261020130200): `add_tag`/`remove_tag`
--      przyjmują tag 1-64 znaki (po `btrim`); dłuższy - wyjątek, nigdy
--      przycięcie. Reszta ciała bez zmian.
--   B. `journey_validate_graph` (CIALO-Z 20261020140200): błąd `tag_length`
--      dla tagu spoza 1-64. Reszta ciała bez zmian.
--   Ta sama liczba w TS: `CRM_TAG_MAX` (src/lib/crm/lifecycle.ts) - czytają
--   ją schematy zod panelu CRM, przepisów i ścieżek, liczniki znaków
--   i komunikaty UI; `JOURNEY_LIMITS.tagMax` to ta sama stała.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020130200 i 20261020140200 (S4, S5).
-- Redefinicje funkcji (bez DDL tabel), więc bez `lock_timeout`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9b_crm_tag_limit_test.sql (64 znaki przechodzą,
-- 65 odrzucone - w walidatorze grafu i w pisarzu tagów; tag z odstępami
-- liczony po `btrim`), src/lib/crm/__tests__/tagLimitParity.test.ts (parytet
-- 64 TS ⇄ najnowsze definicje SQL, wartość graniczna w schematach zod).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Pisarz tagów CRM (akcje przepisów i kroków ścieżek).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020130200
CREATE OR REPLACE FUNCTION public.run_workflow_step(p_event domain_events, p_step jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_first_name text;
  v_last_name text;
  v_sub_ref text;
  v_sub_id uuid;
  v_lead_id uuid;
  v_lead_owner uuid;
  v_task_title text;
  v_assignee uuid;
  v_origin text;
  v_due interval;
  v_tag text;
  v_stage text;
  v_owner uuid;
  -- Kto pisze: przepis (domyślnie) albo krok ścieżki S5 - nic poza tym.
  v_source text := COALESCE(NULLIF(v_params ->> '_source', ''), 'workflow');
  v_prev_source text;
  v_prev_journey text;
  v_prev_enrollment text;
BEGIN
  IF v_source NOT IN ('workflow', 'journey') THEN
    RAISE EXCEPTION 'workflow: invalid _source %', v_source;
  END IF;

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

  -- KONTAKT ZDARZENIA (akcje CRM i newslettera). Redakcja ładunku
  -- (20260729123407) usuwa e-mail, więc adres bierzemy z miejsc, które go
  -- trzymają: subskrybent (agregat albo `subscriber_id`) i profil konta.
  IF v_action IN ('create_crm_lead', 'create_crm_task', 'set_lifecycle_stage', 'set_crm_stage',
                  'add_tag', 'remove_tag', 'assign_owner',
                  'newsletter_list_add', 'newsletter_list_remove') THEN
    v_user := NULLIF(COALESCE(
      public.workflow_param_text(p_event.payload, v_params, 'user_id', 'user_from'),
      p_event.payload ->> 'user_id'
    ), '')::uuid;
    v_email := NULLIF(btrim(
      p_event.payload ->> COALESCE(NULLIF(v_params ->> 'email_from', ''), 'email')
    ), '');
    v_first_name := p_event.payload ->> COALESCE(NULLIF(v_params ->> 'first_name_from', ''), 'first_name');
    v_last_name := p_event.payload ->> COALESCE(NULLIF(v_params ->> 'last_name_from', ''), 'last_name');

    v_sub_ref := CASE
      WHEN p_event.aggregate_type = 'newsletter_subscriber' THEN p_event.aggregate_id
      ELSE NULLIF(p_event.payload ->> 'subscriber_id', '')
    END;
    IF v_sub_ref IS NOT NULL THEN
      SELECT s.id, COALESCE(v_email, NULLIF(btrim(s.email), '')),
             COALESCE(v_first_name, s.first_name), COALESCE(v_last_name, s.last_name)
        INTO v_sub_id, v_email, v_first_name, v_last_name
        FROM public.newsletter_subscribers s
       WHERE s.id::text = v_sub_ref AND s.tenant_id = p_event.tenant_id;
    END IF;
    IF v_email IS NULL AND v_user IS NOT NULL THEN
      SELECT COALESCE(NULLIF(btrim(p.email), ''), NULLIF(btrim(p.contact_email), ''))
        INTO v_email
        FROM public.profiles p
       WHERE p.id = v_user AND p.tenant_id = p_event.tenant_id;
    END IF;
    -- Zdarzenia leada (np. `crm_lead.lifecycle_changed.v1`) nie niosą adresu:
    -- bierzemy go z samego leada, żeby akcje listy newslettera działały też
    -- w przepisach uruchamianych zmianą etapu.
    IF v_email IS NULL THEN
      SELECT NULLIF(btrim(l.email), '')
        INTO v_email
        FROM public.crm_leads l
       WHERE l.tenant_id = p_event.tenant_id
         AND l.id::text = CASE WHEN p_event.aggregate_type = 'crm_lead'
                               THEN p_event.aggregate_id
                               ELSE NULLIF(p_event.payload ->> 'lead_id', '') END;
    END IF;
  END IF;

  -- LEAD ZDARZENIA (akcje CRM poza zakładaniem leada): agregat leada,
  -- `payload.lead_id`, konto (`crm_leads.user_id`), a na końcu e-mail -
  -- z upsertem, jak dotąd w `create_crm_task` („klient jest wart bycia leadem").
  IF v_action IN ('create_crm_task', 'set_lifecycle_stage', 'set_crm_stage',
                  'add_tag', 'remove_tag', 'assign_owner') THEN
    IF p_event.aggregate_type = 'crm_lead' THEN
      SELECT l.id INTO v_lead_id
        FROM public.crm_leads l
       WHERE l.id::text = p_event.aggregate_id AND l.tenant_id = p_event.tenant_id;
    END IF;
    IF v_lead_id IS NULL AND NULLIF(p_event.payload ->> 'lead_id', '') IS NOT NULL THEN
      SELECT l.id INTO v_lead_id
        FROM public.crm_leads l
       WHERE l.id::text = p_event.payload ->> 'lead_id' AND l.tenant_id = p_event.tenant_id;
    END IF;
    IF v_lead_id IS NULL AND v_user IS NOT NULL THEN
      SELECT l.id INTO v_lead_id
        FROM public.crm_leads l
       WHERE l.tenant_id = p_event.tenant_id AND l.user_id = v_user;
    END IF;
    IF v_lead_id IS NULL THEN
      IF v_email IS NULL THEN
        RAISE EXCEPTION 'workflow %: no lead or email resolvable from event', v_action;
      END IF;
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
        RAISE EXCEPTION 'workflow %: lead not found after upsert', v_action;
      END IF;
    END IF;
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
             AND uf.target_id::text = v_author
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
      -- D1: bez adresu przebieg ma się NIE udać (dotąd crm_upsert_lead
      -- zwracał NULL, a przebieg był `succeeded`).
      IF v_email IS NULL THEN
        RAISE EXCEPTION 'workflow create_crm_lead: no email resolvable from payload, subscriber or profile';
      END IF;
      -- D9: zgoda marketingowa wyłącznie z dowodu, nigdy z parametru przepisu.
      PERFORM public.crm_upsert_lead(
        p_event.tenant_id, v_email, v_first_name, v_last_name, NULL, NULL,
        COALESCE((v_params ->> 'newsletter')::boolean, false),
        false
      );

    WHEN 'create_crm_task' THEN
      SELECT l.owner_id INTO v_lead_owner FROM public.crm_leads l WHERE l.id = v_lead_id;

      -- P24: osoba z parametru (tylko personel CRM najemcy), potem właściciel
      -- leada, potem domyślna osoba z ustawień ścieżek. Bez niej przypomnienie
      -- nie trafi do nikogo (reguła diagnostyki S7 to wyłapie).
      v_assignee := NULLIF(v_params ->> 'assignee_id', '')::uuid;
      IF v_assignee IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.tenant_id = p_event.tenant_id AND ur.user_id = v_assignee
           AND ur.role::text IN ('admin', 'editor', 'super_admin')
      ) THEN
        RAISE EXCEPTION 'workflow create_crm_task: assignee is not CRM staff of the tenant';
      END IF;
      IF v_assignee IS NULL THEN
        v_assignee := v_lead_owner;
      END IF;
      IF v_assignee IS NULL THEN
        SELECT js.default_task_assignee_id INTO v_assignee
          FROM public.journey_settings js WHERE js.tenant_id = p_event.tenant_id;
      END IF;

      v_task_title := COALESCE(
        NULLIF(replace(COALESCE(v_params ->> 'title', ''), '{aggregate_id}', p_event.aggregate_id), ''),
        'Follow-up'
      );
      -- Klucz idempotencji kroku. Domyślny łączy zdarzenie z treścią kroku:
      -- ten sam krok tego samego zdarzenia = jedno zadanie także po powtórce.
      v_origin := COALESCE(
        NULLIF(btrim(v_params ->> 'origin_ref'), ''),
        'wf:' || p_event.id::text || ':' || md5(p_step::text)
      );
      v_origin := replace(replace(replace(replace(v_origin,
        '{event_id}', p_event.id::text),
        '{aggregate_id}', p_event.aggregate_id),
        '{user_id}', COALESCE(v_user::text, '')),
        '{lead_id}', v_lead_id::text);
      -- Przycięcie skleiłoby dwa różne kroki w jedno zadanie (I0 CHECK).
      IF char_length(v_origin) > 200 THEN
        RAISE EXCEPTION 'workflow create_crm_task: origin_ref longer than 200 characters';
      END IF;

      IF NULLIF(v_params ->> 'due_hours', '') IS NOT NULL THEN
        v_due := make_interval(hours => GREATEST(0, (v_params ->> 'due_hours')::integer));
      ELSE
        v_due := make_interval(
          days => GREATEST(0, COALESCE(NULLIF(v_params ->> 'due_days', '')::integer, 3))
        );
      END IF;

      -- Dedup: jedno OTWARTE zadanie o tym tytule per lead - zdarzenie może
      -- odpalić wielokrotnie (np. zmiana okresu przy zaplanowanym anulowaniu).
      IF NOT EXISTS (
        SELECT 1 FROM public.crm_tasks ct
         WHERE ct.lead_id = v_lead_id AND ct.status = 'open' AND ct.title = v_task_title
      ) THEN
        INSERT INTO public.crm_tasks (
          tenant_id, lead_id, title, note, due_at, assignee_id, created_by, source, origin_ref
        ) VALUES (
          p_event.tenant_id, v_lead_id, v_task_title,
          NULLIF(v_params ->> 'note', ''),
          now() + v_due,
          v_assignee, NULL, v_source, v_origin
        )
        ON CONFLICT (tenant_id, origin_ref) WHERE origin_ref IS NOT NULL DO NOTHING;
      END IF;

    WHEN 'set_lifecycle_stage' THEN
      v_stage := NULLIF(btrim(v_params ->> 'stage'), '');
      IF v_stage IS NULL THEN
        RAISE EXCEPTION 'workflow set_lifecycle_stage: stage is required';
      END IF;
      v_prev_journey := current_setting('app.change_journey_id', true);
      v_prev_enrollment := current_setting('app.change_enrollment_id', true);
      PERFORM set_config('app.change_journey_id', COALESCE(v_params ->> '_journey_id', ''), true);
      PERFORM set_config('app.change_enrollment_id', COALESCE(v_params ->> '_enrollment_id', ''), true);
      -- Odmowa pierwszeństwa to WYNIK (krok udany bez zmiany), nie błąd.
      PERFORM public.crm_set_lifecycle_stage(
        v_lead_id, v_stage, v_source, COALESCE((v_params ->> 'allow_backward')::boolean, false)
      );
      PERFORM set_config('app.change_journey_id', COALESCE(v_prev_journey, ''), true);
      PERFORM set_config('app.change_enrollment_id', COALESCE(v_prev_enrollment, ''), true);

    WHEN 'set_crm_stage' THEN
      v_stage := NULLIF(btrim(v_params ->> 'stage'), '');
      IF v_stage IS NULL THEN
        RAISE EXCEPTION 'workflow set_crm_stage: stage is required';
      END IF;
      v_prev_source := current_setting('app.change_source', true);
      PERFORM set_config('app.change_source', v_source, true);
      UPDATE public.crm_leads
         SET stage = v_stage::public.crm_stage,
             last_activity_at = now()
       WHERE id = v_lead_id AND stage IS DISTINCT FROM v_stage::public.crm_stage;
      PERFORM set_config('app.change_source', COALESCE(v_prev_source, ''), true);

    WHEN 'add_tag' THEN
      -- 64 = CRM_TAG_MAX (src/lib/crm/lifecycle.ts): jeden limit tagu dla
      -- panelu CRM, przepisów i ścieżek (I9b, Z-S5-02); parytet w teście.
      v_tag := btrim(COALESCE(v_params ->> 'tag', ''));
      IF char_length(v_tag) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION 'workflow add_tag: tag must have 1-64 characters';
      END IF;
      UPDATE public.crm_leads l
         SET tags = l.tags || v_tag
       WHERE l.id = v_lead_id AND NOT (v_tag = ANY (l.tags));

    WHEN 'remove_tag' THEN
      v_tag := btrim(COALESCE(v_params ->> 'tag', ''));
      IF char_length(v_tag) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION 'workflow remove_tag: tag must have 1-64 characters';
      END IF;
      UPDATE public.crm_leads l
         SET tags = array_remove(l.tags, v_tag)
       WHERE l.id = v_lead_id AND v_tag = ANY (l.tags);

    WHEN 'assign_owner' THEN
      v_owner := NULLIF(v_params ->> 'owner_id', '')::uuid;
      IF v_owner IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.tenant_id = p_event.tenant_id AND ur.user_id = v_owner
           AND ur.role::text IN ('admin', 'editor', 'super_admin')
      ) THEN
        RAISE EXCEPTION 'workflow assign_owner: owner is not CRM staff of the tenant';
      END IF;
      UPDATE public.crm_leads l
         SET owner_id = v_owner
       WHERE l.id = v_lead_id
         AND l.owner_id IS DISTINCT FROM v_owner
         AND (l.owner_id IS NULL OR COALESCE((v_params ->> 'overwrite')::boolean, false));

    WHEN 'newsletter_list_add', 'newsletter_list_remove' THEN
      IF v_sub_id IS NULL AND v_email IS NOT NULL THEN
        SELECT s.id INTO v_sub_id
          FROM public.newsletter_subscribers s
         WHERE s.tenant_id = p_event.tenant_id AND lower(s.email) = lower(v_email)
         LIMIT 1;
      END IF;
      -- Automat nie zapisuje na newsletter (zgoda!) - bez subskrybenta nie ma
      -- czego przypisać do listy.
      IF v_sub_id IS NULL THEN
        RAISE EXCEPTION 'workflow %: no newsletter subscriber for the event', v_action;
      END IF;
      PERFORM public.newsletter_subscriber_list_set(
        v_sub_id, v_params ->> 'list_key',
        CASE WHEN v_action = 'newsletter_list_add' THEN 'add' ELSE 'remove' END
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
$function$;

-- ACL jak w 20261020130200 (tylko service_role).
REVOKE ALL ON FUNCTION public.run_workflow_step(public.domain_events, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_workflow_step(public.domain_events, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- B) Walidacja grafu ścieżki (publikacja i zapis szkicu).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140200
CREATE OR REPLACE FUNCTION public.journey_validate_graph(p_graph jsonb, p_trigger_event_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- node-types: lustro JOURNEY_NODE_TYPES (nodeTypesParity.test.ts).
  v_types constant text[] := ARRAY[
    'trigger', 'wait', 'send_email', 'ab_split', 'if_else', 'set_lifecycle_stage',
    'set_crm_stage', 'create_crm_task', 'add_tag', 'remove_tag', 'newsletter_list',
    'notify_staff', 'goal', 'exit'
  ];
  v_errors jsonb := '[]'::jsonb;
  v_nodes jsonb;
  v_edges jsonb;
  v_node jsonb;
  v_edge jsonb;
  v_id text;
  v_type text;
  v_params jsonb;
  v_required text[];
  v_allowed text[];
  v_branches text[];
  v_trigger text;
  v_count integer;
  v_visited integer;
  v_pred jsonb;
  v_n integer;
BEGIN
  IF jsonb_typeof(p_graph) <> 'object' OR jsonb_typeof(p_graph -> 'nodes') <> 'array'
     OR jsonb_typeof(p_graph -> 'edges') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'graph_shape')));
  END IF;
  v_nodes := p_graph -> 'nodes';
  v_edges := p_graph -> 'edges';
  v_count := jsonb_array_length(v_nodes);
  IF v_count = 0 OR v_count > 60 THEN
    v_errors := v_errors || jsonb_build_object('code', 'nodes_count');
  END IF;

  -- Identyfikatory i typy.
  FOR v_node IN SELECT jsonb_array_elements(v_nodes) LOOP
    v_id := v_node ->> 'id';
    IF v_id IS NULL OR v_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
      v_errors := v_errors || jsonb_build_object('code', 'node_id_invalid', 'nodeId', v_id);
    END IF;
    IF NOT ((v_node ->> 'type') = ANY (v_types)) THEN
      v_errors := v_errors || jsonb_build_object('code', 'node_type_unknown', 'nodeId', v_id);
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT n ->> 'id') FROM jsonb_array_elements(v_nodes) n) <> v_count THEN
    v_errors := v_errors || jsonb_build_object('code', 'node_id_duplicate');
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_nodes) n WHERE n ->> 'type' = 'trigger';
  IF v_n <> 1 THEN
    v_errors := v_errors || jsonb_build_object('code', 'trigger_count');
  END IF;
  SELECT n ->> 'id' INTO v_trigger FROM jsonb_array_elements(v_nodes) n WHERE n ->> 'type' = 'trigger' LIMIT 1;

  -- Krawędzie: końce istnieją, gałąź dozwolona dla typu, bez duplikatów, nic nie wchodzi do wyzwalacza.
  FOR v_edge IN SELECT jsonb_array_elements(v_edges) LOOP
    IF public._journey_node(p_graph, v_edge ->> 'from') IS NULL
       OR public._journey_node(p_graph, v_edge ->> 'to') IS NULL THEN
      v_errors := v_errors || jsonb_build_object('code', 'edge_dangling', 'nodeId', v_edge ->> 'from');
    END IF;
    IF v_edge ->> 'to' = v_trigger THEN
      v_errors := v_errors || jsonb_build_object('code', 'edge_into_trigger', 'nodeId', v_edge ->> 'from');
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT DISTINCT e ->> 'from', e ->> 'branch' FROM jsonb_array_elements(v_edges) e) x)
     <> jsonb_array_length(v_edges) THEN
    v_errors := v_errors || jsonb_build_object('code', 'edge_duplicate_branch');
  END IF;

  -- Gałęzie i parametry per typ.
  FOR v_node IN SELECT jsonb_array_elements(v_nodes) LOOP
    v_id := v_node ->> 'id';
    v_type := v_node ->> 'type';
    v_params := COALESCE(v_node -> 'params', '{}'::jsonb);
    v_required := CASE
      WHEN v_type IN ('goal', 'exit') THEN ARRAY[]::text[]
      WHEN v_type = 'ab_split' THEN ARRAY['A', 'B']
      WHEN v_type = 'if_else' THEN ARRAY['yes', 'no']
      WHEN v_type = 'wait' AND v_params ->> 'mode' = 'until_event' THEN ARRAY['event', 'timeout']
      ELSE ARRAY['next']
    END;
    v_branches := ARRAY(SELECT e ->> 'branch' FROM jsonb_array_elements(v_edges) e WHERE e ->> 'from' = v_id);
    IF NOT (v_branches <@ v_required AND v_required <@ v_branches) THEN
      v_errors := v_errors || jsonb_build_object('code', 'branches_incomplete', 'nodeId', v_id);
    END IF;

    CASE v_type
      WHEN 'wait' THEN
        IF v_params ->> 'mode' = 'duration' THEN
          IF NOT (public._journey_num(v_params -> 'minutes') BETWEEN 5 AND 525600) THEN
            v_errors := v_errors || jsonb_build_object('code', 'wait_minutes', 'nodeId', v_id);
          END IF;
        ELSIF v_params ->> 'mode' = 'until_time' THEN
          IF COALESCE(v_params ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             OR jsonb_typeof(v_params -> 'weekdays') <> 'array'
             OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_params -> 'weekdays') w
                         WHERE w !~ '^[1-7]$') THEN
            v_errors := v_errors || jsonb_build_object('code', 'wait_until_time', 'nodeId', v_id);
          END IF;
        ELSIF v_params ->> 'mode' = 'until_event' THEN
          IF COALESCE(v_params ->> 'eventType', '') !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$'
             OR NOT (public._journey_num(v_params -> 'timeoutMinutes') BETWEEN 5 AND 43200) THEN
            v_errors := v_errors || jsonb_build_object('code', 'wait_until_event', 'nodeId', v_id);
          END IF;
        ELSE
          v_errors := v_errors || jsonb_build_object('code', 'wait_mode', 'nodeId', v_id);
        END IF;
      WHEN 'ab_split' THEN
        IF public._journey_num(v_params -> 'weights' -> 'A') + public._journey_num(v_params -> 'weights' -> 'B') <> 100
           OR public._journey_num(v_params -> 'weights' -> 'A') NOT BETWEEN 0 AND 100 THEN
          v_errors := v_errors || jsonb_build_object('code', 'ab_weights', 'nodeId', v_id);
        END IF;
      WHEN 'if_else' THEN
        IF jsonb_typeof(v_params -> 'predicates') <> 'array' OR jsonb_array_length(v_params -> 'predicates') = 0 THEN
          v_errors := v_errors || jsonb_build_object('code', 'if_else_empty', 'nodeId', v_id);
        ELSE
          FOR v_pred IN SELECT jsonb_array_elements(v_params -> 'predicates') LOOP
            IF v_pred ->> 'kind' IN ('email_opened', 'email_clicked') AND NOT EXISTS (
              WITH RECURSIVE anc(node) AS (
                SELECT e ->> 'from' FROM jsonb_array_elements(v_edges) e WHERE e ->> 'to' = v_id
                UNION
                SELECT e ->> 'from' FROM jsonb_array_elements(v_edges) e JOIN anc a ON e ->> 'to' = a.node
              )
              SELECT 1 FROM anc a
               WHERE a.node = v_pred ->> 'nodeId'
                 AND public._journey_node(p_graph, a.node) ->> 'type' = 'send_email'
            ) THEN
              v_errors := v_errors || jsonb_build_object('code', 'predicate_not_ancestor_email', 'nodeId', v_id);
            END IF;
          END LOOP;
        END IF;
      WHEN 'send_email' THEN
        -- Maile windykacji należą do dunning.server.ts.
        IF p_trigger_event_type = 'billing_subscription.payment_failed.v1' THEN
          v_errors := v_errors || jsonb_build_object('code', 'email_on_payment_failed', 'nodeId', v_id);
        END IF;
      WHEN 'set_lifecycle_stage' THEN
        IF NOT (COALESCE(v_params ->> 'stage', '') = ANY (ARRAY[
          'subscriber', 'lead', 'registered', 'mql', 'sql', 'opportunity', 'other'])) THEN
          v_errors := v_errors || jsonb_build_object('code', 'lifecycle_stage', 'nodeId', v_id);
        END IF;
      WHEN 'set_crm_stage' THEN
        IF NOT (COALESCE(v_params ->> 'stage', '') = ANY (enum_range(NULL::public.crm_stage)::text[])) THEN
          v_errors := v_errors || jsonb_build_object('code', 'crm_stage', 'nodeId', v_id);
        END IF;
      WHEN 'create_crm_task' THEN
        IF char_length(btrim(COALESCE(v_params ->> 'title', ''))) NOT BETWEEN 1 AND 200
           OR char_length(COALESCE(v_params ->> 'description', '')) > 2000
           OR NOT (public._journey_num(v_params -> 'dueInDays') BETWEEN 0 AND 60) THEN
          v_errors := v_errors || jsonb_build_object('code', 'task_params', 'nodeId', v_id);
        END IF;
      WHEN 'add_tag', 'remove_tag' THEN
        -- 64 = CRM_TAG_MAX - ten sam limit co pisarz tagów `run_workflow_step`
        -- i panel CRM (I9b, Z-S5-02); dłuższy tag odrzucony, nigdy przycięty.
        IF char_length(btrim(COALESCE(v_params ->> 'tag', ''))) NOT BETWEEN 1 AND 64 THEN
          v_errors := v_errors || jsonb_build_object('code', 'tag_length', 'nodeId', v_id);
        END IF;
      WHEN 'newsletter_list' THEN
        IF COALESCE(v_params ->> 'op', '') NOT IN ('add', 'remove')
           OR COALESCE(v_params ->> 'listKey', '') !~ '^[A-Za-z0-9_-]{1,64}$' THEN
          v_errors := v_errors || jsonb_build_object('code', 'newsletter_list', 'nodeId', v_id);
        END IF;
      WHEN 'notify_staff' THEN
        IF char_length(btrim(COALESCE(v_params ->> 'message', ''))) NOT BETWEEN 1 AND 500 THEN
          v_errors := v_errors || jsonb_build_object('code', 'staff_message', 'nodeId', v_id);
        END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  -- DAG i osiągalność: Kahn od wyzwalacza (węzeł nieosiągalny albo w cyklu
  -- nie trafia do listy odwiedzonych).
  IF v_trigger IS NOT NULL THEN
    -- UNION (nie UNION ALL): wiersz = para (węzeł, głębokość), więc romby
    -- w DAG-u nie mnożą ścieżek wykładniczo; cykl rośnie w głąb ponad 60.
    WITH RECURSIVE walk(node, depth) AS (
      SELECT v_trigger, 0
      UNION
      SELECT e ->> 'to', w.depth + 1
        FROM walk w JOIN jsonb_array_elements(v_edges) e ON e ->> 'from' = w.node
       WHERE w.depth < 61
    )
    SELECT count(DISTINCT node), COALESCE(max(depth), 0) INTO v_visited, v_n FROM walk;
    IF v_n > 60 THEN
      v_errors := v_errors || jsonb_build_object('code', 'graph_cycle');
    ELSIF v_visited <> v_count THEN
      v_errors := v_errors || jsonb_build_object('code', 'node_unreachable');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'errors', v_errors);
END;
$$;

-- ACL jak w 20261020140200 (funkcja wewnętrzna - bez ról API).
REVOKE ALL ON FUNCTION public.journey_validate_graph(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
