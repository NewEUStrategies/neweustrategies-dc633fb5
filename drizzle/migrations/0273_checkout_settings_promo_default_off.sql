ALTER TABLE public.checkout_settings
  ALTER COLUMN allow_promotion_codes SET DEFAULT false;

COMMENT ON COLUMN public.checkout_settings.allow_promotion_codes IS
  'Pole kodu promocyjnego Stripe w Checkout. Domyslnie false (PAY-06): kody Stripe omijaja zakres najemcy i limity kuponow B2B z bazy; najemca wlacza je swiadomie w panelu.';
