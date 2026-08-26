-- ============================================================================
-- 90_module_pages - PIEC ZAWSZE OBECNYCH STRON WYDARZENIA
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260826181500 obiecuje, ze KAZDE wydarzenie ma w menu piec pozycji
-- (Uczestnicy, Prelegenci, Partnerzy, Agenda, Dyskusje), ze front je widzi
-- i ze redakcja nie moze ich zgubic. Kazda z tych obietnic mieszka w CIELE
-- funkcji plpgsql, a ciala plpgsql NIE SA sprawdzane przy `CREATE FUNCTION` -
-- czysty przebieg replayu migracji nie dowodzi o nich niczego. Ten plik je
-- WYWOLUJE.
--
-- Piec eksperymentow, kazdy z kontrapunktem:
--   (a) nowe wydarzenie dostaje piec pozycji z ikonami i kolorami;
--   (b) `event_menu` je oddaje - czyli sa `published`, razem z korzeniem;
--   (c) powtorny zasiew nie duplikuje;
--   (d) odpiecie pozycji modulowej jest odrzucane z NAZWANYM powodem, a zwykla
--       pozycja odpina sie dalej;
--   (e) zapis calego wiersza z panelu NIE czysci znacznika `module`.
-- Plus (f): pulapka `STABLE` - funkcja niewolatylna nie moze zasiac.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza tresci stron modulowych poza tym, ze dokument buildera
--     istnieje i ma jedna sekcje - widget modulowy dokladamy razem
--     z `lib/builder/eventContext.ts` (EB-902), patrz naglowek migracji;
--   * nie sprawdza polityk RLS na `event_pages` - to zakres 80_admin_only
--     (harness pracuje jako wlasciciel, ktory RLS omija);
--   * nie sprawdza panelu ani frontu (`src/`) - to bramki vitest.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem, wiec
-- nie zostawia ani wiersza. Aktorzy sa WLASNI, nie pozyczone z innych plikow -
-- pliki w runtime_test.d musza byc niezalezne od siebie i od kolejnosci.
-- ============================================================================

\echo '== 90 strony modulowe: piatka, menu, idempotencja =='

BEGIN;

-- ── 0. Aktor: administrator najemcy A ───────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('a9000000-0000-0000-0000-000000000a01', 'admin@strony-modulowe.test');

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('a9000000-0000-0000-0000-000000000a01',
   '11111111-1111-1111-1111-111111111111', 'Administrator 90', 'admin-90');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('a9000000-0000-0000-0000-000000000a01', 'admin');

SELECT pg_temp.act_as('a9000000-0000-0000-0000-000000000a01',
                      '11111111-1111-1111-1111-111111111111');

-- ── 1. Kanoniczna piatka jest piatka ────────────────────────────────────────
-- Prog jest ROWNOSCIA, nie „co najmniej": szosty modul dopisany do funkcji ma
-- przyjsc razem ze swiadoma zmiana tej asercji, ekranu i frontu, a nie po cichu.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public._event_default_pages()) = 5,
  '90/piatka: _event_default_pages oddaje dokladnie piec modulow');

SELECT pg_temp.assert(
  (SELECT array_agg(module ORDER BY sort_order) FROM public._event_default_pages())
    = ARRAY['participants', 'speakers', 'partners', 'agenda', 'discussions'],
  '90/piatka: moduly i ich kolejnosc sa te, ktore obiecuje wzorzec');

-- Ikona i kolor MUSZA przejsc przez te same ograniczenia, ktore stoja na
-- kolumnach - inaczej zasiew wywroci sie na wlasnej wartosci domyslnej,
-- i to dopiero u pierwszego redaktora, ktory zaloz wydarzenie.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM public._event_default_pages() d
    WHERE d.icon !~ '^[a-z0-9-]{1,48}$' OR d.color !~ '^#[0-9A-Fa-f]{6}$'
  ),
  '90/piatka: kazda ikona i kolor przechodza CHECK z event_pages');

-- Dwie identyczne ikony w jednym menu sa defektem wygladu, ktorego nie widac
-- w zadnym tescie jednostkowym - a piec kolorow to piec, nie cztery.
SELECT pg_temp.assert(
  (SELECT count(DISTINCT icon) FROM public._event_default_pages()) = 5
  AND (SELECT count(DISTINCT color) FROM public._event_default_pages()) = 5,
  '90/piatka: piec roznych ikon i piec roznych kolorow');

-- ── 2. (a) NOWE WYDARZENIE DOSTAJE PIEC POZYCJI ─────────────────────────────
-- Rodzaj bierzemy z katalogu zaseedowanego migracja 20260823120000 i celowo
-- POMIJAMY rodzaje rejestrujace zewnetrznie: tamte wymagaja adresu https
-- w tym samym wywolaniu i test mierzylby wtedy walidacje adresu, nie zasiew.
CREATE TEMP TABLE t90 (event_id uuid, event_slug text);

INSERT INTO t90 (event_id)
SELECT public.admin_event_create(jsonb_build_object(
  'event_type_id', (SELECT et.id FROM public.event_types et
                     WHERE et.tenant_id = '11111111-1111-1111-1111-111111111111'
                       AND et.is_active
                       AND et.default_registration_mode <> 'external'
                     ORDER BY et.key LIMIT 1),
  'title_pl', 'Kongres modulowy 90',
  'title_en', 'Module congress 90',
  'starts_at', '2027-03-01T09:00:00+00:00',
  'timezone', 'Europe/Warsaw'
));

UPDATE t90 SET event_slug = (SELECT e.slug FROM public.events e WHERE e.id = t90.event_id);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module IS NOT NULL) = 5,
  '90/(a): admin_event_create zasiewa piec pozycji modulowych');

SELECT pg_temp.assert(
  (SELECT array_agg(l.module ORDER BY l.sort_order)
     FROM public.admin_event_pages_list((SELECT event_id FROM t90)) l
    WHERE l.module IS NOT NULL)
    = ARRAY['participants', 'speakers', 'partners', 'agenda', 'discussions'],
  '90/(a): lista panelu oddaje piec pozycji w kolejnosci wzorca');

-- Ikona i kolor sa CALA roznica miedzy menu wzorca i pieciu szarymi wierszami,
-- a `admin_event_page_create` nie przyjmuje klucza `color` - dlatego zasiew
-- pisze wprost do tabeli i dlatego to trzeba sprawdzic.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM public.admin_event_pages_list((SELECT event_id FROM t90)) l
    WHERE l.module IS NOT NULL AND (l.icon IS NULL OR l.color IS NULL)
  ),
  '90/(a): kazda pozycja modulowa ma ikone I kolor');

SELECT pg_temp.assert(
  (SELECT l.color FROM public.admin_event_pages_list((SELECT event_id FROM t90)) l
    WHERE l.module = 'participants') = '#D73953',
  '90/(a): kolor pozycji Uczestnicy jest ten zmierzony ze zrzutu 38');

-- Strona modulowa nie jest pusta: podglad w studiu i publiczny renderer czytaja
-- `pages.builder_data`, a pozycja menu prowadzaca do pustej kanwy jest tym
-- samym problemem, ktory ta migracja mial zlikwidowac.
SELECT pg_temp.assert(
  NOT EXISTS (
    SELECT 1 FROM public.event_pages ep
    JOIN public.pages pg ON pg.id = ep.page_id
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module IS NOT NULL
      AND (pg.builder_data IS NULL
           OR jsonb_array_length(pg.builder_data->'sections') < 1)
  ),
  '90/(a): kazda strona modulowa ma dokument buildera z co najmniej jedna sekcja');

-- Identyfikatory wezlow buildera musza byc ROZNE w jednym dokumencie: builder
-- adresuje nimi wezly przy edycji, wiec dwa te same znacza, ze edycja naglowka
-- rusza akapit.
SELECT pg_temp.assert(
  (SELECT count(DISTINCT node->>'id')
     FROM public.event_pages ep
     JOIN public.pages pg ON pg.id = ep.page_id,
          jsonb_array_elements(pg.builder_data->'sections') AS s,
          jsonb_array_elements(s->'children') AS c,
          jsonb_array_elements(c->'children') AS node
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module = 'agenda') = 2,
  '90/(a): dokument strony modulowej ma dwa wezly o ROZNYCH identyfikatorach');

-- ── 3. (b) `event_menu` JE ODDAJE - CZYLI SA `published` ────────────────────
-- TO JEST TA ASERCJA, KTORA SAMA ODTWORZYLABY ZGLOSZONA USTERKE. `event_menu`
-- filtruje `pg.status = 'published'` ORAZ `_event_page_chain_published(pg.id)`
-- (20260826120000:795-797). Zasiew w `draft` - albo zasiew stron opublikowanych
-- pod SZKICOWYM korzeniem - dalby piec pozycji w panelu i PUSTE menu na froncie.
UPDATE public.events SET status = 'published' WHERE id = (SELECT event_id FROM t90);

-- Front czyta menu takze bez logowania.
SELECT pg_temp.act_as(NULL, NULL);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_menu((SELECT event_slug FROM t90))) = 5,
  '90/(b): event_menu oddaje piec pozycji anonimowemu gosciowi');

SELECT pg_temp.assert(
  (SELECT array_agg(m.module ORDER BY m.sort_order)
     FROM public.event_menu((SELECT event_slug FROM t90)) m)
    = ARRAY['participants', 'speakers', 'partners', 'agenda', 'discussions'],
  '90/(b): event_menu niesie znacznik module, wiec front nie musi zgadywac po slugu');

-- KONTRAPUNKT DLA KORZENIA. Gdyby korzen byl szkicem, lancuch przodkow nie
-- byl by opublikowany i asercja wyzej dalaby zero. Sprawdzamy to wprost, bo
-- to jest dokladnie ten blad, ktorego nie widac w panelu: korzen nie stoi jako
-- pozycja menu, wiec jego status nie ma gdzie zostac zauwazony.
SELECT pg_temp.assert(
  (SELECT pg.status::text FROM public.pages pg
    WHERE pg.id = (SELECT e.root_page_id FROM public.events e
                    WHERE e.id = (SELECT event_id FROM t90))) = 'published',
  '90/(b): korzen zalozony zasiewem jest opublikowany (lancuch przodkow)');

-- UKRYC WOLNO. `in_menu = false` wypycha pozycje z menu publicznego i wraca
-- jednym klikniecem - to jest ta droga, ktora RPC wskazuje zamiast odpiecia.
UPDATE public.event_pages SET in_menu = false
WHERE event_id = (SELECT event_id FROM t90) AND module = 'discussions';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_menu((SELECT event_slug FROM t90))) = 4,
  '90/(b): pozycja modulowa z in_menu = false wypada z menu publicznego');

UPDATE public.event_pages SET in_menu = true
WHERE event_id = (SELECT event_id FROM t90) AND module = 'discussions';

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_menu((SELECT event_slug FROM t90))) = 5,
  '90/(b): i wraca do menu po odwroceniu przelacznika');

-- ── 4. (c) POWTORNY ZASIEW NIE DUPLIKUJE ────────────────────────────────────
SELECT pg_temp.act_as('a9000000-0000-0000-0000-000000000a01',
                      '11111111-1111-1111-1111-111111111111');

SELECT pg_temp.assert(
  public._event_seed_default_pages('11111111-1111-1111-1111-111111111111',
                                   (SELECT event_id FROM t90)) = 0,
  '90/(c): powtorny zasiew zaklada ZERO nowych stron');

-- Lista panelu SAMA zasiewa na wejsciu (dla wydarzen sprzed tej migracji), wiec
-- dwa wejscia na ekran to dwa zasiewy. Dziesiec pozycji zamiast pieciu byloby
-- stanem, z ktorego redaktor nie ma wyjscia: piatki nie da sie odpiac.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.admin_event_pages_list((SELECT event_id FROM t90)) l
    WHERE l.module IS NOT NULL) = 5,
  '90/(c): trzecie wejscie na liste nadal daje piec pozycji, nie dziesiec');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.pages pg
    WHERE pg.parent_id = (SELECT e.root_page_id FROM public.events e
                           WHERE e.id = (SELECT event_id FROM t90))) = 5,
  '90/(c): pod korzeniem lezy piec stron, nie dziesiec (brak stron-sierot)');

-- Unikat czesciowy jest CALA idempotencja, wiec musi odmawiac takze zapisowi
-- wprost - inaczej dowodzilibysmy tylko petli w plpgsql.
--
-- STRONA MUSI BYC INNA NIZ ta, ktora agenda juz ma. Proba przypiecia TEJ SAMEJ
-- strony drugi raz lamie `event_pages_unique (tenant_id, event_id, page_id)`
-- i asercja mierzylaby inne ograniczenie - dlatego zakladamy strone wolna.
CREATE TEMP TABLE t90_wolna (page_id uuid);
WITH ins AS (
  INSERT INTO public.pages (tenant_id, slug, title_pl, title_en, status, editor, template_type)
  VALUES ('11111111-1111-1111-1111-111111111111', 'strona-wolna-90',
          'Wolna 90', 'Free 90', 'draft', 'builder', 'default')
  RETURNING id
)
INSERT INTO t90_wolna (page_id) SELECT id FROM ins;

SELECT pg_temp.assert_raises_like(
  format($$INSERT INTO public.event_pages (tenant_id, event_id, page_id, module)
           VALUES ('11111111-1111-1111-1111-111111111111', %L, %L, 'agenda')$$,
         (SELECT event_id FROM t90), (SELECT page_id FROM t90_wolna)),
  'event_pages_module_uniq',
  '90/(c): drugi wiersz z tym samym modulem lamie event_pages_module_uniq');

-- KONTRAPUNKT: ten sam zapis BEZ znacznika przechodzi. Unikat czesciowy nie
-- ma prawa ograniczac pozycji zwyklych - tych jest w wydarzeniu dowolnie wiele.
INSERT INTO public.event_pages (tenant_id, event_id, page_id, module)
VALUES ('11111111-1111-1111-1111-111111111111',
        (SELECT event_id FROM t90), (SELECT page_id FROM t90_wolna), NULL);

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module IS NULL) = 1,
  '90/(c): pozycja bez znacznika wchodzi bez przeszkod (kontrapunkt unikatu)');

DELETE FROM public.event_pages
WHERE event_id = (SELECT event_id FROM t90) AND module IS NULL;

-- Zbior wartosci znacznika jest zamkniety w CHECK, nie w kodzie klienta.
SELECT pg_temp.assert_raises_like(
  format($$UPDATE public.event_pages SET module = 'sponsorzy'
           WHERE event_id = %L AND module = 'partners'$$,
         (SELECT event_id FROM t90)),
  'event_pages_module_values',
  '90/(c): znacznik poza zbiorem pieciu modulow jest odrzucany');

-- ── 5. (d) ODPIECIE POZYCJI MODULOWEJ JEST ODRZUCANE ────────────────────────
SELECT pg_temp.assert_raises_like(
  format($$SELECT public.admin_event_page_detach(%L)$$,
         (SELECT ep.id FROM public.event_pages ep
           WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module = 'agenda')),
  'module_page',
  '90/(d): odpiecie pozycji modulowej odmawia z nazwanym powodem module_page');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module = 'agenda') = 1,
  '90/(d): po odmowie pozycja modulowa NADAL istnieje');

-- KONTRAPUNKT: oslona nie jest blokada na wszystko. Zwykla pozycja - zalozona
-- rekami redakcji przez `admin_event_page_create` - odpina sie dalej.
-- Bez tego asercja wyzej dowodzilaby tylko tego, ze funkcja zawsze pada.
CREATE TEMP TABLE t90_zwykla (entry_id uuid);
INSERT INTO t90_zwykla (entry_id)
SELECT public.admin_event_page_create(jsonb_build_object(
  'event_id', (SELECT event_id FROM t90),
  'title_pl', 'Materialy prasowe',
  'title_en', 'Press materials'
));

SELECT pg_temp.assert(
  (SELECT ep.module FROM public.event_pages ep
    WHERE ep.id = (SELECT entry_id FROM t90_zwykla)) IS NULL,
  '90/(d): pozycja zalozona przez redakcje NIE ma znacznika modulu');

SELECT pg_temp.assert(
  public.admin_event_page_detach((SELECT entry_id FROM t90_zwykla)) = true,
  '90/(d): zwykla pozycja menu odpina sie dalej (kontrapunkt oslony)');

-- ── 6. (e) ZAPIS Z PANELU NIE CZYSCI ZNACZNIKA ──────────────────────────────
-- Klient wysyla przy KAZDEJ zmianie CALY wiersz (`eventPagesApi.ts:272-296`),
-- wiec pierwsze przelaczenie „w menu / poza menu" jest pierwsza okazja do
-- wyczyszczenia znacznika. Gdyby `module` wszedl na liste
-- `ON CONFLICT … DO UPDATE SET`, pozycja przestalaby byc modulowa, dalaby sie
-- odpiac, a leniwy zasiew zalozylby SZOSTA strone o tej samej tresci.
SELECT pg_temp.assert(
  public.admin_event_page_upsert(jsonb_build_object(
    'id', (SELECT ep.id FROM public.event_pages ep
            WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module = 'agenda'),
    'menu_label_pl', 'Program',
    'menu_label_en', 'Programme',
    'icon', 'calendar-days',
    'color', '#6A48C8',
    'in_menu', false,
    'sort_order', 40,
    'visible_to_groups', '[]'::jsonb
  )) IS NOT NULL,
  '90/(e): zapis calego wiersza pozycji modulowej przechodzi');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module = 'agenda'
      AND ep.in_menu = false AND ep.menu_label_pl = 'Program') = 1,
  '90/(e): zmiana z panelu weszla (etykieta i przelacznik)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_pages ep
    WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module IS NOT NULL) = 5,
  '90/(e): znacznik przezyl zapis - nadal piec pozycji modulowych');

-- Pozycja, ktorej znacznik przezyl zapis, NADAL nie daje sie odpiac. To jest
-- pelna petla usterki: gdyby znacznik zniknal, ta asercja bylaby zielona
-- z bledu, wiec sprawdzamy ja PO zapisie, nie przed.
SELECT pg_temp.assert_raises_like(
  format($$SELECT public.admin_event_page_detach(%L)$$,
         (SELECT ep.id FROM public.event_pages ep
           WHERE ep.event_id = (SELECT event_id FROM t90) AND ep.module = 'agenda')),
  'module_page',
  '90/(e): po zapisie z panelu pozycja modulowa nadal nie daje sie odpiac');

-- ── 7. (f) PULAPKA `STABLE` - DOWOD WYKONAWCZY ──────────────────────────────
-- `admin_event_pages_list` bylo `STABLE` i musialo przestac, bo zasiewa. To NIE
-- jest kosmetyka deklaracji: funkcja niewolatylna nie moze wykonac instrukcji
-- zmieniajacej dane, a PostgreSQL odmawia w RUNTIME - nie przy
-- `CREATE FUNCTION`. Zasiew w funkcji `STABLE` wywalilby wiec KAZDE wejscie na
-- ekran „Strony i menu", a replay migracji przeszedlby na zielono.
CREATE FUNCTION pg_temp.stable_writer_90() RETURNS integer
LANGUAGE plpgsql STABLE AS $$
BEGIN
  INSERT INTO public.tenants (id, name, slug)
  VALUES ('99999999-9999-9999-9999-999999999999', 'Nie wejdzie', 'nie-wejdzie');
  RETURN 1;
END $$;

SELECT pg_temp.assert_raises_like(
  'SELECT pg_temp.stable_writer_90()',
  'non-volatile function',
  '90/(f): funkcja STABLE nie moze zasiac - Postgres odmawia w runtime');

SELECT pg_temp.assert(
  (SELECT p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_event_pages_list') = 'v',
  '90/(f): admin_event_pages_list jest zadeklarowana jako VOLATILE');

-- Zasiew i pomocniki maja ACL zamkniety jak kazdy `_event_*`: domyslny ACL
-- funkcji znaczy EXECUTE dla PUBLIC, czyli takze dla `anon`.
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_seed_default_pages(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
        'public._event_seed_default_pages(uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role',
        'public._event_seed_default_pages(uuid,uuid)', 'EXECUTE'),
  '90/(f): zasiew jest zamkniety dla anon i authenticated, otwarty dla service_role');

ROLLBACK;

\echo '== 90 strony modulowe: koniec =='
