-- ============================================================================
-- FUNKCJE TYLKO DLA ROLI SERWISOWEJ: ZDJETE DOMYSLNE EXECUTE anon/authenticated.
--
-- PRZYCZYNA. Domyslne uprawnienia platformy (ALTER DEFAULT PRIVILEGES w
-- schemacie public, patrz 20261002140000) nadaja EXECUTE na kazda NOWA funkcje
-- JAWNIE rolom anon i authenticated. `REVOKE ... FROM PUBLIC` tych grantow nie
-- zdejmuje. Ponizsze funkcje sa SECURITY DEFINER, kod TS woluje je wylacznie
-- klientem service-role, a migracje, ktore je tworzyly, zdjely EXECUTE tylko
-- z PUBLIC (albo z PUBLIC i anon) - wiec grant byl szerszy niz kod.
-- Znaleziska asercji 3 kontraktu TS <-> SQL
-- (`supabase/tests/ts_sql_contract_test.sql`) po wiernym odtworzeniu domyslnych
-- uprawnien funkcji w lokalnym runnerze pgTAP.
--
--   1. `org_apply_subscription_seats(text, integer)` - BEZ bramki w ciele.
--      Kazdy z kluczem publikowalnym (anon!) ustawial `seats_limit` (1..500)
--      organizacji o podanym identyfikatorze subskrypcji i odpalal
--      `org_reconcile_seats`, czyli przycinal miejsca zespolu. Jedyny wolajacy:
--      webhook operatora platnosci (`teamSeats.server.ts`, supabaseAdmin).
--   2. `crm_upsert_from_form(uuid, text x9)` - przeciazenie 10-argumentowe BEZ
--      bramki: anon zakladal i scalal leady CRM w DOWOLNYM najemcy (najemca
--      jest argumentem). Rodzenstwo 11-argumentowe (z `_custom`) zamknieto juz
--      w 20260708120000; to zostalo z grantem domyslnym.
--   (3. funkcje retencji CV - osobna migracja 20261007120510: harness kariery
--      stawia wylacznie migracje modulu kariery, w ktorym dwoch powyzszych
--      funkcji nie ma.)
--
-- Wywolujacy SQL (`_event_person_crm_sync`, `club_application_crm_sync`,
-- `crm_import_leads`) to SECURITY DEFINER - wykonuja sie jako wlasciciel,
-- wiec EXECUTE wolajacego ich nie dotyczy.
--
-- IDEMPOTENTNA: bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/service_only_rpc_grants_test.sql.
-- ============================================================================

REVOKE ALL ON FUNCTION public.org_apply_subscription_seats(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_apply_subscription_seats(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.crm_upsert_from_form(uuid, text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_from_form(uuid, text, text, text, text, text, text, text, text, text)
  TO service_role;
