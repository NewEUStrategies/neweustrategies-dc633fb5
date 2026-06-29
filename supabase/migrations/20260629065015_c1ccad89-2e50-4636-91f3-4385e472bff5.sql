
-- Restore missing table-level grants on public.profiles (security fix accidentally dropped them)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Add gender column for user profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender public.name_gender;

-- Helper: derive gender from a first name via name_dictionary (case/diacritics insensitive)
CREATE OR REPLACE FUNCTION public.guess_gender_from_name(_name text)
RETURNS public.name_gender
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gender
  FROM public.name_dictionary
  WHERE name_normalized = lower(unaccent(coalesce(_name, '')))
     OR lower(name) = lower(coalesce(_name, ''))
  ORDER BY (gender IS NOT NULL) DESC
  LIMIT 1
$$;

-- Trigger: auto-fill gender on insert/update when null and first_name present
CREATE OR REPLACE FUNCTION public.profiles_autofill_gender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.gender IS NULL AND NEW.first_name IS NOT NULL AND length(trim(NEW.first_name)) > 0 THEN
    NEW.gender := public.guess_gender_from_name(split_part(trim(NEW.first_name), ' ', 1));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_autofill_gender ON public.profiles;
CREATE TRIGGER trg_profiles_autofill_gender
BEFORE INSERT OR UPDATE OF first_name, gender ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_autofill_gender();

-- Backfill existing profiles where gender is null
UPDATE public.profiles
SET gender = public.guess_gender_from_name(split_part(trim(first_name), ' ', 1))
WHERE gender IS NULL AND first_name IS NOT NULL AND length(trim(first_name)) > 0;
