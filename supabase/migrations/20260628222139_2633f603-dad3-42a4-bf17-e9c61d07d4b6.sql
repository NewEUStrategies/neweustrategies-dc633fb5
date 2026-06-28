
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS facebook_url  text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS spotify_url   text,
  ADD COLUMN IF NOT EXISTS contact_email text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_facebook_url_chk  CHECK (facebook_url  IS NULL OR facebook_url  ~* '^https?://'),
  ADD CONSTRAINT profiles_instagram_url_chk CHECK (instagram_url IS NULL OR instagram_url ~* '^https?://'),
  ADD CONSTRAINT profiles_spotify_url_chk   CHECK (spotify_url   IS NULL OR spotify_url   ~* '^https?://'),
  ADD CONSTRAINT profiles_contact_email_chk CHECK (contact_email IS NULL OR contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
