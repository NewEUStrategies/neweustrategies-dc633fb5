-- Add 'builder' option to editor_type enum
ALTER TYPE editor_type ADD VALUE IF NOT EXISTS 'builder';

-- Add builder_data JSONB column to posts and pages
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS builder_data JSONB;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS builder_data JSONB;