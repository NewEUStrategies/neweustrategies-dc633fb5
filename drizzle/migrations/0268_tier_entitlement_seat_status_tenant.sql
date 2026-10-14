
CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text, p_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND p_tenant IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.user_subscriptions us
        JOIN public.access_plans ap ON ap.id = us.plan_id AND ap.tenant_id = p_tenant
        JOIN public.membership_tiers mt
          ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
       WHERE us.user_id = p_user AND us.status = 'active'
         AND (us.current_period_end IS NULL OR us.current_period_end > now())
         AND (mt.features ->> _feature)::boolean IS TRUE
    ) OR EXISTS (
      SELECT 1 FROM public.membership_grants mg
        JOIN public.membership_tiers mt
          ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
       WHERE mg.user_id = p_user AND mg.tenant_id = p_tenant
         AND mg.revoked_at IS NULL
         AND mg.starts_at <= now()
         AND (mg.expires_at IS NULL OR mg.expires_at > now())
         AND (mt.features ->> _feature)::boolean IS TRUE
    ) OR EXISTS (
      SELECT 1 FROM public.organization_seats os
        JOIN public.member_organizations mo ON mo.id = os.org_id
        JOIN public.membership_tiers mt
          ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
       WHERE os.user_id = p_user AND mo.tenant_id = p_tenant
         AND (os.status = 'active'
              OR (os.status = 'grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
         AND mo.status = 'active'
         AND mo.starts_at <= now()
         AND (mo.expires_at IS NULL OR mo.expires_at > now())
         AND (mt.features ->> _feature)::boolean IS TRUE
    )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_tier_feature(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.user_has_tier_feature(uuid, text, uuid) IS
  'Flaga features warstwy uzytkownika p_user W NAJEMCY p_tenant: subskrypcja (najemca planu), '
  'nadanie albo miejsce w organizacji (status active lub grace przed grace_until). '
  'Brak najemcy/uzytkownika = false. Wylacznie service_role i funkcje SECURITY DEFINER.';

CREATE OR REPLACE FUNCTION public.user_has_tier_feature(p_user uuid, _feature text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_tier_feature(
    p_user,
    _feature,
    COALESCE(public.public_tenant_id(), public.current_tenant_id())
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_tier_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_tier_feature(uuid, text) TO service_role;

COMMENT ON FUNCTION public.user_has_tier_feature(uuid, text) IS
  'Zgodnosc wsteczna: user_has_tier_feature(p_user, _feature, najemca kontekstu) - '
  'najemca z public_tenant_id(), potem current_tenant_id(). Nowy kod podaje najemce jawnie.';

CREATE OR REPLACE FUNCTION public.user_tier_rank(p_user uuid, p_tenant uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(p_tenant, public.public_tenant_id(), public.current_tenant_id()) AS tid
  ),
  entitled AS (
    SELECT mt.rank
      FROM public.user_subscriptions us
      JOIN public.access_plans ap ON ap.id = us.plan_id
      JOIN t ON ap.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = ap.tenant_id AND mt.key = ap.tier_key AND mt.active
     WHERE us.user_id = p_user AND us.status = 'active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.rank
      FROM public.membership_grants mg
      JOIN t ON mg.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mg.tenant_id AND mt.key = mg.tier_key AND mt.active
     WHERE mg.user_id = p_user AND mg.revoked_at IS NULL
       AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.rank
      FROM public.organization_seats os
      JOIN public.member_organizations mo ON mo.id = os.org_id
      JOIN t ON mo.tenant_id = t.tid
      JOIN public.membership_tiers mt
        ON mt.tenant_id = mo.tenant_id AND mt.key = mo.tier_key AND mt.active
     WHERE os.user_id = p_user
       AND (os.status = 'active'
            OR (os.status = 'grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
       AND mo.status = 'active'
       AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  )
  SELECT COALESCE(
    (SELECT max(rank) FROM entitled),
    (SELECT mt.rank FROM public.membership_tiers mt JOIN t ON mt.tenant_id = t.tid
      WHERE mt.is_default AND mt.active LIMIT 1),
    0
  );
$$;

REVOKE ALL ON FUNCTION public.user_tier_rank(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_tier_rank(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_tenant uuid;
  v_min_rank integer;
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids, tenant_id, min_tier_rank
    INTO v_mode, v_plans, v_tenant, v_min_rank
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_min_rank := COALESCE(v_min_rank, 0);

  IF v_mode = 'members' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_uid AND p.tenant_id = v_tenant
    ) AND (v_min_rank = 0 OR public.user_tier_rank(v_uid, v_tenant) >= v_min_rank);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  IF v_min_rank > 0 THEN
    RETURN public.user_tier_rank(v_uid, v_tenant) >= v_min_rank;
  END IF;

  IF public.user_has_tier_feature(v_uid, 'premium_content', v_tenant) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.has_content_access(access_entity_type, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_content_access(access_entity_type, uuid)
  TO anon, authenticated, service_role;
