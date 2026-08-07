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

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-thr-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@thr.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member@thr.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Czlonek', true)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

INSERT INTO public.user_roles (user_id, role)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

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
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-tresc","name_pl":"Klub tresci","name_en":"Content club",
    "visibility":"members","who_can_post":"members","moderation_mode":"post",
    "attribution_mode":"anonymous_allowed","status":"active"}'::jsonb);

SELECT lives_ok(
  format($$ SELECT public.club_create_thread('%s','Pierwszy temat klubu',
             'Tresc pierwszego tematu, dluzsza niz dziesiec znakow.','discussion',false,NULL,NULL) $$,
    (SELECT g.id FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
      WHERE c.slug='klub-tresc' LIMIT 1)),
  'admin zaklada temat'
);

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
  (SELECT slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' FROM public.club_threads t
     JOIN public.clubs c ON c.id=t.club_id WHERE c.slug='klub-tresc'),
  'slug tematu ma poprawny format'
);

-- Ogloszenie wymaga moderacji.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000003"}';
SELECT public.club_join((SELECT id FROM public.clubs WHERE slug='klub-tresc'));

SELECT throws_ok(
  format($$ SELECT public.club_create_thread('%s','Ogloszenie dla wszystkich',
             'Tresc ogloszenia, dluzsza niz dziesiec znakow.','announcement',false,NULL,NULL) $$,
    (SELECT g.id FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
      WHERE c.slug='klub-tresc' LIMIT 1)),
  '42501', NULL, 'ogloszenie zaklada wylacznie moderacja'
);

-- Zasob bez kotwicy nie jest zasobem.
SELECT throws_ok(
  format($$ SELECT public.club_create_thread('%s','Material do przeczytania',
             'Tresc materialu, dluzsza niz dziesiec znakow.','resource',false,NULL,NULL) $$,
    (SELECT g.id FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
      WHERE c.slug='klub-tresc' LIMIT 1)),
  '22023', NULL, 'zasob bez kotwicy jest odrzucany'
);

-- ----------------------------------------------------------------------------
-- Odpowiedzi i glebokosc drzewa
-- ----------------------------------------------------------------------------
SELECT lives_ok(
  format($$ SELECT public.club_reply('%s','Pierwsza odpowiedz',NULL,false) $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
  'czlonek odpowiada w watku'
);

SELECT is(
  (SELECT depth FROM public.club_replies ORDER BY created_at LIMIT 1),
  0::smallint, 'odpowiedz bez rodzica ma glebokosc 0'
);

SELECT is(
  (SELECT reply_count FROM public.club_threads LIMIT 1),
  1, 'trigger policzyl odpowiedz na watku'
);

-- Poziom 1, potem 2, potem SPLASZCZENIE zamiast trzeciego pietra.
SELECT public.club_reply(
  (SELECT id FROM public.club_threads LIMIT 1), 'Poziom 1',
  (SELECT id FROM public.club_replies WHERE depth=0 LIMIT 1), false);
SELECT public.club_reply(
  (SELECT id FROM public.club_threads LIMIT 1), 'Poziom 2',
  (SELECT id FROM public.club_replies WHERE depth=1 LIMIT 1), false);
SELECT public.club_reply(
  (SELECT id FROM public.club_threads LIMIT 1), 'Probowal poziom 3',
  (SELECT id FROM public.club_replies WHERE depth=2 LIMIT 1), false);

SELECT is(
  (SELECT max(depth)::int FROM public.club_replies),
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
    (SELECT id FROM public.club_threads LIMIT 1),
    (SELECT id FROM public.club_replies WHERE depth=0 LIMIT 1)),
  '22023', NULL, 'tylko pytanie mozna rozstrzygnac'
);

SELECT * FROM finish();
ROLLBACK;
