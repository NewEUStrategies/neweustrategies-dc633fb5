-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y1, 8/8): RETENCJA DANYCH - RDZEŃ KATALOGU
-- DLA CZTERECH NOWYCH KATEGORII (decyzje właściciela 2026-10-20: Z-I9c-01,
-- Z-I9c-07, Z-I9c-08). JEDNA migracja rdzenia (decyzja wykonawcza
-- orkiestratora): CHECK-i ustawień i przebiegów, katalog, karencja nowych
-- kategorii, dyspozytor przebiegu i podglądu, termin karencji w nagłówku
-- karty.
--
-- DEFEKT: funkcje kategorii z 20261020161500-162100 istnieją, ale katalog
-- (`_data_retention_catalog`), CHECK-i i dyspozytor znają tylko 9 kategorii
-- I9c - karta ich nie pokazuje, zadanie ich nie wykonuje. Bez seedu
-- karencji istniejący najemcy weszliby w nowe kategorie od razu w tryb
-- WYKONANIA (brak wiersza = założenie najemcy + 14 dni, czyli przeszłość).
-- Nagłówek karty brał najwcześniejszy termin karencji ze WSZYSTKICH
-- kategorii - przy starych już wykonywanych i nowych w podglądzie
-- pokazałby „podgląd do <data z przeszłości>". Podgląd karty dla kategorii
-- WYŁĄCZONEJ zwracał liczbę równą sufitowi zamiast „wyłączona" (I9c).
--
-- ZMIANA
--   A. CHECK `data_retention_settings_category_check`,
--      `data_retention_settings_period_check` i
--      `data_retention_runs_category_check` (+ 4 klucze; zakresy = lustro
--      `DATA_RETENTION_PERIODS`): `metered_views` 2-13 (dom. 3),
--      `newsletter_inactive` 6-24 (12), `event_attendees` 12-36 (24),
--      `club_applications` 12-36 (24). Kolejność listy = kolejność karty
--      = `[...DATA_RETENTION_EDITABLE_CATEGORIES, ...STATUTORY]` (TS).
--      Dziennik przebiegów: NOT VALID + VALIDATE (krótka blokada przy
--      dodaniu, skan bez blokady zapisu).
--   B. `_data_retention_catalog` (CIALO-Z niżej): nowe kategorie i reguły
--      `newsletter_response_days` (30) i `newsletter_daily_cap` (200) na
--      końcu literału reguł (lustro `DATA_RETENTION_RULES`).
--   C. Karencja 14 dni dla NOWYCH kluczy u istniejących najemców (wiersz
--      `enforce_after = now() + 14 dni`; stare kategorie bez zmian).
--      „Włącz teraz"/„Przesuń" nadal przestawia wszystkie kategorie naraz.
--   D. `_data_retention_run_tenant` (CIALO-Z niżej) - gałęzie nowych
--      kategorii (bez gałęzi wynik byłby NULL, a parser karty rzuca).
--   E. `admin_data_retention_preview` (CIALO-Z niżej) - liczby nowych
--      kategorii (odczyty licznika liczone wprost - funkcja kategorii
--      pieczętuje, a podgląd jest tylko do odczytu). Naprawa I9c: kategoria
--      WYŁĄCZONA dostawała `count` = sufit (LEAST pomija NULL), a karta
--      pokazuje „wyłączona" tylko przy `count` NULL.
--   F. `admin_data_retention_get` (CIALO-Z niżej) - termin karencji =
--      najbliższy termin kategorii wciąż w podglądzie (kształt bez zmian).
--
-- KOLEJNOŚĆ WDROŻENIA: OSTATNIA migracja I9d-Y1 - po 20261020161500-162100
-- (funkcje kategorii), więc katalog nigdy nie wskazuje funkcji, której
-- nie ma. Front (stałe TS, parser) wdrożyć razem albo wcześniej: parser
-- karty odrzuca nieznaną kategorię (karta pokazałaby błąd, nie dane).
-- IDEMPOTENTNA: DROP CONSTRAINT IF EXISTS + ADD, CREATE OR REPLACE FUNCTION,
-- seed `ON CONFLICT DO NOTHING`, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9c_data_retention_test.sql (13 kategorii,
-- przebieg bez błędów, idempotencja), supabase/tests/hub_i9d_*_test.sql,
-- src/lib/privacy/__tests__/dataRetentionParity.test.ts (najnowsza
-- definicja CHECK i katalogu).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) CHECK-i kategorii i zakresów.
-- ----------------------------------------------------------------------------
SET lock_timeout = '5s';
ALTER TABLE public.data_retention_settings DROP CONSTRAINT IF EXISTS data_retention_settings_category_check;
ALTER TABLE public.data_retention_settings ADD CONSTRAINT data_retention_settings_category_check CHECK (category IN (
  'paywall_metering', 'metered_views', 'email_engagement', 'email_send_log', 'newsletter_inactive',
  'crm_inactive_contacts', 'event_attendees', 'club_applications', 'audit_log', 'journey_enrollments',
  'cancellation_surveys', 'crm_customers', 'consent_log'));
-- Zakres per kategoria = DATA_RETENTION_PERIODS (TS). Kategoria ustawowa
-- nie ma okresu i nie da się jej wyłączyć (minimum ustawowe).
ALTER TABLE public.data_retention_settings DROP CONSTRAINT IF EXISTS data_retention_settings_period_check;
ALTER TABLE public.data_retention_settings ADD CONSTRAINT data_retention_settings_period_check CHECK (CASE category
  WHEN 'paywall_metering' THEN period_months IS NOT NULL AND period_months BETWEEN 3 AND 25
  WHEN 'metered_views' THEN period_months IS NOT NULL AND period_months BETWEEN 2 AND 13
  WHEN 'email_engagement' THEN period_months IS NOT NULL AND period_months BETWEEN 3 AND 25
  WHEN 'email_send_log' THEN period_months IS NOT NULL AND period_months BETWEEN 6 AND 25
  WHEN 'newsletter_inactive' THEN period_months IS NOT NULL AND period_months BETWEEN 6 AND 24
  WHEN 'crm_inactive_contacts' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36
  WHEN 'event_attendees' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36
  WHEN 'club_applications' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36
  WHEN 'audit_log' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 60
  WHEN 'journey_enrollments' THEN period_months IS NOT NULL AND period_months BETWEEN 6 AND 25
  WHEN 'cancellation_surveys' THEN period_months IS NOT NULL AND period_months BETWEEN 12 AND 36
  WHEN 'crm_customers' THEN period_months IS NULL AND enabled
  WHEN 'consent_log' THEN period_months IS NULL AND enabled
  ELSE false END);
-- Bez rozszerzenia tego CHECK wiersz przebiegu nowej kategorii rzuca 23514
-- także z bloku EXCEPTION dyspozytora - padłby cały przebieg najemcy.
ALTER TABLE public.data_retention_runs DROP CONSTRAINT IF EXISTS data_retention_runs_category_check;
ALTER TABLE public.data_retention_runs ADD CONSTRAINT data_retention_runs_category_check CHECK (category IN (
  'paywall_metering', 'metered_views', 'email_engagement', 'email_send_log', 'newsletter_inactive',
  'crm_inactive_contacts', 'event_attendees', 'club_applications', 'audit_log', 'journey_enrollments',
  'cancellation_surveys', 'crm_customers', 'consent_log')) NOT VALID;
RESET lock_timeout;
ALTER TABLE public.data_retention_runs VALIDATE CONSTRAINT data_retention_runs_category_check;

-- ----------------------------------------------------------------------------
-- B) Katalog (lustro TS). Kolejność = kolejność wierszy karty i przebiegu.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020161000
CREATE OR REPLACE FUNCTION public._data_retention_catalog()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'categories', jsonb_build_array(
      jsonb_build_object('key', 'paywall_metering', 'default', 13, 'min', 3, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'metered_views', 'default', 3, 'min', 2, 'max', 13, 'editable', true),
      jsonb_build_object('key', 'email_engagement', 'default', 13, 'min', 3, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'email_send_log', 'default', 13, 'min', 6, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'newsletter_inactive', 'default', 12, 'min', 6, 'max', 24, 'editable', true),
      jsonb_build_object('key', 'crm_inactive_contacts', 'default', 24, 'min', 12, 'max', 36, 'editable', true),
      jsonb_build_object('key', 'event_attendees', 'default', 24, 'min', 12, 'max', 36, 'editable', true),
      jsonb_build_object('key', 'club_applications', 'default', 24, 'min', 12, 'max', 36, 'editable', true),
      jsonb_build_object('key', 'audit_log', 'default', 24, 'min', 12, 'max', 60, 'editable', true),
      jsonb_build_object('key', 'journey_enrollments', 'default', 13, 'min', 6, 'max', 25, 'editable', true),
      jsonb_build_object('key', 'cancellation_surveys', 'default', 24, 'min', 12, 'max', 36, 'editable', true),
      jsonb_build_object('key', 'crm_customers', 'default', NULL, 'min', NULL, 'max', NULL, 'editable', false),
      jsonb_build_object('key', 'consent_log', 'default', NULL, 'min', NULL, 'max', NULL, 'editable', false)),
    'rules', jsonb_build_object(
      'audit_network_months', 12, 'consent_proof_years', 6, 'claims_limitation_years', 6,
      'grace_days', 14, 'postpone_max_days', 90, 'crm_extension_months', 12, 'crm_notice_days', 30,
      'crm_extension_reason_min', 3, 'crm_extension_reason_max', 500,
      'batch_default', 5000, 'batch_max', 50000,
      'newsletter_response_days', 30, 'newsletter_daily_cap', 200))
$$;
REVOKE ALL ON FUNCTION public._data_retention_catalog() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._data_retention_catalog() IS
  'Retencja danych (I9c-X2 + I9d-Y1): kategorie (okres domyślny, zakres, edytowalność) i reguły stałe - lustro src/lib/privacy/dataRetention.ts (parytet dataRetentionParity.test.ts). Wewnętrzny.';

-- ----------------------------------------------------------------------------
-- C) Karencja 14 dni dla NOWYCH kategorii u istniejących najemców.
-- ----------------------------------------------------------------------------
INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
SELECT t.id, c.item ->> 'key', (c.item ->> 'default')::smallint, true, now() + interval '14 days'
  FROM public.tenants t
 CROSS JOIN jsonb_array_elements(public._data_retention_catalog() -> 'categories') AS c(item)
 WHERE c.item ->> 'key' IN ('metered_views', 'newsletter_inactive', 'event_attendees', 'club_applications')
ON CONFLICT (tenant_id, category) DO NOTHING;

-- ----------------------------------------------------------------------------
-- D) Dyspozytor przebiegu najemcy.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020161100
CREATE OR REPLACE FUNCTION public._data_retention_run_tenant(
  p_tenant uuid, p_trigger text, p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 50000);
  v_set record;
  v_crm_cut timestamptz;
  v_res jsonb;
  v_out jsonb := '{}'::jsonb;
  v_started timestamptz;
  v_cutoff timestamptz;
BEGIN
  IF p_tenant IS NULL OR p_trigger NOT IN ('schedule', 'manual') THEN
    RAISE EXCEPTION 'run_invalid' USING ERRCODE = '22023';
  END IF;
  -- Jeden przebieg najemcy naraz (noc i „uruchom teraz" z dwóch kart).
  IF NOT pg_try_advisory_xact_lock(hashtextextended('data_retention_run:' || p_tenant::text, 0)) THEN
    RETURN jsonb_build_object('busy', true);
  END IF;
  SELECT e.cutoff INTO v_crm_cut
    FROM public._data_retention_effective(p_tenant) e WHERE e.category = 'crm_inactive_contacts';

  FOR v_set IN SELECT * FROM public._data_retention_effective(p_tenant) LOOP
    CONTINUE WHEN NOT v_set.enabled;
    -- Klient CRM: ten sam próg nieaktywności co kontakty (kategoria ustawowa
    -- go nie ma), termin ustawowy sprawdza funkcja kategorii.
    v_cutoff := CASE v_set.category
                  WHEN 'crm_customers' THEN v_crm_cut
                  WHEN 'consent_log' THEN NULL
                  ELSE v_set.cutoff END;
    v_started := clock_timestamp();
    BEGIN
      v_res := CASE v_set.category
        WHEN 'paywall_metering' THEN public._data_retention_paywall_metering(p_tenant, v_cutoff, v_set.enforced, v_limit)
        -- ZMIANA (I9d): kategorie decyzji właściciela 2 (Y1).
        WHEN 'metered_views' THEN public._data_retention_metered_views(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'newsletter_inactive' THEN public._data_retention_newsletter_inactive(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'event_attendees' THEN public._data_retention_event_attendees(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'club_applications' THEN public._data_retention_club_applications(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'email_engagement' THEN public._data_retention_email_engagement(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'email_send_log' THEN public._data_retention_email_send_log(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'crm_inactive_contacts' THEN public._data_retention_crm(p_tenant, v_cutoff, v_set.enforced, v_limit, false)
        WHEN 'crm_customers' THEN public._data_retention_crm(p_tenant, v_cutoff, v_set.enforced, v_limit, true)
        WHEN 'audit_log' THEN public._data_retention_audit_log(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'journey_enrollments' THEN public._data_retention_journey_enrollments(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'cancellation_surveys' THEN public._data_retention_cancellation_surveys(p_tenant, v_cutoff, v_set.enforced, v_limit)
        WHEN 'consent_log' THEN public._data_retention_consent_log(p_tenant, v_set.enforced, v_limit)
      END;
      INSERT INTO public.data_retention_runs (tenant_id, category, mode, run_trigger, cutoff, affected, backlog,
                                              started_at, finished_at)
      VALUES (p_tenant, v_set.category, CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END, p_trigger,
              COALESCE((v_res ->> 'cutoff')::timestamptz, v_cutoff), COALESCE((v_res ->> 'affected')::integer, 0),
              COALESCE((v_res ->> 'backlog')::boolean, false), v_started, clock_timestamp());
    EXCEPTION WHEN OTHERS THEN
      -- Kategoria z błędem nie zatrzymuje pozostałych; w dzienniku tylko kod.
      v_res := jsonb_build_object('error', SQLSTATE);
      INSERT INTO public.data_retention_runs (tenant_id, category, mode, run_trigger, cutoff, error_code,
                                              started_at, finished_at)
      VALUES (p_tenant, v_set.category, CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END, p_trigger,
              v_cutoff, SQLSTATE, v_started, clock_timestamp());
    END;
    v_out := v_out || jsonb_build_object(v_set.category,
      v_res || jsonb_build_object('mode', CASE WHEN v_set.enforced THEN 'execute' ELSE 'preview' END));
  END LOOP;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public._data_retention_run_tenant(uuid, text, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Podgląd najbliższego przebiegu (bez zapisu).
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_preview (cap, categories)
-- CIALO-Z: 20261020161400
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
        -- ZMIANA (I9d): odczyty licznika liczone tu wprost - funkcja kategorii
        -- pieczętuje lejek (zapis), a podgląd jest tylko do odczytu.
        WHEN 'metered_views' THEN
          (SELECT count(*) FROM (SELECT 1 FROM public.metered_views mv WHERE mv.tenant_id = v_tenant
             AND mv.created_at < v_day AND mv.period_month < date_trunc('month', now())::date LIMIT c_cap) x)
          + (SELECT count(*) FROM (SELECT 1 FROM public.metering_event_log ml WHERE ml.tenant_id = v_tenant
             AND ml.occurred_at < v_day AND ml.entity_id IS NOT NULL LIMIT c_cap) x)
          + (SELECT count(*) FROM (SELECT 1 FROM public.paywall_hits ph WHERE ph.tenant_id = v_tenant
             AND ph.day < (v_set.cutoff AT TIME ZONE 'UTC')::date AND ph.entity_id IS NOT NULL LIMIT c_cap) x)
        WHEN 'newsletter_inactive' THEN
          (public._data_retention_newsletter_inactive(v_tenant, v_set.cutoff, false, c_cap) ->> 'affected')::bigint
        WHEN 'event_attendees' THEN
          (public._data_retention_event_attendees(v_tenant, v_set.cutoff, false, c_cap) ->> 'affected')::bigint
        WHEN 'club_applications' THEN
          (public._data_retention_club_applications(v_tenant, v_set.cutoff, false, c_cap) ->> 'affected')::bigint
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
      -- ZMIANA (I9d): kategoria wyłączona = `count` NULL. LEAST pomija NULL,
      -- więc dotąd wyłączona kategoria dostawała liczbę równą sufitowi.
      'count', CASE WHEN v_n IS NOT NULL THEN LEAST(v_n, c_cap) END,
      'capped', COALESCE(v_n >= c_cap, false)));
  END LOOP;
  RETURN jsonb_build_object('cap', c_cap, 'categories', v_out);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_data_retention_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_data_retention_preview() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- F) Odczyt karty: termin karencji kategorii wciąż w podglądzie.
-- ----------------------------------------------------------------------------
-- rpc-shape: admin_data_retention_get (rules, categories, grace, funnel_cut,
-- journey_sealed, open_tracking_enabled, journey_settings_updated_at,
-- last_scheduled_run_at)
-- CIALO-Z: 20261020161400
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

  -- ZMIANA (I9d): termin karencji = najbliższy termin kategorii WCIĄŻ
  -- w podglądzie - nowa kategoria (14 dni) obok starych, już wykonywanych,
  -- nie może pokazać „podgląd do <data z przeszłości>".
  SELECT jsonb_build_object('enforce_after', COALESCE(min(e.enforce_after) FILTER (WHERE NOT e.enforced),
                                                      min(e.enforce_after)),
                            'enforce_after_max', max(e.enforce_after),
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
