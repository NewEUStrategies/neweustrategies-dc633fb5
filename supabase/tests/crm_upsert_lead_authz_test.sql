-- pgTAP: crm_upsert_lead nie moze byc wywolywana bezposrednio przez klienta.
--
-- Regresja (naprawiona w 20260724090200): crm_upsert_lead(_tenant, ...) jest
-- SECURITY DEFINER, bierze _tenant z parametru i nie ma kontroli autoryzacji,
-- a byla `GRANT EXECUTE ... TO authenticated` -> kazdy zalogowany uzytkownik
-- mogl pisac leady do dowolnego tenanta i falszowac marketing_consent.
-- Funkcja powinna byc wywolywalna wylacznie przez service_role oraz wewnetrzne
-- funkcje SECURITY DEFINER (ktore i tak nie sprawdzaja grantu roli).

BEGIN;
SELECT plan(3);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)',
    'EXECUTE'
  ),
  'authenticated CANNOT EXECUTE crm_upsert_lead (no cross-tenant lead injection)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)',
    'EXECUTE'
  ),
  'anon CANNOT EXECUTE crm_upsert_lead'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)',
    'EXECUTE'
  ),
  'service_role CAN still EXECUTE crm_upsert_lead (internal callers keep working)'
);

SELECT * FROM finish();
ROLLBACK;
