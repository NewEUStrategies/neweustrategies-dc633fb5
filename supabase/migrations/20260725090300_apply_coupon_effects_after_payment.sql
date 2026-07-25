-- ============================================================================
-- MARTWY GRANT WARSTWY Z KUPONU: funkcja reklamowana, nigdy niewywolana.
--
-- Stan wyjsciowy:
--   * `b2b_coupons.grants_tier_key` / `grants_duration_days` sa edytowalne w
--     /admin/coupons (kolumna „Plan" w kuponach, kampaniach i realizacjach),
--   * `redeem_b2b_coupon_with_effects` (20260721082414) realizuje ten grant +
--     notatke CRM + bonus lead-scoringu,
--   * ale checkout wola `redeem_b2b_coupon` (bez efektow) - patrz
--     checkout.functions.ts. Zaden kod w repo nie wolal wariantu `_with_effects`,
--     wiec kupon typu „nadaj warstwe" nie nadawal NICZEGO. Panel obiecywal
--     funkcje, ktorej nie bylo.
--
-- Naprawa nie polega na przepieciu checkoutu na `_with_effects` - ta funkcja ma
-- wlasny, powazniejszy defekt: nadaje warstwe czlonkowska w momencie SKLADANIA
-- zamowienia (`status='pending'`), czyli PRZED jakakolwiek płatnością. Kod
-- kuponu stawal sie darmowym tokenem premium bramkowanym wylacznie swoja
-- tajnoscia (ryzyko P2 z audytu 2026-07-23).
--
-- Zamiast tego rozdzielamy dwie rzeczy, ktore nigdy nie powinny byc w jednej
-- transakcji:
--   1) REZERWACJA uzycia kuponu (limity, atomowo) - zostaje przy skladaniu
--      zamowienia w `redeem_b2b_coupon`,
--   2) EFEKTY kuponu (warstwa + CRM) - dopiero po POTWIERDZONEJ płatności,
--      przez `apply_b2b_coupon_effects(_order_id)`, wolane ze sciezki, ktora
--      juz zamienia płatność na dostep (webhook Stripe + finalizacja mock).
--
-- Idempotencja: zatrzask `b2b_coupon_redemptions.effects_applied_at` ustawiany
-- atomowym UPDATE ... WHERE effects_applied_at IS NULL RETURNING. Powtorna
-- dostawa webhooka (Stripe ponawia) nie dubluje ani nadania, ani punktow CRM -
-- ta sama doktryna co `paid_at` z `.neq('status','paid')`.
--
-- Fail-safe: zle skonfigurowany kupon (tier_key bez wiersza w membership_tiers,
-- co zlamaloby FK) NIE wywraca ksiegowania płatności - efekt jest pomijany i
-- raportowany w wyniku funkcji.
-- ============================================================================

-- ── 1. Pochodzenie nadania: 'coupon' + wskazanie kuponu zrodlowego ──────────
ALTER TABLE public.membership_grants
  DROP CONSTRAINT IF EXISTS membership_grants_source_check;
ALTER TABLE public.membership_grants
  ADD CONSTRAINT membership_grants_source_check
  CHECK (source IN ('manual', 'donation', 'import', 'coupon'));

ALTER TABLE public.membership_grants
  ADD COLUMN IF NOT EXISTS source_coupon_id uuid
    REFERENCES public.b2b_coupons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_membership_grants_source_coupon
  ON public.membership_grants (source_coupon_id)
  WHERE source_coupon_id IS NOT NULL;

COMMENT ON COLUMN public.membership_grants.source_coupon_id IS
  'Kupon B2B, ktory nadal te warstwe (source = ''coupon''). Nadanie powstaje WYLACZNIE po potwierdzonej płatności - patrz apply_b2b_coupon_effects.';

-- ── 2. Zatrzask idempotencji efektow na wierszu realizacji ──────────────────
ALTER TABLE public.b2b_coupon_redemptions
  ADD COLUMN IF NOT EXISTS effects_applied_at timestamptz;

COMMENT ON COLUMN public.b2b_coupon_redemptions.effects_applied_at IS
  'Znacznik jednokrotnego zastosowania efektow kuponu (warstwa + CRM). Ustawiany atomowo przez apply_b2b_coupon_effects; ponowna dostawa webhooka jest no-opem.';

-- ── 3. Efekty kuponu po potwierdzonej płatności ─────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_b2b_coupon_effects(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption   public.b2b_coupon_redemptions%ROWTYPE;
  v_coupon       public.b2b_coupons%ROWTYPE;
  v_order_status text;
  v_order_user   uuid;
  v_user         uuid;
  v_lead_id      uuid;
  v_lead_email   text;
  v_tier_exists  boolean := false;
  v_granted      boolean := false;
  v_crm          boolean := false;
BEGIN
  IF _order_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_order');
  END IF;

  -- Efekty sa nastepstwem PŁATNOŚCI, nie zlozenia zamowienia. Bez tego warunku
  -- kod kuponu byl darmowym tokenem premium.
  SELECT o.status, o.user_id INTO v_order_status, v_order_user
    FROM public.payment_orders o WHERE o.id = _order_id;
  IF v_order_status IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;
  IF v_order_status <> 'paid' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_paid');
  END IF;

  -- Atomowy zatrzask: pierwszy woajacy zabiera efekty, kolejni dostaja no-op.
  UPDATE public.b2b_coupon_redemptions r
     SET effects_applied_at = now()
   WHERE r.order_id = _order_id
     AND r.effects_applied_at IS NULL
  RETURNING r.* INTO v_redemption;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', CASE
                  WHEN EXISTS (SELECT 1 FROM public.b2b_coupon_redemptions
                                WHERE order_id = _order_id)
                  THEN 'already_applied' ELSE 'no_redemption' END);
  END IF;

  SELECT * INTO v_coupon FROM public.b2b_coupons
   WHERE id = v_redemption.coupon_id AND tenant_id = v_redemption.tenant_id;
  IF v_coupon.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'coupon_not_found');
  END IF;

  -- Uzytkownik: z wiersza realizacji, w ostatniej instancji z zamowienia
  -- (realizacja moze miec user_id NULL po ON DELETE SET NULL).
  v_user := COALESCE(v_redemption.user_id, v_order_user);
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_user');
  END IF;

  -- ── CRM: notatka + bonus lead-scoringu (jesli lead istnieje) ──────────────
  SELECT u.email INTO v_lead_email FROM auth.users u WHERE u.id = v_user;
  IF v_lead_email IS NOT NULL THEN
    SELECT l.id INTO v_lead_id FROM public.crm_leads l
     WHERE l.tenant_id = v_coupon.tenant_id
       AND l.email_norm = lower(btrim(v_lead_email))
     LIMIT 1;
    IF v_lead_id IS NOT NULL THEN
      INSERT INTO public.crm_lead_notes (tenant_id, lead_id, author_id, body, is_internal)
      VALUES (v_coupon.tenant_id, v_lead_id, v_user,
              'Zrealizowano kupon B2B (płatność potwierdzona): ' || v_coupon.code, true);
      UPDATE public.crm_leads
         SET score = score + COALESCE(v_coupon.lead_score_bonus, 15),
             last_activity_at = now(),
             score_updated_at = now()
       WHERE id = v_lead_id;
      v_crm := true;
    END IF;
  END IF;

  -- ── Nadanie warstwy czlonkowskiej ────────────────────────────────────────
  IF v_coupon.grants_tier_key IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.membership_tiers t
       WHERE t.tenant_id = v_coupon.tenant_id AND t.key = v_coupon.grants_tier_key
    ) INTO v_tier_exists;

    IF v_tier_exists THEN
      INSERT INTO public.membership_grants (
        tenant_id, user_id, tier_key, source, source_coupon_id, note,
        granted_by, starts_at, expires_at
      ) VALUES (
        v_coupon.tenant_id, v_user, v_coupon.grants_tier_key, 'coupon', v_coupon.id,
        'Kupon B2B: ' || v_coupon.code,
        NULL, now(),
        CASE WHEN v_coupon.grants_duration_days IS NOT NULL
             THEN now() + make_interval(days => v_coupon.grants_duration_days)
             ELSE NULL END
      );
      v_granted := true;
    ELSE
      -- Zla konfiguracja kuponu nie moze wywrocic ksiegowania płatności
      -- (FK membership_grants -> membership_tiers). Raportujemy w wyniku.
      RETURN jsonb_build_object(
        'applied', true, 'crm', v_crm, 'tier_granted', false,
        'reason', 'tier_key_not_found', 'tier_key', v_coupon.grants_tier_key);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'applied', true, 'crm', v_crm, 'tier_granted', v_granted,
    'tier_key', v_coupon.grants_tier_key, 'coupon_code', v_coupon.code);
END $$;

-- Wywolywana WYLACZNIE ze sciezki serwerowej ksiegujacej płatność (webhook /
-- finalizacja mock), nigdy z przegladarki - inaczej wracaloby ryzyko nadania
-- warstwy bez płatności.
REVOKE ALL ON FUNCTION public.apply_b2b_coupon_effects(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_b2b_coupon_effects(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_b2b_coupon_effects(uuid) TO service_role;

COMMENT ON FUNCTION public.apply_b2b_coupon_effects(uuid) IS
  'Efekty kuponu B2B (warstwa czlonkowska + notatka/score CRM) dla ZAPLACONEGO zamowienia. Idempotentna przez b2b_coupon_redemptions.effects_applied_at. Tylko service_role.';

-- ── 4. Wycofanie sciezki nadajacej warstwe bez płatności ────────────────────
-- Funkcja zostaje (nie chcemy zmieniac wygenerowanych typow), ale traci prawo
-- wykonania dla klientow: nadawala warstwe przy `status='pending'`.
REVOKE ALL ON FUNCTION public.redeem_b2b_coupon_with_effects(uuid, uuid, integer, integer, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redeem_b2b_coupon_with_effects(uuid, uuid, integer, integer, text)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.redeem_b2b_coupon_with_effects(uuid, uuid, integer, integer, text) IS
  'WYCOFANA (2026-07-25): nadawala warstwe czlonkowska przy skladaniu zamowienia, czyli przed płatnością. Uzyj redeem_b2b_coupon (rezerwacja) + apply_b2b_coupon_effects (po płatności).';
