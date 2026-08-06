-- Bramka pól weryfikacji profilu: przywrócenie `super_admin` i twardego 42501.
--
-- CO SIĘ STAŁO: migracja `20260806094104` (weryfikacja po domenie e-mail)
-- przepisała ciało `profiles_guard_verification()` z wariantu lipcowego,
-- dokładając potrzebną furtkę `app.verification_sync`, ale przy okazji
-- ZAWĘŻAJĄC krąg uprawnionych z `admin OR super_admin` (stan z
-- `20260805122338`) do samego `admin` i gubiąc `ERRCODE = '42501'`.
-- Skutki, wszystkie realne:
--   * `super_admin` bez osobnej roli `admin` przestał móc nadawać i odbierać
--     weryfikację profilu - a weryfikacja steruje odznaką, odznaka eksperta
--     pociąga dożywotni dostęp VIP (`sync_expert_vip_grant`),
--   * naruszenie leciało jako `P0001`, więc klient nie mógł go odróżnić od
--     błędu logiki i pokazać komunikatu "brak uprawnień" (cała reszta modułu
--     rzuca 42501: `admin_grant_profile_badge`, `admin_assert_verification_admin`),
--   * snapshot autoryzacji (`src/lib/authz/authzSnapshot.generated.ts`) rozjechał
--     się z migracjami i położył suitę na `main`.
--
-- INTENCJA (rozstrzygnięta zgodnie z resztą modułu): weryfikację nadaje
-- `admin` ORAZ `super_admin`. Dokładnie taki krąg trzymają bramki-rodzeństwo
-- wprowadzone tą samą migracją `20260806094104`:
--   * `admin_assert_verification_admin()` - `has_role(admin) OR is_super_admin()`,
--   * polityka RLS `verification domains staff read` - ten sam warunek,
--   * `admin_grant_profile_badge()` (odznaka `verified`) - ten sam warunek,
--   * `profiles_guard_privileged_columns()` - staff = admin/super_admin/editor.
-- Zawężenie do `admin` było więc niezamierzoną regresją, nie decyzją produktową.
--
-- `is_super_admin()` (nie `has_role(super_admin)`) świadomie: `has_role` jest
-- skalowane tenantem domowym wołającego (`ur.tenant_id = current_tenant_id()`),
-- a super-admin platformy pracuje ponad tenantami - tak samo rozstrzygają
-- pozostałe bramki tego modułu.
--
-- WARSTWY OBRONY na `public.profiles` (kolejność triggerów jest alfabetyczna):
--   1. `profiles_guard_privileged_columns_trg` - dla NIE-staffu CICHO przywraca
--      `verified_at`/`verified_by`/`current_company_id` (zwykły użytkownik nie
--      dostaje błędu, tylko jego wartości nie mają skutku),
--   2. `profiles_guard_verification_trg` (ta funkcja) - dla staffu bez prawa do
--      weryfikacji (czyli `editor`) zmiana przechodzi warstwę 1., więc tutaj
--      MUSI polec głośno: 42501.
-- Dzięki temu eskalacja przez `editor`a jest błędem, a nie cichym no-opem.

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

  -- service_role / wewnętrzne ścieżki SECURITY DEFINER nie mają auth.uid().
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Synchronizacja weryfikacji po domenie e-mail (`sync_org_verification`)
  -- ustawia tę flagę transakcyjnie na czas własnego zapisu.
  IF COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT (
       public.has_role(v_uid, 'admin'::app_role)
       OR public.is_super_admin(v_uid)
     ) THEN
    RAISE EXCEPTION 'profiles: verification fields can only be changed by an admin or super admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_verification() IS
  'Bramka kolumn weryfikacji profilu: zmianę verified_at/verified_by dopuszcza '
  'wyłącznie admin lub super_admin (albo ścieżka serwisowa bez auth.uid(), albo '
  'synchronizacja domenowa z flagą app.verification_sync). Naruszenie = 42501. '
  'Patrz docs/WERYFIKACJA_PROFILI.md.';

-- Trigger bez klauzuli `OF`: wersja kolumnowa nie odpaliłaby się, gdyby
-- `verified_at` ustawił BEFORE-trigger, a nie lista SET w UPDATE.
DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

-- Ręczna ścieżka weryfikacji (Panel → Społeczność) musi mieć ten sam krąg
-- uprawnionych, co bramka triggera - inaczej super_admin przechodzi trigger,
-- ale odbija się od RPC. Skalowanie danych zostaje bez zmian (tenant domowy
-- wołającego), zmienia się wyłącznie warunek rolowy i kod błędu.
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
  IF v_caller IS NULL
     OR NOT (
       public.has_role(v_caller, 'admin'::app_role)
       OR public.is_super_admin(v_caller)
     ) THEN
    RAISE EXCEPTION 'forbidden: admin or super admin role required'
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
