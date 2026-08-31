-- PLASZCZYZNA WLASCICIELA: DWIE OSTATNIE REALNE DZIURY WZORCA
-- `user_id = auth.uid()` NA TABELI Z NOT NULL `tenant_id`.
--
-- Kontynuacja 20260829091010 (media_mentions, saved_searches, user_follows)
-- i 20260831060000 (szesc tabel monetyzacji). Ta migracja zamyka reszte.
--
-- JAK ZOSTALY ZNALEZIONE - i dlaczego nie grepem po migracjach. Wzorzec liczony
-- w migracjach daje liczbe zawyzona i nieaktualna: te same polityki sa
-- wielokrotnie DROP-owane i CREATE-owane, wiec jedno wystapienie w stanie
-- koncowym moze miec kilka trafien w plikach, a naprawione dziury nadal tam
-- swieca. Przeglad zrobiony wiec na STANIE KONCOWYM: wszystkie 931 migracji
-- zaaplikowane na lokalna replike (`scripts/pgtap-local/run.sh migrate`),
-- a potem zapytanie po `pg_policies` skrzyzowane z lista tabel majacych
-- `tenant_id NOT NULL`.
--
-- WYNIK: 579 polityk w `public`, z czego DZIESIEC pasowalo do wzorca
-- "wlasciciel przez auth.uid(), zero wzmianki o current_tenant_id".
-- Po przeczytaniu tresci PIEC z nich okazalo sie BEZPIECZNYCH - wiaza tenanta
-- innym idiomem, ktorego szukanie po `current_tenant_id` nie widzi:
--
--   * club_applications / club_applications_select_own  -> podzapytanie
--     `tenant_id = (SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid())`,
--   * event_audience_grants / ..._own_read              -> `_caller_tenant()`,
--   * event_package_orders / ..._buyer_read             -> `_caller_tenant()`,
--   * event_package_seats / ..._buyer_read              -> `_caller_tenant()`
--     plus domkniecie `o.tenant_id = event_package_seats.tenant_id` w EXISTS,
--   * notification_preferences / "own prefs insert"     -> tenant wiazany
--     w WITH CHECK podzapytaniem po `profiles`.
--
-- Zostaly DWIE tabele i PIEC polityk - naprawiane ponizej. Obie niosa DANE
-- OSOBOWE w rozumieniu RODO, co podnosi wage: historia czytania mowi, CO
-- konkretny czlowiek czytal, a wyniki testu osobowosci to profil psychometryczny.
--
-- ============================================================================
-- 1) user_read_history - CZTERY polityki, wyciek w OBIE strony
-- ============================================================================
-- Stan przed: SELECT/UPDATE/DELETE po `user_id = auth.uid()` i INSERT z takim
-- samym WITH CHECK. Skutki, kazdy osobny:
--   * ODCZYT - historia czytania zalozona w jednym obszarze roboczym byla
--     widoczna z kazdego innego (ten sam czlowiek, inny obszar),
--   * ZAPIS - `tenant_id` ma DEFAULT `current_tenant_id()`, ale default dziala
--     tylko wtedy, gdy kolumny NIE MA w INSERT-cie. Klient podajacy `tenant_id`
--     jawnie zapisywal wiersz do DOWOLNEGO obszaru, bo WITH CHECK o tenanta nie
--     pytal,
--   * UPDATE/DELETE - mozliwa byla zmiana i skasowanie cudzej-obszarowo historii.
--
-- DEFAULT zostaje wzmocniony do wzorca z 20260829091010: COALESCE z
-- `public_tenant_id()` chroni przed NULL-em w kontekscie bez zalogowanego
-- profilu (kolumna jest NOT NULL, wiec goly `current_tenant_id()` zwracajacy
-- NULL wywracalby INSERT).
ALTER TABLE public.user_read_history
  ALTER COLUMN tenant_id SET DEFAULT COALESCE(public.current_tenant_id(), public.public_tenant_id());

DROP POLICY IF EXISTS "read_history owner select" ON public.user_read_history;
CREATE POLICY "read_history owner select" ON public.user_read_history
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "read_history owner insert" ON public.user_read_history;
CREATE POLICY "read_history owner insert" ON public.user_read_history
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "read_history owner update" ON public.user_read_history;
CREATE POLICY "read_history owner update" ON public.user_read_history
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS "read_history owner delete" ON public.user_read_history;
CREATE POLICY "read_history owner delete" ON public.user_read_history
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

-- ============================================================================
-- 2) personality_result_history - JEDNA polityka, wyciek ODCZYTU
-- ============================================================================
-- Tabela ma WYLACZNIE polityke SELECT dla `authenticated` (zapis idzie sciezka
-- definera/service-role), wiec naprawa dotyczy odczytu - i tylko jego.
-- Swiadomie NIE dokladam tu polityk zapisu: nie ma ich dzis, a dodanie
-- powierzchni zapisu dla `authenticated` byloby zmiana produktowa przemycona
-- pod naprawa izolacji.
--
-- `tenant_id` nie ma tu DEFAULT-u (w odroznieniu od user_read_history) i tak
-- zostaje: skoro `authenticated` nie zapisuje, default nie ma czego chronic,
-- a nadanie go zmienialoby zachowanie sciezki definera.
DROP POLICY IF EXISTS "personality_history_owner_read" ON public.personality_result_history;
CREATE POLICY "personality_history_owner_read" ON public.personality_result_history
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = (SELECT public.current_tenant_id())
  );

COMMENT ON TABLE public.user_read_history IS
  'Historia czytania wpisow. Plaszczyzna wlasciciela jest tenant-scoped od 20260831170000 (odczyt i zapis).';
COMMENT ON TABLE public.personality_result_history IS
  'Historia wynikow testu osobowosci. Odczyt wlasciciela jest tenant-scoped od 20260831170000.';
