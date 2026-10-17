-- ============================================================================
-- is_nes_staff: domena NES wyłącznie z POTWIERDZONEGO adresu logowania
-- (auth.users), nie z `profiles.email`, który zalogowany pisze sam.
--
-- LUKA (od 20260811224504). `public.is_nes_staff(uuid)` uznaje za sztab NES
--   cztery role platformy ALBO profil z `profiles.email` w domenie
--   @neweuropeanstrategies.com. Tę kolumnę zalogowany zmienia we własnym
--   wierszu: 20260915092000 (bliźniak drizzle 0024) nadaje `authenticated`
--   UPDATE na KAŻDĄ kolumnę `profiles` poza tenant_id, verified_at,
--   verified_by i completeness_score, polityka „Users update own profile"
--   wpuszcza własny wiersz, a żaden trigger nie pilnuje `email` (REG-01
--   w 20261012132000 mówi to wprost i z tego powodu przestał ufać tej
--   kolumnie). Jedno
--     PATCH /rest/v1/profiles?id=eq.<ja> {"email":"x@neweuropeanstrategies.com"}
--   robi więc z dowolnego konta sztab NES. `public.club_capabilities`
--   (20261007100100) daje sztabowi can_read w KAŻDYM klubie tenantu - także
--   secret, szkicu i archiwum - oraz prawa pisania w całym module, a
--   `public.club_user_can_read` (20261007100000) liczy z tego prawo
--   ODBIORCY wzmianek. Bramka sekretu list z 20261017130000 (`... OR
--   club_capabilities.can_read`) i predykat A19 karty `club_view`
--   (20261017120000) opierają się na can_read, więc ta jedna kolumna
--   otwierała z powrotem dokładnie te wycieki, które obie migracje zamknęły:
--   lista specjalizacji, club_list, licznik kafla i karta sekretu.
--
-- POPRAWKA. Ścieżka domeny czyta `auth.users.email` i wymaga
--   `email_confirmed_at IS NOT NULL` - reguła D1 (REG-01, `_event_uid_owns_email`
--   w 20261012130500): jedynym dowodem kontroli skrzynki jest potwierdzony
--   adres logowania; adres w profilu to deklaracja. Normalizacja lower+btrim
--   jak tam. Ścieżka ról (admin, super_admin, editor, author) - bez zmian,
--   tak samo NULL -> false, sygnatura, zwrotka, STABLE i SECURITY DEFINER
--   (auth.users nie jest czytelna dla ról klienta). search_path dostaje
--   pg_temp. Konsumentów (club_capabilities, club_user_can_read) nie trzeba
--   redefiniować: wołają funkcję po nazwie, więc biorą nowe ciało od razu.
--   CREATE OR REPLACE bez DROP - OID i zależności zostają.
--
-- DLACZEGO NIE `REVOKE UPDATE (email) ON public.profiles`. Blok DO
--   z 20260915092000 / 0024 wylicza kolumny przy KAŻDYM przebiegu i nadaje
--   UPDATE na wszystkie poza czterema, więc ponowne wykonanie cicho cofnęłoby
--   taki REVOKE. `profiles.email` jest też zwykłym polem kontaktowym profilu.
--   Decyzja o zaufaniu należy do funkcji, która nadaje uprawnienie.
--
-- GRANTY. Jak w 20260811224504: EXECUTE dla authenticated i service_role.
--   Tamta migracja nie zdjęła domyślnego EXECUTE dla PUBLIC, więc anonim mógł
--   pytać o status dowolnego uuid - REVOKE FROM PUBLIC, anon. Żadna polityka
--   RLS ani kod klienta (src/**) nie woła is_nes_staff; konsumenci w SQL to
--   funkcje SECURITY DEFINER, które biegną z prawami właściciela.
--
-- KTO TRACI STATUS. Konto bez żadnej z czterech ról, którego potwierdzony
--   adres logowania nie jest w domenie NES - czyli każdy, kto miał domenę
--   tylko w profilu. Przed wdrożeniem (i po nim) operator może je wypisać:
--     SELECT p.id, p.email, u.email AS login_email, u.email_confirmed_at
--       FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
--      WHERE lower(COALESCE(p.email, '')) LIKE '%@neweuropeanstrategies.com'
--        AND NOT (u.email_confirmed_at IS NOT NULL
--                 AND lower(btrim(COALESCE(u.email, ''))) LIKE '%@neweuropeanstrategies.com')
--        AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id
--                         AND r.role IN ('admin', 'super_admin', 'editor', 'author'));
--   Pracownik, który loguje się innym adresem, dostaje rolę (user_roles),
--   a nie wpis w profilu. Konto z niepotwierdzonym adresem NES czeka na
--   potwierdzenie - przy `enable_confirmations = true` (supabase/config.toml)
--   GoTrue i tak nie daje mu sesji.
--
-- DOWÓD: supabase/tests/nes_staff_auth_email_test.sql (pgTAP, pełny schemat)
--   i sekcja NESR w scripts/pg-harness/runtime_test.sql - czerwone na ciele
--   z 20260811224504 (profil z domeną NES listuje sekret), zielone po tej
--   migracji.
--
-- KOLEJNOŚĆ: po 20261017130000 (bramka sekretu list), choć niezależna od
--   niej. POWTÓRNE WYKONANIE BEZPIECZNE (CREATE OR REPLACE, COMMENT,
--   REVOKE/GRANT są idempotentne). Bliźniak drizzle:
--   0299_is_nes_staff_confirmed_auth_email (ten sam SQL wykonywalny).
--
-- PO WDROŻENIU: nowy build NIE jest potrzebny. Anonim (dokumenty SSR i edge
--   cache) nigdy nie był sztabem - auth.uid() IS NULL daje false w obu
--   wersjach - a listy, licznik i karta zalogowanego biegną w przeglądarce
--   (React Query -> POST /rpc), więc biorą nowe ciało przy następnym
--   zapytaniu.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_nes_staff(_user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (
       public.has_role(_user_id, 'admin')
       OR public.has_role(_user_id, 'super_admin')
       OR public.has_role(_user_id, 'editor')
       OR public.has_role(_user_id, 'author')
       -- Domena NES tylko z POTWIERDZONEGO adresu logowania (D1, REG-01).
       -- profiles.email pisze sam zalogowany, wiec nie jest dowodem niczego.
       OR EXISTS (
         SELECT 1 FROM auth.users u
          WHERE u.id = _user_id
            AND u.email_confirmed_at IS NOT NULL
            AND lower(btrim(COALESCE(u.email, ''))) LIKE '%@neweuropeanstrategies.com'
       )
     );
$function$;

COMMENT ON FUNCTION public.is_nes_staff(uuid) IS
  'Sztab NES: rola admin, super_admin, editor albo author, ALBO potwierdzony adres logowania (auth.users.email z email_confirmed_at) w domenie @neweuropeanstrategies.com. Nie czyta profiles.email - te kolumne zalogowany pisze sam, a sztab dostaje can_read w kazdym klubie tenantu (club_capabilities). NULL -> false. Od 20261017140000.';

REVOKE EXECUTE ON FUNCTION public.is_nes_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_nes_staff(uuid) TO authenticated, service_role;
