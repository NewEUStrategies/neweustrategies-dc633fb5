-- ============================================================================
-- FIX (P0): kolizja timestampów migracji 20260723180000 (seed_pricing_defaults)
-- ============================================================================
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

  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('gift_links', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle', 'ngo', 'team')
     AND NOT (features ? 'gift_links');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('expert_request_quota', 1)
   WHERE tenant_id = p_tenant AND key = 'member'
     AND NOT (features ? 'expert_request_quota');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('expert_request_quota', 3)
   WHERE tenant_id = p_tenant AND key IN ('pro', 'ngo')
     AND NOT (features ? 'expert_request_quota');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('chat_direct_gated', true)
   WHERE tenant_id = p_tenant
     AND key IN ('vip', 'team', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'chat_direct_gated');

  PERFORM public.seed_chat_tier_flags(p_tenant);
  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  PERFORM public.apply_pricing_catalog_v4(p_tenant);
  PERFORM public.apply_pricing_catalog_v5(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_chat_tier_flags(r.id);
    PERFORM public.apply_pricing_catalog_v5(r.id);
  END LOOP;
END;
$$;

-- ============================================================================
-- FIX (P1): regresja ekspozycji PII w public.profiles
-- ============================================================================
REVOKE SELECT ON public.profiles FROM authenticated;
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (
  id, tenant_id, slug, display_name, first_name, last_name,
  avatar_url, cover_url, bio, bio_pl, bio_en,
  job_title, current_company, specialization,
  twitter_url, linkedin_url, facebook_url, instagram_url, spotify_url, website_url,
  verified_at, created_at, updated_at
) ON public.profiles TO anon;

DROP POLICY IF EXISTS "Profiles anon read tenant via view" ON public.profiles;
DROP POLICY IF EXISTS "Profiles anon no direct read" ON public.profiles;
DROP POLICY IF EXISTS "Profiles anon public authors" ON public.profiles;
CREATE POLICY "Profiles anon public authors" ON public.profiles
  FOR SELECT TO anon
  USING (
    tenant_id = public_tenant_id()
    AND slug IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = profiles.id
        AND ur.role IN ('admin', 'editor', 'author', 'super_admin')
    )
  );

ALTER VIEW public.profiles_public SET (security_invoker = off);
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- ============================================================================
-- FIX (P1): crm_upsert_lead – zdejmij grant dla authenticated
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_upsert_lead(uuid, text, text, text, text, text, boolean, boolean)
  TO service_role;

-- ============================================================================
-- FIX (P1): monetization_dashboard – tenant scope w CTE orders
-- ============================================================================
CREATE OR REPLACE FUNCTION public.monetization_dashboard(
  _from timestamptz DEFAULT (now() - interval '30 days'),
  _to timestamptz DEFAULT now(),
  _plan_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE v_tenant uuid := public.public_tenant_id(); v_out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH mv AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE user_id IS NOT NULL)::int AS members,
           count(*) FILTER (WHERE user_id IS NULL)::int AS anonymous
    FROM public.metered_views
    WHERE tenant_id = v_tenant AND created_at >= _from AND created_at <= _to
  ), ev AS (
    SELECT
      count(*) FILTER (WHERE outcome='consumed')::int AS consumed,
      count(*) FILTER (WHERE outcome='denied')::int AS denied,
      count(*) FILTER (WHERE outcome='requires_registration')::int AS reg_wall
    FROM public.metering_event_log
    WHERE tenant_id = v_tenant AND occurred_at >= _from AND occurred_at <= _to
  ), orders AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='paid')::int AS paid,
           coalesce(sum(amount_cents) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents
    FROM public.payment_orders
    WHERE tenant_id = v_tenant
      AND created_at >= _from AND created_at <= _to
      AND (_plan_id IS NULL OR plan_id = _plan_id)
  ), coupons AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE active)::int AS active,
           coalesce(sum(redemptions_count),0)::int AS redemptions
    FROM public.b2b_coupons
    WHERE tenant_id = v_tenant
      AND (_organization_id IS NULL OR organization_id = _organization_id)
  ), redemptions AS (
    SELECT count(*)::int AS in_range,
           coalesce(sum(applied_cents),0)::bigint AS discount_cents
    FROM public.b2b_coupon_redemptions r
    WHERE r.tenant_id = v_tenant
      AND r.created_at >= _from AND r.created_at <= _to
      AND (_organization_id IS NULL
           OR EXISTS (SELECT 1 FROM public.b2b_coupons c
                       WHERE c.id = r.coupon_id AND c.organization_id = _organization_id))
  ), cs AS (
    SELECT to_jsonb(cs.*) AS settings
    FROM public.checkout_settings cs
    WHERE cs.tenant_id = v_tenant
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'metered_views', (SELECT to_jsonb(mv) FROM mv),
    'metering_events', (SELECT to_jsonb(ev) FROM ev),
    'orders', (SELECT to_jsonb(orders) FROM orders),
    'coupons', (SELECT to_jsonb(coupons) FROM coupons),
    'redemptions', (SELECT to_jsonb(redemptions) FROM redemptions),
    'checkout_settings', COALESCE((SELECT settings FROM cs), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

-- ============================================================================
-- FIX (P1): comments_guard_update – re-moderacja przy edycji autora
-- ============================================================================
CREATE OR REPLACE FUNCTION public.comments_guard_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_moderated boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.post_id IS DISTINCT FROM OLD.post_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'comments: identity columns are immutable';
  END IF;

  IF public.has_role(v_uid, 'admin'::app_role)
     OR public.has_role(v_uid, 'editor'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body THEN
    IF OLD.status = 'deleted' OR OLD.created_at < now() - interval '15 minutes' THEN
      RAISE EXCEPTION 'comments: edit window expired';
    END IF;
    NEW.edited_at := now();

    SELECT COALESCE((s.value ->> 'moderate_new_comments')::boolean, true)
      INTO v_moderated
      FROM public.site_settings s
     WHERE s.key = 'discussion' AND s.tenant_id = OLD.tenant_id;

    IF COALESCE(v_moderated, true) AND OLD.status = 'approved'
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      NEW.status := 'pending';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('deleted', 'pending') THEN
    RAISE EXCEPTION 'comments: only soft delete is allowed';
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- FIX (P1): expert_request – kwota, advisory lock, liczenie z anulowanymi
-- ============================================================================
CREATE OR REPLACE FUNCTION public.my_expert_request_quota()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_direct boolean := false;
  v_quota integer := 0;
  v_used integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('quota', 0, 'used', 0, 'remaining', 0,
                              'unlimited', false, 'direct', false);
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;

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
    COALESCE(max(NULLIF(mt.features ->> 'expert_request_quota', '')::integer), 0)
  INTO v_direct, v_quota
  FROM keys k
  JOIN public.membership_tiers mt
    ON mt.tenant_id = v_tenant AND mt.key = k.tier_key;

  IF public.is_super_admin(v_uid) OR public.is_expert_user(v_uid) THEN
    v_direct := true;
  END IF;

  SELECT count(*) INTO v_used
    FROM public.expert_requests er
   WHERE er.sender_id = v_uid
     AND er.created_at >= date_trunc('month', now());

  IF v_direct THEN
    RETURN jsonb_build_object('quota', 100000, 'used', v_used, 'remaining', 100000,
                              'unlimited', true, 'direct', true);
  END IF;

  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                            'remaining', GREATEST(v_quota - v_used, 0),
                            'unlimited', false, 'direct', false);
END $$;

CREATE OR REPLACE FUNCTION public.send_expert_request(
  p_recipient_id uuid, p_subject text, p_reason text,
  p_questions text[] DEFAULT ARRAY[]::text[],
  p_expected_answers text DEFAULT NULL,
  p_external_links text[] DEFAULT ARRAY[]::text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid; v_peer_tenant uuid; v_new_id uuid; v_link text;
  v_q jsonb; v_quota integer; v_used integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'expert_request: authentication required'; END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_uid THEN
    RAISE EXCEPTION 'expert_request: invalid recipient';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text));

  SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
  SELECT tenant_id INTO v_peer_tenant FROM public.profiles WHERE id = p_recipient_id;
  IF v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant THEN
    RAISE EXCEPTION 'expert_request: recipient not available';
  END IF;

  IF NOT public.is_gated_recipient(p_recipient_id) THEN
    RAISE EXCEPTION 'expert_request: recipient is not gated';
  END IF;

  v_q := public.my_expert_request_quota();
  v_quota := COALESCE((v_q ->> 'quota')::integer, 0);
  v_used  := COALESCE((v_q ->> 'used')::integer, 0);

  IF v_quota <= 0 THEN
    RAISE EXCEPTION 'expert_request: tier disabled';
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

  IF v_used >= v_quota THEN
    RAISE EXCEPTION 'expert_request: monthly quota exceeded';
  END IF;

  INSERT INTO public.expert_requests
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

-- ============================================================================
-- FIX (P1): Gift Articles – bezpieczne domyślne, cap odsłon, advisory lock
-- ============================================================================
ALTER TABLE public.gift_article_settings
  ADD COLUMN IF NOT EXISTS max_redemptions_per_link integer NOT NULL DEFAULT 50
    CHECK (max_redemptions_per_link BETWEEN 0 AND 100000);

ALTER TABLE public.gift_article_settings ALTER COLUMN monthly_limit SET DEFAULT 10;
ALTER TABLE public.gift_article_settings ALTER COLUMN link_ttl_days SET DEFAULT 30;

UPDATE public.gift_article_settings SET monthly_limit = 10 WHERE monthly_limit = 0;
UPDATE public.gift_article_settings SET link_ttl_days = 30 WHERE link_ttl_days = 0;

CREATE OR REPLACE FUNCTION public.redeem_gift_link(_post_id uuid, _code text)
RETURNS TABLE (
  valid boolean,
  content_pl text,
  content_en text,
  builder_data jsonb,
  blocks_data jsonb
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.public_tenant_id();
  v_uid uuid := auth.uid();
  v_link public.post_gift_links%ROWTYPE;
  v_cap integer := 50;
BEGIN
  SELECT * INTO v_link
    FROM public.post_gift_links l
   WHERE l.code = _code
     AND l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.revoked_at IS NULL
     AND (l.expires_at IS NULL OR l.expires_at > now());

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode = 'password'
  ) THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;

  SELECT COALESCE(s.max_redemptions_per_link, 50) INTO v_cap
    FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  v_cap := COALESCE(v_cap, 50);

  IF v_uid IS DISTINCT FROM v_link.created_by THEN
    IF v_cap > 0 AND v_link.redemption_count >= v_cap THEN
      RETURN QUERY SELECT false, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
      RETURN;
    END IF;
    UPDATE public.post_gift_links
       SET redemption_count = redemption_count + 1,
           last_redeemed_at = now()
     WHERE id = v_link.id;
  END IF;

  RETURN QUERY
    SELECT true, p.content_pl, p.content_en, p.builder_data, p.blocks_data
      FROM public.posts p
     WHERE p.id = _post_id
       AND p.tenant_id = v_tenant
       AND p.status = 'published'
       AND p.deleted_at IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.create_gift_link(_post_id uuid)
RETURNS TABLE (
  code text,
  expires_at timestamptz,
  used integer,
  monthly_limit integer,
  remaining integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
  v_settings public.gift_article_settings%ROWTYPE;
  v_enabled boolean := true;
  v_limit integer := 10;
  v_ttl integer := 30;
  v_used integer := 0;
  v_existing public.post_gift_links%ROWTYPE;
  v_new_code text;
  v_new_expires timestamptz;
  v_period date := (date_trunc('month', now()))::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'gift_auth_required';
  END IF;

  SELECT * INTO v_settings FROM public.gift_article_settings s WHERE s.tenant_id = v_tenant;
  IF FOUND THEN
    v_enabled := v_settings.enabled;
    v_limit := v_settings.monthly_limit;
    v_ttl := v_settings.link_ttl_days;
  END IF;

  IF NOT v_enabled THEN
    RAISE EXCEPTION 'gift_disabled';
  END IF;

  IF NOT public.can_gift_articles() THEN
    RAISE EXCEPTION 'gift_subscription_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.posts p
     WHERE p.id = _post_id
       AND p.tenant_id = v_tenant
       AND p.status = 'published'
       AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'gift_post_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.content_access ca
     WHERE ca.entity_type = 'post'
       AND ca.entity_id = _post_id
       AND ca.mode = 'password'
  ) THEN
    RAISE EXCEPTION 'gift_post_not_found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('gift:' || v_uid::text));

  SELECT * INTO v_existing
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.post_id = _post_id
     AND l.created_by = v_uid
     AND l.revoked_at IS NULL;

  IF FOUND AND (v_existing.expires_at IS NULL OR v_existing.expires_at > now()) THEN
    SELECT count(*)::integer INTO v_used
      FROM public.post_gift_links l
     WHERE l.tenant_id = v_tenant
       AND l.created_by = v_uid
       AND l.period_month = v_period
       AND l.revoked_at IS NULL;
    RETURN QUERY SELECT
      v_existing.code,
      v_existing.expires_at,
      v_used,
      v_limit,
      CASE WHEN v_limit > 0 THEN GREATEST(v_limit - v_used, 0) ELSE NULL::integer END;
    RETURN;
  END IF;

  IF FOUND THEN
    UPDATE public.post_gift_links SET revoked_at = now() WHERE id = v_existing.id;
  END IF;

  SELECT count(*)::integer INTO v_used
    FROM public.post_gift_links l
   WHERE l.tenant_id = v_tenant
     AND l.created_by = v_uid
     AND l.period_month = v_period
     AND l.revoked_at IS NULL;

  IF v_limit > 0 AND v_used >= v_limit THEN
    RAISE EXCEPTION 'gift_limit_reached';
  END IF;

  v_new_expires := CASE WHEN v_ttl > 0 THEN now() + make_interval(days => v_ttl) END;

  INSERT INTO public.post_gift_links (tenant_id, post_id, created_by, expires_at)
  VALUES (v_tenant, _post_id, v_uid, v_new_expires)
  RETURNING post_gift_links.code INTO v_new_code;

  RETURN QUERY SELECT
    v_new_code,
    v_new_expires,
    v_used + 1,
    v_limit,
    CASE WHEN v_limit > 0 THEN GREATEST(v_limit - (v_used + 1), 0) ELSE NULL::integer END;
END $$;

-- ============================================================================
-- FIX (P1): list_qa_questions – zwracaj my_vote
-- ============================================================================
DROP FUNCTION IF EXISTS public.list_qa_questions(uuid);

CREATE FUNCTION public.list_qa_questions(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  author_display text,
  is_anonymous boolean,
  body text,
  status text,
  answer_body text,
  answered_at timestamptz,
  created_at timestamptz,
  votes bigint,
  is_priority boolean,
  my_vote boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id,
    q.session_id,
    q.author_display,
    q.is_anonymous,
    q.body,
    q.status,
    q.answer_body,
    q.answered_at,
    q.created_at,
    COALESCE(v.votes, 0) AS votes,
    public.user_has_tier_feature(q.user_id, 'qa_priority') AS is_priority,
    EXISTS (
      SELECT 1 FROM public.qa_question_votes qv
       WHERE qv.question_id = q.id AND qv.user_id = auth.uid()
    ) AS my_vote
  FROM public.qa_questions q
  LEFT JOIN LATERAL (
    SELECT count(*) AS votes
      FROM public.qa_question_votes qv
     WHERE qv.question_id = q.id
  ) v ON true
  WHERE q.session_id = p_session_id
    AND q.tenant_id = public.public_tenant_id()
    AND q.status IN ('approved', 'answered')
  ORDER BY
    public.user_has_tier_feature(q.user_id, 'qa_priority') DESC,
    COALESCE(v.votes, 0) DESC,
    q.created_at ASC
  LIMIT 500;
$$;

REVOKE EXECUTE ON FUNCTION public.list_qa_questions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_qa_questions(uuid) TO anon, authenticated, service_role;

-- ============================================================================
-- FIX (P1): claim_integration_deliveries – dzierżawa 5 min, reclaim
-- ============================================================================
CREATE OR REPLACE FUNCTION public.claim_integration_deliveries(p_limit integer DEFAULT 20)
RETURNS SETOF public.integration_deliveries
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.integration_deliveries d
     SET status = 'delivering',
         attempts = d.attempts + 1,
         next_attempt_at = now() + interval '5 minutes'
   WHERE d.id IN (
     SELECT i.id FROM public.integration_deliveries i
      WHERE i.status IN ('queued', 'failed', 'delivering')
        AND i.next_attempt_at <= now()
      ORDER BY i.next_attempt_at ASC
      LIMIT GREATEST(1, LEAST(p_limit, 100))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END;
$$;