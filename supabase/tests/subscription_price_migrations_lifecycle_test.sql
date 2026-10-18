-- pgTAP: cykl życia wpisu dziennika przeniesienia na cennik v6.2
-- (`subscription_price_migrations`, migracja 20261018160000).
--
-- Weryfikuje:
--   1. RODO - wpis znika razem z kontem i razem z lustrem `subscriptions`
--      (ON DELETE CASCADE): po usunięciu konta nie zostaje identyfikator
--      subskrypcji operatora (sub_...) z kwotami bez terminu;
--   2. strażnik wpisu `applied` - ponowny przebieg (upsert na ten sam klucz)
--      nie degraduje wykonanej zmiany do `skipped` / `failed`, a zapis samego
--      statusu maila przy `applied` przechodzi;
--   3. wpis intencji (`failed` + `in_progress`) przechodzi w `applied`.
BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('6e621000-0000-4000-8000-0000000000aa', 'spm-life', 'SPM Life');
INSERT INTO auth.users (id, email) VALUES
  ('6e621000-0000-4000-8000-0000000000b1', 'spm-life-a@example.org'),
  ('6e621000-0000-4000-8000-0000000000b2', 'spm-life-b@example.org');
INSERT INTO public.subscriptions
  (id, user_id, tenant_id, provider_subscription_id, provider_customer_id, product_id,
   price_id, status, environment)
VALUES
  ('6e621000-0000-4000-8000-0000000000c1', '6e621000-0000-4000-8000-0000000000b1',
   '6e621000-0000-4000-8000-0000000000aa', 'sub_SpmLifeA', 'cus_SpmLifeA', 'plan_plus',
   'plus_monthly', 'active', 'sandbox'),
  ('6e621000-0000-4000-8000-0000000000c2', '6e621000-0000-4000-8000-0000000000b2',
   '6e621000-0000-4000-8000-0000000000aa', 'sub_SpmLifeB', 'cus_SpmLifeB', 'plan_pro',
   'pro_monthly', 'active', 'sandbox');

INSERT INTO public.subscription_price_migrations
  (tenant_id, environment, subscription_id, provider_subscription_id, user_id, lookup_key,
   from_provider_price_id, to_provider_price_id, quantity, currency, billing_interval,
   from_amount_cents, to_amount_cents, status, applied_at, email_status)
SELECT s.tenant_id, 'sandbox', s.id, s.provider_subscription_id, s.user_id, s.price_id,
       'price_OldA', 'price_NewA', 1, 'PLN', 'month', 5900, 3900, 'applied', now(), 'pending'
  FROM public.subscriptions s WHERE s.id = '6e621000-0000-4000-8000-0000000000c1';
INSERT INTO public.subscription_price_migrations
  (tenant_id, environment, subscription_id, provider_subscription_id, user_id, lookup_key,
   from_provider_price_id, to_provider_price_id, quantity, currency, billing_interval,
   from_amount_cents, to_amount_cents, status, reason, email_status)
SELECT s.tenant_id, 'sandbox', s.id, s.provider_subscription_id, s.user_id, s.price_id,
       'price_OldB', 'price_NewB', 1, 'PLN', 'month', 12900, 11900, 'failed', 'in_progress',
       'pending'
  FROM public.subscriptions s WHERE s.id = '6e621000-0000-4000-8000-0000000000c2';

-- ── Strażnik `applied` ──────────────────────────────────────────────────────
-- Upsert ponownego przebiegu jak w `upsertRepricingLogRow` (ten sam klucz).
INSERT INTO public.subscription_price_migrations
  (tenant_id, environment, provider_subscription_id, lookup_key, from_provider_price_id,
   to_provider_price_id, quantity, currency, billing_interval, from_amount_cents,
   to_amount_cents, status, reason, email_status)
VALUES ('6e621000-0000-4000-8000-0000000000aa', 'sandbox', 'sub_SpmLifeA', 'plus_monthly',
        'price_NewA', 'price_NewA', 1, 'PLN', 'month', 3900, 3900, 'skipped', 'already_current',
        'skipped')
ON CONFLICT (environment, provider_subscription_id, to_provider_price_id) DO UPDATE
  SET status = EXCLUDED.status, reason = EXCLUDED.reason,
      from_provider_price_id = EXCLUDED.from_provider_price_id,
      from_amount_cents = EXCLUDED.from_amount_cents, email_status = EXCLUDED.email_status,
      applied_at = NULL;

SELECT results_eq(
  $$SELECT status, from_provider_price_id, from_amount_cents, email_status, applied_at IS NOT NULL
      FROM public.subscription_price_migrations WHERE provider_subscription_id = 'sub_SpmLifeA'$$,
  $$VALUES ('applied'::text, 'price_OldA'::text, 5900, 'pending'::text, true)$$,
  'ponowny przebieg NIE degraduje wpisu `applied` (status, ceny, kwoty, data, mail bez zmian)'
);

UPDATE public.subscription_price_migrations
   SET status = 'failed', reason = 'provider_error'
 WHERE provider_subscription_id = 'sub_SpmLifeA';
SELECT is(
  (SELECT status FROM public.subscription_price_migrations
    WHERE provider_subscription_id = 'sub_SpmLifeA'),
  'applied',
  'wpis `applied` nie przechodzi też w `failed`'
);

UPDATE public.subscription_price_migrations
   SET email_status = 'queued', email_queued_at = now()
 WHERE provider_subscription_id = 'sub_SpmLifeA';
SELECT is(
  (SELECT email_status FROM public.subscription_price_migrations
    WHERE provider_subscription_id = 'sub_SpmLifeA'),
  'queued',
  'status maila przy wpisie `applied` aktualizuje się normalnie'
);

UPDATE public.subscription_price_migrations
   SET status = 'applied', reason = NULL, applied_at = now()
 WHERE provider_subscription_id = 'sub_SpmLifeB';
SELECT is(
  (SELECT status FROM public.subscription_price_migrations
    WHERE provider_subscription_id = 'sub_SpmLifeB'),
  'applied',
  'wpis intencji (`failed` / `in_progress`) przechodzi w `applied`'
);

SELECT is(
  (SELECT count(*)::int FROM pg_trigger
    WHERE tgrelid = 'public.subscription_price_migrations'::regclass
      AND tgname = 'subscription_price_migrations_keep_applied' AND NOT tgisinternal),
  1,
  'strażnik `applied` jest wyzwalaczem tabeli'
);

-- ── RODO: wpis znika z kontem i z lustrem ───────────────────────────────────
SELECT is(
  (SELECT string_agg(confdeltype::text, ',' ORDER BY conname) FROM pg_constraint
    WHERE conrelid = 'public.subscription_price_migrations'::regclass
      AND conname IN ('subscription_price_migrations_subscription_id_fkey',
                      'subscription_price_migrations_user_id_fkey')),
  'c,c',
  'konto i lustro kasują wpis kaskadowo (ON DELETE CASCADE)'
);

DELETE FROM auth.users WHERE id = '6e621000-0000-4000-8000-0000000000b1';

SELECT is(
  (SELECT count(*)::int FROM public.subscription_price_migrations
    WHERE provider_subscription_id = 'sub_SpmLifeA'),
  0,
  'usunięcie konta zabiera wpis z identyfikatorem subskrypcji operatora'
);

SELECT is(
  (SELECT count(*)::int FROM public.subscription_price_migrations
    WHERE provider_subscription_id = 'sub_SpmLifeB'),
  1,
  'wpis innego konta zostaje'
);

DELETE FROM public.subscriptions WHERE id = '6e621000-0000-4000-8000-0000000000c2';

SELECT is(
  (SELECT count(*)::int FROM public.subscription_price_migrations
    WHERE provider_subscription_id = 'sub_SpmLifeB'),
  0,
  'usunięcie lustra subskrypcji zabiera wpis dziennika'
);

SELECT * FROM finish();
ROLLBACK;
