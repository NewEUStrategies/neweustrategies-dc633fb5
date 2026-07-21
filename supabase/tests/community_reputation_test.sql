-- pgTAP: reputacja spolecznosci + tablica kontrybutorow.
--
--   1. Punkty licza sie z istniejacych danych: odpowiedziane pytania Q&A (10),
--      zaakceptowane pytania (3), odznaki (contributor 30) - wagi w
--      contribution_scores, breakdown per zrodlo.
--   2. Tablica kontrybutorow szanuje prywatnosc: wylacznie profile
--      discoverable=true (opt-in katalogu /people) i bez kont redakcyjnych.
--   3. get_my_reputation: kazdy widzi wlasny wynik takze bez opt-in
--      (board_visible=false, bez pozycji).
--   4. RPC tylko dla zalogowanych.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(10);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('a5000000-0000-0000-0000-0000000000aa', 'rep-star@rep.test'),
  ('a5000000-0000-0000-0000-0000000000bb', 'rep-hidden@rep.test'),
  ('a5000000-0000-0000-0000-0000000000cc', 'rep-editor@rep.test'),
  ('a5000000-0000-0000-0000-0000000000dd', 'rep-viewer@rep.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id()),
       u.id <> 'a5000000-0000-0000-0000-0000000000bb'
  FROM auth.users u
 WHERE u.email LIKE '%@rep.test';

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('a5000000-0000-0000-0000-0000000000cc', 'editor', (SELECT public.public_tenant_id()));

-- Sesja Q&A pod pytania punktowane.
INSERT INTO public.qa_sessions (id, tenant_id, slug, title_pl, title_en, host_user_id, status) VALUES
  ('a5222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'rep-session', 'Sesja punktowa', 'Scoring session',
   'a5000000-0000-0000-0000-0000000000dd', 'closed');

-- star: 1 odpowiedziane pytanie (10) + odznaka contributor (30) = 40 pkt.
-- hidden: 1 zaakceptowane pytanie (3) - profil bez opt-in do katalogu.
-- editor: aktywnosc jak star, ale konto redakcyjne (poza tablica).
INSERT INTO public.qa_questions (tenant_id, session_id, user_id, author_display, body, status, answer_body) VALUES
  ((SELECT public.public_tenant_id()), 'a5222222-2222-2222-2222-222222222201',
   'a5000000-0000-0000-0000-0000000000aa', 'rep-star', 'Pytanie z odpowiedzia eksperta?', 'answered', 'Odpowiedz.'),
  ((SELECT public.public_tenant_id()), 'a5222222-2222-2222-2222-222222222201',
   'a5000000-0000-0000-0000-0000000000bb', 'rep-hidden', 'Pytanie zaakceptowane?', 'approved', NULL),
  ((SELECT public.public_tenant_id()), 'a5222222-2222-2222-2222-222222222201',
   'a5000000-0000-0000-0000-0000000000cc', 'rep-editor', 'Pytanie od redakcji?', 'answered', 'Odpowiedz.');

INSERT INTO public.profile_badges (tenant_id, user_id, badge) VALUES
  ((SELECT public.public_tenant_id()), 'a5000000-0000-0000-0000-0000000000aa', 'contributor');

-- -- 1. Tylko dla zalogowanych ------------------------------------------------------
-- REVOKE EXECUTE FROM anon zatrzymuje anonima juz na grancie (42501) -
-- wewnetrzny wyjatek P0001 to druga linia obrony dla zalogowanych bez sub.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok(
  $$ SELECT * FROM public.get_contributor_leaderboard(90, 10) $$,
  '42501',
  NULL,
  'tablica kontrybutorow wymaga zalogowania (jak katalog /people)'
);

-- -- 2. Punkty i prywatnosc tablicy --------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);

SELECT is(
  (SELECT l.points FROM public.get_contributor_leaderboard(90, 10) l
    WHERE l.user_id = 'a5000000-0000-0000-0000-0000000000aa'),
  40,
  'punkty: odpowiedziane pytanie (10) + odznaka contributor (30) = 40'
);

SELECT is(
  (SELECT (l.breakdown -> 'qa_answered' ->> 'points')::int
     FROM public.get_contributor_leaderboard(90, 10) l
    WHERE l.user_id = 'a5000000-0000-0000-0000-0000000000aa'),
  10,
  'breakdown rozbija punkty per zrodlo (qa_answered = 10)'
);

SELECT is(
  (SELECT l.board_position FROM public.get_contributor_leaderboard(90, 10) l
    WHERE l.user_id = 'a5000000-0000-0000-0000-0000000000aa'),
  1,
  'najwyzszy wynik otwiera tablice (pozycja 1)'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_contributor_leaderboard(90, 10) l
    WHERE l.user_id = 'a5000000-0000-0000-0000-0000000000bb'),
  0,
  'profil bez opt-in (discoverable=false) nie pojawia sie na tablicy'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_contributor_leaderboard(90, 10) l
    WHERE l.user_id = 'a5000000-0000-0000-0000-0000000000cc'),
  0,
  'konta redakcyjne nie konkuruja ze spolecznoscia (poza tablica)'
);

-- -- 3. Wlasna reputacja niezaleznie od widocznosci ---------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  ((public.get_my_reputation(90)) ->> 'points')::int,
  3,
  'get_my_reputation: ukryty profil widzi wlasne punkty (zaakceptowane pytanie = 3)'
);
SELECT is(
  ((public.get_my_reputation(90)) ->> 'board_visible')::boolean,
  false,
  'get_my_reputation: bez opt-in board_visible=false'
);
SELECT ok(
  ((public.get_my_reputation(90)) -> 'position') = 'null'::jsonb,
  'get_my_reputation: bez opt-in nie ma pozycji na tablicy'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT is(
  ((public.get_my_reputation(90)) ->> 'position')::int,
  1,
  'get_my_reputation: widoczny lider zna swoja pozycje (1)'
);

SELECT * FROM finish();
ROLLBACK;
