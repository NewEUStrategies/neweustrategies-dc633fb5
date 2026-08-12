-- ============================================================================
-- WYJATEK OD PRZYPIECIA profiles.tenant_id BYL MARTWY.
--
-- 20260721052806 wprowadzila twarde przypiecie tenanta konta ("profiles.tenant_id
-- is immutable") i zapisala wprost, ze provisioning idzie triggerami albo rola
-- serwerowa. Ten wyjatek nie dzialal ani razu, z trzech niezaleznych powodow:
--
--   1. warunek `current_user = 'service_role'` stoi w funkcji SECURITY DEFINER,
--      wiec `current_user` to WLASCICIEL funkcji (postgres), a nie wolajacy.
--      Reszta repo czyta role wolajacego z GUC `role` (20260711085449,
--      20260713080601, 20260730175806) - tutaj tego zabraklo;
--   2. drugie roszczenie, `request.jwt.claim.role`, to forma sprzed PostgREST 9.
--      Dzisiejszy stack wystawia wylacznie `request.jwt.claims`, dlatego
--      auth.role() czyta oba zapisy - ta bramka czytala tylko starszy;
--   3. nawet po przejsciu tej bramki starszy trigger `profiles_pin_tenant_tg`
--      (20260628211642 / 20260628230000) CICHO cofal tenant_id, bo nie ma
--      zadnego wyjatku, a odpala sie po `profiles_pin_tenant_id_bu`.
--
-- Skutek: serwerowe przypisanie tenanta do ISTNIEJACEGO konta albo konczylo sie
-- bledem 42501, albo - dla super_admina - "udawalo sie" bez zapisu. Snapshot
-- autoryzacji opisuje `fn:profiles_pin_tenant_id/0` jako brame o anyRoles
-- ['super_admin'], czyli kontrakt mowil o uprawnieniu, ktorego baza nie dawala.
--
-- Przypiecie dla WLASCICIELA wiersza zostaje nienaruszone: zwykly UPDATE nadal
-- dostaje 42501 (rls_tenant_isolation_test), oba triggery zostaja na miejscu,
-- a wyjatek ma teraz jedno zrodlo prawdy - nie rozwijamy bramki roli inline
-- w dwoch funkcjach.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.profiles_tenant_pin_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT current_setting('role', true) = 'service_role'
      OR current_setting('request.jwt.claim.role', true) = 'service_role'
      OR auth.role() = 'service_role'
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
$$;

COMMENT ON FUNCTION public.profiles_tenant_pin_bypass() IS
  'Jedyna brama wyjatku od przypiecia profiles.tenant_id: rola serwerowa (provisioning) albo super_admin. Role wolajacego czytamy z GUC `role` i z roszczenia JWT - w SECURITY DEFINER `current_user` pokazuje wlasciciela funkcji, nie wolajacego.';

REVOKE ALL ON FUNCTION public.profiles_tenant_pin_bypass() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profiles_tenant_pin_bypass() FROM anon;
-- `profiles_pin_tenant` jest SECURITY INVOKER, wiec bramke wola rola, ktora
-- aktualizuje profil - bez tego grantu legalny UPDATE wlasnego profilu
-- konczylby sie odmowa wykonania funkcji.
GRANT EXECUTE ON FUNCTION public.profiles_tenant_pin_bypass() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_pin_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bypass boolean := public.profiles_tenant_pin_bypass();
BEGIN
  IF v_bypass THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force new self-inserts to the caller's provisioned tenant. If none yet,
    -- fall back to the default tenant so the row is still valid.
    IF NEW.id = auth.uid() THEN
      NEW.tenant_id := COALESCE(
        (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
        NEW.tenant_id,
        (SELECT id FROM public.tenants WHERE is_default = true LIMIT 1)
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: tenant_id is immutable for the row owner.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'profiles.tenant_id is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Druga warstwa przypiecia: ciche cofniecie zamiast bledu, zeby legalne
  -- UPDATE-y innych kolumn przechodzily. Ten sam wyjatek co warstwa pierwsza -
  -- inaczej warstwa druga cicho unieważnia serwerowy provisioning.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND NOT public.profiles_tenant_pin_bypass() THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;