CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    IF NOT (
      public.has_role(v_uid, 'admin'::app_role)
      OR public.has_role(v_uid, 'super_admin'::app_role)
      OR COALESCE(current_setting('app.verification_sync', true), '') = 'on'
    ) THEN
      RAISE EXCEPTION 'profiles: verification fields can only be changed by staff'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_verification() IS
  'Blokuje samonadanie profiles.verified_at/verified_by. Przechodzą: admin, super_admin oraz sweep domenowy (app.verification_sync=on).';