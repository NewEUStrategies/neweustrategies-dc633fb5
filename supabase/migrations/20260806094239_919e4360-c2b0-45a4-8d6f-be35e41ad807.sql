CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_staff boolean;
BEGIN
  is_staff := public.has_role(auth.uid(), 'admin'::public.app_role)
           OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
           OR public.has_role(auth.uid(), 'editor'::public.app_role);

  IF is_staff OR COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.verified_at        := OLD.verified_at;
  NEW.verified_by        := OLD.verified_by;
  NEW.current_company_id := OLD.current_company_id;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.profiles LOOP
    PERFORM public.sync_org_verification(v_id);
  END LOOP;
END;
$$;