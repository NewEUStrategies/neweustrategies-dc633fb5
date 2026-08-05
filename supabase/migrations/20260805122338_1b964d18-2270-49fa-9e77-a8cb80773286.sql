-- 1) profiles: verification fields are staff-only
CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- service_role / internal SECURITY DEFINER paths have no auth.uid();
  -- staff (admin/super_admin/editor via is_staff) may change verification.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
      RAISE EXCEPTION 'profiles: verification fields can only be changed by staff'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

-- 2) speaker_profiles: internal CRM id must never be readable by clients
REVOKE ALL (crm_lead_id) ON public.speaker_profiles FROM anon, authenticated;
COMMENT ON COLUMN public.speaker_profiles.crm_lead_id IS
  'Internal CRM lead reference. Not granted to anon/authenticated; admin/service paths only.';