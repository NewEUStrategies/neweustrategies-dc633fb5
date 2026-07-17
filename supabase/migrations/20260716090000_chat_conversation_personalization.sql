-- ============================================================================
-- Personalizacja rozmów (1:1 i grupowych) - klasa komunikatorów konsumenckich:
--
--   1) WYGLĄD ROZMOWY (współdzielony, jak motywy Messengera):
--      conversations.theme / wallpaper / quick_emoji. Ustawia dowolny
--      UCZESTNIK (semantyka jak TTL znikających wiadomości); wartości
--      whitelistowane CHECK-iem, egzekwowane też w RPC. Zmiana podbija
--      updated_at wszystkich wierszy uczestników, więc istniejący kanał
--      realtime listy (conversation_participants) rozsiewa nowy wygląd
--      NA ŻYWO do każdego członka bez nowego kanału.
--
--   2) OPIS GRUPY: conversations.description (tylko właściciel, jak tytuł).
--
--   3) PSEUDONIMY: conversation_nicknames - per rozmowa, per członek,
--      widoczne dla wszystkich uczestników (semantyka Messengera). Zapis
--      wyłącznie przez RPC (caller i cel muszą być członkami rozmowy w
--      tenancie wołającego); pusty pseudonim usuwa wiersz. REPLICA IDENTITY
--      FULL + publikacja realtime, żeby otwarte okna rozmowy dostawały
--      zmiany (w tym DELETE) na żywo.
--
-- Wszystko idempotentne; każda reguła egzekwowana w bazie (RLS/SECURITY
-- DEFINER z guardem tenant+członkostwo), nie w UI.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) KOLUMNY WYGLĄDU + OPIS GRUPY
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS theme text,
  ADD COLUMN IF NOT EXISTS wallpaper text,
  ADD COLUMN IF NOT EXISTS quick_emoji text,
  ADD COLUMN IF NOT EXISTS description text;

-- Whitelisty odzwierciedlone po stronie klienta w src/lib/chat/themes.ts
-- (test jednostkowy pilnuje zgodności obu list).
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_theme_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_theme_check
  CHECK (theme IS NULL OR theme IN
    ('ocean', 'forest', 'sunset', 'orchid', 'rose', 'graphite', 'midnight'));

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_wallpaper_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_wallpaper_check
  CHECK (wallpaper IS NULL OR wallpaper IN ('soft', 'lines', 'none'));

-- Pojedynczy klaster grafemów emoji mieści się w 16 znakach; dłuższe wpisy
-- (sekwencje/tekst) odrzucamy na twardo.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_quick_emoji_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_quick_emoji_check
  CHECK (quick_emoji IS NULL OR char_length(quick_emoji) BETWEEN 1 AND 16);

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_description_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_description_check
  CHECK (description IS NULL OR char_length(description) <= 500);

-- ----------------------------------------------------------------------------
-- 2) RPC WYGLĄDU (dowolny uczestnik, wartości whitelistowane)
-- ----------------------------------------------------------------------------
-- Sentinel 'keep' pozwala zmienić jedno pole bez nadpisywania pozostałych
-- (NULL jest legalną wartością docelową = "wróć do domyślnego").
CREATE OR REPLACE FUNCTION public.chat_set_appearance(
  p_conversation_id uuid,
  p_theme text DEFAULT 'keep',
  p_wallpaper text DEFAULT 'keep',
  p_quick_emoji text DEFAULT 'keep'
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF NOT public.is_tenant_conversation_member(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'chat: not a member';
  END IF;
  IF p_theme IS DISTINCT FROM 'keep' AND p_theme IS NOT NULL
     AND p_theme NOT IN ('ocean', 'forest', 'sunset', 'orchid', 'rose', 'graphite', 'midnight') THEN
    RAISE EXCEPTION 'chat: invalid theme';
  END IF;
  IF p_wallpaper IS DISTINCT FROM 'keep' AND p_wallpaper IS NOT NULL
     AND p_wallpaper NOT IN ('soft', 'lines', 'none') THEN
    RAISE EXCEPTION 'chat: invalid wallpaper';
  END IF;
  IF p_quick_emoji IS DISTINCT FROM 'keep' AND p_quick_emoji IS NOT NULL
     AND char_length(btrim(p_quick_emoji)) NOT BETWEEN 1 AND 16 THEN
    RAISE EXCEPTION 'chat: invalid quick emoji';
  END IF;

  UPDATE public.conversations c
     SET theme = CASE WHEN p_theme IS DISTINCT FROM 'keep' THEN p_theme ELSE c.theme END,
         wallpaper = CASE WHEN p_wallpaper IS DISTINCT FROM 'keep' THEN p_wallpaper ELSE c.wallpaper END,
         quick_emoji = CASE WHEN p_quick_emoji IS DISTINCT FROM 'keep'
                            THEN NULLIF(btrim(COALESCE(p_quick_emoji, '')), '')
                            ELSE c.quick_emoji END,
         updated_at = now()
   WHERE c.id = p_conversation_id;

  -- Rozsiew na żywo: kanał listy każdego członka nasłuchuje na jego wierszu
  -- uczestnika - bump updated_at odświeża im cache rozmów (i nowy motyw).
  UPDATE public.conversation_participants cp
     SET updated_at = now()
   WHERE cp.conversation_id = p_conversation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_appearance(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_appearance(uuid, text, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) OPIS GRUPY (właściciel, jak zmiana tytułu)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chat_set_group_description(
  p_conversation_id uuid,
  p_description text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_desc text := NULLIF(btrim(COALESCE(p_description, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF v_desc IS NOT NULL AND char_length(v_desc) > 500 THEN
    RAISE EXCEPTION 'chat: description too long';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
     WHERE conversation_id = p_conversation_id
       AND user_id = v_uid
       AND role = 'owner'
       AND tenant_id = public.current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'chat: owner required';
  END IF;

  UPDATE public.conversations c
     SET description = v_desc,
         updated_at = now()
   WHERE c.id = p_conversation_id AND c.kind = 'group';

  UPDATE public.conversation_participants cp
     SET updated_at = now()
   WHERE cp.conversation_id = p_conversation_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_group_description(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_group_description(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) PSEUDONIMY
-- ----------------------------------------------------------------------------
-- set_by z SET NULL, nie CASCADE: pseudonim należy do rozmowy i jej CELU -
-- usunięcie konta NADAJĄCEGO nie może kasować pseudonimów innych osób.
CREATE TABLE IF NOT EXISTS public.conversation_nicknames (
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 60),
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_nicknames_user_idx
  ON public.conversation_nicknames (user_id);

-- Odczyt przez RLS (członkowie rozmowy we własnym tenancie); zapis WYŁĄCZNIE
-- przez RPC - brak grantów INSERT/UPDATE/DELETE dla authenticated.
GRANT SELECT ON public.conversation_nicknames TO authenticated;
GRANT ALL ON public.conversation_nicknames TO service_role;
ALTER TABLE public.conversation_nicknames ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_nicknames_member_select ON public.conversation_nicknames;
CREATE POLICY conversation_nicknames_member_select ON public.conversation_nicknames
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT public.current_tenant_id())
    AND conversation_id IN (SELECT public.member_conversation_ids())
  );

-- DOMYŚLNA replica identity (payload DELETE = wyłącznie PK): eventy DELETE w
-- Realtime nie przechodzą przez RLS, więc pełny wiersz (z treścią pseudonimu)
-- wyciekałby subskrybentom spoza rozmowy. PK zawiera conversation_id, a klient
-- na eventach tylko invaliduje swój cache - nic więcej nie potrzebuje.
ALTER TABLE public.conversation_nicknames REPLICA IDENTITY DEFAULT;
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_nicknames;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Pseudonim może nadać każdy uczestnik każdemu uczestnikowi (także sobie);
-- pusty/NULL pseudonim usuwa wpis. NADANIE wymaga, by cel był członkiem TEJ
-- rozmowy; CZYSZCZENIE wymaga tylko członkostwa wołającego - inaczej pseudonim
-- osoby, która opuściła krąg, byłby nieusuwalny.
CREATE OR REPLACE FUNCTION public.chat_set_nickname(
  p_conversation_id uuid,
  p_user_id uuid,
  p_nickname text
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_nick text := NULLIF(btrim(COALESCE(p_nickname, '')), '');
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF v_nick IS NOT NULL AND char_length(v_nick) > 60 THEN
    RAISE EXCEPTION 'chat: nickname too long';
  END IF;
  IF NOT public.is_tenant_conversation_member(p_conversation_id, v_uid) THEN
    RAISE EXCEPTION 'chat: not a member';
  END IF;

  IF v_nick IS NULL THEN
    DELETE FROM public.conversation_nicknames
     WHERE conversation_id = p_conversation_id AND user_id = p_user_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
     WHERE conversation_id = p_conversation_id
       AND user_id = p_user_id
       AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'chat: target not a member';
  END IF;

  INSERT INTO public.conversation_nicknames
    (conversation_id, user_id, tenant_id, nickname, set_by)
  VALUES
    (p_conversation_id, p_user_id, v_tenant, v_nick, v_uid)
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET nickname = EXCLUDED.nickname,
                set_by = EXCLUDED.set_by,
                updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.chat_set_nickname(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_set_nickname(uuid, uuid, text) TO authenticated, service_role;
