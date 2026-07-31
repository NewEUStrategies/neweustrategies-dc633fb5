-- pgTAP: ujednolicenie listy wykluczen + runner zadan tla
-- (migracja 20260731120000_email_suppression_unification.sql).
--
-- Bramka anty-regresyjna dla czterech usterek poczty wychodzacej:
--
--   1. Lista wykluczen rozjechana na DWIE tabele: `suppressed_emails` (wypisy,
--      webhook platformy, poczta transakcyjna) i `email_suppressions` (webhook
--      Resend, kampanie). Po migracji istnieje JEDNA tabela, a stara nazwa jest
--      widokiem zgodnosci, ktorego zapisy trafiaja do tabeli kanonicznej.
--   2. Wypis jednym klikniecim nie zatrzymywal kampanii: `email_unsubscribe_by_token`
--      zuzywa token, stawia blokade i - przez trigger - zdejmuje subskrypcje
--      w JEDNEJ transakcji. Obsluguje oba rodzaje tokenow (globalny i per subskrybent).
--   3. Tenant dla adresu poza kontekstem zadania (`email_resolve_tenant_for_address`):
--      jednoznaczny subskrybent -> jednoznaczne konto -> tenant domyslny.
--   4. Runner zadan tla startowal wylaczony i bez adresu: `enabled` ma DEFAULT true,
--      a `job_runner_base_url()` wylicza adres z domeny tenanta domyslnego.
--
-- Osobno: widok zgodnosci NIE MOZE wyciekac adresow (PII) - anon i authenticated
-- nie maja do niego zadnego dostepu, a security_invoker pilnuje RLS tabeli zrodlowej.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(27);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Tenant domyslny jest pilnowany unikalnym indeksem czesciowym
-- (tenants.is_default WHERE is_default), a migracje ustawiaja nim slug 'nes'.
-- Przejmujemy te role na czas testu - wszystko konczy sie ROLLBACK-iem.
UPDATE public.tenants SET is_default = false WHERE is_default;

-- Tenant domyslny z domena (zrodlo adresu bazowego runnera) + tenant obcy.
INSERT INTO public.tenants (id, slug, name, domain, is_default) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'tenant-uni-a', 'Tenant Uni A', 'uni-a.test', true),
  ('c2222222-2222-2222-2222-222222222222', 'tenant-uni-b', 'Tenant Uni B', 'uni-b.test', false);

INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin-uni@uni.test'),
  ('c1000000-0000-0000-0000-0000000000bb', 'reader-uni@uni.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin-uni@uni.test', 'Admin Uni',
   'c1111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-0000000000bb', 'reader-uni@uni.test', 'Reader Uni',
   'c1111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('c1000000-0000-0000-0000-0000000000aa', 'admin', 'c1111111-1111-1111-1111-111111111111');

-- Subskrybenci: jeden w tenancie A (jednoznaczny), jeden w OBU tenantach
-- (niejednoznaczny - rozstrzyganie musi spasc na tenanta domyslnego).
INSERT INTO public.newsletter_subscribers
  (id, tenant_id, email, status, language, unsubscribe_token)
VALUES
  ('c1500000-0000-0000-0000-0000000000a1', 'c1111111-1111-1111-1111-111111111111',
   'solo@example.com', 'subscribed', 'pl', 'tok-solo-per-subscriber'),
  ('c1500000-0000-0000-0000-0000000000a2', 'c1111111-1111-1111-1111-111111111111',
   'shared@example.com', 'subscribed', 'pl', 'tok-shared-a'),
  ('c1500000-0000-0000-0000-0000000000b2', 'c2222222-2222-2222-2222-222222222222',
   'shared@example.com', 'subscribed', 'pl', 'tok-shared-b'),
  ('c1500000-0000-0000-0000-0000000000a3', 'c1111111-1111-1111-1111-111111111111',
   'global@example.com', 'subscribed', 'pl', 'tok-global-sub');

INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES
  ('tok-global-unsub', 'global@example.com');

-- -- 1. `suppressed_emails` to WIDOK, nie druga tabela ------------------------
SELECT is(
  (SELECT c.relkind::text FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'suppressed_emails'),
  'v',
  'suppressed_emails jest widokiem zgodnosci, nie osobna tabela'
);

SELECT ok(
  (SELECT c.reloptions::text LIKE '%security_invoker=true%'
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'suppressed_emails'),
  'widok ma security_invoker=true (RLS tabeli zrodlowej obowiazuje)'
);

-- PII: adresy nie moga wyciekac przez stara nazwe do zwyklych sesji.
SELECT ok(
  NOT has_table_privilege('anon', 'public.suppressed_emails', 'SELECT'),
  'anon NIE czyta widoku zgodnosci'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.suppressed_emails', 'SELECT'),
  'authenticated NIE czyta widoku zgodnosci'
);

-- -- 2. Zapis przez widok ląduje na liscie KANONICZNEJ ------------------------
INSERT INTO public.suppressed_emails (email, reason) VALUES ('Solo@Example.com', 'bounce');

SELECT is(
  (SELECT reason FROM public.email_suppressions
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111'
      AND email_norm = 'solo@example.com'),
  'hard_bounce',
  'INSERT przez widok tworzy blokade w email_suppressions ("bounce" -> hard_bounce)'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions
    WHERE email_norm = 'solo@example.com'),
  1,
  'adres zapisany RAZ, znormalizowany do lowercase'
);

-- Blokada trwala natychmiast wyjmuje adres z audiencji (trigger z 20260725120000).
SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'c1500000-0000-0000-0000-0000000000a1'),
  'unsubscribed',
  'zapis przez widok dziedziczy synchronizacje z lista subskrybentow'
);

-- Widok czyta te sama prawde.
SELECT is(
  (SELECT reason FROM public.suppressed_emails WHERE email = 'solo@example.com'),
  'bounce',
  'odczyt z widoku mapuje powod kanoniczny na domene zaszlosci'
);

-- Ponowny INSERT tego samego adresu nie wywala sie na konflikcie (idempotencja).
INSERT INTO public.suppressed_emails (email, reason) VALUES ('solo@example.com', 'bounce');
SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions WHERE email_norm = 'solo@example.com'),
  1,
  'powtorzony INSERT przez widok jest idempotentny'
);

-- -- 3. Widok pokazuje WYLACZNIE aktywne blokady ------------------------------
SELECT public.email_record_suppression(
  'c1111111-1111-1111-1111-111111111111', 'expired@example.com', 'soft_bounce');
UPDATE public.email_suppressions
   SET expires_at = now() - interval '1 day'
 WHERE email_norm = 'expired@example.com';

SELECT is(
  (SELECT count(*)::int FROM public.suppressed_emails WHERE email = 'expired@example.com'),
  0,
  'blokada WYGASLA nie pojawia sie w widoku (stara tabela tego nie umiala)'
);

-- DELETE przez widok odblokowuje, ale nie kasuje historii.
DELETE FROM public.suppressed_emails WHERE email = 'solo@example.com';
SELECT isnt(
  (SELECT released_at FROM public.email_suppressions WHERE email_norm = 'solo@example.com'),
  NULL,
  'DELETE przez widok ODBLOKOWUJE (released_at), nie usuwa sladu'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions WHERE email_norm = 'solo@example.com'),
  1,
  'wiersz historii zostaje po odblokowaniu'
);

-- -- 4. Rozstrzyganie tenanta dla adresu -------------------------------------
SELECT is(
  public.email_resolve_tenant_for_address('SOLO@example.com'),
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'jednoznaczny subskrybent wskazuje swojego tenanta (case-insensitive)'
);

SELECT is(
  public.email_resolve_tenant_for_address('shared@example.com'),
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'adres w DWOCH tenantach nie jest zgadywany - spada na tenanta domyslnego'
);

SELECT is(
  public.email_resolve_tenant_for_address('reader-uni@uni.test'),
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'adres bez subskrypcji rozstrzygany po jednoznacznym koncie'
);

SELECT is(
  public.email_resolve_tenant_for_address('nikt@nigdzie.test'),
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'adres nieznany spada na tenanta domyslnego (zawezenie wysylki, nie rozszerzenie)'
);

-- -- 5. Wypis jednym klikniecim: token globalny -------------------------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('tok-global-unsub')->>'ok'),
  'true',
  'wypis tokenem globalnym konczy sie sukcesem'
);

SELECT is(
  (SELECT reason FROM public.email_suppressions
    WHERE tenant_id = 'c1111111-1111-1111-1111-111111111111'
      AND email_norm = 'global@example.com'),
  'unsubscribe',
  'wypis stawia blokade na liscie KANONICZNEJ (czytanej przez kampanie)'
);

SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'c1500000-0000-0000-0000-0000000000a3'),
  'unsubscribed',
  'wypis zdejmuje subskrypcje w tej samej transakcji'
);

SELECT isnt(
  (SELECT used_at FROM public.email_unsubscribe_tokens WHERE token = 'tok-global-unsub'),
  NULL,
  'token zostaje oznaczony jako zuzyty'
);

-- Ponowne klikniecie (klienty pocztowe POST-uja one-click wielokrotnie).
SELECT is(
  (SELECT public.email_unsubscribe_by_token('tok-global-unsub')->>'already_unsubscribed'),
  'true',
  'powtorzony wypis jest idempotentny i raportuje "juz wypisany"'
);

-- -- 6. Wypis tokenem per subskrybent (stopka kampanii, RFC 8058) -------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('tok-shared-b')->>'tenant_id'),
  'c2222222-2222-2222-2222-222222222222',
  'token per subskrybent wskazuje tenanta WLASCICIELA wiersza, nie domyslnego'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions
    WHERE email_norm = 'shared@example.com'
      AND tenant_id = 'c1111111-1111-1111-1111-111111111111'),
  0,
  'wypis w tenancie B nie stawia blokady w tenancie A (izolacja)'
);

SELECT is(
  (SELECT public.email_unsubscribe_by_token('nie-ma-takiego')->>'error'),
  'unknown_token',
  'nieznany token nie stawia zadnej blokady'
);

-- -- 7. Runner zadan tla: domyslnie wlaczony, adres z domeny tenanta ----------
SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'job_runner_settings'
      AND column_name = 'enabled'),
  'true',
  'job_runner_settings.enabled ma DEFAULT true (dren kolejki nie czeka na przelacznik)'
);

SELECT is(
  public.job_runner_base_url(),
  'https://uni-a.test',
  'pusty base_url jest wyliczany z domeny tenanta domyslnego'
);

UPDATE public.job_runner_settings SET base_url = 'https://jawny.test' WHERE id = 1;
SELECT is(
  public.job_runner_base_url(),
  'https://jawny.test',
  'jawna konfiguracja ma pierwszenstwo przed domena tenanta'
);

SELECT * FROM finish();
ROLLBACK;
