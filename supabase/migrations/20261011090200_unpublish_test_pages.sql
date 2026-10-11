-- ============================================================================
-- STRONY TESTOWE: ODPUBLIKOWANIE I `noindex` (wszyscy najemcy)
-- ============================================================================
--
-- PRZYCZYNA (2026-10 audyt SEO). Opublikowane i indeksowalne strony
-- `/test-e2e-zakup`, `/test-e2e-zakup-2` oraz poddrzewo `/test/...` trafialy
-- do `sitemaps/pages.xml`, llms.txt i podpowiedzi wyszukiwarki. To artefakty
-- testow e2e (zasiew stron wydarzenia - patrz 20261011090100) i stron proby,
-- ktore nikt nie zdjal z publikacji.
--
-- CO ROBI. Strona (nieusunieta), ktorej slug ALBO slug przodka pasuje do
-- `^(test|e2e)($|[-_])` (`TEST_CONTENT_SLUG_PATTERN`, `src/lib/seo/testContent.ts`),
-- przechodzi z `published`/`scheduled` do `draft` i dostaje `seo_noindex = true`;
-- szkic i archiwum dostaja tylko `noindex`. Zejscie z harmonogramu czysci
-- `publish_at` (ta sama regula co w `updatePage`). Przekierowan NIE zakladamy:
-- adres testowy ma zniknac z sieci (404), a nie przekazac komus moc linkow.
-- Wzorzec lapie CALY pierwszy czlon slugu, wiec `testament` czy `testy-nato`
-- zostaja nietkniete.
--
-- WYZWALACZ `pages_workflow_guard` (`enforce_post_workflow`) NIE BLOKUJE tej
-- zmiany: przy `auth.uid() IS NULL` (migracja, cron) oddaje wiersz bez bramki,
-- a i tak pilnuje wylacznie WEJSCIA w `published`/`scheduled`, nie zejscia.
-- `pages_validate_takeaways_trg` odpala sie tylko na zmiane kolumn wnioskow.
--
-- Logika stoi w funkcji (`_pages_unpublish_test_content`), zeby pgTAP mogl
-- sprawdzic DOKLADNIE to, co wykonuje migracja, i zeby dalo sie ja powtorzyc
-- (idempotentna). Nowe strony testowe pilnuje aplikacja: `updatePage`
-- i `bulkUpdatePages` wymuszaja `noindex` przy publikacji, a warstwy publiczne
-- (meta robots, mapy, llms.txt, podpowiedzi) wykluczaja je niezaleznie od flagi.

CREATE OR REPLACE FUNCTION public._pages_unpublish_test_content()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  WITH RECURSIVE test_tree AS (
    -- Korzen moze byc w koszu - jego nieusuniete potomstwo nadal jest testowe.
    SELECT p.id, p.tenant_id, 0 AS depth
      FROM public.pages p
     WHERE p.slug ~* '^(test|e2e)($|[-_])'
    UNION
    SELECT c.id, c.tenant_id, t.depth + 1
      FROM public.pages c
      JOIN test_tree t ON c.parent_id = t.id AND c.tenant_id = t.tenant_id
     WHERE t.depth < 50
  )
  UPDATE public.pages p
     SET status = CASE
                    WHEN p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
                      THEN 'draft'::public.post_status
                    ELSE p.status
                  END,
         publish_at = CASE
                        WHEN p.status = 'scheduled'::public.post_status THEN NULL
                        ELSE p.publish_at
                      END,
         seo_noindex = true
   WHERE p.id IN (SELECT t.id FROM test_tree t)
     AND p.deleted_at IS NULL
     AND (
       p.status IN ('published'::public.post_status, 'scheduled'::public.post_status)
       OR p.seo_noindex IS DISTINCT FROM true
     );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public._pages_unpublish_test_content() IS
  'Odpublikowuje strony testowe (slug strony albo przodka pasuje do ^(test|e2e)($|[-_])) we wszystkich najemcach: published/scheduled -> draft, seo_noindex = true. Idempotentna. Zwraca liczbe zmienionych stron. Pomocnik wewnetrzny (migracja 20261011090200).';

REVOKE ALL ON FUNCTION public._pages_unpublish_test_content() FROM PUBLIC, anon, authenticated;

SELECT public._pages_unpublish_test_content();
