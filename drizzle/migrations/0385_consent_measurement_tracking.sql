-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (I9d-Y2, 2/3): PIKSEL I LINKI Z IDENTYFIKATOREM
-- ODBIORCY TYLKO ZA ZGODĄ NA POMIAR - RENDER ŚCIEŻEK, ZAPIS ZDARZEŃ ŚCIEŻEK
-- I KAMPANII, LICZNIK ODBIORCÓW MIERZONYCH KAMPANII. Decyzja właściciela
-- 2026-10-21 (wariant (a), EDPB 2/2023), Z-I9c-09 (wspólny przełącznik).
--
-- DEFEKT
--   1. Mail ścieżki dostaje piksel przy samym przełączniku najemcy, a linki
--      z identyfikatorem odbiorcy (`jm:`) - zawsze; kampanie newslettera nie
--      czytają przełącznika wcale (Z-I9c-09). Pomiar nie zależy od zgody.
--   2. Zapis zdarzeń (piksel, przekierowanie, webhook dostawcy) przyjmuje
--      otwarcie i kliknięcie osoby, która wycofała zgodę - z maila wysłanego
--      PRZED wycofaniem (piksel i linki zostają w skrzynce na zawsze).
--   3. Wskaźniki otwarć kampanii dzielą przez wszystkich odbiorców, choć
--      po Y2 mierzeni są tylko odbiorcy ze zgodą - spadek nie byłby realny.
--
-- ZMIANA (DECYZJE WYKONAWCZE I9d-Y2, dziennik §21.23)
--   A. `journey_contact_for_send` (S5, CIALO-Z niżej - druga redefinicja
--      w rezerwie I9): `measurement` = wspólny przełącznik najemcy ORAZ zgoda
--      kontaktu na pomiar (`_email_measurement_consent`); `open_tracking`
--      (piksel - runner już go czyta) i nowe `link_tracking` (przepisanie
--      linków na `nl-click` z identyfikatorem wiadomości) = `measurement`.
--      Bez zgody: brak piksela, linki NIEPRZEPISANE (bezpieczny wariant
--      zamiast anonimowego liczenia - przekierowanie bez odbiorcy nadal
--      byłoby odczytem z urządzenia; wypis RFC 8058 nie jest pomiarem i zostaje).
--   B. `journey_record_message_event` (S5, CIALO-Z niżej - trzecia
--      redefinicja w I9) i `newsletter_record_campaign_event` (CIALO-Z
--      z rejestru `HUB_CIALO_Z`, ciało z 20261020161900): otwarcie
--      i kliknięcie zapisywane TYLKO przy włączonym przełączniku
--      (`measurement_disabled` - od Y2 przełącznik obejmuje też kliknięcia)
--      i zgodzie odbiorcy na pomiar w CHWILI zdarzenia
--      (`no_measurement_consent` - wycofanie działa także na maile wysłane
--      wcześniej). Przekierowanie i obrazek w TS działają dalej; wypis ścieżki
--      bez zmian. Zdarzenia odrzucone nie podbijają znacznika zaangażowania
--      (wygaszanie Y1 obsłuży niemierzonych jedną prośbą o potwierdzenie).
--   C. `newsletter_campaign_recipients.measured` - czy wysyłka do odbiorcy
--      była mierzona (NULL = sprzed Y2); runner może podać wprost, a gdy nie
--      poda, wyzwalacz liczy przy statusie `sent`. RPC panelu
--      `admin_newsletter_campaign_measurement(kampania)` - mianownik
--      wskaźników (wysłane / mierzone / niemierzone / nieznane).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020162300 (czytelnik zgody, przełącznik)
-- i 20261020161900 (ostatnie definicje zapisu zdarzeń). Runner TS sprzed
-- Y2-B czyta `open_tracking` - piksel znika od razu; linki przepisuje do
-- czasu Y2-B, ale ich kliknięcia bez zgody nie są zapisywane (B).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION (te
-- same sygnatury), DROP TRIGGER IF EXISTS + CREATE TRIGGER, bezstanowe
-- REVOKE/GRANT.
-- DOWÓD: supabase/tests/hub_i9d_y2_tracking_test.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Kontakt do wysyłki ścieżki: pomiar tylko za zgodą.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020161300 (I9c-X2: pole `open_tracking`); zmiana - pomiar =
-- przełącznik ORAZ zgoda kontaktu, nowe pola `measurement` i `link_tracking`.
-- CIALO-Z: 20261020161300
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
  v_measured boolean;
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
  SELECT s.sender_name, s.reply_to INTO v_settings
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

  -- ZMIANA (I9d-Y2): pomiar (piksel i linki z identyfikatorem wiadomości)
  -- tylko przy wspólnym przełączniku najemcy ORAZ zgodzie kontaktu na pomiar.
  v_measured := public._newsletter_track_opens(v_e.tenant_id)
    AND v_lead.email_norm IS NOT NULL
    AND public._email_measurement_consent(v_e.tenant_id, v_lead.email_norm);

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
    'measurement', COALESCE(v_measured, false),
    'open_tracking', COALESCE(v_measured, false),
    'link_tracking', COALESCE(v_measured, false),
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
  'Hub S5: adres, imię, język, treść wariantu i zmienne maila ścieżki - WYŁĄCZNIE service_role (PII tylko w pamięci runnera). I9d-Y2: measurement = open_tracking = link_tracking = wspólny przełącznik najemcy ORAZ zgoda kontaktu na pomiar (bez zgody: bez piksela, linki nieprzepisane).';

-- ----------------------------------------------------------------------------
-- B) Zapis zdarzeń: mail ścieżki (S5).
-- ----------------------------------------------------------------------------
-- Ciało z 20261020161900 (I9c-X2 wyłącznik, I9d-Y1 znacznik zaangażowania);
-- zmiana - otwarcie i kliknięcie tylko przy przełączniku i zgodzie kontaktu.
-- CIALO-Z: 20261020161900
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
  v_email text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('open', 'click', 'unsubscribe') THEN
    RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_m FROM public.journey_messages m WHERE m.message_id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'unknown_message');
  END IF;
  SELECT s.machine_open_seconds INTO v_threshold
    FROM public.journey_settings s WHERE s.tenant_id = v_m.tenant_id;
  SELECT l.email_norm INTO v_email FROM public.crm_leads l WHERE l.id = v_m.lead_id;
  IF p_kind IN ('open', 'click') THEN
    -- ZMIANA (I9d-Y2, Z-I9c-09): wspólny przełącznik najemcy obejmuje
    -- otwarcia I kliknięcia (dotąd tylko otwarcia - `open_tracking_disabled`).
    IF NOT public._newsletter_track_opens(v_m.tenant_id) THEN
      RETURN jsonb_build_object('recorded', false, 'reason', 'measurement_disabled', 'tenant_id', v_m.tenant_id);
    END IF;
    -- ZMIANA (I9d-Y2): zgoda kontaktu na pomiar w CHWILI zdarzenia - piksel
    -- i link z maila wysłanego przed wycofaniem niczego już nie zapisują.
    IF v_email IS NULL OR NOT public._email_measurement_consent(v_m.tenant_id, v_email) THEN
      RETURN jsonb_build_object('recorded', false, 'reason', 'no_measurement_consent', 'tenant_id', v_m.tenant_id);
    END IF;
  END IF;
  -- Otwarcie tuż po wysyłce to skaner albo proxy (MPP), nie człowiek.
  v_machine := COALESCE(p_machine, false)
    OR (p_kind = 'open' AND now() - v_m.queued_at < make_interval(secs => COALESCE(v_threshold, 2)));

  -- (I9d-Y1, Z-I9c-08): trwały znacznik zaangażowania subskrybenta
  -- newslettera (wygaszanie nieaktywnych) - PRZED wstawieniem, bo
  -- deduplikacja doby zjadłaby ludzkie otwarcie po maszynowym. Kliknięcie
  -- zawsze; otwarcie - po progu czasu od wysyłki (Apple MPP pobiera piksel
  -- przy doręczeniu). Flaga proxy z TS (`p_machine`) tu się nie liczy:
  -- proxy Gmaila pobiera obrazki przy faktycznym otwarciu.
  IF p_kind = 'click'
     OR (p_kind = 'open' AND now() - v_m.queued_at >= make_interval(secs => COALESCE(v_threshold, 2))) THEN
    PERFORM public._newsletter_engagement_touch(v_m.tenant_id, NULL, v_email, p_kind, now());
  END IF;

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
  'Hub S5: otwarcie/kliknięcie/wypis maila ścieżki - najemca z wiadomości, deduplikacja doby, otwarcia maszynowe; wypis wycofuje zgodę (księga), wypisuje subskrybenta z blokadą i kończy aktywne zapisy marketingowe (unsubscribed). I9d: kliknięcie i otwarcie po progu -> znacznik zaangażowania subskrybenta newslettera. I9d-Y2: otwarcie i kliknięcie tylko przy wspólnym przełączniku (measurement_disabled) i zgodzie kontaktu na pomiar w chwili zdarzenia (no_measurement_consent). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- B) Zapis zdarzeń: kampania newslettera.
-- ----------------------------------------------------------------------------
-- Ciało z 20261020161900 (I9d-Y1: znacznik zaangażowania, otwarcie ludzkie
-- po progu od wysyłki); zmiana - przełącznik najemcy i zgoda subskrybenta
-- na pomiar przed zapisem (piksel, przekierowanie i webhook dostawcy).
-- CIALO-Z: 20260814215302
CREATE OR REPLACE FUNCTION public.newsletter_record_campaign_event(
  p_campaign uuid,
  p_subscriber uuid,
  p_kind text,
  p_url text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_subscriber uuid;
  v_email text;
  v_id uuid;
  v_at timestamptz := LEAST(COALESCE(p_occurred_at, now()), now());
  v_sent_at timestamptz;
  v_threshold integer;
BEGIN
  IF p_campaign IS NULL OR p_kind IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'invalid_input');
  END IF;

  IF p_kind NOT IN ('open', 'click') THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'invalid_kind');
  END IF;

  SELECT c.tenant_id INTO v_tenant
    FROM public.newsletter_campaigns c
   WHERE c.id = p_campaign;

  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_campaign');
  END IF;

  SELECT s.id, s.email INTO v_subscriber, v_email
    FROM public.newsletter_subscribers s
   WHERE s.id = p_subscriber
     AND s.tenant_id = v_tenant;

  IF v_subscriber IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'unknown_subscriber');
  END IF;

  -- ZMIANA (I9d-Y2, Z-I9c-09): wspólny przełącznik najemcy (ścieżki
  -- i kampanie) i zgoda subskrybenta na pomiar w chwili zdarzenia.
  IF NOT public._newsletter_track_opens(v_tenant) THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'measurement_disabled',
                              'tenant_id', v_tenant);
  END IF;
  IF NOT public._email_measurement_consent(v_tenant, v_email) THEN
    RETURN jsonb_build_object('recorded', false, 'duplicate', false, 'reason', 'no_measurement_consent',
                              'tenant_id', v_tenant);
  END IF;

  -- (I9d-Y1, Z-I9c-08): znacznik zaangażowania PRZED deduplikacją doby
  -- (ludzkie otwarcie po maszynowym tej samej doby też się liczy).
  -- Otwarcie ludzkie = po progu `machine_open_seconds` (S5) od wysyłki do
  -- tego odbiorcy: Apple MPP pobiera piksel przy doręczeniu; brak chwili
  -- wysyłki (piksel przed zapisem `sent_at`) = maszynowe.
  IF p_kind = 'click' THEN
    PERFORM public._newsletter_engagement_touch(v_tenant, v_subscriber, NULL, 'click', v_at);
  ELSE
    SELECT max(r.sent_at) INTO v_sent_at FROM public.newsletter_campaign_recipients r
     WHERE r.subscriber_id = v_subscriber AND r.campaign_id = p_campaign;
    SELECT js.machine_open_seconds INTO v_threshold FROM public.journey_settings js WHERE js.tenant_id = v_tenant;
    IF v_sent_at IS NOT NULL AND v_at - v_sent_at >= make_interval(secs => COALESCE(v_threshold, 2)) THEN
      PERFORM public._newsletter_engagement_touch(v_tenant, v_subscriber, NULL, 'open', v_at);
    END IF;
  END IF;

  INSERT INTO public.newsletter_campaign_events
    (tenant_id, campaign_id, subscriber_id, kind, url, created_at)
  VALUES (v_tenant, p_campaign, v_subscriber, p_kind, left(p_url, 2048), v_at)
  ON CONFLICT (campaign_id, subscriber_id, kind, ((created_at AT TIME ZONE 'UTC')::date))
    WHERE subscriber_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'recorded',  v_id IS NOT NULL,
    'duplicate', v_id IS NULL,
    'reason',    CASE WHEN v_id IS NULL THEN 'duplicate_in_day' ELSE 'recorded' END,
    'event_id',  v_id,
    'tenant_id', v_tenant,
    'event_day', (v_at AT TIME ZONE 'UTC')::date
  );
END;
$$;

COMMENT ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz) IS
  'Jedyna sciezka zapisu zdarzen open/click. Tenant z kampanii, subskrybent walidowany w tym samym tenancie, wstawienie idempotentne w dobie UTC. I9d: znacznik zaangazowania subskrybenta (klik; otwarcie po progu machine_open_seconds od wysylki) przed deduplikacja. I9d-Y2: tylko przy wspolnym przelaczniku najemcy (measurement_disabled) i zgodzie subskrybenta na pomiar w chwili zdarzenia (no_measurement_consent).';

REVOKE ALL ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_record_campaign_event(uuid, uuid, text, text, timestamptz)
  TO service_role;

-- ----------------------------------------------------------------------------
-- C) Odbiorcy mierzeni kampanii (mianownik wskaźników).
-- ----------------------------------------------------------------------------
-- Gorąca tabela logu wysyłki (upsert per odbiorca) - limit blokady.
SET lock_timeout = '5s';
ALTER TABLE public.newsletter_campaign_recipients
  ADD COLUMN IF NOT EXISTS measured boolean;
RESET lock_timeout;

COMMENT ON COLUMN public.newsletter_campaign_recipients.measured IS
  'Zgoda i pomiar (I9d-Y2): czy mail do odbiorcy miał piksel i linki z identyfikatorem (zgoda na pomiar ORAZ przełącznik najemcy w chwili wysyłki). NULL = wysyłka sprzed Y2 albo niewysłana.';

-- Runner podaje `measured` wprost (to, co faktycznie wyrenderował); gdy nie
-- poda (runner sprzed Y2-B, wznowienie z innego statusu), stan liczy baza
-- w chwili zapisu statusu `sent` - ta sama reguła co render.
CREATE OR REPLACE FUNCTION public.tg_newsletter_recipients_measured()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.measured := public._newsletter_track_opens(NEW.tenant_id)
    AND public._email_measurement_consent(NEW.tenant_id, NEW.email);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_newsletter_recipients_measured() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_newsletter_recipients_measured ON public.newsletter_campaign_recipients;
CREATE TRIGGER trg_newsletter_recipients_measured
  BEFORE INSERT OR UPDATE OF status ON public.newsletter_campaign_recipients
  FOR EACH ROW
  WHEN (NEW.status = 'sent' AND NEW.measured IS NULL)
  EXECUTE FUNCTION public.tg_newsletter_recipients_measured();

-- Panel kampanii: mianownik wskaźników otwarć i kliknięć. Bramka jak
-- `newsletter_campaign_engagement` (admin/editor w najemcy z sesji).
-- rpc-shape: admin_newsletter_campaign_measurement (campaign_id, sent, measured, unmeasured, unknown)
CREATE OR REPLACE FUNCTION public.admin_newsletter_campaign_measurement(p_campaign uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL
     OR NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'editor'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden: staff role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.newsletter_campaigns c WHERE c.id = p_campaign AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT jsonb_build_object(
           'campaign_id', p_campaign,
           'sent', count(*),
           'measured', count(*) FILTER (WHERE r.measured),
           'unmeasured', count(*) FILTER (WHERE r.measured = false),
           'unknown', count(*) FILTER (WHERE r.measured IS NULL))
    INTO v_out
    FROM public.newsletter_campaign_recipients r
   WHERE r.campaign_id = p_campaign AND r.tenant_id = v_tenant AND r.status = 'sent';
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_newsletter_campaign_measurement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_newsletter_campaign_measurement(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_newsletter_campaign_measurement(uuid) IS
  'Zgoda i pomiar (I9d-Y2): mianownik wskaźników kampanii - wysłane, mierzone (zgoda na pomiar i przełącznik w chwili wysyłki), niemierzone, nieznane (sprzed Y2). Admin/editor w najemcy z sesji; obca kampania P0002.';
