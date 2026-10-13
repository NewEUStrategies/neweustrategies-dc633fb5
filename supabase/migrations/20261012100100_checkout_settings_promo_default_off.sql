-- Pole „kod promocyjny" w Stripe Checkout DOMYŚLNIE WYŁĄCZONE (audyt PAY-06).
--
-- Kod wpisany w nakładce operatora omija wszystko, co wie baza: zakres
-- najemcy, limit na osobę, datę startu, rezerwację użycia
-- (`redeem_b2b_coupon_for_user`) i wiersz realizacji. Konto Stripe jest
-- wspólne dla instalacji, więc kod zsynchronizowany przez jednego najemcę
-- działał u każdego, kto miał to pole włączone - a włączone było DOMYŚLNIE
-- (kolumna `DEFAULT true` z 20260721063638 / 20260721120000).
--
-- Zmieniamy WYŁĄCZNIE domyślną wartość kolumny dla nowych wierszy. Brak wiersza
-- aplikacja i tak traktuje jak `false` (`DEFAULT_CHECKOUT_SETTINGS`
-- w `src/lib/billing/checkoutSettings.ts`), także przy awarii odczytu ustawień.
--
-- ISTNIEJĄCYCH WIERSZY ŚWIADOMIE NIE PRZEPISUJEMY (przegląd PAY-06, 0.4).
-- Wiersz powstaje dopiero przy zapisie panelu checkoutu, a panel zapisuje
-- wszystkie pięć przełączników ze stanu formularza - którego domyślne do tej
-- zmiany miało `allow_promotion_codes = true`. Najemca, który zapisał panel
-- np. dla faktur, ma więc `true` bez świadomej decyzji, a tabela nie ma śladu,
-- który odróżniłby go od najemcy, który pole włączył celowo. Masowe `UPDATE`
-- wyłączyłoby kody Stripe także tym drugim - bez ich wiedzy, w środku
-- trwających kampanii. Ochrona przed kodem CUDZEGO najemcy nie zależy od tej
-- flagi: realizacja zamówienia sprawdza każdy kod promocyjny sesji
-- (`metadata.tenant_id` kodu wobec najemcy zamówienia) i przy kodzie innego
-- najemcy wstrzymuje uprawnienie zakupu jednorazowego, a subskrypcję oznacza
-- do przeglądu - w obu przypadkach z alertem dla adminów.
-- Przegląd wierszy z `allow_promotion_codes = true` i potwierdzenie decyzji
-- z każdym najemcą to krok operatora przy wdrożeniu, nie tej migracji.
ALTER TABLE public.checkout_settings
  ALTER COLUMN allow_promotion_codes SET DEFAULT false;

COMMENT ON COLUMN public.checkout_settings.allow_promotion_codes IS
  'Pole kodu promocyjnego Stripe w Checkout. Domyslnie false (PAY-06): kody Stripe omijaja zakres najemcy i limity kuponow B2B z bazy; najemca wlacza je swiadomie w panelu.';
