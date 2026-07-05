
-- 1) contact_messages: force recipient to NULL for anonymous submissions
DROP POLICY IF EXISTS "Anyone can submit a contact message" ON public.contact_messages;
CREATE POLICY "Anyone can submit a contact message"
  ON public.contact_messages
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    tenant_id = public.public_tenant_id()
    AND recipient IS NULL
  );

-- 2) profiles: restrict anon column access to non-sensitive fields only.
-- RLS row policy stays (slug IS NOT NULL); column-level GRANT is the extra guardrail
-- so PostgREST refuses to return sensitive columns to anon even if requested.
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id,
  slug,
  display_name,
  first_name,
  last_name,
  avatar_url,
  cover_url,
  bio,
  bio_pl,
  bio_en,
  job_title,
  current_company,
  specialization,
  twitter_url,
  linkedin_url,
  website_url,
  facebook_url,
  instagram_url,
  spotify_url,
  created_at
) ON public.profiles TO anon;
