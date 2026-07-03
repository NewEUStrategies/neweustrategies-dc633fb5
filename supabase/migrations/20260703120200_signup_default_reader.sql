-- ============================================================================
-- handle_new_user: close self-service tenant + admin provisioning (re-audit N4).
--
-- Problem: signup_type defaulted to 'staff' and was read from
-- raw_user_meta_data - metadata the CLIENT fully controls in auth.signUp. A
-- direct signUp call (or the /login form, which sent no signup_type at all)
-- therefore CREATED A NEW TENANT and granted the caller the admin role in it.
-- Blast radius: junk tenants + self-provisioned admins.
--
-- New contract:
--   * default is 'reader' - every client-driven signup joins the DEFAULT
--     tenant with the plain 'user' role;
--   * the tenant-creation ('staff') path is honoured ONLY from
--     raw_APP_meta_data, which clients cannot set - it is written exclusively
--     by the service role (auth.admin.createUser / inviteUserByEmail), i.e. a
--     deliberate server-side provisioning act;
--   * an explicit 'reader' in either metadata stays a reader (the UI's
--     LoginPopup already sends it - unchanged behaviour);
--   * bootstrap stays: the very first profile in the default tenant becomes
--     its admin, so a fresh install can be set up at all.
--
-- The default tenant is resolved via tenants.is_default with the legacy seed
-- (slug 'nes') as fallback - consistent with public_tenant_id().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_tenant uuid;
  v_tenant_id uuid;
  v_slug text;
  v_first_in_default boolean;
  v_app_signup text;
  v_user_signup text;
  v_role app_role;
BEGIN
  -- Server-controlled (service role only) vs client-controlled metadata.
  v_app_signup  := NEW.raw_app_meta_data->>'signup_type';
  v_user_signup := NEW.raw_user_meta_data->>'signup_type';

  SELECT COALESCE(
    (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
    (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1)
  ) INTO v_default_tenant;
  IF v_default_tenant IS NULL THEN
    RAISE EXCEPTION 'handle_new_user: no default tenant configured';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE tenant_id = v_default_tenant
  ) INTO v_first_in_default;

  IF COALESCE(v_app_signup, v_user_signup) = 'reader' THEN
    -- Explicit reader stays a reader, even as the very first account.
    v_tenant_id := v_default_tenant;
    v_role := 'user';
  ELSIF v_app_signup = 'staff' THEN
    -- Server-provisioned staff signup: create the tenant, grant admin.
    -- Reachable only through the service role (app_metadata is not settable
    -- from the client SDK), so this is a deliberate operator action.
    v_slug := lower(regexp_replace(
      coalesce(NEW.raw_app_meta_data->>'tenant_slug',
               NEW.raw_user_meta_data->>'tenant_slug',
               split_part(NEW.email, '@', 2),
               split_part(NEW.email, '@', 1)),
      '[^a-z0-9]+', '-', 'g'));
    IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) THEN
      v_slug := v_slug || '-' || substr(NEW.id::text, 1, 8);
    END IF;
    INSERT INTO public.tenants (slug, name)
    VALUES (v_slug,
      coalesce(NEW.raw_app_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'tenant_name',
               NEW.raw_user_meta_data->>'display_name',
               split_part(NEW.email, '@', 1)))
    RETURNING id INTO v_tenant_id;
    v_role := 'admin';
  ELSIF v_first_in_default THEN
    -- Bootstrap: the first account of a fresh install administers the
    -- default tenant (there is no other way to mint the initial admin).
    v_tenant_id := v_default_tenant;
    v_role := 'admin';
  ELSE
    -- Everyone else - including a client-side signUp that spoofs
    -- signup_type='staff' in user_metadata - is a plain reader.
    v_tenant_id := v_default_tenant;
    v_role := 'user';
  END IF;

  INSERT INTO public.profiles (id, email, display_name, tenant_id)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    v_tenant_id);

  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES (NEW.id, v_role, v_tenant_id);

  RETURN NEW;
END $function$;

-- Not callable directly by any client role (the trigger runs as owner);
-- restated here because CREATE OR REPLACE keeps, but should document, the ACL.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_new_user() IS
  'auth.users AFTER INSERT provisioning. Default: reader (''user'' role) in '
  'the default tenant. Tenant creation + admin only via '
  'raw_app_meta_data.signup_type=''staff'' (service-role provisioning) or the '
  'first-account bootstrap of the default tenant. Client-controlled '
  'raw_user_meta_data can only choose ''reader'', never escalate.';
