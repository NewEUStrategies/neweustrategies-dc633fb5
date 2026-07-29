-- 1) Konfiguracja karencji na organizacji
ALTER TABLE public.member_organizations
  ADD COLUMN IF NOT EXISTS seats_grace_days integer NOT NULL DEFAULT 7;

ALTER TABLE public.member_organizations
  DROP CONSTRAINT IF EXISTS member_organizations_seats_grace_days_check;
ALTER TABLE public.member_organizations
  ADD CONSTRAINT member_organizations_seats_grace_days_check
  CHECK (seats_grace_days >= 0 AND seats_grace_days <= 90);

-- 2) Stan karencji na miejscu
ALTER TABLE public.organization_seats
  ADD COLUMN IF NOT EXISTS grace_until timestamptz;

ALTER TABLE public.organization_seats
  DROP CONSTRAINT IF EXISTS organization_seats_status_check;
ALTER TABLE public.organization_seats
  ADD CONSTRAINT organization_seats_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'grace'::text, 'suspended'::text]));

CREATE INDEX IF NOT EXISTS idx_org_seats_grace_until
  ON public.organization_seats (grace_until)
  WHERE status = 'grace';

-- 3) Przeliczenie miejsc z karencją.
--    Miejsca ponad limit trafiają najpierw do 'grace' (o ile organizacja ma
--    dni karencji > 0), a dopiero po terminie tracą dostęp. Zwracamy listy
--    adresów, żeby warstwa aplikacji mogła wysłać powiadomienia.
CREATE OR REPLACE FUNCTION public.org_reconcile_seats(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_grace_days integer;
  v_active integer;
  v_grace integer;
  v_suspended integer;
  v_entered_grace jsonb := '[]'::jsonb;
  v_lost jsonb := '[]'::jsonb;
BEGIN
  SELECT seats_limit, COALESCE(seats_grace_days, 0)
    INTO v_limit, v_grace_days
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
  ),
  target AS (
    SELECT s.id,
           s.status AS old_status,
           s.invited_email,
           s.grace_until AS old_grace_until,
           CASE
             WHEN r.rn <= v_limit THEN 'active'
             WHEN v_grace_days = 0 THEN 'suspended'
             WHEN s.status = 'suspended' THEN 'suspended'
             ELSE 'grace'
           END AS new_status
      FROM public.organization_seats s
      JOIN ranked r ON r.id = s.id
     WHERE s.org_id = p_org
  ),
  updated AS (
    UPDATE public.organization_seats s
       SET status = t.new_status,
           grace_until = CASE
             WHEN t.new_status = 'grace'
               THEN COALESCE(t.old_grace_until, now() + make_interval(days => v_grace_days))
             ELSE NULL
           END,
           suspended_at = CASE
             WHEN t.new_status = 'suspended' THEN COALESCE(s.suspended_at, now())
             ELSE NULL
           END,
           suspended_reason = CASE
             WHEN t.new_status = 'active' THEN NULL
             ELSE 'seats_limit'
           END
      FROM target t
     WHERE s.id = t.id
       AND (s.status IS DISTINCT FROM t.new_status
            OR (t.new_status = 'grace' AND s.grace_until IS NULL))
    RETURNING s.id, s.invited_email, s.status AS new_status, s.grace_until, t.old_status
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'seat_id', id, 'email', invited_email, 'grace_until', grace_until
    )) FILTER (WHERE new_status = 'grace' AND old_status <> 'grace'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'seat_id', id, 'email', invited_email
    )) FILTER (WHERE new_status = 'suspended' AND old_status <> 'suspended'), '[]'::jsonb)
    INTO v_entered_grace, v_lost
    FROM updated;

  SELECT count(*) FILTER (WHERE status = 'active'),
         count(*) FILTER (WHERE status = 'grace'),
         count(*) FILTER (WHERE status = 'suspended')
    INTO v_active, v_grace, v_suspended
    FROM public.organization_seats WHERE org_id = p_org;

  RETURN jsonb_build_object(
    'seats_limit', v_limit,
    'grace_days', v_grace_days,
    'active', COALESCE(v_active, 0),
    'grace', COALESCE(v_grace, 0),
    'suspended', COALESCE(v_suspended, 0),
    'entered_grace', COALESCE(v_entered_grace, '[]'::jsonb),
    'lost_access', COALESCE(v_lost, '[]'::jsonb)
  );
END
$$;

-- 4) Ustawienie długości karencji (admin tenanta albo właściciel organizacji)
CREATE OR REPLACE FUNCTION public.org_set_seats_grace_days(p_org uuid, p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_days integer := GREATEST(0, LEAST(90, COALESCE(p_days, 0)));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;
  IF NOT (
    (public.has_role(v_uid, 'admin'::app_role) AND v_org.tenant_id = public.current_tenant_id())
    OR public.is_org_owner(p_org)
  ) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;

  UPDATE public.member_organizations
     SET seats_grace_days = v_days, updated_at = now()
   WHERE id = p_org;

  RETURN public.org_reconcile_seats(p_org);
END
$$;

-- 5) Wygaszenie karencji po terminie - wołane przez zaplecze (job/webhook)
CREATE OR REPLACE FUNCTION public.org_expire_seat_grace()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired jsonb;
BEGIN
  WITH expired AS (
    UPDATE public.organization_seats s
       SET status = 'suspended',
           suspended_at = COALESCE(s.suspended_at, now()),
           suspended_reason = 'seats_limit',
           grace_until = NULL
     WHERE s.status = 'grace'
       AND s.grace_until IS NOT NULL
       AND s.grace_until <= now()
    RETURNING s.id, s.org_id, s.invited_email
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'seat_id', id, 'org_id', org_id, 'email', invited_email
  )), '[]'::jsonb) INTO v_expired FROM expired;

  RETURN jsonb_build_object('expired', v_expired,
                            'count', jsonb_array_length(COALESCE(v_expired, '[]'::jsonb)));
END
$$;

REVOKE ALL ON FUNCTION public.org_expire_seat_grace() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_expire_seat_grace() TO service_role;
GRANT EXECUTE ON FUNCTION public.org_set_seats_grace_days(uuid, integer) TO authenticated, service_role;

-- 6) Karencja nadaje uprawnienia tak samo jak aktywne miejsce
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
     WHERE os.user_id=auth.uid()
       AND (os.status='active'
            OR (os.status='grace' AND (os.grace_until IS NULL OR os.grace_until > now())))
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