-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S5, 5/6): ŚCIEŻKI KOMUNIKACJI - NARZĘDZIA ADMINA
-- (TEST NA ŻYWO, POMINIĘCIE CZEKANIA, WYJŚCIE KONTAKTU, SZACUNEK ZASIĘGU,
-- SYMULACJA, ZDROWIE SILNIKA).
--
-- DEFEKT
--   Bez narzędzi admin nie sprawdzi ścieżki przed włączeniem silnika
--   (decyzja wdrożeniowa M3: włączenie u NES dopiero po teście na żywo
--   `welcome_onboarding` i `abandoned_checkout`), nie wyjmie kontaktu, który
--   prosi o koniec maili, i nie zobaczy, czy silnik w ogóle chodzi - stan
--   silnika byłby widoczny tylko z bazy.
--
-- ZMIANA (najemca z sesji; bramka `_journey_staff_tenant`)
--   A. `admin_journey_enroll_test(p_journey_id)` (admin|editor) - zapis
--      testowy WŁASNEGO kontaktu wywołującego (`crm_leads.user_id =
--      auth.uid()`), z pominięciem filtru wejścia i polityki ponownego
--      wejścia; działa przy WYŁĄCZONYM silniku (test przed włączeniem),
--      maile idą jako `journey_test` (tylko blokady techniczne). Zapis
--      testowy jest poza licznikami listy i statystyk.
--   B. `admin_journey_enrollment_skip_wait(p_enrollment_id)` (admin) -
--      czekanie kończy się teraz (gałąź `next`, przy `until_event` -
--      `timeout`); służy testowi na żywo i ręcznemu przyspieszeniu.
--   C. `admin_journey_enrollment_exit(p_enrollment_id)` (admin|editor) -
--      wyjście kontaktu z powodem `manual`.
--   D. `admin_journey_trigger_estimate(p_event_type, p_condition, p_days)`
--      (admin|editor) - ile zdarzeń i kontaktów dałby wyzwalacz w ostatnich
--      N dniach (`payload @> condition`).
--   E. `admin_journey_simulate(p_journey_id, p_lead_id, p_draft)`
--      (admin|editor) - przejście grafu dla kontaktu BEZ ZAPISU: zero wierszy
--      w `journey_*`, `email_send_log`, `crm_*` (same odczyty); warunki
--      z historią zapisu (otwarcia, kliknięcia, zdarzenia od wejścia)
--      w symulacji są fałszem z adnotacją.
--   F. `admin_journey_engine_health()` (admin|editor) - stan silnika
--      najemcy: przełącznik, skrzynka (zaległość, najstarsze), zapisy do
--      wykonania, czekające, martwe kroki i błędy 24 h per faza, ostatnie
--      błędy, ostatnie przetworzenie. Awaryjny wyłącznik środowiska
--      (`JOURNEYS_ENGINE_DISABLED`) dokłada server fn - SQL go nie widzi.
--   G. `_journey_send_verdict(…)` (wewnętrzna) - werdykt bramki maila bez
--      zapisu (symulacja), te same reguły co `journey_can_send`.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020140300 (bramka roli) i 20261020140200
-- (warunki, zgody, walidacja grafu).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/journeys_admin_rpc_test.sql (`enroll_test` tylko
-- własny kontakt, `simulate` bez wierszy w journey_*/email_send_log/crm_*,
-- `trigger_estimate`, zdrowie silnika, izolacja najemców).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- G) Werdykt bramki maila bez zapisu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_send_verdict(p_tenant uuid, p_lead uuid, p_category text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_reason text;
  v_consent text;
BEGIN
  SELECT l.email_norm INTO v_email FROM public.crm_leads l WHERE l.id = p_lead AND l.tenant_id = p_tenant;
  IF v_email IS NULL THEN
    RETURN 'no_consent';
  END IF;
  SELECT es.reason INTO v_reason FROM public.email_suppressions es
   WHERE es.tenant_id = p_tenant AND es.email_norm = v_email
     AND es.released_at IS NULL AND (es.expires_at IS NULL OR es.expires_at > now())
     AND (p_category = 'marketing' OR es.reason NOT IN ('unsubscribe', 'soft_bounce'))
   ORDER BY (es.reason = 'unsubscribe') DESC LIMIT 1;
  IF v_reason IS NOT NULL THEN
    RETURN CASE WHEN v_reason = 'unsubscribe' THEN 'unsubscribed' ELSE 'suppressed' END;
  END IF;
  IF p_category = 'service' THEN
    RETURN 'ok';
  END IF;
  v_consent := public._journey_marketing_consent(p_tenant, p_lead);
  RETURN v_consent;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_send_verdict(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- A) Test na żywo - własny kontakt.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_enroll_test(p_journey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_uid uuid := auth.uid();
  v_def record;
  v_lead uuid;
  v_id uuid;
BEGIN
  SELECT d.id, d.status, d.published_version_id, v.trigger_event_type INTO v_def
    FROM public.journey_definitions d
    LEFT JOIN public.journey_versions v ON v.id = d.published_version_id
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_def.published_version_id IS NULL OR v_def.status = 'archived' THEN
    RAISE EXCEPTION 'not_published' USING ERRCODE = '22023';
  END IF;
  -- Wyłącznie WŁASNY kontakt - test nie może wysłać maila cudzej osobie.
  SELECT l.id INTO v_lead FROM public.crm_leads l WHERE l.tenant_id = v_tenant AND l.user_id = v_uid;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'own_lead_missing' USING ERRCODE = 'P0002';
  END IF;
  -- Poprzedni test tej ścieżki kończy się, zanim zacznie się nowy.
  UPDATE public.journey_enrollments e
     SET status = 'exited', exit_reason = 'manual', finished_at = now(),
         next_run_at = NULL, lock_token = NULL, locked_until = NULL
   WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND e.lead_id = v_lead
     AND e.is_test AND e.status IN ('active', 'waiting');

  v_id := public._journey_enroll(
    v_tenant, p_journey_id, v_def.published_version_id, v_lead,
    jsonb_build_object('event_type', v_def.trigger_event_type,
                       'payload', jsonb_build_object('user_id', v_uid, 'test', true)),
    true);
  IF v_id IS NULL THEN
    -- Prawdziwy zapis tego kontaktu trwa (jeden aktywny na ścieżkę i lead).
    RAISE EXCEPTION 'already_enrolled' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object('enrollment_id', v_id, 'lead_id', v_lead);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_enroll_test(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_enroll_test(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Pominięcie czekania.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_enrollment_skip_wait(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(true);
  v_e public.journey_enrollments%ROWTYPE;
  v_mode text;
BEGIN
  SELECT * INTO v_e FROM public.journey_enrollments e
   WHERE e.id = p_enrollment_id AND e.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_e.status <> 'waiting' THEN
    RAISE EXCEPTION 'not_waiting' USING ERRCODE = '22023';
  END IF;
  SELECT sr.detail ->> 'mode' INTO v_mode FROM public.journey_step_runs sr
   WHERE sr.enrollment_id = v_e.id AND sr.node_id = v_e.current_node_id;
  UPDATE public.journey_step_runs sr
     SET status = 'succeeded',
         outcome = CASE WHEN v_mode = 'until_event' THEN 'timeout' ELSE 'next' END,
         finished_at = now(),
         detail = sr.detail || jsonb_build_object('skipped_by', auth.uid())
   WHERE sr.enrollment_id = v_e.id AND sr.node_id = v_e.current_node_id AND sr.status = 'running';
  UPDATE public.journey_enrollments
     SET status = 'active', next_run_at = now(),
         wait_event_type = NULL, wait_condition = NULL, wait_deadline = NULL
   WHERE id = v_e.id;
  RETURN jsonb_build_object('enrollment_id', v_e.id, 'status', 'active');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_enrollment_skip_wait(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_enrollment_skip_wait(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Wyjście kontaktu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_enrollment_exit(p_enrollment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_n integer;
  v_journey uuid;
BEGIN
  UPDATE public.journey_enrollments e
     SET status = 'exited', exit_reason = 'manual', finished_at = now(),
         next_run_at = NULL, lock_token = NULL, locked_until = NULL
   WHERE e.id = p_enrollment_id AND e.tenant_id = v_tenant AND e.status IN ('active', 'waiting')
  RETURNING e.journey_id INTO v_journey;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.journey_enrollments e WHERE e.id = p_enrollment_id AND e.tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'enrollment_not_found' USING ERRCODE = 'P0002';
    END IF;
    RETURN jsonb_build_object('enrollment_id', p_enrollment_id, 'exited', false);
  END IF;
  PERFORM public.emit_domain_event(v_tenant, 'journey', v_journey::text, 'journey.stats_changed.v1',
    jsonb_build_object('journey_id', v_journey, 'enrolled', 0, 'advanced', 0, 'finished', 1, 'emails_queued', 0),
    NULL, p_suppress_actor => true);
  RETURN jsonb_build_object('enrollment_id', p_enrollment_id, 'exited', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_enrollment_exit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_enrollment_exit(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Szacunek zasięgu wyzwalacza.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_trigger_estimate(
  p_event_type text,
  p_condition jsonb DEFAULT '{}'::jsonb,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 90);
  v_events bigint;
  v_contacts bigint;
BEGIN
  IF p_event_type IS NULL OR p_event_type !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$' THEN
    RAISE EXCEPTION 'event_type_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_condition IS NOT NULL AND jsonb_typeof(p_condition) <> 'object' THEN
    RAISE EXCEPTION 'condition_invalid' USING ERRCODE = '22023';
  END IF;
  -- Kontakt w przybliżeniu: konto, osoba, lead albo agregat (bez rozwiązywania
  -- adresów - szacunek nie może kosztować tyle co ingest).
  SELECT count(*),
         count(DISTINCT COALESCE(de.payload ->> 'user_id', de.payload ->> 'person_id',
                                 de.payload ->> 'lead_id', de.aggregate_type || ':' || de.aggregate_id))
    INTO v_events, v_contacts
    FROM public.domain_events de
   WHERE de.tenant_id = v_tenant AND de.event_type = p_event_type
     AND de.created_at > now() - make_interval(days => v_days)
     AND de.payload @> COALESCE(p_condition, '{}'::jsonb);
  RETURN jsonb_build_object('event_type', p_event_type, 'days', v_days,
                            'events', v_events, 'contacts', v_contacts);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_trigger_estimate(text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_trigger_estimate(text, jsonb, integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Symulacja bez zapisu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_simulate(
  p_journey_id uuid,
  p_lead_id uuid,
  p_draft jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_def record;
  v_lead record;
  v_graph jsonb;
  v_settings jsonb;
  v_trigger text;
  v_check jsonb;
  v_node jsonb;
  v_id text;
  v_type text;
  v_params jsonb;
  v_outcome text;
  v_note text;
  v_path jsonb := '[]'::jsonb;
  v_emails jsonb := '[]'::jsonb;
  v_hits integer;
  v_total integer;
  v_bucket integer;
  v_steps integer := 0;
  v_end text;
BEGIN
  SELECT d.id, d.category, d.draft, v.graph AS published_graph, v.trigger_event_type
    INTO v_def
    FROM public.journey_definitions d
    LEFT JOIN public.journey_versions v ON v.id = d.published_version_id
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT l.id, l.user_id INTO v_lead FROM public.crm_leads l WHERE l.id = p_lead_id AND l.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_settings := COALESCE(p_draft -> 'settings', v_def.draft -> 'settings', '{}'::jsonb);
  v_graph := COALESCE(p_draft -> 'graph', v_def.published_graph, v_def.draft -> 'graph');
  v_trigger := COALESCE(v_settings ->> 'triggerEventType', v_def.trigger_event_type);
  v_check := public.journey_validate_graph(v_graph, v_trigger);
  IF NOT (v_check ->> 'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'errors', v_check -> 'errors', 'path', '[]'::jsonb, 'emails', '[]'::jsonb);
  END IF;

  SELECT n ->> 'id' INTO v_id FROM jsonb_array_elements(v_graph -> 'nodes') n WHERE n ->> 'type' = 'trigger' LIMIT 1;
  WHILE v_id IS NOT NULL AND v_steps < 61 LOOP
    v_steps := v_steps + 1;
    v_node := public._journey_node(v_graph, v_id);
    v_type := v_node ->> 'type';
    v_params := COALESCE(v_node -> 'params', '{}'::jsonb);
    v_note := NULL;
    CASE v_type
      WHEN 'wait' THEN
        -- Czekanie na zdarzenie: symulacja idzie gałęzią limitu czasu.
        v_outcome := CASE WHEN v_params ->> 'mode' = 'until_event' THEN 'timeout' ELSE 'next' END;
        v_note := v_params ->> 'mode';
      WHEN 'send_email' THEN
        v_outcome := 'next';
        v_note := public._journey_send_verdict(v_tenant, p_lead_id, v_def.category);
        v_emails := v_emails || jsonb_build_object('nodeId', v_id, 'verdict', v_note);
      WHEN 'ab_split' THEN
        v_bucket := abs(hashtextextended(p_lead_id::text || ':' || v_id, 0)) % 100;
        v_outcome := CASE WHEN v_bucket < COALESCE((v_params -> 'weights' ->> 'A')::integer, 50) THEN 'A' ELSE 'B' END;
        v_note := 'simulated_bucket';
      WHEN 'if_else' THEN
        SELECT count(*) FILTER (WHERE CASE
                 WHEN p ->> 'kind' IN ('email_opened', 'email_clicked', 'event_since_enrollment') THEN false
                 ELSE public._journey_eval_predicate(v_tenant, p_lead_id, v_lead.user_id, NULL, now(), p, NULL) END),
               count(*)
          INTO v_hits, v_total
          FROM jsonb_array_elements(COALESCE(v_params -> 'predicates', '[]'::jsonb)) p;
        v_outcome := CASE
          WHEN v_params ->> 'match' = 'any' THEN CASE WHEN v_hits > 0 THEN 'yes' ELSE 'no' END
          ELSE CASE WHEN v_hits = v_total AND v_total > 0 THEN 'yes' ELSE 'no' END
        END;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_params -> 'predicates', '[]'::jsonb)) p
                    WHERE p ->> 'kind' IN ('email_opened', 'email_clicked', 'event_since_enrollment')) THEN
          v_note := 'history_predicates_false';
        END IF;
      WHEN 'goal', 'exit' THEN
        v_outcome := NULL;
      ELSE
        v_outcome := 'next';
        v_note := CASE WHEN v_type = 'trigger' THEN NULL ELSE 'would_run' END;
    END CASE;
    v_path := v_path || jsonb_strip_nulls(jsonb_build_object(
      'nodeId', v_id, 'type', v_type, 'outcome', v_outcome, 'note', v_note));
    v_end := v_id;
    EXIT WHEN v_outcome IS NULL;
    v_id := public._journey_edge(v_graph, v_id, v_outcome);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'errors', '[]'::jsonb, 'path', v_path, 'emails', v_emails,
                            'ended_at', v_end);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_simulate(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_simulate(uuid, uuid, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Zdrowie silnika najemcy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_engine_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_enabled boolean;
BEGIN
  SELECT s.enabled INTO v_enabled FROM public.journey_settings s WHERE s.tenant_id = v_tenant;
  RETURN jsonb_build_object(
    'enabled', COALESCE(v_enabled, false),
    'journeys_active', (SELECT count(*) FROM public.journey_definitions d
                         WHERE d.tenant_id = v_tenant AND d.status = 'active'),
    'inbox_pending', (SELECT count(*) FROM public.journey_event_inbox i
                       WHERE i.tenant_id = v_tenant AND i.processed_at IS NULL),
    'inbox_oldest_at', (SELECT min(i.received_at) FROM public.journey_event_inbox i
                         WHERE i.tenant_id = v_tenant AND i.processed_at IS NULL),
    'last_ingest_at', (SELECT max(i.processed_at) FROM public.journey_event_inbox i
                        WHERE i.tenant_id = v_tenant),
    'due_now', (SELECT count(*) FROM public.journey_enrollments e
                 WHERE e.tenant_id = v_tenant AND e.status IN ('active', 'waiting')
                   AND e.next_run_at <= now()),
    'active', (SELECT count(*) FROM public.journey_enrollments e
                WHERE e.tenant_id = v_tenant AND e.status = 'active'),
    'waiting', (SELECT count(*) FROM public.journey_enrollments e
                 WHERE e.tenant_id = v_tenant AND e.status = 'waiting'),
    'locked', (SELECT count(*) FROM public.journey_enrollments e
                WHERE e.tenant_id = v_tenant AND e.locked_until > now()),
    'last_step_at', (SELECT max(sr.finished_at) FROM public.journey_step_runs sr
                      WHERE sr.tenant_id = v_tenant),
    'failed_24h', (SELECT count(*) FROM public.journey_enrollments e
                    WHERE e.tenant_id = v_tenant AND e.status = 'failed'
                      AND e.finished_at > now() - interval '24 hours'),
    'dead_steps_24h', (SELECT count(*) FROM public.journey_step_runs sr
                        WHERE sr.tenant_id = v_tenant AND sr.status = 'dead'
                          AND sr.finished_at > now() - interval '24 hours'),
    'messages_24h', (SELECT count(*) FROM public.journey_messages m
                      WHERE m.tenant_id = v_tenant AND m.queued_at > now() - interval '24 hours'),
    'errors_24h', (SELECT COALESCE(jsonb_object_agg(x.phase, x.n), '{}'::jsonb) FROM (
                     SELECT err.phase, count(*) AS n FROM public.journey_engine_errors err
                      WHERE err.tenant_id = v_tenant AND err.created_at > now() - interval '24 hours'
                      GROUP BY err.phase) x),
    'last_errors', (SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
                      -- Komunikat skrócony: błąd SQL nie trafia w całości do panelu.
                      SELECT err.phase, err.created_at, err.journey_id, err.node_id,
                             left(err.error, 300) AS error
                        FROM public.journey_engine_errors err
                       WHERE err.tenant_id = v_tenant
                       ORDER BY err.created_at DESC LIMIT 5) x)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_engine_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_engine_health() TO authenticated, service_role;
