-- ============================================================================
-- §9 - KONIEC FANTOMOWEGO 'contacts' W BRAMCE CZATU.
--
-- STAN ZASTANY. `get_or_create_direct_conversation` przepuszczała odbiorcę,
-- gdy jego preferencja była w zbiorze:
--
--     IF public.chat_allow_messages_from(p_peer_id) NOT IN ('everyone','contacts')
--       THEN RAISE EXCEPTION 'chat: peer not available';
--
-- ...tyle że `'contacts'` NIE JEST dozwoloną wartością: CHECK
-- `notification_preferences_allow_messages_from_check` (20260712190000)
-- dopuszcza wyłącznie `('everyone','existing','nobody')`. Literał wisiał
-- w bramce od siedmiu wydań, nie mógł się nigdy zapalić i - co gorsza - był
-- bramką NIEWERYFIKUJĄCĄ: gdyby wartość kiedykolwiek trafiła do wiersza
-- (zapis `service_role`, rozluźnienie CHECK-a, import danych), bramka
-- otworzyłaby rozmowę BEZ SPRAWDZENIA jakiegokolwiek kontaktu. Fail-open
-- oddalony o jedną migrację.
--
-- ── DECYZJA PRODUKTOWA (to nie jest wyłącznie sprzątanie kodu) ─────────────
--
-- Fantom nazywał funkcję, której platforma naprawdę nie miała, więc zamiast
-- kasować literał - DOMYKAMY GO. `contacts` staje się czwartym, realnym
-- poziomem prywatności, a cała czwórka układa się w jeden malejący porządek:
--
--     everyone  > contacts        > existing              > nobody
--     ktokolwiek  moja sieć         dotychczasowi           nikt
--     w obszarze  (zaakceptowane    rozmówcy (wspólny       (tryb cichy)
--     roboczym    połączenie)       wątek już istnieje)
--
-- Trzy powody, dla których to realna zmiana produktowa, a nie kosmetyka:
--
--  1. KRĘGI (grupy) dostają brakujący środek. `filter_group_candidates` NIE
--     wymaga połączenia w sieci - dopraszanie do kręgu przepuszcza każdego
--     z tenanta, o ile odbiorca ma `everyone`. Do dziś jedyną obroną było
--     zejście na `existing`, czyli odcięcie także własnych kontaktów.
--     `contacts` to dokładnie ten brakujący poziom: „do kręgu może mnie
--     dodać ktoś z mojej sieci, obcy z organizacji już nie".
--
--  2. ROZMOWY BEZPOŚREDNIE przestają kłamać etykietą. `get_or_create_direct_
--     conversation` i tak wymaga `is_connected_pair` („chat: not in your
--     network"), więc dla DM-ów `everyone` od zawsze znaczyło „moja sieć".
--     Po tej migracji ustawienie mówi to, co robi, a różnica między
--     `everyone` a `contacts` jest widoczna tam, gdzie jest realna: w kręgach.
--
--  3. BRAMKA PRZESTAJE UFAĆ NAPISOWI. Zamiast dopasowania literału wchodzi
--     JEDEN predykat `chat_accepts_new_thread(_initiator, _peer)`, który
--     wartość ROZSTRZYGA (sprawdza połączenie / wspólny wątek). Czytają
--     z niego OBAJ konsumenci - rozmowy bezpośrednie i krąg - więc zbiory
--     „kto może zacząć" nie mogą się już rozjechać, tak jak rozjechały się
--     dotąd (DM: literał `contacts`; krąg: `= 'everyone' OR wspólny wątek`).
--
-- Wartość domyślna bez zmian (`everyone`) - migracja nie przestawia nikomu
-- ustawień prywatności; dokłada wybór, którego nie było.
-- ============================================================================

-- ── 1) 'contacts' jako dozwolona wartość ------------------------------------

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_allow_messages_from_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_allow_messages_from_check
  CHECK (allow_messages_from IN ('everyone', 'contacts', 'existing', 'nobody'));

COMMENT ON COLUMN public.notification_preferences.allow_messages_from IS
  'Kto może ZACZĄĆ nowy wątek (istniejące rozmowy żyją dalej, poza ''nobody''): everyone > contacts (zaakceptowane połączenie) > existing (wspólny wątek już istnieje) > nobody. Egzekwuje public.chat_accepts_new_thread - jedyny konsument tej kolumny w bramkach.';

-- ── 2) Jeden predykat dla rozmów bezpośrednich i kręgów ---------------------

-- SECURITY DEFINER, bo czyta cudzy wiersz `notification_preferences` oraz
-- `conversation_participants` obu stron - RLS zasłania jedno i drugie.
-- Fail-closed: brak odbiorcy albo brak inicjatora = false.
CREATE OR REPLACE FUNCTION public.chat_accepts_new_thread(_initiator uuid, _peer uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _initiator IS NOT NULL
     AND _peer IS NOT NULL
     AND _initiator <> _peer
     AND CASE public.chat_allow_messages_from(_peer)
           WHEN 'everyone' THEN true
           -- Zaakceptowane połączenie w dowolnym kierunku.
           WHEN 'contacts' THEN public.is_connected_pair(_initiator, _peer)
           -- Dowolny wspólny wątek (bezpośredni albo krąg) już istnieje.
           WHEN 'existing' THEN EXISTS (
             SELECT 1
               FROM public.conversation_participants a
               JOIN public.conversation_participants b
                 ON b.conversation_id = a.conversation_id
              WHERE a.user_id = _initiator
                AND b.user_id = _peer
           )
           WHEN 'nobody' THEN false
           -- Nieznana wartość (rozluźniony CHECK, import, przyszły poziom):
           -- zamykamy. Bramka nie ma prawa przepuścić napisu, którego nie zna.
           ELSE false
         END;
$$;

COMMENT ON FUNCTION public.chat_accepts_new_thread(uuid, uuid) IS
  'Czy _peer godzi się, by _initiator ZACZĄŁ z nim nowy wątek (DM albo krąg), zgodnie z allow_messages_from. Jedyna bramka czytająca tę preferencję: rozstrzyga wartość zamiast dopasowywać literał, nieznaną wartość odrzuca (fail-closed).';

REVOKE ALL ON FUNCTION public.chat_accepts_new_thread(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_accepts_new_thread(uuid, uuid) TO authenticated, service_role;

-- ── 3) Konsument A: rozmowa bezpośrednia ------------------------------------
-- Ciało jak w 20260806184400; ZMIANA WYŁĄCZNIE w bramce prywatności
-- (dopasowanie literału -> rozstrzygający predykat).

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_peer_discoverable boolean;
  v_key text; v_conversation uuid; v_is_admin boolean; v_features jsonb;
  v_created boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'chat: authentication required'; END IF;
  IF p_peer_id IS NULL OR p_peer_id = v_uid THEN RAISE EXCEPTION 'chat: invalid peer'; END IF;
  IF public.is_blocked_pair(v_uid, p_peer_id) THEN RAISE EXCEPTION 'chat: blocked'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id, discoverable INTO v_peer_tenant, v_peer_discoverable
    FROM public.profiles WHERE id = p_peer_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'chat: peer not available';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);

  IF NOT v_is_admin AND NOT public.is_connected_pair(v_uid, p_peer_id) THEN
    RAISE EXCEPTION 'chat: not in your network';
  END IF;

  IF NOT v_is_admin THEN
    v_features := public.my_effective_tier_features();

    IF NOT public.is_expert_user(v_uid, v_tenant)
       AND NOT public.is_vip_user(v_uid, v_tenant)
       AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: tier disabled';
    END IF;

    IF public.is_gated_recipient(p_peer_id, v_tenant)
       AND NOT public.is_expert_user(v_uid, v_tenant)
       AND NOT public.is_vip_user(v_uid, v_tenant)
       AND COALESCE((v_features ->> 'chat_direct_gated')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: expert requires inmail';
    END IF;
  END IF;

  v_key := v_tenant::text || ':' || LEAST(v_uid, p_peer_id)::text || ':' || GREATEST(v_uid, p_peer_id)::text;
  SELECT id INTO v_conversation FROM public.conversations WHERE direct_key = v_key;

  IF v_conversation IS NULL THEN
    IF NOT v_is_admin THEN
      IF NOT COALESCE(v_peer_discoverable, false) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
      -- Było: NOT IN ('everyone','contacts') - dopasowanie literału, w tym
      -- jednego, którego CHECK nigdy nie dopuścił.
      IF NOT public.chat_accepts_new_thread(v_uid, p_peer_id) THEN
        RAISE EXCEPTION 'chat: peer not available';
      END IF;
    END IF;
    INSERT INTO public.conversations (tenant_id, kind, direct_key, created_by)
    VALUES (v_tenant, 'direct', v_key, v_uid)
    ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conversation;
    INSERT INTO public.conversation_participants (conversation_id, tenant_id, user_id)
    VALUES (v_conversation, v_tenant, v_uid), (v_conversation, v_tenant, p_peer_id)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    v_created := true;
  END IF;

  IF NOT v_created THEN
    UPDATE public.conversation_participants
       SET archived_at = NULL,
           updated_at = now()
     WHERE conversation_id = v_conversation
       AND user_id = v_uid
       AND archived_at IS NOT NULL;

    UPDATE public.conversations
       SET updated_at = now()
     WHERE id = v_conversation;
  END IF;

  RETURN v_conversation;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid) TO authenticated, service_role;

-- ── 4) Konsument B: dopraszanie do kręgu ------------------------------------
-- Filtr kandydatów wspólny dla tworzenia kręgu i dopraszania: ten sam tenant,
-- brak blokady w dowolnym kierunku, poszanowanie allow_messages_from - teraz
-- przez ten sam predykat co rozmowy bezpośrednie.

CREATE OR REPLACE FUNCTION public.filter_group_candidates(p_inviter uuid, p_candidates uuid[])
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
    FROM (
      SELECT DISTINCT p.id
        FROM unnest(p_candidates) AS cand(id)
        JOIN public.profiles p ON p.id = cand.id
        JOIN public.profiles inv ON inv.id = p_inviter
       WHERE p.id <> p_inviter
         AND p.tenant_id = inv.tenant_id
         AND NOT public.is_blocked_pair(p_inviter, p.id)
         AND public.chat_accepts_new_thread(p_inviter, p.id)
    ) c;
$$;

COMMENT ON FUNCTION public.filter_group_candidates(uuid, uuid[]) IS
  'Kandydaci na członków kręgu: ten sam tenant, brak blokady, zgoda odbiorcy wg chat_accepts_new_thread (ten sam predykat co rozmowy bezpośrednie - poziom ''contacts'' domyka lukę, w której obcy z organizacji mógł dodać Cię do kręgu).';

REVOKE EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) TO service_role;
