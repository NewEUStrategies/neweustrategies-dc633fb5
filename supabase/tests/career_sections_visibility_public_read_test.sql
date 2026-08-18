-- pgTAP: publiczny odczyt sekcji strony /zatrudniamy respektuje przełącznik
-- widoczności (migracja 20260817230000).
--
-- Finding: `career_sections_public_read` filtrowała WYŁĄCZNIE po najemcy
-- (`tenant_id = public_tenant_id()`), choć bliźniacza polityka na
-- `career_roles` z tej samej migracji wiąże odczyt z flagą publikacji
-- (`is_published AND tenant_id = ...`). Sekcja wyłączona w panelu znikała ze
-- strony, ale jej wiersz - razem z roboczymi `title_*`/`subtitle_*` - był
-- czytelny dla anon i authenticated przez Data API.
--
-- Poprawka ma DWIE połowy i ten plik przybija obie, bo każda osobno jest zła:
--
--   * samo `AND is_visible` w polityce zamienia wyciek brudnopisu na regresję
--     funkcjonalną - RLS zawęża WIERSZE, więc wiersz sekcji ukrytej znika,
--     a `sectionState()` czyta BRAK wiersza jako "pokaż" (i musi tak czytać:
--     świeża instalacja ma pustą tabelę i nie może dać pustej strony);
--   * dlatego publiczną powierzchnią jest widok `career_page_sections_public`
--     (DEFINER, wzorzec `author_profiles_public`): oddaje KOMPLET kluczy
--     najemcy wraz z flagą `is_visible`, ale nagłówki sekcji ukrytej tnie do
--     NULL. Sygnał "ukryj" przeżywa, brudnopis nie wychodzi.
--
-- Konwencje: plik samowystarczalny (BEGIN/plan/finish/ROLLBACK), wcielenia
-- przez SET LOCAL ROLE + request.jwt.claims, najemca publiczny rozstrzygany
-- z nagłówka x-tenant-host - jak w club_topics_tenant_isolation_test.sql.

BEGIN;
SELECT plan(19);

-- ── (1) Strukturalnie: polityka wreszcie zna przełącznik widoczności ────────
SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'career_page_sections'
      AND policyname = 'career_sections_public_read') ~ 'is_visible',
  'career_sections_public_read filtruje po is_visible (parytet z career_roles_public_read)'
);

SELECT ok(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'career_page_sections'
      AND policyname = 'career_sections_public_read') ~ 'public_tenant_id',
  'career_sections_public_read nie zgubiła przy tym wiązania z najemcą'
);

-- Kanarek regresji w drugą stronę: gdyby ktoś "uprościł" widok na
-- security_invoker, przestałby widzieć wiersze odcięte właśnie tą polityką
-- i sekcje ukryte wróciłyby na stronę (patrz nagłówek pliku).
SELECT ok(
  (SELECT array_to_string(reloptions, ',') FROM pg_class
    WHERE oid = 'public.career_page_sections_public'::regclass)
    ~ 'security_invoker=(off|false)',
  'widok career_page_sections_public jest DEFINER-owy - inaczej nie zobaczy sekcji ukrytych'
);

SELECT ok(
  (SELECT array_to_string(reloptions, ',') FROM pg_class
    WHERE oid = 'public.career_page_sections_public'::regclass)
    ~ 'security_barrier=(on|true)',
  'widok ma security_barrier (wzorzec author_profiles_public)'
);

SELECT ok(
  has_table_privilege('anon', 'public.career_page_sections_public', 'SELECT')
  AND has_table_privilege('authenticated', 'public.career_page_sections_public', 'SELECT'),
  'widok jest publiczną projekcją sekcji (grant SELECT dla obu ról klienckich)'
);

-- ── Seed: dwaj najemcy z domenami, redaktor w A, sekcja ukryta z brudnopisem ─
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('cf111111-1111-1111-1111-111111111111', 'sections-a', 'Sections A', 'sections-a.example'),
  ('cf222222-2222-2222-2222-222222222222', 'sections-b', 'Sections B', 'sections-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('cf000000-0000-0000-0000-000000000001', 'editor@sections-a.test'),
  ('cf000000-0000-0000-0000-000000000002', 'reader@sections-a.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('cf000000-0000-0000-0000-000000000001', 'editor@sections-a.test', 'Editor A',
   'cf111111-1111-1111-1111-111111111111'),
  ('cf000000-0000-0000-0000-000000000002', 'reader@sections-a.test', 'Reader A',
   'cf111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('cf000000-0000-0000-0000-000000000001', 'editor',
   'cf111111-1111-1111-1111-111111111111'),
  ('cf000000-0000-0000-0000-000000000002', 'user',
   'cf111111-1111-1111-1111-111111111111');

-- `benefits` to dokładnie ten wiersz z findingu: redakcja ZDJĘŁA sekcję ze
-- strony i trzyma w niej roboczy tekst na później.
INSERT INTO public.career_page_sections
  (tenant_id, key, is_visible, sort_order, title_pl, subtitle_pl) VALUES
  ('cf111111-1111-1111-1111-111111111111', 'hero',     true,  10,
   'Pracuj z nami', 'Zespół analityczny'),
  ('cf111111-1111-1111-1111-111111111111', 'benefits', false, 30,
   'BRUDNOPIS: benefity', 'Wersja robocza, nie publikować'),
  ('cf222222-2222-2222-2222-222222222222', 'hero',     true,  10,
   'Sekcja najemcy B', 'Nie dla czytelnika A');

-- ── (2) anon na domenie A: tabela bazowa nie oddaje już brudnopisu ──────────
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"sections-a.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections
    WHERE tenant_id = 'cf111111-1111-1111-1111-111111111111' AND key = 'benefits'),
  0,
  'anon NIE czyta z tabeli wiersza sekcji wyłączonej (sedno findingu)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections
    WHERE title_pl = 'BRUDNOPIS: benefity' OR subtitle_pl = 'Wersja robocza, nie publikować'),
  0,
  'roboczy nagłówek sekcji wyłączonej jest nieosiągalny przez tabelę'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections
    WHERE tenant_id = 'cf111111-1111-1111-1111-111111111111' AND key = 'hero'),
  1,
  'sekcja WŁĄCZONA nadal jest czytelna z tabeli (poprawka nie gasi strony)'
);

-- ── (3) anon na domenie A: widok niesie sygnał "ukryj" bez brudnopisu ───────
SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections_public),
  2,
  'widok oddaje KOMPLET sekcji najemcy A - także wyłączoną'
);

SELECT is(
  (SELECT is_visible FROM public.career_page_sections_public WHERE key = 'benefits'),
  false,
  'sekcja wyłączona przychodzi z is_visible = false - "brak wiersza" nie udaje "pokaż"'
);

SELECT ok(
  (SELECT title_pl IS NULL AND subtitle_pl IS NULL
     FROM public.career_page_sections_public WHERE key = 'benefits'),
  'nagłówki sekcji wyłączonej są ucięte do NULL także w widoku'
);

SELECT is(
  (SELECT title_pl FROM public.career_page_sections_public WHERE key = 'hero'),
  'Pracuj z nami',
  'nagłówek sekcji włączonej przechodzi przez widok bez zmian'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections_public
    WHERE title_pl = 'Sekcja najemcy B'),
  0,
  'widok jest związany z najemcą hosta - sekcje najemcy B nie wyciekają'
);

-- ── (4) anon na domenie B: symetria obu domen ───────────────────────────────
SELECT set_config('request.headers', '{"x-tenant-host":"sections-b.example"}', true);

SELECT is(
  (SELECT title_pl FROM public.career_page_sections_public WHERE key = 'hero'),
  'Sekcja najemcy B',
  'anon na domenie B czyta przez widok sekcje najemcy B'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections_public),
  1,
  'i wyłącznie je - najemca A nie przecieka w drugą stronę'
);

-- ── (5) Zalogowany BEZ roli redakcyjnej to nadal publiczność ────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"sections-a.example"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections
    WHERE tenant_id = 'cf111111-1111-1111-1111-111111111111' AND key = 'benefits'),
  0,
  'zwykły zalogowany też nie dostaje wiersza sekcji wyłączonej (polityka jest TO anon, authenticated)'
);

-- ── (6) Redakcja czyta brudnopis jak dotąd - panel musi działać ─────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT title_pl FROM public.career_page_sections
    WHERE tenant_id = 'cf111111-1111-1111-1111-111111111111' AND key = 'benefits'),
  'BRUDNOPIS: benefity',
  'redaktor tenanta czyta z tabeli sekcję wyłączoną RAZEM z brudnopisem (career_sections_staff_read)'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections
    WHERE tenant_id = 'cf111111-1111-1111-1111-111111111111'),
  2,
  'panel widzi komplet sekcji swojego tenanta - to on jest przedmiotem edycji'
);

SELECT is(
  (SELECT count(*)::int FROM public.career_page_sections
    WHERE tenant_id = 'cf222222-2222-2222-2222-222222222222'),
  0,
  'redaktor A nie sięga po sekcje najemcy B (career_sections_staff_read wiąże current_tenant_id())'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
