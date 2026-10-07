-- ============================================================================
-- UPRAWNIENIA KLIENTA ZGODNE Z TYM, JAK KOD TS NAPRAWDE WOLA BAZE.
--
-- Znaleziska pierwszego przebiegu kontraktu TypeScript <-> SQL
-- (`supabase/tests/ts_sql_contract_test.sql`, generator
-- `src/lib/ci/tsSqlContract.ts`). Kazde to rozjazd, ktorego nie widzial ani
-- test TS (atrapa przyjmuje kazde uprawnienie), ani pgTAP (nie zna wywolan TS):
--
--   1. `conversations` - DELETE dla `authenticated`. Polityka
--      `conversations_staff_delete` (admin/super_admin najemcy, 20260713200000)
--      powstala TRZY DNI PO `REVOKE ALL ... FROM authenticated`
--      (20260710092631:13), ktory zostawil tylko SELECT. Przycisk „Usun
--      konwersacje" w panelu czatu (`deleteConversation`,
--      src/lib/admin/community.ts) konczyl sie wiec 42501 przy KAZDYM
--      kliknieciu, a polityka nie miala czego pilnowac. Zakres usuwania dalej
--      wyznacza polityka (najemca + rola), nie grant.
--   2. `join_us_link_and_backfill(...)` - EXECUTE odebrane `authenticated`.
--      Kod woluje ja WYLACZNIE rola serwisowa z kontem z sesji
--      (`joinUsSync.functions.ts`, komentarz: „RPC ma REVOKE FROM PUBLIC, wiec
--      wymaga admin clienta"), a baza dawala EXECUTE kazdemu zalogowanemu:
--      `_user_id`, `_tenant_id` i `_email` z zadania pozwalaly przepiac
--      dowolna subskrypcje newslettera na dowolne konto i dopisac puste pola
--      cudzego profilu (telefon, LinkedIn, firma).
--   3. `enforce_form_field_policy(uuid, text, jsonb)` - EXECUTE odebrane
--      `PUBLIC`, `anon` i `authenticated`. Woluja ja wylacznie funkcje
--      serwerowe (newsletter, kontakt) rola serwisowa; anon odpytywal nia
--      polityke pol formularzy DOWOLNEGO najemcy (w tym wzorce regex).
--
-- Kod TS nie wymaga zmian dla 2 i 3 (juz woluje rola serwisowa); dla 1 to
-- jedyna poprawka - panel zaczyna dzialac.
--
-- IDEMPOTENTNA: bezstanowe GRANT/REVOKE.
-- ============================================================================

GRANT DELETE ON public.conversations TO authenticated;

REVOKE ALL ON FUNCTION public.join_us_link_and_backfill(uuid, uuid, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_us_link_and_backfill(uuid, uuid, text, text, text, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.enforce_form_field_policy(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_form_field_policy(uuid, text, jsonb) TO service_role;
