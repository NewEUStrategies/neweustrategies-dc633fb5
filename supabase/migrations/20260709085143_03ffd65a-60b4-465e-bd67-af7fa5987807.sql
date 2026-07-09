ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS toc_override jsonb;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS toc_override jsonb;
COMMENT ON COLUMN public.posts.toc_override IS 'Per-post override for global ToC settings; null = inherit.';
COMMENT ON COLUMN public.pages.toc_override IS 'Per-page override for global ToC settings; null = inherit.';