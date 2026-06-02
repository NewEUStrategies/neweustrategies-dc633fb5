-- 1) Add 'blocks' to editor_type enum
ALTER TYPE public.editor_type ADD VALUE IF NOT EXISTS 'blocks';

-- 2) Add blocks_data column to posts
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS blocks_data jsonb;

-- Index for faster lookups on editor type
CREATE INDEX IF NOT EXISTS posts_editor_idx ON public.posts (editor);