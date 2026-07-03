CREATE OR REPLACE FUNCTION public.admin_update_user_avatar(_user_id uuid, _avatar_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no_tenant_context'; END IF;
  IF NOT (public.has_role(v_actor, 'admin') OR public.is_super_admin(v_actor)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND tenant_id = v_tenant
  ) THEN RAISE EXCEPTION 'target_not_in_tenant'; END IF;

  UPDATE public.profiles
     SET avatar_url = _avatar_url,
         updated_at = now()
   WHERE id = _user_id AND tenant_id = v_tenant;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_avatar(uuid, text) TO authenticated;