-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9c-X2, 5/5): RETENCJA DANYCH - RPC PANELU
-- (karta „Retencja danych" w /admin/settings/privacy). Polecenie właściciela
-- 2026-10-20 (Z-I9b-10) i wymóg „wszystko w panelu admina".
--
-- DEFEKT: okresy, tryb podglądu, lista kontaktów do anonimizacji i ręczne
-- uruchomienie (20261020161000-161100) nie mają wejścia w panelu - admin
-- najemcy nie zobaczy ani nie zmieni niczego bez SQL.
--
-- ZMIANA (admin najemcy z SESJI - `current_tenant_id()`, rola admin albo
-- super_admin; najemca nigdy z argumentu):
--   A. `admin_data_retention_get()` - kategorie z wartościami domyślnymi
--      (okres, zakres, włączenie, termin włączenia usuwania, tryb), ostatni
--      przebieg każdej kategorii, stan karencji, granice agregatów
--      i przełącznik piksela otwarć (ustawienia silnika ścieżek).
--   B. `admin_data_retention_save(kategoria, okres, włączona, token)` -
--      okres w zakresie kategorii (inaczej 22023 `period_out_of_range`, nigdy
--      przycięcie), kategoria ustawowa nie do zmiany (22023
--      `category_read_only`), CAS po `updated_at` (40001 `conflict`),
--      `audit_log` i zdarzenie `data_retention.changed.v1`.
--   C. `admin_data_retention_enforcement('enable_now' | 'postpone', dzień)` -
--      karencja: usuwanie od teraz albo od wskazanego dnia (jutro … +90 dni,
--      strefa Europe/Warsaw); `audit_log`, zdarzenie.
--   D. `admin_data_retention_preview()` - ILE rekordów i od jakiej daty obejmie
--      najbliższy przebieg (bez zapisu, liczniki do 100 000).
--   E. `admin_data_retention_crm_due(limit)` - kontakty CRM, które zostaną
--      zanonimizowane w ciągu 30 dni (adres, imię, ostatnia aktywność, termin,
--      klient), `admin_data_retention_crm_extend(lead, powód)` - +12 mies.,
--      powód 3-500 znaków (dłuższy odrzucony), `audit_log`.
--   F. `admin_data_retention_run_now(potwierdzenie)` - przebieg najemcy na
--      żądanie (w karencji - podgląd), `audit_log` z wynikiem.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161000-161300. Panel woła RPC literałami;
-- przed wdrożeniem dostaje PGRST202/42883 i pokazuje „źródło niewdrożone".
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/hub_i9c_data_retention_test.sql (role, najemca
-- z sesji, CAS, zakresy, karencja, przedłużenie, audyt).
-- ============================================================================

-- Admin najemcy z sesji (42501 dla pozostałych).
CREATE OR REPLACE FUNCTION public._data_retention_admin_tenant()
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
  IF v_uid IS NULL OR v_tenant IS NULL
     OR NOT (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_admin_tenant() FROM PUBLIC, anon, authenticated, service_role;

-- Zdarzenie zmiany (panel w innej karcie odświeża kartę). Ładunek bez danych
-- osobowych: kategoria i rodzaj operacji.
CREATE OR REPLACE FUNCTION public._data_retention_emit(p_tenant uuid, p_op text, p_category text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.emit_domain_event(p_tenant, 'data_retention', p_tenant::text, 'data_retention.changed.v1',
    jsonb_strip_nulls(jsonb_build_object('op', p_op, 'category', p_category)), auth.uid(), false);
EXCEPTION WHEN OTHERS THEN
  -- Szyna nie może wycofać zapisu ustawień.
  PERFORM public._log_emit_error(p_tenant, '_data_retention_emit', 'data_retention.changed.v1', SQLSTATE, SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_emit(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- A) Odczyt karty.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_get (rules, categories, grace, funnel_cut,
-- journey_sealed, open_tracking_enabled, journey_settings_updated_at,
-- last_scheduled_run_at)
CREATE OR REPLACE FUNCTION public.admin_data_retention_get()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._data_retention_admin_tenant();
  v_categories jsonb;
  v_grace jsonb;
  v_journey record;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'key', e.category, 'editable', e.editable, 'period_months', e.period_months,
           'default_months', (c.item ->> 'default')::integer, 'min_months', (c.item ->> 'min')::integer,
           'max_months', (c.item ->> 'max')::integer, 'enabled', e.enabled,
           'enforce_after', e.enforce_after, 'enforced', e.enforced, 'cutoff', e.cutoff,
           'updated_at', e.updated_at, 'stored', e.stored,
           'last_run', (SELECT jsonb_build_object('mode', r.mode, 'run_trigger', r.run_trigger,
                                                  'affected', r.affected, 'backlog', r.backlog,
                                                  'error_code', r.error_code, 'cutoff', r.cutoff,
                                                  'started_at', r.started_at, 'finished_at', r.finished_at)
                          FROM public.data_retention_runs r
                         WHERE r.tenant_id = v_tenant AND r.category = e.category
                         ORDER BY r.started_at DESC, r.id DESC LIMIT 1)))
    INTO v_categories
    FROM public._data_retention_effective(v_tenant) e
    JOIN jsonb_array_elements(public._data_retention_catalog() -> 'categories') AS c(item)
      ON c.item ->> 'key' = e.category;

  SELECT jsonb_build_object('enforce_after', min(e.enforce_after), 'enforce_after_max', max(e.enforce_after),
                            'enforced', bool_and(e.enforced), 'any_preview', bool_or(NOT e.enforced))
    INTO v_grace
    FROM public._data_retention_effective(v_tenant) e WHERE e.enabled;

  SELECT s.open_tracking_enabled, s.updated_at INTO v_journey
    FROM (SELECT 1) one LEFT JOIN public.journey_settings s ON s.tenant_id = v_tenant;

  RETURN jsonb_build_object(
    'rules', public._data_retention_catalog() -> 'rules',
    'categories', COALESCE(v_categories, '[]'::jsonb),
    'grace', v_grace,
    'funnel_cut', public._data_retention_funnel_cut(v_tenant),
    'journey_sealed', public._data_retention_journey_sealed(v_tenant),
    'open_tracking_enabled', COALESCE(v_journey.open_tracking_enabled, true),
    'journey_settings_updated_at', v_journey.updated_at,
    'last_scheduled_run_at', (SELECT max(r.started_at) FROM public.data_retention_runs r
                               WHERE r.tenant_id = v_tenant AND r.run_trigger = 'schedule'));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_get() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Zapis kategorii.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_retention_save(
  p_category text,
  p_period_months integer,
  p_enabled boolean,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._data_retention_admin_tenant();
  v_cat jsonb;
  v_cur public.data_retention_settings%ROWTYPE;
  v_exists boolean;
  v_eff record;
BEGIN
  SELECT c.item INTO v_cat FROM jsonb_array_elements(public._data_retention_catalog() -> 'categories') AS c(item)
   WHERE c.item ->> 'key' = p_category;
  IF v_cat IS NULL THEN
    RAISE EXCEPTION 'category_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_cat ->> 'editable')::boolean THEN
    RAISE EXCEPTION 'category_read_only' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL OR p_period_months IS NULL
     OR p_period_months < (v_cat ->> 'min')::integer OR p_period_months > (v_cat ->> 'max')::integer THEN
    RAISE EXCEPTION 'period_out_of_range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cur FROM public.data_retention_settings s
   WHERE s.tenant_id = v_tenant AND s.category = p_category FOR UPDATE;
  v_exists := FOUND;
  IF (v_exists AND p_expected_updated_at IS DISTINCT FROM v_cur.updated_at)
     OR (NOT v_exists AND p_expected_updated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'conflict' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_eff FROM public._data_retention_effective(v_tenant) e WHERE e.category = p_category;

  INSERT INTO public.data_retention_settings AS s (tenant_id, category, period_months, enabled, enforce_after,
                                                  updated_by, updated_at)
  VALUES (v_tenant, p_category, p_period_months::smallint, p_enabled, v_eff.enforce_after, auth.uid(), now())
  ON CONFLICT (tenant_id, category) DO UPDATE
     SET period_months = EXCLUDED.period_months, enabled = EXCLUDED.enabled,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(), 'data_retention.settings_changed', 'data_retention_settings', NULL,
          jsonb_build_object('category', p_category,
                             'from', jsonb_build_object('period_months', v_eff.period_months, 'enabled', v_eff.enabled),
                             'to', jsonb_build_object('period_months', p_period_months, 'enabled', p_enabled)));
  PERFORM public._data_retention_emit(v_tenant, 'settings', p_category);
  RETURN public.admin_data_retention_get();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_save(text, integer, boolean, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_save(text, integer, boolean, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Karencja: włącz teraz albo przesuń termin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_retention_enforcement(p_action text, p_until date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.postponeMaxDays.
  c_postpone_max constant integer := 90;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_today date := (now() AT TIME ZONE 'Europe/Warsaw')::date;
  v_at timestamptz;
BEGIN
  IF p_action = 'enable_now' THEN
    v_at := now();
  ELSIF p_action = 'postpone' THEN
    IF p_until IS NULL OR p_until <= v_today OR p_until > v_today + c_postpone_max THEN
      RAISE EXCEPTION 'postpone_out_of_range' USING ERRCODE = '22023';
    END IF;
    -- Lokalna północ wskazanego dnia (bez przesunięcia doby).
    v_at := p_until::timestamp AT TIME ZONE 'Europe/Warsaw';
  ELSE
    RAISE EXCEPTION 'action_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.data_retention_settings AS s (tenant_id, category, period_months, enabled, enforce_after,
                                                  updated_by, updated_at)
  SELECT v_tenant, e.category, CASE WHEN e.editable THEN e.period_months::smallint END, e.enabled, v_at,
         auth.uid(), now()
    FROM public._data_retention_effective(v_tenant) e
  ON CONFLICT (tenant_id, category) DO UPDATE
     SET enforce_after = EXCLUDED.enforce_after, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(), 'data_retention.enforcement_changed', 'data_retention_settings', NULL,
          jsonb_build_object('action', p_action, 'enforce_after', v_at));
  PERFORM public._data_retention_emit(v_tenant, 'enforcement');
  RETURN public.admin_data_retention_get();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_enforcement(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_enforcement(text, date) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Podgląd najbliższego przebiegu (bez zapisu).
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_preview (cap, categories)
CREATE OR REPLACE FUNCTION public.admin_data_retention_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_cap constant integer := 100000;
  c_redacted constant text := '[redacted]';
  v_tenant uuid := public._data_retention_admin_tenant();
  v_set record;
  v_crm_cut timestamptz;
  v_n bigint;
  v_day timestamptz;
  v_out jsonb := '[]'::jsonb;
BEGIN
  SELECT e.cutoff INTO v_crm_cut FROM public._data_retention_effective(v_tenant) e
   WHERE e.category = 'crm_inactive_contacts';
  FOR v_set IN SELECT * FROM public._data_retention_effective(v_tenant) LOOP
    v_n := NULL;
    -- Dzień progu (UTC) - ta sama granica co przebieg po pieczęci.
    v_day := date_trunc('day', v_set.cutoff AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    IF v_set.enabled THEN
      v_n := CASE v_set.category
        WHEN 'paywall_metering' THEN
          (SELECT count(*) FROM (SELECT 1 FROM public.paywall_hits ph WHERE ph.tenant_id = v_tenant
             AND ph.day < (v_set.cutoff AT TIME ZONE 'UTC')::date LIMIT c_cap) x)
          + (SELECT count(*) FROM (SELECT 1 FROM public.metering_event_log ml WHERE ml.tenant_id = v_tenant
             AND ml.occurred_at < v_day LIMIT c_cap) x)
        WHEN 'email_engagement' THEN
          (SELECT count(*) FROM (SELECT 1 FROM public.journey_message_events me WHERE me.tenant_id = v_tenant
             AND me.occurred_at < v_day LIMIT c_cap) x)
          + (SELECT count(*) FROM (SELECT 1 FROM public.newsletter_campaign_events ce WHERE ce.tenant_id = v_tenant
             AND ce.created_at < v_set.cutoff LIMIT c_cap) x)
        WHEN 'email_send_log' THEN
          (SELECT count(*) FROM (SELECT 1 FROM public.email_send_log l WHERE l.tenant_id = v_tenant
             AND l.created_at < v_day AND (l.recipient_email <> c_redacted OR l.message_id IS NOT NULL
               OR l.provider_message_id IS NOT NULL) LIMIT c_cap) x)
          + (SELECT count(*) FROM (SELECT 1 FROM public.email_delivery_events de WHERE de.tenant_id = v_tenant
             AND de.occurred_at < v_day AND (de.email IS NOT NULL OR de.provider_message_id IS NOT NULL) LIMIT c_cap) x)
          + (SELECT count(*) FROM (SELECT 1 FROM public.newsletter_campaign_recipients r WHERE r.tenant_id = v_tenant
             AND r.created_at < v_set.cutoff AND r.email NOT LIKE '[redacted]%' LIMIT c_cap) x)
        WHEN 'crm_inactive_contacts' THEN
          (public._data_retention_crm(v_tenant, v_set.cutoff, false, c_cap, false) ->> 'affected')::bigint
        WHEN 'crm_customers' THEN
          (public._data_retention_crm(v_tenant, v_crm_cut, false, c_cap, true) ->> 'affected')::bigint
        WHEN 'audit_log' THEN
          (public._data_retention_audit_log(v_tenant, v_set.cutoff, false, c_cap) ->> 'affected')::bigint
        WHEN 'journey_enrollments' THEN
          (SELECT count(*) FROM (SELECT 1 FROM public.journey_enrollments e WHERE e.tenant_id = v_tenant
             AND e.status IN ('completed', 'goal_reached', 'exited', 'failed') AND e.finished_at < v_day
             LIMIT c_cap) x)
        WHEN 'cancellation_surveys' THEN
          (public._data_retention_cancellation_surveys(v_tenant, v_set.cutoff, false, c_cap) ->> 'affected')::bigint
        WHEN 'consent_log' THEN
          (public._data_retention_consent_log(v_tenant, false, c_cap) ->> 'affected')::bigint
      END;
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'key', v_set.category, 'enabled', v_set.enabled,
      'mode', CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END,
      'cutoff', CASE v_set.category WHEN 'crm_customers' THEN v_crm_cut
                                    WHEN 'consent_log' THEN now() - make_interval(years => 6)
                                    ELSE v_set.cutoff END,
      'count', LEAST(v_n, c_cap), 'capped', COALESCE(v_n >= c_cap, false)));
  END LOOP;
  RETURN jsonb_build_object('cap', c_cap, 'categories', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_preview() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Kontakty CRM „do anonimizacji w 30 dni" i przedłużenie.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_crm_due (items, notice_days)
CREATE OR REPLACE FUNCTION public.admin_data_retention_crm_due(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.crmNoticeDays.
  c_notice constant integer := 30;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_set record;
  v_items jsonb;
BEGIN
  SELECT * INTO v_set FROM public._data_retention_effective(v_tenant) e WHERE e.category = 'crm_inactive_contacts';
  WITH due AS (
    SELECT c.lead_id, c.last_activity, c.last_tx,
           GREATEST(c.last_activity + make_interval(months => v_set.period_months),
                    CASE WHEN c.last_tx IS NOT NULL
                         THEN (public._data_retention_customer_until(c.last_tx) + 1)::timestamp
                              AT TIME ZONE 'Europe/Warsaw' END) AS due_at
      FROM public._data_retention_crm_candidates(v_tenant, v_set.cutoff + make_interval(days => c_notice),
                                                 v_limit * 4) c
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'email', l.email, 'first_name', l.first_name, 'last_name', l.last_name,
           'company', l.company, 'last_activity', d.last_activity, 'due_at', d.due_at,
           'customer', d.last_tx IS NOT NULL) ORDER BY d.due_at, l.id), '[]'::jsonb)
    INTO v_items
    FROM (SELECT * FROM due WHERE due_at < now() + make_interval(days => c_notice)
           ORDER BY due_at LIMIT v_limit) d
    JOIN public.crm_leads l ON l.id = d.lead_id AND l.tenant_id = v_tenant;
  RETURN jsonb_build_object('items', v_items, 'notice_days', c_notice, 'enabled', v_set.enabled,
                            'enforced', v_set.enforced);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_crm_due(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_crm_due(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_data_retention_crm_extend(p_lead_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Lustro DATA_RETENTION_RULES.crmExtensionMonths / crmExtensionReason*.
  c_months constant integer := 12;
  c_reason_min constant integer := 3;
  c_reason_max constant integer := 500;
  v_tenant uuid := public._data_retention_admin_tenant();
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_until timestamptz;
BEGIN
  IF char_length(v_reason) < c_reason_min OR char_length(v_reason) > c_reason_max THEN
    RAISE EXCEPTION 'reason_length' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_leads l
                  WHERE l.id = p_lead_id AND l.tenant_id = v_tenant AND l.anonymized_at IS NULL) THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT GREATEST(now(), COALESCE(max(x.extended_until), now())) + make_interval(months => c_months)
    INTO v_until FROM public.data_retention_crm_extensions x
   WHERE x.tenant_id = v_tenant AND x.lead_id = p_lead_id;
  INSERT INTO public.data_retention_crm_extensions AS x (tenant_id, lead_id, extended_until, reason, created_by,
                                                        created_at)
  VALUES (v_tenant, p_lead_id, v_until, v_reason, auth.uid(), now())
  ON CONFLICT (tenant_id, lead_id) DO UPDATE
     SET extended_until = EXCLUDED.extended_until, reason = EXCLUDED.reason,
         created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at;
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(), 'data_retention.crm_extended', 'crm_lead', p_lead_id,
          jsonb_build_object('extended_until', v_until, 'reason', v_reason));
  PERFORM public._data_retention_emit(v_tenant, 'extension', 'crm_inactive_contacts');
  RETURN jsonb_build_object('lead_id', p_lead_id, 'extended_until', v_until);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_crm_extend(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_crm_extend(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Uruchom teraz.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_retention_run_now(p_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._data_retention_admin_tenant();
  v_result jsonb;
BEGIN
  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'confirmation_required' USING ERRCODE = '22023';
  END IF;
  v_result := public._data_retention_run_tenant(v_tenant, 'manual',
                (public._data_retention_catalog() -> 'rules' ->> 'batch_default')::integer);
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, auth.uid(), 'data_retention.run_manual', 'data_retention_settings', NULL,
          jsonb_build_object('result', (SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object(
                                        'mode', v ->> 'mode', 'affected', v -> 'affected', 'error', v -> 'error')), '{}'::jsonb)
                                        FROM jsonb_each(v_result) AS r(k, v) WHERE jsonb_typeof(v) = 'object'),
                             'busy', COALESCE((v_result ->> 'busy')::boolean, false)));
  PERFORM public._data_retention_emit(v_tenant, 'run');
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_run_now(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_run_now(boolean) TO authenticated, service_role;
