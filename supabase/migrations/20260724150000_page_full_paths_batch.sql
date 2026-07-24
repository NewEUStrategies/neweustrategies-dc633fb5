-- Batch wariant page_full_path: rezolucja pelnych sciezek WIELU stron jednym
-- wywolaniem RPC. Archiwa (kategoria/tag) i wyszukiwarka hydratowaly href
-- wpisow jednym wywolaniem `page_full_path` NA KAZDY unikalny parent_page_id
-- (klasyczny N+1, do ~60 round-tripow HTTP na strone wynikow). Ta funkcja
-- sklada te same sciezki jednym rekurencyjnym CTE dla calego zbioru id.
--
-- Semantyka sciezki identyczna z public.page_full_path (segmenty slug od
-- korzenia, separator '/', limit glebokosci 50). SECURITY INVOKER: RLS na
-- public.pages obowiazuje jak przy wywolaniach per-id, wiec funkcja nie
-- ujawnia nic ponad to, co wolajacy i tak by odczytal.

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
    SELECT r.root_id, p.id, p.parent_id, p.slug, 1 AS depth
      FROM requested r
      JOIN public.pages p ON p.id = r.root_id
    UNION ALL
    SELECT c.root_id, p.id, p.parent_id, p.slug, c.depth + 1
      FROM public.pages p
      JOIN chain c ON p.id = c.parent_id
      WHERE c.depth < 50
  )
  SELECT root_id AS page_id, string_agg(slug, '/' ORDER BY depth DESC) AS full_path
    FROM chain
    GROUP BY root_id;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_paths(uuid[]) TO anon, authenticated, service_role;
