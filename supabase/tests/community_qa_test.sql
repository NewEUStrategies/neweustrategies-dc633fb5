-- pgTAP: sesje Q&A (qa_sessions, qa_questions, qa_question_votes).
--
--   1. Publiczny odczyt sesji pomija szkice; pytania widac publicznie dopiero
--      w statusie approved/answered; kolumna user_id jest odcieta grantem
--      (anonimowosc Chatham House).
--   2. ask_qa_question: wymaga otwartej sesji ('qa: session closed'),
--      rate limit 5/h per (uzytkownik, sesja) ('qa: rate limited'),
--      author_display = nazwa profilu (nigdy pelny e-mail), pytanie
--      anonimowe bez author_display; host dostaje powiadomienie.
--   3. Zalazkowa polityka bezposredniego INSERT-u zostala usunieta - pytania
--      wchodza wylacznie przez RPC.
--   4. Glosy: tylko na pytania approved/answered, jeden glos (PK).
--   5. list_qa_questions: porzadek priorytet Pro (qa_priority) > glosy >
--      starszenstwo; zwraca licznik glosow i is_priority.
--   6. Moderacja hosta: host sesji przestawia statusy; odpowiedz stempluje
--      answered_at/by i powiadamia autora.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(22);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-0000-0000-0000000000aa', 'jan.kowalski@qa.test'),
  ('e1000000-0000-0000-0000-0000000000bb', 'pro-asker@qa.test'),
  ('e1000000-0000-0000-0000-0000000000cc', 'voter@qa.test'),
  ('e1000000-0000-0000-0000-0000000000dd', 'host@qa.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e1000000-0000-0000-0000-0000000000aa', 'jan.kowalski@qa.test', 'Jan Kowalski',
   (SELECT public.public_tenant_id())),
  ('e1000000-0000-0000-0000-0000000000bb', 'pro-asker@qa.test', 'Pro Asker',
   (SELECT public.public_tenant_id())),
  ('e1000000-0000-0000-0000-0000000000cc', 'voter@qa.test', 'Voter',
   (SELECT public.public_tenant_id())),
  ('e1000000-0000-0000-0000-0000000000dd', 'host@qa.test', 'Host',
   (SELECT public.public_tenant_id()));

-- Pro-subskrypcja dla pro-askera (flaga qa_priority w features warstwy pro).
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key)
VALUES ('e2222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
        'Pro (test)', 'Pro (test)', 9900, 'eur', 'month', 'pro');
INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end)
VALUES ('e1000000-0000-0000-0000-0000000000bb', 'e2222222-2222-2222-2222-222222222201',
        (SELECT public.public_tenant_id()), 'active', now() + interval '30 days');

INSERT INTO public.qa_sessions (id, tenant_id, slug, title_pl, title_en, host_user_id, status) VALUES
  ('e3333333-3333-3333-3333-333333333301', (SELECT public.public_tenant_id()),
   'qa-open', 'Sesja otwarta', 'Open session',
   'e1000000-0000-0000-0000-0000000000dd', 'open'),
  ('e3333333-3333-3333-3333-333333333302', (SELECT public.public_tenant_id()),
   'qa-draft', 'Szkic', 'Draft',
   'e1000000-0000-0000-0000-0000000000dd', 'draft'),
  ('e3333333-3333-3333-3333-333333333303', (SELECT public.public_tenant_id()),
   'qa-closed', 'Zamknieta', 'Closed',
   'e1000000-0000-0000-0000-0000000000dd', 'closed');

-- -- 1. Publiczny odczyt sesji + grant kolumnowy ---------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.qa_sessions
    WHERE slug IN ('qa-open', 'qa-draft', 'qa-closed')),
  2,
  'anon widzi sesje open/closed, nigdy draft'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.qa_questions', 'user_id', 'SELECT'),
  'qa_questions.user_id jest odciety od klienta (anonimowosc)'
);

-- -- 2. ask_qa_question ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333303',
       'Pytanie do zamknietej sesji') $$,
  'P0001',
  'qa: session closed',
  'pytanie do zamknietej sesji odpada'
);

SELECT lives_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301',
       'Pytanie podpisane nazwiskiem profilu') $$,
  'pytanie do otwartej sesji przechodzi'
);

SELECT lives_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301',
       'Pytanie anonimowe', true) $$,
  'pytanie anonimowe przechodzi'
);

-- Rate limit 5/h: mamy 2, dokladamy 3 i szoste odbija.
SELECT lives_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301', 'Pytanie nr 3') $$,
  'pytanie 3/5 w oknie godzinowym'
);
SELECT lives_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301', 'Pytanie nr 4') $$,
  'pytanie 4/5 w oknie godzinowym'
);
SELECT lives_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301', 'Pytanie nr 5') $$,
  'pytanie 5/5 w oknie godzinowym'
);
SELECT throws_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301', 'Pytanie nr 6') $$,
  'P0001',
  'qa: rate limited',
  'szoste pytanie w godzine odbija sie o rate limit'
);

-- Zalazkowy INSERT bezposredni jest zamkniety.
SELECT throws_ok(
  $$ INSERT INTO public.qa_questions (tenant_id, session_id, user_id, body, status)
     VALUES ((SELECT public.public_tenant_id()),
             'e3333333-3333-3333-3333-333333333301',
             'e1000000-0000-0000-0000-0000000000aa',
             'Pytanie boczna furtka', 'pending') $$,
  '42501',
  NULL,
  'bezposredni INSERT do qa_questions jest zabroniony (RPC-only)'
);

RESET ROLE;

SELECT is(
  (SELECT author_display FROM public.qa_questions
    WHERE body = 'Pytanie podpisane nazwiskiem profilu'),
  'Jan Kowalski',
  'author_display to nazwa profilu, nie pelny e-mail'
);

SELECT is(
  (SELECT author_display FROM public.qa_questions
    WHERE body = 'Pytanie anonimowe'),
  NULL,
  'pytanie anonimowe nie snapshotuje autora'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'e1000000-0000-0000-0000-0000000000dd' AND href = '/qa/qa-open'),
  1,
  'host sesji dostaje powiadomienie o nowym pytaniu (z dedupem 5 min)'
);

-- Identyfikatory pytan dla asercji glosowania: pytania pending sa niewidoczne
-- pod RLS, wiec voter nie moze ich wyselektowac - tabela tymczasowa niesie id.
CREATE TEMP TABLE qa_ids AS
  SELECT id, tenant_id, body FROM public.qa_questions;
GRANT SELECT ON qa_ids TO authenticated;

-- -- 3. Moderacja + publiczna widocznosc + glosy -----------------------------------
-- Pro-asker zadaje pytanie; host zatwierdza dwa pytania.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.ask_qa_question('e3333333-3333-3333-3333-333333333301',
       'Pytanie od czlonka Pro') $$,
  'pro-asker zadaje pytanie'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT lives_ok(
  $$ UPDATE public.qa_questions SET status = 'approved'
      WHERE body IN ('Pytanie podpisane nazwiskiem profilu', 'Pytanie od czlonka Pro') $$,
  'host sesji moderuje pytania (approve)'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.qa_questions WHERE status = 'approved'),
  2,
  'oba pytania zatwierdzone przez hosta'
);

-- Glos na zatwierdzone pytanie przechodzi; na pending odpada.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT lives_ok(
  $$ INSERT INTO public.qa_question_votes (question_id, user_id, tenant_id)
     SELECT q.id, 'e1000000-0000-0000-0000-0000000000cc', q.tenant_id
       FROM public.qa_questions q
      WHERE q.body = 'Pytanie podpisane nazwiskiem profilu' $$,
  'glos na zatwierdzone pytanie przechodzi'
);

SELECT throws_ok(
  $$ INSERT INTO public.qa_question_votes (question_id, user_id, tenant_id)
     SELECT q.id, 'e1000000-0000-0000-0000-0000000000cc', q.tenant_id
       FROM qa_ids q
      WHERE q.body = 'Pytanie anonimowe' $$,
  '42501',
  NULL,
  'glos na pytanie pending odpada (polityka approved/answered)'
);

-- -- 4. list_qa_questions: priorytet Pro > glosy > starszenstwo ---------------------
-- Pytanie zwykle ma 1 glos i jest starsze, ale pytanie Pro (qa_priority)
-- i tak laduje pierwsze.
SELECT is(
  (SELECT l.body FROM public.list_qa_questions('e3333333-3333-3333-3333-333333333301') l
    LIMIT 1),
  'Pytanie od czlonka Pro',
  'list_qa_questions sortuje pytania Pro (qa_priority) przed glosami'
);

SELECT is(
  (SELECT l.votes::int FROM public.list_qa_questions('e3333333-3333-3333-3333-333333333301') l
    WHERE l.body = 'Pytanie podpisane nazwiskiem profilu'),
  1,
  'list_qa_questions zwraca licznik glosow'
);

-- -- 5. Odpowiedz: stempel + powiadomienie autora -----------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT lives_ok(
  $$ UPDATE public.qa_questions
        SET status = 'answered', answer_body = 'Odpowiedz redakcji'
      WHERE body = 'Pytanie podpisane nazwiskiem profilu' $$,
  'host odpowiada na pytanie'
);

RESET ROLE;
SELECT ok(
  (SELECT answered_at IS NOT NULL AND answered_by = 'e1000000-0000-0000-0000-0000000000dd'
     FROM public.qa_questions
    WHERE body = 'Pytanie podpisane nazwiskiem profilu'),
  'odpowiedz stempluje answered_at/answered_by'
);

SELECT * FROM finish();
ROLLBACK;
