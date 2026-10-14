-- events-harness: include
-- ============================================================================
-- POTWIERDZENIE NADANE PRZEZ ADMINISTRATORA NIE DOWODZI SKRZYNKI; ADRES
-- POROWNYWANY BEZ UNICODE-OWEGO ZWIJANIA WIELKOSCI LITER
-- (PRZEGLAD R12: USTALENIE 4 I UWAGA O ZWIJANIU; REG-01, decyzja D1).
--
-- DEFEKT (latest: `_event_uid_owns_email`, 20261012130500:89-102)
--   1. D1 zaklada, ze `auth.users.email_confirmed_at` znaczy „wlasciciel
--      kliknal link w tej skrzynce". Administrator obszaru zaklada jednak
--      konta z `email_confirm: true` (src/lib/admin/invitations.functions.ts:
--      zaproszenie w trybie hasla tymczasowego - haslo widzi w panelu;
--      import zespolu `provisionTeamMembers`). Administrator obszaru A
--      zakladal konto victim@, logowal sie haslem tymczasowym i na stronie
--      wydarzenia obszaru B byl „zweryfikowany": dowiazanie kartoteki ofiary,
--      nadpisanie imienia i telefonu, zgody marketing/partnerzy z dowodem
--      `verified_account`, klucz samoobslugi i QR (powtorzone:
--      review/R12-identity-consents/p2_identity.sql, czesc E).
--   2. Obie strony porownania szly przez `lower()` z kolacja bazy. Przy
--      LC_CTYPE UTF-8 `lower()` zwija U+0130 'İ' i znak kelwina U+212A do
--      ASCII: konto z potwierdzonym 'kate@vİctim.com' „posiadalo"
--      kate@victim.com.
--
-- ZMIANA 20261012 (R12)
--   A. `auth_admin_provisioned_accounts` - rejestr kont zalozonych przez
--      administratora PRZED ta zmiana (wypelnia go 20261012180800 z
--      `user_invitations`; tej tabeli nie zna harness wydarzen). RLS bez
--      polityk, tylko service_role. Nowe konta niosa znacznik w
--      `auth.users.raw_app_meta_data` (`provisioned_by_admin`,
--      `provisioned_email`), ustawiany w tym samym `createUser`
--      (invitations.functions.ts) - bez okna, w ktorym konto jest bez znacznika.
--   B. `_event_account_admin_provisioned(konto)` - konto ma znacznik albo wiersz
--      rejestru DLA SWOJEGO OBECNEGO ADRESU. Dowodem skrzynki po fakcie jest
--      zmiana adresu konta potwierdzona mailem (GoTrue podmienia
--      `auth.users.email` dopiero po kliknieciu linku; serwer nie zmienia
--      adresu kontom kluczem serwisowym) - wtedy znacznik dotyczy juz innego
--      adresu i nie blokuje nowego. Odzyskanie hasla i logowanie linkiem NIE
--      sa takim dowodem: `auth.users` nie zapisuje ich trwale, a
--      administrator, ktory znal haslo tymczasowe, dalej moze sie nim
--      zalogowac, dopoki wlasciciel go nie zmieni.
--   C. `_event_uid_owns_email` - poza kontem oznaczonym jak wyzej; adresy
--      porownywane po `lower(... COLLATE "C")` (zwijanie WYLACZNIE A-Z).
--      Adres z wielka litera spoza ASCII i to samo male slowo po stronie
--      kartoteki sa wtedy rozne - falszywe „nie wlasciciel" (bezpieczny
--      kierunek: sciezka obcego + double opt-in), nigdy falszywe „wlasciciel".
--   D. `_event_person_account_risk` - nowa klasa `admin_provisioned` (konto
--      samo zalozylo osobe na swoj adres, ale ten adres potwierdzil
--      administrator); `foreign_record` nadal pierwsze. CHECK dziennika
--      odwiazan przyjmuje `admin_provisioned` i `suspect_takeover`
--      (20261012180650); naprawa historii nie zapisuje `suspect_takeover`.
--
-- CZEGO TO NIE ZAMYKA
--   * Konto oznaczone nie wiaze sie samo (zapis, profil uczestnika,
--     `event_my_account_link`, nabor prelegentow: `email_unverified`) -
--     jedyna droga to jawne przywrocenie przez organizatora z dziennika
--     (`admin_event_person_account_restore`, logowane) albo potwierdzona
--     zmiana adresu konta. Dotyczy tez kont importu zespolu, ktorych haslo
--     nigdy nie bylo pokazane (wejscie tylko przez odzyskanie hasla) -
--     swiadomie: rejestr nie odroznia ich od trybu hasla tymczasowego.
--   * Podszycie super_admina (`startImpersonation`) daje sesje dowolnego konta
--     najemcy - poza D1, opisane w R12-fix-notes.md.
--   * Konta zalozone kluczem serwisowym poza `invitations.functions.ts` (panel
--     Supabase, skrypty) - brak znacznika; grep `email_confirm` w src: dwa
--     miejsca, oba oznaczone.
-- KOLEJNOSC WDROZENIA: dowolna wzgledem kodu - stary kod zaklada konta bez
--   znacznika (luka zostaje do wdrozenia kodu), nowy kod na starej bazie
--   tylko dopisuje metadane. Backfill rejestru - 20261012180800. Odwiazanie
--   istniejacych dowiazan takich kont - naprawa 20261012190000/190100.
-- IDEMPOTENTNA: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE,
--   DROP CONSTRAINT IF EXISTS + ADD, bezstanowe REVOKE/GRANT, COMMENT ON.
-- DOWOD: supabase/tests/event_identity_consents_r12_test.sql (konto oznaczone
--   nie jest wlascicielem i nie wiaze sie; zmiana adresu konta zdejmuje
--   blokade; 'vİctim.com' != 'victim.com'), supabase/tests/reg_foundations_test.sql,
--   scripts/events-harness/runtime_test.d/25_account_binding_invites.sql.
-- ============================================================================

-- A) REJESTR KONT ZALOZONYCH PRZEZ ADMINISTRATORA (BACKFILL) ----------------------
CREATE TABLE IF NOT EXISTS public.auth_admin_provisioned_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Adres, dla ktorego administrator nadal potwierdzenie (ASCII-lower).
  email_norm text NOT NULL,
  -- Najemca i zaproszenie, z ktorego wynika wpis - slad dla audytu.
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  invitation_id uuid,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_admin_provisioned_accounts_source_values
    CHECK (source IN ('invitation_temp_password', 'team_provision')),
  CONSTRAINT auth_admin_provisioned_accounts_email_shape
    CHECK (email_norm = btrim(email_norm) AND email_norm <> '')
);

ALTER TABLE public.auth_admin_provisioned_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_admin_provisioned_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.auth_admin_provisioned_accounts TO service_role;

COMMENT ON TABLE public.auth_admin_provisioned_accounts IS
  'R12 (D1): konta zalozone przez administratora z potwierdzonym adresem (zaproszenie temp_password, import zespolu) PRZED znacznikiem app_metadata.provisioned_by_admin - wypelniane migracja z user_invitations. Potwierdzenie takiego konta nie dowodzi skrzynki (_event_account_admin_provisioned). RLS bez polityk, tylko service_role.';

-- B) CZY KONTO MA POTWIERDZENIE NADANE PRZEZ ADMINISTRATORA -----------------------
-- Dla OBECNEGO adresu konta: po potwierdzonej zmianie adresu znacznik dotyczy
-- adresu poprzedniego. Znacznik bez `provisioned_email` (ksztalt nieznany)
-- obejmuje kazdy adres - bezpieczny kierunek.
CREATE OR REPLACE FUNCTION public._event_account_admin_provisioned(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users u
     WHERE u.id = p_uid
       AND (
         (COALESCE(u.raw_app_meta_data->>'provisioned_by_admin', '') = 'true'
          AND COALESCE(NULLIF(lower(btrim(u.raw_app_meta_data->>'provisioned_email') COLLATE "C"), ''),
                       NULLIF(lower(btrim(u.email) COLLATE "C"), ''))
              IS NOT DISTINCT FROM NULLIF(lower(btrim(u.email) COLLATE "C"), ''))
         OR EXISTS (
           SELECT 1
             FROM public.auth_admin_provisioned_accounts a
            WHERE a.user_id = u.id
              AND a.email_norm = NULLIF(lower(btrim(u.email) COLLATE "C"), '')
         )
       )
  );
$$;
REVOKE ALL ON FUNCTION public._event_account_admin_provisioned(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_account_admin_provisioned(uuid) TO service_role;

COMMENT ON FUNCTION public._event_account_admin_provisioned(uuid) IS
  'R12 (D1): true, gdy potwierdzenie OBECNEGO adresu konta nadal administrator (app_metadata.provisioned_by_admin + provisioned_email albo wiersz auth_admin_provisioned_accounts). Potwierdzona zmiana adresu konta zdejmuje blokade dla nowego adresu. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- C) KONTO MA POTWIERDZONY TEN ADRES ------------------------------------------------
-- Cialo z 20261012130500:89-102; zmiany oznaczone.
CREATE OR REPLACE FUNCTION public._event_uid_owns_email(p_uid uuid, p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  -- ZMIANA 20261012 (R12): `lower(... COLLATE "C")` zwija wylacznie A-Z.
  -- Z kolacja bazy UTF-8 `lower()` sprowadzal 'İ' (U+0130) i znak kelwina
  -- (U+212A) do ASCII, wiec konto 'kate@vİctim.com' „mialo" kate@victim.com.
  SELECT p_uid IS NOT NULL
     AND NULLIF(lower(btrim(p_email) COLLATE "C"), '') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM auth.users u
        WHERE u.id = p_uid
          AND u.email_confirmed_at IS NOT NULL
          AND NULLIF(lower(btrim(u.email) COLLATE "C"), '') = NULLIF(lower(btrim(p_email) COLLATE "C"), '')
          -- ZMIANA 20261012 (R12): potwierdzenie nadane przez administratora
          -- (`email_confirm: true`) nie jest kliknieciem w skrzynce.
          AND NOT public._event_account_admin_provisioned(u.id)
     );
$$;
REVOKE ALL ON FUNCTION public._event_uid_owns_email(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_uid_owns_email(uuid, text) TO service_role;

COMMENT ON FUNCTION public._event_uid_owns_email(uuid, text) IS
  'REG-01 (D1): true wtedy i tylko wtedy, gdy konto ma POTWIERDZONY (auth.users.email_confirmed_at) adres rowny podanemu po btrim i zwinieciu wielkosci liter WYLACZNIE A-Z (COLLATE "C", R12) i to potwierdzenie nie zostalo nadane przez administratora (_event_account_admin_provisioned, R12). Brak konta, adresu lub potwierdzenia -> false (nigdy NULL). Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- D) KLASYFIKACJA DOWIAZANIA ----------------------------------------------------------
-- Cialo z 20261012132100:129-143; nowa galaz oznaczona.
CREATE OR REPLACE FUNCTION public._event_person_account_risk(p_user_id uuid, p_email_norm text, p_created_by uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    WHEN public._event_uid_owns_email(p_user_id, p_email_norm) THEN 'verified'
    WHEN NULLIF(btrim(COALESCE(p_email_norm, '')), '') IS NULL THEN 'no_email'
    WHEN p_created_by IS DISTINCT FROM p_user_id THEN 'foreign_record'
    -- ZMIANA 20261012 (R12): konto samo zalozylo osobe na SWOJ adres, ale ten
    -- adres potwierdzil administrator - nie podpis przejecia, tylko brak dowodu.
    WHEN public._event_account_admin_provisioned(p_user_id)
         AND EXISTS (
           SELECT 1 FROM auth.users u
            WHERE u.id = p_user_id
              AND u.email_confirmed_at IS NOT NULL
              AND NULLIF(lower(btrim(u.email) COLLATE "C"), '') = NULLIF(lower(btrim(p_email_norm) COLLATE "C"), '')
         ) THEN 'admin_provisioned'
    WHEN NOT EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
    ) THEN 'account_unconfirmed'
    ELSE 'self_created'
  END;
$$;
REVOKE ALL ON FUNCTION public._event_person_account_risk(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._event_person_account_risk(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public._event_person_account_risk(uuid, text, uuid) IS
  'REG-01: klasyfikacja dowiazania konta do osoby wydarzen - verified (D1: potwierdzony adres osoby) | no_email | foreign_record (osobe zalozyl ktos inny niz konto) | admin_provisioned (R12: adres osoby = adres konta, ale potwierdzenie nadal administrator) | account_unconfirmed | self_created; NULL bez konta. Jedna regula dla audytu, naprawy historii i ekranu organizatora. Pomocnicza: tylko service_role i funkcje SECURITY DEFINER.';

-- E) DZIENNIK ODWIAZAN: NOWE KLASY RYZYKA ----------------------------------------------
-- `suspect_takeover` - wylacznie odwiazanie przez organizatora osoby z listy
-- przegladu (20261012180650); naprawa historii odwiazuje tylko dowiazania
-- niespelniajace D1, wiec ani `verified`, ani `suspect_takeover`.
ALTER TABLE public.event_person_account_unbinds
  DROP CONSTRAINT IF EXISTS event_person_account_unbinds_risk_values;
ALTER TABLE public.event_person_account_unbinds
  ADD CONSTRAINT event_person_account_unbinds_risk_values CHECK (risk IN (
    'verified', 'no_email', 'foreign_record', 'account_unconfirmed', 'self_created',
    'admin_provisioned', 'suspect_takeover'
  ));
ALTER TABLE public.event_person_account_unbinds
  DROP CONSTRAINT IF EXISTS event_person_account_unbinds_remediation_unverified;
ALTER TABLE public.event_person_account_unbinds
  ADD CONSTRAINT event_person_account_unbinds_remediation_unverified
    CHECK (reason <> 'reg01_remediation' OR risk NOT IN ('verified', 'suspect_takeover'));
