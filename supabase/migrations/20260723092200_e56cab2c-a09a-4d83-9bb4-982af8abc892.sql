-- 1) is_vip_user
CREATE OR REPLACE FUNCTION public.is_vip_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.membership_grants g
       WHERE g.user_id = _uid
         AND g.revoked_at IS NULL
         AND g.starts_at <= now()
         AND (g.expires_at IS NULL OR g.expires_at > now())
         AND g.tier_key IN ('vip','corporate','partner','partner_general','presidents_circle')
    ) OR EXISTS (
      SELECT 1 FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id
       WHERE us.user_id = _uid
         AND us.status::text IN ('active','trialing','past_due')
         AND ap.tier_key IN ('vip','corporate','partner','partner_general','presidents_circle')
    )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_vip_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_vip_user(uuid) TO authenticated, service_role;

-- 2) is_gated_recipient = expert OR vip
CREATE OR REPLACE FUNCTION public.is_gated_recipient(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_expert_user(_uid) OR public.is_vip_user(_uid);
$$;
REVOKE EXECUTE ON FUNCTION public.is_gated_recipient(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_gated_recipient(uuid) TO authenticated, service_role;

-- 3) Rebranding flag na warstwach
--   Pro nie ma już bezpośredniego DM do ekspertów - obowiązuje kwota inMail.
UPDATE public.membership_tiers
   SET features = COALESCE(features,'{}'::jsonb) - 'chat_experts_direct';

--   VIP i wyżej: bezpośredni DM do ekspertów i VIP-ów bez inMail.
UPDATE public.membership_tiers
   SET features = COALESCE(features,'{}'::jsonb) || jsonb_build_object('chat_direct_gated', true)
 WHERE key IN ('vip','corporate','partner','partner_general','presidents_circle');

--   Kwoty miesięczne inMail
UPDATE public.membership_tiers
   SET features = COALESCE(features,'{}'::jsonb) || jsonb_build_object('chat_inmail_quota_2', true)
 WHERE key = 'member';

UPDATE public.membership_tiers
   SET features = COALESCE(features,'{}'::jsonb) || jsonb_build_object('chat_inmail_quota_5', true)
 WHERE key = 'pro';

-- 4) get_or_create_direct_conversation: bramka „gated recipient".
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(p_peer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_peer_discoverable boolean;
  v_key text; v_conversation uuid; v_is_admin boolean; v_features jsonb;
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

    IF NOT public.is_expert_user(v_uid)
       AND NOT public.is_vip_user(v_uid)
       AND COALESCE((v_features ->> 'chat_enabled')::boolean, false) = false THEN
      RAISE EXCEPTION 'chat: tier disabled';
    END IF;

    -- Bezpośredni czat z „gated" (ekspert / VIP): wymaga chat_direct_gated
    -- ALBO bycia samemu ekspertem lub VIP-em (ekspert <-> VIP też przechodzi).
    IF public.is_gated_recipient(p_peer_id)
       AND NOT public.is_expert_user(v_uid)
       AND NOT public.is_vip_user(v_uid)
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
      IF public.chat_allow_messages_from(p_peer_id) NOT IN ('everyone','contacts') THEN
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
  END IF;

  RETURN v_conversation;
END;
$$;

-- 5) send_expert_inmail: gated recipient + kwota miesięczna.
CREATE OR REPLACE FUNCTION public.send_expert_inmail(
  p_recipient_id uuid, p_subject text, p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_features jsonb; v_new_id uuid; v_link text;
  v_quota integer; v_used integer; v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'inmail: authentication required'; END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'inmail: invalid recipient';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'inmail: recipient not available';
  END IF;

  IF NOT public.is_gated_recipient(p_recipient_id) THEN
    RAISE EXCEPTION 'inmail: recipient is not gated';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);
  v_features := public.my_effective_tier_features();

  -- Wybór kwoty miesięcznej po flagach (najwyższa wygrywa).
  v_quota := CASE
    WHEN v_is_admin THEN 100000
    WHEN COALESCE((v_features ->> 'chat_direct_gated')::boolean, false) THEN 100000
    WHEN COALESCE((v_features ->> 'chat_inmail_quota_5')::boolean, false) THEN 5
    WHEN COALESCE((v_features ->> 'chat_inmail_quota_2')::boolean, false) THEN 2
    ELSE 0
  END;

  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'inmail: tier disabled';
  END IF;

  IF char_length(coalesce(p_subject,'')) < 5 OR char_length(coalesce(p_subject,'')) > 140 THEN
    RAISE EXCEPTION 'inmail: subject length';
  END IF;
  IF char_length(coalesce(p_reason,'')) < 20 OR char_length(coalesce(p_reason,'')) > 2000 THEN
    RAISE EXCEPTION 'inmail: reason length';
  END IF;
  IF p_questions IS NOT NULL AND array_length(p_questions, 1) > 5 THEN
    RAISE EXCEPTION 'inmail: too many questions';
  END IF;
  IF p_external_links IS NOT NULL AND array_length(p_external_links, 1) > 3 THEN
    RAISE EXCEPTION 'inmail: too many links';
  END IF;
  IF p_external_links IS NOT NULL THEN
    FOREACH v_link IN ARRAY p_external_links LOOP
      IF v_link !~* '^https?://' THEN
        RAISE EXCEPTION 'inmail: invalid link';
      END IF;
    END LOOP;
  END IF;

  -- Kwota miesięczna kalendarzowa: liczymy WSZYSTKIE wysłane w tym miesiącu
  -- poza tymi, które sam nadawca anulował (nie karzemy za wycofanie).
  SELECT count(*) INTO v_used FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.created_at >= date_trunc('month', now())
     AND ei.status <> 'cancelled';

  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'inmail: monthly quota exceeded';
  END IF;

  INSERT INTO public.expert_inmails
    (tenant_id, sender_id, recipient_id, subject, reason, questions,
     expected_answers, external_links)
  VALUES
    (v_tenant, v_uid, p_recipient_id, btrim(p_subject), btrim(p_reason),
     COALESCE(p_questions, ARRAY[]::text[]),
     NULLIF(btrim(coalesce(p_expected_answers,'')),''),
     COALESCE(p_external_links, ARRAY[]::text[]))
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_expert_inmail(uuid, text, text, text[], text, text[]) TO authenticated;

-- 6) Helper: podgląd stanu kwoty dla klienta (UI może pokazać „2/2 użyto").
CREATE OR REPLACE FUNCTION public.my_inmail_quota()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_features jsonb;
  v_quota integer;
  v_used integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('quota', 0, 'used', 0); END IF;
  v_features := public.my_effective_tier_features();
  v_quota := CASE
    WHEN public.is_super_admin(v_uid) THEN 100000
    WHEN COALESCE((v_features ->> 'chat_direct_gated')::boolean, false) THEN 100000
    WHEN COALESCE((v_features ->> 'chat_inmail_quota_5')::boolean, false) THEN 5
    WHEN COALESCE((v_features ->> 'chat_inmail_quota_2')::boolean, false) THEN 2
    ELSE 0
  END;
  SELECT count(*) INTO v_used FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.created_at >= date_trunc('month', now())
     AND ei.status <> 'cancelled';
  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', v_quota >= 100000);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_inmail_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_inmail_quota() TO authenticated, service_role;
