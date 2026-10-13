DO $$
BEGIN
  LOCK TABLE public.user_subscriptions IN SHARE ROW EXCLUSIVE MODE;

  WITH ranked AS (
    SELECT us.id,
           row_number() OVER (
             PARTITION BY us.external_ref
             ORDER BY us.created_at, us.id
           ) AS rn
      FROM public.user_subscriptions us
     WHERE us.external_ref IS NOT NULL
  )
  UPDATE public.user_subscriptions AS us
     SET external_ref = us.external_ref || '#dup:' || us.id::text,
         status = CASE
                    WHEN us.status = 'refunded'::public.purchase_status THEN us.status
                    ELSE 'canceled'::public.purchase_status
                  END,
         canceled_at = COALESCE(us.canceled_at, now())
    FROM ranked
   WHERE ranked.id = us.id
     AND ranked.rn > 1;

  CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_external_ref_key
    ON public.user_subscriptions (external_ref);
END
$$;

COMMENT ON INDEX public.user_subscriptions_external_ref_key IS
  'Jeden wiersz uprawnienia na klucz operatora (PAY-10). Arbiter ON CONFLICT (external_ref) - zwykly, nie czesciowy; NULL dozwolone. Duplikaty sprzed indeksu: external_ref z sufiksem #dup:<id>, status canceled (refunded zostaje).';