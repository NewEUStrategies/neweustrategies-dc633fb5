-- ============================================================================
-- SUBSKRYPCJE: UZGODNIENIE DANYCH POD JEDNOZNACZNE POTWIERDZENIE ZAKUPU I
-- KARENCJE ZALEGLYCH PLANOW INDYWIDUALNYCH (przeglad poprawek audytu
-- rozliczen SUB-02, SUB-03 po migracji 20261013090500).
--
-- DEFEKTY.
--   SUB-02  `purchase_confirmed_at` mial dwa znaczenia NULL: „potwierdzenie
--           jeszcze nie wyszlo" (wiersze zakladane przez nowy kod) i „wiersz
--           sprzed kolumny" (potwierdzony dawno temu). Kod nie mogl wiec
--           uznac samego NULL za zakup do potwierdzenia i zgadywal po
--           poprzednim statusie (`incomplete`). Gdy awaria przerwala
--           potwierdzenie PO zapisie statusu `active` (albo `updated`
--           wyprzedzilo `created`), ponowienie zastawalo `active` i mail,
--           CRM, dzwonek oraz jawna zgoda na newsletter z checkoutu
--           przepadaly na zawsze. Po tym uzgodnieniu NULL znaczy wylacznie
--           „potwierdzenie nie wyszlo" i webhook potwierdza kazdy wiersz
--           w stanie active|trialing z pustym znacznikiem - dokladnie raz,
--           atomowym zajeciem.
--   SUB-03  migracja 20261013090500 zakotwiczyla karencje subskrypcji JUZ
--           zaleglych, ale zostawila ich uprawnienia indywidualne
--           (`user_subscriptions.current_period_end`) na koncu nowego,
--           nieoplaconego okresu - przy planie rocznym rok dostepu. Kolejne
--           proby obciazenia przy ustawieniu operatora „zostaw past_due" nie
--           wysylaja zadnego zdarzenia stanu, wiec nic tego nie poprawialo
--           (zespoly domyka dobowy przebieg, osoby - nie).
--
-- ZMIANA (wylacznie dane + komentarz; bez zmian schematu i uprawnien):
--   1. `purchase_confirmed_at` wierszy sprzed znacznika: chwila zalozenia
--      wiersza. Zakres: stan inny niz sprzed zaplaty (`incomplete`,
--      `incomplete_expired` - te czekaja na prawdziwe potwierdzenie) ORAZ
--      wiersz zalozony PRZED pierwszym potwierdzeniem wyslanym przez nowy kod
--      (bez zadnego - wszystkie). Gdy migracja wejdzie po kodzie, wiersz
--      zalozony po pierwszym potwierdzeniu (czekajacy na ponowienie swojego)
--      zostaje nietkniety;
--   2. uprawnienie indywidualne subskrypcji zaleglej (`past_due|unpaid`
--      z kotwica karencji) przyciete do min(koniec okresu, kotwica +
--      karencja) - ta sama data, ktora webhook zapisuje przy zaleglosci.
--      Karencja: 14 dni = `PAYMENT_GRACE_DAYS` w src/lib/billing/accessPeriod.ts
--      (zmiana jednej wartosci wymaga zmiany drugiej). Wylacznie skracanie:
--      wiersz z data juz nie pozniejsza zostaje nietkniety;
--   3. komentarz kolumny bez zastrzezenia o wierszach sprzed znacznika.
--
-- UPRAWNIENIA. Bez zmian (zapis do obu tabel: rola serwisowa - webhook).
--
-- KOLEJNOSC WDROZENIA: po 20261013090500, przed kodem z nowym warunkiem
-- potwierdzenia (kod bez tego uzgodnienia potwierdzalby wiersze sprzed
-- znacznika drugi raz - mail odsiewa log wysylek, dzwonek nie).
-- IDEMPOTENTNA: oba UPDATE dotykaja wylacznie wierszy jeszcze nieuzgodnionych
-- (pusty znacznik sprzed pierwszego potwierdzenia / data pozniejsza niz koniec
-- karencji), wiec ponowne uruchomienie niczego nie zmienia.
-- ============================================================================

UPDATE public.subscriptions s
   SET purchase_confirmed_at = s.created_at
 WHERE s.purchase_confirmed_at IS NULL
   AND s.status NOT IN ('incomplete', 'incomplete_expired')
   AND s.created_at < COALESCE(
         (SELECT min(c.purchase_confirmed_at)
            FROM public.subscriptions c
           WHERE c.purchase_confirmed_at IS NOT NULL),
         'infinity'::timestamptz);

UPDATE public.user_subscriptions us
   SET current_period_end = LEAST(
         s.first_payment_failed_at + interval '14 days',
         COALESCE(s.current_period_end, 'infinity'::timestamptz))
  FROM public.subscriptions s
 WHERE us.external_ref = s.provider_subscription_id
   AND us.status = 'active'
   AND s.status IN ('past_due', 'unpaid')
   AND s.first_payment_failed_at IS NOT NULL
   AND (us.current_period_end IS NULL
        OR us.current_period_end > LEAST(
             s.first_payment_failed_at + interval '14 days',
             COALESCE(s.current_period_end, 'infinity'::timestamptz)));

COMMENT ON COLUMN public.subscriptions.purchase_confirmed_at IS
  'Chwila wyslania efektow zakupu (mail potwierdzenia, CRM, newsletter premium, dzwonek). Ustawiana raz, atomowym zajeciem (UPDATE ... WHERE purchase_confirmed_at IS NULL) po zapisie uprawnienia, przy pierwszym zdarzeniu w stanie active|trialing. NULL = potwierdzenie jeszcze nie wyszlo (wiersze sprzed 20261013090500 uzupelnia 20261013090600).';
