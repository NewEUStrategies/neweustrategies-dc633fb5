ALTER TABLE public.membership_grants
  DROP CONSTRAINT IF EXISTS membership_grants_source_check;
ALTER TABLE public.membership_grants
  ADD CONSTRAINT membership_grants_source_check
  CHECK (source = ANY (ARRAY['manual', 'donation', 'import', 'coupon', 'expert', 'org_domain']));

COMMENT ON COLUMN public.membership_grants.source IS
  'Pochodzenie nadania warstwy: manual (admin), donation, import, coupon '
  '(apply_b2b_coupon_effects - wylacznie po potwierdzonej płatności), expert '
  '(odznaka eksperta), org_domain (weryfikacja domeny organizacji).';

CREATE OR REPLACE FUNCTION public.my_expert_request_quota()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_direct boolean := false;
  v_quota  integer := 0;
  v_legacy integer := 0;
  v_used   integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;
  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;
  WITH keys AS (
    SELECT g.tier_key
      FROM public.membership_grants g
     WHERE g.user_id = v_uid AND g.tenant_id = v_tenant
       AND g.revoked_at IS NULL
       AND g.starts_at <= now()
       AND (g.expires_at IS NULL OR g.expires_at > now())
    UNION
    SELECT ap.tier_key
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
     WHERE us.user_id = v_uid AND us.tenant_id = v_tenant
       AND us.status::text IN ('active', 'trialing', 'past_due')
       AND ap.tier_key IS NOT NULL
  )
  SELECT
    COALESCE(bool_or(COALESCE((mt.features ->> 'chat_direct_gated')::boolean, false)), false),
    COALESCE(max(NULLIF(mt.features ->> 'expert_request_quota', '')::integer), 0),
    COALESCE(max(CASE
      WHEN COALESCE((mt.features ->> 'chat_inmail_quota_5')::boolean, false) THEN 5
      WHEN COALESCE((mt.features ->> 'chat_inmail_quota_2')::boolean, false) THEN 2
      ELSE 0
    END), 0)
  INTO v_direct, v_quota, v_legacy
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;
  v_quota := GREATEST(v_quota, v_legacy);
  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid, v_tenant) THEN
    v_direct := true;
  END IF;
  SELECT count(*) INTO v_used
    FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.tenant_id = v_tenant
     AND ei.created_at >= date_trunc('month', now());
  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;
  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END $$;

COMMENT ON FUNCTION public.my_expert_request_quota() IS
  'Miesięczna pula „Zapytań do eksperta" (quota/used/remaining/unlimited/direct) per tenant. Pula = GREATEST(features.expert_request_quota, dawne chat_inmail_quota_2/5); `used` liczy WSZYSTKIE wysłane w bieżącym miesiącu, także anulowane. Status eksperta rozstrzygany JAWNIE w obszarze roboczym wołającego.';

CREATE OR REPLACE FUNCTION public.send_expert_request(
  p_recipient_id uuid,
  p_subject text,
  p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_tenant      uuid;
  v_peer_tenant uuid;
  v_new_id      uuid;
  v_link        text;
  v_q           jsonb;
  v_quota       integer;
  v_used        integer;
  v_recent      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'expert_request: authentication required';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'expert_request: invalid recipient';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text));
  SELECT tenant_id INTO v_tenant      FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'expert_request: recipient not available';
  END IF;
  IF NOT public.is_gated_recipient(p_recipient_id, v_tenant) THEN
    RAISE EXCEPTION 'expert_request: recipient is not gated';
  END IF;
  IF NOT COALESCE(
       (SELECT p.expert_requests_enabled FROM public.profiles p WHERE p.id = p_recipient_id),
       true) THEN
    RAISE EXCEPTION 'expert_request: recipient not accepting requests';
  END IF;
  IF NOT COALESCE(
       (SELECT (s.value ->> 'expert_requests_enabled')::boolean
          FROM public.site_settings s
         WHERE s.key = 'community_modules' AND s.tenant_id = v_tenant),
       true) THEN
    RAISE EXCEPTION 'expert_request: feature disabled';
  END IF;
  IF char_length(coalesce(p_subject, '')) < 5 OR char_length(coalesce(p_subject, '')) > 140 THEN
    RAISE EXCEPTION 'expert_request: subject length';
  END IF;
  IF char_length(coalesce(p_reason, '')) < 20 OR char_length(coalesce(p_reason, '')) > 2000 THEN
    RAISE EXCEPTION 'expert_request: reason length';
  END IF;
  IF p_questions IS NOT NULL AND array_length(p_questions, 1) > 5 THEN
    RAISE EXCEPTION 'expert_request: too many questions';
  END IF;
  IF p_external_links IS NOT NULL AND array_length(p_external_links, 1) > 3 THEN
    RAISE EXCEPTION 'expert_request: too many links';
  END IF;
  IF p_external_links IS NOT NULL THEN
    FOREACH v_link IN ARRAY p_external_links LOOP
      IF v_link !~* '^https?://' THEN
        RAISE EXCEPTION 'expert_request: invalid link';
      END IF;
    END LOOP;
  END IF;
  v_q     := public.my_expert_request_quota();
  v_quota := COALESCE((v_q ->> 'quota')::integer, 0);
  v_used  := COALESCE((v_q ->> 'used')::integer, 0);
  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'expert_request: tier disabled';
  END IF;
  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'expert_request: monthly quota exceeded';
  END IF;
  SELECT count(*) INTO v_recent
    FROM public.expert_inmails ei
   WHERE ei.sender_id = v_uid
     AND ei.recipient_id = p_recipient_id
     AND ei.created_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'expert_request: rate limit';
  END IF;
  INSERT INTO public.expert_inmails
    (tenant_id, sender_id, recipient_id, subject, reason, questions,
     expected_answers, external_links)
  VALUES
    (v_tenant, v_uid, p_recipient_id, btrim(p_subject), btrim(p_reason),
     COALESCE(p_questions, ARRAY[]::text[]),
     NULLIF(btrim(coalesce(p_expected_answers, '')), ''),
     COALESCE(p_external_links, ARRAY[]::text[]))
  RETURNING id INTO v_new_id;
  RETURN v_new_id;
END $$;

COMMENT ON FUNCTION public.send_expert_request(uuid, text, text, text[], text, text[]) IS
  'Wysyła „Zapytanie do eksperta". Bramki: ten sam tenant, odbiorca ekspert/VIP z włączonym przyjmowaniem (status liczony w obszarze roboczym nadawcy), moduł włączony w tenancie, walidacja treści, pula miesięczna (anulowane liczą się) i antyspam 5/24 h per odbiorca. Wysyłki jednego nadawcy serializuje pg_advisory_xact_lock.';

CREATE OR REPLACE FUNCTION public.is_service_role_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT current_setting('role', true) = 'service_role'
      OR current_setting('request.jwt.claim.role', true) = 'service_role'
      OR auth.role() = 'service_role'
$$;

COMMENT ON FUNCTION public.is_service_role_caller() IS
  'Czy zapis idzie rola serwerowa (klucz service_role). Role wolajacego czytamy z GUC `role` oraz z roszczenia JWT w obu zapisach - w SECURITY DEFINER `current_user` pokazuje wlasciciela funkcji, nie wolajacego, wiec porownanie z current_user jest tam ZAWSZE falszywe.';

REVOKE ALL ON FUNCTION public.is_service_role_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_service_role_caller() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_service_role_caller() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profiles_pin_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := public.is_service_role_caller();
  v_is_super boolean := public.has_role(auth.uid(), 'super_admin'::public.app_role);
BEGIN
  IF v_is_service OR v_is_super THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.id = auth.uid() THEN
      NEW.tenant_id := COALESCE(
        (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
        NEW.tenant_id,
        (SELECT id FROM public.tenants WHERE is_default = true LIMIT 1)
      );
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'profiles.tenant_id is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_pin_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND NOT (
       public.is_service_role_caller()
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
     ) THEN
    NEW.tenant_id := OLD.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "events public read" ON public.events;
CREATE POLICY "events public read" ON public.events
  FOR SELECT TO anon
  USING (
    status = 'published'
    AND tenant_id = (SELECT public.public_tenant_id())
    AND visibility = 'public'
    AND COALESCE(min_tier_rank, 0) = 0
  );

COMMENT ON POLICY "events public read" ON public.events IS
  'Anonimowy odczyt wydarzeń: opublikowane, w tenancie publicznym żądania i niebramkowane w OBU wymiarach (visibility = public ORAZ próg rangi 0). Ta sama definicja bramki, którą egzekwują rsvp_event i get_event_access - members z domyślną rangą 0 też jest bramkowane.';