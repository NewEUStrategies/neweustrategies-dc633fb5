-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 4/8): HELPERY AGREGATÓW PRZYCHODU - MRR
-- W CHWILI, RUCHY W OKNIE, PRZYCHÓD ZREALIZOWANY.
--
-- DEFEKT
--   Siedem RPC przychodu (110400) i migawka huba liczyłyby te same trzy
--   rzeczy osobno: MRR w chwili t, ruchy w oknie i przychód zrealizowany.
--   Trzy kopie tej samej sumy to trzy definicje przychodu (brief 05: „trzy
--   prawdy o przychodzie" - pulpit, BI i billing pokazywały różne liczby),
--   a most MRR nie domknąłby się, gdy saldo i ruchy liczy inny kod.
--
-- ZMIANA (helpery WEWNĘTRZNE - bez EXECUTE dla ról API, mogą przyjąć
-- najemcę parametrem, bo żadna rola API ich nie wywoła; §4.4):
--   A. `_revenue_mrr_at(p_tenant, p_at, p_segment, p_segment_at)` - MRR
--      w chwili `p_at` = Σ `delta_minor` ruchów `live` sprzed `p_at`,
--      PER WALUTA (nigdy suma walut), z licznikami: subskrypcje z saldem > 0,
--      klienci (konto, a po anonimizacji Z-07 - subskrypcja), miejsca
--      (ilość z ostatniej historii przed `p_at`, bez niej z bieżącego wiersza,
--      inaczej 1). Segment liczony per SUBSKRYPCJA - z ostatniego ruchu przed
--      `p_segment_at` (domyślnie `p_at`): most z filtrem segmentu bierze ten
--      sam zbiór subskrypcji na początku i na końcu okna, więc się domyka
--      także, gdy klient przeszedł między segmentami.
--   B. `_revenue_movements(p_tenant, p_since, p_until, p_segment)` - ruchy
--      `live` w `[p_since, p_until)` per waluta i rodzaj; ruchy z backfillu
--      (`backfilled`) jako osobny rodzaj `opening` (saldo otwarcia księgi, nie
--      sprzedaż). Kwoty ze znakiem (`churn`/`contraction` ujemne):
--      `_revenue_mrr_at(until) = _revenue_mrr_at(since) + Σ ruchów` z
--      konstrukcji - dowód w pgTAP.
--   C. `_revenue_realized(p_tenant, p_since, p_until)` - przychód
--      zrealizowany z `billing_documents` (AD-07) wystawionych w oknie:
--      faktury i paragony `paid|refunded`, środowisko `live` (z dokumentu,
--      a bez niego z zamówienia), operator inny niż `mock`; per kategoria
--      (`subscription` - odnowienia i zamówienia subskrypcji, `event` -
--      zamówienie z `metadata.event_id`, `content` - odblokowanie treści,
--      `plan_one_time` - plan jednorazowy, np. Decision Lab, `other`) i waluta:
--      brutto, zwroty (kwota zwrotu zamówienia; dokument `refunded` bez
--      zamówienia - cały), netto. Noty korygujące pomijane - zwrot jest już
--      w stanie dokumentu i zamówienia (bez podwójnego odjęcia).
--
-- KOLEJNOŚĆ WDROŻENIA: po 110100-110200, przed 110400 (RPC je wołają).
-- IDEMPOTENTNA: CREATE OR REPLACE FUNCTION (nowe nazwy - bez CIALO-Z),
-- bezstanowe REVOKE.
-- DOWÓD: supabase/tests/revenue_aggregates_test.sql (start + Σ = koniec,
-- waluty rozdzielne, sandbox i `mock` bez wpływu, ACL helperów).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) MRR w chwili.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_mrr_at(
  p_tenant uuid,
  p_at timestamptz,
  p_segment text DEFAULT NULL,
  p_segment_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  currency text,
  mrr_minor bigint,
  active_subscriptions integer,
  active_customers integer,
  seats integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH bal AS (
    SELECT m.subscription_id, m.currency, sum(m.delta_minor) AS amount
      FROM public.mrr_movements m
     WHERE m.tenant_id = p_tenant AND m.environment = 'live' AND m.occurred_at < p_at
     GROUP BY m.subscription_id, m.currency
    HAVING sum(m.delta_minor) > 0
  ), last_mv AS (
    SELECT DISTINCT ON (m.subscription_id) m.subscription_id, m.user_id
      FROM public.mrr_movements m
     WHERE m.tenant_id = p_tenant AND m.environment = 'live' AND m.occurred_at < p_at
     ORDER BY m.subscription_id, m.occurred_at DESC, m.id DESC
  ), seg AS (
    SELECT DISTINCT ON (m.subscription_id) m.subscription_id, m.segment
      FROM public.mrr_movements m
     WHERE m.tenant_id = p_tenant AND m.environment = 'live'
       AND m.occurred_at < COALESCE(p_segment_at, p_at)
     ORDER BY m.subscription_id, m.occurred_at DESC, m.id DESC
  ), qty AS (
    SELECT DISTINCT ON (h.subscription_id) h.subscription_id, h.quantity_after
      FROM public.subscription_state_history h
     WHERE h.tenant_id = p_tenant AND h.environment = 'live' AND h.occurred_at < p_at
     ORDER BY h.subscription_id, h.occurred_at DESC, h.id DESC
  )
  SELECT b.currency,
         sum(b.amount)::bigint,
         count(DISTINCT b.subscription_id)::integer,
         count(DISTINCT COALESCE(l.user_id::text, 'sub:' || b.subscription_id::text))::integer,
         sum(GREATEST(COALESCE(q.quantity_after, s.quantity, 1), 1))::integer
    FROM bal b
    LEFT JOIN last_mv l ON l.subscription_id = b.subscription_id
    LEFT JOIN seg g ON g.subscription_id = b.subscription_id
    LEFT JOIN qty q ON q.subscription_id = b.subscription_id
    LEFT JOIN public.subscriptions s ON s.id = b.subscription_id
   WHERE p_segment IS NULL OR p_segment = 'all' OR g.segment = p_segment
   GROUP BY b.currency
$$;

COMMENT ON FUNCTION public._revenue_mrr_at(uuid, timestamptz, text, timestamptz) IS
  'Hub przychodu (S2): MRR live w chwili per waluta (Σ ruchów sprzed p_at) z licznikami subskrypcji, klientów i miejsc; segment subskrypcji z ostatniego ruchu przed p_segment_at.';

-- ----------------------------------------------------------------------------
-- B) Ruchy w oknie.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_movements(
  p_tenant uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_segment text DEFAULT NULL
)
RETURNS TABLE (
  currency text,
  kind text,
  amount_minor bigint,
  movements integer,
  subscriptions integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH seg AS (
    SELECT DISTINCT ON (m.subscription_id) m.subscription_id, m.segment
      FROM public.mrr_movements m
     WHERE m.tenant_id = p_tenant AND m.environment = 'live' AND m.occurred_at < p_until
     ORDER BY m.subscription_id, m.occurred_at DESC, m.id DESC
  )
  SELECT m.currency,
         CASE WHEN m.backfilled THEN 'opening' ELSE m.kind END,
         sum(m.delta_minor)::bigint,
         count(*)::integer,
         count(DISTINCT m.subscription_id)::integer
    FROM public.mrr_movements m
    LEFT JOIN seg g ON g.subscription_id = m.subscription_id
   WHERE m.tenant_id = p_tenant AND m.environment = 'live'
     AND m.occurred_at >= p_since AND m.occurred_at < p_until
     AND (p_segment IS NULL OR p_segment = 'all' OR g.segment = p_segment)
   GROUP BY m.currency, CASE WHEN m.backfilled THEN 'opening' ELSE m.kind END
$$;

COMMENT ON FUNCTION public._revenue_movements(uuid, timestamptz, timestamptz, text) IS
  'Hub przychodu (S2): ruchy MRR live w [p_since, p_until) per waluta i rodzaj (backfill = opening), kwoty ze znakiem.';

-- ----------------------------------------------------------------------------
-- C) Przychód zrealizowany z dokumentów.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_realized(
  p_tenant uuid,
  p_since timestamptz,
  p_until timestamptz
)
RETURNS TABLE (
  category text,
  currency text,
  gross_minor bigint,
  refunds_minor bigint,
  net_minor bigint,
  documents integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH docs AS (
    SELECT upper(d.currency) AS currency,
           d.amount_cents::bigint AS gross,
           CASE
             WHEN o.id IS NOT NULL AND COALESCE(o.refunded_amount_cents, 0) > 0
               THEN LEAST(o.refunded_amount_cents, d.amount_cents)::bigint
             WHEN d.status = 'refunded' THEN d.amount_cents::bigint
             ELSE 0::bigint
           END AS refunds,
           CASE
             WHEN d.order_id IS NULL OR o.kind = 'subscription' THEN 'subscription'
             WHEN o.metadata ? 'event_id' THEN 'event'
             WHEN o.entity_type IS NOT NULL THEN 'content'
             WHEN o.plan_id IS NOT NULL THEN 'plan_one_time'
             ELSE 'other'
           END AS category
      FROM public.billing_documents d
      LEFT JOIN public.payment_orders o ON o.id = d.order_id
     WHERE d.tenant_id = p_tenant
       AND d.issued_at >= p_since AND d.issued_at < p_until
       AND d.kind IN ('invoice', 'receipt')
       AND d.status IN ('paid', 'refunded')
       AND d.provider <> 'mock'
       AND COALESCE(o.provider, '') <> 'mock'
       AND COALESCE(d.environment, o.environment) = 'live'
  )
  SELECT category, currency, sum(gross)::bigint, sum(refunds)::bigint,
         (sum(gross) - sum(refunds))::bigint, count(*)::integer
    FROM docs
   GROUP BY category, currency
$$;

COMMENT ON FUNCTION public._revenue_realized(uuid, timestamptz, timestamptz) IS
  'Hub przychodu (S2): przychód zrealizowany z billing_documents (live, nie mock) per kategoria i waluta - brutto, zwroty, netto. Jedna definicja dla pulpitu, huba i BI.';

REVOKE ALL ON FUNCTION public._revenue_mrr_at(uuid, timestamptz, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_movements(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._revenue_realized(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
