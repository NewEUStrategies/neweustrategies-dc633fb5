-- ============================================================================
-- INV-13 - RETENCJA DOWODÓW KSIĘGOWYCH DO PRZEDAWNIENIA ZOBOWIĄZANIA
-- PODATKOWEGO: 31.12 ROKU OBROTOWEGO + 6, NIE + 5.
--
-- PRZYCZYNA ŹRÓDŁOWA (20260803090002:117-122): `accounting_retention_until`
-- liczyła `make_date(rok + 5, 12, 31)`. To spełnia art. 74 ust. 2 ustawy
-- o rachunkowości (5 lat od początku roku następującego po roku obrotowym),
-- ale dowody tych samych transakcji są też dokumentami związanymi z
-- rozliczeniem podatku, a te przechowuje się do upływu przedawnienia
-- zobowiązania podatkowego:
--   * art. 86 § 1 Ordynacji podatkowej i art. 112 ustawy o VAT - księgi
--     i dokumenty "do czasu upływu okresu przedawnienia zobowiązania
--     podatkowego";
--   * art. 70 § 1 Ordynacji podatkowej - zobowiązanie przedawnia się z upływem
--     5 lat, licząc od końca roku kalendarzowego, w którym upłynął TERMIN
--     PŁATNOŚCI podatku.
-- Dla VAT za grudzień roku R termin płatności mija 25 stycznia R+1, dla CIT
-- rocznego za rok R - z końcem trzeciego miesiąca R+1. Przedawnienie kończy
-- się więc 31.12 roku R+6, a dotychczasowy purge (najwcześniej w 2032)
-- usuwałby dowody o rok za wcześnie - gdy zobowiązanie jeszcze się nie
-- przedawniło. Dla transakcji ze stycznia reguła R+6 bywa o kilka miesięcy
-- szersza niż ściśle konieczne, ale jedna reguła dla całego roku obrotowego
-- jest tym, co da się wyjaśnić użytkownikowi i sprawdzić w teście.
--
-- DECYZJA: rok obrotowy (= kalendarzowy, strefa siedziby Europe/Warsaw) + 6.
-- To KONSERWATYWNE odczytanie przepisów, DO POTWIERDZENIA PRZEZ DORADCĘ
-- PODATKOWEGO. RODO tego nie blokuje: dłuższe przechowywanie z mocy obowiązku
-- prawnego ma podstawę (art. 6 ust. 1 lit. c, art. 17 ust. 3 lit. b RODO),
-- a usunięcie dowodu przed przedawnieniem jest nieodwracalne.
--
-- GDZIE ZMIENIĆ, gdy doradca rozstrzygnie inaczej (rok obrotowy inny niż
-- kalendarzowy, inna liczba lat): STAŁA w ciele `accounting_retention_until`
-- niżej ORAZ `ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR`
-- (src/lib/billing/accountingRetentionRule.ts). Test parzystości
-- (src/lib/billing/__tests__/accountingRetentionRule.test.ts) czerwieni się,
-- gdy zmieni się tylko jedna strona; pgTAP
-- (supabase/tests/accounting_retention_test.sql) przybija daty.
--
-- PRZEDŁUŻENIE PONAD REGUŁĘ - BEZ NOWEGO PODSYSTEMU. Bieg przedawnienia bywa
-- zawieszany albo przerywany (art. 70 § 2-6 Ordynacji podatkowej: m.in.
-- postępowanie karne skarbowe, układ ratalny, zabezpieczenie hipoteką,
-- upadłość), a o tym wie wyłącznie dział księgowy. Na to istnieje już
-- `retention_hold` (20260803090002, 20260805090100) na obu tabelach dowodowych:
-- blokada czyszczenia ustawiana przez service_role. Ta migracja dopisuje ten
-- przypadek do jego kontraktu i nie dokłada drugiego mechanizmu.
--
-- CO ROBI:
--   1) `accounting_retention_until` -> rok obrotowy + 6 (jedno źródło prawdy
--      dla triggerów obu tabel; `SET search_path` z 20260803095618 zostaje);
--   2) BACKFILL `retention_until` w `payment_orders` i `user_purchases` -
--      wyłącznie WYDŁUŻENIE, bez dotykania `updated_at` zamówień;
--   3) purge: zapisany stempel to nie wszystko - wiersz znika dopiero, gdy
--      termin minął także według reguły policzonej z daty transakcji teraz
--      (dane odtworzone z kopii sprzed tej migracji z wyłączonymi triggerami
--      niosłyby stary, krótszy stempel);
--   4) komentarze kolumn i funkcji mówią to samo, co kod.
--
-- Wszystko idempotentne: CREATE OR REPLACE, backfill z warunkiem "krócej niż
-- reguła", komentarze.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Reguła retencji.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounting_retention_until(p_at timestamptz)
RETURNS date
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public, pg_temp
AS $$
  -- STAŁA RETENCJI = 6 lat po końcu roku obrotowego (art. 70 § 1 i art. 86 § 1
  -- Ordynacji podatkowej; obejmuje też 5 lat z art. 74 ust. 2 uor). Lustro TS:
  -- ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR. Rok obrotowy w strefie
  -- siedziby: transakcja z 31.12, 23:30 czasu lokalnego należy do roku, w
  -- którym ją zaksięgowano, nie do następnego roku UTC.
  SELECT make_date(EXTRACT(YEAR FROM (p_at AT TIME ZONE 'Europe/Warsaw'))::int + 6, 12, 31);
$$;

COMMENT ON FUNCTION public.accounting_retention_until(timestamptz) IS
  'Ostatni dzień obowiązkowego przechowywania dowodu z podanej chwili: 31.12 szóstego roku po roku obrotowym (przedawnienie zobowiązania podatkowego, art. 70 § 1 i art. 86 § 1 Ordynacji podatkowej; obejmuje art. 74 ust. 2 uor). Konserwatywne odczytanie do potwierdzenia przez doradcę podatkowego - stała w ciele + ACCOUNTING_RETENTION_YEARS_AFTER_FISCAL_YEAR (TS).';

-- ----------------------------------------------------------------------------
-- 2) Backfill zapisanych stempli.
--
-- Triggery stemplujące (`tg_payment_orders_stamp_retention`,
-- `tg_user_purchases_stamp_retention`) przeliczają termin przy KAŻDYM UPDATE,
-- więc sam zapis kolumny wystarcza. Bierzemy wyłącznie wiersze, których
-- stempel jest KRÓTSZY niż reguła: termin dłuższy (ustawiony kiedyś ręcznie)
-- zostaje, a powtórne wykonanie pliku nie dotyka niczego.
--
-- `payment_orders` ma też trigger `payment_orders_updated_at`
-- (20260624172041, `set_updated_at`). Przeliczenie polityki retencji to nie
-- zmiana zamówienia - bez wyłączenia go każde zamówienie dostałoby dziś nowe
-- `updated_at`, czyli fałszywą "ostatnią zmianę" w panelu i w raportach.
-- Wyłączenie jest transakcyjne: inne sesje go nie widzą, a błąd w środku
-- wycofuje je razem z backfillem.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_touch boolean := EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.payment_orders'::regclass
       AND tgname = 'payment_orders_updated_at'
       AND NOT tgisinternal
  );
BEGIN
  IF v_touch THEN
    EXECUTE 'ALTER TABLE public.payment_orders DISABLE TRIGGER payment_orders_updated_at';
  END IF;

  UPDATE public.payment_orders o
     SET retention_until = public.accounting_retention_until(COALESCE(o.paid_at, o.created_at))
   WHERE o.retention_until IS NULL
      OR o.retention_until < public.accounting_retention_until(COALESCE(o.paid_at, o.created_at));

  IF v_touch THEN
    EXECUTE 'ALTER TABLE public.payment_orders ENABLE TRIGGER payment_orders_updated_at';
  END IF;
END $$;

-- `user_purchases` nie ma triggera `updated_at`, a `trg_score_on_purchase`
-- odpala się tylko na `UPDATE OF status` - zapis samego stempla go nie budzi.
UPDATE public.user_purchases p
   SET retention_until = public.accounting_retention_until(p.purchased_at)
 WHERE p.retention_until IS NULL
    OR p.retention_until < public.accounting_retention_until(p.purchased_at);

-- ----------------------------------------------------------------------------
-- 3) Purge: termin według stempla I według reguły.
--
-- Ciała jak w 20260803090002 / 20260805090100 plus jeden warunek: wiersz
-- znika dopiero, gdy minął zarówno zapisany `retention_until`, jak i termin
-- policzony teraz z daty transakcji. Zwykle to ta sama data; różnią się tylko
-- wtedy, gdy stempel jest nieaktualny - i wtedy wygrywa dłuższy.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_payment_orders()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.payment_orders o
   WHERE o.anonymized_at IS NOT NULL
     AND o.user_id IS NULL
     AND o.retention_hold = false
     AND o.retention_until IS NOT NULL
     AND o.retention_until < current_date
     AND public.accounting_retention_until(COALESCE(o.paid_at, o.created_at)) < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_payment_orders() IS
  'Usuwa zanonimizowane zamówienia po upływie retencji - zapisanego retention_until ORAZ reguły accounting_retention_until z daty transakcji (art. 5 ust. 1 lit. e RODO). Pomija wiersze z retention_hold.';

REVOKE EXECUTE ON FUNCTION public.purge_expired_payment_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_payment_orders() TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_user_purchases()
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.user_purchases p
   WHERE p.anonymized_at IS NOT NULL
     AND p.user_id IS NULL
     AND p.retention_hold = false
     AND p.retention_until IS NOT NULL
     AND p.retention_until < current_date
     AND public.accounting_retention_until(p.purchased_at) < current_date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_user_purchases() IS
  'Usuwa zanonimizowane uprawnienia zakupowe po upływie retencji - zapisanego retention_until ORAZ reguły accounting_retention_until z daty zakupu (art. 5 ust. 1 lit. e RODO). Pomija wiersze z retention_hold.';

REVOKE EXECUTE ON FUNCTION public.purge_expired_user_purchases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_user_purchases() TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Kontrakt kolumn - ta sama reguła i ten sam hold na obu tabelach.
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.payment_orders.retention_until IS
  'Ostatni dzień obowiązkowego przechowywania: 31.12 szóstego roku po roku transakcji (przedawnienie podatkowe, art. 70 § 1 i art. 86 § 1 Ordynacji podatkowej; obejmuje art. 74 ust. 2 uor). Stemplowane triggerem z accounting_retention_until.';
COMMENT ON COLUMN public.payment_orders.retention_hold IS
  'Blokada czyszczenia ponad regułę: kontrola skarbowa, spór, chargeback, zawieszenie lub przerwanie biegu przedawnienia (art. 70 § 2-6 Ordynacji podatkowej). Ustawia dział księgowy przez service_role.';
COMMENT ON COLUMN public.user_purchases.retention_until IS
  'Ostatni dzień obowiązkowego przechowywania: 31.12 szóstego roku po roku zakupu (przedawnienie podatkowe, art. 70 § 1 i art. 86 § 1 Ordynacji podatkowej; obejmuje art. 74 ust. 2 uor). Stemplowane triggerem z accounting_retention_until.';
COMMENT ON COLUMN public.user_purchases.retention_hold IS
  'Blokada czyszczenia ponad regułę: kontrola, spór, chargeback, zawieszenie lub przerwanie biegu przedawnienia (art. 70 § 2-6 Ordynacji podatkowej). Ustawia dział księgowy przez service_role.';