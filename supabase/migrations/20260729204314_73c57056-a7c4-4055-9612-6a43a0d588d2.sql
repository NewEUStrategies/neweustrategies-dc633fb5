ALTER TABLE public.member_organizations
  ADD COLUMN IF NOT EXISTS paddle_subscription_id text,
  ADD COLUMN IF NOT EXISTS seats_source text NOT NULL DEFAULT 'manual';

DO $$ BEGIN
  ALTER TABLE public.member_organizations
    ADD CONSTRAINT member_organizations_seats_source_check
    CHECK (seats_source IN ('manual','subscription'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_member_orgs_paddle_subscription
  ON public.member_organizations(paddle_subscription_id)
  WHERE paddle_subscription_id IS NOT NULL;

ALTER TABLE public.organization_seats
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

DO $$ BEGIN
  ALTER TABLE public.organization_seats
    ADD CONSTRAINT organization_seats_status_check
    CHECK (status IN ('active','suspended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_org_seats_org_status
  ON public.organization_seats(org_id, status);

CREATE OR REPLACE FUNCTION public.org_reconcile_seats(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_active integer;
  v_suspended integer;
BEGIN
  SELECT seats_limit INTO v_limit
    FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF v_limit IS NULL THEN RAISE EXCEPTION 'orgs: not found'; END IF;

  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             ORDER BY (role = 'owner') DESC,
                      (claimed_at IS NOT NULL) DESC,
                      COALESCE(claimed_at, created_at) ASC,
                      created_at ASC,
                      id ASC
           ) AS rn
      FROM public.organization_seats
     WHERE org_id = p_org
  )
  UPDATE public.organization_seats s
     SET status = CASE WHEN r.rn <= v_limit THEN 'active' ELSE 'suspended' END,
         suspended_at = CASE WHEN r.rn <= v_limit THEN NULL ELSE COALESCE(s.suspended_at, now()) END,
         suspended_reason = CASE WHEN r.rn <= v_limit THEN NULL ELSE 'seats_limit' END
    FROM ranked r
   WHERE s.id = r.id
     AND s.status IS DISTINCT FROM (CASE WHEN r.rn <= v_limit THEN 'active' ELSE 'suspended' END);

  SELECT count(*) FILTER (WHERE status = 'active'),
         count(*) FILTER (WHERE status = 'suspended')
    INTO v_active, v_suspended
    FROM public.organization_seats WHERE org_id = p_org;

  RETURN jsonb_build_object(
    'seats_limit', v_limit,
    'active', COALESCE(v_active, 0),
    'suspended', COALESCE(v_suspended, 0)
  );
END $$;

REVOKE ALL ON FUNCTION public.org_reconcile_seats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_reconcile_seats(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.org_set_seats_limit(
  p_org uuid,
  p_limit integer,
  p_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_limit integer := GREATEST(1, LEAST(500, COALESCE(p_limit, 1)));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('manual','subscription') THEN
    RAISE EXCEPTION 'orgs: invalid seats source';
  END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;
  IF NOT (
    (public.has_role(v_uid, 'admin'::app_role) AND v_org.tenant_id = public.current_tenant_id())
    OR public.is_org_owner(p_org)
  ) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;

  IF v_org.seats_source = 'subscription'
     AND NOT (public.has_role(v_uid, 'admin'::app_role) AND v_org.tenant_id = public.current_tenant_id())
  THEN
    RAISE EXCEPTION 'orgs: seats managed by subscription';
  END IF;

  UPDATE public.member_organizations
     SET seats_limit = v_limit,
         seats_source = COALESCE(p_source, seats_source),
         updated_at = now()
   WHERE id = p_org;

  RETURN public.org_reconcile_seats(p_org);
END $$;

REVOKE ALL ON FUNCTION public.org_set_seats_limit(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_set_seats_limit(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_set_seats_limit(uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.org_apply_subscription_seats(
  p_subscription_id text,
  p_quantity integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_limit integer := GREATEST(1, LEAST(500, COALESCE(p_quantity, 1)));
BEGIN
  SELECT id INTO v_org
    FROM public.member_organizations
   WHERE paddle_subscription_id = p_subscription_id
   LIMIT 1;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('linked', false);
  END IF;

  UPDATE public.member_organizations
     SET seats_limit = v_limit,
         seats_source = 'subscription',
         updated_at = now()
   WHERE id = v_org;

  RETURN public.org_reconcile_seats(v_org) || jsonb_build_object('linked', true, 'org_id', v_org);
END $$;

REVOKE ALL ON FUNCTION public.org_apply_subscription_seats(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_apply_subscription_seats(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.org_add_seat(
  p_org uuid,
  p_email text,
  p_role text DEFAULT 'member'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user uuid; v_used integer; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;
  IF p_role NOT IN ('owner', 'member') THEN RAISE EXCEPTION 'orgs: invalid role'; END IF;
  IF v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'orgs: invalid email';
  END IF;
  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;
  IF NOT (
    (public.has_role(v_uid, 'admin'::app_role) AND v_org.tenant_id = public.current_tenant_id())
    OR public.is_org_owner(p_org)
  ) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;
  IF p_role = 'owner' AND NOT (
    public.has_role(v_uid, 'admin'::app_role) AND v_org.tenant_id = public.current_tenant_id()
  ) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;
  IF v_org.status <> 'active' THEN RAISE EXCEPTION 'orgs: organization inactive'; END IF;
  SELECT count(*) INTO v_used
    FROM public.organization_seats
   WHERE org_id = p_org AND status = 'active';
  IF v_used >= v_org.seats_limit THEN RAISE EXCEPTION 'orgs: seats limit reached'; END IF;
  SELECT u.id INTO v_user FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;
  INSERT INTO public.organization_seats
    (tenant_id, org_id, invited_email, user_id, role, claimed_at, invited_by, last_invited_at, status)
  VALUES
    (v_org.tenant_id, p_org, v_email, v_user, p_role,
     CASE WHEN v_user IS NULL THEN NULL ELSE now() END,
     v_uid, now(), 'active')
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'orgs: seat exists';
END $$;

CREATE OR REPLACE FUNCTION public.current_membership_tier()
RETURNS TABLE(key text, rank integer, name_pl text, name_en text, features jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (SELECT COALESCE(public.public_tenant_id(), public.current_tenant_id()) AS tid),
  entitled AS (
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.user_subscriptions us JOIN public.access_plans ap ON ap.id=us.plan_id
      JOIN t ON ap.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=ap.tenant_id AND mt.key=ap.tier_key AND mt.active
     WHERE us.user_id=auth.uid() AND us.status='active'
       AND (us.current_period_end IS NULL OR us.current_period_end > now())
    UNION ALL
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.membership_grants mg JOIN t ON mg.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=mg.tenant_id AND mt.key=mg.tier_key AND mt.active
     WHERE mg.user_id=auth.uid() AND mg.revoked_at IS NULL AND mg.starts_at <= now()
       AND (mg.expires_at IS NULL OR mg.expires_at > now())
    UNION ALL
    SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
      FROM public.organization_seats os JOIN public.member_organizations mo ON mo.id=os.org_id
      JOIN t ON mo.tenant_id=t.tid
      JOIN public.membership_tiers mt ON mt.tenant_id=mo.tenant_id AND mt.key=mo.tier_key AND mt.active
     WHERE os.user_id=auth.uid() AND os.status='active'
       AND mo.status='active' AND mo.starts_at <= now()
       AND (mo.expires_at IS NULL OR mo.expires_at > now())
  ),
  best AS (SELECT * FROM entitled ORDER BY rank DESC LIMIT 1),
  def AS (SELECT mt.key, mt.rank, mt.name_pl, mt.name_en, mt.features
            FROM public.membership_tiers mt JOIN t ON mt.tenant_id=t.tid
           WHERE mt.is_default AND mt.active LIMIT 1)
  SELECT * FROM best
  UNION ALL SELECT * FROM def WHERE NOT EXISTS (SELECT 1 FROM best)
  UNION ALL SELECT 'reader',0,'Konto bezpłatne','Free account','{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM best) AND NOT EXISTS (SELECT 1 FROM def);
$$;

CREATE OR REPLACE FUNCTION public.my_organization()
RETURNS TABLE(
  org_id uuid, name text, tier_key text, my_role text, status text,
  seats_limit integer, seats_used integer, starts_at timestamptz, expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mo.id, mo.name, mo.tier_key, os.role, mo.status, mo.seats_limit,
         (SELECT count(*)::integer FROM public.organization_seats s
           WHERE s.org_id=mo.id AND s.status='active'),
         mo.starts_at, mo.expires_at
    FROM public.organization_seats os
    JOIN public.member_organizations mo ON mo.id=os.org_id
    LEFT JOIN public.membership_tiers mt ON mt.tenant_id=mo.tenant_id AND mt.key=mo.tier_key
   WHERE os.user_id=auth.uid()
     AND mo.tenant_id=COALESCE(public.public_tenant_id(), public.current_tenant_id())
   ORDER BY COALESCE(mt.rank,0) DESC, mo.created_at ASC LIMIT 1;
$$;