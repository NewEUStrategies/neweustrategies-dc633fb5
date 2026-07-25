
CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_staff boolean;
BEGIN
  -- Staff (admin/super_admin/editor) may modify verification + company linkage.
  is_staff := public.has_role(auth.uid(), 'admin'::public.app_role)
           OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
           OR public.has_role(auth.uid(), 'editor'::public.app_role);

  IF is_staff THEN
    RETURN NEW;
  END IF;

  -- Non-staff: silently preserve privileged columns on self-update.
  NEW.verified_at       := OLD.verified_at;
  NEW.verified_by       := OLD.verified_by;
  NEW.current_company_id := OLD.current_company_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns_trg ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_guard_privileged_columns();
