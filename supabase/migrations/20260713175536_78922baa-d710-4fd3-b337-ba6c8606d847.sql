ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verified_by uuid;

COMMENT ON COLUMN public.profiles.verified_at IS
  'Weryfikacja zawodowa nadana przez admina (NULL = niezweryfikowany).';
COMMENT ON COLUMN public.profiles.verified_by IS
  'Admin, ktory nadal/odebral weryfikacje (audyt; bez grantu SELECT dla klientow).';

GRANT SELECT (verified_at) ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
      RAISE EXCEPTION 'profiles: verification can only be changed by an admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE UPDATE OF verified_at, verified_by ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_verification();

CREATE OR REPLACE FUNCTION public.admin_set_profile_verification(
  p_user_id uuid,
  p_verified boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = v_caller;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_target_tenant IS NULL OR v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'forbidden: target outside caller tenant';
  END IF;

  UPDATE public.profiles
     SET verified_at = CASE WHEN p_verified THEN now() ELSE NULL END,
         verified_by = CASE WHEN p_verified THEN v_caller ELSE NULL END
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_profile_verification(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verification(uuid, boolean)
  TO authenticated, service_role;