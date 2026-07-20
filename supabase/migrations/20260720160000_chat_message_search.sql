-- Wyszukiwanie w treści rozmów czatu (P0 z OCENA_MODULOW_2026-07-20 §4.5).
--
-- Kontekst:
--   * Czat ma tylko klientowy filtr listy rozmów po NAZWIE - treść wiadomości
--     jest nieprzeszukiwalna ("luka nr 1 w codziennym użyciu").
--   * Infrastruktura FTS platformy już istnieje (unaccent, nes_search_tsquery
--     z polską fleksją, konwencja ts_headline z delimiterami [[[ ]]]).
--
-- Zakres:
--   1. messages.search_vector (tsvector) utrzymywany triggerem z body (waga A)
--      i attachment_name (waga B) + backfill + indeks GIN.
--   2. RPC search_messages: SECURITY DEFINER z JAWNIE powtórzonymi warunkami
--      polityki messages_member_select (tenant, członkostwo, expires_at,
--      cleared_before) + wykluczeniem tombstone'ów (deleted_at) - tombstony
--      przechodzą przez RLS (renderują się jako "usunięto"), ale nie mogą
--      wyciekać przez wyszukiwarkę. Zwraca snippet ts_headline w konwencji
--      [[[ ]]] (klient renderuje przez SearchSnippet, bez innerHTML).
--
-- Konwencje jak w 20260714130000 / 20260720140000:
--   * SECURITY DEFINER + search_path = public, extensions,
--   * tenant rozstrzygany WYŁĄCZNIE serwerowo (lustro RLS: current_tenant_id),
--   * REVOKE FROM PUBLIC, GRANT tylko authenticated + service_role
--     (czat wymaga zalogowania - anon nie ma tu nic do szukania),
--   * LIMIT ograniczony obustronnie.

-- 1. Kolumna + trigger + backfill + indeks ------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION public.nes_messages_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  -- Tombstone (cofnięcie wysłania) zeruje body -> wektor też się zeruje,
  -- więc usunięta treść znika z indeksu bez osobnego sprzątania.
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.body, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.attachment_name, ''))), 'B');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_search_vector ON public.messages;
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF body, attachment_name ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.nes_messages_search_vector();

UPDATE public.messages
   SET search_vector =
         setweight(to_tsvector('simple', unaccent(coalesce(body, ''))), 'A') ||
         setweight(to_tsvector('simple', unaccent(coalesce(attachment_name, ''))), 'B')
 WHERE search_vector IS NULL
   AND (body IS NOT NULL OR attachment_name IS NOT NULL);

CREATE INDEX IF NOT EXISTS messages_search_vector_gin
  ON public.messages USING gin (search_vector);

-- 2. RPC search_messages ------------------------------------------------------
-- _conversation_id = NULL -> szukanie we WSZYSTKICH rozmowach wołającego
-- (skrzynka /messages); konkretny id -> szukanie w jednej rozmowie (okno).
-- Porządek: najnowsze najpierw (konwencja WhatsApp/Messenger) - rank zostaje
-- w wyniku jako sygnał pomocniczy dla klienta.

CREATE OR REPLACE FUNCTION public.search_messages(
  _q text,
  _conversation_id uuid DEFAULT NULL,
  _limit integer DEFAULT 30,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  kind text,
  snippet text,
  created_at timestamptz,
  rank real,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH tq AS (
    SELECT public.nes_search_tsquery(_q) AS q
  ),
  hits AS (
    SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.body,
           m.attachment_name, m.created_at,
           ts_rank_cd(m.search_vector, tq.q)::real AS rank
      FROM public.messages m
      JOIN public.conversation_participants cp
        ON cp.conversation_id = m.conversation_id
       AND cp.user_id = auth.uid()
      CROSS JOIN tq
     WHERE auth.uid() IS NOT NULL
       AND tq.q IS NOT NULL
       AND m.search_vector @@ tq.q
       -- Lustro messages_member_select + wykluczenie tombstone'ów:
       AND m.tenant_id = (SELECT public.current_tenant_id())
       AND m.deleted_at IS NULL
       AND (m.expires_at IS NULL OR m.expires_at > now())
       AND m.created_at >= coalesce(cp.cleared_before, '-infinity'::timestamptz)
       AND (_conversation_id IS NULL OR m.conversation_id = _conversation_id)
  )
  SELECT h.id, h.conversation_id, h.sender_id, h.kind,
         ts_headline(
           'simple',
           left(coalesce(h.body, h.attachment_name, ''), 1000),
           tq.q,
           'StartSel=[[[, StopSel=]]], MaxWords=18, MinWords=8, ShortWord=2, MaxFragments=1'
         ) AS snippet,
         h.created_at, h.rank,
         (count(*) OVER ())::bigint AS total_count
    FROM hits h
    CROSS JOIN tq
   ORDER BY h.created_at DESC, h.id DESC
   LIMIT GREATEST(LEAST(coalesce(_limit, 30), 100), 1)
  OFFSET GREATEST(coalesce(_offset, 0), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_messages(text, uuid, integer, integer)
  TO authenticated, service_role;
