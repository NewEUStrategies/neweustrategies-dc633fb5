-- PR #53: 4 zaległe migracje (chat search, saved search alerts, multi-select facets v6, semantic pgvector)

-- ============ 1. Chat message search (20260720160000) ============
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION public.nes_messages_search_vector()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.body, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.attachment_name, ''))), 'B');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_search_vector ON public.messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF body, attachment_name ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.nes_messages_search_vector();

UPDATE public.messages
   SET search_vector =
         setweight(to_tsvector('simple', unaccent(coalesce(body, ''))), 'A') ||
         setweight(to_tsvector('simple', unaccent(coalesce(attachment_name, ''))), 'B')
 WHERE search_vector IS NULL
   AND (body IS NOT NULL OR attachment_name IS NOT NULL);

CREATE INDEX IF NOT EXISTS messages_search_vector_gin ON public.messages USING gin (search_vector);

CREATE OR REPLACE FUNCTION public.search_messages(
  _q text, _conversation_id uuid DEFAULT NULL,
  _limit integer DEFAULT 30, _offset integer DEFAULT 0
) RETURNS TABLE (
  id uuid, conversation_id uuid, sender_id uuid, kind text,
  snippet text, created_at timestamptz, rank real, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH tq AS (SELECT public.nes_search_tsquery(_q) AS q),
  hits AS (
    SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.body,
           m.attachment_name, m.created_at,
           ts_rank_cd(m.search_vector, tq.q)::real AS rank
      FROM public.messages m
      JOIN public.conversation_participants cp
        ON cp.conversation_id = m.conversation_id AND cp.user_id = auth.uid()
      CROSS JOIN tq
     WHERE auth.uid() IS NOT NULL AND tq.q IS NOT NULL
       AND m.search_vector @@ tq.q
       AND m.tenant_id = (SELECT public.current_tenant_id())
       AND m.deleted_at IS NULL
       AND (m.expires_at IS NULL OR m.expires_at > now())
       AND m.created_at >= coalesce(cp.cleared_before, '-infinity'::timestamptz)
       AND (_conversation_id IS NULL OR m.conversation_id = _conversation_id)
  )
  SELECT h.id, h.conversation_id, h.sender_id, h.kind,
         ts_headline('simple', left(coalesce(h.body, h.attachment_name, ''), 1000), tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=18, MinWords=8, ShortWord=2, MaxFragments=1') AS snippet,
         h.created_at, h.rank, (count(*) OVER ())::bigint AS total_count
    FROM hits h CROSS JOIN tq
   ORDER BY h.created_at DESC, h.id DESC
   LIMIT GREATEST(LEAST(coalesce(_limit, 30), 100), 1)
  OFFSET GREATEST(coalesce(_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) TO authenticated, service_role;

-- ============ 2. Saved search alerts (20260720170000) ============
ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS alert_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS url text,
  ADD COLUMN IF NOT EXISTS last_seen_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_alert_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_alert_check_at timestamptz;

CREATE INDEX IF NOT EXISTS saved_searches_alert_enabled_idx
  ON public.saved_searches (last_alert_check_at) WHERE alert_enabled;

CREATE OR REPLACE FUNCTION public.saved_searches_alert_defaults()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.alert_enabled AND (TG_OP = 'INSERT' OR NOT OLD.alert_enabled)
     AND NEW.last_seen_published_at IS NULL THEN
    NEW.last_seen_published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saved_searches_alert_defaults ON public.saved_searches;
CREATE TRIGGER trg_saved_searches_alert_defaults
  BEFORE INSERT OR UPDATE OF alert_enabled ON public.saved_searches
  FOR EACH ROW EXECUTE FUNCTION public.saved_searches_alert_defaults();

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS enabled_saved_search boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('system','comment','follow','subscription','content',
                  'security','message','tracker','connection','saved_search')) NOT VALID;

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_user_id uuid, p_kind text, p_title_pl text, p_title_en text,
  p_body_pl text DEFAULT NULL::text, p_body_en text DEFAULT NULL::text,
  p_href text DEFAULT NULL::text, p_icon text DEFAULT NULL::text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_tenant uuid; v_id uuid; v_enabled boolean;
BEGIN
  IF p_user_id IS NULL OR p_kind IS NULL OR btrim(p_kind) = '' THEN RETURN NULL; END IF;
  IF p_kind <> 'security' THEN
    SELECT CASE p_kind
             WHEN 'message'      THEN np.enabled_message
             WHEN 'comment'      THEN np.enabled_comment
             WHEN 'follow'       THEN np.enabled_follow
             WHEN 'subscription' THEN np.enabled_subscription
             WHEN 'content'      THEN np.enabled_content
             WHEN 'system'       THEN np.enabled_system
             WHEN 'tracker'      THEN np.enabled_tracker
             WHEN 'connection'   THEN np.enabled_connection
             WHEN 'saved_search' THEN np.enabled_saved_search
             ELSE true END
      INTO v_enabled FROM public.notification_preferences np WHERE np.user_id = p_user_id;
    IF v_enabled IS FALSE THEN RETURN NULL; END IF;
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_tenant IS NULL THEN
    v_tenant := COALESCE(public.public_tenant_id(), public.current_tenant_id());
  END IF;
  IF v_tenant IS NULL THEN
    SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications n
    WHERE n.user_id = p_user_id AND n.kind = p_kind
      AND COALESCE(n.href, '') = COALESCE(p_href, '')
      AND n.created_at > now() - interval '5 minutes') THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (
    user_id, tenant_id, kind, title_pl, title_en, body_pl, body_en, href, icon
  ) VALUES (
    p_user_id, v_tenant, p_kind,
    COALESCE(NULLIF(btrim(p_title_pl), ''), NULLIF(btrim(p_title_en), ''), p_kind),
    NULLIF(btrim(p_title_en), ''),
    NULLIF(btrim(p_body_pl), ''),
    NULLIF(btrim(p_body_en), ''),
    NULLIF(btrim(p_href), ''),
    NULLIF(btrim(p_icon), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nes_post_matches_term_group(
  p_post_id uuid, p_group_csv text
) RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  WITH RECURSIVE req AS (
    SELECT btrim(x)::uuid AS term_id
      FROM unnest(string_to_array(coalesce(p_group_csv, ''), ',')) AS x
     WHERE btrim(x) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  tree AS (
    SELECT r.term_id AS match_id, 0 AS depth FROM req r
    UNION ALL
    SELECT c.id, t.depth + 1
      FROM public.categories c
      JOIN tree t ON c.parent_id = t.match_id
     WHERE t.depth < 10
  )
  SELECT NOT EXISTS (SELECT 1 FROM req)
      OR EXISTS (
           SELECT 1 FROM public.post_categories pc
             JOIN tree t ON t.match_id = pc.category_id
            WHERE pc.post_id = p_post_id);
$$;

CREATE OR REPLACE FUNCTION public.run_saved_search_alerts(p_max_searches integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  s record; v_q text; v_match text; v_scope text; v_tq tsquery;
  v_author uuid; v_format text; v_lang text; v_access text;
  v_from timestamptz; v_to timestamptz; v_year text;
  v_count bigint; v_max_pub timestamptz;
  v_href text; v_body_pl text; v_body_en text; v_sent integer := 0;
BEGIN
  FOR s IN
    SELECT ss.id, ss.user_id, ss.tenant_id, ss.name, ss.params, ss.url,
           coalesce(ss.last_seen_published_at, ss.created_at) AS watermark
      FROM public.saved_searches ss
     WHERE ss.alert_enabled
     ORDER BY coalesce(ss.last_alert_check_at, to_timestamp(0)) ASC
     LIMIT GREATEST(LEAST(coalesce(p_max_searches, 200), 1000), 1)
  LOOP
    BEGIN
      v_q := nullif(btrim(coalesce(s.params->>'q', '')), '');
      v_match := coalesce(nullif(s.params->>'match', ''), 'all');
      v_scope := coalesce(nullif(s.params->>'scope', ''),
                          CASE WHEN s.params->>'tab' = 'titles' THEN 'title' ELSE 'all' END);
      v_tq := CASE WHEN v_q IS NULL THEN NULL
                   ELSE public.nes_search_tsquery_adv(v_q, v_match) END;
      v_author := CASE
        WHEN coalesce(s.params->>'author', '')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (s.params->>'author')::uuid END;
      v_format := nullif(s.params->>'format', '');
      v_lang := nullif(s.params->>'lang', '');
      v_access := nullif(s.params->>'access', '');
      v_year := nullif(s.params->>'year', '');
      v_from := CASE WHEN nullif(s.params->>'from', '') IS NOT NULL
                     THEN (s.params->>'from')::timestamptz END;
      v_to := CASE WHEN nullif(s.params->>'to', '') IS NOT NULL
                   THEN (s.params->>'to')::timestamptz END;
      IF v_year ~ '^[0-9]{4}$' AND v_from IS NULL AND v_to IS NULL THEN
        v_from := (v_year || '-01-01')::timestamptz;
        v_to := (v_year || '-12-31')::timestamptz;
      END IF;

      SELECT count(*), max(p.published_at) INTO v_count, v_max_pub
        FROM public.posts p
        LEFT JOIN public.content_access ca
          ON ca.entity_type = 'post' AND ca.entity_id = p.id
       WHERE p.tenant_id = s.tenant_id
         AND p.status = 'published' AND p.deleted_at IS NULL
         AND p.published_at > s.watermark AND p.published_at <= now()
         AND (v_tq IS NULL OR p.search_vector @@ v_tq)
         AND (v_tq IS NULL OR v_scope IS DISTINCT FROM 'title'
              OR to_tsvector('simple', unaccent(
                   coalesce(p.title_pl, '') || ' ' || coalesce(p.title_en, ''))) @@ v_tq)
         AND (v_author IS NULL OR p.author_id = v_author)
         AND (v_format IS NULL OR p.post_format = v_format)
         AND (v_lang IS NULL
              OR (v_lang = 'pl' AND btrim(p.title_pl) <> '')
              OR (v_lang = 'en' AND btrim(p.title_en) <> ''))
         AND (v_access IS NULL OR coalesce(ca.mode::text, 'public') = v_access)
         AND (v_from IS NULL OR p.published_at >= v_from)
         AND (v_to IS NULL OR p.published_at <= v_to)
         AND public.nes_post_matches_term_group(p.id, s.params->>'spec')
         AND public.nes_post_matches_term_group(p.id, s.params->>'type')
         AND public.nes_post_matches_term_group(p.id, s.params->>'region')
         AND public.nes_post_matches_term_group(p.id, s.params->>'topic')
         AND public.nes_post_matches_term_group(p.id, s.params->>'project')
         AND public.nes_post_matches_term_group(p.id, s.params->>'series')
         AND public.nes_post_matches_term_group(p.id, s.params->>'org');

      UPDATE public.saved_searches SET last_alert_check_at = now() WHERE id = s.id;

      IF coalesce(v_count, 0) > 0 THEN
        v_href := coalesce(nullif(btrim(s.url), ''), '/search');
        v_body_pl := CASE
          WHEN v_count = 1 THEN '1 nowa publikacja dla zapisanego wyszukiwania'
          WHEN v_count % 10 BETWEEN 2 AND 4 AND v_count % 100 NOT BETWEEN 12 AND 14
            THEN v_count::text || ' nowe publikacje dla zapisanego wyszukiwania'
          ELSE v_count::text || ' nowych publikacji dla zapisanego wyszukiwania'
        END;
        v_body_en := CASE
          WHEN v_count = 1 THEN '1 new publication for your saved search'
          ELSE v_count::text || ' new publications for your saved search'
        END;
        PERFORM public.enqueue_notification(
          s.user_id, 'saved_search',
          'Nowe wyniki: ' || s.name,
          'New results: ' || s.name,
          v_body_pl, v_body_en, v_href, 'search');
        UPDATE public.saved_searches
           SET last_seen_published_at = greatest(coalesce(v_max_pub, now()), s.watermark),
               last_alert_at = now()
         WHERE id = s.id;
        v_sent := v_sent + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.saved_searches SET last_alert_check_at = now() WHERE id = s.id;
    END;
  END LOOP;
  RETURN v_sent;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.run_saved_search_alerts(integer) TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron not installed - saved-search-alerts not scheduled';
    RETURN;
  END IF;
  PERFORM cron.schedule('saved-search-alerts', '*/20 * * * *',
    'SELECT public.run_saved_search_alerts()');
END $$;

-- ============ 3. Search multi-select facets v6 (20260720180000) ============
DROP FUNCTION IF EXISTS public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text
);

CREATE FUNCTION public.search_posts(
  _q text DEFAULT NULL, _limit int DEFAULT 80, _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL, _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL, _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL, _lang text DEFAULT NULL, _access text DEFAULT NULL,
  _sort text DEFAULT 'relevance', _match text DEFAULT 'all', _in text DEFAULT 'all',
  _term_groups jsonb DEFAULT NULL
) RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text,
  excerpt_pl text, excerpt_en text, cover_image_url text,
  published_at timestamptz, parent_page_id uuid, author_id uuid, rank real,
  headline_pl text, headline_en text,
  post_format text, access_mode text, fuzzy boolean, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH RECURSIVE ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery_adv(_q, _match) AS q),
  nq AS (SELECT public.nes_search_positive_rest(_q) AS q),
  term_tree AS (
    SELECT t.term_id AS root, t.term_id AS match_id, 0 AS depth
      FROM unnest(coalesce(_terms, '{}'::uuid[])) AS t(term_id)
    UNION ALL
    SELECT tt.root, c.id, tt.depth + 1
      FROM public.categories c
      JOIN term_tree tt ON c.parent_id = tt.match_id
     WHERE tt.depth < 10
  ),
  base AS (
    SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
           p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
           p.post_format, p.search_vector,
           coalesce(ca.mode::text, 'public') AS eff_access
      FROM public.posts p
      JOIN ctx ON p.tenant_id = ctx.tid
      LEFT JOIN public.content_access ca
        ON ca.entity_type = 'post' AND ca.entity_id = p.id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
       AND (_author IS NULL OR p.author_id = _author)
       AND (_date_from IS NULL OR p.published_at >= _date_from)
       AND (_date_to IS NULL OR p.published_at <= _date_to)
       AND (_category IS NULL OR EXISTS (
             SELECT 1 FROM public.post_categories pc
              WHERE pc.post_id = p.id AND pc.category_id = _category))
       AND (_format IS NULL OR p.post_format = _format)
       AND (_lang IS NULL
            OR (_lang = 'pl' AND btrim(p.title_pl) <> '')
            OR (_lang = 'en' AND btrim(p.title_en) <> ''))
       AND (_access IS NULL OR coalesce(ca.mode::text, 'public') = _access)
       AND (_terms IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(_terms) AS req(term_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.post_categories pc
                JOIN term_tree tt
                  ON tt.match_id = pc.category_id AND tt.root = req.term_id
                WHERE pc.post_id = p.id)))
       AND (_term_groups IS NULL OR (
             public.nes_post_matches_term_group(p.id, _term_groups->>'category')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'pub_type')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'region')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'topic')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'project')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'series')
         AND public.nes_post_matches_term_group(p.id, _term_groups->>'organization')))
  ),
  fts AS (
    SELECT b.*, ts_rank_cd(b.search_vector, tq.q)::real AS rank, false AS fuzzy
      FROM base b, tq
     WHERE tq.q IS NOT NULL AND b.search_vector @@ tq.q
       AND (_in IS DISTINCT FROM 'title'
            OR to_tsvector('simple', unaccent(
                 coalesce(b.title_pl, '') || ' ' || coalesce(b.title_en, ''))) @@ tq.q)
  ),
  trgm AS (
    SELECT b.*,
           GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           )::real AS rank, true AS fuzzy
      FROM base b, nq
     WHERE length(nq.q) >= 4 AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  browse AS (
    SELECT b.*, 0::real AS rank, false AS fuzzy FROM base b, nq WHERE nq.q = ''
  ),
  hits AS (
    SELECT * FROM fts UNION ALL SELECT * FROM trgm UNION ALL SELECT * FROM browse
  ),
  pop AS (
    SELECT v.post_id, count(*) AS views FROM public.post_views v
     WHERE _sort = 'popular' AND v.viewed_at > now() - interval '90 days'
     GROUP BY v.post_id
  ),
  ranked AS (
    SELECT h.id, h.slug, h.title_pl, h.title_en, h.excerpt_pl, h.excerpt_en,
           h.cover_image_url, h.published_at, h.parent_page_id, h.author_id,
           h.post_format, h.eff_access, h.rank, h.fuzzy,
           (count(*) OVER ())::bigint AS total_count,
           row_number() OVER (ORDER BY
             CASE WHEN _sort = 'popular' THEN coalesce(pop.views, 0) END DESC NULLS LAST,
             CASE WHEN coalesce(_sort, 'relevance') NOT IN ('newest','popular') THEN h.rank END DESC NULLS LAST,
             h.published_at DESC NULLS LAST, h.id
           ) AS rn
      FROM hits h LEFT JOIN pop ON pop.post_id = h.id
  ),
  page AS (SELECT * FROM ranked WHERE rn <= GREATEST(LEAST(_limit, 200), 1))
  SELECT pg.id, pg.slug, pg.title_pl, pg.title_en, pg.excerpt_pl, pg.excerpt_en,
         pg.cover_image_url, pg.published_at, pg.parent_page_id, pg.author_id,
         pg.rank,
         CASE WHEN tq.q IS NOT NULL AND NOT pg.fuzzy THEN ts_headline(
           'simple',
           left(coalesce(pg.excerpt_pl, '') || ' ' ||
                regexp_replace(coalesce(p.content_pl, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) END AS headline_pl,
         CASE WHEN tq.q IS NOT NULL AND NOT pg.fuzzy THEN ts_headline(
           'simple',
           left(coalesce(pg.excerpt_en, '') || ' ' ||
                regexp_replace(coalesce(p.content_en, ''), '<[^>]+>', ' ', 'g'), 4000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=28, MinWords=12, ShortWord=2, MaxFragments=1'
         ) END AS headline_en,
         pg.post_format, pg.eff_access AS access_mode, pg.fuzzy, pg.total_count
    FROM page pg JOIN public.posts p ON p.id = pg.id CROSS JOIN tq
   ORDER BY pg.rn;
$$;

REVOKE ALL ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(
  text, int, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, text, jsonb
) TO anon, authenticated, service_role;

CREATE FUNCTION public.search_facets(
  _q text DEFAULT NULL, _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL, _date_to timestamptz DEFAULT NULL,
  _category uuid DEFAULT NULL, _terms uuid[] DEFAULT NULL,
  _format text DEFAULT NULL, _lang text DEFAULT NULL, _access text DEFAULT NULL,
  _match text DEFAULT 'all', _in text DEFAULT 'all',
  _term_groups jsonb DEFAULT NULL
) RETURNS TABLE (
  dim text, id uuid, slug text, label_pl text, label_en text,
  parent_id uuid, cnt bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH RECURSIVE ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  tq AS (SELECT public.nes_search_tsquery_adv(_q, _match) AS q),
  nq AS (SELECT public.nes_search_positive_rest(_q) AS q),
  term_tree AS (
    SELECT t.term_id AS root, t.term_id AS match_id, 0 AS depth
      FROM unnest(coalesce(_terms, '{}'::uuid[])) AS t(term_id)
    UNION ALL
    SELECT tt.root, c.id, tt.depth + 1
      FROM public.categories c
      JOIN term_tree tt ON c.parent_id = tt.match_id
     WHERE tt.depth < 10
  ),
  base AS (
    SELECT p.id, p.author_id, p.post_format, p.published_at,
           p.title_pl, p.title_en, p.search_vector,
           coalesce(ca.mode::text, 'public') AS eff_access
      FROM public.posts p JOIN ctx ON p.tenant_id = ctx.tid
      LEFT JOIN public.content_access ca
        ON ca.entity_type = 'post' AND ca.entity_id = p.id
     WHERE p.status = 'published' AND p.deleted_at IS NULL
       AND (_author IS NULL OR p.author_id = _author)
       AND (_date_from IS NULL OR p.published_at >= _date_from)
       AND (_date_to IS NULL OR p.published_at <= _date_to)
       AND (_category IS NULL OR EXISTS (
             SELECT 1 FROM public.post_categories pc
              WHERE pc.post_id = p.id AND pc.category_id = _category))
       AND (_format IS NULL OR p.post_format = _format)
       AND (_lang IS NULL
            OR (_lang = 'pl' AND btrim(p.title_pl) <> '')
            OR (_lang = 'en' AND btrim(p.title_en) <> ''))
       AND (_access IS NULL OR coalesce(ca.mode::text, 'public') = _access)
       AND (_terms IS NULL OR NOT EXISTS (
             SELECT 1 FROM unnest(_terms) AS req(term_id)
              WHERE NOT EXISTS (
                SELECT 1 FROM public.post_categories pc
                JOIN term_tree tt
                  ON tt.match_id = pc.category_id AND tt.root = req.term_id
                WHERE pc.post_id = p.id)))
  ),
  fts AS (
    SELECT b.* FROM base b, tq
     WHERE tq.q IS NOT NULL AND b.search_vector @@ tq.q
       AND (_in IS DISTINCT FROM 'title'
            OR to_tsvector('simple', unaccent(
                 coalesce(b.title_pl, '') || ' ' || coalesce(b.title_en, ''))) @@ tq.q)
  ),
  trgm AS (
    SELECT b.* FROM base b, nq
     WHERE length(nq.q) >= 4 AND NOT EXISTS (SELECT 1 FROM fts)
       AND GREATEST(
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_pl, '')))),
             word_similarity(nq.q, unaccent(lower(coalesce(b.title_en, ''))))
           ) > 0.3
  ),
  browse AS (SELECT b.* FROM base b, nq WHERE nq.q = ''),
  matched AS (
    SELECT * FROM fts UNION ALL SELECT * FROM trgm UNION ALL SELECT * FROM browse
  ),
  flags AS (
    SELECT m.*,
           CASE WHEN coalesce(_term_groups->>'category', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'category') END AS ok_category,
           CASE WHEN coalesce(_term_groups->>'pub_type', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'pub_type') END AS ok_pub_type,
           CASE WHEN coalesce(_term_groups->>'region', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'region') END AS ok_region,
           CASE WHEN coalesce(_term_groups->>'topic', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'topic') END AS ok_topic,
           CASE WHEN coalesce(_term_groups->>'project', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'project') END AS ok_project,
           CASE WHEN coalesce(_term_groups->>'series', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'series') END AS ok_series,
           CASE WHEN coalesce(_term_groups->>'organization', '') = '' THEN true
                ELSE public.nes_post_matches_term_group(m.id, _term_groups->>'organization') END AS ok_organization
      FROM matched m
  ),
  full_set AS (
    SELECT f.* FROM flags f
     WHERE f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic
       AND f.ok_project AND f.ok_series AND f.ok_organization
  ),
  vocab_tree AS (
    SELECT c.id AS root, c.id AS match_id, 0 AS depth
      FROM public.categories c, ctx WHERE c.tenant_id = ctx.tid
    UNION ALL
    SELECT vt.root, c.id, vt.depth + 1
      FROM public.categories c JOIN vocab_tree vt ON c.parent_id = vt.match_id
     WHERE vt.depth < 10
  )
  SELECT c.kind AS dim, c.id, c.slug, c.name_pl AS label_pl, c.name_en AS label_en,
         c.parent_id, count(DISTINCT f.id) AS cnt
    FROM flags f
    JOIN public.post_categories pc ON pc.post_id = f.id
    JOIN vocab_tree vt ON vt.match_id = pc.category_id
    JOIN public.categories c ON c.id = vt.root
   WHERE CASE c.kind
           WHEN 'category'     THEN f.ok_pub_type AND f.ok_region AND f.ok_topic AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'pub_type'     THEN f.ok_category AND f.ok_region AND f.ok_topic AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'region'       THEN f.ok_category AND f.ok_pub_type AND f.ok_topic AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'topic'        THEN f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_project AND f.ok_series AND f.ok_organization
           WHEN 'project'      THEN f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic AND f.ok_series AND f.ok_organization
           WHEN 'series'       THEN f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic AND f.ok_project AND f.ok_organization
           WHEN 'organization' THEN f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic AND f.ok_project AND f.ok_series
           ELSE f.ok_category AND f.ok_pub_type AND f.ok_region AND f.ok_topic AND f.ok_project AND f.ok_series AND f.ok_organization
         END
   GROUP BY c.kind, c.id, c.slug, c.name_pl, c.name_en, c.parent_id
  UNION ALL
  SELECT 'author', pr.id, pr.slug, coalesce(pr.display_name, 'Autor'),
         coalesce(pr.display_name, 'Author'), NULL, count(*)::bigint
    FROM full_set m JOIN public.profiles pr ON pr.id = m.author_id
   GROUP BY pr.id, pr.slug, pr.display_name
  UNION ALL
  SELECT 'format', NULL, m.post_format, m.post_format, m.post_format, NULL, count(*)::bigint
    FROM full_set m GROUP BY m.post_format
  UNION ALL
  SELECT 'lang', NULL, l.code, l.code, l.code, NULL, count(*)::bigint
    FROM full_set m
    CROSS JOIN LATERAL (
      SELECT 'pl'::text AS code WHERE btrim(m.title_pl) <> ''
      UNION ALL SELECT 'en' WHERE btrim(m.title_en) <> ''
    ) l GROUP BY l.code
  UNION ALL
  SELECT 'access', NULL, m.eff_access, m.eff_access, m.eff_access, NULL, count(*)::bigint
    FROM full_set m GROUP BY m.eff_access
  UNION ALL
  SELECT 'year', NULL, y.year_slug, y.year_slug, y.year_slug, NULL, count(*)::bigint
    FROM (SELECT extract(year FROM m.published_at)::int::text AS year_slug
            FROM full_set m WHERE m.published_at IS NOT NULL) y
   GROUP BY y.year_slug;
$$;

REVOKE ALL ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_facets(
  text, uuid, timestamptz, timestamptz, uuid, uuid[], text, text, text, text, text, jsonb
) TO anon, authenticated, service_role;

-- ============ 4. Semantic search pgvector (20260720190000) ============
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.post_embeddings (
  post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.post_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_embeddings FROM PUBLIC;
REVOKE ALL ON public.post_embeddings FROM anon, authenticated;
GRANT ALL ON public.post_embeddings TO service_role;

CREATE INDEX IF NOT EXISTS post_embeddings_tenant_idx ON public.post_embeddings (tenant_id);
CREATE INDEX IF NOT EXISTS post_embeddings_hnsw
  ON public.post_embeddings USING hnsw (embedding extensions.vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.nes_post_embedding_source(
  p_title_pl text, p_excerpt_pl text, p_title_en text, p_excerpt_en text
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT left(
    concat_ws(E'\n',
      nullif(btrim(coalesce(p_title_pl, '')), ''),
      nullif(btrim(coalesce(p_excerpt_pl, '')), ''),
      nullif(btrim(coalesce(p_title_en, '')), ''),
      nullif(btrim(coalesce(p_excerpt_en, '')), '')
    ), 2000);
$$;

CREATE OR REPLACE FUNCTION public.posts_needing_embeddings(_limit integer DEFAULT 32)
RETURNS TABLE (post_id uuid, tenant_id uuid, content_hash text, embed_text text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT p.id, p.tenant_id,
         md5(public.nes_post_embedding_source(p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en)) AS content_hash,
         public.nes_post_embedding_source(p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en) AS embed_text
    FROM public.posts p
    LEFT JOIN public.post_embeddings pe ON pe.post_id = p.id
   WHERE p.status = 'published' AND p.deleted_at IS NULL
     AND coalesce(public.nes_post_embedding_source(
           p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en), '') <> ''
     AND (pe.post_id IS NULL
          OR pe.content_hash IS DISTINCT FROM
             md5(public.nes_post_embedding_source(
               p.title_pl, p.excerpt_pl, p.title_en, p.excerpt_en)))
   ORDER BY p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(coalesce(_limit, 32), 200), 1);
$$;

REVOKE EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.posts_needing_embeddings(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.semantic_search_posts(
  _embedding double precision[], _limit integer DEFAULT 40
) RETURNS TABLE (post_id uuid, similarity real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH ctx AS (
    SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid
  ),
  q AS (SELECT (_embedding::extensions.vector(768)) AS v)
  SELECT pe.post_id, (1 - (pe.embedding <=> q.v))::real AS similarity
    FROM public.post_embeddings pe
    JOIN public.posts p ON p.id = pe.post_id
    JOIN ctx ON pe.tenant_id = ctx.tid
    CROSS JOIN q
   WHERE p.status = 'published' AND p.deleted_at IS NULL
     AND cardinality(_embedding) = 768
   ORDER BY pe.embedding <=> q.v
   LIMIT GREATEST(LEAST(coalesce(_limit, 40), 100), 1);
$$;

REVOKE ALL ON FUNCTION public.semantic_search_posts(double precision[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.semantic_search_posts(double precision[], integer)
  TO anon, authenticated, service_role;