-- ============================================================================
-- PR #39 bundle: apply four security migrations that shipped in the repo but
-- were never executed against the database:
--   * 20260703090000_remove_super_admin_backdoor
--   * 20260703090100_profiles_column_grants_and_role_audit
--   * 20260703090200_tenant_domains
--   * 20260703090300_redirects_tenant_scope
-- ============================================================================

-- ---------- (A) remove_super_admin_backdoor ----------
DROP TRIGGER IF EXISTS on_auth_user_created_grant_super_admin ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_super_admin ON auth.users;
DROP FUNCTION IF EXISTS public.grant_super_admin_for_marketing_email();

-- ---------- (B) profiles column grants ----------
REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, display_name, avatar_url, cover_url, tenant_id, slug,
  bio, bio_pl, bio_en, contact_email, first_name, last_name,
  gender, phone, job_title, current_company, specialization, location,
  twitter_url, linkedin_url, website_url, facebook_url, instagram_url, spotify_url,
  created_at, updated_at
) ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_own_profile()
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.profiles WHERE id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.get_own_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid, display_name text, email text, avatar_url text, cover_url text, slug text,
  bio text, bio_pl text, bio_en text,
  twitter_url text, linkedin_url text, website_url text,
  created_at timestamptz, updated_at timestamptz,
  roles public.app_role[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p.id, p.display_name, p.email, p.avatar_url, p.cover_url, p.slug,
    p.bio, p.bio_pl, p.bio_en, p.twitter_url, p.linkedin_url, p.website_url,
    p.created_at, p.updated_at,
    COALESCE(
      (SELECT array_agg(ur.role ORDER BY ur.role)
       FROM public.user_roles ur
       WHERE ur.user_id = p.id AND ur.tenant_id = p.tenant_id),
      '{}'::public.app_role[]
    ) AS roles
  FROM public.profiles p
  WHERE p.tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
$$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;

-- ---------- (C) role_audit_log ----------
CREATE TABLE IF NOT EXISTS public.role_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id uuid,
  target_user_id uuid NOT NULL,
  old_roles public.app_role[] NOT NULL DEFAULT '{}',
  new_roles public.app_role[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS role_audit_log_tenant_created_idx
  ON public.role_audit_log (tenant_id, created_at DESC);

REVOKE ALL ON public.role_audit_log FROM anon, authenticated;
GRANT SELECT ON public.role_audit_log TO authenticated;
GRANT ALL ON public.role_audit_log TO service_role;

ALTER TABLE public.role_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read role audit" ON public.role_audit_log;
CREATE POLICY "Admins read role audit" ON public.role_audit_log
FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
);

-- ---------- (D) atomic change_user_role ----------
CREATE OR REPLACE FUNCTION public.change_user_role(
  _target_user_id uuid, _new_role public.app_role
)
RETURNS public.app_role[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid := auth.uid();
  v_actor_is_admin boolean;
  v_actor_is_super boolean;
  v_old_roles public.app_role[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant_context'; END IF;

  v_actor_is_super := public.is_super_admin(v_actor);
  v_actor_is_admin := v_actor_is_super OR public.has_role(v_actor, 'admin');
  IF NOT v_actor_is_admin THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _target_user_id = v_actor THEN RAISE EXCEPTION 'cannot_change_own_role'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _target_user_id AND tenant_id = v_tenant
  ) THEN RAISE EXCEPTION 'target_not_in_tenant'; END IF;

  SELECT COALESCE(array_agg(role ORDER BY role), '{}'::public.app_role[])
  INTO v_old_roles
  FROM public.user_roles
  WHERE user_id = _target_user_id AND tenant_id = v_tenant;

  IF NOT v_actor_is_super
     AND (_new_role = 'super_admin' OR 'super_admin' = ANY (v_old_roles)) THEN
    RAISE EXCEPTION 'super_admin_required';
  END IF;

  DELETE FROM public.user_roles
   WHERE user_id = _target_user_id AND tenant_id = v_tenant;
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (_target_user_id, _new_role, v_tenant);
  INSERT INTO public.role_audit_log (tenant_id, actor_id, target_user_id, old_roles, new_roles)
  VALUES (v_tenant, v_actor, _target_user_id, v_old_roles, ARRAY[_new_role]);

  RETURN ARRAY[_new_role];
END;
$$;
REVOKE ALL ON FUNCTION public.change_user_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_user_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;
DROP POLICY IF EXISTS "Admins manage tenant roles" ON public.user_roles;
DROP POLICY IF EXISTS "super_admin manages roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins view tenant roles" ON public.user_roles;
CREATE POLICY "Admins view tenant roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
);

-- ---------- (E) tenant_domains ----------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_domain_key
  ON public.tenants (lower(domain)) WHERE domain IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_single_default
  ON public.tenants (is_default) WHERE is_default;

UPDATE public.tenants SET is_default = true WHERE slug = 'nes';

-- ---------- (F) redirects tenant scope ----------
ALTER TABLE public.redirects
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.redirects SET tenant_id = public.public_tenant_id() WHERE tenant_id IS NULL;

ALTER TABLE public.redirects
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id();

ALTER TABLE public.redirects DROP CONSTRAINT IF EXISTS redirects_source_path_key;
CREATE UNIQUE INDEX IF NOT EXISTS redirects_source_per_tenant
  ON public.redirects (tenant_id, source_path);

DROP INDEX IF EXISTS redirects_enabled_idx;
CREATE INDEX IF NOT EXISTS redirects_tenant_enabled_idx
  ON public.redirects (tenant_id) WHERE is_enabled;

DROP POLICY IF EXISTS "Staff reads redirects" ON public.redirects;
CREATE POLICY "Staff reads redirects" ON public.redirects FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')));
DROP POLICY IF EXISTS "Staff inserts redirects" ON public.redirects;
CREATE POLICY "Staff inserts redirects" ON public.redirects FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')));
DROP POLICY IF EXISTS "Staff updates redirects" ON public.redirects;
CREATE POLICY "Staff updates redirects" ON public.redirects FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')))
  WITH CHECK (tenant_id = public.current_tenant_id()
              AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')));
DROP POLICY IF EXISTS "Staff deletes redirects" ON public.redirects;
CREATE POLICY "Staff deletes redirects" ON public.redirects FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')));

-- ---------- (G) seo_404_hits tenant scope ----------
ALTER TABLE public.seo_404_hits
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

UPDATE public.seo_404_hits SET tenant_id = public.public_tenant_id() WHERE tenant_id IS NULL;

ALTER TABLE public.seo_404_hits ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE public.seo_404_hits DROP CONSTRAINT IF EXISTS seo_404_hits_pkey;
ALTER TABLE public.seo_404_hits ADD PRIMARY KEY (tenant_id, path);

DROP POLICY IF EXISTS "Staff reads 404 hits" ON public.seo_404_hits;
CREATE POLICY "Staff reads 404 hits" ON public.seo_404_hits FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')));
DROP POLICY IF EXISTS "Staff deletes 404 hits" ON public.seo_404_hits;
CREATE POLICY "Staff deletes 404 hits" ON public.seo_404_hits FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id()
         AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor')));

DROP FUNCTION IF EXISTS public.record_seo_404(text, text);
CREATE OR REPLACE FUNCTION public.record_seo_404(
  _tenant_id uuid, _path text, _referrer text DEFAULT NULL
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.seo_404_hits AS h (tenant_id, path, last_referrer)
  VALUES (_tenant_id, left(_path, 500), left(_referrer, 500))
  ON CONFLICT (tenant_id, path) DO UPDATE
  SET hits = h.hits + 1,
      last_seen = now(),
      last_referrer = COALESCE(EXCLUDED.last_referrer, h.last_referrer);
$$;
REVOKE ALL ON FUNCTION public.record_seo_404(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_seo_404(uuid, text, text) TO service_role;