
-- 1) PAGES: parent_id, template_id, menu_order
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.pages(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.builder_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS menu_order int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pages_parent_order ON public.pages(parent_id, menu_order);

-- Unique slug within (tenant, parent). NULL parent_id treated as distinct top-level scope per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pages_tenant_parent_slug
  ON public.pages(tenant_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
  WHERE deleted_at IS NULL;

-- Anti-cycle trigger
CREATE OR REPLACE FUNCTION public.check_page_parent_no_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cur uuid;
  hops int := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'page parent cycle: page cannot be its own parent';
  END IF;
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    hops := hops + 1;
    IF hops > 100 THEN
      RAISE EXCEPTION 'page parent chain too deep (>100)';
    END IF;
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'page parent cycle detected';
    END IF;
    SELECT parent_id INTO cur FROM public.pages WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pages_no_cycle ON public.pages;
CREATE TRIGGER trg_pages_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.check_page_parent_no_cycle();

-- page_full_path function
CREATE OR REPLACE FUNCTION public.page_full_path(_page_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT id, parent_id, slug, 1 AS depth FROM public.pages WHERE id = _page_id
    UNION ALL
    SELECT p.id, p.parent_id, p.slug, c.depth + 1
      FROM public.pages p JOIN chain c ON p.id = c.parent_id
      WHERE c.depth < 50
  )
  SELECT string_agg(slug, '/' ORDER BY depth DESC) FROM chain;
$$;

GRANT EXECUTE ON FUNCTION public.page_full_path(uuid) TO anon, authenticated, service_role;

-- 2) POSTS: parent_page_id, template_id

-- Ensure a "Blog" page exists per tenant for backfill
DO $$
DECLARE
  t record;
  v_blog_id uuid;
  v_author uuid;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM public.posts LOOP
    SELECT id INTO v_blog_id
      FROM public.pages
      WHERE tenant_id = t.tenant_id AND slug = 'blog' AND parent_id IS NULL
      LIMIT 1;

    IF v_blog_id IS NULL THEN
      SELECT author_id INTO v_author FROM public.posts WHERE tenant_id = t.tenant_id LIMIT 1;
      INSERT INTO public.pages (tenant_id, author_id, slug, title_pl, title_en, editor, status, published_at)
      VALUES (t.tenant_id, v_author, 'blog', 'Blog', 'Blog', 'builder', 'published', now())
      RETURNING id INTO v_blog_id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS parent_page_id uuid REFERENCES public.pages(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.builder_templates(id) ON DELETE SET NULL;

-- Backfill parent_page_id for existing posts → tenant's "blog" page
UPDATE public.posts p
SET parent_page_id = pg.id
FROM public.pages pg
WHERE p.parent_page_id IS NULL
  AND pg.tenant_id = p.tenant_id
  AND pg.slug = 'blog'
  AND pg.parent_id IS NULL;

ALTER TABLE public.posts ALTER COLUMN parent_page_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_posts_parent_slug
  ON public.posts(parent_page_id, slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_parent_page ON public.posts(parent_page_id);

-- 3) resolve_path RPC: tries page hierarchy, then falls back to last segment as post under parent
CREATE OR REPLACE FUNCTION public.resolve_path(_segments text[])
RETURNS TABLE (page_id uuid, post_id uuid)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_parent uuid := NULL;
  v_current uuid := NULL;
  v_seg text;
  i int;
  v_post uuid;
BEGIN
  IF _segments IS NULL OR array_length(_segments, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Try full path as pages
  v_parent := NULL;
  FOR i IN 1 .. array_length(_segments, 1) LOOP
    v_seg := _segments[i];
    SELECT id INTO v_current
      FROM public.pages
      WHERE slug = v_seg
        AND parent_id IS NOT DISTINCT FROM v_parent
        AND status = 'published'
        AND deleted_at IS NULL
      LIMIT 1;
    IF v_current IS NULL THEN
      EXIT;
    END IF;
    v_parent := v_current;
  END LOOP;

  IF v_current IS NOT NULL AND i = array_length(_segments, 1) THEN
    page_id := v_current;
    post_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Try resolving all-but-last as page path, last as post slug
  IF array_length(_segments, 1) >= 1 THEN
    v_parent := NULL;
    v_current := NULL;
    IF array_length(_segments, 1) = 1 THEN
      -- post directly under root? not allowed; only under a page
      RETURN;
    END IF;
    FOR i IN 1 .. array_length(_segments, 1) - 1 LOOP
      v_seg := _segments[i];
      SELECT id INTO v_current
        FROM public.pages
        WHERE slug = v_seg
          AND parent_id IS NOT DISTINCT FROM v_parent
          AND status = 'published'
          AND deleted_at IS NULL
        LIMIT 1;
      IF v_current IS NULL THEN
        RETURN;
      END IF;
      v_parent := v_current;
    END LOOP;

    SELECT id INTO v_post
      FROM public.posts
      WHERE slug = _segments[array_length(_segments, 1)]
        AND parent_page_id = v_current
        AND status = 'published'
        AND deleted_at IS NULL
      LIMIT 1;

    IF v_post IS NOT NULL THEN
      page_id := v_current;
      post_id := v_post;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_path(text[]) TO anon, authenticated, service_role;

-- 4) breadcrumbs RPC for a page
CREATE OR REPLACE FUNCTION public.page_breadcrumbs(_page_id uuid)
RETURNS TABLE (id uuid, slug text, title_pl text, title_en text, depth int, full_path text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT p.id, p.parent_id, p.slug, p.title_pl, p.title_en, 1 AS depth
      FROM public.pages p WHERE p.id = _page_id
    UNION ALL
    SELECT p.id, p.parent_id, p.slug, p.title_pl, p.title_en, c.depth + 1
      FROM public.pages p JOIN chain c ON p.id = c.parent_id
      WHERE c.depth < 50
  ),
  ordered AS (
    SELECT *, (SELECT max(depth) FROM chain) - depth + 1 AS rank FROM chain
  )
  SELECT o.id, o.slug, o.title_pl, o.title_en, o.rank::int AS depth,
         public.page_full_path(o.id) AS full_path
    FROM ordered o
    ORDER BY o.rank;
$$;

GRANT EXECUTE ON FUNCTION public.page_breadcrumbs(uuid) TO anon, authenticated, service_role;
