-- ============================================================================
-- FEATURE: sterowanie widocznością przycisku "Zapytanie do eksperta".
--
-- Trzy poziomy kontroli (przycisk widoczny <=> global ON i per-user ON):
--   1) GLOBAL (per tenant): site_settings.community_modules.expert_requests_enabled
--      (domyślnie true) - admin włącza/wyłącza funkcję dla całej organizacji.
--   2) PER-USER: profiles.expert_requests_enabled (domyślnie true) - edytowalne
--      przez samego eksperta (własny wiersz, RLS) ORAZ przez admina (RPC).
--
-- Egzekwujemy zarówno w UI (przycisk znika), jak i serwerowo w send_expert_inmail
-- (bezpośrednie wywołanie RPC do wyłączonego eksperta jest odrzucane).
-- ============================================================================

-- ── (1) Per-user flaga na profiles ──────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS expert_requests_enabled boolean NOT NULL DEFAULT true;

-- Granty kolumnowe (table-level SELECT dla authenticated jest cofnięty modelem
-- kolumnowym). SELECT: self-read (własny wiersz) + panel admina (staff czyta
-- wiersze tenanta pod RLS). UPDATE: self opt-out (polityka "Users update own
-- profile"). Anon czyta przez zaufany widok profiles_public - bez grantu bazowego.
-- Wiersze i tak filtruje RLS, więc grant nie poszerza widoczności między userami.
GRANT SELECT (expert_requests_enabled) ON public.profiles TO authenticated;
GRANT UPDATE (expert_requests_enabled) ON public.profiles TO authenticated;

-- ── (2) profiles_public: dołóż kolumnę (widok = zaufana projekcja definera) ──
-- CREATE OR REPLACE VIEW pozwala DODAĆ kolumny na końcu listy. Odtwarzamy pełną
-- listę z 20260720085723 + expert_requests_enabled i utrzymujemy security_invoker=off.
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = off) AS
SELECT
  id,
  tenant_id,
  slug,
  display_name,
  first_name,
  last_name,
  avatar_url,
  cover_url,
  bio_pl,
  bio_en,
  job_title,
  twitter_url,
  linkedin_url,
  facebook_url,
  instagram_url,
  spotify_url,
  website_url,
  current_company,
  specialization,
  verified_at,
  updated_at,
  expert_requests_enabled
FROM public.profiles
WHERE tenant_id = public_tenant_id();

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- ── (3) Admin: przełącznik per-user (profiles UPDATE jest own-row only) ──────
CREATE OR REPLACE FUNCTION public.admin_set_expert_requests_enabled(
  p_user_id uuid,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_tenant uuid;
  v_target_tenant uuid;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT tenant_id INTO v_caller_tenant FROM public.profiles WHERE id = v_caller;
  SELECT tenant_id INTO v_target_tenant FROM public.profiles WHERE id = p_user_id;
  IF v_target_tenant IS NULL OR v_target_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'forbidden: target outside caller tenant';
  END IF;

  UPDATE public.profiles
     SET expert_requests_enabled = COALESCE(p_enabled, true)
   WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_expert_requests_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_expert_requests_enabled(uuid, boolean)
  TO authenticated, service_role;

-- ── (4) Egzekucja serwerowa w send_expert_inmail ────────────────────────────
-- Odtworzenie ciała z 20260723092200 + dwie bramki po sprawdzeniu is_gated_recipient:
-- odbiorca musi mieć włączone przyjmowanie zapytań ORAZ funkcja włączona globalnie.
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

  -- Odbiorca wyłączył przyjmowanie zapytań (self opt-out).
  IF NOT COALESCE(
       (SELECT p.expert_requests_enabled FROM public.profiles p WHERE p.id = p_recipient_id),
       true) THEN
    RAISE EXCEPTION 'inmail: recipient not accepting requests';
  END IF;

  -- Funkcja wyłączona globalnie dla tenanta (community_modules).
  IF NOT COALESCE(
       (SELECT (s.value ->> 'expert_requests_enabled')::boolean
          FROM public.site_settings s
         WHERE s.key = 'community_modules' AND s.tenant_id = v_peer_tenant),
       true) THEN
    RAISE EXCEPTION 'inmail: feature disabled';
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
