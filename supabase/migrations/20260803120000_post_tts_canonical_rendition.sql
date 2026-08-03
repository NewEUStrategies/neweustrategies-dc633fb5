-- ============================================================================
-- Audio artykułu (TTS): JEDEN kanoniczny głos/model per wpis.
--
-- PRZYCZYNA ZRODLOWA (audyt 2026-08-03, moduł 1, pozycja "Audio artykułu"):
-- publiczny endpoint /api/public/post-tts przyjmował `voiceId` i `model` OD
-- KLIENTA, a cache keszował po `(post, lang, voice, model, hash)`. Sześć głosów
-- z allowlisty × dwa modele × dwa języki = do 24 PŁATNYCH syntez ElevenLabs i
-- 24 plików MP3 na JEDEN wpis, wyzwalanych przez dowolnego anonimowego
-- czytelnika pętlą po allowliście. Allowlista ograniczała kształt nadużycia,
-- nie jego koszt.
--
-- Ta migracja przenosi decyzję "jakim głosem czytamy ten artykuł" z klienta do
-- redakcji i utrwala ją tak, że NADMIAROWY WARIANT NIE MA GDZIE ISTNIEĆ:
--
--   1) posts.tts_voice_pl / tts_voice_en - redakcyjne nadpisanie kanonicznego
--      głosu per wpis i język (NULL = głos najemcy z site_settings.reading).
--      CHECK jest lustrem allowlisty z src/lib/audio/ttsCanonical.ts.
--
--   2) post_tts_renditions - rejestr KANONICZNEGO nagrania. Klucz główny
--      (post_id, lang) czyni drugi wariant tego samego wpisu w tym samym
--      języku niereprezentowalnym w schemacie, a nie tylko "niechcianym".
--      Wiersz niesie też telemetrię kosztu (znaki, bajty, licznik syntez),
--      dzięki której amplifikacja jest MIERZALNA, a nie domniemana.
--
--   3) record_post_tts_rendition() - jedyna ścieżka zapisu rejestru
--      (service_role, wołane przez endpoint po udanej syntezie). Atomowy
--      UPSERT z inkrementacją licznika; tenant_id wyprowadzany z wiersza wpisu,
--      więc nagranie nie może zostać przypisane do obcego najemcy nawet przy
--      błędzie po stronie aplikacji.
--
--   4) Czyszczenie legacy: obiekty w buckecie `tts-cache` nazwane starym
--      schematem (`<lang>-<voice>-<model>-<hash>.mp3`) są od teraz nieosiągalne
--      dla nowej ścieżki `<tenant>/<post>/<lang>.mp3`, więc zostają usunięte -
--      to cache, a nie dane. Pierwszy słuchacz każdego wpisu zapłaci jedną
--      syntezę (dokładnie ta jedna jest z założenia jedyną).
--
-- Wszystkie kroki idempotentne (re-run na świeżej bazie i na produkcji).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Redakcyjne nadpisanie kanonicznego głosu per wpis
-- ----------------------------------------------------------------------------
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS tts_voice_pl text,
  ADD COLUMN IF NOT EXISTS tts_voice_en text;

COMMENT ON COLUMN public.posts.tts_voice_pl IS
  'Canonical ElevenLabs voice id for the Polish narration of this post (NULL = tenant default from site_settings.reading). Readers never choose it.';
COMMENT ON COLUMN public.posts.tts_voice_en IS
  'Canonical ElevenLabs voice id for the English narration of this post (NULL = tenant default from site_settings.reading). Readers never choose it.';

-- Lustro allowlisty TTS_VOICES (src/lib/audio/ttsCanonical.ts). Rozszerzenie
-- allowlisty w kodzie WYMAGA migracji podnoszącej te CHECK-i - inaczej panel
-- pokaże głos, którego baza nie przyjmie.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_tts_voice_pl_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_tts_voice_pl_check
  CHECK (tts_voice_pl IS NULL OR tts_voice_pl IN (
    'JBFqnCBsd6RMkjVDRZzb', 'EXAVITQu4vr4xnSDxMaL', 'onwK4e9ZLuTAKqWW03F9',
    'pFZP5JQG7iQjIQuC4Bku', 'FGY2WhTYpPnrIDTdsKH5', 'XrExE9yKIg1WjnnlVkGX'
  ));

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_tts_voice_en_check;
ALTER TABLE public.posts
  ADD CONSTRAINT posts_tts_voice_en_check
  CHECK (tts_voice_en IS NULL OR tts_voice_en IN (
    'JBFqnCBsd6RMkjVDRZzb', 'EXAVITQu4vr4xnSDxMaL', 'onwK4e9ZLuTAKqWW03F9',
    'pFZP5JQG7iQjIQuC4Bku', 'FGY2WhTYpPnrIDTdsKH5', 'XrExE9yKIg1WjnnlVkGX'
  ));

-- ----------------------------------------------------------------------------
-- 2) Rejestr kanonicznego nagrania: jeden wiersz na (wpis, język)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_tts_renditions (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  lang text NOT NULL CHECK (lang IN ('pl', 'en')),
  -- Izolacja najemcy: kolumna jest wiązana triggerem z wierszem wpisu, więc
  -- nie da się jej rozjechać z posts.tenant_id (service_role omija RLS).
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  voice_id text NOT NULL,
  model text NOT NULL,
  -- Hash TREŚCI (bez głosu i modelu): identyfikuje rewizję tekstu, z której
  -- powstało audio. Zmiana treści => nagranie nieświeże => jedna ponowna
  -- synteza NADPISUJĄCA ten sam obiekt storage.
  content_hash text NOT NULL CHECK (length(content_hash) BETWEEN 8 AND 128),
  storage_path text NOT NULL CHECK (length(storage_path) > 0),
  byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  char_count integer NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  -- Telemetria amplifikacji: ile razy ten (wpis, język) kosztował realną
  -- syntezę. W zdrowym stanie rośnie tylko przy edycji treści albo zmianie
  -- kanonicznego głosu przez redakcję.
  synth_count integer NOT NULL DEFAULT 1 CHECK (synth_count >= 0),
  synthesized_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- INWARIANT NADRZEDNY: (wpis, język) -> dokładnie jedno nagranie. Bez
  -- tenant_id w kluczu, bo post_id jest globalnie unikalny - dodanie go
  -- OSŁABIŁOBY inwariant (wpuszczając dwa wiersze na wpis).
  PRIMARY KEY (post_id, lang)
);

COMMENT ON TABLE public.post_tts_renditions IS
  'Canonical TTS rendition per (post, lang): pinned voice/model, content hash, storage path and cost telemetry. PK (post_id, lang) makes a second variant of the same article unrepresentable - the fix for the client-chosen voice/model cost amplification (audit 2026-08-03).';

CREATE INDEX IF NOT EXISTS idx_post_tts_renditions_tenant
  ON public.post_tts_renditions (tenant_id, synthesized_at DESC);

-- Tenant nagrania ZAWSZE dziedziczony z wpisu (wzorzec z
-- crm_webhook_endpoints: BEFORE-trigger wykonuje się przed WITH CHECK polityki,
-- więc próba podpięcia nagrania pod wpis innego najemcy nie ma jak przejść).
CREATE OR REPLACE FUNCTION public.tg_post_tts_renditions_bind_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.posts WHERE id = NEW.post_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;
  NEW.tenant_id := v_tenant;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_tts_renditions_bind_tenant ON public.post_tts_renditions;
CREATE TRIGGER trg_post_tts_renditions_bind_tenant
  BEFORE INSERT OR UPDATE ON public.post_tts_renditions
  FOR EACH ROW EXECUTE FUNCTION public.tg_post_tts_renditions_bind_tenant();

-- Odczyt: wyłącznie redakcja tego najemcy (panel pokazuje stan nagrania w
-- sekcji Audio edytora wpisu). Zapis: WYŁĄCZNIE service_role przez
-- record_post_tts_rendition() - żadnej polityki INSERT/UPDATE dla klienta,
-- bo klient nie ma prawa deklarować, co zostało zsyntezowane.
GRANT SELECT ON public.post_tts_renditions TO authenticated;
GRANT ALL ON public.post_tts_renditions TO service_role;

ALTER TABLE public.post_tts_renditions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_tts_renditions_staff_select ON public.post_tts_renditions;
CREATE POLICY post_tts_renditions_staff_select
  ON public.post_tts_renditions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.is_staff());

-- ----------------------------------------------------------------------------
-- 3) Zapis rejestru: atomowy upsert z inkrementacją licznika syntez
-- ----------------------------------------------------------------------------
-- Wołane przez /api/public/post-tts po udanej syntezie i uploadzie. Klient
-- Supabase nie potrafi wyrazić `synth_count = synth_count + 1` w upsercie, a
-- odczyt-modyfikacja-zapis gubiłby zliczenia przy równoległych żądaniach.
CREATE OR REPLACE FUNCTION public.record_post_tts_rendition(
  _post_id uuid,
  _lang text,
  _voice_id text,
  _model text,
  _content_hash text,
  _storage_path text,
  _byte_size bigint,
  _char_count integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF _lang NOT IN ('pl', 'en') THEN
    RAISE EXCEPTION 'invalid_lang';
  END IF;

  -- Tenant nigdy nie przychodzi z zewnątrz - wyprowadzamy go z wpisu (trigger
  -- wiążący robi to samo; tu odcinamy zapis dla nieistniejącego wpisu wcześniej
  -- i z czystym komunikatem).
  SELECT tenant_id INTO v_tenant FROM public.posts WHERE id = _post_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  INSERT INTO public.post_tts_renditions AS r (
    post_id, lang, tenant_id, voice_id, model, content_hash, storage_path,
    byte_size, char_count, synth_count, synthesized_at
  )
  VALUES (
    _post_id, _lang, v_tenant, _voice_id, _model, _content_hash, _storage_path,
    GREATEST(coalesce(_byte_size, 0), 0), GREATEST(coalesce(_char_count, 0), 0), 1, now()
  )
  ON CONFLICT (post_id, lang) DO UPDATE
    SET voice_id       = EXCLUDED.voice_id,
        model          = EXCLUDED.model,
        content_hash   = EXCLUDED.content_hash,
        storage_path   = EXCLUDED.storage_path,
        byte_size      = EXCLUDED.byte_size,
        char_count     = EXCLUDED.char_count,
        synth_count    = r.synth_count + 1,
        synthesized_at = now(),
        updated_at     = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_post_tts_rendition(
  uuid, text, text, text, text, text, bigint, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_post_tts_rendition(
  uuid, text, text, text, text, text, bigint, integer
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_post_tts_rendition(
  uuid, text, text, text, text, text, bigint, integer
) TO service_role;

COMMENT ON FUNCTION public.record_post_tts_rendition(
  uuid, text, text, text, text, text, bigint, integer
) IS
  'Service-role only: records the canonical TTS rendition of (post, lang) after a paid synthesis. Atomic upsert bumping synth_count; tenant_id is derived from the post, never supplied by the caller.';

-- ----------------------------------------------------------------------------
-- 4) Czyszczenie obiektów keszowanych starym (mnożącym warianty) schematem
-- ----------------------------------------------------------------------------
-- Stare nazwy zawsze zawierają id modelu (`-eleven_...`), nowa ścieżka nigdy -
-- filtr jest więc precyzyjny i nie może usunąć kanonicznego pliku.
--
-- POPRAWKA 2026-08-03: blok robił BEZPOŚREDNI `DELETE FROM storage.objects`, co
-- od storage-api >= 0055 (w CI od pinu supabase/setup-cli 2.111.0) rzuca 42501
-- „Direct deletion from storage tables is not allowed" - statementowy trigger
-- `protect_objects_delete` wymaga GUC `storage.allow_delete_query`. Ponieważ to
-- blok WYKONYWANY (a nie ciało funkcji, jak w 20260712190000/192421),
-- `supabase db start` PRZERYWAŁ tu odtwarzanie migracji - identyczny defekt jak
-- w 20260803085428 i naprawiony tą samą, sankcjonowaną furtką z 20260801122000:
-- GUC transakcyjnie wokół DELETE + przywrócenie, plus EXCEPTION, żeby kolejna
-- zmiana w storage-api nie zabiła całego odtworzenia bazy. Czyszczenie cache'u
-- jest porządkowe - ostrzeżenie jest właściwą reakcją, przerwanie migracji nie.
DO $$
DECLARE
  v_prev text;
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tts-cache') THEN
    BEGIN
      v_prev := current_setting('storage.allow_delete_query', true);
      PERFORM set_config('storage.allow_delete_query', 'true', true);
      DELETE FROM storage.objects
       WHERE bucket_id = 'tts-cache'
         AND name LIKE '%-eleven!_%' ESCAPE '!';
      PERFORM set_config('storage.allow_delete_query', coalesce(v_prev, 'false'), true);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'tts: czyszczenie cache po starym schemacie nie powiodlo sie: %', SQLERRM;
    END;
  END IF;
END $$;
