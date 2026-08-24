-- ============================================================================
-- 00_smoke - MINIMALNY ZESTAW ASERCJI DYMNYCH
--
-- PO CO TEN PLIK ISTNIEJE
-- Dowodzi, ze petla dziala i ze szkielet potrafi byc CZERWONY: sloty asercji
-- sa podpiete, aktor sie przestawia, migracje faktycznie zostawily po sobie
-- schemat, a odmowa jest wykrywana jako odmowa. Jest przygrywka dla plikow
-- 10_..60_, a nie ich zamiennikiem.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza logiki sesji, zapisow, sponsorow, frontu, odprawy ani
--     spotkan - to zakres plikow 10_ .. 60_;
--   * nie sprawdza tresci polityk RLS poza tym, ze RLS jest wlaczony i ze
--     izolacja najemcow w ogole dziala na `events`;
--   * nie sprawdza atrap - one sa scenografia, nie przedmiotem testu.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem, wiec
-- nie zostawia po sobie ani wiersza. To jest kontrakt kazdego pliku
-- w runtime_test.d: pliki musza byc niezalezne od siebie i od kolejnosci.
-- ============================================================================

\echo '== 00 dym: schemat, petla, aktor, izolacja =='

BEGIN;

-- ── 1. Migracje zostawily po sobie schemat ───────────────────────────
-- Progi sa DOLNE, nie rowne. Rownosc byla by asercja o dacie ostatniego
-- commita: kazda nowa migracja modulu doklada tabele i polityki, wiec test
-- na rownosc czerwienil by sie od poprawnej pracy. Prog dolny lamie sie
-- natychmiast, gdy ktorakolwiek migracja przestanie sie wykonywac - a to jest
-- dokladnie ten blad, ktorego szukamy.
--
-- Liczby zmierzone na tym harnessie po replayu dziesieciu migracji:
--   34 tabele event_*, 53 polityki RLS, 143 funkcje modulu,
--   6 ograniczen EXCLUDE, 195 indeksow, 31 triggerow.
-- Progi ponizej siedza pod nimi z zapasem na drobne przestawienia.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname LIKE 'event\_%') >= 30,
  'dym: modul zostawil co najmniej 30 tabel event_*');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE 'event%' OR p.proname LIKE 'admin\_event%'
           OR p.proname LIKE '\_event%')) >= 130,
  'dym: modul zostawil co najmniej 130 funkcji');

-- Ograniczenia EXCLUDE sa sercem modulu: kolizja sesji na sali, podwojna
-- odprawa w oknie czasowym, nakladajace sie spotkania i dostepnosci. Zadne
-- z nich nie zalozylo by sie bez rozszerzenia btree_gist w harnessie - a
-- migracje zakladaja je przez EXECUTE w bloku DO, wiec brak rozszerzenia
-- moglby przejsc bokiem. Dlatego liczymy je wprost.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_constraint WHERE contype = 'x') >= 6,
  'dym: modul zalozyl co najmniej 6 ograniczen EXCLUDE');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
    AND tablename LIKE 'event\_%') >= 45,
  'dym: modul zalozyl co najmniej 45 polityk RLS na tabelach event_*');

-- Tabela modulu bez wlaczonego RLS to tabela otwarta dla kazdego posiadacza
-- grantu SELECT. Lista musi byc PUSTA, a nie "krotka" - dlatego = 0.
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname LIKE 'event\_%' AND NOT c.relrowsecurity) = 0,
  'dym: kazda tabela event_* ma wlaczony RLS');

-- Seed katalogu rodzajow wydarzen z 20260823120000 wchodzi wzgledem
-- `public_tenant_id()`. Gdyby atrapa najemcy publicznego wskazywala w prozanie,
-- migracja przeszlaby (INSERT ... ON CONFLICT DO NOTHING), a katalog zostalby
-- pusty - czyli caly modul stalby na scenografii bez rekwizytow.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_types
    WHERE tenant_id = public.public_tenant_id()) >= 6,
  'dym: katalog rodzajow wydarzen zaseedowany w najemcy publicznym');

-- ── 2. Slot odmowy naprawde wykrywa odmowe ──────────────────────────────────
-- Bez tego kazda asercja `assert_raises` w plikach 10_..60_ mogla by byc
-- komentarzem: nie wiedzielibysmy, czy odmowa jest wykrywana, czy tylko
-- niezauwazana.
SELECT pg_temp.assert_raises_like(
  'SELECT 1/0', 'division by zero',
  'dym: slot odmowy lapie wyjatek i sprawdza jego powod');

-- ── 3. Aktor sie przestawia ─────────────────────────────────────────────────
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(auth.uid() IS NULL, 'dym: bez tozsamosci auth.uid() jest NULL (anonim)');

SELECT pg_temp.act_as('a0000000-0000-0000-0000-00000000000a',
                      '11111111-1111-1111-1111-111111111111', 30, 'recordings');
SELECT pg_temp.assert(auth.uid() = 'a0000000-0000-0000-0000-00000000000a',
  'dym: act_as ustawia auth.uid()');
SELECT pg_temp.assert(public._caller_tenant() = '11111111-1111-1111-1111-111111111111',
  'dym: act_as ustawia najemce wolajacego');
SELECT pg_temp.assert(public.has_tier_rank(30) AND NOT public.has_tier_rank(31),
  'dym: act_as ustawia range warstwy dokladnie, a nie "co najmniej cokolwiek"');
SELECT pg_temp.assert(public.has_tier_feature('recordings')
                  AND NOT public.has_tier_feature('nagrania'),
  'dym: act_as ustawia ceche warstwy dokladnie');

-- Bramka zapisu panelu MUSI odmawiac anonimowi. Gdyby atrapa
-- `assert_admin_tenant()` tylko zwracala NULL, kazda asercja o uprawnieniach
-- w plikach 10_..60_ przechodzilaby na fikcji.
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  'SELECT public.assert_admin_tenant()', 'FORBIDDEN',
  'dym: bramka panelu odmawia anonimowi');

-- ── 4. IZOLACJA NAJEMCOW - najwazniejsza asercja szkieletu ──────────────────
-- Dwoch najemcow, TO SAMO zapytanie wykonane jako kazdy z nich, i zaden nie
-- widzi ANI JEDNEGO wiersza drugiego.
--
-- Tabela testowa jest `event_types`, bo jej polityke `event_types_public_read`
-- (`tenant_id = COALESCE(_caller_tenant(), public_tenant_id())`) zaklada
-- MIGRACJA MODULU 20260823120000. Gdyby test siedzial na `events`, mierzylby
-- polityke ATRAPY z harness.sql - czyli scenografie, nie modul.
--
-- RLS nie obowiazuje superuzytkownika, wiec bez `SET ROLE authenticated`
-- polityki nie zostalyby nawet policzone i asercja przechodzilaby ZAWSZE.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('22222222-2222-2222-2222-222222222222','Tenant B','tb')
ON CONFLICT (id) DO NOTHING;

-- Najemca A ma katalog z migracji (seed wzgledem `public_tenant_id()`).
-- Najemcy B dokladamy jeden wiersz wlasny - inaczej nie byloby czego nie widziec.
INSERT INTO public.event_types (tenant_id, key, name_pl, name_en) VALUES
  ('22222222-2222-2222-2222-222222222222','smoke_b','Dym B','Smoke B');

-- Najemca A: nie widzi ANI JEDNEGO wiersza najemcy B.
SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_types
    WHERE tenant_id = '22222222-2222-2222-2222-222222222222') = 0,
  'dym/izolacja: najemca A nie widzi ANI JEDNEGO wiersza najemcy B');
RESET ROLE;

-- Najemca B: to samo zapytanie, odwrotna strona.
SELECT pg_temp.act_as(NULL, '22222222-2222-2222-2222-222222222222');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_types
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  'dym/izolacja: najemca B nie widzi ANI JEDNEGO wiersza najemcy A');

-- KONTRAPUNKT. Gdyby polityka nie przepuszczala NICZEGO (albo gdyby RLS bez
-- polityki dawalo deny-all), obie asercje wyzej przechodzilyby na pustym
-- wyniku. Bez tego kontrapunktu test nie odroznia IZOLACJI od BLOKADY - a to
-- jest roznica miedzy dzialajacym modulem i modulem, ktory nie oddaje nic.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_types WHERE key = 'smoke_b') = 1,
  'dym/izolacja: najemca B widzi SWOJ wiersz (inaczej test mierzylby blokade)');
RESET ROLE;

SELECT pg_temp.act_as(NULL, '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_types
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') >= 6,
  'dym/izolacja: najemca A widzi SWOJ katalog (kontrapunkt dla strony A)');
RESET ROLE;

-- ── 5. Anonim tez jest aktorem ───────────────────────────────────────────────
-- `anon` ma grant SELECT na `event_types`, wiec katalog widzi bez logowania -
-- ale WYLACZNIE w swoim najemcy. To jest ta sama polityka, sprawdzona z drugiej
-- roli bazodanowej: gdyby polityka byla przywiazana do `authenticated`, ta
-- asercja by sie zlamala.
SELECT pg_temp.act_as(NULL, '22222222-2222-2222-2222-222222222222');
SET ROLE anon;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_types
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  'dym/izolacja: anonim w najemcy B nie widzi katalogu najemcy A');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);

ROLLBACK;

\echo '== 00 dym: koniec =='
