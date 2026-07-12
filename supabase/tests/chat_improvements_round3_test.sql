-- pgTAP: runda poprawek czatu (migracja 20260713100000).
--
--   1. Znikające wiadomości naprawdę znikają: po purge treść NIE zostaje w
--      conversations.last_message_preview (przeliczenie z ocalałej wiadomości),
--      a notyfikacje rozmów z TTL nie utrwalają treści (generyczny podgląd).
--   2. Limit tempa uploadów: 20/min per użytkownik, 21. odmówiony.
--   3. Podpisy pod załącznikami: body <= 2000 dozwolone, >2000 odrzucone;
--      podgląd listy woli podpis od nazwy pliku.
--   4. Forward: kolumna forwarded zapisywalna przez klienta.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a1111111-1111-1111-1111-11111111c3aa', 'r3-tenant-a', 'R3 Tenant A');

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000c3a1', 'r3-a1@chat.test'),
  ('a0000000-0000-0000-0000-00000000c3a2', 'r3-a2@chat.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('a0000000-0000-0000-0000-00000000c3a1', 'r3-a1@chat.test', 'R3 A1', 'a1111111-1111-1111-1111-11111111c3aa', false),
  ('a0000000-0000-0000-0000-00000000c3a2', 'r3-a2@chat.test', 'R3 A2', 'a1111111-1111-1111-1111-11111111c3aa', true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000c3a1","role":"authenticated"}', true);
SELECT public.get_or_create_direct_conversation('a0000000-0000-0000-0000-00000000c3a2');

RESET ROLE;
CREATE TEMP TABLE r3conv AS
SELECT id FROM public.conversations
WHERE direct_key = 'a1111111-1111-1111-1111-11111111c3aa'
  || ':a0000000-0000-0000-0000-00000000c3a1'
  || ':a0000000-0000-0000-0000-00000000c3a2';
GRANT SELECT ON r3conv TO authenticated;

-- Włącz znikające wiadomości (24h) i wyślij tajną treść.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000c3a1","role":"authenticated"}', true);
SELECT public.chat_set_message_ttl((SELECT id FROM r3conv), 86400);
INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body)
VALUES ((SELECT id FROM r3conv), 'a1111111-1111-1111-1111-11111111c3aa',
        'a0000000-0000-0000-0000-00000000c3a1', 'text', 'TAJNA-TRESC-XYZ');

-- ── 1) Fan-out przy TTL nie utrwala treści ──────────────────────────────────
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.href = '/messages?c=' || (SELECT id::text FROM r3conv)
      AND (n.body_pl LIKE '%TAJNA-TRESC%' OR n.body_en LIKE '%TAJNA-TRESC%')),
  0,
  'notyfikacja rozmowy z TTL NIE zawiera treści wiadomości'
);
SELECT is(
  (SELECT n.body_pl FROM public.notifications n
    WHERE n.href = '/messages?c=' || (SELECT id::text FROM r3conv)
    ORDER BY n.created_at DESC LIMIT 1),
  'Nowa wiadomość',
  'notyfikacja rozmowy z TTL ma generyczny podgląd'
);

-- Podgląd konwersacji trzyma treść DOPÓKI wiadomość żyje (członek i tak ją widzi).
SELECT is(
  (SELECT last_message_preview FROM public.conversations WHERE id = (SELECT id FROM r3conv)),
  'TAJNA-TRESC-XYZ',
  'podgląd listy pokazuje treść dopóki wiadomość nie wygasła'
);

-- Wygaszamy i uruchamiamy purge -> treść znika z podglądu, wiersz skasowany.
UPDATE public.messages SET expires_at = now() - interval '1 minute'
WHERE conversation_id = (SELECT id FROM r3conv) AND body = 'TAJNA-TRESC-XYZ';

-- Druga, świeższa wiadomość (nie wygasła) - purge powinien przeliczyć podgląd DO niej.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000c3a2","role":"authenticated"}', true);
INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body, expires_at)
VALUES ((SELECT id FROM r3conv), 'a1111111-1111-1111-1111-11111111c3aa',
        'a0000000-0000-0000-0000-00000000c3a2', 'text', 'NOWSZA-JAWNA', now() + interval '24 hours');

RESET ROLE;
SELECT ok(
  public.chat_purge_expired_messages() >= 1,
  'purge kasuje wygasłą wiadomość'
);
SELECT is(
  (SELECT count(*)::int FROM public.messages
    WHERE conversation_id = (SELECT id FROM r3conv) AND body = 'TAJNA-TRESC-XYZ'),
  0,
  'wygasła wiadomość skasowana twardo'
);
SELECT is(
  (SELECT last_message_preview FROM public.conversations WHERE id = (SELECT id FROM r3conv)),
  'NOWSZA-JAWNA',
  'podgląd przeliczony z najnowszej OCALAŁEJ wiadomości (treść wygasłej znika)'
);

-- ── 2) Limit tempa uploadów ─────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000c3a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.chat_check_upload_quota() FROM generate_series(1, 20)$$,
  '20 uploadów w oknie minuty przechodzi'
);
SELECT throws_ok(
  $$SELECT public.chat_check_upload_quota()$$,
  'chat: upload rate limited',
  '21. upload w tej samej minucie odrzucony'
);

-- ── 3) Podpisy pod załącznikami ─────────────────────────────────────────────
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('chat-attachments',
        'a1111111-1111-1111-1111-11111111c3aa/' || (SELECT id FROM r3conv)::text
          || '/a0000000-0000-0000-0000-00000000c3a1/pic.png');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000c3a1","role":"authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.messages
      (conversation_id, tenant_id, sender_id, kind, body,
       attachment_path, attachment_name, attachment_mime, attachment_size)
    VALUES ((SELECT id FROM r3conv), 'a1111111-1111-1111-1111-11111111c3aa',
            'a0000000-0000-0000-0000-00000000c3a1', 'image', 'mój podpis',
            'a1111111-1111-1111-1111-11111111c3aa/' || (SELECT id FROM r3conv)::text
              || '/a0000000-0000-0000-0000-00000000c3a1/pic.png',
            'pic.png', 'image/png', 2048)$$,
  'obraz z podpisem (body) dozwolony'
);
SELECT is(
  (SELECT last_message_preview FROM public.conversations WHERE id = (SELECT id FROM r3conv)),
  'mój podpis',
  'podgląd listy woli podpis od nazwy pliku'
);
SELECT throws_ok(
  $$INSERT INTO public.messages
      (conversation_id, tenant_id, sender_id, kind, body, attachment_path, attachment_name, attachment_mime, attachment_size)
    VALUES ((SELECT id FROM r3conv), 'a1111111-1111-1111-1111-11111111c3aa',
            'a0000000-0000-0000-0000-00000000c3a1', 'image', repeat('x', 2001),
            'a1111111-1111-1111-1111-11111111c3aa/x/z.png', 'z.png', 'image/png', 2048)$$,
  '23514',
  NULL,
  'podpis dłuższy niż 2000 znaków odrzucony przez CHECK'
);

-- ── 4) Forward ──────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$INSERT INTO public.messages (conversation_id, tenant_id, sender_id, kind, body, forwarded)
    VALUES ((SELECT id FROM r3conv), 'a1111111-1111-1111-1111-11111111c3aa',
            'a0000000-0000-0000-0000-00000000c3a1', 'text', 'przekazana', true)$$,
  'wiadomość z flagą forwarded zapisywalna przez klienta'
);

SELECT * FROM finish();
ROLLBACK;
