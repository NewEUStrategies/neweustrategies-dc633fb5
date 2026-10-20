-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 7/8): PRZEPŁYW ANULOWANIA - ZDARZENIA, SKANER
-- PORZUCENIA, SKUTECZNOŚĆ OFERTY RETENCYJNEJ.
--
-- DEFEKT
--   1. `retention_feedback` zapisywał wyłącznie ZAKOŃCZONE ankiety - kto
--      otworzył dialog anulowania i z niego wyszedł, nie zostawiał śladu.
--      „Save rate" nie miał mianownika, a ścieżki komunikacji nie miały
--      wyzwalacza „klient rozważa odejście".
--   2. Przepływ porzucony w połowie wisiałby w stanie `started` na zawsze.
--   3. Brak agregatu: ile przepływów, ile uratowanych (brutto i netto - bez
--      tych, którzy i tak odeszli później), jakie powody.
--
-- ZMIANA
--   A. `tg_retention_feedback_emit` (AFTER INSERT OR UPDATE OF outcome):
--      wiersz `started` -> `retention_flow.started.v1`; przejście (albo
--      wstawienie) w `saved|canceled|abandoned` -> `retention_flow.completed.v1`
--      z `outcome`, `reason_key` (id powodu z katalogu, `not_given` dla
--      „Anuluj mimo to" przed wyborem powodu - Z-09, `other` dla powodu
--      wpisanego), `offer_shown`, `offer_accepted`. Payload bez komentarza
--      i bez treści powodu (PII). Wiersze bez `outcome` (kod sprzed S2) nie
--      emitują. Awaria szyny nie przerywa zapisu (`_log_emit_error`).
--   B. `run_retention_flow_scanner()` (SERWISOWA, `jobs-tick` co 5 min, I9):
--      `started` starszy niż 24 h -> `abandoned` (bez powodu - CHECK I0
--      dopuszcza `abandoned` bez `reason_label`), znacznik
--      `retention_abandoned:<id>`; partia 1000. UPDATE emituje `completed`.
--   C. `admin_revenue_retention_offers(p_since, p_until)` (panel, tylko
--      admin): przepływy rozpoczęte w oknie - rozpoczęte, uratowane,
--      anulowane, porzucone, otwarte, oferty pokazane/przyjęte,
--      `save_rate_gross` = uratowane / (uratowane + anulowane),
--      `save_rate_net` = uratowane, które NIE odeszły później (brak ruchu
--      `churn` subskrypcji albo konta po przepływie) / (uratowane + anulowane
--      + porzucone); powody (`not_given` osobno - to nie powód) i odpowiedzi
--      sprzed S2 (`legacy_responses`, bez `outcome`).
--
-- KOLEJNOŚĆ WDROŻENIA: po I0 (kolumny `outcome`, `flow_started_at` i CHECK
-- `retention_feedback_reason_label_required`); przed kodem S2, który pisze
-- `started` (`startRetentionFlow`). `CREATE TRIGGER` na gorącej tabeli
-- z `lock_timeout`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- DROP TRIGGER IF EXISTS + CREATE, bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/retention_flow_test.sql (`started` bez powodu, CHECK
-- przy `saved/canceled`, `not_given`, skaner po 24 h, emisje, save rate).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Emiter przepływu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_retention_feedback_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason_key text;
BEGIN
  IF NEW.outcome IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.outcome IS NOT DISTINCT FROM NEW.outcome THEN
    RETURN NEW;
  END IF;
  IF NEW.outcome = 'started' THEN
    IF TG_OP = 'INSERT' THEN
      BEGIN
        PERFORM public.emit_domain_event(NEW.tenant_id, 'retention_flow', NEW.id::text,
          'retention_flow.started.v1',
          jsonb_build_object('feedback_id', NEW.id, 'user_id', NEW.user_id,
            'subscription_id', NEW.subscription_id),
          NEW.user_id);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public._log_emit_error(NEW.tenant_id, 'tg_retention_feedback_emit',
          'retention_flow.started.v1', SQLSTATE, SQLERRM);
      END;
    END IF;
    RETURN NEW;
  END IF;
  v_reason_key := CASE
    WHEN NEW.reason_id IS NOT NULL THEN NEW.reason_id::text
    WHEN NEW.reason_label = 'not_given' THEN 'not_given'
    WHEN NEW.reason_label IS NULL THEN NULL
    ELSE 'other'
  END;
  BEGIN
    PERFORM public.emit_domain_event(NEW.tenant_id, 'retention_flow', NEW.id::text,
      'retention_flow.completed.v1',
      jsonb_build_object('feedback_id', NEW.id, 'user_id', NEW.user_id,
        'subscription_id', NEW.subscription_id, 'outcome', NEW.outcome,
        'reason_key', v_reason_key, 'offer_shown', NEW.offer_shown,
        'offer_accepted', NEW.offer_accepted),
      NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public._log_emit_error(NEW.tenant_id, 'tg_retention_feedback_emit',
      'retention_flow.completed.v1', SQLSTATE, SQLERRM);
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_retention_feedback_emit() IS
  'Hub przychodu (S2): retention_flow.started.v1 (wiersz started) i retention_flow.completed.v1 (saved|canceled|abandoned); payload bez komentarza i treści powodu.';

SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_retention_feedback_emit ON public.retention_feedback;
CREATE TRIGGER trg_retention_feedback_emit
  AFTER INSERT OR UPDATE OF outcome ON public.retention_feedback
  FOR EACH ROW EXECUTE FUNCTION public.tg_retention_feedback_emit();
RESET lock_timeout;

-- ----------------------------------------------------------------------------
-- B) Skaner porzuconych przepływów.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_retention_flow_scanner()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_abandoned integer := 0;
BEGIN
  FOR r IN
    WITH due AS (
      SELECT f.id FROM public.retention_feedback f
       WHERE f.outcome = 'started'
         AND COALESCE(f.flow_started_at, f.created_at) < now() - interval '24 hours'
       ORDER BY COALESCE(f.flow_started_at, f.created_at), f.id
       LIMIT 1000
    )
    UPDATE public.retention_feedback f SET outcome = 'abandoned'
      FROM due WHERE f.id = due.id AND f.outcome = 'started'
    RETURNING f.id, f.tenant_id
  LOOP
    INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
    VALUES (r.tenant_id, 'retention_abandoned', r.id::text)
    ON CONFLICT (tenant_id, kind, ref) DO NOTHING;
    v_abandoned := v_abandoned + 1;
  END LOOP;
  RETURN jsonb_build_object('abandoned', v_abandoned);
END;
$$;

COMMENT ON FUNCTION public.run_retention_flow_scanner() IS
  'Hub przychodu (S2): skaner co 5 min (jobs-tick, service_role) - przepływ anulowania started > 24 h -> abandoned (emisja completed z triggera).';

-- ----------------------------------------------------------------------------
-- C) Skuteczność przepływu i oferty.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_revenue_retention_offers(
  p_since timestamptz,
  p_until timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since
     OR p_until - p_since > interval '400 days' THEN
    RAISE EXCEPTION 'window_invalid' USING ERRCODE = '22023';
  END IF;

  WITH f AS (
    SELECT rf.*, COALESCE(rf.flow_started_at, rf.created_at) AS at
      FROM public.retention_feedback rf
     WHERE rf.tenant_id = v_tenant
       AND COALESCE(rf.flow_started_at, rf.created_at) >= p_since
       AND COALESCE(rf.flow_started_at, rf.created_at) < p_until
  ), flows AS (
    SELECT f.*,
           f.outcome = 'saved' AND NOT EXISTS (
             SELECT 1 FROM public.mrr_movements m
              WHERE m.tenant_id = v_tenant AND m.environment = 'live' AND m.kind = 'churn'
                AND m.occurred_at > f.at
                AND (m.subscription_id = f.subscription_id OR m.user_id = f.user_id)) AS retained
      FROM f WHERE f.outcome IS NOT NULL
  ), c AS (
    SELECT count(*) AS started,
           count(*) FILTER (WHERE outcome = 'saved') AS saved,
           count(*) FILTER (WHERE outcome = 'canceled') AS canceled,
           count(*) FILTER (WHERE outcome = 'abandoned') AS abandoned,
           count(*) FILTER (WHERE outcome = 'started') AS open,
           count(*) FILTER (WHERE offer_shown) AS offers_shown,
           count(*) FILTER (WHERE offer_accepted) AS offers_accepted,
           count(*) FILTER (WHERE retained) AS retained,
           count(*) FILTER (WHERE reason_label = 'not_given') AS not_given
      FROM flows
  )
  SELECT jsonb_build_object(
    'since', p_since,
    'until', p_until,
    'flows_started', c.started,
    'saved', c.saved,
    'canceled', c.canceled,
    'abandoned', c.abandoned,
    'open', c.open,
    'offers_shown', c.offers_shown,
    'offers_accepted', c.offers_accepted,
    'save_rate_gross', CASE WHEN c.saved + c.canceled > 0
                         THEN round(c.saved::numeric / (c.saved + c.canceled), 4) END,
    'save_rate_net', CASE WHEN c.saved + c.canceled + c.abandoned > 0
                       THEN round(c.retained::numeric / (c.saved + c.canceled + c.abandoned), 4) END,
    'reason_not_given', c.not_given,
    'legacy_responses', (SELECT count(*) FROM f WHERE f.outcome IS NULL AND f.reason_label IS NOT NULL),
    'reasons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('reason_id', x.reason_id, 'reason_label', x.reason_label,
                                          'responses', x.n) ORDER BY x.n DESC, x.reason_label)
        FROM (SELECT f.reason_id, min(f.reason_label) AS reason_label, count(*) AS n
                FROM f
               WHERE f.reason_label IS NOT NULL AND f.reason_label <> 'not_given'
               GROUP BY f.reason_id, CASE WHEN f.reason_id IS NULL THEN f.reason_label END) x), '[]'::jsonb)
  ) INTO v_result
    FROM c;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_retention_feedback_emit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_retention_flow_scanner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention_flow_scanner() TO service_role;
REVOKE ALL ON FUNCTION public.admin_revenue_retention_offers(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_retention_offers(timestamptz, timestamptz) TO authenticated, service_role;
