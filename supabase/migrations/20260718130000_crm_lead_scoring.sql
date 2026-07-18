-- ============================================================================
-- CRM Lead Scoring - behawioralny scoring leadów z sygnałów platformy.
--
-- Model (wzorzec HubSpot/Marketo, dopasowany do architektury NES):
--   * Sygnały BEHAWIORALNE (z decay czasowym - półokres konfigurowalny):
--       email_open / email_click   (newsletter_campaign_events per subskrybent)
--       contact_form               (contact_messages po e-mailu)
--       event_rsvp                 (event_rsvps; going=1.0, interested=0.5)
--       resource_download          (resource_downloads - biblioteka członkowska)
--       comment                    (comments po user_id)
--       purchase                   (user_purchases status=active)
--       donation                   (donations status=paid/succeeded po e-mailu)
--   * Sygnały STATUSOWE/FIT (bez decay):
--       newsletter_confirmed, marketing_consent, has_company, has_position,
--       has_phone, has_linkedin
--   * Każdy sygnał ma wagę (points) i sufit (cap) - konfigurowalne per tenant
--     w crm_scoring_settings.weights (merge nad domyślnymi).
--   * Wynik -> pasmo: hot / warm / cool / cold (progi per tenant).
--   * Wyjaśnialność: crm_leads.score_breakdown przechowuje rozbicie
--     [{key, count, points}] - panel pokazuje "dlaczego ten wynik".
--
-- Spójność (doktryna platformy):
--   * compute_crm_lead_score aktualizuje wiersz TYLKO gdy wynik się zmienił;
--     UPDATE odpala tg_crm_leads_emit_events -> crm_lead.updated.v1 -> mapa
--     inwalidacji odświeża listę leadów na żywo (zero nowych kanałów).
--   * Triggery sygnałowe są AFTER i połykają błędy (EXCEPTION WHEN OTHERS) -
--     scoring nigdy nie może zepsuć zapisu źródłowego.
--   * Trigger na crm_leads jest kolumnowo zawężony (pola fit/tożsamości),
--     a compute pisze wyłącznie kolumny score_* - brak rekursji.
--
-- Tożsamość: crm_leads.email_norm (lower e-mail). Sygnały user_id łączone
-- przez auth.users.email (SECURITY DEFINER). Horyzont skanu ograniczony
-- (horizon_days, domyślnie 365) + indeksy wspierające.
--
-- Idempotentne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Kolumny wyniku na crm_leads
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_band text NOT NULL DEFAULT 'cold',
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS score_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_leads_score_band_check' AND conrelid = 'public.crm_leads'::regclass
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_score_band_check
      CHECK (score_band IN ('hot', 'warm', 'cool', 'cold'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_leads_tenant_score
  ON public.crm_leads (tenant_id, score DESC);

COMMENT ON COLUMN public.crm_leads.score IS
  'Lead score (0+). Utrzymywany przez compute_crm_lead_score - nie edytować ręcznie.';
COMMENT ON COLUMN public.crm_leads.score_breakdown IS
  'Rozbicie wyniku: [{key, count, points}] - wyjaśnialność scoringu w panelu.';

-- Widok cross-tenant super admina dołącza kolumny na końcu SELECT l.*,
-- więc nowe kolumny crm_leads wymagają odtworzenia widoku (pozycje kolumn).
DROP VIEW IF EXISTS public.crm_leads_all;
CREATE VIEW public.crm_leads_all AS
  SELECT l.*, t.slug AS tenant_slug, t.name AS tenant_name
    FROM public.crm_leads l
    LEFT JOIN public.tenants t ON t.id = l.tenant_id;
ALTER VIEW public.crm_leads_all SET (security_invoker = true);
GRANT SELECT ON public.crm_leads_all TO authenticated;

-- ----------------------------------------------------------------------------
-- 2) Ustawienia scoringu per tenant
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_scoring_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  half_life_days integer NOT NULL DEFAULT 30
    CHECK (half_life_days BETWEEN 1 AND 365),
  horizon_days integer NOT NULL DEFAULT 365
    CHECK (horizon_days BETWEEN 7 AND 1095),
  hot_threshold integer NOT NULL DEFAULT 80 CHECK (hot_threshold > 0),
  warm_threshold integer NOT NULL DEFAULT 45 CHECK (warm_threshold > 0),
  cool_threshold integer NOT NULL DEFAULT 20 CHECK (cool_threshold > 0),
  -- Nadpisania wag: {"email_click": {"points": 6, "cap": 30}, ...} - merge
  -- po kluczu nad crm_scoring_default_weights().
  weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (hot_threshold > warm_threshold AND warm_threshold > cool_threshold)
);

ALTER TABLE public.crm_scoring_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_scoring_settings_staff_read ON public.crm_scoring_settings;
CREATE POLICY crm_scoring_settings_staff_read
  ON public.crm_scoring_settings FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS crm_scoring_settings_admin_write ON public.crm_scoring_settings;
CREATE POLICY crm_scoring_settings_admin_write
  ON public.crm_scoring_settings FOR ALL TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
  );

GRANT SELECT, INSERT, UPDATE ON public.crm_scoring_settings TO authenticated;
GRANT ALL ON public.crm_scoring_settings TO service_role;

-- Aktualizacja stempla przy zapisie ustawień.
CREATE OR REPLACE FUNCTION public.tg_crm_scoring_settings_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_scoring_settings_touch ON public.crm_scoring_settings;
CREATE TRIGGER trg_crm_scoring_settings_touch
  BEFORE INSERT OR UPDATE ON public.crm_scoring_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_crm_scoring_settings_touch();

-- ----------------------------------------------------------------------------
-- 3) Domyślne wagi (jedno źródło prawdy; frontend tylko wyświetla)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_scoring_default_weights()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    -- behawioralne (decay)
    'email_open',           jsonb_build_object('points', 2,  'cap', 16),
    'email_click',          jsonb_build_object('points', 6,  'cap', 30),
    'contact_form',         jsonb_build_object('points', 25, 'cap', 50),
    'event_rsvp',           jsonb_build_object('points', 15, 'cap', 30),
    'resource_download',    jsonb_build_object('points', 12, 'cap', 36),
    'comment',              jsonb_build_object('points', 4,  'cap', 12),
    'purchase',             jsonb_build_object('points', 40, 'cap', 80),
    'donation',             jsonb_build_object('points', 25, 'cap', 50),
    -- statusowe / fit (bez decay)
    'newsletter_confirmed', jsonb_build_object('points', 10, 'cap', 10),
    'marketing_consent',    jsonb_build_object('points', 5,  'cap', 5),
    'has_company',          jsonb_build_object('points', 4,  'cap', 4),
    'has_position',         jsonb_build_object('points', 4,  'cap', 4),
    'has_phone',            jsonb_build_object('points', 3,  'cap', 3),
    'has_linkedin',         jsonb_build_object('points', 3,  'cap', 3)
  );
$$;

REVOKE ALL ON FUNCTION public.crm_scoring_default_weights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_scoring_default_weights() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Indeksy wspierające skan sygnałów
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nce_subscriber_kind_created
  ON public.newsletter_campaign_events (subscriber_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_tenant_email_ci
  ON public.contact_messages (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_donations_tenant_email_ci
  ON public.donations (tenant_id, lower(donor_email))
  WHERE donor_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user_created
  ON public.event_rsvps (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_resource_downloads_user_created
  ON public.resource_downloads (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_purchases_user_status
  ON public.user_purchases (user_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_user_created
  ON public.comments (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email_ci_tenant
  ON public.newsletter_subscribers (tenant_id, lower(email));

-- ----------------------------------------------------------------------------
-- 5) Rdzeń: compute_crm_lead_score(lead_id)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_crm_lead_score(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  l public.crm_leads%ROWTYPE;
  s public.crm_scoring_settings%ROWTYPE;
  w jsonb;
  v_half numeric := 30;
  v_horizon interval := interval '365 days';
  v_hot integer := 80;
  v_warm integer := 45;
  v_cool integer := 20;
  v_user uuid;
  v_count numeric;
  v_decayed numeric;
  v_pts numeric;
  v_total numeric := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_score integer;
  v_band text;
BEGIN
  SELECT * INTO l FROM public.crm_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO s FROM public.crm_scoring_settings WHERE tenant_id = l.tenant_id;
  IF FOUND THEN
    IF NOT s.enabled THEN RETURN; END IF;
    v_half := s.half_life_days;
    v_horizon := make_interval(days => s.horizon_days);
    v_hot := s.hot_threshold;
    v_warm := s.warm_threshold;
    v_cool := s.cool_threshold;
    w := public.crm_scoring_default_weights() || COALESCE(s.weights, '{}'::jsonb);
  ELSE
    w := public.crm_scoring_default_weights();
  END IF;

  -- Konto powiązane po e-mailu (dla sygnałów user_id); brak konta = NULL.
  SELECT u.id INTO v_user
    FROM auth.users u
   WHERE lower(u.email) = l.email_norm
   LIMIT 1;

  -- --- email_open -----------------------------------------------------------
  SELECT count(*),
         COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - e.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed
    FROM public.newsletter_campaign_events e
    JOIN public.newsletter_subscribers ns ON ns.id = e.subscriber_id
   WHERE e.tenant_id = l.tenant_id
     AND e.kind = 'open'
     AND lower(ns.email) = l.email_norm
     AND e.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'email_open'->>'points')::numeric,
                 (w->'email_open'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'email_open', 'count', v_count, 'points', round(v_pts, 1));
  END IF;

  -- --- email_click ----------------------------------------------------------
  SELECT count(*),
         COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - e.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed
    FROM public.newsletter_campaign_events e
    JOIN public.newsletter_subscribers ns ON ns.id = e.subscriber_id
   WHERE e.tenant_id = l.tenant_id
     AND e.kind = 'click'
     AND lower(ns.email) = l.email_norm
     AND e.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'email_click'->>'points')::numeric,
                 (w->'email_click'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'email_click', 'count', v_count, 'points', round(v_pts, 1));
  END IF;

  -- --- contact_form ---------------------------------------------------------
  SELECT count(*),
         COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - m.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed
    FROM public.contact_messages m
   WHERE m.tenant_id = l.tenant_id
     AND lower(m.email) = l.email_norm
     AND m.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'contact_form'->>'points')::numeric,
                 (w->'contact_form'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'contact_form', 'count', v_count, 'points', round(v_pts, 1));
  END IF;

  IF v_user IS NOT NULL THEN
    -- --- event_rsvp (going=1.0, interested=0.5) -----------------------------
    SELECT count(*),
           COALESCE(sum(
             (CASE WHEN r.status = 'going' THEN 1.0 ELSE 0.5 END)
             * power(0.5, GREATEST(extract(epoch FROM (now() - r.created_at)), 0) / 86400.0 / v_half)
           ), 0)
      INTO v_count, v_decayed
      FROM public.event_rsvps r
     WHERE r.tenant_id = l.tenant_id
       AND r.user_id = v_user
       AND r.status IN ('going', 'interested')
       AND r.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'event_rsvp'->>'points')::numeric,
                   (w->'event_rsvp'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object(
        'key', 'event_rsvp', 'count', v_count, 'points', round(v_pts, 1));
    END IF;

    -- --- resource_download --------------------------------------------------
    SELECT count(*),
           COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - d.created_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed
      FROM public.resource_downloads d
     WHERE d.tenant_id = l.tenant_id
       AND d.user_id = v_user
       AND d.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'resource_download'->>'points')::numeric,
                   (w->'resource_download'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object(
        'key', 'resource_download', 'count', v_count, 'points', round(v_pts, 1));
    END IF;

    -- --- comment ------------------------------------------------------------
    SELECT count(*),
           COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - c.created_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed
      FROM public.comments c
     WHERE c.tenant_id = l.tenant_id
       AND c.user_id = v_user
       AND c.status <> 'rejected'
       AND c.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'comment'->>'points')::numeric,
                   (w->'comment'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object(
        'key', 'comment', 'count', v_count, 'points', round(v_pts, 1));
    END IF;

    -- --- purchase (aktywne zakupy) ------------------------------------------
    SELECT count(*),
           COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - p.purchased_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed
      FROM public.user_purchases p
     WHERE p.tenant_id = l.tenant_id
       AND p.user_id = v_user
       AND p.status = 'active'
       AND p.purchased_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'purchase'->>'points')::numeric,
                   (w->'purchase'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object(
        'key', 'purchase', 'count', v_count, 'points', round(v_pts, 1));
    END IF;
  END IF;

  -- --- donation (po e-mailu lub koncie) --------------------------------------
  SELECT count(*),
         COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - d.created_at)), 0) / 86400.0 / v_half)), 0)
    INTO v_count, v_decayed
    FROM public.donations d
   WHERE d.tenant_id = l.tenant_id
     AND d.status = 'paid'
     AND (lower(COALESCE(d.donor_email, '')) = l.email_norm
          OR (v_user IS NOT NULL AND d.user_id = v_user))
     AND d.created_at >= now() - v_horizon;
  v_pts := LEAST(v_decayed * (w->'donation'->>'points')::numeric,
                 (w->'donation'->>'cap')::numeric);
  IF v_count > 0 AND v_pts > 0 THEN
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'donation', 'count', v_count, 'points', round(v_pts, 1));
  END IF;

  -- --- newsletter_confirmed (statusowy, bez decay) ---------------------------
  IF EXISTS (
    SELECT 1 FROM public.newsletter_subscribers ns
     WHERE ns.tenant_id = l.tenant_id
       AND lower(ns.email) = l.email_norm
       AND ns.status = 'subscribed'
       AND ns.confirmed_at IS NOT NULL
  ) THEN
    v_pts := (w->'newsletter_confirmed'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'newsletter_confirmed', 'count', 1, 'points', round(v_pts, 1));
  END IF;

  -- --- sygnały fit (bez decay) ------------------------------------------------
  IF l.marketing_consent THEN
    v_pts := (w->'marketing_consent'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'marketing_consent', 'count', 1, 'points', round(v_pts, 1));
  END IF;
  IF COALESCE(l.company, '') <> '' THEN
    v_pts := (w->'has_company'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'has_company', 'count', 1, 'points', round(v_pts, 1));
  END IF;
  IF COALESCE(l.position, '') <> '' THEN
    v_pts := (w->'has_position'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'has_position', 'count', 1, 'points', round(v_pts, 1));
  END IF;
  IF COALESCE(l.phone, '') <> '' THEN
    v_pts := (w->'has_phone'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'has_phone', 'count', 1, 'points', round(v_pts, 1));
  END IF;
  IF COALESCE(l.linkedin_url, '') <> '' THEN
    v_pts := (w->'has_linkedin'->>'points')::numeric;
    v_total := v_total + v_pts;
    v_breakdown := v_breakdown || jsonb_build_object(
      'key', 'has_linkedin', 'count', 1, 'points', round(v_pts, 1));
  END IF;

  v_score := GREATEST(0, round(v_total))::integer;
  v_band := CASE
    WHEN v_score >= v_hot THEN 'hot'
    WHEN v_score >= v_warm THEN 'warm'
    WHEN v_score >= v_cool THEN 'cool'
    ELSE 'cold'
  END;

  -- Zapis tylko przy realnej zmianie - inaczej każde przeliczenie emitowałoby
  -- crm_lead.updated.v1 (tg_crm_leads_emit_events) bez powodu.
  UPDATE public.crm_leads
     SET score = v_score,
         score_band = v_band,
         score_breakdown = v_breakdown,
         score_updated_at = now()
   WHERE id = l.id
     AND (score IS DISTINCT FROM v_score
          OR score_band IS DISTINCT FROM v_band
          OR score_breakdown IS DISTINCT FROM v_breakdown);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_crm_lead_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_crm_lead_score(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_crm_lead_score(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 6) RPC dla panelu: pojedyncze przeliczenie + przeliczenie hurtowe
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_crm_lead_score(p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid;
  l record;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.crm_leads WHERE id = p_lead_id;
  IF v_tenant IS NULL
     OR (v_tenant <> public.current_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.compute_crm_lead_score(p_lead_id);
  SELECT score, score_band, score_breakdown, score_updated_at
    INTO l FROM public.crm_leads WHERE id = p_lead_id;
  RETURN jsonb_build_object(
    'score', l.score, 'band', l.score_band,
    'breakdown', l.score_breakdown, 'updated_at', l.score_updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_crm_lead_score(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_crm_lead_score(uuid) TO authenticated, service_role;

-- Hurtowe przeliczenie tenanta wywołującego (po zmianie wag / backfill).
-- Zwraca liczbę przetworzonych leadów; limit chroni przed timeoutem.
CREATE OR REPLACE FUNCTION public.recompute_crm_lead_scores(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid;
  v_processed integer := 0;
  r record;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RETURN 0; END IF;
  FOR r IN
    SELECT id FROM public.crm_leads
     WHERE tenant_id = v_tenant
     ORDER BY last_activity_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 5000)
  LOOP
    PERFORM public.compute_crm_lead_score(r.id);
    v_processed := v_processed + 1;
  END LOOP;
  RETURN v_processed;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_crm_lead_scores(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_crm_lead_scores(integer) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) Triggery sygnałowe (AFTER, połykają błędy - nie psują zapisu źródła)
-- ----------------------------------------------------------------------------

-- Zdarzenia kampanii (open/click) -> lead po e-mailu subskrybenta.
CREATE OR REPLACE FUNCTION public.tg_score_on_campaign_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lead uuid;
BEGIN
  SELECT cl.id INTO v_lead
    FROM public.newsletter_subscribers ns
    JOIN public.crm_leads cl
      ON cl.tenant_id = ns.tenant_id AND cl.email_norm = lower(ns.email)
   WHERE ns.id = NEW.subscriber_id
   LIMIT 1;
  IF v_lead IS NOT NULL THEN
    PERFORM public.compute_crm_lead_score(v_lead);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_on_campaign_event ON public.newsletter_campaign_events;
CREATE TRIGGER trg_score_on_campaign_event
  AFTER INSERT ON public.newsletter_campaign_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_campaign_event();

-- Subskrybent (potwierdzenie / wypis) -> lead po e-mailu.
CREATE OR REPLACE FUNCTION public.tg_score_on_subscriber()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lead uuid;
BEGIN
  SELECT cl.id INTO v_lead
    FROM public.crm_leads cl
   WHERE cl.tenant_id = NEW.tenant_id AND cl.email_norm = lower(NEW.email)
   LIMIT 1;
  IF v_lead IS NOT NULL THEN
    PERFORM public.compute_crm_lead_score(v_lead);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_on_subscriber ON public.newsletter_subscribers;
CREATE TRIGGER trg_score_on_subscriber
  AFTER INSERT OR UPDATE OF status, confirmed_at ON public.newsletter_subscribers
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_subscriber();

-- Formularz kontaktowy -> lead po e-mailu (lead powstaje w tym samym zapisie
-- przez crm_upsert_from_form; trigger AFTER widzi go już w tabeli).
CREATE OR REPLACE FUNCTION public.tg_score_on_contact_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lead uuid;
BEGIN
  SELECT cl.id INTO v_lead
    FROM public.crm_leads cl
   WHERE cl.tenant_id = NEW.tenant_id AND cl.email_norm = lower(NEW.email)
   LIMIT 1;
  IF v_lead IS NOT NULL THEN
    PERFORM public.compute_crm_lead_score(v_lead);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_on_contact_message ON public.contact_messages;
CREATE TRIGGER trg_score_on_contact_message
  AFTER INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_contact_message();

-- Sygnały konta (RSVP / pobrania / zakupy / komentarze) -> lead po e-mailu konta.
CREATE OR REPLACE FUNCTION public.crm_score_touch_user(p_tenant uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lead uuid;
BEGIN
  SELECT cl.id INTO v_lead
    FROM auth.users u
    JOIN public.crm_leads cl
      ON cl.tenant_id = p_tenant AND cl.email_norm = lower(u.email)
   WHERE u.id = p_user
   LIMIT 1;
  IF v_lead IS NOT NULL THEN
    PERFORM public.compute_crm_lead_score(v_lead);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_score_touch_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_score_touch_user(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_score_touch_user(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_score_on_user_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.crm_score_touch_user(NEW.tenant_id, NEW.user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_on_event_rsvp ON public.event_rsvps;
CREATE TRIGGER trg_score_on_event_rsvp
  AFTER INSERT OR UPDATE OF status ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_user_signal();

DROP TRIGGER IF EXISTS trg_score_on_resource_download ON public.resource_downloads;
CREATE TRIGGER trg_score_on_resource_download
  AFTER INSERT ON public.resource_downloads
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_user_signal();

DROP TRIGGER IF EXISTS trg_score_on_purchase ON public.user_purchases;
CREATE TRIGGER trg_score_on_purchase
  AFTER INSERT OR UPDATE OF status ON public.user_purchases
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_user_signal();

DROP TRIGGER IF EXISTS trg_score_on_comment ON public.comments;
CREATE TRIGGER trg_score_on_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_user_signal();

-- Darowizny: e-mail darczyńcy lub konto.
CREATE OR REPLACE FUNCTION public.tg_score_on_donation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF NEW.donor_email IS NOT NULL THEN
    SELECT cl.id INTO v_lead
      FROM public.crm_leads cl
     WHERE cl.tenant_id = NEW.tenant_id AND cl.email_norm = lower(NEW.donor_email)
     LIMIT 1;
    IF v_lead IS NOT NULL THEN
      PERFORM public.compute_crm_lead_score(v_lead);
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.user_id IS NOT NULL THEN
    PERFORM public.crm_score_touch_user(NEW.tenant_id, NEW.user_id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_on_donation ON public.donations;
CREATE TRIGGER trg_score_on_donation
  AFTER INSERT OR UPDATE OF status ON public.donations
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_donation();

-- Lead: świeży wynik od razu po utworzeniu oraz po edycji pól fit/tożsamości.
-- Trigger jest kolumnowo zawężony, a compute pisze wyłącznie score_* -
-- brak rekursji (UPDATE score_* nie pasuje do listy kolumn triggera).
CREATE OR REPLACE FUNCTION public.tg_score_on_lead_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.compute_crm_lead_score(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_score_on_lead_change ON public.crm_leads;
CREATE TRIGGER trg_score_on_lead_change
  AFTER INSERT OR UPDATE OF email, email_norm, phone, company, position,
    linkedin_url, marketing_consent
  ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_lead_change();

-- ----------------------------------------------------------------------------
-- 8) Backfill istniejących leadów (bez wołania per wiersz przy dużych bazach:
--    limit bezpieczeństwa 5000 najświeższych per tenant; reszta doliczy się
--    lazy triggerami / przyciskiem "Przelicz wszystkie").
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN (
    SELECT id FROM (
      SELECT id,
             row_number() OVER (PARTITION BY tenant_id ORDER BY last_activity_at DESC) AS rn
        FROM public.crm_leads
    ) ranked
    WHERE rn <= 5000
  ) LOOP
    BEGIN
      PERFORM public.compute_crm_lead_score(r.id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- backfill best-effort
    END;
  END LOOP;
END $$;
