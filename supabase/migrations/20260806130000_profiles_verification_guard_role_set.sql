-- ============================================================================
-- GUARD PÓL WERYFIKACJI: przywrócenie `super_admin` + jawny kontrakt bramki.
--
-- ROOT CAUSE. Migracja 20260806094104 (weryfikacja po domenie e-mail) dopisała
-- do `profiles_guard_verification()` sankcjonowaną furtkę synchronizacji
-- (`app.verification_sync`), ale zrobiła to na bazie NAJSTARSZEJ definicji
-- guardu (20260713160000), a nie ostatniej żywej (20260805122338). Skutkiem
-- ubocznym - nieopisanym w żadnej zmianie - było:
--   * ZAWĘŻENIE kręgu uprawnionych z `admin` + `super_admin` do samego `admin`,
--     czyli `super_admin` bez osobno nadanej roli `admin` przestał móc nadawać
--     i odbierać weryfikację profilu;
--   * utrata `ERRCODE = 42501` (odmowa wracała jako P0001, więc klient nie
--     mógł odróżnić braku uprawnień od błędu logiki);
--   * rozjazd snapshotu autoryzacji (`src/lib/authz/authzSnapshot.generated.ts`),
--     który kładł test parytetu macierzy uprawnień na `main`.
--
-- DLACZEGO `super_admin` WRACA (a nie: dokumentujemy zawężenie). Cały pozostały
-- osprzęt tej samej ścieżki - w tym fragmenty tej samej migracji 20260806094104 -
-- konsekwentnie mówi `admin` OR `super_admin`:
--   * polityka RLS `"Admins can update tenant profiles"` (20260731185816) wprost
--     pozwala `super_admin` aktualizować profile w swoim tenancie - guard
--     przeczył polityce, która go przepuszczała;
--   * `admin_assert_verification_admin()` i polityka `"verification domains
--     staff read"` (20260806094104) - `has_role(admin) OR is_super_admin()`;
--   * `admin_grant_profile_badge()` (20260803113000), czyli nadanie tej samej
--     odznaki `verified` inną drogą - `has_role(admin) OR is_super_admin()`;
--   * bliźniaczy `profiles_guard_privileged_columns()` (20260806094239, commit
--     obok) zachował pełny zbiór stafowy.
-- Zawężenie było więc regresem, nie decyzją: `super_admin` mógł dodać domenę
-- weryfikującą (a przez `sync_org_verification` nadać odznakę automatycznie),
-- ale nie mógł nadać jej ręcznie. W module, w którym weryfikacja steruje
-- odznaką, a odznaka `expert` pociąga dożywotni VIP (20260805201517), taka
-- niespójność jest nie do utrzymania.
--
-- KONTRAKT (pilnowany przez supabase/tests/profiles_verification_guard_test.sql
-- oraz przez snapshot bramek i test parytetu macierzy uprawnień):
--   1. `verified_at` / `verified_by` zmienia WYŁĄCZNIE `admin` albo `super_admin`
--      (celowo BEZ `editor`: to samo zawężenie ma `admin_grant_profile_badge`);
--   2. odmowa = `RAISE EXCEPTION ... ERRCODE 42501`;
--   3. ścieżki wewnętrzne bez sesji (`service_role`, cron, definer poza żądaniem)
--      przechodzą - brak `auth.uid()` nie jest samonadaniem;
--   4. sankcjonowana furtka `app.verification_sync = 'on'` (ustawiana lokalnie
--      wyłącznie przez `sync_org_verification()`) przechodzi;
--   5. bramka obowiązuje też przy INSERT - patrz uzasadnienie niżej.
--
-- NOWE POKRYCIE: INSERT. Polityka `"Users insert own profile"` (20260721105920)
-- pozwala użytkownikowi wstawić WŁASNY wiersz `profiles`, a oba guardy
-- (`privileged_columns`, `verification`) były BEFORE UPDATE - self-insert z
-- `verified_at = now()` przechodził bez kontroli w oknie, w którym wiersz
-- profilu nie istnieje (skasowany profil przy żywym koncie `auth.users`,
-- nieudane provisioning'owe utworzenie profilu). `upsert` klienta trafia w
-- konflikt PK i idzie ścieżką UPDATE, więc luka była wąska, ale realna.
-- Ścieżki systemowe pozostają nietknięte: `handle_new_user()` i
-- `invitations.functions.ts` wstawiają profil bez `auth.uid()` (service_role)
-- i bez pól weryfikacji.
-- ============================================================================

-- ── (1) Guard: jeden zbiór uprawnionych, jeden ERRCODE, dwie sankcjonowane
--        furtki, pokrycie INSERT + UPDATE ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.profiles_guard_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_touches_verification boolean;
BEGIN
  -- INSERT nie ma OLD: sprawdzamy, czy wiersz RODZI SIĘ zweryfikowany.
  IF TG_OP = 'INSERT' THEN
    v_touches_verification := NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL;
  ELSE
    v_touches_verification := NEW.verified_at IS DISTINCT FROM OLD.verified_at
                              OR NEW.verified_by IS DISTINCT FROM OLD.verified_by;
  END IF;

  IF NOT v_touches_verification THEN
    RETURN NEW;
  END IF;

  -- Ścieżki wewnętrzne bez sesji użytkownika (service_role, cron, definer
  -- wywołany poza żądaniem HTTP) - nie ma tu samonadania do zablokowania.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sankcjonowana furtka synchronizacji domenowej: `sync_org_verification()`
  -- ustawia flagę lokalnie na czas własnego UPDATE (20260806094104).
  IF COALESCE(current_setting('app.verification_sync', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin'::app_role)
    OR public.is_super_admin(v_uid)
  ) THEN
    RAISE EXCEPTION
      'profiles: verification fields can only be changed by admin or super_admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_guard_verification() IS
  'Bramka pól verified_at/verified_by na public.profiles. Uprawnieni: admin lub '
  'super_admin (bez editor - parytet z admin_grant_profile_badge). Odmowa: 42501. '
  'Przechodzą: brak auth.uid() (service_role/cron) oraz app.verification_sync = on '
  '(sync_org_verification). Obowiązuje na INSERT i UPDATE. Zbiór rol jest źródłem '
  'wiersza profile_verification w macierzy uprawnien (snapshot bramek).';

DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

-- ── (2) RPC nadania/odebrania weryfikacji: ten sam zbiór ról co guard ───────
-- Bez tego kroku naprawa guardu jest martwa dla `super_admin`: RPC (jedyna
-- ścieżka zapisu z panelu, src/routes/admin.users.$id.tsx) nadal odrzucałaby
-- go na własnej bramce. Komunikat celowo zachowuje frazę "admin role required"
-- (kontrakt asercji w supabase/tests/people_verification_test.sql), dochodzi
-- brakujący ERRCODE 42501. Skalowanie tenantem zostaje - `super_admin` działa
-- w swoim tenancie domowym, tak jak w polityce "Admins can update tenant
-- profiles".
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
  IF v_caller IS NULL
     OR NOT (
       public.has_role(v_caller, 'admin'::app_role)
       OR public.is_super_admin(v_caller)
     ) THEN
    RAISE EXCEPTION 'forbidden: admin role required'
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

COMMENT ON FUNCTION public.admin_set_profile_verification(uuid, boolean) IS
  'Ręczne nadanie/odebranie weryfikacji profilu w tenancie wołającego. '
  'Uprawnieni: admin lub super_admin (parytet z profiles_guard_verification). '
  'Odmowa: 42501. Ustawia verified_at + verified_by (audyt w kolumnach). '
  'Odznaka profile_badges jest odrębną warstwą - patrz docs/WERYFIKACJA_PROFILI.md.';

REVOKE ALL ON FUNCTION public.admin_set_profile_verification(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_verification(uuid, boolean)
  TO authenticated, service_role;
