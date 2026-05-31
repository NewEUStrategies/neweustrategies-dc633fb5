-- ============================================================
-- Phase A: Security hardening + multi-tenant storage isolation
-- ============================================================

-- 1) Storage RLS per-tenant. Convention: object path starts with "{tenant_id}/..."
--    The "media" bucket stays public for SELECT (CDN-friendly), but writes
--    are restricted to staff of the owning tenant.

-- Wipe any prior permissive policies on the media bucket (idempotent).
DROP POLICY IF EXISTS "media public read"       ON storage.objects;
DROP POLICY IF EXISTS "media tenant insert"     ON storage.objects;
DROP POLICY IF EXISTS "media tenant update"     ON storage.objects;
DROP POLICY IF EXISTS "media tenant delete"     ON storage.objects;

-- Public read keeps published images viewable on the public site.
CREATE POLICY "media public read"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'media');

-- Helper: parse first path segment as UUID tenant id. Returns NULL on bad path.
CREATE OR REPLACE FUNCTION public.storage_path_tenant(_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    THEN (split_part(_name, '/', 1))::uuid
    ELSE NULL
  END
$$;

CREATE POLICY "media tenant insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND public.storage_path_tenant(name) = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'editor'::app_role)
    OR public.has_role(auth.uid(), 'author'::app_role)
  )
);

CREATE POLICY "media tenant update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND public.storage_path_tenant(name) = public.current_tenant_id()
);

CREATE POLICY "media tenant delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND public.storage_path_tenant(name) = public.current_tenant_id()
);

-- 2) Slug uniqueness per tenant (DB-enforced, not app-enforced).
CREATE UNIQUE INDEX IF NOT EXISTS posts_tenant_slug_uniq
  ON public.posts (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS pages_tenant_slug_uniq
  ON public.pages (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS categories_tenant_slug_uniq
  ON public.categories (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS tags_tenant_slug_uniq
  ON public.tags (tenant_id, slug);

-- 3) Soft delete columns.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS posts_not_deleted_idx ON public.posts (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pages_not_deleted_idx ON public.pages (tenant_id) WHERE deleted_at IS NULL;

-- Tighten public SELECT to exclude soft-deleted rows.
DROP POLICY IF EXISTS "Public reads published posts" ON public.posts;
CREATE POLICY "Public reads published posts"
ON public.posts FOR SELECT
TO anon, authenticated
USING (status = 'published'::post_status AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Public reads published pages" ON public.pages;
CREATE POLICY "Public reads published pages"
ON public.pages FOR SELECT
TO anon, authenticated
USING (status = 'published'::post_status AND deleted_at IS NULL);

-- 4) Revisions table — append-only snapshots of post/page content.
CREATE TABLE IF NOT EXISTS public.content_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  entity_type  text NOT NULL CHECK (entity_type IN ('post','page')),
  entity_id    uuid NOT NULL,
  author_id    uuid,
  snapshot     jsonb NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_revisions_lookup_idx
  ON public.content_revisions (tenant_id, entity_type, entity_id, created_at DESC);

GRANT SELECT, INSERT ON public.content_revisions TO authenticated;
GRANT ALL ON public.content_revisions TO service_role;

ALTER TABLE public.content_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revisions tenant read"
ON public.content_revisions FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'editor'::app_role)
    OR public.has_role(auth.uid(),'author'::app_role)
  )
);

CREATE POLICY "revisions tenant insert"
ON public.content_revisions FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND author_id = auth.uid()
);

-- 5) Audit log — every privileged write surface logs here.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  actor_id    uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  metadata    jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx
  ON public.audit_log (tenant_id, created_at DESC);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log admin read tenant"
ON public.audit_log FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.has_role(auth.uid(),'admin'::app_role)
);

CREATE POLICY "audit_log staff insert tenant"
ON public.audit_log FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND actor_id = auth.uid()
);

-- 6) Rate-limit counter table (sliding-window bucket, server-side).
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      text NOT NULL,        -- e.g. 'media_upload'
  subject_id uuid NOT NULL,        -- usually auth.uid()
  window_start timestamptz NOT NULL DEFAULT date_trunc('minute', now()),
  count      integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_window_uniq
  ON public.rate_limits (scope, subject_id, window_start);

GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies — only service_role (server functions) touches this table.
