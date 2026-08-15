-- Asercje runtime po scaleniu tabel programów (20260815100000).
--
-- Sprawdzamy SKUTKI, nie składnię: bramki `check:sql-*` czytają migracje jako
-- tekst i nie zobaczą ani zgubionego wiersza, ani polityki, która po zmianie
-- kształtu przestała cokolwiek filtrować.

\set ON_ERROR_STOP on
SET nes.public_tenant = '11111111-0000-0000-0000-000000000001';
SET nes.tenant        = '11111111-0000-0000-0000-000000000001';
SET nes.uid           = 'aaaaaaaa-0000-0000-0000-00000000000a';

DO $t$
DECLARE
  v_n        integer;
  v_txt      text;
  v_bool     boolean;
  v_asserts  integer := 0;
BEGIN
  -- ── 1. Jedna tabela, jeden widok ─────────────────────────────────────────
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'research_programs' AND c.relkind = 'v';
  ASSERT v_n = 1, 'research_programs musi byc WIDOKIEM po scaleniu';
  v_asserts := v_asserts + 1;

  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'research_programs' AND c.relkind = 'r';
  ASSERT v_n = 0, 'stara TABELA research_programs nie moze przetrwac';
  v_asserts := v_asserts + 1;

  -- security_invoker jest warunkiem izolacji: bez niego widok omija RLS.
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'research_programs'
       AND 'security_invoker=true' = ANY (c.reloptions)
  ) INTO v_bool;
  ASSERT v_bool, 'widok research_programs MUSI miec security_invoker = true';
  v_asserts := v_asserts + 1;

  -- ── 2. Nic nie zginelo ───────────────────────────────────────────────────
  -- 3 wiersze slownika + 2 huby bez kolizji (`bezpieczenstwo`, `szkic`);
  -- `energia` scalone w istniejacy wiersz slownika.
  SELECT count(*) INTO v_n FROM public.programs;
  ASSERT v_n = 5, format('oczekiwano 5 programow po scaleniu, jest %s', v_n);
  v_asserts := v_asserts + 1;

  -- Identyfikatory hubow bez kolizji sa ZACHOWANE - inaczej kotwice watkow
  -- klubowych (anchor_id jako text, bez FK) wskazywalyby w prozanie.
  SELECT count(*) INTO v_n FROM public.programs
   WHERE id = 'f0000000-0000-0000-0000-000000000002';
  ASSERT v_n = 1, 'id huba bez kolizji musi byc zachowane';
  v_asserts := v_asserts + 1;

  -- Kolizja: zostaje wiersz SLOWNIKA (na niego wskazuja FK tresci).
  SELECT count(*) INTO v_n FROM public.programs
   WHERE id = 'f0000000-0000-0000-0000-000000000001';
  ASSERT v_n = 0, 'przy kolizji slugu wiersz huba nie moze zostac zdublowany';
  v_asserts := v_asserts + 1;

  -- ── 3. Kolizja scalila DANE, a nie tylko wiersze ─────────────────────────
  SELECT tagline_pl INTO v_txt FROM public.programs WHERE id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_txt = 'Transformacja energetyczna', 'warstwa redakcyjna musi trafic na wiersz slownika';
  v_asserts := v_asserts + 1;

  SELECT description_pl INTO v_txt FROM public.programs WHERE id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_txt = 'Opis ze slownika' OR v_txt = 'Opis ze słownika',
    'opis ze slownika nie moze zostac nadpisany przez scalenie';
  v_asserts := v_asserts + 1;

  SELECT count(*) INTO v_n FROM public.programs
   WHERE id = 'e0000000-0000-0000-0000-000000000001'
     AND category_id = 'cccccccc-0000-0000-0000-00000000000c'
     AND contact_email = 'energia@example.org'
     AND accent_color = '#0f172a'
     AND icon = 'Zap'
     AND jsonb_array_length(research_questions) = 1;
  ASSERT v_n = 1, 'wszystkie pola redakcyjne musza przejsc na wiersz po scaleniu';
  v_asserts := v_asserts + 1;

  -- ── 4. Dzieci wskazuja na scalony program ────────────────────────────────
  SELECT count(*) INTO v_n FROM public.research_program_members
   WHERE program_id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_n = 1, 'czlonkowie huba musza wskazywac na wiersz po scaleniu';
  v_asserts := v_asserts + 1;

  SELECT count(*) INTO v_n FROM public.research_program_items
   WHERE program_id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_n = 1, 'kuratorowane pozycje huba musza wskazywac na wiersz po scaleniu';
  v_asserts := v_asserts + 1;

  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.programs'::regclass
     AND conrelid IN ('public.research_program_members'::regclass,
                      'public.research_program_projects'::regclass,
                      'public.research_program_partners'::regclass,
                      'public.research_program_items'::regclass);
  ASSERT v_n = 4, format('kazde z 4 dzieci musi miec FK na programs, jest %s', v_n);
  v_asserts := v_asserts + 1;

  -- Stary FK na hub nie moze przetrwac pod inna nazwa.
  SELECT count(*) INTO v_n FROM pg_constraint WHERE contype = 'f'
     AND confrelid::regclass::text = 'research_programs';
  ASSERT v_n = 0, 'zaden FK nie moze wskazywac na nieistniejaca tabele hubow';
  v_asserts := v_asserts + 1;

  -- ── 5. FK tresci na `programs` NIE zostaly ruszone ───────────────────────
  SELECT count(*) INTO v_n FROM public.post_programs
   WHERE program_id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_n = 1, 'powiazanie wpisu z programem musi przezyc scalenie';
  v_asserts := v_asserts + 1;

  -- ── 6. status <-> is_active nie moga sie rozjechac ───────────────────────
  SELECT count(*) INTO v_n FROM public.programs WHERE is_active <> (status = 'published');
  ASSERT v_n = 0, 'is_active musi byc zawsze rowne (status = published)';
  v_asserts := v_asserts + 1;

  -- `is_active = false` ze slownika staje sie `archived`, nie `draft`:
  -- ten program BYL publiczny, wiec szkic bylby przeklamaniem historii.
  SELECT status INTO v_txt FROM public.programs WHERE id = 'e0000000-0000-0000-0000-000000000002';
  ASSERT v_txt = 'archived', format('nieaktywny program slownika ma byc archived, jest %s', v_txt);
  v_asserts := v_asserts + 1;

  -- Pisarz ruszajacy WYLACZNIE stara kolumna przenosi intencje na status.
  UPDATE public.programs SET is_active = true WHERE id = 'e0000000-0000-0000-0000-000000000002';
  SELECT status INTO v_txt FROM public.programs WHERE id = 'e0000000-0000-0000-0000-000000000002';
  ASSERT v_txt = 'published', 'zapis is_active = true musi przelozyc sie na status published';
  v_asserts := v_asserts + 1;

  -- I odwrotnie.
  UPDATE public.programs SET status = 'draft' WHERE id = 'e0000000-0000-0000-0000-000000000002';
  SELECT is_active INTO v_bool FROM public.programs WHERE id = 'e0000000-0000-0000-0000-000000000002';
  ASSERT v_bool = false, 'zapis status = draft musi zdjac is_active';
  v_asserts := v_asserts + 1;

  -- INSERT z jawnym is_active = false przy domyslnym statusie.
  INSERT INTO public.programs (tenant_id, slug, name_pl, name_en, is_active)
  VALUES ('11111111-0000-0000-0000-000000000001', 'nowy-nieaktywny', 'Nowy', 'New', false);
  SELECT status INTO v_txt FROM public.programs WHERE slug = 'nowy-nieaktywny';
  ASSERT v_txt = 'archived', format('INSERT z is_active=false ma dac archived, dal %s', v_txt);
  v_asserts := v_asserts + 1;

  -- ── 7. Widok jest aktualizowalny - panel redakcji pisze bez zmian ────────
  INSERT INTO public.research_programs (tenant_id, slug, name_pl, name_en, status, tagline_pl)
  VALUES ('11111111-0000-0000-0000-000000000001', 'przez-widok', 'Przez widok', 'Via view',
          'published', 'Wpisane widokiem');
  SELECT count(*) INTO v_n FROM public.programs WHERE slug = 'przez-widok' AND status = 'published';
  ASSERT v_n = 1, 'INSERT przez widok musi wyladowac w tabeli programs';
  v_asserts := v_asserts + 1;

  UPDATE public.research_programs SET status = 'archived' WHERE slug = 'przez-widok';
  SELECT is_active INTO v_bool FROM public.programs WHERE slug = 'przez-widok';
  ASSERT v_bool = false, 'UPDATE przez widok musi odpalic trigger synchronizacji';
  v_asserts := v_asserts + 1;

  DELETE FROM public.research_programs WHERE slug = 'przez-widok';
  SELECT count(*) INTO v_n FROM public.programs WHERE slug = 'przez-widok';
  ASSERT v_n = 0, 'DELETE przez widok musi usunac wiersz z tabeli programs';
  v_asserts := v_asserts + 1;

  -- ── 8. Slug do 120 znakow przechodzi (huby mialy szerszy zakres) ─────────
  INSERT INTO public.programs (tenant_id, slug, name_pl, name_en)
  VALUES ('11111111-0000-0000-0000-000000000001', repeat('a', 100), 'Dlugi', 'Long');
  v_asserts := v_asserts + 1;

  -- ── 9. Funkcje SECURITY DEFINER przepiete na jedyna tabele ───────────────
  -- Ciala plpgsql/sql NIE sa walidowane przy CREATE, wiec rozjazd relacji
  -- odezwalby sie dopiero przy wywolaniu - u uzytkownika. Wolamy je tutaj.
  SELECT count(*) INTO v_n FROM public.get_program_members(
    ARRAY['e0000000-0000-0000-0000-000000000001'::uuid]);
  ASSERT v_n = 1, format('get_program_members ma zwrocic czlonka scalonego programu, zwrocil %s', v_n);
  v_asserts := v_asserts + 1;

  SELECT public.club_anchor_label('research_program', 'e0000000-0000-0000-0000-000000000001')
    INTO v_txt;
  ASSERT v_txt LIKE 'Energia%',
    format('kotwica watku klubowego ma nazwac scalony program, dala %L', v_txt);
  v_asserts := v_asserts + 1;

  -- Zespol programu NIEOPUBLIKOWANEGO nie moze wyciec przez RPC.
  SELECT count(*) INTO v_n FROM public.get_program_members(
    ARRAY['f0000000-0000-0000-0000-000000000002'::uuid]);
  ASSERT v_n = 1, 'get_program_members ma dzialac dla huba bez kolizji';
  v_asserts := v_asserts + 1;

  UPDATE public.programs SET status = 'draft' WHERE id = 'f0000000-0000-0000-0000-000000000002';
  SELECT count(*) INTO v_n FROM public.get_program_members(
    ARRAY['f0000000-0000-0000-0000-000000000002'::uuid]);
  ASSERT v_n = 0, 'get_program_members nie moze zwracac zespolu programu niepublikowanego';
  UPDATE public.programs SET status = 'published' WHERE id = 'f0000000-0000-0000-0000-000000000002';
  v_asserts := v_asserts + 1;

  RAISE NOTICE 'asercje strukturalne: % OK', v_asserts;
END
$t$;

-- ── 9. RLS: to samo pytanie zadane jako anon ───────────────────────────────
-- Poza blokiem DO, bo `SET ROLE` w SECURITY INVOKER musi objac cale zapytanie.
DO $rls$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE anon;

  -- Szkic huba NIE moze byc widoczny publicznie - to jest ta gwarancja, ktora
  -- dawala stara polityka `research_programs`, a `programs` (bez statusu) nie.
  SELECT count(*) INTO v_n FROM public.research_programs WHERE slug = 'szkic-programu';
  ASSERT v_n = 0, 'anon NIE MOZE widziec szkicu programu przez widok';

  SELECT count(*) INTO v_n FROM public.programs WHERE slug = 'szkic-programu';
  ASSERT v_n = 0, 'anon NIE MOZE widziec szkicu programu przez tabele';

  -- Opublikowany widoczny.
  SELECT count(*) INTO v_n FROM public.research_programs WHERE slug = 'bezpieczenstwo-europejskie';
  ASSERT v_n = 1, 'anon musi widziec opublikowany program przez widok';

  -- Program najemcy B niewidoczny dla najemcy A.
  SELECT count(*) INTO v_n FROM public.programs
   WHERE id = 'e0000000-0000-0000-0000-000000000003';
  ASSERT v_n = 0, 'program innego najemcy nie moze byc widoczny';

  -- Czlonkostwo w programie innego najemcy - dziura zalatana ta migracja.
  SELECT count(*) INTO v_n FROM public.program_members
   WHERE program_id = 'e0000000-0000-0000-0000-000000000003';
  ASSERT v_n = 0, 'czlonkostwo w programie innego najemcy nie moze wyciekac';

  -- Czlonkostwo we wlasnym, opublikowanym programie - widoczne.
  SELECT count(*) INTO v_n FROM public.program_members
   WHERE program_id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_n = 1, 'czlonkostwo we wlasnym opublikowanym programie musi byc widoczne';

  -- Dzieci huba: widoczne tylko przy opublikowanym programie.
  SELECT count(*) INTO v_n FROM public.research_program_members
   WHERE program_id = 'e0000000-0000-0000-0000-000000000001';
  ASSERT v_n = 1, 'czlonkowie opublikowanego huba musza byc widoczni';

  RESET ROLE;
  RAISE NOTICE 'asercje RLS (anon): 7 OK';
END
$rls$;

-- ── 10. Zapis przez widok jako `authenticated`, nie superuser ──────────────
-- Blok wyzej sprawdzal ODCZYT. Panel redakcji PISZE - i pisze rola
-- `authenticated`, ktora przy `security_invoker = true` musi miec uprawnienia
-- NA TABELI BAZOWEJ, nie tylko na widoku. Test wykonany jako postgres
-- (superuser) przeszedlby, nawet gdyby grantow brakowalo.
DO $rw$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;

  INSERT INTO public.research_programs (tenant_id, slug, name_pl, name_en, status)
  VALUES ('11111111-0000-0000-0000-000000000001', 'zapis-jako-user', 'Zapis', 'Write', 'published');
  SELECT count(*) INTO v_n FROM public.research_programs WHERE slug = 'zapis-jako-user';
  ASSERT v_n = 1, 'authenticated z rola admina musi moc pisac przez widok';

  UPDATE public.research_programs SET tagline_pl = 'Zmienione' WHERE slug = 'zapis-jako-user';
  SELECT count(*) INTO v_n FROM public.research_programs
   WHERE slug = 'zapis-jako-user' AND tagline_pl = 'Zmienione';
  ASSERT v_n = 1, 'UPDATE przez widok jako authenticated musi zadzialac';

  DELETE FROM public.research_programs WHERE slug = 'zapis-jako-user';
  SELECT count(*) INTO v_n FROM public.research_programs WHERE slug = 'zapis-jako-user';
  ASSERT v_n = 0, 'DELETE przez widok jako authenticated musi zadzialac';

  RESET ROLE;
  RAISE NOTICE 'asercje zapisu przez widok: 3 OK';
END
$rw$;

-- ── 11. Zwykly uzytkownik (bez roli sztabowej) NIE pisze ───────────────────
DO $rw_deny$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('nes.uid', 'bbbbbbbb-0000-0000-0000-00000000000b', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.research_programs (tenant_id, slug, name_pl, name_en)
    VALUES ('11111111-0000-0000-0000-000000000001', 'nielegalny', 'Nie', 'No');
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  RESET ROLE;
  ASSERT v_failed, 'uzytkownik bez roli admin/editor NIE MOZE pisac przez widok';
  RAISE NOTICE 'asercje odmowy zapisu: 1 OK';
END
$rw_deny$;

SELECT 'programs-harness: WSZYSTKIE ASERCJE PRZESZLY' AS wynik;
