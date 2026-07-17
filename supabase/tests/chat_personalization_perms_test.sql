-- pgTAP: RLS i uprawnienia dla personalizacji rozmów (PR #35).
--
-- Uzupełnia chat_personalization_test.sql o twarde asercje na warstwę
-- kontroli dostępu (nie tylko happy path w RPC):
--
--   1. Metatest uprawnień: role EXECUTE na trzech RPC (anon/authenticated/
--      service_role) - regresja zauważy przypadkowe GRANT-y dla anon lub
--      REVOKE dla authenticated.
--   2. anon (nieuwierzytelniony) NIE MOŻE wywołać żadnego z RPC (permission
--      denied) - kanoniczna warstwa "authentication required" liczy się
--      przed grantami przez REVOKE FROM PUBLIC, anon.
--   3. Bezpośrednie UPDATE / DELETE na conversation_nicknames przez zwykłego
--      członka rozmowy jest odrzucone przez RLS (brak polityk INSERT/UPDATE/
--      DELETE) - zapis wyłącznie przez SECURITY DEFINER RPC.
--   4. Bezpośredni UPDATE public.conversations przez członka omijający
--      chat_set_appearance / chat_set_group_description jest odrzucony przez
--      RLS - motyw i opis grupy przechodzą wyłącznie przez RPC.
--   5. Anonimowy SELECT z conversation_nicknames zwraca zero wierszy - polityka
--      RLS jest ograniczona do roli authenticated, więc anon nie zobaczy
--      pseudonimów mimo tabelarycznego grantu SELECT (RLS jest ostatnią linią).
--   6. Walidacje długości (nickname > 60, description > 500, quick_emoji > 16
--      znaków) - każdy RPC odrzuca nadmierne dane zanim dotknie tabeli.
--   7. Rozsiew realtime: chat_set_appearance i chat_set_group_description
--      podbijają updated_at wszystkich wierszy uczestników rozmowy - jedyny
--      mechanizm, przez który peers otrzymują nowy wygląd/opis na żywo.
--   8. Publikacja realtime obejmuje conversation_nicknames - inaczej klient nie
--      zobaczy nadanego pseudonimu bez ręcznego refetch.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Osobne UUID (sufix "p5"), żeby test nie kolidował z chat_personalization_test.
INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-11111111f5aa', 'perms-tenant-a', 'Perms Tenant A'),
  ('b2222222-2222-2222-2222-22222222f5bb', 'perms-tenant-b', 'Perms Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000f5a1', 'perms-a1@chat.test'),
  ('a0000000-0000-0000-0000-00000000f5a2', 'perms-a2@chat.test'),
  ('b0000000-0000-0000-0000-00000000f5b1', 'perms-b1@chat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('a0000000-0000-0000-0000-00000000f5a1', 'perms-a1@chat.test', 'Perms A1', 'a1111111-1111-1111-1111-11111111f5aa', false),
  ('a0000000-0000-0000-0000-00000000f5a2', 'perms-a2@chat.test', 'Perms A2', 'a1111111-1111-1111-1111-11111111f5aa', true),
  ('b0000000-0000-0000-0000-00000000f5b1', 'perms-b1@chat.test', 'Perms B1', 'b2222222-2222-2222-2222-22222222f5bb', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-00000000f5a2');
SELECT public.create_group_conversation('Krąg uprawnień',
  ARRAY['a0000000-0000-0000-0000-00000000f5a2']::uuid[]);

RESET ROLE;
CREATE TEMP TABLE permsconv AS
SELECT id FROM public.conversations
WHERE direct_key = 'a1111111-1111-1111-1111-11111111f5aa'
  || ':a0000000-0000-0000-0000-00000000f5a1'
  || ':a0000000-0000-0000-0000-00000000f5a2';
CREATE TEMP TABLE permsgroup AS
SELECT id FROM public.conversations
WHERE kind = 'group' AND title = 'Krąg uprawnień';
GRANT SELECT ON permsconv TO authenticated, anon;
GRANT SELECT ON permsgroup TO authenticated, anon;

-- ── 1) Metatest uprawnień EXECUTE ───────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated',
    'public.chat_set_appearance(uuid, text, text, text)', 'EXECUTE'),
  'authenticated MA EXECUTE na chat_set_appearance'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'public.chat_set_appearance(uuid, text, text, text)', 'EXECUTE'),
  'anon NIE MA EXECUTE na chat_set_appearance'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.chat_set_group_description(uuid, text)', 'EXECUTE'),
  'authenticated MA EXECUTE na chat_set_group_description'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'public.chat_set_group_description(uuid, text)', 'EXECUTE'),
  'anon NIE MA EXECUTE na chat_set_group_description'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.chat_set_nickname(uuid, uuid, text)', 'EXECUTE'),
  'authenticated MA EXECUTE na chat_set_nickname'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'public.chat_set_nickname(uuid, uuid, text)', 'EXECUTE'),
  'anon NIE MA EXECUTE na chat_set_nickname'
);

-- ── 2) anon nie może wywołać żadnego RPC ────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.chat_set_appearance((SELECT id FROM permsconv), 'ocean')$$,
  '42501',
  NULL,
  'anon: chat_set_appearance odrzucony (permission denied)'
);
SELECT throws_ok(
  $$SELECT public.chat_set_group_description((SELECT id FROM permsgroup), 'X')$$,
  '42501',
  NULL,
  'anon: chat_set_group_description odrzucony (permission denied)'
);
SELECT throws_ok(
  $$SELECT public.chat_set_nickname((SELECT id FROM permsconv),
      'a0000000-0000-0000-0000-00000000f5a2', 'X')$$,
  '42501',
  NULL,
  'anon: chat_set_nickname odrzucony (permission denied)'
);

-- ── 5) anon SELECT z conversation_nicknames widzi 0 wierszy (RLS) ──────────
-- Najpierw uczestnik zapisze pseudonim, żeby wiersz istniał.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
SELECT public.chat_set_nickname((SELECT id FROM permsconv),
  'a0000000-0000-0000-0000-00000000f5a2', 'Kolega z Brukseli');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames),
  1,
  'pseudonim zapisany w tabeli (widok superusera)'
);

SET LOCAL ROLE anon;
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames),
  0,
  'anon: RLS ukrywa pseudonimy (polityka ograniczona do authenticated)'
);

-- ── 3) Bezpośredni UPDATE / DELETE na conversation_nicknames przez członka ─
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$UPDATE public.conversation_nicknames
      SET nickname = 'Przejęcie'
    WHERE conversation_id = (SELECT id FROM permsconv)$$,
  '42501',
  NULL,
  'członek: bezpośredni UPDATE pseudonimu odrzucony (brak polityki RLS)'
);
SELECT throws_ok(
  $$DELETE FROM public.conversation_nicknames
    WHERE conversation_id = (SELECT id FROM permsconv)$$,
  '42501',
  NULL,
  'członek: bezpośredni DELETE pseudonimu odrzucony (brak polityki RLS)'
);

-- ── 4) Bezpośredni UPDATE public.conversations przez członka odrzucony ─────
SELECT throws_ok(
  $$UPDATE public.conversations
      SET theme = 'ocean'
    WHERE id = (SELECT id FROM permsconv)$$,
  '42501',
  NULL,
  'członek: bezpośredni UPDATE conversations.theme odrzucony (RLS wymusza RPC)'
);
SELECT throws_ok(
  $$UPDATE public.conversations
      SET description = 'Przejęcie'
    WHERE id = (SELECT id FROM permsgroup)$$,
  '42501',
  NULL,
  'członek: bezpośredni UPDATE conversations.description odrzucony (RLS wymusza RPC)'
);

-- ── 6) Walidacje długości ──────────────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.chat_set_nickname((SELECT id FROM permsconv),
      'a0000000-0000-0000-0000-00000000f5a2', repeat('x', 61))$$,
  NULL,
  'chat: nickname too long',
  'pseudonim > 60 znaków odrzucony'
);
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_group_description((SELECT id FROM permsgroup),
      repeat('x', 501))$$,
  NULL,
  'chat: description too long',
  'opis grupy > 500 znaków odrzucony'
);
SELECT throws_ok(
  $$SELECT public.chat_set_appearance((SELECT id FROM permsconv),
      p_quick_emoji => repeat('a', 17))$$,
  NULL,
  'chat: invalid quick emoji',
  'quick_emoji > 16 znaków odrzucony'
);

-- ── 7) Rozsiew realtime: RPC podbijają updated_at uczestników ──────────────
-- appearance
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
RESET ROLE;
UPDATE public.conversation_participants
   SET updated_at = now() - interval '1 hour'
 WHERE conversation_id = (SELECT id FROM permsconv);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
SELECT public.chat_set_appearance((SELECT id FROM permsconv), 'sunset');

RESET ROLE;
SELECT ok(
  (SELECT bool_and(updated_at > now() - interval '30 seconds')
     FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM permsconv)),
  'chat_set_appearance podbija updated_at KAŻDEGO uczestnika (rozsiew realtime)'
);

-- description
UPDATE public.conversation_participants
   SET updated_at = now() - interval '1 hour'
 WHERE conversation_id = (SELECT id FROM permsgroup);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000f5a1","role":"authenticated"}', true);
SELECT public.chat_set_group_description((SELECT id FROM permsgroup),
  'Nowy opis kręgu strategii');

RESET ROLE;
SELECT ok(
  (SELECT bool_and(updated_at > now() - interval '30 seconds')
     FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM permsgroup)),
  'chat_set_group_description podbija updated_at każdego uczestnika grupy'
);

-- ── 8) Publikacja realtime obejmuje conversation_nicknames ─────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'conversation_nicknames'
  ),
  'conversation_nicknames należy do publikacji supabase_realtime'
);

-- ── Guard-y międzytenantowe ────────────────────────────────────────────────
-- Właściciel jednej rozmowy nie zmieni opisu grupy innego tenanta.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000f5b1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_group_description((SELECT id FROM permsgroup), 'Obcy')$$,
  NULL,
  'chat: owner required',
  'user z innego tenanta nie zmieni opisu grupy (owner_required)'
);
SELECT throws_ok(
  $$SELECT public.chat_set_nickname((SELECT id FROM permsconv),
      'a0000000-0000-0000-0000-00000000f5a2', 'Obcy')$$,
  NULL,
  'chat: not a member',
  'user z innego tenanta nie nada pseudonimu w cudzej rozmowie'
);

SELECT * FROM finish();
ROLLBACK;
