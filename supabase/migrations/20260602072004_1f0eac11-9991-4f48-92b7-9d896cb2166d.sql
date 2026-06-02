ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS excerpt_pl text,
  ADD COLUMN IF NOT EXISTS excerpt_en text;