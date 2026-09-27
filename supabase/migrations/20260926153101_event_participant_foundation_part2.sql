-- CZESC 2/2 MIGRACJI 20260926153100_event_participant_foundation.sql
-- migration-split: part 2/2 of 20260926153100_event_participant_foundation.sql
--
-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl
-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts
-- pocial oryginal na czesci po najwyzej 46080 B - wylacznie na granicach
-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS
-- i REVOKE. Czesci wdraza sie PO KOLEI: 20260926153100_event_participant_foundation.sql,
-- potem 20260926153101_event_participant_foundation_part2.sql .. 20260926153101_event_participant_foundation_part2.sql.
-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu
-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.
-- events-harness: include

-- LOCKS: event_participant_settings row (FOR UPDATE) only.
CREATE OR REPLACE FUNCTION public.admin_event_participant_settings_save(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_uid uuid := auth.uid();
  v_event uuid;
  v_row public.event_participant_settings;
  v_key text;
  v_j jsonb;
  v_num numeric;
  v_text text;
  v_leads integer[];
  v_keys text[];
  i integer;
  c_bool_keys CONSTANT text[] := ARRAY[
    'calendar_export_enabled', 'reminders_enabled', 'session_reminders_enabled',
    'reminder_sms_enabled', 'transfer_enabled', 'certificate_enabled',
    'certificate_require_survey', 'survey_enabled', 'survey_anonymous', 'survey_invite_enabled'];
  c_text_keys CONSTANT text[] := ARRAY[
    'certificate_issuer_name', 'certificate_signatory_name', 'certificate_signatory_title_pl',
    'certificate_signatory_title_en', 'certificate_body_pl', 'certificate_body_en',
    'survey_intro_pl', 'survey_intro_en'];
  c_text_max CONSTANT integer[] := ARRAY[160, 120, 120, 120, 600, 600, 600, 600];
  c_known_keys CONSTANT text[] := ARRAY[
    'calendar_export_enabled', 'reminders_enabled', 'reminder_event_leads_minutes',
    'session_reminders_enabled', 'session_reminder_lead_minutes', 'reminder_sms_enabled',
    'transfer_enabled', 'transfer_deadline_hours', 'refund_mode', 'refund_deadline_hours',
    'waitlist_offer_hours', 'certificate_enabled', 'certificate_eligibility',
    'certificate_min_sessions', 'certificate_require_survey', 'certificate_hours',
    'certificate_issuer_name', 'certificate_signatory_name', 'certificate_signatory_title_pl',
    'certificate_signatory_title_en', 'certificate_body_pl', 'certificate_body_en',
    'survey_enabled', 'survey_anonymous', 'survey_close_after_days', 'survey_min_results',
    'survey_invite_enabled', 'survey_intro_pl', 'survey_intro_en'];
BEGIN
  v_tenant := public.assert_event_admin_tenant();

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_request: payload must be a JSON object';
  END IF;
  IF COALESCE(p_payload->>'event_id', '')
       !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'invalid_request: event_id is required';
  END IF;
  v_event := (p_payload->>'event_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'not_found: event does not exist in this tenant';
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_keys
    FROM jsonb_object_keys(p_payload) k
   WHERE k = ANY (c_known_keys);
  IF v_keys IS NULL THEN
    -- Sam event_id: nic do zapisania, nic do ogloszenia.
    RETURN public.admin_event_participant_settings_get(v_event);
  END IF;

  SELECT s.* INTO v_row
    FROM public.event_participant_settings s
   WHERE s.tenant_id = v_tenant AND s.event_id = v_event
     FOR UPDATE;
  IF NOT FOUND THEN
    v_row := public._event_participant_settings_effective(v_tenant, v_event);
  END IF;

  -- ── Walidacja KAZDEJ wartosci PRZED zapisem; wynik w lokalnym wierszu ────
  -- Rzutowania stoja w OSOBNYCH instrukcjach po sprawdzeniu typu JSON:
  -- planista nie gwarantuje kolejnosci wyliczania warunkow w jednym IF.
  FOREACH v_key IN ARRAY c_bool_keys LOOP
    CONTINUE WHEN NOT (p_payload ? v_key);
    IF jsonb_typeof(p_payload->v_key) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'invalid_boolean: %', v_key;
    END IF;
    CASE v_key
      WHEN 'calendar_export_enabled' THEN v_row.calendar_export_enabled := (p_payload->>v_key)::boolean;
      WHEN 'reminders_enabled' THEN v_row.reminders_enabled := (p_payload->>v_key)::boolean;
      WHEN 'session_reminders_enabled' THEN v_row.session_reminders_enabled := (p_payload->>v_key)::boolean;
      WHEN 'reminder_sms_enabled' THEN v_row.reminder_sms_enabled := (p_payload->>v_key)::boolean;
      WHEN 'transfer_enabled' THEN v_row.transfer_enabled := (p_payload->>v_key)::boolean;
      WHEN 'certificate_enabled' THEN v_row.certificate_enabled := (p_payload->>v_key)::boolean;
      WHEN 'certificate_require_survey' THEN v_row.certificate_require_survey := (p_payload->>v_key)::boolean;
      WHEN 'survey_enabled' THEN v_row.survey_enabled := (p_payload->>v_key)::boolean;
      WHEN 'survey_anonymous' THEN v_row.survey_anonymous := (p_payload->>v_key)::boolean;
      ELSE v_row.survey_invite_enabled := (p_payload->>v_key)::boolean;
    END CASE;
  END LOOP;

  IF p_payload ? 'reminder_event_leads_minutes' THEN
    v_j := p_payload->'reminder_event_leads_minutes';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_j) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'number') THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_j) x
       WHERE x::numeric % 1 <> 0 OR x::numeric < 15 OR x::numeric > 10080
    ) THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::integer ORDER BY x::integer DESC), '{}'::integer[])
      INTO v_leads
      FROM jsonb_array_elements_text(v_j) x;
    IF cardinality(v_leads) > 4 THEN
      RAISE EXCEPTION 'invalid_reminder_leads: expected an array of at most 4 integers between 15 and 10080';
    END IF;
    v_row.reminder_event_leads_minutes := v_leads;
  END IF;

  IF p_payload ? 'session_reminder_lead_minutes' THEN
    v_j := p_payload->'session_reminder_lead_minutes';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_session_lead: session_reminder_lead_minutes must be an integer between 5 and 240';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 5 OR v_num > 240 THEN
      RAISE EXCEPTION 'invalid_session_lead: session_reminder_lead_minutes must be an integer between 5 and 240';
    END IF;
    v_row.session_reminder_lead_minutes := v_num::integer;
  END IF;

  IF p_payload ? 'transfer_deadline_hours' THEN
    v_j := p_payload->'transfer_deadline_hours';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_transfer_deadline: transfer_deadline_hours must be an integer between 0 and 720';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 0 OR v_num > 720 THEN
      RAISE EXCEPTION 'invalid_transfer_deadline: transfer_deadline_hours must be an integer between 0 and 720';
    END IF;
    v_row.transfer_deadline_hours := v_num::integer;
  END IF;

  IF p_payload ? 'refund_mode' THEN
    v_j := p_payload->'refund_mode';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_refund_mode: refund_mode must be policy or none';
    END IF;
    IF (v_j #>> '{}') NOT IN ('policy', 'none') THEN
      RAISE EXCEPTION 'invalid_refund_mode: refund_mode must be policy or none';
    END IF;
    v_row.refund_mode := v_j #>> '{}';
  END IF;

  IF p_payload ? 'refund_deadline_hours' THEN
    v_j := p_payload->'refund_deadline_hours';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_refund_deadline: refund_deadline_hours must be an integer between 0 and 2160';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 0 OR v_num > 2160 THEN
      RAISE EXCEPTION 'invalid_refund_deadline: refund_deadline_hours must be an integer between 0 and 2160';
    END IF;
    v_row.refund_deadline_hours := v_num::integer;
  END IF;

  IF p_payload ? 'waitlist_offer_hours' THEN
    v_j := p_payload->'waitlist_offer_hours';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_offer_hours: waitlist_offer_hours must be an integer between 2 and 168';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 2 OR v_num > 168 THEN
      RAISE EXCEPTION 'invalid_offer_hours: waitlist_offer_hours must be an integer between 2 and 168';
    END IF;
    v_row.waitlist_offer_hours := v_num::integer;
  END IF;

  IF p_payload ? 'certificate_eligibility' THEN
    v_j := p_payload->'certificate_eligibility';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_certificate_eligibility: expected attended, sessions_min or confirmed';
    END IF;
    IF (v_j #>> '{}') NOT IN ('attended', 'sessions_min', 'confirmed') THEN
      RAISE EXCEPTION 'invalid_certificate_eligibility: expected attended, sessions_min or confirmed';
    END IF;
    v_row.certificate_eligibility := v_j #>> '{}';
  END IF;

  IF p_payload ? 'certificate_min_sessions' THEN
    v_j := p_payload->'certificate_min_sessions';
    IF jsonb_typeof(v_j) = 'null' THEN
      v_row.certificate_min_sessions := NULL;
    ELSE
      IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_certificate_min_sessions: certificate_min_sessions must be null or an integer between 1 and 100';
      END IF;
      v_num := (v_j #>> '{}')::numeric;
      IF v_num % 1 <> 0 OR v_num < 1 OR v_num > 100 THEN
        RAISE EXCEPTION 'invalid_certificate_min_sessions: certificate_min_sessions must be null or an integer between 1 and 100';
      END IF;
      v_row.certificate_min_sessions := v_num::integer;
    END IF;
  END IF;

  IF p_payload ? 'certificate_hours' THEN
    v_j := p_payload->'certificate_hours';
    IF jsonb_typeof(v_j) = 'null' THEN
      v_row.certificate_hours := NULL;
    ELSE
      IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'invalid_certificate_hours: certificate_hours must be null or a number greater than 0 and at most 999';
      END IF;
      -- Zaokraglenie PRZED sprawdzeniem zakresu: numeric(5,2) zaokragla przy
      -- zapisie, wiec 0.001 dawalo 0.00 (CHECK) a 999.999 - przepelnienie.
      v_num := round((v_j #>> '{}')::numeric, 2);
      IF v_num <= 0 OR v_num > 999 THEN
        RAISE EXCEPTION 'invalid_certificate_hours: certificate_hours must be null or a number greater than 0 and at most 999';
      END IF;
      v_row.certificate_hours := v_num;
    END IF;
  END IF;

  FOR i IN 1 .. array_length(c_text_keys, 1) LOOP
    v_key := c_text_keys[i];
    CONTINUE WHEN NOT (p_payload ? v_key);
    v_j := p_payload->v_key;
    IF jsonb_typeof(v_j) = 'null' THEN
      v_text := NULL;
    ELSIF jsonb_typeof(v_j) = 'string' THEN
      v_text := NULLIF(btrim(v_j #>> '{}'), '');
    ELSE
      RAISE EXCEPTION 'invalid_text_length: %', v_key;
    END IF;
    IF v_text IS NOT NULL AND char_length(v_text) > c_text_max[i] THEN
      RAISE EXCEPTION 'invalid_text_length: %', v_key;
    END IF;
    CASE v_key
      WHEN 'certificate_issuer_name' THEN v_row.certificate_issuer_name := v_text;
      WHEN 'certificate_signatory_name' THEN v_row.certificate_signatory_name := v_text;
      WHEN 'certificate_signatory_title_pl' THEN v_row.certificate_signatory_title_pl := v_text;
      WHEN 'certificate_signatory_title_en' THEN v_row.certificate_signatory_title_en := v_text;
      WHEN 'certificate_body_pl' THEN v_row.certificate_body_pl := v_text;
      WHEN 'certificate_body_en' THEN v_row.certificate_body_en := v_text;
      WHEN 'survey_intro_pl' THEN v_row.survey_intro_pl := v_text;
      ELSE v_row.survey_intro_en := v_text;
    END CASE;
  END LOOP;

  IF p_payload ? 'survey_close_after_days' THEN
    v_j := p_payload->'survey_close_after_days';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_survey_close_days: survey_close_after_days must be an integer between 1 and 90';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 1 OR v_num > 90 THEN
      RAISE EXCEPTION 'invalid_survey_close_days: survey_close_after_days must be an integer between 1 and 90';
    END IF;
    v_row.survey_close_after_days := v_num::integer;
  END IF;

  IF p_payload ? 'survey_min_results' THEN
    v_j := p_payload->'survey_min_results';
    IF jsonb_typeof(v_j) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'invalid_survey_min_results: survey_min_results must be an integer between 5 and 50';
    END IF;
    v_num := (v_j #>> '{}')::numeric;
    IF v_num % 1 <> 0 OR v_num < 5 OR v_num > 50 THEN
      RAISE EXCEPTION 'invalid_survey_min_results: survey_min_results must be an integer between 5 and 50';
    END IF;
    v_row.survey_min_results := v_num::integer;
  END IF;

  -- Regula miedzypolowa liczona na WIERSZU WYNIKOWYM (zapisany stan + podane
  -- klucze), nie na samym ladunku.
  IF v_row.certificate_eligibility = 'sessions_min' AND v_row.certificate_min_sessions IS NULL THEN
    RAISE EXCEPTION 'invalid_certificate_min_sessions: sessions_min eligibility requires certificate_min_sessions';
  END IF;

  -- ── Zapis: WYLACZNIE podane klucze (brak klucza = bez zmian) ─────────────
  INSERT INTO public.event_participant_settings AS s (
    tenant_id, event_id,
    calendar_export_enabled, reminders_enabled, reminder_event_leads_minutes,
    session_reminders_enabled, session_reminder_lead_minutes, reminder_sms_enabled,
    transfer_enabled, transfer_deadline_hours, refund_mode, refund_deadline_hours,
    waitlist_offer_hours, certificate_enabled, certificate_eligibility,
    certificate_min_sessions, certificate_require_survey, certificate_hours,
    certificate_issuer_name, certificate_signatory_name, certificate_signatory_title_pl,
    certificate_signatory_title_en, certificate_body_pl, certificate_body_en,
    survey_enabled, survey_anonymous, survey_close_after_days, survey_min_results,
    survey_invite_enabled, survey_intro_pl, survey_intro_en, updated_by
  ) VALUES (
    v_tenant, v_event,
    v_row.calendar_export_enabled, v_row.reminders_enabled, v_row.reminder_event_leads_minutes,
    v_row.session_reminders_enabled, v_row.session_reminder_lead_minutes, v_row.reminder_sms_enabled,
    v_row.transfer_enabled, v_row.transfer_deadline_hours, v_row.refund_mode, v_row.refund_deadline_hours,
    v_row.waitlist_offer_hours, v_row.certificate_enabled, v_row.certificate_eligibility,
    v_row.certificate_min_sessions, v_row.certificate_require_survey, v_row.certificate_hours,
    v_row.certificate_issuer_name, v_row.certificate_signatory_name, v_row.certificate_signatory_title_pl,
    v_row.certificate_signatory_title_en, v_row.certificate_body_pl, v_row.certificate_body_en,
    v_row.survey_enabled, v_row.survey_anonymous, v_row.survey_close_after_days, v_row.survey_min_results,
    v_row.survey_invite_enabled, v_row.survey_intro_pl, v_row.survey_intro_en, v_uid
  )
  ON CONFLICT (tenant_id, event_id) DO UPDATE SET
    calendar_export_enabled = CASE WHEN p_payload ? 'calendar_export_enabled' THEN EXCLUDED.calendar_export_enabled ELSE s.calendar_export_enabled END,
    reminders_enabled = CASE WHEN p_payload ? 'reminders_enabled' THEN EXCLUDED.reminders_enabled ELSE s.reminders_enabled END,
    reminder_event_leads_minutes = CASE WHEN p_payload ? 'reminder_event_leads_minutes' THEN EXCLUDED.reminder_event_leads_minutes ELSE s.reminder_event_leads_minutes END,
    session_reminders_enabled = CASE WHEN p_payload ? 'session_reminders_enabled' THEN EXCLUDED.session_reminders_enabled ELSE s.session_reminders_enabled END,
    session_reminder_lead_minutes = CASE WHEN p_payload ? 'session_reminder_lead_minutes' THEN EXCLUDED.session_reminder_lead_minutes ELSE s.session_reminder_lead_minutes END,
    reminder_sms_enabled = CASE WHEN p_payload ? 'reminder_sms_enabled' THEN EXCLUDED.reminder_sms_enabled ELSE s.reminder_sms_enabled END,
    transfer_enabled = CASE WHEN p_payload ? 'transfer_enabled' THEN EXCLUDED.transfer_enabled ELSE s.transfer_enabled END,
    transfer_deadline_hours = CASE WHEN p_payload ? 'transfer_deadline_hours' THEN EXCLUDED.transfer_deadline_hours ELSE s.transfer_deadline_hours END,
    refund_mode = CASE WHEN p_payload ? 'refund_mode' THEN EXCLUDED.refund_mode ELSE s.refund_mode END,
    refund_deadline_hours = CASE WHEN p_payload ? 'refund_deadline_hours' THEN EXCLUDED.refund_deadline_hours ELSE s.refund_deadline_hours END,
    waitlist_offer_hours = CASE WHEN p_payload ? 'waitlist_offer_hours' THEN EXCLUDED.waitlist_offer_hours ELSE s.waitlist_offer_hours END,
    certificate_enabled = CASE WHEN p_payload ? 'certificate_enabled' THEN EXCLUDED.certificate_enabled ELSE s.certificate_enabled END,
    certificate_eligibility = CASE WHEN p_payload ? 'certificate_eligibility' THEN EXCLUDED.certificate_eligibility ELSE s.certificate_eligibility END,
    certificate_min_sessions = CASE WHEN p_payload ? 'certificate_min_sessions' THEN EXCLUDED.certificate_min_sessions ELSE s.certificate_min_sessions END,
    certificate_require_survey = CASE WHEN p_payload ? 'certificate_require_survey' THEN EXCLUDED.certificate_require_survey ELSE s.certificate_require_survey END,
    certificate_hours = CASE WHEN p_payload ? 'certificate_hours' THEN EXCLUDED.certificate_hours ELSE s.certificate_hours END,
    certificate_issuer_name = CASE WHEN p_payload ? 'certificate_issuer_name' THEN EXCLUDED.certificate_issuer_name ELSE s.certificate_issuer_name END,
    certificate_signatory_name = CASE WHEN p_payload ? 'certificate_signatory_name' THEN EXCLUDED.certificate_signatory_name ELSE s.certificate_signatory_name END,
    certificate_signatory_title_pl = CASE WHEN p_payload ? 'certificate_signatory_title_pl' THEN EXCLUDED.certificate_signatory_title_pl ELSE s.certificate_signatory_title_pl END,
    certificate_signatory_title_en = CASE WHEN p_payload ? 'certificate_signatory_title_en' THEN EXCLUDED.certificate_signatory_title_en ELSE s.certificate_signatory_title_en END,
    certificate_body_pl = CASE WHEN p_payload ? 'certificate_body_pl' THEN EXCLUDED.certificate_body_pl ELSE s.certificate_body_pl END,
    certificate_body_en = CASE WHEN p_payload ? 'certificate_body_en' THEN EXCLUDED.certificate_body_en ELSE s.certificate_body_en END,
    survey_enabled = CASE WHEN p_payload ? 'survey_enabled' THEN EXCLUDED.survey_enabled ELSE s.survey_enabled END,
    survey_anonymous = CASE WHEN p_payload ? 'survey_anonymous' THEN EXCLUDED.survey_anonymous ELSE s.survey_anonymous END,
    survey_close_after_days = CASE WHEN p_payload ? 'survey_close_after_days' THEN EXCLUDED.survey_close_after_days ELSE s.survey_close_after_days END,
    survey_min_results = CASE WHEN p_payload ? 'survey_min_results' THEN EXCLUDED.survey_min_results ELSE s.survey_min_results END,
    survey_invite_enabled = CASE WHEN p_payload ? 'survey_invite_enabled' THEN EXCLUDED.survey_invite_enabled ELSE s.survey_invite_enabled END,
    survey_intro_pl = CASE WHEN p_payload ? 'survey_intro_pl' THEN EXCLUDED.survey_intro_pl ELSE s.survey_intro_pl END,
    survey_intro_en = CASE WHEN p_payload ? 'survey_intro_en' THEN EXCLUDED.survey_intro_en ELSE s.survey_intro_en END,
    updated_by = EXCLUDED.updated_by;

  PERFORM public.emit_domain_event(
    v_tenant,
    'event_participant_settings',
    v_event::text,
    'event.participant_settings.updated.v1',
    jsonb_build_object('event_id', v_event, 'keys', to_jsonb(v_keys)),
    v_uid
  );

  RETURN public.admin_event_participant_settings_get(v_event);
END;
$function$;
COMMENT ON FUNCTION public.admin_event_participant_settings_save(jsonb) IS
  'Panel: zapis ustawien uczestnika. Brak klucza = bez zmian; kazda wartosc walidowana PRZED zapisem (invalid_*), pusty tekst = NULL. Emituje event.participant_settings.updated.v1 {event_id, keys}. Zwraca to samo co _get.';
REVOKE ALL ON FUNCTION public.admin_event_participant_settings_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_participant_settings_save(jsonb) TO authenticated, service_role;

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public.admin_event_message_delivery_stats(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  v_tenant := public.assert_event_admin_tenant();
  RETURN jsonb_build_object(
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'kind', g.kind, 'channel', g.channel, 'claimed', g.claimed,
               'sent', g.sent, 'skipped', g.skipped, 'failed', g.failed)
             ORDER BY g.kind, g.channel)
        FROM (
          SELECT d.kind, d.channel,
                 count(*) FILTER (WHERE d.status = 'claimed') AS claimed,
                 count(*) FILTER (WHERE d.status = 'sent') AS sent,
                 count(*) FILTER (WHERE d.status = 'skipped') AS skipped,
                 count(*) FILTER (WHERE d.status = 'failed') AS failed
            FROM public.event_message_deliveries d
           WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id
           GROUP BY d.kind, d.channel
        ) g
    ), '[]'::jsonb),
    'last_sent_at', (
      SELECT max(d.sent_at) FROM public.event_message_deliveries d
       WHERE d.tenant_id = v_tenant AND d.event_id = p_event_id
    )
  );
END;
$function$;
COMMENT ON FUNCTION public.admin_event_message_delivery_stats(uuid) IS
  'Panel komunikacji: liczniki dziennika doreczen wydarzenia per rodzaj i kanal (claimed/sent/skipped/failed) + ostatnie wyslanie. Filtr najemca + wydarzenie.';
REVOKE ALL ON FUNCTION public.admin_event_message_delivery_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_message_delivery_stats(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) Publiczne RPC: flagi potrzebne UI uczestnika (niezalezne od widza)
-- ----------------------------------------------------------------------------

-- LOCKS: none (read only).
CREATE OR REPLACE FUNCTION public.event_participant_options(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_event public.events;
  v_s public.event_participant_settings;
  v_end timestamptz;
BEGIN
  IF v_tenant IS NULL OR p_slug IS NULL OR btrim(p_slug) = '' THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT e.* INTO v_event
    FROM public.events e
   WHERE e.tenant_id = v_tenant AND e.slug = btrim(p_slug) AND e.status = 'published';
  IF v_event.id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  v_s := public._event_participant_settings_effective(v_tenant, v_event.id);
  v_end := public._event_effective_end(v_event.starts_at, v_event.ends_at);

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'timezone', public._event_safe_timezone(v_event.timezone),
    'starts_at', v_event.starts_at,
    'ends_at', v_event.ends_at,
    'effective_end', v_end,
    'calendar_export_enabled', v_s.calendar_export_enabled,
    'reminders_enabled', v_s.reminders_enabled,
    'reminder_event_leads_minutes', to_jsonb(v_s.reminder_event_leads_minutes),
    'session_reminders_enabled', v_s.session_reminders_enabled,
    'session_reminder_lead_minutes', v_s.session_reminder_lead_minutes,
    'reminder_sms_enabled', v_s.reminder_sms_enabled,
    'transfer_enabled', v_s.transfer_enabled,
    'transfer_deadline_at', v_event.starts_at - make_interval(hours => v_s.transfer_deadline_hours),
    'refund_mode', v_s.refund_mode,
    'refund_deadline_hours', v_s.refund_deadline_hours,
    'waitlist_offer_hours', v_s.waitlist_offer_hours,
    'certificate_enabled', v_s.certificate_enabled,
    'survey_enabled', v_s.survey_enabled,
    'survey_opens_at', v_end,
    'survey_closes_at', v_end + make_interval(days => v_s.survey_close_after_days)
  );
END;
$function$;
COMMENT ON FUNCTION public.event_participant_options(text) IS
  'Publiczne flagi funkcji uczestnika opublikowanego wydarzenia (niezalezne od widza, bez danych osobowych): kalendarz, przypomnienia, przekazanie, zwrot, oferty, certyfikat, okno ankiety. Wydarzenie nieopublikowane/nieznane = {"ok":false}.';
REVOKE ALL ON FUNCTION public.event_participant_options(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_participant_options(text) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 10) Rezerwacja i potwierdzenie doreczenia (service_role)
-- ----------------------------------------------------------------------------

-- LOCKS: event_message_deliveries row (INSERT ... ON CONFLICT) only.
CREATE OR REPLACE FUNCTION public._event_delivery_claim(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid;
  v_event uuid;
  v_registration uuid;
  v_person uuid;
  v_user uuid;
  v_session uuid;
  v_lead integer;
  v_starts timestamptz;
  v_kind text := NULLIF(btrim(COALESCE(p_payload->>'kind', '')), '');
  v_channel text := NULLIF(btrim(COALESCE(p_payload->>'channel', '')), '');
  v_key text := NULLIF(btrim(COALESCE(p_payload->>'dedupe_key', '')), '');
  v_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload: payload must be a JSON object';
  END IF;

  BEGIN
    v_tenant := NULLIF(p_payload->>'tenant_id', '')::uuid;
    v_event := NULLIF(p_payload->>'event_id', '')::uuid;
    v_registration := NULLIF(p_payload->>'registration_id', '')::uuid;
    v_person := NULLIF(p_payload->>'person_id', '')::uuid;
    v_user := NULLIF(p_payload->>'user_id', '')::uuid;
    v_session := NULLIF(p_payload->>'session_id', '')::uuid;
    v_lead := NULLIF(p_payload->>'lead_minutes', '')::integer;
    v_starts := NULLIF(p_payload->>'starts_at', '')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid_payload: malformed id, lead_minutes or starts_at';
  END;

  IF v_tenant IS NULL OR v_event IS NULL OR v_kind IS NULL OR v_channel IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'invalid_payload: tenant_id, event_id, kind, channel and dedupe_key are required';
  END IF;
  IF v_kind NOT IN ('event_reminder', 'session_reminder', 'waitlist_offer', 'waitlist_offer_expired',
                    'waitlist_offer_refunded', 'waitlist_joined', 'transfer_offer', 'transfer_completed',
                    'transfer_revoked', 'survey_invite', 'certificate_ready') THEN
    RAISE EXCEPTION 'invalid_payload: unknown kind';
  END IF;
  IF v_channel NOT IN ('email', 'sms', 'inapp') THEN
    RAISE EXCEPTION 'invalid_payload: unknown channel';
  END IF;
  IF char_length(v_key) < 8 OR char_length(v_key) > 300 THEN
    RAISE EXCEPTION 'invalid_payload: dedupe_key must have 8..300 characters';
  END IF;
  IF v_lead IS NOT NULL AND (v_lead < 0 OR v_lead > 20160) THEN
    RAISE EXCEPTION 'invalid_payload: lead_minutes must be between 0 and 20160';
  END IF;

  BEGIN
    INSERT INTO public.event_message_deliveries AS d (
      tenant_id, event_id, registration_id, person_id, user_id, session_id,
      kind, channel, lead_minutes, starts_at_snapshot, dedupe_key
    ) VALUES (
      v_tenant, v_event, v_registration, v_person, v_user, v_session,
      v_kind, v_channel, v_lead, v_starts, v_key
    )
    ON CONFLICT (tenant_id, dedupe_key) DO UPDATE SET
      status = 'claimed',
      claimed_at = now(),
      attempts = d.attempts + 1,
      updated_at = now()
    -- Powiadomienia w aplikacji sa jednorazowe: nigdy ponownie rezerwowane
    -- (dzwonek wyslany dwa razy to dwa dzwonki). E-mail/SMS: porzucona
    -- rezerwacja po 15 min albo blad przy mniej niz 3 probach. Limit 10 prob
    -- porzuconej rezerwacji chroni CHECK `attempts BETWEEN 1 AND 10`.
    WHERE d.channel <> 'inapp'
      AND (
        (d.status = 'claimed' AND d.claimed_at < now() - interval '15 minutes' AND d.attempts < 10)
        OR (d.status = 'failed' AND d.attempts < 3)
      )
    RETURNING d.id INTO v_id;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'invalid_payload: referenced event, registration, person, user or session does not exist';
  END;

  RETURN v_id;
END;
$function$;
COMMENT ON FUNCTION public._event_delivery_claim(jsonb) IS
  'Rezerwuje doreczenie po kluczu deduplikacji (UNIQUE tenant_id+dedupe_key). Zwraca id nowego albo ponownie zarezerwowanego wiersza, NULL gdy nie do wziecia. In-app nigdy ponownie; e-mail/SMS po 15 min porzucenia albo po bledzie (proby < 3).';
REVOKE ALL ON FUNCTION public._event_delivery_claim(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_delivery_claim(jsonb) TO service_role;

-- LOCKS: event_message_deliveries row (UPDATE) only.
CREATE OR REPLACE FUNCTION public._event_delivery_confirm(p_id uuid, p_status text, p_detail text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'invalid_status: status must be sent, skipped or failed';
  END IF;

  UPDATE public.event_message_deliveries d
     SET status = p_status,
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE d.sent_at END,
         detail = left(NULLIF(btrim(COALESCE(p_detail, '')), ''), 500),
         updated_at = now()
   WHERE d.id = p_id
     AND d.status = 'claimed';
  RETURN FOUND;
END;
$function$;
COMMENT ON FUNCTION public._event_delivery_confirm(uuid, text, text) IS
  'Zamyka zarezerwowane doreczenie: sent (ze stemplem sent_at), skipped albo failed; detail = powod/kod bledu bez danych osobowych. Dziala wylacznie na wierszu w stanie claimed; zwraca czy cos zmieniono.';
REVOKE ALL ON FUNCTION public._event_delivery_confirm(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_delivery_confirm(uuid, text, text) TO service_role;
