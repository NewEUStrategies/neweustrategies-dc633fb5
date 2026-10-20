-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S5, 3/6): ŚCIEŻKI KOMUNIKACJI - WARUNKI, ZGODY
-- I LIMITY WYSYŁKI, KONTAKT DO WYSYŁKI, WALIDACJA GRAFU.
--
-- pg-harness: wyłączenie niżej - warunek `club_member` czyta członkostwo klubu.
-- pg-harness: exclude
--
-- DEFEKT
--   1. Silnik (20261020140100) rozgałęzia się po warunkach (`if_else`),
--      a nie ma ich interpretera - każdy warunek byłby fałszem.
--   2. Mail ścieżki nie ma bramki zgody: dzisiejsza brama listy wykluczeń
--      (`suppressionPolicy.ts`) zna blokady, ale nie zgodę marketingową
--      leada, księgę zgód ani limit częstotliwości (D-03: najwyżej 3 maile
--      marketingowe na 7 dni na kontakt, cisza nocna 21:00-08:00 Europe/Warsaw
--      - maile przesuwane na 08:00).
--   3. Publikacja bez walidacji grafu po stronie bazy przepuściłaby graf
--      z cyklem albo z mailem przy `payment_failed` z ominięciem edytora
--      (wywołanie RPC wprost).
--
-- ZMIANA
--   A. `journey_settings` += `sender_name` (1-120, nazwa nadawcy maili
--      ścieżek; NULL = nazwa serwisu), `reply_to` (adres odpowiedzi ≤ 254,
--      NULL = bez) - przełączniki panelu (admin_journey_settings_save), nie
--      zmienne środowiska. Za długie wartości ODRZUCANE (CHECK), nie
--      przycinane.
--   B. `_journey_eval_predicate(…)` (wewnętrzna; także filtr wejścia
--      i symulacja) + `journey_eval_predicate(p_enrollment_id, p_predicate)`
--      (wewnętrzna, kontrakt SPEC): `email_opened` (domyślnie bez otwarć
--      maszynowych), `email_clicked`, `plan`, `subscription_status`,
--      `crm_stage`, `lifecycle_stage`, `consent`, `newsletter_status`,
--      `has_tag`, `score_band`, `event_since_enrollment`, `club_member`,
--      `event_registered`, `trigger_field` (pole ładunku zdarzenia wejścia,
--      `in`/`not_in` - zaprzeczenie, którego `payload @> condition` nie
--      wyrazi: win-back bez pauzy, D13). Nieznany rodzaj = 22023 (krok
--      ponawiany, nie cichy fałsz).
--   C. `_journey_marketing_consent(p_tenant, p_lead)` (wewnętrzna) - zgoda
--      marketingowa: `crm_leads.marketing_consent` albo subskrybent
--      `confirmed` (`subscribed`, gdy najemca wyłączył double opt-in); ostatni
--      wpis księgi `crm_consent_log` (`marketing`, `given = false`) albo wypis
--      z newslettera ją zdejmuje. Silnik NIGDY jej nie ustawia.
--   D. `journey_can_send(p_enrollment_id, p_category)` (service_role) -
--      `ok|no_consent|unsubscribed|suppressed|capped|quiet`: blokady listy
--      wykluczeń wg polityki kategorii (lustro `suppressionPolicy.ts`:
--      `service` przepuszcza `unsubscribe` i `soft_bounce`), zgoda,
--      limit `marketing_cap_per_7d` z wiadomości ścieżek + kampanii
--      newslettera, cisza nocna. Zapis testowy: tylko blokady techniczne.
--   E. `_journey_quiet_until(p_tenant)` (wewnętrzna) - koniec ciszy nocnej
--      (następne `quiet_end` w strefie najemcy) albo NULL poza ciszą.
--   F. `journey_contact_for_send(p_enrollment_id, p_node_id)` (WYŁĄCZNIE
--      service_role) - adres, imię, język, treść wariantu i zmienne;
--      PII żyje tylko w pamięci runnera, nie trafia do żadnej tabeli ścieżek.
--   G. `journey_validate_graph(p_graph, p_trigger_event_type)` (wewnętrzna)
--      - te same reguły co `src/lib/journeys/graph.ts`: jeden wyzwalacz,
--      DAG, osiągalność, kompletne gałęzie, węzły końcowe tylko `goal|exit`,
--      ≤ 60 węzłów, parametry w granicach CHECK, otwarcie/kliknięcie wskazuje
--      przodka `send_email`, zakaz maila przy `payment_failed` (maile
--      windykacji należą do `dunning.server.ts`).
--
-- KOLEJNOŚĆ WDROŻENIA: po 20261020140100. `ALTER TABLE journey_settings`
-- dotyka tabeli I0 bez ruchu (silnik wyłączony) - zwykła blokada wystarcza.
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, CHECK przez DROP CONSTRAINT IF
-- EXISTS + ADD, CREATE OR REPLACE FUNCTION, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/journeys_consent_test.sql (zgoda, wypis, blokada,
-- limit ścieżki + kampanie, cisza nocna, `service` z podstawą prawną,
-- `journey_contact_for_send` tylko service_role); parytet typów węzłów
-- i reguł: src/lib/journeys/__tests__/nodeTypesParity.test.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Nadawca maili ścieżek (panel, nie env).
-- ----------------------------------------------------------------------------
ALTER TABLE public.journey_settings
  ADD COLUMN IF NOT EXISTS sender_name text,
  ADD COLUMN IF NOT EXISTS reply_to text;

ALTER TABLE public.journey_settings DROP CONSTRAINT IF EXISTS journey_settings_sender_name_check;
ALTER TABLE public.journey_settings
  ADD CONSTRAINT journey_settings_sender_name_check
  CHECK (sender_name IS NULL OR (char_length(btrim(sender_name)) BETWEEN 1 AND 120
                                 AND sender_name !~ '[<>"\r\n]'));
ALTER TABLE public.journey_settings DROP CONSTRAINT IF EXISTS journey_settings_reply_to_check;
ALTER TABLE public.journey_settings
  ADD CONSTRAINT journey_settings_reply_to_check
  CHECK (reply_to IS NULL OR (char_length(reply_to) <= 254
                              AND reply_to ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$'));

COMMENT ON COLUMN public.journey_settings.sender_name IS
  'Hub S5: nazwa nadawcy maili ścieżek (domena nadawcza platformy bez zmian); NULL = nazwa serwisu.';
COMMENT ON COLUMN public.journey_settings.reply_to IS
  'Hub S5: adres odpowiedzi maili ścieżek; NULL = bez nagłówka Reply-To.';

-- ----------------------------------------------------------------------------
-- C) Zgoda marketingowa kontaktu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_marketing_consent(p_tenant uuid, p_lead uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead record;
  v_sub text;
  v_doi boolean;
  v_last boolean;
BEGIN
  SELECT l.email_norm, l.marketing_consent INTO v_lead
    FROM public.crm_leads l WHERE l.id = p_lead AND l.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN 'no_consent';
  END IF;
  SELECT s.status INTO v_sub FROM public.newsletter_subscribers s
   WHERE s.tenant_id = p_tenant AND lower(s.email) = v_lead.email_norm
   ORDER BY s.updated_at DESC LIMIT 1;
  IF v_sub = 'unsubscribed' THEN
    RETURN 'unsubscribed';
  END IF;
  -- Ostatnie słowo księgi zgód wygrywa z flagą leada (wycofanie po zgodzie).
  SELECT c.given INTO v_last FROM public.crm_consent_log c
   WHERE c.tenant_id = p_tenant AND lower(c.email) = v_lead.email_norm AND c.consent_key = 'marketing'
   ORDER BY c.created_at DESC LIMIT 1;
  IF v_last IS FALSE THEN
    RETURN 'no_consent';
  END IF;
  SELECT ns.double_opt_in INTO v_doi FROM public.newsletter_settings ns WHERE ns.tenant_id = p_tenant;
  IF v_lead.marketing_consent OR v_sub = 'confirmed'
     OR (v_sub = 'subscribed' AND v_doi IS FALSE) THEN
    RETURN 'ok';
  END IF;
  RETURN 'no_consent';
END;
$$;

REVOKE ALL ON FUNCTION public._journey_marketing_consent(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- B) Warunki.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_eval_predicate(
  p_tenant uuid,
  p_lead uuid,
  p_user uuid,
  p_enrollment_id uuid,
  p_since timestamptz,
  p_predicate jsonb,
  p_trigger_payload jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := p_predicate ->> 'kind';
  v_lead record;
  v_user uuid;
  v_in text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_predicate -> 'in', '[]'::jsonb)));
  v_keys text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_predicate -> 'tierKeys', '[]'::jsonb)));
  v_hours integer := NULLIF(p_predicate ->> 'withinHours', '')::integer;
  v_tier text;
  v_paid boolean;
  v_status text;
  v_values text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_predicate -> 'values', '[]'::jsonb)));
BEGIN
  SELECT l.id, l.email_norm, l.user_id, l.stage, l.lifecycle_stage, l.tags, l.score_band,
         l.newsletter_status
    INTO v_lead
    FROM public.crm_leads l WHERE l.id = p_lead AND l.tenant_id = p_tenant;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_user := COALESCE(p_user, v_lead.user_id);

  CASE v_kind
    WHEN 'email_opened' THEN
      RETURN p_enrollment_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.journey_messages m
          JOIN public.journey_message_events me ON me.message_id = m.message_id
         WHERE m.enrollment_id = p_enrollment_id AND m.node_id = p_predicate ->> 'nodeId'
           AND me.kind = 'open'
           -- Otwarcia proxy (MPP) domyślnie nie są sygnałem zainteresowania.
           AND (NOT COALESCE((p_predicate ->> 'excludeMachine')::boolean, true) OR NOT me.machine)
           AND (v_hours IS NULL OR me.occurred_at <= m.queued_at + make_interval(hours => v_hours)));
    WHEN 'email_clicked' THEN
      RETURN p_enrollment_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.journey_messages m
          JOIN public.journey_message_events me ON me.message_id = m.message_id
         WHERE m.enrollment_id = p_enrollment_id AND m.node_id = p_predicate ->> 'nodeId'
           AND me.kind = 'click'
           AND (v_hours IS NULL OR me.occurred_at <= m.queued_at + make_interval(hours => v_hours))
           AND (NULLIF(p_predicate ->> 'urlContains', '') IS NULL
                OR position(lower(p_predicate ->> 'urlContains') IN lower(COALESCE(me.url, ''))) > 0));
    WHEN 'plan' THEN
      IF v_user IS NOT NULL THEN
        v_tier := public._membership_tier_for_user(p_tenant, v_user);
        v_paid := EXISTS (
          SELECT 1 FROM public.subscriptions s
           WHERE s.tenant_id = p_tenant AND s.user_id = v_user AND s.environment = 'live'
             AND s.status IN ('active', 'trialing', 'past_due'));
      ELSE
        v_paid := false;
      END IF;
      RETURN CASE p_predicate ->> 'op'
        WHEN 'has_paid' THEN v_paid
        WHEN 'none' THEN NOT v_paid AND v_tier IS NULL
        WHEN 'tier_in' THEN v_tier IS NOT NULL AND v_tier = ANY (v_keys)
        WHEN 'tier_at_least' THEN v_tier IS NOT NULL AND cardinality(v_keys) > 0
          AND public._tier_rank_of(p_tenant, v_tier) >= (
            SELECT min(public._tier_rank_of(p_tenant, k)) FROM unnest(v_keys) k)
        ELSE false
      END;
    WHEN 'subscription_status' THEN
      IF v_user IS NULL THEN
        RETURN false;
      END IF;
      SELECT s.status INTO v_status FROM public.subscriptions s
       WHERE s.tenant_id = p_tenant AND s.user_id = v_user AND s.environment = 'live'
       ORDER BY s.updated_at DESC LIMIT 1;
      RETURN v_status IS NOT NULL AND v_status = ANY (v_in);
    WHEN 'crm_stage' THEN
      RETURN v_lead.stage::text = ANY (v_in);
    WHEN 'lifecycle_stage' THEN
      RETURN v_lead.lifecycle_stage = ANY (v_in);
    WHEN 'consent' THEN
      RETURN public._journey_marketing_consent(p_tenant, p_lead) = 'ok';
    WHEN 'newsletter_status' THEN
      SELECT s.status INTO v_status FROM public.newsletter_subscribers s
       WHERE s.tenant_id = p_tenant AND lower(s.email) = v_lead.email_norm
       ORDER BY s.updated_at DESC LIMIT 1;
      RETURN COALESCE(v_status, v_lead.newsletter_status) = ANY (v_in);
    WHEN 'has_tag' THEN
      RETURN (p_predicate ->> 'tag') = ANY (v_lead.tags);
    WHEN 'score_band' THEN
      RETURN v_lead.score_band = ANY (v_in);
    WHEN 'event_since_enrollment' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.domain_events de
         WHERE de.tenant_id = p_tenant AND de.event_type = p_predicate ->> 'eventType'
           AND de.created_at >= COALESCE(p_since, now())
           AND de.payload @> COALESCE(p_predicate -> 'condition', '{}'::jsonb)
           AND ((de.aggregate_type = 'crm_lead' AND de.aggregate_id = p_lead::text)
                OR de.payload ->> 'lead_id' = p_lead::text
                OR (v_user IS NOT NULL AND (de.payload ->> 'user_id' = v_user::text
                                            OR de.actor_id = v_user))));
    WHEN 'club_member' THEN
      RETURN v_user IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.club_members cm
         WHERE cm.tenant_id = p_tenant AND cm.user_id = v_user AND cm.status = 'active'
           AND (NULLIF(p_predicate ->> 'clubId', '') IS NULL
                OR cm.club_id::text = p_predicate ->> 'clubId'));
    WHEN 'event_registered' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.event_registrations r
          JOIN public.event_people p ON p.id = r.person_id
         WHERE r.tenant_id = p_tenant
           AND (p.email_norm = v_lead.email_norm OR (v_user IS NOT NULL AND p.user_id = v_user))
           AND r.status IN ('pending', 'approved', 'waitlist', 'attended')
           AND (NULLIF(p_predicate ->> 'eventId', '') IS NULL
                OR r.event_id::text = p_predicate ->> 'eventId'));
    WHEN 'trigger_field' THEN
      -- Pole ładunku zdarzenia wejścia: `payload @> condition` nie umie
      -- zaprzeczenia (win-back: `reason <> 'paused'`, D13).
      IF p_trigger_payload IS NULL THEN
        RETURN false;
      END IF;
      v_status := p_trigger_payload ->> (p_predicate ->> 'key');
      RETURN CASE p_predicate ->> 'op'
        WHEN 'in' THEN v_status IS NOT NULL AND v_status = ANY (v_values)
        WHEN 'not_in' THEN v_status IS NULL OR NOT (v_status = ANY (v_values))
        ELSE false
      END;
    ELSE
      RAISE EXCEPTION 'journey: unknown predicate kind %', COALESCE(v_kind, '(null)') USING ERRCODE = '22023';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_eval_predicate(uuid, uuid, uuid, uuid, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.journey_eval_predicate(p_enrollment_id uuid, p_predicate jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_e record;
BEGIN
  SELECT e.tenant_id, e.lead_id, e.user_id, e.entered_at, e.trigger_snapshot -> 'payload' AS payload INTO v_e
    FROM public.journey_enrollments e WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN public._journey_eval_predicate(v_e.tenant_id, v_e.lead_id, v_e.user_id, p_enrollment_id,
                                        v_e.entered_at, p_predicate, v_e.payload);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_eval_predicate(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- E) Cisza nocna.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._journey_quiet_until(p_tenant uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz text := 'Europe/Warsaw';
  v_start time := '21:00';
  v_end time := '08:00';
  v_local timestamp;
  v_now time;
  v_quiet boolean;
  v_until timestamp;
BEGIN
  SELECT s.timezone, s.quiet_start, s.quiet_end INTO v_tz, v_start, v_end
    FROM public.journey_settings s WHERE s.tenant_id = p_tenant;
  v_tz := COALESCE(v_tz, 'Europe/Warsaw');
  v_start := COALESCE(v_start, '21:00');
  v_end := COALESCE(v_end, '08:00');
  IF v_start = v_end THEN
    RETURN NULL;
  END IF;
  v_local := now() AT TIME ZONE v_tz;
  v_now := v_local::time;
  -- Okno przez północ (21:00-08:00) albo w ciągu doby (np. 13:00-14:00).
  v_quiet := CASE WHEN v_start > v_end THEN v_now >= v_start OR v_now < v_end
                  ELSE v_now >= v_start AND v_now < v_end END;
  IF NOT v_quiet THEN
    RETURN NULL;
  END IF;
  v_until := v_local::date + v_end;
  IF v_until <= v_local THEN
    v_until := v_until + interval '1 day';
  END IF;
  RETURN v_until AT TIME ZONE v_tz;
END;
$$;

REVOKE ALL ON FUNCTION public._journey_quiet_until(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- D) Bramka wysyłki.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_can_send(p_enrollment_id uuid, p_category text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_e record;
  v_category text;
  v_reason text;
  v_consent text;
  v_cap integer;
  v_sent integer;
BEGIN
  IF p_category IS NULL OR p_category NOT IN ('marketing', 'service') THEN
    RAISE EXCEPTION 'journey_can_send: category_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT e.tenant_id, e.lead_id, e.is_test, l.email_norm, d.category
    INTO v_e
    FROM public.journey_enrollments e
    JOIN public.crm_leads l ON l.tenant_id = e.tenant_id AND l.id = e.lead_id
    JOIN public.journey_definitions d ON d.tenant_id = e.tenant_id AND d.id = e.journey_id
   WHERE e.id = p_enrollment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journey_can_send: enrollment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Ostrożniej, nie luźniej: kategoria ścieżki wygrywa z deklaracją runnera.
  v_category := CASE WHEN v_e.category = 'marketing' OR p_category = 'marketing'
                     THEN 'marketing' ELSE 'service' END;

  -- Lista wykluczeń (lustro suppressionPolicy.ts): marketing zatrzymuje każda
  -- aktywna blokada; usługa przepuszcza wypis i miękkie odbicie.
  SELECT es.reason INTO v_reason
    FROM public.email_suppressions es
   WHERE es.tenant_id = v_e.tenant_id AND es.email_norm = v_e.email_norm
     AND es.released_at IS NULL AND (es.expires_at IS NULL OR es.expires_at > now())
     AND (v_category = 'marketing' OR es.reason NOT IN ('unsubscribe', 'soft_bounce'))
   ORDER BY (es.reason = 'unsubscribe') DESC, es.updated_at DESC
   LIMIT 1;
  IF v_reason IS NOT NULL THEN
    RETURN CASE WHEN v_reason = 'unsubscribe' THEN 'unsubscribed' ELSE 'suppressed' END;
  END IF;

  -- Test na żywo i komunikacja usługowa (z podstawą prawną): tylko blokady techniczne.
  IF v_e.is_test OR v_category = 'service' THEN
    RETURN 'ok';
  END IF;

  v_consent := public._journey_marketing_consent(v_e.tenant_id, v_e.lead_id);
  IF v_consent <> 'ok' THEN
    RETURN v_consent;
  END IF;

  -- D-03: limit maili marketingowych na kontakt w 7 dni - ścieżki + kampanie.
  SELECT COALESCE(MAX(s.marketing_cap_per_7d), 3) INTO v_cap
    FROM public.journey_settings s WHERE s.tenant_id = v_e.tenant_id;
  SELECT count(*) INTO v_sent
    FROM public.journey_messages m
    JOIN public.journey_definitions d ON d.tenant_id = m.tenant_id AND d.id = m.journey_id
    JOIN public.journey_enrollments en ON en.id = m.enrollment_id
   WHERE m.tenant_id = v_e.tenant_id AND m.lead_id = v_e.lead_id
     AND d.category = 'marketing' AND NOT en.is_test
     AND m.queued_at > now() - interval '7 days';
  v_sent := v_sent + (
    SELECT count(*) FROM public.newsletter_campaign_recipients r
     WHERE r.tenant_id = v_e.tenant_id AND lower(r.email) = v_e.email_norm
       AND r.status = 'sent' AND r.sent_at > now() - interval '7 days');
  IF v_sent >= v_cap THEN
    RETURN 'capped';
  END IF;

  -- D-03: cisza nocna - mail czeka do końca ciszy (runner przesuwa krok).
  IF public._journey_quiet_until(v_e.tenant_id) IS NOT NULL THEN
    RETURN 'quiet';
  END IF;
  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.journey_can_send(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.journey_can_send(uuid, text) TO service_role;

COMMENT ON FUNCTION public.journey_can_send(uuid, text) IS
  'Hub S5: bramka maila ścieżki - ok|no_consent|unsubscribed|suppressed|capped|quiet (lista wykluczeń wg kategorii, zgoda, limit marketing_cap_per_7d ścieżek i kampanii, cisza nocna). Tylko service_role.';

-- ----------------------------------------------------------------------------
-- F) Kontakt do wysyłki (PII wyłącznie w pamięci runnera).
-- ----------------------------------------------------------------------------
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

-- Liczba z JSON-a albo -1 (walidacja nie może rzucać na złym typie).
CREATE OR REPLACE FUNCTION public._journey_num(p_value jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::numeric ELSE -1 END
$$;

REVOKE ALL ON FUNCTION public._journey_num(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- G) Walidacja grafu (lustro src/lib/journeys/graph.ts).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.journey_validate_graph(p_graph jsonb, p_trigger_event_type text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- node-types: lustro JOURNEY_NODE_TYPES (nodeTypesParity.test.ts).
  v_types constant text[] := ARRAY[
    'trigger', 'wait', 'send_email', 'ab_split', 'if_else', 'set_lifecycle_stage',
    'set_crm_stage', 'create_crm_task', 'add_tag', 'remove_tag', 'newsletter_list',
    'notify_staff', 'goal', 'exit'
  ];
  v_errors jsonb := '[]'::jsonb;
  v_nodes jsonb;
  v_edges jsonb;
  v_node jsonb;
  v_edge jsonb;
  v_id text;
  v_type text;
  v_params jsonb;
  v_required text[];
  v_allowed text[];
  v_branches text[];
  v_trigger text;
  v_count integer;
  v_visited integer;
  v_pred jsonb;
  v_n integer;
BEGIN
  IF jsonb_typeof(p_graph) <> 'object' OR jsonb_typeof(p_graph -> 'nodes') <> 'array'
     OR jsonb_typeof(p_graph -> 'edges') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'errors', jsonb_build_array(jsonb_build_object('code', 'graph_shape')));
  END IF;
  v_nodes := p_graph -> 'nodes';
  v_edges := p_graph -> 'edges';
  v_count := jsonb_array_length(v_nodes);
  IF v_count = 0 OR v_count > 60 THEN
    v_errors := v_errors || jsonb_build_object('code', 'nodes_count');
  END IF;

  -- Identyfikatory i typy.
  FOR v_node IN SELECT jsonb_array_elements(v_nodes) LOOP
    v_id := v_node ->> 'id';
    IF v_id IS NULL OR v_id !~ '^[A-Za-z0-9_-]{1,64}$' THEN
      v_errors := v_errors || jsonb_build_object('code', 'node_id_invalid', 'nodeId', v_id);
    END IF;
    IF NOT ((v_node ->> 'type') = ANY (v_types)) THEN
      v_errors := v_errors || jsonb_build_object('code', 'node_type_unknown', 'nodeId', v_id);
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT n ->> 'id') FROM jsonb_array_elements(v_nodes) n) <> v_count THEN
    v_errors := v_errors || jsonb_build_object('code', 'node_id_duplicate');
  END IF;
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_nodes) n WHERE n ->> 'type' = 'trigger';
  IF v_n <> 1 THEN
    v_errors := v_errors || jsonb_build_object('code', 'trigger_count');
  END IF;
  SELECT n ->> 'id' INTO v_trigger FROM jsonb_array_elements(v_nodes) n WHERE n ->> 'type' = 'trigger' LIMIT 1;

  -- Krawędzie: końce istnieją, gałąź dozwolona dla typu, bez duplikatów, nic nie wchodzi do wyzwalacza.
  FOR v_edge IN SELECT jsonb_array_elements(v_edges) LOOP
    IF public._journey_node(p_graph, v_edge ->> 'from') IS NULL
       OR public._journey_node(p_graph, v_edge ->> 'to') IS NULL THEN
      v_errors := v_errors || jsonb_build_object('code', 'edge_dangling', 'nodeId', v_edge ->> 'from');
    END IF;
    IF v_edge ->> 'to' = v_trigger THEN
      v_errors := v_errors || jsonb_build_object('code', 'edge_into_trigger', 'nodeId', v_edge ->> 'from');
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM (SELECT DISTINCT e ->> 'from', e ->> 'branch' FROM jsonb_array_elements(v_edges) e) x)
     <> jsonb_array_length(v_edges) THEN
    v_errors := v_errors || jsonb_build_object('code', 'edge_duplicate_branch');
  END IF;

  -- Gałęzie i parametry per typ.
  FOR v_node IN SELECT jsonb_array_elements(v_nodes) LOOP
    v_id := v_node ->> 'id';
    v_type := v_node ->> 'type';
    v_params := COALESCE(v_node -> 'params', '{}'::jsonb);
    v_required := CASE
      WHEN v_type IN ('goal', 'exit') THEN ARRAY[]::text[]
      WHEN v_type = 'ab_split' THEN ARRAY['A', 'B']
      WHEN v_type = 'if_else' THEN ARRAY['yes', 'no']
      WHEN v_type = 'wait' AND v_params ->> 'mode' = 'until_event' THEN ARRAY['event', 'timeout']
      ELSE ARRAY['next']
    END;
    v_branches := ARRAY(SELECT e ->> 'branch' FROM jsonb_array_elements(v_edges) e WHERE e ->> 'from' = v_id);
    IF NOT (v_branches <@ v_required AND v_required <@ v_branches) THEN
      v_errors := v_errors || jsonb_build_object('code', 'branches_incomplete', 'nodeId', v_id);
    END IF;

    CASE v_type
      WHEN 'wait' THEN
        IF v_params ->> 'mode' = 'duration' THEN
          IF NOT (public._journey_num(v_params -> 'minutes') BETWEEN 5 AND 525600) THEN
            v_errors := v_errors || jsonb_build_object('code', 'wait_minutes', 'nodeId', v_id);
          END IF;
        ELSIF v_params ->> 'mode' = 'until_time' THEN
          IF COALESCE(v_params ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             OR jsonb_typeof(v_params -> 'weekdays') <> 'array'
             OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_params -> 'weekdays') w
                         WHERE w !~ '^[1-7]$') THEN
            v_errors := v_errors || jsonb_build_object('code', 'wait_until_time', 'nodeId', v_id);
          END IF;
        ELSIF v_params ->> 'mode' = 'until_event' THEN
          IF COALESCE(v_params ->> 'eventType', '') !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+\.v[0-9]+$'
             OR NOT (public._journey_num(v_params -> 'timeoutMinutes') BETWEEN 5 AND 43200) THEN
            v_errors := v_errors || jsonb_build_object('code', 'wait_until_event', 'nodeId', v_id);
          END IF;
        ELSE
          v_errors := v_errors || jsonb_build_object('code', 'wait_mode', 'nodeId', v_id);
        END IF;
      WHEN 'ab_split' THEN
        IF public._journey_num(v_params -> 'weights' -> 'A') + public._journey_num(v_params -> 'weights' -> 'B') <> 100
           OR public._journey_num(v_params -> 'weights' -> 'A') NOT BETWEEN 0 AND 100 THEN
          v_errors := v_errors || jsonb_build_object('code', 'ab_weights', 'nodeId', v_id);
        END IF;
      WHEN 'if_else' THEN
        IF jsonb_typeof(v_params -> 'predicates') <> 'array' OR jsonb_array_length(v_params -> 'predicates') = 0 THEN
          v_errors := v_errors || jsonb_build_object('code', 'if_else_empty', 'nodeId', v_id);
        ELSE
          FOR v_pred IN SELECT jsonb_array_elements(v_params -> 'predicates') LOOP
            IF v_pred ->> 'kind' IN ('email_opened', 'email_clicked') AND NOT EXISTS (
              WITH RECURSIVE anc(node) AS (
                SELECT e ->> 'from' FROM jsonb_array_elements(v_edges) e WHERE e ->> 'to' = v_id
                UNION
                SELECT e ->> 'from' FROM jsonb_array_elements(v_edges) e JOIN anc a ON e ->> 'to' = a.node
              )
              SELECT 1 FROM anc a
               WHERE a.node = v_pred ->> 'nodeId'
                 AND public._journey_node(p_graph, a.node) ->> 'type' = 'send_email'
            ) THEN
              v_errors := v_errors || jsonb_build_object('code', 'predicate_not_ancestor_email', 'nodeId', v_id);
            END IF;
          END LOOP;
        END IF;
      WHEN 'send_email' THEN
        -- Maile windykacji należą do dunning.server.ts.
        IF p_trigger_event_type = 'billing_subscription.payment_failed.v1' THEN
          v_errors := v_errors || jsonb_build_object('code', 'email_on_payment_failed', 'nodeId', v_id);
        END IF;
      WHEN 'set_lifecycle_stage' THEN
        IF NOT (COALESCE(v_params ->> 'stage', '') = ANY (ARRAY[
          'subscriber', 'lead', 'registered', 'mql', 'sql', 'opportunity', 'other'])) THEN
          v_errors := v_errors || jsonb_build_object('code', 'lifecycle_stage', 'nodeId', v_id);
        END IF;
      WHEN 'set_crm_stage' THEN
        IF NOT (COALESCE(v_params ->> 'stage', '') = ANY (enum_range(NULL::public.crm_stage)::text[])) THEN
          v_errors := v_errors || jsonb_build_object('code', 'crm_stage', 'nodeId', v_id);
        END IF;
      WHEN 'create_crm_task' THEN
        IF char_length(btrim(COALESCE(v_params ->> 'title', ''))) NOT BETWEEN 1 AND 200
           OR char_length(COALESCE(v_params ->> 'description', '')) > 2000
           OR NOT (public._journey_num(v_params -> 'dueInDays') BETWEEN 0 AND 60) THEN
          v_errors := v_errors || jsonb_build_object('code', 'task_params', 'nodeId', v_id);
        END IF;
      WHEN 'add_tag', 'remove_tag' THEN
        -- 40 = limit tagu pisarza CRM (run_workflow_step, panel CRM).
        IF char_length(btrim(COALESCE(v_params ->> 'tag', ''))) NOT BETWEEN 1 AND 40 THEN
          v_errors := v_errors || jsonb_build_object('code', 'tag_length', 'nodeId', v_id);
        END IF;
      WHEN 'newsletter_list' THEN
        IF COALESCE(v_params ->> 'op', '') NOT IN ('add', 'remove')
           OR COALESCE(v_params ->> 'listKey', '') !~ '^[A-Za-z0-9_-]{1,64}$' THEN
          v_errors := v_errors || jsonb_build_object('code', 'newsletter_list', 'nodeId', v_id);
        END IF;
      WHEN 'notify_staff' THEN
        IF char_length(btrim(COALESCE(v_params ->> 'message', ''))) NOT BETWEEN 1 AND 500 THEN
          v_errors := v_errors || jsonb_build_object('code', 'staff_message', 'nodeId', v_id);
        END IF;
      ELSE
        NULL;
    END CASE;
  END LOOP;

  -- DAG i osiągalność: Kahn od wyzwalacza (węzeł nieosiągalny albo w cyklu
  -- nie trafia do listy odwiedzonych).
  IF v_trigger IS NOT NULL THEN
    -- UNION (nie UNION ALL): wiersz = para (węzeł, głębokość), więc romby
    -- w DAG-u nie mnożą ścieżek wykładniczo; cykl rośnie w głąb ponad 60.
    WITH RECURSIVE walk(node, depth) AS (
      SELECT v_trigger, 0
      UNION
      SELECT e ->> 'to', w.depth + 1
        FROM walk w JOIN jsonb_array_elements(v_edges) e ON e ->> 'from' = w.node
       WHERE w.depth < 61
    )
    SELECT count(DISTINCT node), COALESCE(max(depth), 0) INTO v_visited, v_n FROM walk;
    IF v_n > 60 THEN
      v_errors := v_errors || jsonb_build_object('code', 'graph_cycle');
    ELSIF v_visited <> v_count THEN
      v_errors := v_errors || jsonb_build_object('code', 'node_unreachable');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(v_errors) = 0, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.journey_validate_graph(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
