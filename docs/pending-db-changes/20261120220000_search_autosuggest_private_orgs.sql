-- ============================================================================
-- PODPOWIEDZI WYSZUKIWARKI BEZ FIRM CZŁONKOWSKICH (2026-11-20).
--
-- STAN PRZED: `search_autosuggest(text, int)` (SECURITY DEFINER, EXECUTE dla
-- `anon` i `authenticated`) zwracał - obok kategorii, autorów, wpisów i stron -
-- nazwy i slugi `member_organizations` (klienci B2B z abonamentem). RLS tej
-- tabeli wpuszcza tylko administratora najemcy i posiadacza miejsca, więc
-- funkcja ujawniała gościom listę firm, której nie wolno im czytać. Gałąź
-- stron nie sprawdzała też `deleted_at`, więc tytuły usuniętych stron
-- opublikowanych wciąż wracały w podpowiedziach.
--
-- ZMIANA:
--   1. Gałąź 'company' (member_organizations) usunięta. Klient (`facetModel`)
--      nadal obsługuje ten rodzaj, więc brak wierszy nie zmienia kontraktu.
--      Publiczne organizacje wracają przez `search_people_orgs` (kategorie
--      `kind = 'organization'`).
--   2. Strony: dodany warunek `deleted_at IS NULL` (parytet z polityką
--      "Public reads published pages" i gałęzią wpisów).
--   3. `admin_event_lead_scans_export(uuid, uuid)`: odebrany EXECUTE dla
--      PUBLIC/`anon` (funkcja i tak odrzuca gościa w
--      `assert_event_admin_tenant`; to porządek grantów, nie zmiana zachowania).
--
-- Idempotentna: CREATE OR REPLACE + jawne GRANT/REVOKE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_autosuggest(_q text, _limit integer DEFAULT 8)
 RETURNS TABLE(kind text, id uuid, slug text, label_pl text, label_en text, parent_page_id uuid, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  nq AS (
    SELECT
      unaccent(lower(btrim(coalesce(_q, '')))) AS q,
      length(unaccent(lower(btrim(coalesce(_q, ''))))) AS qlen
  ),
  scored AS (
    SELECT
      coalesce(c.kind, 'category')::text AS kind,
      c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
      NULL::uuid AS parent_page_id,
      public._suggest_score(nq.q, c.name_pl, c.name_en) AS score
    FROM public.categories c, ctx, nq
    WHERE nq.qlen >= 2 AND c.tenant_id = ctx.tid

    UNION ALL
    SELECT 'author'::text, pr.id, pr.slug,
      coalesce(pr.display_name, 'Autor'),
      coalesce(pr.display_name, 'Author'),
      NULL::uuid,
      public._suggest_score(nq.q, pr.display_name, pr.display_name)
    FROM public.profiles pr, ctx, nq
    WHERE nq.qlen >= 2
      AND pr.discoverable = true
      AND pr.tenant_id = ctx.tid

    UNION ALL
    SELECT 'post'::text, p.id, p.slug, p.title_pl, p.title_en, p.parent_page_id,
      public._suggest_score(nq.q, p.title_pl, p.title_en)
    FROM public.posts p, ctx, nq
    WHERE nq.qlen >= 2
      AND p.tenant_id = ctx.tid
      AND p.status = 'published'
      AND p.deleted_at IS NULL

    UNION ALL
    SELECT 'page'::text, pg.id, pg.slug,
      coalesce(pg.title_pl, pg.title_en, pg.slug),
      coalesce(pg.title_en, pg.title_pl, pg.slug),
      NULL::uuid,
      public._suggest_score(nq.q, pg.title_pl, pg.title_en)
    FROM public.pages pg, ctx, nq
    WHERE nq.qlen >= 2
      AND pg.tenant_id = ctx.tid
      AND pg.status = 'published'
      AND pg.deleted_at IS NULL
  )
  SELECT kind, id, slug, label_pl, label_en, parent_page_id, score::real
  FROM scored
  WHERE score > 0
  ORDER BY score DESC, label_pl
  LIMIT GREATEST(LEAST(_limit, 20), 1);
$function$;

REVOKE ALL ON FUNCTION public.search_autosuggest(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_autosuggest(text, integer) TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_event_lead_scans_export(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_event_lead_scans_export(uuid, uuid) TO authenticated, service_role;
