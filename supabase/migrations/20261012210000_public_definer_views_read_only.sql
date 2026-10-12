-- ============================================================================
-- PUBLICZNE WIDOKI DEFINER: TYLKO ODCZYT DLA ROL KLIENCKICH.
--
-- DEFEKT (zmierzony na produkcji 2026-10-12, katalog, tylko odczyt):
-- `pg_default_acl` roli postgres w schemacie public nadaje anon,
-- authenticated i service_role `arwdDxtm` na KAZDA nowa relacje, wiec kazdy
-- CREATE VIEW oddaje klientom INSERT/UPDATE/DELETE, a pozniejszy
-- GRANT SELECT tego nie zaweza. Ponizsze widoki sa:
--   * security_invoker = off (DEFINER) - tabele bazowa sprawdza wlasciciel,
--   * wlasnosci postgres (BYPASSRLS), a RLS tabel bazowych nie jest FORCE,
--   * proste (jedna tabela, bez agregatow) - Postgres aktualizuje je sam,
--   * bez WITH CHECK OPTION - INSERT nie podlega predykatowi widoku.
-- Zapis przez widok omija wiec CALE RLS tabeli bazowej: anon (PostgREST
-- PATCH/POST/DELETE na /rest/v1/<widok>) nadpisuje lub kasuje wiersze
-- widoczne w projekcji, a INSERT wstawia wiersz z dowolnym tenant_id /
-- user_id. Tak bylo z author_profiles_public (domkniete w 20261012200000);
-- ta migracja domyka reszte klasy:
--
--   profiles_public              -> profiles
--   career_page_sections_public  -> career_page_sections
--   personality_results_public   -> personality_results
--   profile_awards_public        -> profile_awards
--   profile_education_public     -> profile_education
--   profile_experiences_public   -> profile_experiences
--   profile_hobbies_public       -> profile_hobbies
--   profile_skills_public        -> profile_skills
--   content_access_public        -> content_access (patrz 2)
--
-- Zaden klient nie pisze przez te widoki (src/** i supabase/functions/**
-- tylko .select), wiec zostaje sam SELECT - ten sam, ktory migracje juz
-- nadawaly jawnie. service_role bez zmian (backend). Kolumnowych ACL na
-- widokach brak, wiec REVOKE ALL na relacji zdejmuje zapis w calosci.
-- Definicje widokow bez zmian - zmieniamy wylacznie granty.
--
-- 2) content_access_public: dryf w druga strone. Produkcja ma
-- security_invoker = on (20260721105920), ale 20260721120000 (dopisanie
-- metering_policy) odtwarza widok z security_invoker = off i w bazie
-- odbudowanej z tego pasa wygrywa - CI testowalo widok DEFINER, ktorego
-- na produkcji nie ma, z zapisywalnym one_time_price_cents (cena z tego
-- widoku idzie do checkoutu: checkout.functions.ts,
-- adhocCheckoutOrder.server.ts). ALTER VIEW ... SET (security_invoker = on)
-- jest na produkcji no-opem, a pas wyrownuje do stanu, ktory dziala tam od
-- lipca (odczyt anon/authenticated przez kolumnowy SELECT i polityke
-- "content_access public read" z 20260908070716).
--
-- Straznik klasy: supabase/tests/public_definer_views_read_only_test.sql -
-- kazdy widok DEFINER w public daje anon/authenticated/PUBLIC wylacznie
-- SELECT. Lokalne domyslne uprawnienia (Dxtm) sprawiaja, ze nowy widok
-- DEFINER bez jawnego REVOKE ALL oblewa ten test w CI.
--
-- Pas drizzle: drizzle/migrations/0153_public_definer_views_read_only.sql
-- (blizniak - ten sam SQL wykonywalny). Bez wpisu rejestru z pasa drizzle -
-- powod jak w 20261012200000 (glowa rejestru nie moze wyprzedzic wersji
-- 20261012095900..20261012122000, ktorych produkcja jeszcze nie ma).
--
-- careers-harness wybiera pliki po tresci (`public.career_`), wiec wciaga
-- ten plik przez career_page_sections_public, a potem odbija sie od
-- profiles_public i reszty widokow, ktorych harness kariery CELOWO nie
-- modeluje. Pominiecie jest jawne i widoczne w logu (SKIP); pelne
-- odtworzenie dowodzi pgtap na komplecie supabase/migrations.
-- careers-harness: exclude
-- IDEMPOTENTNA: REVOKE/GRANT, ALTER VIEW SET.
-- ============================================================================

-- ---------- 1) Widoki DEFINER: rolom klienckim zostaje SELECT ----------------
REVOKE ALL ON public.profiles_public FROM anon, authenticated;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

REVOKE ALL ON public.career_page_sections_public FROM anon, authenticated;
GRANT SELECT ON public.career_page_sections_public TO anon, authenticated;

REVOKE ALL ON public.personality_results_public FROM anon, authenticated;
GRANT SELECT ON public.personality_results_public TO anon, authenticated;

REVOKE ALL ON public.profile_awards_public FROM anon, authenticated;
GRANT SELECT ON public.profile_awards_public TO anon, authenticated;

REVOKE ALL ON public.profile_education_public FROM anon, authenticated;
GRANT SELECT ON public.profile_education_public TO anon, authenticated;

REVOKE ALL ON public.profile_experiences_public FROM anon, authenticated;
GRANT SELECT ON public.profile_experiences_public TO anon, authenticated;

REVOKE ALL ON public.profile_hobbies_public FROM anon, authenticated;
GRANT SELECT ON public.profile_hobbies_public TO anon, authenticated;

REVOKE ALL ON public.profile_skills_public FROM anon, authenticated;
GRANT SELECT ON public.profile_skills_public TO anon, authenticated;

REVOKE ALL ON public.content_access_public FROM anon, authenticated;
GRANT SELECT ON public.content_access_public TO anon, authenticated;

-- ---------- 2) content_access_public: z powrotem INVOKER, jak na produkcji ---
ALTER VIEW public.content_access_public SET (security_invoker = on);
