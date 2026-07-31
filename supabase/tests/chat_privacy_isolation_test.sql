-- pgTAP: prywatność czatu per tenant + załączniki + preferencje.
--
-- Domyka lukę z audytu ("czat: zero testów") i weryfikuje własności
-- z migracji 20260712190000_chat_privacy_tenant_hardening.sql:
--   1. Izolacja tenantów czatu jest odporna nawet na LEGACY wiersz członkostwa
--      cross-tenant (user tenanta B "wszczepiony" do konwersacji tenanta A nie
--      czyta wiadomości, konwersacji, uczestników ANI załącznika w storage).
--   2. Załącznik w chat-attachments znika ze storage przy "cofnij wysłanie"
--      (trigger purge) - nie zostaje osierocony obiekt czytelny po ścieżce.
--   3. notification_preferences ma przypięte user_id/tenant_id (INSERT i
--      UPDATE nie przepiszą wiersza do obcego tenanta).
--   4. Potwierdzenia odczytu są wzajemne: wyłączenie u jednej strony ukrywa
--      wiersz uczestnika w OBU kierunkach; ponowne włączenie przywraca.
--   5. allow_messages_from: 'nobody' blokuje nowe konwersacje (RPC) i wycisza
--      wysyłkę w istniejących wątkach (trigger), asymetrycznie.
--   6. get_chat_peers nie ujawnia profili poza tenantem wołającego.
--   7. Polityki Realtime Authorization (typing/presence) istnieją, a parser
--      topiców odrzuca śmieciowe wejście.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(31);

-- ── Seed ───────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'chat-tenant-a', 'Chat Tenant A'),
  ('b2222222-2222-2222-2222-222222222222', 'chat-tenant-b', 'Chat Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'a1@chat.test'),
  ('a0000000-0000-0000-0000-0000000000a2', 'a2@chat.test'),
  ('a0000000-0000-0000-0000-0000000000a3', 'a3@chat.test'),
  ('b0000000-0000-0000-0000-0000000000b1', 'b1@chat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'a1@chat.test', 'User A1', 'a1111111-1111-1111-1111-111111111111', false),
  ('a0000000-0000-0000-0000-0000000000a2', 'a2@chat.test', 'User A2', 'a1111111-1111-1111-1111-111111111111', true),
  ('a0000000-0000-0000-0000-0000000000a3', 'a3@chat.test', 'User A3', 'a1111111-1111-1111-1111-111111111111', true),
  ('b0000000-0000-0000-0000-0000000000b1', 'b1@chat.test', 'User B1', 'b2222222-2222-2222-2222-222222222222', true);

-- ── A1 tworzy konwersację z A2 i wysyła wiadomość ──────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-0000000000a2')$$,
  'A1 otwiera konwersację direct z discoverable A2 w tym samym tenancie'
);

RESET ROLE;
CREATE TEMP TABLE tconv AS
SELECT id FROM public.conversations
WHERE direct_key = 'a1111111-1111-1111-1111-111111111111'
  || ':a0000000-0000-0000-0000-0000000000a1'
  || ':a0000000-0000-0000-0000-0000000000a2';
GRANT SELECT ON tconv TO authenticated;

SELECT is(
  (SELECT count(*)::int FROM tconv), 1,
  'konwersacja ma deterministyczny direct_key z prefiksem tenanta'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
    VALUES ((SELECT id FROM tconv), 'a1111111-1111-1111-1111-111111111111',
            'a0000000-0000-0000-0000-0000000000a1', 'text', 'hej A2')$$,
  'A1 (członek) wysyła wiadomość w swoim tenancie'
);

-- ── Pozytywna kontrola: A2 widzi rozmowę ────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE conversation_id = (SELECT id FROM tconv)),
  1,
  'A2 (członek, ten sam tenant) czyta wiadomość'
);

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM tconv)),
  2,
  'A2 widzi oba wiersze uczestników (baseline potwierdzeń odczytu)'
);

-- ── Legacy cross-tenant członkostwo: B1 wszczepiony do konwersacji A ────────
RESET ROLE;
INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id)
VALUES ((SELECT id FROM tconv), 'b0000000-0000-0000-0000-0000000000b1',
        'a1111111-1111-1111-1111-111111111111');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE conversation_id = (SELECT id FROM tconv)),
  0,
  'user tenanta B nie czyta wiadomości tenanta A mimo wiersza członkostwa'
);

SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT id FROM tconv)),
  0,
  'user tenanta B nie widzi samej konwersacji tenanta A'
);

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM tconv)),
  0,
  'user tenanta B nie widzi wierszy uczestników konwersacji tenanta A'
);

SELECT is(
  public.is_conversation_member((SELECT id FROM tconv), 'b0000000-0000-0000-0000-0000000000b1'),
  true,
  'stare is_conversation_member uznaje legacy członkostwo (kontekst regresji)'
);

SELECT is(
  public.is_tenant_conversation_member((SELECT id FROM tconv), 'b0000000-0000-0000-0000-0000000000b1'),
  false,
  'is_tenant_conversation_member odmawia: konwersacja nie jest w tenancie wołającego'
);

SELECT is(
  (SELECT count(*)::int FROM public.get_chat_peers(
     ARRAY['a0000000-0000-0000-0000-0000000000a2']::uuid[])),
  0,
  'get_chat_peers nie ujawnia B1 profilu A2 mimo wspólnej (legacy) konwersacji'
);

-- mark_conversation_read nie modyfikuje stanu odczytu poza tenantem wołającego
SELECT lives_ok(
  $$SELECT public.mark_conversation_read((SELECT id FROM tconv))$$,
  'mark_conversation_read jako B1 nie rzuca (cichy no-op)'
);

RESET ROLE;
SELECT is(
  (SELECT last_read_at FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM tconv)
      AND user_id = 'b0000000-0000-0000-0000-0000000000b1'),
  NULL,
  'guard tenanta: wiersz B1 pozostaje nietknięty po mark_conversation_read'
);

-- ── Storage: załącznik czytelny dla członka, niewidoczny cross-tenant ───────
INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-attachments',
        'a1111111-1111-1111-1111-111111111111/'
        || (SELECT id FROM tconv)::text
        || '/a0000000-0000-0000-0000-0000000000a1/zal.png');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'chat-attachments'
      AND name LIKE '%' || (SELECT id::text FROM tconv) || '%'),
  1,
  'A2 (członek, ten sam tenant) widzi obiekt załącznika w storage'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'chat-attachments'
      AND name LIKE '%' || (SELECT id::text FROM tconv) || '%'),
  0,
  'user tenanta B nie widzi załącznika tenanta A mimo legacy członkostwa'
);

-- ── Purge załącznika przy "cofnij wysłanie" ────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.messages
      (conversation_id, tenant_id, sender_id, kind,
       attachment_path, attachment_name, attachment_mime, attachment_size)
    VALUES ((SELECT id FROM tconv), 'a1111111-1111-1111-1111-111111111111',
            'a0000000-0000-0000-0000-0000000000a1', 'image',
            'a1111111-1111-1111-1111-111111111111/' || (SELECT id FROM tconv)::text
              || '/a0000000-0000-0000-0000-0000000000a1/zal.png',
            'zal.png', 'image/png', 1024)$$,
  'A1 wysyła wiadomość z załącznikiem'
);

SELECT lives_ok(
  $$UPDATE public.messages
       SET deleted_at = now(), body = NULL, attachment_path = NULL,
           attachment_name = NULL, attachment_mime = NULL, attachment_size = NULL
     WHERE sender_id = 'a0000000-0000-0000-0000-0000000000a1'
       AND kind = 'image'$$,
  'A1 cofa wysłanie wiadomości z załącznikiem (soft delete)'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'chat-attachments'
      AND name LIKE '%' || (SELECT id::text FROM tconv) || '%'),
  0,
  'purge: obiekt storage znika razem z cofniętą wiadomością (zero sierot)'
);

-- ── Preferencje: pin tenanta na INSERT i UPDATE ────────────────────────────
-- INSERT (nawet service/superuser) z obcym tenantem: trigger przypina do
-- tenanta właściciela wiersza.
INSERT INTO public.notification_preferences (user_id, tenant_id, read_receipts_enabled)
VALUES ('a0000000-0000-0000-0000-0000000000a2',
        'b2222222-2222-2222-2222-222222222222', false);

SELECT is(
  (SELECT tenant_id FROM public.notification_preferences
    WHERE user_id = 'a0000000-0000-0000-0000-0000000000a2'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'INSERT preferencji przypina tenant_id do tenanta właściciela wiersza'
);

-- ── Potwierdzenia odczytu: wzajemne ukrywanie wierszy uczestników ───────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM tconv)
      AND user_id <> 'b0000000-0000-0000-0000-0000000000b1'),
  1,
  'A2 wyłączyła potwierdzenia: A1 widzi już tylko własny wiersz uczestnika'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM tconv)
      AND user_id <> 'b0000000-0000-0000-0000-0000000000b1'),
  1,
  'wzajemność: A2 z wyłączonymi potwierdzeniami też nie widzi wiersza A1'
);

-- A2 włącza potwierdzenia z powrotem, próbując przy okazji przejąć tenant B.
SELECT lives_ok(
  $$UPDATE public.notification_preferences
       SET read_receipts_enabled = true,
           tenant_id = 'b2222222-2222-2222-2222-222222222222'
     WHERE user_id = 'a0000000-0000-0000-0000-0000000000a2'$$,
  'A2 aktualizuje własne preferencje (z próbą podmiany tenant_id)'
);

RESET ROLE;
SELECT is(
  (SELECT tenant_id FROM public.notification_preferences
    WHERE user_id = 'a0000000-0000-0000-0000-0000000000a2'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'UPDATE preferencji: tenant_id przypięty (próba przejęcia zignorowana)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.conversation_participants
    WHERE conversation_id = (SELECT id FROM tconv)
      AND user_id <> 'b0000000-0000-0000-0000-0000000000b1'),
  2,
  'po ponownym włączeniu potwierdzeń A1 znów widzi oba wiersze'
);

-- ── allow_messages_from ─────────────────────────────────────────────────────
-- A3 (discoverable) ustawia 'nobody': nowej konwersacji nie da się otworzyć.
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.notification_preferences (user_id, tenant_id, allow_messages_from)
    VALUES ('a0000000-0000-0000-0000-0000000000a3',
            'a1111111-1111-1111-1111-111111111111', 'nobody')$$,
  'A3 zapisuje preferencję allow_messages_from = nobody'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-0000000000a3')$$,
  'chat: peer not available',
  'nowa konwersacja z osobą "nobody" odmówiona (bez enumeracji powodu)'
);

-- A2 ustawia 'nobody' w ISTNIEJĄCEJ konwersacji: A1 nie wyśle, A2 nadal może.
RESET ROLE;
UPDATE public.notification_preferences
   SET allow_messages_from = 'nobody'
 WHERE user_id = 'a0000000-0000-0000-0000-0000000000a2';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT throws_ok(
  $$INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
    VALUES ((SELECT id FROM tconv), 'a1111111-1111-1111-1111-111111111111',
            'a0000000-0000-0000-0000-0000000000a1', 'text', 'halo?')$$,
  'chat: recipient unavailable',
  'tryb cichy: wysyłka do osoby "nobody" zablokowana też w istniejącym wątku'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
    VALUES ((SELECT id FROM tconv), 'a1111111-1111-1111-1111-111111111111',
            'a0000000-0000-0000-0000-0000000000a2', 'text', 'ja mogę pisać')$$,
  'tryb cichy jest asymetryczny: A2 nadal może pisać do A1'
);

-- ── Realtime Authorization: polityki i parser topiców ───────────────────────
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname IN (
        'chat_typing_member_read', 'chat_typing_member_write',
        'chat_presence_tenant_read', 'chat_presence_tenant_write',
        'entity_presence_tenant_read', 'entity_presence_tenant_write')),
  6,
  'komplet 6 polityk Realtime Authorization dla typing/presence istnieje'
);

SELECT is(
  public.chat_topic_conversation_id('chat-conv:' || (SELECT id::text FROM tconv)),
  (SELECT id FROM tconv),
  'parser topiców wyciąga UUID konwersacji z chat-conv:<uuid>'
);

SELECT is(
  public.chat_topic_conversation_id('chat-conv:../../etc/passwd'),
  NULL,
  'parser topiców odrzuca śmieciowe topici (NULL zamiast wyjątku rzutowania)'
);

SELECT * FROM finish();
ROLLBACK;
