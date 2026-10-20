-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9c-X2, 4/5): PRZEŁĄCZNIK PIKSELA OTWARĆ W MAILACH
-- ŚCIEŻEK. Polecenie właściciela 2026-10-20 (Z-I9b-10, retencja danych).
--
-- DEFEKT
--   Treść zgody newslettera w formularzach zapisu („Wyrażam zgodę na
--   otrzymywanie newslettera i przetwarzanie mojego adresu e-mail w tym
--   celu.", `i18n-public.ts`) nie wspomina pomiaru otwarć i kliknięć -
--   informuje o nim dopiero polityka komunikacji (`/rodo`, sekcja „Pomiar
--   skuteczności wysyłki"). Piksel otwarć w mailach ścieżek (S5) nie ma
--   wyłącznika najemcy, a zapis z piksela jest dostępem do informacji
--   w urządzeniu odbiorcy w rozumieniu art. 5 ust. 3 dyrektywy 2002/58/WE
--   (wytyczne EDPB 2/2023 w sprawie zakresu technicznego tego przepisu).
--   Tekstu prawnego ta migracja NIE zmienia - rekomendacja uzupełnienia
--   treści zgody jest w dzienniku wdrożenia (§21.21).
--
-- ZMIANA (kolumna `journey_settings.open_tracking_enabled` - 20261020161000,
-- domyślnie WŁĄCZONA, czyli zachowanie sprzed X2)
--   A. `journey_record_message_event` - otwarcie przy wyłączonym pomiarze
--      nie jest zapisywane (`open_tracking_disabled`), także z piksela maila
--      wysłanego wcześniej; kliknięcia i wypis bez zmian.
--   B. `journey_contact_for_send` - pole `open_tracking` dla renderu (runner
--      nie wstawia piksela, gdy `false`).
--   C. `admin_journey_settings_get/save` - klucz `open_tracking_enabled`
--      (łatka: tylko boolean, inaczej 22023), ustawienie silnika S5 (UI
--      w S8) i karta „Retencja danych" w `/admin/settings/privacy`.
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020161000. Runner bez tej migracji nie
-- dostaje pola `open_tracking` i wstawia piksel jak dotąd.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (te same sygnatury), bezstanowe
-- REVOKE/GRANT. Zero DDL.
-- DOWÓD: supabase/tests/hub_i9c_data_retention_aggregates_test.sql (piksel),
-- src/lib/journeys/__tests__/render*.test.ts, testy S5 bez zmian asercji.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Zapis zdarzenia: otwarcie przy wyłączonym pomiarze - bez zapisu.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140500
CREATE OR REPLACE FUNCTION public.journey_record_message_event(
  p_message_id text,
  p_kind text,
  p_link_index integer DEFAULT -1,
  p_url text DEFAULT NULL,
  p_machine boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_m public.journey_messages%ROWTYPE;
  v_threshold integer;
  v_machine boolean;
  v_id bigint;
  v_exited integer := 0;
  v_track_opens boolean;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('open', 'click', 'unsubscribe') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_m FROM public.journey_messages m WHERE m.message_id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'unknown_message');
  END IF;
  SELECT s.machine_open_seconds, s.open_tracking_enabled INTO v_threshold, v_track_opens
    FROM public.journey_settings s WHERE s.tenant_id = v_m.tenant_id;
  -- ZMIANA (I9c-X2): najemca wylaczyl pomiar otwarc - piksel z maila
  -- wyslanego wczesniej nie zapisuje zdarzenia (brak wiersza = wlaczony).
  IF p_kind = 'open' AND v_track_opens IS FALSE THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'open_tracking_disabled', 'tenant_id', v_m.tenant_id);
  END IF;
  -- Otwarcie tuż po wysyłce to skaner albo proxy (MPP), nie człowiek.
  v_machine := COALESCE(p_machine, false)
    OR (p_kind = 'open' AND now() - v_m.queued_at < make_interval(secs => COALESCE(v_threshold, 2)));

  INSERT INTO public.journey_message_events (tenant_id, message_id, kind, link_index, url, machine)
  VALUES (
    v_m.tenant_id, v_m.message_id, p_kind,
    CASE WHEN p_kind = 'click' THEN LEAST(GREATEST(COALESCE(p_link_index, 0), 0), 999) ELSE -1 END,
    CASE WHEN p_kind = 'click' THEN left(p_url, 2000) END,
    v_machine
  )
  ON CONFLICT ON CONSTRAINT journey_message_events_dedupe_key DO NOTHING
  RETURNING id INTO v_id;

  IF p_kind = 'unsubscribe' THEN
    v_exited := public._journey_unsubscribe(v_m.tenant_id, v_m.lead_id, v_m.message_id);
  END IF;
  RETURN jsonb_build_object('recorded', v_id IS NOT NULL, 'tenant_id', v_m.tenant_id,
                            'kind', p_kind, 'machine', v_machine, 'exited', v_exited);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_record_message_event(text, text, integer, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_record_message_event(text, text, integer, text, boolean) TO service_role;

COMMENT ON FUNCTION public.journey_record_message_event(text, text, integer, text, boolean) IS
  'Hub S5: otwarcie/kliknięcie/wypis maila ścieżki - najemca z wiadomości, deduplikacja doby, otwarcia maszynowe; wypis wycofuje zgodę (księga), wypisuje subskrybenta z blokadą i kończy aktywne zapisy marketingowe (unsubscribed). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- B) Kontakt do wysyłki: pole `open_tracking` dla renderu.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140200
CREATE OR REPLACE FUNCTION public.journey_contact_for_send(p_enrollment_id uuid, p_node_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_e public.journey_enrollments%ROWTYPE;
  v_lead record;
  v_def record;
  v_settings record;
  v_tenant record;
  v_arm text;
  v_content public.journey_email_contents%ROWTYPE;
  v_locale text;
  v_fallback boolean := false;
  v_payload jsonb;
  v_tier_key text;
  v_plan text;
  v_event text;
  v_club text;
BEGIN
  SELECT * INTO v_e FROM public.journey_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND OR v_e.current_node_id IS DISTINCT FROM p_node_id
     OR v_e.status NOT IN ('active', 'waiting') THEN
    RAISE EXCEPTION 'journey_contact_for_send: not_at_node' USING ERRCODE = 'P0002';
  END IF;
  SELECT l.email, l.email_norm, l.first_name, l.last_name, l.user_id INTO v_lead
    FROM public.crm_leads l WHERE l.id = v_e.lead_id AND l.tenant_id = v_e.tenant_id;
  SELECT d.category, d.name INTO v_def
    FROM public.journey_definitions d WHERE d.id = v_e.journey_id;
  SELECT s.sender_name, s.reply_to, s.open_tracking_enabled INTO v_settings
    FROM (SELECT 1) one LEFT JOIN public.journey_settings s ON s.tenant_id = v_e.tenant_id;
  SELECT t.name, t.domain INTO v_tenant FROM public.tenants t WHERE t.id = v_e.tenant_id;

  -- Ramię testu A/B na ścieżce tego zapisu (ostatni podział przed mailem).
  SELECT sr.outcome INTO v_arm FROM public.journey_step_runs sr
   WHERE sr.enrollment_id = v_e.id AND sr.node_type = 'ab_split' AND sr.status = 'succeeded'
   ORDER BY sr.finished_at DESC NULLS LAST LIMIT 1;

  SELECT * INTO v_content FROM public.journey_email_contents c
   WHERE c.tenant_id = v_e.tenant_id AND c.journey_id = v_e.journey_id
     AND c.version_id = v_e.version_id AND c.node_id = p_node_id
     AND c.variant IN (COALESCE(v_arm, 'A'), 'A')
   ORDER BY (c.variant = COALESCE(v_arm, 'A')) DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ready', false, 'reason', 'content_missing');
  END IF;

  -- Język: subskrybent, potem preferencja konta, domyślnie polski.
  SELECT lower(s.language) INTO v_locale FROM public.newsletter_subscribers s
   WHERE s.tenant_id = v_e.tenant_id AND lower(s.email) = v_lead.email_norm LIMIT 1;
  IF v_locale IS NULL AND v_lead.user_id IS NOT NULL THEN
    SELECT lower(COALESCE(p.prefs ->> 'language', p.prefs ->> 'lang')) INTO v_locale
      FROM public.profiles p WHERE p.id = v_lead.user_id;
  END IF;
  v_locale := CASE WHEN v_locale LIKE 'en%' THEN 'en' ELSE 'pl' END;
  IF v_locale = 'en' AND v_content.subject_en IS NULL THEN
    -- Wersja EN niegotowa: wysyłka po polsku (statystyka `fallbackLocale`).
    v_locale := 'pl';
    v_fallback := true;
  END IF;

  v_payload := COALESCE(v_e.trigger_snapshot -> 'payload', '{}'::jsonb);
  v_tier_key := COALESCE(v_payload ->> 'tier_key',
    CASE WHEN v_lead.user_id IS NOT NULL
         THEN public._membership_tier_for_user(v_e.tenant_id, v_lead.user_id) END);
  SELECT CASE WHEN v_locale = 'en' THEN mt.name_en ELSE mt.name_pl END INTO v_plan
    FROM public.membership_tiers mt WHERE mt.tenant_id = v_e.tenant_id AND mt.key = v_tier_key;
  IF v_payload ->> 'event_id' ~* '^[0-9a-f-]{36}$' THEN
    SELECT CASE WHEN v_locale = 'en' THEN ev.title_en ELSE ev.title_pl END INTO v_event
      FROM public.events ev WHERE ev.id = (v_payload ->> 'event_id')::uuid AND ev.tenant_id = v_e.tenant_id;
  END IF;
  IF v_payload ->> 'club_id' ~* '^[0-9a-f-]{36}$' THEN
    SELECT CASE WHEN v_locale = 'en' THEN c.name_en ELSE c.name_pl END INTO v_club
      FROM public.clubs c WHERE c.id = (v_payload ->> 'club_id')::uuid AND c.tenant_id = v_e.tenant_id
       AND c.visibility <> 'secret';
  END IF;

  RETURN jsonb_build_object(
    'ready', true,
    'enrollment_id', v_e.id, 'tenant_id', v_e.tenant_id, 'journey_id', v_e.journey_id,
    'version_id', v_e.version_id, 'node_id', p_node_id, 'lead_id', v_e.lead_id,
    'is_test', v_e.is_test, 'category', v_def.category,
    'email', lower(btrim(COALESCE(NULLIF(v_lead.email, ''), v_lead.email_norm))),
    'first_name', v_lead.first_name, 'last_name', v_lead.last_name,
    'locale', v_locale, 'fallback_locale', v_fallback,
    'variant', v_arm, 'content_variant', v_content.variant,
    'subject', CASE WHEN v_locale = 'en' THEN v_content.subject_en ELSE v_content.subject_pl END,
    'preheader', CASE WHEN v_locale = 'en' THEN v_content.preheader_en ELSE v_content.preheader_pl END,
    'doc', v_content.doc,
    'sender_name', v_settings.sender_name, 'reply_to', v_settings.reply_to,
    -- ZMIANA (I9c-X2): piksel otwarc w renderze (brak wiersza = wlaczony).
    'open_tracking', COALESCE(v_settings.open_tracking_enabled, true),
    'site_name', v_tenant.name, 'site_domain', v_tenant.domain,
    'vars', jsonb_strip_nulls(jsonb_build_object(
      'plan_name', v_plan, 'event_title', v_event, 'club_name', v_club,
      'trial_ends_at', v_payload ->> 'trial_ends_at',
      'period_month', v_payload ->> 'period_month'))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.journey_contact_for_send(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_contact_for_send(uuid, text) TO service_role;

COMMENT ON FUNCTION public.journey_contact_for_send(uuid, text) IS
  'Hub S5: adres, imię, język, treść wariantu i zmienne maila ścieżki - WYŁĄCZNIE service_role (PII tylko w pamięci runnera).';

-- ----------------------------------------------------------------------------
-- C) Ustawienia silnika: klucz `open_tracking_enabled`.
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20261020140300
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
    'open_tracking_enabled', COALESCE(v_s.open_tracking_enabled, true),
    'updated_at', CASE WHEN v_exists THEN v_s.updated_at END,
    'exists', v_exists
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_settings_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_settings_get() TO authenticated, service_role;

-- CIALO-Z: 20261020140300
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
    'default_task_assignee_id', 'machine_open_seconds', 'sender_name', 'reply_to',
    'open_tracking_enabled'
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
  IF p_patch ? 'open_tracking_enabled' AND jsonb_typeof(p_patch -> 'open_tracking_enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'open_tracking_enabled_invalid' USING ERRCODE = '22023';
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
    default_task_assignee_id, machine_open_seconds, sender_name, reply_to, open_tracking_enabled, updated_by
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
    CASE WHEN p_patch ? 'open_tracking_enabled' THEN (p_patch ->> 'open_tracking_enabled')::boolean
         ELSE COALESCE(v_cur.open_tracking_enabled, true) END,
    auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
     SET enabled = EXCLUDED.enabled, marketing_cap_per_7d = EXCLUDED.marketing_cap_per_7d,
         quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
         timezone = EXCLUDED.timezone, default_task_assignee_id = EXCLUDED.default_task_assignee_id,
         machine_open_seconds = EXCLUDED.machine_open_seconds, sender_name = EXCLUDED.sender_name,
         reply_to = EXCLUDED.reply_to, open_tracking_enabled = EXCLUDED.open_tracking_enabled,
         updated_by = EXCLUDED.updated_by;

  -- Agregat = najemca (ustawienia nie mają ścieżki); op `settings` odświeża panel.
  PERFORM public.emit_domain_event(v_tenant, 'journey', v_tenant::text, 'journey.changed.v1',
    jsonb_build_object('journey_id', NULL, 'status', NULL, 'version', NULL, 'op', 'settings',
                       'keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_patch) k)));
  RETURN public.admin_journey_settings_get();
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_settings_save(jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_settings_save(jsonb, timestamptz) TO authenticated, service_role;
