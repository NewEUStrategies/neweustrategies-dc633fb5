ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hide_avatar boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.hide_avatar IS
  'Gdy true, zdjecie profilowe nie jest wystawiane w wyszukiwarce, katalogu osob ani na publicznych powierzchniach (profiles_public).';

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off, security_barrier = true) AS
SELECT
  p.id,
  p.tenant_id,
  p.slug,
  p.display_name,
  p.first_name,
  p.last_name,
  CASE WHEN p.hide_avatar THEN NULL ELSE p.avatar_url END AS avatar_url,
  p.cover_url,
  p.bio_pl,
  p.bio_en,
  p.job_title,
  p.twitter_url,
  p.linkedin_url,
  p.facebook_url,
  p.instagram_url,
  p.spotify_url,
  p.website_url,
  p.current_company,
  p.specialization,
  p.verified_at,
  p.updated_at,
  p.expert_requests_enabled
FROM public.profiles p
WHERE
  (
    auth.uid() IS NOT NULL
    AND p.tenant_id = public.current_tenant_id()
    AND (
      p.id = auth.uid()
      OR p.discoverable = true
      OR public.caller_is_tenant_staff()
      OR public.caller_is_connected_to(p.id)
    )
  )
  OR (
    p.tenant_id = public.public_tenant_id()
    AND public.profile_has_public_presence(p.id, p.tenant_id)
  );

GRANT SELECT ON public.profiles_public TO anon, authenticated;

DO $do$
DECLARE
  r record;
  new_def text;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('search_people', 'search_people_orgs', 'search_chat_contacts')
  LOOP
    IF r.def LIKE '%hide_avatar%' THEN
      CONTINUE;
    END IF;
    new_def := regexp_replace(
      r.def,
      '(\m(p|pr)\.)avatar_url',
      'CASE WHEN \1hide_avatar THEN NULL ELSE \1avatar_url END',
      'g'
    );
    IF new_def <> r.def THEN
      EXECUTE new_def;
    END IF;
  END LOOP;
END
$do$;