-- ============================================================================
-- ZWOLNIENIE UZYCIA KODU: STATUS ZAMOWIENIA CZYTANY POD BLOKADA WIERSZA.
--
-- DEFEKT (20261007140200, przeglad PR #522). `_release_b2b_coupon` sprawdzal
-- status zamowienia zwyklym EXISTS, bez blokady, a realizacje usuwal kilka
-- instrukcji pozniej. Pod READ COMMITTED w te luke wchodzi rozliczenie
-- platnosci tego samego zamowienia (oplacona sesja na zamowieniu `failed` /
-- `canceled` jest rozliczana - #498):
--   1. zwolnienie widzi `failed` - warunek spelniony;
--   2. webhook przestawia zamowienie na `paid` (commit);
--   3. `apply_b2b_coupon_effects` widzi `paid` i realizacje - nadaje efekty
--      kuponu (warstwa czlonkowska, CRM) i stempluje effects_applied_at;
--   4. zwolnienie usuwa realizacje i zmniejsza `redemptions_count`.
-- Wynik nieosiagalny przy wykonaniu szeregowym: oplacone zamowienie z nadanymi
-- efektami kodu, a kod jednorazowy znow wazny. (Szeregowo: zwolnienie przed
-- platnoscia -> efekty `no_redemption`; platnosc przed zwolnieniem ->
-- zwolnienie odmawia.)
--
-- ZMIANA. Ten sam warunek (zamowienie TEGO konta, w TYM najemcy, pending /
-- failed / canceled), ale `FOR SHARE` na wierszu zamowienia, PRZED blokada
-- kodu:
--   * przestawienie statusu w toku (UPDATE trzyma blokade wiersza) - czekamy
--     na jego koniec i warunek jest sprawdzany ponownie na nowej wersji
--     wiersza: `paid` -> odmowa;
--   * przestawienie po naszej blokadzie czeka na koniec zwolnienia - wynik
--     jak przy kolejnosci szeregowej (zwolnienie, potem platnosc).
-- FOR SHARE, nie FOR UPDATE: rezerwacja (`_redeem_b2b_coupon`) wstawia
-- realizacje z kluczem obcym do zamowienia (KEY SHARE) - z FOR SHARE sie nie
-- gryzie. Kolejnosc blokad: zamowienie -> kod -> realizacja; zaden zapis
-- statusu zamowienia nie trzyma blokady kodu, wiec cyklu nie ma.
--
-- Reszta funkcji bez zmian; ACL potwierdzone jawnie (CREATE OR REPLACE je
-- zachowuje). Na pasie produkcyjnym: bliznak drizzle 0306_release_coupon_order_lock.
-- IDEMPOTENTNA. DOWOD: supabase/tests/coupon_release_test.sql.
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
  -- Zamowienie TEGO konta, w TYM najemcy, jeszcze nieoplacone - pod blokada
  -- wiersza, zeby rozliczenie platnosci nie weszlo miedzy ten odczyt
  -- a usuniecie realizacji. Oplacone, przetwarzane i zwrocone zachowuja
  -- realizacje - inaczej zwolnienie resetowaloby limit kodu po skorzystaniu
  -- z rabatu.
  PERFORM 1 FROM public.payment_orders o
   WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
     AND o.status IN ('pending', 'failed', 'canceled')
   FOR SHARE OF o;
  IF NOT FOUND THEN
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
