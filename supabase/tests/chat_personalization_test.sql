-- pgTAP: personalizacja rozmów (migracja 20260716090000).
--
--   1. chat_set_appearance: uczestnik ustawia motyw/tapetę/szybką emotkę;
--      sentinel 'keep' zmienia tylko wskazane pole; NULL wraca do domyślnych;
--      wartości spoza whitelisty odrzucone; nie-uczestnik odrzucony.
--   2. Pseudonimy: zapis wyłącznie przez RPC (bezpośredni INSERT bez grantu),
--      widoczne dla członków rozmowy przez RLS, niewidoczne poza tenantem /
--      rozmową; pusty pseudonim usuwa wpis; cel spoza rozmowy odrzucony.
--   3. Opis grupy: tylko właściciel (jak zmiana tytułu).
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(17);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-11111111d4aa', 'pers-tenant-a', 'Pers Tenant A'),
  ('b2222222-2222-2222-2222-22222222d4bb', 'pers-tenant-b', 'Pers Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000d4a1', 'pers-a1@chat.test'),
  ('a0000000-0000-0000-0000-00000000d4a2', 'pers-a2@chat.test'),
  ('b0000000-0000-0000-0000-00000000d4b1', 'pers-b1@chat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('a0000000-0000-0000-0000-00000000d4a1', 'pers-a1@chat.test', 'Pers A1', 'a1111111-1111-1111-1111-11111111d4aa', false),
  ('a0000000-0000-0000-0000-00000000d4a2', 'pers-a2@chat.test', 'Pers A2', 'a1111111-1111-1111-1111-11111111d4aa', true),
  ('b0000000-0000-0000-0000-00000000d4b1', 'pers-b1@chat.test', 'Pers B1', 'b2222222-2222-2222-2222-22222222d4bb', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-00000000d4a2');
SELECT public.create_group_conversation('Krąg personalizacji',
  ARRAY['a0000000-0000-0000-0000-00000000d4a2']::uuid[]);

RESET ROLE;
CREATE TEMP TABLE persconv AS
SELECT id FROM public.conversations
WHERE direct_key = 'a1111111-1111-1111-1111-11111111d4aa'
  || ':a0000000-0000-0000-0000-00000000d4a1'
  || ':a0000000-0000-0000-0000-00000000d4a2';
CREATE TEMP TABLE persgroup AS
SELECT id FROM public.conversations
WHERE kind = 'group' AND title = 'Krąg personalizacji';
GRANT SELECT ON persconv TO authenticated;
GRANT SELECT ON persgroup TO authenticated;

-- ── 1) Wygląd: uczestnik ustawia wszystkie pola ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT public.chat_set_appearance((SELECT id FROM persconv), 'ocean', 'soft', '🔥');

RESET ROLE;
SELECT is(
  (SELECT theme || '/' || wallpaper || '/' || quick_emoji
     FROM public.conversations WHERE id = (SELECT id FROM persconv)),
  'ocean/soft/🔥',
  'chat_set_appearance zapisuje motyw, tapetę i szybką emotkę'
);

-- ── 2) Sentinel keep: drugi uczestnik zmienia tylko motyw ───────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a2","role":"authenticated"}', true);
SELECT public.chat_set_appearance((SELECT id FROM persconv), p_theme => 'forest');

RESET ROLE;
SELECT is(
  (SELECT theme FROM public.conversations WHERE id = (SELECT id FROM persconv)),
  'forest',
  'każdy uczestnik może zmienić motyw'
);
SELECT is(
  (SELECT wallpaper || '/' || quick_emoji
     FROM public.conversations WHERE id = (SELECT id FROM persconv)),
  'soft/🔥',
  'sentinel keep nie nadpisuje pozostałych pól'
);

-- ── 3) NULL wraca do wartości domyślnych ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT public.chat_set_appearance((SELECT id FROM persconv), NULL, NULL, NULL);

RESET ROLE;
SELECT is(
  (SELECT (theme IS NULL AND wallpaper IS NULL AND quick_emoji IS NULL)
     FROM public.conversations WHERE id = (SELECT id FROM persconv)),
  true,
  'NULL przywraca domyślny wygląd (kolumny wyczyszczone)'
);

-- ── 4) Whitelisty i członkostwo ─────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_appearance((SELECT id FROM persconv), 'komiks')$$,
  NULL,
  'chat: invalid theme',
  'motyw spoza whitelisty odrzucony'
);
SELECT throws_ok(
  $$SELECT public.chat_set_appearance((SELECT id FROM persconv), p_wallpaper => 'marmur')$$,
  NULL,
  'chat: invalid wallpaper',
  'tapeta spoza whitelisty odrzucona'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000d4b1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_appearance((SELECT id FROM persconv), 'ocean')$$,
  NULL,
  'chat: not a member',
  'użytkownik spoza rozmowy nie zmieni jej wyglądu'
);

-- ── 5) Pseudonimy: zapis przez RPC, odczyt przez RLS ────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.conversation_nicknames
      (conversation_id, user_id, tenant_id, nickname, set_by)
    VALUES ((SELECT id FROM persconv), 'a0000000-0000-0000-0000-00000000d4a2',
            'a1111111-1111-1111-1111-11111111d4aa', 'Haker',
            'a0000000-0000-0000-0000-00000000d4a1')$$,
  '42501',
  NULL,
  'bezpośredni INSERT pseudonimu odrzucony (zapis wyłącznie przez RPC)'
);

SELECT lives_ok(
  $$SELECT public.chat_set_nickname((SELECT id FROM persconv),
      'a0000000-0000-0000-0000-00000000d4a2', 'Szef Energetyki')$$,
  'uczestnik nadaje pseudonim drugiemu uczestnikowi'
);

-- Widoczny dla CELU pseudonimu (drugiego członka) przez RLS.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a2","role":"authenticated"}', true);
SELECT is(
  (SELECT nickname FROM public.conversation_nicknames
    WHERE conversation_id = (SELECT id FROM persconv)
      AND user_id = 'a0000000-0000-0000-0000-00000000d4a2'),
  'Szef Energetyki',
  'pseudonim widoczny dla członków rozmowy'
);

-- Niewidoczny spoza rozmowy/tenantu.
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000d4b1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames),
  0,
  'pseudonimy niewidoczne poza rozmową i tenantem'
);

-- Cel spoza rozmowy odrzucony; pusty pseudonim usuwa wpis.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_nickname((SELECT id FROM persconv),
      'b0000000-0000-0000-0000-00000000d4b1', 'Obcy')$$,
  NULL,
  'chat: target not a member',
  'pseudonim dla osoby spoza rozmowy odrzucony'
);
SELECT lives_ok(
  $$SELECT public.chat_set_nickname((SELECT id FROM persconv),
      'a0000000-0000-0000-0000-00000000d4a2', '')$$,
  'pusty pseudonim akceptowany jako usunięcie'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversation_nicknames
    WHERE conversation_id = (SELECT id FROM persconv)),
  0,
  'pusty pseudonim usuwa wpis'
);

-- ── 6) Opis grupy: tylko właściciel ─────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a2","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_group_description((SELECT id FROM persgroup), 'Podmiana')$$,
  NULL,
  'chat: owner required',
  'zwykły członek nie zmieni opisu kręgu'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000d4a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_set_group_description((SELECT id FROM persgroup),
      'Rozmowy o strategii energetycznej UE')$$,
  'właściciel ustawia opis kręgu'
);

RESET ROLE;
SELECT is(
  (SELECT description FROM public.conversations WHERE id = (SELECT id FROM persgroup)),
  'Rozmowy o strategii energetycznej UE',
  'opis kręgu zapisany'
);

SELECT * FROM finish();
ROLLBACK;
