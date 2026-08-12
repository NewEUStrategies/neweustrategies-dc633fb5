-- ============================================================================
-- FINDING (audyt modulu 17): `related_posts_signals/2` (20260716212125) brala
-- najemce z PARAMETRU `_tenant` podanego przez klienta, a autoryzowala wylacznie
-- role (`has_role(auth.uid(), 'admin')`).
--
-- `has_role` jest zakresowany najemca DOMOWYM wolajacego, wiec admin najemcy A
-- przechodzil bramke roli WE WLASNYM obszarze, a nastepnie podawal `_tenant`
-- najemcy B i dostawal komplet analityki tresci B: liste wpisow z tytulami,
-- popularnosc (odslony i unikalni czytelnicy), pary klikniec rekomendacji oraz
-- ranking hubow. Funkcja jest SECURITY DEFINER, wiec RLS na `posts`,
-- `post_views`, `related_post_clicks` i `user_read_history` tego nie
-- zatrzymywala, a wywolanie idzie prosto z `supabase.rpc()` - do
-- przeprowadzenia ataku wystarczylo podmienic jeden uuid w zapytaniu. Snapshot
-- autoryzacji raportowal te bramke jako `tenantRef: "row"`.
--
-- Poprawka usuwa parametr i bierze najemce z serwerowego zrodla prawdy:
-- `assert_admin_tenant()` (20260713190000) sprawdza role admina i zwraca
-- `profiles.tenant_id` wolajacego - tak jak reszta analityki adminowej
-- (`admin_member_funnel`, `admin_member_retention`,
-- `admin_member_activity_series`). Brak roli albo brak najemcy w profilu konczy
-- sie wyjatkiem, wiec bramka jest fail-closed, i najemcy nie da sie juz podac
-- z zewnatrz. Autoryzacja przenosi sie w calosci do helpera, dlatego jawny
-- `has_role` z ciala znika.
--
-- Zmiana sygnatury (2 -> 1 argument) wymaga DROP-a starego przeciazenia: bez
-- niego `CREATE OR REPLACE` zostawilby obok dzialajacy wariant `(uuid, integer)`,
-- czyli podatna sciezke nadal otwarta dla klienta. DROP i CREATE stoja w tym
-- samym pliku, wiec dla `check:rpc-contract` wygrywa CREATE (wzorzec repo, patrz
-- 20260811150000).
--
-- Regresje pilnuje `supabase/tests/related_posts_signals_tenant_scope_test.sql`.
-- ============================================================================

DROP FUNCTION IF EXISTS public.related_posts_signals(uuid, integer);

CREATE OR REPLACE FUNCTION public.related_posts_signals(
  _since_days integer DEFAULT 28
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Autoryzacja i zakres najemcy w jednym: rola admina + `profiles.tenant_id`
  -- wolajacego. Wyjatek z helpera przerywa funkcje przed pierwszym odczytem.
  _tenant uuid := public.assert_admin_tenant();
  _since timestamptz := now() - make_interval(days => GREATEST(1, _since_days));
  _result jsonb;
  _top_cats jsonb;
  _top_tags jsonb;
  _co_tags jsonb;
  _popularity jsonb;
  _click_pairs jsonb;
  _hub_targets jsonb;
  _summary jsonb;
BEGIN
  -- Top kategorie (liczba wpisów w tenancie)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.posts_count DESC), '[]'::jsonb) INTO _top_cats
  FROM (
    SELECT c.id AS category_id,
           COALESCE(c.name_pl, c.name_en, c.slug) AS name,
           COUNT(pc.post_id)::int AS posts_count
    FROM public.categories c
    LEFT JOIN public.post_categories pc ON pc.category_id = c.id
    LEFT JOIN public.posts p ON p.id = pc.post_id
      AND p.tenant_id = _tenant
      AND p.status = 'published'::post_status
      AND p.deleted_at IS NULL
    WHERE c.tenant_id = _tenant
    GROUP BY c.id, c.name_pl, c.name_en, c.slug
    ORDER BY posts_count DESC
    LIMIT 40
  ) t;

  -- Top tagi
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.posts_count DESC), '[]'::jsonb) INTO _top_tags
  FROM (
    SELECT tg.id AS tag_id,
           COALESCE(tg.name, tg.slug) AS name,
           COUNT(pt.post_id)::int AS posts_count
    FROM public.tags tg
    LEFT JOIN public.post_tags pt ON pt.tag_id = tg.id
    LEFT JOIN public.posts p ON p.id = pt.post_id
      AND p.tenant_id = _tenant
      AND p.status = 'published'::post_status
      AND p.deleted_at IS NULL
    WHERE tg.tenant_id = _tenant
    GROUP BY tg.id, tg.name, tg.slug
    ORDER BY posts_count DESC
    LIMIT 40
  ) t;

  -- Macierz współwystępowania top-25 tagów
  WITH top_tag AS (
    SELECT tg.id
    FROM public.tags tg
    JOIN public.post_tags pt ON pt.tag_id = tg.id
    JOIN public.posts p ON p.id = pt.post_id
      AND p.tenant_id = _tenant
      AND p.status = 'published'::post_status
      AND p.deleted_at IS NULL
    WHERE tg.tenant_id = _tenant
    GROUP BY tg.id
    ORDER BY COUNT(*) DESC
    LIMIT 25
  ),
  pairs AS (
    SELECT a.tag_id AS a, b.tag_id AS b, COUNT(*)::int AS c
    FROM public.post_tags a
    JOIN public.post_tags b ON a.post_id = b.post_id AND a.tag_id < b.tag_id
    JOIN public.posts p ON p.id = a.post_id
      AND p.tenant_id = _tenant
      AND p.status = 'published'::post_status
      AND p.deleted_at IS NULL
    WHERE a.tag_id IN (SELECT id FROM top_tag)
      AND b.tag_id IN (SELECT id FROM top_tag)
    GROUP BY a.tag_id, b.tag_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(pairs) ORDER BY c DESC), '[]'::jsonb) INTO _co_tags FROM pairs;

  -- Popularność top-40 wpisów w oknie (post_views)
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.views DESC), '[]'::jsonb) INTO _popularity
  FROM (
    SELECT p.id AS post_id,
           COALESCE(p.title_pl, p.title_en) AS title,
           COUNT(pv.id)::int AS views,
           COUNT(DISTINCT pv.viewer_hash)::int AS uniques
    FROM public.posts p
    LEFT JOIN public.post_views pv
      ON pv.post_id = p.id
     AND pv.tenant_id = _tenant
     AND pv.viewed_at >= _since
    WHERE p.tenant_id = _tenant
      AND p.status = 'published'::post_status
      AND p.deleted_at IS NULL
    GROUP BY p.id, p.title_pl, p.title_en
    HAVING COUNT(pv.id) > 0
    ORDER BY views DESC
    LIMIT 40
  ) t;

  -- Pary "źródło -> cel" z klików
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.clicks DESC), '[]'::jsonb) INTO _click_pairs
  FROM (
    SELECT rc.source_post_id,
           rc.target_post_id,
           COALESCE(ps.title_pl, ps.title_en) AS source_title,
           COALESCE(pt.title_pl, pt.title_en) AS target_title,
           COUNT(*)::int AS clicks
    FROM public.related_post_clicks rc
    JOIN public.posts ps ON ps.id = rc.source_post_id
    JOIN public.posts pt ON pt.id = rc.target_post_id
    WHERE rc.tenant_id = _tenant
      AND rc.clicked_at >= _since
    GROUP BY rc.source_post_id, rc.target_post_id, ps.title_pl, ps.title_en, pt.title_pl, pt.title_en
    ORDER BY clicks DESC
    LIMIT 60
  ) t;

  -- Ranking "hub-postów" - najczęściej klikane jako cel
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.clicks DESC), '[]'::jsonb) INTO _hub_targets
  FROM (
    SELECT rc.target_post_id AS post_id,
           COALESCE(p.title_pl, p.title_en) AS title,
           COUNT(*)::int AS clicks,
           COUNT(DISTINCT rc.source_post_id)::int AS sources
    FROM public.related_post_clicks rc
    JOIN public.posts p ON p.id = rc.target_post_id
    WHERE rc.tenant_id = _tenant
      AND rc.clicked_at >= _since
    GROUP BY rc.target_post_id, p.title_pl, p.title_en
    ORDER BY clicks DESC
    LIMIT 20
  ) t;

  -- Podsumowanie
  SELECT jsonb_build_object(
    'total_posts', (
      SELECT COUNT(*) FROM public.posts p
      WHERE p.tenant_id = _tenant
        AND p.status = 'published'::post_status
        AND p.deleted_at IS NULL
    ),
    'total_views', (
      SELECT COUNT(*) FROM public.post_views pv
      WHERE pv.tenant_id = _tenant AND pv.viewed_at >= _since
    ),
    'total_clicks', (
      SELECT COUNT(*) FROM public.related_post_clicks rc
      WHERE rc.tenant_id = _tenant AND rc.clicked_at >= _since
    ),
    'total_reads', (
      SELECT COUNT(*) FROM public.user_read_history urh
      WHERE urh.tenant_id = _tenant AND urh.read_at >= _since
    ),
    'window_days', _since_days
  ) INTO _summary;

  _result := jsonb_build_object(
    'summary', _summary,
    'top_categories', _top_cats,
    'top_tags', _top_tags,
    'tag_cooccurrence', _co_tags,
    'popularity', _popularity,
    'click_pairs', _click_pairs,
    'hub_targets', _hub_targets
  );

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.related_posts_signals(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.related_posts_signals(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.related_posts_signals(integer) TO authenticated;

COMMENT ON FUNCTION public.related_posts_signals(integer) IS
  'Analityka silnika rekomendacji dla panelu admina. Najemca pochodzi z assert_admin_tenant() (rola admina + profiles.tenant_id wolajacego), nie z parametru - admin czyta wylacznie wlasny obszar roboczy.';