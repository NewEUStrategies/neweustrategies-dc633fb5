ALTER TABLE public.posts ALTER COLUMN editor SET DEFAULT 'builder';
ALTER TABLE public.pages ALTER COLUMN editor SET DEFAULT 'builder';
UPDATE public.posts SET editor='builder' WHERE editor='richtext' AND (content_pl IS NULL OR content_pl='') AND (content_en IS NULL OR content_en='');
UPDATE public.pages SET editor='builder' WHERE editor='richtext' AND (content_pl IS NULL OR content_pl='') AND (content_en IS NULL OR content_en='');