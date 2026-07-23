-- ============================================================================
-- Czat = świadczenie od progu Plus (i wyżej); Essential (reader) bez czatu.
--
-- Kontekst: bramka czatu (get_or_create_direct_conversation -> features.chat_enabled)
-- oraz kwoty inMail zostały wprowadzone JEDNORAZOWYMI UPDATE-ami w migracjach
-- 20260723090707 i 20260723092200. Działają dla ISTNIEJĄCYCH tenantów, ale
-- kanoniczny seed nowych tenantów (seed_pricing_defaults) NIE ustawiał flag
-- chat_*. Skutek: świeżo zaseedowany tenant miałby czat wyłączony dla WSZYSTKICH
-- warstw (także Plus), bo my_effective_tier_features() nie widziałoby chat_enabled
-- na żadnym progu. Ta migracja domyka lukę seeda i - dla uczciwości oferty -
-- dokłada świadczenie „czat" do copy planu Plus, żeby /pricing (karta + macierz
-- porównania) pokazywały je wprost.
--
-- Zakres i bezpieczeństwo:
--   * BEZ nowych bramek - flagi chat_* są już egzekwowane serwerowo i figurują
--     w rejestrze TIER_CAPABILITIES (src/lib/billing/capabilities.ts). Ta migracja
--     dopina je tylko do ścieżki seeda nowych tenantów.
--   * reader (Essential) nigdy nie dostaje flag czatu (krok defensywny).
--   * Wszystko idempotentne (guardy `NOT (features ? ...)`, katalog benefitów
--     force-update tylko dla progu member).
-- ============================================================================

-- 1) Idempotentny seed flag czatu wg rang progów (jedno źródło - używane przez
--    seed nowych tenantów ORAZ backfill istniejących poniżej).
CREATE OR REPLACE FUNCTION public.seed_chat_tier_flags(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rozpoczęcie rozmowy DM: Plus (member, rank 10) i wyżej. Reader BEZ flagi.
  UPDATE public.membership_tiers
     SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('chat_enabled', true)
   WHERE tenant_id = p_tenant
     AND key IN ('member', 'pro', 'vip', 'corporate', 'partner', 'partner_general',
                 'presidents_circle', 'team', 'ngo', 'educator', 'student')
     AND NOT (features ? 'chat_enabled');

  -- Bezpośredni DM z ekspertami/VIP-ami bez inMail: VIP i wyżej.
  UPDATE public.membership_tiers
     SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('chat_direct_gated', true)
   WHERE tenant_id = p_tenant
     AND key IN ('vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'chat_direct_gated');

  -- Miesięczne kwoty inMail do ekspertów: Plus = 2, Pro = 5.
  UPDATE public.membership_tiers
     SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('chat_inmail_quota_2', true)
   WHERE tenant_id = p_tenant AND key = 'member' AND NOT (features ? 'chat_inmail_quota_2');

  UPDATE public.membership_tiers
     SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object('chat_inmail_quota_5', true)
   WHERE tenant_id = p_tenant AND key = 'pro' AND NOT (features ? 'chat_inmail_quota_5');

  -- Essential (reader) nigdy nie ma flag czatu (defensywnie, gdyby katalog
  -- kiedyś je dołożył na tym progu).
  UPDATE public.membership_tiers
     SET features = (((COALESCE(features, '{}'::jsonb) - 'chat_enabled') - 'chat_direct_gated')
                     - 'chat_inmail_quota_2') - 'chat_inmail_quota_5'
   WHERE tenant_id = p_tenant AND key = 'reader'
     AND (features ? 'chat_enabled' OR features ? 'chat_direct_gated'
          OR features ? 'chat_inmail_quota_2' OR features ? 'chat_inmail_quota_5');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_chat_tier_flags(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_chat_tier_flags(uuid) TO service_role;

-- 2) Copy benefitów v5: benefit „czat" w planie Plus (member). Zwracamy WYŁĄCZNIE
--    próg member i force-update tylko jego - pozostałe progi trzyma katalog v4
--    (nie ruszamy ich, żeby nie nadpisać innych świadczeń). Nowe tenanty dostają
--    ten krok po apply_pricing_catalog_v4 (patrz seed_pricing_defaults niżej).
CREATE OR REPLACE FUNCTION public.pricing_catalog_v5_benefits()
RETURNS TABLE (key text, benefits jsonb)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT * FROM (VALUES
    ('member',
     '[{"pl":"Pełne archiwum analiz i policy papers, bez limitów","en":"The full archive of analyses and policy papers, no limits",
        "group_pl":"Wszystko z planu Essential, oraz:","group_en":"Everything in Essential, plus:"},
       {"pl":"Wczesny dostęp do raportów przed publikacją otwartą","en":"Early access to reports ahead of open publication"},
       {"pl":"Pogłębiony digest członkowski - analiza, nie nagłówki","en":"A members-only in-depth digest - analysis, not headlines"},
       {"pl":"Briefingi i wydarzenia członkowskie online wraz z nagraniami","en":"Online member briefings and events, with recordings"},
       {"pl":"Czat i wiadomości z innymi członkami społeczności","en":"Chat and direct messages with other community members"},
       {"pl":"Zniżka na konferencję „Geopolityczna Gra Mocarstw” i wydarzenia biletowane","en":"A discount on the „Geopolityczna Gra Mocarstw” conference and ticketed events"},
       {"pl":"Pełny dostęp do podcastu „Depesza Dyplomaty”, wywiadów i materiałów audio-wideo","en":"Full access to the „Depesza Dyplomaty” podcast, interviews and audio-video",
        "group_pl":"Narzędzia i materiały członkowskie:","group_en":"Member tools and materials:"},
       {"pl":"Panel „Analiza Tygodnia”: mapy, wykresy i dane w pigułce","en":"The „Analysis of the Week” panel: maps, charts and data at a glance"},
       {"pl":"Cykl „Learning Path”: kuratorowane listy lektur i ścieżki tematyczne","en":"„Learning Path”: curated reading lists and thematic tracks"},
       {"pl":"Narzędzia cytowania pełnych analiz (Chicago, APA, BibTeX)","en":"Citation tools for full analyses (Chicago, APA, BibTeX)"},
       {"pl":"Anulowanie w każdej chwili","en":"Cancel anytime"}]'::jsonb)
  ) AS v(key, benefits);
$$;

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_v5_benefits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_v5_benefits() TO service_role;

CREATE OR REPLACE FUNCTION public.apply_pricing_catalog_v5(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.membership_tiers mt
     SET benefits = v.benefits
    FROM public.pricing_catalog_v5_benefits() v
   WHERE mt.tenant_id = p_tenant AND mt.key = v.key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_pricing_catalog_v5(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_pricing_catalog_v5(uuid) TO service_role;

-- 3) Nowe tenanty: seed flag czatu + copy v5 wplecione w seed_pricing_defaults
--    (pełne ciało z kroku 20260723170000 + krok chat_* i krok v5 na końcu).
CREATE OR REPLACE FUNCTION public.seed_pricing_defaults(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_pricing_audiences(p_tenant);
  PERFORM public.seed_membership_tiers(p_tenant);

  UPDATE public.membership_tiers
     SET audience_key = CASE
       WHEN key IN ('reader', 'supporter', 'member', 'pro', 'vip') THEN 'individual'
       WHEN key IN ('corporate', 'partner', 'partner_general', 'presidents_circle')
         THEN 'business'
       WHEN key IN ('student', 'educator', 'ngo') THEN 'academic'
       WHEN key = 'team' THEN 'team'
       ELSE audience_key
     END
   WHERE tenant_id = p_tenant AND audience_key IS NULL;

  -- Monitoring regulacyjny (tracker) - benefit Pro i wyżej.
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  -- Zapytanie do eksperta + linki podarunkowe - progi Pro-scope (jak qa_priority).
  UPDATE public.membership_tiers
     SET features = features
         || jsonb_build_object('expert_request', true)
         || jsonb_build_object('gift_links', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle', 'ngo', 'team')
     AND NOT (features ? 'expert_request' AND features ? 'gift_links');

  -- Czat: świadczenie od progu Plus (i wyżej); reader bez czatu.
  PERFORM public.seed_chat_tier_flags(p_tenant);

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  -- Benefity progów indywidualnych wg macierzy NES (v4) + benefit czatu (v5, member).
  PERFORM public.apply_pricing_catalog_v4(p_tenant);
  PERFORM public.apply_pricing_catalog_v5(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

-- 4) Bramka czatu grupowego (kręgi). Tworzenie kręgu to funkcja czatu, więc
--    wymaga progu Plus (chat_enabled) - dokładnie jak DM w
--    get_or_create_direct_conversation. Bez tej bramki Essential mógłby ominąć
--    ograniczenie zakładając krąg. Eksperci, VIP-y i super-admin pomijają
--    bramkę (spójnie ze ścieżką DM). Reszta ciała bez zmian względem
--    20260713094000_group_conversations.sql.
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

  -- Bramka progu: czat (także grupowy) od Plus w górę. Eksperci/VIP/super-admin
  -- pomijają, tak jak w get_or_create_direct_conversation.
  IF NOT public.is_super_admin(v_user)
     AND NOT public.is_expert_user(v_user)
     AND NOT public.is_vip_user(v_user)
     AND COALESCE((public.my_effective_tier_features() ->> 'chat_enabled')::boolean, false) = false THEN
    RAISE EXCEPTION 'chat: tier disabled';
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

-- 5) Istniejące tenanty: backfill flag czatu (idempotentnie) + odświeżenie
--    copy Plus o benefit czatu. Nie ruszamy pozostałych progów.
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_chat_tier_flags(v_t);
    PERFORM public.apply_pricing_catalog_v5(v_t);
  END LOOP;
END $$;
