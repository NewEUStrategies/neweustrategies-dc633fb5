-- pgTAP: izolacja najemcy w kanonicznej sciezce strony.
--
-- Funkcje `public.page_full_path(uuid)` i `public.page_full_paths(uuid[])`
-- NIE MIALY DO TEJ PORY ZADNEGO TESTU pgTAP - audyt pokrycia (wydanie 7,
-- rozdz. 8.4) trzymal to znalezisko otwarte siedem wydan z rzedu. Ten plik
-- domyka je razem z migracja 20260831160000_page_full_path_tenant_scope.sql.
--
-- Sprawdzane sa DWIE niezalezne warstwy obrony, bo migracja stawia obie:
--
--   A. OGRANICZENIE SCHEMATU `pages_parent_same_tenant_fkey` - nie pozwala
--      WYTWORZYC strony, ktorej rodzic siedzi u innego najemcy. Testowane w obu
--      kierunkach: zapis dziecka ORAZ zmiana najemcy rodzica/dziecka.
--   B. PREDYKAT NAJEMCY W REKURENCJI - gdy takie dane jednak w bazie sa
--      (weszly przed migracja albo ograniczenie zostalo zdjete), funkcja NIE
--      wnosi obcego sluga do sciezki. To wlasnie ta sciezka trafiala do
--      sitemapy i RSS-a.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`),
-- lokalnie: `bash scripts/pgtap-local/run.sh test page_full_path`.

BEGIN;
SELECT plan(14);

-- ── Seed ───────────────────────────────────────────────────────────────────
-- Seedujemy jako wlasciciel (RLS pomijane) - przedmiotem testu jest schemat
-- i cialo funkcji, nie polityki. Triggery na auth.users wylaczone z tego samego
-- powodu co w rls_tenant_isolation_test.sql (auto-provisioning tenanta).
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-111111111111', 'tenant-c', 'Tenant C'),
  ('d2222222-2222-2222-2222-222222222222', 'tenant-d', 'Tenant D');

-- Drzewo najemcy C: korzen -> dzial -> podstrona (trzy poziomy, zeby test
-- sprawdzal SKLADANIE sciezki, nie tylko jej brak).
INSERT INTO public.pages (id, tenant_id, slug, status) VALUES
  ('cccccccc-0000-0000-0000-00000000c001', 'c1111111-1111-1111-1111-111111111111', 'o-nas',    'published'),
  ('cccccccc-0000-0000-0000-00000000c002', 'c1111111-1111-1111-1111-111111111111', 'zespol',   'published'),
  ('cccccccc-0000-0000-0000-00000000c003', 'c1111111-1111-1111-1111-111111111111', 'zarzad',   'published');

UPDATE public.pages SET parent_id = 'cccccccc-0000-0000-0000-00000000c001'
  WHERE id = 'cccccccc-0000-0000-0000-00000000c002';
UPDATE public.pages SET parent_id = 'cccccccc-0000-0000-0000-00000000c002'
  WHERE id = 'cccccccc-0000-0000-0000-00000000c003';

-- Strona najemcy D - kandydat na "obcego rodzica".
INSERT INTO public.pages (id, tenant_id, slug, status) VALUES
  ('dddddddd-0000-0000-0000-00000000d001', 'd2222222-2222-2222-2222-222222222222', 'tajny-klient', 'published');

-- ── A. Sciezka skladana W OBREBIE najemcy dziala bez zmian ─────────────────
-- Regresja odwrotna: predykat najemcy nie ma prawa zepsuc normalnego drzewa.

SELECT is(
  public.page_full_path('cccccccc-0000-0000-0000-00000000c001'),
  'o-nas',
  'strona korzeniowa: sciezka to jej wlasny slug'
);

SELECT is(
  public.page_full_path('cccccccc-0000-0000-0000-00000000c002'),
  'o-nas/zespol',
  'jeden poziom zagniezdzenia: sciezka sklada sie od korzenia'
);

SELECT is(
  public.page_full_path('cccccccc-0000-0000-0000-00000000c003'),
  'o-nas/zespol/zarzad',
  'dwa poziomy zagniezdzenia: pelna sciezka z trzech segmentow'
);

SELECT is(
  public.page_full_path('00000000-0000-0000-0000-000000000000'),
  NULL,
  'strona nieistniejaca: NULL, bez wyjatku'
);

SELECT is(
  (SELECT full_path FROM public.page_full_paths(ARRAY[
      'cccccccc-0000-0000-0000-00000000c003'::uuid
   ]) WHERE page_id = 'cccccccc-0000-0000-0000-00000000c003'),
  'o-nas/zespol/zarzad',
  'wariant wsadowy sklada te sama sciezke co pojedynczy'
);

-- ── B. Ograniczenie schematu: nie da sie WYTWORZYC obcego rodzica ──────────
-- 23503 = foreign_key_violation.

SELECT throws_ok(
  $$INSERT INTO public.pages (id, tenant_id, slug, status, parent_id)
    VALUES ('cccccccc-0000-0000-0000-00000000c004',
            'c1111111-1111-1111-1111-111111111111', 'podszywka', 'published',
            'dddddddd-0000-0000-0000-00000000d001')$$,
  '23503',
  NULL,
  'INSERT strony z rodzicem u obcego najemcy jest odrzucany'
);

SELECT throws_ok(
  $$UPDATE public.pages
       SET parent_id = 'dddddddd-0000-0000-0000-00000000d001'
     WHERE id = 'cccccccc-0000-0000-0000-00000000c002'$$,
  '23503',
  NULL,
  'UPDATE parent_id na strone obcego najemcy jest odrzucany'
);

-- DRUGI KIERUNEK - to jest ta polowa, ktorej trigger na dziecku by nie zlapal:
-- przeniesienie DZIECKA do innego najemcy przy nietknietym parent_id.
SELECT throws_ok(
  $$UPDATE public.pages
       SET tenant_id = 'd2222222-2222-2222-2222-222222222222'
     WHERE id = 'cccccccc-0000-0000-0000-00000000c003'$$,
  '23503',
  NULL,
  'UPDATE tenant_id dziecka rozjezdzajacy je z rodzicem jest odrzucany'
);

-- ...i przeniesienie RODZICA majacego dzieci.
SELECT throws_ok(
  $$UPDATE public.pages
       SET tenant_id = 'd2222222-2222-2222-2222-222222222222'
     WHERE id = 'cccccccc-0000-0000-0000-00000000c001'$$,
  '23503',
  NULL,
  'UPDATE tenant_id rodzica majacego dzieci jest odrzucany'
);

-- Strona korzeniowa (parent_id IS NULL) zostaje nietknieta - MATCH SIMPLE.
SELECT lives_ok(
  $$INSERT INTO public.pages (id, tenant_id, slug, status)
    VALUES ('cccccccc-0000-0000-0000-00000000c005',
            'c1111111-1111-1111-1111-111111111111', 'kontakt', 'published')$$,
  'strona korzeniowa bez rodzica przechodzi normalnie'
);

-- ── C. Predykat w rekurencji: obrona gdy zle dane JUZ SA w bazie ───────────
-- Zdejmujemy ograniczenie, zeby wstawic wiersz naruszajacy izolacje - taki,
-- jaki siedzial w bazie przed ta migracja. DDL jest transakcyjne, wiec
-- ROLLBACK na koncu pliku przywraca ograniczenie.
--
-- `IF EXISTS` jest tu ISTOTNE, nie ostrozne. Bez niego plik wywraca sie na tym
-- DDL-u, gdy ograniczenia nie ma - a wtedy transakcja jest juz przerwana
-- i CZTERY ASERCJE PONIZEJ NIE WYKONUJA SIE WCALE. Zweryfikowane wprost:
-- przy przywroconym stanie sprzed migracji plik raportowal `ran=10` z planu 14,
-- czyli warstwa B zostawala niesprawdzona dokladnie w tym scenariuszu, dla
-- ktorego istnieje. Z `IF EXISTS` obie warstwy zapalaja sie niezaleznie.
ALTER TABLE public.pages DROP CONSTRAINT IF EXISTS pages_parent_same_tenant_fkey;

INSERT INTO public.pages (id, tenant_id, slug, status, parent_id) VALUES
  ('cccccccc-0000-0000-0000-00000000c006',
   'c1111111-1111-1111-1111-111111111111', 'raport', 'published',
   'dddddddd-0000-0000-0000-00000000d001');

SELECT is(
  public.page_full_path('cccccccc-0000-0000-0000-00000000c006'),
  'raport',
  'rodzic u obcego najemcy: sciezka NIE zawiera obcego sluga (lancuch urwany na granicy)'
);

SELECT ok(
  public.page_full_path('cccccccc-0000-0000-0000-00000000c006') NOT LIKE '%tajny-klient%',
  'slug strony obcego najemcy nie wycieka do sciezki kanonicznej'
);

SELECT is(
  (SELECT full_path FROM public.page_full_paths(ARRAY[
      'cccccccc-0000-0000-0000-00000000c006'::uuid
   ]) WHERE page_id = 'cccccccc-0000-0000-0000-00000000c006'),
  'raport',
  'wariant wsadowy tez urywa lancuch na granicy najemcy'
);

-- Kontrola mieszana: w jednym wywolaniu wsadowym poprawna strona i naruszajaca
-- - zdrowa sciezka nie ma prawa ucierpiec od sasiedztwa.
SELECT results_eq(
  $$SELECT page_id, full_path FROM public.page_full_paths(ARRAY[
      'cccccccc-0000-0000-0000-00000000c003'::uuid,
      'cccccccc-0000-0000-0000-00000000c006'::uuid
    ]) ORDER BY full_path$$,
  $$VALUES ('cccccccc-0000-0000-0000-00000000c003'::uuid, 'o-nas/zespol/zarzad'),
           ('cccccccc-0000-0000-0000-00000000c006'::uuid, 'raport')$$,
  'wywolanie wsadowe mieszane: zdrowa sciezka pelna, naruszajaca urwana'
);

SELECT * FROM finish();
ROLLBACK;
