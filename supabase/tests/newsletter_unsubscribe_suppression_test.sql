-- pgTAP: wypis z newslettera stawia blokade na KANONICZNEJ liscie wykluczen
-- (migracja 20261002190100_newsletter_unsubscribe_canonical_suppression.sql).
--
-- Bramka anty-regresyjna dla wypisu tokenem PER SUBSKRYBENT (stopka i naglowek
-- List-Unsubscribe kampanii, RFC 8058 one-click):
--
--   1. Wypis stawia blokade `unsubscribe` w tenancie WLASCICIELA wiersza i w tej
--      samej transakcji wypisuje subskrybenta (status + uniewaznienie tokenu
--      potwierdzenia) - bez polegania na triggerze synchronizacji.
--   2. Ponowny klik raportuje "juz wypisany" (wczesniej zawsze false) i nie
--      dubluje wpisu; wiersz wypisany PRZED poprawka dostaje brakujaca blokade.
--   3. Mocniejsza blokada (skarga) nie jest oslabiana, a subskrybent i tak
--      zostaje wypisany (galaz kept_stronger nie odpala triggera).
--   4. Izolacja tenantow: wypis w B nie dotyka wiersza ani listy w A.
--   5. Token globalny poczty systemowej dziala jak wczesniej.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(20);

INSERT INTO public.tenants (id, slug, name, domain, is_default) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'tenant-nlu-a', 'Tenant NLU A', 'nlu-a.test', false),
  ('d2222222-2222-2222-2222-222222222222', 'tenant-nlu-b', 'Tenant NLU B', 'nlu-b.test', false);

INSERT INTO public.newsletter_subscribers
  (id, tenant_id, email, status, language, unsubscribe_token,
   confirmation_token, confirmation_expires_at)
VALUES
  -- Zwykly subskrybent z wiszacym tokenem potwierdzenia (stary mail DOI).
  ('d1500000-0000-0000-0000-0000000000a1', 'd1111111-1111-1111-1111-111111111111',
   'nlu-solo@example.com', 'subscribed', 'pl', 'nlu-tok-solo',
   'nlu-confirm-solo', now() + interval '1 day'),
  -- Wypisany PRZED poprawka: status jest, blokady nie ma.
  ('d1500000-0000-0000-0000-0000000000a2', 'd1111111-1111-1111-1111-111111111111',
   'nlu-already@example.com', 'unsubscribed', 'pl', 'nlu-tok-already', NULL, NULL),
  -- Ten sam adres w dwoch tenantach - wypis w B nie moze dotknac A.
  ('d1500000-0000-0000-0000-0000000000a3', 'd1111111-1111-1111-1111-111111111111',
   'nlu-shared@example.com', 'subscribed', 'pl', 'nlu-tok-shared-a', NULL, NULL),
  ('d1500000-0000-0000-0000-0000000000b3', 'd2222222-2222-2222-2222-222222222222',
   'nlu-shared@example.com', 'subscribed', 'pl', 'nlu-tok-shared-b', NULL, NULL),
  -- Adres ze skarga, przywrocony do listy recznie (import/CRM).
  ('d1500000-0000-0000-0000-0000000000a4', 'd1111111-1111-1111-1111-111111111111',
   'nlu-complaint@example.com', 'subscribed', 'pl', 'nlu-tok-complaint', NULL, NULL),
  -- Adres wypisywany tokenem GLOBALNYM poczty systemowej.
  ('d1500000-0000-0000-0000-0000000000a5', 'd1111111-1111-1111-1111-111111111111',
   'nlu-global@example.com', 'subscribed', 'pl', 'nlu-tok-global-sub', NULL, NULL);

INSERT INTO public.email_unsubscribe_tokens (token, email) VALUES
  ('nlu-tok-global', 'nlu-global@example.com');

-- Skarga zapisana wczesniej (trigger wypisal subskrybenta), potem operator
-- przywrocil status - dokladnie ten stan, w ktorym trigger synchronizacji
-- przy kolejnym wypisie NIE odpala (kept_stronger aktualizuje tylko liczniki).
SELECT public.email_record_suppression(
  p_tenant => 'd1111111-1111-1111-1111-111111111111',
  p_email => 'nlu-complaint@example.com',
  p_reason => 'complaint');
UPDATE public.newsletter_subscribers
   SET status = 'subscribed', unsubscribed_at = NULL
 WHERE id = 'd1500000-0000-0000-0000-0000000000a4';

-- -- 1. Pierwszy wypis tokenem per subskrybent ---------------------------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-tok-solo')->>'already_unsubscribed'),
  'false',
  'pierwszy wypis NIE jest raportowany jako "juz wypisany"'
);

SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'd1500000-0000-0000-0000-0000000000a1'),
  'unsubscribed',
  'wypis zdejmuje subskrypcje w tej samej transakcji'
);

SELECT ok(
  (SELECT unsubscribed_at IS NOT NULL FROM public.newsletter_subscribers
    WHERE id = 'd1500000-0000-0000-0000-0000000000a1'),
  'wypis stawia znacznik czasu'
);

SELECT ok(
  (SELECT confirmation_token IS NULL AND confirmation_expires_at IS NULL
     FROM public.newsletter_subscribers
    WHERE id = 'd1500000-0000-0000-0000-0000000000a1'),
  'wypis uniewaznia token potwierdzenia (stary link DOI nie reaktywuje subskrypcji)'
);

SELECT is(
  (SELECT unsubscribe_token FROM public.newsletter_subscribers
    WHERE id = 'd1500000-0000-0000-0000-0000000000a1'),
  'nlu-tok-solo',
  'token wypisu ZOSTAJE - na nim stoi idempotencja ponownego kliku'
);

SELECT is(
  (SELECT reason || '/' || scope FROM public.email_suppressions
    WHERE tenant_id = 'd1111111-1111-1111-1111-111111111111'
      AND email_norm = 'nlu-solo@example.com'
      AND released_at IS NULL),
  'unsubscribe/permanent',
  'wypis stawia trwala blokade `unsubscribe` na liscie KANONICZNEJ'
);

SELECT is(
  (SELECT subscriber_id FROM public.email_suppressions
    WHERE tenant_id = 'd1111111-1111-1111-1111-111111111111'
      AND email_norm = 'nlu-solo@example.com'),
  'd1500000-0000-0000-0000-0000000000a1'::uuid,
  'blokada wskazuje wypisanego subskrybenta (slad dowodowy wycofania zgody)'
);

-- -- 2. Idempotencja i blokada dla wierszy sprzed poprawki ---------------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-tok-solo')->>'already_unsubscribed'),
  'true',
  'ponowny klik raportuje "juz wypisany"'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions
    WHERE email_norm = 'nlu-solo@example.com'),
  1,
  'ponowny klik nie dubluje wpisu na liscie'
);

SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-tok-already')->>'already_unsubscribed'),
  'true',
  'wiersz wypisany przed poprawka jest "juz wypisany"'
);

SELECT is(
  (SELECT reason FROM public.email_suppressions
    WHERE tenant_id = 'd1111111-1111-1111-1111-111111111111'
      AND email_norm = 'nlu-already@example.com'),
  'unsubscribe',
  '... a ponowny klik dopisuje mu brakujaca blokade'
);

-- -- 3. Mocniejsza blokada nie jest oslabiana, a wypis i tak dziala ------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-tok-complaint')->>'ok'),
  'true',
  'wypis adresu ze skarga konczy sie sukcesem'
);

SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'd1500000-0000-0000-0000-0000000000a4'),
  'unsubscribed',
  'subskrybent wypisany mimo ze trigger synchronizacji nie odpalil (kept_stronger)'
);

SELECT is(
  (SELECT reason FROM public.email_suppressions
    WHERE tenant_id = 'd1111111-1111-1111-1111-111111111111'
      AND email_norm = 'nlu-complaint@example.com'),
  'complaint',
  'skarga NIE zostaje oslabiona do wypisu (skarga blokuje tez poczte transakcyjna)'
);

-- -- 4. Izolacja tenantow ------------------------------------------------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-tok-shared-b')->>'tenant_id'),
  'd2222222-2222-2222-2222-222222222222',
  'token per subskrybent wskazuje tenanta WLASCICIELA wiersza'
);

SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions
    WHERE email_norm = 'nlu-shared@example.com'
      AND tenant_id = 'd1111111-1111-1111-1111-111111111111'),
  0,
  'wypis w tenancie B nie stawia blokady w tenancie A'
);

SELECT is(
  (SELECT status FROM public.newsletter_subscribers
    WHERE id = 'd1500000-0000-0000-0000-0000000000a3'),
  'subscribed',
  'wypis w tenancie B nie wypisuje subskrybenta tego adresu w tenancie A'
);

-- -- 5. Token globalny i token nieznany ----------------------------------------
SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-tok-global')->>'already_unsubscribed'),
  'false',
  'token globalny: pierwszy wypis'
);

SELECT ok(
  (SELECT used_at IS NOT NULL FROM public.email_unsubscribe_tokens
    WHERE token = 'nlu-tok-global')
  AND (SELECT status = 'unsubscribed' FROM public.newsletter_subscribers
        WHERE id = 'd1500000-0000-0000-0000-0000000000a5'),
  'token globalny zostaje zuzyty, a subskrypcja tego adresu zdjeta'
);

SELECT is(
  (SELECT public.email_unsubscribe_by_token('nlu-nie-ma-takiego')->>'error'),
  'unknown_token',
  'nieznany token nie stawia zadnej blokady'
);

SELECT * FROM finish();
ROLLBACK;
