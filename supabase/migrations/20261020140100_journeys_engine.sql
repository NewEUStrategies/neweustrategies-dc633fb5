-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S5, 2/6): ŚCIEŻKI KOMUNIKACJI - SILNIK
-- (POBRANIE Z DZIERŻAWĄ, WYKONANIE WĘZŁÓW, PONOWIENIA, ZDARZENIE STATYSTYK,
-- SPRZĄTANIE, WARSTWA KONTA).
--
-- DEFEKT
--   Zapisy na ścieżkę (20261020140000) nie mają wykonawcy: kontakt stoi na
--   węźle wyzwalacza na zawsze. Wykonawca wywoływany z dwóch powierzchni
--   (jobs-tick co minutę i ręczny tick admina) bez dzierżawy wykonałby ten
--   sam krok dwa razy - podwójne zadanie CRM, podwójny mail.
--
-- ZMIANA
--   A. `journey_claim_due(p_limit, p_lease_seconds)` (service_role) - zapisy
--      z `next_run_at <= now()`, `FOR UPDATE SKIP LOCKED`, dzierżawa
--      (`lock_token`, `locked_until`); najwyżej 20 zapisów na najemcę
--      (sprawiedliwość - jeden najemca z kampanią na 10 tys. kontaktów nie
--      zagłodzi pozostałych); pomija ścieżki nie-`active` (pauza)
--      i najemców z `journey_settings.enabled = false` - poza zapisami
--      testowymi (`is_test`), które admin uruchamia świadomie, zanim włączy
--      silnik (test na żywo).
--   B. `journey_advance(p_enrollment_id, p_lock_token, p_max_steps)`
--      (service_role) - wykonuje węzły bazy aż do `send_email` (oddaje
--      runnerowi), czekania albo końca. Każdy węzeł raz na zapis
--      (`UNIQUE (enrollment_id, node_id)`): powtórka po awarii odtwarza
--      wynik zapisany w `journey_step_runs`, nie wykonuje akcji drugi raz.
--      A/B: `abs(hashtextextended(zapis:węzeł)) % 100` - ten sam wariant przy
--      każdej powtórce. Akcje CRM idą przez wspólne `run_workflow_step`
--      (S4, `_source = 'journey'`, `origin_ref` = `journey:{zapis}:{węzeł}`),
--      cykl życia przez `crm_set_lifecycle_stage` (odmowa pierwszeństwa =
--      wynik `precedence`, nie błąd).
--   C. `journey_fail_step(…)` (service_role) - ponowienie z odstępem
--      `least(12 h, 1 min · 4^(próby-1))`, po 8 próbach krok `dead`, zapis
--      `failed` (powód `error`), ślad w `journey_engine_errors`.
--   D. `journey_tick_emit_stats(p_journey_ids, p_counts)` (service_role) -
--      `journey.stats_changed.v1` RAZ na ścieżkę na tick (agregat `journey`
--      - trasa szyny go pomija, więc zdarzenie nie wraca do silnika).
--   E. `journey_purge(p_older_than)` (service_role) - sprzątanie skrzynki
--      i dziennika błędów (wiersze przetworzone starsze niż okno).
--   F. `_membership_tier_for_user(p_tenant, p_user)` (wewnętrzna) - klucz
--      warstwy o najwyższej randze z tych samych trzech źródeł co
--      `user_tier_rank` (subskrypcja, nadanie, miejsce w organizacji).
--   Helpery wewnętrzne: `_journey_node`, `_journey_edge`, `_journey_next_time`
--   (czekanie do dnia tygodnia i godziny w strefie najemcy),
--   `_journey_exec_action` (akcje CRM, listy, powiadomienia personelu).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020140000 i po S4 (`run_workflow_step` v2,
-- `crm_set_lifecycle_stage`). `journey_eval_predicate` (if/else) powstaje
-- w 20261020140200 - rozwiązywana przy wykonaniu, a do publikacji pierwszej
-- ścieżki silnik nie ma czego wykonać.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/journeys_engine_test.sql (filtr wejścia, 3 polityki
-- ponownego wejścia, czekania, if/else, cel i wyjście, odstęp i `dead`,
-- sprawiedliwość, pauza, wyłączony silnik), supabase/tests/journeys_versions_ab_test.sql
-- (A/B deterministyczny, przypięcie do wersji, `stats_changed` raz na tick).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpery grafu (wewnętrzne).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_node(p_graph jsonb, p_node_id text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT n FROM jsonb_array_elements(COALESCE(p_graph -> 'nodes', '[]'::jsonb)) n
   WHERE n ->> 'id' = p_node_id
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._journey_edge(p_graph jsonb, p_from text, p_branch text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT e ->> 'to' FROM jsonb_array_elements(COALESCE(p_graph -> 'edges', '[]'::jsonb)) e
   WHERE e ->> 'from' = p_from AND e ->> 'branch' = p_branch
   LIMIT 1
$$;

-- Najbliższa chwila (> teraz) w dniu tygodnia z listy (ISO: 1 = poniedziałek)
-- o godzinie `HH:MM` czasu lokalnego strefy najemcy.
CREATE OR REPLACE FUNCTION public._journey_next_time(p_timezone text, p_weekdays integer[], p_time text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := COALESCE(NULLIF(p_timezone, ''), 'Europe/Warsaw');
  v_today date := (now() AT TIME ZONE v_tz)::date;
  v_at timestamptz;
  v_day date;
BEGIN
  FOR i IN 0..7 LOOP
    v_day := v_today + i;
    IF p_weekdays IS NULL OR cardinality(p_weekdays) = 0
       OR extract(isodow FROM v_day)::integer = ANY (p_weekdays) THEN
      v_at := (v_day + p_time::time) AT TIME ZONE v_tz;
      IF v_at > now() THEN
        RETURN v_at;
      END IF;
    END IF;
  END LOOP;
  RETURN now() + interval '7 days';
END;
$$;

REVOKE ALL ON FUNCTION public._journey_node(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._journey_edge(jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._journey_next_time(text, integer[], text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Warstwa konta (klucz o najwyższej randze).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._membership_tier_for_user(p_tenant uuid, p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH entitled AS (
    SELECT mt.key, mt.rank
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id AND ap.tenant_id = p_tenant
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = p_user AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.key, mt.rank
      FROM public.membership_grants mg
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.tenant_id = p_tenant AND mg.user_id = p_user AND mg.revoked_at IS NULL
       AND mg.starts_at <= now() AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.key, mt.rank
      FROM public.organization_seats os
      JOIN public.member_organizations mo ON mo.id = os.org_id AND mo.tenant_id = p_tenant
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
     WHERE os.user_id = p_user
       AND (os.status = 'active'
            OR (os.status = 'grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
       AND mo.status = 'active' AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  )
  SELECT e.key FROM entitled e ORDER BY e.rank DESC, e.key LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._membership_tier_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- A) Pobranie zapisów do wykonania (dzierżawa).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_claim_due(
  p_limit integer DEFAULT 50,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (enrollment_id uuid, lock_token uuid, tenant_id uuid, journey_id uuid, is_test boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Sufit najemcy na tick = JOURNEY_ENGINE_LIMITS.enrollmentsPerTenantPerTick.
  c_per_tenant constant integer := 20;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
  v_lease interval := make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 10), 900));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id, e.tenant_id, e.next_run_at
      FROM public.journey_enrollments e
      JOIN public.journey_definitions d ON d.tenant_id = e.tenant_id AND d.id = e.journey_id
      LEFT JOIN public.journey_settings s ON s.tenant_id = e.tenant_id
     WHERE e.status IN ('active', 'waiting')
       AND e.next_run_at <= now()
       AND (e.locked_until IS NULL OR e.locked_until < now())
       AND (e.is_test OR (COALESCE(s.enabled, false) AND d.status = 'active'))
     ORDER BY e.next_run_at
     LIMIT v_limit * 5
     FOR UPDATE OF e SKIP LOCKED
  ),
  fair AS (
    SELECT c.id,
           row_number() OVER (PARTITION BY c.tenant_id ORDER BY c.next_run_at) AS rn,
           c.next_run_at
      FROM candidates c
  ),
  picked AS (
    SELECT f.id FROM fair f WHERE f.rn <= c_per_tenant ORDER BY f.next_run_at LIMIT v_limit
  )
  UPDATE public.journey_enrollments e
     SET lock_token = gen_random_uuid(), locked_until = now() + v_lease
    FROM picked p
   WHERE e.id = p.id
  RETURNING e.id, e.lock_token, e.tenant_id, e.journey_id, e.is_test;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_claim_due(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_claim_due(integer, integer) TO service_role;

COMMENT ON FUNCTION public.journey_claim_due(integer, integer) IS
  'Hub S5: zapisy do wykonania z dzierżawą (FOR UPDATE SKIP LOCKED, ≤ 20 na najemcę, pomija pauzę i wyłączony silnik poza zapisami testowymi). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- C) Ponowienie kroku.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_fail_step(
  p_enrollment_id uuid,
  p_lock_token uuid,
  p_node_id text,
  p_error text,
  p_phase text DEFAULT 'advance'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Martwy krok po 8 próbach (SPEC §5.6 pkt 6).
  c_max_attempts constant integer := 8;
  v_e public.journey_enrollments%ROWTYPE;
  v_node jsonb;
  v_attempts integer;
  v_next timestamptz;
BEGIN
  SELECT * INTO v_e FROM public.journey_enrollments WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND OR v_e.lock_token IS DISTINCT FROM p_lock_token THEN
    RETURN jsonb_build_object('status', 'lost_lock', 'enrollment_id', p_enrollment_id);
  END IF;

  SELECT public._journey_node(v.graph, p_node_id) INTO v_node
    FROM public.journey_versions v WHERE v.id = v_e.version_id;

  INSERT INTO public.journey_step_runs (
    tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status
  ) VALUES (
    v_e.tenant_id, v_e.id, v_e.journey_id, v_e.version_id, p_node_id,
    COALESCE(v_node ->> 'type', 'unknown'), 'running'
  )
  ON CONFLICT (enrollment_id, node_id) DO NOTHING;

  UPDATE public.journey_step_runs sr
     SET attempts = sr.attempts + 1,
         status = CASE WHEN sr.attempts + 1 >= c_max_attempts THEN 'dead' ELSE 'failed' END,
         error = left(COALESCE(p_error, 'error'), 2000),
         -- least(12 h, 1 min · 4^(próba-1)): 1, 4, 16, 64, 256 min, potem 12 h.
         next_attempt_at = now() + LEAST(interval '12 hours', interval '1 minute' * power(4, sr.attempts)),
         finished_at = CASE WHEN sr.attempts + 1 >= c_max_attempts THEN now() END
   WHERE sr.enrollment_id = v_e.id AND sr.node_id = p_node_id
  RETURNING sr.attempts, sr.next_attempt_at INTO v_attempts, v_next;

  INSERT INTO public.journey_engine_errors (tenant_id, phase, journey_id, enrollment_id, node_id, error)
  VALUES (
    v_e.tenant_id,
    CASE WHEN p_phase IN ('route', 'ingest', 'advance', 'email', 'tracking') THEN p_phase ELSE 'advance' END,
    v_e.journey_id, v_e.id, p_node_id, left(COALESCE(p_error, 'error'), 2000)
  );

  IF v_attempts >= c_max_attempts THEN
    UPDATE public.journey_enrollments
       SET status = 'failed', exit_reason = 'error', finished_at = now(),
           next_run_at = NULL, lock_token = NULL, locked_until = NULL
     WHERE id = v_e.id;
    RETURN jsonb_build_object('status', 'dead', 'attempts', v_attempts, 'journey_id', v_e.journey_id);
  END IF;

  UPDATE public.journey_enrollments
     SET next_run_at = v_next, lock_token = NULL, locked_until = NULL
   WHERE id = v_e.id;
  RETURN jsonb_build_object('status', 'retry', 'attempts', v_attempts, 'next_attempt_at', v_next,
                            'journey_id', v_e.journey_id);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_fail_step(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_fail_step(uuid, uuid, text, text, text) TO service_role;

-- ----------------------------------------------------------------------------
-- Akcje węzłów (wewnętrzne): CRM, listy newslettera, powiadomienia personelu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_exec_action(p_e public.journey_enrollments, p_node jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type text := p_node ->> 'type';
  v_node_id text := p_node ->> 'id';
  v_params jsonb := COALESCE(p_node -> 'params', '{}'::jsonb);
  v_ev public.domain_events;
  v_res jsonb;
  v_stage text;
  v_current public.crm_stage;
  v_lead record;
  v_recipient uuid;
  v_step jsonb;
  v_marker jsonb := jsonb_build_object(
    '_source', 'journey', '_journey_id', p_e.journey_id, '_enrollment_id', p_e.id);
BEGIN
  -- Zdarzenie wyzwalacza z leadem ZAPISU jako agregatem: akcja CRM trafia
  -- w kontakt ścieżki, a nie w to, co da się wyczytać z ładunku.
  v_ev := jsonb_populate_record(NULL::public.domain_events,
    COALESCE(p_e.trigger_snapshot, '{}'::jsonb) || jsonb_build_object(
      'id', COALESCE(p_e.trigger_event_id, p_e.id),
      'tenant_id', p_e.tenant_id,
      'aggregate_type', 'crm_lead',
      'aggregate_id', p_e.lead_id::text,
      'event_type', COALESCE(p_e.trigger_event_type, 'journey.step.v1'),
      'payload', COALESCE(p_e.trigger_snapshot -> 'payload', '{}'::jsonb)
                 || jsonb_build_object('lead_id', p_e.lead_id),
      'created_at', now()));

  SELECT l.id, l.owner_id, l.email_norm, l.stage INTO v_lead
    FROM public.crm_leads l WHERE l.id = p_e.lead_id;

  CASE v_type
    WHEN 'set_lifecycle_stage' THEN
      PERFORM set_config('app.change_journey_id', p_e.journey_id::text, true);
      PERFORM set_config('app.change_enrollment_id', p_e.id::text, true);
      v_res := public.crm_set_lifecycle_stage(p_e.lead_id, v_params ->> 'stage', 'journey', false);
      PERFORM set_config('app.change_journey_id', '', true);
      PERFORM set_config('app.change_enrollment_id', '', true);
      -- Płatność i człowiek mają pierwszeństwo: odmowa to wynik kroku.
      IF v_res ->> 'skipped' IN ('precedence', 'billing_owned', 'backward') THEN
        RETURN 'precedence';
      END IF;
      RETURN 'next';

    WHEN 'set_crm_stage' THEN
      v_stage := v_params ->> 'stage';
      v_current := v_lead.stage;
      IF COALESCE((v_params ->> 'onlyForward')::boolean, true)
         AND v_current IS NOT NULL AND v_current >= v_stage::public.crm_stage THEN
        RETURN 'skipped';
      END IF;
      v_step := jsonb_build_object('action', 'set_crm_stage',
        'params', jsonb_build_object('stage', v_stage) || v_marker);

    WHEN 'create_crm_task' THEN
      v_step := jsonb_build_object('action', 'create_crm_task', 'params',
        jsonb_strip_nulls(jsonb_build_object(
          'title', v_params ->> 'title',
          'note', v_params ->> 'description',
          'due_days', COALESCE((v_params ->> 'dueInDays')::integer, 3),
          'assignee_id', CASE WHEN v_params -> 'assignee' ->> 'mode' = 'user'
                              THEN v_params -> 'assignee' ->> 'userId' END,
          -- Idempotencja zadania: powtórka kroku nie dubluje zadania.
          'origin_ref', 'journey:' || p_e.id::text || ':' || v_node_id
        )) || v_marker);

    WHEN 'add_tag', 'remove_tag' THEN
      v_step := jsonb_build_object('action', v_type,
        'params', jsonb_build_object('tag', v_params ->> 'tag') || v_marker);

    WHEN 'newsletter_list' THEN
      -- Krok nigdy nie zakłada subskrybenta (zgoda!) - bez niego pomijamy.
      IF NOT EXISTS (
        SELECT 1 FROM public.newsletter_subscribers s
         WHERE s.tenant_id = p_e.tenant_id AND lower(s.email) = v_lead.email_norm
      ) THEN
        RETURN 'skipped';
      END IF;
      v_step := jsonb_build_object(
        'action', CASE WHEN v_params ->> 'op' = 'remove' THEN 'newsletter_list_remove' ELSE 'newsletter_list_add' END,
        'params', jsonb_build_object('list_key', v_params ->> 'listKey') || v_marker);

    WHEN 'notify_staff' THEN
      FOR v_recipient IN
        SELECT DISTINCT r.user_id FROM (
          SELECT COALESCE(v_lead.owner_id, s.default_task_assignee_id) AS user_id
            FROM (SELECT 1) one
            LEFT JOIN public.journey_settings s ON s.tenant_id = p_e.tenant_id
           WHERE v_params ->> 'recipients' = 'owner'
          UNION ALL
          SELECT ur.user_id FROM public.user_roles ur
           WHERE v_params ->> 'recipients' = 'admins'
             AND ur.tenant_id = p_e.tenant_id AND ur.role::text = 'admin'
          UNION ALL
          SELECT ur.user_id FROM public.user_roles ur
           WHERE jsonb_typeof(v_params -> 'recipients') = 'object'
             AND ur.tenant_id = p_e.tenant_id
             AND ur.role::text IN ('admin', 'editor', 'super_admin')
             AND ur.user_id::text IN (
               SELECT jsonb_array_elements_text(v_params -> 'recipients' -> 'userIds'))
        ) r
        -- Wyłącznie personel CRM najemcy - nigdy kontakt ani obcy najemca.
        WHERE r.user_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.user_roles ur2
           WHERE ur2.user_id = r.user_id AND ur2.tenant_id = p_e.tenant_id
             AND ur2.role::text IN ('admin', 'editor', 'super_admin'))
      LOOP
        PERFORM public.enqueue_notification(
          v_recipient, 'crm_task', v_params ->> 'message', v_params ->> 'message',
          NULL, NULL, '/admin/crm/leads/' || p_e.lead_id::text, NULL);
      END LOOP;
      RETURN 'next';

    ELSE
      RAISE EXCEPTION 'journey: unknown action node type %', v_type USING ERRCODE = '22023';
  END CASE;

  PERFORM public.run_workflow_step(v_ev, v_step);
  RETURN 'next';
END;
$$;

REVOKE ALL ON FUNCTION public._journey_exec_action(public.journey_enrollments, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Wykonanie zapisu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_advance(
  p_enrollment_id uuid,
  p_lock_token uuid,
  p_max_steps integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_e public.journey_enrollments%ROWTYPE;
  v_graph jsonb;
  v_category text;
  v_tz text;
  v_node jsonb;
  v_node_id text;
  v_type text;
  v_params jsonb;
  v_run public.journey_step_runs%ROWTYPE;
  v_outcome text;
  v_next text;
  v_until timestamptz;
  v_mode text;
  v_bucket integer;
  v_hits integer;
  v_total integer;
  v_steps integer := 0;
  v_max integer := LEAST(GREATEST(COALESCE(p_max_steps, 25), 1), 100);
  v_base jsonb;
BEGIN
  SELECT * INTO v_e FROM public.journey_enrollments WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND OR v_e.lock_token IS DISTINCT FROM p_lock_token
     OR v_e.locked_until IS NULL OR v_e.locked_until < now() THEN
    RETURN jsonb_build_object('status', 'lost_lock', 'enrollment_id', p_enrollment_id);
  END IF;
  v_base := jsonb_build_object('enrollment_id', v_e.id, 'journey_id', v_e.journey_id,
                               'tenant_id', v_e.tenant_id, 'is_test', v_e.is_test);
  IF v_e.status NOT IN ('active', 'waiting') THEN
    UPDATE public.journey_enrollments SET lock_token = NULL, locked_until = NULL WHERE id = v_e.id;
    RETURN v_base || jsonb_build_object('status', v_e.status, 'steps', 0);
  END IF;

  SELECT v.graph, d.category INTO v_graph, v_category
    FROM public.journey_versions v
    JOIN public.journey_definitions d ON d.tenant_id = v.tenant_id AND d.id = v.journey_id
   WHERE v.id = v_e.version_id;
  SELECT COALESCE(MAX(s.timezone), 'Europe/Warsaw') INTO v_tz
    FROM public.journey_settings s WHERE s.tenant_id = v_e.tenant_id;
  v_base := v_base || jsonb_build_object('category', v_category);

  LOOP
    IF v_steps >= v_max THEN
      -- Bezpiecznik: długi łańcuch akcji dokończy następny tick.
      UPDATE public.journey_enrollments
         SET next_run_at = now(), lock_token = NULL, locked_until = NULL
       WHERE id = v_e.id;
      RETURN v_base || jsonb_build_object('status', 'yield', 'steps', v_steps);
    END IF;
    v_steps := v_steps + 1;

    v_node_id := v_e.current_node_id;
    v_node := public._journey_node(v_graph, v_node_id);
    IF v_node IS NULL THEN
      UPDATE public.journey_enrollments
         SET status = 'failed', exit_reason = 'error', finished_at = now(),
             next_run_at = NULL, lock_token = NULL, locked_until = NULL
       WHERE id = v_e.id;
      INSERT INTO public.journey_engine_errors (tenant_id, phase, journey_id, enrollment_id, node_id, error)
      VALUES (v_e.tenant_id, 'advance', v_e.journey_id, v_e.id, v_node_id, 'node_not_found');
      RETURN v_base || jsonb_build_object('status', 'failed', 'steps', v_steps);
    END IF;
    v_type := v_node ->> 'type';
    v_params := COALESCE(v_node -> 'params', '{}'::jsonb);

    -- Węzeł raz na zapis: istniejący przebieg = powtórka, nie nowe wykonanie.
    INSERT INTO public.journey_step_runs (
      tenant_id, enrollment_id, journey_id, version_id, node_id, node_type, status
    ) VALUES (
      v_e.tenant_id, v_e.id, v_e.journey_id, v_e.version_id, v_node_id, v_type, 'running'
    )
    ON CONFLICT (enrollment_id, node_id) DO NOTHING;
    SELECT * INTO v_run FROM public.journey_step_runs
     WHERE enrollment_id = v_e.id AND node_id = v_node_id;

    IF v_run.status = 'dead' THEN
      UPDATE public.journey_enrollments
         SET status = 'failed', exit_reason = 'error', finished_at = now(),
             next_run_at = NULL, lock_token = NULL, locked_until = NULL
       WHERE id = v_e.id;
      RETURN v_base || jsonb_build_object('status', 'failed', 'steps', v_steps);
    END IF;

    IF v_run.status IN ('succeeded', 'skipped') THEN
      v_outcome := v_run.outcome;
    ELSE
      v_outcome := NULL;
      CASE v_type
        WHEN 'trigger', 'goal', 'exit' THEN
          v_outcome := 'next';

        WHEN 'wait' THEN
          v_mode := v_params ->> 'mode';
          IF NOT (v_run.detail ? 'until') THEN
            v_until := CASE v_mode
              WHEN 'duration' THEN now() + make_interval(mins => (v_params ->> 'minutes')::integer)
              WHEN 'until_time' THEN public._journey_next_time(
                v_tz,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_params -> 'weekdays', '[]'::jsonb))::integer),
                v_params ->> 'time')
              WHEN 'until_event' THEN now() + make_interval(mins => (v_params ->> 'timeoutMinutes')::integer)
            END;
            IF v_until IS NULL THEN
              RAISE EXCEPTION 'journey: invalid wait params on %', v_node_id USING ERRCODE = '22023';
            END IF;
            UPDATE public.journey_step_runs
               SET detail = detail || jsonb_build_object('until', v_until, 'mode', v_mode)
             WHERE id = v_run.id;
            UPDATE public.journey_enrollments
               SET status = 'waiting', next_run_at = v_until,
                   wait_event_type = CASE WHEN v_mode = 'until_event' THEN v_params ->> 'eventType' END,
                   wait_condition = CASE WHEN v_mode = 'until_event'
                                         THEN COALESCE(v_params -> 'condition', '{}'::jsonb) END,
                   wait_deadline = CASE WHEN v_mode = 'until_event' THEN v_until END,
                   lock_token = NULL, locked_until = NULL
             WHERE id = v_e.id;
            RETURN v_base || jsonb_build_object('status', 'waiting', 'until', v_until, 'steps', v_steps);
          END IF;
          v_until := (v_run.detail ->> 'until')::timestamptz;
          IF now() < v_until THEN
            UPDATE public.journey_enrollments
               SET status = 'waiting', next_run_at = v_until, lock_token = NULL, locked_until = NULL
             WHERE id = v_e.id;
            RETURN v_base || jsonb_build_object('status', 'waiting', 'until', v_until, 'steps', v_steps);
          END IF;
          v_outcome := CASE WHEN v_mode = 'until_event' THEN 'timeout' ELSE 'next' END;

        WHEN 'send_email' THEN
          -- Mail składa runner (TS): zapis zostaje pod dzierżawą, krok `running`.
          UPDATE public.journey_enrollments
             SET status = 'active', wait_event_type = NULL, wait_condition = NULL, wait_deadline = NULL
           WHERE id = v_e.id;
          RETURN v_base || jsonb_build_object(
            'status', 'email', 'node_id', v_node_id, 'lock_token', p_lock_token, 'steps', v_steps);

        WHEN 'ab_split' THEN
          -- Deterministyczny kubełek: ten sam wariant przy każdej powtórce.
          v_bucket := abs(hashtextextended(v_e.id::text || ':' || v_node_id, 0)) % 100;
          v_outcome := CASE WHEN v_bucket < COALESCE((v_params -> 'weights' ->> 'A')::integer, 50)
                            THEN 'A' ELSE 'B' END;
          UPDATE public.journey_step_runs
             SET detail = detail || jsonb_build_object('bucket', v_bucket)
           WHERE id = v_run.id;

        WHEN 'if_else' THEN
          SELECT count(*) FILTER (WHERE public.journey_eval_predicate(v_e.id, p)), count(*)
            INTO v_hits, v_total
            FROM jsonb_array_elements(COALESCE(v_params -> 'predicates', '[]'::jsonb)) p;
          v_outcome := CASE
            WHEN v_params ->> 'match' = 'any' THEN CASE WHEN v_hits > 0 THEN 'yes' ELSE 'no' END
            ELSE CASE WHEN v_hits = v_total AND v_total > 0 THEN 'yes' ELSE 'no' END
          END;

        ELSE
          BEGIN
            v_outcome := public._journey_exec_action(v_e, v_node);
          EXCEPTION WHEN OTHERS THEN
            -- Podtransakcja akcji wycofana; ponowienie z odstępem.
            RETURN v_base || public.journey_fail_step(
              v_e.id, p_lock_token, v_node_id, SQLSTATE || ': ' || SQLERRM, 'advance')
              || jsonb_build_object('steps', v_steps);
          END;
      END CASE;

      UPDATE public.journey_step_runs
         SET status = CASE WHEN v_outcome IN ('precedence', 'skipped') THEN 'skipped' ELSE 'succeeded' END,
             outcome = v_outcome,
             attempts = attempts + 1,
             finished_at = now(),
             error = NULL
       WHERE id = v_run.id;
    END IF;

    IF v_type = 'goal' THEN
      UPDATE public.journey_enrollments
         SET status = 'goal_reached', exit_reason = 'goal', finished_at = now(),
             next_run_at = NULL, lock_token = NULL, locked_until = NULL
       WHERE id = v_e.id;
      RETURN v_base || jsonb_build_object('status', 'goal_reached', 'steps', v_steps);
    END IF;
    v_next := public._journey_edge(v_graph, v_node_id, v_outcome);
    IF v_type = 'exit' OR v_next IS NULL THEN
      UPDATE public.journey_enrollments
         SET status = 'completed', exit_reason = 'completed', finished_at = now(),
             next_run_at = NULL, lock_token = NULL, locked_until = NULL
       WHERE id = v_e.id;
      RETURN v_base || jsonb_build_object('status', 'completed', 'steps', v_steps);
    END IF;

    UPDATE public.journey_enrollments
       SET current_node_id = v_next, status = 'active',
           wait_event_type = NULL, wait_condition = NULL, wait_deadline = NULL
     WHERE id = v_e.id;
    v_e.current_node_id := v_next;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_advance(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_advance(uuid, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.journey_advance(uuid, uuid, integer) IS
  'Hub S5: wykonanie zapisu pod dzierżawą - węzły bazy aż do send_email (status email, oddaje runnerowi), czekania albo końca; węzeł raz na zapis (powtórka odtwarza wynik). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- D) Zdarzenie statystyk - raz na ścieżkę na tick.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_tick_emit_stats(
  p_journey_ids uuid[],
  p_counts jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_journey record;
  v_counts jsonb;
  v_emitted integer := 0;
BEGIN
  FOR v_journey IN
    SELECT d.id, d.tenant_id
      FROM public.journey_definitions d
     WHERE d.id IN (SELECT DISTINCT unnest(COALESCE(p_journey_ids, ARRAY[]::uuid[])))
     ORDER BY d.id
  LOOP
    v_counts := COALESCE(p_counts -> v_journey.id::text, '{}'::jsonb);
    PERFORM public.emit_domain_event(
      v_journey.tenant_id, 'journey', v_journey.id::text, 'journey.stats_changed.v1',
      jsonb_build_object(
        'journey_id', v_journey.id,
        'enrolled', COALESCE((v_counts ->> 'enrolled')::integer, 0),
        'advanced', COALESCE((v_counts ->> 'advanced')::integer, 0),
        'finished', COALESCE((v_counts ->> 'finished')::integer, 0),
        'emails_queued', COALESCE((v_counts ->> 'emails_queued')::integer, 0)
      ),
      NULL, p_suppress_actor => true);
    v_emitted := v_emitted + 1;
  END LOOP;
  RETURN v_emitted;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_tick_emit_stats(uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_tick_emit_stats(uuid[], jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- E) Sprzątanie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_purge(p_older_than interval DEFAULT interval '30 days')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Krócej niż tydzień = skrzynka bez śladu do diagnozy wczorajszej awarii.
  v_window interval := GREATEST(COALESCE(p_older_than, interval '30 days'), interval '7 days');
  v_inbox integer;
  v_errors integer;
BEGIN
  DELETE FROM public.journey_event_inbox i
   WHERE i.processed_at IS NOT NULL AND i.processed_at < now() - v_window;
  GET DIAGNOSTICS v_inbox = ROW_COUNT;
  DELETE FROM public.journey_engine_errors x
   WHERE x.created_at < now() - GREATEST(v_window, interval '90 days');
  GET DIAGNOSTICS v_errors = ROW_COUNT;
  RETURN jsonb_build_object('inbox', v_inbox, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_purge(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_purge(interval) TO service_role;
