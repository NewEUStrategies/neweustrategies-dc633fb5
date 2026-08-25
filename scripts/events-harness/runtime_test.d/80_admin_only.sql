-- ============================================================================
-- 80_admin_only - PLASZCZYZNA ADMINISTRACYJNA JEST ZAMKNIETA DLA REDAKCJI
--
-- PO CO TEN PLIK ISTNIEJE
-- Panel Wydarzen ma dwie niezalezne plaszczyzny dostepu: funkcje RPC i RLS.
-- `20260824090000` zamknelo pierwsza (alias `assert_editor_tenant` deleguje
-- do wersji administracyjnej), `20260825170000` domknelo druga. Ten plik
-- pilnuje, zeby zadna kolejna migracja nie otworzyla ktorejkolwiek z nich
-- z powrotem - a wzorzec `admin OR editor` jest w tym repozytorium domyslny,
-- wiec otwarcie z automatu jest kwestia czasu, nie ryzykiem teoretycznym.
--
-- DLACZEGO ASERCJE CZYTAJA KATALOG, A NIE WYKONUJA ZAPYTAN
-- Harness nie zaklada roli bazodanowej (`act_as` ustawia same GUC-i), wiec
-- pracuje jako wlasciciel, a wlasciciel OMIJA RLS. Zapytanie "czy redaktor
-- to zobaczy" zwrocilo by tu wynik pozytywny NIEZALEZNIE od tresci polityki
-- i bylo by asercja pozorna. Katalog `pg_policies` jest jedynym miejscem,
-- w ktorym tresc polityki da sie tu sprawdzic uczciwie. Odpowiednikiem
-- wykonawczym jest `supabase/tests/event_admin_only_contract_test.sql`,
-- ktory chodzi po PELNYM lancuchu migracji na bramce `pgtap`.
--
-- SPRZATANIE. Plik nic nie wstawia i nie zmienia - same odczyty katalogu.
-- ============================================================================

\echo '== 80 tylko admin: RLS i oslony RPC =='

BEGIN;

-- ── 1. Zadna polityka modulu nie wymienia roli `editor` ─────────────────────
-- Trzy tabele starszych modulow sa wylaczone IMIENNIE (uzasadnienie w naglowku
-- `20260825170000`): `events` niesie ekran LISTY, ktory zostaje powierzchnia
-- redakcyjna, `event_rsvps` to starsza plaszczyzna RSVP, a `event_speakers`
-- czyta kreator stron i hub ekspertow. Nowa tabela modulu wchodzi pod kontrakt
-- automatycznie, bo nie ma jej na liscie wyjatkow.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename LIKE 'event%'
       AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')
       AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '''editor'''
  ),
  'RLS: zadna polityka modulu nie wpuszcza roli editor');

-- ── 2. Kazda polityka administracyjna zna super admina ──────────────────────
-- `has_role(uid,'admin')` czyta wiersz z `user_roles` SCISLE i nie obejmuje
-- `super_admin`. Polityka wymieniajaca `admin` bez `is_super_admin` zamyka
-- super administratora przed jego wlasnymi danymi - to ta sama usterka, tylko
-- z drugiej strony, i musi byc pilnowana razem z pierwsza.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename LIKE 'event%'
       AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')
       AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ '''admin'''
       AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) !~ 'is_super_admin'
  ),
  'RLS: kazda polityka administracyjna modulu wymienia is_super_admin');

-- ── 3. Zawezenie faktycznie kogos dotknelo ──────────────────────────────────
-- Prog DOLNY na liczbe polityk administracyjnych modulu. Asercje 1 i 2 sa
-- spelnione takze przez ZERO polityk - gdyby ktoras migracja skasowala je
-- hurtem, obie przeszlyby na zielono, a modul stalby otworem albo zamkniety
-- na gluchy. Ten prog lamie sie w takim przypadku natychmiast.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename LIKE 'event%'
      AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')
      AND (COALESCE(p.qual, '') || ' ' || COALESCE(p.with_check, '')) ~ 'is_super_admin') >= 30,
  'RLS: co najmniej 30 polityk modulu przeszlo na admin + super_admin');

-- ── 4. Alias RPC nadal deleguje do wersji administracyjnej ──────────────────
-- Gdyby ktoras migracja przedeklarowala `assert_editor_tenant` na wlasne
-- sprawdzenie roli, nazwa zostalaby ta sama, a 338 wywolan w cialach funkcji
-- modulu po cichu znow wpuscilo by redakcje.
SELECT pg_temp.assert(
  (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assert_editor_tenant')
    LIKE '%assert_event_admin_tenant%',
  'RPC: assert_editor_tenant deleguje do assert_event_admin_tenant');

-- ── 5. Oslona administracyjna ODMAWIA redaktorowi - dowod wykonawczy ────────
-- Tu asercja wykonawcza jest UCZCIWA, w odroczeniu od RLS: oslona sprawdza
-- role SAMA, w ciele funkcji, wiec omijanie RLS przez wlasciciela nic tu nie
-- zaklamuje. Redaktor istnieje, ma najemce i ma wiersz roli `editor` -
-- odmowa moze wyjsc wylacznie z DECYZJI oslony, nie z braku danych.
--
-- Aktorzy sa wlasni, a nie pozyczone z 10_sessions: pliki w runtime_test.d
-- musza byc niezalezne od siebie i od kolejnosci (kazdy konczy ROLLBACK-iem).
INSERT INTO auth.users (id, email) VALUES
  ('a8000000-0000-0000-0000-000000000a01', 'admin@tylko-admin.test'),
  ('a8000000-0000-0000-0000-000000000e02', 'redaktor@tylko-admin.test');

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('a8000000-0000-0000-0000-000000000a01',
   '11111111-1111-1111-1111-111111111111', 'Administrator 80', 'admin-80'),
  ('a8000000-0000-0000-0000-000000000e02',
   '11111111-1111-1111-1111-111111111111', 'Redaktor 80', 'redaktor-80');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a8000000-0000-0000-0000-000000000a01', 'admin'),
  ('a8000000-0000-0000-0000-000000000e02', 'editor');

SELECT pg_temp.act_as('a8000000-0000-0000-0000-000000000e02',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.assert_editor_tenant()$$,
  'admin role required',
  'RPC: redaktor dostaje odmowe z aliasu assert_editor_tenant');
SELECT pg_temp.assert_raises_like(
  $$SELECT public.assert_event_admin_tenant()$$,
  'admin role required',
  'RPC: redaktor dostaje odmowe z assert_event_admin_tenant');

-- Redakcja NIE jest odcieta od wszystkiego: ekran LISTY wydarzen zostaje jej
-- powierzchnia, wiec oslona `staff` musi tego samego redaktora WPUSCIC.
-- Bez tej asercji zawezenie mogloby po cichu zamknac takze liste.
SELECT pg_temp.assert(
  public.assert_event_staff_tenant() = '11111111-1111-1111-1111-111111111111'::uuid,
  'RPC: redaktor NADAL przechodzi przez oslone staff (ekran listy)');

-- Administrator tego samego najemcy przechodzi - inaczej asercje wyzej
-- dowodzilyby tylko tego, ze funkcja zawsze pada.
SELECT pg_temp.act_as('a8000000-0000-0000-0000-000000000a01',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert(
  public.assert_event_admin_tenant() = '11111111-1111-1111-1111-111111111111'::uuid,
  'RPC: administrator przechodzi i dostaje swojego najemce');
SELECT pg_temp.assert(
  public.assert_editor_tenant() = '11111111-1111-1111-1111-111111111111'::uuid,
  'RPC: alias przepuszcza administratora, wiec nie pada zawsze');

-- ── 6. Bez zalogowanego uzytkownika oslona odmawia WYJATKIEM ────────────────
-- Cichy NULL w SECURITY DEFINER oznacza zapytanie bez wlasciciela, czyli
-- wyciek poza najemce. Ta sama asercja stoi w pgTAP
-- (`event_admin_only_contract_test.sql`) i pilnuje tam PELNEGO lancucha -
-- tutaj sprawdzamy jej przeslanke, zeby bramka `pgtap` nie byla pierwszym
-- miejscem, w ktorym sie o niej dowiadujemy.
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $$SELECT public.assert_editor_tenant()$$,
  'authentication required',
  'RPC: bez zalogowanego uzytkownika alias odmawia wyjatkiem');

ROLLBACK;

\echo '== 80 tylko admin: koniec =='
