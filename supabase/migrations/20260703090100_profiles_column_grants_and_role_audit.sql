-- ============================================================================
-- Security: (1) re-restrict profiles column grants, (2) atomic + audited role
-- management.
--
-- (1) profiles.email / profiles.prefs exposure (regression fix)
--     Migration 20260627150000 correctly replaced the table-level SELECT on
--     public.profiles with a column-level grant that excluded `email` and
--     `prefs` (a table-level SELECT satisfies the privilege check for ALL
--     columns, so earlier column REVOKEs were no-ops). Migration
--     20260629065015 then re-added `GRANT SELECT ON public.profiles TO
--     authenticated` ("restore missing table-level grants"), silently undoing
--     the fix - every signed-in user could read every user's e-mail again.
--
--     This migration re-applies the column-level model with the CURRENT
--     column list (the table has grown since June). Everything except `email`
--     and `prefs` stays readable (author bylines, public author boxes, own
--     profile editing). Own-row access to the private columns goes through
--     public.get_own_profile() below.
--
--     NOTE for future migrations: never `GRANT SELECT ON public.profiles`
--     table-wide again - add new PUBLIC columns to the column list instead.
--
-- (2) Role changes were a client-side DELETE + INSERT on user_roles - not
--     atomic (a failure between the two calls strips the user of every role),
--     unaudited, and the write policy let any tenant admin INSERT an arbitrary
--     role row - including granting themselves super_admin. Writes now go
--     exclusively through public.change_user_role(): one transaction, actor
--     authorization (only super_admin may touch super_admin), self-change
--     forbidden, every change recorded in public.role_audit_log.
-- ============================================================================

-- ---------- (1) profiles: column-level SELECT ----------

REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  display_name,
  avatar_url,
  cover_url,
  tenant_id,
  slug,
  bio,
  bio_pl,
  bio_en,
  contact_email,
  first_name,
  last_name,
  gender,
  phone,
  job_title,
  current_company,
  specialization,
  location,
  twitter_url,
  linkedin_url,
  website_url,
  facebook_url,
  instagram_url,
  spotify_url,
  created_at,
  updated_at
) ON public.profiles TO anon, authenticated;

-- Own-row access to the full profile (incl. email / prefs) for the account
-- screens and consent sync. SECURITY DEFINER bypasses the column grants but
-- is hard-scoped to auth.uid(), so it can never read anyone else's row.
CREATE OR REPLACE FUNCTION public.get_own_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid()
$$;

REVOKE ALL ON FUNCTION public.get_own_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated, service_role;

-- Admin user management needs tenant users WITH e-mail + roles. Gated on
-- admin / super_admin of the caller's tenant; editors and authors do not see
-- e-mail addresses. Replaces the client-side profiles+user_roles double query.
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  display_name text,
  email text,
  avatar_url text,
  cover_url text,
  slug text,
  bio text,
  bio_pl text,
  bio_en text,
  twitter_url text,
  linkedin_url text,
  website_url text,
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

-- ---------- (2) role audit log ----------

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

-- Clients never write the audit log directly - only via change_user_role()
-- (SECURITY DEFINER) and the service role.
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

-- ---------- (2) atomic, audited role change ----------

CREATE OR REPLACE FUNCTION public.change_user_role(
  _target_user_id uuid,
  _new_role public.app_role
)
RETURNS public.app_role[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid := auth.uid();
  v_actor_is_admin boolean;
  v_actor_is_super boolean;
  v_old_roles public.app_role[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant_context';
  END IF;

  v_actor_is_super := public.is_super_admin(v_actor);
  v_actor_is_admin := v_actor_is_super OR public.has_role(v_actor, 'admin');
  IF NOT v_actor_is_admin THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF _target_user_id = v_actor THEN
    RAISE EXCEPTION 'cannot_change_own_role';
  END IF;

  -- Target must belong to the actor's tenant.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _target_user_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'target_not_in_tenant';
  END IF;

  SELECT COALESCE(array_agg(role ORDER BY role), '{}'::public.app_role[])
  INTO v_old_roles
  FROM public.user_roles
  WHERE user_id = _target_user_id AND tenant_id = v_tenant;

  -- Only a super_admin may grant super_admin or demote one.
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

-- Close the direct-write escalation path: role rows are managed only through
-- change_user_role() (and the service role). The old "Admins manage tenant
-- roles" FOR ALL policy let any tenant admin INSERT e.g. a super_admin row
-- for themselves; "super_admin manages roles" is superseded by the function.
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;
DROP POLICY IF EXISTS "Admins manage tenant roles" ON public.user_roles;
DROP POLICY IF EXISTS "super_admin manages roles" ON public.user_roles;

-- Reads stay: own roles + tenant-wide for admins/super_admins.
DROP POLICY IF EXISTS "Admins view tenant roles" ON public.user_roles;
CREATE POLICY "Admins view tenant roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND (public.has_role(auth.uid(), 'admin') OR public.is_super_admin())
);
