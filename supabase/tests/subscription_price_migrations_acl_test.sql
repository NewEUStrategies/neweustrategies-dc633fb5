-- pgTAP: dziennik przeniesienia subskrypcji na cenę katalogu v6.2
-- (`subscription_price_migrations`, migracja 20261018160000).
--
-- Tabela jest server-only: panel czyta ją przez server function z bramką
-- admina + MFA i filtrem `tenant_id` z sesji. Weryfikuje:
--   1. RLS włączone, a role klienckie (anon, authenticated) nie mają ŻADNEGO
--      przywileju - nawet odczytu własnych wierszy (nie ma polityk);
--   2. service_role czyta, wstawia i aktualizuje, ale NIE usuwa ani nie
--      czyści tabeli (dziennik; TRUNCATE też, mimo domyślnych praw schematu);
--   3. `tenant_id` NOT NULL z FK do najemców;
--   4. klucz idempotencji (środowisko, subskrypcja, cena docelowa) jest
--      unikalny - druga próba zapisu tego samego przeniesienia to konflikt;
--   5. CHECK-i odrzucają zły status, `applied` bez daty i powód z treścią
--      błędu zamiast kodu.
BEGIN;
SELECT plan(14);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.subscription_price_migrations'::regclass),
  'RLS włączone'
);

SELECT ok(
  NOT (SELECT bool_or(has_table_privilege(r, 'public.subscription_price_migrations', p))
         FROM unnest(ARRAY['anon', 'authenticated']) r,
              unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p),
  'anon i authenticated: brak SELECT/INSERT/UPDATE/DELETE'
);

SELECT ok(
  (SELECT bool_and(has_table_privilege('service_role', 'public.subscription_price_migrations', p))
     FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) p),
  'service_role: SELECT, INSERT, UPDATE'
);

-- Także TRUNCATE, REFERENCES i TRIGGER: domyślne uprawnienia schematu na
-- produkcji dają je każdej nowej tabeli, więc odbiera je dopiero REVOKE ALL
-- z service_role w migracji (sam GRANT trzech praw ich nie zdejmuje).
SELECT ok(
  NOT (SELECT bool_or(has_table_privilege('service_role', 'public.subscription_price_migrations', p))
         FROM unnest(ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p),
  'service_role: brak DELETE/TRUNCATE/REFERENCES/TRIGGER - to dziennik audytowy'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'subscription_price_migrations'),
  0,
  'brak polityk RLS - dostęp wyłącznie spod service_role'
);

SELECT col_not_null('public', 'subscription_price_migrations', 'tenant_id', 'tenant_id NOT NULL');

SELECT fk_ok(
  'public', 'subscription_price_migrations', 'tenant_id',
  'public', 'tenants', 'id',
  'tenant_id -> tenants(id)'
);

SELECT is(
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'subscription_price_migrations_target_key'),
  'UNIQUE (environment, provider_subscription_id, to_provider_price_id)',
  'klucz idempotencji: (środowisko, subskrypcja, cena docelowa)'
);

-- ── Zapisy (jako właściciel - pomijamy RLS, sprawdzamy kształt) ─────────────
SELECT lives_ok(
  $$INSERT INTO public.subscription_price_migrations
      (tenant_id, environment, provider_subscription_id, lookup_key,
       from_provider_price_id, to_provider_price_id, quantity, currency,
       billing_interval, from_amount_cents, to_amount_cents, status, applied_at)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 'sandbox', 'sub_V62acl1',
            'plus_monthly', 'price_Old1', 'price_New1', 1, 'PLN', 'month', 5900, 3900,
            'applied', now())$$,
  'poprawny wpis `applied` przechodzi'
);

SELECT throws_ok(
  $$INSERT INTO public.subscription_price_migrations
      (tenant_id, environment, provider_subscription_id, lookup_key,
       from_provider_price_id, to_provider_price_id, quantity, currency,
       billing_interval, from_amount_cents, to_amount_cents, status, applied_at)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 'sandbox', 'sub_V62acl1',
            'plus_monthly', 'price_Old1', 'price_New1', 1, 'PLN', 'month', 5900, 3900,
            'applied', now())$$,
  '23505', NULL,
  'to samo przeniesienie drugi raz: konflikt klucza idempotencji'
);

SELECT throws_ok(
  $$INSERT INTO public.subscription_price_migrations
      (tenant_id, environment, provider_subscription_id, lookup_key,
       from_provider_price_id, to_provider_price_id, quantity, currency,
       billing_interval, from_amount_cents, to_amount_cents, status)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 'sandbox', 'sub_V62acl2',
            'plus_monthly', 'price_Old1', 'price_New1', 1, 'PLN', 'month', 5900, 3900,
            'applied')$$,
  '23514', NULL,
  '`applied` bez applied_at jest odrzucane'
);

SELECT throws_ok(
  $$INSERT INTO public.subscription_price_migrations
      (tenant_id, environment, provider_subscription_id, lookup_key,
       from_provider_price_id, to_provider_price_id, quantity, currency,
       billing_interval, from_amount_cents, to_amount_cents, status)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 'sandbox', 'sub_V62acl3',
            'plus_monthly', 'price_Old1', 'price_New1', 1, 'PLN', 'month', 5900, 3900,
            'done')$$,
  '23514', NULL,
  'status spoza listy jest odrzucany'
);

SELECT throws_ok(
  $$INSERT INTO public.subscription_price_migrations
      (tenant_id, environment, provider_subscription_id, lookup_key,
       from_provider_price_id, to_provider_price_id, quantity, currency,
       billing_interval, from_amount_cents, to_amount_cents, status, reason)
    VALUES ((SELECT id FROM public.tenants WHERE slug = 'nes'), 'sandbox', 'sub_V62acl4',
            'plus_monthly', 'price_Old1', 'price_New1', 1, 'PLN', 'month', 5900, 3900,
            'failed', 'Card for jan@example.org was declined')$$,
  '23514', NULL,
  'powód musi być kodem, nie treścią błędu z danymi klienta'
);

-- ── Rola kliencka nie czyta dziennika ───────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT count(*) FROM public.subscription_price_migrations$$,
  '42501', NULL,
  'authenticated: odczyt dziennika odrzucony uprawnieniem'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
