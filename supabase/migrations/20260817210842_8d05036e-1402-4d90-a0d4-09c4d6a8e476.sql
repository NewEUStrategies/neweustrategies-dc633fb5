DROP POLICY IF EXISTS "Public can view public author profiles" ON public.author_profiles;
DROP POLICY IF EXISTS "Authenticated can view public author profiles" ON public.author_profiles;

REVOKE ALL ON public.author_profiles FROM anon;

REVOKE SELECT (phone, contact_email, media_contact_email, media_contact_phone)
  ON public.author_profiles FROM anon, authenticated;