-- Autorytet weryfikacji profilu: JEDEN predykat, JEDNA bramka na kolumne.

CREATE OR REPLACE FUNCTION public.can_manage_profile_verification(
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND (
       public.has_role(_user_id, 'admin'::public.app_role)
       OR public.has_role(_user_id, 'super_admin'::public.app_role)
     )
$$;

COMMENT ON FUNCTION public.can_manage_profile_verification(uuid) IS
  'Jedyne zrodlo prawdy dla uprawnienia "zmiana weryfikacji profilu" (admin, super_admin). Czytaja z niego: trigger profiles_guard_verification, admin_set_profile_verification, admin_assert_verification_admin oraz polityka RLS verification_domains. Rola editor NIE nadaje weryfikacji - weryfikacja steruje odznaka, a odznaka expert nadaje dozywotni VIP.';

REVOKE ALL ON FUNCTION public.can_manage_profile_verification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_profile_verification(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
     AND NEW.verified_by IS NOT DISTINCT FROM OLD.verified_by THEN
    RETURN NEW;
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

  IF OLD.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION
      'profiles: verification can only be changed inside the caller workspace'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_verification() IS
  'Wlasciciel kolumn profiles.verified_at / verified_by. Odmowa jest TWARDA (42501), zeby proba samonadania weryfikacji zostawiala slad - cichy revert w profiles_guard_privileged_columns maskowal ja do 20260806150000.';

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE UPDATE OF verified_at, verified_by ON public.profiles
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
BEGIN
  IF NEW.current_company_id IS NOT DISTINCT FROM OLD.current_company_id THEN
    RETURN NEW;
  END IF;

  IF v_uid IS NULL
     OR COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF (public.has_role(v_uid, 'admin'::public.app_role)
      OR public.has_role(v_uid, 'super_admin'::public.app_role)
      OR public.has_role(v_uid, 'editor'::public.app_role))
     AND OLD.tenant_id IS NOT DISTINCT FROM public.current_tenant_id() THEN
    RETURN NEW;
  END IF;

  IF v_uid = OLD.id
     AND (
       NEW.current_company_id IS NULL
       OR EXISTS (
         SELECT 1 FROM public.crm_companies c
          WHERE c.id = NEW.current_company_id
            AND c.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
       )
     ) THEN
    RETURN NEW;
  END IF;

  NEW.current_company_id := OLD.current_company_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_privileged_columns() IS
  'Wlasciciel kolumny profiles.current_company_id: staff w swoim tenancie oraz WLASCICIEL wiersza (firma z jego tenanta) zapisuja, kazdy inny zapis jest po cichu wycofywany. Kolumny weryfikacji obsluguje profiles_guard_verification.';

DROP TRIGGER IF EXISTS profiles_guard_privileged_columns_trg ON public.profiles;
CREATE TRIGGER profiles_guard_privileged_columns_trg
  BEFORE UPDATE OF current_company_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_privileged_columns();

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
  IF NOT public.can_manage_profile_verification(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or super_admin role required'
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

REVOKE ALL ON FUNCTION public.admin_set_profile_verification(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verification(uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_assert_verification_admin()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF v_tenant IS NULL OR NOT public.can_manage_profile_verification(v_actor) THEN
    RAISE EXCEPTION 'verification: admin or super_admin role required'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assert_verification_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assert_verification_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS "verification domains staff read" ON public.verification_domains;
CREATE POLICY "verification domains staff read"
  ON public.verification_domains FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND (SELECT public.can_manage_profile_verification(auth.uid()))
  );

DO $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.profiles LOOP
    PERFORM public.sync_org_verification(v_id);
  END LOOP;
END;
$$;