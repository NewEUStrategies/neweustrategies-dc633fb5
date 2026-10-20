-- ============================================================================
-- HUB „PRZYCHÓD I LEJEK" (S2, 3/8): BACKFILL KSIĘGI - ŚRODOWISKO DOKUMENTÓW
-- I SALDO OTWARCIA MRR.
--
-- DEFEKT
--   1. `billing_documents.environment` (I0) jest NULL dla każdego dokumentu
--      sprzed huba - przychód zrealizowany musiałby albo liczyć piaskownicę
--      razem z produkcją, albo pominąć całą historię.
--   2. Trigger księgi (110100) pisze ruchy od chwili wdrożenia. Subskrypcja,
--      która płaci od miesięcy, nie ma w księdze ani jednego ruchu - MRR
--      z księgi byłby zerem, a pierwsza zmiana jej stanu („przed" = saldo
--      księgi) wyglądałaby jak nowy klient.
--
-- ZMIANA
--   A. `billing_documents.environment` porcjami po `id` (1000 wierszy na
--      krok): ze ZAMÓWIENIA dokumentu (`payment_orders.environment`), a bez
--      zamówienia - z subskrypcji operatora przez uprawnienie
--      (`user_subscriptions.external_ref` = `subscriptions.provider_subscription_id`).
--      Bez żadnego powiązania zostaje NULL = „nieznane" (przychód
--      zrealizowany go nie liczy, a diagnostyka pokazuje liczbę takich
--      dokumentów) - zgadywanie `live` dopisałoby testowe płatności do
--      przychodu.
--   B. Saldo otwarcia: dla każdej subskrypcji `live` w stanie płatnym
--      (`active|past_due` bez pauzy) BEZ żadnego ruchu w księdze - jeden ruch
--      `new` z `reason = 'backfill'`, `backfilled = true`, w chwili wdrożenia
--      (`now()`): księga zaczyna się od dnia wdrożenia (`data_since`), a ruch
--      otwarcia nie udaje sprzedaży z przeszłości. Agregaty (110300) liczą go
--      do salda początku okresu, nie do „nowych". Kwota z
--      `subscription_mrr_minor` (migawka operatora albo - D-05 - katalog,
--      jawnie). Cena spoza katalogu nie dostaje ruchu (MRR nieznany, nie 0).
--      Sandbox nie dostaje salda otwarcia (nie trafia do liczb huba).
--
-- KOLEJNOŚĆ WDROŻENIA: po 110100 (trigger musi już pisać, żeby zmiana stanu
-- w trakcie wdrożenia nie zgubiła ruchu - wiersz z ruchem z triggera jest
-- pomijany przez warunek „bez żadnego ruchu").
-- IDEMPOTENTNA: A dotyka wyłącznie wierszy z `environment IS NULL` i znanym
-- źródłem; B wstawia ruch tylko subskrypcji bez żadnego ruchu - drugie
-- uruchomienie nie zmienia niczego (pgTAP: 2× = ten sam stan).
-- DOWÓD: supabase/tests/revenue_backfill_test.sql.
-- ============================================================================

-- Treść między znacznikami `backfill:` jest w pgTAP 1:1 (revenue_backfill_test
-- uruchamia ją dwukrotnie); zgodność obu kopii pilnuje vitest
-- src/lib/revenue/finance/__tests__/backfillParity.test.ts.
-- backfill:begin
-- ----------------------------------------------------------------------------
-- A) Środowisko dokumentów - porcjami po `id`.
-- ----------------------------------------------------------------------------
DO $backfill_env$
DECLARE
  v_after uuid := '00000000-0000-0000-0000-000000000000';
  v_last uuid;
BEGIN
  LOOP
    -- `uuid` nie ma agregatu `max` - ostatni identyfikator porcji wprost.
    SELECT b.id INTO v_last
      FROM (SELECT d.id FROM public.billing_documents d
             WHERE d.id > v_after AND d.environment IS NULL
             ORDER BY d.id LIMIT 1000) b
     ORDER BY b.id DESC
     LIMIT 1;
    EXIT WHEN v_last IS NULL;
    UPDATE public.billing_documents d
       SET environment = src.environment
      FROM (
        SELECT d2.id,
               COALESCE(
                 CASE WHEN o.environment IN ('sandbox', 'live') THEN o.environment END,
                 CASE WHEN s.environment IN ('sandbox', 'live') THEN s.environment END
               ) AS environment
          FROM public.billing_documents d2
          LEFT JOIN public.payment_orders o ON o.id = d2.order_id
          LEFT JOIN public.user_subscriptions us ON us.id = d2.subscription_id
          LEFT JOIN public.subscriptions s ON s.provider_subscription_id = us.external_ref
         WHERE d2.id > v_after AND d2.id <= v_last AND d2.environment IS NULL
      ) src
     WHERE d.id = src.id AND src.environment IS NOT NULL;
    v_after := v_last;
  END LOOP;
END
$backfill_env$;

-- ----------------------------------------------------------------------------
-- B) Saldo otwarcia MRR (tylko produkcja, tylko bez ruchów).
-- ----------------------------------------------------------------------------
INSERT INTO public.mrr_movements (
  tenant_id, history_id, subscription_id, user_id, environment, occurred_at,
  kind, reason, mrr_before_minor, mrr_after_minor, currency,
  tier_key_before, tier_key_after, interval_before, interval_after, segment, backfilled)
SELECT s.tenant_id, NULL, s.id, s.user_id, s.environment, now(),
       'new', 'backfill', 0, q.mrr_minor, q.currency,
       NULL, q.tier_key, NULL, q.billing_interval,
       public.revenue_segment_of_tier(q.tier_key), true
  FROM public.subscriptions s
  CROSS JOIN LATERAL public.subscription_mrr_minor(
    s.tenant_id, s.price_id, s.quantity, s.unit_amount_minor, s.currency,
    s.discount_minor_per_period, s.discount_ends_at, now()) q
 WHERE s.environment = 'live'
   AND s.status IN ('active', 'past_due')
   AND s.status <> 'paused'
   AND s.pause_collection_behavior IS NULL
   AND q.mrr_minor IS NOT NULL
   AND q.mrr_minor > 0
   AND q.currency ~ '^[A-Z]{3}$'
   AND NOT EXISTS (
     SELECT 1 FROM public.mrr_movements m
      WHERE m.subscription_id = s.id AND m.environment = s.environment);
-- backfill:end
