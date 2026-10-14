-- pgTAP: dziennik idempotencji SMS (REG-11, migracja 20261012131000_sms_send_log).
--
-- CO PRZYPINA:
--   * „wyslane" dopiero po zamknieciu rezerwacji jako sent; blad operatora
--     (finish failed) zwalnia klucz i kolejna rezerwacja dostaje 'claimed' -
--     DOWOD UKONCZENIA audytu „blad HTTP -> ponowienie faktycznie wysyla";
--   * swieza rezerwacja innego procesu to 'in_flight' (bez wysylki), wiszaca
--     ponad 10 minut wraca do gry, limit prob daje 'exhausted';
--   * kazde przejecie zmienia claim_id - spozniony wynik starszej proby nie
--     nadpisze stanu nowszej;
--   * najemcy nie dziela kluczy, retencja 30 dni, zadanie pg_cron;
--   * brak numeru i tresci w tabeli; ACL wylacznie service_role.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test sms_send_log
BEGIN;
SELECT plan(37);

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-a', 'SMS log A', 'ssl-a.example'),
  ('5d000000-0000-0000-0000-0000000000bb', 'ssl-b', 'SMS log B', 'ssl-b.example');

-- ── 1. ACL i ksztalt ─────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.sms_send_claim(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sms_send_claim(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sms_send_finish(uuid, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sms_send_finish(uuid, uuid, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sms_send_log_prune(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.sms_send_log_prune(integer)', 'EXECUTE'),
  'acl: claim/finish/prune bez EXECUTE dla anon i authenticated');
SELECT ok(
  has_function_privilege('service_role', 'public.sms_send_claim(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.sms_send_finish(uuid, uuid, text, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.sms_send_log_prune(integer)', 'EXECUTE'),
  'acl: claim/finish/prune dla service_role');
SELECT ok(
  NOT has_table_privilege('anon', 'public.sms_send_log', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.sms_send_log', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.sms_send_log', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.sms_send_log', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.sms_send_log', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.sms_send_log', 'DELETE'),
  'acl: klient nie czyta i nie pisze dziennika');
SELECT ok(has_table_privilege('service_role', 'public.sms_send_log', 'SELECT,INSERT,UPDATE,DELETE'),
  'acl: service_role ma pelny dostep do dziennika');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sms_send_log'::regclass),
  'rls: wlaczone (brak polityk klienta)');
SELECT hasnt_column('public', 'sms_send_log', 'phone', 'minimalizacja: brak kolumny z numerem');
SELECT hasnt_column('public', 'sms_send_log', 'body', 'minimalizacja: brak kolumny z trescia');
SELECT ok((
  SELECT bool_and(EXISTS (
           SELECT 1 FROM unnest(p.proconfig) c
            WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp%'))
    FROM pg_proc p
   WHERE p.oid IN ('public.sms_send_claim(uuid, text)'::regprocedure,
                   'public.sms_send_finish(uuid, uuid, text, text)'::regprocedure,
                   'public.sms_send_log_prune(integer)'::regprocedure)),
  'search_path: kazda z trzech funkcji ma przypieta sciezke z pg_temp');

-- ── 2. Rezerwacja i zamkniecie ───────────────────────────────────────────────
SET LOCAL ROLE service_role;

CREATE TEMP TABLE c (step text PRIMARY KEY, res jsonb) ON COMMIT DROP;
GRANT ALL ON c TO service_role;

INSERT INTO c VALUES ('first', public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'event-ticket-sms:k-1'));
SELECT is((SELECT res->>'state' FROM c WHERE step = 'first'), 'claimed', 'claim: nowy klucz -> claimed');
SELECT ok((SELECT res->>'claim_id' IS NOT NULL FROM c WHERE step = 'first')
  AND (SELECT status = 'pending' AND attempts = 1 AND sent_at IS NULL
         FROM public.sms_send_log WHERE idempotency_key = 'event-ticket-sms:k-1'),
  'claim: wiersz pending, proba 1, bez sent_at');

INSERT INTO c VALUES ('busy', public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'event-ticket-sms:k-1'));
SELECT is((SELECT res FROM c WHERE step = 'busy'), '{"claim_id": null, "state": "in_flight"}'::jsonb,
  'claim: swieza rezerwacja innego procesu -> in_flight bez claim_id (bez wysylki)');

SELECT ok(public.sms_send_finish('5d000000-0000-0000-0000-0000000000aa',
    (SELECT (res->>'claim_id')::uuid FROM c WHERE step = 'first'), 'failed', 'sms_http_500'),
  'finish: failed na swojej rezerwacji -> true');
SELECT ok((SELECT status = 'failed' AND detail = 'sms_http_500' AND sent_at IS NULL
             FROM public.sms_send_log WHERE idempotency_key = 'event-ticket-sms:k-1'),
  'finish: wiersz failed z kodem bledu, bez sent_at');

-- UKONCZENIE (REG-11, czesc SQL): blad operatora NIE konczy sie „duplicate" -
-- kolejna proba dostaje rezerwacje i moze wyslac.
INSERT INTO c VALUES ('retry', public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'event-ticket-sms:k-1'));
SELECT is((SELECT res->>'state' FROM c WHERE step = 'retry'), 'claimed',
  'UKONCZENIE: po bledzie HTTP ponowienie dostaje claimed (stara bramka: duplicate)');
SELECT ok((SELECT attempts = 2 AND status = 'pending' AND detail IS NULL
             FROM public.sms_send_log WHERE idempotency_key = 'event-ticket-sms:k-1')
  AND (SELECT (res->>'claim_id') FROM c WHERE step = 'retry')
      IS DISTINCT FROM (SELECT (res->>'claim_id') FROM c WHERE step = 'first'),
  'claim: ponowienie = proba 2, nowy claim_id, kod bledu wyczyszczony');

SELECT ok(NOT public.sms_send_finish('5d000000-0000-0000-0000-0000000000aa',
    (SELECT (res->>'claim_id')::uuid FROM c WHERE step = 'first'), 'sent', NULL),
  'finish: spozniony wynik STAREJ rezerwacji niczego nie zmienia');
SELECT ok(NOT public.sms_send_finish('5d000000-0000-0000-0000-0000000000bb',
    (SELECT (res->>'claim_id')::uuid FROM c WHERE step = 'retry'), 'sent', NULL),
  'finish: rezerwacja z innym najemca -> false');

SELECT ok(public.sms_send_finish('5d000000-0000-0000-0000-0000000000aa',
    (SELECT (res->>'claim_id')::uuid FROM c WHERE step = 'retry'), 'sent', NULL),
  'finish: sent na biezacej rezerwacji -> true');
SELECT ok((SELECT status = 'sent' AND sent_at IS NOT NULL
             FROM public.sms_send_log WHERE idempotency_key = 'event-ticket-sms:k-1'),
  'finish: wiersz sent ze stemplem sent_at');

INSERT INTO c VALUES ('after_sent', public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'event-ticket-sms:k-1'));
SELECT is((SELECT res FROM c WHERE step = 'after_sent'), '{"claim_id": null, "state": "sent"}'::jsonb,
  'claim: po prawdziwym sukcesie -> sent (dopiero teraz duplikat mowi prawde)');
SELECT ok(NOT public.sms_send_finish('5d000000-0000-0000-0000-0000000000aa',
    (SELECT (res->>'claim_id')::uuid FROM c WHERE step = 'retry'), 'failed', 'late'),
  'finish: wiersz juz nie pending -> false (sent zostaje sent)');

SELECT throws_ok(
  $$SELECT public.sms_send_finish('5d000000-0000-0000-0000-0000000000aa', gen_random_uuid(), 'bogus', NULL)$$,
  'P0001', 'invalid_status: status must be sent or failed',
  'finish: status spoza sent|failed -> invalid_status');
SELECT throws_ok(
  $$SELECT public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'short')$$,
  'P0001', 'invalid_payload: idempotency key must have 8 to 300 characters',
  'claim: klucz krotszy niz 8 znakow -> invalid_payload');
SELECT throws_ok(
  $$SELECT public.sms_send_claim(NULL, 'event-ticket-sms:k-x')$$,
  'P0001', 'invalid_payload: tenant is required',
  'claim: bez najemcy -> invalid_payload');

-- Ten sam klucz u innego najemcy to inny wpis.
INSERT INTO c VALUES ('other_tenant', public.sms_send_claim('5d000000-0000-0000-0000-0000000000bb', 'event-ticket-sms:k-1'));
SELECT is((SELECT res->>'state' FROM c WHERE step = 'other_tenant'), 'claimed',
  'claim: ten sam klucz u innego najemcy rezerwuje sie niezaleznie');

-- ── 3. Wiszace rezerwacje i limit prob ────────────────────────────────────────
RESET ROLE;
INSERT INTO public.sms_send_log (tenant_id, idempotency_key, status, attempts, claimed_at, detail, sent_at) VALUES
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-stale-pending', 'pending', 1, now() - interval '11 minutes', NULL, NULL),
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-fresh-pending', 'pending', 1, now() - interval '9 minutes', NULL, NULL),
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-failed-4', 'failed', 4, now() - interval '1 hour', 'sms_http_503', NULL),
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-failed-5', 'failed', 5, now() - interval '1 hour', 'sms_http_503', NULL),
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-stale-cap', 'pending', 10, now() - interval '1 hour', NULL, NULL);
SET LOCAL ROLE service_role;

SELECT is(public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'ssl-stale-pending')->>'state', 'claimed',
  'claim: pending wiszace ponad 10 minut wraca do gry (proces padl po rezerwacji)');
SELECT is(public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'ssl-fresh-pending')->>'state', 'in_flight',
  'claim: pending sprzed 9 minut -> in_flight');
SELECT is(public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'ssl-failed-4')->>'state', 'claimed',
  'claim: failed przy 4 probach -> claimed (proba 5)');
SELECT is((SELECT attempts FROM public.sms_send_log WHERE idempotency_key = 'ssl-failed-4'), 5,
  'claim: licznik prob rosnie przy kazdym przejeciu');
SELECT is(public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'ssl-failed-5')->>'state', 'exhausted',
  'claim: failed przy 5 probach -> exhausted');
SELECT is(public.sms_send_claim('5d000000-0000-0000-0000-0000000000aa', 'ssl-stale-cap')->>'state', 'exhausted',
  'claim: wiszace pending przy 10 probach -> exhausted, nie wieczne in_flight');
SELECT ok(
  pg_get_functiondef('public.sms_send_claim(uuid, text)'::regprocedure) LIKE '%interval ''10 minutes''%'
  AND pg_get_functiondef('public._event_delivery_claim(jsonb)'::regprocedure) LIKE '%interval ''15 minutes''%',
  'niezmiennik: przejecie wiszacego SMS (10 min) krotsze niz przejecie doreczenia (15 min)');

-- ── 4. Retencja i harmonogram ─────────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.sms_send_log (tenant_id, idempotency_key, status, attempts, sent_at, created_at, updated_at) VALUES
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-old-31d', 'sent', 1, now() - interval '31 days',
   now() - interval '31 days', now() - interval '31 days'),
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-keep-29d', 'sent', 1, now() - interval '29 days',
   now() - interval '29 days', now() - interval '29 days'),
  ('5d000000-0000-0000-0000-0000000000aa', 'ssl-old-but-touched', 'failed', 2, NULL,
   now() - interval '40 days', now() - interval '1 day');
SET LOCAL ROLE service_role;
SELECT cmp_ok(public.sms_send_log_prune(50000), '>=', 1, 'prune: kasuje co najmniej wiersz sprzed 31 dni');
RESET ROLE;
SELECT ok(NOT EXISTS (SELECT 1 FROM public.sms_send_log WHERE idempotency_key = 'ssl-old-31d'),
  'prune: wiersz bez zmian od 31 dni usuniety');
SELECT ok(EXISTS (SELECT 1 FROM public.sms_send_log WHERE idempotency_key = 'ssl-keep-29d')
  AND EXISTS (SELECT 1 FROM public.sms_send_log WHERE idempotency_key = 'ssl-old-but-touched'),
  'prune: wiersz sprzed 29 dni i stary, ale ruszony wczoraj, zostaja');
SELECT row_eq(
  $$ SELECT schedule, command FROM cron.job WHERE jobname = 'sms-send-log-prune' $$,
  ROW('53 3 * * *'::text, 'SELECT public.sms_send_log_prune(50000)'::text),
  'pg_cron: sms-send-log-prune codziennie 03:53, partia 50000');
SELECT has_index('public', 'sms_send_log', 'sms_send_log_updated_at_idx', ARRAY['updated_at'],
  'indeks updated_at pod partie retencji');

SELECT * FROM finish();
ROLLBACK;
