-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S5, 6/6): ŚCIEŻKI KOMUNIKACJI - DOMKNIĘCIE KROKU
-- MAILA, ŚLEDZENIE 1:1, WYPIS, STATYSTYKI PER KROK, ROLLUP DZIENNY,
-- DOPASOWANIE ZDARZEŃ DOSTAWCY PO IDENTYFIKATORZE WIADOMOŚCI.
--
-- DEFEKT
--   1. Runner (TS) składa mail, ale baza nie wie, że krok się udał - zapis
--      stałby na `send_email` i przy każdym ticku próbowałby wysłać znowu
--      (chroni tylko klucz idempotencji kolejki).
--   2. Otwarcia, kliknięcia i wypisy z maili ścieżek nie mają gdzie trafić:
--      `newsletter_record_campaign_event` zna wyłącznie kampanie.
--   3. Odbicia i skargi maili 1:1 (ścieżki, transakcyjne) nie wracają do
--      najemcy: `email_apply_delivery_event` dopasowuje identyfikator
--      dostawcy tylko w odbiorcach kampanii, a adres bywa w wielu najemcach -
--      blokada po skardze nie powstaje, wysyłka idzie dalej na skarżący
--      się adres.
--   4. Panel nie ma statystyk per krok („który mail sprzedaje").
--
-- ZMIANA
--   A. `_journey_message_id(p_enrollment, p_node)` (wewnętrzna) - lustro
--      `deterministicMessageId("journey:{zapis}:{węzeł}")` (SHA-256, 16
--      bajtów, bity wersji i wariantu UUID) - runner nie podrzuci obcego
--      identyfikatora, a kolejka, dziennik wysyłek i wiadomość ścieżki mają
--      jedną tożsamość.
--   B. `journey_complete_email_step(…)` (service_role) - wynik kroku maila:
--      `queued` (wiadomość ścieżki, krok udany, silnik idzie dalej w tej
--      samej dzierżawie), `deferred` (zaległość kolejki / reputacja - +N
--      min), `quiet` (do końca ciszy nocnej), `capped` (do 3 przesunięć
--      o dobę, potem krok pominięty `capped`), `no_consent|unsubscribed|
--      suppressed` (zapis wychodzi z powodem), `delivery_not_ready` (krok
--      pominięty).
--   C. `journey_record_message_event(p_message_id, p_kind, p_link_index,
--      p_url, p_machine)` (service_role) - otwarcie/kliknięcie/wypis,
--      najemca z WIADOMOŚCI (nigdy z żądania), deduplikacja doby; otwarcie
--      szybsze niż `machine_open_seconds` od wysyłki = maszynowe. Wypis:
--      zgoda leada wycofana z wpisem w księdze (`given = false`), subskrybent
--      wypisany przez istniejące `email_unsubscribe_by_token` (blokada
--      `unsubscribe` w tej samej transakcji; bez subskrybenta - sama
--      blokada), aktywne zapisy MARKETINGOWE kontaktu wychodzą z powodem
--      `unsubscribed`.
--   D. `admin_journey_stats(…)`, `admin_journey_series(…)` (admin|editor) -
--      statystyki ścieżki, węzłów (z mailem: wysłane, blokady, odbicia,
--      skargi, otwarcia unikalne i „ludzkie", kliknięcia, CTOR, wypisy,
--      język zastępczy) i wariantów A/B (test dwóch proporcji, `z` tylko
--      przy n ≥ 100 na wariant); zapisy testowe wykluczone; okno > 400 dni
--      albo > 50 tys. zapisów -> węzły z `journey_node_daily_stats`.
--   E. `journey_rollup_daily()` (service_role) - dni zamknięte (UTC, 7 dni
--      wstecz, upsert = powtórka liczy to samo).
--   F. `email_apply_delivery_event` - pełne ciało z najnowszej definicji
--      (CIALO-Z niżej) + najemca z `email_send_log.provider_message_id`
--      (dren zapisuje go od S5) przed dopasowaniem po adresie.
--   G. `_journey_unsubscribe(…)` (wewnętrzna) - wypis ze ścieżki (C).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020140100 (`journey_advance`), I0
-- (`email_send_log.provider_message_id`). Kod drenu zapisujący
-- `provider_message_id` może wejść przed albo po: bez niego dopasowanie
-- działa jak dotąd (kampanie, adres).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/journeys_tracking_stats_test.sql (deduplikacja doby,
-- otwarcia maszynowe, statystyki z `email_send_log` po `message_id`,
-- dopasowanie po `provider_message_id`, `z` tylko przy n ≥ 100, wypis).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Tożsamość wiadomości (lustro src/lib/email/messageId.ts).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_message_id(p_enrollment uuid, p_node text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-' || substr(h, 13, 4) || '-'
         || substr(h, 17, 4) || '-' || substr(h, 21, 12)
    FROM (
      SELECT encode(
               set_byte(set_byte(b, 6, (get_byte(b, 6) & 15) | 64), 8, (get_byte(b, 8) & 63) | 128),
               'hex') AS h
        FROM (SELECT substring(sha256(convert_to('journey:' || p_enrollment::text || ':' || p_node, 'UTF8'))
                               FROM 1 FOR 16) AS b) raw
    ) hex
$$;

REVOKE ALL ON FUNCTION public._journey_message_id(uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Wynik kroku maila.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_complete_email_step(
  p_enrollment_id uuid,
  p_lock_token uuid,
  p_node_id text,
  p_result text,
  p_message_id text DEFAULT NULL,
  p_variant text DEFAULT NULL,
  p_locale text DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Limit D-03: najwyżej 3 przesunięcia o dobę, potem krok pominięty.
  c_cap_retries constant integer := 3;
  v_e public.journey_enrollments%ROWTYPE;
  v_run public.journey_step_runs%ROWTYPE;
  v_detail jsonb := COALESCE(p_detail, '{}'::jsonb);
  v_until timestamptz;
  v_count integer;
  v_outcome text;
  v_reason text;
BEGIN
  IF p_result IS NULL OR p_result NOT IN ('queued', 'deferred', 'quiet', 'capped', 'no_consent',
                                          'unsubscribed', 'suppressed', 'delivery_not_ready') THEN
    RAISE EXCEPTION 'result_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_e FROM public.journey_enrollments WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND OR v_e.lock_token IS DISTINCT FROM p_lock_token THEN
    RETURN jsonb_build_object('status', 'lost_lock', 'enrollment_id', p_enrollment_id);
  END IF;
  SELECT * INTO v_run FROM public.journey_step_runs
   WHERE enrollment_id = v_e.id AND node_id = p_node_id;
  IF NOT FOUND OR v_e.current_node_id IS DISTINCT FROM p_node_id OR v_run.node_type <> 'send_email' THEN
    RAISE EXCEPTION 'not_at_email_node' USING ERRCODE = '22023';
  END IF;

  IF p_result = 'queued' THEN
    IF p_message_id IS DISTINCT FROM public._journey_message_id(v_e.id, p_node_id) THEN
      RAISE EXCEPTION 'message_id_mismatch' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.journey_messages (
      message_id, tenant_id, enrollment_id, journey_id, version_id, node_id, lead_id, variant, locale
    ) VALUES (
      p_message_id, v_e.tenant_id, v_e.id, v_e.journey_id, v_e.version_id, p_node_id, v_e.lead_id,
      CASE WHEN p_variant ~ '^[A-E]$' THEN p_variant END,
      CASE WHEN p_locale IN ('pl', 'en') THEN p_locale END
    )
    ON CONFLICT (message_id) DO NOTHING;
    UPDATE public.journey_step_runs
       SET status = 'succeeded', outcome = 'next', attempts = attempts + 1, finished_at = now(),
           error = NULL,
           detail = detail || jsonb_strip_nulls(jsonb_build_object(
             'message_id', p_message_id,
             'variant', p_variant,
             'fallback_locale', COALESCE((v_detail ->> 'fallback_locale')::boolean, false)))
     WHERE id = v_run.id;
    -- Dalej w tej samej dzierżawie: kolejne węzły bazy bez czekania na tick.
    RETURN public.journey_advance(v_e.id, p_lock_token, 25) || jsonb_build_object('completed', 'queued');
  END IF;

  IF p_result IN ('deferred', 'quiet') THEN
    v_until := CASE WHEN p_result = 'quiet'
      THEN COALESCE(public._journey_quiet_until(v_e.tenant_id), now() + interval '30 minutes')
      ELSE now() + make_interval(mins => LEAST(GREATEST(COALESCE((v_detail ->> 'minutes')::integer, 5), 1), 1440))
    END;
    UPDATE public.journey_step_runs
       SET detail = detail || jsonb_build_object(
             p_result || '_count', COALESCE((detail ->> (p_result || '_count'))::integer, 0) + 1)
     WHERE id = v_run.id;
    UPDATE public.journey_enrollments
       SET next_run_at = v_until, lock_token = NULL, locked_until = NULL
     WHERE id = v_e.id;
    RETURN jsonb_build_object('status', 'deferred', 'reason', p_result, 'until', v_until,
                              'journey_id', v_e.journey_id);
  END IF;

  IF p_result = 'capped' THEN
    v_count := COALESCE((v_run.detail ->> 'capped_count')::integer, 0) + 1;
    UPDATE public.journey_step_runs
       SET detail = detail || jsonb_build_object('capped_count', v_count)
     WHERE id = v_run.id;
    IF v_count <= c_cap_retries THEN
      UPDATE public.journey_enrollments
         SET next_run_at = now() + interval '1 day', lock_token = NULL, locked_until = NULL
       WHERE id = v_e.id;
      RETURN jsonb_build_object('status', 'deferred', 'reason', 'capped', 'attempt', v_count,
                                'journey_id', v_e.journey_id);
    END IF;
    UPDATE public.journey_step_runs
       SET status = 'skipped', outcome = 'capped', finished_at = now()
     WHERE id = v_run.id;
    RETURN public.journey_advance(v_e.id, p_lock_token, 25) || jsonb_build_object('completed', 'capped');
  END IF;

  IF p_result = 'delivery_not_ready' THEN
    UPDATE public.journey_step_runs
       SET status = 'skipped', outcome = 'delivery_not_ready', finished_at = now(),
           detail = detail || v_detail
     WHERE id = v_run.id;
    RETURN public.journey_advance(v_e.id, p_lock_token, 25) || jsonb_build_object('completed', 'delivery_not_ready');
  END IF;

  -- Brak zgody, wypis, blokada: kontakt opuszcza ścieżkę z powodem.
  v_outcome := CASE WHEN p_result = 'suppressed' THEN 'skipped' ELSE 'no_consent' END;
  v_reason := CASE p_result WHEN 'no_consent' THEN 'consent' ELSE p_result END;
  UPDATE public.journey_step_runs
     SET status = 'skipped', outcome = v_outcome, finished_at = now(),
         detail = detail || jsonb_build_object('reason', p_result)
   WHERE id = v_run.id;
  UPDATE public.journey_enrollments
     SET status = 'exited', exit_reason = v_reason, finished_at = now(),
         next_run_at = NULL, lock_token = NULL, locked_until = NULL
   WHERE id = v_e.id;
  RETURN jsonb_build_object('status', 'exited', 'reason', v_reason, 'journey_id', v_e.journey_id);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_complete_email_step(uuid, uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_complete_email_step(uuid, uuid, text, text, text, text, text, jsonb) TO service_role;

-- ----------------------------------------------------------------------------
-- G) Wypis ze ścieżki.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_unsubscribe(p_tenant uuid, p_lead uuid, p_message_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_token text;
  v_result jsonb;
  v_exited integer;
BEGIN
  SELECT COALESCE(NULLIF(btrim(l.email), ''), l.email_norm) INTO v_email
    FROM public.crm_leads l WHERE l.id = p_lead AND l.tenant_id = p_tenant;
  IF v_email IS NULL THEN
    RETURN 0;
  END IF;
  -- Ten sam zapis co wycofanie zgody w CRM: flaga + dowód w księdze, żeby
  -- most wydarzeń nie wskrzesił zgody (R12).
  UPDATE public.crm_leads SET marketing_consent = false, updated_at = now()
   WHERE id = p_lead AND marketing_consent;
  INSERT INTO public.crm_consent_log (
    tenant_id, email, source_type, source_id, form_id, form_name,
    consent_key, consent_text, consent_version, given, ip, user_agent, lang
  ) VALUES (
    p_tenant, v_email, 'other'::public.crm_source_type, p_lead, 'journey:unsubscribe', 'journey',
    'marketing', 'Marketing consent withdrawn with the one-click unsubscribe link of a journey email.',
    NULL, false, NULL, NULL, NULL
  );

  SELECT s.unsubscribe_token INTO v_token FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND lower(s.email) = lower(v_email);
  IF v_token IS NOT NULL THEN
    -- Istniejący wypis: status subskrybenta + blokada `unsubscribe` jedną transakcją.
    v_result := public.email_unsubscribe_by_token(v_token);
  ELSE
    v_result := public.email_record_suppression(
      p_tenant => p_tenant, p_email => v_email, p_reason => 'unsubscribe',
      p_source => 'system', p_provider => 'self_service',
      p_meta => jsonb_build_object('channel', 'journey_unsubscribe', 'message_id', p_message_id));
  END IF;
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'suppression_not_recorded: %', COALESCE(v_result ->> 'error', 'unknown')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.journey_enrollments e
     SET status = 'exited', exit_reason = 'unsubscribed', finished_at = now(),
         next_run_at = NULL, lock_token = NULL, locked_until = NULL
    FROM public.journey_definitions d
   WHERE e.tenant_id = p_tenant AND e.lead_id = p_lead AND e.status IN ('active', 'waiting')
     AND d.tenant_id = e.tenant_id AND d.id = e.journey_id AND d.category = 'marketing';
  GET DIAGNOSTICS v_exited = ROW_COUNT;
  RETURN v_exited;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_unsubscribe(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- C) Zdarzenia śledzenia.
-- ----------------------------------------------------------------------------
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
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('open', 'click', 'unsubscribe') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_m FROM public.journey_messages m WHERE m.message_id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'unknown_message');
  END IF;
  SELECT s.machine_open_seconds INTO v_threshold FROM public.journey_settings s WHERE s.tenant_id = v_m.tenant_id;
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
-- D) Statystyki panelu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_journey_stats(
  p_journey_id uuid,
  p_version_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Próg istotności A/B (SPEC §5.6): z liczone od 100 zapisów na wariant.
  c_min_n constant integer := 100;
  v_tenant uuid := public._journey_staff_tenant(false);
  v_def record;
  v_graph jsonb;
  v_since timestamptz := COALESCE(p_since, now() - interval '30 days');
  v_until timestamptz := COALESCE(p_until, now());
  v_rollup boolean;
  v_journey jsonb;
  v_nodes jsonb;
  v_variants jsonb := '[]'::jsonb;
  v_ab jsonb;
  v_metric text;
  -- Zapisy okna jako tablica identyfikatorów (jedno przejście filtra okna;
  -- bez tabeli tymczasowej, której analiza statyczna plpgsql_check nie widzi).
  v_ids uuid[];
  v_an bigint;
  v_ag bigint;
  v_ac bigint;
  v_bn bigint;
  v_bg bigint;
  v_bc bigint;
  v_p double precision;
  v_se double precision;
  v_za double precision;
  v_zb double precision;
BEGIN
  IF v_until <= v_since THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT d.id, d.published_version_id INTO v_def FROM public.journey_definitions d
   WHERE d.id = p_journey_id AND d.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT v.graph INTO v_graph FROM public.journey_versions v
   WHERE v.journey_id = v_def.id AND v.tenant_id = v_tenant
     AND v.id = COALESCE(p_version_id, v_def.published_version_id);

  SELECT COALESCE(array_agg(e.id), '{}'::uuid[]) INTO v_ids FROM public.journey_enrollments e
   WHERE e.tenant_id = v_tenant AND e.journey_id = v_def.id AND NOT e.is_test
     AND (p_version_id IS NULL OR e.version_id = p_version_id)
     AND e.entered_at >= v_since AND e.entered_at <= v_until;

  v_rollup := v_until - v_since > interval '400 days' OR cardinality(v_ids) > 50000;

  SELECT jsonb_build_object(
    'enrolled', count(*),
    'active', count(*) FILTER (WHERE status = 'active'),
    'waiting', count(*) FILTER (WHERE status = 'waiting'),
    'completed', count(*) FILTER (WHERE status = 'completed'),
    'goal_reached', count(*) FILTER (WHERE status = 'goal_reached'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'exited', COALESCE((SELECT jsonb_object_agg(x.exit_reason, x.n) FROM (
        SELECT j.exit_reason, count(*) AS n FROM public.journey_enrollments j
         WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids) AND j.status = 'exited'
         GROUP BY j.exit_reason) x), '{}'::jsonb),
    'goal_rate', CASE WHEN count(*) > 0
                      THEN round((count(*) FILTER (WHERE status = 'goal_reached'))::numeric / count(*), 4) END
  ) INTO v_journey FROM public.journey_enrollments
   WHERE tenant_id = v_tenant AND id = ANY (v_ids);

  IF v_rollup THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'node_id', r.node_id, 'type', public._journey_node(v_graph, r.node_id) ->> 'type',
      'entered', r.entered, 'succeeded', r.succeeded, 'skipped', r.skipped, 'failed', r.failed,
      'dead', r.dead, 'waiting_now', 0, 'outcomes', '{}'::jsonb,
      'email', CASE WHEN public._journey_node(v_graph, r.node_id) ->> 'type' = 'send_email' THEN jsonb_build_object(
        'queued', r.sent, 'sent', r.sent, 'suppressed', 0, 'bounced', r.bounced, 'complained', r.complained,
        'unique_opens', r.opens, 'unique_human_opens', r.human_opens, 'unique_clicks', r.clicks,
        'ctor', CASE WHEN r.human_opens > 0 THEN round(r.clicks::numeric / r.human_opens, 4) END,
        'unsubscribed', r.unsubs, 'fallback_locale', 0) END
    ) ORDER BY r.node_id), '[]'::jsonb) INTO v_nodes
    FROM (
      SELECT s.node_id, sum(s.entered) AS entered, sum(s.succeeded) AS succeeded, sum(s.skipped) AS skipped,
             sum(s.failed) AS failed, sum(s.dead) AS dead, sum(s.emails_sent) AS sent,
             sum(s.emails_bounced) AS bounced, sum(s.emails_complained) AS complained,
             sum(s.unique_opens) AS opens, sum(s.unique_human_opens) AS human_opens,
             sum(s.unique_clicks) AS clicks, sum(s.unsubscribes) AS unsubs
        FROM public.journey_node_daily_stats s
       WHERE s.tenant_id = v_tenant AND s.journey_id = v_def.id AND s.variant = '-'
         AND (p_version_id IS NULL OR s.version_id = p_version_id)
         AND s.day >= v_since::date AND s.day < v_until::date
       GROUP BY s.node_id
    ) r;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'node_id', n.node_id, 'type', n.node_type,
      'entered', n.entered, 'succeeded', n.succeeded, 'skipped', n.skipped, 'failed', n.failed,
      'dead', n.dead, 'waiting_now', n.waiting_now, 'outcomes', n.outcomes,
      'email', CASE WHEN n.node_type = 'send_email' THEN (
        SELECT jsonb_build_object(
          'queued', count(*),
          'sent', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    WHERE l.message_id = m.message_id AND l.status = 'sent')),
          'suppressed', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    WHERE l.message_id = m.message_id AND l.status = 'suppressed')),
          'bounced', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
                    WHERE l.message_id = m.message_id AND de.kind = 'bounced')),
          'complained', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.email_send_log l
                    JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
                    WHERE l.message_id = m.message_id AND de.kind = 'complained')),
          'unique_opens', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open')),
          'unique_human_opens', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)),
          'unique_clicks', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'click')),
          'ctor', CASE WHEN count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)) > 0
                  THEN round((count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'click')))::numeric
                    / count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine)), 4) END,
          'unsubscribed', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_message_events me
                    WHERE me.message_id = m.message_id AND me.kind = 'unsubscribe')),
          'fallback_locale', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_step_runs sr
                    WHERE sr.enrollment_id = m.enrollment_id AND sr.node_id = m.node_id
                      AND (sr.detail ->> 'fallback_locale')::boolean))
        )
          FROM public.journey_messages m
         WHERE m.journey_id = v_def.id AND m.node_id = n.node_id
           AND m.tenant_id = v_tenant AND m.enrollment_id = ANY (v_ids)
      ) END
    ) ORDER BY n.node_id), '[]'::jsonb) INTO v_nodes
    FROM (
      SELECT sr.node_id, max(sr.node_type) AS node_type,
             count(*) AS entered,
             count(*) FILTER (WHERE sr.status = 'succeeded') AS succeeded,
             count(*) FILTER (WHERE sr.status = 'skipped') AS skipped,
             count(*) FILTER (WHERE sr.status = 'failed') AS failed,
             count(*) FILTER (WHERE sr.status = 'dead') AS dead,
             (SELECT count(*) FROM public.journey_enrollments j
               WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
                 AND j.current_node_id = sr.node_id AND j.status IN ('active', 'waiting')) AS waiting_now,
             COALESCE((SELECT jsonb_object_agg(o.outcome, o.n) FROM (
                SELECT sr2.outcome, count(*) AS n FROM public.journey_step_runs sr2
                 WHERE sr2.tenant_id = v_tenant AND sr2.enrollment_id = ANY (v_ids)
                   AND sr2.node_id = sr.node_id AND sr2.outcome IS NOT NULL
                 GROUP BY sr2.outcome) o), '{}'::jsonb) AS outcomes
        FROM public.journey_step_runs sr
       WHERE sr.tenant_id = v_tenant AND sr.enrollment_id = ANY (v_ids)
       GROUP BY sr.node_id
    ) n;
  END IF;

  -- Warianty A/B (ramiona podziału): wejścia, kliknięcia, cele, z.
  FOR v_ab IN SELECT n FROM jsonb_array_elements(COALESCE(v_graph -> 'nodes', '[]'::jsonb)) n
               WHERE n ->> 'type' = 'ab_split' LOOP
    v_metric := COALESCE(v_ab -> 'params' ->> 'winnerMetric', 'goal');
    SELECT count(*) AS n,
           count(*) FILTER (WHERE j.status = 'goal_reached') AS goals,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = j.id)) AS clicks
      INTO v_an, v_ag, v_ac
      FROM public.journey_enrollments j JOIN public.journey_step_runs sr ON sr.enrollment_id = j.id
     WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
       AND sr.node_id = v_ab ->> 'id' AND sr.outcome = 'A';
    SELECT count(*) AS n,
           count(*) FILTER (WHERE j.status = 'goal_reached') AS goals,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = j.id)) AS clicks
      INTO v_bn, v_bg, v_bc
      FROM public.journey_enrollments j JOIN public.journey_step_runs sr ON sr.enrollment_id = j.id
     WHERE j.tenant_id = v_tenant AND j.id = ANY (v_ids)
       AND sr.node_id = v_ab ->> 'id' AND sr.outcome = 'B';
    v_za := NULL;
    v_zb := NULL;
    IF v_an >= c_min_n AND v_bn >= c_min_n THEN
      -- Test dwóch proporcji (wspólna proporcja w błędzie standardowym).
      IF v_metric = 'click' THEN
        v_p := (v_ac + v_bc)::double precision / (v_an + v_bn);
      ELSE
        v_p := (v_ag + v_bg)::double precision / (v_an + v_bn);
      END IF;
      v_se := sqrt(v_p * (1 - v_p) * (1.0 / v_an + 1.0 / v_bn));
      IF v_se > 0 THEN
        IF v_metric = 'click' THEN
          v_za := ((v_ac::double precision / v_an) - (v_bc::double precision / v_bn)) / v_se;
        ELSE
          v_za := ((v_ag::double precision / v_an) - (v_bg::double precision / v_bn)) / v_se;
        END IF;
        v_zb := -v_za;
      END IF;
    END IF;
    v_variants := v_variants
      || jsonb_build_object('node_id', v_ab ->> 'id', 'variant', 'A', 'metric', v_metric, 'entered', v_an,
                            'unique_clicks', v_ac, 'goal_reached', v_ag,
                            'z', CASE WHEN v_za IS NOT NULL THEN round(v_za::numeric, 3) END)
      || jsonb_build_object('node_id', v_ab ->> 'id', 'variant', 'B', 'metric', v_metric, 'entered', v_bn,
                            'unique_clicks', v_bc, 'goal_reached', v_bg,
                            'z', CASE WHEN v_zb IS NOT NULL THEN round(v_zb::numeric, 3) END);
  END LOOP;

  RETURN jsonb_build_object('since', v_since, 'until', v_until, 'version_id', p_version_id,
                            'source', CASE WHEN v_rollup THEN 'rollup' ELSE 'raw' END,
                            'journey', v_journey, 'nodes', v_nodes, 'variants', v_variants);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_stats(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_stats(uuid, uuid, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_journey_series(
  p_journey_id uuid,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public._journey_staff_tenant(false);
  v_since date := COALESCE(p_since, now() - interval '30 days')::date;
  v_until date := COALESCE(p_until, now())::date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.journey_definitions d WHERE d.id = p_journey_id AND d.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'journey_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_until < v_since OR v_until - v_since > 731 THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'day', g.day,
             'enrolled', (SELECT count(*) FROM public.journey_enrollments e
                           WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND NOT e.is_test
                             AND e.entered_at >= g.day AND e.entered_at < g.day + 1),
             'goal_reached', (SELECT count(*) FROM public.journey_enrollments e
                               WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND NOT e.is_test
                                 AND e.status = 'goal_reached'
                                 AND e.finished_at >= g.day AND e.finished_at < g.day + 1),
             'exited', (SELECT count(*) FROM public.journey_enrollments e
                         WHERE e.tenant_id = v_tenant AND e.journey_id = p_journey_id AND NOT e.is_test
                           AND e.status = 'exited'
                           AND e.finished_at >= g.day AND e.finished_at < g.day + 1),
             'emails_queued', (SELECT count(*) FROM public.journey_messages m
                                JOIN public.journey_enrollments e ON e.id = m.enrollment_id AND NOT e.is_test
                                WHERE m.tenant_id = v_tenant AND m.journey_id = p_journey_id
                                  AND m.queued_at >= g.day AND m.queued_at < g.day + 1),
             'unique_clicks', (SELECT count(DISTINCT me.message_id) FROM public.journey_message_events me
                                JOIN public.journey_messages m ON m.message_id = me.message_id
                                JOIN public.journey_enrollments e ON e.id = m.enrollment_id AND NOT e.is_test
                                WHERE me.tenant_id = v_tenant AND m.journey_id = p_journey_id
                                  AND me.kind = 'click' AND me.day = g.day)
           ) ORDER BY g.day)
      FROM (SELECT d::date AS day FROM generate_series(v_since, v_until, interval '1 day') d) g
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_journey_series(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_journey_series(uuid, timestamptz, timestamptz) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Rollup dzienny (dni zamknięte, UTC).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_rollup_daily()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH days AS (
    SELECT d::date AS day FROM generate_series(
      (now() AT TIME ZONE 'UTC')::date - 7, (now() AT TIME ZONE 'UTC')::date - 1, interval '1 day') d
  ),
  runs AS (
    SELECT sr.tenant_id, sr.journey_id, sr.version_id, sr.node_id, sr.enrollment_id, sr.status,
           (sr.started_at AT TIME ZONE 'UTC')::date AS day
      FROM public.journey_step_runs sr
      JOIN public.journey_enrollments e ON e.id = sr.enrollment_id AND NOT e.is_test
     WHERE sr.started_at >= ((now() AT TIME ZONE 'UTC')::date - 7)::timestamp AT TIME ZONE 'UTC'
       AND sr.started_at < ((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC'
  ),
  agg AS (
    SELECT r.tenant_id, r.journey_id, r.version_id, r.node_id, r.day,
           count(*) AS entered,
           count(*) FILTER (WHERE r.status = 'succeeded') AS succeeded,
           count(*) FILTER (WHERE r.status = 'skipped') AS skipped,
           count(*) FILTER (WHERE r.status = 'failed') AS failed,
           count(*) FILTER (WHERE r.status = 'dead') AS dead,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.email_send_log l ON l.message_id = m.message_id AND l.status = 'sent'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS sent,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.email_send_log l ON l.message_id = m.message_id
             JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id AND de.kind = 'bounced')) AS bounced,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.email_send_log l ON l.message_id = m.message_id
             JOIN public.email_delivery_events de ON de.provider_message_id = l.provider_message_id
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id AND de.kind = 'complained')) AS complained,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'open'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS opens,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'open' AND NOT me.machine
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS human_opens,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'click'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS clicks,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_messages m
             JOIN public.journey_message_events me ON me.message_id = m.message_id AND me.kind = 'unsubscribe'
             WHERE m.enrollment_id = r.enrollment_id AND m.node_id = r.node_id)) AS unsubs,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.journey_enrollments e2
             WHERE e2.id = r.enrollment_id AND e2.status = 'goal_reached')) AS goals
      FROM runs r JOIN days ON days.day = r.day
     GROUP BY r.tenant_id, r.journey_id, r.version_id, r.node_id, r.day
  )
  INSERT INTO public.journey_node_daily_stats AS s (
    tenant_id, journey_id, version_id, node_id, variant, day, entered, succeeded, skipped, failed, dead,
    emails_sent, emails_bounced, emails_complained, unique_opens, unique_human_opens, unique_clicks,
    unsubscribes, goal_reached
  )
  SELECT a.tenant_id, a.journey_id, a.version_id, a.node_id, '-', a.day, a.entered, a.succeeded, a.skipped,
         a.failed, a.dead, a.sent, a.bounced, a.complained, a.opens, a.human_opens, a.clicks, a.unsubs, a.goals
    FROM agg a
  ON CONFLICT (journey_id, version_id, node_id, variant, day) DO UPDATE
     SET entered = EXCLUDED.entered, succeeded = EXCLUDED.succeeded, skipped = EXCLUDED.skipped,
         failed = EXCLUDED.failed, dead = EXCLUDED.dead, emails_sent = EXCLUDED.emails_sent,
         emails_bounced = EXCLUDED.emails_bounced, emails_complained = EXCLUDED.emails_complained,
         unique_opens = EXCLUDED.unique_opens, unique_human_opens = EXCLUDED.unique_human_opens,
         unique_clicks = EXCLUDED.unique_clicks, unsubscribes = EXCLUDED.unsubscribes,
         goal_reached = EXCLUDED.goal_reached;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.journey_rollup_daily() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_rollup_daily() TO service_role;

-- ----------------------------------------------------------------------------
-- F) Dopasowanie zdarzeń dostawcy po identyfikatorze wiadomości (redefinicja).
-- ----------------------------------------------------------------------------
-- CIALO-Z: 20260725123624
CREATE OR REPLACE FUNCTION public.email_apply_delivery_event(
  p_provider text, p_event_id text, p_event_type text, p_kind text, p_email text,
  p_provider_message_id text DEFAULT NULL, p_bounce_class text DEFAULT NULL,
  p_diagnostic text DEFAULT NULL, p_occurred_at timestamptz DEFAULT now(),
  p_tenant_hint uuid DEFAULT NULL, p_campaign_hint uuid DEFAULT NULL,
  p_subscriber_hint uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_provider text := COALESCE(NULLIF(btrim(p_provider), ''), 'resend');
  v_tenant uuid := p_tenant_hint; v_campaign uuid := p_campaign_hint;
  v_subscriber uuid := p_subscriber_hint;
  v_rec record; v_match_count integer := 0; v_event_id uuid;
  v_reason text; v_suppression jsonb := NULL; v_state text;
BEGIN
  IF p_event_id IS NULL OR btrim(p_event_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_event_id');
  END IF;
  IF p_provider_message_id IS NOT NULL AND btrim(p_provider_message_id) <> '' THEN
    SELECT r.tenant_id, r.campaign_id, r.subscriber_id, r.id INTO v_rec
      FROM public.newsletter_campaign_recipients r
     WHERE r.provider_message_id = p_provider_message_id LIMIT 1;
    IF FOUND THEN
      v_tenant := COALESCE(v_tenant, v_rec.tenant_id);
      v_campaign := COALESCE(v_campaign, v_rec.campaign_id);
      v_subscriber := COALESCE(v_subscriber, v_rec.subscriber_id);
    END IF;
  END IF;
  -- ZMIANA (S5): poczta 1:1 (ścieżki, transakcyjne) - najemca z dziennika
  -- drenu po identyfikatorze dostawcy, ZANIM zgadujemy po adresie (adres
  -- bywa w wielu najemcach i wtedy blokada po skardze nie powstawała).
  IF v_tenant IS NULL AND p_provider_message_id IS NOT NULL AND btrim(p_provider_message_id) <> '' THEN
    SELECT l.tenant_id INTO v_tenant FROM public.email_send_log l
     WHERE l.provider_message_id = p_provider_message_id AND l.tenant_id IS NOT NULL
     ORDER BY l.created_at DESC LIMIT 1;
  END IF;
  IF v_tenant IS NULL AND v_email <> '' THEN
    SELECT count(*) INTO v_match_count FROM public.newsletter_subscribers ns
     WHERE lower(ns.email) = v_email;
    IF v_match_count = 1 THEN
      SELECT ns.tenant_id, ns.id INTO v_tenant, v_subscriber
        FROM public.newsletter_subscribers ns WHERE lower(ns.email) = v_email;
    END IF;
  END IF;
  INSERT INTO public.email_delivery_events (
    tenant_id, provider, provider_event_id, event_type, kind, bounce_class,
    email, provider_message_id, campaign_id, subscriber_id, diagnostic,
    occurred_at, payload
  ) VALUES (
    v_tenant, v_provider, p_event_id, left(p_event_type, 120), p_kind, p_bounce_class,
    NULLIF(v_email, ''), p_provider_message_id, v_campaign, v_subscriber,
    left(COALESCE(p_diagnostic, ''), 1000), COALESCE(p_occurred_at, now()),
    COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  v_state := CASE p_kind
    WHEN 'delivered' THEN 'delivered' WHEN 'bounced' THEN 'bounced'
    WHEN 'complained' THEN 'complained' WHEN 'delayed' THEN 'delayed'
    WHEN 'failed' THEN 'failed' ELSE NULL
  END;
  IF v_state IS NOT NULL AND p_provider_message_id IS NOT NULL THEN
    UPDATE public.newsletter_campaign_recipients r
       SET delivery_state = v_state,
           bounce_class = COALESCE(p_bounce_class, r.bounce_class),
           delivered_at = CASE WHEN p_kind = 'delivered'
                               THEN COALESCE(r.delivered_at, COALESCE(p_occurred_at, now()))
                               ELSE r.delivered_at END,
           bounced_at = CASE WHEN p_kind = 'bounced'
                             THEN COALESCE(r.bounced_at, COALESCE(p_occurred_at, now()))
                             ELSE r.bounced_at END,
           complained_at = CASE WHEN p_kind = 'complained'
                                THEN COALESCE(r.complained_at, COALESCE(p_occurred_at, now()))
                                ELSE r.complained_at END,
           error = CASE WHEN p_kind IN ('bounced','complained','failed')
                        THEN left(COALESCE(p_diagnostic, r.error, p_event_type), 500)
                        ELSE r.error END
     WHERE r.provider_message_id = p_provider_message_id
       AND (v_state <> 'delivered' OR r.delivery_state NOT IN ('bounced','complained','failed'));
  END IF;
  v_reason := CASE
    WHEN p_kind = 'complained' THEN 'complaint'
    WHEN p_kind = 'bounced' AND p_bounce_class = 'hard' THEN 'hard_bounce'
    WHEN p_kind = 'bounced' AND p_bounce_class = 'block' THEN 'blocked'
    WHEN p_kind = 'bounced' AND p_bounce_class = 'soft' THEN 'soft_bounce'
    WHEN p_kind = 'bounced' THEN 'soft_bounce'
    ELSE NULL
  END;
  IF v_reason IS NOT NULL AND v_tenant IS NOT NULL AND v_email <> '' THEN
    v_suppression := public.email_record_suppression(
      p_tenant => v_tenant, p_email => v_email, p_reason => v_reason,
      p_source => 'resend_webhook', p_provider => v_provider,
      p_provider_message_id => p_provider_message_id, p_event_id => p_event_id,
      p_campaign => v_campaign, p_subscriber => v_subscriber,
      p_diagnostic => p_diagnostic,
      p_meta => jsonb_build_object('event_type', p_event_type));
  END IF;
  RETURN jsonb_build_object('ok', true, 'duplicate', false,
    'tenant_id', v_tenant, 'campaign_id', v_campaign, 'subscriber_id', v_subscriber,
    'kind', p_kind, 'suppression', v_suppression);
END;
$fn$;

REVOKE ALL ON FUNCTION public.email_apply_delivery_event(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_apply_delivery_event(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, uuid, jsonb)
  TO service_role;
