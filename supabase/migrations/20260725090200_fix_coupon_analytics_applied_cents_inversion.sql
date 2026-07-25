-- ============================================================================
-- INWERSJA `applied_cents`: kolumny Przychod <-> Rabat w analityce kuponow.
--
-- Semantyka kolumny jest jednoznaczna i ustalona przez pisarza:
--   checkout.functions.ts -> redeem_b2b_coupon(_applied_cents := couponDiscountCents)
-- czyli `b2b_coupon_redemptions.applied_cents` = RABAT zastosowany do
-- zamowienia (a nie kwota zaplacona). Tak tez czyta ja `monetization_dashboard`:
--   coalesce(sum(applied_cents),0) AS discount_cents            <- poprawnie.
--
-- `b2b_coupons_analytics` czytala ja odwrotnie:
--   revenue_cents        := SUM(applied_cents)                  <- to jest RABAT
--   discount_cents_total := SUM(original_cents - applied_cents) <- to jest PRZYCHOD
-- Skutek: w /admin/coupons/analytics kafel „Przychod" pokazywal sume udzielonych
-- rabatow, a wiersz „Rabat lacznie" - realny przychod netto. Przy rabacie 20%
-- obie liczby rozjezdzaly sie czterokrotnie i w PRZECIWNYCH kierunkach, wiec
-- kupon o najwyzszym rabacie wygladal na najbardziej dochodowy. Ten sam blad
-- powtarzal klient w /admin/coupons/redemptions.
--
-- Niezmiennik utrwalony w komentarzach kolumn:
--   original_cents = applied_cents (rabat) + kwota zaplacona
-- Kolumny wyjscia funkcji zostaja pod tymi samymi nazwami (klient ich nie
-- zmienia), poprawiamy WYRAZENIA - liczby zaczynaja odpowiadac naglowkom.
-- ============================================================================

COMMENT ON COLUMN public.b2b_coupon_redemptions.applied_cents IS
  'RABAT zastosowany przy realizacji kuponu (w groszach/centach), nie kwota zaplacona. Niezmiennik: original_cents = applied_cents + zaplacone.';
COMMENT ON COLUMN public.b2b_coupon_redemptions.original_cents IS
  'Kwota zamowienia PRZED rabatem kuponu (w walucie `currency`). Przychod netto = original_cents - applied_cents.';

CREATE OR REPLACE FUNCTION public.b2b_coupons_analytics(_from TIMESTAMPTZ, _to TIMESTAMPTZ)
RETURNS TABLE(
  coupon_id UUID, code TEXT, name TEXT,
  redemptions BIGINT, revenue_cents BIGINT, discount_cents_total BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.code, c.name,
    COUNT(r.id)::BIGINT,
    -- Przychod netto = zaplacone = original - rabat.
    COALESCE(SUM(r.original_cents - r.applied_cents), 0)::BIGINT,
    -- Rabat udzielony = applied_cents (patrz COMMENT ON COLUMN wyzej).
    COALESCE(SUM(r.applied_cents), 0)::BIGINT
  FROM public.b2b_coupons c
  LEFT JOIN public.b2b_coupon_redemptions r
    ON r.coupon_id = c.id
   AND r.tenant_id = c.tenant_id
   AND r.created_at BETWEEN _from AND _to
  WHERE c.tenant_id = public.current_tenant_id()
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role))
  GROUP BY c.id, c.code, c.name
  ORDER BY COUNT(r.id) DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.b2b_coupons_analytics(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Agregaty per kupon B2B dla biezacego tenanta. revenue_cents = przychod netto (original - applied), discount_cents_total = udzielony rabat (applied). Patrz COMMENT ON COLUMN b2b_coupon_redemptions.applied_cents.';
