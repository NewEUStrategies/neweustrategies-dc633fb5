-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S5, 4/6): ŚCIEŻKI KOMUNIKACJI - RPC PANELU
-- (TWORZENIE, SZKIC, PUBLIKACJA, STATUS, TREŚĆ MAILA, USTAWIENIA SILNIKA,
-- LISTY).
--
-- DEFEKT
--   Tabele ścieżek z I0 mają dla `authenticated` wyłącznie SELECT (zapis
--   tylko przez RPC), a RPC nie było - edytor S8 nie miałby czym zapisać
--   szkicu, opublikować wersji ani włączyć silnika. Wymóg właściciela:
--   KAŻDY przełącznik silnika (włączenie per najemca, limit D-03, cisza
--   nocna, nadawca, pauza ścieżki, wyjście kontaktu, test na żywo) jest
--   w panelu admina - żadnego ustawienia dostępnego tylko z SQL albo env.
--
-- ZMIANA (najemca ZAWSZE z sesji - `current_tenant_id()`; nigdy z ładunku)
--   A. `_journey_staff_tenant(p_admin_only)` (wewnętrzna) - bramka roli:
--      admin|editor (odczyt, szkic, treść) albo wyłącznie admin (publikacja,
--      status, ustawienia). Odmowa = 42501.
--   B. `admin_journey_create` - nowa ścieżka (szkic), klucz z CHECK-u
--      (`^[a-z0-9_-]{3,64}$`), komunikacja `service` wyłącznie z podstawą
--      prawną; `admin_journey_save_draft` - szkic grafu i ustawień
--      z optymistyczną współbieżnością (`p_expected_updated_at` niezgodne =
--      40001 `conflict`), szkic > 256 KiB ODRZUCONY.
--   C. `admin_journey_publish` (admin) - walidacja grafu
--      (`journey_validate_graph`, 22023 `graph_invalid` z listą błędów),
--      treść każdego maila (wariant A) wymagana, nowa niezmienna wersja
--      (`graph_checksum` = md5 grafu), kopia treści do wersji, przebudowa tras
--      (`enroll`, `goal`, `exit`, globalny wypis z newslettera dla
--      marketingu, `wake` dla czekań `until_event` - także wersji, na których
--      ktoś jeszcze czeka); zapisy poprzednich wersji: `drain` (dokończą swoją
--      wersję - przypięcie) albo `exit_all` (wyjście `manual`).
--   D. `admin_journey_set_status` (admin) - `active|paused|archived`;
--      archiwum kończy aktywne zapisy (`journey_archived`) i zdejmuje trasy.
--   E. `admin_journey_email_content_save` - temat/preheader PL/EN + dokument
--      EmailDoc v1 węzła `send_email` szkicu (wariant A-E); temat > 200
--      znaków odrzuca CHECK, nie przycina.
--   F. `admin_journey_settings_get` / `admin_journey_settings_save` (admin) -
--      ustawienia silnika najemcy z białą listą kluczy: `enabled`
--      (DOMYŚLNIE false), `marketing_cap_per_7d` (D-03: 3), `quiet_start`,
--      `quiet_end` (D-03: 21:00-08:00), `timezone` (Europe/Warsaw),
--      `default_task_assignee_id` (personel CRM najemcy), `machine_open_seconds`,
--      `sender_name`, `reply_to`.
--   G. `admin_journey_list`, `admin_journey_enrollments`,
--      `admin_journey_lead_enrollments` - listy panelu (zapisy testowe poza
--      licznikami listy, widoczne z flagą na liście kontaktów).
--   Każda zmiana emituje `journey.changed.v1` (agregat `journey`, op
--   `create|save|publish|status|content|settings`) - inwalidacja panelu.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020140200 (`journey_validate_graph`,
-- kolumny nadawcy). Bez zależności od kodu: RPC czeka na UI S8.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/journeys_admin_rpc_test.sql (create/save z konfliktem,
-- publish z walidacją i sumą kontrolną, status, publikacja i ustawienia tylko
-- admin, lista bez zapisów testowych, izolacja najemców).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Bramka roli.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_staff_tenant(p_admin_only boolean)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_admin_only THEN
    IF NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'super_admin'::app_role)) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (public.is_admin_or_editor() OR public.has_role(v_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_staff_tenant(boolean) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Tworzenie i szkic.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_create(
  p_key text,
  p_name text,
  p_category text DEFAULT 'marketing',
  p_legal_basis text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_template_key text DEFAULT NULL,
  p_draft jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_row public.journey_definitions%ROWTYPE;
BEGIN
  IF p_draft IS NOT NULL AND (jsonb_typeof(p_draft) <> 'object' OR length(p_draft::text) > 262144) THEN
    RAISE EXCEPTION 'draft_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_template_key IS NOT NULL AND p_template_key !~ '^[a-z0-9_]{3,64}$' THEN
    RAISE EXCEPTION 'template_key_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.journey_definitions (
    tenant_id, key, name, description, category, legal_basis, template_key, draft,
    created_by, updated_by
  ) VALUES (
    v_tenant, p_key, btrim(p_name), NULLIF(btrim(COALESCE(p_description, '')), ''),
    COALESCE(p_category, 'marketing'), NULLIF(btrim(COALESCE(p_legal_basis, '')), ''),
    p_template_key,
    COALESCE(p_draft, '{"graph":{"nodes":[],"edges":[]},"settings":{}}'::jsonb),
    auth.uid(), auth.uid()
  )
  RETURNING * INTO v_row;

  PERFORM public.emit_domain_event(v_tenant, 'journey', v_row.id::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', v_row.id, 'status', v_row.status, 'version', NULL, 'op', 'create'));
  RETURN jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at, 'status', v_row.status);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'key_taken' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_create(text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_create(text, text, text, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_journey_save_draft(
  p_journey_id uuid,
  p_expected_updated_at timestamptz,
  p_draft jsonb,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_legal_basis text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_row public.journey_definitions%ROWTYPE;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object'
     OR jsonb_typeof(p_draft -> 'graph') IS DISTINCT FROM 'object'
     OR length(p_draft::text) > 262144 THEN
    RAISE EXCEPTION 'draft_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '40001';
  END IF;
  IF v_row.status = 'archived' THEN
    RAISE EXCEPTION 'journey_archived' USING ERRCODE = '22023';
  END IF;

  UPDATE public.journey_definitions d
     SET draft = p_draft,
         name = COALESCE(btrim(p_name), d.name),
         description = CASE WHEN p_description IS NULL THEN d.description
                            ELSE NULLIF(btrim(p_description), '') END,
         category = COALESCE(p_category, d.category),
         legal_basis = CASE WHEN p_legal_basis IS NULL THEN d.legal_basis
                            ELSE NULLIF(btrim(p_legal_basis), '') END,
         updated_by = auth.uid()
   WHERE d.id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.emit_domain_event(v_tenant, 'journey', v_row.id::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', v_row.id, 'status', v_row.status, 'version', NULL, 'op', 'save'));
  RETURN jsonb_build_object('id', v_row.id, 'updated_at', v_row.updated_at, 'status', v_row.status);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_save_draft(uuid, timestamptz, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_save_draft(uuid, timestamptz, jsonb, text, text, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Publikacja.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_publish(
  p_journey_id uuid,
  p_expected_updated_at timestamptz,
  p_mode text DEFAULT 'drain'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_type_re constant text := '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$';
  v_tenant uuid := public._journey_staff_tenant(true);
  v_row public.journey_definitions%ROWTYPE;
  v_settings jsonb;
  v_graph jsonb;
  v_trigger text;
  v_check jsonb;
  v_missing jsonb;
  v_version integer;
  v_version_id uuid;
  v_checksum text;
  v_exit jsonb;
  v_reentry text;
BEGIN
  IF COALESCE(p_mode, 'drain') NOT IN ('drain', 'exit_all') THEN
    RAISE EXCEPTION 'mode_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NULL OR v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '40001';
  END IF;
  IF v_row.status = 'archived' THEN
    RAISE EXCEPTION 'journey_archived' USING ERRCODE = '22023';
  END IF;

  v_settings := COALESCE(v_row.draft -> 'settings', '{}'::jsonb);
  v_graph := COALESCE(v_row.draft -> 'graph', '{}'::jsonb);
  v_trigger := v_settings ->> 'triggerEventType';
  IF v_trigger IS NULL OR v_trigger !~ c_type_re THEN
    RAISE EXCEPTION 'trigger_invalid' USING ERRCODE = '22023';
  END IF;
  IF (v_settings -> 'goal') IS NOT NULL AND jsonb_typeof(v_settings -> 'goal') = 'object'
     AND COALESCE(v_settings -> 'goal' ->> 'eventType', '') !~ c_type_re THEN
    RAISE EXCEPTION 'goal_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_settings -> 'exitEvents', '[]'::jsonb)) x
              WHERE COALESCE(x ->> 'eventType', '') !~ c_type_re) THEN
    RAISE EXCEPTION 'exit_invalid' USING ERRCODE = '22023';
  END IF;
  v_reentry := COALESCE(v_settings ->> 'reentry', 'never');

  v_check := public.journey_validate_graph(v_graph, v_trigger);
  IF NOT (v_check ->> 'ok')::boolean THEN
    RAISE EXCEPTION 'graph_invalid' USING ERRCODE = '22023', DETAIL = (v_check -> 'errors')::text;
  END IF;

  -- Każdy mail ma treść wariantu A (temat PL i dokument).
  SELECT COALESCE(jsonb_agg(n ->> 'id'), '[]'::jsonb) INTO v_missing
    FROM jsonb_array_elements(v_graph -> 'nodes') n
   WHERE n ->> 'type' = 'send_email'
     AND NOT EXISTS (
       SELECT 1 FROM public.journey_email_contents c
        WHERE c.tenant_id = v_tenant AND c.journey_id = v_row.id AND c.version_id IS NULL
          AND c.node_id = n ->> 'id' AND c.variant = 'A');
  IF jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'content_missing' USING ERRCODE = '22023', DETAIL = v_missing::text;
  END IF;

  SELECT COALESCE(max(v.version), 0) + 1 INTO v_version
    FROM public.journey_versions v WHERE v.journey_id = v_row.id;
  v_checksum := md5(v_graph::text);
  INSERT INTO public.journey_versions (
    tenant_id, journey_id, version, trigger_event_type, trigger_condition, entry_filter,
    reentry, reentry_cooldown_days, goal, exit_events, graph, graph_checksum, published_by
  ) VALUES (
    v_tenant, v_row.id, v_version, v_trigger,
    COALESCE(v_settings -> 'triggerCondition', '{}'::jsonb),
    COALESCE(v_settings -> 'entryFilter', '[]'::jsonb),
    v_reentry,
    CASE WHEN v_reentry = 'cooldown' THEN COALESCE((v_settings ->> 'reentryCooldownDays')::integer, 30) END,
    CASE WHEN jsonb_typeof(v_settings -> 'goal') = 'object' THEN v_settings -> 'goal' END,
    COALESCE(v_settings -> 'exitEvents', '[]'::jsonb),
    v_graph, v_checksum, auth.uid()
  )
  RETURNING id INTO v_version_id;

  -- Treść szkicu -> treść wersji (wersja niezmienna, szkic edytowalny dalej).
  INSERT INTO public.journey_email_contents (
    tenant_id, journey_id, version_id, node_id, variant, subject_pl, subject_en,
    preheader_pl, preheader_en, doc
  )
  SELECT c.tenant_id, c.journey_id, v_version_id, c.node_id, c.variant, c.subject_pl, c.subject_en,
         c.preheader_pl, c.preheader_en, c.doc
    FROM public.journey_email_contents c
   WHERE c.tenant_id = v_tenant AND c.journey_id = v_row.id AND c.version_id IS NULL
     AND c.node_id IN (SELECT n ->> 'id' FROM jsonb_array_elements(v_graph -> 'nodes') n
                        WHERE n ->> 'type' = 'send_email');

  -- Trasy: indeks nasłuchu tej ścieżki od nowa.
  DELETE FROM public.journey_event_routes r WHERE r.tenant_id = v_tenant AND r.journey_id = v_row.id;
  INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role, condition)
  VALUES (v_tenant, v_trigger, v_row.id, v_version_id, 'enroll',
          COALESCE(v_settings -> 'triggerCondition', '{}'::jsonb));
  IF jsonb_typeof(v_settings -> 'goal') = 'object' THEN
    INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role, condition)
    VALUES (v_tenant, v_settings -> 'goal' ->> 'eventType', v_row.id, v_version_id, 'goal',
            COALESCE(v_settings -> 'goal' -> 'condition', '{}'::jsonb))
    ON CONFLICT DO NOTHING;
  END IF;
  FOR v_exit IN SELECT jsonb_array_elements(COALESCE(v_settings -> 'exitEvents', '[]'::jsonb)) LOOP
    INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role, condition)
    VALUES (v_tenant, v_exit ->> 'eventType', v_row.id, v_version_id, 'exit',
            COALESCE(v_exit -> 'condition', '{}'::jsonb))
    ON CONFLICT DO NOTHING;
  END LOOP;
  IF v_row.category = 'marketing' THEN
    -- Wypis z newslettera kończy KAŻDĄ ścieżkę marketingową (warunek pusty).
    INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role, condition)
    VALUES (v_tenant, 'newsletter_subscriber.unsubscribed.v1', v_row.id, v_version_id, 'exit', '{}'::jsonb)
    ON CONFLICT (tenant_id, event_type, journey_id, role) DO UPDATE SET condition = '{}'::jsonb;
  END IF;
  -- Przebudzenia: czekania nowej wersji i wersji, na których ktoś jeszcze czeka.
  INSERT INTO public.journey_event_routes (tenant_id, event_type, journey_id, version_id, role, condition)
  SELECT DISTINCT v_tenant, x.event_type, v_row.id, v_version_id, 'wake', '{}'::jsonb
    FROM (
      SELECT n -> 'params' ->> 'eventType' AS event_type
        FROM jsonb_array_elements(v_graph -> 'nodes') n
       WHERE n ->> 'type' = 'wait' AND n -> 'params' ->> 'mode' = 'until_event'
      UNION
      SELECT e.wait_event_type FROM public.journey_enrollments e
       WHERE e.tenant_id = v_tenant AND e.journey_id = v_row.id AND e.status = 'waiting'
         AND e.wait_event_type IS NOT NULL
    ) x
   WHERE x.event_type IS NOT NULL
  ON CONFLICT DO NOTHING;

  IF p_mode = 'exit_all' THEN
    UPDATE public.journey_enrollments e
       SET status = 'exited', exit_reason = 'manual', finished_at = now(),
           next_run_at = NULL, lock_token = NULL, locked_until = NULL
     WHERE e.tenant_id = v_tenant AND e.journey_id = v_row.id
       AND e.status IN ('active', 'waiting') AND e.version_id <> v_version_id;
  END IF;

  UPDATE public.journey_definitions d
     SET status = 'active', published_version_id = v_version_id, updated_by = auth.uid()
   WHERE d.id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.emit_domain_event(v_tenant, 'journey', v_row.id::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', v_row.id, 'status', 'active', 'version', v_version, 'op', 'publish'));
  RETURN jsonb_build_object('id', v_row.id, 'version_id', v_version_id, 'version', v_version,
                            'graph_checksum', v_checksum, 'updated_at', v_row.updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_publish(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_publish(uuid, timestamptz, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Status ścieżki.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_set_status(
  p_journey_id uuid,
  p_status text,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(true);
  v_row public.journey_definitions%ROWTYPE;
  v_exited integer := 0;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('active', 'paused', 'archived') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '40001';
  END IF;
  -- Archiwum jest końcem: trasy zdjęte, zapisy zakończone - wznowienie to nowa ścieżka.
  IF v_row.status = 'archived' AND p_status <> 'archived' THEN
    RAISE EXCEPTION 'journey_archived' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'active' AND v_row.published_version_id IS NULL THEN
    RAISE EXCEPTION 'not_published' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'archived' THEN
    UPDATE public.journey_enrollments e
       SET status = 'exited', exit_reason = 'journey_archived', finished_at = now(),
           next_run_at = NULL, lock_token = NULL, locked_until = NULL
     WHERE e.tenant_id = v_tenant AND e.journey_id = v_row.id AND e.status IN ('active', 'waiting');
    GET DIAGNOSTICS v_exited = ROW_COUNT;
    DELETE FROM public.journey_event_routes r WHERE r.tenant_id = v_tenant AND r.journey_id = v_row.id;
  END IF;

  UPDATE public.journey_definitions d
     SET status = p_status, updated_by = auth.uid()
   WHERE d.id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public.emit_domain_event(v_tenant, 'journey', v_row.id::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', v_row.id, 'status', p_status, 'version', NULL, 'op', 'status'));
  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'updated_at', v_row.updated_at,
                            'exited', v_exited);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_set_status(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_set_status(uuid, text, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Treść maila węzła (szkic).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_email_content_save(
  p_journey_id uuid,
  p_node_id text,
  p_variant text,
  p_subject_pl text,
  p_subject_en text,
  p_preheader_pl text,
  p_preheader_en text,
  p_doc jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_row public.journey_definitions%ROWTYPE;
  v_id uuid;
  v_updated timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(public._journey_node(v_row.draft -> 'graph', p_node_id) ->> 'type', '') <> 'send_email' THEN
    RAISE EXCEPTION 'node_not_email' USING ERRCODE = '22023';
  END IF;
  IF p_doc IS NULL OR jsonb_typeof(p_doc) <> 'object' OR (p_doc ->> 'version') IS DISTINCT FROM '1'
     OR jsonb_typeof(p_doc -> 'blocks') <> 'array' THEN
    RAISE EXCEPTION 'doc_invalid' USING ERRCODE = '22023';
  END IF;
  IF length(p_doc::text) > 200000 THEN
    RAISE EXCEPTION 'doc_too_large' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.journey_email_contents (
    tenant_id, journey_id, version_id, node_id, variant, subject_pl, subject_en,
    preheader_pl, preheader_en, doc
  ) VALUES (
    v_tenant, v_row.id, NULL, p_node_id, COALESCE(p_variant, 'A'), btrim(p_subject_pl),
    NULLIF(btrim(COALESCE(p_subject_en, '')), ''), NULLIF(btrim(COALESCE(p_preheader_pl, '')), ''),
    NULLIF(btrim(COALESCE(p_preheader_en, '')), ''), p_doc
  )
  ON CONFLICT ON CONSTRAINT journey_email_contents_node_key DO UPDATE
     SET subject_pl = EXCLUDED.subject_pl, subject_en = EXCLUDED.subject_en,
         preheader_pl = EXCLUDED.preheader_pl, preheader_en = EXCLUDED.preheader_en,
         doc = EXCLUDED.doc
  RETURNING id, updated_at INTO v_id, v_updated;

  PERFORM public.emit_domain_event(v_tenant, 'journey', v_row.id::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', v_row.id, 'status', v_row.status, 'version', NULL, 'op', 'content'));
  RETURN jsonb_build_object('id', v_id, 'updated_at', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_email_content_save(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_email_content_save(uuid, text, text, text, text, text, text, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Ustawienia silnika najemcy (panel).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_settings_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_s public.journey_settings%ROWTYPE;
  v_exists boolean;
BEGIN
  SELECT * INTO v_s FROM public.journey_settings s WHERE s.tenant_id = v_tenant;
  v_exists := FOUND;
  -- Brak wiersza = wartości domyślne kontraktu (silnik WYŁĄCZONY, D-03).
  RETURN jsonb_build_object(
    'enabled', COALESCE(v_s.enabled, false),
    'marketing_cap_per_7d', COALESCE(v_s.marketing_cap_per_7d, 3),
    'quiet_start', to_char(COALESCE(v_s.quiet_start, '21:00'::time), 'HH24:MI'),
    'quiet_end', to_char(COALESCE(v_s.quiet_end, '08:00'::time), 'HH24:MI'),
    'timezone', COALESCE(v_s.timezone, 'Europe/Warsaw'),
    'default_task_assignee_id', v_s.default_task_assignee_id,
    'machine_open_seconds', COALESCE(v_s.machine_open_seconds, 2),
    'sender_name', v_s.sender_name,
    'reply_to', v_s.reply_to,
    'updated_at', CASE WHEN v_exists THEN v_s.updated_at END,
    'exists', v_exists
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_settings_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_settings_get() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_journey_settings_save(
  p_patch jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_keys constant text[] := ARRAY[
    'enabled', 'marketing_cap_per_7d', 'quiet_start', 'quiet_end', 'timezone',
    'default_task_assignee_id', 'machine_open_seconds', 'sender_name', 'reply_to'
  ];
  v_tenant uuid := public._journey_staff_tenant(true);
  v_cur public.journey_settings%ROWTYPE;
  v_exists boolean;
  v_key text;
  v_assignee uuid;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch_invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (c_keys)) THEN
      RAISE EXCEPTION 'unknown_setting:%', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_patch ? 'enabled' AND jsonb_typeof(p_patch -> 'enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'enabled_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'quiet_start' AND COALESCE(p_patch ->> 'quiet_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'quiet_start_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'quiet_end' AND COALESCE(p_patch ->> 'quiet_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'quiet_end_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'timezone' AND NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = p_patch ->> 'timezone') THEN
    RAISE EXCEPTION 'timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'default_task_assignee_id' AND jsonb_typeof(p_patch -> 'default_task_assignee_id') <> 'null' THEN
    v_assignee := (p_patch ->> 'default_task_assignee_id')::uuid;
    -- Osoba domyślna = personel CRM TEGO najemcy (P24).
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
       WHERE ur.tenant_id = v_tenant AND ur.user_id = v_assignee
         AND ur.role::text IN ('admin', 'editor', 'super_admin')) THEN
      RAISE EXCEPTION 'assignee_not_staff' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_cur FROM public.journey_settings s WHERE s.tenant_id = v_tenant FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND p_expected_updated_at IS NOT NULL AND v_cur.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '40001';
  END IF;

  -- Wartości z łatki; brak klucza = wartość bieżąca (albo domyślna kontraktu).
  -- Za długie/niepoprawne wartości odrzuca CHECK tabeli (23514), nie przycina.
  INSERT INTO public.journey_settings AS s (
    tenant_id, enabled, marketing_cap_per_7d, quiet_start, quiet_end, timezone,
    default_task_assignee_id, machine_open_seconds, sender_name, reply_to, updated_by
  ) VALUES (
    v_tenant,
    CASE WHEN p_patch ? 'enabled' THEN (p_patch ->> 'enabled')::boolean ELSE COALESCE(v_cur.enabled, false) END,
    CASE WHEN p_patch ? 'marketing_cap_per_7d' THEN (p_patch ->> 'marketing_cap_per_7d')::smallint
         ELSE COALESCE(v_cur.marketing_cap_per_7d, 3) END,
    CASE WHEN p_patch ? 'quiet_start' THEN (p_patch ->> 'quiet_start')::time
         ELSE COALESCE(v_cur.quiet_start, '21:00'::time) END,
    CASE WHEN p_patch ? 'quiet_end' THEN (p_patch ->> 'quiet_end')::time
         ELSE COALESCE(v_cur.quiet_end, '08:00'::time) END,
    CASE WHEN p_patch ? 'timezone' THEN p_patch ->> 'timezone' ELSE COALESCE(v_cur.timezone, 'Europe/Warsaw') END,
    CASE WHEN p_patch ? 'default_task_assignee_id' THEN v_assignee ELSE v_cur.default_task_assignee_id END,
    CASE WHEN p_patch ? 'machine_open_seconds' THEN (p_patch ->> 'machine_open_seconds')::smallint
         ELSE COALESCE(v_cur.machine_open_seconds, 2) END,
    CASE WHEN p_patch ? 'sender_name' THEN NULLIF(btrim(COALESCE(p_patch ->> 'sender_name', '')), '')
         ELSE v_cur.sender_name END,
    CASE WHEN p_patch ? 'reply_to' THEN NULLIF(btrim(COALESCE(p_patch ->> 'reply_to', '')), '')
         ELSE v_cur.reply_to END,
    auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
     SET enabled = EXCLUDED.enabled, marketing_cap_per_7d = EXCLUDED.marketing_cap_per_7d,
         quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
         timezone = EXCLUDED.timezone, default_task_assignee_id = EXCLUDED.default_task_assignee_id,
         machine_open_seconds = EXCLUDED.machine_open_seconds, sender_name = EXCLUDED.sender_name,
         reply_to = EXCLUDED.reply_to, updated_by = EXCLUDED.updated_by;

  -- Agregat = najemca (ustawienia nie mają ścieżki); op `settings` odświeża panel.
  PERFORM public.emit_domain_event(v_tenant, 'journey', v_tenant::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', NULL, 'status', NULL, 'version', NULL, 'op', 'settings',
                       'keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) k)));
  RETURN public.admin_journey_settings_get();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_settings_save(jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_settings_save(jsonb, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- G) Listy panelu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_list(p_status text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
BEGIN
  IF p_status IS NOT NULL AND p_status NOT IN ('draft', 'active', 'paused', 'archived') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.updated_at DESC)
      FROM (
        SELECT d.id, d.key, d.name, d.description, d.status, d.category, d.template_key,
               d.published_version_id, v.version, v.trigger_event_type,
               d.created_at, d.updated_at,
               -- Zapisy testowe poza licznikami (test na żywo nie zawyża wyników).
               (SELECT count(*) FROM public.journey_enrollments e
                 WHERE e.tenant_id = d.tenant_id AND e.journey_id = d.id AND NOT e.is_test
                   AND e.status IN ('active', 'waiting')) AS active,
               (SELECT count(*) FROM public.journey_enrollments e
                 WHERE e.tenant_id = d.tenant_id AND e.journey_id = d.id AND NOT e.is_test
                   AND e.entered_at > now() - interval '30 days') AS enrolled_30d,
               (SELECT count(*) FROM public.journey_enrollments e
                 WHERE e.tenant_id = d.tenant_id AND e.journey_id = d.id AND NOT e.is_test
                   AND e.entered_at > now() - interval '30 days' AND e.status = 'goal_reached') AS goal_reached_30d
          FROM public.journey_definitions d
          LEFT JOIN public.journey_versions v ON v.id = d.published_version_id
         WHERE d.tenant_id = v_tenant AND (p_status IS NULL OR d.status = p_status)
      ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_list(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_list(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_journey_enrollments(
  p_journey_id uuid,
  p_node_id text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
  v_page integer := GREATEST(COALESCE(p_page, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journey_definitions d WHERE d.id = p_journey_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'waiting', 'completed', 'goal_reached', 'exited', 'failed') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM public.journey_enrollments e
   WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id
     AND (p_node_id IS NULL OR e.current_node_id = p_node_id)
     AND (p_status IS NULL OR e.status = p_status);
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.entered_at DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT e.id, e.lead_id, l.email AS lead_email,
             NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '') AS lead_name,
             e.status, e.current_node_id, e.entered_at, e.finished_at, e.next_run_at,
             e.exit_reason, e.is_test, v.version
        FROM public.journey_enrollments e
        JOIN public.crm_leads l ON l.tenant_id = e.tenant_id AND l.id = e.lead_id
        JOIN public.journey_versions v ON v.id = e.version_id
       WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id
         AND (p_node_id IS NULL OR e.current_node_id = p_node_id)
         AND (p_status IS NULL OR e.status = p_status)
       ORDER BY e.entered_at DESC
       LIMIT v_size OFFSET v_page * v_size
    ) x;
  RETURN jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_enrollments(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_enrollments(uuid, text, text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_journey_lead_enrollments(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.entered_at DESC)
      FROM (
        SELECT e.id AS enrollment_id, e.journey_id, d.name AS journey_name, d.category,
               e.status, e.current_node_id, e.entered_at, e.finished_at, e.exit_reason,
               e.is_test, v.version
          FROM public.journey_enrollments e
          JOIN public.journey_definitions d ON d.tenant_id = e.tenant_id AND d.id = e.journey_id
          JOIN public.journey_versions v ON v.id = e.version_id
         WHERE e.tenant_id = v_tenant AND e.lead_id = p_lead_id
         ORDER BY e.entered_at DESC
         LIMIT 100
      ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_lead_enrollments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_lead_enrollments(uuid) TO authenticated, service_role;
