
ALTER TABLE public.name_dictionary
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS instrumental_pl text,
  ADD COLUMN IF NOT EXISTS genitive_pl text,
  ADD COLUMN IF NOT EXISTS dative_pl text,
  ADD COLUMN IF NOT EXISTS english_form text,
  ADD COLUMN IF NOT EXISTS is_compound boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS origin text;

-- Backfill key/display_name/origin from existing rows
UPDATE public.name_dictionary
   SET display_name = COALESCE(display_name, name),
       key = COALESCE(key, name_normalized),
       origin = COALESCE(origin, origin_country)
 WHERE display_name IS NULL OR key IS NULL OR origin IS NULL;

-- Unique key per dictionary
CREATE UNIQUE INDEX IF NOT EXISTS name_dictionary_key_uidx
  ON public.name_dictionary (key);

-- Enable realtime
ALTER TABLE public.name_dictionary REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.name_dictionary';
  EXCEPTION WHEN duplicate_object THEN NULL;
           WHEN others THEN NULL;
  END;
END $$;
