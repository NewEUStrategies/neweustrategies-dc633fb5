CREATE OR REPLACE FUNCTION public.admin_claim_invitation_send(p_invitation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.user_invitations
     SET send_count = send_count + 1
   WHERE id = p_invitation_id
     AND send_count < 5
     AND tenant_id = public._caller_tenant()
     AND (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
     )
  RETURNING send_count INTO v_count;

  IF v_count IS NULL THEN
    RAISE EXCEPTION 'activation_send_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_claim_invitation_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_claim_invitation_send(uuid) TO authenticated, service_role;
