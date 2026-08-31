-- Darowizny: kolumna `environment`, zeby zwrot z piaskownicy nie ruszal
-- prawdziwej wplaty.
--
-- PRZYCZYNA ZRODLOWA. Migracja 20260731220000 dolozyla `environment` do
-- `payment_orders` dokladnie z tego powodu: zdarzenie webhooka z piaskownicy
-- trafialo w wiersz produkcyjny, bo dopasowanie szlo wylacznie po identyfikatorze
-- operatora. Ten sam bezpiecznik ominal tabele `donations` - i to widac w kodzie:
-- `revokeOrder` i `revokeSubscription` w `src/lib/billing/refunds.server.ts`
-- filtruja po srodowisku, a stojacy obok `revokeDonation` NIE, bo nie ma po
-- czym. Naprawa refundow (ta sama galaz) domknela dwie pierwsze funkcje i
-- zostawila trzecia jako jedyna niezabezpieczona.
--
-- SKUTEK PRZED NAPRAWA: identyfikator sesji albo intencji z konta testowego,
-- ktory przypadkiem albo zlosliwie trafi w wiersz o tym samym identyfikatorze,
-- oznacza REALNA darowizne jako zwrocona - a to jest wpis ksiegowy i podstawa
-- do odebrania przydzialu czlonkostwa nadanego za wplate
-- (`membership_grants.source = 'donation'`).
--
-- DLACZEGO DEFAULT 'live', a nie 'sandbox': wiersze zastane powstaly na
-- produkcji - tak samo rozstrzygnela to migracja `payment_orders`. Zla wartosc
-- domyslna schowalaby historie przed panelem produkcyjnym.
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
  CHECK (environment IN ('sandbox', 'live'));

-- Indeks pod filtr uzywany przez `revokeDonation` i panel darowizn: zwrot
-- szuka po identyfikatorze operatora ORAZ srodowisku.
CREATE INDEX IF NOT EXISTS donations_environment_idx
  ON public.donations (environment, created_at DESC);

COMMENT ON COLUMN public.donations.environment IS
  'Srodowisko operatora platnosci (sandbox|live). Bramkuje dopasowanie zdarzen webhooka do wiersza - bez niego zwrot z piaskownicy mogl oznaczyc realna wplate jako zwrocona. Lustro tej samej kolumny w payment_orders (20260731220000).';
