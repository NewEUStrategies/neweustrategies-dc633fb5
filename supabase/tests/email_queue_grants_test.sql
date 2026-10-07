-- pgTAP: wrappery kolejek poczty (pgmq) tylko dla roli serwisowej
-- (migracja 20261007140000_email_queue_service_only).
--
-- DEFEKT. Cztery funkcje SECURITY DEFINER bez bramki w ciele zostaly zamkniete
-- tylko dla PUBLIC, a domyslne uprawnienia platformy daja EXECUTE jawnie rolom
-- anon i authenticated. Klucz publikowalny wystarczal, zeby czytac kolejke maili
-- autoryzacyjnych (linki resetu hasla) i wysylac dowolna poczte z adresu
-- platformy.
--
-- CO PRZYPINA: brak EXECUTE dla anon i authenticated, EXECUTE dla service_role
-- (webhook auth, wysylka transakcyjna i dren kolejki dzialaja). Asercje czytaja
-- ACL (has_function_privilege), wiec nie zaleza od zawartosci kolejek.
BEGIN;
SELECT plan(12);

SELECT ok(NOT has_function_privilege('anon', 'public.read_email_batch(text, integer, integer)', 'EXECUTE'),
  'read_email_batch: anon bez EXECUTE (odczyt linkow resetu hasla z auth_emails)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.read_email_batch(text, integer, integer)', 'EXECUTE'),
  'read_email_batch: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.read_email_batch(text, integer, integer)', 'EXECUTE'),
  'read_email_batch: service_role z EXECUTE (dren kolejki)');

SELECT ok(NOT has_function_privilege('anon', 'public.enqueue_email(text, jsonb)', 'EXECUTE'),
  'enqueue_email: anon bez EXECUTE (dowolny mail z adresu platformy)');
SELECT ok(NOT has_function_privilege('authenticated', 'public.enqueue_email(text, jsonb)', 'EXECUTE'),
  'enqueue_email: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.enqueue_email(text, jsonb)', 'EXECUTE'),
  'enqueue_email: service_role z EXECUTE (webhook auth, wysylka transakcyjna)');

SELECT ok(NOT has_function_privilege('anon', 'public.delete_email(text, bigint)', 'EXECUTE'),
  'delete_email: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.delete_email(text, bigint)', 'EXECUTE'),
  'delete_email: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.delete_email(text, bigint)', 'EXECUTE'),
  'delete_email: service_role z EXECUTE');

SELECT ok(NOT has_function_privilege('anon', 'public.move_to_dlq(text, text, bigint, jsonb)', 'EXECUTE'),
  'move_to_dlq: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.move_to_dlq(text, text, bigint, jsonb)', 'EXECUTE'),
  'move_to_dlq: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.move_to_dlq(text, text, bigint, jsonb)', 'EXECUTE'),
  'move_to_dlq: service_role z EXECUTE');

SELECT * FROM finish();
ROLLBACK;
