-- pgTAP: publikacja podsumowania sesji Q&A jako tresci (publish_qa_session_summary).
--
--   1. Bramki: tylko staff lub host sesji; sesja musi byc w fazie
--      answering/closed; bez odpowiedzianych pytan nie ma podsumowania.
--   2. Szkic: wpis powstaje jako draft (redakcyjny szlif), qa_sessions.post_id
--      zostaje spiety, tresc ma pelny escaping HTML (surowy tekst uzytkownikow)
--      i zachowuje anonimowosc Chatham House ('Anonimowo').
--   3. Porzadek: glosy spolecznosci > starszenstwo (pytanie z glosem jest
--      "Pytanie 1").
--   4. Publikacja: respektuje workflow redakcyjny (can_publish_content -
--      host-ekspert kompiluje szkic, publikuje admin), idempotentny upsert
--      (bez duplikatu), autorzy odpowiedzianych pytan dostaja powiadomienie;
--      raz opublikowany wpis nie wraca do szkicu.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('f1000000-0000-0000-0000-0000000000aa', 'qs-host@qs.test'),
  ('f1000000-0000-0000-0000-0000000000bb', 'qs-asker@qs.test'),
  ('f1000000-0000-0000-0000-0000000000cc', 'qs-anon@qs.test'),
  ('f1000000-0000-0000-0000-0000000000dd', 'qs-admin@qs.test');

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('f1000000-0000-0000-0000-0000000000dd', 'admin', (SELECT public.public_tenant_id()));

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.email LIKE '%@qs.test';

-- Wpisy wymagaja strony-rodzica (posts.parent_page_id NOT NULL) - kanoniczna
-- strona "blog" tenanta.
INSERT INTO public.pages (id, tenant_id, slug, title_pl, title_en, status)
VALUES ('f4444444-4444-4444-4444-444444444401', (SELECT public.public_tenant_id()),
        'blog', 'Blog', 'Blog', 'published')
ON CONFLICT DO NOTHING;

INSERT INTO public.qa_sessions (id, tenant_id, slug, title_pl, title_en, intro_pl, intro_en, host_user_id, status) VALUES
  ('f2222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'qs-ai-act', 'AI Act w praktyce', 'AI Act in practice',
   'Sesja o wdrazaniu AI Act.', 'A session on implementing the AI Act.',
   'f1000000-0000-0000-0000-0000000000aa', 'open');

-- Dwa pytania: jawne z proba XSS w tresci + anonimowe (z glosem spolecznosci).
INSERT INTO public.qa_questions (id, tenant_id, session_id, user_id, author_display, is_anonymous, body, status) VALUES
  ('f3333333-3333-3333-3333-333333333301', (SELECT public.public_tenant_id()),
   'f2222222-2222-2222-2222-222222222201', 'f1000000-0000-0000-0000-0000000000bb',
   'qs-asker', false, 'Czy <script>alert(1)</script> jest zgodny z AI Act?', 'approved'),
  ('f3333333-3333-3333-3333-333333333302', (SELECT public.public_tenant_id()),
   'f2222222-2222-2222-2222-222222222201', 'f1000000-0000-0000-0000-0000000000cc',
   NULL, true, 'Jak wyglada nadzor rynkowy po 2026 roku?', 'approved');

INSERT INTO public.qa_question_votes (question_id, user_id, tenant_id) VALUES
  ('f3333333-3333-3333-3333-333333333302', 'f1000000-0000-0000-0000-0000000000aa',
   (SELECT public.public_tenant_id()));

-- -- 1. Bramki dostepu i fazy sesji -----------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201') $$,
  'P0001',
  'qa: not allowed',
  'zwykly uczestnik (nie host, nie staff) nie opublikuje podsumowania'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201') $$,
  'P0001',
  'qa: session not summarizable',
  'otwarta sesja to za wczesnie na podsumowanie'
);

RESET ROLE;
UPDATE public.qa_sessions SET status = 'closed'
 WHERE id = 'f2222222-2222-2222-2222-222222222201';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201') $$,
  'P0001',
  'qa: no answered questions',
  'bez odpowiedzianych pytan nie ma czego publikowac'
);

RESET ROLE;
UPDATE public.qa_questions
   SET status = 'answered', answer_body = 'Krotka odpowiedz eksperta.'
 WHERE session_id = 'f2222222-2222-2222-2222-222222222201';

-- -- 2. Szkic: tresc, escaping, anonimowosc, porzadek glosow ------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  ((public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201', false)) ->> 'status'),
  'draft',
  'host tworzy podsumowanie jako szkic do redakcyjnego szlifu'
);

RESET ROLE;
SELECT is(
  (SELECT p.id FROM public.posts p
    WHERE p.tenant_id = (SELECT public.public_tenant_id())
      AND p.slug = 'qa-qs-ai-act-podsumowanie'),
  (SELECT s.post_id FROM public.qa_sessions s
    WHERE s.id = 'f2222222-2222-2222-2222-222222222201'),
  'qa_sessions.post_id jest spiety z utworzonym wpisem'
);

SELECT ok(
  (SELECT p.content_pl LIKE '%&lt;script&gt;%' AND p.content_pl NOT LIKE '%<script>%'
     FROM public.posts p WHERE p.slug = 'qa-qs-ai-act-podsumowanie'),
  'tresc pytan przechodzi pelny escaping HTML (XSS nie wchodzi do wpisu)'
);

SELECT ok(
  (SELECT p.content_pl LIKE '%Anonimowo%' AND p.content_en LIKE '%Anonymous%'
     FROM public.posts p WHERE p.slug = 'qa-qs-ai-act-podsumowanie'),
  'anonimowe pytanie zachowuje anonimowosc Chatham House w obu jezykach'
);

SELECT ok(
  (SELECT strpos(p.content_pl, 'nadzor rynkowy') < strpos(p.content_pl, 'zgodny z AI Act')
     FROM public.posts p WHERE p.slug = 'qa-qs-ai-act-podsumowanie'),
  'pytanie z glosem spolecznosci otwiera podsumowanie (glosy > starszenstwo)'
);

-- -- 3. Publikacja: workflow redakcyjny + idempotentny upsert + powiadomienia -----
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201', true) $$,
  'P0001',
  'qa: publish requires editorial role',
  'host bez roli redakcyjnej nie publikuje - kompiluje szkic, publikuje redakcja'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT is(
  ((public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201', true)) ->> 'status'),
  'published',
  'admin publikuje podsumowanie (workflow redakcyjny przechodzi)'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.posts p
    WHERE p.tenant_id = (SELECT public.public_tenant_id())
      AND p.slug = 'qa-qs-ai-act-podsumowanie'),
  1,
  'upsert jest idempotentny - jeden wpis, zero duplikatow'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id IN ('f1000000-0000-0000-0000-0000000000bb',
                        'f1000000-0000-0000-0000-0000000000cc')
      AND n.title_pl = 'Podsumowanie sesji Q&A jest już dostępne'),
  2,
  'publikacja powiadamia autorow odpowiedzianych pytan (takze anonimowych)'
);

-- Raz opublikowany wpis nie wraca do szkicu przy odswiezeniu tresci.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT is(
  ((public.publish_qa_session_summary('f2222222-2222-2222-2222-222222222201', false)) ->> 'status'),
  'published',
  'odswiezenie tresci nie cofa publikacji do szkicu'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.title_pl = 'Podsumowanie sesji Q&A jest już dostępne'),
  2,
  'powiadomienie o podsumowaniu wychodzi tylko przy pierwszej publikacji'
);

SELECT * FROM finish();
ROLLBACK;
