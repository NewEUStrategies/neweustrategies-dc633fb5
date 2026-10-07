-- pgTAP: funkcje wolane z TS wylacznie rola serwisowa nie sa wykonywalne dla
-- klienta (migracja 20261007120500_service_only_rpc_default_execute).
--
-- DEFEKT. Domyslne uprawnienia platformy nadaja EXECUTE na kazda nowa funkcje
-- w `public` JAWNIE rolom anon i authenticated; migracje tych funkcji zdjely
-- EXECUTE tylko z PUBLIC (albo z PUBLIC i anon). Najgrozniejsze:
-- `org_apply_subscription_seats` (SECURITY DEFINER bez bramki - anon
-- przestawial limit miejsc dowolnej organizacji) i 10-argumentowe
-- `crm_upsert_from_form` (anon pisal leady CRM w dowolnym najemcy).
--
-- CO PRZYPINA: brak EXECUTE dla anon i authenticated, EXECUTE dla
-- service_role (job retencji CV, webhook platnosci i formularze dzialaja).
-- Asercje czytaja ACL funkcji (has_function_privilege), nie wynik wywolania,
-- wiec nie zaleza od danych ani od bramek w cialach.
BEGIN;
SELECT plan(18);

SELECT ok(NOT has_function_privilege('anon', 'public.org_apply_subscription_seats(text, integer)', 'EXECUTE'),
  'org_apply_subscription_seats: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.org_apply_subscription_seats(text, integer)', 'EXECUTE'),
  'org_apply_subscription_seats: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.org_apply_subscription_seats(text, integer)', 'EXECUTE'),
  'org_apply_subscription_seats: service_role z EXECUTE (webhook platnosci)');

SELECT ok(NOT has_function_privilege('anon',
    'public.crm_upsert_from_form(uuid, text, text, text, text, text, text, text, text, text)', 'EXECUTE'),
  'crm_upsert_from_form (10 arg): anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated',
    'public.crm_upsert_from_form(uuid, text, text, text, text, text, text, text, text, text)', 'EXECUTE'),
  'crm_upsert_from_form (10 arg): authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role',
    'public.crm_upsert_from_form(uuid, text, text, text, text, text, text, text, text, text)', 'EXECUTE'),
  'crm_upsert_from_form (10 arg): service_role z EXECUTE');

SELECT ok(NOT has_function_privilege('anon', 'public.career_cv_gc_scan(integer)', 'EXECUTE'),
  'career_cv_gc_scan: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.career_cv_gc_scan(integer)', 'EXECUTE'),
  'career_cv_gc_scan: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.career_cv_gc_scan(integer)', 'EXECUTE'),
  'career_cv_gc_scan: service_role z EXECUTE (job retencji)');

SELECT ok(NOT has_function_privilege('anon', 'public.career_cv_gc_claim(integer)', 'EXECUTE'),
  'career_cv_gc_claim: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.career_cv_gc_claim(integer)', 'EXECUTE'),
  'career_cv_gc_claim: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.career_cv_gc_claim(integer)', 'EXECUTE'),
  'career_cv_gc_claim: service_role z EXECUTE');

SELECT ok(NOT has_function_privilege('anon', 'public.career_cv_gc_done(text[])', 'EXECUTE'),
  'career_cv_gc_done: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.career_cv_gc_done(text[])', 'EXECUTE'),
  'career_cv_gc_done: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.career_cv_gc_done(text[])', 'EXECUTE'),
  'career_cv_gc_done: service_role z EXECUTE');

SELECT ok(NOT has_function_privilege('anon', 'public.career_cv_gc_fail(text, text)', 'EXECUTE'),
  'career_cv_gc_fail: anon bez EXECUTE');
SELECT ok(NOT has_function_privilege('authenticated', 'public.career_cv_gc_fail(text, text)', 'EXECUTE'),
  'career_cv_gc_fail: authenticated bez EXECUTE');
SELECT ok(has_function_privilege('service_role', 'public.career_cv_gc_fail(text, text)', 'EXECUTE'),
  'career_cv_gc_fail: service_role z EXECUTE');

SELECT * FROM finish();
ROLLBACK;
