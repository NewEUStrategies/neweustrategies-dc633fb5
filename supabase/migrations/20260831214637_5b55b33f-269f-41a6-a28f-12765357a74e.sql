-- BLIZNIAK TRESCI: 20260831160000_page_full_path_tenant_scope.sql
--
-- TEN PLIK NIE WNOSI ZMIANY. Pipeline wdrozeniowy wydal go ponownie przy
-- wdrozeniu PR #312 (commit `1759be2`, 2026-08-31 21:50:45) i przy okazji zdjal
-- WSZYSTKIE 125 linii komentarza z pliku z PR-a (215 -> 85 linii). Tresc wykonywana
-- jest identyczna po odjeciu komentarzy - md5 okrojonej tresci `9df21f7097e4` po obu
-- stronach pary.
--
-- UWAGA NA DATOWANIE: wersja w nazwie tego pliku (20260831214637) to chwila
-- ZASTOSOWANIA przez pipeline, a NIE chwila wejscia zmiany. Zmiana weszla
-- z wersja 20260831160000, czyli 5 h 46 min wczesniej. Kto datuje regresje po
-- katalogu migracji albo po `schema_migrations` - a przy commitach nazwanych
-- „Changes" to jedyne narzedzie, jakie zostaje - trafia najpierw tutaj.
--
-- GDZIE LEZY UZASADNIENIE: w pliku wskazanym w naglowku wyzej. Sa tam: sciezka
-- wycieku (wolanie spod service-role z `src/lib/server/sitemapEntries.server.ts`),
-- powod, dla ktorego polityki tego nie domykaja, oraz mechanizm idempotentnosci
-- obu ograniczen. Tu tego nie ma i nie bedzie - duplikowanie argumentu w dwoch
-- plikach konczy sie tym, ze rozjezdzaja sie po cichu.
--
-- DLACZEGO PLIK ZOSTAJE, ZAMIAST ZOSTAC SKASOWANY: wersja 20260831214637 siedzi
-- w `schema_migrations` na wdrozonej bazie, a `supabase/migration-ledger.json`
-- (sekcja `reconciled`) mapuje na nia plik z PR-a. Usuniecie duplikatu
-- zostawiloby wiersz rejestru bez pliku i wywrocilo kolejny `db push`. Para jest
-- zarejestrowana jako dlug w `KNOWN_CONTENT_TWINS` (`src/lib/ci/migrationReplay.ts`).

CREATE OR REPLACE FUNCTION public.page_full_path(_page_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, slug, tenant_id, 1 AS depth
      FROM public.pages
     WHERE id = _page_id
    UNION ALL
    SELECT p.id, p.parent_id, p.slug, p.tenant_id, c.depth + 1
      FROM public.pages p
      JOIN chain c ON p.id = c.parent_id
     WHERE c.depth < 50
       AND p.tenant_id = c.tenant_id
  )
  SELECT string_agg(slug, '/' ORDER BY depth DESC) FROM chain;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_path(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.page_full_paths(_page_ids uuid[])
RETURNS TABLE(page_id uuid, full_path text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE requested AS (
    SELECT DISTINCT unnest(_page_ids) AS root_id
  ),
  chain AS (
    SELECT r.root_id, p.id, p.parent_id, p.slug, p.tenant_id, 1 AS depth
      FROM requested r
      JOIN public.pages p ON p.id = r.root_id
    UNION ALL
    SELECT c.root_id, p.id, p.parent_id, p.slug, p.tenant_id, c.depth + 1
      FROM public.pages p
      JOIN chain c ON p.id = c.parent_id
     WHERE c.depth < 50
       AND p.tenant_id = c.tenant_id
  )
  SELECT root_id AS page_id, string_agg(slug, '/' ORDER BY depth DESC) AS full_path
    FROM chain
    GROUP BY root_id;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_paths(uuid[]) TO anon, authenticated, service_role;

DO $$ BEGIN
  ALTER TABLE public.pages ADD CONSTRAINT pages_id_tenant_id_key UNIQUE (id, tenant_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

DO $$
DECLARE
  v_fixed int;
BEGIN
  WITH bad AS (
    SELECT c.id
      FROM public.pages c
      JOIN public.pages p ON p.id = c.parent_id
     WHERE c.parent_id IS NOT NULL
       AND p.tenant_id <> c.tenant_id
  )
  UPDATE public.pages
     SET parent_id = NULL
   WHERE id IN (SELECT id FROM bad);
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  IF v_fixed > 0 THEN
    RAISE NOTICE 'page_full_path tenant scope: odczepiono % stron od rodzica u obcego najemcy', v_fixed;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.pages
    ADD CONSTRAINT pages_parent_same_tenant_fkey
    FOREIGN KEY (parent_id, tenant_id)
    REFERENCES public.pages (id, tenant_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON CONSTRAINT pages_parent_same_tenant_fkey ON public.pages IS
  'Strona-rodzic musi nalezec do tego samego najemcy. Domyka izolacje kanonicznej sciezki (public.page_full_path / page_full_paths).';