-- pgTAP: kanoniczne nagranie TTS - jeden głos/model i jeden plik na (wpis, język).
--
-- Weryfikuje migrację 20260803120000_post_tts_canonical_rendition.sql, czyli
-- domknięcie audytu 2026-08-03 (moduł 1, "Audio artykułu"): wcześniej klient
-- wybierał głos i model, a cache keszował po (post, lang, voice, model, hash) -
-- do 24 płatnych syntez i 24 plików na jeden wpis.
--
-- Sprawdzane inwarianty:
--   1. posts.tts_voice_* przyjmuje NULL i id z allowlisty, odrzuca resztę.
--   2. post_tts_renditions ma klucz główny (post_id, lang) - drugi wariant tego
--      samego wpisu w tym samym języku jest NIEREPREZENTOWALNY.
--   3. tenant_id nagrania jest wiązany z wpisem (nie da się go podać z zewnątrz).
--   4. record_post_tts_rendition() aktualizuje wiersz w miejscu i inkrementuje
--      licznik syntez (telemetria amplifikacji), zostawiając JEDEN wiersz.
--   5. Rejestr nie ma żadnej polityki zapisu dla klienta, anon go nie czyta,
--      a funkcja zapisu jest niewykonywalna poza service_role.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(15);

-- ── Seed ───────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('c1111111-1111-1111-1111-1111111111c1', 'tts-tenant-a', 'TTS Tenant A'),
  ('c2222222-2222-2222-2222-2222222222c2', 'tts-tenant-b', 'TTS Tenant B');

INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-0000000000aa', 'tts-author@a.test');

INSERT INTO public.pages (id, tenant_id, slug) VALUES
  ('cccccccc-0000-0000-0000-00000000000a',
   'c1111111-1111-1111-1111-1111111111c1', 'tts-test-home');

INSERT INTO public.posts (id, slug, author_id, status, tenant_id, parent_page_id, title_pl) VALUES
  ('c0000000-0000-0000-0000-0000000000d1', 'tts-test-post',
   'c0000000-0000-0000-0000-0000000000aa', 'published',
   'c1111111-1111-1111-1111-1111111111c1',
   'cccccccc-0000-0000-0000-00000000000a', 'Artykuł z lektorem');

-- ── 1. Allowlista głosu na wpisie (lustro TTS_VOICES w TypeScript) ─────────
SELECT lives_ok(
  $$UPDATE public.posts
       SET tts_voice_pl = 'EXAVITQu4vr4xnSDxMaL', tts_voice_en = NULL
     WHERE id = 'c0000000-0000-0000-0000-0000000000d1'$$,
  'posts.tts_voice_*: id z allowlisty i NULL (dziedzicz głos najemcy) przechodzą'
);

SELECT throws_ok(
  $$UPDATE public.posts
       SET tts_voice_pl = 'jakis-obcy-glos'
     WHERE id = 'c0000000-0000-0000-0000-0000000000d1'$$,
  '23514',
  NULL,
  'posts.tts_voice_pl: głos spoza allowlisty odrzucony przez CHECK'
);

SELECT throws_ok(
  $$UPDATE public.posts
       SET tts_voice_en = 'eleven_multilingual_v2'
     WHERE id = 'c0000000-0000-0000-0000-0000000000d1'$$,
  '23514',
  NULL,
  'posts.tts_voice_en: id modelu w kolumnie głosu odrzucone (wymiary się nie mieszają)'
);

-- ── 2. Klucz główny (post_id, lang) = koniec wariantów per głos/model ──────
SELECT set_eq(
  $$SELECT a.attname::text
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.post_tts_renditions'::regclass
       AND c.contype = 'p'$$,
  ARRAY['post_id', 'lang'],
  'post_tts_renditions: klucz główny to dokładnie (post_id, lang) - bez voice/model'
);

SELECT lives_ok(
  $$INSERT INTO public.post_tts_renditions
      (post_id, lang, tenant_id, voice_id, model, content_hash, storage_path,
       byte_size, char_count)
    VALUES ('c0000000-0000-0000-0000-0000000000d1', 'pl',
            'c1111111-1111-1111-1111-1111111111c1', 'EXAVITQu4vr4xnSDxMaL',
            'eleven_multilingual_v2', 'aaaaaaaabbbbbbbb',
            'c1111111-1111-1111-1111-1111111111c1/c0000000-0000-0000-0000-0000000000d1/pl.mp3',
            2048, 900)$$,
  'post_tts_renditions: pierwsze nagranie (pl) zapisane'
);

SELECT throws_ok(
  $$INSERT INTO public.post_tts_renditions
      (post_id, lang, tenant_id, voice_id, model, content_hash, storage_path)
    VALUES ('c0000000-0000-0000-0000-0000000000d1', 'pl',
            'c1111111-1111-1111-1111-1111111111c1', 'XrExE9yKIg1WjnnlVkGX',
            'eleven_turbo_v2_5', 'ccccccccdddddddd',
            'c1111111-1111-1111-1111-1111111111c1/c0000000-0000-0000-0000-0000000000d1/pl-2.mp3')$$,
  '23505',
  NULL,
  'post_tts_renditions: DRUGI wariant tego samego (wpis, język) odrzucony przez PK'
);

SELECT throws_ok(
  $$INSERT INTO public.post_tts_renditions
      (post_id, lang, tenant_id, voice_id, model, content_hash, storage_path)
    VALUES ('c0000000-0000-0000-0000-0000000000d1', 'de',
            'c1111111-1111-1111-1111-1111111111c1', 'EXAVITQu4vr4xnSDxMaL',
            'eleven_multilingual_v2', 'eeeeeeeeffffffff', 'x/y/de.mp3')$$,
  '23514',
  NULL,
  'post_tts_renditions: język poza (pl, en) odrzucony przez CHECK'
);

-- ── 3. Tenant nagrania dziedziczony z wpisu, nie z wejścia ─────────────────
UPDATE public.post_tts_renditions
   SET tenant_id = 'c2222222-2222-2222-2222-2222222222c2'
 WHERE post_id = 'c0000000-0000-0000-0000-0000000000d1' AND lang = 'pl';

SELECT is(
  (SELECT tenant_id FROM public.post_tts_renditions
    WHERE post_id = 'c0000000-0000-0000-0000-0000000000d1' AND lang = 'pl'),
  'c1111111-1111-1111-1111-1111111111c1'::uuid,
  'trigger wiążący: przypisanie nagrania obcemu najemcy jest korygowane do tenanta wpisu'
);

-- ── 4. record_post_tts_rendition: upsert w miejscu + licznik syntez ────────
SELECT lives_ok(
  $$SELECT public.record_post_tts_rendition(
      'c0000000-0000-0000-0000-0000000000d1', 'pl', 'XrExE9yKIg1WjnnlVkGX',
      'eleven_turbo_v2_5', '1111111122222222',
      'c1111111-1111-1111-1111-1111111111c1/c0000000-0000-0000-0000-0000000000d1/pl.mp3',
      4096, 1200)$$,
  'record_post_tts_rendition: zmiana kanonicznego głosu nadpisuje nagranie'
);

SELECT is(
  (SELECT count(*)::int FROM public.post_tts_renditions
    WHERE post_id = 'c0000000-0000-0000-0000-0000000000d1'),
  1,
  'po zmianie głosu nadal JEDEN wiersz nagrania na wpis (a nie drugi wariant)'
);

SELECT results_eq(
  $$SELECT voice_id, model, content_hash, byte_size, char_count, synth_count
      FROM public.post_tts_renditions
     WHERE post_id = 'c0000000-0000-0000-0000-0000000000d1' AND lang = 'pl'$$,
  $$VALUES ('XrExE9yKIg1WjnnlVkGX'::text, 'eleven_turbo_v2_5'::text,
            '1111111122222222'::text, 4096::bigint, 1200, 2)$$,
  'record_post_tts_rendition: nowa para, nowy hash, rozmiar i synth_count = 2'
);

SELECT throws_ok(
  $$SELECT public.record_post_tts_rendition(
      'c0000000-0000-0000-0000-0000000000d1', 'de', 'EXAVITQu4vr4xnSDxMaL',
      'eleven_multilingual_v2', '3333333344444444', 'x/y/de.mp3', 1, 1)$$,
  'P0001',
  'invalid_lang',
  'record_post_tts_rendition: nieobsługiwany język odrzucony jawnym błędem'
);

-- ── 5. Powierzchnia klienta: tylko odczyt dla staff, zero zapisu ───────────
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'post_tts_renditions'
      AND cmd <> 'SELECT'),
  0,
  'post_tts_renditions: zero polityk INSERT/UPDATE/DELETE (zapis tylko service_role)'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT throws_ok(
  $$SELECT count(*) FROM public.post_tts_renditions$$,
  '42501',
  NULL,
  'anon nie czyta rejestru nagrań (brak GRANT-u SELECT dla anon)'
);

SELECT throws_ok(
  $$SELECT public.record_post_tts_rendition(
      'c0000000-0000-0000-0000-0000000000d1', 'pl', 'EXAVITQu4vr4xnSDxMaL',
      'eleven_multilingual_v2', '5555555566666666', 'x/y/pl.mp3', 1, 1)$$,
  '42501',
  NULL,
  'anon nie może zadeklarować nagrania (EXECUTE odebrany, zostaje service_role)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
