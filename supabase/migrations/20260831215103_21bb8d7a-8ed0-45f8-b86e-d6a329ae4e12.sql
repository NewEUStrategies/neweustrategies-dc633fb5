-- BLIZNIAK TRESCI: 20260831170000_owner_plane_tenant_scope_read_history.sql
--
-- TEN PLIK NIE WNOSI ZMIANY. Pipeline wdrozeniowy wydal go ponownie przy
-- wdrozeniu PR #312 (commit `528abb5`, 2026-08-31 21:51:17) i przy okazji zdjal
-- WSZYSTKIE 62 linie komentarza z pliku z PR-a (113 -> 51 linii). Tresc wykonywana
-- jest identyczna po odjeciu komentarzy - md5 okrojonej tresci `a90cb00acee0` po obu
-- stronach pary.
--
-- UWAGA NA DATOWANIE: wersja w nazwie tego pliku (20260831215103) to chwila
-- ZASTOSOWANIA przez pipeline, a NIE chwila wejscia zmiany. Zmiana weszla
-- z wersja 20260831170000, czyli 4 h 51 min wczesniej. Kto datuje regresje po
-- katalogu migracji albo po `schema_migrations` - a przy commitach nazwanych
-- „Changes" to jedyne narzedzie, jakie zostaje - trafia najpierw tutaj.
--
-- GDZIE LEZY UZASADNIENIE: w pliku wskazanym w naglowku wyzej. Jest tam przeglad
-- zrobiony na STANIE KONCOWYM polityk (nie grepem po migracjach), lista piatki
-- polityk odrzuconych jako bezpieczne wraz z idiomem, ktory je wiaze, oraz powod,
-- dla ktorego te dwie tabele zostaly. Tu tego nie ma i nie bedzie - duplikowanie
-- argumentu w dwoch plikach konczy sie tym, ze rozjezdzaja sie po cichu.
--
-- DLACZEGO PLIK ZOSTAJE, ZAMIAST ZOSTAC SKASOWANY: wersja 20260831215103 siedzi
-- w `schema_migrations` na wdrozonej bazie, a `supabase/migration-ledger.json`
-- (sekcja `reconciled`) mapuje na nia plik z PR-a. Usuniecie duplikatu
-- zostawiloby wiersz rejestru bez pliku i wywrocilo kolejny `db push`. Para jest
-- zarejestrowana jako dlug w `KNOWN_CONTENT_TWINS` (`src/lib/ci/migrationReplay.ts`).

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