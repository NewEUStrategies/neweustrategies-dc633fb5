CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_touches_verification boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_touches_verification := NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL;
  ELSE
    v_touches_verification := NEW.verified_at IS DISTINCT FROM OLD.verified_at
                              OR NEW.verified_by IS DISTINCT FROM OLD.verified_by;
  END IF;

  IF NOT v_touches_verification THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.is_super_admin(v_uid)
  ) THEN
    RAISE EXCEPTION
      'profiles: verification fields can only be changed by admin or super_admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_verification() IS
  'Bramka pol verified_at/verified_by na public.profiles. Uprawnieni: admin lub super_admin. Odmowa: 42501. Przechodza: brak auth.uid() oraz app.verification_sync = on. Obowiazuje na INSERT i UPDATE.';

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

CREATE OR REPLACE FUNCTION public.admin_set_profile_verification(
  p_user_id uuid,
  p_verified boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  IF v_caller IS NULL
     OR NOT (
       public.has_role(v_caller, 'admin'::app_role)
       OR public.is_super_admin(v_caller)
     ) THEN
    RAISE EXCEPTION 'forbidden: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = v_caller;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_target_tenant IS NULL OR v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'forbidden: target outside caller tenant'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET verified_at = CASE WHEN p_verified THEN now() ELSE NULL END,
         verified_by = CASE WHEN p_verified THEN v_caller ELSE NULL END
   WHERE id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.admin_set_profile_verification(uuid, boolean) IS
  'Reczne nadanie/odebranie weryfikacji profilu w tenancie wolajacego. Uprawnieni: admin lub super_admin. Odmowa: 42501.';

REVOKE ALL ON FUNCTION public.admin_set_profile_verification(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verification(uuid, boolean)
  TO authenticated, service_role;