-- ============================================================================
-- RETENCJA CV: FUNKCJE KOLEJKI TYLKO DLA ROLI SERWISOWEJ.
--
-- PRZYCZYNA (ta sama klasa co 20261007120500). Domyslne uprawnienia platformy
-- nadaja EXECUTE na kazda NOWA funkcje w `public` JAWNIE rolom anon
-- i authenticated; migracje kolejki retencji (20260814110000:516-523,
-- 20260814123014:419-426) zdjely EXECUTE tylko z PUBLIC i anon, wiec
-- `authenticated` zostal z grantem domyslnym.
--
-- `career_cv_gc_scan/claim/done/fail` maja bramke `is_super_admin` dla
-- zalogowanych, ale kod woluje je WYLACZNIE z joba retencji
-- (`src/lib/server/careerCvRetention.server.ts`, supabaseAdmin). Kolejka niesie
-- SCIEZKI do plikow CV kandydatow - zadnej powierzchni klienta tu nie trzeba,
-- a grant szerszy niz kod to jedna bramka w ciele funkcji mniej od wycieku.
-- Znalezisko asercji 3 kontraktu TS <-> SQL.
--
-- OSOBNA MIGRACJA, bo harness kariery (`scripts/careers-harness`) stawia
-- wylacznie migracje modulu kariery - funkcje z 20261007120500 w nim nie
-- istnieja, a te tutaj sa sprawdzane na jego zywej bazie.
--
-- IDEMPOTENTNA: bezstanowe REVOKE/GRANT.
-- DOWOD: supabase/tests/service_only_rpc_grants_test.sql.
-- ============================================================================

REVOKE ALL ON FUNCTION public.career_cv_gc_scan(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_cv_gc_claim(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_cv_gc_done(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.career_cv_gc_fail(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_scan(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_claim(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_done(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.career_cv_gc_fail(text, text) TO service_role;
