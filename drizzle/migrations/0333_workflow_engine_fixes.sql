-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S4, 4/8): SILNIK PRZEPISÓW - PRZEBIEG RAZ NA
-- ZDARZENIE, UCZCIWY LICZNIK, ŚLAD AWARII, BRAMKA INSTALACJI, ZDARZENIE ZMIANY.
--
-- DEFEKT (rozpoznanie silnika, docs/ROZPOZNANIE_SILNIK_SCIEZEK_BI_2026-10-18.md §1.10)
--   D3. W przebiegu `failed` `steps_completed` liczył kroki, których efekty
--       savepoint już cofnął: „2 z 3 kroków wykonane", choć w bazie nie
--       zostało nic - admin szukał skutków, których nie było.
--   D4. `install_workflow_template` wpuszczał `is_staff()`, czyli także
--       AUTORA, choć RLS definicji (20260824074231) już go odcina. Autor mógł
--       przez RPC zainstalować przepis albo PONOWNIE WŁĄCZYĆ wyłączony
--       (`ON CONFLICT ... DO UPDATE SET enabled = true`).
--   D5. Awaria całego silnika (blok zewnętrzny `EXCEPTION WHEN OTHERS THEN
--       RETURN NEW`) ginęła bez śladu - przepisy przestawały działać po cichu.
--   D6. Brak `UNIQUE (workflow_id, event_id)`: ponowna dostawa tego samego
--       zdarzenia (powtórka importu, odtworzenie szyny) wykonywała przepis
--       drugi raz - druga notyfikacja, drugie zadanie.
--   Hub: zmiana przepisu nie miała zdarzenia, więc diagnostyka huba (reguła
--   „przepis dubluje ścieżkę", S7) i druga karta panelu nie wiedziały o niej.
--
-- ZMIANA
--   A. Deduplikacja `workflow_runs` (zostaje NAJSTARSZY przebieg pary
--      `(workflow_id, event_id)`) + indeks unikalny
--      `workflow_runs_workflow_event_uidx`.
--   B. `tg_run_workflows_for_event()` (CIALO-Z niżej): przebieg najpierw
--      ZAJMUJE parę `(workflow_id, event_id)` (`ON CONFLICT DO NOTHING`), a
--      dopiero potem wykonuje kroki - druga dostawa zdarzenia nic nie robi
--      (D6); porażka zapisuje `steps_completed = 0` i komunikat z numerem
--      i akcją kroku (D3); awaria całego silnika -> `_log_emit_error` (D5).
--   C. `install_workflow_template(text)` (CIALO-Z niżej): bramka
--      `is_admin_or_editor()` = RLS definicji (D4), odmowa 42501.
--   D. `tg_workflow_definitions_emit()` - AFTER INSERT/UPDATE/DELETE na
--      `workflow_definitions`: `workflow_definition.changed.v1`
--      {workflow_id, enabled, op}, aktor `auth.uid()`; UPDATE emituje tylko
--      przy zmianie kolumn znaczących (nazwa, włączenie, wyzwalacz, warunek,
--      kroki); awaria emisji nie przerywa zapisu.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020130200 (`run_workflow_step` v2). Deduplikacja
-- przed indeksem w tym samym pliku (inaczej CREATE UNIQUE INDEX padnie na
-- historycznych duplikatach).
-- IDEMPOTENTNA: DELETE duplikatów (powtórka nie ma czego usunąć), CREATE
-- UNIQUE INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/workflow_engine_fixes_test.sql (to samo zdarzenie
-- dwa razy = 1 przebieg, licznik bez kroków cofniętych, ślad awarii silnika,
-- autor nie zainstaluje ani nie włączy przepisu, zdarzenie zmiany przepisu).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Jeden przebieg na parę przepis × zdarzenie.
-- ----------------------------------------------------------------------------
DELETE FROM public.workflow_runs r
 USING public.workflow_runs older
 WHERE r.workflow_id = older.workflow_id
   AND r.event_id = older.event_id
   AND (older.created_at, older.id) < (r.created_at, r.id);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_workflow_event_uidx
  ON public.workflow_runs (workflow_id, event_id);

-- ----------------------------------------------------------------------------
-- B) Silnik przepisów.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260711221058
CREATE OR REPLACE FUNCTION public.tg_run_workflows_for_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_def record;
  v_step jsonb;
  v_done integer;
  v_step_no integer;
  v_action text;
  v_run uuid;
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

    -- D6: najpierw zajęcie pary (przepis, zdarzenie), potem kroki. Druga
    -- dostawa tego samego zdarzenia nie przejdzie zajęcia i niczego nie
    -- wykona drugi raz. Zajęcie stoi POZA podtransakcją kroków, więc ich
    -- porażka go nie cofa - przebieg zostaje jako `failed`.
    v_run := NULL;
    INSERT INTO public.workflow_runs (
      tenant_id, workflow_id, event_id, event_type, correlation_id,
      status, steps_completed
    ) VALUES (
      NEW.tenant_id, v_def.id, NEW.id, NEW.event_type, NEW.correlation_id,
      'succeeded', 0
    )
    ON CONFLICT (workflow_id, event_id) DO NOTHING
    RETURNING id INTO v_run;
    IF v_run IS NULL THEN
      CONTINUE;
    END IF;

    v_done := 0;
    v_step_no := 0;
    v_action := NULL;
    BEGIN
      FOR v_step IN SELECT * FROM jsonb_array_elements(v_def.steps) LOOP
        v_step_no := v_step_no + 1;
        v_action := v_step ->> 'action';
        PERFORM public.run_workflow_step(NEW, v_step);
        v_done := v_done + 1;
      END LOOP;
      UPDATE public.workflow_runs SET steps_completed = v_done WHERE id = v_run;
    EXCEPTION WHEN OTHERS THEN
      -- D3: savepoint cofnął efekty WSZYSTKICH kroków przebiegu, więc licznik
      -- to 0; numer i akcja kroku, który padł, idą do komunikatu.
      UPDATE public.workflow_runs
         SET status = 'failed',
             steps_completed = 0,
             error = left(format('step %s (%s): %s', v_step_no, COALESCE(v_action, '?'), SQLERRM), 500)
       WHERE id = v_run;
    END;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- D5: zapis źródłowy (zdarzenie) przechodzi, ale awaria silnika zostawia
  -- ślad - inaczej przepisy przestają działać bez jednego sygnału.
  PERFORM public._log_emit_error(
    NEW.tenant_id, 'tg_run_workflows_for_event', NEW.event_type, SQLSTATE, SQLERRM
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_run_workflows_for_event() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_run_workflows_for_event ON public.domain_events;
CREATE TRIGGER trg_run_workflows_for_event
  AFTER INSERT ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_run_workflows_for_event();

-- ----------------------------------------------------------------------------
-- C) Instalacja przepisu z katalogu - bramka = RLS definicji (D4).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260711221058
CREATE OR REPLACE FUNCTION public.install_workflow_template(p_key text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_template public.workflow_templates%ROWTYPE;
  v_id uuid;
BEGIN
  -- Autor (`is_staff()` go obejmował) nie zapisze definicji przez RLS, więc
  -- nie może jej też zainstalować ani ponownie włączyć przez to RPC.
  IF v_tenant IS NULL OR NOT public.is_admin_or_editor() THEN
    RAISE EXCEPTION 'workflows: admin or editor only' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.install_workflow_template(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.install_workflow_template(text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Zdarzenie zmiany przepisu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_workflow_definitions_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.workflow_definitions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  -- Stempel `updated_at` sam w sobie nie jest zmianą przepisu.
  IF TG_OP = 'UPDATE'
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.enabled IS NOT DISTINCT FROM OLD.enabled
     AND NEW.trigger_event_type IS NOT DISTINCT FROM OLD.trigger_event_type
     AND NEW.condition IS NOT DISTINCT FROM OLD.condition
     AND NEW.steps IS NOT DISTINCT FROM OLD.steps THEN
    RETURN NULL;
  END IF;
  -- Payload bez treści kroków (mogą nieść teksty powiadomień) - identyfikator,
  -- stan i rodzaj operacji wystarczą, żeby czytelnik odświeżył swój odczyt.
  PERFORM public.emit_domain_event(
    v_row.tenant_id, 'workflow_definition', v_row.id::text, 'workflow_definition.changed.v1',
    jsonb_build_object('workflow_id', v_row.id, 'enabled', v_row.enabled, 'op', lower(TG_OP))
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM public._log_emit_error(
    v_row.tenant_id, 'tg_workflow_definitions_emit', 'workflow_definition.changed.v1', SQLSTATE, SQLERRM
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_workflow_definitions_emit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_workflow_definitions_emit ON public.workflow_definitions;
CREATE TRIGGER trg_workflow_definitions_emit
  AFTER INSERT OR UPDATE OR DELETE ON public.workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_workflow_definitions_emit();
