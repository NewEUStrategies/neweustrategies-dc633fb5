-- ============================================================================
-- FIX (P1 bezpieczenstwo): crm_upsert_lead - cross-tenant zapis bez autoryzacji.
--
-- public.crm_upsert_lead(_tenant, ...) jest SECURITY DEFINER, przyjmuje _tenant
-- z parametru klienta i NIE ma zadnej kontroli autoryzacji, a jednoczesnie ma
-- `GRANT EXECUTE ... TO authenticated` (20260630053423). Kazdy zalogowany
-- uzytkownik moze wiec wywolac ja bezposrednio przez PostgREST i:
--   * wstrzyknac/nadpisac leady w DOWOLNYM tenancie,
--   * wymusic marketing_consent = true (falszywa zgoda marketingowa, RODO).
--
-- Aplikacja NIE wola tej funkcji z klienta - wywolania ida wylacznie z innych
-- funkcji SECURITY DEFINER (newsletter confirm, workflow engine, bridge CRM),
-- ktore wykonuja sie z uprawnieniami definera (nie roli authenticated). Grant do
-- `authenticated` to zatem czysta, zbedna powierzchnia ataku - zdejmujemy go.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;

-- Pozostaje wylacznie dla service_role oraz wewnetrznych wywolan SECURITY DEFINER.
GRANT EXECUTE ON FUNCTION public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)
  TO service_role;
