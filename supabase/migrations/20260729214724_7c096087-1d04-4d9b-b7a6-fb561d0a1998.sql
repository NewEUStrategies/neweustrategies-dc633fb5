ALTER TABLE public.member_organizations
  ADD COLUMN IF NOT EXISTS seats_grace_reminder_days integer[] NOT NULL DEFAULT ARRAY[7,1];

CREATE OR REPLACE FUNCTION public.org_set_seats_grace_reminder_days(p_org uuid, p_days integer[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_org public.member_organizations%ROWTYPE;
  v_days integer[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'orgs: authentication required'; END IF;

  SELECT * INTO v_org FROM public.member_organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'orgs: not found'; END IF;
  IF NOT (
    (public.has_role(v_uid, 'admin'::app_role) AND v_org.tenant_id = public.current_tenant_id())
    OR public.is_org_owner(p_org)
  ) THEN RAISE EXCEPTION 'orgs: not allowed'; END IF;

  SELECT COALESCE(array_agg(d ORDER BY d DESC), ARRAY[]::integer[])
    INTO v_days
    FROM (
      SELECT DISTINCT GREATEST(1, LEAST(90, x)) AS d
        FROM unnest(COALESCE(p_days, ARRAY[]::integer[])) AS x
       WHERE x IS NOT NULL
    ) s;

  IF array_length(v_days, 1) > 10 THEN
    v_days := v_days[1:10];
  END IF;

  UPDATE public.member_organizations
     SET seats_grace_reminder_days = v_days, updated_at = now()
   WHERE id = p_org;

  RETURN jsonb_build_object('days', to_jsonb(v_days));
END
$function$;

GRANT EXECUTE ON FUNCTION public.org_set_seats_grace_reminder_days(uuid, integer[]) TO authenticated;