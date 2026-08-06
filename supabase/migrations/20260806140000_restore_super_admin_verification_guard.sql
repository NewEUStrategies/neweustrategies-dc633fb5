-- ============================================================================
-- profiles_guard_verification: PRZYWRÓCENIE roli super_admin.
--
-- PRZYCZYNA ŹRÓDŁOWA. Migracja 20260805122338 nadała guardowi kontrakt
-- „weryfikację zmienia wyłącznie STAFF" i wymieniała w warunku dwie role:
--
--     NOT (has_role(uid, 'admin') OR has_role(uid, 'super_admin'))
--
-- Późniejsza 20260806094104 przepisała funkcję (dokładając furtkę
-- `app.verification_sync` dla sweepu weryfikacji domenowej) i przy okazji
-- ZGUBIŁA drugą gałąź - w żywej definicji został sam 'admin'.
--
-- To NIE jest równoważne zawężenie. public.has_role() dopasowuje rolę
-- DOKŁADNIE (`ur.role = _role`, migracja 20260625160054) - nie ma hierarchii
-- ról, więc konto mające wyłącznie `super_admin` przestało móc nadawać i
-- zdejmować weryfikację: trafia w `RAISE EXCEPTION` zamiast przejść bramkę.
-- Utrata uprawnienia jest cicha, bo dotyczy tylko roli, której nie używa się
-- w testach dymnych na koncie administratora - dokładnie ta klasa defektu,
-- którą opisuje nagłówek scripts/check-sql-app-role-literals.ts.
--
-- Wykrycie: bramka parytetu snapshotu autoryzacji
-- (src/lib/authz/__tests__/authzSnapshotParity.test.ts) pokazała rozjazd
-- `anyRoles` snapshotu ['admin','super_admin'] vs migracji ['admin'].
-- Regeneracja snapshotu bez tej migracji **utrwaliłaby regresję**.
--
-- Ta migracja odtwarza pełny zbiór ról, ZACHOWUJĄC oba zachowania dodane
-- 06.08: furtkę `app.verification_sync` (sweep domenowy działa pod
-- service_role bez auth.uid()) oraz wcześniejsze wyjście dla ścieżek bez
-- sesji. Kod błędu 42501 wraca z 20260805122338 - „brak uprawnień" to czysta
-- odmowa, nie błąd wewnętrzny.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Ścieżki service_role / wewnętrzne SECURITY DEFINER nie mają auth.uid().
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by THEN
    IF NOT (
      public.has_role(v_uid, 'admin'::app_role)
      OR public.has_role(v_uid, 'super_admin'::app_role)
      -- Sweep weryfikacji domenowej (runOrgVerificationSweep) ustawia tę flagę
      -- na czas transakcji; poza nią pozostaje pusta.
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
  'Blokuje samonadanie profiles.verified_at/verified_by. Przechodzą: admin, super_admin oraz sweep domenowy (app.verification_sync=on). has_role dopasowuje rolę DOKŁADNIE - przy edycji tej funkcji wymieniaj OBIE role jawnie, inaczej super_admin cicho traci uprawnienie (regresja z 20260806094104).';
