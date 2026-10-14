-- pgTAP: DLQ poczty bez tresci i z retencja 30 dni (REG-17, migracja
-- 20261012160100_email_dlq_redaction_retention).
--
-- KRYTERIUM AUDYTU REG-17 (czesc „jawne kody w kolejce poczty"): wiadomosc,
-- ktora nie wyszla, NIE zostawia w bazie tresci maila - kodu wejscia z biletu,
-- linku samoobslugi, linku resetu hasla ani tokenu wypisu - i nie lezy w DLQ
-- dluzej niz 30 dni. Zaleglosc sprzed migracji jest redagowana z zachowaniem
-- wieku, kolejki glowne zostaja nietkniete.
--
-- KOLEJKI TYLKO PRZEZ API pgmq. Atrapa lokalna (scripts/pgtap-local/stub.sql)
-- trzyma wszystkie kolejki w jednej tabeli i nie ukrywa przeczytanych
-- wiadomosci, prawdziwe pgmq (CI) - tabela na kolejke i `vt`. Zapis i odczyt
-- produkcyjny ida wiec przez send/read/delete, a do OGLEDZIN tresci kolejki
-- (niezaleznie od `vt`, ktore prune ustawia czytajac) sluzy pomocnik
-- rozpoznajacy oba uklady.
BEGIN;
SELECT plan(21);

-- Wszystkie wiadomosci kolejki (niezaleznie od widocznosci), w kolejnosci
-- wstawienia.
CREATE FUNCTION pg_temp.queue_messages(_q text) RETURNS SETOF jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('pgmq.q_messages') IS NOT NULL THEN
    RETURN QUERY EXECUTE
      'SELECT message FROM pgmq.q_messages WHERE queue_name = $1 ORDER BY msg_id' USING _q;
  ELSE
    RETURN QUERY EXECUTE format('SELECT message FROM pgmq.%I ORDER BY msg_id', 'q_' || _q);
  END IF;
END $$;

CREATE FUNCTION pg_temp.dlq_message(_q text, _message_id text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT m FROM pg_temp.queue_messages(_q) m WHERE m->>'message_id' = _message_id LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 1. ACL i harmonogram
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'public._email_dlq_redact(jsonb, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._email_dlq_redact(jsonb, timestamptz)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._email_dlq_redact(jsonb, timestamptz)', 'EXECUTE'),
  '_email_dlq_redact: tylko service_role');
SELECT ok(NOT has_function_privilege('anon', 'public.email_dlq_prune(interval, integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.email_dlq_prune(interval, integer)', 'EXECUTE'),
  'email_dlq_prune: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public.email_dlq_prune(interval, integer)', 'EXECUTE'),
  'email_dlq_prune: service_role (pg_cron / na zadanie)');
SELECT ok(NOT has_function_privilege('anon', 'public.move_to_dlq(text, text, bigint, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.move_to_dlq(text, text, bigint, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.move_to_dlq(text, text, bigint, jsonb)', 'EXECUTE'),
  'move_to_dlq: nadal tylko service_role');
SELECT ok(to_regclass('cron.job') IS NULL
  OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-dlq-prune' AND schedule = '37 3 * * *'
               AND command LIKE '%email_dlq_prune(interval ''30 days''%'),
  'harmonogram: email-dlq-prune codziennie o 3:37 (gdy jest pg_cron)');

-- ---------------------------------------------------------------------------
-- 2. move_to_dlq: do DLQ idzie ladunek po redakcji
-- ---------------------------------------------------------------------------
-- Mail z biletem: kod wejscia i klucz samoobslugi w linku, token wypisu.
CREATE TEMP TABLE b7dlq (k text PRIMARY KEY, payload jsonb NOT NULL, msg_id bigint);
GRANT ALL ON b7dlq TO service_role;
INSERT INTO b7dlq (k, payload) VALUES ('ticket', jsonb_build_object(
  'message_id', 'b7dlq-ticket',
  'to', 'b7dlq@example.org',
  'subject', 'Twoj bilet',
  'label', 'event_ticket_issued',
  'purpose', 'transactional',
  'html', '<a href="https://example.org/events/x/ticket#t=QRQRQRQRQRQRQRQRQRQRQRQRQRQRQRQR&m=MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM">Bilet</a>',
  'text', 'Kod: QRQRQRQRQRQRQRQRQRQRQRQRQRQRQRQR',
  'unsubscribe_token', 'UNSUBUNSUBUNSUB'));
-- `pgmq.send` zwraca SETOF bigint (pgmq >= 1.4); w UPDATE ... SET funkcja
-- zwracajaca zbior jest niedozwolona, wiec identyfikator czytamy podzapytaniem.
UPDATE b7dlq SET msg_id = (SELECT s.id FROM pgmq.send('transactional_emails', payload) AS s(id))
 WHERE k = 'ticket';

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT isnt(public.move_to_dlq('transactional_emails', 'transactional_emails_dlq',
    (SELECT msg_id FROM b7dlq WHERE k = 'ticket'),
    (SELECT payload FROM b7dlq WHERE k = 'ticket')),
  NULL::bigint, 'move_to_dlq: wiadomosc przeniesiona (nowy identyfikator w DLQ)');
RESET ROLE;

SELECT ok(NOT (pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-ticket') ?| ARRAY['html', 'text', 'unsubscribe_token']),
  'DLQ: bez html, text i unsubscribe_token');
SELECT ok(pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-ticket')::text NOT LIKE '%QRQRQRQR%'
  AND pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-ticket')::text NOT LIKE '%MMMMMMMM%'
  AND pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-ticket')::text NOT LIKE '%UNSUBUNSUB%',
  'DLQ: REG-17 ani kod wejscia, ani klucz samoobslugi, ani token wypisu nie zostaja w bazie');
SELECT is(pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-ticket')
            - ARRAY['dlq_at'],
  jsonb_build_object('message_id', 'b7dlq-ticket', 'to', 'b7dlq@example.org', 'subject', 'Twoj bilet',
                     'label', 'event_ticket_issued', 'purpose', 'transactional', 'redacted', true),
  'DLQ: zostaje to, czego potrzebuje operator (adresat, temat, etykieta) + redacted');
SELECT is((pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-ticket')->>'dlq_at')::timestamptz, now(),
  'DLQ: dlq_at = chwila przeniesienia');
SELECT is((SELECT count(*)::int FROM pg_temp.queue_messages('transactional_emails') m
            WHERE m->>'message_id' = 'b7dlq-ticket'), 0,
  'move_to_dlq: zrodlo skasowane');

-- ---------------------------------------------------------------------------
-- 3. email_dlq_prune: zaleglosc i retencja
-- ---------------------------------------------------------------------------
-- Zaleglosc sprzed migracji: tresc w DLQ, wiek 10 dni (zostaje, ale bez tresci).
SELECT pgmq.send('transactional_emails_dlq', jsonb_build_object(
  'message_id', 'b7dlq-legacy', 'to', 'legacy@example.org', 'subject', 'Zarzadzaj zgloszeniem',
  'html', '<a href="/events/x/manage?token=LEGACYLEGACYLEGACY">', 'text', 'LEGACYLEGACYLEGACY',
  'dlq_at', to_jsonb(now() - interval '10 days')));
-- Ladunek, ktory nie jest obiektem - zastapiony w calosci.
SELECT pgmq.send('transactional_emails_dlq', to_jsonb('surowy ladunek z kodem RAWRAWRAW'::text));
-- Mail autoryzacyjny sprzed 40 dni (magic link) - skasowany.
SELECT pgmq.send('auth_emails_dlq', jsonb_build_object(
  'message_id', 'b7dlq-old', 'to', 'old@example.org', 'html', 'magic link OLDOLDOLD',
  'dlq_at', to_jsonb(now() - interval '40 days')));
-- Juz zredagowany, 5 dni - nietkniety.
SELECT pgmq.send('auth_emails_dlq', jsonb_build_object(
  'message_id', 'b7dlq-young', 'to', 'young@example.org', 'redacted', true,
  'dlq_at', to_jsonb(now() - interval '5 days')));
-- Kolejka glowna - poza zakresem retencji DLQ.
SELECT pgmq.send('auth_emails', jsonb_build_object(
  'message_id', 'b7dlq-main', 'to', 'main@example.org', 'html', 'reset MAINMAINMAIN'));

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
CREATE TEMP TABLE b7dlq_run AS SELECT public.email_dlq_prune() AS r;
SELECT throws_ok($$SELECT public.email_dlq_prune(interval '0 days', 10)$$,
  'P0001', 'invalid_payload: retention age must be positive',
  'prune: wiek retencji musi byc dodatni');
RESET ROLE;

SELECT is((SELECT r - 'scanned' - 'skipped' FROM b7dlq_run),
  '{"ok": true, "deleted": 1, "redacted": 2}'::jsonb,
  'prune: jeden starszy niz 30 dni skasowany, dwie zaleglosci z trescia zredagowane');
SELECT is(pg_temp.dlq_message('auth_emails_dlq', 'b7dlq-old'), NULL::jsonb,
  'prune: wiadomosc starsza niz 30 dni (dlq_at) skasowana');
SELECT ok(NOT (pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-legacy') ?| ARRAY['html', 'text', 'unsubscribe_token'])
  AND (pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-legacy')->>'redacted')::boolean,
  'prune: zaleglosc z trescia zredagowana');
SELECT is((pg_temp.dlq_message('transactional_emails_dlq', 'b7dlq-legacy')->>'dlq_at')::timestamptz,
  now() - interval '10 days', 'prune: redakcja zachowuje wiek wiadomosci (nie odmladza jej)');
SELECT is((SELECT count(*)::int FROM pg_temp.queue_messages('transactional_emails_dlq') m
            WHERE jsonb_typeof(m) <> 'object' OR m::text LIKE '%RAWRAWRAW%'), 0,
  'prune: ladunek nie-obiekt zastapiony w calosci');
SELECT is(pg_temp.dlq_message('auth_emails_dlq', 'b7dlq-young') - 'dlq_at',
  '{"message_id": "b7dlq-young", "to": "young@example.org", "redacted": true}'::jsonb,
  'prune: mlodsza wiadomosc bez tresci nietknieta');
SELECT is(pg_temp.dlq_message('auth_emails', 'b7dlq-main')->>'html', 'reset MAINMAINMAIN',
  'prune: kolejka glowna poza zakresem (tresc potrzebna do wysylki)');
SELECT is((SELECT count(*)::int FROM (
             SELECT m FROM pg_temp.queue_messages('transactional_emails_dlq') m
             UNION ALL
             SELECT m FROM pg_temp.queue_messages('auth_emails_dlq') m) q
            WHERE q.m ?| ARRAY['html', 'text', 'unsubscribe_token']), 0,
  'prune: REG-17 po przebiegu zadna DLQ nie trzyma tresci maila');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(public.email_dlq_prune() - 'scanned' - 'skipped',
  '{"ok": true, "deleted": 0, "redacted": 0}'::jsonb,
  'prune: drugi przebieg nie ma nic do zrobienia (idempotentny)');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
