
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
