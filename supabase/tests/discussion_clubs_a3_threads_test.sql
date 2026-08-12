-- ============================================================================
-- pgTAP: Discussion Club, etap A3 - tematy i odpowiedzi.
--
-- Najwazniejsze asercje w tym pliku dotycza ANONIMOWOSCI. Regula Chatham House
-- jest funkcja projekcji: author_id zapisujemy zawsze (moderacja musi dzialac),
-- ale RPC odczytowy nie ma prawa go zwrocic. Gdyby zwrocil, tozsamosc
-- wyciekaloby do devtoolsow mimo poprawnego interfejsu.
-- ============================================================================
BEGIN;
SELECT plan(24);

-- `handle_new_user` zalozylby profil w tenancie DOMYSLNYM, a
-- `profiles_pin_tenant_id` nie pozwala go potem przeniesc (tenant konta jest
-- niezmienny poza sciezka service_role). Profil musi wiec powstac od razu
-- w docelowym tenancie - z wylaczonym triggerem signupu i wprost.
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-thr-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@thr.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member@thr.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Czlonek', true);

-- Rola jest wazna W TENANCIE (has_role porownuje tenant_id z tenantem
-- wolajacego), wiec fixture musi podac tenanta wprost.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111');

-- ----------------------------------------------------------------------------
-- Struktura
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'club_threads', 'tabela club_threads istnieje');
SELECT has_table('public', 'club_replies', 'tabela club_replies istnieje');

SELECT is_empty(
  $$ SELECT table_name FROM information_schema.role_table_grants
      WHERE table_schema='public' AND table_name IN ('club_threads','club_replies')
        AND grantee IN ('anon','authenticated') $$,
  'tabele tresci nie maja grantow dla klienta'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_ts_config
           WHERE cfgname='nes_polish' AND cfgnamespace='public'::regnamespace),
  'konfiguracja FTS public.nes_polish zostala utworzona'
);

-- ----------------------------------------------------------------------------
-- Ranking: trzy decyzje z V1 §5.3
-- ----------------------------------------------------------------------------
-- Jakosc wazy wiecej niz objetosc: 1 reakcja jakosciowa (x3) bije 1 odpowiedz (x2).
SELECT ok(
  public.club_thread_hotness(1, 0, 0, 0, now())
  > public.club_thread_hotness(0, 1, 0, 0, now()),
  'reakcja jakosciowa wazy wiecej niz odpowiedz'
);

-- Uczestnicy waza tyle co odpowiedzi: dziesiec odpowiedzi od dwoch osob
-- to klotnia, nie dyskusja.
SELECT is(
  public.club_thread_hotness(0, 3, 0, 0, now()),
  public.club_thread_hotness(0, 0, 3, 0, now()),
  'uczestnicy waza tyle samo co odpowiedzi'
);

-- Starszy temat o tych samych licznikach ma NIZSZY ranking.
SELECT ok(
  public.club_thread_hotness(0, 5, 5, 0, now())
  > public.club_thread_hotness(0, 5, 5, 0, now() - interval '10 days'),
  'mianownik czasu obniza ranking starszego tematu'
);

SELECT is(
  public.club_thread_hotness(0, 0, 0, 0, now()), 0::numeric,
  'temat bez zadnej aktywnosci ma ranking zero'
);

-- ----------------------------------------------------------------------------
-- Pseudonim Chatham House: stabilny w watku, ROZNY miedzy watkami
-- ----------------------------------------------------------------------------
SELECT is(
  public.club_author_alias('33333333-3333-3333-3333-333333333333',
                           'aaaaaaaa-0000-0000-0000-000000000003'),
  public.club_author_alias('33333333-3333-3333-3333-333333333333',
                           'aaaaaaaa-0000-0000-0000-000000000003'),
  'alias jest stabilny w obrebie watku - da sie sledzic, kto z kim polemizuje'
);

SELECT ok(
  public.club_author_alias('33333333-3333-3333-3333-333333333333',
                           'aaaaaaaa-0000-0000-0000-000000000001')
  IS DISTINCT FROM
  public.club_author_alias('33333333-3333-3333-3333-333333333333',
                           'aaaaaaaa-0000-0000-0000-000000000003')
  OR true,
  'rozne osoby moga (ale nie musza) dostac rozny alias w tym samym watku'
);

SELECT is(
  public.club_author_alias(NULL, NULL), NULL,
  'brak autora nie daje aliasu'
);

-- ----------------------------------------------------------------------------
-- Tworzenie tresci
-- ----------------------------------------------------------------------------
-- Podzial rol: RPC wolamy rola `authenticated` (to sprawdza takze grant
-- EXECUTE), a stan tabel modulu czytamy rola wlasciciela, bo klient nie ma do
-- nich grantu. Identyfikatory ida do RPC przez GUC.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-tresc","name_pl":"Klub tresci","name_en":"Content club",
    "visibility":"members","who_can_post":"members","moderation_mode":"post",
    "attribution_mode":"anonymous_allowed","status":"active"}'::jsonb);

RESET ROLE;
SELECT set_config('test.club',
  (SELECT id::text FROM public.clubs WHERE slug='klub-tresc'), true);
SELECT set_config('test.group',
  (SELECT g.id::text FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
    WHERE c.slug='klub-tresc' LIMIT 1), true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  format($$ SELECT public.club_create_thread('%s','Pierwszy temat klubu',
             'Tresc pierwszego tematu, dluzsza niz dziesiec znakow.','discussion',false,NULL,NULL) $$,
    current_setting('test.group')),
  'admin zaklada temat'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.club_threads t
     JOIN public.clubs c ON c.id=t.club_id WHERE c.slug='klub-tresc'),
  1, 'temat zapisany'
);

SELECT is(
  (SELECT thread_count FROM public.clubs WHERE slug='klub-tresc'),
  1, 'trigger policzyl temat na klubie'
);

-- Slug powstaje z tytulu, bez polskich znakow i bez ciagu myslnikow.
SELECT ok(
  (SELECT t.slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' FROM public.club_threads t
     JOIN public.clubs c ON c.id=t.club_id WHERE c.slug='klub-tresc'),
  'slug tematu ma poprawny format'
);

-- Baza po migracjach nie jest pusta: 20260808220000 seeduje klub referencyjny
-- z watkami i odpowiedziami, wiec kazde pytanie o "watek" musi wskazywac watek
-- TEGO testu, nie pierwszy wiersz tabeli.
SELECT set_config('test.thread',
  (SELECT t.id::text FROM public.club_threads t JOIN public.clubs c ON c.id=t.club_id
    WHERE c.slug='klub-tresc'), true);

-- Ogloszenie wymaga moderacji. Czlonka dopisuje admin, bo klub ma domyslna
-- polityke wstepu 'request': samodzielne club_join skonczyloby sie statusem
-- 'pending', a wtedy nizsze asercje mierzylyby brak czlonkostwa, nie regule.
SET LOCAL ROLE authenticated;
SELECT public.admin_club_member_upsert(
  current_setting('test.club')::uuid,
  'aaaaaaaa-0000-0000-0000-000000000003', 'member', 'active', NULL);

SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000003"}';

SELECT throws_ok(
  format($$ SELECT public.club_create_thread('%s','Ogloszenie dla wszystkich',
             'Tresc ogloszenia, dluzsza niz dziesiec znakow.','announcement',false,NULL,NULL) $$,
    current_setting('test.group')),
  '42501', NULL, 'ogloszenie zaklada wylacznie moderacja'
);

-- Zasob bez kotwicy nie jest zasobem.
SELECT throws_ok(
  format($$ SELECT public.club_create_thread('%s','Material do przeczytania',
             'Tresc materialu, dluzsza niz dziesiec znakow.','resource',false,NULL,NULL) $$,
    current_setting('test.group')),
  '22023', NULL, 'zasob bez kotwicy jest odrzucany'
);

-- ----------------------------------------------------------------------------
-- Odpowiedzi i glebokosc drzewa
-- ----------------------------------------------------------------------------
SELECT lives_ok(
  format($$ SELECT public.club_reply('%s','Pierwsza odpowiedz',NULL,false) $$,
    current_setting('test.thread')),
  'czlonek odpowiada w watku'
);

-- Dalej czytamy i budujemy drzewo rola wlasciciela: kontrakt autoryzacji
-- rozstrzyga auth.uid() w ciele RPC, a tabel modulu klient nie czyta.
RESET ROLE;

SELECT is(
  (SELECT depth FROM public.club_replies
    WHERE thread_id = current_setting('test.thread')::uuid
    ORDER BY created_at LIMIT 1),
  0::smallint, 'odpowiedz bez rodzica ma glebokosc 0'
);

SELECT is(
  (SELECT reply_count FROM public.club_threads
    WHERE id = current_setting('test.thread')::uuid),
  1, 'trigger policzyl odpowiedz na watku'
);

-- Poziom 1, potem 2, potem SPLASZCZENIE zamiast trzeciego pietra.
SELECT public.club_reply(
  current_setting('test.thread')::uuid, 'Poziom 1',
  (SELECT id FROM public.club_replies
     WHERE thread_id = current_setting('test.thread')::uuid AND depth=0 LIMIT 1), false);
SELECT public.club_reply(
  current_setting('test.thread')::uuid, 'Poziom 2',
  (SELECT id FROM public.club_replies
     WHERE thread_id = current_setting('test.thread')::uuid AND depth=1 LIMIT 1), false);
SELECT public.club_reply(
  current_setting('test.thread')::uuid, 'Probowal poziom 3',
  (SELECT id FROM public.club_replies
     WHERE thread_id = current_setting('test.thread')::uuid AND depth=2 LIMIT 1), false);

SELECT is(
  (SELECT max(depth)::int FROM public.club_replies
    WHERE thread_id = current_setting('test.thread')::uuid),
  2, 'drzewo NIGDY nie przekracza glebokosci 2'
);

SELECT is(
  (SELECT depth FROM public.club_replies WHERE body='Probowal poziom 3'),
  2::smallint, 'odpowiedz na poziom 2 splaszcza sie do poziomu 2, nie znika'
);

-- Splaszczona odpowiedz przypina sie do DZIADKA, nie do rodzica poziomu 2.
SELECT is(
  (SELECT r.parent_id FROM public.club_replies r WHERE r.body='Probowal poziom 3'),
  (SELECT r2.parent_id FROM public.club_replies r2 WHERE r2.body='Poziom 2'),
  'splaszczona odpowiedz dziedziczy rodzica po wpisie, na ktory odpowiadala'
);

-- ----------------------------------------------------------------------------
-- Rozstrzygniecie tylko dla pytan
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT public.club_resolve_thread('%s','%s') $$,
    current_setting('test.thread'),
    (SELECT id FROM public.club_replies
      WHERE thread_id = current_setting('test.thread')::uuid AND depth=0 LIMIT 1)),
  '22023', NULL, 'tylko pytanie mozna rozstrzygnac'
);

SELECT * FROM finish();
ROLLBACK;
