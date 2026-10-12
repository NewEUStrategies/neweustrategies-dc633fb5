-- ============================================================================
-- SUBSKRYPCJE: KARENCJA PLATNOSCI, JEDNORAZOWE POTWIERDZENIE ZAKUPU, PAUZA
-- POBORU (audyt rozliczen SUB-02, SUB-03, SUB-14, SUB-16).
--
-- DEFEKTY.
--   SUB-03  `PAYMENT_GRACE_DAYS = 14` zyla wylacznie w tresci maila. `past_due`
--           dawal dostep do `current_period_end`, ktory Stripe przy odnowieniu
--           przesuwa o caly cykl PRZED obciazeniem karty - nieudane odnowienie
--           planu rocznego dawalo rok dostepu bez platnosci, takze po
--           `customer.subscription.deleted` (koniec windykacji). Regula wymaga
--           kotwicy: chwili PIERWSZEJ nieudanej platnosci cyklu.
--   SUB-02  efekty zakupu (mail „subskrypcja potwierdzona", CRM, newsletter,
--           dzwonek) szly przy `subscription.created` niezaleznie od statusu,
--           takze `incomplete` (3DS w toku). Teraz ida przy wejsciu w
--           `active|trialing` - dokladnie raz, co zapisuje znacznik ponizej.
--   SUB-14  pauza poboru (`pause_collection`) nie byla mapowana, wiec dostep
--           zostawal bez platnosci. Sposob wznowienia zalezy od tego, czym
--           pauze ustawiono - ten fakt musi przezyc w wierszu.
--   SUB-16  ponowienia jednej faktury maja ten sam identyfikator - klucz
--           deduplikacji windykacji to teraz `<faktura>:<numer proby>`.
--
-- ZMIANA (wylacznie kolumny + komentarze + jednorazowe uzgodnienie danych):
--   1. `first_payment_failed_at` - kotwica karencji. Ustawia ja PIERWSZA
--      nieudana platnosc albo wejscie w `past_due|unpaid` (nigdy nie
--      przesuwana przez kolejne proby), zeruje odzyskanie platnosci;
--   2. `purchase_confirmed_at` - chwila wyslania efektow zakupu; wstawienie
--      wiersza w stanie uprawniajacym albo atomowe zajecie
--      (`UPDATE ... WHERE purchase_confirmed_at IS NULL`) przy przejsciu
--      `incomplete` -> `active|trialing`;
--   3. `pause_collection_behavior` - surowe `pause_collection.behavior`
--      operatora (`void` / `keep_as_draft` / `mark_uncollectible`); NULL =
--      brak pauzy poboru. Status `paused` bez tej wartosci to pauza statusu
--      (koniec triala bez metody platnosci) - wznawiana inaczej;
--   4. uzgodnienie: subskrypcje JUZ zalegle dostaja kotwice z najwczesniejszego
--      znanego sygnalu (ostatnia porazka albo poczatek okresu), zeby kolejna
--      proba nie zakotwiczyla karencji pozniej, niz sie zaczela.
--
-- UPRAWNIENIA. Bez zmian: kolumny dziedzicza granty tabeli (`SELECT` dla
-- `authenticated` przez polityke wlasciciela, zapis wylacznie `service_role`
-- - webhook operatora). Zadna nie jest prywatna wobec wlasciciela wiersza.
--
-- KOLEJNOSC WDROZENIA: migracja PRZED kodem (kod zapisuje nowe kolumny).
-- IDEMPOTENTNA: ADD COLUMN IF NOT EXISTS, COMMENT ON, UPDATE warunkowy
-- (dotyka wylacznie wierszy bez kotwicy).
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS first_payment_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_collection_behavior text;

COMMENT ON COLUMN public.subscriptions.first_payment_failed_at IS
  'Pierwsza nieudana platnosc biezacego cyklu windykacji - kotwica karencji (PAYMENT_GRACE_DAYS, src/lib/billing/accessPeriod.ts). Dostep przy past_due/unpaid i po anulowaniu za brak platnosci trwa do min(current_period_end, ta data + karencja). NULL = brak otwartego cyklu.';

COMMENT ON COLUMN public.subscriptions.purchase_confirmed_at IS
  'Chwila wyslania efektow zakupu (mail potwierdzenia, CRM, newsletter premium, dzwonek). Ustawiana raz: przy wstawieniu wiersza w stanie active|trialing albo atomowym zajeciem przy przejsciu incomplete -> active|trialing. NULL przy wierszach sprzed 20261012120000 nie oznacza braku potwierdzenia.';

COMMENT ON COLUMN public.subscriptions.pause_collection_behavior IS
  'pause_collection.behavior operatora (void / keep_as_draft / mark_uncollectible); NULL = brak pauzy poboru. Pauze poboru zdejmuje pause_collection: null, a status paused bez tej wartosci - subscriptions.resume.';

COMMENT ON COLUMN public.subscriptions.last_dunning_transaction_id IS
  'Klucz ostatniej proby obciazenia, dla ktorej uruchomiono windykacje: <faktura>:<attempt_count> (bez numeru proby - sama faktura). Blokuje duplikat zdarzenia o tej samej probie; kolejna proba tej samej faktury ma nowy klucz.';

UPDATE public.subscriptions
   SET first_payment_failed_at = LEAST(last_payment_failed_at, current_period_start)
 WHERE status IN ('past_due', 'unpaid')
   AND first_payment_failed_at IS NULL
   AND (last_payment_failed_at IS NOT NULL OR current_period_start IS NOT NULL);
