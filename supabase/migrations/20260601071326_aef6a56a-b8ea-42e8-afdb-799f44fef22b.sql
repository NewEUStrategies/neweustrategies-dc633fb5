
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS takeaways_pl text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS takeaways_en text[] NOT NULL DEFAULT '{}';

-- Validation: max 6 bullets per language, each up to 500 chars.
CREATE OR REPLACE FUNCTION public.posts_validate_takeaways()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  b text;
BEGIN
  IF array_length(NEW.takeaways_pl, 1) > 6 THEN
    RAISE EXCEPTION 'takeaways_pl: max 6 items';
  END IF;
  IF array_length(NEW.takeaways_en, 1) > 6 THEN
    RAISE EXCEPTION 'takeaways_en: max 6 items';
  END IF;
  IF NEW.takeaways_pl IS NOT NULL THEN
    FOREACH b IN ARRAY NEW.takeaways_pl LOOP
      IF length(b) > 500 THEN RAISE EXCEPTION 'takeaways_pl item too long (max 500)'; END IF;
    END LOOP;
  END IF;
  IF NEW.takeaways_en IS NOT NULL THEN
    FOREACH b IN ARRAY NEW.takeaways_en LOOP
      IF length(b) > 500 THEN RAISE EXCEPTION 'takeaways_en item too long (max 500)'; END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS posts_validate_takeaways_trg ON public.posts;
CREATE TRIGGER posts_validate_takeaways_trg
  BEFORE INSERT OR UPDATE OF takeaways_pl, takeaways_en ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.posts_validate_takeaways();
