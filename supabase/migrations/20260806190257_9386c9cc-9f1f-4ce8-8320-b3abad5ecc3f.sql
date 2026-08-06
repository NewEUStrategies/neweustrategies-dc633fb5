-- Bramki kolumn `profiles`: PARYTET INSERT/UPDATE i koniec zależności od
-- alfabetycznej kolejności triggerów.

CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row_tenant uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verified_at IS NULL AND NEW.verified_by IS NULL THEN
      RETURN NEW;
    END IF;
    v_row_tenant := NEW.tenant_id;
  ELSE
    IF NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
       AND NEW.verified_by IS NOT DISTINCT FROM OLD.verified_by THEN
      RETURN NEW;
    END IF;
    v_row_tenant := OLD.tenant_id;
  END IF;

  IF v_uid IS NULL
     OR COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT public.can_manage_profile_verification(v_uid) THEN
    RAISE EXCEPTION
      'profiles: verification fields can only be changed by admin or super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF v_row_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION
      'profiles: verification can only be changed inside the caller workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_verification() IS
  'Wlasciciel kolumn profiles.verified_at / verified_by na INSERT i UPDATE. Kto moze: can_manage_profile_verification() (admin, super_admin) i tylko w obszarze roboczym wiersza. Odmowa jest TWARDA (42501), zeby proba samonadania zostawiala slad. Przechodza: brak auth.uid() (service_role/cron) oraz app.verification_sync = on (sync_org_verification). Patrz docs/WERYFIKACJA_PROFILI.md.';

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

CREATE OR REPLACE FUNCTION public.profiles_guard_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller_tenant uuid;
  v_row_id uuid;
  v_row_tenant uuid;
  v_scope_tenant uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_company_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_row_id := NEW.id;
    v_row_tenant := NEW.tenant_id;
  ELSE
    IF NEW.current_company_id IS NOT DISTINCT FROM OLD.current_company_id THEN
      RETURN NEW;
    END IF;
    v_row_id := OLD.id;
    v_row_tenant := OLD.tenant_id;
  END IF;

  IF v_uid IS NULL
     OR COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  v_caller_tenant := public.current_tenant_id();

  v_scope_tenant := CASE WHEN TG_OP = 'INSERT' THEN v_caller_tenant ELSE v_row_tenant END;

  IF v_row_tenant IS NOT DISTINCT FROM v_caller_tenant
     AND (
       public.has_role(v_uid, 'admin'::public.app_role)
       OR public.has_role(v_uid, 'super_admin'::public.app_role)
       OR public.has_role(v_uid, 'editor'::public.app_role)
     ) THEN
    RETURN NEW;
  END IF;

  IF v_uid = v_row_id
     AND (
       NEW.current_company_id IS NULL
       OR EXISTS (
         SELECT 1 FROM public.crm_companies c
          WHERE c.id = NEW.current_company_id
            AND c.tenant_id IS NOT DISTINCT FROM v_scope_tenant
       )
     ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.current_company_id := NULL;
  ELSE
    NEW.current_company_id := OLD.current_company_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_privileged_columns() IS
  'Wlasciciel kolumny profiles.current_company_id na INSERT i UPDATE: zapisuja staff w swoim tenancie oraz WLASCICIEL wiersza (firma z tenanta wiersza albo odlaczenie), kazdy inny zapis jest po cichu wycofywany - przy INSERT do NULL, przy UPDATE do wartosci poprzedniej. Kolumny weryfikacji obsluguje profiles_guard_verification.';

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns_trg ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_privileged_columns();

UPDATE public.profiles p
   SET current_company_id = NULL
 WHERE p.current_company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.crm_companies c
      WHERE c.id = p.current_company_id
        AND c.tenant_id IS NOT DISTINCT FROM p.tenant_id
   );