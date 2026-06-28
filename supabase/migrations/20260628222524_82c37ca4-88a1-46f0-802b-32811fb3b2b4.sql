
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS current_company text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phone_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phone_chk
  CHECK (phone IS NULL OR phone ~ '^[+0-9 ()\-]{6,32}$');
