-- PR #48: Editorial features migrations (bundled)
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS show_citation boolean NOT NULL DEFAULT true;

-- Pages scheduled publishing
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS publish_at timestamptz;

CREATE INDEX IF NOT EXISTS pages_scheduled_due_idx
  ON public.pages (publish_at)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS pages_workflow_guard ON public.pages;
CREATE TRIGGER pages_workflow_guard
  BEFORE INSERT OR UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_post_workflow();

CREATE OR REPLACE FUNCTION public.publish_due_pages()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  UPDATE public.pages
     SET status = 'published',
         published_at = COALESCE(published_at, publish_at, now())
   WHERE status = 'scheduled'
     AND deleted_at IS NULL
     AND publish_at IS NOT NULL
     AND publish_at <= now();
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_due_pages() FROM public;
GRANT EXECUTE ON FUNCTION public.publish_due_pages() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('publish-due-pages', '* * * * *', 'SELECT public.publish_due_pages()');
  ELSE
    RAISE NOTICE 'pg_cron unavailable - scheduled pages publish via opportunistic ticks only';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron setup skipped: %', SQLERRM;
END;
$$;

-- Follow publish alerts: programs as follow target
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.user_follows'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%target_type%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.user_follows DROP CONSTRAINT %I', v_conname);
  END IF;
  ALTER TABLE public.user_follows
    ADD CONSTRAINT user_follows_target_type_check
    CHECK (target_type IN ('author', 'category', 'tag', 'program'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_user_follows_target
  ON public.user_follows (tenant_id, target_type, target_id);

CREATE OR REPLACE FUNCTION public.notify_post_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_title_pl text;
  v_title_en text;
  v_href text;
  v_author_name text;
  v_transitioned boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_transitioned := (NEW.status = 'published');
  ELSE
    v_transitioned := (NEW.status = 'published'
                       AND (OLD.status IS DISTINCT FROM 'published'));
  END IF;

  IF NOT v_transitioned THEN
    RETURN NEW;
  END IF;

  v_title_pl := COALESCE(NULLIF(btrim(NEW.title_pl), ''), NEW.slug);
  v_title_en := COALESCE(NULLIF(btrim(NEW.title_en), ''), NEW.slug);
  v_href := public.post_canonical_href(NEW.id);

  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'autora') INTO v_author_name
    FROM public.profiles WHERE id = NEW.author_id;

  IF NEW.author_id IS NOT NULL THEN
    PERFORM public.enqueue_notification(
      f.user_id,
      'content',
      'Nowy wpis: ' || v_title_pl,
      'New post: ' || v_title_en,
      'Autor ' || v_author_name || ' opublikował nowy wpis.',
      'New post by ' || v_author_name || '.',
      v_href,
      'newspaper'
    )
    FROM public.user_follows f
    WHERE f.target_type = 'author'
      AND f.target_id = NEW.author_id
      AND f.user_id <> COALESCE(NEW.author_id, '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;

  PERFORM public.enqueue_notification(
    f.user_id, 'content',
    'Nowy wpis: ' || v_title_pl,
    'New post: ' || v_title_en,
    NULL, NULL, v_href, 'newspaper'
  )
  FROM public.user_follows f
  JOIN public.post_categories pc ON pc.category_id = f.target_id
  WHERE f.target_type = 'category' AND pc.post_id = NEW.id;

  PERFORM public.enqueue_notification(
    f.user_id, 'content',
    'Nowy wpis: ' || v_title_pl,
    'New post: ' || v_title_en,
    NULL, NULL, v_href, 'newspaper'
  )
  FROM public.user_follows f
  JOIN public.post_tags pt ON pt.tag_id = f.target_id
  WHERE f.target_type = 'tag' AND pt.post_id = NEW.id;

  PERFORM public.enqueue_notification(
    f.user_id, 'content',
    'Nowy wpis: ' || v_title_pl,
    'New post: ' || v_title_en,
    NULL, NULL, v_href, 'newspaper'
  )
  FROM public.user_follows f
  JOIN public.post_programs pp ON pp.program_id = f.target_id
  WHERE f.target_type = 'program' AND pp.post_id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- Quote share toggle
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS show_quote_share boolean NOT NULL DEFAULT true;

-- Post changelog
CREATE TABLE IF NOT EXISTS public.post_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  note_pl text NOT NULL,
  note_en text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_changelog_post
  ON public.post_changelog (post_id, entry_date DESC, created_at DESC);

GRANT SELECT ON public.post_changelog TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.post_changelog TO authenticated;
GRANT ALL ON public.post_changelog TO service_role;

ALTER TABLE public.post_changelog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "changelog public read" ON public.post_changelog;
CREATE POLICY "changelog public read" ON public.post_changelog
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_changelog.post_id
         AND p.tenant_id = public_tenant_id()
         AND p.tenant_id = post_changelog.tenant_id
         AND p.status = 'published'
         AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "changelog staff read" ON public.post_changelog;
CREATE POLICY "changelog staff read" ON public.post_changelog
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS "changelog staff manage" ON public.post_changelog;
CREATE POLICY "changelog staff manage" ON public.post_changelog
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Post preview tokens
CREATE TABLE IF NOT EXISTS public.post_preview_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_preview_tokens_post
  ON public.post_preview_tokens (post_id, expires_at DESC);

GRANT SELECT, INSERT, DELETE ON public.post_preview_tokens TO authenticated;
GRANT ALL ON public.post_preview_tokens TO service_role;

ALTER TABLE public.post_preview_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "preview tokens staff manage" ON public.post_preview_tokens;
CREATE POLICY "preview tokens staff manage" ON public.post_preview_tokens
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Post feedback
CREATE TABLE IF NOT EXISTS public.post_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  helpful boolean NOT NULL,
  voter_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_feedback_post
  ON public.post_feedback (post_id, created_at DESC);

GRANT SELECT ON public.post_feedback TO authenticated;
GRANT ALL ON public.post_feedback TO service_role;

ALTER TABLE public.post_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback staff read" ON public.post_feedback;
CREATE POLICY "feedback staff read" ON public.post_feedback
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Series
CREATE TABLE IF NOT EXISTS public.series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  slug text NOT NULL,
  name_pl text NOT NULL,
  name_en text NOT NULL DEFAULT '',
  description_pl text,
  description_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS public.post_series (
  post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  part_number integer NOT NULL DEFAULT 1 CHECK (part_number >= 1 AND part_number <= 999),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_series_series
  ON public.post_series (series_id, part_number);

GRANT SELECT ON public.series, public.post_series TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.series, public.post_series TO authenticated;
GRANT ALL ON public.series, public.post_series TO service_role;

ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "series public read" ON public.series;
CREATE POLICY "series public read" ON public.series
  FOR SELECT USING (tenant_id = public_tenant_id());

DROP POLICY IF EXISTS "series staff manage" ON public.series;
CREATE POLICY "series staff manage" ON public.series
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

DROP POLICY IF EXISTS "post_series public read" ON public.post_series;
CREATE POLICY "post_series public read" ON public.post_series
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_series.post_id
         AND p.tenant_id = public_tenant_id()
         AND p.status = 'published'
         AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "post_series staff manage" ON public.post_series;
CREATE POLICY "post_series staff manage" ON public.post_series
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_series.post_id
         AND p.tenant_id = public.current_tenant_id()
    ) AND public.is_staff()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.posts p
       WHERE p.id = post_series.post_id
         AND p.tenant_id = public.current_tenant_id()
    ) AND public.is_staff()
  );

-- Glossary terms
CREATE TABLE IF NOT EXISTS public.glossary_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT current_tenant_id(),
  slug text NOT NULL,
  term_pl text NOT NULL,
  term_en text NOT NULL DEFAULT '',
  definition_pl text NOT NULL,
  definition_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_glossary_terms_tenant
  ON public.glossary_terms (tenant_id, term_pl);

GRANT SELECT ON public.glossary_terms TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.glossary_terms TO authenticated;
GRANT ALL ON public.glossary_terms TO service_role;

ALTER TABLE public.glossary_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "glossary public read" ON public.glossary_terms;
CREATE POLICY "glossary public read" ON public.glossary_terms
  FOR SELECT USING (tenant_id = public_tenant_id());

DROP POLICY IF EXISTS "glossary staff manage" ON public.glossary_terms;
CREATE POLICY "glossary staff manage" ON public.glossary_terms
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff())
  WITH CHECK (tenant_id = public.current_tenant_id() AND public.is_staff());

-- Outbound link checks
CREATE TABLE IF NOT EXISTS public.outbound_link_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  url text NOT NULL,
  ok boolean NOT NULL,
  status_code integer,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, url)
);

CREATE INDEX IF NOT EXISTS idx_outbound_link_checks_broken
  ON public.outbound_link_checks (tenant_id, checked_at DESC)
  WHERE ok = false;

GRANT SELECT ON public.outbound_link_checks TO authenticated;
GRANT ALL ON public.outbound_link_checks TO service_role;

ALTER TABLE public.outbound_link_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "link checks staff read" ON public.outbound_link_checks;
CREATE POLICY "link checks staff read" ON public.outbound_link_checks
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS outbound_links_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_posts_link_check_due
  ON public.posts (outbound_links_checked_at NULLS FIRST)
  WHERE status = 'published' AND deleted_at IS NULL;