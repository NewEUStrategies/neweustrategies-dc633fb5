-- ============================================================================
-- KONTRAKT: PLASZCZYZNA ADMINISTRACYJNA WYDARZEN JEST ZAMKNIETA DLA REDAKCJI.
--
-- Po co osobny plik. Panel Wydarzen ma DWIE niezalezne plaszczyzny dostepu.
-- Pierwsza to funkcje RPC - zamknieta w `20260824090000`, gdzie
-- `assert_editor_tenant()` zaczal delegowac do `assert_event_admin_tenant()`.
-- Druga to RLS: klient Supabase czyta i pisze tabele takze BEZ RPC, przez
-- PostgREST. Zamkniecie jednej plaszczyzny nie zamyka drugiej, a przez
-- pol dnia bylo zamkniete tylko RPC - redaktor mial pelny zapis (`FOR ALL`)
-- na czterech tabelach wejsciowek i na sekcjach strony wydarzenia.
--
-- Dlaczego to musi byc BRAMKA, a nie komentarz w migracji. Polityki powstaja
-- z automatu (Lovable) w kazdej kolejnej migracji dotykajacej tabeli, i wzorzec
-- `admin OR editor` jest w tym repozytorium domyslny. Jedno `CREATE POLICY`
-- cofa cala naprawe BEZ SLADU W DIFFIE tamtej migracji - dokladnie tak zginela
-- naprawa `search_path` w `a8_hardening` (patrz
-- `extensions_search_path_contract_test.sql`, ten sam mechanizm).
--
-- Asercja czyta KATALOG, nie migracje: liczy sie stan po odtworzeniu calego
-- lancucha, a nie to, co ktoras migracja deklarowala po drodze.
-- ============================================================================
BEGIN;
SELECT plan(5);

-- ── 1. Zadna polityka modulu nie wymienia roli `editor` ─────────────────────
-- ZAKRES: tabele `event\_%` MINUS trzy tabele starszych modulow, ktore
-- celowo zostaja dostepne dla redakcji (uzasadnienie w `20260825170000`):
--   `events`         - ekran LISTY wydarzen jest powierzchnia redakcyjna,
--   `event_rsvps`    - starsza plaszczyzna RSVP,
--   `event_speakers` - czytana przez kreator stron, hub ekspertow i spolecznosc.
-- Wyjatek jest IMIENNY, a nie wzorcem: nowa tabela modulu wchodzi pod kontrakt
-- automatycznie, bo nie ma jej na tej liscie.
SELECT is_empty($$
  SELECT p.tablename || '.' || p.policyname AS polityka_wpuszczajaca_redakcje
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename LIKE 'event%'
     AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')
     AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '''editor'''
   ORDER BY 1
$$, 'zadna polityka RLS modulu Wydarzen nie wymienia roli editor');

-- ── 2. Powierzchnia administracyjna zna super admina ────────────────────────
-- `has_role(uid,'admin')` to scisly odczyt wiersza z `user_roles` i NIE
-- obejmuje `super_admin`. Polityka, ktora wymienia `admin`, a nie wymienia
-- `is_super_admin`, zamyka super admina przed jego wlasnymi danymi. To druga
-- polowa tej samej naprawy i musi byc pilnowana razem z pierwsza, inaczej
-- kolejne `CREATE POLICY` odtworzy sam `admin`.
SELECT is_empty($$
  SELECT p.tablename || '.' || p.policyname AS polityka_bez_super_admina
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename LIKE 'event%'
     AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')
     AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '''admin'''
     AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~ 'is_super_admin'
   ORDER BY 1
$$, 'kazda polityka modulu wymieniajaca admina wymienia tez is_super_admin');

-- ── 3. Alias `assert_editor_tenant` naprawde deleguje do wersji administracyjnej
-- Asercja strukturalna na ciele: gdyby ktoras migracja przedeklarowala alias
-- z powrotem na wlasne sprawdzenie roli, nazwa zostalaby ta sama, a 338
-- wywolan w module po cichu znow wpuscilobyc redakcje.
SELECT matches(
  (SELECT p.prosrc
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assert_editor_tenant'),
  'assert_event_admin_tenant',
  'assert_editor_tenant deleguje do assert_event_admin_tenant, nie sprawdza roli sam');

-- ── 4. Zawezenie faktycznie kogos dotknelo ──────────────────────────────────
-- Asercje 1 i 2 sa spelnione takze przez ZERO polityk. Gdyby ktoras migracja
-- skasowala polityki modulu hurtem, obie przeszlyby na zielono, a modul
-- stalby otworem albo zamkniety na gluchy. Prog DOLNY, nie rownosc: kazda
-- nowa tabela modulu doklada polityki, wiec test na rownosc czerwienilby sie
-- od poprawnej pracy.
SELECT cmp_ok(
  (SELECT count(*)::int FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename LIKE 'event%'
      AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')
      AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ 'is_super_admin'),
  '>=', 30,
  'co najmniej 30 polityk modulu stoi na admin + super_admin');

-- ── 5. Dowod ZACHOWANIA oslony, nie tylko jej tresci ────────────────────────
-- Kontrakt strukturalny moze byc spelniony, a funkcja i tak nie istniec albo
-- padac na czyms innym. Bez zalogowanego uzytkownika oslona musi ODMOWIC
-- wyjatkiem, a nie zwrocic cichy NULL: cichy NULL w SECURITY DEFINER oznacza
-- zapytanie bez wlasciciela, czyli wyciek poza najemce.
SELECT throws_ok(
  $$SELECT public.assert_editor_tenant()$$,
  'forbidden: authentication required',
  'assert_editor_tenant odmawia bez zalogowanego uzytkownika');

SELECT * FROM finish();
ROLLBACK;
