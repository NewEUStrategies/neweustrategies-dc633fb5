-- pgTAP: rozmowy grupowe / "kregi" (20260713094000) na infrastrukturze 1:1.
--
--   1. create_group_conversation: walidacja tytulu; kandydaci filtrowani
--      serwerowo (blokady i allow_messages_from='nobody' nie do obejscia
--      przez zaproszenie); tworca zostaje ownerem; zaproszeni dostaja
--      powiadomienie.
--   2. Zarzadzanie: dopraszanie i rename tylko owner; filtr kandydatow
--      dziala tez przy dopraszaniu.
--   3. Fan-out N>2: wiadomosc w 4-osobowym kregu bumpuje unread_count
--      KAZDEMU pozostalemu uczestnikowi, nigdy nadawcy.
--   4. Guard grupowy: tryb cichy ('nobody') czlonka NIE knebluje calego
--      kregu (zawezone do 1:1); blokada pary NADAL obowiazuje wewnatrz
--      kregu ('chat: blocked').
--   5. Wyjscia: owner przekazuje wlasnosc najstarszemu czlonkowi; ostatni
--      uczestnik kasuje konwersacje.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(21);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('b7000000-0000-0000-0000-0000000000a1', 'owner-grp@grp.test'),
  ('b7000000-0000-0000-0000-0000000000a2', 'member2-grp@grp.test'),
  ('b7000000-0000-0000-0000-0000000000a3', 'member3-grp@grp.test'),
  ('b7000000-0000-0000-0000-0000000000a4', 'quiet-grp@grp.test'),
  ('b7000000-0000-0000-0000-0000000000a5', 'late-grp@grp.test'),
  ('b7000000-0000-0000-0000-0000000000b1', 'blocked-grp@grp.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.email LIKE '%@grp.test';

-- g1 blokuje bX; g4 zyje w trybie cichym - obaj musza odpasc z zaproszen.
INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id)
VALUES ('b7000000-0000-0000-0000-0000000000a1',
        'b7000000-0000-0000-0000-0000000000b1',
        (SELECT public.public_tenant_id()));

INSERT INTO public.notification_preferences (user_id, tenant_id, allow_messages_from)
VALUES ('b7000000-0000-0000-0000-0000000000a4',
        (SELECT public.public_tenant_id()), 'nobody')
ON CONFLICT (user_id) DO UPDATE SET allow_messages_from = 'nobody';

-- -- 1. Tworzenie kregu ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.create_group_conversation('x',
       ARRAY['b7000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  'P0001',
  'chat: invalid group title',
  'tytul kregu krotszy niz 2 znaki odpada'
);

SELECT lives_ok(
  $$ SELECT public.create_group_conversation('Krag testowy',
       ARRAY['b7000000-0000-0000-0000-0000000000a2',
             'b7000000-0000-0000-0000-0000000000a3',
             'b7000000-0000-0000-0000-0000000000a4',
             'b7000000-0000-0000-0000-0000000000b1']::uuid[]) $$,
  'utworzenie kregu z lista kandydatow przechodzi'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants cp
    WHERE cp.conversation_id =
          (SELECT id FROM public.conversations WHERE title = 'Krag testowy')),
  3,
  'kandydaci zablokowani i w trybie cichym odpadaja (zostaje owner + 2 czlonkow)'
);

SELECT is(
  (SELECT cp.role FROM public.conversation_participants cp
    WHERE cp.conversation_id =
          (SELECT id FROM public.conversations WHERE title = 'Krag testowy')
      AND cp.user_id = 'b7000000-0000-0000-0000-0000000000a1'),
  'owner',
  'tworca kregu zostaje ownerem'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.href = '/messages?c=' ||
          (SELECT id::text FROM public.conversations WHERE title = 'Krag testowy')
      AND n.user_id IN ('b7000000-0000-0000-0000-0000000000a2',
                        'b7000000-0000-0000-0000-0000000000a3')),
  2,
  'zaproszeni czlonkowie dostaja powiadomienie o dodaniu do kregu'
);

-- -- 2. Zarzadzanie: owner-only ------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT throws_ok(
  $$ SELECT public.add_group_members(
       (SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
       ARRAY['b7000000-0000-0000-0000-0000000000a5']::uuid[]) $$,
  'P0001',
  'chat: owner required',
  'dopraszac moze tylko owner'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  public.add_group_members(
    (SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
    ARRAY['b7000000-0000-0000-0000-0000000000a5',
          'b7000000-0000-0000-0000-0000000000b1']::uuid[]),
  1,
  'dopraszanie filtruje kandydatow (wchodzi 1, zablokowany odpada)'
);

-- -- 3. Fan-out N>2 -------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, kind, body)
     VALUES ((SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
             'b7000000-0000-0000-0000-0000000000a2', 'text', 'Czesc wszystkim') $$,
  'czlonek wysyla wiadomosc do kregu'
);

RESET ROLE;

SELECT is(
  (SELECT sum(cp.unread_count)::int FROM public.conversation_participants cp
    WHERE cp.conversation_id =
          (SELECT id FROM public.conversations WHERE title = 'Krag testowy')
      AND cp.user_id IN ('b7000000-0000-0000-0000-0000000000a1',
                         'b7000000-0000-0000-0000-0000000000a3',
                         'b7000000-0000-0000-0000-0000000000a5')),
  3,
  'wiadomosc bumpuje unread_count kazdemu z 3 pozostalych czlonkow'
);

SELECT is(
  (SELECT cp.unread_count FROM public.conversation_participants cp
    WHERE cp.conversation_id =
          (SELECT id FROM public.conversations WHERE title = 'Krag testowy')
      AND cp.user_id = 'b7000000-0000-0000-0000-0000000000a2'),
  0,
  'nadawca nie bumpuje wlasnego licznika'
);

-- -- 4. Guard grupowy: tryb cichy nie knebluje kregu, blokada pary tak ---------------
INSERT INTO public.notification_preferences (user_id, tenant_id, allow_messages_from)
VALUES ('b7000000-0000-0000-0000-0000000000a3',
        (SELECT public.public_tenant_id()), 'nobody')
ON CONFLICT (user_id) DO UPDATE SET allow_messages_from = 'nobody';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, kind, body)
     VALUES ((SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
             'b7000000-0000-0000-0000-0000000000a1', 'text', 'Krag dziala dalej') $$,
  'tryb cichy pojedynczego czlonka NIE blokuje wiadomosci w kregu (guard 1:1-only)'
);

RESET ROLE;
INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id)
VALUES ('b7000000-0000-0000-0000-0000000000a5',
        'b7000000-0000-0000-0000-0000000000a2',
        (SELECT public.public_tenant_id()));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT throws_ok(
  $$ INSERT INTO public.messages (conversation_id, sender_id, kind, body)
     VALUES ((SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
             'b7000000-0000-0000-0000-0000000000a2', 'text', 'Nie przejdzie') $$,
  'P0001',
  'chat: blocked',
  'blokada pary obowiazuje takze wewnatrz kregu'
);

-- -- 5. Rename + wyjscia ---------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.rename_group_conversation(
       (SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
       'Zmiana przez czlonka') $$,
  'P0001',
  'chat: owner required',
  'rename moze tylko owner'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT public.rename_group_conversation(
       (SELECT id FROM public.conversations WHERE title = 'Krag testowy'),
       'Krag po zmianie') $$,
  'owner zmienia nazwe kregu'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE title = 'Krag po zmianie'),
  1,
  'nowa nazwa kregu zapisana'
);

-- Owner wychodzi -> wlasnosc przechodzi na najstarszego czlonka.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.leave_group_conversation(
       (SELECT id FROM public.conversations WHERE title = 'Krag po zmianie')) $$,
  'owner opuszcza krag'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants cp
    WHERE cp.conversation_id =
          (SELECT id FROM public.conversations WHERE title = 'Krag po zmianie')
      AND cp.role = 'owner'),
  1,
  'wlasnosc przechodzi na dokladnie jednego pozostalego czlonka'
);

-- Reszta wychodzi; ostatni gasi swiatlo (konwersacja znika).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.leave_group_conversation(
       (SELECT id FROM public.conversations WHERE title = 'Krag po zmianie')) $$,
  'czlonek 2 opuszcza krag'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.leave_group_conversation(
       (SELECT id FROM public.conversations WHERE title = 'Krag po zmianie')) $$,
  'czlonek 3 opuszcza krag'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b7000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.leave_group_conversation(
       (SELECT id FROM public.conversations WHERE title = 'Krag po zmianie')) $$,
  'ostatni uczestnik opuszcza krag'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE title = 'Krag po zmianie'),
  0,
  'wyjscie ostatniego uczestnika kasuje konwersacje'
);

SELECT * FROM finish();
ROLLBACK;
