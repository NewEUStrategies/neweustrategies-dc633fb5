-- pgTAP: funkcje czatu klasy WhatsApp (migracja 20260712230000).
--
-- Weryfikuje, że każda nowa powierzchnia jest egzekwowana w bazie:
--   1. mark_conversations_delivered() odhacza dostarczenie (ticki ✓✓).
--   2. Pin/archiwum: RPC modyfikują wyłącznie własny wiersz uczestnika;
--      archiwizacja zdejmuje przypięcie.
--   3. Wyciszenie: fan-out powiadomień pomija wyciszonych odbiorców
--      i wraca po wyłączeniu wyciszenia.
--   4. "Wyczyść czat dla mnie": historia znika tylko wołającemu; rozmówca
--      zachowuje wszystko; nowe wiadomości znów widoczne.
--   5. Znikające wiadomości: whitelist TTL, tylko członek rozmowy może
--      ustawiać, expires_at stampowane, RLS ukrywa wygasłe natychmiast,
--      purge usuwa twardo razem z obiektem storage (głosówka).
--   6. Głosówki: kind='audio' przechodzi CHECK-i, limit czasu trwania,
--      podgląd listy bez nazwy pliku, allowlist bucketu z audio.
--   7. Gwiazdki: prywatne per użytkownik, tenant/członkostwo w RLS,
--      nadawca nie widzi cudzych gwiazdek.
--   8. Job pg_cron na purge jest zaplanowany.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(34);

-- ── Seed ───────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-11111111aaaa', 'wa-tenant-a', 'WA Tenant A'),
  ('b2222222-2222-2222-2222-22222222bbbb', 'wa-tenant-b', 'WA Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000aaa1', 'wa-a1@chat.test'),
  ('a0000000-0000-0000-0000-00000000aaa2', 'wa-a2@chat.test'),
  ('b0000000-0000-0000-0000-00000000bbb1', 'wa-b1@chat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('a0000000-0000-0000-0000-00000000aaa1', 'wa-a1@chat.test', 'WA A1', 'a1111111-1111-1111-1111-11111111aaaa', false),
  ('a0000000-0000-0000-0000-00000000aaa2', 'wa-a2@chat.test', 'WA A2', 'a1111111-1111-1111-1111-11111111aaaa', true),
  ('b0000000-0000-0000-0000-00000000bbb1', 'wa-b1@chat.test', 'WA B1', 'b2222222-2222-2222-2222-22222222bbbb', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-00000000aaa2');

RESET ROLE;
CREATE TEMP TABLE waconv AS
SELECT id FROM public.conversations
WHERE direct_key = 'a1111111-1111-1111-1111-11111111aaaa'
  || ':a0000000-0000-0000-0000-00000000aaa1'
  || ':a0000000-0000-0000-0000-00000000aaa2';
GRANT SELECT ON waconv TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
VALUES ((SELECT id FROM waconv), 'a1111111-1111-1111-1111-11111111aaaa',
        'a0000000-0000-0000-0000-00000000aaa1', 'text', 'm1');

-- ── 1) Dostarczenia ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa2","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.mark_conversations_delivered()$$,
  'A2 potwierdza dostarczenie wszystkich swoich rozmów jednym wywołaniem'
);

RESET ROLE;
SELECT is(
  (SELECT cp.last_delivered_at FROM public.conversation_participants cp
    WHERE cp.conversation_id = (SELECT id FROM waconv)
      AND cp.user_id = 'a0000000-0000-0000-0000-00000000aaa2'),
  (SELECT c.last_message_at FROM public.conversations c WHERE c.id = (SELECT id FROM waconv)),
  'last_delivered_at odbiorcy zrównane z last_message_at rozmowy'
);

-- ── 2) Pin + archiwum ───────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.chat_set_pinned((SELECT id FROM waconv), true)$$,
  'A1 przypina rozmowę'
);

RESET ROLE;
SELECT is(
  (SELECT cp.pinned_at IS NOT NULL FROM public.conversation_participants cp
    WHERE cp.conversation_id = (SELECT id FROM waconv)
      AND cp.user_id = 'a0000000-0000-0000-0000-00000000aaa1'),
  true,
  'pinned_at ustawione na wierszu wołającego'
);

SELECT is(
  (SELECT cp.pinned_at IS NULL FROM public.conversation_participants cp
    WHERE cp.conversation_id = (SELECT id FROM waconv)
      AND cp.user_id = 'a0000000-0000-0000-0000-00000000aaa2'),
  true,
  'wiersz rozmówcy nietknięty (RPC działa self-row)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_set_archived((SELECT id FROM waconv), true)$$,
  'A1 archiwizuje rozmowę'
);

RESET ROLE;
SELECT is(
  (SELECT cp.archived_at IS NOT NULL AND cp.pinned_at IS NULL
     FROM public.conversation_participants cp
    WHERE cp.conversation_id = (SELECT id FROM waconv)
      AND cp.user_id = 'a0000000-0000-0000-0000-00000000aaa1'),
  true,
  'archiwizacja ustawia archived_at i zdejmuje przypięcie'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_set_archived((SELECT id FROM waconv), false)$$,
  'A1 przywraca rozmowę z archiwum'
);

-- ── 3) Wyciszenie a fan-out powiadomień ─────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa2","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_set_muted((SELECT id FROM waconv), 3600)$$,
  'A2 wycisza rozmowę na godzinę'
);

RESET ROLE;
SELECT is(
  (SELECT cp.muted_until > now() FROM public.conversation_participants cp
    WHERE cp.conversation_id = (SELECT id FROM waconv)
      AND cp.user_id = 'a0000000-0000-0000-0000-00000000aaa2'),
  true,
  'muted_until w przyszłości'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
VALUES ((SELECT id FROM waconv), 'a1111111-1111-1111-1111-11111111aaaa',
        'a0000000-0000-0000-0000-00000000aaa1', 'text', 'm2');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'a0000000-0000-0000-0000-00000000aaa2'
      AND n.kind = 'message'
      AND n.href = '/messages?c=' || (SELECT id::text FROM waconv)),
  1,
  'wyciszony odbiorca nie dostaje powiadomienia (tylko wpis sprzed wyciszenia)'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa2","role":"authenticated"}', true);
SELECT public.chat_set_muted((SELECT id FROM waconv), NULL);
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
VALUES ((SELECT id FROM waconv), 'a1111111-1111-1111-1111-11111111aaaa',
        'a0000000-0000-0000-0000-00000000aaa1', 'text', 'm3');

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'a0000000-0000-0000-0000-00000000aaa2'
      AND n.kind = 'message'
      AND n.href = '/messages?c=' || (SELECT id::text FROM waconv)),
  2,
  'po zdjęciu wyciszenia powiadomienia wracają'
);

-- ── 4) Wyczyść czat dla mnie ────────────────────────────────────────────────
-- pgTAP działa w JEDNEJ transakcji (now() zamrożone), więc granice czasowe
-- ustawiamy jawnie: historia zostaje cofnięta o minutę, a wiadomość "po
-- wyczyszczeniu" dostaje bieżący clock_timestamp().
RESET ROLE;
UPDATE public.messages
   SET created_at = created_at - interval '1 minute'
 WHERE conversation_id = (SELECT id FROM waconv);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa2","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_clear_history((SELECT id FROM waconv))$$,
  'A2 czyści historię rozmowy u siebie'
);

SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE conversation_id = (SELECT id FROM waconv)),
  0,
  'A2 nie widzi już żadnej wiadomości sprzed wyczyszczenia'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE conversation_id = (SELECT id FROM waconv)),
  3,
  'A1 (rozmówca) zachowuje pełną historię - czyszczenie działa tylko "dla mnie"'
);

INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
VALUES ((SELECT id FROM waconv), 'a1111111-1111-1111-1111-11111111aaaa',
        'a0000000-0000-0000-0000-00000000aaa1', 'text', 'm4');

-- W realu m4 przyszłaby w PÓŹNIEJSZEJ transakcji; tu odmrażamy jej czas.
RESET ROLE;
UPDATE public.messages SET created_at = clock_timestamp()
 WHERE conversation_id = (SELECT id FROM waconv) AND body = 'm4';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa2","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE conversation_id = (SELECT id FROM waconv)),
  1,
  'nowe wiadomości po wyczyszczeniu są znów widoczne dla A2'
);

-- ── 5) Znikające wiadomości ─────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.chat_set_message_ttl((SELECT id FROM waconv), 3600)$$,
  'chat: invalid ttl',
  'TTL spoza whitelisty (24h/7d/90d) odrzucony'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000bbb1","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.chat_set_message_ttl((SELECT id FROM waconv), 86400)$$,
  'chat: not a member',
  'nie-członek (obcy tenant) nie ustawi znikających wiadomości'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_set_message_ttl((SELECT id FROM waconv), 86400)$$,
  'uczestnik włącza znikające wiadomości (24h)'
);

RESET ROLE;
SELECT is(
  (SELECT c.message_ttl_seconds FROM public.conversations c WHERE c.id = (SELECT id FROM waconv)),
  86400,
  'TTL zapisany na rozmowie'
);

-- ── 6) Głosówka + wygasanie + purge ─────────────────────────────────────────
INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-attachments',
        'a1111111-1111-1111-1111-11111111aaaa/'
        || (SELECT id FROM waconv)::text
        || '/a0000000-0000-0000-0000-00000000aaa1/voice.webm');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.messages
      (conversation_id, tenant_id, sender_id, kind,
       attachment_path, attachment_name, attachment_mime, attachment_size, attachment_duration)
    VALUES ((SELECT id FROM waconv), 'a1111111-1111-1111-1111-11111111aaaa',
            'a0000000-0000-0000-0000-00000000aaa1', 'audio',
            'a1111111-1111-1111-1111-11111111aaaa/' || (SELECT id FROM waconv)::text
              || '/a0000000-0000-0000-0000-00000000aaa1/voice.webm',
            'voice.webm', 'audio/webm', 20480, 12)$$,
  'głosówka (kind=audio, czas trwania) przechodzi CHECK-i'
);

SELECT throws_ok(
  $$INSERT INTO public.messages
      (conversation_id, tenant_id, sender_id, kind,
       attachment_path, attachment_name, attachment_mime, attachment_size, attachment_duration)
    VALUES ((SELECT id FROM waconv), 'a1111111-1111-1111-1111-11111111aaaa',
            'a0000000-0000-0000-0000-00000000aaa1', 'audio',
            'a1111111-1111-1111-1111-11111111aaaa/x/y/too-long.webm',
            'too-long.webm', 'audio/webm', 20480, 700)$$,
  '23514',
  NULL,
  'głosówka dłuższa niż limit 600 s odrzucona przez CHECK'
);

RESET ROLE;
CREATE TEMP TABLE wam5 AS
SELECT id FROM public.messages
WHERE conversation_id = (SELECT id FROM waconv) AND kind = 'audio';

SELECT is(
  (SELECT m.expires_at > now() + interval '23 hours'
      AND m.expires_at < now() + interval '25 hours'
     FROM public.messages m WHERE m.id = (SELECT id FROM wam5)),
  true,
  'expires_at wiadomości ostemplowane TTL-em rozmowy (~24h)'
);

SELECT is(
  (SELECT c.last_message_kind = 'audio' AND c.last_message_preview IS NULL
     FROM public.conversations c WHERE c.id = (SELECT id FROM waconv)),
  true,
  'podgląd listy dla głosówki bez nazwy pliku (etykietę nadaje klient)'
);

SELECT is(
  (SELECT 'audio/webm' = ANY(b.allowed_mime_types) FROM storage.buckets b
    WHERE b.id = 'chat-attachments'),
  true,
  'allowlist bucketu poszerzona o kontenery audio'
);

-- Wygasła wiadomość znika z RLS natychmiast... (sprawdzane jako A1 - nadawca
-- bez cleared_before, więc jedynym powodem ukrycia jest wygaśnięcie).
UPDATE public.messages SET expires_at = now() - interval '2 hours'
WHERE id = (SELECT id FROM wam5);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.messages
    WHERE conversation_id = (SELECT id FROM waconv) AND kind = 'audio'),
  0,
  'wygasła wiadomość niewidoczna przez RLS jeszcze przed purge'
);

-- ...a purge usuwa ją twardo razem z plikiem w storage.
RESET ROLE;
SELECT ok(
  public.chat_purge_expired_messages() >= 1,
  'purge usuwa wygasłe wiadomości'
);

SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE id = (SELECT id FROM wam5)),
  0,
  'wiersz wygasłej głosówki usunięty twardo'
);

SELECT is(
  (SELECT count(*)::int FROM storage.objects
    WHERE bucket_id = 'chat-attachments' AND name LIKE '%voice.webm'),
  0,
  'obiekt storage głosówki wyczyszczony kaskadą purge'
);

-- ── 7) Gwiazdki ─────────────────────────────────────────────────────────────
RESET ROLE;
CREATE TEMP TABLE wam4 AS
SELECT id FROM public.messages
WHERE conversation_id = (SELECT id FROM waconv) AND body = 'm4';
GRANT SELECT ON wam4 TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa2","role":"authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.message_stars (user_id, message_id)
    VALUES ('a0000000-0000-0000-0000-00000000aaa2', (SELECT id FROM wam4))$$,
  'A2 oznacza wiadomość gwiazdką'
);

RESET ROLE;
SELECT is(
  (SELECT s.conversation_id = (SELECT id FROM waconv)
      AND s.tenant_id = 'a1111111-1111-1111-1111-11111111aaaa'
     FROM public.message_stars s
    WHERE s.user_id = 'a0000000-0000-0000-0000-00000000aaa2'),
  true,
  'trigger przypina conversation_id/tenant_id gwiazdki z wiadomości'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000aaa1","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.message_stars),
  0,
  'gwiazdki są prywatne - nadawca nie widzi, że jego wiadomość oznaczono'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"b0000000-0000-0000-0000-00000000bbb1","role":"authenticated"}', true);
SELECT throws_ok(
  $$INSERT INTO public.message_stars (user_id, message_id)
    VALUES ('b0000000-0000-0000-0000-00000000bbb1', (SELECT id FROM wam4))$$,
  '42501',
  NULL,
  'użytkownik spoza rozmowy/tenanta nie oznaczy cudzej wiadomości'
);

-- ── 8) Harmonogram purge ────────────────────────────────────────────────────
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname = 'chat-purge-expired-messages'),
  1,
  'job pg_cron na purge wygasłych wiadomości zaplanowany'
);

SELECT * FROM finish();
ROLLBACK;
