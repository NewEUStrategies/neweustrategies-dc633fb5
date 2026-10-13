-- pgTAP: publiczne widoki DEFINER sa dla rol klienckich TYLKO DO ODCZYTU
-- (migracje 20261012200000 i 20261012210000).
--
-- Klasa bledu: schemat public na produkcji ma domyslne uprawnienia `arwdDxtm`
-- dla anon/authenticated na kazda nowa relacje. Prosty widok
-- security_invoker = off wlasnosci postgres (BYPASSRLS) jest automatycznie
-- aktualizowalny, wiec INSERT/UPDATE/DELETE przez niego omija cale RLS
-- tabeli bazowej (INSERT takze predykat widoku - brak WITH CHECK OPTION).
-- Ten plik przybija:
--
--   * inwariant klasy: ZADEN widok DEFINER w public nie daje anon,
--     authenticated ani PUBLIC niczego poza SELECT - ani na relacji, ani
--     kolumnowo. Lokalne domyslne uprawnienia daja klientom `Dxtm`, wiec
--     nowy widok DEFINER w PASIE SUPABASE bez jawnego `REVOKE ALL ... FROM
--     anon, authenticated` oblewa ten test w CI. Zasieg jest uczciwie
--     waski: baza pgTAP powstaje wylacznie z supabase/migrations, wiec
--     widok zalozony tylko w pasie drizzle (migracja panelu Lovable bez
--     blizniaka, jak 0150) jest dla tego testu niewidoczny - i Lovable
--     wgrywa go na produkcje, zanim CI cokolwiek uruchomi. Te luke domyka
--     statycznie `check:sql-definer-views` (oba pasy, job verify),
--   * warunek czulosci: domyslne uprawnienia roli postgres w public daja
--     anon i authenticated cos poza SELECT. Inwariant wyzej lapie brak
--     REVOKE tylko dlatego; gdyby nowsze CLI zaostrzylo domyslki, test
--     przestalby widziec blad cicho - ta asercja zamienia to w czerwien,
--   * znane widoki zachowuja SELECT dla anon i authenticated (strony
--     publiczne czytaja je bez sesji),
--   * zapis przez kazdy znany widok konczy sie 42501 - anon UPDATE,
--     zalogowany DELETE i INSERT (WHERE false: bramka uprawnien dziala
--     przed wykonaniem, wiec seed jest zbedny; INSERT celuje w zwykla
--     kolumne, zeby 0A000 "cannot insert into column" nie przykryl 42501),
--   * content_access_public jest security_invoker (stan produkcji od
--     20260721105920; 20260721120000 cofal go w tym pasie do DEFINER).
--
-- Konwencje: plik samowystarczalny (BEGIN/plan/finish/ROLLBACK), wcielenia
-- przez SET LOCAL ROLE + request.jwt.claims.

BEGIN;
SELECT plan(35);

-- ── (1) Inwariant klasy: widok DEFINER = tylko SELECT dla klientow ─────────
SELECT is_empty(
  $$SELECT c.relname || ' -> ' || CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
           || ': ' || a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND NOT coalesce((SELECT o.option_value::boolean
                           FROM pg_options_to_table(c.reloptions) o
                          WHERE o.option_name = 'security_invoker'), false)
       AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
       AND a.privilege_type <> 'SELECT'$$,
  'zaden widok DEFINER w public nie daje anon/authenticated/PUBLIC praw innych niz SELECT'
);
SELECT is_empty(
  $$SELECT c.relname || '.' || att.attname || ' -> '
           || CASE a.grantee WHEN 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
           || ': ' || a.privilege_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND att.attacl IS NOT NULL
      CROSS JOIN LATERAL aclexplode(att.attacl) a
     WHERE n.nspname = 'public'
       AND c.relkind = 'v'
       AND NOT coalesce((SELECT o.option_value::boolean
                           FROM pg_options_to_table(c.reloptions) o
                          WHERE o.option_name = 'security_invoker'), false)
       AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
       AND a.privilege_type <> 'SELECT'$$,
  'zaden widok DEFINER w public nie daje klientom kolumnowego INSERT/UPDATE/REFERENCES'
);

-- ── (1b) Warunek czulosci inwariantu: lokalne domyslki daja klientom zapis ──
SELECT ok(
  (SELECT bool_and(EXISTS (
            SELECT 1
              FROM pg_default_acl d
              CROSS JOIN LATERAL aclexplode(d.defaclacl) a
             WHERE d.defaclrole = 'postgres'::regrole
               AND d.defaclnamespace = 'public'::regnamespace
               AND d.defaclobjtype = 'r'
               AND a.grantee = r.role
               AND a.privilege_type <> 'SELECT'))
     FROM (VALUES ('anon'::regrole), ('authenticated'::regrole)) AS r(role)),
  'domyslne uprawnienia public daja anon i authenticated prawo poza SELECT - bez tego inwariant (1) nie wykrylby brakujacego REVOKE ALL'
);

-- ── (2) Znane widoki publiczne zachowuja odczyt ─────────────────────────────
SELECT is_empty(
  $$SELECT v.name
      FROM unnest(ARRAY[
        'author_profiles_public', 'profiles_public', 'career_page_sections_public',
        'personality_results_public', 'profile_awards_public', 'profile_education_public',
        'profile_experiences_public', 'profile_hobbies_public', 'profile_skills_public',
        'content_access_public'
      ]) AS v(name)
     WHERE to_regclass('public.' || v.name) IS NULL
        OR NOT has_table_privilege('anon', 'public.' || v.name, 'SELECT')
        OR NOT has_table_privilege('authenticated', 'public.' || v.name, 'SELECT')$$,
  'wszystkie znane widoki publiczne istnieja i sa czytelne dla anon oraz authenticated'
);

-- ── (3) content_access_public: INVOKER jak na produkcji ─────────────────────
SELECT ok(
  coalesce((SELECT o.option_value::boolean
              FROM pg_options_to_table(
                     (SELECT reloptions FROM pg_class WHERE oid = 'public.content_access_public'::regclass)) o
             WHERE o.option_name = 'security_invoker'), false),
  'content_access_public jest security_invoker (odczyt przez RLS content_access, nie przez wlasciciela)'
);

-- ── (4) anon: UPDATE przez widok -> 42501 ───────────────────────────────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);

SELECT throws_ok($$UPDATE public.author_profiles_public SET user_id = user_id WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez author_profiles_public');
SELECT throws_ok($$UPDATE public.profiles_public SET slug = slug WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez profiles_public');
SELECT throws_ok($$UPDATE public.career_page_sections_public SET is_visible = is_visible WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez career_page_sections_public');
SELECT throws_ok($$UPDATE public.personality_results_public SET openness = openness WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez personality_results_public');
SELECT throws_ok($$UPDATE public.profile_awards_public SET title = title WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez profile_awards_public');
SELECT throws_ok($$UPDATE public.profile_education_public SET school = school WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez profile_education_public');
SELECT throws_ok($$UPDATE public.profile_experiences_public SET company = company WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez profile_experiences_public');
SELECT throws_ok($$UPDATE public.profile_hobbies_public SET label = label WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez profile_hobbies_public');
SELECT throws_ok($$UPDATE public.profile_skills_public SET label = label WHERE false$$,
  '42501', NULL, 'anon NIE aktualizuje przez profile_skills_public');
SELECT throws_ok($$UPDATE public.content_access_public SET one_time_price_cents = 1 WHERE false$$,
  '42501', NULL, 'anon NIE zmienia ceny przez content_access_public');

-- ── (5) authenticated: DELETE i INSERT przez widok -> 42501 ─────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok($$DELETE FROM public.author_profiles_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez author_profiles_public');
SELECT throws_ok($$DELETE FROM public.profiles_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez profiles_public');
SELECT throws_ok($$DELETE FROM public.career_page_sections_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez career_page_sections_public');
SELECT throws_ok($$DELETE FROM public.personality_results_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez personality_results_public');
SELECT throws_ok($$DELETE FROM public.profile_awards_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez profile_awards_public');
SELECT throws_ok($$DELETE FROM public.profile_education_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez profile_education_public');
SELECT throws_ok($$DELETE FROM public.profile_experiences_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez profile_experiences_public');
SELECT throws_ok($$DELETE FROM public.profile_hobbies_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez profile_hobbies_public');
SELECT throws_ok($$DELETE FROM public.profile_skills_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje przez profile_skills_public');
SELECT throws_ok($$DELETE FROM public.content_access_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE kasuje regul dostepu przez content_access_public');

SELECT throws_ok($$INSERT INTO public.author_profiles_public (user_id)
                     SELECT user_id FROM public.author_profiles_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez author_profiles_public');
SELECT throws_ok($$INSERT INTO public.profiles_public (id)
                     SELECT id FROM public.profiles_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez profiles_public');
SELECT throws_ok($$INSERT INTO public.career_page_sections_public (key)
                     SELECT key FROM public.career_page_sections_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez career_page_sections_public');
SELECT throws_ok($$INSERT INTO public.personality_results_public (user_id)
                     SELECT user_id FROM public.personality_results_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez personality_results_public');
SELECT throws_ok($$INSERT INTO public.profile_awards_public (user_id)
                     SELECT user_id FROM public.profile_awards_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez profile_awards_public');
SELECT throws_ok($$INSERT INTO public.profile_education_public (user_id)
                     SELECT user_id FROM public.profile_education_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez profile_education_public');
SELECT throws_ok($$INSERT INTO public.profile_experiences_public (user_id)
                     SELECT user_id FROM public.profile_experiences_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez profile_experiences_public');
SELECT throws_ok($$INSERT INTO public.profile_hobbies_public (user_id)
                     SELECT user_id FROM public.profile_hobbies_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez profile_hobbies_public');
SELECT throws_ok($$INSERT INTO public.profile_skills_public (user_id)
                     SELECT user_id FROM public.profile_skills_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia przez profile_skills_public');
SELECT throws_ok($$INSERT INTO public.content_access_public (id)
                     SELECT id FROM public.content_access_public WHERE false$$,
  '42501', NULL, 'zalogowany NIE wstawia regul dostepu przez content_access_public');

SELECT * FROM finish();
ROLLBACK;
