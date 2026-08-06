-- Bramki kolumn `profiles`: PARYTET INSERT/UPDATE i koniec zależności od
-- alfabetycznej kolejności triggerów.
--
-- CO SIĘ ZEPSUŁO. `20260806150000` (autorytet weryfikacji) słusznie rozdzieliła
-- własność kolumn - jedna kolumna = jedna bramka - ale przepięła OBA triggery na
-- `BEFORE UPDATE OF <kolumna>`. To cofnęło dwie rzeczy:
--
--   1. POKRYCIE INSERT, dodane świadomie w `20260806130000`. Polityka
--      `"Users insert own profile"` (20260721105920) pozwala wstawić WŁASNY
--      wiersz `profiles`, gdy jeszcze/już go nie ma (skasowany profil przy żywym
--      koncie `auth.users`, nieudany provisioning). Bramka na samym UPDATE nie
--      widzi takiego wiersza, więc `INSERT ... verified_at = now()` przechodził
--      bez kontroli - a `verified_at` steruje odznaką `verified`, odznaka
--      `expert` pociąga DOŻYWOTNI VIP (`sync_expert_vip_grant`). Kontrakt
--      pgTAP (`tgtype = 23`) mówił „BEFORE INSERT OR UPDATE"; migracje mówiły 19.
--      Ten sam brak dotyczył `current_company_id`: wiersz mógł URODZIĆ SIĘ
--      wskazujący firmę z OBCEGO obszaru roboczego, bo walidacja tenanta stała
--      wyłącznie w gałęzi UPDATE.
--
--   2. NIEZALEŻNOŚĆ OD KOLEJNOŚCI TRIGGERÓW. `BEFORE UPDATE OF kolumna` odpala
--      się według LISTY `SET` w zapytaniu, a nie według realnej zmiany wartości.
--      Kolumny spoza tej listy, podstawione przez wcześniejszy trigger BEFORE
--      (nazwy sortują się alfabetycznie), mijają bramkę bez śladu - dokładnie tę
--      klasę defektu `20260806150000` opisała jako przyczynę źródłową i
--      zostawiła jako założenie „żaden inny trigger nie pisze po tych
--      kolumnach", którego nic nie pilnuje. Wersja bez `OF` nie ma tego
--      założenia: bramka jest właścicielem kolumny bez względu na to, kto i
--      kiedy podstawił wartość. Kosztu wydajności nie ma - wyjście przez
--      `IS NOT DISTINCT FROM` jest pierwszą instrukcją, PRZED jakimkolwiek
--      zapytaniem do katalogu.
--
-- CZEGO TA MIGRACJA NIE ZMIENIA: kręgu uprawnionych. Decyzję „kto może" nadal
-- podejmuje JEDEN predykat `can_manage_profile_verification()` (admin,
-- super_admin), z którego czytają trigger, RPC panelu, RPC domen weryfikacji i
-- polityka RLS `verification_domains`. Weryfikację nadaje się WYŁĄCZNIE w
-- obszarze roboczym wiersza - inaczej admin tenanta A stemplowałby odznakę
-- (i dożywotniego VIP-a) w tenancie B.
--
-- TENANT WIERSZA: `OLD.tenant_id` przy UPDATE, `NEW.tenant_id` przy INSERT.
-- `profiles_pin_tenant_id_bu` / `_bi` odpalają się PO tych bramkach
-- (alfabetycznie: `profiles_g…` < `profiles_p…`), więc przy UPDATE `NEW` może
-- jeszcze nieść tenanta podstawionego przez wołającego - tenantem wiersza jest
-- wtedy zawsze `OLD`. Przy INSERT `OLD` nie istnieje i jedyną deklaracją jest
-- `NEW`; porównanie z `current_tenant_id()` zamyka podstawienie, bo obcy tenant
-- w `NEW` prowadzi do odmowy, a nie do przejścia bramki.

-- ---------------------------------------------------------------------------
-- 1) verified_at / verified_by - twarda odmowa (42501), INSERT + UPDATE
-- ---------------------------------------------------------------------------
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
    -- INSERT nie ma OLD: pytanie brzmi „czy wiersz RODZI SIĘ zweryfikowany".
    IF NEW.verified_at IS NULL AND NEW.verified_by IS NULL THEN
      RETURN NEW;
    END IF;
    v_row_tenant := NEW.tenant_id;
  ELSE
    -- Samoobsługowy UPDATE profilu posyła te kolumny bez zmiany wartości (PATCH
    -- z pełnym wierszem), więc brak realnej różnicy przepuszczamy bez pytania
    -- o rolę. To jednocześnie jedyny koszt bramki na zapisach, które jej nie
    -- dotyczą: dwa porównania, zero zapytań.
    IF NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
       AND NEW.verified_by IS NOT DISTINCT FROM OLD.verified_by THEN
      RETURN NEW;
    END IF;
    v_row_tenant := OLD.tenant_id;
  END IF;

  -- Ścieżki systemowe: brak sesji (service_role, cron, definer poza żądaniem
  -- HTTP) oraz sankcjonowana furtka synchronizacji po domenie e-mail
  -- (`sync_org_verification` ustawia flagę lokalnie na czas własnego zapisu).
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

-- Bez klauzuli `OF`: bramka jest właścicielem kolumny niezależnie od listy `SET`
-- w zapytaniu i od kolejności triggerów BEFORE.
DROP TRIGGER IF EXISTS profiles_guard_verification_trg ON public.profiles;
CREATE TRIGGER profiles_guard_verification_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_verification();

-- ---------------------------------------------------------------------------
-- 2) current_company_id - cichy revert, INSERT + UPDATE, zawsze w tenancie
-- ---------------------------------------------------------------------------
-- Dlaczego cicho, a nie 42501: to nie jest ścieżka eskalacji uprawnień, a
-- „przypisz firmę" ma własny RPC (`link_current_company`) z jawnymi błędami
-- `company_not_found` / `tenant_mismatch`. Wyjątek z triggera wywalałby
-- niepowiązane zapisy do profilu, które przypadkiem przenoszą tę kolumnę.
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
  -- Tenant wiersza: FAKT przy UPDATE, DEKLARACJA wołającego przy INSERT.
  v_row_tenant uuid;
  -- Tenant, do którego musi należeć firma.
  v_scope_tenant uuid;
BEGIN
  -- Kolumny weryfikacji NIE należą do tej bramki - ich właścicielem jest
  -- profiles_guard_verification (twarde 42501). Dublowanie własności kończyło
  -- się dryfem zbiorów ról i utratą śladu po naruszeniu (20260806150000).
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

  -- Przy INSERT `NEW.tenant_id` jest deklaracją wołającego - `profiles_pin_tenant_id_bi`
  -- przestawi ją PO tej bramce - więc firmę walidujemy względem tenanta WOŁAJĄCEGO.
  -- Przy UPDATE tenant wiersza jest już faktem i to on wyznacza zakres.
  v_scope_tenant := CASE WHEN TG_OP = 'INSERT' THEN v_caller_tenant ELSE v_row_tenant END;

  -- Staff (admin/super_admin/editor) przypisuje firmę w SWOIM obszarze roboczym.
  IF v_row_tenant IS NOT DISTINCT FROM v_caller_tenant
     AND (
       public.has_role(v_uid, 'admin'::public.app_role)
       OR public.has_role(v_uid, 'super_admin'::public.app_role)
       OR public.has_role(v_uid, 'editor'::public.app_role)
     ) THEN
    RETURN NEW;
  END IF;

  -- Właściciel wiersza: firma z obszaru roboczego albo odłączenie. To ścieżka UI
  -- (`link_current_company` / „odłącz firmę" w CompanyPickerDialog), więc cofanie
  -- jej byłoby defektem, nie zabezpieczeniem: członek dostawał zielony toast i
  -- zero zmiany w bazie (naprawione w 20260806150000). W oknie self-INSERT-u
  -- (profil jeszcze nie istnieje) `current_tenant_id()` jest NULL-em, więc żadna
  -- firma nie przejdzie - i słusznie: wiersz ma się urodzić bez wskazania, a
  -- przypisanie idzie potem przez RPC, który waliduje tenanta jawnym błędem.
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

  -- Cichy revert. Przy INSERT nie ma czego przywracać - wiersz rodzi się bez
  -- firmy, zamiast rodzić się z firmą z obcego obszaru roboczego.
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

-- ---------------------------------------------------------------------------
-- 3) Higiena stanu: wiersze wskazujące firmę z obcego obszaru roboczego
-- ---------------------------------------------------------------------------
-- Okno, w którym takie wiersze mogły powstać: INSERT bez bramki (do tej
-- migracji) oraz UPDATE przed 20260806150000. Odłączamy wskazanie - nazwa firmy
-- w wolnym polu `current_company` zostaje, bo to dane wpisane przez użytkownika,
-- nie referencja między obszarami roboczymi.
UPDATE public.profiles p
   SET current_company_id = NULL
 WHERE p.current_company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.crm_companies c
      WHERE c.id = p.current_company_id
        AND c.tenant_id IS NOT DISTINCT FROM p.tenant_id
   );
