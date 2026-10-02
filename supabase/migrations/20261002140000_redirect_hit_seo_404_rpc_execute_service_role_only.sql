-- ============================================================================
-- record_seo_404 / record_redirect_hit: EXECUTE WYLACZNIE DLA service_role.
--
-- PRZYCZYNA. Obie funkcje sa SECURITY DEFINER (omijaja RLS) i z zalozenia
-- wola je tylko serwer (src/lib/seo/redirects.server.ts, klient service-role):
--   * public.record_seo_404(uuid, text, text) - 20260703090300_redirects_tenant_scope
--     (linie 123-124; wczesniej 20260703063657:234-235),
--   * public.record_redirect_hit(uuid) - 20260702195636 (linie 78-79;
--     wczesniej 20260702130000:105-106).
-- Kazda z tych migracji robi jednak tylko `REVOKE ALL ... FROM PUBLIC`
-- i `GRANT EXECUTE ... TO service_role`. Domyslne uprawnienia platformy
-- (ALTER DEFAULT PRIVILEGES w schemacie public) nadaja EXECUTE na kazda nowa
-- funkcje JAWNIE rolom anon i authenticated - REVOKE z PUBLIC tych grantow
-- nie zdejmuje. Dlatego reszta repo konsekwentnie pisze
-- `FROM PUBLIC, anon, authenticated` (np. sweep 20260725181430:32-33).
-- Zaden pozniejszy sweep tych dwoch funkcji nie obejmuje: 20260725181311
-- dotyczy wylacznie funkcji wyzwalaczy, 20260725181430 - zamknietej listy
-- nazw, na ktorej ich nie ma.
--
-- SKUTEK LUKI (przez /rest/v1/rpc z kluczem publikowalnym):
--   * record_seo_404 - anon dopisuje dowolne sciezki i referery do monitora
--     404 DOWOLNEGO tenanta (tenant jest argumentem), czyli zasmieca panel
--     /admin/redirects i podsuwa operatorowi falszywe "brakujace adresy";
--   * record_redirect_hit - anon podbija hit_count/last_hit_at dowolnej
--     reguly, a to na tej kolumnie operator opiera decyzje o usunieciu
--     "martwej" 301-ki.
--
-- CO ZMIENIA. Zdejmuje EXECUTE z anon i authenticated (i ponownie z PUBLIC),
-- potwierdza GRANT dla service_role. Ciala funkcji, sygnatury i typy
-- generowane (src/integrations/supabase/types.ts) bez zmian.
--
-- IDEMPOTENCJA. REVOKE uprawnienia, ktorego rola nie ma, i GRANT juz
-- nadanego sa no-opami - ponowne wykonanie niczego nie zmienia.
--
-- DOWOD. supabase/tests/redirects_seo_404_tenant_rls_test.sql: asercje
-- has_function_privilege('anon'|'authenticated', ..., 'EXECUTE') = false
-- (do tej migracji w bloku todo_start) oraz = true dla service_role.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.record_seo_404(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_seo_404(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_redirect_hit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_redirect_hit(uuid) TO service_role;
