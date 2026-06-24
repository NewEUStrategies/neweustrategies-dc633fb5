
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS auto_load_next_post boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.live_blog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  block_id text NOT NULL,
  lang text NOT NULL DEFAULT 'pl' CHECK (lang IN ('pl','en')),
  title text,
  body_html text NOT NULL DEFAULT '',
  pinned boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_blog_entries_post_block_idx
  ON public.live_blog_entries (post_id, block_id, occurred_at DESC);

GRANT SELECT ON public.live_blog_entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_blog_entries TO authenticated;
GRANT ALL ON public.live_blog_entries TO service_role;

ALTER TABLE public.live_blog_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read live blog entries for published posts"
  ON public.live_blog_entries FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.id = live_blog_entries.post_id
      AND p.status = 'published'
      AND p.deleted_at IS NULL
  ));

CREATE POLICY "Tenant members can insert live blog entries"
  ON public.live_blog_entries FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members can update their live blog entries"
  ON public.live_blog_entries FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members can delete their live blog entries"
  ON public.live_blog_entries FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_live_blog_entries_updated_at
  BEFORE UPDATE ON public.live_blog_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.live_blog_entries REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_blog_entries;
