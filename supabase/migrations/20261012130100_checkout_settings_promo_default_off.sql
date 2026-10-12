-- Pole „kod promocyjny" w Stripe Checkout DOMYŚLNIE WYŁĄCZONE (audyt PAY-06).
--
-- Kod wpisany w nakładce operatora omija wszystko, co wie baza: zakres
-- najemcy, limit na osobę, datę startu, rezerwację użycia
-- (`redeem_b2b_coupon_for_user`) i wiersz realizacji. Konto Stripe jest
-- wspólne dla instalacji, więc kod zsynchronizowany przez jednego najemcę
-- działał u każdego, kto miał to pole włączone - a włączone było DOMYŚLNIE
-- (kolumna `DEFAULT true` z 20260721063638 / 20260721120000).
--
-- Zmieniamy WYŁĄCZNIE domyślną wartość kolumny dla nowych wierszy. Istniejące
-- wiersze zostają bez zmian: najemca, który świadomie włączył kody Stripe,
-- zachowuje swój wybór. Brak wiersza aplikacja i tak traktuje jak `false`
-- (`DEFAULT_CHECKOUT_SETTINGS` w `src/lib/billing/checkoutSettings.ts`), także
-- przy awarii odczytu ustawień.
ALTER TABLE public.checkout_settings
  ALTER COLUMN allow_promotion_codes SET DEFAULT false;

COMMENT ON COLUMN public.checkout_settings.allow_promotion_codes IS
  'Pole kodu promocyjnego Stripe w Checkout. Domyslnie false (PAY-06): kody Stripe omijaja zakres najemcy i limity kuponow B2B z bazy; najemca wlacza je swiadomie w panelu.';
