-- Profil członka (/people/<slug>) - każda zarejestrowana osoba w tenancie.
-- Autor (/author/<slug>) = rola author/editor/admin/super_admin nadana przez
-- admina LUB zaakceptowane zaproszenie mailowe z taką rolą.
CREATE OR REPLACE FUNCTION public.is_platform_author(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role IN ('author','editor','admin','super_admin')
  ) OR EXISTS (
    SELECT 1 FROM public.user_invitations
     WHERE auth_user_id = _user_id
       AND status = 'accepted'
       AND role IN ('author','editor','admin','super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_platform_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_author(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_member_profile(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public._caller_tenant();
  r public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM public.profiles
   WHERE slug = p_slug AND tenant_id = v_tenant LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r.id <> v_uid AND NOT COALESCE(r.discoverable, false)
     AND NOT public._are_connected(v_uid, r.id) THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', r.id,
    'slug', r.slug,
    'display_name', COALESCE(NULLIF(trim(r.display_name), ''),
                             NULLIF(trim(concat_ws(' ', r.first_name, r.last_name)), ''), r.slug),
    'avatar_url', CASE WHEN COALESCE(r.hide_avatar, false) THEN NULL ELSE r.avatar_url END,
    'cover_url', r.cover_url,
    'job_title', r.job_title,
    'company', r.current_company,
    'location', r.location,
    'bio_pl', COALESCE(r.bio_pl, r.bio),
    'bio_en', COALESCE(r.bio_en, r.bio),
    'specialization', r.specialization,
    'linkedin_url', r.linkedin_url,
    'website_url', r.website_url,
    'verified', r.verified_at IS NOT NULL,
    'is_self', r.id = v_uid,
    'is_author', public.is_platform_author(r.id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_member_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_profile(text) TO authenticated;

-- Publiczna (anon) informacja wyłącznie "czy slug należy do nie-autora" -
-- potrzebna do 301 z /author na /people bez ujawniania danych osoby.
CREATE OR REPLACE FUNCTION public.member_slug_is_non_author(p_slug text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.slug = p_slug AND NOT public.is_platform_author(p.id)
  );
$$;
REVOKE ALL ON FUNCTION public.member_slug_is_non_author(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_slug_is_non_author(text) TO anon, authenticated, service_role;