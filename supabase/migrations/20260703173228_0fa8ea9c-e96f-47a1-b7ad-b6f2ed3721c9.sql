
CREATE OR REPLACE FUNCTION public.admin_get_user(_user_id uuid)
RETURNS TABLE (
  id uuid,
  email text,
  display_name text,
  first_name text,
  last_name text,
  avatar_url text,
  cover_url text,
  slug text,
  bio text,
  bio_pl text,
  bio_en text,
  job_title text,
  current_company text,
  specialization text,
  location text,
  phone text,
  contact_email text,
  gender name_gender,
  twitter_url text,
  linkedin_url text,
  website_url text,
  facebook_url text,
  instagram_url text,
  spotify_url text,
  prefs jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  roles public.app_role[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.email, p.display_name, p.first_name, p.last_name,
    p.avatar_url, p.cover_url, p.slug,
    p.bio, p.bio_pl, p.bio_en,
    p.job_title, p.current_company, p.specialization, p.location,
    p.phone, p.contact_email, p.gender,
    p.twitter_url, p.linkedin_url, p.website_url,
    p.facebook_url, p.instagram_url, p.spotify_url,
    p.prefs, p.created_at, p.updated_at,
    COALESCE(
      (SELECT array_agg(ur.role ORDER BY ur.role)
       FROM public.user_roles ur
       WHERE ur.user_id = p.id AND ur.tenant_id = p.tenant_id),
      '{}'::public.app_role[]
    ) AS roles
  FROM public.profiles p
  WHERE p.id = _user_id
    AND p.tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
$$;

REVOKE ALL ON FUNCTION public.admin_get_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO authenticated, service_role;
