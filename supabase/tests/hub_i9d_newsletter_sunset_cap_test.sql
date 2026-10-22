-- pgTAP: DZIENNY LIMIT próśb o potwierdzenie na najemcę w zajęciu porcji
-- `newsletter_sunset_claim` (wygaszanie newslettera, I9d-Y1, Z-I9c-08;
-- migracja 20261020162000). To kontrakt, na którym stoi krok TS `jobs-tick`
-- (`src/lib/privacy/newsletterSunsetMail.server.ts`): krok bierze jedną porcję
-- i NIE liczy limitu sam - limit (reputacja domeny nadawcy, stała
-- `newsletterDailyCap` = 200, parytet w dataRetentionParity.test.ts) musi
-- trzymać baza, także przy wielu tickach w ciągu doby.
--
-- CO PRZYPINA:
--   * porcja nie przekracza `p_limit`;
--   * najemca dostaje najwyżej 200 próśb na 24 h - liczą się prośby wysłane
--     w ciągu doby ORAZ zajęte w toku (dzierżawa), więc kolejne ticki tego
--     samego dnia nie dobierają ponad limit;
--   * po upływie doby od wysyłki reszta kolejki wychodzi;
--   * limit jest per najemca (drugi najemca nie czeka na pierwszego);
--   * kategoria wyłączona u najemcy - żadnej prośby.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_newsletter_sunset_cap
BEGIN;
SELECT plan(8);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
-- A: 205 próśb czeka na wysyłkę; B: 3; C: 2, kategoria wyłączona. Wszyscy
-- najemcy po karencji (założeni 30 dni temu, bez wierszy ustawień).
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19d4ca00-0000-4000-8000-0000000000a0', 'i9d-cap-a', 'I9d Cap A', now() - interval '30 days'),
  ('19d4ca00-0000-4000-8000-0000000000b0', 'i9d-cap-b', 'I9d Cap B', now() - interval '30 days'),
  ('19d4ca00-0000-4000-8000-0000000000c0', 'i9d-cap-c', 'I9d Cap C', now() - interval '30 days');
INSERT INTO public.data_retention_settings (tenant_id, category, period_months, enabled, enforce_after)
VALUES ('19d4ca00-0000-4000-8000-0000000000c0', 'newsletter_inactive', 12, false, now() - interval '1 day');

INSERT INTO public.newsletter_subscribers (tenant_id, email, status, language, created_at, confirmed_at)
SELECT t.id, 'cap' || g || '@' || t.slug || '.test', 'subscribed', 'pl', now() - interval '20 months',
       now() - interval '20 months'
  FROM public.tenants t
 CROSS JOIN LATERAL generate_series(1, CASE t.slug WHEN 'i9d-cap-a' THEN 205 WHEN 'i9d-cap-b' THEN 3 ELSE 2 END) g
 WHERE t.slug IN ('i9d-cap-a', 'i9d-cap-b', 'i9d-cap-c');
INSERT INTO public.newsletter_sunset_requests (subscriber_id, tenant_id, requested_at)
SELECT s.id, s.tenant_id, now() - interval '1 hour'
  FROM public.newsletter_subscribers s WHERE s.email LIKE 'cap%@i9d-cap-%.test';

CREATE TEMP TABLE claimed (round int, subscriber_id uuid, tenant_id uuid, nonce uuid) ON COMMIT DROP;
CREATE FUNCTION pg_temp.claim(p_round int, p_limit int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO claimed SELECT p_round, c.subscriber_id, c.tenant_id, c.nonce FROM public.newsletter_sunset_claim(p_limit) c
   WHERE c.tenant_id::text LIKE '19d4ca00-%';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── 1. Porcja i limit dzienny ───────────────────────────────────────────────
SELECT is(pg_temp.claim(1, 2), 2, 'porcja: najwyżej p_limit próśb');

SELECT is(pg_temp.claim(2, 500), 201,
  'drugi tick tej doby: A dobiera do 200 (z 2 zajętymi wcześniej), B swoje 3, C nic');
SELECT ok(
  (SELECT count(*) = 200 FROM claimed WHERE tenant_id = '19d4ca00-0000-4000-8000-0000000000a0')
  AND (SELECT count(*) = 3 FROM claimed WHERE tenant_id = '19d4ca00-0000-4000-8000-0000000000b0')
  AND NOT EXISTS (SELECT 1 FROM claimed WHERE tenant_id = '19d4ca00-0000-4000-8000-0000000000c0'),
  'limit per najemca: A = 200 (dzienny limit), B nie czeka na A, C (kategoria wyłączona) - zero');

SELECT is(pg_temp.claim(3, 500), 0, 'kolejny tick w trakcie dzierżawy: nic ponad limit');

-- Krok TS zapisuje wynik: wszystkie prośby A wysłane teraz.
SELECT ok(bool_and((public.newsletter_sunset_mark(c.subscriber_id, c.nonce, 'queued') ->> 'ok')::boolean),
          'wynik wysyłki zapisany (queued) dla 200 próśb A')
  FROM claimed c WHERE c.tenant_id = '19d4ca00-0000-4000-8000-0000000000a0';

SELECT is(pg_temp.claim(4, 500), 0,
  'po wysyłce tej samej doby: 5 próśb A czeka (wysłane w 24 h liczą się do limitu)');

-- ── 2. Następna doba ────────────────────────────────────────────────────────
UPDATE public.newsletter_sunset_requests SET mailed_at = mailed_at - interval '25 hours'
 WHERE tenant_id = '19d4ca00-0000-4000-8000-0000000000a0' AND mailed_at IS NOT NULL;
SELECT is(pg_temp.claim(5, 500), 5, 'po dobie od wysyłki reszta kolejki A wychodzi');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.newsletter_sunset_requests q
               WHERE q.tenant_id = '19d4ca00-0000-4000-8000-0000000000c0'
                 AND (q.attempts > 0 OR q.claimed_until IS NOT NULL OR q.mailed_at IS NOT NULL)),
  'kategoria wyłączona: prośby najemcy C nietknięte (bez zajęcia i wysyłki)');

SELECT * FROM finish();
ROLLBACK;
