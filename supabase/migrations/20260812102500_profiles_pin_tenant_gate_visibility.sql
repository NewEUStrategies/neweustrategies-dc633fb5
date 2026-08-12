-- ============================================================================
-- BRAMKA profiles_pin_tenant_id ZNIKNELA Z MACIERZY UPRAWNIEN.
--
-- 20260812100000 naprawila martwy wyjatek serwerowy w przypieciu tenanta konta
-- i przy okazji wyniosla CALY warunek wyjatku - razem z literalem roli
-- `has_role(auth.uid(), 'super_admin')` - do osobnej funkcji
-- profiles_tenant_pin_bypass(). Zachowanie jest poprawne, ale kontrakt
-- autoryzacji przestal byc widoczny: scripts/generate-authz-snapshot.ts odtwarza
-- bramki z LITERALOW ROL w ciele funkcji, wiec po tamtej zmianie
-- `fn:profiles_pin_tenant_id/0` nie ma zadnego literalu i generator konczy sie
-- bledem "Macierz uprawnien wskazuje bramki, ktorych nie ma w migracjach"
-- (wiersz `tenant_pin` w src/lib/authz/permissionRows.ts:48).
--
-- To nie jest problem kosmetyczny: dopoki generator nie widzi bramki, macierz
-- /admin/permissions i snapshot nie moga sie zregenerowac, czyli KAZDA kolejna
-- zmiana bramki w bazie zostaje bez sygnalu - dokladnie ta klasa dryfu, ktorej
-- ten snapshot ma zapobiegac.
--
-- Naprawa: rozstrzygniecie roli serwerowej zostaje w funkcji pomocniczej (jedno
-- zrodlo prawdy dla obu warstw przypiecia), ale sprawdzenie `super_admin` wraca
-- do CIALA obu triggerow. Zachowanie sie nie zmienia - zmienia sie to, ze
-- uprawnienie jest znow czytelne dla generatora.
--
-- Forward-only: 20260812100000 jest juz zmergowana, wiec nie tykamy jej tresci.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_service_role_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT current_setting('role', true) = 'service_role'
      OR current_setting('request.jwt.claim.role', true) = 'service_role'
      OR auth.role() = 'service_role'
$$;

COMMENT ON FUNCTION public.is_service_role_caller() IS
  'Czy zapis idzie rola serwerowa (klucz service_role). Role wolajacego czytamy z GUC `role` oraz z roszczenia JWT w obu zapisach - w SECURITY DEFINER `current_user` pokazuje wlasciciela funkcji, nie wolajacego, wiec porownanie z current_user jest tam ZAWSZE falszywe.';

REVOKE ALL ON FUNCTION public.is_service_role_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_service_role_caller() FROM anon;
-- `profiles_pin_tenant` jest SECURITY INVOKER, wiec te bramke wola rola, ktora
-- aktualizuje profil: bez grantu legalny UPDATE wlasnego profilu konczylby sie
-- odmowa wykonania funkcji.
GRANT EXECUTE ON FUNCTION public.is_service_role_caller() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_pin_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := public.is_service_role_caller();
  -- Literal roli stoi TUTAJ, a nie w funkcji pomocniczej, bo z niego generator
  -- snapshotu odtwarza uprawnienie tej bramki (patrz naglowek migracji).
  v_is_super boolean := public.has_role(auth.uid(), 'super_admin'::public.app_role);
BEGIN
  IF v_is_service OR v_is_super THEN
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
  -- inaczej warstwa druga cicho uniewaznia serwerowy provisioning.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND NOT (
       public.is_service_role_caller()
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
     ) THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;
