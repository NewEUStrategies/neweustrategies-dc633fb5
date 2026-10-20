-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 6/8): SKANER CYKLU ŻYCIA SUBSKRYPCJI -
-- KONIEC TRIALA, WYGAŚNIĘCIE, UTRATA W WINDYKACJI, MIGAWKA DZIENNA MRR.
--
-- DEFEKT
--   1. Faktów czasowych nie emituje żaden zapis: „trial kończy się za 3 dni"
--      i „dostęp wygasł" dzieją się z upływem czasu, nie z webhookiem. Szyna
--      ich nie zna, więc ścieżki komunikacji (S5) nie mają wyzwalacza
--      przypomnienia o końcu triala ani win-backu.
--   2. Cykl windykacji bez rozstrzygnięcia wisi `open` na zawsze (operator
--      po wyczerpaniu prób czasem nie przysyła zdarzenia, które by go
--      zamknęło) - skuteczność windykacji nie ma mianownika.
--   3. Księga MRR nie ma drugiego, niezależnego pomiaru - błąd klasyfikacji
--      ruchu byłby niewidoczny.
--   4. Pauza i odejście dawały ten sam sygnał (P13): win-back startował
--      także dla klienta, który tylko wstrzymał subskrypcję.
--
-- ZMIANA - `run_revenue_lifecycle_scanner()` (SERWISOWA: wyłącznie
-- service_role; najemca z WIERSZA, nigdy z parametru), wołana literałem
-- z `jobs-tick` co 5 minut (podpięcie: Integrator I9, `jobsTick.server.ts`).
-- Każdy fakt raz - znacznik `revenue_event_marks` (`INSERT … ON CONFLICT DO
-- NOTHING RETURNING`): emisja tylko przy NOWYM znaczniku, więc powtórka
-- ticku niczego nie dubluje. Partie po 500 na rodzaj (budżet ticku).
--   A. `billing_subscription.trial_ending.v1` - `live`, `trialing`, koniec
--      triala w ciągu 3 dni; znacznik `<subskrypcja>:<data końca triala>`.
--   B. `subscription.expired.v1` - `live`, `current_period_end` minął
--      (ostatnie 7 dni - pierwszy przebieg nie zalewa szyny historią),
--      stan bez dostępu (`canceled|unpaid|incomplete_expired|paused`) i konto
--      bez innej żywej subskrypcji; `reason`: `paused` (pauza - win-back jej
--      nie dotyczy, D13), `unpaid` (brak płatności), `ended` (rezygnacja na
--      koniec okresu), `canceled` (anulowanie natychmiastowe); znacznik
--      `<subskrypcja>:<data końca okresu>`.
--   C. Windykacja: cykl `open` starszy niż 30 dni -> `lost`; znacznik
--      `dunning_lost:<cykl>` (ślad, bez zdarzenia - utratę widać w agregacie).
--   D. Migawka dzienna: raz na dobę (UTC) i najemcę - stan BIEŻĄCYCH
--      subskrypcji przeliczony od zera (`subscription_mrr_minor`) per
--      środowisko × waluta × segment: MRR, aktywne, klienci, triale, udział
--      kwot z katalogu. Liczona niezależnie od ruchów - rozjazd z księgą to
--      dryf (reguła `data_quality.ledger_drift`, S7).
--   Zdarzenia bez aktora (`p_suppress_actor`), payload bez PII; awaria szyny
--   nie przerywa przebiegu (`_log_emit_error`).
--
-- KOLEJNOŚĆ WDROŻENIA: po 110100 (cykle windykacji) i 110400. Funkcja nie
-- działa, dopóki I9 nie podepnie jej w `jobs-tick`.
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowa nazwa - bez CIALO-Z),
-- bezstanowe REVOKE/GRANT.
-- DOWÓD: supabase/tests/revenue_lifecycle_scanner_test.sql (T-3 dni raz,
-- `expired` z powodem, pauza = `paused`, utrata po 30 dniach, migawka =
-- suma ruchów, powtórka bez duplikatów, granty).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.run_revenue_lifecycle_scanner()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_marked boolean;
  v_reason text;
  v_tier text;
  v_trial integer := 0;
  v_expired integer := 0;
  v_lost integer := 0;
  v_snap integer := 0;
  v_day text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  -- ── A. Koniec triala za ≤ 3 dni ──────────────────────────────────────────
  FOR r IN
    SELECT s.id, s.tenant_id, s.user_id, s.trial_ends_at
      FROM public.subscriptions s
     WHERE s.environment = 'live' AND s.status = 'trialing'
       AND s.trial_ends_at > now() AND s.trial_ends_at <= now() + interval '3 days'
     ORDER BY s.trial_ends_at, s.id
     LIMIT 500
  LOOP
    v_marked := NULL;
    INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
    VALUES (r.tenant_id, 'trial_ending',
            r.id::text || ':' || to_char(r.trial_ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
    ON CONFLICT (tenant_id, kind, ref) DO NOTHING
    RETURNING true INTO v_marked;
    IF v_marked THEN
      v_trial := v_trial + 1;
      BEGIN
        PERFORM public.emit_domain_event(r.tenant_id, 'billing_subscription', r.id::text,
          'billing_subscription.trial_ending.v1',
          jsonb_build_object('subscription_id', r.id, 'user_id', r.user_id,
            'trial_ends_at', r.trial_ends_at),
          NULL, p_suppress_actor => true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public._log_emit_error(r.tenant_id, 'run_revenue_lifecycle_scanner',
          'billing_subscription.trial_ending.v1', SQLSTATE, SQLERRM);
      END;
    END IF;
  END LOOP;

  -- ── B. Wygaśnięcie dostępu ───────────────────────────────────────────────
  FOR r IN
    SELECT s.id, s.tenant_id, s.user_id, s.price_id, s.status, s.current_period_end,
           s.cancel_at_period_end, s.payment_failure_count, s.first_payment_failed_at,
           s.pause_collection_behavior
      FROM public.subscriptions s
     WHERE s.environment = 'live'
       AND s.status IN ('canceled', 'unpaid', 'incomplete_expired', 'paused')
       AND s.current_period_end < now()
       AND s.current_period_end >= now() - interval '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.subscriptions o
          WHERE o.user_id = s.user_id AND o.tenant_id = s.tenant_id AND o.environment = 'live'
            AND o.id <> s.id AND o.status IN ('active', 'trialing', 'past_due')
            AND (o.current_period_end IS NULL OR o.current_period_end > now()))
     ORDER BY s.current_period_end, s.id
     LIMIT 500
  LOOP
    v_marked := NULL;
    INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
    VALUES (r.tenant_id, 'expired',
            r.id::text || ':' || to_char(r.current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
    ON CONFLICT (tenant_id, kind, ref) DO NOTHING
    RETURNING true INTO v_marked;
    IF v_marked THEN
      v_expired := v_expired + 1;
      v_reason := CASE
        WHEN r.status = 'paused' OR r.pause_collection_behavior IS NOT NULL THEN 'paused'
        WHEN r.status = 'unpaid' OR COALESCE(r.payment_failure_count, 0) > 0
             OR r.first_payment_failed_at IS NOT NULL THEN 'unpaid'
        WHEN r.cancel_at_period_end THEN 'ended'
        ELSE 'canceled'
      END;
      SELECT c.tier_key INTO v_tier FROM public.billing_catalog_entry(r.price_id) c;
      BEGIN
        PERFORM public.emit_domain_event(r.tenant_id, 'subscription', r.id::text,
          'subscription.expired.v1',
          jsonb_build_object('subscription_id', r.id, 'user_id', r.user_id,
            'tier_key', v_tier, 'reason', v_reason),
          NULL, p_suppress_actor => true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public._log_emit_error(r.tenant_id, 'run_revenue_lifecycle_scanner',
          'subscription.expired.v1', SQLSTATE, SQLERRM);
      END;
    END IF;
  END LOOP;

  -- ── C. Windykacja bez rozstrzygnięcia po 30 dniach = utrata ─────────────
  FOR r IN
    WITH due AS (
      SELECT d.id FROM public.dunning_cycles d
       WHERE d.outcome = 'open' AND d.started_at < now() - interval '30 days'
       ORDER BY d.started_at, d.id
       LIMIT 500
    )
    UPDATE public.dunning_cycles d SET outcome = 'lost', lost_at = now()
      FROM due WHERE d.id = due.id AND d.outcome = 'open'
    RETURNING d.id, d.tenant_id
  LOOP
    INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
    VALUES (r.tenant_id, 'dunning_lost', r.id::text)
    ON CONFLICT (tenant_id, kind, ref) DO NOTHING;
    v_lost := v_lost + 1;
  END LOOP;

  -- ── D. Migawka dzienna (raz na dobę UTC i najemcę) ─────────────────────
  FOR r IN
    SELECT DISTINCT s.tenant_id FROM public.subscriptions s
     WHERE NOT EXISTS (SELECT 1 FROM public.revenue_event_marks k
                        WHERE k.tenant_id = s.tenant_id AND k.kind = 'mrr_snapshot' AND k.ref = v_day)
     LIMIT 500
  LOOP
    v_marked := NULL;
    INSERT INTO public.revenue_event_marks (tenant_id, kind, ref)
    VALUES (r.tenant_id, 'mrr_snapshot', v_day)
    ON CONFLICT (tenant_id, kind, ref) DO NOTHING
    RETURNING true INTO v_marked;
    CONTINUE WHEN v_marked IS NULL;
    INSERT INTO public.mrr_daily_snapshots (
      tenant_id, day, environment, currency, segment, mrr_minor, active_subscriptions,
      active_customers, trialing, basis_catalog_share, computed_at)
    SELECT r.tenant_id, v_day::date, x.environment, x.currency, x.segment,
           COALESCE(sum(x.mrr) FILTER (WHERE x.paid), 0),
           count(*) FILTER (WHERE x.paid AND x.mrr > 0),
           count(DISTINCT x.user_id) FILTER (WHERE x.paid AND x.mrr > 0),
           count(*) FILTER (WHERE x.status = 'trialing'),
           CASE WHEN count(*) FILTER (WHERE x.paid AND x.mrr > 0) > 0
                THEN round(count(*) FILTER (WHERE x.paid AND x.mrr > 0 AND x.basis = 'catalog')::numeric
                           / count(*) FILTER (WHERE x.paid AND x.mrr > 0), 4)
                ELSE 0 END,
           now()
      FROM (
        SELECT s.environment, s.user_id, s.status, q.currency, q.mrr_minor AS mrr, q.basis,
               public.revenue_segment_of_tier(q.tier_key) AS segment,
               s.status IN ('active', 'past_due') AND s.pause_collection_behavior IS NULL AS paid
          FROM public.subscriptions s
          CROSS JOIN LATERAL public.subscription_mrr_minor(s.tenant_id, s.price_id, s.quantity,
            s.unit_amount_minor, s.currency, s.discount_minor_per_period, s.discount_ends_at, now()) q
         WHERE s.tenant_id = r.tenant_id
           AND s.status IN ('active', 'past_due', 'trialing')
           AND q.currency ~ '^[A-Z]{3}$'
      ) x
     GROUP BY x.environment, x.currency, x.segment
    ON CONFLICT (tenant_id, day, environment, currency, segment) DO UPDATE
       SET mrr_minor = EXCLUDED.mrr_minor,
           active_subscriptions = EXCLUDED.active_subscriptions,
           active_customers = EXCLUDED.active_customers,
           trialing = EXCLUDED.trialing,
           basis_catalog_share = EXCLUDED.basis_catalog_share,
           computed_at = EXCLUDED.computed_at;
    v_snap := v_snap + 1;
  END LOOP;

  RETURN jsonb_build_object('trial_ending', v_trial, 'expired', v_expired,
                            'dunning_lost', v_lost, 'snapshots', v_snap);
END;
$$;

COMMENT ON FUNCTION public.run_revenue_lifecycle_scanner() IS
  'Hub przychodu (S2): skaner co 5 min (jobs-tick, service_role) - trial_ending T-3 d, subscription.expired z powodem, windykacja lost po 30 d, migawka dzienna MRR; znaczniki revenue_event_marks.';

REVOKE ALL ON FUNCTION public.run_revenue_lifecycle_scanner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_revenue_lifecycle_scanner() TO service_role;
