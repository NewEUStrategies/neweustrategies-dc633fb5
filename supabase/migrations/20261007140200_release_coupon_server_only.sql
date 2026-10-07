-- ============================================================================
-- ZWOLNIENIE UZYCIA KODU: TYLKO Z SERWERA, TYLKO DLA NIEOPLACONEGO ZAMOWIENIA
-- TEGO KONTA.
--
-- DEFEKT (rodzenstwo N-13-1, ktorego 20261007120200 nie objela).
-- `release_b2b_coupon(_coupon_id, _order_id)` (20260730150104:7-31) jest
-- SECURITY DEFINER, ma GRANT dla `authenticated` (i domyslne EXECUTE dla anon)
-- i NIE sprawdza ani wlasciciela zamowienia, ani jego statusu: kasuje wiersz
-- realizacji i zmniejsza `redemptions_count`. `_b2b_coupon_evaluate` liczy
-- limit kampanii z `redemptions_count`, a limit na osobe z liczby wierszy
-- realizacji - wiec zwolnienie zeruje OBA. Scenariusz: czlonek wykorzystuje
-- jednorazowy kod (100% albo z miejscami), placi, czyta swoj wiersz realizacji
-- (polityka b2b_coupon_redemptions_own_select) i woluje
-- `rpc/release_b2b_coupon(coupon_id, wlasne_zamowienie)` - kod znowu jest
-- wazny; powtorzone daje nieograniczone uzycie, a analityka kuponow traci
-- slad realizacji. (Dowod dynamiczny audytu: SET ROLE anon, licznik 1 -> 0.)
--
-- ZMIANA (wzorzec redeem_b2b_coupon_for_user, 20261007120200):
--   A. `_release_b2b_coupon(najemca, konto, kod, zamowienie)` - zwalnia tylko,
--      gdy zamowienie istnieje W TYM najemcy, nalezy do TEGO konta i NIE
--      zostalo oplacone (status pending / failed / canceled - kasa zwalnia po
--      `markOrderSession(..., 'failed')`); usuwa wylacznie wiersze tego konta.
--   B. `release_b2b_coupon_for_user(_tenant_id, _user_id, _coupon_id,
--      _order_id)` - TYLKO `service_role`.
--   C. `release_b2b_coupon(2)` zostaje cienkim wrapperem (konto z JWT, najemca
--      ZAMOWIENIA) z tymi samymi warunkami - TYLKO `service_role`.
--
-- KOLEJNOSC WDROZENIA: NAJPIERW KOD. Kod (`couponRpc.server.ts`,
-- `releaseCouponForUser`) woluje wersje `_for_user` rola serwisowa, a przy
-- PGRST202/42883 wraca do starego wywolania JWT kupujacego - ktore dziala do
-- wejscia tej migracji.
--
-- IDEMPOTENTNA: CREATE OR REPLACE i bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/coupon_release_test.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._release_b2b_coupon(
  p_tenant uuid, p_uid uuid, _coupon_id uuid, _order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_tenant IS NULL OR p_uid IS NULL OR _coupon_id IS NULL OR _order_id IS NULL THEN
    RETURN false;
  END IF;
  -- Zamowienie TEGO konta, w TYM najemcy, jeszcze nieoplacone. Oplacone,
  -- przetwarzane i zwrocone zachowuja realizacje - inaczej zwolnienie
  -- resetowaloby limit kodu po skorzystaniu z rabatu.
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
       AND o.status IN ('pending', 'failed', 'canceled')
  ) THEN
    RETURN false;
  END IF;
  -- Blokada wiersza kodu: rownolegla rezerwacja i zwolnienie licza na tym samym
  -- liczniku.
  PERFORM 1 FROM public.b2b_coupons
   WHERE id = _coupon_id AND tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.b2b_coupon_redemptions r
   WHERE r.coupon_id = _coupon_id AND r.order_id = _order_id
     AND r.user_id = p_uid AND r.tenant_id = p_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.b2b_coupons
     SET redemptions_count = GREATEST(0, COALESCE(redemptions_count, 0) - v_deleted),
         updated_at = now()
   WHERE id = _coupon_id AND tenant_id = p_tenant;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._release_b2b_coupon(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_b2b_coupon_for_user(
  _tenant_id uuid, _user_id uuid, _coupon_id uuid, _order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._release_b2b_coupon(_tenant_id, _user_id, _coupon_id, _order_id);
END $$;
REVOKE ALL ON FUNCTION public.release_b2b_coupon_for_user(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_b2b_coupon_for_user(uuid, uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_b2b_coupon(_coupon_id uuid, _order_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._release_b2b_coupon(
    (SELECT o.tenant_id FROM public.payment_orders o WHERE o.id = _order_id),
    auth.uid(), _coupon_id, _order_id);
END $$;
REVOKE ALL ON FUNCTION public.release_b2b_coupon(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_b2b_coupon(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.release_b2b_coupon_for_user(uuid, uuid, uuid, uuid) IS
  'Zwolnienie uzycia kodu - TYLKO service_role. Wylacznie dla nieoplaconego (pending/failed/canceled) zamowienia tego konta w tym najemcy; usuwa tylko wiersze tego konta.';
COMMENT ON FUNCTION public.release_b2b_coupon(uuid, uuid) IS
  'Wrapper zgodnosci (konto z JWT, najemca zamowienia) z tymi samymi warunkami - TYLKO service_role. Kasa woluje release_b2b_coupon_for_user.';
