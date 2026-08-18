-- ============================================================================
-- Bezpieczeństwo: publiczny odczyt `career_page_sections` respektuje przełącznik
-- widoczności (`is_visible`), a treść sekcji wyłączonej przestaje wyciekać.
--
-- Finding: polityka `career_sections_public_read` (20260814100000, powtórzona
-- w 20260814122639) filtruje WYŁĄCZNIE po najemcy:
--
--     USING (tenant_id = public.public_tenant_id())
--
-- Bliźniacza polityka na `career_roles` z tej samej migracji wiąże publiczny
-- odczyt z flagą publikacji (`is_published AND tenant_id = ...`), więc brak
-- `is_visible` po stronie sekcji jest przeoczeniem, nie decyzją. Skutek: sekcja
-- wyłączona w panelu (`/admin/hiring`, zakładka "sekcje") znikała ze STRONY,
-- ale jej wiersz - razem z roboczymi nagłówkami `title_*` i `subtitle_*` -
-- pozostawał czytelny dla anon i authenticated przez Data API. Redakcyjny
-- brudnopis ("wyłączam sekcję, dopiszę treść później") był publiczny.
--
-- ── DLACZEGO SAMO `AND is_visible` TO ZA MAŁO ───────────────────────────────
-- RLS zawęża WIERSZE, nie kolumny, więc dociśnięcie polityki USUWA wiersz
-- sekcji ukrytej z odpowiedzi dla anona. A `sectionState()`
-- (src/lib/careers/catalog.ts) czyta BRAK wiersza jako "pokaż" - i musi tak
-- czytać, bo świeża instalacja ma pustą tabelę sekcji i nie może wyświetlić
-- pustej strony (bramka: src/lib/careers/__tests__/catalog.test.ts). Sama
-- poprawka polityki zamieniłaby więc wyciek brudnopisu na regresję
-- funkcjonalną: sekcja wyłączona przez redakcję WRACAŁABY na stronę (z treścią
-- z i18n zamiast z bazy). "Nie ma wiersza" i "wiersz mówi: ukryj" to dwa różne
-- stany i publiczny czytelnik musi je nadal rozróżniać.
--
-- Dlatego tabela bazowa przestaje być publicznym API strony /zatrudniamy,
-- a jej miejsce zajmuje wąska projekcja - wzorzec `author_profiles_public`
-- (20260724114239, dociśnięty w 20260730120000):
--
--   * widok `career_page_sections_public` oddaje anonowi KOMPLET sekcji
--     najemcy publicznego wraz z flagą `is_visible` (sygnał "ukryj" przeżywa),
--     ale nagłówki sekcji ukrytej tnie na NULL - brudnopis nie wychodzi;
--   * widok jest DEFINER-owy (`security_invoker = off`) + `security_barrier`,
--     bo musi widzieć wiersze, które dociśnięta polityka właśnie odcięła;
--     predykat najemcy jest w ciele widoku, dokładnie jak w bliźniaku.
--
-- Panel admina czyta dalej TABELĘ (polityka `career_sections_staff_read`,
-- bez zmian) - operator ma widzieć brudnopis, na tym polega jego praca.
--
-- Testy: supabase/tests/career_sections_visibility_public_read_test.sql.
-- ============================================================================

-- ---------- 1) Polityka: przełącznik widoczności wreszcie coś znaczy ---------
-- Parytet z `career_roles_public_read` (`is_published AND tenant_id = ...`).
DROP POLICY IF EXISTS career_sections_public_read ON public.career_page_sections;
CREATE POLICY career_sections_public_read ON public.career_page_sections
  FOR SELECT TO anon, authenticated
  USING (is_visible AND tenant_id = public.public_tenant_id());

-- ---------- 2) Publiczna projekcja: flaga widoczna, brudnopis nie -----------
-- CREATE OR REPLACE nie umie zmienić listy kolumn, więc replay idzie przez
-- DROP + CREATE (ten sam powód, co przy przebudowie `author_profiles_public`).
DROP VIEW IF EXISTS public.career_page_sections_public;

CREATE VIEW public.career_page_sections_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  s.key,
  s.is_visible,
  s.sort_order,
  CASE WHEN s.is_visible THEN s.title_pl END    AS title_pl,
  CASE WHEN s.is_visible THEN s.title_en END    AS title_en,
  CASE WHEN s.is_visible THEN s.subtitle_pl END AS subtitle_pl,
  CASE WHEN s.is_visible THEN s.subtitle_en END AS subtitle_en
FROM public.career_page_sections s
WHERE s.tenant_id = public.public_tenant_id();

GRANT SELECT ON public.career_page_sections_public TO anon, authenticated;

COMMENT ON VIEW public.career_page_sections_public IS
  'Publiczna projekcja sekcji strony /zatrudniamy: komplet kluczy najemcy z nagłówka x-tenant-host wraz z flagą is_visible, ale nagłówki sekcji ukrytej ucięte do NULL. Istnieje, bo RLS zawęża wiersze, a strona musi odróżniać "brak wiersza" (świeża instalacja - pokaż) od "wiersz mówi: ukryj".';
