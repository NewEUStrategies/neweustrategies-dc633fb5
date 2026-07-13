-- pgTAP: ankiety (polls, poll_votes) + program kontrybutorow
-- (contributor_submissions).
--
--   1. Publiczny odczyt ankiet pomija szkice.
--   2. vote_poll: walidacja opcji, zamkniete/przeterminowane ankiety odpadaja,
--      zmiana glosu to upsert (total sie nie dubluje).
--   3. Anti-anchoring: wyniki (get_poll_results / _bulk) widoczne dopiero po
--      oddaniu glosu albo po zamknieciu ankiety.
--   4. Zapis bezposredni do poll_votes jest niemozliwy (polityki-zalazki
--      usuniete, grant INSERT cofniety) - RPC-only.
--   5. Zgloszenia kontrybutorow: own insert (tylko status submitted), rate
--      limit 3/24h, izolacja odczytu (own + staff wlasnego tenanta),
--      akceptacja nadaje odznake contributor i powiadamia autora.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(21);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('f1111111-1111-1111-1111-111111111111', 'tenant-polls-x', 'Polls X');

INSERT INTO auth.users (id, email) VALUES
  ('f1000000-0000-0000-0000-0000000000aa', 'voter1@polls.test'),
  ('f1000000-0000-0000-0000-0000000000bb', 'voter2@polls.test'),
  ('f1000000-0000-0000-0000-0000000000cc', 'editor-nes@polls.test'),
  ('f1000000-0000-0000-0000-0000000000dd', 'admin-foreign@polls.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('f1000000-0000-0000-0000-0000000000aa', 'voter1@polls.test', 'Voter One',
   (SELECT public.public_tenant_id())),
  ('f1000000-0000-0000-0000-0000000000bb', 'voter2@polls.test', 'Voter Two',
   (SELECT public.public_tenant_id())),
  ('f1000000-0000-0000-0000-0000000000cc', 'editor-nes@polls.test', 'Editor Nes',
   (SELECT public.public_tenant_id())),
  ('f1000000-0000-0000-0000-0000000000dd', 'admin-foreign@polls.test', 'Admin Foreign',
   'f1111111-1111-1111-1111-111111111111');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('f1000000-0000-0000-0000-0000000000cc', 'admin', (SELECT public.public_tenant_id())),
  ('f1000000-0000-0000-0000-0000000000dd', 'admin', 'f1111111-1111-1111-1111-111111111111');

INSERT INTO public.polls (id, tenant_id, question_pl, question_en, options, status, ends_at) VALUES
  ('f2222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'Otwarta?', 'Open?',
   '[{"pl":"Tak","en":"Yes"},{"pl":"Nie","en":"No"},{"pl":"Nie wiem","en":"Unsure"}]'::jsonb,
   'open', NULL),
  ('f2222222-2222-2222-2222-222222222202', (SELECT public.public_tenant_id()),
   'Zamknieta?', 'Closed?',
   '[{"pl":"Tak","en":"Yes"},{"pl":"Nie","en":"No"}]'::jsonb,
   'closed', NULL),
  ('f2222222-2222-2222-2222-222222222203', (SELECT public.public_tenant_id()),
   'Szkic?', 'Draft?',
   '[{"pl":"Tak","en":"Yes"},{"pl":"Nie","en":"No"}]'::jsonb,
   'draft', NULL),
  ('f2222222-2222-2222-2222-222222222204', (SELECT public.public_tenant_id()),
   'Po terminie?', 'Expired?',
   '[{"pl":"Tak","en":"Yes"},{"pl":"Nie","en":"No"}]'::jsonb,
   'open', now() - interval '1 day');

-- -- 1. Publiczny odczyt ------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.polls
    WHERE id IN ('f2222222-2222-2222-2222-222222222201',
                 'f2222222-2222-2222-2222-222222222202',
                 'f2222222-2222-2222-2222-222222222203',
                 'f2222222-2222-2222-2222-222222222204')),
  3,
  'anon widzi ankiety open/closed, nigdy draft'
);

-- -- 2. vote_poll + anti-anchoring ---------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  ((public.get_poll_results('f2222222-2222-2222-2222-222222222201')) ->> 'visible')::boolean,
  false,
  'przed oddaniem glosu wyniki otwartej ankiety sa ukryte (anti-anchoring)'
);

SELECT is(
  ((public.get_poll_results('f2222222-2222-2222-2222-222222222202')) ->> 'visible')::boolean,
  true,
  'wyniki zamknietej ankiety sa widoczne bez glosowania'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.vote_poll('f2222222-2222-2222-2222-222222222201', 9) $$,
  'P0001',
  NULL,
  'glos na nieistniejaca opcje odpada'
);

SELECT throws_ok(
  $$ SELECT public.vote_poll('f2222222-2222-2222-2222-222222222202', 0) $$,
  'P0001',
  NULL,
  'glos w zamknietej ankiecie odpada'
);

SELECT throws_ok(
  $$ SELECT public.vote_poll('f2222222-2222-2222-2222-222222222204', 0) $$,
  'P0001',
  NULL,
  'glos po ends_at odpada'
);

SELECT is(
  ((public.vote_poll('f2222222-2222-2222-2222-222222222201', 0)) ->> 'total')::int,
  1,
  'poprawny glos przechodzi i odslania wyniki (total=1)'
);

SELECT is(
  ((public.vote_poll('f2222222-2222-2222-2222-222222222201', 1)) ->> 'my_vote')::int,
  1,
  'zmiana glosu to upsert (my_vote=1)'
);

SELECT is(
  ((public.get_poll_results('f2222222-2222-2222-2222-222222222201')) ->> 'total')::int,
  1,
  'zmiana glosu nie dubluje total (nadal 1)'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_poll_results_bulk(
     ARRAY['f2222222-2222-2222-2222-222222222201',
           'f2222222-2222-2222-2222-222222222202']::uuid[]) b
    WHERE (b.result ->> 'visible')::boolean),
  2,
  'get_poll_results_bulk zwraca wyniki per ankieta (po glosie + zamknieta)'
);

SELECT throws_ok(
  $$ INSERT INTO public.poll_votes (poll_id, user_id, tenant_id, option_idx)
     VALUES ('f2222222-2222-2222-2222-222222222201',
             'f1000000-0000-0000-0000-0000000000aa',
             (SELECT public.public_tenant_id()), 0) $$,
  '42501',
  NULL,
  'bezposredni INSERT do poll_votes jest zabroniony (RPC-only)'
);

-- -- 3. Zgloszenia kontrybutorow ------------------------------------------------------
SELECT lives_ok(
  $$ INSERT INTO public.contributor_submissions (tenant_id, user_id, title, pitch, language)
     VALUES ((SELECT public.public_tenant_id()),
             'f1000000-0000-0000-0000-0000000000aa',
             'Pierwszy pitch',
             repeat('Tresc zgloszenia o polityce europejskiej. ', 3), 'pl') $$,
  'autor sklada zgloszenie (own insert, status submitted)'
);

SELECT throws_ok(
  $$ INSERT INTO public.contributor_submissions (tenant_id, user_id, title, pitch, language)
     VALUES ((SELECT public.public_tenant_id()),
             'f1000000-0000-0000-0000-0000000000bb',
             'Podszywka',
             repeat('Zgloszenie za kogos innego, niedozwolone. ', 3), 'pl') $$,
  '42501',
  NULL,
  'nie mozna zlozyc zgloszenia za innego uzytkownika'
);

-- Rate limit 3/24h: mamy 1, dokladamy 2 i czwarte odbija (trigger P0001).
SELECT lives_ok(
  $$ INSERT INTO public.contributor_submissions (tenant_id, user_id, title, pitch, language)
     VALUES ((SELECT public.public_tenant_id()),
             'f1000000-0000-0000-0000-0000000000aa',
             'Drugi pitch', repeat('Kolejna propozycja tekstu do redakcji. ', 3), 'pl') $$,
  'zgloszenie 2/3 w oknie dobowym'
);
SELECT lives_ok(
  $$ INSERT INTO public.contributor_submissions (tenant_id, user_id, title, pitch, language)
     VALUES ((SELECT public.public_tenant_id()),
             'f1000000-0000-0000-0000-0000000000aa',
             'Trzeci pitch', repeat('Jeszcze jedna propozycja dla redakcji. ', 3), 'pl') $$,
  'zgloszenie 3/3 w oknie dobowym'
);
SELECT throws_ok(
  $$ INSERT INTO public.contributor_submissions (tenant_id, user_id, title, pitch, language)
     VALUES ((SELECT public.public_tenant_id()),
             'f1000000-0000-0000-0000-0000000000aa',
             'Czwarty pitch', repeat('Ta propozycja przekracza limit dobowy. ', 3), 'pl') $$,
  'P0001',
  NULL,
  'czwarte zgloszenie w dobe odbija sie o rate limit'
);

-- Izolacja odczytu: inny uzytkownik nie widzi cudzych zgloszen; admin obcego
-- tenanta tez nie (staff read jest po current_tenant_id()).
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.contributor_submissions),
  0,
  'cudze zgloszenia sa niewidoczne (own read)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.contributor_submissions),
  0,
  'admin OBCEGO tenanta nie widzi zgloszen publicznego tenanta (izolacja cross-tenant)'
);

-- Akceptacja przez staff wlasciwego tenanta: odznaka + powiadomienie.
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT lives_ok(
  $$ UPDATE public.contributor_submissions SET status = 'accepted'
      WHERE title = 'Pierwszy pitch' $$,
  'staff publicznego tenanta akceptuje zgloszenie'
);

RESET ROLE;
SELECT is(
  (SELECT status FROM public.contributor_submissions WHERE title = 'Pierwszy pitch'),
  'accepted',
  'akceptacja zapisana (staff wlasciwego tenanta ma dostep)'
);
SELECT is(
  (SELECT count(*)::int FROM public.profile_badges
    WHERE user_id = 'f1000000-0000-0000-0000-0000000000aa' AND badge = 'contributor'),
  1,
  'akceptacja automatycznie nadaje odznake contributor'
);

SELECT * FROM finish();
ROLLBACK;
