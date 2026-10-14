
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS first_payment_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pause_collection_behavior text;

COMMENT ON COLUMN public.subscriptions.first_payment_failed_at IS
  'Pierwsza nieudana platnosc biezacego cyklu windykacji - kotwica karencji (PAYMENT_GRACE_DAYS, src/lib/billing/accessPeriod.ts). Dostep przy past_due/unpaid i po anulowaniu za brak platnosci trwa do min(current_period_end, ta data + karencja). NULL = brak otwartego cyklu.';

COMMENT ON COLUMN public.subscriptions.purchase_confirmed_at IS
  'Chwila wyslania efektow zakupu (mail potwierdzenia, CRM, newsletter premium, dzwonek). Ustawiana raz: przy wstawieniu wiersza w stanie active|trialing albo atomowym zajeciem przy przejsciu incomplete -> active|trialing. NULL przy wierszach sprzed 20261013090500 nie oznacza braku potwierdzenia.';

COMMENT ON COLUMN public.subscriptions.pause_collection_behavior IS
  'pause_collection.behavior operatora (void / keep_as_draft / mark_uncollectible); NULL = brak pauzy poboru. Pauze poboru zdejmuje pause_collection: null, a status paused bez tej wartosci - subscriptions.resume.';

COMMENT ON COLUMN public.subscriptions.last_dunning_transaction_id IS
  'Klucz ostatniej proby obciazenia, dla ktorej uruchomiono windykacje: <faktura>:<attempt_count> (bez numeru proby - sama faktura). Blokuje duplikat zdarzenia o tej samej probie; kolejna proba tej samej faktury ma nowy klucz.';

UPDATE public.subscriptions
   SET first_payment_failed_at = LEAST(last_payment_failed_at, current_period_start)
 WHERE status IN ('past_due', 'unpaid')
   AND first_payment_failed_at IS NULL
   AND (last_payment_failed_at IS NOT NULL OR current_period_start IS NOT NULL);
