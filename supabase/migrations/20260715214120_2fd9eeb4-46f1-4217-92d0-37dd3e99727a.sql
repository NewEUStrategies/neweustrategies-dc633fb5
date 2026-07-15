
CREATE OR REPLACE FUNCTION public.admin_get_user_consent(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (p.prefs->'consent')
  FROM public.profiles p
  WHERE p.id = _user_id
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_consent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_consent(uuid) TO authenticated;
