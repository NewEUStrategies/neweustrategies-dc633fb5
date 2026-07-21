-- ============================================================================
-- CRM lead scoring: sygnał "page_view" (odsłony treści z post_views).
--
-- Domyka listę sygnałów z szyny platformy: odsłony, pobrania, RSVP, zapisy.
-- Odsłony liczą się tylko dla zalogowanych (post_views.user_id NOT NULL) -
-- anonimowych odsłon nie da się przypisać do leada. Waga celowo niska
-- (1 pkt, sufit 10): odsłona to najsłabszy i najczęstszy sygnał.
--
-- Wolumen: post_views rośnie o rzędy wielkości szybciej niż pozostałe źródła,
-- więc trigger dławi przeliczenia - compute odpala się tylko dla PIERWSZEJ
-- odsłony użytkownika w oknie godziny (kolejne i tak zmieniają wynik
-- marginalnie, a pełny przelicz łapie je przy następnym oknie/sygnale).
--
-- Lustro TS: src/lib/crm/scoring.ts (SCORE_SIGNAL_KEYS + DEFAULT_SCORING_WEIGHTS
-- + SCORE_SIGNAL_LABELS) - zaktualizowane w tym samym commicie.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_post_views_user_viewed
  ON public.post_views (user_id, viewed_at)
  WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_scoring_default_weights()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'email_open',           jsonb_build_object('points', 2,  'cap', 16),
    'email_click',          jsonb_build_object('points', 6,  'cap', 30),
    'page_view',            jsonb_build_object('points', 1,  'cap', 10),
    'contact_form',         jsonb_build_object('points', 25, 'cap', 50),
    'event_rsvp',           jsonb_build_object('points', 15, 'cap', 30),
    'resource_download',    jsonb_build_object('points', 12, 'cap', 36),
    'comment',              jsonb_build_object('points', 4,  'cap', 12),
    'purchase',             jsonb_build_object('points', 40, 'cap', 80),
    'donation',             jsonb_build_object('points', 25, 'cap', 50),
    'newsletter_confirmed', jsonb_build_object('points', 10, 'cap', 10),
    'marketing_consent',    jsonb_build_object('points', 5,  'cap', 5),
    'has_company',          jsonb_build_object('points', 4,  'cap', 4),
    'has_position',         jsonb_build_object('points', 4,  'cap', 4),
    'has_phone',            jsonb_build_object('points', 3,  'cap', 3),
    'has_linkedin',         jsonb_build_object('points', 3,  'cap', 3)
  );
$fn$;

REVOKE ALL ON FUNCTION public.crm_scoring_default_weights() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_scoring_default_weights() TO authenticated, service_role;

-- Pełna redefinicja compute_crm_lead_score: jedyna zmiana to blok page_view
-- w sekcji sygnałów konta (v_user) - reszta 1:1 z 20260719083815.
CREATE OR REPLACE FUNCTION public.compute_crm_lead_score(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
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

  SELECT p.id INTO v_user
    FROM public.profiles p
   WHERE p.tenant_id = l.tenant_id
     AND lower(p.email) = l.email_norm
   LIMIT 1;

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
    -- Odsłony treści (post_views): tylko zalogowane, z decay i niskim sufitem.
    SELECT count(*),
           COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - pv.viewed_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed
      FROM public.post_views pv
     WHERE pv.tenant_id = l.tenant_id
       AND pv.user_id = v_user
       AND pv.viewed_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'page_view'->>'points')::numeric,
                   (w->'page_view'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object(
        'key', 'page_view', 'count', v_count, 'points', round(v_pts, 1));
    END IF;

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

    SELECT count(*),
           COALESCE(sum(power(0.5, GREATEST(extract(epoch FROM (now() - c.created_at)), 0) / 86400.0 / v_half)), 0)
      INTO v_count, v_decayed
      FROM public.comments c
     WHERE c.tenant_id = l.tenant_id
       AND c.user_id = v_user
       AND c.status IN ('approved', 'pending')
       AND c.created_at >= now() - v_horizon;
    v_pts := LEAST(v_decayed * (w->'comment'->>'points')::numeric,
                   (w->'comment'->>'cap')::numeric);
    IF v_count > 0 AND v_pts > 0 THEN
      v_total := v_total + v_pts;
      v_breakdown := v_breakdown || jsonb_build_object(
        'key', 'comment', 'count', v_count, 'points', round(v_pts, 1));
    END IF;

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
$fn$;

REVOKE ALL ON FUNCTION public.compute_crm_lead_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_crm_lead_score(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_crm_lead_score(uuid) TO service_role;

-- Trigger z dławieniem: przelicz tylko przy pierwszej odsłonie użytkownika
-- w oknie godziny (kolejne odsłony nie zmieniają wyniku na tyle, by płacić
-- pełny compute przy każdym page view). AFTER + połykanie błędów - scoring
-- nigdy nie psuje zapisu odsłony (ta sama doktryna co pozostałe triggery).
CREATE OR REPLACE FUNCTION public.tg_score_on_post_view()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.post_views pv
     WHERE pv.user_id = NEW.user_id
       AND pv.tenant_id = NEW.tenant_id
       AND pv.viewed_at >= now() - interval '1 hour'
       AND pv.id <> NEW.id
     LIMIT 1
  ) THEN
    RETURN NEW;
  END IF;
  PERFORM public.crm_score_touch_user(NEW.tenant_id, NEW.user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_score_on_post_view ON public.post_views;
CREATE TRIGGER trg_score_on_post_view
  AFTER INSERT ON public.post_views
  FOR EACH ROW EXECUTE FUNCTION public.tg_score_on_post_view();
