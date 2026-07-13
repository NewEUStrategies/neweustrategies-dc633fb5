-- ============================================================================
-- SPOŁECZNOŚĆ 5/10: rozmowy grupowe ("kręgi") na istniejącej infrastrukturze
-- czatu 1:1.
--
-- conversations.kind zna 'group' od pierwszej migracji czatu; RLS wiadomości,
-- reakcje, potwierdzenia, wyciszanie, TTL i fan-out powiadomień są już
-- generyczne po uczestnikach - ten plik dodaje brakujące minimum:
--
--   * conversations.title (nazwa kręgu) i rola uczestnika (owner/member),
--   * create_group_conversation: tworzenie z listą członków; kandydaci są
--     filtrowani serwerowo tak, żeby zaproszenie do grupy NIE obchodziło
--     prywatności czatu (allow_messages_from) ani blokad (user_blocks),
--   * add_group_members / leave_group_conversation / rename_group_conversation
--     (owner zarządza; wyjście ostatniego uczestnika sprząta konwersację,
--     wyjście ownera promuje najstarszego członka).
--
-- Guard wiadomości (tg_messages_guard) i fan-out działają bez zmian: blokada
-- pary nadal obowiązuje wewnątrz grupy, limit tempa per nadawca również.
--
-- Wszystko idempotentne.
-- ============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_title_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_title_check
  CHECK (title IS NULL OR length(btrim(title)) BETWEEN 2 AND 80);

ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';
ALTER TABLE public.conversation_participants
  DROP CONSTRAINT IF EXISTS conversation_participants_role_check;
ALTER TABLE public.conversation_participants
  ADD CONSTRAINT conversation_participants_role_check
  CHECK (role IN ('owner', 'member'));

-- ----------------------------------------------------------------------------
-- Filtr kandydatów wspólny dla tworzenia grupy i dopraszania: ten sam tenant,
-- brak blokady w dowolnym kierunku, poszanowanie allow_messages_from
-- ('existing' wymaga wcześniejszej wspólnej konwersacji z zapraszającym).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.filter_group_candidates(p_inviter uuid, p_candidates uuid[])
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
    FROM (
      SELECT DISTINCT p.id
        FROM unnest(p_candidates) AS cand(id)
        JOIN public.profiles p ON p.id = cand.id
        JOIN public.profiles inv ON inv.id = p_inviter
        LEFT JOIN public.notification_preferences np ON np.user_id = p.id
       WHERE p.id <> p_inviter
         AND p.tenant_id = inv.tenant_id
         AND NOT public.is_blocked_pair(p_inviter, p.id)
         AND COALESCE(np.allow_messages_from, 'everyone') <> 'nobody'
         AND (
           COALESCE(np.allow_messages_from, 'everyone') = 'everyone'
           OR EXISTS (
             SELECT 1
               FROM public.conversation_participants a
               JOIN public.conversation_participants b
                 ON b.conversation_id = a.conversation_id
              WHERE a.user_id = p_inviter AND b.user_id = p.id
           )
         )
    ) c;
$$;

REVOKE EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filter_group_candidates(uuid, uuid[]) TO service_role;

-- ----------------------------------------------------------------------------
-- Tworzenie kręgu
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_group_conversation(p_title text, p_member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_title text := btrim(COALESCE(p_title, ''));
  v_members uuid[];
  v_conv uuid;
  v_m uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'chat: authentication required';
  END IF;
  IF length(v_title) < 2 OR length(v_title) > 80 THEN
    RAISE EXCEPTION 'chat: invalid group title';
  END IF;
  IF p_member_ids IS NULL OR array_length(p_member_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'chat: members required';
  END IF;
  IF array_length(p_member_ids, 1) > 49 THEN
    RAISE EXCEPTION 'chat: too many members';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_user;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'chat: profile missing';
  END IF;

  v_members := public.filter_group_candidates(v_user, p_member_ids);
  IF array_length(v_members, 1) IS NULL THEN
    RAISE EXCEPTION 'chat: no eligible members';
  END IF;

  INSERT INTO public.conversations (tenant_id, kind, created_by, title, last_message_at)
  VALUES (v_tenant, 'group', v_user, v_title, now())
  RETURNING id INTO v_conv;

  INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
  VALUES (v_conv, v_user, v_tenant, 'owner');

  FOREACH v_m IN ARRAY v_members LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
    VALUES (v_conv, v_m, v_tenant, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;

    PERFORM public.enqueue_notification(
      v_m,
      'message',
      'Dodano Cię do kręgu: ' || v_title,
      'You were added to the circle: ' || v_title,
      NULL, NULL,
      '/messages?c=' || v_conv::text,
      'UsersRound'
    );
  END LOOP;

  RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_conversation(text, uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Dopraszanie (owner) - ta sama filtracja kandydatów
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_group_members(p_conversation_id uuid, p_member_ids uuid[])
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_conv public.conversations%ROWTYPE;
  v_members uuid[];
  v_m uuid;
  v_added integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'chat: authentication required';
  END IF;

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_conv.kind <> 'group' THEN
    RAISE EXCEPTION 'chat: group not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
     WHERE conversation_id = p_conversation_id AND user_id = v_user AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'chat: owner required';
  END IF;

  v_members := public.filter_group_candidates(v_user, p_member_ids);

  FOREACH v_m IN ARRAY COALESCE(v_members, '{}'::uuid[]) LOOP
    INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id, role)
    VALUES (p_conversation_id, v_m, v_conv.tenant_id, 'member')
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
    IF FOUND THEN
      v_added := v_added + 1;
      PERFORM public.enqueue_notification(
        v_m,
        'message',
        'Dodano Cię do kręgu: ' || COALESCE(v_conv.title, 'Krąg'),
        'You were added to the circle: ' || COALESCE(v_conv.title, 'Circle'),
        NULL, NULL,
        '/messages?c=' || p_conversation_id::text,
        'UsersRound'
      );
    END IF;
  END LOOP;

  RETURN v_added;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Wyjście z kręgu: ostatni gasi światło, owner przekazuje pałeczkę
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_group_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_kind text;
  v_was_owner boolean;
  v_next uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'chat: authentication required';
  END IF;

  SELECT kind INTO v_kind FROM public.conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR v_kind <> 'group' THEN
    RAISE EXCEPTION 'chat: group not found';
  END IF;

  DELETE FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id AND user_id = v_user
  RETURNING role = 'owner' INTO v_was_owner;
  IF v_was_owner IS NULL THEN
    RAISE EXCEPTION 'chat: not a participant';
  END IF;

  SELECT user_id INTO v_next
    FROM public.conversation_participants
   WHERE conversation_id = p_conversation_id
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_next IS NULL THEN
    DELETE FROM public.conversations WHERE id = p_conversation_id;
  ELSIF v_was_owner THEN
    UPDATE public.conversation_participants
       SET role = 'owner'
     WHERE conversation_id = p_conversation_id AND user_id = v_next;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_group_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_group_conversation(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Zmiana nazwy (owner)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rename_group_conversation(p_conversation_id uuid, p_title text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_title text := btrim(COALESCE(p_title, ''));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'chat: authentication required';
  END IF;
  IF length(v_title) < 2 OR length(v_title) > 80 THEN
    RAISE EXCEPTION 'chat: invalid group title';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.conversation_participants
     WHERE conversation_id = p_conversation_id AND user_id = v_user AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'chat: owner required';
  END IF;

  UPDATE public.conversations
     SET title = v_title
   WHERE id = p_conversation_id AND kind = 'group';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rename_group_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_group_conversation(uuid, text) TO authenticated, service_role;

-- Właściciele istniejących konwersacji direct zostają 'member' (bez znaczenia
-- dla 1:1); twórcy istniejących grup - gdyby jakieś powstały ręcznie - ownerem.
UPDATE public.conversation_participants cp
   SET role = 'owner'
  FROM public.conversations c
 WHERE c.id = cp.conversation_id
   AND c.kind = 'group'
   AND c.created_by = cp.user_id
   AND cp.role <> 'owner';
