-- ============================================================
-- PART A: Full-text search (posts + pages)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.nes_jsonb_text(_j jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(string_agg(v #>> '{}', ' '), '')
  FROM jsonb_path_query(coalesce(_j, '{}'::jsonb), '$.** ? (@.type() == "string")') AS v;
$$;

CREATE OR REPLACE FUNCTION public.nes_search_tsquery(_q text)
RETURNS tsquery LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
DECLARE v_terms text;
BEGIN
  SELECT string_agg(term || ':*', ' & ') INTO v_terms FROM (
    SELECT regexp_replace(unaccent(lower(w)), '[^a-z0-9]', '', 'g') AS term
    FROM unnest(regexp_split_to_array(coalesce(_q, ''), '\s+')) AS w
  ) s WHERE term <> '';
  IF v_terms IS NULL OR v_terms = '' THEN RETURN NULL; END IF;
  RETURN to_tsquery('simple', v_terms);
EXCEPTION WHEN others THEN
  RETURN plainto_tsquery('simple', unaccent(lower(coalesce(_q, ''))));
END;
$$;

CREATE OR REPLACE FUNCTION public.nes_posts_search_vector(
  _title_pl text, _title_en text, _excerpt_pl text, _excerpt_en text, _slug text,
  _content_pl text, _content_en text, _takeaways_pl text[], _takeaways_en text[],
  _blocks jsonb, _builder jsonb
) RETURNS tsvector LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT
    setweight(to_tsvector('simple', unaccent(coalesce(_title_pl,'') || ' ' || coalesce(_title_en,''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(_slug,''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(
      coalesce(_excerpt_pl,'') || ' ' || coalesce(_excerpt_en,'') || ' ' ||
      coalesce(array_to_string(_takeaways_pl,' '),'') || ' ' ||
      coalesce(array_to_string(_takeaways_en,' '),'')
    )), 'B') ||
    setweight(to_tsvector('simple', left(unaccent(regexp_replace(
      coalesce(_content_pl,'') || ' ' || coalesce(_content_en,'') || ' ' ||
      public.nes_jsonb_text(_blocks) || ' ' || public.nes_jsonb_text(_builder),
      '<[^>]+>', ' ', 'g'
    )), 900000)), 'C');
$$;

CREATE OR REPLACE FUNCTION public.nes_pages_search_vector(
  _title_pl text, _title_en text, _excerpt_pl text, _excerpt_en text, _slug text,
  _content_pl text, _content_en text, _builder jsonb
) RETURNS tsvector LANGUAGE sql STABLE SET search_path = public, extensions AS $$
  SELECT
    setweight(to_tsvector('simple', unaccent(coalesce(_title_pl,'') || ' ' || coalesce(_title_en,''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(_slug,''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(_excerpt_pl,'') || ' ' || coalesce(_excerpt_en,''))), 'B') ||
    setweight(to_tsvector('simple', left(unaccent(regexp_replace(
      coalesce(_content_pl,'') || ' ' || coalesce(_content_en,'') || ' ' ||
      public.nes_jsonb_text(_builder), '<[^>]+>', ' ', 'g'
    )), 900000)), 'C');
$$;

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION public.posts_search_vector_refresh()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  NEW.search_vector := public.nes_posts_search_vector(
    NEW.title_pl, NEW.title_en, NEW.excerpt_pl, NEW.excerpt_en, NEW.slug,
    NEW.content_pl, NEW.content_en, NEW.takeaways_pl, NEW.takeaways_en,
    NEW.blocks_data, NEW.builder_data);
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.pages_search_vector_refresh()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, extensions AS $$
BEGIN
  NEW.search_vector := public.nes_pages_search_vector(
    NEW.title_pl, NEW.title_en, NEW.excerpt_pl, NEW.excerpt_en, NEW.slug,
    NEW.content_pl, NEW.content_en, NEW.builder_data);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS posts_search_vector_tg ON public.posts;
CREATE TRIGGER posts_search_vector_tg
  BEFORE INSERT OR UPDATE OF title_pl, title_en, excerpt_pl, excerpt_en, slug,
    content_pl, content_en, takeaways_pl, takeaways_en, blocks_data, builder_data
  ON public.posts FOR EACH ROW EXECUTE FUNCTION public.posts_search_vector_refresh();

DROP TRIGGER IF EXISTS pages_search_vector_tg ON public.pages;
CREATE TRIGGER pages_search_vector_tg
  BEFORE INSERT OR UPDATE OF title_pl, title_en, excerpt_pl, excerpt_en, slug,
    content_pl, content_en, builder_data
  ON public.pages FOR EACH ROW EXECUTE FUNCTION public.pages_search_vector_refresh();

CREATE INDEX IF NOT EXISTS posts_search_vector_gin ON public.posts USING gin (search_vector);
CREATE INDEX IF NOT EXISTS pages_search_vector_gin ON public.pages USING gin (search_vector);

UPDATE public.posts SET search_vector = public.nes_posts_search_vector(
  title_pl, title_en, excerpt_pl, excerpt_en, slug, content_pl, content_en,
  takeaways_pl, takeaways_en, blocks_data, builder_data);
UPDATE public.pages SET search_vector = public.nes_pages_search_vector(
  title_pl, title_en, excerpt_pl, excerpt_en, slug, content_pl, content_en, builder_data);

CREATE OR REPLACE FUNCTION public.search_posts(
  _q text, _limit int DEFAULT 80, _author uuid DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL, _date_to timestamptz DEFAULT NULL
) RETURNS TABLE (
  id uuid, slug text, title_pl text, title_en text, excerpt_pl text, excerpt_en text,
  cover_image_url text, published_at timestamptz, parent_page_id uuid, author_id uuid, rank real
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH ctx AS (SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid),
       tq  AS (SELECT public.nes_search_tsquery(_q) AS q)
  SELECT p.id, p.slug, p.title_pl, p.title_en, p.excerpt_pl, p.excerpt_en,
         p.cover_image_url, p.published_at, p.parent_page_id, p.author_id,
         ts_rank_cd(p.search_vector, tq.q)::real AS rank
    FROM public.posts p, tq, ctx
   WHERE tq.q IS NOT NULL AND p.search_vector @@ tq.q
     AND p.status='published' AND p.deleted_at IS NULL AND p.tenant_id = ctx.tid
     AND (_author IS NULL OR p.author_id = _author)
     AND (_date_from IS NULL OR p.published_at >= _date_from)
     AND (_date_to   IS NULL OR p.published_at <= _date_to)
   ORDER BY rank DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 200), 1);
$$;

CREATE OR REPLACE FUNCTION public.search_quick(_q text, _limit int DEFAULT 12)
RETURNS TABLE (kind text, id uuid, slug text, title_pl text, title_en text, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  WITH ctx AS (SELECT coalesce(public.current_tenant_id(), public.public_tenant_id()) AS tid),
       tq  AS (SELECT public.nes_search_tsquery(_q) AS q),
       hits AS (
         SELECT 'post'::text AS kind, p.id, p.slug, p.title_pl, p.title_en,
                ts_rank_cd(p.search_vector, tq.q)::real AS rank
           FROM public.posts p, tq, ctx
          WHERE tq.q IS NOT NULL AND p.search_vector @@ tq.q
            AND p.status='published' AND p.deleted_at IS NULL AND p.tenant_id = ctx.tid
         UNION ALL
         SELECT 'page'::text AS kind, pg.id, pg.slug, pg.title_pl, pg.title_en,
                ts_rank_cd(pg.search_vector, tq.q)::real AS rank
           FROM public.pages pg, tq, ctx
          WHERE tq.q IS NOT NULL AND pg.search_vector @@ tq.q
            AND pg.status='published' AND pg.deleted_at IS NULL AND pg.tenant_id = ctx.tid
       )
  SELECT kind, id, slug, title_pl, title_en, rank FROM hits
   ORDER BY rank DESC LIMIT GREATEST(LEAST(_limit, 50), 1);
$$;

REVOKE EXECUTE ON FUNCTION public.search_posts(text, int, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_quick(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_posts(text, int, uuid, timestamptz, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_quick(text, int) TO anon, authenticated, service_role;

-- ============================================================
-- PART B: Tenant isolation + staff authz
-- ============================================================
CREATE OR REPLACE FUNCTION public.profiles_pin_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS profiles_pin_tenant_tg ON public.profiles;
CREATE TRIGGER profiles_pin_tenant_tg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_pin_tenant();

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'editor')
      OR public.has_role(auth.uid(), 'author')
$$;

REVOKE EXECUTE ON FUNCTION public.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;